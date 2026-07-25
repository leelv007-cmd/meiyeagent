/**
 * R-08 / D-127 — Pro Studio entitlement three-state truth (issue #211).
 *
 * `unknown | locked | active` is the only entitlement vocabulary this product
 * speaks about Pro Studio. The single truth source is the canonical entitlement
 * projection owned by core (`ProStudioEntitlementApplicationService`), reached
 * from the browser through `GET /api/pro-studio/entry`.
 *
 * Every consumer — the workbench entry banner, the fullscreen catalog, the
 * `/pro-studio` route gate — reads this module. A static seed must never stand
 * in for a real answer: when the projection is not readable the honest state is
 * `unknown`, which is presented conservatively and never grants entry.
 *
 * Pro Studio itself stays frozen (ADR-0012 / D-127 FREEZE, entry only). This
 * module changes what the entry *says*, never what Pro Studio *does*.
 */

import * as z from 'zod';

export const PRO_STUDIO_ENTITLEMENT_STATES = [
  'unknown',
  'locked',
  'active',
] as const;

export type ProStudioEntitlementState =
  (typeof PRO_STUDIO_ENTITLEMENT_STATES)[number];

/** Canonical projection read path. Never deep-link Canvas around it. */
export const PRO_STUDIO_ENTRY_PATH = '/api/pro-studio/entry';

/** Why the canonical projection could not answer. */
export type ProStudioUnknownReason =
  /** Cold start — the projection has not been read yet. */
  | 'projection_pending'
  /** The query failed (upstream down, unauthorized, network). */
  | 'projection_unreachable'
  /** A response arrived but did not match the projection contract. */
  | 'projection_unreadable';

export type ProStudioOfferView = {
  canPurchase: boolean;
  demoUrl: string;
  description: string;
  id: string;
  priceLabel: string;
  purchasePath: string;
  purchaseReason?:
    | 'activation_pending'
    | 'already_purchased'
    | 'owner_required'
    | 'unavailable';
};

export type ProStudioEntitlementProjection =
  | {
      state: 'active';
      activatedAt: string;
      launchUrl: string;
      offerId: string;
    }
  | { state: 'locked'; launchUrl: string; offer: ProStudioOfferView }
  | { state: 'unknown'; reason: ProStudioUnknownReason };

const entryPayloadSchema = z.discriminatedUnion('status', [
  z.object({
    activatedAt: z.string(),
    launchUrl: z.string(),
    offerId: z.string(),
    status: z.literal('active'),
  }),
  z.object({
    launchUrl: z.string(),
    offer: z.object({
      canPurchase: z.boolean(),
      demoUrl: z.string(),
      description: z.string(),
      id: z.string(),
      priceLabel: z.string(),
      purchasePath: z.string(),
      purchaseReason: z
        .enum([
          'activation_pending',
          'already_purchased',
          'owner_required',
          'unavailable',
        ])
        .optional(),
    }),
    status: z.literal('locked'),
  }),
]);

/**
 * Read a `/api/pro-studio/entry` payload into the canonical projection.
 * Anything that does not parse is `unknown`, never a guessed verdict.
 */
export function readProStudioEntitlementProjection(
  payload: unknown
): ProStudioEntitlementProjection {
  const parsed = entryPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { state: 'unknown', reason: 'projection_unreadable' };
  }
  if (parsed.data.status === 'active') {
    return {
      state: 'active',
      activatedAt: parsed.data.activatedAt,
      launchUrl: parsed.data.launchUrl,
      offerId: parsed.data.offerId,
    };
  }
  return {
    state: 'locked',
    launchUrl: parsed.data.launchUrl,
    offer: parsed.data.offer,
  };
}

/**
 * Project a fetch-shaped query result (pending / error / data) into the
 * canonical projection. This is where cold start and query failure become the
 * `unknown` state instead of silently reading as "not purchased".
 */
export function projectProStudioEntitlement(query: {
  isPending?: boolean;
  isError?: boolean;
  data?: unknown;
}): ProStudioEntitlementProjection {
  if (query.isError) {
    return { state: 'unknown', reason: 'projection_unreachable' };
  }
  if (query.isPending || query.data === undefined || query.data === null) {
    return { state: 'unknown', reason: 'projection_pending' };
  }
  return readProStudioEntitlementProjection(query.data);
}

/**
 * The single gate predicate. Entry presentation and the route gate both call
 * it, so "visible entry → gate refuses" cannot happen.
 */
export function canEnterProStudio(
  state: ProStudioEntitlementState
): state is 'active' {
  return state === 'active';
}

/** Merchant-language reason for a non-active state. Never engineering terms. */
export function proStudioEntitlementReason(
  projection: ProStudioEntitlementProjection
): string | undefined {
  if (projection.state === 'active') return undefined;
  if (projection.state === 'locked') {
    switch (projection.offer.purchaseReason) {
      case 'activation_pending':
        return '付款已确认，权益正在开通';
      case 'already_purchased':
        return '已购买，权益正在同步';
      case 'owner_required':
        return '请联系工作区 Owner 开通';
      case 'unavailable':
        return '开通入口暂不可用';
      default:
        // Pro Studio is a standalone add-on, not a plan tier — say so honestly.
        return '尚未开通 Pro Studio';
    }
  }
  return projection.reason === 'projection_pending'
    ? '正在读取工作区权益'
    : '权益状态暂时读不到，稍后重试';
}

/** Fetch the canonical projection. Throws so a query surfaces `unknown`. */
export async function fetchProStudioEntitlement(
  signal?: AbortSignal
): Promise<unknown> {
  const response = await fetch(PRO_STUDIO_ENTRY_PATH, {
    credentials: 'same-origin',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error('Pro Studio entitlement projection is unavailable.');
  }
  return response.json();
}
