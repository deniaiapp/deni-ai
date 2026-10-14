/// <reference types="@vitejs/plugin-rsc/types" />
import "server-only";

type EmailRenderer = typeof import("./render");

// Route handlers run in the RSC environment, where react-dom/server refuses to load, so emails are
// rendered in the SSR environment instead. Scripts run with tsx have no import.meta.env and import
// the renderer directly.
export async function loadEmailRenderer(): Promise<EmailRenderer> {
  if (!import.meta.env) return import("./render");
  return import.meta.viteRsc.import<EmailRenderer>("./render", { environment: "ssr" });
}
