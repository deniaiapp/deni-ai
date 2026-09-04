import { convertToModelMessages, generateText, isLoopFinished, type UIMessage } from "ai";
import { buildInstructions, createDeniTools, deniToolApproval, nextCron } from "./agent";
import { getApiKey } from "./config";
import { setComputer } from "./computer";
import { createId, nowIso } from "./ids";
import { getDeniModel } from "./llm";
import {
  listDueRoutineUserIds,
  listUserStores,
  loadMessages,
  mutateStore,
  readStore,
  saveMessages,
} from "./store";
import { assertCanUseTokens, isUsageLimitError, recordTokenUsage } from "./usage";

const g = globalThis as typeof globalThis & { __deniScheduler?: boolean };

export function startScheduler() {
  if (g.__deniScheduler || process.env.DENI_SCHEDULER !== "true") return;
  g.__deniScheduler = true;
  setInterval(() => {
    tick().catch((error) => {
      console.error("[deni scheduler]", error);
      void import("./report").then(({ reportError }) => reportError(error, "scheduler"));
    });
  }, 30_000);
  tick().catch(() => undefined);
}

async function tick() {
  const now = Date.now();
  let userIds: string[];
  try {
    userIds = await listDueRoutineUserIds(new Date(now));
  } catch {
    userIds = (await listUserStores()).map((row) => row.userId);
  }
  for (const userId of userIds) {
    const store = await readStore(userId);
    const due = (store.routines ?? []).filter(
      (item) => item.enabled && item.nextRunAt && new Date(item.nextRunAt).getTime() <= now,
    );
    for (const routine of due) {
      await runRoutine(userId, routine.id);
    }
  }
}

async function runRoutine(userId: string, routineId: string) {
  const store = await readStore(userId);
  const routine = store.routines.find((item) => item.id === routineId);
  if (!routine) return;
  const bot = store.bots.find((item) => item.id === routine.botId);
  if (!bot) return;
  const apiKey = await getApiKey(userId);
  if (!apiKey) {
    await mutateStore(userId, (s) => {
      const item = s.routines.find((entry) => entry.id === routineId);
      if (item) item.lastError = "API key missing";
    });
    return;
  }

  const kickoff: UIMessage = {
    id: createId("msg"),
    role: "user",
    parts: [
      {
        type: "text",
        text: `[Routine ${routine.name}]\n${routine.instructions}\n\nThis is a scheduled run. Do not perform actions that require approval; leave the result behind.`,
      },
    ],
  };

  const previous = await loadMessages(userId, routine.threadId);
  const messages = [...previous, kickoff];
  await saveMessages(userId, routine.threadId, messages);
  try {
    await assertCanUseTokens(userId);
  } catch (error) {
    if (isUsageLimitError(error)) {
      await mutateStore(userId, (s) => {
        const item = s.routines.find((entry) => entry.id === routineId);
        if (!item) return;
        item.lastError = error.message;
        item.nextRunAt = nextCron(item.cron, s.config.timezone);
      });
      return;
    }
    throw error;
  }
  await setComputer(userId, {
    status: "working",
    workingBotId: bot.id,
    workingLabel: `routine:${routine.name}`,
    botId: bot.id,
  });

  try {
    const { model, providerOptions, tokenMultiplier } = await getDeniModel(userId);
    const result = await generateText({
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
      messages: await convertToModelMessages(messages),
      tools: createDeniTools({ userId, bot, threadId: routine.threadId }),
      toolApproval: deniToolApproval(),
      stopWhen: isLoopFinished(),
      providerOptions,
    });
    await recordTokenUsage(userId, result.usage, { multiplier: tokenMultiplier });
    const assistant: UIMessage = {
      id: createId("msg"),
      role: "assistant",
      parts: [{ type: "text", text: result.text || "Routine completed." }],
    };
    await saveMessages(userId, routine.threadId, [...messages, assistant]);
    await mutateStore(userId, (s) => {
      const item = s.routines.find((entry) => entry.id === routineId);
      if (!item) return;
      item.lastRunAt = nowIso();
      item.lastError = null;
      item.nextRunAt = nextCron(item.cron, s.config.timezone);
    });
  } catch (error) {
    await mutateStore(userId, (s) => {
      const item = s.routines.find((entry) => entry.id === routineId);
      if (!item) return;
      item.lastError = error instanceof Error ? error.message : String(error);
      item.nextRunAt = nextCron(item.cron, s.config.timezone);
    });
  } finally {
    await setComputer(userId, { status: "idle", workingLabel: "", workingBotId: null });
  }
}
