import { useExtracted } from "@/i18n/react";
import { CaretRightIcon, SparkleIcon, WarningIcon } from "@phosphor-icons/react";
import { MessageResponse } from "@/components/ai-elements/message";
import { ConnectorLogo } from "./connector-logos";
import {
  isMcpBodyArgument,
  mcpArgumentTitle,
  mcpArgumentValue,
  mcpToolKind,
  mcpToolTitle,
  useMcpExplanation,
  useMcpToolDescription,
} from "./mcp-tool-labels";

/**
 * What an MCP call is about to do, for someone who is not a developer: whether it reads or
 * changes data, a plain-language explanation from the summary model, and the text it will
 * write. The tool's own description and raw arguments stay under "Technical details".
 */
export function McpApprovalDetails({
  connectionId,
  tool,
  args,
  explain = true,
}: {
  connectionId?: string;
  tool?: string;
  args?: Record<string, unknown>;
  /**
   * Off for answered approvals: each explanation is a model call, and history can hold many. One
   * already loaded on this page is still shown.
   */
  explain?: boolean;
}) {
  const t = useExtracted();
  const described = useMcpToolDescription(connectionId, tool, args);
  const explanation = useMcpExplanation(connectionId, tool, args, { request: explain });
  const service = described?.connection.name ?? t("a connected app");
  const definition = described?.tool;
  const names = described?.names ?? {};
  const title = definition?.title || (tool ? mcpToolTitle(tool, described?.connection.name) : "");
  const kind = mcpToolKind(tool ?? "");
  const headline =
    kind === "write"
      ? t("Wants to change data in {service}", { service })
      : kind === "read"
        ? t("Wants to look up data in {service}", { service })
        : t("Wants to use {service}", { service });
  const entries = Object.entries(args ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== "");
  const fields = entries.filter(([key, value]) => !isMcpBodyArgument(key, value));
  const bodies = entries.filter(([key, value]) => isMcpBodyArgument(key, value)) as [string, string][];
  // A named ID reads as what it is: "Channel ID" becomes "Channel" once it shows "#general".
  const label = (key: string) =>
    definition?.arguments[key]?.title || mcpArgumentTitle(names[key] ? key.replace(/[_-]?ids?$/i, "") || key : key);
  const firstParagraph = definition?.description?.trim().split(/\n\s*\n/)[0];
  const summary = firstParagraph?.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? firstParagraph;

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        {described?.connection.catalogId ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised ring-1 ring-foreground/10">
            <ConnectorLogo id={described.connection.catalogId} className="size-4.5" aria-hidden />
          </span>
        ) : null}
        <div className="grid min-w-0 gap-1">
          <p className="font-semibold">{headline}</p>
          {explanation === undefined ? (
            <p className="animate-pulse text-sm text-muted-foreground">{t("Checking what this will do…")}</p>
          ) : explanation ? (
            <p className="flex gap-1.5 text-sm">
              <SparkleIcon weight="fill" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label={t("Explained by AI")} />
              <span>{explanation}</span>
            </p>
          ) : null}
        </div>
      </div>
      {definition?.destructive ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive-300">
          <WarningIcon weight="fill" className="size-3.5 shrink-0" />
          {t("This can change or delete data in {service}, and it may not be possible to undo.", { service })}
        </p>
      ) : null}
      {bodies.map(([key, value]) => (
        <div key={key} className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">{label(key)}</p>
          <div className="max-h-80 overflow-auto rounded-lg border border-foreground/10 bg-surface-raised p-3 text-sm">
            <MessageResponse>{value}</MessageResponse>
          </div>
        </div>
      ))}
      {fields.length > 0 || summary ? (
        <details className="group text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <CaretRightIcon className="size-3 transition-transform group-open:rotate-90" />
            {t("Technical details")}
          </summary>
          <div className="mt-2 grid gap-2">
            {title || summary ? (
              <p className="text-xs text-muted-foreground">
                {title ? <span className="font-medium text-foreground">{title}</span> : null}
                {title && summary ? " · " : null}
                {summary}
              </p>
            ) : null}
            {fields.length > 0 ? (
              <dl className="grid gap-x-4 gap-y-1.5 rounded-lg bg-foreground/5 p-3 text-sm sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)]">
                {fields.map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="text-xs text-muted-foreground sm:text-sm" title={definition?.arguments[key]?.description ?? undefined}>{label(key)}</dt>
                    <dd className="mb-1.5 min-w-0 break-words last:mb-0 sm:mb-0">
                      {names[key] ? (
                        <>
                          <span className="font-medium">{names[key]}</span>{" "}
                          <span className="font-mono text-xs text-muted-foreground">{mcpArgumentValue(value)}</span>
                        </>
                      ) : value && typeof value === "object" && !Array.isArray(value) ? (
                        // Nested settings read better indented than on one line.
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>
                      ) : (
                        <span className="font-mono text-xs">{mcpArgumentValue(value)}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
