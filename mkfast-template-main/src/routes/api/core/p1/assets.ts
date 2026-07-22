import { createFileRoute } from '@tanstack/react-router';
import { forwardWorkspaceAssetRequest } from '@/lib/core-client';

export const workspaceAssetHandlers = {
  GET: ({ request }: { request: Request }) =>
    forwardWorkspaceAssetRequest(request),
  HEAD: ({ request }: { request: Request }) =>
    forwardWorkspaceAssetRequest(request),
};

export const Route = createFileRoute('/api/core/p1/assets')({
  server: {
    handlers: workspaceAssetHandlers,
  },
});
