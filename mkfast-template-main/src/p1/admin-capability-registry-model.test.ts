import assert from 'node:assert/strict';
import test from 'node:test';
import { CAPABILITY_INVENTORY } from '@/p1/capability-inventory';
import {
  REQUIRED_SIX_QUESTION_KEYS,
  SIX_QUESTION_KEYS,
  assertNoSyntheticZeroHealth,
  buildCapabilityDependencyTable,
  buildCapabilityRegistry,
  buildRegistryEntry,
  formatMetricEnvelope,
  getProjection,
  getRegistryEntry,
  isDeepCapabilityId,
  lookupDependencies,
  lookupDependents,
  projectSixQuestionCompleteness,
  unknownMetric,
} from './admin-capability-registry-model';

test('builds registry covering every CAPABILITY_INVENTORY item', () => {
  const view = buildCapabilityRegistry();
  assert.equal(view.inventory.revision, CAPABILITY_INVENTORY.revision);
  assert.equal(view.entries.length, CAPABILITY_INVENTORY.items.length);
  assert.equal(view.projections.length, CAPABILITY_INVENTORY.items.length);

  for (const item of CAPABILITY_INVENTORY.items) {
    const entry = getRegistryEntry(view, item.id);
    assert.ok(entry, `missing entry for ${item.id}`);
    assert.equal(entry.purpose, item.purpose);
    assert.equal(entry.owner, item.owner);
    assert.equal(entry.drilldownKey, item.drilldownKey);
    assert.deepEqual(entry.dependencyRefs, item.criticalDependencies);
  }
});

test('six-question completeness holds for every inventory capability', () => {
  const view = buildCapabilityRegistry();

  for (const projection of view.projections) {
    assert.ok(
      projection.requiredComplete,
      `${projection.capabilityId} must complete Q1–Q3,Q5,Q6; got ${JSON.stringify(projection.questions)}`
    );

    for (const key of REQUIRED_SIX_QUESTION_KEYS) {
      assert.equal(
        projection.questions[key].status,
        'complete',
        `${projection.capabilityId}.${key} must be complete`
      );
    }

    for (const key of SIX_QUESTION_KEYS) {
      assert.ok(
        projection.questions[key],
        `${projection.capabilityId} missing question ${key}`
      );
      assert.ok(
        projection.questions[key].summary.length > 0,
        `${projection.capabilityId}.${key} summary empty`
      );
    }
  }
});

test('not_instrumented only replaces runtime facts (Q4), never other five', () => {
  const view = buildCapabilityRegistry();
  const stubs = view.entries.filter(
    (entry) =>
      entry.instrumentStatus === 'stub' ||
      entry.instrumentStatus === 'not_instrumented' ||
      entry.instrumentStatus === 'not_in_scope_for_supply_v1'
  );
  assert.ok(stubs.length > 0, 'expected stub domains');

  for (const entry of stubs) {
    const item = CAPABILITY_INVENTORY.items.find((row) => row.id === entry.id);
    const projection = projectSixQuestionCompleteness(
      entry,
      item?.name ?? entry.id
    );

    assert.equal(
      projection.questions.runtimeFacts.status,
      'not_instrumented',
      `${entry.id} Q4 must be not_instrumented`
    );

    for (const key of REQUIRED_SIX_QUESTION_KEYS) {
      assert.equal(
        projection.questions[key].status,
        'complete',
        `${entry.id}.${key} must remain complete under not_instrumented runtime`
      );
    }

    // Runtime facts use honest unknown envelopes, not synthetic zeros.
    assert.equal(entry.runtimeFacts?.calls?.status, 'unknown');
    if (entry.runtimeFacts?.calls?.status === 'unknown') {
      assert.equal(entry.runtimeFacts.calls.reason, 'not_instrumented');
    }
  }
});

test('audio remains visible as not_in_scope_for_supply_v1 with six-question carrier', () => {
  const view = buildCapabilityRegistry();
  const audio = getRegistryEntry(view, 'generation_audio');
  assert.ok(audio);
  assert.equal(audio.instrumentStatus, 'not_in_scope_for_supply_v1');
  assert.equal(audio.availability, 'not_instrumented');
  assert.ok(audio.purpose.length > 0);
  assert.ok(audio.owner.length > 0);
  assert.ok(audio.drilldownKey.includes('audio'));

  const projection = getProjection(view, 'generation_audio');
  assert.ok(projection);
  assert.equal(projection.requiredComplete, true);
  assert.equal(projection.questions.runtimeFacts.status, 'not_instrumented');
});

test('deepens model-supply / job-queue / entitlements self-reports', () => {
  const view = buildCapabilityRegistry();
  const deepIds = [
    'model_supply_routing_quality',
    'generation_copy',
    'generation_image',
    'generation_video',
    'job_queue_harness',
    'entitlements_billing_redemption',
  ];

  for (const id of deepIds) {
    assert.ok(isDeepCapabilityId(id));
    const entry = getRegistryEntry(view, id);
    assert.ok(entry, id);
    assert.equal(entry.instrumentStatus, 'instrumented');
    assert.ok(entry.config?.revisionId);
    assert.ok(entry.config?.effectiveScope);
    assert.ok(entry.runtimeFacts);
    assert.ok((entry.recentEvidenceRefs?.length ?? 0) > 0);
    assert.ok((entry.allowedSafeActions?.length ?? 0) > 0);
    assert.ok(entry.technicalHandoff?.deepLink);

    const projection = getProjection(view, id);
    assert.ok(projection);
    assert.equal(projection.requiredComplete, true);
    // Instrumented domains expose runtime fact structure (may be all-unknown).
    assert.equal(projection.questions.runtimeFacts.status, 'complete');
  }

  const entitlements = getRegistryEntry(
    view,
    'entitlements_billing_redemption'
  );
  assert.equal(
    entitlements?.runtimeFacts?.entitlementHeadroom?.status,
    'unknown'
  );
});

test('dependency table supports forward and reverse lookup without propagation', () => {
  const edges = buildCapabilityDependencyTable();
  assert.ok(edges.length > 0);

  const modelDeps = lookupDependencies('model_supply_routing_quality', edges);
  assert.ok(modelDeps.some((edge) => edge.dependsOnId === 'job_queue_harness'));
  assert.ok(modelDeps.every((edge) => edge.relation === 'requires'));

  const dependents = lookupDependents('job_queue_harness', edges);
  assert.ok(
    dependents.some(
      (edge) => edge.capabilityId === 'model_supply_routing_quality'
    )
  );
  assert.ok(
    dependents.some((edge) => edge.capabilityId === 'generation_video')
  );

  // Static table only — no severity field / propagation metadata.
  for (const edge of edges) {
    assert.equal(typeof edge.capabilityId, 'string');
    assert.equal(typeof edge.dependsOnId, 'string');
    assert.ok(
      ['requires', 'observes', 'configured_by'].includes(edge.relation)
    );
  }
});

test('formatMetricEnvelope never fabricates zero for unknown metrics', () => {
  assert.equal(formatMetricEnvelope(undefined), 'unknown (metric_absent)');
  assert.equal(
    formatMetricEnvelope(unknownMetric('domain_reporter_not_wired')),
    'unknown (domain_reporter_not_wired)'
  );
  assert.equal(formatMetricEnvelope({ status: 'known', value: 3 }), '3');
  // Explicit known zero is allowed; synthetic_default scope is flagged.
  assert.equal(formatMetricEnvelope({ status: 'known', value: 0 }), '0');

  const entry = buildRegistryEntry(
    CAPABILITY_INVENTORY.items.find((item) => item.id === 'job_queue_harness')!
  );
  assert.deepEqual(assertNoSyntheticZeroHealth(entry), []);
});

test('missing required six-question fields fail completeness projection', () => {
  const item = CAPABILITY_INVENTORY.items.find(
    (row) => row.id === 'account_auth'
  )!;
  const broken = {
    ...buildRegistryEntry(item),
    purpose: '',
    config: undefined,
    recentEvidenceRefs: [],
    allowedSafeActions: undefined,
    technicalHandoff: undefined,
  };
  const projection = projectSixQuestionCompleteness(broken, item.name);
  assert.equal(projection.requiredComplete, false);
  assert.equal(projection.questions.purposeStatus.status, 'missing');
  assert.equal(projection.questions.configRevisionScope.status, 'missing');
  assert.equal(projection.questions.recentEvidence.status, 'missing');
  assert.equal(projection.questions.safeActionsHandoff.status, 'missing');
  // Q4 still not_instrumented for stub.
  assert.equal(projection.questions.runtimeFacts.status, 'not_instrumented');
});
