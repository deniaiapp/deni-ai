import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getExtracted, getLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { MotionProvider } from "@/components/motion";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getExtracted();
  return {
    title: "Deni Run",
    description: t("AI teammates with an isolated computer for every account."),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full overflow-hidden bg-background text-foreground tracking-tight">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NextIntlClientProvider>
            <MotionProvider>{children}</MotionProvider>
            <LocaleSwitcher />
            <ThemeToggle />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
