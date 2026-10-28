import { createFileRoute } from "@tanstack/react-router";
import { BlogSettingsPage } from "@/components/blog/blog-settings-page";

export const Route = createFileRoute("/_app/settings/blog/")({
  component: BlogSettingsPage,
});
