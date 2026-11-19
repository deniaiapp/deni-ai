/** The two top-level modes of the signed-in app. Each keeps its own history. */
export type AppMode = "chat" | "run";

export function getAppMode(pathname: string | null | undefined): AppMode {
  return pathname === "/run" || Boolean(pathname?.startsWith("/run/")) ? "run" : "chat";
}
