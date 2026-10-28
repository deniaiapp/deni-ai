import { createServerFn } from "@tanstack/react-start";

/** Capabilities derived from server env at request time (never baked in at build). */
export const getPlatformCapabilitiesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getPlatformCapabilities } = await import("@/lib/platform-capabilities.server");
  return getPlatformCapabilities();
});
