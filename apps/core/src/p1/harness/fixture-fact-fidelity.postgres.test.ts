import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { contentPackageSchema } from '@meiye/contracts';
import { Pool } from 'pg';

import {
  FixtureAiStructuredObjectExecutor,
} from '../model-supply/ai-sdk-runner.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import {
  AssetIntakeService,
} from '../operations/asset-intake-service.js';
import { MemoryContextSourceRevisionRepository } from '../operations/context-source-revisions.js';
import { PostgresAssetIntakeRepository } from '../operations/postgres-asset-intake-repository.js';
import { PostgresContextBundleRepository } from '../operations/postgres-context-bundle-repository.js';
import { PostgresStoreFactLedger } from '../operations/postgres-store-fact-ledger.js';
import { createMarketingPackageEvidence } from './marketing-package-evidence.js';
import { LedgerBackedHarnessContextPort } from './production-context-port.js';
import { projectTodayRecommendation } from './today-recommendation.js';
import {
  compileExecutionBrief,
  type IntentDeclaration,
} from './structured-nodes.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { frozenHarnessPrompt } from './frozen-prompt.testing.js';

const connectionString = process.env.TEST_DATABASE_URL;
const now = '2026-07-25T12:00:00.000Z';

test(
  'asset intake fact reaches the frozen bundle, fixture brief and delivery evidence',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const intakeRepository = new PostgresAssetIntakeRepository(pool);
    const facts = new PostgresStoreFactLedger(pool);
    const bundles = new PostgresContextBundleRepository(pool);
    const workspaceId = `t43-fixture-fidelity-${randomUUID()}`;
    await intakeRepository.migrate();
    await facts.migrate();
    await bundles.migrate();

    try {
      const intake = new AssetIntakeService(
        intakeRepository,
        facts,
        () => now,
      );
      const prepared = await intake.recordBatch({
        batchId: 't43-price-batch',
        workspaceId,
        taskId: 't43-intake-task',
        source: {
          sourceId: 't43-price-source',
          kind: 'pasted_text',
          referenceId: 't43-price-reference',
          capabilityStatus: 'assisted',
          sourceWorkspaceId: workspaceId,
          capturedAt: now,
          example: false,
        },
        summary: 'Current price candidate: CNY 299',
        candidates: [
          {
            candidateId: 't43-price-candidate',
            objectKind: 'store_fact',
            status: 'pending',
            fact: {
              kind: 'price',
              key: 'offer.price',
              value: { amount: 299, currency: 'CNY' },
              scope: { storeId: workspaceId },
              source: {
                kind: 'user_confirmation',
                referenceId: 't43-price-reference',
                capturedAt: now,
              },
              effectiveFrom: now,
              expiresAt: null,
            },
          },
        ],
        createdAt: now,
      });
      const fact = await intake.confirmFact(
        { workspaceId, userId: 'owner-t43' },
        {
          batchId: prepared.batchId,
          candidateId: 't43-price-candidate',
          factId: 't43-offer-price',
          expectedFactRevision: 0,
          idempotencyKey: 't43-confirm-price',
        },
      );
      const headRows = await pool.query<{
        fact_id: string;
        revision: string;
        workspace_id: string;
      }>(
        `SELECT workspace_id, fact_id, revision::text
           FROM p1_store_fact_heads
          WHERE workspace_id = $1`,
        [workspaceId],
      );
      assert.deepEqual(headRows.rows, [
        {
          workspace_id: workspaceId,
          fact_id: fact.factId,
          revision: '1',
        },
      ]);
      t.diagnostic(`p1_store_fact_heads=${JSON.stringify(headRows.rows)}`);

      const contextPort = new LedgerBackedHarnessContextPort(
        facts,
        bundles,
        () => now,
        new MemoryContextSourceRevisionRepository(),
      );
      const request: HarnessWorkflowInput = {
        actorId: 'owner-t43',
        workspaceId,
        packageId: 't43-package',
        expectedRevision: 0,
        workflowRevision: 1,
        creationMode: 'customized',
        rawInput: '参考 https://example.invalid/weekend 写一条头疗团购文案',
        factScope: { storeId: workspaceId },
        intent: {
          context: {
            workId: 't43-work',
            intent: '参考周末话题写一条头疗团购文案',
            sourceSummaries: [],
          },
          assetReferences: [],
        },
      };
      const declaration: IntentDeclaration = {
        normalizedIntent: request.rawInput,
        taskType: 'traffic_opportunity',
        deliveryLayer: 'copy',
        relevantAssetCategories: ['promotion_activity'],
        usedAssetCategories: ['promotion_activity'],
        route: 'customized',
        routingSource: 'model',
        implicitConstraints: ['只使用已确认事实'],
      };
      const context = await contextPort.compileAndFreeze({
        workflowId: 't43-workflow',
        request,
        declaration,
      });
      assert.deepEqual(context.bundle.referencedFactRevisions, [
        { factId: fact.factId, revision: fact.revision },
      ]);
      assert.equal(
        context.bundle.dimensions.store_facts_assets['offer.price']?.sourceRef,
        `store_fact:${fact.factId}:${fact.revision}`,
      );

      const runner = new RecordingFixtureRunner();
      const brief = await compileExecutionBrief(
        {
          prompt: frozenHarnessPrompt('briefCompilation'),
          workflowId: 't43-workflow',
          unitId: 'copy-r1',
          unitKind: 'copy',
          declaration,
          bundle: context.bundle,
          allowedFactRefs: [`store_fact:${fact.factId}:${fact.revision}`],
        },
        runner,
      );
      if (brief.kind !== 'copy') throw new Error('Expected a copy brief.');
      const prompt = JSON.parse(runner.requests[0]!.prompt) as {
        bundle: {
          referencedFactRevisions: unknown;
          dimensions: { store_facts_assets: Record<string, unknown> };
        };
      };
      assert.deepEqual(
        prompt.bundle.referencedFactRevisions,
        context.bundle.referencedFactRevisions,
      );
      assert.deepEqual(brief.factRefs, [
        `store_fact:${fact.factId}:${fact.revision}`,
      ]);
      t.diagnostic(
        `fact_chain=${JSON.stringify({
          bundleFactRefs: context.bundle.referencedFactRevisions,
          promptFactRefs: prompt.bundle.referencedFactRevisions,
          briefFactRefs: brief.factRefs,
        })}`,
      );

      const evidence = createMarketingPackageEvidence({
        declaration,
        context,
        authorizedFactRefs: brief.factRefs,
        at: now,
      });
      assert.deepEqual(evidence.factRefs, brief.factRefs);

      const versionId = 't43-version-1';
      const title = '本周头疗团购推荐';
      const body = '本店已确认头疗团购价为 299 元，欢迎私信了解当前项目。';
      const whyNow = '当前任务与本店已确认的头疗团购事实匹配';
      const currentFactsRevision = await facts.currentRevision(workspaceId);
      assert.equal(context.factsRevision, currentFactsRevision);
      const recommendation = projectTodayRecommendation(
        workspaceId,
        currentFactsRevision,
        {
          taskId: request.intent.context.workId,
          rawInput: request.rawInput,
          deliveredAt: now,
          delivery: {
            packageId: request.packageId,
            versionId,
            revision: 1,
          },
          contentPackage: contentPackageSchema.parse({
            workspaceId,
            id: request.packageId,
            kind: 'image_text',
            status: 'review_ready',
            revision: 1,
            currentVersionId: versionId,
            createdAt: now,
            updatedAt: now,
            source: {
              assetIds: [],
              workflowId: 't43-workflow',
              workId: request.intent.context.workId,
            },
            rights: { state: 'authorized' },
            compliance: {
              aigcLabelEnabled: true,
              watermarkEnabled: false,
            },
            lineage: {},
            generated: { childRuns: [] },
            exportReceipts: [],
            variants: [],
            versions: [
              {
                id: versionId,
                title,
                body,
                conversionHook: '私信了解当前项目',
                orderedAssetIds: [],
                topics: [],
                createdAt: now,
                createdBy: request.intent.context.workId,
                source: 'ai_generated',
              },
            ],
          }),
          contextTrace: {
            sourceRevisions: {
              ...context.bundle.sourceRevisions,
              facts: context.factsRevision,
            },
          },
          briefTrace: {
            factRefs: brief.factRefs,
          },
          selectionTrace: {
            winnerCandidateId: 'c01',
            candidateScores: [{ candidateId: 'c01', reason: whyNow }],
          },
        },
        now,
      );
      assert.ok(recommendation.recommendation);
      assert.equal(recommendation.recommendation.title, title);
      assert.equal(recommendation.recommendation.body, body);
      assert.equal(recommendation.recommendation.whyNow, whyNow);
      assert.deepEqual(
        recommendation.recommendation.factReferences,
        brief.factRefs,
      );
      t.diagnostic(
        `today_recommendation=${JSON.stringify({
          title: recommendation.recommendation.title,
          body: recommendation.recommendation.body,
          whyNow: recommendation.recommendation.whyNow,
          factReferences: recommendation.recommendation.factReferences,
        })}`,
      );
    } finally {
      await bundles.deleteWorkspaceForTest(workspaceId);
      await intakeRepository.deleteWorkspaceForTest(workspaceId);
      await facts.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

class RecordingFixtureRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];
  private readonly executor = new FixtureAiStructuredObjectExecutor();

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    const result = await this.executor.generate({
      abortSignal: request.abortSignal,
      instructions: request.instructions,
      onPartialOutput: request.onPartialOutput,
      prompt: request.prompt,
      schema: request.schema,
      schemaName: request.schemaName,
    });
    return {
      ...result,
      attempts: 1,
      replayed: false,
    };
  }
}
