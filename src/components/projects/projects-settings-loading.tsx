import { useExtracted } from "use-intl";
import { SettingsPageShell } from "@/components/settings-page-shell";

/** Same title block as the loaded page, so the heading does not jump. */
export function ProjectsSettingsLoading() {
  const t = useExtracted();

  return (
    <SettingsPageShell title={t("Projects")}>
      <p className="py-10 text-sm text-muted-foreground">{t("Loading projects…")}</p>
    </SettingsPageShell>
  );
}
