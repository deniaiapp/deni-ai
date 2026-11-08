import { isAbortError } from "@/lib/chat-tools/helpers";

let installed = false;

function looksLikeAbortLog(args: unknown[]) {
  return args.some((arg) => {
    if (isAbortError(arg)) {
      return true;
    }
    if (typeof arg !== "string") {
      return false;
    }
    return arg.includes("unhandledRejection") && arg.includes("AbortError");
  });
}

/**
 * Cancelled requests (client navigations, preloads, stopped streams) abort
 * leftover server work, which can surface as an extra unhandled AbortError.
 * Swallow that noise without patching AbortController (the patch itself
 * re-entered abort()).
 */
export function installAbortDiagnostics() {
  if (installed) {
    return;
  }
  installed = true;

  // Registering a listener replaces Node's default reporting, so anything that
  // is not an abort must still be logged here or it would vanish silently.
  process.on("unhandledRejection", (reason) => {
    if (isAbortError(reason)) {
      return;
    }
    console.error("[unhandledRejection]", reason);
  });

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (looksLikeAbortLog(args)) {
      return;
    }
    originalError(...args);
  };
}
