import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/core/product/commands')({
  server: {
    handlers: {
      POST: ({ request }) => forwardWorkspaceCoreRequest(request, 'commands'),
    },
  },
});
