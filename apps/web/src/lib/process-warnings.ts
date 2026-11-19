import { ServerResponse } from "node:http";

let installed = false;

function isServerResponseCloseListenerWarning(warning: string | Error) {
  if (typeof warning === "string" || warning.name !== "MaxListenersExceededWarning") {
    return false;
  }
  const { emitter, type } = warning as Error & { emitter?: unknown; type?: unknown };
  return emitter instanceof ServerResponse && type === "close";
}

/**
 * Next.js (request signal, streaming, `after()`) and Sentry each add a `close`
 * listener to the same ServerResponse, so streamed chat responses pass Node's
 * default limit of 10. The listeners go away with the response, so this is not
 * a leak; drop only that warning and keep every other one.
 */
export function installProcessWarningFilter() {
  if (installed) {
    return;
  }
  installed = true;

  const originalEmitWarning = process.emitWarning.bind(process) as (
    warning: string | Error,
    ...args: unknown[]
  ) => void;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isServerResponseCloseListenerWarning(warning)) {
      return;
    }
    originalEmitWarning(warning, ...args);
  }) as typeof process.emitWarning;
}
