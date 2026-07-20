import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSharedExplanationProjection,
  buildDemoRouteExplanationFacts,
  buildDemoRouteSimulatorPanel,
  buildRouteDecisionExplanationView,
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
