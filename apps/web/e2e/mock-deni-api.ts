/**
 * Stand-in for the Deni AI API (OpenAI-compatible chat completions) during the
 * end-to-end tests: the app under test points `DENI_API_BASE_URL` here, so no
 * real provider is called and answers are deterministic.
 *
 * - The answer is `Mock reply: <last user text>`.
 * - A last user message containing `[slow]` streams for about ten seconds, so a test
 *   can stop the generation while it runs.
 * - A request with `response_format` (structured output, e.g. memory
 *   extraction) gets an empty memory result.
 *
 * Run with `node e2e/mock-deni-api.ts` (Node strips the types); the port is
 * `MOCK_DENI_API_PORT` (default 4010).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const port = Number(process.env.MOCK_DENI_API_PORT ?? 4010);

type ChatMessage = { role: string; content: string | Array<{ type: string; text?: string }> };
type ChatRequest = {
  model?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  response_format?: unknown;
};

export const SLOW_MARKER = "[slow]";

function messageText(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("");
}

function lastUserText(request: ChatRequest): string {
  const lastUser = request.messages?.findLast((message) => message.role === "user");
  return lastUser ? messageText(lastUser).trim() : "";
}

function answerFor(request: ChatRequest): string {
  if (request.response_format) return JSON.stringify({ hasNew: false, memories: [] });
  return `Mock reply: ${lastUserText(request)}`;
}

async function readJson(request: IncomingMessage): Promise<ChatRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as ChatRequest;
}

const usage = { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 };

function sendCompletion(response: ServerResponse, model: string, content: string) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      id: `chatcmpl-e2e-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage,
    }),
  );
}

async function streamCompletion(
  request: IncomingMessage,
  response: ServerResponse,
  model: string,
  content: string,
  slow: boolean,
) {
  const id = `chatcmpl-e2e-${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let closed = false;
  request.on("close", () => {
    closed = true;
  });
  const send = (payload: unknown) => {
    if (!closed) response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) => ({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });

  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  send(chunk({ role: "assistant", content: "" }));

  // Word by word, so the client sees a real stream.
  const pieces = content.split(/(?<= )/);
  const extra = slow ? 40 : 0;
  for (const piece of pieces) {
    send(chunk({ content: piece }));
  }
  for (let index = 0; index < extra && !closed; index++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    send(chunk({ content: ` …${index}` }));
  }
  send(chunk({}, "stop"));
  send({ id, object: "chat.completion.chunk", created, model, choices: [], usage });
  if (!closed) response.end("data: [DONE]\n\n");
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }
    if (request.method === "POST" && url.pathname.endsWith("/chat/completions")) {
      const body = await readJson(request);
      const model = body.model ?? "openai/gpt-6-luna";
      const content = answerFor(body);
      const slow = !body.response_format && lastUserText(body).includes(SLOW_MARKER);
      if (body.stream) {
        await streamCompletion(request, response, model, content, slow);
      } else {
        sendCompletion(response, model, content);
      }
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ error: { message: `No mock for ${request.method} ${url.pathname}` } }),
    );
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: String(error) } }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[mock-deni-api] listening on http://127.0.0.1:${port}`);
});
