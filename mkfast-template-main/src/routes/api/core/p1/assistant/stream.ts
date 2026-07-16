import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/core/p1/assistant/stream')({
  server: {
    handlers: {
      POST: ({ request }) =>
        forwardWorkspaceCoreRequest(request, 'p1/assistant/stream'),
    },
  },
});
