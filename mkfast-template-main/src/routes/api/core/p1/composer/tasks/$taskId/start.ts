import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceComposerTaskStartResource } from '@/lib/core-request';

export const Route = createFileRoute(
  '/api/core/p1/composer/tasks/$taskId/start'
)({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        forwardWorkspaceCoreRequest(
          request,
          workspaceComposerTaskStartResource(params.taskId)
        ),
    },
  },
});
