/**
 * Merchant credit catalogue read side. Values come from the same revisioned
 * `plan.credits.*` config consumed by the Core subscription scheduler.
 */
import { serverEnv } from '@/env/server';
import {
  PUBLIC_PLAN_CREDIT_SEED,
  publicPlanCatalogSchema,
  type PublicPlanCatalog,
} from '@meiye/contracts';
import { createServerFn } from '@tanstack/react-start';

export const PLAN_CATALOG_SEED: PublicPlanCatalog = {
  plans: [...PUBLIC_PLAN_CREDIT_SEED],
};

export const getPublicPlanCatalog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicPlanCatalog> => {
    try {
      const response = await fetch(
        `${serverEnv.CORE_SERVICE_URL}/public/plan-catalog`,
        {
          headers: { 'x-service-token': serverEnv.CORE_SERVICE_TOKEN },
          method: 'GET',
        }
      );
      if (!response.ok) return PLAN_CATALOG_SEED;
      const envelope = (await response.json()) as { data?: unknown };
      const parsed = publicPlanCatalogSchema.safeParse(envelope.data);
      return parsed.success ? parsed.data : PLAN_CATALOG_SEED;
    } catch {
      return PLAN_CATALOG_SEED;
    }
  }
);
