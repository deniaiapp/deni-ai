import { createFileRoute, redirect } from '@tanstack/react-router';
import { detectLanguage, i18n } from '@/lib/i18n';

// Server requests for `/` are redirected by `src/start.ts` using `Accept-Language`;
// this covers client-side navigation.
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const lang =
      typeof navigator === 'undefined'
        ? i18n.defaultLanguage
        : detectLanguage(navigator.languages ?? [navigator.language]);
    throw redirect({ to: '/$lang/$', params: { lang, _splat: '' } });
  },
});
