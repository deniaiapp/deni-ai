import { useChat } from "@ai-sdk/react";
import { sendGAEvent } from "@/lib/gtag";
import type { FileUIPart, UIMessage } from "ai";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { dynamic } from "@/lib/dynamic";
import { useCallback, useMemo, useRef, useState } from "react";
import { ArtifactPreviewProvider } from "@/components/chat/artifact-preview-context";
import { ChatComposer, type ComposerMessage } from "@/components/chat/chat-composer";
import { ChatInterfaceHeader } from "@/components/chat/chat-interface-header";
import { ChatInterfaceMessages } from "@/components/chat/chat-interface-messages";
import { IntelligentUiActionsProvider } from "@/components/chat/intelligent-ui/intelligent-ui-context";
import { UsageAlerts } from "@/components/chat/usage-alerts";
import { useAvailableModels } from "@/hooks/use-available-models";
import { useChatPageSync } from "@/hooks/use-chat-page-sync";
import { useInitialMessage } from "@/hooks/use-initial-message";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useChatBranches } from "@/hooks/use-chat-branches";
import { useMemorySaveNotice } from "@/hooks/use-memory-save-notice";
import { useNewChat } from "@/hooks/use-new-chat";
import { setPreferredModel, usePreferredModel } from "@/hooks/use-preferred-model";
import { useUsageStatus } from "@/hooks/use-usage-status";
import { getVisualLayout } from "@/hooks/use-visual-layout";
import { authClient } from "@/lib/auth-client";
import { ensureChatCreated } from "@/lib/chat-creation";
import { CHAT_OLDER_MESSAGE_COUNT, mergeMessageWindow } from "@/lib/chat-messages";
import type { QuestionnaireToolOutput } from "@/lib/chat-tools/questionnaire";
import {
  defaultModel,
  GA_ID,
  getPreferredReasoningEffort,
  type ReasoningEffort,
} from "@/lib/constants";
import { trpc } from "@/lib/trpc/react";

const ArtifactPreviewPanel = dynamic(
  () => import("@/components/chat/artifact-preview-panel").then((mod) => mod.ArtifactPreviewPanel),
  { ssr: false },
);

interface ChatInterfaceProps {
  id: string;
  initialMessages?: UIMessage[];
  initialHasMore?: boolean;
  initialOldestIndex?: number;
  initialTitle?: string | null;
  initialProjectId?: string | null;
  initialProjectName?: string | null;
  initialProjectDefaultModel?: string | null;
  isActive?: boolean;
}

type PendingMessageMetadata = {
  pending?: boolean;
  [key: string]: unknown;
};

function getMessageRenderKeys(messages: UIMessage[]) {
  const occurrences = new Map<string, number>();

  return messages.map((message, index) => {
    const baseKey =
      typeof message.id === "string" && message.id.trim().length > 0
        ? message.id.trim()
        : `message-${index}`;
    const duplicateCount = occurrences.get(baseKey) ?? 0;

    occurrences.set(baseKey, duplicateCount + 1);

    return duplicateCount === 0 ? baseKey : `${baseKey}-${duplicateCount}`;
  });
}

function isPendingMessage(message: UIMessage | undefined) {
  if (!message || message.role !== "assistant") {
    return false;
  }

  return Boolean((message.metadata as PendingMessageMetadata | undefined)?.pending);
}

function handleFocusComposer() {
  window.dispatchEvent(new CustomEvent("deni:focus-composer"));
}

function shouldResumeQuestionnaire({ messages }: { messages: UIMessage[] }) {
  const lastMessage = messages.at(-1);
  return (
    lastAssistantMessageIsCompleteWithToolCalls({ messages }) &&
    lastMessage?.role === "assistant" &&
    lastMessage.parts.some(
      (part) => part.type === "tool-questionnaire" && part.state === "output-available",
    )
  );
}

async function submitComposerMessage(params: {
  message: ComposerMessage;
  options: {
    model: string;
    webSearch: boolean;
    reasoningEffort: ReasoningEffort;
    proMode: boolean;
    fastMode: boolean;
    deepResearch: boolean;
  };
  id: string;
  isSubmitBlocked: boolean;
  usageTier: string;
  sendMessage: ReturnType<typeof useChat>["sendMessage"];
  invalidateChats: () => void;
  setInput: (value: string) => void;
}) {
  if (params.isSubmitBlocked) {
    return;
  }

  // The composer uploads attachments as they are added, so they arrive here with stored URLs.
  const attachments: FileUIPart[] | undefined = params.message.files?.length
    ? params.message.files
    : undefined;

  if (params.message.text || attachments?.length) {
    if (GA_ID) {
      sendGAEvent("event", "chat_message_sent", {
        event_category: "chat",
        event_label: params.usageTier,
        value: 1,
      });
    }

    Promise.resolve(
      params.sendMessage(
        {
          text: params.message.text || "",
          files: attachments,
        },
        {
          body: {
            model: params.options.model,
            webSearch: params.options.webSearch,
            reasoningEffort: params.options.reasoningEffort,
            proMode: params.options.proMode,
            fastMode: params.options.fastMode,
            deepResearch: params.options.deepResearch,
            id: params.id,
          },
        },
      ),
    ).finally(() => {
      params.invalidateChats();
    });
    params.setInput("");
  }
}

export function ChatInterface({
  id,
  initialMessages = [],
  initialHasMore = false,
  initialOldestIndex = 0,
  initialTitle = null,
  initialProjectId = null,
  initialProjectName = null,
  initialProjectDefaultModel = null,
  isActive = true,
}: ChatInterfaceProps) {
  const session = authClient.useSession();
  const isAnonymous = Boolean(session.data?.user?.isAnonymous);
  const [input, setInput] = useState("");
  const [modelOverride, setModel] = useState<string | null>(null);
  const [webSearchOverride, setWebSearch] = useState<boolean | null>(null);
  const [reasoningEffortOverride, setReasoningEffort] = useState<ReasoningEffort | null>(null);
  const [proModeOverride, setProMode] = useState<boolean | null>(null);
  const [fastModeOverride, setFastMode] = useState<boolean | null>(null);
  const [deepResearchOverride, setDeepResearch] = useState<boolean | null>(null);
  const utils = trpc.useUtils();
  const { availableModels, platformCapabilities } = useAvailableModels();
  const { features } = platformCapabilities;
  const billingDisabled = !features.billing;
  // Whether /api/chat accepted the latest request. By then the server has saved
  // the turn with a pending answer, which it finishes even if the client drops.
  const responseReceivedRef = useRef(false);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        // Read on every request so a layout change applies to the next answer.
        body: () => ({
          id,
          visualLayout: getVisualLayout(),
        }),
        // A chat started on the client may still be creating its row, or need a
        // retry after a failed attempt; /api/chat rejects chats without one.
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          responseReceivedRef.current = false;
          if (!(await ensureChatCreated(id)) && !init?.signal?.aborted) {
            throw new Error("Chat not found");
          }
          const response = await fetch(input, init);
          responseReceivedRef.current = response.ok;
          return response;
        },
      }),
    [id],
  );

  const [isRecoveringStream, setIsRecoveringStream] = useState(false);
  const {
    messages,
    sendMessage,
    regenerate,
    setMessages,
    addToolOutput,
    status,
    error,
    stop,
    clearError,
  } = useChat({
    id,
    messages: initialMessages,
    sendAutomaticallyWhen: shouldResumeQuestionnaire,
    transport,
    onFinish: ({ isDisconnect }) => {
      // A phone that sleeps mid-answer drops the stream with a network error,
      // but the server keeps generating and saves the answer. Read it back from
      // the saved page instead of showing the error.
      if (isDisconnect && responseReceivedRef.current) {
        clearError();
        setIsRecoveringStream(true);
      }
    },
  });
  // A new request streams the answer itself.
  if (isRecoveringStream && (status === "submitted" || status === "streaming")) {
    setIsRecoveringStream(false);
  }
  const handleStreamRecovered = useCallback(() => setIsRecoveringStream(false), []);

  const oldestIndexRef = useRef(initialOldestIndex);
  const hasMoreRef = useRef(initialHasMore);
  const isLoadingOlderRef = useRef(false);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const loadOlderMessages = useCallback(async () => {
    if (!hasMoreRef.current || isLoadingOlderRef.current || oldestIndexRef.current <= 0) {
      return;
    }

    isLoadingOlderRef.current = true;
    setIsLoadingOlder(true);
    try {
      const page = await utils.chat.getOlderMessages.fetch({
        id,
        beforeIndex: oldestIndexRef.current,
        limit: CHAT_OLDER_MESSAGE_COUNT,
      });
      oldestIndexRef.current = page.oldestIndex;
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
      setMessages((current) => mergeMessageWindow(page.messages as UIMessage[], current));
    } finally {
      isLoadingOlderRef.current = false;
      setIsLoadingOlder(false);
    }
  }, [id, setMessages, utils.chat.getOlderMessages]);

  const projectDefaultModel =
    initialProjectDefaultModel &&
    availableModels.some((entry) => entry.value === initialProjectDefaultModel)
      ? initialProjectDefaultModel
      : null;
  const preferredModel = usePreferredModel();
  const fallbackModel =
    preferredModel && availableModels.some((entry) => entry.value === preferredModel)
      ? preferredModel
      : availableModels.some((entry) => entry.value === defaultModel.value)
        ? defaultModel.value
        : (availableModels[0]?.value ?? defaultModel.value);
  const availableModelValues = useMemo(
    () =>
      availableModels.length > 0 ? new Set(availableModels.map((entry) => entry.value)) : undefined,
    [availableModels],
  );

  const seed = useInitialMessage({
    id,
    initialMessagesLength: initialMessages.length,
    model: modelOverride ?? projectDefaultModel ?? fallbackModel,
    availableModelValues,
    sendMessage,
    onMessageSent: () => {
      void utils.chat.getChats.invalidate();
    },
    onDraft: setInput,
  });

  const model = modelOverride ?? seed?.model ?? projectDefaultModel ?? fallbackModel;
  const webSearch = features.webSearch && (webSearchOverride ?? seed?.webSearch ?? false);
  const reasoningEffort =
    reasoningEffortOverride ??
    seed?.reasoningEffort ??
    getPreferredReasoningEffort(defaultModel.efforts);
  const proMode =
    Boolean(availableModels.find((entry) => entry.value === model)?.supportsProMode) &&
    (proModeOverride ?? seed?.proMode ?? false);
  const fastMode = fastModeOverride ?? seed?.fastMode ?? false;
  const deepResearch = features.webSearch && (deepResearchOverride ?? seed?.deepResearch ?? false);

  const {
    usageQuery,
    selectedModel,
    usageTier,
    isSignupLimited,
    isUsageLow,
    isUsageBlocked,
    canEnableMaxMode,
    needsMaxModeCredits,
    isSubmitBlocked,
    usageTierLabel,
    remainingPercent,
    enableMaxMode,
  } = useUsageStatus({ model, availableModels, proMode });

  const requestBody = useMemo(
    () => ({
      model,
      webSearch,
      reasoningEffort,
      proMode,
      fastMode,
      deepResearch,
      id,
    }),
    [model, webSearch, reasoningEffort, proMode, fastMode, deepResearch, id],
  );

  const { handleRegenerate, groupedMessages } = useChatBranches({
    messages,
    setMessages,
    regenerate,
  });
  const hasPendingQuestionnaire = messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "tool-questionnaire" &&
        (part.state === "input-streaming" || part.state === "input-available"),
    ),
  );
  const handleQuestionnaireComplete = useCallback(
    (toolCallId: string, output: QuestionnaireToolOutput) => {
      addToolOutput({
        tool: "questionnaire",
        toolCallId,
        output,
        options: { body: requestBody },
      });
    },
    [addToolOutput, requestBody],
  );
  const showMessageActions = status !== "streaming" && status !== "submitted";
  const lastMessage = messages.at(-1);
  const isWaitingForResponse =
    status !== "streaming" &&
    status !== "submitted" &&
    (isRecoveringStream || isPendingMessage(lastMessage));
  const chatStatusQuery = trpc.chat.getChatStatus.useQuery(
    { id },
    {
      enabled: isWaitingForResponse,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: true,
      refetchIntervalInBackground: true,
      refetchInterval: isWaitingForResponse ? 1000 : false,
    },
  );

  useChatPageSync({
    id,
    status,
    isWaitingForResponse,
    activeGenerationId: chatStatusQuery.data?.activeGenerationId,
    statusUpdatedAt: chatStatusQuery.data?.updated_at,
    isStatusSuccess: chatStatusQuery.isSuccess,
    setMessages,
    onRecovered: handleStreamRecovered,
  });

  useMemorySaveNotice({ status, enabled: features.memory });

  const handleSubmit = (
    message: ComposerMessage,
    options: {
      model: string;
      webSearch: boolean;
      reasoningEffort: ReasoningEffort;
      proMode: boolean;
      fastMode: boolean;
      deepResearch: boolean;
    },
  ) =>
    submitComposerMessage({
      message,
      options,
      id,
      // The SDK does not guard against overlapping requests; a second send while
      // one is in flight interleaves both streams and truncates the first answer.
      isSubmitBlocked:
        isSubmitBlocked ||
        hasPendingQuestionnaire ||
        status === "submitted" ||
        status === "streaming",
      usageTier,
      sendMessage,
      invalidateChats: () => {
        void utils.chat.getChats.invalidate();
      },
      setInput,
    });

  const isIntelligentUiSendBlocked =
    isSubmitBlocked || hasPendingQuestionnaire || status === "submitted" || status === "streaming";
  // Intelligent UI buttons and forms send their prompt as the next user message
  // with the current composer settings, leaving any draft in the composer alone.
  const intelligentUiActions = {
    sendPrompt: isIntelligentUiSendBlocked
      ? null
      : (text: string) =>
          submitComposerMessage({
            message: { text, files: [] },
            options: { model, webSearch, reasoningEffort, proMode, fastMode, deepResearch },
            id,
            isSubmitBlocked: false,
            usageTier,
            sendMessage,
            invalidateChats: () => {
              void utils.chat.getChats.invalidate();
            },
            setInput: () => undefined,
          }),
  };

  // Adjust invalid model during render (avoids setState-in-effect cascade).
  if (!selectedModel && availableModels.length > 0) {
    setModel(fallbackModel);
  }

  const handleStop = useCallback(() => {
    stop();

    void fetch("/api/chat/stop", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
  }, [id, stop]);

  const messageRenderKeys = useMemo(() => getMessageRenderKeys(messages), [messages]);
  const messageIndexMap = useMemo(() => {
    const indexMap = new Map<UIMessage, number>();
    for (let i = 0; i < messages.length; i++) {
      indexMap.set(messages[i], i);
    }
    return indexMap;
  }, [messages]);

  const startNewChat = useNewChat();
  const handleNewChat = useCallback(() => startNewChat(), [startNewChat]);
  const handleModelChange = useCallback(
    (value: string) => {
      setModel(value);
      setPreferredModel(value);
      const nextModel = availableModels.find((entry) => entry.value === value);
      const nextEfforts = nextModel?.efforts;
      if (!nextModel?.supportsProMode) {
        setProMode(false);
      }
      if (!nextModel?.supportsFastMode) {
        setFastMode(false);
      }
      if (!nextEfforts) {
        return;
      }
      setReasoningEffort((current) =>
        current && nextEfforts.includes(current)
          ? current
          : getPreferredReasoningEffort(nextEfforts),
      );
    },
    [availableModels],
  );
  const handleWebSearchChange = useCallback(
    (enabled: boolean) => setWebSearch(enabled && features.webSearch),
    [features.webSearch],
  );

  useKeyboardShortcuts({
    enabled: isActive,
    onFocusComposer: handleFocusComposer,
    onNewChat: handleNewChat,
  });

  return (
    <ArtifactPreviewProvider>
      <IntelligentUiActionsProvider value={intelligentUiActions}>
        <ArtifactPreviewPanel />
        <div className="flex h-full flex-1 min-h-0 flex-col w-full max-w-4xl mx-auto p-4 overflow-hidden">
          <ChatInterfaceHeader
            chatId={id}
            messages={messages}
            initialTitle={initialTitle}
            initialProjectId={initialProjectId}
            initialProjectName={initialProjectName}
          />
          <ChatInterfaceMessages
            messages={messages}
            groupedMessages={groupedMessages}
            messageRenderKeys={messageRenderKeys}
            messageIndexMap={messageIndexMap}
            status={status}
            showMessageActions={showMessageActions}
            isSubmitBlocked={isSubmitBlocked || hasPendingQuestionnaire}
            isWaitingForResponse={isWaitingForResponse}
            sessionUserId={session.data?.session?.userId}
            isAnonymous={isAnonymous}
            usageTier={usageQuery.data?.tier ?? null}
            error={error}
            initialProjectId={initialProjectId}
            requestBody={requestBody}
            onRegenerate={handleRegenerate}
            availableModels={availableModels}
            onModelChange={handleModelChange}
            onWebSearchChange={handleWebSearchChange}
            onQuestionnaireComplete={handleQuestionnaireComplete}
            webSearchAvailable={features.webSearch}
            isActive={isActive}
            hasMore={hasMore}
            isLoadingOlder={isLoadingOlder}
            onLoadOlder={
              status === "streaming" || status === "submitted" ? undefined : loadOlderMessages
            }
          />

          <UsageAlerts
            status={{
              isAnonymous,
              isSignupLimited,
              isUsageLow,
              isUsageBlocked,
              canEnableMaxMode,
              needsMaxModeCredits,
              billingDisabled,
            }}
            usage={{
              remainingPercent,
              tierLabel: usageTierLabel,
            }}
            enableMaxMode={enableMaxMode}
            onRefreshUsage={() => usageQuery.refetch()}
          />

          <ChatComposer
            className="mt-4"
            globalDrop={isActive}
            value={input}
            onValueChange={setInput}
            onSubmit={handleSubmit}
            onStop={handleStop}
            status={status}
            isSubmitDisabled={isSubmitBlocked || hasPendingQuestionnaire}
            availableModels={availableModels}
            model={model}
            onModelChange={handleModelChange}
            webSearch={webSearch}
            onWebSearchChange={(enabled) => setWebSearch(enabled && features.webSearch)}
            webSearchAvailable={features.webSearch}
            reasoningEffort={reasoningEffort}
            onReasoningEffortChange={setReasoningEffort}
            proMode={proMode}
            onProModeChange={setProMode}
            fastMode={fastMode}
            onFastModeChange={setFastMode}
            deepResearch={deepResearch}
            onDeepResearchChange={setDeepResearch}
          />
        </div>
      </IntelligentUiActionsProvider>
    </ArtifactPreviewProvider>
  );
}
