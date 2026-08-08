import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceAgentSemanticResource } from '@/lib/core-request';

export const Route = createFileRoute(
  '/api/core/p1/agent-threads/$threadId/events'
)({
  server: {
    handlers: {
      GET: ({ request }) => {
        const threadId = new URL(request.url).pathname.split('/').at(-2) ?? '';
        return forwardWorkspaceCoreRequest(
          request,
          workspaceAgentSemanticResource(decodeURIComponent(threadId), 'events')
        );
      },
    },
  },
});
