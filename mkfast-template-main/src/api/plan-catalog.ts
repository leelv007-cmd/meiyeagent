/**
 * D-143 单一商品目录 — the public pricing page's read side.
 *
 * The 文案/图片/视频 numbers a visitor is quoted come from the same
 * `plan.allowances.*` admin-config revision that grants a merchant their
 * entitlements, so 后台改额度 → 公开页跟着变 is structural rather than a
 * discipline someone has to remember. Prices stay where they already live
 * (payment configuration): this endpoint carries entitlement counts only.
 *
 * The D-123 seed answers when core is unreachable — a pricing page that
 * renders nothing is worse than one stating the launch baseline, and the seed
 * is literally what an unconfigured deployment grants: it is the same shared
 * constant core builds its own default plan offers from.
 */
import { serverEnv } from '@/env/server';
import {
  PUBLIC_PLAN_ALLOWANCE_SEED,
  publicPlanCatalogSchema,
  type PublicPlanCatalog,
} from '@meiye/contracts';
import { createServerFn } from '@tanstack/react-start';

export const PLAN_CATALOG_SEED: PublicPlanCatalog = {
  plans: [...PUBLIC_PLAN_ALLOWANCE_SEED],
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
