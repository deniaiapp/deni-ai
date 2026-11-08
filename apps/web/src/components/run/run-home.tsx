import { Bot, ExternalLink } from "lucide-react";
import { useExtracted } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@deniai/ui/components/empty";
import { DocumentTitle } from "@/components/document-title";
import { clientEnv } from "@/public-env";

/** Run mode home. Points to the standalone Deni Run until it moves into this app. */
export function RunHome() {
  const t = useExtracted();

  return (
    <>
      <DocumentTitle title={t("Run")} />
      <div className="flex flex-1 items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Bot />
            </EmptyMedia>
            <EmptyTitle>{t("Deni Run is coming to this app")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "Hand work to AI teammates that finish it on their own computer. Until Run is ready here, keep using the standalone app.",
              )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              render={
                <a href={clientEnv.NEXT_PUBLIC_DENI_RUN_URL} target="_blank" rel="noreferrer" />
              }
              nativeButton={false}
            >
              {t("Open Deni Run")}
              <ExternalLink className="size-4" />
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    </>
  );
}
