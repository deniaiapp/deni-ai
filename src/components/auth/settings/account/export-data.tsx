"use client";

import { Download, FileJson, RotateCcw } from "lucide-react";
import { useExtracted, useLocale } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { triggerDownload } from "@/lib/chat-export";
import { formatAppDate } from "@/lib/format-date";
import { trpc } from "@/lib/trpc/react";

/** How often the status is refetched while an export is being built. */
const EXPORT_POLL_INTERVAL_MS = 4000;

const KIB = 1024;
const MIB = 1024 * KIB;

function formatExportSize(bytes: number, locale: string) {
  const [value, unit] = bytes >= MIB ? [bytes / MIB, "megabyte"] : [bytes / KIB, "kilobyte"];
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    maximumFractionDigits: 1,
  }).format(Math.max(value, 0.1));
}

export function ExportData() {
  const t = useExtracted();
  const locale = useLocale();
  const localizeError = useLocalizeError();
  const utils = trpc.useUtils();
  const statusQuery = trpc.account.exportStatus.useQuery(undefined, {
    // Only while the export is being built: stops once it is ready or failed.
    refetchInterval: (query) =>
      query.state.data?.status === "pending" ? EXPORT_POLL_INTERVAL_MS : false,
  });
  const latest = statusQuery.data ?? null;

  const requestExport = trpc.account.requestExport.useMutation({
    onSuccess: (result) => {
      if (result.mode === "download") {
        triggerDownload(
          JSON.stringify(result.payload, null, 2),
          result.fileName,
          "application/json",
        );
        toast.success(t("Your data export has been downloaded."));
        return;
      }
      // Shows the pending state (and starts polling) right away.
      utils.account.exportStatus.setData(undefined, result.export);
    },
    onError: (error) => {
      toast.error(localizeError(error, t("Failed to export account data.")));
      void utils.account.exportStatus.invalidate();
    },
  });

  const downloadExport = trpc.account.exportDownloadUrl.useMutation({
    // The file is served as a download, so the page stays open.
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => {
      toast.error(localizeError(error, t("Failed to download the export.")));
      void utils.account.exportStatus.invalidate();
    },
  });

  const isBuilding = latest?.status === "pending";
  const isRequesting = requestExport.isPending || isBuilding;

  let statusText: string | null = null;
  if (latest?.status === "pending") {
    statusText = t("Preparing your export. This can take a few minutes; you can leave this page.");
  } else if (latest?.status === "ready" && latest.expiresAt) {
    statusText = t("Your export ({size}) is ready. Download it before {date}.", {
      size: formatExportSize(latest.sizeBytes ?? 0, locale),
      date: formatAppDate(latest.expiresAt, locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    });
  } else if (latest?.status === "failed") {
    statusText = t("Your last export failed. Please try again.");
  } else if (latest?.status === "expired") {
    statusText = t("Your last export has expired. Export again to download your data.");
  }

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">{t("Download your data")}</h2>
      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("Account export")}</p>
            <p className="text-xs text-muted-foreground">
              {t(
                "Download a JSON copy of your profile, chats, memories, projects, and security activity. Secrets such as passwords and API keys are not included.",
              )}
            </p>
            {statusText && (
              <p
                role="status"
                className={
                  latest?.status === "failed"
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {statusText}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {latest?.status === "ready" && (
              <Button
                type="button"
                disabled={downloadExport.isPending}
                onClick={() => downloadExport.mutate({ id: latest.id })}
              >
                {downloadExport.isPending ? <Spinner /> : <Download className="size-4" />}
                {t("Download")}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={isRequesting}
              onClick={() => requestExport.mutate()}
            >
              {isRequesting ? (
                <Spinner />
              ) : latest?.status === "failed" ? (
                <RotateCcw className="size-4" />
              ) : (
                <FileJson className="size-4" />
              )}
              {latest?.status === "failed"
                ? t("Try again")
                : latest?.status === "ready" || latest?.status === "expired"
                  ? t("Export again")
                  : t("Export JSON")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
