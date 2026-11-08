import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/inter";
import { MotionProvider } from "@/components/common/motion";
import { themeScript, ThemeProvider, useTheme } from "@/components/common/theme-provider";
import { getRequestIntl } from "@/i18n/functions";
import { headTranslator } from "@/i18n/head";
import { loadMessages } from "@/i18n/messages";
import { getThemePreference } from "@/lib/ui/theme";
import { cn } from "@/lib/utils";
import "@/styles/globals.css";

export const Route = createRootRoute({
  loader: async () => {
    const [{ locale, timeZone }, theme] = await Promise.all([getRequestIntl(), getThemePreference()]);
    return { locale, timeZone, theme, messages: await loadMessages(locale) };
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
  const { locale, timeZone, theme, messages } = Route.useLoaderData();
  return (
    <ThemeProvider initialTheme={theme}>
      <RootDocument lang={locale}>
        <IntlProvider locale={locale} timeZone={timeZone} messages={messages}>
          <MotionProvider>
            <Outlet />
          </MotionProvider>
        </IntlProvider>
      </RootDocument>
    </ThemeProvider>
  );
}

function RootDocument({ lang, children }: { lang: string; children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    // The class can differ during hydration when the system theme script added "dark".
    <html lang={lang} suppressHydrationWarning className={cn("h-full antialiased", resolvedTheme === "dark" && "dark")}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body className="h-full overflow-hidden bg-background text-foreground tracking-tight">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
