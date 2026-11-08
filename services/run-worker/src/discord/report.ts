import { runLogger } from "@deniai/run/runtime";

/** Log an unexpected error with its context; the worker's logs are the error sink. */
export function reportError(error: unknown, context?: string) {
  const message = error instanceof Error ? error.message : String(error);
  runLogger().error(context ? `[${context}] ${message}` : message, error);
}
