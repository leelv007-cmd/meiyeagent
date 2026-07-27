import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';

export const Route = createFileRoute('/api/core/p1/harness/tasks')({
  server: {
    handlers: {
      // 时间桥 (D-145): runs still in flight for the caller's workspace.
      GET: ({ request }) =>
        forwardWorkspaceCoreRequest(request, 'p1/harness/tasks'),
      POST: ({ request }) =>
        forwardWorkspaceCoreRequest(request, 'p1/harness/tasks'),
    },
  },
});
