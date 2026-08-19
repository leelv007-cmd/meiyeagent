/**
 * V31-14 Make snapshot consume — zero intent/brief LLM re-call + validator.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION,
} from '@meiye/contracts';

import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import {
  assessMemoryStyleCompliance,
  describeMemoryStyleViolations,
  isMakeSnapshotConsumePath,
  MakeSnapshotConsumeError,
  materializeCopyBriefFromSnapshot,
  materializeIntentFromSnapshot,
  materializeMediaBriefFromSnapshot,
  materializeNoteBriefFromSnapshot,
  resolveMakeSnapshotConsume,
  snapshotConsumeTracePayload,
  validateContextBundleAgainstSnapshot,
  validateIntentAgainstSnapshot,
} from './make-snapshot-consume.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { VIDEO_PARTIAL_FAILURE_NOT_CALLED_ANCHOR } from './video-scene-execution.js';

const BOUNDED = {
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
};

const COMPILED = {
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
};

function frozenContent(
  overrides: Partial<ExecutionPlanFrozenContent> = {}
): ExecutionPlanFrozenContent {
  return {
    planId: 'plan-1',
    planRevision: 1,
    intentDeclaration: { summary: '纯文案推广本店团购' },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'ctx-hash-1',
    },
    executionPlan: COMPILED,
    deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: {
      copyGeneration: { key: 'copyGeneration', version: 'v3' },
    },
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: ['rights-1'],
    factRevisionRefs: ['fact-1'],
    boundedExecution: {
      ...BOUNDED,
      requiredLimits: ['maxIterations', 'maxCostCents'],
    },
    harnessReleaseId: 'release-1',
    approvalBasis: 'policy_exempt_copy',
    ...overrides,
  } as unknown as ExecutionPlanFrozenContent;
}

function buildSnapshot(overrides: Partial<ExecutionPlanFrozenContent> = {}) {
  const content = frozenContent(overrides);
  const { snapshotHash } = freezeExecutionPlanContent(content);
  return buildExecutionPlanSnapshot({ content, snapshotHash });
}

function baseRequest(
  snapshot?: ReturnType<typeof buildSnapshot>
): HarnessWorkflowInput {
  return {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 1,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: '纯文案推广本店团购',
    intent: {
      context: {
        workId: 'work-1',
        intent: '纯文案推广本店团购',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    ...(snapshot ? { executionPlanSnapshot: snapshot } : {}),
  };
}

function copyExecutionSnapshot(identity: { id: string; revision: string }) {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'snapshot-consume-identity',
      taskId: 'task-1',
      workId: 'work-1',
      contentPackageId: 'package-1',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '纯文案推广本店团购',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'copy',
      platform: { id: 'xiaohongshu' },
      deliverables: [{ id: 'copy-main', kind: 'copy', order: 0, quantity: 1 }],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity,
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'composer:session-1', revision: 1 },
      contentModules: ['social_cover'],
    },
    '2026-08-13T00:00:00.000Z'
  );
}

test('resolveMakeSnapshotConsume: no snapshot → legacy_llm', () => {
  const decision = resolveMakeSnapshotConsume({ request: baseRequest() });
  assert.equal(decision.mode, 'legacy_llm');
  assert.equal(isMakeSnapshotConsumePath(decision), false);
});

test('resolveMakeSnapshotConsume: valid snapshot → snapshot_validator', () => {
  const snapshot = buildSnapshot();
  const decision = resolveMakeSnapshotConsume({
    request: baseRequest(snapshot),
  });
  assert.equal(decision.mode, 'snapshot_validator');
  assert.equal(isMakeSnapshotConsumePath(decision), true);
  if (isMakeSnapshotConsumePath(decision)) {
    assert.equal(
      decision.snapshot.schemaVersion,
      EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION
    );
    assert.equal(decision.snapshot.snapshotHash, snapshot.snapshotHash);
  }
});

test('resolveMakeSnapshotConsume: hash mismatch fail closed', () => {
  const snapshot = buildSnapshot();
  const broken = { ...snapshot, snapshotHash: '0'.repeat(64) };
  assert.throws(
    () =>
      resolveMakeSnapshotConsume({
        request: baseRequest(broken as typeof snapshot),
      }),
    (error: unknown) =>
      error instanceof MakeSnapshotConsumeError &&
      error.code === 'SNAPSHOT_HASH_MISMATCH'
  );
});

test('materializeIntentFromSnapshot: llmInvoked=false and customized policy route', () => {
  const snapshot = buildSnapshot();
  const result = materializeIntentFromSnapshot({
    snapshot,
    request: baseRequest(snapshot),
  });
  assert.equal(result.llmInvoked, false);
  assert.equal(result.blockingQuestion, null);
  assert.equal(result.declaration.route, 'customized');
  assert.equal(result.declaration.routingSource, 'policy');
  assert.equal(result.declaration.normalizedIntent, '纯文案推广本店团购');
  assert.equal(result.declaration.deliveryLayer, 'copy');
});

test('materializeCopyBriefFromSnapshot: deterministic brief, zero LLM, freeze fact refs', () => {
  const snapshot = buildSnapshot();
  const request = {
    ...baseRequest(snapshot),
    executionSnapshot: copyExecutionSnapshot({
      id: 'identity-selected',
      revision: '3',
    }),
  };
  const intent = materializeIntentFromSnapshot({
    snapshot,
    request,
  });
  const result = materializeCopyBriefFromSnapshot({
    snapshot,
    declaration: intent.declaration,
    request,
  });
  assert.equal(result.llmInvoked, false);
  assert.equal(result.brief.kind, 'copy');
  assert.deepEqual(result.brief.factRefs, ['fact-1']);
  assert.deepEqual(result.brief.identityRefs, [
    'marketing_identity:identity-selected:3',
  ]);
  assert.match(result.brief.instructions, /已确认方案/);
  assert.doesNotMatch(result.brief.instructions, /ExecutionPlanSnapshot/);
  assert.ok(
    result.brief.constraints.every(
      (c) =>
        !c.includes(snapshot.snapshotHash) &&
        !c.includes('ExecutionPlanSnapshot')
    )
  );
});

test('free snapshot materializers keep copy, image, video and note facts on the explicit frozen intersection', () => {
  const snapshot = buildSnapshot({
    factRevisionRefs: ['store_fact:service-1:1', 'store_fact:price-1:1'],
  });
  const request = {
    ...baseRequest(snapshot),
    creationMode: 'free' as const,
    executionSnapshot: copyExecutionSnapshot({
      id: 'identity-must-not-be-implicit',
      revision: '4',
    }),
  };
  const declaration = materializeIntentFromSnapshot({ snapshot, request })
    .declaration;
  const allowedFactRefs = [
    'store_fact:service-1:1',
    'store_fact:not-frozen:1',
  ];
  const copy = materializeCopyBriefFromSnapshot({
    snapshot,
    declaration,
    request,
    allowedFactRefs,
  }).brief;
  const image = materializeMediaBriefFromSnapshot({
    snapshot,
    declaration,
    request: {
      ...request,
      executionSnapshot: { lens: 'image', platform: { id: 'xiaohongshu' } },
    } as HarnessWorkflowInput,
    allowedFactRefs,
  }).brief;
  const video = materializeMediaBriefFromSnapshot({
    snapshot,
    declaration,
    request: {
      ...request,
      executionSnapshot: { lens: 'video', platform: { id: 'douyin' } },
    } as HarnessWorkflowInput,
    allowedFactRefs,
  }).brief;
  const note = materializeNoteBriefFromSnapshot({
    snapshot,
    declaration,
    request,
    allowedFactRefs,
  }).brief;

  assert.equal(declaration.route, 'free');
  assert.deepEqual(copy.factRefs, ['store_fact:service-1:1']);
  assert.deepEqual(copy.identityRefs, []);
  assert.match(copy.instructions, /用户指定的 1 项资料/u);
  assert.equal(image.kind, 'image');
  if (image.kind === 'image') {
    assert.deepEqual(image.intent.factRefs, ['store_fact:service-1:1']);
  }
  assert.equal(video.kind, 'video');
  for (const candidate of note.candidates.candidates) {
    for (const page of candidate.plan.pages) {
      assert.deepEqual(page.imageIntent.factRefs, ['store_fact:service-1:1']);
    }
  }
  for (const serialized of [
    JSON.stringify(copy),
    JSON.stringify(image),
    JSON.stringify(video),
    JSON.stringify(note),
  ]) {
    assert.doesNotMatch(serialized, /store_fact:not-frozen:1/u);
  }
});

test('V31-36 snapshot consume materializes three video scenes for the partial-failure fixture', () => {
  const ordinarySnapshot = buildSnapshot();
  const ordinaryDeclaration = materializeIntentFromSnapshot({
    snapshot: ordinarySnapshot,
    request: baseRequest(ordinarySnapshot),
  }).declaration;
  const ordinary = materializeMediaBriefFromSnapshot({
    snapshot: ordinarySnapshot,
    declaration: ordinaryDeclaration,
    request: {
      ...baseRequest(ordinarySnapshot),
      executionSnapshot: { lens: 'video', platform: { id: 'douyin' } },
    } as unknown as HarnessWorkflowInput,
  });
  assert.equal(ordinary.brief.kind, 'video');
  if (ordinary.brief.kind === 'video') {
    assert.equal(ordinary.brief.storyboard.length, 2);
  }

  const summary = `做成抖音项目成片，${VIDEO_PARTIAL_FAILURE_NOT_CALLED_ANCHOR}`;
  const snapshot = buildSnapshot({ intentDeclaration: { summary } });
  const declaration = materializeIntentFromSnapshot({
    snapshot,
    request: baseRequest(snapshot),
  }).declaration;
  const partial = materializeMediaBriefFromSnapshot({
    snapshot,
    declaration,
    request: {
      ...baseRequest(snapshot),
      executionSnapshot: { lens: 'video', platform: { id: 'douyin' } },
    } as unknown as HarnessWorkflowInput,
  });
  assert.equal(partial.brief.kind, 'video');
  if (partial.brief.kind === 'video') {
    assert.equal(partial.brief.storyboard.length, 3);
    assert.match(
      partial.brief.storyboard.map((scene) => scene.description).join('\n'),
      new RegExp(VIDEO_PARTIAL_FAILURE_NOT_CALLED_ANCHOR, 'u'),
    );
  }
});

test('materialize media/note briefs never put snapshotHash in merchant-visible text', () => {
  const snapshot = buildSnapshot();
  const declaration = materializeIntentFromSnapshot({
    snapshot,
    request: baseRequest(snapshot),
  }).declaration;

  const image = materializeMediaBriefFromSnapshot({
    snapshot,
    declaration,
    request: {
      ...baseRequest(snapshot),
      executionSnapshot: { lens: 'image', platform: { id: 'xiaohongshu' } },
    } as unknown as HarnessWorkflowInput,
  });
  const video = materializeMediaBriefFromSnapshot({
    snapshot,
    declaration,
    request: {
      ...baseRequest(snapshot),
      executionSnapshot: { lens: 'video', platform: { id: 'douyin' } },
    } as unknown as HarnessWorkflowInput,
  });
  const note = materializeNoteBriefFromSnapshot({
    snapshot,
    declaration,
    request: baseRequest(snapshot),
  });

  for (const serialized of [
    JSON.stringify(image.brief),
    JSON.stringify(video.brief),
    JSON.stringify(note.brief),
  ]) {
    assert.ok(!serialized.includes(snapshot.snapshotHash));
    assert.doesNotMatch(serialized, /snapshotHash=/u);
    assert.doesNotMatch(serialized, /ExecutionPlanSnapshot/u);
  }
  assert.equal(image.brief.kind, 'image');
  if (image.brief.kind === 'image') {
    assert.doesNotMatch(image.brief.prompt, /snapshotHash/u);
    assert.ok(
      image.brief.constraints.every(
        (line) => !line.includes(snapshot.snapshotHash)
      )
    );
  }
  assert.equal(video.brief.kind, 'video');
  if (video.brief.kind === 'video') {
    assert.doesNotMatch(video.brief.firstFramePrompt, /snapshotHash/u);
    assert.ok(
      video.brief.constraints.every(
        (line) => !line.includes(snapshot.snapshotHash)
      )
    );
  }
  for (const candidate of note.brief.candidates.candidates) {
    const page2 = candidate.plan.pages.find((page) => page.id === 'page-2');
    assert.equal(page2?.textBlock.body, '私信了解详情并预约。');
  }
});

test('materializeCopyBriefFromSnapshot keeps the official neutral identity unbound', () => {
  const snapshot = buildSnapshot();
  const request = {
    ...baseRequest(snapshot),
    executionSnapshot: copyExecutionSnapshot({
      id: 'official-neutral',
      revision: '1',
    }),
  };
  const intent = materializeIntentFromSnapshot({ snapshot, request });
  const result = materializeCopyBriefFromSnapshot({
    snapshot,
    declaration: intent.declaration,
    request,
  });

  assert.deepEqual(result.brief.identityRefs, []);
});

test('materializeCopyBriefFromSnapshot consumes structured memory style without leaking its statement', () => {
  const snapshot = buildSnapshot({
    executionPlan: {
      ...COMPILED,
      units: [
        {
          ...COMPILED.units[0],
          input: {
            memoryContext: {
              entries: [{ memoryId: 'preference-1', revision: 3 }],
              receiptRef: {
                taskId: 'task-1',
                runId: 'run-1',
                harnessReleaseId: 'release-1',
              },
              styleConstraints: {
                tones: ['concise', 'restrained'],
                maxTitleChars: 24,
                maxBodyChars: 32,
                maxSentenceChars: 24,
                forbiddenPhrases: ['绝对', '保证', '必然'],
              },
            },
          },
        },
      ],
    } as unknown as ExecutionPlanFrozenContent['executionPlan'],
  });
  const intent = materializeIntentFromSnapshot({
    snapshot,
    request: baseRequest(snapshot),
  });
  const result = materializeCopyBriefFromSnapshot({
    snapshot,
    declaration: intent.declaration,
    request: baseRequest(snapshot),
  });
  assert.deepEqual(result.brief.identityRefs, []);
  assert.match(result.brief.instructions, /正文不超过 32 字/u);
  assert.match(result.brief.instructions, /语气=concise、restrained/u);
  // The previous assertion here checked for a merchant statement, which
  // `planMemoryContextSchema` is `.strict()` about never carrying — it could not
  // fail. What CAN leak is the receipt's internal identity, so assert that: the
  // model must receive the derived constraint, never memory/run bookkeeping.
  const serializedBrief = JSON.stringify(result.brief);
  assert.doesNotMatch(serializedBrief, /preference-1/u);
  assert.doesNotMatch(serializedBrief, /run-1/u);
  assert.doesNotMatch(serializedBrief, /release-1/u);
});

test('V31-18 P1-8: media and note briefs consume the same injected memory style', () => {
  const snapshot = buildSnapshot({
    executionPlan: {
      ...COMPILED,
      units: [
        {
          ...COMPILED.units[0],
          input: {
            memoryContext: {
              entries: [{ memoryId: 'preference-1', revision: 3 }],
              receiptRef: {
                taskId: 'task-1',
                runId: 'run-1',
                harnessReleaseId: 'release-1',
              },
              styleConstraints: {
                tones: ['concise', 'restrained'],
                maxTitleChars: 24,
                maxBodyChars: 32,
                maxSentenceChars: 24,
                forbiddenPhrases: ['绝对', '保证', '必然'],
              },
            },
          },
        },
      ],
    } as unknown as ExecutionPlanFrozenContent['executionPlan'],
  });
  const declaration = materializeIntentFromSnapshot({
    snapshot,
    request: baseRequest(snapshot),
  }).declaration;

  // A MemoryInjectionReceipt is written for note and media carriers too, and the
  // receipt panel tells the merchant 已注入 — so the confirmed preference has to
  // actually reach their briefs, not only the copy one.
  const image = materializeMediaBriefFromSnapshot({
    snapshot,
    declaration,
    request: {
      ...baseRequest(snapshot),
      executionSnapshot: { lens: 'image', platform: { id: 'xiaohongshu' } },
    } as unknown as HarnessWorkflowInput,
  });
  assert.ok(
    image.brief.constraints.some((line) => /正文不超过 32 字/u.test(line)),
    'image constraints must carry the confirmed style'
  );
  assert.match(JSON.stringify(image.brief), /语气=concise、restrained/u);

  // promotion_poster freezes aspectRatio 3:4; hard-coded 9:16 breaks
  // assertBriefMatchesSnapshot on the Make snapshot path.
  const poster = materializeMediaBriefFromSnapshot({
    snapshot,
    declaration,
    request: {
      ...baseRequest(snapshot),
      executionSnapshot: {
        lens: 'image',
        platform: { id: 'offline' },
        deliverable: { kind: 'poster', quantity: 1, aspectRatio: '3:4' },
        deliverables: [
          {
            id: 'd1',
            kind: 'image',
            quantity: 1,
            order: 0,
            aspectRatio: '3:4',
          },
        ],
      },
    } as unknown as HarnessWorkflowInput,
  });
  assert.equal(poster.brief.kind, 'image');
  if (poster.brief.kind === 'image') {
    assert.equal(poster.brief.parameters.ratio, '3:4');
  }

  const video = materializeMediaBriefFromSnapshot({
    snapshot,
    declaration,
    request: {
      ...baseRequest(snapshot),
      executionSnapshot: { lens: 'video', platform: { id: 'douyin' } },
    } as unknown as HarnessWorkflowInput,
  });
  assert.ok(
    video.brief.constraints.some((line) => /正文不超过 32 字/u.test(line)),
    'video constraints must carry the confirmed style'
  );

  const note = materializeNoteBriefFromSnapshot({
    snapshot,
    declaration,
    request: baseRequest(snapshot),
  });
  assert.ok(note.brief.candidates.candidates.length > 0);
  for (const candidate of note.brief.candidates.candidates) {
    assert.match(candidate.positioning, /正文不超过 32 字/u);
    assert.match(candidate.plan.style.positioning, /正文不超过 32 字/u);
  }

  // Same no-leak rule as copy on every carrier.
  for (const serialized of [
    JSON.stringify(image.brief),
    JSON.stringify(video.brief),
    JSON.stringify(note.brief),
  ]) {
    assert.doesNotMatch(serialized, /preference-1/u);
    assert.doesNotMatch(serialized, /run-1/u);
    assert.ok(!serialized.includes(snapshot.snapshotHash));
    assert.doesNotMatch(serialized, /snapshotHash=/u);
    assert.doesNotMatch(serialized, /ExecutionPlanSnapshot/u);
  }
  if (image.brief.kind === 'image') {
    assert.doesNotMatch(image.brief.prompt, /snapshotHash/u);
    assert.ok(
      image.brief.constraints.every(
        (line) =>
          !line.includes(snapshot.snapshotHash) &&
          !line.includes('snapshotHash=')
      )
    );
  }
  if (video.brief.kind === 'video') {
    assert.doesNotMatch(video.brief.firstFramePrompt, /snapshotHash/u);
    assert.ok(
      video.brief.constraints.every(
        (line) =>
          !line.includes(snapshot.snapshotHash) &&
          !line.includes('snapshotHash=')
      )
    );
  }
  for (const candidate of note.brief.candidates.candidates) {
    const page2 = candidate.plan.pages.find((page) => page.id === 'page-2');
    assert.equal(page2?.textBlock.body, '私信了解详情并预约。');
    assert.doesNotMatch(page2?.textBlock.body ?? '', /snapshotHash/u);
  }
});

test('validateIntentAgainstSnapshot: hard drift fail closed', () => {
  const snapshot = buildSnapshot();
  assert.throws(
    () =>
      validateIntentAgainstSnapshot({
        snapshot,
        declaration: {
          normalizedIntent: '完全不同的意图内容xyz',
          taskType: 'routine_marketing_materials',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['store'],
          usedAssetCategories: ['store'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: [],
        },
      }),
    (error: unknown) =>
      error instanceof MakeSnapshotConsumeError &&
      error.code === 'INTENT_VALIDATOR_MISMATCH'
  );
});

test('validateContextBundleAgainstSnapshot: same id with revision drift fails', () => {
  const snapshot = buildSnapshot();
  assert.throws(
    () =>
      validateContextBundleAgainstSnapshot({
        snapshot,
        bundle: {
          bundleId: 'bundle-1',
          revision: 99,
          hash: 'other-hash',
        },
      }),
    (error: unknown) =>
      error instanceof MakeSnapshotConsumeError &&
      error.code === 'CONTEXT_REF_MISMATCH'
  );
});

test('snapshotConsumeTracePayload asserts llmInvoked=false for both stages', () => {
  const snapshot = buildSnapshot();
  for (const stage of ['intent_naming', 'brief_compilation'] as const) {
    const payload = snapshotConsumeTracePayload({
      snapshotHash: snapshot.snapshotHash,
      approvalBasis: snapshot.approvalBasis,
      stage,
      llmInvoked: false,
    });
    assert.equal(payload.llmInvoked, false);
    assert.equal(payload.makeConsume, 'snapshot_validator');
    assert.equal(payload.stage, stage);
  }
});

const CONCISE_STYLE = {
  tones: ['concise' as const, 'restrained' as const],
  maxTitleChars: 24,
  maxBodyChars: 32,
  maxSentenceChars: 24,
  forbiddenPhrases: ['绝对', '保证', '必然'],
};

test('V31-18 P1-5: real output is measured against the confirmed style, not the prompt', () => {
  // Conforming: this is what the fixture returns, and it must pass on its own
  // merits rather than because the fixture regexed its own instructions.
  assert.deepEqual(
    assessMemoryStyleCompliance(
      {
        title: '周末护理，到店前先了解',
        body: '先沟通需求，再确认护理安排。周末到店，轻松一点。',
      },
      CONCISE_STYLE
    ),
    { passed: true, violations: [] }
  );

  // The three constraints nothing used to check, each proven separately.
  const longBody = assessMemoryStyleCompliance(
    {
      title: '到店前先了解',
      body:
        '从真实需求出发，把项目特点、沟通流程和到店前需要确认的信息一次说清楚；' +
        '具体方案以现场沟通和当前有效信息为准。',
    },
    CONCISE_STYLE
  );
  assert.equal(longBody.passed, false);
  assert.ok(
    longBody.violations.some((row) => row.rule === 'max_body_chars'),
    'a body over maxBodyChars must be a violation'
  );
  assert.ok(
    longBody.violations.some((row) => row.rule === 'max_sentence_chars'),
    'a sentence over maxSentenceChars must be a violation'
  );

  const longTitle = assessMemoryStyleCompliance(
    {
      title: '这次想认真地、完整地介绍一下本店最近上线的新项目与流程',
      body: '简短正文。',
    },
    CONCISE_STYLE
  );
  assert.equal(longTitle.passed, false);
  assert.deepEqual(
    longTitle.violations.map((row) => row.rule),
    ['max_title_chars']
  );

  const forbidden = assessMemoryStyleCompliance(
    { title: '保证有效', body: '效果绝对好。' },
    CONCISE_STYLE
  );
  assert.equal(forbidden.passed, false);
  assert.deepEqual(
    forbidden.violations
      .filter((row) => row.rule === 'forbidden_phrase')
      .map((row) => (row.rule === 'forbidden_phrase' ? row.phrase : '')),
    ['绝对', '保证']
  );
  assert.match(
    describeMemoryStyleViolations(forbidden.violations),
    /标题出现约定禁用词「保证」/u
  );

  // No injected memory must never invent a constraint.
  assert.deepEqual(
    assessMemoryStyleCompliance(
      { title: 'x'.repeat(400), body: 'y'.repeat(4000) },
      undefined
    ),
    { passed: true, violations: [] }
  );
});
