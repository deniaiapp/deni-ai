import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { AdSlot } from "@/components/ad-slot";
import { GuestSignInButton } from "@/components/guest-sign-in-button";
import { authClient } from "@/lib/auth-client";
import { localizedPath } from "@/lib/locale-path";
import { HOME_ALTERNATE_NAMES } from "@/lib/seo";
import { Button } from "@deniai/ui/components/button";

function HomeJsonLd({ description }: { description: string }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Deni AI",
    alternateName: [...HOME_ALTERNATE_NAMES],
    url: "https://deniai.app",
    description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Web, Windows, macOS",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
}

/** `/home` and `/ja`: what Deni AI is, a way into chat, and the other products. */
export function HomePage() {
  const t = useExtracted();
  const locale = useLocale();
  const session = authClient.useSession();
  const description = t(
    "Deni AI is a chat app where you can use GPT, Claude, Gemini and other AI models in one place, in the browser or in the desktop app.",
  );

  const products = [
    {
      href: localizedPath("/flixa", locale),
      title: "Flixa",
      body: t("AI coding agent for VS Code, Cursor and other editors."),
    },
    {
      href: localizedPath("/desktop", locale),
      title: t("Desktop app"),
      body: t("Deni AI for Windows and macOS."),
    },
    {
      href: "/run",
      title: "Deni Run",
      body: t(
        "AI teammates that work on tasks with their own browser and computer. Sign in to use it.",
      ),
    },
  ];

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6 md:py-24">
      <HomeJsonLd description={description} />

      <h1 className="text-3xl font-semibold text-balance sm:text-4xl">
        {t("Chat with GPT, Claude, Gemini and more")}
      </h1>
      <p className="mt-4 max-w-[60ch] text-base text-muted-foreground">{description}</p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" render={<Link href="/chat" />} nativeButton={false}>
          {t("Start chatting")}
        </Button>
        <GuestSignInButton />
      </div>

      {!session.isPending && (
        <AdSlot
          viewerId={session.data?.user.id ?? "public"}
          chatId="home"
          placement="home"
          visible
          requestInFlight={false}
          className="mt-8 max-w-xl"
        />
      )}

      <section aria-labelledby="home-products" className="mt-16 border-t border-border pt-8">
        <h2 id="home-products" className="text-lg font-semibold">
          {t("Also from Deni AI")}
        </h2>
        <ul className="mt-4 flex flex-col gap-4">
          {products.map((product) => (
            <li key={product.href}>
              <Link
                href={product.href}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {product.title}
              </Link>
              <p className="text-sm text-muted-foreground">{product.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
