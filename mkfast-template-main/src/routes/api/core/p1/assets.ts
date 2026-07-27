import { createFileRoute } from '@tanstack/react-router';
import { forwardWorkspaceAssetRequest } from '@/lib/core-client';

export const workspaceAssetHandlers = {
  GET: ({ request }: { request: Request }) =>
    forwardWorkspaceAssetRequest(request),
  HEAD: ({ request }: { request: Request }) =>
    forwardWorkspaceAssetRequest(request),
  /**
   * W02 ①: the five-step intake needs the photo to exist in *Core's* asset
   * space before `parse_single_asset` will look at it — the parse source
   * authorizer re-reads the object and matches sha256 + sizeBytes. Without a
   * write verb here the merchant could only upload into the web storage that
   * Core cannot see, so the whole photo lane was unreachable.
   */
  PUT: ({ request }: { request: Request }) =>
    forwardWorkspaceAssetRequest(request),
};

export const Route = createFileRoute('/api/core/p1/assets')({
  server: {
    handlers: workspaceAssetHandlers,
  },
});
