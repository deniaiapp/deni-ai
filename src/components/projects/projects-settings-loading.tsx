import { useExtracted } from "use-intl";
import { SettingsPageShell } from "@/components/settings-page-shell";
import { Spinner } from "@/components/ui/spinner";

/** Same title block as the loaded page, so the heading does not jump. */
export function ProjectsSettingsLoading() {
  const t = useExtracted();

  return (
    <SettingsPageShell title={t("Projects")}>
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    </SettingsPageShell>
  );
}
