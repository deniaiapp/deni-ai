import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  ScriptOnce,
  useRouteContext,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { IntlProvider, useExtracted } from "use-intl";
import { ErrorPage } from "@/components/error-page";
import { NotFoundPage } from "@/components/not-found-page";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { getPreferredLocale, localeFromPathname } from "@/i18n/locale";
import { defaultLocale } from "@/i18n/locales";
import { loadMessages, primeMessages } from "@/i18n/messages";
import { GA_ID } from "@/lib/constants";
import { getPlatformCapabilitiesFn } from "@/lib/platform-capabilities-functions";
import { HOME_ALTERNATE_NAMES, HOME_DESCRIPTION, HOME_TITLE, safeJsonLd } from "@/lib/seo";
import { SIDEBAR_WIDTH_BOOT_SCRIPT } from "@/lib/sidebar-width";
import appCss from "@/styles/globals.css?url";
import themesCss from "@/styles/themes.css?url";

const SITE_URL = "https://deniai.app";
const OG_IMAGE = `${SITE_URL}/og.png`;

const GA_INIT_SCRIPT = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(GA_ID)});`;

const SITE_JSON_LD = [
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Deni AI",
    alternateName: [...HOME_ALTERNATE_NAMES],
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/new/{search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  },
  {
    "@context": "https://schema.org",
    "@type": "SiteNavigationElement",
    name: [
      "About",
      "Use Cases",
      "AI Models",
      "Desktop App",
      "Flixa",
      "FAQ",
      "Terms of Service",
      "Privacy Policy",
    ],
    url: [
      `${SITE_URL}/about`,
      `${SITE_URL}/use-cases`,
      `${SITE_URL}/models`,
      `${SITE_URL}/desktop`,
      `${SITE_URL}/flixa`,
      `${SITE_URL}/faq`,
      `${SITE_URL}/legal/terms`,
      `${SITE_URL}/legal/privacy-policy`,
    ],
  },
];

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    const locale = localeFromPathname(location.pathname) ?? getPreferredLocale();
    return { intl: { locale, messages: await loadMessages(locale) } };
  },
  // Server env decides these; one fetch per page load is enough.
  loader: () => getPlatformCapabilitiesFn(),
  staleTime: Number.POSITIVE_INFINITY,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: HOME_TITLE },
      { name: "description", content: HOME_DESCRIPTION },
      { name: "application-name", content: "Deni AI" },
      {
        name: "keywords",
        content:
          "Deni AI,Deni Chat,denichat,AI chat,ChatGPT alternative,Claude,Gemini,free AI chat,multi-model AI",
      },
      { name: "author", content: "Deni AI" },
      { name: "creator", content: "Deni AI" },
      { name: "publisher", content: "Deni AI" },
      { name: "format-detection", content: "telephone=no, address=no, email=no" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Deni AI" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "robots", content: "index, follow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Deni AI" },
      { property: "og:title", content: HOME_TITLE },
      { property: "og:description", content: HOME_DESCRIPTION },
      { property: "og:locale", content: "en_US" },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "800" },
      { property: "og:image:height", content: "600" },
      { property: "og:image:alt", content: "Deni AI" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: HOME_TITLE },
      { name: "twitter:description", content: HOME_DESCRIPTION },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: themesCss },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/icon.png", type: "image/png" },
      { rel: "icon", href: "/pwa/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { rel: "icon", href: "/pwa/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-icon.png" },
      { rel: "apple-touch-icon", href: "/pwa/apple-touch-icon.png", sizes: "180x180" },
    ],
    scripts:
      process.env.NODE_ENV === "production"
        ? [
            { src: `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`, async: true },
            { children: GA_INIT_SCRIPT },
          ]
        : [],
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  errorComponent: ErrorPage,
  notFoundComponent: NotFoundPage,
});

function SkipToContent() {
  const t = useExtracted();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {t("Skip to content")}
    </a>
  );
}

function RootComponent() {
  return (
    <>
      <SkipToContent />
      <div className="min-h-screen">
        <Outlet />
      </div>
    </>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  // Absent only when the root beforeLoad itself failed; render the error page in English.
  const intl = useRouteContext({ from: "__root__", select: (context) => context.intl });
  const locale = intl?.locale ?? defaultLocale;
  const messages = intl?.messages ?? {};
  if (intl) {
    primeMessages(intl.locale, intl.messages);
  }

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#171717" />
        <HeadContent />
      </head>
      <body className="font-sans antialiased min-w-full min-h-screen overflow-x-hidden transition-colors duration-500">
        {/* Restores the resized sidebar width before first paint. */}
        <ScriptOnce>{SIDEBAR_WIDTH_BOOT_SCRIPT}</ScriptOnce>
        <script
          type="application/ld+json"
          // Static module constant: no request data reaches this sink.
          dangerouslySetInnerHTML={{ __html: safeJsonLd(SITE_JSON_LD) }}
        />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {/* A fixed time zone keeps server and browser output identical; the app
              formats dates with its own helpers, not use-intl. */}
          <IntlProvider locale={locale} messages={messages} timeZone="UTC">
            {children}
          </IntlProvider>
          <Toaster position="top-center" />
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
