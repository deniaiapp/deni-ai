/**
 * Starts `task` without delaying the current response. Errors are logged; the
 * long-running Node.js server keeps the task alive after the response is sent.
 */
export function runAfterResponse(task: () => unknown) {
  setImmediate(() => {
    Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        console.error("[run-after-response] background task failed", error);
      });
  });
}
