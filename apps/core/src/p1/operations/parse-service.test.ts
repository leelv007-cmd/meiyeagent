import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ParseSourceAssetInput,
  StoreFactCandidateDraft,
} from '@meiye/contracts';

import {
  FixtureAssetDraftCompiler,
  FixtureDocumentParseProvider,
  FixtureVisualAssetClassifier,
  MemoryParseRepository,
  ParseProviderError,
  ParseService,
  type DocumentParseProvider,
} from './parse-service.js';

const now = '2026-07-26T02:00:00.000Z';
const context = { workspaceId: 'workspace-a' };

test('single fixture parse persists original, parsed and unconfirmed draft layers', async () => {
  const repository = new MemoryParseRepository();
  const service = fixtureService(repository);

  const result = await service.parseSingle(context, {
    taskId: 'parse-single',
    source: source('price-list'),
  });

  assert.equal(result.task.status, 'completed');
  assert.equal(result.draft.origin, 'parsed');
  assert.equal(result.draft.parsedDocumentId, 'parsed:parse-single:price-list');
  assert.deepEqual(result.draft.fields, [
    {
      key: 'offer.price',
      value: { amount: 239, currency: 'CNY' },
      provenance: 'photo_extract',
      status: 'unconfirmed',
    },
  ]);
  assert.equal(
    (
      await repository.getSource(context.workspaceId, 'price-list')
    )?.sha256,
    'a'.repeat(64),
  );
  assert.equal(
    (
      await repository.getDocument(
        context.workspaceId,
        'parsed:parse-single:price-list',
      )
    )?.parser.kind,
    'fixture',
  );
});

for (const reason of ['failed', 'timeout', 'rate_limited'] as const) {
  test(`parse ${reason} returns the same-schema manual fallback without blocking`, async () => {
    const service = fixtureService(new MemoryParseRepository(), {
      async parse() {
        throw new ParseProviderError(reason, reason);
      },
    });
    const result = await service.parseSingle(context, {
      taskId: `parse-${reason}`,
      source: source(`price-list-${reason}`),
    });

    assert.equal(result.task.status, 'completed_with_fallback');
    assert.equal(result.draft.origin, 'manual');
    assert.equal(result.draft.parsedDocumentId, null);
    assert.equal(result.draft.fields[0]?.key, 'offer.price');
    assert.equal(result.draft.fields[0]?.value, null);
    assert.match(
      String(result.draft.fields[1]?.value),
      /手动填写/u,
    );
  });
}

test('manual intake stays available when the parse provider is unavailable', async () => {
  const service = fixtureService(new MemoryParseRepository(), {
    async parse() {
      throw new Error('service unavailable');
    },
  });
  const manual = await service.prepareManualDraft(context, {
    taskId: 'manual-only',
    source: source('manual-source'),
    fields: [
      {
        key: 'offer.price',
        value: { amount: 299, currency: 'CNY' },
      },
    ],
    factCandidates: [priceFact('manual-source', 299)],
  });

  assert.equal(manual.origin, 'manual');
  assert.equal(manual.fields[0]?.provenance, 'user');
  assert.equal(manual.factCandidates[0]?.source.kind, 'user_confirmation');
});

test('a late parsed result is stored for audit but never overwrites a manual draft', async () => {
  let release!: () => void;
  let entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const repository = new MemoryParseRepository();
  const provider: DocumentParseProvider = {
    async parse(input) {
      entered();
      await releasePromise;
      return new FixtureDocumentParseProvider().parse(input);
    },
  };
  const service = fixtureService(repository, provider);
  const input = {
    taskId: 'late-parse',
    source: source('late-source'),
  };
  const parsing = service.parseSingle(context, input);
  await enteredPromise;
  const manual = await service.prepareManualDraft(context, {
    taskId: input.taskId,
    source: input.source,
    fields: [
      {
        key: 'offer.price',
        value: { amount: 399, currency: 'CNY' },
      },
    ],
    factCandidates: [priceFact('late-source', 399)],
  });
  release();
  const completed = await parsing;

  assert.deepEqual(completed.draft, manual);
  assert.equal(
    (
      await repository.getDocument(
        context.workspaceId,
        'parsed:late-parse:late-source',
      )
    )?.markdown,
    '头皮护理 239 元',
  );
  assert.deepEqual(
    (
      await repository.latestDraftForSource(
        context.workspaceId,
        'late-source',
      )
    )?.factCandidates[0]?.value,
    { amount: 399, currency: 'CNY' },
  );
});

test('batch parse is queued, exposes durable progress and recovers on refresh', async () => {
  const submitted: unknown[] = [];
  const repository = new MemoryParseRepository();
  const service = fixtureService(
    repository,
    new FixtureDocumentParseProvider(),
    {
      async submit(input) {
        submitted.push(input);
        return {} as never;
      },
    },
  );
  const queued = await service.startBatch(context, {
    taskId: 'parse-batch',
    sources: [source('batch-a'), source('batch-b')],
  });

  assert.equal(queued.status, 'queued');
  assert.equal(submitted.length, 1);
  const completed = await service.runBatchTask(
    context.workspaceId,
    queued.taskId,
  );
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.progress, {
    completed: 2,
    total: 2,
    message: '正在整理你上传的资料，已完成 2/2 份；离开后也会继续处理。',
  });
  assert.deepEqual(await service.task(context.workspaceId, queued.taskId), completed);
  assert.deepEqual(
    await service.runBatchTask(context.workspaceId, queued.taskId),
    completed,
  );
});

test('four visual slots include descriptions and a skippable rights soft prompt', async () => {
  const service = fixtureService(new MemoryParseRepository());
  const cases = [
    ['work-case-1', 'work_case'],
    ['store-scene-1', 'store_scene'],
    ['product-1', 'product'],
    ['person-1', 'subject_person'],
  ] as const;
  for (const [assetId, slot] of cases) {
    const result = await service.parseSingle(context, {
      taskId: `visual-${assetId}`,
      source: {
        ...source(assetId),
        inputKind: 'visual_asset',
        target: 'visual_asset',
      },
    });
    assert.equal(result.draft.visualClassification?.slot, slot);
    assert.ok(result.draft.visualClassification?.description);
    assert.deepEqual(
      result.draft.visualClassification?.rightsPrompt,
      {
        message:
          '如果照片里有顾客，请确认已经获得对方同意；这一步可以稍后补充，不影响继续整理。',
        skippable: true,
        blocking: false,
      },
    );
  }
});

test('five-step intake experience comes from the configured guidance source', async () => {
  const service = fixtureService(new MemoryParseRepository());
  const experience = await service.experience({
    industry: 'hair_care',
    assetType: 'price_list',
  });

  assert.deepEqual(
    experience.steps.map((step) => step.id),
    [
      'see_examples',
      'choose_recommendations',
      'say_or_upload',
      'ai_arrange',
      'confirm_each',
    ],
  );
  assert.equal(experience.steps[4].optional, false);
  assert.match(experience.disclosure, /第三方解析服务/u);
  assert.match(experience.disclosure, /随时跳过/u);

  const groupBuy = await service.experience({
    industry: 'skin_management',
    assetType: 'group_buy',
  });
  assert.match(groupBuy.examples[0]!.title, /皮肤管理团购套餐/u);
});

function fixtureService(
  repository: MemoryParseRepository,
  provider: DocumentParseProvider = new FixtureDocumentParseProvider(),
  jobs?: { submit(input: unknown): Promise<never> },
) {
  return new ParseService(
    repository,
    provider,
    new FixtureAssetDraftCompiler(),
    new FixtureVisualAssetClassifier(),
    {
      async isAuthorized(workspaceId, input) {
        return (
          workspaceId === context.workspaceId &&
          input.objectKey.startsWith(`${workspaceId}/owned/`)
        );
      },
    },
    undefined,
    jobs as never,
    () => now,
  );
}

function source(assetId: string): ParseSourceAssetInput {
  return {
    assetId,
    objectKey: `${context.workspaceId}/owned/${assetId}.png`,
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
    contentType: 'image/png',
    sourceUrl: `https://assets.example.test/${assetId}.png`,
    inputKind: 'document_image',
    target: 'price_list',
    rightsStatus: 'confirmed',
  };
}

function priceFact(
  referenceId: string,
  amount: number,
): StoreFactCandidateDraft {
  return {
    kind: 'price',
    key: 'offer.price',
    value: { amount, currency: 'CNY' },
    scope: { storeId: context.workspaceId },
    source: {
      kind: 'user_confirmation',
      referenceId,
      capturedAt: now,
    },
    effectiveFrom: now,
    expiresAt: null,
  };
}
