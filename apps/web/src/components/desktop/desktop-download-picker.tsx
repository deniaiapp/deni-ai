import React from "react";
import { Download } from "lucide-react";
import { useExtracted } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import { Checkbox } from "@deniai/ui/components/checkbox";
import type { DesktopDownloads, DesktopRelease } from "./types";

type DownloadOption = {
  id: string;
  href: string;
  os: "windows" | "macos" | "linux";
  arch: "x64" | "arm64";
  format: string;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
    architecture?: string;
  };
};

function normalizeArchitecture(raw: string): "x64" | "arm64" | null {
  const value = raw.toLowerCase();

  if (value.includes("arm") || value.includes("aarch")) {
    return "arm64";
  }

  if (
    value.includes("x86_64") ||
    value.includes("x64") ||
    value.includes("amd64") ||
    value.includes("intel")
  ) {
    return "x64";
  }

  return null;
}

function detectPreferredPlatform(): {
  os: DownloadOption["os"] | null;
  arch: DownloadOption["arch"] | null;
} {
  if (typeof window === "undefined") {
    return { os: null, arch: null };
  }

  const userAgentData = (navigator as NavigatorWithUserAgentData).userAgentData;
  const platformSource = `${userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`;
  const architectureSource = `${userAgentData?.architecture ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`;
  const platform = platformSource.toLowerCase();

  let os: DownloadOption["os"] | null = null;

  if (platform.includes("win")) {
    os = "windows";
  } else if (platform.includes("mac")) {
    os = "macos";
  } else if (platform.includes("linux") || platform.includes("x11")) {
    os = "linux";
  }

  return {
    os,
    arch: normalizeArchitecture(architectureSource),
  };
}

function parseDownloadOptions(assets: DesktopRelease["assets"]): DownloadOption[] {
  return assets
    .flatMap((asset) => {
      const { name, browser_download_url: href } = asset;

      if (/\.sig$/i.test(name) || /^latest\.json$/i.test(name) || /\.app\.tar\.gz$/i.test(name)) {
        return [];
      }

      let os: DownloadOption["os"] | null = null;
      if (/_windows_/i.test(name)) {
        os = "windows";
      } else if (/_darwin_/i.test(name)) {
        os = "macos";
      } else if (/_linux_/i.test(name)) {
        os = "linux";
      }

      if (!os) {
        return [];
      }

      const archMatch = name.match(/_(aarch64|arm64|x64|x86_64|amd64)(?=[._-])/i);
      const arch = normalizeArchitecture(archMatch?.[1] ?? "");

      if (!arch) {
        return [];
      }

      let format = "";
      if (/setup\.exe$/i.test(name)) {
        format = ".exe";
      } else if (/\.msi$/i.test(name)) {
        format = ".msi";
      } else if (/\.dmg$/i.test(name)) {
        format = ".dmg";
      } else if (/\.appimage$/i.test(name)) {
        format = "AppImage";
      } else if (/\.deb$/i.test(name)) {
        format = ".deb";
      } else if (/\.rpm$/i.test(name)) {
        format = ".rpm";
      } else {
        return [];
      }

      return [
        {
          id: name,
          href,
          os,
          arch,
          format,
        } satisfies DownloadOption,
      ];
    })
    .sort((a, b) => {
      const osOrder = { windows: 0, macos: 1, linux: 2 };

      if (osOrder[a.os] !== osOrder[b.os]) {
        return osOrder[a.os] - osOrder[b.os];
      }

      if (a.arch !== b.arch) {
        return a.arch === "arm64" ? -1 : 1;
      }

      return a.format.localeCompare(b.format);
    });
}

function getArchLabel(os: DownloadOption["os"], arch: DownloadOption["arch"]): string {
  if (os === "macos") {
    return arch === "arm64" ? "Apple Silicon" : "Intel";
  }

  return arch === "arm64" ? "ARM64" : "x64";
}

function getFormatLabel(format: string): string {
  return format.replace(/^\./, "");
}

function getOsText(os: DownloadOption["os"]): string {
  if (os === "windows") {
    return "Windows";
  }

  if (os === "macos") {
    return "macOS";
  }

  return "Linux";
}

const OS_ORDER = ["windows", "macos", "linux"] as const;

function selectionChipClassName(active: boolean): string {
  return `rounded-md border px-3 py-1.5 text-sm transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground"
  }`;
}

function pickDefaultOption(
  options: DownloadOption[],
  preferred: {
    os: DownloadOption["os"] | null;
    arch: DownloadOption["arch"] | null;
  },
): DownloadOption | null {
  if (options.length === 0) {
    return null;
  }

  return (
    options.find((option) => option.os === preferred.os && option.arch === preferred.arch) ??
    options.find((option) => option.os === preferred.os) ??
    options[0]
  );
}

type PreferredPlatform = ReturnType<typeof detectPreferredPlatform>;

const SERVER_PLATFORM: PreferredPlatform = { os: null, arch: null };
let clientPlatform: PreferredPlatform | undefined;

function getClientPlatform(): PreferredPlatform {
  clientPlatform ??= detectPreferredPlatform();
  return clientPlatform;
}

const subscribeToNothing = () => () => {};

export function DesktopDownloadPicker({ downloads }: { downloads: DesktopDownloads }) {
  const t = useExtracted();
  // The server cannot know the visitor's platform: render its default first and
  // switch to the detected build after hydration.
  const preferred = React.useSyncExternalStore(
    subscribeToNothing,
    getClientPlatform,
    () => SERVER_PLATFORM,
  );
  const [includePrerelease, setIncludePrerelease] = React.useState(false);
  const latestOptions = parseDownloadOptions(downloads.latestRelease.assets);
  const prereleaseOptions = parseDownloadOptions(downloads.prerelease?.assets ?? []);
  const hasPrerelease = prereleaseOptions.length > 0;
  // Derive the effective toggle instead of resetting state in an effect: when no
  // prerelease exists the user's opt-in is simply ignored, with no extra render.
  const effectiveIncludePrerelease = includePrerelease && hasPrerelease;
  const shouldUsePrereleaseFallback = latestOptions.length === 0 && hasPrerelease;
  const options =
    effectiveIncludePrerelease || shouldUsePrereleaseFallback ? prereleaseOptions : latestOptions;
  // Only the user's explicit picks are stored. The effective os/arch/format are
  // derived below with validation against the current options, so we never sync
  // selection state through an effect when `options` changes.
  const [selectedOs, setSelectedOs] = React.useState<DownloadOption["os"] | null>(null);
  const [selectedArch, setSelectedArch] = React.useState<DownloadOption["arch"] | null>(null);
  const [selectedFormat, setSelectedFormat] = React.useState<string | null>(null);

  const osOptions = {
    windows: options.filter((option) => option.os === "windows"),
    macos: options.filter((option) => option.os === "macos"),
    linux: options.filter((option) => option.os === "linux"),
  };
  const availableOs = OS_ORDER.filter((os) => osOptions[os].length > 0);
  const selectOs = (os: DownloadOption["os"]) => {
    setSelectedOs(os);
    setSelectedArch(null);
    setSelectedFormat(null);
  };
  const currentOs =
    (selectedOs && options.some((option) => option.os === selectedOs) ? selectedOs : null) ??
    pickDefaultOption(options, preferred)?.os ??
    null;
  const availableArchs = (() => {
    if (!currentOs) {
      return [] as DownloadOption["arch"][];
    }

    const archs = new Set<DownloadOption["arch"]>();
    for (const option of options) {
      if (option.os === currentOs) {
        archs.add(option.arch);
      }
    }
    return Array.from(archs);
  })();
  const currentArch =
    (selectedArch && availableArchs.includes(selectedArch) ? selectedArch : null) ??
    (preferred.arch && availableArchs.includes(preferred.arch) ? preferred.arch : null) ??
    availableArchs[0] ??
    null;
  const availableFormats =
    !currentOs || !currentArch
      ? []
      : options.filter((option) => option.os === currentOs && option.arch === currentArch);
  const currentFormat =
    availableFormats.find((option) => option.format === selectedFormat)?.format ??
    availableFormats[0]?.format ??
    null;
  const selectedOption =
    availableFormats.find((option) => option.format === currentFormat) ??
    pickDefaultOption(options, preferred) ??
    null;

  return (
    <section id="download" aria-labelledby="desktop-download" className="mt-10">
      <h2 id="desktop-download" className="text-lg font-semibold">
        {t("Download")}
      </h2>
      <div className="mt-4 flex flex-col items-start gap-4">
        {hasPrerelease ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={includePrerelease}
              onCheckedChange={(checked) => setIncludePrerelease(checked === true)}
            />
            <span>{t("Pre-release")}</span>
          </label>
        ) : null}
        {options.length > 0 && selectedOption ? (
          <>
            {availableOs.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {availableOs.map((os) => (
                  <button
                    key={os}
                    type="button"
                    aria-pressed={currentOs === os}
                    onClick={() => selectOs(os)}
                    className={selectionChipClassName(currentOs === os)}
                  >
                    {getOsText(os)}
                  </button>
                ))}
              </div>
            ) : null}
            {availableArchs.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {availableArchs.map((arch) => (
                  <button
                    key={arch}
                    type="button"
                    aria-pressed={currentArch === arch}
                    onClick={() => {
                      setSelectedArch(arch);
                      setSelectedFormat(null);
                    }}
                    className={selectionChipClassName(currentArch === arch)}
                  >
                    {getArchLabel(currentOs ?? selectedOption.os, arch)}
                  </button>
                ))}
              </div>
            ) : null}
            {availableFormats.length > 1 ? (
              <div className="flex flex-wrap gap-2">
                {availableFormats.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={currentFormat === option.format}
                    onClick={() => setSelectedFormat(option.format)}
                    className={selectionChipClassName(currentFormat === option.format)}
                  >
                    {getFormatLabel(option.format)}
                  </button>
                ))}
              </div>
            ) : null}
            <Button
              size="lg"
              render={<a href={selectedOption.href} target="_blank" rel="noreferrer" />}
              nativeButton={false}
            >
              <Download className="size-4" />
              {t("Download")} ({getOsText(selectedOption.os)},{" "}
              {getArchLabel(selectedOption.os, selectedOption.arch)},{" "}
              {getFormatLabel(selectedOption.format)})
            </Button>
          </>
        ) : null}
        <a
          href={downloads.releasesUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("View all releases")}
        </a>
      </div>
    </section>
  );
}
