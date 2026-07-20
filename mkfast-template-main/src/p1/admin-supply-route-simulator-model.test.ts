import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSharedExplanationProjection,
  buildDemoRouteExplanationFacts,
  buildDemoRouteSimulatorPanel,
  buildRouteDecisionExplanationView,
  projectLiveRouteDecision,
  projectRouteSimulatorPanel,
} from './admin-supply-route-simulator-model';

test('simulator and task_audit share identical explanation projection', () => {
  const base = buildDemoRouteExplanationFacts();
  const simulator = buildRouteDecisionExplanationView({
    ...base,
    surface: 'simulator',
  });
  const taskAudit = buildRouteDecisionExplanationView({
    ...base,
    surface: 'task_audit',
  });

  assert.equal(simulator.surface, 'simulator');
  assert.equal(taskAudit.surface, 'task_audit');
  assert.doesNotThrow(() =>
    assertSharedExplanationProjection(simulator, taskAudit),
  );
});

test('explanation projects hard filter, sort, live exclude, max cost, acceptance, not-selected, evidence freshness, cost source', () => {
  const explanation = buildRouteDecisionExplanationView(
    buildDemoRouteExplanationFacts(),
  );
  const panel = projectRouteSimulatorPanel(explanation);

  assert.ok(panel.hardFilterPassed.includes('dep-text-ark'));
  assert.ok(
    panel.hardFilterExcluded.some((e) => e.deploymentId === 'dep-image-single'),
  );
  assert.deepEqual(
    [...panel.layerOrder],
    [
      'quality_reliability_gate',
      'health_capacity_guardrail',
      'cost_optimization',
    ],
  );
  assert.equal(panel.sortRanked[0]?.deploymentId, 'dep-text-ark');
  assert.ok(
    panel.liveExclusions.some((e) => e.deploymentId === 'dep-text-tuzi'),
  );
  assert.ok(panel.maxCost);
  assert.equal(panel.maxCost?.evidenceSource, 'invoice');
  assert.equal(panel.acceptanceBranch.decision, 'safe_auto_fallback');
  assert.ok(panel.notSelectedReasons.length >= 2);
  assert.ok(
    panel.evidenceFreshness.some((row) =>
      row.criticalEvidence.some((f) => f.kind === 'conformance'),
    ),
  );
  assert.ok(
    panel.costEvidenceSource.some((row) => row.source === 'invoice'),
  );
  assert.equal(panel.failClosed, false);
});

test('fail-closed when no compliant candidates', () => {
  const explanation = buildRouteDecisionExplanationView({
    surface: 'simulator',
    requestedDataClasses: ['contains_face'],
    hardFilterPassedDeploymentIds: [],
    hardFilterExcluded: [
      {
        deploymentId: 'dep-x',
        reasons: ['data_class_disallowed'],
      },
    ],
    ranked: [],
    acceptanceBranch: {
      acceptance: 'not_attempted',
      decision: 'stop',
      reason: 'no_compliant_candidate',
    },
  });
  assert.equal(explanation.failClosed, true);
  assert.equal(explanation.failClosedReason, 'no_compliant_candidate');
  assert.equal(explanation.maxCost, null);
});

test('assertSharedExplanationProjection throws on divergence', () => {
  const base = buildDemoRouteExplanationFacts();
  const left = buildRouteDecisionExplanationView({
    ...base,
    surface: 'simulator',
  });
  const right = buildRouteDecisionExplanationView({
    ...base,
    surface: 'task_audit',
    hardFilterPassedDeploymentIds: ['only-left'],
  });
  assert.throws(() => assertSharedExplanationProjection(left, right), /diverged/);
});

test('demo panel is SSR-ready with all G5 sections', () => {
  const panel = buildDemoRouteSimulatorPanel();
  assert.equal(panel.surface, 'simulator');
  assert.ok(panel.hardFilterPassed.length >= 1);
  assert.ok(panel.notSelectedReasons.length >= 1);
  assert.ok(panel.evidenceFreshness.length >= 1);
  assert.ok(panel.costEvidenceSource.length >= 1);
});

test('projectLiveRouteDecision accepts preview flat explanation and execute wrapper', () => {
  const flat = {
    surface: 'simulator',
    hardFilter: {
      passedDeploymentIds: ['dep-a'],
      excluded: [{ deploymentId: 'dep-b', reasons: ['data_class'] }],
    },
    sort: {
      layerOrder: [
        'quality_reliability_gate',
        'health_capacity_guardrail',
        'cost_optimization',
      ],
      ranked: [{ deploymentId: 'dep-a', rank: 1, band: 'production' }],
    },
    liveExclusions: [],
    acceptanceBranch: {
      decision: 'complete',
      reason: 'primary accepted',
      primaryDeploymentId: 'dep-a',
    },
    failClosed: false,
    failClosedReason: null,
    maxCost: {
      amountMicros: 1000,
      currency: 'CNY',
      evidenceSource: 'catalog',
    },
    notSelectedReasons: [{ deploymentId: 'dep-b', reasons: ['data_class'] }],
    evidenceFreshness: [
      {
        deploymentId: 'dep-a',
        criticalEvidence: [{ kind: 'conformance', status: 'fresh' }],
      },
    ],
    costEvidenceSource: [
      { deploymentId: 'dep-a', source: 'catalog', amountMicros: 1000 },
    ],
    dataProcessingLevel: {
      level: 'standard',
      protectedChannel: false,
      copy: '标准数据处理等级',
    },
  };

  const fromPreview = projectLiveRouteDecision(flat);
  assert.ok(fromPreview);
  assert.equal(fromPreview?.hardFilterPassed[0], 'dep-a');
  assert.equal(fromPreview?.acceptanceBranch.decision, 'complete');
  assert.equal(fromPreview?.maxCost?.evidenceSource, 'catalog');

  const fromExecute = projectLiveRouteDecision({
    simulator: flat,
    taskAudit: { ...flat, surface: 'task_audit' },
  });
  assert.ok(fromExecute);
  assert.equal(fromExecute?.surface, 'simulator');
  assert.equal(fromExecute?.sortRanked[0]?.deploymentId, 'dep-a');

  assert.equal(projectLiveRouteDecision(null), null);
  assert.equal(projectLiveRouteDecision({}), null);
});
