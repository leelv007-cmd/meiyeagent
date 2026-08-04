import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAssetBatchInputSchema,
  requiredP1Capability,
  type ParseSourceAssetInput,
} from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { AssetMemoryFoundationModule } from './asset-memory-foundation-module.js';
import {
  AssetIntakeService,
  MemoryAssetIntakeRepository,
} from './asset-intake-service.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';
import {
  FixtureAssetDraftCompiler,
  FixtureDocumentParseProvider,
  FixtureVisualAssetClassifier,
  MemoryParseRepository,
  ParseService,
} from './parse-service.js';

const now = '2026-07-18T06:00:00.000Z';
const context: P1Context = {
  actor: 'owner',
  correlationId: 'correlation-a',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

function parseSource(assetId: string): ParseSourceAssetInput {
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

function buildParseService(jobs?: {
  submit(input: unknown): Promise<never>;
}) {
  return new ParseService(
    new MemoryParseRepository(),
    new FixtureDocumentParseProvider(),
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

function buildModule(parsing?: ParseService) {
  return new AssetMemoryFoundationModule(
    new AssetIntakeService(
      new MemoryAssetIntakeRepository(),
      new MemoryStoreFactLedger(),
      () => now,
    ),
    parsing,
  );
}

test('asset-memory keeps direct fact confirmation as a trusted kernel seam', async () => {
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    new MemoryStoreFactLedger(),
    () => now,
  );
  await intake.recordBatch({
    batchId: 'batch-a',
    workspaceId: context.workspaceId,
    taskId: 'task-a',
    source: {
      sourceId: 'source-a',
      kind: 'manual',
      referenceId: 'upload-a',
      capabilityStatus: 'assisted',
      sourceWorkspaceId: context.workspaceId,
      capturedAt: now,
      example: false,
    },
    summary: '识别到一个待确认项目价格。',
    candidates: [
      {
        candidateId: 'candidate-price',
        objectKind: 'store_fact',
        status: 'pending',
        fact: {
          kind: 'price',
          key: 'offer.price',
          value: { amount: 299, currency: 'CNY' },
          scope: { storeId: 'store-a' },
          source: {
            kind: 'user_confirmation',
            referenceId: 'upload-a',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      },
    ],
    createdAt: now,
  });

  const module = new AssetMemoryFoundationModule(intake);
  const fact = await module.execute({
    context,
    idempotencyKey: 'confirm-price',
    input: {
      action: 'confirm_asset_intake_fact',
      payload: {
        batchId: 'batch-a',
        candidateId: 'candidate-price',
        factId: 'fact-price',
        expectedFactRevision: 0,
      },
    },
  });

  assert.deepEqual((fact as { value: unknown }).value, {
    amount: 299,
    currency: 'CNY',
  });
});

test('asset-memory denies and rejects all 21 retired public seams', async () => {
  const module = new AssetMemoryFoundationModule(
    new AssetIntakeService(
      new MemoryAssetIntakeRepository(),
      new MemoryStoreFactLedger(),
      () => now,
    ),
  );

  const commands = [
    'parse_asset_batch',
    'promote_asset_draft',
    'record_asset_intake_batch',
    'correct_asset_intake_fact',
    'reject_asset_intake_candidate',
    'propose_reusable_asset',
    'confirm_reusable_asset',
    'deactivate_series',
    'create_reuse_task',
    'record_preference_signal',
    'propose_preference',
    'confirm_preference',
    'revoke_preference',
  ] as const;
  const queries = [
    'parse_task_view',
    'asset_draft_view',
    'asset_intake_view',
    'asset_intake_missing_fact_keys',
    'reusable_asset_view',
    'reuse_task_seed',
    'series_suggestions',
    'preference_view',
  ] as const;

  for (const action of commands) {
    assert.equal(requiredP1Capability('command', 'asset-memory', action), null);
    await assert.rejects(
      module.execute({
        context,
        idempotencyKey: `retired-${action}`,
        input: { action, payload: {} },
      }),
      new RegExp(`Unknown asset-memory command ${action}`, 'u'),
    );
  }
  for (const action of queries) {
    assert.equal(requiredP1Capability('query', 'asset-memory', action), null);
    await assert.rejects(
      module.query({ context, input: { action, payload: {} } }),
      new RegExp(`Unknown asset-memory query ${action}`, 'u'),
    );
  }
});

test('batch parse surfaces require content.create / workspace.read', () => {
  assert.equal(
    requiredP1Capability(
      'command',
      'asset-memory',
      'start_parse_asset_batch',
    ),
    'content.create',
  );
  assert.equal(
    requiredP1Capability('query', 'asset-memory', 'asset_parse_task'),
    'workspace.read',
  );
  assert.equal(
    requiredP1Capability(
      'query',
      'asset-memory',
      'asset_parse_task_drafts',
    ),
    'workspace.read',
  );
  // Direct confirm remains a kernel seam (D-151); batch never opens it.
  assert.equal(
    requiredP1Capability(
      'command',
      'asset-memory',
      'confirm_asset_intake_fact',
    ),
    null,
  );
  assert.equal(
    requiredP1Capability('command', 'asset-memory', 'parse_asset_batch'),
    null,
  );
});

test('start_parse_asset_batch is idempotent after completion and keeps one active carrier', async () => {
  const submitted: Array<{ jobId?: string }> = [];
  const parsing = buildParseService({
    async submit(input) {
      submitted.push(structuredClone(input as { jobId?: string }));
      return {} as never;
    },
  });
  const module = buildModule(parsing);
  const payload = {
    taskId: 'batch-idempotent',
    sources: [parseSource('batch-a'), parseSource('batch-b')],
  };

  const first = (await module.execute({
    context,
    idempotencyKey: 'batch-1',
    input: { action: 'start_parse_asset_batch', payload },
  })) as { taskId: string; status: string; carrierAttempt?: number };

  assert.equal(first.taskId, 'batch-idempotent');
  assert.equal(first.status, 'queued');
  assert.equal(submitted.length, 1);
  assert.equal(first.carrierAttempt, 1);

  // Queued re-entry reserves a new carrier (recovery fence); stale carriers
  // no-op via carrierAttempt mismatch inside runBatchTask.
  const resubmit = (await module.execute({
    context,
    idempotencyKey: 'batch-2',
    input: { action: 'start_parse_asset_batch', payload },
  })) as { status: string; carrierAttempt?: number };
  assert.equal(resubmit.status, 'queued');
  assert.equal(resubmit.carrierAttempt, 2);
  assert.equal(submitted.length, 2);

  const completed = await parsing.runBatchTask(
    context.workspaceId,
    first.taskId,
    resubmit.carrierAttempt,
  );
  assert.equal(completed.status, 'completed');
  assert.equal(completed.progress.completed, 2);

  // Terminal re-entry returns the same completed projection and does not
  // submit another carrier or regress progress.
  const afterComplete = (await module.execute({
    context,
    idempotencyKey: 'batch-3',
    input: { action: 'start_parse_asset_batch', payload },
  })) as { status: string; progress: { completed: number } };

  assert.equal(afterComplete.status, 'completed');
  assert.equal(afterComplete.progress.completed, 2);
  assert.equal(submitted.length, 2);
});

test('asset-memory exposes parse task progress and draft enumeration', async () => {
  const parsing = buildParseService({
    async submit() {
      return {} as never;
    },
  });
  const module = buildModule(parsing);
  const payload = {
    taskId: 'batch-progress',
    sources: [parseSource('prog-a'), parseSource('prog-b')],
  };

  const task = (await module.execute({
    context,
    idempotencyKey: 'batch-progress',
    input: { action: 'start_parse_asset_batch', payload },
  })) as { taskId: string; carrierAttempt?: number; status: string };

  const pendingDrafts = (await module.query({
    context,
    input: {
      action: 'asset_parse_task_drafts',
      payload: { taskId: task.taskId },
    },
  })) as {
    taskId: string;
    items: Array<{ sourceAssetId: string; draft: unknown }>;
  };
  assert.equal(pendingDrafts.taskId, task.taskId);
  assert.equal(pendingDrafts.items.length, 2);
  assert.equal(pendingDrafts.items[0]?.draft, null);
  assert.equal(pendingDrafts.items[1]?.draft, null);

  await parsing.runBatchTask(
    context.workspaceId,
    task.taskId,
    task.carrierAttempt,
  );

  const progress = (await module.query({
    context,
    input: {
      action: 'asset_parse_task',
      payload: { taskId: task.taskId },
    },
  })) as {
    status: string;
    mode: string;
    progress: { completed: number; total: number; message: string };
    draftSupply: { kind: string; open: boolean };
  };
  assert.equal(progress.status, 'completed');
  assert.equal(progress.mode, 'batch_async');
  assert.equal(progress.progress.completed, 2);
  assert.equal(progress.progress.total, 2);
  assert.match(progress.progress.message, /2\/2/u);
  assert.deepEqual(progress.draftSupply, { kind: 'fixture', open: true });

  const drafts = (await module.query({
    context,
    input: {
      action: 'asset_parse_task_drafts',
      payload: { taskId: task.taskId },
    },
  })) as {
    items: Array<{
      sourceAssetId: string;
      draft: {
        origin: string;
        parser: { kind: string } | null;
      } | null;
    }>;
    draftSupply: { kind: string; open: boolean };
  };
  assert.equal(drafts.items[0]?.sourceAssetId, 'prog-a');
  assert.equal(drafts.items[1]?.sourceAssetId, 'prog-b');
  assert.equal(drafts.items[0]?.draft?.origin, 'parsed');
  assert.equal(drafts.items[0]?.draft?.parser?.kind, 'fixture');
  assert.equal(drafts.items[1]?.draft?.origin, 'parsed');
  assert.deepEqual(drafts.draftSupply, { kind: 'fixture', open: true });

  const experience = (await module.query({
    context,
    input: {
      action: 'asset_intake_experience',
      payload: { industry: 'hair_care', assetType: 'price_list' },
    },
  })) as { draftSupply: { kind: string; open: boolean } };
  assert.deepEqual(experience.draftSupply, { kind: 'fixture', open: true });
});

test('start_parse_asset_batch rejects invalid payloads and unknown actions', async () => {
  const module = buildModule(
    buildParseService({
      async submit() {
        return {} as never;
      },
    }),
  );

  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'too-few',
      input: {
        action: 'start_parse_asset_batch',
        payload: {
          taskId: 'too-few',
          sources: [parseSource('only-one')],
        },
      },
    }),
    /Invalid asset-memory payload/u,
  );

  assert.throws(
    () =>
      parseAssetBatchInputSchema.parse({
        taskId: 'dup',
        sources: [parseSource('a'), parseSource('a')],
      }),
    /unique/u,
  );

  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'unknown',
      input: { action: 'not_a_real_command', payload: {} },
    }),
    /Unknown asset-memory command not_a_real_command/u,
  );
  await assert.rejects(
    module.query({
      context,
      input: { action: 'not_a_real_query', payload: {} },
    }),
    /Unknown asset-memory query not_a_real_query/u,
  );
});
