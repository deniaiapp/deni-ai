declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/** Queues a gtag.js command (loaded by the root route in production). */
export function sendGAEvent(..._args: unknown[]) {
  if (typeof window === "undefined" || !window.dataLayer) {
    return;
  }
  // gtag.js reads `arguments` objects, not arrays.
  // oxlint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments);
}
