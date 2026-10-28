import { useExtracted } from "use-intl";

export function ProjectsSettingsLoading() {
  const t = useExtracted();

  return <div className="py-10 text-sm text-muted-foreground">{t("Loading projects…")}</div>;
}
