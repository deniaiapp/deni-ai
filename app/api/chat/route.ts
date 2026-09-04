import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isLoopFinished,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { limitOrResponse } from "@/lib/rate-limit";
import { reportError } from "@/lib/report";
import { buildInstructions, createDeniTools, deniToolApproval } from "@/lib/agent";
import { getApiKey } from "@/lib/config";
import { setComputer } from "@/lib/computer";
import { getDeniModel } from "@/lib/llm";
import { parseRunMode } from "@/lib/model";
import { loadMessages, mutateStore, readStore, saveMessages } from "@/lib/store";
import { assertCanUseTokens, isUsageLimitError, recordTokenUsage } from "@/lib/usage";
import { compactMessagesForModel, mergeThreadMessages } from "@/lib/messages";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "chat", 40);
  if (limited) return limited;
  const body = (await req.json()) as {
    messages?: UIMessage[];
    botId?: string;
    threadId?: string;
    id?: string;
    runMode?: string;
  };

  const threadId = body.threadId || body.id;
  const store = await readStore(userId);
  const thread = store.threads.find((item) => item.id === threadId);
  if (!thread) {
    return new Response("thread not found", { status: 404 });
  }

  const botId = body.botId || thread.botIds[0];
  const bot = store.bots.find((item) => item.id === botId);
  if (!bot) {
    return new Response("bot not found", { status: 404 });
  }

  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    return new Response("OPENROUTER_API_KEY is missing", { status: 401 });
  }

  try {
    await assertCanUseTokens(userId);
  } catch (error) {
    if (isUsageLimitError(error)) {
      return new Response(error.message, { status: 402 });
    }
    throw error;
  }

  const incoming = body.messages ?? [];
  const persisted = await loadMessages(userId, thread.id);
  const messages = mergeThreadMessages(persisted, incoming);
  const runMode = parseRunMode(body.runMode ?? store.config.runMode);
  if (body.runMode && runMode !== store.config.runMode) {
    await mutateStore(userId, (next) => {
      next.config.runMode = runMode;
    });
  }

  const { model, providerOptions, tokenMultiplier } = await getDeniModel(userId, runMode);
  const tools = createDeniTools({ userId, bot, threadId: thread.id });

  const result = streamText({
    model,
    instructions: buildInstructions(
      bot,
      store.skills,
      store.bots.map((item) => ({
        id: item.id,
        name: item.name,
        job: item.job,
      })),
    ),
    messages: await convertToModelMessages(compactMessagesForModel(messages)),
    tools,
    toolApproval: deniToolApproval(),
    stopWhen: isLoopFinished(),
    providerOptions,
    onStepEnd: async (step) => {
      await recordTokenUsage(userId, step.usage, { multiplier: tokenMultiplier }).catch((error) => {
        console.error("record tokens", error);
      });
    },
    onError: async (event) => {
      reportError(event, "chat");
      await setComputer(userId, {
        status: "idle",
        workingLabel: "",
        workingBotId: null,
        lastError: "The model call failed",
      });
    },
    onFinish: async () => {
      await setComputer(userId, {
        status: "idle",
        workingLabel: "",
        workingBotId: null,
      });
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      onEnd: ({ messages: next }) => {
        saveMessages(userId, thread.id, next).catch((error) => {
          console.error("save messages", error);
        });
      },
    }),
  });
}
