import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceHarnessInteractionResource } from '@/lib/core-request';

function forward(request: Request) {
  const taskId = new URL(request.url).pathname.split('/').at(-4) ?? '';
  return forwardWorkspaceCoreRequest(
    request,
    workspaceHarnessInteractionResource(
      decodeURIComponent(taskId),
      'v2/editing'
    )
  );
}

export const Route = createFileRoute(
  '/api/core/p1/harness/tasks/$taskId/interaction/v2/editing'
)({
  server: {
    handlers: {
      POST: ({ request }) => forward(request),
    },
  },
});
