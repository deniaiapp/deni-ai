import { useExtracted } from "use-intl";
import { RunApiError } from "./run-api";

/** Translated text for a Run API error code (src/server/http/run/router.ts). */
export function useRunErrorText() {
  const t = useExtracted();
  return (error: unknown): string => {
    const code = error instanceof RunApiError ? error.code : null;
    const field = error instanceof RunApiError ? error.detail.field : undefined;
    const message =
      error instanceof RunApiError && typeof error.detail.message === "string"
        ? error.detail.message
        : null;
    switch (code) {
      case "unauthorized":
        return t("Sign in to use Run.");
      case "guest_account":
        return t("Guest accounts cannot use Run. Create an account to continue.");
      case "run_unconfigured":
        return t("Run is not set up on this server yet.");
      case "llm_unconfigured":
        return t("No AI model is configured for Run on this server yet.");
      case "usage_limit":
        return error instanceof RunApiError && error.detail.metric === "teammates"
          ? t("You have reached your plan's teammate limit. Upgrade your plan to add more.")
          : t("This month's usage is used up. Upgrade your plan to keep going.");
      case "rate_limited":
        return t("Too many requests. Please wait a moment.");
      case "name_required":
        return t("Name is required.");
      case "invalid_icon":
        return t("Invalid icon.");
      case "default_teammate":
        return t("Default teammates cannot be deleted.");
      case "invalid_group":
        return t("Choose at least two teammates.");
      case "thread_not_found":
        return t("Conversation not found.");
      case "thread_busy":
        return t("Stop or finish the current task first.");
      case "job_not_cancellable":
        return t("This task can no longer be stopped.");
      case "job_not_retryable":
        return t("This task cannot be retried.");
      case "invalid_skill":
        return t("Name and instructions are required.");
      case "duplicate_skill":
        return t("A skill with this name already exists.");
      case "invalid_routine":
        if (field === "name") return t("Name is required.");
        if (field === "instructions") return t("Instructions are required.");
        if (field === "cron")
          return message ? t("Invalid schedule: {message}", { message }) : t("Invalid schedule.");
        return t("Invalid routine.");
      case "invalid_timezone":
        return t("Unknown time zone.");
      case "discord_unconfigured":
        return t("Discord is not set up on this server.");
      case "browser_unconfigured":
        return t("The browser is not set up on this server.");
      case "mcp_error":
        return message ?? t("The connector could not be reached.");
      case "name_and_url_required":
        return t("Name and URL are required.");
      default:
        return message ?? t("Something went wrong. Please try again.");
    }
  };
}
