import { useLoaderData } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers";

/** App providers with the platform capabilities the root route resolved per request. */
export function RuntimeAppProviders({ children }: { children: ReactNode }) {
  const platformCapabilities = useLoaderData({ from: "__root__" });
  return <AppProviders platformCapabilities={platformCapabilities}>{children}</AppProviders>;
}
