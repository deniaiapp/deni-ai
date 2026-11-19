import { createFileRoute, redirect } from '@tanstack/react-router';
import { feedbackTemplateParams } from '@/lib/feedback-templates';
import { resolveLanguage } from '@/lib/i18n';

// The feedback form lives in the support widget. This URL opens it on the help
// center home; the widget reads `?support=` and, from app links, `?from=` and
// `?version=` (see `@/lib/feedback-templates`).
export const Route = createFileRoute('/$lang/feedback')({
  beforeLoad: ({ params, location }) => {
    const incoming = new URLSearchParams(location.searchStr);
    const search = new URLSearchParams({ support: 'feedback' });
    for (const key of feedbackTemplateParams) {
      const value = incoming.get(key);
      if (value) search.set(key, value);
    }
    throw redirect({ href: `/${resolveLanguage(params.lang)}?${search.toString()}` });
  },
});
