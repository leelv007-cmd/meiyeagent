import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';

export const Route = createFileRoute('/api/core/p1/harness/tasks')({
  server: {
    handlers: {
      POST: ({ request }) =>
        forwardWorkspaceCoreRequest(request, 'p1/harness/tasks'),
    },
  },
});
