import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/core/p1/query')({
  server: {
    handlers: {
      POST: ({ request }) => forwardWorkspaceCoreRequest(request, 'p1/query'),
    },
  },
});
