import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/contact')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('@/server/http/contact')).POST(request),
    },
  },
});
