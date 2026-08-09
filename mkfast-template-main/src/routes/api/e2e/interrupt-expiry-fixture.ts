import { createFileRoute } from '@tanstack/react-router';

import { forwardAuthenticatedCoreRequest } from '@/lib/core-client';

const TEST_API_SECRET = 'mkfast-e2e-secret';

export const Route = createFileRoute('/api/e2e/interrupt-expiry-fixture')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const allowed =
          import.meta.env.DEV === true &&
          import.meta.env.MODE === 'e2e' &&
          request.headers.get('x-e2e-secret') === TEST_API_SECRET;
        if (!allowed) {
          return Response.json({ error: 'Not Found' }, { status: 404 });
        }
        return forwardAuthenticatedCoreRequest(
          request,
          '/v1/e2e/interrupt-expiry-fixture'
        );
      },
    },
  },
});
