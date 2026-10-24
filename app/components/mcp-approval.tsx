import { useExtracted } from "@/i18n/react";
import { WarningIcon } from "@phosphor-icons/react";
import { MessageResponse } from "@/components/ai-elements/message";
import { ConnectorLogo } from "./connector-logos";
import {
  isMcpBodyArgument,
  mcpArgumentTitle,
  mcpArgumentValue,
  mcpToolTitle,
  useMcpToolDescription,
} from "./mcp-tool-labels";

/**
 * What an MCP call is about to do, in the tool's own words: "Wants to send message in Slack",
 * where it goes (IDs named where the connector can look them up), and the text it will write.
 */
export function McpApprovalDetails({ connectionId, tool, args }: { connectionId?: string; tool?: string; args?: Record<string, unknown> }) {
  const t = useExtracted();
  const described = useMcpToolDescription(connectionId, tool, args);
  const service = described?.connection.name ?? t("a connected app");
  const definition = described?.tool;
  const names = described?.names ?? {};
  const title = definition?.title || (tool ? mcpToolTitle(tool, described?.connection.name) : "");
  const action = title ? title.charAt(0).toLowerCase() + title.slice(1) : t("run a tool");
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
      <div className="flex items-center gap-3">
        {described?.connection.catalogId ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-raised ring-1 ring-foreground/10">
            <ConnectorLogo id={described.connection.catalogId} className="size-4.5" aria-hidden />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="font-semibold">{t("Wants to {action} in {service}", { action, service })}</p>
          {summary ? <p className="text-xs text-muted-foreground">{summary}</p> : null}
        </div>
      </div>
      {definition?.destructive ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive-300">
          <WarningIcon weight="fill" className="size-3.5 shrink-0" />
          {t("This may delete or overwrite data in {service}.", { service })}
        </p>
      ) : null}
      {fields.length > 0 ? (
        <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg bg-foreground/5 p-3 text-sm">
          {fields.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="text-muted-foreground" title={definition?.arguments[key]?.description ?? undefined}>{label(key)}</dt>
              <dd className="min-w-0 break-words">
                {names[key] ? (
                  <>
                    <span className="font-medium">{names[key]}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">{mcpArgumentValue(value)}</span>
                  </>
                ) : (
                  <span className="font-mono text-xs">{mcpArgumentValue(value)}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {bodies.map(([key, value]) => (
        <div key={key} className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">{label(key)}</p>
          <div className="max-h-80 overflow-auto rounded-lg border border-foreground/10 bg-surface-raised p-3 text-sm">
            <MessageResponse>{value}</MessageResponse>
          </div>
        </div>
      ))}
    </div>
  );
}
