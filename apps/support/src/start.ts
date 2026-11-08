import { createMiddleware, createCsrfMiddleware, createStart } from '@tanstack/react-start';
import { isMarkdownPreferred } from 'fumadocs-core/negotiation';
import { redirect } from '@tanstack/react-router';
import { detectLanguage, isLanguage } from '@/lib/i18n';
import { getPageMarkdownUrl } from '@/lib/shared';

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
});

const localeMiddleware = createMiddleware().server(({ next, request }) => {
  const url = new URL(request.url);
  if (url.pathname !== '/') return next();

  const lang = detectLanguage(request.headers.get('accept-language')?.split(',') ?? []);
  url.pathname = `/${lang}`;
  throw redirect({ href: url.href, headers: { Vary: 'Accept-Language' } });
});

const llmMiddleware = createMiddleware().server(({ next, request }) => {
  const url = new URL(request.url);
  const [lang, ...rest] = url.pathname.split('/').filter((v) => v.length > 0);

  if (
    isLanguage(lang) &&
    // The OG images and support forms have no Markdown version.
    !['og', 'contact', 'feedback'].includes(rest[0] ?? '') &&
    !url.pathname.endsWith('.md') &&
    isMarkdownPreferred(request)
  ) {
    url.pathname = getPageMarkdownUrl({ slugs: rest, locale: lang }).url;

    // this URL has two representations, selected by `Accept`
    throw redirect({ href: url.href, headers: { Vary: 'Accept' } });
  }

  return next();
});

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [csrfMiddleware, localeMiddleware, llmMiddleware],
  };
});
