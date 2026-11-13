import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/conversation')({
  server: {
    handlers: {
      GET: async ({ request }) => (await import('@/server/http/conversation')).GET(request),
    },
  },
});
