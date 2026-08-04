/**
 * L1-1: single-page note regenerate production path (true single page).
 *
 * Fresh-library PG pattern: skip without TEST_DATABASE_URL.
 * Seeds a 3-page note ContentPackage in PG, resolves it through the production
 * source resolver, runs merchant page regeneration, and asserts:
 * - exactly 1 image provider call
 * - trusted usage image quantity = 1
 * - pages 1 and 3 keep body + asset ids
 * - page 2 receives a new revision/asset
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  contentPackageCarrierOf,
  contentPackageSchema,
  imageTextNoteVersionSchema,
  type ContentPackage,
  type NotePlan,
} from '@meiye/contracts';
import { Pool } from 'pg';

import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import {
  ExecutionSourceContentPackageResolver,
  type SourceContentPackageReader,
} from '../execution-spine/source-content-package-resolver.js';
import { buildContentPackage } from '../operations/content-package.js';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import { unconfiguredNotePlanEnhancementJudgeResolver } from './note-plan-structured-port.js';
import {
  UnifiedHarnessStagePorts,
  type HarnessMediaExecutionPort,
} from './unified-media-stage-ports.js';
import type {
  HarnessContextSnapshot,
  HarnessStagePorts,
} from './workflow-core.js';
import type { ContentPackageRevisionWritePort } from '../execution-spine/content-package-revision-port.js';
import type { HarnessWorkflowInput } from './task-admission.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'single-page note regeneration keeps other pages and records usage=1',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    await operations.migrate();
    const suffix = randomUUID().slice(0, 8);
    const workspaceId = `ws-note-regen-${suffix}`;
    const packageId = `pkg-note-regen-${suffix}`;
    const sourceAssetIds = [
      `asset-${suffix}-1`,
      `asset-${suffix}-2`,
      `asset-${suffix}-3`,
    ];
    const plan = threePagePlan(sourceAssetIds);
    const note = imageTextNoteVersionSchema.parse({
      schema: 'image-text-note-version/v1',
      plan,
      regenerationReceipts: [],
    });
    const timestamp = '2026-08-02T00:00:00.000Z';

    try {
      const seeded = contentPackageSchema.parse({
        ...buildContentPackage({
          id: packageId,
          kind: 'image_text',
          source: {
            assetIds: sourceAssetIds,
            targetPlatform: 'xiaohongshu',
            workId: `work-${suffix}`,
            workflowId: `task-${suffix}`,
            workflowRevision: 1,
          },
          timestamp,
          workspaceId,
        }),
        revision: 1,
        status: 'accepted',
        currentVersionId: `${packageId}-v1`,
        versions: [
          {
            id: `${packageId}-v1`,
            title: plan.themeAnchor,
            body: plan.pages.map((page) => page.textBlock.body).join('\n\n'),
            orderedAssetIds: [...sourceAssetIds],
            topics: [],
            createdAt: timestamp,
            source: 'ai_generated',
            note,
            harnessCandidateId: plan.style.id,
            harnessScore: 100,
          },
        ],
        generated: {
          assetIds: sourceAssetIds,
          childRuns: [],
          ownedAssets: sourceAssetIds.map((id) => ownedAsset(id)),
        },
      });
      await pool.query(
        `INSERT INTO p1_content_packages
           (workspace_id, id, payload, revision, updated_at)
         VALUES ($1, $2, $3::jsonb, 1, $4)`,
        [workspaceId, packageId, JSON.stringify(seeded), timestamp],
      );

      const reader: SourceContentPackageReader = {
        async get(input) {
          const row = await pool.query<{ payload: ContentPackage }>(
            `SELECT payload
               FROM p1_content_packages
              WHERE workspace_id = $1 AND id = $2`,
            [input.workspaceId, input.packageId],
          );
          return row.rows[0]?.payload ?? null;
        },
      };
      const sourcePackages = new ExecutionSourceContentPackageResolver(reader);
      const resolved = await sourcePackages.resolve({
        workspaceId,
        source: { id: packageId, revision: '1' },
      });
      assert.ok(resolved?.note);
      assert.equal(resolved.note?.plan.pages.length, 3);

      let imageCalls = 0;
      let billingTrustedUsage:
        | {
            kind: string;
            units: Array<{ resource: string; quantity: number }>;
            evidenceRef: string;
          }
        | undefined;

      const media: HarnessMediaExecutionPort = {
        async execute() {
          imageCalls += 1;
          const id = `asset-${suffix}-regen-${imageCalls}`;
          return {
            kind: 'image',
            asset: ownedAsset(id),
            childRun: {
              runId: `run-${id}`,
              runType: 'model_job',
              status: 'succeeded',
              assetIds: [id],
              productUsage: { quantity: 1, status: 'committed' },
            },
            trace: {
              stage: 'execution_selection',
              winnerCandidateId: id,
              candidateScores: [],
              blockedCandidates: [],
              rubricVersion: 'test',
              rubricHash: createHash('sha256').update('test').digest('hex'),
            },
          };
        },
      };

      const writer: ContentPackageRevisionWritePort = {
        async write(input) {
          billingTrustedUsage = structuredClone(
            input.billingTrustedUsage as typeof billingTrustedUsage,
          );
          return {
            packageId: input.packageId,
            versionId: input.version.id,
            revision: input.expectedRevision + 1,
          };
        },
      };

      const ports = new UnifiedHarnessStagePorts({
        core: {
          contentPackages: writer,
          now: () => '2026-08-02T01:00:00.000Z',
          runners: {
          create() {
            return {
              async run() {
                throw new Error('structured runner unused for page regen');
              },
            };
          },
        },
        },
        collaborators: {
          copy: emptyCopyPorts(),
          media: media,
        },
        capabilities: {
          noteSettings: {
          async read() {
            return { styles: { styles: [] } };
          },
        },
          noteEnhancementJudge: unconfiguredNotePlanEnhancementJudgeResolver,
          sourceContentPackages: sourcePackages,
        },
      });

      const request = pageRegenRequest({
        workspaceId,
        packageId,
        derivedPackageId: `pkg-derived-${suffix}`,
        taskId: `task-derived-${suffix}`,
        workId: `work-derived-${suffix}`,
        targetAssetId: sourceAssetIds[1]!,
      });
      const context = emptyContext(request, sourceAssetIds);
      const brief = {
        kind: 'image_text_note' as const,
        candidates: {
          candidates: [
            {
              styleId: plan.style.id,
              styleName: plan.style.name,
              positioning: plan.style.positioning,
              plan,
            },
          ],
        },
      };

      const selection = await ports.executeNoteAndSelect({
        workflowId: request.packageId,
        request,
        brief,
        context,
        selectedStyleId: plan.style.id,
      });

      assert.equal(imageCalls, 1, 'exactly one image provider call');
      assert.equal(selection.ownedAssets.length, 1);
      assert.equal(
        selection.version.plan.pages[0]?.imageAssetId,
        sourceAssetIds[0],
      );
      assert.equal(
        selection.version.plan.pages[2]?.imageAssetId,
        sourceAssetIds[2],
      );
      assert.equal(selection.version.plan.pages[1]?.revision, 2);
      assert.notEqual(
        selection.version.plan.pages[1]?.imageAssetId,
        sourceAssetIds[1],
      );
      assert.equal(
        selection.version.plan.pages[0]?.textBlock.body,
        plan.pages[0]?.textBlock.body,
      );
      assert.equal(
        selection.version.plan.pages[2]?.textBlock.body,
        plan.pages[2]?.textBlock.body,
      );
      assert.equal(
        selection.version.regenerationReceipts.at(-1)?.imagePoints,
        1,
      );

      await ports.assembleNoteAndDeliver({
        workflowId: request.packageId,
        request,
        declaration: {
          normalizedIntent: '重新生成第 2 页',
          taskType: 'daily_service_exposure',
          deliveryLayer: 'finished_media',
          relevantAssetCategories: ['product_service'],
          usedAssetCategories: ['product_service'],
          route: 'free',
          routingSource: 'model',
          implicitConstraints: [],
        } as never,
        context,
        brief,
        selection,
      });

      assert.deepEqual(billingTrustedUsage, {
        kind: 'product_units',
        units: [{ resource: 'image', quantity: 1 }],
        evidenceRef: `note-page-regeneration:${sourceAssetIds[1]}`,
      });
      assert.equal(
        contentPackageCarrierOf({
          kind: 'image_text',
          orderedAssetCount: selection.version.plan.pages.length,
        }),
        'note',
      );
    } finally {
      await pool.query(
        `DELETE FROM p1_content_packages WHERE workspace_id = $1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

function threePagePlan(assetIds: string[]): NotePlan {
  return {
    schema: 'note-plan/v1',
    themeAnchor: '夏日控油护理',
    style: {
      id: 'story',
      name: '种草叙事版',
      positioning: '真实体验导向',
    },
    pages: [1, 2, 3].map((order) => ({
      id: `page-${order}`,
      order,
      revision: 1,
      pageRole:
        order === 1
          ? ('cover' as const)
          : order === 3
            ? ('cta_guide' as const)
            : ('pain_scene' as const),
      pagePurpose:
        order === 1
          ? ('capture_attention' as const)
          : order === 3
            ? ('drive_action' as const)
            : ('name_customer_pain' as const),
      imageIntent: {
        operation: 'image.generate' as const,
        purpose: `page-${order}`,
        subject: '门店护理项目',
        scene: '真实门店场景',
        composition: '主体清晰',
        references: [],
        exactText: [],
        changes: [],
        invariants: [],
        factRefs: [],
        rightsRefs: [],
        outputPlan: { kind: 'single' as const },
      },
      textBlock: {
        title: `第 ${order} 页标题`,
        body: `第 ${order} 页正文`,
        exactText: [],
      },
      dependencies:
        order === 1
          ? []
          : [{ pageId: `page-${order - 1}`, kind: 'text_sequence' as const }],
      imageAssetId: assetIds[order - 1],
    })),
  };
}

function ownedAsset(id: string) {
  return {
    id,
    objectKey: `workspace/generated/${id}.png`,
    contentType: 'image/png',
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
  };
}

function pageRegenRequest(input: {
  workspaceId: string;
  packageId: string;
  derivedPackageId: string;
  taskId: string;
  workId: string;
  targetAssetId: string;
}): HarnessWorkflowInput {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: input.workspaceId,
      idempotencyKey: `idem-${input.taskId}`,
      taskId: input.taskId,
      workId: input.workId,
      contentPackageId: input.derivedPackageId,
      expectedContentPackageRevision: 0,
      creationMode: 'free',
      intent: '重新生成图文笔记第 2 页配图。',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-note', revision: 'recipe-r1' },
      lens: 'image_text_note',
      operation: 'image.generate',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: {
        kind: 'note',
        quantity: 1,
        aspectRatio: '3:4',
        notePageBound: 3,
      },
      deliverables: [
        {
          id: 'image_text_note-main',
          kind: 'image_text_note',
          order: 0,
          quantity: 1,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      ],
      sources: {
        assets: [],
        contentPackage: { id: input.packageId, revision: '1' },
        pageRegeneration: { targetAssetId: input.targetAssetId },
      },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: 'model-image_text_note-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      contentModules: ['social_cover'],
    },
    '2026-08-02T01:00:00.000Z',
  );
  return {
    actorId: snapshot.actorId,
    workspaceId: snapshot.workspaceId,
    packageId: input.derivedPackageId,
    expectedRevision: 0,
    workflowRevision: snapshot.revision,
    creationMode: snapshot.creationMode,
    rawInput: snapshot.intent.text,
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    executionSnapshot: snapshot,
  };
}

function emptyCopyPorts(): HarnessStagePorts {
  return {
    async nameIntent() {
      throw new Error('unused');
    },
    async injectContext() {
      throw new Error('unused');
    },
    async fenceContext() {
      throw new Error('unused');
    },
    async compileBrief() {
      throw new Error('unused');
    },
    async executeAndSelect() {
      throw new Error('unused');
    },
    async assembleAndDeliver() {
      throw new Error('unused');
    },
  };
}

function emptyContext(
  request: HarnessWorkflowInput,
  authorizedAssetIds: readonly string[] = [],
): HarnessContextSnapshot {
  return {
    bundle: {
      bundleId: `bundle-${request.packageId}`,
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1',
      workspaceId: request.workspaceId,
      taskId: request.packageId,
      frozenAt: '2026-08-02T00:00:00.000Z',
      frozenBy: 'owner-1',
      previousRevision: null,
      referencedFactRevisions: [],
      sourceRevisions: {
        facts: 0,
        assets: 1,
        identity: 1,
        rights: 1,
        preferences: 0,
        recipe: 1,
        platformRules: 1,
        currentSignal: 1,
      },
      dimensions: {
        promotion_task: {},
        traffic_opportunity: {},
        expression_identity: {},
        platform_mechanism: {},
        store_facts_assets: {},
        conversion_action: {},
      },
    },
    activeFacts: [],
    policyReferences: {
      sourceRefs: [],
      rightsRefs: authorizedAssetIds.map((assetId) => ({
        assetId,
        workspaceId: request.workspaceId,
        status: 'authorized' as const,
        allowedUses: ['public_content'] as const,
      })),
      identityRefs: [
        {
          id: 'marketing_identity:identity-1:identity-r1',
          workspaceId: request.workspaceId,
          status: 'registered',
        },
      ],
    },
  };
}
