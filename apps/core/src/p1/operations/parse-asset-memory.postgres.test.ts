import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import type { P1Context } from '../foundation/domain.js';
import type { IntentDeclaration } from '../harness/structured-nodes.js';
import type { HarnessWorkflowInput } from '../harness/task-admission.js';
import { LedgerBackedHarnessContextPort } from '../harness/production-context-port.js';
import { AssetIntakeService } from './asset-intake-service.js';
import { AssetMemoryFoundationModule } from './asset-memory-foundation-module.js';
import { MemoryContextSourceRevisionRepository } from './context-source-revisions.js';
import {
  FixtureAssetDraftCompiler,
  FixtureDocumentParseProvider,
  FixtureVisualAssetClassifier,
  ParseProviderError,
  ParseService,
} from './parse-service.js';
import { PostgresAssetIntakeRepository } from './postgres-asset-intake-repository.js';
import { PostgresContextBundleRepository } from './postgres-context-bundle-repository.js';
import { PostgresParseRepository } from './postgres-parse-repository.js';
import { PostgresStoreFactLedger } from './postgres-store-fact-ledger.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from './reuse-memory-service.js';

const connectionString = process.env.TEST_DATABASE_URL;
const now = '2026-07-26T02:00:00.000Z';

test(
  'Core PG journey promotes an unconfirmed parse draft and exposes only its confirmed fact to ContextBundle',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const workspaceId = `t24-journey-${randomUUID()}`;
    const context: P1Context = {
      actor: 'owner',
      correlationId: 't24-correlation',
      userId: 'owner-t24',
      workspaceId,
    };
    const parseRepository = new PostgresParseRepository(pool);
    const intakeRepository = new PostgresAssetIntakeRepository(pool);
    const facts = new PostgresStoreFactLedger(pool);
    const bundles = new PostgresContextBundleRepository(pool);
    await parseRepository.migrate();
    await intakeRepository.migrate();
    await facts.migrate();
    await bundles.migrate();
    const parsing = new ParseService(
      parseRepository,
      new FixtureDocumentParseProvider(),
      new FixtureAssetDraftCompiler(),
      new FixtureVisualAssetClassifier(),
      { isAuthorized: async () => true },
      undefined,
      undefined,
      () => now,
    );
    const module = new AssetMemoryFoundationModule(
      new AssetIntakeService(intakeRepository, facts, () => now),
      bundles,
      new ReuseMemoryService(
        new MemoryReuseMemoryRepository(),
        { verifyCandidate: async () => {}, verifyRevision: async () => {} },
        () => now,
      ),
      undefined,
      () => now,
      parsing,
    );
    try {
      const parsed = (await module.execute({
        context,
        idempotencyKey: 't24-parse',
        input: {
          action: 'parse_single_asset',
          payload: {
            taskId: 't24-parse-task',
            source: {
              assetId: 't24-price-sheet',
              objectKey: `${workspaceId}/price-sheet.png`,
              sha256: 'c'.repeat(64),
              sizeBytes: 256,
              contentType: 'image/png',
              sourceUrl: 'https://assets.example.test/price-sheet.png',
              inputKind: 'document_image',
              target: 'price_list',
              rightsStatus: 'confirmed',
            },
          },
        },
      })) as { draft: { draftId: string; revision: number } };
      const taskView = (await module.query({
        context,
        input: {
          action: 'parse_task_view',
          payload: { taskId: 't24-parse-task' },
        },
      })) as { status: string; progress: { completed: number; total: number } };
      assert.equal(taskView.progress.completed, 1);
      assert.equal(taskView.progress.total, 1);
      assert.equal(taskView.status, 'completed');
      const draftView = (await module.query({
        context,
        input: {
          action: 'asset_draft_view',
          payload: {
            draftId: parsed.draft.draftId,
            revision: parsed.draft.revision,
          },
        },
      })) as { fields: Array<{ status: string }> };
      assert.ok(draftView.fields.every((field) => field.status === 'unconfirmed'));
      const experience = (await module.query({
        context,
        input: {
          action: 'asset_intake_experience',
          payload: { industry: 'hair_care', assetType: 'price_list' },
        },
      })) as { steps: Array<{ id: string }> };
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
      const promoted = (await module.execute({
        context,
        idempotencyKey: 't24-promote',
        input: {
          action: 'promote_asset_draft',
          payload: {
            draftId: parsed.draft.draftId,
            draftRevision: parsed.draft.revision,
            batchId: 't24-confirmation-batch',
          },
        },
      })) as { candidates: Array<{ candidateId: string }> };
      assert.equal(await facts.currentRevision(workspaceId), 0);

      const contextPort = new LedgerBackedHarnessContextPort(
        facts,
        bundles,
        () => now,
        new MemoryContextSourceRevisionRepository(),
      );
      const before = await contextPort.compileAndFreeze({
        workflowId: 't24-before-confirmation',
        request: workflowRequest(workspaceId, 'before'),
        declaration: declaration(),
      });
      assert.deepEqual(before.bundle.referencedFactRevisions, []);

      const confirmed = (await module.execute({
        context,
        idempotencyKey: 't24-confirm',
        input: {
          action: 'confirm_asset_intake_fact',
          payload: {
            batchId: 't24-confirmation-batch',
            candidateId: promoted.candidates[0]!.candidateId,
            factId: 't24-offer-price',
            expectedFactRevision: 0,
          },
        },
      })) as { factId: string; revision: number };
      const after = await contextPort.compileAndFreeze({
        workflowId: 't24-after-confirmation',
        request: workflowRequest(workspaceId, 'after'),
        declaration: declaration(),
      });
      assert.deepEqual(after.bundle.referencedFactRevisions, [
        { factId: confirmed.factId, revision: confirmed.revision },
      ]);

      const unavailableParsing = new ParseService(
        parseRepository,
        {
          async parse() {
            throw new ParseProviderError('failed', 'fixture unavailable');
          },
        },
        new FixtureAssetDraftCompiler(),
        new FixtureVisualAssetClassifier(),
        { isAuthorized: async () => true },
        undefined,
        undefined,
        () => now,
      );
      const unavailableModule = new AssetMemoryFoundationModule(
        new AssetIntakeService(intakeRepository, facts, () => now),
        bundles,
        new ReuseMemoryService(
          new MemoryReuseMemoryRepository(),
          { verifyCandidate: async () => {}, verifyRevision: async () => {} },
          () => now,
        ),
        undefined,
        () => now,
        unavailableParsing,
      );
      const manualSource = {
        assetId: 't24-manual-sheet',
        objectKey: `${workspaceId}/manual-sheet.png`,
        sha256: 'd'.repeat(64),
        sizeBytes: 128,
        contentType: 'image/png',
        sourceUrl: 'https://assets.example.test/manual-sheet.png',
        inputKind: 'document_image' as const,
        target: 'price_list' as const,
        rightsStatus: 'confirmed' as const,
      };
      const fallback = (await unavailableModule.execute({
        context,
        idempotencyKey: 't24-unavailable',
        input: {
          action: 'parse_single_asset',
          payload: { taskId: 't24-unavailable-task', source: manualSource },
        },
      })) as { draft: { origin: string } };
      assert.equal(fallback.draft.origin, 'manual');
      const manualDraft = (await unavailableModule.execute({
        context,
        idempotencyKey: 't24-manual-draft',
        input: {
          action: 'prepare_manual_asset_draft',
          payload: {
            taskId: 't24-unavailable-task',
            source: manualSource,
            fields: [
              { key: 'offer.price', value: { amount: 299, currency: 'CNY' } },
            ],
            factCandidates: [
              {
                kind: 'price',
                key: 'offer.price',
                value: { amount: 299, currency: 'CNY' },
                scope: { storeId: workspaceId },
                source: {
                  kind: 'user_confirmation',
                  referenceId: 'manual-placeholder',
                  capturedAt: now,
                },
                effectiveFrom: now,
                expiresAt: null,
              },
            ],
          },
        },
      })) as { draftId: string; revision: number };
      const manualBatch = (await unavailableModule.execute({
        context,
        idempotencyKey: 't24-manual-promote',
        input: {
          action: 'promote_asset_draft',
          payload: {
            draftId: manualDraft.draftId,
            draftRevision: manualDraft.revision,
            batchId: 't24-manual-batch',
          },
        },
      })) as { candidates: Array<{ candidateId: string }> };
      const manualFact = (await unavailableModule.execute({
        context,
        idempotencyKey: 't24-manual-confirm',
        input: {
          action: 'confirm_asset_intake_fact',
          payload: {
            batchId: 't24-manual-batch',
            candidateId: manualBatch.candidates[0]!.candidateId,
            factId: 't24-manual-price',
            expectedFactRevision: 0,
          },
        },
      })) as { value: unknown };
      assert.deepEqual(manualFact.value, { amount: 299, currency: 'CNY' });
      t.diagnostic(
        `fact_visibility=${JSON.stringify({
          before: before.bundle.referencedFactRevisions,
          after: after.bundle.referencedFactRevisions,
          manualFallback: manualFact.value,
        })}`,
      );
    } finally {
      await bundles.deleteWorkspaceForTest(workspaceId);
      await intakeRepository.deleteWorkspaceForTest(workspaceId);
      await facts.deleteWorkspaceForTest(workspaceId);
      await parseRepository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

function workflowRequest(
  workspaceId: string,
  suffix: string,
): HarnessWorkflowInput {
  return {
    actorId: 'owner-t24',
    workspaceId,
    packageId: `t24-package-${suffix}`,
    expectedRevision: 0,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: '写一条头皮护理团购文案',
    factScope: { storeId: workspaceId },
    intent: {
      context: {
        workId: `t24-work-${suffix}`,
        intent: '写一条头皮护理团购文案',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function declaration(): IntentDeclaration {
  return {
    normalizedIntent: '写一条头皮护理团购文案',
    taskType: 'traffic_opportunity',
    deliveryLayer: 'copy',
    relevantAssetCategories: ['promotion_activity'],
    usedAssetCategories: ['promotion_activity'],
    route: 'customized',
    routingSource: 'model',
    implicitConstraints: ['只使用已确认事实'],
  };
}
