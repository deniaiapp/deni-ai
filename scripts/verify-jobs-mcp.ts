import dotenv from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Module from "node:module";
import { createServer } from "node:http";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

type NodeLoader = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
const moduleRuntime = Module as unknown as { _load: NodeLoader };
const originalLoad = moduleRuntime._load;
moduleRuntime._load = function load(request: string, parent: NodeModule | null, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let tempDir = "";

async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-jobs-"));
  // Same dialect as D1, in an isolated file. The local executor applies db/migrations itself.
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  const jobs = await import("../lib/jobs");
  const mcp = await import("../lib/mcp");
  const agent = await import("../lib/agent");

  const first = await jobs.createJob({
    userId: "tenant-a",
    threadId: "thread-a",
    botId: "bot-a",
    kind: "chat",
    idempotencyKey: "same-request",
    payload: { message: "hello" },
  });
  const duplicate = await jobs.createJob({
    userId: "tenant-a",
    threadId: "thread-a",
    botId: "bot-a",
    kind: "chat",
    idempotencyKey: "same-request",
    payload: { message: "should not duplicate" },
  });
  assert(first.id === duplicate.id, "idempotency created two jobs");

  const claims = await Promise.all([
    jobs.claimJob("tenant-a", first.id),
    jobs.claimJob("tenant-a", first.id),
  ]);
  assert(claims.filter((item) => item?.claimed).length === 1, "concurrent claim was not exclusive");
  await jobs.checkpointJob("tenant-a", first.id, { step: 1, tool: "read" });
  assert((await jobs.getJob("tenant-a", first.id))?.checkpoint?.step === 1, "checkpoint was not saved");
  const concurrentEvents = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      jobs.appendJobEvent("tenant-a", first.id, "test", { index }),
    ),
  );
  const sequences = concurrentEvents
    .map((event) => event?.sequence)
    .filter((value): value is number => value != null);
  assert(sequences.length === 8 && new Set(sequences).size === 8, "event sequences were duplicated");
  assert(
    (await jobs.listJobEvents("tenant-a", first.id)).map((event) => event.sequence).join(",") ===
      [...sequences]
        .sort((a, b) => a - b)
        .concat(1)
        .sort((a, b) => a - b)
        .join(","),
    "event sequence history was not persisted in order",
  );
  assert((await jobs.getJob("tenant-b", first.id)) == null, "tenant could read another tenant job");
  await jobs.cancelJob("tenant-a", first.id);
  assert((await jobs.getJob("tenant-a", first.id))?.status === "cancelled", "cancel did not persist");

  const stale = await jobs.createJob({
    userId: "tenant-a",
    threadId: "thread-a",
    botId: "bot-a",
    kind: "chat",
    idempotencyKey: "stale-job",
    payload: {},
  });
  const staleClaim = await jobs.claimJob("tenant-a", stale.id);
  assert(Boolean(staleClaim?.claimed), "stale test job was not claimed");
  await jobs.recoverStaleJobs(new Date(Date.now() + jobs.JOB_LEASE_MS + 1));
  assert((await jobs.getJob("tenant-a", stale.id))?.status === "uncertain", "stale job was replayed instead of marked uncertain");
  assert((await jobs.listJobs("tenant-b")).length === 0, "tenant list was not isolated");

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method?: string };
      const result = body.method === "initialize"
        ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } }
        : body.method === "tools/list"
          ? { tools: [{ name: "echo", description: "untrusted test tool", inputSchema: { type: "object" } }] }
          : { content: [{ type: "text", text: "echoed" }] };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock MCP server did not start");
  const connection = await mcp.saveMcpConnection({
    userId: "tenant-a",
    name: "mock",
    url: `http://127.0.0.1:${address.port}/mcp`,
    secret: "test-secret",
    headers: { "X-Test": "header-secret" },
  });
  assert(Boolean(connection?.hasSecret), "MCP secret was not saved");
  const listed = await mcp.listMcpConnections("tenant-a");
  assert(!JSON.stringify(listed).includes("test-secret"), "MCP secret leaked from public listing");
  assert(!JSON.stringify(listed).includes("header-secret"), "MCP header secret leaked from public listing");
  const discovery = await mcp.testMcpConnection("tenant-a", connection!.id);
  assert(discovery.tools.length === 1, "MCP discovery did not return tools");
  const call = await mcp.callMcpTool("tenant-a", connection!.id, "echo", { value: "x" });
  assert(JSON.stringify(call).includes("echoed"), "MCP tool call did not return result");
  const approval = agent.deniToolApproval({ userId: "tenant-a", jobId: stale.id });
  assert(approval.mcp({ action: "call" }) === "user-approval", "MCP call did not require approval");
  server.close();
  console.log(`verified durable job claims, checkpoints, cancel, uncertain recovery, tenant isolation, and MCP discovery/call on local SQLite`);
}

async function run() {
  try {
    await main();
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

void run();
