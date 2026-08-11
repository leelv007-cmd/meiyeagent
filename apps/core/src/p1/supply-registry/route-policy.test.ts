import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CatalogModel,
  ModelDeployment,
} from '../model-supply/supply-contracts.js';
import { planModelSupplyCandidates } from '../model-supply/route-planning.js';
import { MemoryHealthOverlayPort } from './health-overlay.js';
import type { RoutePolicyPayload } from './route-policy.js';
import {
  collectHealthExcludedDeploymentIds,
  decideAutoFallback,
  planModelSupplyCandidatesWithPolicy,
} from './supply-control-plane.js';

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
    modelById: new Map(models.map((model) => [model.id, model])),
    deployments,
  };
}

const routePolicy: RoutePolicyPayload = {
  operation: 'copy.generate',
  qualityTier: 'quality',
  hardConstraints: ['deployment_active'],
  candidateDeploymentIds: ['gemini-direct', 'openai-direct'],
  maxAttempts: 2,
  fallbackAuthorized: true,
  modelSubstitutionDegradationSurfaces: {
    'gemini-direct': ['tone_consistency'],
  },
};

test('fixed selection remains first when substitution fallback is authorized', () => {
  const plan = planModelSupplyCandidatesWithPolicy({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
    dataClass: [],
    routePolicy,
  });

  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.deployment.id),
    ['openai-direct', 'gemini-direct'],
  );
});

test('published policy payload orders the production candidate plan', () => {
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
    routePolicy,
  });
  assert.deepEqual(
    planned.candidates.map((candidate) => candidate.deployment.id),
    ['gemini-direct', 'openai-direct'],
  );
});

test('auto-fallback requires a pre-acceptance rejection and a safe next candidate', () => {
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

test('health overlay exclusions affect planning without mutating policy input', async () => {
  const overlay = new MemoryHealthOverlayPort(() => 1_000);
  await overlay.reportFact({
    targetKind: 'deployment',
    targetId: 'gemini-direct',
    kind: 'rate_limited',
    reason: '429',
    source: 'adapter',
  });
  const excluded = await collectHealthExcludedDeploymentIds({
    overlay,
    deploymentIds: routePolicy.candidateDeploymentIds,
    nowMs: 1_000,
  });
  const planned = planModelSupplyCandidatesWithPolicy({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    routePolicy,
    healthExcludedDeploymentIds: excluded,
  });

  assert.deepEqual(
    planned.candidates.map((candidate) => candidate.deployment.id),
    ['openai-direct'],
  );
  assert.deepEqual(routePolicy.candidateDeploymentIds, [
    'gemini-direct',
    'openai-direct',
  ]);
});
