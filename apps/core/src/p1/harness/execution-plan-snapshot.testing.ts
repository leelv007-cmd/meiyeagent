/**
 * Test-only admitted ExecutionPlanSnapshot builder (U14).
 *
 * Snapshot-less durable replay is archived fail-closed. Happy-path claim /
 * workflow fixtures must carry a schema-valid snapshot whose hash covers the
 * frozen fields — a stub `{ snapshotHash }` dodges U14 then dies in
 * `normalizeRequest`.
 */

import { harnessReleaseIdSchema } from '@meiye/contracts';

import { createCanonicalCarrierUnitRecipeRegistry } from './carrier-unit-recipes.js';
import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';

const BOUNDED = {
  schemaVersion: 'bounded-execution-snapshot/v1' as const,
  maxIterations: 10,
  maxCostCents: 100,
  maxWallClockMs: 60_000,
  maxDelegations: 2,
  requiredLimits: ['maxIterations', 'maxCostCents'] as const,
  consumption: {
    iterations: 0,
    costCents: 0,
    wallClockMs: 0,
    delegations: 0,
  },
  stopReason: null,
  triggeredLimit: null,
};

export type PolicyExemptSnapshotCarrier = 'copy' | 'media' | 'note';

export type PolicyExemptSnapshotInput = {
  planId: string;
  intentSummary: string;
  quoteId: string;
  quoteRevision?: number | string;
  harnessReleaseId: string;
  carrier?: PolicyExemptSnapshotCarrier;
  contextBundleId?: string;
  contextHash?: string;
  rightsRevisionRefs?: string[];
  factRevisionRefs?: string[];
};

export function freezePolicyExemptPlan(
  input: PolicyExemptSnapshotInput,
): ReturnType<typeof freezeExecutionPlanContent> {
  const carrier = input.carrier ?? 'copy';
  const content = {
    planId: input.planId,
    planRevision: 1,
    intentDeclaration: { summary: input.intentSummary },
    contextBundleRef: {
      bundleId: input.contextBundleId ?? `bundle-${input.planId}`,
      revision: 1,
      hash: input.contextHash ?? 'a'.repeat(64),
    },
    executionPlan: createCanonicalCarrierUnitRecipeRegistry().resolve(carrier)
      .plan,
    deliverables: [
      {
        deliverableId: `${carrier}-main`,
        kind: carrier,
        quantity: 1,
      },
    ],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: {
      id: input.quoteId,
      revision: input.quoteRevision ?? 1,
    },
    rightsRevisionRefs: input.rightsRevisionRefs ?? [],
    factRevisionRefs: input.factRevisionRefs ?? [],
    boundedExecution: BOUNDED,
    harnessReleaseId: harnessReleaseIdSchema.parse(input.harnessReleaseId),
    approvalBasis: 'policy_exempt_copy' as const,
  } as unknown as ExecutionPlanFrozenContent;
  return freezeExecutionPlanContent(content);
}

export function buildPolicyExemptExecutionPlanSnapshot(
  input: PolicyExemptSnapshotInput,
) {
  const { content, snapshotHash } = freezePolicyExemptPlan(input);
  return buildExecutionPlanSnapshot({ content, snapshotHash });
}
