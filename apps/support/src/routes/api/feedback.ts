import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/feedback')({
  server: {
    handlers: {
      POST: async ({ request }) => (await import('@/server/http/feedback')).POST(request),
    },
  },
});
