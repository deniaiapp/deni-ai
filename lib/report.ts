export function reportError(error: unknown, context?: string) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(context ? `[${context}] ${message}` : message, error);
  const webhook = process.env.ERROR_WEBHOOK_URL?.trim();
  if (!webhook) return;
  void fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: context ?? "app",
      message,
      stack,
      at: new Date().toISOString(),
    }),
  }).catch(() => undefined);
}
