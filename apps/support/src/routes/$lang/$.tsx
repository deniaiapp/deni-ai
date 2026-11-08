import { createFileRoute, notFound } from '@tanstack/react-router';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { createServerFn } from '@tanstack/react-start';
import { docs, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
} from 'fumadocs-ui/layouts/docs/page';
import { ViewOptionsPopover } from '@/components/page-actions';
import { PageFeedback } from '@/components/support-forms';
import { baseOptions } from '@/lib/layout.shared';
import { isLanguage, resolveLanguage, type Language } from '@/lib/i18n';
import { appName, getPageImageUrl, getPageMarkdownUrl, siteUrl } from '@/lib/shared';
import { useFumadocsLoader } from 'fumadocs-core/source/client';
import { Suspense, use } from 'react';
import { useMDXComponents } from '@/components/mdx';

export const Route = createFileRoute('/$lang/$')({
  component: Page,
  loader: async ({ params }) => {
    if (!isLanguage(params.lang)) throw notFound();

    const slugs = params._splat?.split('/').filter((v) => v.length > 0) ?? [];
    const data = await serverLoader({ data: { slugs, lang: params.lang } });
    await docs.getPage(data.path)?.preload();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [] };
    const title = loaderData.slugs.length === 0 ? appName : `${loaderData.title} | ${appName}`;
    const description = loaderData.description;

    return {
      meta: [
        { title },
        ...(description ? [{ name: 'description', content: description }] : []),
        // Link previews need absolute URLs.
        { property: 'og:title', content: title },
        ...(description ? [{ property: 'og:description', content: description }] : []),
        { property: 'og:url', content: `${siteUrl}${loaderData.url}` },
        { property: 'og:site_name', content: appName },
        { property: 'og:type', content: 'article' },
        { property: 'og:image', content: `${siteUrl}${loaderData.imageUrl}` },
        { name: 'twitter:card', content: 'summary_large_image' },
      ],
    };
  },
});

const serverLoader = createServerFn({
  method: 'GET',
})
  .validator((data: { slugs: string[]; lang: string }) => data)
  .handler(async ({ data: { slugs, lang } }) => {
    const page = source.getPage(slugs, lang);
    if (!page) throw notFound();

    return {
      path: page.path,
      url: page.url,
      slugs: page.slugs,
      title: page.data.title,
      description: page.data.description,
      markdownUrl: getPageMarkdownUrl(page).url,
      imageUrl: getPageImageUrl(page).url,
      pageTree: await source.serializePageTree(source.getPageTree(lang)),
    };
  });

function Content({
  lang,
  path,
  markdownUrl,
}: {
  lang: Language;
  path: string;
  markdownUrl: string;
}) {
  const page = docs.getPage(path);
  if (!page) throw new Error(`unknown page: ${path}`);

  const { toc } = use(page.load());
  const MDX = page.body;

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.title}</DocsTitle>
      <DocsDescription>{page.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover lang={lang} markdownUrl={markdownUrl} />
      </div>
      <DocsBody>
        <MDX components={useMDXComponents()} />
        <PageFeedback key={path} lang={lang} />
      </DocsBody>
    </DocsPage>
  );
}

function Page() {
  const lang = resolveLanguage(Route.useParams().lang);
  const { path, pageTree, markdownUrl } = useFumadocsLoader(Route.useLoaderData());

  return (
    <DocsLayout {...baseOptions(lang)} tree={pageTree}>
      <Suspense>
        <Content lang={lang} path={path} markdownUrl={markdownUrl} />
      </Suspense>
    </DocsLayout>
  );
}
