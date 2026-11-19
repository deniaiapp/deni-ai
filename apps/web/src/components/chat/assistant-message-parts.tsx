import type { UIDataTypes, UIMessagePart, UITools } from "ai";
import { BrainIcon, Globe, ImageOffIcon, VideoOffIcon } from "lucide-react";
import { Link } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtSearchResult,
  ChainOfThoughtSearchResults,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Source, Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import {
  isBrowseToolInput,
  isBrowseToolOutput,
  isSearchResultArray,
} from "@/components/chat/chat-utils";
import { getSafeDisplayUrl, toSafeHref } from "@/lib/safe-href";

interface AssistantMessageChainOfThoughtProps {
  messageId: string;
  reasoningParts: UIMessagePart<UIDataTypes, UITools>[];
  isStreamingThis: boolean;
  hasTextParts: boolean;
}

export function AssistantMessageChainOfThought({
  messageId,
  reasoningParts,
  isStreamingThis,
  hasTextParts,
}: AssistantMessageChainOfThoughtProps) {
  const t = useExtracted();

  if (reasoningParts.length === 0) {
    return null;
  }

  return (
    <ChainOfThought defaultOpen={isStreamingThis}>
      <ChainOfThoughtHeader>
        {isStreamingThis && !hasTextParts ? (
          <Shimmer duration={2}>{t("Thinking...")}</Shimmer>
        ) : (
          t("Thought process")
        )}
      </ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {reasoningParts.map((part) => {
          if (part.type === "reasoning") {
            const lines = (part.text ?? "").replace(/\r\n?/g, "\n").split("\n");
            const titleRegex = /^\*\*(.+?)\*\*\s*$/;

            type Section = {
              title: string;
              content: string[];
            };
            const sections: Section[] = [];

            let currentTitle: string | null = null;
            let currentContent: string[] = [];

            const flush = () => {
              if (currentTitle === null && currentContent.length === 0) return;

              sections.push({
                title: (currentTitle ?? t("Reasoning")).trim() || t("Reasoning"),
                content: currentContent,
              });

              currentTitle = null;
              currentContent = [];
            };

            for (const rawLine of lines) {
              const line = rawLine;
              const trimmed = line.trim();
              const m = trimmed.match(titleRegex);

              if (m) {
                flush();
                currentTitle = m[1];
              } else {
                currentContent.push(line);
              }
            }
            flush();

            if (sections.length === 0) {
              sections.push({
                title: t("Reasoning"),
                content: [],
              });
            }

            return sections.map((s) => {
              const content = s.content.join("\n").trim();
              return (
                <ChainOfThoughtStep
                  key={`${messageId}-cot-${s.title}-${content.slice(0, 32)}`}
                  icon={BrainIcon}
                  label={s.title || t("Reasoning")}
                  description={content || t("No details")}
                  className="whitespace-pre-wrap"
                  status="complete"
                />
              );
            });
          }

          if (part.type === "tool-search") {
            const isSearching = part.state !== "output-available" && part.state !== "output-error";
            const searchResults = isSearchResultArray(part.output) ? part.output : [];
            const searchKey =
              part.toolCallId ??
              `${messageId}-search-${part.state}-${searchResults[0]?.url ?? "empty"}`;
            return (
              <ChainOfThoughtStep
                key={searchKey}
                icon={Globe}
                label={
                  isSearching ? (
                    <Shimmer duration={2}>{t("Searching...")}</Shimmer>
                  ) : part.state === "output-error" ? (
                    t("Search failed")
                  ) : (
                    t("Found {count} results", {
                      count: searchResults.length.toString(),
                    })
                  )
                }
                status={isSearching ? "active" : "complete"}
              >
                {searchResults.length > 0 && (
                  <ChainOfThoughtSearchResults>
                    {searchResults.map((result) => {
                      const displayUrl = getSafeDisplayUrl(result.url);
                      return (
                        <Link
                          key={result.url}
                          href={displayUrl?.href ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ChainOfThoughtSearchResult>
                            <Globe className="size-3" />
                            {displayUrl?.hostname ?? t("Unknown")}
                          </ChainOfThoughtSearchResult>
                        </Link>
                      );
                    })}
                  </ChainOfThoughtSearchResults>
                )}
              </ChainOfThoughtStep>
            );
          }

          if (part.type === "tool-browse") {
            const isBrowsing = part.state !== "output-available" && part.state !== "output-error";
            const browseOutput = isBrowseToolOutput(part.output) ? part.output : null;
            const browseInput = isBrowseToolInput(part.input) ? part.input : null;
            const browseUrl = browseOutput?.url ?? browseInput?.url ?? "";
            const displayUrl = getSafeDisplayUrl(browseUrl);
            const browseKey =
              part.toolCallId ?? `${messageId}-browse-${part.state}-${browseUrl || "empty"}`;
            const failed =
              part.state === "output-error" ||
              Boolean(browseOutput?.error && !browseOutput.content);

            return (
              <ChainOfThoughtStep
                key={browseKey}
                icon={Globe}
                label={
                  isBrowsing ? (
                    <Shimmer duration={2}>{t("Opening page...")}</Shimmer>
                  ) : failed ? (
                    t("Failed to open page")
                  ) : (
                    t("Opened page")
                  )
                }
                status={isBrowsing ? "active" : "complete"}
              >
                {displayUrl && (
                  <ChainOfThoughtSearchResults>
                    <Link href={displayUrl.href} target="_blank" rel="noreferrer">
                      <ChainOfThoughtSearchResult>
                        <Globe className="size-3" />
                        {browseOutput?.title?.trim() || displayUrl.hostname}
                      </ChainOfThoughtSearchResult>
                    </Link>
                  </ChainOfThoughtSearchResults>
                )}
              </ChainOfThoughtStep>
            );
          }
          return null;
        })}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

interface AssistantMessageRetiredToolNoticesProps {
  showImageNotice: boolean;
  showVideoNotice: boolean;
}

// Image and video generation were retired; saved chats show one notice per message instead.
export function AssistantMessageRetiredToolNotices({
  showImageNotice,
  showVideoNotice,
}: AssistantMessageRetiredToolNoticesProps) {
  const t = useExtracted();

  return (
    <>
      {showVideoNotice && (
        <Message from="assistant">
          <MessageContent className="w-full rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <VideoOffIcon className="size-4 shrink-0" />
              <span>{t("Video generation is no longer available.")}</span>
            </div>
          </MessageContent>
        </Message>
      )}
      {showImageNotice && (
        <Message from="assistant">
          <MessageContent className="w-full rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ImageOffIcon className="size-4 shrink-0" />
              <span>{t("Image generation is no longer available.")}</span>
            </div>
          </MessageContent>
        </Message>
      )}
    </>
  );
}

interface AssistantMessageSourcesProps {
  messageId: string;
  sourceParts: Extract<UIMessagePart<UIDataTypes, UITools>, { type: "source-url" }>[];
}

export function AssistantMessageSources({ messageId, sourceParts }: AssistantMessageSourcesProps) {
  const t = useExtracted();

  if (sourceParts.length === 0) {
    return null;
  }

  return (
    <Sources className="mt-2">
      <SourcesTrigger count={sourceParts.length}>{t("Sources")}</SourcesTrigger>
      <SourcesContent>
        {sourceParts.map((part) => (
          <Source
            key={part.url || part.title || messageId}
            href={toSafeHref(part.url)}
            title={part.title || part.url || t("Source")}
          />
        ))}
      </SourcesContent>
    </Sources>
  );
}
