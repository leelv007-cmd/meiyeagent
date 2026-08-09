import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceComposerTaskReviseResource } from '@/lib/core-request';

export const Route = createFileRoute(
  '/api/core/p1/composer/tasks/$taskId/revise'
)({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        forwardWorkspaceCoreRequest(
          request,
          workspaceComposerTaskReviseResource(params.taskId)
        ),
    },
  },
});
