import { useParams } from '@tanstack/react-router';
import { baseOptions } from '@/lib/layout.shared';
import { resolveLanguage } from '@/lib/i18n';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { DefaultNotFound } from 'fumadocs-ui/layouts/home/not-found';

export function NotFound() {
  const lang = resolveLanguage(useParams({ strict: false }).lang);

  return (
    <HomeLayout {...baseOptions(lang)}>
      <DefaultNotFound />
    </HomeLayout>
  );
}
