import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/core/product/state')({
  server: {
    handlers: {
      GET: ({ request }) => forwardWorkspaceCoreRequest(request, 'state'),
    },
  },
});
