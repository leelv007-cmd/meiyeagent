import { P1DomainError } from '../foundation/domain.js';
import type {
  EntitlementPlanTier,
  EntitlementPolicyBody,
  EntitlementPolicyRevision,
} from './contracts.js';

export interface DraftEntitlementPolicyInput {
  tier: EntitlementPlanTier;
  body: EntitlementPolicyBody;
  actorId: string;
  reason: string;
  correlationId: string;
  /** CAS: expected published head revision for this tier, or null if none. */
  expectedPublishedRevision: number | null;
}

export interface PublishEntitlementPolicyInput {
  tier: EntitlementPlanTier;
  revisionId: string;
  actorId: string;
  reason: string;
  correlationId: string;
  expectedPublishedRevision: number | null;
}

export interface RollbackEntitlementPolicyInput {
  tier: EntitlementPlanTier;
  targetRevision: number;
  actorId: string;
  reason: string;
  correlationId: string;
  expectedPublishedRevision: number;
}

/**
 * In-memory versioned EntitlementPolicy registry.
 * Publish is batch-wide: a single published head per tier is the plan default
 * for every account on that tier — no per-account policy copies.
 */
export class EntitlementPolicyRevisionRegistry {
  private readonly byTier = new Map<
    EntitlementPlanTier,
    EntitlementPolicyRevision[]
  >();
  private readonly publishedHead = new Map<
    EntitlementPlanTier,
    EntitlementPolicyRevision
  >();
  private seq = 0;

  draft(input: DraftEntitlementPolicyInput): EntitlementPolicyRevision {
    this.assertCas(input.tier, input.expectedPublishedRevision);
    if (input.body.tier !== input.tier) {
      throw new P1DomainError(
        'INVALID_STATE',
        'EntitlementPolicy body tier must match the draft tier.'
      );
    }
    const revision: EntitlementPolicyRevision = {
      id: `entitlement-policy:${input.tier}:r${++this.seq}`,
      tier: input.tier,
      body: structuredClone(input.body),
      revision: this.seq,
      stage: 'draft',
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
      rolledBackToRevision: null,
    };
    const history = this.byTier.get(input.tier) ?? [];
    history.push(revision);
    this.byTier.set(input.tier, history);
    return structuredClone(revision);
  }

  publish(input: PublishEntitlementPolicyInput): EntitlementPolicyRevision {
    this.assertCas(input.tier, input.expectedPublishedRevision);
    const history = this.byTier.get(input.tier) ?? [];
    const draft = history.find((item) => item.id === input.revisionId);
    if (!draft) {
      throw new P1DomainError(
        'NOT_FOUND',
        'EntitlementPolicy revision was not found.'
      );
    }
    if (draft.stage !== 'draft') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only draft EntitlementPolicy revisions can be published.'
      );
    }
    const previous = this.publishedHead.get(input.tier);
    if (previous) {
      previous.stage = 'superseded';
    }
    draft.stage = 'published';
    draft.actorId = input.actorId;
    draft.reason = input.reason;
    draft.correlationId = input.correlationId;
    this.publishedHead.set(input.tier, draft);
    return structuredClone(draft);
  }

  rollback(input: RollbackEntitlementPolicyInput): EntitlementPolicyRevision {
    this.assertCas(input.tier, input.expectedPublishedRevision);
    const history = this.byTier.get(input.tier) ?? [];
    const target = history.find(
      (item) =>
        item.revision === input.targetRevision &&
        (item.stage === 'published' ||
          item.stage === 'superseded' ||
          item.stage === 'rolled_back')
    );
    if (!target) {
      throw new P1DomainError(
        'NOT_FOUND',
        'EntitlementPolicy target revision was not found.'
      );
    }
    const previous = this.publishedHead.get(input.tier);
    if (previous) {
      previous.stage = 'superseded';
    }
    const rolled: EntitlementPolicyRevision = {
      id: `entitlement-policy:${input.tier}:r${++this.seq}`,
      tier: input.tier,
      body: structuredClone(target.body),
      revision: this.seq,
      stage: 'rolled_back',
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
      rolledBackToRevision: target.revision,
    };
    // Rolled-back revision becomes the new published head (batch-wide).
    rolled.stage = 'published';
    history.push(rolled);
    this.byTier.set(input.tier, history);
    this.publishedHead.set(input.tier, rolled);
    return structuredClone(rolled);
  }

  getPublished(tier: EntitlementPlanTier): EntitlementPolicyRevision | null {
    const head = this.publishedHead.get(tier);
    return head ? structuredClone(head) : null;
  }

  history(tier: EntitlementPlanTier): EntitlementPolicyRevision[] {
    return structuredClone(this.byTier.get(tier) ?? []);
  }

  /**
   * Project the published plan policy for a tier into the product policy shape.
   * Batch-wide: every account on the tier shares this single revision head.
   */
  projectPlanPolicy(
    tier: EntitlementPlanTier
  ): EntitlementPolicyBody | null {
    const published = this.getPublished(tier);
    return published ? structuredClone(published.body) : null;
  }

  private assertCas(
    tier: EntitlementPlanTier,
    expectedPublishedRevision: number | null
  ) {
    const current = this.publishedHead.get(tier)?.revision ?? null;
    if (current !== expectedPublishedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'EntitlementPolicy published head changed before the command could be applied.'
      );
    }
  }
}
