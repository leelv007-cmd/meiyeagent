import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceHarnessDecisionResource } from '@/lib/core-request';

function forward(request: Request) {
  const taskId = new URL(request.url).pathname.split('/').at(-2) ?? '';
  return forwardWorkspaceCoreRequest(
    request,
    workspaceHarnessDecisionResource(decodeURIComponent(taskId))
  );
}

export const Route = createFileRoute(
  '/api/core/p1/harness/tasks/$taskId/decision'
)({
  server: {
    handlers: {
      GET: ({ request }) => forward(request),
      POST: ({ request }) => forward(request),
    },
  },
});
