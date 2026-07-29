import assert from 'node:assert/strict';
import test from 'node:test';
import { P1DomainError } from '../foundation/domain.js';
import type { CatalogModel, ModelDeployment } from '../model-supply/supply-contracts.js';
import {
  expandThinRouteRevision,
  RoutePolicyRegistry,
  toPublicRoutePolicyRevision,
} from './route-policy.js';
import {
  decideAutoFallback,
  planModelSupplyCandidatesWithPolicy,
  resolveRoutePolicyAuthority,
  simulateRoutePolicyCandidate,
} from './supply-control-plane.js';
import { MemoryHealthOverlayPort } from './health-overlay.js';
import { planModelSupplyCandidates } from '../model-supply/route-planning.js';

const models: CatalogModel[] = [
  {
    id: 'copy-quality',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Q',
    qualityRank: 90,
  },
  {
    id: 'copy-anthropic',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'A',
    qualityRank: 85,
  },
  {
    id: 'copy-gemini',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'G',
    qualityRank: 80,
  },
];

const deployments: ModelDeployment[] = [
  {
    id: 'openai-direct',
    catalogModelId: 'copy-quality',
    apiFamily: 'openai',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'anthropic-direct',
    catalogModelId: 'copy-anthropic',
    apiFamily: 'anthropic',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'gemini-direct',
    catalogModelId: 'copy-gemini',
    apiFamily: 'gemini',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
];

function catalog() {
  return {
    modelById: new Map(models.map((m) => [m.id, m])),
    deployments,
  };
}

test('model substitution degradation surfaces bind only non-empty unique facts to frozen candidates', () => {
  const registry = new RoutePolicyRegistry();
  const payload = {
    operation: 'copy.generate' as const,
    qualityTier: 'quality' as const,
    hardConstraints: ['deployment_active'],
    candidateDeploymentIds: ['openai-direct', 'anthropic-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  };
  const candidate = registry.createCandidate({
    ...payload,
    modelSubstitutionDegradationSurfaces: {
      'anthropic-direct': ['tone_consistency'],
    },
  });
  assert.deepEqual(
    candidate.payload.modelSubstitutionDegradationSurfaces,
    { 'anthropic-direct': ['tone_consistency'] },
  );
  assert.throws(
    () =>
      registry.createCandidate({
        ...payload,
        modelSubstitutionDegradationSurfaces: {
          'outside-policy': ['tone_consistency'],
        },
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'INVALID_STATE',
  );
});

function publishPolicy(
  registry: RoutePolicyRegistry,
  payload: Parameters<RoutePolicyRegistry['createCandidate']>[0],
  expectedHead: string | null = null,
) {
  const candidate = registry.createCandidate(payload, {
    actorId: 'admin',
    correlationId: 'corr-1',
  });
  const simulated = registry.simulate(
    candidate.id,
    {
      eligibleDeploymentIds: payload.candidateDeploymentIds,
      excluded: [],
      estimatedMaximumCostMicros: 40_000,
      simulatedAt: new Date().toISOString(),
    },
    { actorId: 'admin', correlationId: 'corr-1' },
  );
  const approved = registry.approve(simulated.id, {
    actorId: 'admin',
    correlationId: 'corr-1',
    reason: 'approved',
  });
  return registry.publish(approved.id, expectedHead, {
    actorId: 'admin',
    correlationId: 'corr-1',
    reason: 'publish',
  });
}

test('RoutePolicy lifecycle candidate→simulate→approve→publish', () => {
  const registry = new RoutePolicyRegistry();
  const published = publishPolicy(registry, {
    operation: 'copy.generate',
    qualityTier: 'quality',
    hardConstraints: ['deployment_active', 'data_class'],
    candidateDeploymentIds: ['anthropic-direct', 'gemini-direct'],
    orderBands: ['primary', 'fallback'],
    maxAttempts: 2,
    costBoundaryMicros: 100_000,
    fallbackAuthorized: true,
  });
  assert.equal(published.stage, 'published');
  assert.ok(published.publishedAt);
  const head = registry.getEffectiveHead('copy.generate', 'quality');
  assert.equal(head?.id, published.id);
  const publicView = toPublicRoutePolicyRevision(published);
  assert.equal(publicView.operation, 'copy.generate');
  assert.equal(publicView.fallbackAuthorized, true);
  assert.equal(publicView.candidateDeploymentIds.length, 2);
});

test('publish CAS rejects stale expected head', () => {
  const registry = new RoutePolicyRegistry();
  const first = publishPolicy(registry, {
    operation: 'image.generate',
    qualityTier: 'balanced',
    hardConstraints: [],
    candidateDeploymentIds: ['openai-direct'],
    maxAttempts: 1,
    fallbackAuthorized: false,
  });
  const candidate = registry.createCandidate({
    operation: 'image.generate',
    qualityTier: 'balanced',
    hardConstraints: [],
    candidateDeploymentIds: ['anthropic-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  const simulated = registry.simulate(candidate.id, {
    eligibleDeploymentIds: ['anthropic-direct'],
    excluded: [],
    estimatedMaximumCostMicros: null,
    simulatedAt: new Date().toISOString(),
  });
  const approved = registry.approve(simulated.id);
  assert.throws(
    () => registry.publish(approved.id, null),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
  const ok = registry.publish(approved.id, first.id);
  assert.equal(registry.getEffectiveHead('image.generate', 'balanced')?.id, ok.id);
});

test('rollback restores prior published head under CAS', () => {
  const registry = new RoutePolicyRegistry();
  const first = publishPolicy(registry, {
    operation: 'copy.generate',
    qualityTier: 'auto',
    hardConstraints: [],
    candidateDeploymentIds: ['openai-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  const second = publishPolicy(
    registry,
    {
      operation: 'copy.generate',
      qualityTier: 'auto',
      hardConstraints: [],
      candidateDeploymentIds: ['anthropic-direct', 'gemini-direct'],
      maxAttempts: 2,
      fallbackAuthorized: true,
    },
    first.id,
  );
  assert.equal(registry.getEffectiveHead('copy.generate', 'auto')?.id, second.id);
  const rolled = registry.rollback({
    operation: 'copy.generate',
    qualityTier: 'auto',
    targetRevisionId: first.id,
    expectedHeadRevisionId: second.id,
    reason: 'regression',
    actorId: 'admin',
    correlationId: 'corr-rb',
  });
  assert.equal(rolled.current?.id, first.id);
  assert.equal(registry.getEffectiveHead('copy.generate', 'auto')?.id, first.id);
  assert.equal(registry.listRollbackAudits().length, 1);
});

test('impact preview diffs deployments and flags for a candidate', () => {
  const registry = new RoutePolicyRegistry();
  const current = publishPolicy(registry, {
    operation: 'copy.generate',
    qualityTier: 'quality',
    hardConstraints: ['data_class'],
    candidateDeploymentIds: ['openai-direct', 'anthropic-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  const candidate = registry.createCandidate({
    operation: 'copy.generate',
    qualityTier: 'quality',
    hardConstraints: ['data_class', 'activation_evidence'],
    candidateDeploymentIds: ['anthropic-direct', 'gemini-direct'],
    maxAttempts: 1,
    fallbackAuthorized: false,
  });
  const preview = registry.previewImpact(candidate.id);
  assert.equal(preview.currentHeadId, current.id);
  assert.deepEqual(preview.addedDeploymentIds, ['gemini-direct']);
  assert.deepEqual(preview.removedDeploymentIds, ['openai-direct']);
  assert.equal(preview.maxAttemptsBefore, 2);
  assert.equal(preview.maxAttemptsAfter, 1);
  assert.equal(preview.fallbackAuthorizedBefore, true);
  assert.equal(preview.fallbackAuthorizedAfter, false);
});

test('per operation/quality-tier heads are independent (no global weights)', () => {
  const registry = new RoutePolicyRegistry();
  publishPolicy(registry, {
    operation: 'copy.generate',
    qualityTier: 'quality',
    hardConstraints: [],
    candidateDeploymentIds: ['openai-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  publishPolicy(registry, {
    operation: 'copy.generate',
    qualityTier: 'balanced',
    hardConstraints: [],
    candidateDeploymentIds: ['anthropic-direct'],
    maxAttempts: 1,
    fallbackAuthorized: false,
  });
  publishPolicy(registry, {
    operation: 'image.generate',
    qualityTier: 'quality',
    hardConstraints: [],
    candidateDeploymentIds: ['gemini-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  assert.deepEqual(
    registry.getEffectiveHead('copy.generate', 'quality')?.payload
      .candidateDeploymentIds,
    ['openai-direct'],
  );
  assert.deepEqual(
    registry.getEffectiveHead('copy.generate', 'balanced')?.payload
      .candidateDeploymentIds,
    ['anthropic-direct'],
  );
  assert.deepEqual(
    registry.getEffectiveHead('image.generate', 'quality')?.payload
      .candidateDeploymentIds,
    ['gemini-direct'],
  );
});

test('published policy is sole authority; thin route is not a second head', () => {
  const registry = new RoutePolicyRegistry();
  const thinRoutes = [
    { id: 'thin-copy', operation: 'copy.generate' as const, revision: 1 },
  ];
  const before = resolveRoutePolicyAuthority({
    registry,
    operation: 'copy.generate',
    thinRoutes,
  });
  assert.equal(before.source, 'thin_route_bootstrap');
  assert.equal(before.head, null);

  publishPolicy(registry, {
    operation: 'copy.generate',
    qualityTier: 'quality',
    hardConstraints: ['deployment_active'],
    candidateDeploymentIds: ['gemini-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  const after = resolveRoutePolicyAuthority({
    registry,
    operation: 'copy.generate',
    thinRoutes,
  });
  assert.equal(after.source, 'published_policy');
  assert.deepEqual(after.policy?.candidateDeploymentIds, ['gemini-direct']);
  assert.ok(after.head);
});

test('plan with published policy orders candidates by policy list', () => {
  const registry = new RoutePolicyRegistry();
  publishPolicy(registry, {
    operation: 'copy.generate',
    qualityTier: 'quality',
    hardConstraints: [],
    candidateDeploymentIds: ['gemini-direct', 'openai-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  const authority = resolveRoutePolicyAuthority({
    registry,
    operation: 'copy.generate',
  });
  const unconstrained = planModelSupplyCandidates({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
  });
  assert.equal(unconstrained.candidates[0]?.deployment.id, 'openai-direct');

  const planned = planModelSupplyCandidatesWithPolicy({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    routePolicy: authority.policy,
  });
  assert.deepEqual(
    planned.candidates.map((c) => c.deployment.id),
    ['gemini-direct', 'openai-direct'],
  );
});

test('simulateRoutePolicyCandidate advances stage and freezes summary', () => {
  const registry = new RoutePolicyRegistry();
  const candidate = registry.createCandidate({
    operation: 'copy.generate',
    qualityTier: 'quality',
    hardConstraints: [],
    candidateDeploymentIds: ['openai-direct', 'anthropic-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  const result = simulateRoutePolicyCandidate({
    registry,
    revisionId: candidate.id,
    catalog: catalog(),
    selection: { mode: 'auto', profile: 'quality', fallbackConsent: true },
    dataClass: [],
    actorId: 'admin',
    correlationId: 'sim-1',
  });
  assert.equal(result.revision.stage, 'simulated');
  assert.deepEqual(result.summary.eligibleDeploymentIds, [
    'openai-direct',
    'anthropic-direct',
  ]);
  assert.ok(result.publicView.revisionId.includes('copy.generate'));
});

test('auto-fallback only for rejected_before_accept with hard-constraint-safe next', () => {
  assert.equal(
    decideAutoFallback({
      acceptance: 'rejected_before_accept',
      fallbackAuthorized: true,
      nextCandidatePassesHardConstraints: true,
    }),
    'safe_auto_fallback',
  );
  assert.equal(
    decideAutoFallback({
      acceptance: 'accepted',
      fallbackAuthorized: true,
      nextCandidatePassesHardConstraints: true,
    }),
    'query_reconcile_manual',
  );
  assert.equal(
    decideAutoFallback({
      acceptance: 'acceptance_unknown',
      fallbackAuthorized: true,
      nextCandidatePassesHardConstraints: true,
    }),
    'query_reconcile_manual',
  );
  assert.equal(
    decideAutoFallback({
      acceptance: 'rejected_before_accept',
      fallbackAuthorized: false,
      nextCandidatePassesHardConstraints: true,
    }),
    'fallback_not_authorized',
  );
  assert.equal(
    decideAutoFallback({
      acceptance: 'rejected_before_accept',
      fallbackAuthorized: true,
      nextCandidatePassesHardConstraints: false,
    }),
    'no_safe_fallback_candidate',
  );
});

test('health overlay exclusions affect planning only (not policy revision)', async () => {
  const registry = new RoutePolicyRegistry();
  const published = publishPolicy(registry, {
    operation: 'copy.generate',
    qualityTier: 'quality',
    hardConstraints: [],
    candidateDeploymentIds: ['openai-direct', 'anthropic-direct'],
    maxAttempts: 2,
    fallbackAuthorized: true,
  });
  const overlay = new MemoryHealthOverlayPort(() => 1_000);
  await overlay.reportFact({
    targetKind: 'deployment',
    targetId: 'openai-direct',
    kind: 'rate_limited',
    reason: '429',
    source: 'adapter',
  });
  const planned = planModelSupplyCandidatesWithPolicy({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    routePolicy: published.payload,
    healthExcludedDeploymentIds: ['openai-direct'],
  });
  assert.deepEqual(
    planned.candidates.map((c) => c.deployment.id),
    ['anthropic-direct'],
  );
  // revision untouched
  assert.deepEqual(
    registry.getEffectiveHead('copy.generate', 'quality')?.payload
      .candidateDeploymentIds,
    ['openai-direct', 'anthropic-direct'],
  );
});

test('expandThinRouteRevision bootstraps catalog RouteRevision fields', () => {
  const payload = expandThinRouteRevision(
    { id: 'r1', catalogModelId: 'copy-quality', operation: 'copy.generate', revision: 1 },
    {
      candidateDeploymentIds: ['openai-direct'],
      qualityTier: 'balanced',
      maxAttempts: 3,
      fallbackAuthorized: false,
    },
  );
  assert.equal(payload.operation, 'copy.generate');
  assert.equal(payload.qualityTier, 'balanced');
  assert.equal(payload.maxAttempts, 3);
  assert.equal(payload.fallbackAuthorized, false);
  assert.deepEqual(payload.candidateDeploymentIds, ['openai-direct']);
});
