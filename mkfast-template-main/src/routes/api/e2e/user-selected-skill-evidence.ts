import { createFileRoute } from '@tanstack/react-router';

import { forwardAuthenticatedCoreRequest } from '@/lib/core-client';

const TEST_API_SECRET = 'mkfast-e2e-secret';

function assertE2EAccess(request: Request) {
  const requestSecret = request.headers.get('x-e2e-secret');
  const isLocalE2EMode =
    import.meta.env.DEV === true && import.meta.env.MODE === 'e2e';

  if (!isLocalE2EMode || requestSecret !== TEST_API_SECRET) {
    return Response.json({ error: 'Not Found' }, { status: 404 });
  }

  return null;
}

function assertEmptyPayload(request: Request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength && contentLength !== '0') {
    return Response.json(
      { error: 'Evidence probe does not accept a payload' },
      { status: 400 }
    );
  }
  return null;
}

function payloadFreeRequest(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete('content-length');
  headers.delete('content-type');
  return new Request(request.url, { headers, method: request.method });
}

export const Route = createFileRoute('/api/e2e/user-selected-skill-evidence')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const accessError = assertE2EAccess(request);
        if (accessError) return accessError;
        const payloadError = assertEmptyPayload(request);
        if (payloadError) return payloadError;

        const inbound = new URL(request.url);
        const taskId = inbound.searchParams.get('taskId')?.trim();
        if (!taskId) {
          return Response.json(
            { error: 'taskId query is required' },
            { status: 400 }
          );
        }

        return forwardAuthenticatedCoreRequest(
          payloadFreeRequest(request),
          `/v1/e2e/user-selected-skill-evidence?taskId=${encodeURIComponent(taskId)}`
        );
      },
    },
  },
});
