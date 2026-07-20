import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';

export const Route = createFileRoute('/api/core/p1/pending-actions')({
  server: {
    handlers: {
      GET: ({ request }) =>
        forwardWorkspaceCoreRequest(request, 'p1/pending-actions'),
    },
  },
});
