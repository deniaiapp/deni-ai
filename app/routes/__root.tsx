import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/inter";
import { MotionProvider } from "@/components/motion";
import { ThemeProvider } from "@/components/theme-provider";
import { getRequestIntl } from "@/i18n/functions";
import { headTranslator } from "@/i18n/head";
import { loadMessages } from "@/i18n/messages";
import "../globals.css";

export const Route = createRootRoute({
  loader: async () => {
    const { locale, timeZone } = await getRequestIntl();
    return { locale, timeZone, messages: await loadMessages(locale) };
  },
  // The locale only changes through the language menus, which invalidate the router.
  staleTime: Infinity,
  head: ({ matches }) => {
    const t = headTranslator(matches);
    const description = t("AI teammates with an isolated computer for every account.");
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: "Deni Run" },
        { name: "application-name", content: "Deni Run" },
        { name: "description", content: description },
        { property: "og:description", content: description },
        { property: "og:site_name", content: "Deni Run" },
        { property: "og:title", content: "Deni Run" },
        { property: "og:type", content: "website" },
      ],
      links: [
        { rel: "icon", href: "/favicon.ico", sizes: "any" },
        { rel: "icon", href: "/icon.png", type: "image/png", sizes: "192x192" },
        { rel: "apple-touch-icon", href: "/apple-icon.png", sizes: "180x180" },
      ],
    };
  },
  component: RootComponent,
});

function RootComponent() {
  const { locale, timeZone, messages } = Route.useLoaderData();
  return (
    <RootDocument lang={locale}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <IntlProvider locale={locale} timeZone={timeZone} messages={messages}>
          <MotionProvider>
            <Outlet />
          </MotionProvider>
        </IntlProvider>
      </ThemeProvider>
    </RootDocument>
  );
}

function RootDocument({ lang, children }: { lang: string; children: ReactNode }) {
  return (
    <html lang={lang} suppressHydrationWarning className="h-full antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="h-full overflow-hidden bg-background text-foreground tracking-tight">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
