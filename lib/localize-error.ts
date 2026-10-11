import "server-only";

import { getExtracted, getLocale } from "next-intl/server";
import { translateMessage } from "./i18n-server";
import type { UsageLimitError } from "./plans";
import { getUsageSnapshot } from "./usage";

/**
 * Translates the English messages that lib code throws so API routes can return them in the
 * viewer's language. Messages that are not mapped here fall back to the
 * shared server dictionary, and anything still unknown is returned unchanged.
 */
export async function localizeError(error: unknown, fallback?: string): Promise<string> {
  const t = await getExtracted();
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return fallback ?? t("Something went wrong");

  const exact: Record<string, () => string> = {
    "Invalid cron expression": () => t("Invalid cron expression"),
    "Could not revoke access at Google. Try again.": () => t("Could not revoke access at Google. Try again."),
    "Could not revoke access at GitHub. Try again.": () => t("Could not revoke access at GitHub. Try again."),
    "Cron expression has no matching time in the next five years": () => t("Cron expression has no matching time in the next five years"),
    "MCP URL is invalid": () => t("MCP URL is invalid"),
    "MCP URL must use http or https": () => t("MCP URL must use http or https"),
    "MCP connection name is required": () => t("MCP connection name is required"),
    "MCP connection not found": () => t("MCP connection not found"),
    "An MCP connection with this name already exists": () => t("An MCP connection with this name already exists"),
    "MCP connection is not available": () => t("MCP connection is not available"),
    "MCP tool name is invalid": () => t("MCP tool name is invalid"),
    "MCP request failed": () => t("MCP request failed"),
    "Path is outside the workspace": () => t("Path is outside the workspace"),
    "A file path is required": () => t("A file path is required"),
    "A directory path is required": () => t("A directory path is required"),
    "File is too large (maximum 1 MB)": () => t("File is too large (maximum 1 MB)"),
    "File is too large to download": () => t("File is too large to download"),
    "File not found": () => t("File not found"),
    "Path is a directory": () => t("Path is a directory"),
    "The workspace root cannot be deleted": () => t("The workspace root cannot be deleted"),
    "Artifact path must stay inside the workspace": () => t("Artifact path must stay inside the workspace"),
    "Unable to register artifact": () => t("Unable to register artifact"),
    "Invalid URL": () => t("Invalid URL"),
    "Only http(s) URLs are allowed": () => t("Only http(s) URLs are allowed"),
    "Invalid plugin operation": () => t("Invalid plugin operation"),
    "Connect write access first": () => t("Connect write access first"),
    "Result too large to display": () => t("Result too large to display"),
    "Input too large": () => t("Input too large"),
    "No teammate matched that mention. Choose a name or use @everyone.": () => t("No teammate matched that mention. Choose a name or use @everyone."),
    "Conversation no longer exists": () => t("Conversation no longer exists"),
    "Reply target not found": () => t("Reply target not found"),
    "Choose a valid time.": () => t("Choose a valid time."),
    "Choose a weekday.": () => t("Choose a weekday."),
    "Choose a day between 1 and 31.": () => t("Choose a day between 1 and 31."),
    "Checkout URL is unavailable": () => t("Checkout URL is unavailable"),
  };
  const known = exact[message];
  if (known) return known();

  let match: RegExpMatchArray | null;
  if ((match = message.match(/^Invalid timezone: (.+)$/))) return t("Invalid timezone: {timezone}", { timezone: match[1] });
  if ((match = message.match(/^Invalid MCP header: (.+)$/))) return t("Invalid MCP header: {name}", { name: match[1] });
  if ((match = message.match(/^MCP SSE connection failed \((\d+)\)$/))) return t("MCP SSE connection failed ({status})", { status: match[1] });
  if ((match = message.match(/^MCP request failed \((\d+)\)$/))) return t("MCP request failed ({status})", { status: match[1] });
  if ((match = message.match(/^Connect (\w+)( write access)? in Plugins first\.$/))) {
    return match[2]
      ? t("Connect {service} write access in Plugins first.", { service: match[1] })
      : t("Connect {service} in Plugins first.", { service: match[1] });
  }
  if ((match = message.match(/^Reconnect (\w+) in Plugins\.$/))) return t("Reconnect {service} in Plugins.", { service: match[1] });

  return translateMessage(await getLocale(), message);
}

/** Usage limits are phrased from the plan limits at the time of the request. */
export async function localizeUsageLimit(userId: string, error: UsageLimitError): Promise<string> {
  const t = await getExtracted();
  const usage = await getUsageSnapshot(userId);
  const plan = usage.planName;
  switch (error.metric) {
    case "tokens":
      return t("Monthly token limit reached ({limit} on {plan}). Upgrade to keep chatting.", { limit: usage.tokens.limit.toLocaleString(), plan });
    case "browser":
      return t("Monthly browser time limit reached ({limit} min on {plan}). Upgrade to keep using the browser.", { limit: String(usage.browserMinutes.limit), plan });
    case "computer":
      return t("Monthly computer time limit reached ({limit} min on {plan}). Upgrade to keep using the terminal.", { limit: String(usage.computerMinutes.limit), plan });
    default:
      return t("Teammate limit reached ({limit} on {plan}). Upgrade to add more teammates.", { limit: String(usage.teammates.limit), plan });
  }
}

