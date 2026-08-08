/**
 * L0.5 production sampling + release binding tests (V31-23).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { HarnessReleaseArtifact } from '@meiye/contracts';

import {
  createSessionBehaviorQuickCheckRegistry,
  type QuickCheckTrace,
} from '../agent-session/quick-checks.js';
import { P1DomainError } from '../foundation/domain.js';
import {
  createDefaultProductionQuickCheckSampler,
  quickChecksToProxyGates,
} from './production-sampling.js';
import { MemoryEvalVerdictStore } from './verdict-store.js';

function artifact(releaseId: string): HarnessReleaseArtifact {
  return {
    schemaVersion: 'harness-release-artifact/v1',
    releaseId,
    version: 1,
    manifestHash: 'a'.repeat(64),
    agentSessionHarnessVersion: 'session/1',
    makeHarnessVersion: 'make/1',
    middlewareBindings: [
      {
        policyId: 'policy-1',
        revision: '1',
        kind: 'session',
        order: 0,
        allowedControlActions: ['continue', 'end_turn'],
      },
    ],
    controlLimits: {
      maxLlmSteps: 8,
      maxToolCalls: 8,
      maxRetrievalCalls: 4,
      maxMerchantQuestions: 3,
      maxReplans: 2,
      maxSchemaRepairs: 2,
      maxContextTokens: 8000,
      maxDelegations: 1,
    },
    supervisorPolicyRef: { id: 'sup', revision: 1 },
    memoryPolicyRef: { id: 'mem', revision: 1 },
    contextCompilerRef: { id: 'ctx', revision: 1 },
    planSchemaRevision: 'plan/1',
    promptBindings: {},
    promptPackBindings: {},
    schemaBindings: {},
    skillBindings: {},
    toolPolicyRevision: 'tool/1',
    modelPolicyRevision: 'model/1',
    factPolicyRevision: 'fact/1',
    rightsPolicyRevision: 'rights/1',
    budgetPolicyRevision: 'budget/1',
    evalSuiteRevision: 'eval/sampling-1',
    createdAt: '2026-08-08T00:00:00.000Z',
  } as unknown as HarnessReleaseArtifact;
}

test('quickChecksToProxyGates fails fidelity when any check fails', () => {
  const gates = quickChecksToProxyGates([
    { id: 'a', passed: true },
    { id: 'b', passed: false, reason: 'nope' },
  ]);
  assert.equal(gates.find((g) => g.kind === 'fidelity')?.passed, false);
  assert.equal(gates.find((g) => g.kind === 'rights')?.passed, true);
});

test('production sampler binds verdict to release evalSuiteRevision', async () => {
  const releases = new Map([['release-s1', artifact('release-s1')]]);
  const store = new MemoryEvalVerdictStore();
  const sampler = createDefaultProductionQuickCheckSampler({
    releases: {
      async getArtifact(id) {
        return releases.get(id) ?? null;
      },
    },
    verdicts: store,
    registry: createSessionBehaviorQuickCheckRegistry(),
  });

  const goodTrace: QuickCheckTrace = {
    toolCalls: [
      { toolName: 'read_context' },
      { toolName: 'generate' },
      { toolName: 'check' },
      { toolName: 'record' },
    ],
    llmCallCount: 0,
    tags: ['level0'],
    output: { merchantMessage: 'ok' },
  };

  const outcome = await sampler.sample({
    harnessReleaseId: 'release-s1',
    trace: goodTrace,
    sampleTraceId: 'trace-1',
    resultId: 'sample-result-1',
    createdAt: '2026-08-08T01:00:00.000Z',
  });

  assert.equal(outcome.result.harnessReleaseId, 'release-s1');
  assert.equal(outcome.result.evalSuiteRevision, 'eval/sampling-1');
  assert.equal(outcome.result.layer, 'l0.5');
  assert.equal(outcome.result.verdict, 'passed');
  assert.equal(outcome.result.releasable, true);
  assert.ok((outcome.result.quickCheckIds?.length ?? 0) > 0);

  const listed = await store.listByRelease('release-s1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.resultId, 'sample-result-1');
});

test('production sampler fails closed when release missing', async () => {
  const sampler = createDefaultProductionQuickCheckSampler({
    releases: { async getArtifact() { return null; } },
    verdicts: new MemoryEvalVerdictStore(),
  });
  await assert.rejects(
    sampler.sample({
      harnessReleaseId: 'missing',
      trace: { toolCalls: [] },
    }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'NOT_FOUND',
  );
});
