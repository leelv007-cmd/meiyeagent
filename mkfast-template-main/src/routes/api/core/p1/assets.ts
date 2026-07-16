import { forwardWorkspaceAssetRequest } from '@/lib/core-client';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/core/p1/assets')({
  server: {
    handlers: {
      GET: ({ request }) => forwardWorkspaceAssetRequest(request),
    },
  },
});
