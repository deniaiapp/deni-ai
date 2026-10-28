import { Eye } from "lucide-react";
import { useExtracted } from "use-intl";
import { useRef } from "react";
import { BlogMarkdown } from "@/components/blog/blog-markdown";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { slugifyBlogTitle } from "@/lib/blog/slug";

export type BlogEditorDraft = {
  slug: string;
  title: string;
  description: string;
  body: string;
  titleJa: string;
  descriptionJa: string;
  bodyJa: string;
  author: string;
};

export function BlogEditorFields({
  draft,
  lockSlugInitially,
  localeTab,
  mode,
  onDraftChange,
  onLocaleTabChange,
  onModeChange,
}: {
  draft: BlogEditorDraft;
  lockSlugInitially: boolean;
  localeTab: string;
  mode: string;
  onDraftChange: (updater: (current: BlogEditorDraft) => BlogEditorDraft) => void;
  onLocaleTabChange: (value: string) => void;
  onModeChange: (value: string) => void;
}) {
  const t = useExtracted();
  const slugTouchedRef = useRef(lockSlugInitially);
  const previewMarkdown = localeTab === "ja" ? draft.bodyJa || draft.body : draft.body;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="blog-title">{t("Title")}</Label>
        <Input
          id="blog-title"
          value={draft.title}
          placeholder={t("How to keep AI chats useful after the first week")}
          onChange={(event) => {
            const title = event.target.value;
            onDraftChange((current) => ({
              ...current,
              title,
              slug: slugTouchedRef.current ? current.slug : slugifyBlogTitle(title),
            }));
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="blog-slug">{t("Slug")}</Label>
          <Input
            id="blog-slug"
            value={draft.slug}
            placeholder={t("keep-ai-chats-useful")}
            onChange={(event) => {
              slugTouchedRef.current = true;
              onDraftChange((current) => ({ ...current, slug: event.target.value }));
            }}
          />
          <p className="text-xs text-muted-foreground">/blog/{draft.slug || t("your-slug")}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="blog-author">{t("Author")}</Label>
          <Input
            id="blog-author"
            value={draft.author}
            onChange={(event) =>
              onDraftChange((current) => ({ ...current, author: event.target.value }))
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="blog-description">{t("Excerpt")}</Label>
        <Textarea
          id="blog-description"
          value={draft.description}
          className="min-h-20"
          placeholder={t("One or two sentences shown on the blog index and in search results.")}
          onChange={(event) =>
            onDraftChange((current) => ({ ...current, description: event.target.value }))
          }
        />
      </div>

      <Tabs value={localeTab} onValueChange={onLocaleTabChange}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="en">{t("English")}</TabsTrigger>
            <TabsTrigger value="ja">{t("Japanese")}</TabsTrigger>
          </TabsList>
          <Tabs value={mode} onValueChange={onModeChange}>
            <TabsList>
              <TabsTrigger value="write">{t("Write")}</TabsTrigger>
              <TabsTrigger value="preview">
                <Eye className="size-3.5" />
                {t("Preview")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <TabsContent value="en" className="mt-4 space-y-3">
          {mode === "preview" ? (
            <div className="rounded-2xl border border-border bg-card p-5">
              <BlogMarkdown markdown={draft.body} />
            </div>
          ) : (
            <Textarea
              value={draft.body}
              className="min-h-80 font-mono text-sm"
              placeholder={t("Write in Markdown. Use ## headings, lists, and links.")}
              onChange={(event) =>
                onDraftChange((current) => ({ ...current, body: event.target.value }))
              }
            />
          )}
        </TabsContent>

        <TabsContent value="ja" className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="blog-title-ja">{t("Japanese title")}</Label>
            <Input
              id="blog-title-ja"
              value={draft.titleJa}
              onChange={(event) =>
                onDraftChange((current) => ({ ...current, titleJa: event.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="blog-description-ja">{t("Japanese excerpt")}</Label>
            <Textarea
              id="blog-description-ja"
              value={draft.descriptionJa}
              className="min-h-20"
              onChange={(event) =>
                onDraftChange((current) => ({ ...current, descriptionJa: event.target.value }))
              }
            />
          </div>
          {mode === "preview" ? (
            <div className="rounded-2xl border border-border bg-card p-5">
              <BlogMarkdown markdown={previewMarkdown} />
            </div>
          ) : (
            <Textarea
              value={draft.bodyJa}
              className="min-h-80 font-mono text-sm"
              placeholder={t("Optional Japanese Markdown. English is used if this is empty.")}
              onChange={(event) =>
                onDraftChange((current) => ({ ...current, bodyJa: event.target.value }))
              }
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
