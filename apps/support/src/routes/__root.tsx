import { createRootRoute, HeadContent, Outlet, Scripts, useParams } from '@tanstack/react-router';
import * as React from 'react';
import appCss from '@/styles/app.css?url';
import { RootProvider } from 'fumadocs-ui/provider/tanstack';
import { i18nProvider } from 'fumadocs-ui/i18n';
import { resolveLanguage } from '@/lib/i18n';
import { translations } from '@/lib/layout.shared';
import { appName } from '@/lib/shared';
import { getSupportConfig } from '@/lib/support-config';
import { SupportConfigProvider } from '@/components/support-config';
import { SupportWidget } from '@/components/support-widget';

export const Route = createRootRoute({
  // Server configuration doesn't change while the page is open.
  loader: () => getSupportConfig(),
  staleTime: Infinity,
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: appName,
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  const lang = resolveLanguage(useParams({ strict: false }).lang);
  const supportConfig = Route.useLoaderData();

  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body className="flex flex-col min-h-screen">
        <RootProvider i18n={i18nProvider(translations, lang)}>
          <SupportConfigProvider value={supportConfig}>
            <Outlet />
            <SupportWidget lang={lang} />
          </SupportConfigProvider>
        </RootProvider>
        <Scripts />
      </body>
    </html>
  );
}
