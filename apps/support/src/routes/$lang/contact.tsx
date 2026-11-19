import { createFileRoute, redirect } from '@tanstack/react-router';
import { resolveLanguage } from '@/lib/i18n';
import { isContactCategory } from '@/lib/support-protocol';

// The contact form lives in the support widget. This URL (linked from articles and
// elsewhere) opens it on the help center home; the widget reads `?support=`.
export const Route = createFileRoute('/$lang/contact')({
  beforeLoad: ({ params, search }) => {
    const query = new URLSearchParams({ support: 'contact' });
    const category = (search as Record<string, unknown>).category;
    if (isContactCategory(category)) query.set('category', category);
    throw redirect({ href: `/${resolveLanguage(params.lang)}?${query}` });
  },
});
