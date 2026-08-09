import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';

export const Route = createFileRoute('/api/core/p1/pending-interrupts')({
  server: {
    handlers: {
      GET: ({ request }) =>
        forwardWorkspaceCoreRequest(request, 'p1/pending-interrupts'),
    },
  },
});
