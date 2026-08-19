/**
 * Merchant credit catalogue read side. Values come from the same revisioned
 * `plan.credits.*` config consumed by the Core subscription scheduler.
 */
import {
  commercePlanCatalogSnapshotSchema,
  type CommercePlanCatalogSnapshot,
  publicPlanCatalogSchema,
  type PublicPlanCatalog,
} from '@meiye/contracts/billing-balance';
import { createServerFn } from '@tanstack/react-start';
import { serverEnv } from '@/env/server';

export async function fetchPublicPlanCatalog(
  fetcher: typeof fetch = fetch
): Promise<PublicPlanCatalog> {
  const response = await fetcher(
    `${serverEnv.CORE_SERVICE_URL}/public/plan-catalog`,
    {
      headers: { 'x-service-token': serverEnv.CORE_SERVICE_TOKEN },
      method: 'GET',
    }
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

export async function fetchCommercePlanCatalogSnapshot(
  fetcher: typeof fetch = fetch
): Promise<CommercePlanCatalogSnapshot> {
  const response = await fetcher(
    `${serverEnv.CORE_SERVICE_URL}/internal/commerce-plan-catalog`,
    {
      cache: 'no-store',
      headers: { 'x-service-token': serverEnv.CORE_SERVICE_TOKEN },
      method: 'GET',
    }
  );
  if (!response.ok) {
    throw new Error(`Core commerce plan catalog returned ${response.status}.`);
  }
  const envelope = (await response.json()) as { data?: unknown };
  const parsed = commercePlanCatalogSnapshotSchema.safeParse(envelope.data);
  if (!parsed.success) {
    throw new Error('Core commerce plan catalog response is invalid.');
  }
  return parsed.data;
}

export const getPublicPlanCatalog = createServerFn({ method: 'GET' }).handler(
  async () => fetchPublicPlanCatalog()
);
