"use client";

import { useExtracted } from "next-intl";
import { formatStorageBytes } from "@/lib/attachment-quota";
import { trpc } from "@/lib/trpc/react";
import { Progress } from "../ui/progress";

/** Attachment storage counted against the plan quota; hidden when storage is not configured. */
export function AttachmentStorageUsage() {
  const t = useExtracted();
  const { data } = trpc.attachments.storageUsage.useQuery(undefined, { staleTime: 60_000 });
  if (!data) return null;

  const percent = data.limitBytes > 0 ? Math.min((data.usedBytes / data.limitBytes) * 100, 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{t("Attachment storage")}</span>
        <span className="text-muted-foreground">
          {t("{used} of {limit}", {
            used: formatStorageBytes(data.usedBytes),
            limit: formatStorageBytes(data.limitBytes),
          })}
        </span>
      </div>
      <Progress value={percent} className="h-2" />
    </div>
  );
}
