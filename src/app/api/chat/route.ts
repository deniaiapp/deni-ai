import { suppressTracing } from "@sentry/nextjs";
import {
  consumeStream,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  readUIMessageStream,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  wrapLanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type SystemModelMessage,
  type UIMessage,
} from "ai";
import { headers } from "next/headers";
import { after, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  clearChatGenerationState,
  generateTitle,
  getChatById,
  isChatGenerationActive,
  replaceLastChatMessage,
  restoreStoppedRegeneration,
  updateChat,
} from "@/lib/chat";
import {
  compactEarlierToolOutputs,
  getContinuedAssistantMessage,
  mergeStoredAndClientMessages,
  selectModelContextMessages,
} from "@/lib/chat-messages";
import { inlineTextAttachments } from "@/lib/chat-text-attachments";
import {
  prepareBinaryAttachments,
  createChatAttachmentDownload,
  fitBinaryAttachmentsToBudget,
  type ChatAttachmentCache,
} from "@/lib/chat-attachment-download";
import { isComparisonConversation } from "@/lib/comparison-conversation";
import {
  clearChatGeneration,
  getRecentPromptUsage,
  isChatStopRequestedSince,
  isCurrentChatGeneration,
  recordPromptUsage,
  startChatGeneration,
} from "@/lib/chat-generation";
import { createChatTools } from "@/lib/chat-tools";
import { getModelContextWindow, getModelDefinition } from "@/lib/constants";
import { buildMemoryPrompt, getUserMemoryState, maybeAutoSaveMemories } from "@/lib/memory";
import { platformCapabilities } from "@/lib/platform-capabilities.server";
import { buildProjectPrompt } from "@/lib/project-context";
import {
  canCompareModels,
  consumeUsage,
  recordObservedUsage,
  settleUsage as settleUsageReservation,
  UsageLimitError,
} from "@/lib/usage";
import { calculateChatUsageAmount, resolveFinalChatUsageAmount } from "@/lib/chat-usage-amount";
import { checkRateLimit } from "@/lib/rate-limit";
import { guardMutationRequest } from "@/lib/mutation-request";
import { readRequestJson, RequestBodyTooLargeError } from "@/lib/request-body";
import {
  classifyUpstreamError,
  extractChatRequestErrorText,
  formatUpstreamErrorMessage,
  GENERIC_CHAT_REQUEST_ERROR,
  isContextOverflowMessage,
} from "@/lib/chat-request-error";
import { authorLabels } from "@/app/(home)/models/models-author-labels";
import { addOpenRouterCacheControl, ChatRouteError, resolveChatModelContext } from "./_lib/model";
import { buildChatSystemPrompt } from "./_lib/prompt";
import { ChatRequestSchema, setPendingState } from "./_lib/schema";
import {
  estimateGuestPromptTokens,
  estimatePromptInputTokens,
  estimatePromptTextTokens,
  estimateTokenReservation,
  estimateUrlAttachmentTokens,
  fingerprintPromptPrefixes,
  GUEST_MAX_OUTPUT_TOKENS,
  GUEST_MAX_PROMPT_TOKENS,
  GUEST_TOOL_OUTPUT_CHARS,
} from "./_lib/usage-estimate";

const tokenCountFormatter = new Intl.NumberFormat("en-US");

const MAX_STEPS = 50;
// Guests are billed per request, not per token, so bound the tool loop a single
// guest request can run.
const GUEST_MAX_STEPS = 8;

function formatChatStreamError(error: unknown, modelId: string): string {
  console.error("Chat request error", error);

  const upstreamKind = classifyUpstreamError(error);
  if (upstreamKind) {
    const author = getModelDefinition(modelId)?.author;
    const providerName = (author && authorLabels[author]) || author || "This provider's";
    return formatUpstreamErrorMessage(upstreamKind, providerName);
  }

  const rawMessage = extractChatRequestErrorText(error);
  if (!rawMessage || !isContextOverflowMessage(rawMessage)) {
    return GENERIC_CHAT_REQUEST_ERROR;
  }

  const modelName = getModelDefinition(modelId)?.name ?? modelId;
  const contextWindow = getModelContextWindow(modelId);

  if (contextWindow) {
    return `${modelName} exceeded its context window (${tokenCountFormatter.format(contextWindow)} tokens). Start a new chat or trim earlier messages/files.`;
  }

  return `${modelName} exceeded its context window. Start a new chat or trim earlier messages/files.`;
}

export async function POST(req: Request) {
  // Arrival time; a stop that arrives later applies to this request.
  const requestStartedAt = Date.now();
  const rejected = guardMutationRequest(req, "application/json");
  if (rejected) return rejected;
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  const userId = session?.session?.userId;
  const isAnonymous = Boolean(session?.user?.isAnonymous);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await readRequestJson(req, 16 * 1024 * 1024);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof RequestBodyTooLargeError
            ? "Request body is too large"
            : "Invalid request body",
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  const rateCheck = await checkRateLimit({
    key: `chat:${userId}`,
    windowMs: 60_000,
    maxRequests: 30,
  });
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter) } },
    );
  }

  const parsedBody = ChatRequestSchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (parsedBody.data.comparison && !(await canCompareModels(userId))) {
    return NextResponse.json({ error: "Model comparison requires Pro or Max." }, { status: 403 });
  }

  const {
    id: requestId,
    messages: rawMessages = [],
    trigger,
    model: baseModel,
    webSearch = false,
    reasoningEffort = "high",
    proMode: requestedProMode = false,
    fastMode: requestedFastMode = false,
    deepResearch = false,
    responseStyle,
    forceWebSearch = false,
    additionalInstruction,
  } = parsedBody.data;

  if (isAnonymous && (requestedProMode || requestedFastMode || deepResearch)) {
    return NextResponse.json(
      { error: "Fast, Pro, and Deep Research are not available for guest sessions." },
      { status: 403 },
    );
  }

  const isComparison = parsedBody.data.comparison === true;
  // Ephemeral generation keys are scoped to the authenticated account and never
  // overlap persisted chat IDs or another user's in-process generation lock.
  const id = isComparison ? `comparison:${userId}:${requestId}` : requestId;

  const validatedMessagesPromise = safeValidateUIMessages<UIMessage>({
    messages: rawMessages,
  });

  const [chat, validatedMessages] = await Promise.all([
    isComparison
      ? Promise.resolve({ title: null, projectId: null, messages: [] as UIMessage[] })
      : getChatById(id, userId),
    validatedMessagesPromise,
  ]);

  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  if (!validatedMessages.success) {
    return NextResponse.json({ error: "Invalid messages payload" }, { status: 400 });
  }

  if (isComparison && !isComparisonConversation(validatedMessages.data)) {
    return NextResponse.json({ error: "Invalid comparison conversation." }, { status: 400 });
  }

  const storedMessages = Array.isArray(chat.messages) ? (chat.messages as UIMessage[]) : [];
  const messages = mergeStoredAndClientMessages(storedMessages, validatedMessages.data);

  let memoryState: Awaited<ReturnType<typeof getUserMemoryState>>;
  let modelContext: Awaited<ReturnType<typeof resolveChatModelContext>>;

  try {
    [memoryState, modelContext] = await Promise.all([
      getUserMemoryState(userId),
      resolveChatModelContext({
        userId,
        isAnonymous,
        baseModel,
        reasoningEffort,
        proMode: requestedProMode,
        fastMode: requestedFastMode,
      }),
    ]);
  } catch (error) {
    if (error instanceof ChatRouteError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    console.error("Chat request error", error);
    return NextResponse.json({ error: GENERIC_CHAT_REQUEST_ERROR }, { status: 500 });
  }

  const { model, providerOptions, usageCategory, usageUnit, usesOpenRouter } = modelContext;

  // Pro / Fast are available for OpenAI models routed through OpenRouter.
  const modelDef = getModelDefinition(baseModel);
  const proMode = Boolean(
    requestedProMode && modelDef?.supportsProMode && modelDef.author === "openai" && usesOpenRouter,
  );
  const fastMode = Boolean(
    requestedFastMode &&
    modelDef?.supportsFastMode &&
    modelDef.author === "openai" &&
    usesOpenRouter,
  );

  const enabledTools = parsedBody.data.enabledTools ?? ["search", "browse"];
  const searchToolEnabled =
    platformCapabilities.features.webSearch && enabledTools.includes("search");
  const browseToolEnabled =
    platformCapabilities.features.webSearch && enabledTools.includes("browse");
  const webSearchEnabled = searchToolEnabled || browseToolEnabled;
  const deepResearchEnabled = searchToolEnabled && deepResearch;
  // Explicit Search (or a retry that requests search) still forces at least one lookup.
  const forceWebSearchEnabled = searchToolEnabled && (forceWebSearch || webSearch);
  const tools = createChatTools({
    // Comparison panes have no interactive questionnaire UI.
    interactive: !parsedBody.data.comparison,
    webSearch: webSearchEnabled,
    enabledTools,
    usage: {
      userId,
      isAnonymous,
    },
  });

  // Models accept images and PDFs as files, not text files, so inline those.
  const attachmentCache: ChatAttachmentCache = new Map();
  const contextMessages = selectModelContextMessages(messages, {
    regenerate: trigger === "regenerate-message",
  });
  let modelMessages: ModelMessage[];
  try {
    modelMessages = await convertToModelMessages(
      await fitBinaryAttachmentsToBudget(
        prepareBinaryAttachments(
          await inlineTextAttachments(
            isAnonymous
              ? compactEarlierToolOutputs(contextMessages, GUEST_TOOL_OUTPUT_CHARS)
              : contextMessages,
          ),
        ),
        attachmentCache,
        // Not the request signal: like the generation, a download outlives a
        // client disconnect. The helper bounds it with its own timeout.
        new AbortController().signal,
      ),
    );
  } catch {
    return NextResponse.json({ error: "Invalid or oversized attachment" }, { status: 400 });
  }
  const currentDate = new Date().toISOString().split("T")[0];
  const persistentMemory = platformCapabilities.features.memory
    ? buildMemoryPrompt(memoryState)
    : null;

  // Guest usage is one request regardless of size, so reject oversized prompts
  // before anything is reserved or written. URL files are already downloaded,
  // so PDFs count by their real size.
  if (
    isAnonymous &&
    estimateGuestPromptTokens({
      modelMessages,
      systemPrompt: persistentMemory ?? "",
      attachmentCache,
    }) > GUEST_MAX_PROMPT_TOKENS
  ) {
    // Say which limit was hit: a new chat does not help when a file is too large.
    const textFits =
      estimatePromptTextTokens({ modelMessages, systemPrompt: persistentMemory ?? "" }) <=
      GUEST_MAX_PROMPT_TOKENS;
    return NextResponse.json(
      textFits
        ? {
            error: "Attachments this large are not available for guest sessions.",
            reason: "guest_attachment_too_large",
          }
        : {
            error: "Conversations this long are not available for guest sessions.",
            reason: "guest_prompt_too_long",
          },
      { status: 413 },
    );
  }

  // A questionnaire answer continues its assistant message in place, so the
  // transcript never holds a second copy of that message's tool calls.
  const continuedMessage = getContinuedAssistantMessage(messages, trigger);
  const responseMessageId = continuedMessage?.id ?? generateId();
  const generationId = generateId();
  const shouldGenerateTitle = chat.title === "New Chat";
  const pendingAssistantMessage = setPendingState(
    continuedMessage ??
      ({
        id: responseMessageId,
        role: "assistant",
        parts: [],
      } as UIMessage),
    true,
  );
  const pendingMessages = [
    ...(continuedMessage ? messages.slice(0, -1) : messages),
    pendingAssistantMessage,
  ];
  // Parts the continued message already had are not output of this request.
  const previousPartCount = pendingAssistantMessage.parts.length;

  let generationAbortController: AbortController | undefined;
  let pendingStateRolledBack = false;
  let usageConsumed = false;
  let usageRefunded = false;
  let generationWatch: ReturnType<typeof setInterval> | undefined;
  let usageWatch: ReturnType<typeof setInterval> | undefined;
  let trailingPersistTimer: ReturnType<typeof setTimeout> | undefined;
  let hasAssistantOutput = false;
  let consumedUsageAmount = 0;
  let finalUsageAmount = 0;
  // Provider usage arrives when a model call ends, and is added once its step
  // finishes. A stop during the step's tool calls keeps the call's reported usage.
  // A call the provider accepted but that was cut off before it ended (stop,
  // replacement, disconnect, upstream error) reports none but was billed by the
  // provider, so it is estimated from its prompt plus the output streamed so
  // far. A call the provider rejected before streaming was not billed, so it is
  // not counted.
  let basePromptTokens = 0;
  let finishedStepCount = 0;
  let finishedStepMessageTokens = 0;
  let stepInFlight = false;
  let stepAccepted = false;
  let stepCallUsage: LanguageModelUsage | undefined;
  let stepPromptTokens = 0;
  let stepOutputChars = 0;
  // The prompt estimate counts text only. The input the provider reported for
  // the last call whose prompt this one starts with (attachments included),
  // plus the messages added since, is a lower bound too, so the larger of the
  // two is billed.
  let reportedPromptTokens = 0;
  let reportedStepMessageTokens = 0;
  // The provider reads part of the prompt from cache: at least what it last
  // reported reading for this chat, and commonly all of the reported prompt it
  // was just sent. That much is billed at the cache-read weight, as finishing
  // the call would have been.
  const promptCacheKey = `${userId}:${id}:${baseModel}${proMode ? ":pro" : ""}`;
  const recentPromptUsage = getRecentPromptUsage(promptCacheKey);
  let promptCacheReadTokens = recentPromptUsage.cacheReadTokens;
  let promptFingerprints: string[] = [];
  const resolveUnfinishedStepAmount = () => {
    if (stepCallUsage) {
      return calculateChatUsageAmount(baseModel, stepCallUsage, { proMode, fastMode });
    }
    if (!hasAssistantOutput || !stepInFlight || !stepAccepted) return 0;
    const cacheReadTokens = Math.min(
      Math.max(promptCacheReadTokens, reportedPromptTokens),
      stepPromptTokens,
    );
    return calculateChatUsageAmount(
      baseModel,
      {
        inputTokens: stepPromptTokens,
        inputTokenDetails: {
          noCacheTokens: stepPromptTokens - cacheReadTokens,
          cacheReadTokens,
          cacheWriteTokens: undefined,
        },
        outputTokens: Math.ceil(stepOutputChars / 4),
      },
      { proMode, fastMode },
    );
  };
  const resolveUsageAmount = () => {
    if (usageUnit !== "tokens") return hasAssistantOutput ? 1 : 0;
    return Math.max(finalUsageAmount + resolveUnfinishedStepAmount(), hasAssistantOutput ? 1 : 0);
  };
  const modelReservationId = `${generationId}:model`;
  const persistObservedUsage = async () => {
    if (!usageConsumed) return;
    const amount = resolveUsageAmount();
    try {
      await recordObservedUsage({ userId, reservationId: modelReservationId, amount });
    } catch (error) {
      console.error("Failed to persist observed chat usage", error);
    }
  };
  const watchUsage = () => {
    usageWatch = setInterval(() => {
      void persistObservedUsage();
    }, 30_000);
  };

  const ownsCurrentGeneration = async () => {
    return (
      isCurrentChatGeneration(id, generationId) &&
      (isComparison || (await isChatGenerationActive(id, userId, generationId)))
    );
  };

  const refundConsumedUsage = async () => {
    if (!usageConsumed || usageRefunded || resolveUsageAmount() > 0) return;
    try {
      await settleUsageReservation({ userId, reservationId: modelReservationId, amount: 0 });
      usageRefunded = true;
      usageConsumed = false;
    } catch (error) {
      console.error("Failed to refund chat usage", error);
    }
  };

  let usageSettlement: Promise<void> | undefined;
  const settleUsage = () => {
    usageSettlement ??= (async () => {
      if (!usageConsumed) return;
      const amount = resolveUsageAmount();
      await settleUsageReservation({ userId, reservationId: modelReservationId, amount });
    })();
    return usageSettlement;
  };

  // A regenerate request omits the answer it replaces, so a regenerate that
  // fails or is stopped without output restores the stored transcript instead of
  // deleting that answer. A pending tail belonged to the generation it replaced.
  const isRegenerate = trigger === "regenerate-message";
  const regenerateRollbackMessages = storedMessages.map((message, index) =>
    index === storedMessages.length - 1 &&
    (message.metadata as { pending?: unknown } | undefined)?.pending
      ? setPendingState(message, false)
      : message,
  );

  const rollbackPendingAssistantState = async () => {
    if (isComparison || pendingStateRolledBack) {
      return;
    }

    pendingStateRolledBack = true;

    try {
      if (!(await ownsCurrentGeneration())) {
        // A stop (possibly from another instance) already released the row. Put
        // back the answer a regenerate replaced, unless a newer generation or
        // transcript has taken its place or the new answer has output.
        if (isRegenerate) {
          await restoreStoppedRegeneration(
            id,
            userId,
            responseMessageId,
            regenerateRollbackMessages,
          );
        }
        return;
      }
      await updateChat(
        id,
        userId,
        isRegenerate ? regenerateRollbackMessages : messages,
        undefined,
        { expectedGenerationId: generationId },
      );
    } catch (error) {
      console.error("Failed to rollback pending chat response", error);
    }
  };

  const abortComparison = () => generationAbortController?.abort("stopped");

  const clearGenerationLock = () => {
    if (usageWatch) {
      clearInterval(usageWatch);
      usageWatch = undefined;
    }
    if (isComparison) req.signal.removeEventListener("abort", abortComparison);
    if (generationWatch) {
      clearInterval(generationWatch);
      generationWatch = undefined;
    }

    if (trailingPersistTimer) {
      clearTimeout(trailingPersistTimer);
      trailingPersistTimer = undefined;
    }

    if (!generationAbortController) {
      return;
    }

    clearChatGeneration(id, generationId);
    generationAbortController = undefined;
  };

  let projectPrompt: string | null;

  try {
    ({ abortController: generationAbortController } = startChatGeneration(id, generationId));
    if (isComparison) {
      req.signal.addEventListener("abort", abortComparison, { once: true });
      if (req.signal.aborted) abortComparison();
    } else {
      const { stopRequestedAt } = await updateChat(id, userId, pendingMessages, undefined, {
        nextGenerationId: generationId,
      });
      // A stop that arrived after this request but before this registration found
      // no generation to stop. One handled by this instance is remembered in
      // memory; one handled by another instance is on the chat row. A client
      // disconnect is not a stop: the generation survives it and the client
      // recovers the answer from the saved pending message.
      if (
        isChatStopRequestedSince(id, requestStartedAt) ||
        (stopRequestedAt !== null && stopRequestedAt.getTime() > requestStartedAt)
      ) {
        await rollbackPendingAssistantState();
        clearGenerationLock();
        return new Response(null, { status: 499 });
      }
    }
    projectPrompt = isComparison ? null : await buildProjectPrompt(chat.projectId, userId);
    if (usageUnit === "requests") {
      consumedUsageAmount = 1;
      await consumeUsage({
        userId,
        category: usageCategory,
        reservationId: modelReservationId,
        isAnonymous,
        amount: consumedUsageAmount,
      });
      usageConsumed = true;
      watchUsage();
    }
  } catch (error) {
    await rollbackPendingAssistantState();
    await refundConsumedUsage();
    clearGenerationLock();
    if (error instanceof UsageLimitError) {
      return NextResponse.json({ error: error.message, reason: "usage_limit" }, { status: 402 });
    }
    throw error;
  }

  const systemPrompt = buildChatSystemPrompt({
    currentDate,
    persistentMemory,
    projectPrompt,
    additionalInstruction,
    responseStyle,
    webSearchEnabled,
    searchToolEnabled,
    browseToolEnabled,
    interactive: !isComparison,
    deepResearch: deepResearchEnabled,
    forceWebSearch: forceWebSearchEnabled,
  });

  let requestMessages: ModelMessage[] = modelMessages;
  let requestSystem: string | SystemModelMessage = systemPrompt;

  if (usesOpenRouter) {
    const cachedPrompt = addOpenRouterCacheControl(modelMessages, systemPrompt);
    requestMessages = cachedPrompt.messages;
    requestSystem = cachedPrompt.system;
  }

  if (!isComparison) {
    // Cross-instance stop check. Untraced: a 1s poll would otherwise add one
    // identical DB span per second and trip Sentry's N+1 query detector.
    generationWatch = setInterval(() => {
      void suppressTracing(() => isChatGenerationActive(id, userId, generationId))
        .then((isActive) => {
          if (!isActive) {
            generationAbortController?.abort("stopped");
          }
        })
        // A failed poll must not stop the generation; the next tick checks again.
        .catch((error) => {
          console.warn("[chat] generation ownership poll failed", error);
        });
    }, 1000);
  }

  let result: ReturnType<typeof streamText<typeof tools>>;

  try {
    if (usageUnit === "tokens") {
      // Attachment floors are only reserved: a cut-off call is billed at its
      // prompt text or the input the provider reported for it, so they can never
      // make stopping cost more.
      basePromptTokens = estimatePromptTextTokens({ modelMessages, systemPrompt });
      // A recent report applies only while this prompt still starts with the one
      // it was for; an edited or branched transcript can be smaller.
      promptFingerprints = fingerprintPromptPrefixes({
        modelMessages,
        systemPrompt,
        toolNames: Object.keys(tools),
      });
      const reportedPrompt = recentPromptUsage.prompt;
      if (
        reportedPrompt &&
        promptFingerprints[reportedPrompt.messageCount] === reportedPrompt.fingerprint
      ) {
        reportedPromptTokens = reportedPrompt.inputTokens;
      }
      consumedUsageAmount = estimateTokenReservation({
        estimatedPromptTokens:
          estimatePromptInputTokens({ modelMessages, systemPrompt }) +
          estimateUrlAttachmentTokens(modelMessages),
        modelId: baseModel,
        proMode,
        fastMode,
      });
      await consumeUsage({
        userId,
        category: usageCategory,
        reservationId: modelReservationId,
        isAnonymous,
        amount: consumedUsageAmount,
      });
      usageConsumed = true;
      watchUsage();
      usageRefunded = false;
    }

    const generationSignal = generationAbortController.signal;
    result = streamText({
      // The provider has accepted a call once its stream opens. A rejection
      // (429, 503, a context-window error) throws before that, including every
      // retry, and is not billed even if a stop lands during the retry backoff.
      model:
        typeof model === "string"
          ? model
          : wrapLanguageModel({
              model,
              middleware: {
                wrapStream: async ({ doStream }) => {
                  const call = await doStream();
                  stepAccepted = true;
                  return call;
                },
              },
            }),
      experimental_download: createChatAttachmentDownload(generationSignal, attachmentCache),
      messages: requestMessages,
      abortSignal: generationSignal,
      stopWhen: stepCountIs(isAnonymous ? GUEST_MAX_STEPS : MAX_STEPS),
      maxOutputTokens: isAnonymous ? GUEST_MAX_OUTPUT_TOKENS : undefined,
      tools,
      // Runs right before the provider call, once attachments are downloaded.
      // The call counts once the provider accepts it, including prefill and
      // hidden reasoning before its first streamed part.
      onStepStart: () => {
        stepInFlight = true;
        stepAccepted = false;
        stepCallUsage = undefined;
        stepPromptTokens = Math.max(
          basePromptTokens + finishedStepMessageTokens,
          reportedPromptTokens + finishedStepMessageTokens - reportedStepMessageTokens,
        );
        stepOutputChars = 0;
      },
      onChunk: ({ chunk }) => {
        if (chunk.type === "start-step") {
          stepAccepted = true;
        } else if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
          stepOutputChars += chunk.text.length;
        } else if (chunk.type === "tool-input-delta") {
          stepOutputChars += chunk.delta.length;
        }
      },
      // Runs before the step's tool calls; the step finishes after them.
      onLanguageModelCallEnd: ({ usage }) => {
        stepCallUsage = usage;
        promptCacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
        if (usage.inputTokens !== undefined) {
          reportedPromptTokens = usage.inputTokens;
          reportedStepMessageTokens = finishedStepMessageTokens;
        }
        recordPromptUsage(promptCacheKey, {
          cacheReadTokens: promptCacheReadTokens,
          // Only the first call's prompt is this request's own, which a later
          // request can start with; later calls add this request's tool steps.
          prompt:
            finishedStepCount === 0 &&
            usage.inputTokens !== undefined &&
            promptFingerprints.length > 0
              ? {
                  inputTokens: usage.inputTokens,
                  messageCount: modelMessages.length,
                  fingerprint: promptFingerprints[modelMessages.length],
                }
              : undefined,
        });
      },
      // onFinish is not called by the SDK after an abort. Keep the usage of
      // completed steps so stopped/replaced generations still get reconciled.
      onStepFinish: async ({ usage, response }) => {
        finishedStepCount++;
        stepInFlight = false;
        stepCallUsage = undefined;
        // Later steps resend this step's assistant and tool messages.
        finishedStepMessageTokens += estimatePromptInputTokens({
          modelMessages: response.messages,
          systemPrompt: "",
        });
        finalUsageAmount += calculateChatUsageAmount(baseModel, usage, { proMode, fastMode });
        await persistObservedUsage();
      },
      onFinish: async ({ totalUsage }) => {
        finalUsageAmount = resolveFinalChatUsageAmount(finalUsageAmount, baseModel, totalUsage, {
          proMode,
          fastMode,
        });
        await persistObservedUsage();
      },
      providerOptions,
      system: requestSystem,
    });
  } catch (error) {
    await rollbackPendingAssistantState();
    await refundConsumedUsage();
    // Nothing streamed, so there is no reconciliation left to wait for.
    clearGenerationLock();
    // The token reservation can exceed what is left even when the pre-check passed.
    if (error instanceof UsageLimitError) {
      return NextResponse.json({ error: error.message, reason: "usage_limit" }, { status: 402 });
    }
    return NextResponse.json({ error: formatChatStreamError(error, baseModel) }, { status: 500 });
  }

  // Throttle JSONB writes during streaming. Only the last assistant message is
  // rewritten (jsonb_set on the final array index). We persist at most every
  // PERSIST_INTERVAL_MS, and a trailing-edge timer ensures the most recent
  // chunk eventually lands even if nothing new arrives.
  const PERSIST_INTERVAL_MS = 1500;
  let lastPersistedSignature = "";
  let latestPersistedMessage: UIMessage = pendingAssistantMessage;
  let partialPersistPromise: Promise<void> = Promise.resolve();
  let lastPersistAt = 0;
  let pendingDirty = false;

  const runPersist = () => {
    pendingDirty = false;
    lastPersistAt = Date.now();
    if (trailingPersistTimer) {
      clearTimeout(trailingPersistTimer);
      trailingPersistTimer = undefined;
    }
    partialPersistPromise = partialPersistPromise
      .catch(() => undefined)
      .then(async () => {
        try {
          // Untraced like the generation poll: one identical select+update span pair
          // per interval would otherwise trip Sentry's N+1 query detector.
          await suppressTracing(async () => {
            if (!(await ownsCurrentGeneration())) {
              return;
            }
            await replaceLastChatMessage(id, userId, latestPersistedMessage, {
              expectedGenerationId: generationId,
            });
          });
        } catch (error) {
          console.error("Failed to persist partial chat response", error);
        }
      });
  };

  const queuePartialPersist = (message: UIMessage, force: boolean = false) => {
    const pendingMessage = setPendingState(message, true);
    if (pendingMessage.parts.length > previousPartCount) {
      if (!hasAssistantOutput) {
        hasAssistantOutput = true;
        void persistObservedUsage();
      }
    }
    if (isComparison) {
      latestPersistedMessage = pendingMessage;
      return;
    }
    const signature = JSON.stringify(pendingMessage.parts);

    if (!force && signature === lastPersistedSignature) {
      return;
    }

    latestPersistedMessage = pendingMessage;
    lastPersistedSignature = signature;
    pendingDirty = true;

    const elapsed = Date.now() - lastPersistAt;
    if (force || elapsed >= PERSIST_INTERVAL_MS) {
      runPersist();
      return;
    }

    if (!trailingPersistTimer) {
      trailingPersistTimer = setTimeout(() => {
        trailingPersistTimer = undefined;
        if (pendingDirty) runPersist();
      }, PERSIST_INTERVAL_MS - elapsed);
    }
  };

  const stream = createUIMessageStream<UIMessage>({
    // Ends with the pending message, so the SDK builds the response from it
    // instead of copying an earlier trailing assistant message's parts.
    originalMessages: pendingMessages,
    execute: async ({ writer }) => {
      try {
        writer.write({
          type: "start",
          messageId: responseMessageId,
        });

        const uiStream = result.toUIMessageStream<UIMessage>({
          sendReasoning: true,
          sendSources: true,
          sendStart: false,
          onError: (error) => formatChatStreamError(error, baseModel),
        });
        const [clientStream, persistenceStream] = uiStream.tee();

        writer.merge(clientStream);

        // No start chunk reaches this branch (sendStart: false), so seed it with
        // the pending message; otherwise partial saves would carry an empty ID.
        // The SDK mutates the seed, so it gets a copy.
        for await (const message of readUIMessageStream<UIMessage>({
          message: structuredClone(pendingAssistantMessage),
          stream: persistenceStream,
        })) {
          // In-memory only: this runs for every chunk. The database ownership check
          // happens in the 1s poll above and again before each persisted write.
          if (!isCurrentChatGeneration(id, generationId)) {
            break;
          }
          queuePartialPersist(message);
        }

        if (trailingPersistTimer) {
          clearTimeout(trailingPersistTimer);
          trailingPersistTimer = undefined;
        }
        queuePartialPersist(latestPersistedMessage, true);

        await partialPersistPromise;
      } catch (error) {
        await rollbackPendingAssistantState();
        await refundConsumedUsage();
        clearGenerationLock();
        throw new Error(formatChatStreamError(error, baseModel));
      }
    },
    onFinish: async ({ messages: updatedMessages, isAborted }) => {
      try {
        await partialPersistPromise;
        hasAssistantOutput ||= updatedMessages.some(
          (message) => message.id === responseMessageId && message.parts.length > previousPartCount,
        );
        // Accounting belongs to this request, not to the current chat-row owner.
        // Stopping/replacing the generation must only suppress transcript writes.
        try {
          await settleUsage();
        } catch (error) {
          // The answer was already streamed; a billing failure must not drop it
          // from the saved transcript.
          console.error("Failed to settle chat usage", error);
        }

        // Comparisons consume normal usage but never write chats or auto-memory.
        // The chosen transcript is saved explicitly by saveComparison later.
        if (isComparison) return;

        // A regenerate that ends without answer content (an upstream error, or a
        // stop before the first token) puts back the answer it replaced.
        const restoresReplacedAnswer =
          isRegenerate &&
          !updatedMessages.some(
            (message) =>
              message.id === responseMessageId &&
              message.parts.some((part) => part.type !== "step-start"),
          );

        if (!(await ownsCurrentGeneration())) {
          pendingStateRolledBack = true;
          if (restoresReplacedAnswer) {
            try {
              // Only while no newer generation or transcript replaced this one.
              await restoreStoppedRegeneration(
                id,
                userId,
                responseMessageId,
                regenerateRollbackMessages,
              );
            } catch (error) {
              console.error("Failed to restore the replaced chat response", error);
            }
          }
          return;
        }

        if (restoresReplacedAnswer) {
          pendingStateRolledBack = true;
          try {
            await updateChat(id, userId, regenerateRollbackMessages, undefined, {
              expectedGenerationId: generationId,
              nextGenerationId: null,
            });
          } catch (error) {
            // Also thrown when a newer generation took over the chat meanwhile.
            console.error("Failed to restore the replaced chat response", error);
          }
          return;
        }

        let newTitle: string | undefined;

        try {
          if (shouldGenerateTitle) {
            newTitle = await generateTitle(updatedMessages);
          }
        } catch (error) {
          console.error("Failed to generate title", error);
        }

        const finalizedMessages = updatedMessages.map((message) =>
          message.id === responseMessageId ? setPendingState(message, false) : message,
        );
        const cleared = await clearChatGenerationState(
          id,
          userId,
          generationId,
          finalizedMessages.at(-1),
          newTitle,
        );

        if (!cleared) {
          pendingStateRolledBack = true;
          return;
        }

        pendingStateRolledBack = true;

        if (isAborted || generationAbortController?.signal.aborted) {
          return;
        }

        // Memory extraction can take seconds and must not keep the chat SSE
        // open. Schedule it after the response finishes so the client can end
        // the request immediately while work continues on the backend.
        // Guests pay one request per turn, so they get no extra unbilled model call.
        if (
          !isAnonymous &&
          platformCapabilities.features.memory &&
          memoryState.profile.autoMemory
        ) {
          after(() =>
            maybeAutoSaveMemories({
              userId,
              messages: updatedMessages,
              enabled: true,
            }).catch((error) => {
              console.error("Failed to auto-save memories", error);
            }),
          );
        }
      } catch (error) {
        await rollbackPendingAssistantState();
        await refundConsumedUsage();
        throw error;
      } finally {
        clearGenerationLock();
      }
    },
  });

  return createUIMessageStreamResponse({
    stream,
    consumeSseStream: consumeStream,
  });
}
