import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerSubmissionBodySchema,
  submitComposerSubmission,
} from './composer-submission-client';

function submissionBody() {
  return {
    briefConfirmation: { id: 'brief-confirm-1', revision: 'draft-r3' },
    briefContext: { id: 'brief-context-1', revision: 3 },
    catalogModel: { id: 'catalog-copy-1', revision: 'catalog-r4' },
    contentPackagePlatform: 'douyin' as const,
    distributionTarget: 'export' as const,
    deliverable: { kind: 'copy_document' as const, quantity: 1 },
    creationMode: 'customized' as const,
    identity: { id: 'identity-brand', revision: '2' },
    idempotencyKey: 'composer-submit-1',
    intent: '写一条夏日护理预约文案',
    quote: { id: 'quote-1', revision: 'quote-r2' },
    recipe: { id: 'recipe-summer', revision: 'recipe-summer@2' },
    sources: {
      assets: [
        {
          id: 'asset-store-1',
          revision: 'sha256-r1',
          role: 'reference' as const,
        },
      ],
    },
    surface: {
      id: 'surface.home.launch',
      revision: 'surface.home.launch@3',
    },
  };
}

test('browser submission carries signed public fields without server truth', () => {
  const parsed = composerSubmissionBodySchema.parse({
    ...submissionBody(),
    agentThreadId: 'thread-authoritative-1',
    requestedFactRefs: ['store_fact:service-main:3'],
  });
  assert.equal('route' in parsed, false);
  assert.equal('rights' in parsed, false);
  assert.equal('deliverables' in parsed, false);
  assert.equal('modelPolicy' in parsed, false);
  assert.equal(parsed.contentPackagePlatform, 'douyin');
  assert.equal(parsed.distributionTarget, 'export');
  assert.equal(parsed.agentThreadId, 'thread-authoritative-1');
  assert.deepEqual(parsed.requestedFactRefs, ['store_fact:service-main:3']);
});

test('browser submission accepts P2-09 beauty voice and thinking level injection', () => {
  const parsed = composerSubmissionBodySchema.parse({
    ...submissionBody(),
    creationMode: 'free',
    beautyVoiceRole: 'beautician',
    thinkingLevel: 'deep',
  });
  assert.equal(parsed.beautyVoiceRole, 'beautician');
  assert.equal(parsed.thinkingLevel, 'deep');
  assert.equal(
    composerSubmissionBodySchema.safeParse({
      ...submissionBody(),
      beautyVoiceRole: 'blogger',
    }).success,
    false
  );
  assert.equal(
    composerSubmissionBodySchema.safeParse({
      ...submissionBody(),
      beautyVoiceRole: 'owner',
      thinkingLevel: 'standard',
    }).success,
    false
  );
});

test('browser submission preserves only a valid free-image operation', () => {
  const freeImage = {
    ...submissionBody(),
    creationMode: 'free' as const,
    imageOperation: 'image.edit' as const,
    deliverable: {
      kind: 'image_set' as const,
      quantity: 1,
      aspectRatio: '3:4' as const,
    },
  };
  assert.equal(
    composerSubmissionBodySchema.parse(freeImage).imageOperation,
    'image.edit'
  );
  assert.equal(
    composerSubmissionBodySchema.safeParse({
      ...freeImage,
      creationMode: 'customized',
    }).success,
    false
  );
});

test('browser submission keeps viral source structured and rejects unfrozen asset ids', () => {
  const viral = {
    ...submissionBody(),
    contentPackagePlatform: 'xiaohongshu' as const,
    deliverable: {
      kind: 'note' as const,
      quantity: 1,
      aspectRatio: '3:4' as const,
      notePageBound: 3,
    },
    intent: '请为本店项目复刻一篇小红书爆款笔记，参考素材已由商家确认。',
    recipe: {
      id: 'recipe.viral_adapt',
      revision: 'recipe.viral_adapt@2',
    },
    viralAdaptSource: {
      schemaVersion: 'viral-adapt-source/v1' as const,
      track: 'paste' as const,
      noteText:
        'RAW_NOTE_TOKEN_9f71 https://xhs.invalid/explore/private-note?xsec_token=SECRET',
      authorizedAssetIds: ['asset-store-1'],
    },
  };

  const parsed = composerSubmissionBodySchema.parse(viral);
  assert.deepEqual(parsed.viralAdaptSource, viral.viralAdaptSource);
  assert.doesNotMatch(parsed.intent, /\[viral_adapt_source:|asset-store-1/u);
  assert.doesNotMatch(parsed.intent, /RAW_NOTE_TOKEN_9f71/u);
  assert.doesNotMatch(parsed.intent, /https:\/\/|xsec_token|SECRET/u);
  assert.equal(
    composerSubmissionBodySchema.safeParse({
      ...viral,
      viralAdaptSource: {
        ...viral.viralAdaptSource,
        authorizedAssetIds: ['asset-outside-frozen-sources'],
      },
    }).success,
    false
  );
});

test('submits the exact Composer body and returns the durable handles', async () => {
  const previousFetch = globalThis.fetch;
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(new URL(String(input), 'http://localhost'), init);
    return Response.json({
      data: {
        contentPackage: { expectedRevision: 0, id: 'package-1' },
        replayed: false,
        makeReady: true,
        runId: 'run-1',
        snapshot: {
          id: 'snapshot-task-1',
          identity: { id: 'identity-brand', revision: '2' },
          schemaVersion: 'creation-execution-snapshot/v1',
        },
        task: { id: 'task-1' },
        threadId: 'thread-1',
        usageReservation: { id: 'usage-task-1' },
        work: { id: 'work-1' },
      },
      meta: { correlationId: 'corr-test' },
    });
  };
  try {
    const result = await submitComposerSubmission(submissionBody());
    assert.equal(result.work.id, 'work-1');
    assert.equal(result.task.id, 'task-1');
    assert.equal(result.threadId, 'thread-1');
    assert.equal(result.runId, 'run-1');
    assert.equal(
      request?.url,
      'http://localhost/api/core/p1/composer/submissions'
    );
    assert.equal(request?.headers.get('idempotency-key'), 'composer-submit-1');
    // Omitted userSelectedSkillRefs defaults to [] on the wire (no undefined leak).
    assert.deepEqual(await request?.json(), {
      ...submissionBody(),
      userSelectedSkillRefs: [],
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('selected skill refs enter the submission payload; empty stays empty', async () => {
  const previousFetch = globalThis.fetch;
  let body: unknown;
  globalThis.fetch = async (input, init) => {
    const request = new Request(
      new URL(String(input), 'http://localhost'),
      init
    );
    body = await request.json();
    return Response.json({
      data: {
        contentPackage: { expectedRevision: 0, id: 'package-1' },
        replayed: false,
        makeReady: true,
        runId: 'run-1',
        snapshot: {
          id: 'snapshot-task-1',
          identity: { id: 'identity-brand', revision: '2' },
          schemaVersion: 'creation-execution-snapshot/v1',
        },
        task: { id: 'task-1' },
        threadId: 'thread-1',
        usageReservation: { id: 'usage-task-1' },
        work: { id: 'work-1' },
      },
      meta: { correlationId: 'corr-test' },
    });
  };
  try {
    // Negative unselected
    await submitComposerSubmission(submissionBody());
    assert.deepEqual(
      (body as { userSelectedSkillRefs: string[] }).userSelectedSkillRefs,
      []
    );

    // Positive selected
    await submitComposerSubmission({
      ...submissionBody(),
      userSelectedSkillRefs: ['skill.story@3', 'skill.tone@1'],
    });
    assert.deepEqual(
      (body as { userSelectedSkillRefs: string[] }).userSelectedSkillRefs,
      ['skill.story@3', 'skill.tone@1']
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
