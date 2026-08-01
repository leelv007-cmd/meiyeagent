/**
 * Merchant credit catalogue read side. Values come from the same revisioned
 * `plan.credits.*` config consumed by the Core subscription scheduler.
 */
import { serverEnv } from '@/env/server';
import {
  publicPlanCatalogSchema,
  type PublicPlanCatalog,
} from '@meiye/contracts';
import { createServerFn } from '@tanstack/react-start';

export async function fetchPublicPlanCatalog(
  fetcher: typeof fetch = fetch,
): Promise<PublicPlanCatalog> {
  const response = await fetcher(
    `${serverEnv.CORE_SERVICE_URL}/public/plan-catalog`,
    {
      headers: { 'x-service-token': serverEnv.CORE_SERVICE_TOKEN },
      method: 'GET',
    },
  );
  if (!response.ok) {
    throw new Error(`Core plan catalog returned ${response.status}.`);
  }
  const envelope = (await response.json()) as { data?: unknown };
  const parsed = publicPlanCatalogSchema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new Error('Core plan catalog response is invalid.');
  }
  return parsed.data;
}

export const getPublicPlanCatalog = createServerFn({ method: 'GET' }).handler(
  async () => fetchPublicPlanCatalog(),
);
