import type { inferRouterOutputs } from "@trpc/server";
import { Trash2 } from "lucide-react";
import { Link } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { trpc } from "@/lib/trpc/react";
import type { AppRouter } from "@/server/api/root";

type SavedComparison = inferRouterOutputs<AppRouter>["chat"]["getComparisons"][number];

export function DeleteComparisonDialog({
  comparison,
  open,
  onOpenChange,
  onDeleted,
}: {
  comparison: Pick<SavedComparison, "id" | "title"> | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once the comparison is gone, so a page showing it can leave it. */
  onDeleted: (id: string) => void;
}) {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const utils = trpc.useUtils();

  async function forget(id: string) {
    onDeleted(id);
    // Marked stale without a refetch: a page still showing it is navigating away.
    void utils.chat.getComparison.invalidate({ id }, { refetchType: "none" });
    await utils.chat.getComparisons.invalidate();
    onOpenChange(false);
  }

  const deleteComparison = trpc.chat.deleteComparison.useMutation({
    onSuccess: async (_deleted, { id }) => {
      await forget(id);
      toast.success(t("Comparison deleted."));
    },
    onError: async (error, { id }) => {
      toast.error(localizeError(error, t("Could not delete this comparison. Please try again.")));
      // Already deleted elsewhere (another tab): it is gone either way.
      if (error.data?.code === "NOT_FOUND") await forget(id);
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (deleteComparison.isPending) return;
        onOpenChange(nextOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("Delete this comparison?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              "This will permanently remove “{title}” and both of its conversations. Chats you saved with Continue this chat are kept. This action cannot be undone.",
              { title: comparison?.title ?? "" },
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteComparison.isPending}>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!comparison || deleteComparison.isPending}
            onClick={() => {
              if (!comparison || deleteComparison.isPending) return;
              deleteComparison.mutate({ id: comparison.id });
            }}
          >
            {deleteComparison.isPending ? <Spinner /> : null}
            {t("Delete comparison")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SavedComparisonsList({
  history,
  activeId,
  locked,
  onDeleted,
}: {
  history: {
    isPending: boolean;
    isError: boolean;
    data?: SavedComparison[];
  };
  activeId: string | undefined;
  locked: boolean;
  onDeleted: (id: string) => void;
}) {
  const t = useExtracted();
  // Kept after closing so the dialog keeps its text while it animates out.
  const [deleteTarget, setDeleteTarget] = useState<SavedComparison>();
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  return (
    <>
      <details className="text-sm">
        <summary className="cursor-pointer">{t("Saved comparisons")}</summary>
        <div className="max-h-48 overflow-y-auto space-y-2 py-2">
          {history.isPending ? (
            <p>{t("Loading…")}</p>
          ) : history.isError ? (
            <p role="alert">{t("Could not load saved comparisons.")}</p>
          ) : !history.data?.length ? (
            <p>{t("No saved comparisons yet.")}</p>
          ) : (
            history.data?.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-1 rounded-md border pr-1 hover:bg-muted"
              >
                <Link
                  href={`/compare/${entry.id}`}
                  aria-current={activeId === entry.id ? "page" : undefined}
                  className="block min-w-0 flex-1 px-3 py-2"
                  onClick={(event) => {
                    if (locked) event.preventDefault();
                  }}
                >
                  <span className="block truncate">{entry.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {entry.leftName} / {entry.rightName}
                  </span>
                </Link>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={t("Delete comparison: {title}", { title: entry.title })}
                  title={t("Delete comparison")}
                  disabled={locked}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setDeleteTarget(entry);
                    setIsDeleteOpen(true);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </details>
      <DeleteComparisonDialog
        comparison={deleteTarget}
        open={isDeleteOpen}
        onOpenChange={setIsDeleteOpen}
        onDeleted={onDeleted}
      />
    </>
  );
}
