import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, Folder as FolderIcon } from "lucide-react";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import { Spinner } from "@deniai/ui/components/spinner";
import { runFetch, useThreadArtifacts, type Artifact } from "./run-api";
import { useRunErrorText } from "./run-error-text";

function ArtifactCard({
  artifact,
  onRevision,
}: {
  artifact: Artifact;
  onRevision: (text: string) => void;
}) {
  const t = useExtracted();
  const errorText = useRunErrorText();
  const [preview, setPreview] = useState<string | null>(null);
  const load = useMutation({
    mutationFn: () => runFetch<{ content: string }>(`artifacts/${artifact.id}`),
    onSuccess: (result) => setPreview(result.content),
    onError: (error) => toast.error(errorText(error)),
  });
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start gap-2">
        <FolderIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{artifact.title}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{artifact.path}</p>
          {artifact.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{artifact.description}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={load.isPending}
          onClick={() => (preview === null ? load.mutate() : setPreview(null))}
        >
          {load.isPending ? <Spinner className="size-3" /> : null}
          {preview === null ? t("Preview") : t("Hide preview")}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          render={<a href={`/api/run/artifacts/${artifact.id}?mode=download`} download />}
          nativeButton={false}
        >
          <DownloadIcon />
          {t("Download")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() =>
            onRevision(
              t('Revise the artifact "{title}" at {path} and register the updated file.', {
                title: artifact.title,
                path: artifact.path,
              }),
            )
          }
        >
          {t("Request revision")}
        </Button>
      </div>
      {preview !== null ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
          {preview}
        </pre>
      ) : null}
    </div>
  );
}

/** The files a teammate delivered in a conversation, listed under its messages. */
export function RunArtifacts({
  threadId,
  onRevision,
}: {
  threadId: string;
  onRevision: (text: string) => void;
}) {
  const t = useExtracted();
  const artifacts = useThreadArtifacts(threadId);
  const list = artifacts.data?.artifacts ?? [];
  if (list.length === 0) return null;
  return (
    <section className="mt-4 flex flex-col gap-2" aria-label={t("Deliverables")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t("Deliverables")}
      </p>
      {list.slice(0, 12).map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} onRevision={onRevision} />
      ))}
    </section>
  );
}
