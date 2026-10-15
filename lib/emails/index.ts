import "@tanstack/react-start/server-only";

type EmailRenderer = typeof import("./render");

// Loaded on first use so react-email stays out of modules that never send mail.
export async function loadEmailRenderer(): Promise<EmailRenderer> {
  return import("./render");
}
