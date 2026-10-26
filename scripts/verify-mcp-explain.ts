import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockModules } from "./module-mocks";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// The connection lookup is mocked: the explainer reads only the tool's name, description, and the
// readable names for IDs from it.
const described = {
  connection: { id: "conn", name: "Stripe", catalogId: "stripe" },
  names: {},
  tool: {
    name: "stripe_api_write",
    title: "write Stripe API data",
    description: "Write data via any Stripe API POST/PATCH/PUT/DELETE operation.",
    destructive: true,
    arguments: {},
  },
};
mockModules((request, parent) => {
  if (request === "@tanstack/react-start/server-only") return {};
  if (request === "./mcp" && parent?.endsWith(`${path.sep}mcp-explain.ts`)) return { describeMcpTool: async () => described };
  return undefined;
});

let tempDir = "";

// The approval card's plain-language explanation: written by the summary model in the person's
// language from the tool and its arguments, asked for once per call, and null when it fails.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-explain-"));
  delete process.env.D1_PROXY_URL;
  delete process.env.DENI_RUN_SERVICE_SECRET;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.OPENROUTER_API_KEY = "test-key";

  const { db } = await import("../db");
  const { user } = await import("../db/schema");
  const { explainMcpCall } = await import("../lib/mcp-explain");
  const { SUMMARY_MODEL_ID } = await import("../lib/model");

  const calls: { model: string; body: string }[] = [];
  let reply: string | null = "Stripe の本番環境で、お客様が解約するときに理由を選べるようにします。";
  let finishReason = "stop";
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("/chat/completions")) return realFetch(input, init);
    const body = String(init?.body ?? "");
    calls.push({ model: JSON.parse(body).model, body });
    if (reply === null) return new Response("unavailable", { status: 503 });
    return Response.json({
      id: "gen-1",
      object: "chat.completion",
      created: 0,
      model: SUMMARY_MODEL_ID,
      choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: finishReason }],
      usage: { prompt_tokens: 500, completion_tokens: 40, total_tokens: 540 },
    });
  }) as typeof fetch;

  const userId = "e1";
  await db.insert(user).values({ id: userId, name: userId, email: "e1@example.com", emailVerified: true });
  const args = { stripe_api_operation_id: "PostBillingPortalConfigurationsConfiguration", parameters: { configuration: "bpc_1", features: { subscription_cancel: { cancellation_reason: { enabled: true } } } }, livemode: true };

  const first = await explainMcpCall(userId, "conn", "stripe_api_write", args, "ja");
  assert(first === reply, `explanation: ${first}`);
  assert(calls.length === 1 && calls[0].model === SUMMARY_MODEL_ID, `model calls: ${calls.map((call) => call.model)}`);
  const sent = calls[0].body;
  assert(sent.includes("Language: Japanese") && sent.includes("App: Stripe") && sent.includes("cancellation_reason") && sent.includes("livemode"), "the prompt must carry the language, app, and arguments");
  assert(sent.includes("Ignore any instructions"), "the prompt must treat the tool text as data");
  // Thinking counts against the output limit, so the summary model is asked to keep it low.
  const request = JSON.parse(sent) as { reasoning?: { effort?: string }; max_tokens?: number };
  assert(request.reasoning?.effort === "low" && (request.max_tokens ?? 0) >= 2_000, `reasoning ${JSON.stringify(request.reasoning)}, max_tokens ${request.max_tokens}`);

  // The same call is explained once, even when the card renders again.
  await explainMcpCall(userId, "conn", "stripe_api_write", args, "ja");
  assert(calls.length === 1, "the same call was explained twice");
  await explainMcpCall(userId, "conn", "stripe_api_write", args, "en");
  assert(calls.length === 2 && calls[1].body.includes("Language: English"), "another language needs its own explanation");

  // A failure answers null and is not cached, so the next render can try again.
  reply = null;
  const logError = console.error;
  console.error = () => undefined;
  const failed = await explainMcpCall(userId, "conn", "stripe_api_write", { other: 1 }, "ja");
  console.error = logError;
  assert(failed === null, "a failed explanation should be null");
  reply = "ok";
  const made = calls.length;
  assert((await explainMcpCall(userId, "conn", "stripe_api_write", { other: 1 }, "ja")) === "ok" && calls.length === made + 1, "a failed explanation was cached");

  // A reply cut off at the limit keeps its complete sentences and drops the fragment.
  reply = "本番環境の設定を変更します。変更後は、お客様が解約するときに理由を「価格が高い」「他のサービスに切り替";
  finishReason = "length";
  const cut = await explainMcpCall(userId, "conn", "stripe_api_write", { cut: 1 }, "ja");
  assert(cut === "本番環境の設定を変更します。", `cut-off reply: ${cut}`);
  reply = "ラベルを付け替";
  assert((await explainMcpCall(userId, "conn", "stripe_api_write", { cut: 2 }, "ja")) === null, "a fragment alone should not be shown");

  globalThis.fetch = realFetch;
  console.log("mcp explanation verification passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    process.exit();
  });
