import { useFumadocsLoader } from 'fumadocs-core/source/client';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import type { ReactNode } from 'react';
import type { Language } from '@/lib/i18n';
import { baseOptions } from '@/lib/layout.shared';
import type { loadPageTree } from '@/lib/page-tree';

/** Docs-style page for the support forms, with the help center sidebar. */
export function SupportPage({
  lang,
  data,
  title,
  description,
  children,
}: {
  lang: Language;
  data: Awaited<ReturnType<typeof loadPageTree>>;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const { pageTree } = useFumadocsLoader(data);

  return (
    <DocsLayout {...baseOptions(lang)} tree={pageTree}>
      <DocsPage toc={[]}>
        <DocsTitle>{title}</DocsTitle>
        <DocsDescription>{description}</DocsDescription>
        <DocsBody>{children}</DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
