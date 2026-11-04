import { createFileRoute, notFound } from '@tanstack/react-router';
import { ContactForm } from '@/components/support-forms';
import { SupportPage } from '@/components/support-page';
import { isLanguage, resolveLanguage, type Language } from '@/lib/i18n';
import { loadPageTree } from '@/lib/page-tree';
import { appName, siteUrl } from '@/lib/shared';

const copy = {
  en: {
    title: 'Contact support',
    description:
      'Send a message to the Deni AI team. For quick answers, try the help center or the AI assistant first.',
    email: 'You can also email',
  },
  ja: {
    title: 'お問い合わせ',
    description:
      'Deni AI チームにメッセージを送信します。すぐに解決したい場合は、ヘルプセンターや AI アシスタントもご利用ください。',
    email: 'メールでのお問い合わせ：',
  },
} satisfies Record<Language, unknown>;

export const Route = createFileRoute('/$lang/contact')({
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
        { property: 'og:url', content: `${siteUrl}/${params.lang}/contact` },
        { property: 'og:site_name', content: appName },
      ],
    };
  },
  component: ContactPage,
});

function ContactPage() {
  const lang = resolveLanguage(Route.useParams().lang);
  const t = copy[lang];

  return (
    <SupportPage
      lang={lang}
      data={Route.useLoaderData()}
      title={t.title}
      description={t.description}
    >
      <ContactForm lang={lang} />
      <p className="text-sm text-fd-muted-foreground">
        {t.email} <a href="mailto:contact@deniai.app">contact@deniai.app</a>
      </p>
    </SupportPage>
  );
}
