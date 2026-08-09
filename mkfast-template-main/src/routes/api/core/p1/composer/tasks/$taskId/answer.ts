import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceComposerTaskAnswerResource } from '@/lib/core-request';

export const Route = createFileRoute(
  '/api/core/p1/composer/tasks/$taskId/answer'
)({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        forwardWorkspaceCoreRequest(
          request,
          workspaceComposerTaskAnswerResource(params.taskId)
        ),
    },
  },
});
