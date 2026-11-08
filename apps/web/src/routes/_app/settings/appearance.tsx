import { createFileRoute, useRouteContext, useRouter } from "@tanstack/react-router";
import { AlignLeft, Check, Monitor, Moon, Sparkles, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useExtracted } from "use-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SettingsPageShell } from "@/components/settings-page-shell";
import {
  PageSection,
  PageSectionContent,
  PageSectionDescription,
  PageSectionHeader,
  PageSectionTitle,
} from "@deniai/ui/components/page-section";
import { useThemePreset } from "@/hooks/use-theme-preset";
import { setVisualLayout, useVisualLayout } from "@/hooks/use-visual-layout";
import { type ThemeName, themePresets } from "@/lib/theme-presets";
import { storeUiPreference, type UiPreference } from "@/lib/ui-preference";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/settings/appearance")({
  component: AppearancePage,
});

/** true only after client hydration — next-themes has no value during SSR. */
function useHasMounted() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

type ChoiceOption<T extends string> = {
  value: T;
  title: string;
  description?: string;
  icon?: LucideIcon;
  preview?: string[];
};

/** A radio group of bordered choices; the selected one gets a check and an indigo edge. */
function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 2,
}: {
  label: string;
  options: ChoiceOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  columns?: 2 | 3;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid grid-cols-1 gap-2", columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}
    >
      {options.map(({ value: optionValue, title, description, icon: Icon, preview }) => {
        const selected = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(optionValue)}
            className={cn(
              "flex items-start gap-3 rounded-card border p-3 text-left transition-colors duration-(--duration-fast)",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selected
                ? "border-primary bg-secondary/60 ring-1 ring-primary legacy:border-foreground legacy:bg-accent legacy:ring-0"
                : "border-border hover:bg-accent/60",
            )}
          >
            {Icon ? <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : null}
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-medium">{title}</span>
              {description ? (
                <span className="text-xs text-muted-foreground">{description}</span>
              ) : null}
              {preview ? (
                <span className="mt-1 flex w-full gap-1" aria-hidden="true">
                  {preview.map((bar) => (
                    <span key={bar} className={cn("h-1.5 flex-1 rounded-full", bar)} />
                  ))}
                </span>
              ) : null}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                selected
                  ? "bg-primary text-primary-foreground legacy:bg-foreground legacy:text-background"
                  : "border border-input",
              )}
            >
              {selected ? <Check className="size-3" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AppearancePage() {
  const t = useExtracted();
  const router = useRouter();
  const hasMounted = useHasMounted();
  const { theme, setTheme } = useTheme();
  const { preset, setPreset } = useThemePreset();
  const visualLayout = useVisualLayout();
  const ui = useRouteContext({ from: "__root__", select: (context) => context.ui });
  // Avoid hydration mismatch: server always sees theme as undefined.
  const activeMode = hasMounted ? theme : undefined;

  const changeUi = async (value: UiPreference) => {
    storeUiPreference(value);
    // Re-run the root route so React renders <html data-ui> with the new value.
    await router.invalidate();
  };

  const getPresetCopy = (key: ThemeName) => {
    switch (key) {
      case "default":
        return { title: t("Default"), description: t("Clean, neutral gray tones") };
      case "t3-chat":
        return { title: t("T3 Chat"), description: t("Pink & violet inspired chat vibe") };
      case "tangerine":
        return { title: t("Tangerine"), description: t("Bright, warm, and friendly") };
      case "mono":
        return { title: t("Mono"), description: t("Neutral grayscale, minimal distractions") };
      case "deep-dark":
        return {
          title: t("Deep Dark"),
          description: t("Pure black surfaces with crisp OLED contrast"),
        };
      case "deep-dark-high-contrast":
        return {
          title: t("Deep Dark (high contrast)"),
          description: t("Absolute black with maximum contrast for OLED screens"),
        };
      default:
        return { title: key, description: "" };
    }
  };

  return (
    <SettingsPageShell title={t("Appearance")} description={t("Customize your visual experience")}>
      <div>
        <PageSection>
          <PageSectionHeader>
            <PageSectionTitle>{t("Interface")}</PageSectionTitle>
            <PageSectionDescription>
              {t("Switch between the new design and the previous one on this browser")}
            </PageSectionDescription>
          </PageSectionHeader>
          <PageSectionContent>
            <ChoiceGroup
              label={t("Interface")}
              value={ui}
              onChange={(value) => void changeUi(value)}
              options={[
                {
                  value: "next",
                  title: t("New design"),
                  description: t("Indigo frame, calmer type and roomier settings"),
                  preview: ["bg-[#182052]", "bg-[#33419d]", "bg-[#f2b036]", "bg-[#f5f7fb]"],
                },
                {
                  value: "legacy",
                  title: t("Previous design"),
                  description: t("Neutral gray tones and the color themes below"),
                  preview: ["bg-[#171717]", "bg-[#737373]", "bg-[#f5f5f5]"],
                },
              ]}
            />
          </PageSectionContent>
        </PageSection>

        <PageSection>
          <PageSectionHeader>
            <PageSectionTitle>{t("Mode")}</PageSectionTitle>
            <PageSectionDescription>
              {t("Select light, dark, or system preference")}
            </PageSectionDescription>
          </PageSectionHeader>
          <PageSectionContent>
            <ChoiceGroup
              label={t("Mode")}
              columns={3}
              value={activeMode}
              onChange={setTheme}
              options={[
                { value: "light", title: t("Light"), icon: Sun },
                { value: "dark", title: t("Dark"), icon: Moon },
                { value: "system", title: t("System"), icon: Monitor },
              ]}
            />
          </PageSectionContent>
        </PageSection>

        <PageSection>
          <PageSectionHeader>
            <PageSectionTitle>{t("Language")}</PageSectionTitle>
            <PageSectionDescription>
              {t("Choose your preferred language for the interface")}
            </PageSectionDescription>
          </PageSectionHeader>
          <PageSectionContent>
            <LocaleSwitcher />
          </PageSectionContent>
        </PageSection>

        <PageSection>
          <PageSectionHeader>
            <PageSectionTitle>{t("Layout and visuals")}</PageSectionTitle>
            <PageSectionDescription>
              {t("Choose how much answers use visual and interactive elements")}
            </PageSectionDescription>
          </PageSectionHeader>
          <PageSectionContent>
            <ChoiceGroup
              label={t("Layout and visuals")}
              value={hasMounted ? visualLayout : undefined}
              onChange={setVisualLayout}
              options={[
                {
                  value: "rich",
                  icon: Sparkles,
                  title: t("Rich"),
                  description: t(
                    "Answers can include charts, checklists, calculators, and other interactive elements when they help",
                  ),
                },
                {
                  value: "simple",
                  icon: AlignLeft,
                  title: t("Simple"),
                  description: t("Mostly text. Visual elements appear only when you ask for them"),
                },
              ]}
            />
          </PageSectionContent>
        </PageSection>

        {ui === "legacy" ? (
          <PageSection>
            <PageSectionHeader>
              <PageSectionTitle>{t("Color Theme")}</PageSectionTitle>
              <PageSectionDescription>
                {t("Choose a color palette that suits your style")}
              </PageSectionDescription>
            </PageSectionHeader>
            <PageSectionContent>
              <ChoiceGroup
                label={t("Color Theme")}
                value={preset}
                onChange={setPreset}
                options={themePresets.map((presetItem) => ({
                  value: presetItem.key,
                  ...getPresetCopy(presetItem.key),
                  preview: presetItem.preview,
                }))}
              />
            </PageSectionContent>
          </PageSection>
        ) : null}
      </div>
    </SettingsPageShell>
  );
}
