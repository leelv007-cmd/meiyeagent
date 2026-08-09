import { createFileRoute } from '@tanstack/react-router';

import { forwardWorkspaceCoreRequest } from '@/lib/core-client';

export const Route = createFileRoute(
  '/api/core/p1/campaigns/paid-works/$campaignId'
)({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        forwardWorkspaceCoreRequest(
          request,
          `p1/campaigns/paid-works/${encodeURIComponent(params.campaignId)}`
        ),
    },
  },
});
