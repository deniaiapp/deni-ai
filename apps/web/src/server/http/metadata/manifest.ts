/** Fields of the Web App Manifest this app sets (formerly Next's `MetadataRoute.Manifest`). */
type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: "any" | "maskable" | "monochrome";
};

type WebAppManifest = {
  name: string;
  short_name: string;
  description: string;
  id: string;
  start_url: string;
  scope: string;
  handle_links: "auto" | "preferred" | "not-preferred";
  display: "fullscreen" | "standalone" | "minimal-ui" | "browser";
  orientation: "any" | "natural" | "portrait" | "landscape";
  background_color: string;
  theme_color: string;
  categories: string[];
  shortcuts: { name: string; short_name: string; description: string; url: string }[];
  icons: ManifestIcon[];
};

export const manifest: WebAppManifest = {
  name: "Deni AI",
  short_name: "Deni AI",
  description:
    "Access GPT, Claude, Gemini and more AI models in one place. Free, fast, and private AI chat for everyone.",
  id: "/",
  start_url: "/",
  scope: "/",
  // Keep links from outside the app (password-reset emails, OAuth callbacks
  // for Google/GitHub sign-in started in a browser tab) in that browser tab.
  // Otherwise the installed PWA captures them and opens on the chat screen.
  handle_links: "not-preferred",
  display: "standalone",
  orientation: "any",
  background_color: "#ffffff",
  theme_color: "#171717",
  categories: ["productivity", "utilities"],
  shortcuts: [
    {
      name: "New chat",
      short_name: "Chat",
      description: "Start a new Deni AI chat",
      url: "/chat",
    },
    {
      name: "Settings",
      short_name: "Settings",
      description: "Open Deni AI settings",
      url: "/settings/appearance",
    },
  ],
  icons: [
    {
      src: "/pwa/android-chrome-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/pwa/android-chrome-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
    {
      src: "/pwa/android-chrome-192x192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "maskable",
    },
    {
      src: "/pwa/android-chrome-512x512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

/** `/manifest.webmanifest`; Cache-Control comes from the Nitro route rules. */
export function GET() {
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json" },
  });
}
