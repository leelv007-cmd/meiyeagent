import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceWorkflowEventResource } from '@/lib/core-request';

export const Route = createFileRoute(
  '/api/core/p1/workflows/$workflowId/events'
)({
  server: {
    handlers: {
      GET: ({ request }) => {
        const workflowId =
          new URL(request.url).pathname.split('/').at(-2) ?? '';
        return forwardWorkspaceCoreRequest(
          request,
          workspaceWorkflowEventResource(decodeURIComponent(workflowId))
        );
      },
    },
  },
});
