import { forwardAuthenticatedCoreRequest } from '@/lib/core-client';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/core/diagnostics/$id/resume')({
  server: {
    handlers: {
      POST: ({ request }) => {
        const id = new URL(request.url).pathname.split('/').at(-2);
        return forwardAuthenticatedCoreRequest(
          request,
          `/v1/diagnostics/${encodeURIComponent(id ?? '')}/resume`
        );
      },
    },
  },
});
