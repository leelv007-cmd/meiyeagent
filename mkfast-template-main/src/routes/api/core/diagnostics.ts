import { forwardAuthenticatedCoreRequest } from '@/lib/core-client';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/core/diagnostics')({
  server: {
    handlers: {
      GET: ({ request }) => forwardAuthenticatedCoreRequest(request, '/health'),
      POST: ({ request }) =>
        forwardAuthenticatedCoreRequest(request, '/v1/diagnostics'),
    },
  },
});
