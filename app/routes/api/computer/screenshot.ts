import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { getScreenshot } from "@/lib/computer";

async function GET({ request: req }: { request: Request }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const jobId = new URL(req.url).searchParams.get("jobId") || undefined;
  const image = await getScreenshot(userId, jobId);
  if (image) {
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800">
    <rect width="100%" height="100%" fill="#161310"/>
    <text x="50%" y="48%" text-anchor="middle" fill="#9a8f84" font-family="Georgia, serif" font-size="28">Deni Run</text>
    <text x="50%" y="54%" text-anchor="middle" fill="#6d655c" font-family="sans-serif" font-size="14">The browser has not started yet</text>
  </svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/computer/screenshot")({
  server: { handlers: { GET } },
});
