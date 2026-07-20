/**
 * G5 shared explanation projection — simulator and task audit (D-065 ④).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogModel, ModelDeployment } from '../model-supply/supply-contracts.js';
import { QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE } from '../model-supply/supply-contracts.js';
import {
  assertSharedExplanationProjection,
  buildRouteDecisionExplanation,
} from './route-explanation.js';
import {
  explainPlanDecision,
  planModelSupplyCandidatesWithDataPolicy,
} from './supply-control-plane.js';
import {
  DataPolicyRegistry,
} from './data-policy.js';
import type {
  CriticalEvidenceKind,
  RankingCandidateInput,
} from './three-layer-ranking.js';

const models: CatalogModel[] = [
  {
    id: 'copy-quality',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Q',
    qualityRank: 90,
  },
  {
    id: 'copy-domestic',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'D',
    qualityRank: 70,
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
    id: 'qwen-direct',
    catalogModelId: 'copy-domestic',
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
    allowedDataClasses: ['public', 'contains_face', 'pii', 'medical'],
  },
];

function catalog() {
  return {
    modelById: new Map(models.map((m) => [m.id, m])),
    deployments,
  };
}

function rankingInput(
  deploymentId: string,
  amountMicros: number,
  source: RankingCandidateInput['cost']['source'] = 'invoice',
): RankingCandidateInput {
  const freshAt = new Date().toISOString();
  const fact = (kind: CriticalEvidenceKind) => ({
    kind,
    status: 'fresh' as const,
    observedAt: freshAt,
    sampleSize: QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
    value: kind === 'success_rate' ? 0.95 : kind === 'p95' ? 500 : 1,
  });
  return {
    deploymentId,
    quality: {
      conformance: fact('conformance'),
      mappingTrust: fact('mapping_trust'),
      activationEvidence: fact('activation_evidence'),
      versionedQualityBaseline: fact('versioned_quality_baseline'),
      successRate: fact('success_rate'),
      p95: fact('p95'),
      acceptanceCompleteness: fact('acceptance_completeness'),
    },
    health: { healthState: 'healthy', capacityHeadroom: 0.7 },
    cost: {
      source,
      amountMicros,
      currency: 'CNY',
      failureCostMicros: 100,
      latencyMs: 120,
      concentration: 0.1,
    },
  };
}

test('simulator and task audit share the same explanation projection', () => {
  const registry = new DataPolicyRegistry();
  const dp = registry.create({
    sourceTrustLevel: 'platform_verified',
    processingRegion: 'domestic',
    allowedDataClasses: ['public', 'pii'],
    dualApprovalRequiredFor: ['pii'],
  });

  const planResult = planModelSupplyCandidatesWithDataPolicy({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: ['pii'],
    dataPolicyByDeploymentId: new Map([
      [
        'qwen-direct',
        {
          deploymentId: 'qwen-direct',
          dataPolicyRevisionId: dp.id,
          dataPolicy: dp.payload,
          dualApproval: { contractApproved: true, technicalApproved: true },
        },
      ],
      [
        'openai-direct',
        {
          deploymentId: 'openai-direct',
          dataPolicyRevisionId: dp.id,
          dataPolicy: {
            sourceTrustLevel: 'self_declared',
            processingRegion: 'overseas',
            allowedDataClasses: ['public'],
          },
          dualApproval: null,
        },
      ],
    ]),
    rankingInputsByDeploymentId: new Map([
      ['qwen-direct', rankingInput('qwen-direct', 12_000, 'observed_usage')],
    ]),
    healthExcludedDeploymentIds: [],
  });

  const acceptanceBranch = {
    acceptance: 'not_attempted' as const,
    decision: 'awaiting_selection' as const,
    reason: 'no_attempt_yet',
    primaryDeploymentId: planResult.plan.candidates[0]?.deployment.id,
  };

  const simulator = explainPlanDecision({
    surface: 'simulator',
    planResult,
    requestedDataClasses: ['pii'],
    liveExclusions: [
      { deploymentId: 'openai-direct', reasons: ['data_class_disallowed'] },
    ],
    acceptanceBranch,
  });
  const audit = explainPlanDecision({
    surface: 'task_audit',
    planResult,
    requestedDataClasses: ['pii'],
    liveExclusions: [
      { deploymentId: 'openai-direct', reasons: ['data_class_disallowed'] },
    ],
    acceptanceBranch,
  });

  assert.equal(simulator.surface, 'simulator');
  assert.equal(audit.surface, 'task_audit');
  assertSharedExplanationProjection(simulator, audit);

  // Required explanation fields (D-065 ④)
  assert.ok(Array.isArray(simulator.hardFilter.passedDeploymentIds));
  assert.ok(Array.isArray(simulator.hardFilter.excluded));
  assert.deepEqual(simulator.sort.layerOrder, [
    'quality_reliability_gate',
    'health_capacity_guardrail',
    'cost_optimization',
  ]);
  assert.ok(Array.isArray(simulator.sort.ranked));
  assert.ok(Array.isArray(simulator.liveExclusions));
  assert.ok(simulator.maxCost === null || typeof simulator.maxCost.amountMicros === 'number');
  assert.ok(simulator.acceptanceBranch);
  assert.ok(Array.isArray(simulator.notSelectedReasons));
  assert.ok(Array.isArray(simulator.evidenceFreshness));
  assert.ok(Array.isArray(simulator.costEvidenceSource));
  assert.equal(simulator.dataProcessingLevel.protectedChannel, true);
  assert.doesNotMatch(simulator.dataProcessingLevel.copy, /openai-direct|qwen-direct/);
});

test('buildRouteDecisionExplanation projects evidence freshness and cost source', () => {
  const planResult = planModelSupplyCandidatesWithDataPolicy({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    rankingInputsByDeploymentId: new Map([
      ['openai-direct', rankingInput('openai-direct', 9_000, 'invoice')],
      ['qwen-direct', rankingInput('qwen-direct', 11_000, 'gateway_estimate')],
    ]),
  });

  const explanation = buildRouteDecisionExplanation({
    surface: 'simulator',
    requestedDataClasses: ['public'],
    hardFilterPassedDeploymentIds: planResult.plan.candidates.map(
      (c) => c.deployment.id,
    ),
    hardFilterExcluded: planResult.plan.candidateEvaluations
      .filter((e) => !e.eligible)
      .map((e) => ({
        deploymentId: e.deploymentId,
        reasons: e.exclusionReasons,
      })),
    ranking: planResult.ranking,
    costByDeploymentId: new Map(
      planResult.plan.candidateEvaluations.map((e) => [
        e.deploymentId,
        {
          amountMicros: e.costEstimate.amountMicros,
          currency: e.costEstimate.currency,
          source:
            e.deploymentId === 'openai-direct' ? 'invoice' : 'gateway_estimate',
        },
      ]),
    ),
    acceptanceBranch: {
      acceptance: 'rejected_before_accept',
      decision: 'safe_auto_fallback',
      reason: 'safe_auto_fallback',
      primaryDeploymentId: planResult.plan.candidates[0]?.deployment.id,
      fallbackDeploymentId: planResult.plan.candidates[1]?.deployment.id,
    },
  });

  assert.equal(explanation.failClosed, false);
  assert.ok(explanation.sort.ranked.length >= 1);
  assert.ok(explanation.evidenceFreshness.length >= 1);
  assert.ok(
    explanation.evidenceFreshness.every((row) =>
      row.criticalEvidence.every((fact) =>
        [
          'conformance',
          'mapping_trust',
          'activation_evidence',
          'versioned_quality_baseline',
          'success_rate',
          'p95',
          'acceptance_completeness',
        ].includes(fact.kind),
      ),
    ),
  );
  assert.ok(
    explanation.costEvidenceSource.some((row) => row.source === 'invoice'),
  );
  assert.ok(explanation.maxCost);
  assert.equal(explanation.acceptanceBranch.decision, 'safe_auto_fallback');
});

test('shared projection fail-closed when no compliant candidate', () => {
  const planResult = planModelSupplyCandidatesWithDataPolicy({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
    dataClass: ['contains_face'],
    dataPolicyByDeploymentId: new Map([
      [
        'openai-direct',
        {
          deploymentId: 'openai-direct',
          dataPolicyRevisionId: 'dp-none',
          dataPolicy: {
            sourceTrustLevel: 'untrusted',
            processingRegion: 'overseas',
            allowedDataClasses: ['public'],
          },
        },
      ],
    ]),
    applyThreeLayerRanking: false,
  });
  assert.equal(planResult.failClosed, true);

  const explanation = explainPlanDecision({
    surface: 'task_audit',
    planResult,
    requestedDataClasses: ['contains_face'],
    acceptanceBranch: {
      acceptance: 'not_attempted',
      decision: 'stop',
      reason: 'no_compliant_candidate',
    },
  });
  assert.equal(explanation.failClosed, true);
  assert.equal(explanation.failClosedReason, 'no_compliant_candidate');
  assert.equal(explanation.dataProcessingLevel.protectedChannel, true);
});
