import { createContext, use } from "react";

type IntelligentUiActions = {
  /** Sends text as the user's next message; null while a message cannot be sent. */
  sendPrompt: ((text: string) => void) | null;
};

const IntelligentUiActionsContext = createContext<IntelligentUiActions>({ sendPrompt: null });

export const IntelligentUiActionsProvider = IntelligentUiActionsContext.Provider;

export function useIntelligentUiActions() {
  return use(IntelligentUiActionsContext);
}

type IntelligentUiMessage = {
  messageId: string | null;
  /** While true, an unparseable block is still being written and shows a placeholder. */
  isStreaming: boolean;
};

const IntelligentUiMessageContext = createContext<IntelligentUiMessage>({
  messageId: null,
  isStreaming: false,
});

export const IntelligentUiMessageProvider = IntelligentUiMessageContext.Provider;

export function useIntelligentUiMessage() {
  return use(IntelligentUiMessageContext);
}
