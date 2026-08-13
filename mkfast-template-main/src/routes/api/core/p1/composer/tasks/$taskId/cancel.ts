import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceComposerTaskCancelResource } from '@/lib/core-request';

export const Route = createFileRoute(
  '/api/core/p1/composer/tasks/$taskId/cancel'
)({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        forwardWorkspaceCoreRequest(
          request,
          workspaceComposerTaskCancelResource(params.taskId)
        ),
    },
  },
});
