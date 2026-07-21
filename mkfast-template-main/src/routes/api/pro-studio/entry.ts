import { createAuth } from '@/auth/auth';
import { websiteConfig } from '@/config/website';
import { getDb } from '@/db';
import { resolveDefaultWorkspace } from '@/db/workspaces';
import { serverEnv } from '@/env/server';
import { findPlanByPriceId } from '@/lib/price-plan';
import { isProStudioPaymentProviderReady } from '@/payment/pro-studio-commerce';
import { PostgresProStudioCommerceStore } from '@/payment/postgres-pro-studio-commerce';
import { createFileRoute } from '@tanstack/react-router';
import * as z from 'zod';
import { withCanonicalProStudioOffer } from './-entry-offer';

export const Route = createFileRoute('/api/pro-studio/entry')({
  server: {
    handlers: {
      GET: ({ request }) => getEntry(request),
    },
  },
});

const entrySchema = z.discriminatedUnion('status', [
  z.strictObject({
    activatedAt: z.string(),
    offerId: z.string(),
    status: z.literal('active'),
  }),
  z.strictObject({
    offer: z.strictObject({
      canPurchase: z.boolean(),
      demoUrl: z.string(),
      description: z.string(),
      id: z.string(),
      priceLabel: z.string(),
      purchasePath: z.string(),
    }),
    status: z.literal('locked'),
  }),
]);

async function getEntry(request: Request) {
  const current = await createAuth().api.getSession({
    headers: request.headers,
  });
  if (!current?.user?.id || !current.user.emailVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const workspace = await resolveDefaultWorkspace(current.user.id);
  if (!workspace) {
    return Response.json({ error: 'Workspace not found' }, { status: 404 });
  }
  const canvasServiceUrl = new URL(
    '/api/internal/pro-studio-entry',
    serverEnv.CANVAS_SERVICE_URL
  );
  const upstream = await fetch(canvasServiceUrl, {
    body: JSON.stringify({
      mainSessionId: current.session.id,
      userId: current.user.id,
      workspaceId: workspace.id,
    }),
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      'x-canvas-service-token': serverEnv.CANVAS_SERVICE_TOKEN,
    },
    method: 'POST',
  });
  if (!upstream.ok) {
    return Response.json(
      { error: 'Pro Studio entry is unavailable' },
      { status: upstream.status >= 500 ? 503 : upstream.status }
    );
  }
  const parsedEntry = entrySchema.parse(await upstream.json());
  const claimStatus =
    parsedEntry.status === 'locked'
      ? await new PostgresProStudioCommerceStore(
          getDb()
        ).getLatestWorkspaceClaimStatus(workspace.id)
      : null;
  const entry =
    parsedEntry.status === 'locked'
      ? withCanonicalProStudioOffer(
          parsedEntry,
          process.env,
          {
            findPlanByPriceId,
          },
          isProStudioPaymentProviderReady(websiteConfig.payment, process.env),
          claimStatus
        )
      : parsedEntry;
  return Response.json(
    {
      ...entry,
      launchUrl: new URL('/launch', serverEnv.CANVAS_ORIGIN).href,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
