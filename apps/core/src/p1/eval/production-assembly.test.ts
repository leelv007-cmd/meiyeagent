/**
 * Production wiring tests for eval layers (V31-23 hard acceptance).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryOpsRollbackDrillStore } from '../ops-console/state-stores.js';
import { buildGateResult } from './verdict.js';
import { MemoryEvalVerdictStore } from './verdict-store.js';
import {
  createProductionEvalLayersAssembly,
  type ProductionEvalLayersPorts,
} from './production-assembly.js';
import { RecordingLangfuseEvalWriter } from './langfuse-eval-writer.js';

function ports(
  overrides: Partial<ProductionEvalLayersPorts> = {},
): ProductionEvalLayersPorts {
  return {
    releases: {
      async getArtifact(id) {
        if (id !== 'release-prod-1') return null;
        return { evalSuiteRevision: 'eval/prod-1' } as never;
      },
    },
    verdicts: new MemoryEvalVerdictStore(),
    langfuseWriter: new RecordingLangfuseEvalWriter(),
    rollbackDrills: new MemoryOpsRollbackDrillStore(),
    ...overrides,
  };
}

test('production assembly fails closed when releases, verdicts, or langfuseWriter missing', () => {
  assert.throws(
    () =>
      createProductionEvalLayersAssembly({
        releases: undefined as never,
        verdicts: new MemoryEvalVerdictStore(),
        langfuseWriter: new RecordingLangfuseEvalWriter(),
      }),
    /releases/u,
  );
  assert.throws(
    () =>
      createProductionEvalLayersAssembly({
        releases: { async getArtifact() { return null; } },
        verdicts: undefined as never,
        langfuseWriter: new RecordingLangfuseEvalWriter(),
      }),
    /verdicts/u,
  );
  assert.throws(
    () =>
      createProductionEvalLayersAssembly({
        releases: { async getArtifact() { return null; } },
        verdicts: new MemoryEvalVerdictStore(),
        langfuseWriter: undefined as never,
      }),
    /langfuseWriter/u,
  );
});

test('production assembly samples, binds, emits Langfuse, and reads drills', async () => {
  const drills = new MemoryOpsRollbackDrillStore();
  await drills.appendRollbackDrill({
    id: 'drill-1',
    releaseId: 'release-prod-1',
    operatorId: 'admin-1',
    reason: 'canary rollback drill',
    evidence: 'ops-runbook-pass',
    result: 'passed',
    notes: null,
    createdAt: '2026-08-08T04:00:00.000Z',
  });
  const writer = new RecordingLangfuseEvalWriter();
  const assembly = createProductionEvalLayersAssembly(
    ports({ rollbackDrills: drills, langfuseWriter: writer }),
  );

  assert.ok(assembly.listDatasets().length >= 1);
  assert.ok(assembly.listL0Gaps().length >= 1);

  const { result, langfuseEvents } = await assembly.recordAndEmit({
    harnessReleaseId: 'release-prod-1',
    layer: 'l1',
    resultId: 'prod-result-1',
    createdAt: '2026-08-08T05:00:00.000Z',
    datasetRevision: 'l1-intent@1',
    gates: [
      buildGateResult({ id: 'g-f', kind: 'fidelity', passed: true }),
      buildGateResult({ id: 'g-r', kind: 'rights', passed: true }),
      buildGateResult({ id: 'g-rl', kind: 'redline', passed: true }),
    ],
  });
  assert.equal(result.evalSuiteRevision, 'eval/prod-1');
  assert.equal(result.verdict, 'passed');
  assert.ok(langfuseEvents >= 1);
  assert.equal(writer.written.length, 1);
  assert.deepEqual(writer.written[0]?.tags, ['releaseId:release-prod-1']);

  const readiness = await assembly.assessCanaryReadiness('release-prod-1');
  assert.equal(readiness.hasPassedRollbackDrill, true);
  assert.equal(readiness.latestDrillId, 'drill-1');
  assert.equal(readiness.autoPromoteAllowed, false);
  assert.equal(readiness.latestEvalVerdict, 'passed');
  assert.equal(readiness.higherLayers.length, 2);
});
