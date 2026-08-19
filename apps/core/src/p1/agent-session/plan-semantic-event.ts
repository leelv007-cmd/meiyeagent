/**
 * MarketingPlanRevision → plan.created / plan.revised semantic events (V31-10).
 *
 * Projector remains the sole streamOffset writer (V31-03). PlanCompiler may
 * project immediately after append (fast path). V31-40 Postgres append also
 * writes a pending outbox candidate in the same TX as the revision; the
 * PlanEventOutboxDispatcher recovers any row not yet projected.
 *
 * Payload shape is the wire contract for Workstream Living Plan UI
 * (`parseLivingPlanEventPayload` in mkfast agent-workbench).
 * eventId is stable via planSemanticEventId(planId, revision).
 */

import type {
  MarketingPlanReadiness,
  MarketingPlanRevision,
} from '@meiye/contracts';

import type { SemanticEventCandidate } from '../agent-semantic-events/semantic-event-store.js';

/** Optional merchant billing overlay (never invent; omit when unknown). */
export type PlanLivingPlanBillingOverlay = {
  creditCost?: number;
  balanceCredits?: number;
  failureRefundsCredits?: boolean;
  durationLabel?: string;
};

export type BuildPlanLivingPlanEventPayloadInput = {
  revision: MarketingPlanRevision;
  readiness?: MarketingPlanReadiness;
  adjustmentSummary?: string;
  billing?: PlanLivingPlanBillingOverlay;
  factsSummary?: string;
  assetsSummary?: string;
  rightsLabel?: string;
};

/**
 * Merchant-facing Living Plan payload (five-section UI contract).
 * Fail-open on optional billing; goal.summary is always required from revision.
 */
export function buildPlanLivingPlanEventPayload(
  input: BuildPlanLivingPlanEventPayloadInput,
): Record<string, unknown> {
  const { revision } = input;
  const rightsLabel =
    input.rightsLabel ?? projectRightsLabel(revision.rightsSummary);
  const factsSummary =
    input.factsSummary ?? projectFactsSummary(revision.factUsages);
  const assetsSummary =
    input.assetsSummary ?? projectAssetsSummary(revision.assetUsages);
  const authoritySummary = projectAuthoritySummary(revision.authorityRefs);

  const costDuration: Record<string, unknown> = {};
  if (
    typeof input.billing?.creditCost === 'number' &&
    Number.isSafeInteger(input.billing.creditCost) &&
    input.billing.creditCost > 0
  ) {
    costDuration.creditCost = input.billing.creditCost;
  }
  if (
    typeof input.billing?.balanceCredits === 'number' &&
    Number.isSafeInteger(input.billing.balanceCredits) &&
    input.billing.balanceCredits >= 0
  ) {
    costDuration.balanceCredits = input.billing.balanceCredits;
  }
  if (typeof input.billing?.failureRefundsCredits === 'boolean') {
    costDuration.failureRefundsCredits = input.billing.failureRefundsCredits;
  }
  if (input.billing?.durationLabel?.trim()) {
    costDuration.durationLabel = input.billing.durationLabel.trim();
  }

  // Quote ref is always present on revision — surface a non-invented readiness cue.
  if (Object.keys(costDuration).length === 0 && revision.quoteRef?.id) {
    costDuration.durationLabel = '报价由系统绑定后显示';
  }

  const payload: Record<string, unknown> = {
    planId: revision.planId,
    revision: revision.revision,
    goal: {
      summary: revision.goal.summary,
      whyNow: revision.goal.whyNow,
      desiredAction: revision.goal.desiredAction,
    },
    deliverables: revision.deliverables.map((item) => ({
      kind: item.kind,
      ...(item.platform ? { platform: item.platform } : {}),
      quantity: item.quantity,
      ...(item.purpose ? { purpose: item.purpose } : {}),
    })),
    expression: {
      ...(revision.expression.voice
        ? { voice: revision.expression.voice }
        : {}),
      ...(revision.expression.openingMechanism
        ? { openingMechanism: revision.expression.openingMechanism }
        : {}),
      ...(revision.expression.narrativeStructure
        ? { narrativeStructure: revision.expression.narrativeStructure }
        : {}),
      ...(revision.expression.promotionIntensity
        ? { promotionIntensity: revision.expression.promotionIntensity }
        : {}),
      ...(revision.expression.cta ? { cta: revision.expression.cta } : {}),
    },
    factsAssets: {
      ...(factsSummary ? { factsSummary } : {}),
      ...(authoritySummary ? { authoritySummary } : {}),
      ...(assetsSummary ? { assetsSummary } : {}),
      ...(rightsLabel ? { rightsLabel } : {}),
    },
    costDuration,
    quoteRef: {
      id: revision.quoteRef.id,
      revision: revision.quoteRef.revision,
    },
  };

  if (input.readiness) {
    payload.readiness = input.readiness;
  }
  if (input.adjustmentSummary?.trim()) {
    payload.adjustmentSummary = input.adjustmentSummary.trim();
  }

  return payload;
}

export function planEventTypeForRevision(
  revisionNumber: number,
): 'plan.created' | 'plan.revised' {
  return revisionNumber <= 1 ? 'plan.created' : 'plan.revised';
}

/** Stable eventId so crash-window re-emit is idempotent (projector eventId key). */
export function planSemanticEventId(planId: string, revision: number): string {
  return `plan:${planId}:r${revision}`;
}

export type BuildPlanSemanticEventCandidateInput =
  BuildPlanLivingPlanEventPayloadInput & {
    /** Tenant boundary — workspaceId is the production resourceId for plan paths. */
    resourceId: string;
    correlationId?: string;
    causationId?: string;
    occurredAt?: string;
  };

export function buildPlanSemanticEventCandidate(
  input: BuildPlanSemanticEventCandidateInput,
): SemanticEventCandidate {
  const revision = input.revision;
  const eventType = planEventTypeForRevision(revision.revision);
  const payload = buildPlanLivingPlanEventPayload(input);

  return {
    eventId: planSemanticEventId(revision.planId, revision.revision),
    threadId: revision.threadId,
    resourceId: input.resourceId,
    contextRole: 'included',
    sourceDomain: 'marketing_plan_revision',
    sourceEntityId: revision.planId,
    sourceRevision: String(revision.revision),
    correlationId: input.correlationId ?? revision.threadId,
    ...(input.causationId !== undefined
      ? { causationId: input.causationId }
      : {}),
    eventType,
    payload,
    occurredAt: input.occurredAt ?? revision.createdAt,
  };
}

/** Thin port so PlanCompiler does not import the full projector class. */
export type PlanSemanticEventSink = {
  project(
    candidate: SemanticEventCandidate,
  ): Promise<{ event: unknown; replayed: boolean }>;
};

function projectRightsLabel(rightsSummary: unknown): string | undefined {
  if (!rightsSummary || typeof rightsSummary !== 'object') return undefined;
  const record = rightsSummary as Record<string, unknown>;
  if (record.blocked === true || record.authorized === false) {
    return '素材授权待处理';
  }
  if (record.authorized === true || record.ok === true) {
    return '素材授权通过';
  }
  if (typeof record.summary === 'string' && record.summary.trim()) {
    return record.summary.trim();
  }
  if (typeof record.label === 'string' && record.label.trim()) {
    return record.label.trim();
  }
  return undefined;
}

function projectFactsSummary(factUsages: unknown): string | undefined {
  if (!Array.isArray(factUsages) || factUsages.length === 0) {
    return undefined;
  }
  return `已绑定 ${factUsages.length} 项事实用法`;
}

function projectAuthoritySummary(
  authorityRefs: readonly string[],
): string | undefined {
  if (authorityRefs.length === 0) return undefined;
  return `已参考 ${authorityRefs.length} 项品牌与创作资料`;
}

function projectAssetsSummary(assetUsages: unknown): string | undefined {
  if (!Array.isArray(assetUsages) || assetUsages.length === 0) {
    return undefined;
  }
  return `已绑定 ${assetUsages.length} 项素材用法`;
}
