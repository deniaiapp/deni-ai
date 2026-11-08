import { createFileRoute } from "@tanstack/react-router";

const robots = `User-Agent: *
Allow: /
Disallow: /api/
Disallow: /sign-in
Disallow: /sign-up
Disallow: /two-factor
Disallow: /account
`;

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => new Response(robots, { headers: { "Content-Type": "text/plain" } }),
    },
  },
});
