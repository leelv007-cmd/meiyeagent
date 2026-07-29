import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceHarnessInteractionResource } from '@/lib/core-request';

function forward(request: Request) {
  const taskId = new URL(request.url).pathname.split('/').at(-3) ?? '';
  return forwardWorkspaceCoreRequest(
    request,
    workspaceHarnessInteractionResource(decodeURIComponent(taskId), 'message')
  );
}

export const Route = createFileRoute(
  '/api/core/p1/harness/tasks/$taskId/interaction/message'
)({
  server: {
    handlers: {
      GET: ({ request }) => forward(request),
      POST: ({ request }) => forward(request),
    },
  },
});
