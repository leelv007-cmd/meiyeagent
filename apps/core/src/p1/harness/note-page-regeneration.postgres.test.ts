/**
 * L1-1: single-page note regenerate production path (true single page).
 *
 * Fresh-library PG pattern: skip without TEST_DATABASE_URL.
 * Seeds a 3-page note ContentPackage in PG with mixed merchant-upload +
 * platform-generated assets, resolves through the production source resolver,
 * and delivers through the real PostgresContentPackageRevisionWritePort +
 * ProductContentPackageRightsResolver so #341 (inherited generated assets
 * misclassified as merchant sources) is reproducible on this path.
 *
 * Positive case (post-fix expectation): delivery lands revision 1 with
 * usage=1. Pre-fix this case is red on CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE.
 * Negative case: withdrawn merchant source asset still refuses delivery.
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
  ContentPackageRevisionWriteError,
  PostgresContentPackageRevisionWritePort,
} from '../execution-spine/content-package-revision-port.js';
import {
  ExecutionSourceContentPackageResolver,
  type SourceContentPackageReader,
} from '../execution-spine/source-content-package-resolver.js';
import { buildContentPackage } from '../operations/content-package.js';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import { ProductContentPackageRightsResolver } from '../operations/product-package-rights-adapter.js';
import { unconfiguredNotePlanEnhancementJudgeResolver } from './note-plan-structured-port.js';
import {
  UnifiedHarnessStagePorts,
  type HarnessMediaExecutionPort,
} from './unified-media-stage-ports.js';
import { harnessRuntimeId } from './workspace-scope.js';
import type {
  HarnessContextSnapshot,
  HarnessStagePorts,
} from './workflow-core.js';
import type { HarnessWorkflowInput } from './task-admission.js';

const connectionString = process.env.TEST_DATABASE_URL;

type PageRegenFixture = {
  cleanup: () => Promise<void>;
  derivedPackageId: string;
  genAsset2: string;
  genAsset3: string;
  merchantAssetId: string;
  packageId: string;
  plan: NotePlan;
  ports: UnifiedHarnessStagePorts;
  request: HarnessWorkflowInput;
  /** Flip merchant source asset to withdrawn after selection (mid-execution). */
  revokeMerchantAsset: () => void;
  taskId: string;
  workspaceId: string;
  imageCalls: () => number;
};

async function seedPageRegenFixture(pool: Pool): Promise<PageRegenFixture> {
  const operations = new PostgresOperationsRepository(pool);
  await operations.migrate();

  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws-note-regen-${suffix}`;
  const packageId = `pkg-note-regen-${suffix}`;
  const derivedPackageId = `pkg-derived-${suffix}`;
  const taskId = `task-derived-${suffix}`;
  const workId = `work-derived-${suffix}`;
  // Mixed mother-package assets: page1 merchant upload, page2/3 platform-generated.
  const merchantAssetId = `asset-${suffix}-source-1`;
  const genAsset2 = `asset-${suffix}-gen-2`;
  const genAsset3 = `asset-${suffix}-gen-3`;
  const orderedAssetIds = [merchantAssetId, genAsset2, genAsset3];
  const plan = threePagePlan(orderedAssetIds);
  const note = imageTextNoteVersionSchema.parse({
    schema: 'image-text-note-version/v1',
    plan,
    regenerationReceipts: [],
  });
  const timestamp = '2026-08-02T00:00:00.000Z';

  const mother = contentPackageSchema.parse({
    ...buildContentPackage({
      id: packageId,
      kind: 'image_text',
      source: {
        // Only merchant-uploaded material lives in source.assetIds.
        assetIds: [merchantAssetId],
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
        orderedAssetIds: [...orderedAssetIds],
        topics: [],
        createdAt: timestamp,
        source: 'ai_generated',
        note,
        harnessCandidateId: plan.style.id,
        harnessScore: 100,
      },
    ],
    // Platform-generated pages are owned receipts, not merchant source assets.
    generated: {
      assetIds: [genAsset2, genAsset3],
      childRuns: [],
      ownedAssets: [genAsset2, genAsset3].map((id) => ownedAsset(id)),
    },
  });
  await pool.query(
    `INSERT INTO p1_content_packages
       (workspace_id, id, payload, revision, updated_at)
     VALUES ($1, $2, $3::jsonb, 1, $4)`,
    [workspaceId, packageId, JSON.stringify(mother), timestamp],
  );

  const request = pageRegenRequest({
    workspaceId,
    packageId,
    derivedPackageId,
    taskId,
    workId,
    targetAssetId: genAsset2,
  });
  const snapshot = request.executionSnapshot!;

  // Derived package shell matches postgres-creation-submission-store shape
  // (revision 0, bound to this execution snapshot + source mother package).
  const derivedShell = {
    ...buildContentPackage({
      id: derivedPackageId,
      kind: 'image_text',
      source: {
        assetIds: [],
        creationExecutionSnapshot: {
          id: snapshot.id,
          revision: snapshot.revision,
          schemaVersion: snapshot.schemaVersion,
        },
        sourceContentPackage: { id: packageId, revision: '1' },
        targetPlatform: 'xiaohongshu',
        workId: snapshot.work.id,
        workflowId: snapshot.task.id,
        workflowRevision: snapshot.revision,
      },
      timestamp,
      workspaceId,
    }),
    lineage: { reusedFromPackageId: packageId },
  };
  await pool.query(
    `INSERT INTO p1_content_packages
       (workspace_id, id, payload, revision, updated_at)
     VALUES ($1, $2, $3::jsonb, 0, $4)`,
    [workspaceId, derivedPackageId, JSON.stringify(derivedShell), timestamp],
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

  // Mutable product rights: starts authorized so sourcing can pass; negative
  // tests flip to withdrawn mid-execution before delivery write.
  let merchantAuthorization: 'authorized' | 'withdrawn' = 'authorized';
  // Generated images are never merchant assets — they are absent from
  // p1_owned_assets / p1_creative_assets and thus from this product rights list.
  const rightsResolver = new ProductContentPackageRightsResolver({
    async load(loadWorkspaceId) {
      if (loadWorkspaceId !== workspaceId) return null;
      return {
        assets: [
          {
            id: merchantAssetId,
            sourceType: 'real',
            authorizationStatus: merchantAuthorization,
            consentScope: 'public_marketing',
            rightsEvidence: 'merchant-release.pdf',
            rightsNoFixedExpiry: true,
          },
        ],
      };
    },
  });

  // Production wires the same rights resolver into sourcing (core-assembly).
  const sourcePackages = new ExecutionSourceContentPackageResolver(
    reader,
    rightsResolver,
  );

  const writer = new PostgresContentPackageRevisionWritePort(
    pool,
    rightsResolver,
  );
  await writer.applySchema();

  let imageCalls = 0;
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
      media,
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

  return {
    cleanup: async () => {
      const runtimeWorkflowId = harnessRuntimeId(workspaceId, taskId);
      await pool.query(
        `DELETE FROM harness_runtime.audit_events WHERE workflow_id = $1`,
        [runtimeWorkflowId],
      );
      await pool.query(
        `DELETE FROM execution_spine.content_package_write_receipts
          WHERE workspace_id = $1`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM p1_content_packages WHERE workspace_id = $1`,
        [workspaceId],
      );
    },
    derivedPackageId,
    genAsset2,
    genAsset3,
    merchantAssetId,
    packageId,
    plan,
    ports,
    request,
    revokeMerchantAsset: () => {
      merchantAuthorization = 'withdrawn';
    },
    taskId,
    workspaceId,
    imageCalls: () => imageCalls,
  };
}

function noteBrief(plan: NotePlan) {
  return {
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
}

const declaration = {
  normalizedIntent: '重新生成第 2 页',
  taskType: 'daily_service_exposure',
  deliveryLayer: 'finished_media',
  relevantAssetCategories: ['product_service'],
  usedAssetCategories: ['product_service'],
  route: 'free',
  routingSource: 'model',
  implicitConstraints: [],
} as never;

test(
  'single-page note regeneration keeps other pages and delivers revision 1 with usage=1',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const pool = new Pool({ connectionString });
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const fixture = await seedPageRegenFixture(pool);
      cleanup = fixture.cleanup;
      const {
        derivedPackageId,
        genAsset2,
        genAsset3,
        merchantAssetId,
        plan,
        ports,
        request,
        taskId,
        workspaceId,
      } = fixture;
      // Production workflowId === taskId (task-admission); not package id.
      const workflowId = request.executionSnapshot!.task.id;
      assert.equal(workflowId, taskId);

      const context = emptyContext(request, [merchantAssetId]);
      const brief = noteBrief(plan);

      const selection = await ports.executeNoteAndSelect({
        workflowId,
        request,
        brief,
        context,
        selectedStyleId: plan.style.id,
      });

      assert.equal(fixture.imageCalls(), 1, 'exactly one image provider call');
      assert.equal(selection.ownedAssets.length, 1);
      assert.equal(
        selection.version.plan.pages[0]?.imageAssetId,
        merchantAssetId,
      );
      assert.equal(
        selection.version.plan.pages[2]?.imageAssetId,
        genAsset3,
      );
      assert.equal(selection.version.plan.pages[1]?.revision, 2);
      assert.notEqual(
        selection.version.plan.pages[1]?.imageAssetId,
        genAsset2,
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

      const delivery = await ports.assembleNoteAndDeliver({
        workflowId,
        request,
        declaration,
        context,
        brief,
        selection,
      });

      assert.equal(delivery.revision, 1);
      assert.equal(delivery.packageId, derivedPackageId);
      assert.ok(delivery.versionId);

      const persisted = await pool.query<{
        payload: ContentPackage;
        revision: string;
      }>(
        `SELECT payload, revision::text AS revision
           FROM p1_content_packages
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, derivedPackageId],
      );
      const derived = contentPackageSchema.parse(persisted.rows[0]?.payload);
      assert.equal(persisted.rows[0]?.revision, '1');
      assert.equal(derived.revision, 1);
      assert.equal(derived.currentVersionId, delivery.versionId);
      const deliveredVersion = derived.versions.find(
        (version) => version.id === delivery.versionId,
      );
      assert.ok(deliveredVersion?.note);
      const receipt = deliveredVersion.note.regenerationReceipts.at(-1);
      assert.equal(receipt?.imagePoints, 1);
      assert.equal(receipt?.pageId, plan.pages[1]?.id);

      const audit = await pool.query<{
        payload: {
          billingTrustedUsage?: {
            kind: string;
            units: Array<{ resource: string; quantity: number }>;
            evidenceRef: string;
          };
        };
      }>(
        `SELECT payload
           FROM harness_runtime.audit_events
          WHERE workflow_id = $1 AND event_type = 'package_delivered'`,
        [harnessRuntimeId(workspaceId, workflowId)],
      );
      assert.deepEqual(audit.rows[0]?.payload.billingTrustedUsage, {
        kind: 'product_units',
        units: [{ resource: 'image', quantity: 1 }],
        evidenceRef: `note-page-regeneration:${genAsset2}`,
      });

      assert.equal(
        contentPackageCarrierOf({
          kind: 'image_text',
          orderedAssetCount: selection.version.plan.pages.length,
        }),
        'note',
      );
    } finally {
      if (cleanup) await cleanup();
      await pool.end();
    }
  },
);

test(
  'delivery refuses a merchant source asset revoked mid-execution',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const pool = new Pool({ connectionString });
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const fixture = await seedPageRegenFixture(pool);
      cleanup = fixture.cleanup;
      const {
        derivedPackageId,
        merchantAssetId,
        plan,
        ports,
        request,
        revokeMerchantAsset,
        workspaceId,
      } = fixture;
      const workflowId = request.executionSnapshot!.task.id;
      const context = emptyContext(request, [merchantAssetId]);
      const brief = noteBrief(plan);

      // Sourcing still sees authorized merchant asset and generates the page.
      const selection = await ports.executeNoteAndSelect({
        workflowId,
        request,
        brief,
        context,
        selectedStyleId: plan.style.id,
      });

      // Live rights flip after selection — delivery write must re-check.
      revokeMerchantAsset();

      await assert.rejects(
        () =>
          ports.assembleNoteAndDeliver({
            workflowId,
            request,
            declaration,
            context,
            brief,
            selection,
          }),
        (error: unknown) => {
          assert.ok(error instanceof ContentPackageRevisionWriteError);
          assert.equal(error.code, 'CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE');
          return true;
        },
      );

      const persisted = await pool.query<{
        payload: ContentPackage;
        revision: string;
      }>(
        `SELECT payload, revision::text AS revision
           FROM p1_content_packages
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, derivedPackageId],
      );
      const derived = contentPackageSchema.parse(persisted.rows[0]?.payload);
      assert.equal(persisted.rows[0]?.revision, '0');
      assert.equal(derived.revision, 0);
      assert.equal(derived.currentVersionId, undefined);
    } finally {
      if (cleanup) await cleanup();
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
  const taskId = request.executionSnapshot?.task.id ?? request.packageId;
  return {
    bundle: {
      bundleId: `bundle-${request.packageId}`,
      revision: 1,
      hash: 'a'.repeat(64),
      serializerVersion: 'context-bundle-c14n-v1',
      workspaceId: request.workspaceId,
      taskId,
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
