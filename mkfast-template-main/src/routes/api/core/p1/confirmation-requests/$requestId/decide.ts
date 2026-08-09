import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceConfirmationDecisionResource } from '@/lib/core-request';

function forward(request: Request) {
  const requestId = new URL(request.url).pathname.split('/').at(-2) ?? '';
  return forwardWorkspaceCoreRequest(
    request,
    workspaceConfirmationDecisionResource(decodeURIComponent(requestId))
  );
}

export const Route = createFileRoute(
  '/api/core/p1/confirmation-requests/$requestId/decide'
)({
  server: {
    handlers: {
      POST: ({ request }) => forward(request),
    },
  },
});
