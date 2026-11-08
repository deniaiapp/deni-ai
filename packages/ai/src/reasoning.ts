import type { AssistantModelMessage, ModelMessage } from "ai";

type ProviderOptions = NonNullable<ModelMessage["providerOptions"]>;
type AssistantContentPart = Exclude<AssistantModelMessage["content"], string>[number];

function withoutReasoningDetails(
  providerOptions: ProviderOptions | undefined,
): ProviderOptions | undefined {
  const openrouter = providerOptions?.openrouter;
  if (!openrouter || !("reasoning_details" in openrouter)) return providerOptions;
  const { reasoning_details: _reasoningDetails, ...rest } = openrouter;
  return { ...providerOptions, openrouter: rest };
}

/**
 * Drop the signed reasoning of earlier turns. Anthropic binds a thinking
 * block's signature to the system prompt and messages it was created with, and
 * rejects it once either changes (a new date or memory in the system prompt,
 * edited project instructions, a model switch, an edited or regenerated
 * branch). Earlier turns' reasoning does not affect the answer, so only the
 * turn being answered (after the last user message, such as a tool loop a
 * questionnaire answer continues) keeps it.
 */
export function stripEarlierTurnReasoning(messages: ModelMessage[]): ModelMessage[] {
  const lastUserIndex = messages.findLastIndex((message) => message.role === "user");
  return messages.flatMap<ModelMessage>((message, index) => {
    if (index >= lastUserIndex || message.role !== "assistant") return [message];
    const providerOptions = withoutReasoningDetails(message.providerOptions);
    if (typeof message.content === "string") {
      return [
        providerOptions === message.providerOptions ? message : { ...message, providerOptions },
      ];
    }
    const content = message.content.flatMap<AssistantContentPart>((part) => {
      if (part.type === "reasoning") return [];
      if (part.type !== "tool-call") return [part];
      const partOptions = withoutReasoningDetails(part.providerOptions);
      return [
        partOptions === part.providerOptions ? part : { ...part, providerOptions: partOptions },
      ];
    });
    // A turn that only reasoned (stopped before answering) has nothing left to send.
    if (content.length === 0) return [];
    return [{ ...message, content, ...(providerOptions ? { providerOptions } : {}) }];
  });
}
