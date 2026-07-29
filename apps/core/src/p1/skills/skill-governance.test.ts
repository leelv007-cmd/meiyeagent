import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { HarnessFrozenPrompt } from '../harness/langfuse-prompts.js';
import { MemorySkillRepository } from './repository.js';
import { SkillService } from './service.js';

const BASE_TIME = '2026-07-30T02:00:00.000Z';
const APPLY_TIME = '2026-07-30T02:01:00.000Z';
const PROMPT_CONTENT = 'Use grounded industry facts.';
const PROMPT: HarnessFrozenPrompt = {
  content: PROMPT_CONTENT,
  contentHash: sha256(PROMPT_CONTENT),
  isFallback: false,
  label: 'production',
  name: 'harness/intent-naming',
  source: 'langfuse',
  version: '42',
};

test('mixed governance patch creates one immutable draft and strips protected fields without auditing values', async () => {
  const { base, repository } = await seedSkill();
  const governance = new SkillService(
    repository,
    () => APPLY_TIME,
  );

  const result = await governance.applyGovernanceRevision({
    actorId: 'platform-admin-2',
    baseSkillRevisionRef: base.skillRevisionRef,
    expectedHeadRevision: 1,
    patch: {
      'governance.fallback': 'fail_closed-private-value',
      instruction: 'Safer operator instruction',
      'manifest.description': 'Safer operator description',
    },
    runId: 'skill-governance-run-1',
    workspaceId: 'platform-operations',
  });

  assert.deepEqual(result, {
    applied: true,
    runId: 'skill-governance-run-1',
    success: true,
    validationResults: [
      {
        fieldPath: 'governance.fallback',
        reasonCode: 'field_not_editable',
        status: 'stripped',
      },
      {
        fieldPath: 'instruction',
        reasonCode: 'field_applied',
        status: 'applied',
      },
      {
        fieldPath: 'manifest.description',
        reasonCode: 'field_applied',
        status: 'applied',
      },
    ],
  });
  const draft = await repository.getRevision('skills/daily-industry@2');
  assert.equal(draft?.formatVersion, 2);
  if (!draft || draft.formatVersion !== 2) {
    assert.fail('Expected a v2 governance draft.');
  }
  assert.equal(draft.instruction, 'Safer operator instruction');
  assert.equal(draft.manifest.description, 'Safer operator description');
  assert.equal(draft.governance.fallback, 'skip');

  const inspected = await governance.inspectGovernanceRun(
    'skill-governance-run-1',
  );
  assert.equal(inspected?.status, 'completed');
  assert.doesNotMatch(
    JSON.stringify(inspected?.auditEntries),
    /fail_closed-private-value|Safer operator instruction|Safer operator description/u,
  );
});

test('an all-protected patch completes without applying or creating a revision', async () => {
  const { base, repository } = await seedSkill();
  const governance = new SkillService(repository, () => APPLY_TIME);

  const result = await governance.applyGovernanceRevision({
    actorId: 'platform-admin-2',
    baseSkillRevisionRef: base.skillRevisionRef,
    expectedHeadRevision: 1,
    patch: {
      'governance.fallback': 'fail_closed-private-value',
    },
    runId: 'skill-governance-run-all-stripped',
    workspaceId: 'platform-operations',
  });

  assert.deepEqual(result, {
    applied: false,
    runId: 'skill-governance-run-all-stripped',
    success: true,
    validationResults: [
      {
        fieldPath: 'governance.fallback',
        reasonCode: 'field_not_editable',
        status: 'stripped',
      },
    ],
  });
  assert.equal(
    await repository.getRevision('skills/daily-industry@2'),
    null,
  );
});

test('a stale head records a non-applying CAS result and replays it idempotently', async () => {
  const { base, repository } = await seedSkill();
  await repository.putRevision(
    {
      ...structuredClone(base),
      contentHash: 'concurrent-content-hash',
      createdAt: '2026-07-30T02:00:30.000Z',
      revision: 2,
      skillRevisionRef: 'skills/daily-industry@2',
    },
    1,
  );
  const governance = new SkillService(repository, () => APPLY_TIME);
  const request = {
    actorId: 'platform-admin-2',
    baseSkillRevisionRef: base.skillRevisionRef,
    expectedHeadRevision: 1,
    patch: {
      instruction: 'Stale operator instruction',
    },
    runId: 'skill-governance-run-cas',
    workspaceId: 'platform-operations',
  };

  const first = await governance.applyGovernanceRevision(request);
  const replay = await governance.applyGovernanceRevision(request);

  assert.deepEqual(first, {
    applied: false,
    runId: 'skill-governance-run-cas',
    success: true,
    validationResults: [
      {
        fieldPath: 'instruction',
        reasonCode: 'cas_conflict',
        status: 'not_applied',
      },
    ],
  });
  assert.deepEqual(replay, first);
  assert.equal(
    await repository.getRevision('skills/daily-industry@3'),
    null,
  );
  await assert.rejects(
    governance.applyGovernanceRevision({
      ...request,
      patch: {
        instruction: 'Different stale instruction',
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('concurrent retries with the same run ID create exactly one draft', async () => {
  const { base, repository } = await seedSkill();
  const governance = new SkillService(repository, () => APPLY_TIME);
  const request = {
    actorId: 'platform-admin-2',
    baseSkillRevisionRef: base.skillRevisionRef,
    expectedHeadRevision: 1,
    patch: {
      instruction: 'Concurrent operator instruction',
    },
    runId: 'skill-governance-run-concurrent',
    workspaceId: 'platform-operations',
  };

  const results = await Promise.all([
    governance.applyGovernanceRevision(request),
    governance.applyGovernanceRevision(request),
  ]);

  assert.deepEqual(results[0], results[1]);
  assert.equal(
    (await repository.listRevisions('skills/daily-industry', 10)).length,
    2,
  );
});

async function seedSkill() {
  const repository = new MemorySkillRepository();
  const service = new SkillService(
    repository,
    () => BASE_TIME,
    {
      async capture() {
        return structuredClone(PROMPT);
      },
    },
  );
  await service.defineCatalogEntry({
    actorId: 'platform-admin-1',
    description: 'Original description',
    name: 'Daily industry copy',
    presentationPolicy: 'explainable',
    skillId: 'skills/daily-industry',
    sourceKind: 'authored',
    tier: 'industry',
  });
  const base = await service.draftRevision({
    actorId: 'platform-admin-1',
    expectedRevision: null,
    governance: {
      budget: {
        maxChildEffects: 2,
        maxCostCents: 5,
        timeoutMs: 10_000,
      },
      contextScopes: ['industry_category'],
      executionMode: 'prompt_materialized',
      fallback: 'skip',
      inputSchemaRef: 'skill-input.daily-industry@1',
      outputSchemaRef: 'skill-output.intent-decision@1',
      requiredModelCapabilities: ['structured_output'],
      sideEffectClass: 'none',
      workflowRevisionRefs: ['workflow.daily-copy@1'],
    },
    instruction: 'Original instruction',
    manifest: {
      description: 'Original description',
      name: 'daily-industry',
    },
    promptReference: {
      contentHash: PROMPT.contentHash,
      name: PROMPT.name,
      version: PROMPT.version,
    },
    skillId: 'skills/daily-industry',
  });
  return { base, repository };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
