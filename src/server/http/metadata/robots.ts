type RobotsRule = { userAgent: string; allow: string[]; disallow: string[] };

const rules: RobotsRule[] = [
  {
    userAgent: "*",
    allow: ["/"],
    disallow: ["/chat", "/settings", "/api", "/auth", "/account", "/getting-started"],
  },
];
const sitemap = "https://deniai.app/sitemap.xml";

/** Serialized the way Next.js rendered `MetadataRoute.Robots`. */
export function renderRobots() {
  let content = "";
  for (const rule of rules) {
    content += `User-Agent: ${rule.userAgent}\n`;
    for (const path of rule.allow) content += `Allow: ${path}\n`;
    for (const path of rule.disallow) content += `Disallow: ${path}\n`;
    content += "\n";
  }
  return `${content}Sitemap: ${sitemap}\n`;
}

export function GET() {
  return new Response(renderRobots(), {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}
