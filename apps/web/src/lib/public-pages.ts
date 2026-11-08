export type PublicPage = {
  path: string;
  changeFrequency: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority: number;
};

export const PUBLIC_SITE_ORIGIN = "https://deniai.app";

/** Marketing and legal URLs that should appear in the sitemap. */
export const publicPages: PublicPage[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/home", changeFrequency: "weekly", priority: 1 },
  { path: "/flixa", changeFrequency: "monthly", priority: 0.8 },
  { path: "/desktop", changeFrequency: "weekly", priority: 0.8 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.7 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.85 },
  { path: "/changelog", changeFrequency: "weekly", priority: 0.8 },
  { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/privacy-policy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/tokusho", changeFrequency: "yearly", priority: 0.3 },
];
