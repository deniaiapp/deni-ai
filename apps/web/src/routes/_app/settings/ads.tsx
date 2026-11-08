import { createFileRoute } from "@tanstack/react-router";
import { AdsSettings } from "@/components/ads-settings";

export const Route = createFileRoute("/_app/settings/ads")({
  component: AdsSettings,
});
