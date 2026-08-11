/**
 * HarnessRelease P1 action-boundary tests (V31-21).
 * Seam: immutability, manifestHash, unset limit reject, missing pin reject,
 * per-run full candidate selection, allowlist canary, rollback freeze semantics,
 * readable release diff.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentControlLimits } from '@meiye/contracts';

import {
  assertIntentRetrievalBindingsPinned,
  createDefaultIntentRetrievalBindings,
} from '../agent-session/intent-retrieval-policies.js';
import { P1DomainError } from '../foundation/domain.js';
import {
  HARNESS_PROMPT_PACKS,
  HARNESS_PROMPT_PACK_IDS,
  REGISTERED_PLATFORM_SKILL_IDS,
  defaultPromptPackBindings,
  promptKeysForAllPacks,
  validateReleasePromptPublish,
  validateReleaseSkillPublish,
} from './prompt-packs.js';
import {
  HarnessReleaseService,
  MemoryHarnessReleaseStore,
  assertControlLimitsFullySet,
  computeHarnessReleaseManifestHash,
  diffHarnessReleaseArtifacts,
  type PublishHarnessReleaseInput,
} from './harness-release.js';
import {
  ensureSeedProductionRelease,
  seedHarnessReleaseManifest,
  SEED_HARNESS_RELEASE_ID,
} from './seed-harness-release.js';
import { resolveSessionRunRelease } from './session-run-release.js';

const TS = '2026-08-08T12:00:00.000Z';

const CONTROL_LIMITS: AgentControlLimits = {
  maxLlmSteps: 6,
  maxToolCalls: 8,
  maxRetrievalCalls: 4,
  maxMerchantQuestions: 1,
  maxReplans: 3,
  maxSchemaRepairs: 1,
  maxContextTokens: 32_000,
  maxDelegations: 2,
};

function fullPromptBindings(): PublishHarnessReleaseInput['promptBindings'] {
  const bindings: PublishHarnessReleaseInput['promptBindings'] = {};
  for (const key of promptKeysForAllPacks()) {
    bindings[key] = { key, version: `${key}@v1` };
  }
  return bindings;
}

function basePublish(
  releaseId: string,
  overrides: Partial<PublishHarnessReleaseInput> = {},
): PublishHarnessReleaseInput {
  return {
    releaseId,
    version: 1,
    agentSessionHarnessVersion: 'session/1',
    makeHarnessVersion: 'make/1',
    middlewareBindings: [
      {
        policyId: 'tenant-gate',
        revision: '1',
        kind: 'wrap_tool_call',
        order: 0,
        allowedControlActions: ['continue', 'end_turn'],
      },
      // assertIntentRetrievalBindingsPinned (intent-retrieval-policies.ts)
      // fails closed on any release missing these three — every fixture
      // release must carry them, not just the seeded production one.
      ...createDefaultIntentRetrievalBindings(),
    ],
    controlLimits: { ...CONTROL_LIMITS },
    supervisorPolicyRef: { id: 'sup', revision: '1' },
    memoryPolicyRef: { id: 'mem', revision: '1' },
    contextCompilerRef: { id: 'ctx', revision: '1' },
    planSchemaRevision: 'plan-schema/v1',
    promptBindings: fullPromptBindings(),
    promptPackBindings: defaultPromptPackBindings(),
    schemaBindings: { notePlan: 'note-plan/v1' },
    skillBindings: {
      'skill.beauty-copywriting': [
        { skillId: 'skill.beauty-copywriting', revision: '1' },
      ],
      'skill.capture-store-workflow': [
        { skillId: 'skill.capture-store-workflow', revision: '1' },
      ],
      'copy-skill': [{ skillId: 'copy-skill', revision: '1' }],
    },
    toolPolicyRevision: 'tool/1',
    modelPolicyRevision: 'model/1',
    factPolicyRevision: 'fact/1',
    rightsPolicyRevision: 'rights/1',
    budgetPolicyRevision: 'budget/1',
    evalSuiteRevision: 'eval/1',
    createdAt: TS,
    ...overrides,
  };
}

function createService() {
  const store = new MemoryHarnessReleaseStore();
  return { store, service: new HarnessReleaseService(store) };
}

test('assertControlLimitsFullySet rejects unset keys (U11)', () => {
  assert.deepEqual(assertControlLimitsFullySet(CONTROL_LIMITS), CONTROL_LIMITS);
  assert.throws(
    () =>
      assertControlLimitsFullySet({
        ...CONTROL_LIMITS,
        maxLlmSteps: undefined,
      }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      error.message.includes('maxLlmSteps'),
  );
  assert.throws(
    () =>
      assertControlLimitsFullySet({
        ...CONTROL_LIMITS,
        maxToolCalls: null,
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.message.includes('maxToolCalls'),
  );
  assert.throws(
    () => assertControlLimitsFullySet(null),
    (error: unknown) => error instanceof P1DomainError,
  );
});

test('publish creates immutable artifact with stable manifestHash and non-empty controlLimits', async () => {
  const { service } = createService();
  const published = await service.publishArtifact(basePublish('rel-a'));
  assert.equal(published.artifact.releaseId, 'rel-a');
  assert.equal(published.lifecycle.status, 'draft');
  assert.deepEqual(published.rollout.workspaceAllowlist, []);
  assert.ok(published.artifact.manifestHash.length >= 32);
  assert.equal(published.artifact.controlLimits.maxLlmSteps, 6);

  const expectedHash = computeHarnessReleaseManifestHash({
    agentSessionHarnessVersion: published.artifact.agentSessionHarnessVersion,
    makeHarnessVersion: published.artifact.makeHarnessVersion,
    middlewareBindings: published.artifact.middlewareBindings,
    controlLimits: published.artifact.controlLimits,
    supervisorPolicyRef: published.artifact.supervisorPolicyRef,
    memoryPolicyRef: published.artifact.memoryPolicyRef,
    contextCompilerRef: published.artifact.contextCompilerRef,
    planSchemaRevision: published.artifact.planSchemaRevision,
    promptBindings: published.artifact.promptBindings,
    promptPackBindings: published.artifact.promptPackBindings,
    schemaBindings: published.artifact.schemaBindings,
    skillBindings: published.artifact.skillBindings,
    toolPolicyRevision: published.artifact.toolPolicyRevision,
    modelPolicyRevision: published.artifact.modelPolicyRevision,
    factPolicyRevision: published.artifact.factPolicyRevision,
    rightsPolicyRevision: published.artifact.rightsPolicyRevision,
    budgetPolicyRevision: published.artifact.budgetPolicyRevision,
    evalSuiteRevision: published.artifact.evalSuiteRevision,
  });
  assert.equal(published.artifact.manifestHash, expectedHash);

  // Idempotent same-payload re-publish.
  const again = await service.publishArtifact(basePublish('rel-a'));
  assert.equal(again.artifact.manifestHash, published.artifact.manifestHash);

  // Different payload same releaseId → immutability conflict.
  await assert.rejects(
    service.publishArtifact(
      basePublish('rel-a', {
        toolPolicyRevision: 'tool/2',
      }),
    ),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'IDEMPOTENCY_CONFLICT',
  );

  // Exact restore path.
  const restored = await service.getExactRelease('rel-a');
  assert.deepEqual(restored, published.artifact);
  assert.ok(restored.controlLimits.maxDelegations >= 0);
});

test('production publish rejects an empty prompt pack manifest', async () => {
  const { service } = createService();
  await assert.rejects(
    service.publishArtifact(
      basePublish('rel-empty-pack', {
        promptBindings: {},
        promptPackBindings: {},
      }),
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      error.message.includes('prompt pack'),
  );
});

test('legacy empty immutable production is atomically replaced by exact-pin seed', async () => {
  const source = createService();
  const valid = await source.service.publishArtifact(basePublish('legacy-empty'));
  const store = new MemoryHarnessReleaseStore();
  await store.putArtifactImmutable({
    ...valid.artifact,
    promptBindings: {},
    promptPackBindings: {},
  });
  await store.putLifecycle({
    ...valid.lifecycle,
    status: 'production',
  });
  await store.putRollout(valid.rollout);
  const service = new HarnessReleaseService(store);

  await ensureSeedProductionRelease({ store, service });

  const production = await store.getLifecycleByStatus('production');
  assert.equal(production?.releaseId, SEED_HARNESS_RELEASE_ID);
  assert.equal((await store.getLifecycle('legacy-empty'))?.status, 'retired');
  const seed = await service.getExactRelease(SEED_HARNESS_RELEASE_ID);
  assert.ok(Object.keys(seed.promptPackBindings).length > 0);
  assert.ok(Object.values(seed.promptBindings).every((ref) => ref.version === '1'));
});

test('seeded production release owns its middleware; the assembly merge adds nothing', async () => {
  const store = new MemoryHarnessReleaseStore();
  const service = new HarnessReleaseService(store);
  await ensureSeedProductionRelease({ store, service });
  const seed = await service.getExactRelease(SEED_HARNESS_RELEASE_ID);

  assert.deepEqual(
    seed.middlewareBindings,
    createDefaultIntentRetrievalBindings(),
  );
  // The session port used by core-assembly must return the release's own
  // bindings unchanged; otherwise the assembly is a second authority.
  const resolved = await resolveSessionRunRelease({
    service,
    harnessReleaseId: SEED_HARNESS_RELEASE_ID,
  });
  assert.equal(resolved.releaseId, SEED_HARNESS_RELEASE_ID);
  assert.deepEqual(resolved.middlewareBindings, seed.middlewareBindings);
  // An incomplete release now fails closed — the seed being complete is what
  // lets the session port resolve it at all.
  assert.throws(
    () =>
      assertIntentRetrievalBindingsPinned({
        releaseId: 'incomplete-release',
        bindings: [],
      }),
    /does not pin required Intent\/retrieval middleware/u,
  );
});

test('an unknown frozen pin fails closed instead of falling back to production', async () => {
  const { store, service } = createService();
  await service.publishArtifact(basePublish('live-production'));
  await service.transitionLifecycle({
    releaseId: 'live-production',
    toStatus: 'evaluating',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'live-production',
    toStatus: 'canary',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'live-production',
    toStatus: 'production',
    now: TS,
  });
  assert.equal(
    (await store.getLifecycleByStatus('production'))?.releaseId,
    'live-production',
  );

  // Session port: a run pinned to a release this store never saw must fail,
  // not silently continue on the current production composition.
  await assert.rejects(
    resolveSessionRunRelease({
      service,
      harnessReleaseId: 'release-that-never-existed',
    }),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'NOT_FOUND' &&
      error.message.includes('release-that-never-existed'),
  );
  // Same fail-closed answer one level down, so neither layer can reintroduce it.
  await assert.rejects(
    service.resolveForRun({
      workspaceId: 'ws-any',
      frozenReleaseId: 'release-that-never-existed',
    }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'NOT_FOUND',
  );
  // A run with no pin at all still resolves the rollout normally.
  assert.equal(
    (await resolveSessionRunRelease({ service })).releaseId,
    'live-production',
  );
});

test('rollback rejects draft and evaluating releases without production history', async () => {
  const { service } = createService();
  await service.publishArtifact(basePublish('never-production'));
  await assert.rejects(
    service.rollbackProduction({ toReleaseId: 'never-production' }),
    /must be retired/,
  );
  await service.transitionLifecycle({
    releaseId: 'never-production',
    toStatus: 'evaluating',
  });
  await assert.rejects(
    service.rollbackProduction({ toReleaseId: 'never-production' }),
    /must be retired/,
  );
});

test('retired release without authoritative history is isolated until explicitly authorized', async () => {
  const { service } = createService();
  await service.publishArtifact(basePublish('retired-unproven'));
  await service.transitionLifecycle({
    releaseId: 'retired-unproven',
    toStatus: 'retired',
  });

  await assert.rejects(
    service.rollbackProduction({ toReleaseId: 'retired-unproven' }),
    /no prior production identity/,
  );
  await service.authorizeProductionHistory({
    releaseId: 'retired-unproven',
    promotedAt: TS,
  });
  const rolled = await service.rollbackProduction({
    toReleaseId: 'retired-unproven',
  });
  assert.equal(rolled.production.releaseId, 'retired-unproven');
});

test('publish rejects unset controlLimits (U11)', async () => {
  const { service } = createService();
  const partial = { ...CONTROL_LIMITS } as Record<string, number | undefined>;
  delete partial.maxReplans;
  await assert.rejects(
    service.publishArtifact(
      basePublish('rel-unset', {
        controlLimits: partial,
      }),
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      error.message.includes('maxReplans'),
  );
});

test('publish rejects missing prompt pin via validateReleasePromptPublish', async () => {
  const { service } = createService();
  const bindings = fullPromptBindings();
  delete bindings.briefImage;
  await assert.rejects(
    service.publishArtifact(
      basePublish('rel-pin', {
        promptBindings: bindings,
        promptPackBindings: {
          ...defaultPromptPackBindings(),
          media: [...HARNESS_PROMPT_PACKS.media],
        },
      }),
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.message.includes('briefImage') &&
      error.message.includes('prompt publish rejected'),
  );
});

test('publish rejects when referenced pack key lacks exact pin', async () => {
  const { service } = createService();
  // Full pack map but omit a pin that belongs to the copy pack.
  const bindings = fullPromptBindings();
  delete bindings.copyGeneration;
  await assert.rejects(
    service.publishArtifact(
      basePublish('rel-pack', {
        promptBindings: bindings,
      }),
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.message.includes('copyGeneration') &&
      error.message.includes('prompt publish rejected'),
  );
  assert.ok(HARNESS_PROMPT_PACK_IDS.includes('copy'));
});

test('publish rejects when a registered platform skill binding is missing (V31-38)', async () => {
  const { service } = createService();
  await assert.rejects(
    service.publishArtifact(
      basePublish('rel-skill-missing', {
        skillBindings: {
          'skill.beauty-copywriting': [
            { skillId: 'skill.beauty-copywriting', revision: '1' },
          ],
        },
      }),
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.message.includes('skill.capture-store-workflow') &&
      error.message.includes('skill publish rejected'),
  );
});

test('publish rejects synthetic or non-numeric skill revisions (V31-38)', async () => {
  const { service } = createService();
  for (const revision of ['plan_compile', 'latest', 'head', '']) {
    await assert.rejects(
      service.publishArtifact(
        basePublish(`rel-skill-synthetic-${revision || 'empty'}`, {
          skillBindings: {
            'skill.beauty-copywriting': [
              { skillId: 'skill.beauty-copywriting', revision },
            ],
            'skill.capture-store-workflow': [
              { skillId: 'skill.capture-store-workflow', revision: '1' },
            ],
          },
        }),
      ),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.message.includes('numeric skill revision') &&
        error.message.includes('skill publish rejected'),
    );
  }
});

test('publish rejects a skill binding whose key does not match the ref skillId (V31-38)', async () => {
  const { service } = createService();
  await assert.rejects(
    service.publishArtifact(
      basePublish('rel-skill-impersonation', {
        skillBindings: {
          'skill.beauty-copywriting': [
            { skillId: 'skill.capture-store-workflow', revision: '1' },
          ],
          'skill.capture-store-workflow': [
            { skillId: 'skill.capture-store-workflow', revision: '1' },
          ],
        },
      }),
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.message.includes('binding key must equal the skill id') &&
      error.message.includes('skill publish rejected'),
  );
});

test('seed release manifest passes constructive prompt + skill coverage (V31-38)', async () => {
  const seed = seedHarnessReleaseManifest();
  const promptGate = validateReleasePromptPublish({
    promptPackBindings: seed.promptPackBindings,
    promptBindings: seed.promptBindings,
  });
  assert.equal(promptGate.ok, true);
  const skillGate = validateReleaseSkillPublish({
    skillBindings: seed.skillBindings,
  });
  assert.equal(skillGate.ok, true);
  if (skillGate.ok) {
    assert.deepEqual(
      [...skillGate.requiredSkillIds].sort(),
      [...REGISTERED_PLATFORM_SKILL_IDS].sort(),
    );
  }
  const { service } = createService();
  const published = await service.publishArtifact(seed);
  assert.ok(
    published.artifact.skillBindings['skill.beauty-copywriting']?.[0]?.revision,
  );
});

test('per-run resolve selects full candidate only; frozen pin wins over production (U10)', async () => {
  const { service } = createService();
  await service.publishArtifact(basePublish('prod-1'));
  await service.transitionLifecycle({
    releaseId: 'prod-1',
    toStatus: 'evaluating',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'prod-1',
    toStatus: 'canary',
    approvedBy: 'ops',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'prod-1',
    toStatus: 'production',
    approvedBy: 'ops',
    now: TS,
  });

  await service.publishArtifact(
    basePublish('cand-1', {
      version: 2,
      toolPolicyRevision: 'tool/cand',
      createdAt: '2026-08-08T13:00:00.000Z',
    }),
  );

  const production = await service.resolveForRun({ workspaceId: 'ws-a' });
  assert.equal(production.selection, 'production');
  assert.equal(production.releaseId, 'prod-1');
  assert.ok(production.controlLimits.maxLlmSteps > 0);

  const candidate = await service.resolveForRun({
    workspaceId: 'ws-a',
    candidateReleaseId: 'cand-1',
  });
  assert.equal(candidate.selection, 'candidate');
  assert.equal(candidate.releaseId, 'cand-1');
  assert.equal(candidate.artifact.toolPolicyRevision, 'tool/cand');

  // In-flight freeze keeps old release even when candidate / production differ.
  const frozen = await service.resolveForRun({
    workspaceId: 'ws-a',
    frozenReleaseId: 'prod-1',
    candidateReleaseId: 'cand-1',
  });
  assert.equal(frozen.selection, 'frozen');
  assert.equal(frozen.releaseId, 'prod-1');
});

test('workspace allowlist canary hits candidate; non-allowlist stays production', async () => {
  const { service } = createService();
  await service.publishArtifact(basePublish('prod-2'));
  await service.transitionLifecycle({
    releaseId: 'prod-2',
    toStatus: 'evaluating',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'prod-2',
    toStatus: 'canary',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'prod-2',
    toStatus: 'production',
    now: TS,
  });

  await service.publishArtifact(
    basePublish('canary-2', {
      version: 2,
      modelPolicyRevision: 'model/canary',
      createdAt: '2026-08-08T14:00:00.000Z',
    }),
  );
  await service.transitionLifecycle({
    releaseId: 'canary-2',
    toStatus: 'evaluating',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'canary-2',
    toStatus: 'canary',
    now: TS,
  });
  await service.updateRollout({
    releaseId: 'canary-2',
    workspaceAllowlist: ['ws-canary'],
    now: TS,
  });

  const hit = await service.resolveForRun({ workspaceId: 'ws-canary' });
  assert.equal(hit.selection, 'canary_allowlist');
  assert.equal(hit.releaseId, 'canary-2');

  const miss = await service.resolveForRun({ workspaceId: 'ws-other' });
  assert.equal(miss.selection, 'production');
  assert.equal(miss.releaseId, 'prod-2');
});

test('rollback switches new tasks to prior production; frozen in-flight stays put', async () => {
  const { service } = createService();
  await service.publishArtifact(basePublish('r-old'));
  await service.transitionLifecycle({
    releaseId: 'r-old',
    toStatus: 'evaluating',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'r-old',
    toStatus: 'canary',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'r-old',
    toStatus: 'production',
    now: TS,
  });

  await service.publishArtifact(
    basePublish('r-new', {
      version: 2,
      evalSuiteRevision: 'eval/2',
      createdAt: '2026-08-08T15:00:00.000Z',
    }),
  );
  await service.transitionLifecycle({
    releaseId: 'r-new',
    toStatus: 'evaluating',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'r-new',
    toStatus: 'canary',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'r-new',
    toStatus: 'production',
    now: TS,
  });

  // Simulates in-flight task that started on r-new.
  const inFlight = await service.resolveForRun({
    workspaceId: 'ws-x',
    frozenReleaseId: 'r-new',
  });
  assert.equal(inFlight.releaseId, 'r-new');

  const rolled = await service.rollbackProduction({
    toReleaseId: 'r-old',
    approvedBy: 'ops',
    now: '2026-08-08T16:00:00.000Z',
  });
  assert.equal(rolled.production.releaseId, 'r-old');
  assert.equal(rolled.production.status, 'production');
  assert.equal(rolled.previousProduction?.releaseId, 'r-new');
  assert.equal(rolled.previousProduction?.status, 'retired');

  const newTask = await service.resolveForRun({ workspaceId: 'ws-x' });
  assert.equal(newTask.selection, 'production');
  assert.equal(newTask.releaseId, 'r-old');

  // In-flight still reads frozen r-new exact artifact (rollback did not rewrite pin).
  const stillInFlight = await service.resolveForRun({
    workspaceId: 'ws-x',
    frozenReleaseId: 'r-new',
  });
  assert.equal(stillInFlight.selection, 'frozen');
  assert.equal(stillInFlight.releaseId, 'r-new');
  assert.equal(stillInFlight.artifact.evalSuiteRevision, 'eval/2');
});

test('release diff is path-readable for binding changes', async () => {
  const { service } = createService();
  const a = await service.publishArtifact(basePublish('diff-a'));
  const b = await service.publishArtifact(
    basePublish('diff-b', {
      version: 2,
      toolPolicyRevision: 'tool/diff',
      controlLimits: { ...CONTROL_LIMITS, maxLlmSteps: 9 },
      createdAt: '2026-08-08T17:00:00.000Z',
    }),
  );

  const diff = await service.diffReleases('diff-a', 'diff-b');
  assert.equal(diff.leftReleaseId, 'diff-a');
  assert.equal(diff.rightReleaseId, 'diff-b');
  assert.notEqual(diff.leftManifestHash, diff.rightManifestHash);
  assert.ok(diff.changes.length >= 2);
  const paths = diff.changes.map((entry) => entry.path);
  assert.ok(paths.includes('toolPolicyRevision'));
  assert.ok(paths.includes('controlLimits.maxLlmSteps'));

  // Pure helper mirrors service.
  const pure = diffHarnessReleaseArtifacts(a.artifact, b.artifact);
  assert.deepEqual(pure.changes, diff.changes);
});

test('resolver always returns non-empty controlLimits from published artifact', async () => {
  const { service } = createService();
  await service.publishArtifact(basePublish('lim-1'));
  await service.transitionLifecycle({
    releaseId: 'lim-1',
    toStatus: 'evaluating',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'lim-1',
    toStatus: 'canary',
    now: TS,
  });
  await service.transitionLifecycle({
    releaseId: 'lim-1',
    toStatus: 'production',
    now: TS,
  });
  const resolved = await service.resolveForRun({ workspaceId: 'ws-lim' });
  for (const key of Object.keys(CONTROL_LIMITS) as (keyof AgentControlLimits)[]) {
    assert.equal(typeof resolved.controlLimits[key], 'number');
  }
});

test('resolveForRun works without workspaceId for frozen pins (session port, V31-21 P1-a)', async () => {
  const { service } = createService();
  await service.publishArtifact(basePublish('pin-1'));
  const frozen = await service.resolveForRun({ frozenReleaseId: 'pin-1' });
  assert.equal(frozen.selection, 'frozen');
  assert.equal(frozen.releaseId, 'pin-1');
  await assert.rejects(
    service.resolveForRun({}),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.message.includes('No production HarnessRelease is pinned'),
  );
});
