import { useExtracted } from "use-intl";
import {
  extractChatRequestErrorText,
  isUserFacingChatRequestError,
} from "@/lib/chat-request-error";

/**
 * Translates the English chat error strings returned by `/api/chat`. Known
 * messages are matched first; other text is shown only when it is user-facing,
 * so internal errors fall back to the generic message.
 */
export function useLocalizedChatError() {
  const t = useExtracted();

  return (error: unknown): string => {
    const generic = t("An unexpected error occurred.");
    const text = extractChatRequestErrorText(error);
    if (!text) {
      return generic;
    }

    const unavailable = text.match(
      /^(.+) models are currently unavailable\. Please try again later\.$/,
    );
    if (unavailable) {
      return t("{provider} models are currently unavailable. Please try again later.", {
        provider: unavailable[1],
      });
    }

    const highDemand = text.match(
      /^(.+) models are experiencing high demand right now\. Please try again later\.$/,
    );
    if (highDemand) {
      return t(
        "{provider} models are experiencing high demand right now. Please try again later.",
        {
          provider: highDemand[1],
        },
      );
    }

    const contextWithTokens = text.match(
      /^(.+) exceeded its context window \(([\d,]+) tokens\)\. Start a new chat or trim earlier messages\/files\.$/,
    );
    if (contextWithTokens) {
      return t(
        "{model} exceeded its context window ({tokens} tokens). Start a new chat or trim earlier messages/files.",
        { model: contextWithTokens[1], tokens: contextWithTokens[2] },
      );
    }

    const context = text.match(
      /^(.+) exceeded its context window\. Start a new chat or trim earlier messages\/files\.$/,
    );
    if (context) {
      return t(
        "{model} exceeded its context window. Start a new chat or trim earlier messages/files.",
        { model: context[1] },
      );
    }

    switch (text) {
      case "You've hit the usage limit for your plan.":
      case "Usage limit reached for your plan.":
        return t("You've hit the usage limit for your plan.");
      case "This model is not available on your plan. Upgrade to Plus or higher to use it.":
        return t("This model is not available on your plan. Upgrade to Plus or higher to use it.");
      case "This model is available on the Pro plan. Upgrade to Pro to use it.":
        return t("This model is available on the Pro plan. Upgrade to Pro to use it.");
      case "Pro mode is not available on your plan. Upgrade to Plus or higher to use it.":
        return t("Pro mode is not available on your plan. Upgrade to Plus or higher to use it.");
      case "Only GPT-6 Luna is available for guest sessions.":
        return t("Only GPT-6 Luna is available for guest sessions. Log in to use more models.");
      case "Pro mode is not available for guest sessions.":
        return t("Pro mode is not available for guest sessions. Log in to use it.");
      case "Fast, Pro, and Deep Research are not available for guest sessions.":
        return t(
          "Fast, Pro, and Deep Research are not available for guest sessions. Log in to use them.",
        );
      case "Conversations this long are not available for guest sessions.":
        return t(
          "Conversations this long are not available for guest sessions. Start a new chat or log in to continue.",
        );
      case "Attachments this large are not available for guest sessions.":
        return t(
          "Files this large are not available for guest sessions. Remove the attachment or log in to send it.",
        );
      // Also another account's attachment (src/server/http/chat/route.ts).
      case "Invalid or oversized attachment":
        return t(
          "An attachment in this chat can't be used. It may be too large, unsupported, or unavailable.",
        );
      case "Too many requests. Please slow down.":
        return t("Too many requests. Please slow down.");
      case "Chat not found":
        return t("This chat couldn't be found. It may have been deleted.");
      default:
        return isUserFacingChatRequestError(text) ? text : generic;
    }
  };
}
