/**
 * V31-14 production live facts reader for DBOS fence seam.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPILED_EXECUTION_PLAN_SCHEMA_VERSION } from '@meiye/contracts';

import {
  buildExecutionPlanSnapshot,
  evaluateExecutionPlanStaleness,
  ExecutionPlanAdmissionError,
  freezeExecutionPlanContent,
  verifyExecutionPlanSnapshotForDbos,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import {
  createAuthoritativeExecutionPlanLiveFactsPorts,
  createResolveExecutionPlanLiveFacts,
  resolveExecutionPlanLiveFactsFromPorts,
} from './execution-plan-live-facts.js';
import {
  createProductionPlanCompilerPorts,
  type ProductionPlanRightsResolver,
} from '../agent-session/plan-compiler-production-ports.js';
import { ProductContentPackageRightsResolver } from '../operations/product-package-rights-adapter.js';

/**
 * V31-55: a rights resolver mock whose returned revision encodes exactly the
 * inputs the real ProductContentPackageRightsResolver's productRightsRevision
 * fingerprints (known/unauthorized asset ids, platform, requested asset ids).
 * `state` is mutable so a test can simulate a genuine rights change between
 * the compile-time (freeze) call and the verify-time (live) call.
 */
function platformSensitiveRightsResolver(state: {
  knownAssetIds: string[];
  unauthorizedAssetIds: string[];
}) {
  const resolveWithRevision = async (input: {
    workspaceId: string;
    assetIds: string[];
    platform?: string;
  }) => ({
    knownAssetIds: state.knownAssetIds,
    rightsRevision: `rights:${input.workspaceId}:${JSON.stringify({
      known: [...state.knownAssetIds].sort(),
      unauthorized: [...state.unauthorizedAssetIds].sort(),
      platform: input.platform ?? null,
      assetIds: [...input.assetIds].sort(),
    })}`,
    unauthorizedAssetIds: state.unauthorizedAssetIds,
  });
  return {
    async resolve(input: {
      workspaceId: string;
      assetIds: string[];
      platform?: string;
    }) {
      const { rightsRevision: _rightsRevision, ...rest } =
        await resolveWithRevision(input);
      return rest;
    },
    resolveWithRevision,
  };
}

function snapshot() {
  const content = {
    planId: 'plan-1',
    planRevision: 1,
    intentDeclaration: { summary: '推广' },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'ctx-hash-1',
    },
    executionPlan: {
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      units: [
        {
          unitId: 'unit-1',
          unitType: 'copy.generate',
          primitive: 'generate' as const,
        },
      ],
      dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
      boundedRetry: {
        'unit-1': {
          maxAttempts: 1,
          maxCostCents: 0,
          retry: { enabled: false as const },
        },
      },
    },
    deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: ['rights-1', 'rights-2'],
    factRevisionRefs: ['fact-1'],
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1' as const,
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: ['maxIterations', 'maxCostCents'] as const,
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: 'release-1',
    approvalBasis: 'policy_exempt_copy',
  } as unknown as ExecutionPlanFrozenContent;
  const { snapshotHash } = freezeExecutionPlanContent(content);
  return buildExecutionPlanSnapshot({ content, snapshotHash });
}

/**
 * Same shape as snapshot(), but with a caller-supplied deliverables list and
 * rightsRevisionRefs baked into the frozen content *before* hashing, so the
 * result's snapshotHash matches its own content (spreading overrides onto an
 * already-built snapshot would leave a stale hash and fail verification for
 * an unrelated reason).
 */
function snapshotWithDeliverablesAndRights(
  deliverables: ExecutionPlanFrozenContent['deliverables'],
  rightsRevisionRefs: readonly string[],
) {
  const content = {
    planId: 'plan-1',
    planRevision: 1,
    intentDeclaration: { summary: '推广' },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'ctx-hash-1',
    },
    executionPlan: {
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      units: [
        {
          unitId: 'unit-1',
          unitType: 'copy.generate',
          primitive: 'generate' as const,
        },
      ],
      dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
      boundedRetry: {
        'unit-1': {
          maxAttempts: 1,
          maxCostCents: 0,
          retry: { enabled: false as const },
        },
      },
    },
    deliverables,
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs,
    factRevisionRefs: [],
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1' as const,
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: ['maxIterations', 'maxCostCents'] as const,
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: 'release-1',
    approvalBasis: 'policy_exempt_copy',
  } as unknown as ExecutionPlanFrozenContent;
  const { snapshotHash } = freezeExecutionPlanContent(content);
  return buildExecutionPlanSnapshot({ content, snapshotHash });
}

test('revoked rights head → rightsRevoked true', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveRightsHeads() {
        return [
          { revisionId: 'rights-1', revoked: false },
          { revisionId: 'rights-2', revoked: true },
        ];
      },
      async resolveQuoteHead() {
        return { quoteId: 'quote-1', revision: 1 };
      },
      async resolveFactHeads() {
        return [{ factRevisionId: 'fact-1' }];
      },
    },
  });
  assert.equal(live.rightsRevoked, true);
  assert.deepEqual(live.rightsRevisionRefs, ['rights-1']);
  assert.equal(live.quoteRevision, 1);
});

test('missing rights head treated as revoked', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveRightsHeads() {
        return [{ revisionId: 'rights-1', revoked: false }];
      },
    },
  });
  assert.equal(live.rightsRevoked, true);
});

test('missing production head adapters fail closed instead of treating frozen refs as current', async () => {
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snapshot(),
    workspaceId: 'ws-1',
    ports: {},
  });
  assert.equal(live.rightsRevoked, true);
  assert.deepEqual(live.rightsRevisionRefs, []);
  assert.deepEqual(live.factRevisionRefs, []);
  assert.equal(live.contextDrifted, true);
  assert.notEqual(live.quoteRevision, snapshot().quoteRef.revision);
});

test('authoritative rights policy head replaces the frozen ref and requires reconfirmation', async () => {
  const frozen = {
    ...snapshot(),
    rightsRevisionRefs: ['rights:ws-1:policy-old'],
  };
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive() {
        return [];
      },
    },
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '用门店素材做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '用门店素材做图文',
          sourceSummaries: [],
        },
        assetReferences: ['asset-1'],
      },
    },
    rights: {
      async resolve() {
        return { knownAssetIds: ['asset-1'], unauthorizedAssetIds: [] };
      },
      async resolveWithRevision() {
        return {
          knownAssetIds: ['asset-1'],
          rightsRevision: 'rights:ws-1:policy-new',
          unauthorizedAssetIds: [],
        };
      },
    },
  });

  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: frozen,
    workspaceId: 'ws-1',
    ports,
  });

  assert.deepEqual(live.rightsRevisionRefs, ['rights:ws-1:policy-new']);
  assert.notEqual(live.rightsRevoked, true);
  const staleness = evaluateExecutionPlanStaleness({ snapshot: frozen, live });
  assert.equal(staleness.status, 'stale');
  assert.ok(
    staleness.status === 'stale' && staleness.diff.rightsRevisionRefs,
  );
});

test('unresolved quote and fact heads fail closed', async () => {
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snapshot(),
    workspaceId: 'ws-1',
    ports: {
      async resolveRightsHeads({ rightsRevisionRefs }) {
        return rightsRevisionRefs.map((revisionId) => ({
          revisionId,
          revoked: false,
        }));
      },
      async resolveQuoteHead() {
        return null;
      },
      async resolveFactHeads() {
        return [];
      },
    },
  });
  assert.notEqual(live.quoteRevision, snapshot().quoteRef.revision);
  assert.deepEqual(live.factRevisionRefs, []);
  assert.equal(live.contextDrifted, true);
});

test('missing quote head is projected as a fail-closed live fact', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveQuoteHead() {
        return null;
      },
    },
  });
  assert.equal(live.quoteMissing, true);
});

test('an authorized rights head revision advances without being classified as revoked', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveRightsHeads() {
        return [
          {
            frozenRevisionId: 'rights-1',
            revisionId: 'rights-3',
            revoked: false,
          },
          { revisionId: 'rights-2', revoked: false },
        ];
      },
    },
  });
  assert.equal(live.rightsRevoked, undefined);
  assert.deepEqual(live.rightsRevisionRefs, ['rights-3', 'rights-2']);
});

test('material price/date fact change sets contextDrifted', async () => {
  const snap = snapshot();
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: snap,
    workspaceId: 'ws-1',
    ports: {
      async resolveFactHeads() {
        return [
          { factRevisionId: 'fact-1', materialPriceOrDateChanged: true },
        ];
      },
    },
  });
  assert.equal(live.contextDrifted, true);
});

test('authoritative brief head detects a material store fact changed after freeze', async () => {
  const frozenAt = '2026-08-09T00:00:00.000Z';
  const currentAt = '2026-08-09T00:05:00.000Z';
  const frozenPrice = {
    factId: 'store-project:project-1:price',
    kind: 'price' as const,
    revision: 1,
    effectiveFrom: '2026-08-08T00:00:00.000Z',
    expiresAt: null,
  };
  const currentPrice = {
    ...frozenPrice,
    revision: 2,
    effectiveFrom: '2026-08-09T00:01:00.000Z',
  };
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive({ at }) {
        return [at === frozenAt ? frozenPrice : currentPrice] as never;
      },
    },
    now: () => currentAt,
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '做图文',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      executionSnapshot: {
        createdAt: frozenAt,
        briefContext: { id: 'brief-1', revision: 1 },
      } as never,
    },
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    },
  });

  const heads = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: ['brief:brief-1@1'],
  });

  assert.equal(heads[0]?.frozenRevisionId, 'brief:brief-1@1');
  assert.notEqual(heads[0]?.factRevisionId, 'brief:brief-1@1');
  assert.equal(heads[0]?.materialPriceOrDateChanged, true);
});

test('baselined material-head brief ref stays current when live material still matches (reconfirm admit)', async () => {
  const frozenAt = '2026-08-09T00:00:00.000Z';
  const currentAt = '2026-08-09T00:05:00.000Z';
  const frozenPrice = {
    factId: 'store-project:project-1:price',
    kind: 'price' as const,
    revision: 1,
    effectiveFrom: '2026-08-08T00:00:00.000Z',
    expiresAt: null,
  };
  const currentPrice = {
    ...frozenPrice,
    revision: 2,
    effectiveFrom: '2026-08-09T00:01:00.000Z',
  };
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive({ at }) {
        // First fence compares frozenAt vs now; baselined re-check only reads now.
        return [at === frozenAt ? frozenPrice : currentPrice] as never;
      },
    },
    now: () => currentAt,
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '做图文',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      executionSnapshot: {
        // Original compile time — still earlier than the price change. Without
        // material-head parsing this would re-trip the fence forever.
        createdAt: frozenAt,
        briefContext: { id: 'brief-1', revision: 1 },
      } as never,
    },
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    },
  });

  const first = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: ['brief:brief-1@1'],
  });
  const baselined = first[0]?.factRevisionId;
  assert.ok(baselined?.includes(':material-head:'));
  assert.equal(first[0]?.materialPriceOrDateChanged, true);

  const second = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: [baselined!],
  });
  assert.equal(second[0]?.factRevisionId, baselined);
  assert.notEqual(second[0]?.materialPriceOrDateChanged, true);

  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: {
      ...snapshot(),
      factRevisionRefs: [baselined!],
    },
    workspaceId: 'ws-1',
    ports,
  });
  assert.deepEqual(live.factRevisionRefs, [baselined]);
  assert.notEqual(live.contextDrifted, true);
});

test('baselined material-head brief ref re-drifts when material changes again', async () => {
  const frozenAt = '2026-08-09T00:00:00.000Z';
  const currentAt = '2026-08-09T00:10:00.000Z';
  let priceRevision = 2;
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive({ at }) {
        if (at === frozenAt) {
          return [
            {
              factId: 'store-project:project-1:price',
              kind: 'price' as const,
              revision: 1,
              effectiveFrom: '2026-08-08T00:00:00.000Z',
              expiresAt: null,
            },
          ] as never;
        }
        return [
          {
            factId: 'store-project:project-1:price',
            kind: 'price' as const,
            revision: priceRevision,
            effectiveFrom: '2026-08-09T00:01:00.000Z',
            expiresAt: null,
          },
        ] as never;
      },
    },
    now: () => currentAt,
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '做图文',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      executionSnapshot: {
        createdAt: frozenAt,
        briefContext: { id: 'brief-1', revision: 1 },
      } as never,
    },
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    },
  });

  const first = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: ['brief:brief-1@1'],
  });
  const baselined = first[0]?.factRevisionId;
  assert.ok(baselined?.includes(':material-head:'));

  priceRevision = 3;
  const again = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: [baselined!],
  });
  assert.notEqual(again[0]?.factRevisionId, baselined);
  assert.equal(again[0]?.materialPriceOrDateChanged, true);
  assert.match(String(again[0]?.factRevisionId), /:material-head:[a-f0-9]{16}$/u);
});

test('baselined identity-head ref stays current when live version still matches', async () => {
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive() {
        return [];
      },
    },
    identities: {
      async listActive() {
        return [{ identityId: 'identity-1', version: 2 }] as never;
      },
    },
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '用门店素材做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '用门店素材做图文',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    },
  });

  const first = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: ['identity:identity-1@1'],
  });
  assert.equal(
    first[0]?.factRevisionId,
    'identity:identity-1@1:identity-head:2',
  );
  assert.equal(first[0]?.materialPriceOrDateChanged, true);

  const second = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: ['identity:identity-1@1:identity-head:2'],
  });
  assert.equal(
    second[0]?.factRevisionId,
    'identity:identity-1@1:identity-head:2',
  );
  assert.notEqual(second[0]?.materialPriceOrDateChanged, true);
});

test('authoritative identity head treats an unresolvable ref as non-drifted, not a fence trip', async () => {
  const frozen = {
    ...snapshot(),
    factRevisionRefs: ['identity:identity-1@1'],
  };
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive() {
        return [];
      },
    },
    // No `identities` dependency wired at all — the port has no way to
    // resolve this ref one way or the other.
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '用门店素材做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '用门店素材做图文',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    } as unknown as ProductionPlanRightsResolver,
  });

  const heads = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: ['identity:identity-1@1'],
  });
  assert.equal(heads[0]?.frozenRevisionId, 'identity:identity-1@1');
  assert.equal(heads[0]?.factRevisionId, 'identity:identity-1@1');
  assert.notEqual(heads[0]?.materialPriceOrDateChanged, true);

  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: frozen,
    workspaceId: 'ws-1',
    ports,
  });
  assert.notEqual(live.contextDrifted, true);
});

test('authoritative identity head still flags drift when the resolved version genuinely differs', async () => {
  const frozen = {
    ...snapshot(),
    factRevisionRefs: ['identity:identity-1@1'],
  };
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive() {
        return [];
      },
    },
    identities: {
      async listActive() {
        return [{ identityId: 'identity-1', version: 2 }] as never;
      },
    },
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '用门店素材做图文',
      intent: {
        context: {
          workId: 'work-1',
          intent: '用门店素材做图文',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    },
  });

  const heads = await ports.resolveFactHeads!({
    workspaceId: 'ws-1',
    factRevisionRefs: ['identity:identity-1@1'],
  });
  assert.notEqual(heads[0]?.factRevisionId, 'identity:identity-1@1');
  assert.equal(heads[0]?.materialPriceOrDateChanged, true);

  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: frozen,
    workspaceId: 'ws-1',
    ports,
  });
  assert.equal(live.contextDrifted, true);
});

// V31-55: compile time (plan-compiler-production-ports.ts) and verify time
// (execution-plan-live-facts.ts) both narrow a deliverable's platform through
// asRightsPlatform before handing it to the rights resolver. Before the fix,
// only the verify side narrowed — compile time passed any platform string
// straight through — so a deliverable targeting a platform outside the
// rights domain's xiaohongshu/douyin allowlist (e.g. wechat_moments)
// fingerprinted differently on each side for reasons unrelated to any real
// rights change, and the snapshot self-rejected as SNAPSHOT_STALE on its very
// first verification.
const productionSkillStub = {
  async resolveSkill() {
    return {
      skillId: 'skill.beauty-copywriting',
      skillRevisionRef: 'skill.beauty-copywriting@1',
      contentHash: 'a'.repeat(64),
    };
  },
};

test('V31-55: production plan compilation fails closed without an authoritative rights revision', async () => {
  const ports = createProductionPlanCompilerPorts({
    rights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    } as unknown as ProductionPlanRightsResolver,
    models: {
      async getCatalog() {
        return { revisionId: 'model-r1', models: [{ id: 'model-1' }] };
      },
    },
    skills: productionSkillStub,
  });

  await assert.rejects(
    () =>
      ports.rights.resolveRights({
        workspaceId: 'ws-1',
        assetIntentions: [],
        factIntentions: [],
        deliverables: [
          {
            deliverableId: 'd1',
            kind: 'copy',
            platform: 'wechat_moments',
            quantity: 1,
            purpose: '朋友圈文案',
          },
        ],
      }),
    /authoritative rights revision/u,
  );
});

test('V31-55: production rights revision stays stable from compile through verification', async () => {
  const resolver = new ProductContentPackageRightsResolver({
    async load() {
      return { assets: [] };
    },
  });
  const compiled = await createProductionPlanCompilerPorts({
    rights: resolver,
    models: {
      async getCatalog() {
        return { revisionId: 'model-r1', models: [{ id: 'model-1' }] };
      },
    },
    skills: productionSkillStub,
  }).rights.resolveRights({
    workspaceId: 'ws-1',
    assetIntentions: [],
    factIntentions: [],
    deliverables: [
      {
        deliverableId: 'd1',
        kind: 'copy',
        platform: 'wechat_moments',
        quantity: 1,
        purpose: '朋友圈文案',
      },
    ],
  });
  const frozen = snapshotWithDeliverablesAndRights(
    [
      {
        deliverableId: 'd1',
        kind: 'copy',
        quantity: 1,
        platform: 'wechat_moments',
      },
    ] as unknown as ExecutionPlanFrozenContent['deliverables'],
    compiled.rightsRevisionIds,
  );
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive() {
        return [];
      },
    },
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '朋友圈文案',
      executionPlanSnapshot: frozen,
      intent: {
        context: {
          workId: 'work-1',
          intent: '朋友圈文案',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
    rights: resolver,
  });
  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: frozen,
    workspaceId: 'ws-1',
    ports: {
      ...ports,
      async resolveQuoteHead() {
        return { quoteId: frozen.quoteRef.id, revision: frozen.quoteRef.revision };
      },
    },
  });

  assert.deepEqual(live.rightsRevisionRefs, frozen.rightsRevisionRefs);
  assert.equal(evaluateExecutionPlanStaleness({ snapshot: frozen, live }).status, 'current');
  assert.equal(verifyExecutionPlanSnapshotForDbos({ snapshot: frozen, live }).ok, true);
});

test('V31-55: a deliverable platform outside the rights allowlist does not fingerprint differently between freeze and verify', async () => {
  const state = { knownAssetIds: ['asset-1'], unauthorizedAssetIds: [] as string[] };
  const resolver = platformSensitiveRightsResolver(state);

  const compiled = await createProductionPlanCompilerPorts({
    rights: resolver,
    models: {
      async getCatalog() {
        return { revisionId: 'model-r1', models: [{ id: 'model-1' }] };
      },
    },
    skills: productionSkillStub,
  }).rights.resolveRights({
    workspaceId: 'ws-1',
    assetIntentions: ['asset-1'],
    factIntentions: [],
    deliverables: [
      {
        deliverableId: 'd1',
        kind: 'note',
        platform: 'wechat_moments',
        quantity: 1,
        purpose: '朋友圈图文',
      },
    ],
  });

  const frozen = snapshotWithDeliverablesAndRights(
    [
      {
        deliverableId: 'd1',
        kind: 'copy',
        quantity: 1,
        platform: 'wechat_moments',
      },
    ] as unknown as ExecutionPlanFrozenContent['deliverables'],
    compiled.rightsRevisionIds,
  );

  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive() {
        return [];
      },
    },
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '朋友圈图文',
      executionPlanSnapshot: frozen,
      intent: {
        context: {
          workId: 'work-1',
          intent: '朋友圈图文',
          sourceSummaries: [],
        },
        assetReferences: ['asset-1'],
      },
    },
    rights: resolver,
  });

  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: frozen,
    workspaceId: 'ws-1',
    // createAuthoritativeExecutionPlanLiveFactsPorts never binds a quote
    // head (quote is resolved elsewhere in production); pin the quote as
    // current so only the rights fingerprint under test can move staleness.
    ports: {
      ...ports,
      async resolveQuoteHead() {
        return { quoteId: frozen.quoteRef.id, revision: frozen.quoteRef.revision };
      },
    },
  });
  const staleness = evaluateExecutionPlanStaleness({ snapshot: frozen, live });
  assert.equal(staleness.status, 'current');
  const verified = verifyExecutionPlanSnapshotForDbos({
    snapshot: frozen,
    live,
  });
  assert.equal(verified.ok, true);
});

// Fidelity gate: the narrowing fix above must not loosen genuine rights
// drift detection for a wechat_moments-targeting plan. Same setup as above,
// except the resolver's asset authorization genuinely changes between freeze
// and verify — that must still trip the fence.
test('V31-55: a genuine rights change for a non-allowlisted platform still trips the rights fence', async () => {
  const frozenState = { knownAssetIds: ['asset-1'], unauthorizedAssetIds: [] as string[] };

  const compiled = await createProductionPlanCompilerPorts({
    rights: platformSensitiveRightsResolver(frozenState),
    models: {
      async getCatalog() {
        return { revisionId: 'model-r1', models: [{ id: 'model-1' }] };
      },
    },
    skills: productionSkillStub,
  }).rights.resolveRights({
    workspaceId: 'ws-1',
    assetIntentions: ['asset-1'],
    factIntentions: [],
    deliverables: [
      {
        deliverableId: 'd1',
        kind: 'note',
        platform: 'wechat_moments',
        quantity: 1,
        purpose: '朋友圈图文',
      },
    ],
  });

  const frozen = snapshotWithDeliverablesAndRights(
    [
      {
        deliverableId: 'd1',
        kind: 'copy',
        quantity: 1,
        platform: 'wechat_moments',
      },
    ] as unknown as ExecutionPlanFrozenContent['deliverables'],
    compiled.rightsRevisionIds,
  );

  // Asset-1's rights were genuinely withdrawn since freeze.
  const liveState = { knownAssetIds: ['asset-1'], unauthorizedAssetIds: ['asset-1'] };
  const ports = createAuthoritativeExecutionPlanLiveFactsPorts({
    facts: {
      async history() {
        return [];
      },
      async listActive() {
        return [];
      },
    },
    request: {
      actorId: 'actor-1',
      workspaceId: 'ws-1',
      packageId: 'package-1',
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '朋友圈图文',
      executionPlanSnapshot: frozen,
      intent: {
        context: {
          workId: 'work-1',
          intent: '朋友圈图文',
          sourceSummaries: [],
        },
        assetReferences: ['asset-1'],
      },
    },
    rights: platformSensitiveRightsResolver(liveState),
  });

  const live = await resolveExecutionPlanLiveFactsFromPorts({
    snapshot: frozen,
    workspaceId: 'ws-1',
    ports,
  });
  const staleness = evaluateExecutionPlanStaleness({ snapshot: frozen, live });
  assert.equal(staleness.status, 'stale');
  assert.throws(
    () => verifyExecutionPlanSnapshotForDbos({ snapshot: frozen, live }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'RIGHTS_FENCE_MISMATCH',
  );
});

test('createResolveExecutionPlanLiveFacts skips when no snapshot on request', async () => {
  const resolve = createResolveExecutionPlanLiveFacts({});
  const live = await resolve({
    workflowId: 'wf-1',
    request: {
      actorId: 'a',
      workspaceId: 'ws-1',
      packageId: 'p',
      expectedRevision: 1,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: 'x',
      intent: {
        context: { workId: 'w', intent: 'x', sourceSummaries: [] },
        assetReferences: [],
      },
    },
  });
  assert.equal(live, undefined);
});

test('createResolveExecutionPlanLiveFacts binds snapshot path', async () => {
  const snap = snapshot();
  const resolve = createResolveExecutionPlanLiveFacts({
    async resolveQuoteHead() {
      return { quoteId: 'quote-1', revision: 2 };
    },
  });
  const live = await resolve({
    workflowId: 'wf-1',
    request: {
      actorId: 'a',
      workspaceId: 'ws-1',
      packageId: 'p',
      expectedRevision: 1,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: 'x',
      intent: {
        context: { workId: 'w', intent: 'x', sourceSummaries: [] },
        assetReferences: [],
      },
      executionPlanSnapshot: snap,
    },
  });
  assert.equal(live?.quoteRevision, 2);
});
