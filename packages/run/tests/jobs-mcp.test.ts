import { afterAll, beforeAll, it } from "vitest";
import { configureRunForTest, createRunTestDb, seedTestUser, type RunTestDb } from "../src/testing";
import { createServer } from "node:http";

let testDb: RunTestDb;

beforeAll(async () => {
  testDb = await createRunTestDb();
  configureRunForTest(testDb, { config: { openrouterApiKey: "test-key" } });
}, 60_000);

afterAll(async () => {
  await testDb.pglite.close();
});

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

it("jobs and MCP: idempotency, claims, events, recovery, isolation and approvals", async () => {
  await seedTestUser(testDb.pglite, "tenant-a");
  await seedTestUser(testDb.pglite, "tenant-b");
  const jobs = await import("../src/jobs");
  const mcp = await import("../src/mcp");
  const agent = await import("../src/agent");

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
  assert(
    (await jobs.getJob("tenant-a", first.id))?.checkpoint?.step === 1,
    "checkpoint was not saved",
  );
  const concurrentEvents = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      jobs.appendJobEvent("tenant-a", first.id, "test", { index }),
    ),
  );
  const sequences = concurrentEvents
    .map((event) => event?.sequence)
    .filter((value): value is number => value != null);
  assert(
    sequences.length === 8 && new Set(sequences).size === 8,
    "event sequences were duplicated",
  );
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
  assert(
    (await jobs.getJob("tenant-a", first.id))?.status === "cancelled",
    "cancel did not persist",
  );

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
  assert(
    (await jobs.getJob("tenant-a", stale.id))?.status === "uncertain",
    "stale job was replayed instead of marked uncertain",
  );
  assert((await jobs.listJobs("tenant-b")).length === 0, "tenant list was not isolated");

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method?: string };
      const result =
        body.method === "initialize"
          ? {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "fake", version: "1" },
            }
          : body.method === "tools/list"
            ? {
                tools: [
                  {
                    name: "echo",
                    description: "untrusted test tool",
                    inputSchema: { type: "object" },
                  },
                ],
              }
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
  assert(
    !JSON.stringify(listed).includes("header-secret"),
    "MCP header secret leaked from public listing",
  );
  const discovery = await mcp.testMcpConnection("tenant-a", connection!.id);
  assert(discovery.tools.length === 1, "MCP discovery did not return tools");
  const call = await mcp.callMcpTool("tenant-a", connection!.id, "echo", { value: "x" });
  assert(JSON.stringify(call).includes("echoed"), "MCP tool call did not return result");
  const approval = agent.deniToolApproval({ userId: "tenant-a", jobId: stale.id });
  const echoCall = { action: "call", connectionId: connection!.id, name: "echo" };
  assert((await approval.mcp(echoCall)) === "user-approval", "MCP call did not require approval");
  await mcp.setMcpAlwaysAllow("tenant-a", connection!.id, "echo", true);
  assert((await approval.mcp(echoCall)) === "approved", "Always allow did not skip MCP approval");
  const handoff = agent.deniHandoffToolApproval(undefined, "denied", "tenant-a");
  assert(
    typeof (await handoff.mcp(echoCall)) === "object",
    "a handoff ran an MCP call that is not read-only",
  );
  await mcp.setMcpAlwaysAllow("tenant-a", connection!.id, "echo", false);
  assert(
    (await approval.mcp(echoCall)) === "user-approval",
    "turning Always allow off did not ask again",
  );

  // Resuming after an approval re-checks the approved call; that must not wait for approval again.
  const resumed = await jobs.createJob({
    userId: "tenant-a",
    threadId: "thread-a",
    botId: "bot-a",
    kind: "chat",
    idempotencyKey: "resumed-approval",
    payload: {},
  });
  assert(
    Boolean((await jobs.claimJob("tenant-a", resumed.id))?.claimed),
    "resumed test job was not claimed",
  );
  const answered = [
    {
      role: "assistant" as const,
      content: [
        {
          type: "tool-call" as const,
          toolCallId: "call-1",
          toolName: "mcp",
          input: { action: "call" },
        },
        { type: "tool-approval-request" as const, approvalId: "ap-1", toolCallId: "call-1" },
      ],
    },
    {
      role: "tool" as const,
      content: [{ type: "tool-approval-response" as const, approvalId: "ap-1", approved: true }],
    },
  ];
  const recheck = agent.deniToolApproval({ userId: "tenant-a", jobId: resumed.id });
  assert(
    (await recheck.mcp(echoCall, { toolCallId: "call-1", messages: answered })) === "user-approval",
    "an approved call was not treated as approved",
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(
    (await jobs.getJob("tenant-a", resumed.id))?.status === "running",
    "re-checking an approved call put the job back into waiting_approval",
  );
  await recheck.mcp(echoCall, { toolCallId: "call-2", messages: answered });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(
    (await jobs.getJob("tenant-a", resumed.id))?.status === "waiting_approval",
    "a new call did not wait for approval",
  );

  // A wait whose card was answered or never saved must not block the next message forever.
  const { hasOpenApproval } = await import("../src/chat/run-state");
  const { releaseStaleApproval } = await import("../src/jobs/actions");
  const card = (jobId: string | undefined, state: string) =>
    ({
      id: "m-1",
      role: "assistant" as const,
      metadata: jobId ? { jobId } : {},
      parts: [{ type: "tool-mcp", toolCallId: "call-2", state, approval: { id: "ap-2" } }],
    }) as unknown as import("ai").UIMessage;
  assert(
    hasOpenApproval([card(resumed.id, "approval-requested")], resumed.id),
    "an open card was not found",
  );
  assert(
    hasOpenApproval([card(undefined, "approval-requested")], resumed.id),
    "a card without a job ID did not count as open",
  );
  assert(
    !hasOpenApproval([card("job-other", "approval-requested")], resumed.id),
    "another job's card kept this job waiting",
  );
  assert(
    !hasOpenApproval([card(resumed.id, "approval-responded")], resumed.id),
    "an answered card counted as open",
  );
  assert(
    (await releaseStaleApproval("tenant-a", resumed.id))?.status === "cancelled",
    "a stale approval wait was not released",
  );
  assert(
    (await releaseStaleApproval("tenant-a", resumed.id)) === null,
    "a job that stopped waiting was released again",
  );
  server.close();
}, 120_000);
