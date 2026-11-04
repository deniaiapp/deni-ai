import { createFileRoute, notFound } from '@tanstack/react-router';
import { FeedbackForm } from '@/components/support-forms';
import { SupportPage } from '@/components/support-page';
import { isLanguage, resolveLanguage, type Language } from '@/lib/i18n';
import { loadPageTree } from '@/lib/page-tree';
import { appName, siteUrl } from '@/lib/shared';

const copy = {
  en: {
    title: 'Send feedback',
    description:
      'Tell us what to improve in Deni AI, Flixa, or this help center. If you need a reply about a problem, use the contact form instead.',
  },
  ja: {
    title: 'フィードバックを送る',
    description:
      'Deni AI、Flixa、このヘルプセンターについて、改善してほしい点をお聞かせください。問題について返信が必要な場合は、お問い合わせフォームをご利用ください。',
  },
} satisfies Record<Language, unknown>;

export const Route = createFileRoute('/$lang/feedback')({
  loader: async ({ params }) => {
    if (!isLanguage(params.lang)) throw notFound();
    return loadPageTree({ data: { lang: params.lang } });
  },
  head: ({ params }) => {
    const t = copy[resolveLanguage(params.lang)];
    return {
      meta: [
        { title: `${t.title} | ${appName}` },
        { name: 'description', content: t.description },
        { property: 'og:title', content: `${t.title} | ${appName}` },
        { property: 'og:description', content: t.description },
        { property: 'og:url', content: `${siteUrl}/${params.lang}/feedback` },
        { property: 'og:site_name', content: appName },
      ],
    };
  },
  component: FeedbackPage,
});

function FeedbackPage() {
  const lang = resolveLanguage(Route.useParams().lang);
  const t = copy[lang];

  return (
    <SupportPage
      lang={lang}
      data={Route.useLoaderData()}
      title={t.title}
      description={t.description}
    >
      <FeedbackForm lang={lang} />
    </SupportPage>
  );
}
