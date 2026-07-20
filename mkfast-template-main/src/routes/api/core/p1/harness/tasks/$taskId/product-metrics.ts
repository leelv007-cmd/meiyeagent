import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';
import { workspaceHarnessProductMetricResource } from '@/lib/core-request';

export const Route = createFileRoute(
  '/api/core/p1/harness/tasks/$taskId/product-metrics'
)({
  server: {
    handlers: {
      POST: ({ params, request }) =>
        forwardWorkspaceCoreRequest(
          request,
          workspaceHarnessProductMetricResource(params.taskId)
        ),
    },
  },
});
