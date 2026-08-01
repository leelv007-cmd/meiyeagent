import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { DBOS } from '@dbos-inc/dbos-sdk';
import { contentPackageSchema } from '@meiye/contracts';
import { Pool } from 'pg';
import { z, type ZodType } from 'zod';

import {
  AgentPrimitiveObservabilityAdapter,
  HarnessObservabilityEventAudit,
} from '../creation-experience/index.js';
import {
  createCreationExecutionSnapshot,
  OFFICIAL_NEUTRAL_IDENTITY,
} from '../execution-spine/creation-execution-snapshot.js';
import { ModelSupplyComposerRouteResolver } from '../execution-spine/composer-route-resolver.js';
import { PostgresContentPackageRevisionWritePort } from '../execution-spine/content-package-revision-port.js';
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from '../execution-spine/postgres-creation-submission-store.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import { PostgresCreditLedger } from '../credit-billing/postgres-credit-ledger.js';
import { P1ApplicationService } from '../foundation/application-service.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import {
  fromModelSupplyRouteSnapshot,
  toFoundationRouteCheckpoint,
} from '../route-snapshot-normalize.js';
import { PgBossJobPort } from '../job-runtime/pg-boss-job-port.js';
import {
  DurableTracerWorker,
  PostgresTracerJobRepository,
  TracerJobApplicationService,
} from '../job-runtime/tracer-worker.js';
import {
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  createDefaultCatalogModels,
  createDefaultDeployments,
  modelSupplyJobIdForKey,
  type CatalogModel,
  type MediaProviderEffectRequest,
  type MediaProviderLifecyclePort,
  type ModelSupplyResult,
  type ProviderExecutionRequest,
  type StructuredObjectExecutor,
} from '../model-supply/index.js';
import { FoundationModelSupplyLedger } from '../model-supply/foundation-ledger.js';
import {
  DurableMediaGenerationApplicationService,
  ModelMediaGenerationEffect,
} from '../model-supply/media-generation-workflow.js';
import { ModelSupplyStructuredNodeRunner } from '../model-supply/structured-node-runner.js';
import type {
  ClaimMerchantExecutionInput,
  MerchantExecutionBillingPort,
  MerchantExecutionPromotionPort,
} from '../product-billing/durable-service.js';
import {
  DurableProductBillingService,
  merchantExecutionInputHashes,
} from '../product-billing/durable-service.js';
import { PostgresProductBillingRepository } from '../product-billing/postgres-repository.js';
import {
  ModelSupplyCreationInputResolver,
} from '../operations/model-supply-creation-adapter.js';
import type { CreativeGroundingSnapshot } from '../operations/types.js';
import { buildContentPackage } from '../operations/content-package.js';
import { MemoryContextBundleRepository } from '../operations/context-bundle-repository.js';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import { MemoryStoreFactLedger } from '../operations/store-fact-ledger.js';
import {
  CapabilityHotAssemblyRegistry,
  type RuntimeCapabilityEntry,
} from '../supply-registry/hot-assembly.js';
import type { CredentialSecretBrokerPort } from '../supply-registry/secret-broker.js';
import {
  DbosHarnessWorkflowStarter,
  registerHarnessDbosWorkflow,
  resumeHarnessDbosInteractionWorkflow,
  resumeHarnessDbosWorkflow,
  sendHarnessMediaJobTerminal,
} from './dbos-workflow.js';
import { HarnessInteractionService } from './interaction-service.js';
import {
  HARNESS_BUILTIN_PROMPTS,
  HARNESS_LANGFUSE_PROMPT_NAMES,
  type HarnessFrozenPrompts,
} from './langfuse-prompts.js';
import {
  LangfuseHttpSender,
  langfuseTraceId,
} from './langfuse-sender.js';
import { PostgresNoteMediaAdmissionCoordinator } from './note-media-admission.js';
import type { HarnessLangfuseOutboxItem } from './outbox-worker.js';
import { unconfiguredNotePlanEnhancementJudgeResolver } from './note-plan-structured-port.js';
import { LedgerBackedHarnessContextPort } from './production-context-port.js';
import { ProductionHarnessFrozenRouteSnapshotResolver } from './production-frozen-route.js';
import { createProductionHarnessMediaAssembly } from './production-media-assembly.js';
import {
  ProductionHarnessStagePorts,
  type HarnessStructuredNodeRunnerFactory,
} from './production-stage-ports.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { PostgresHarnessBillingCompensationStore } from './postgres-billing-compensation-store.js';
import { PostgresHarnessResumeReconcilerStore } from './postgres-resume-reconciler-store.js';
import { HarnessProductBillingSettlementExecutor } from './product-billing-settlement.js';
import { HarnessResumeReconciler } from './resume-reconciler.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from './structured-nodes.js';
import {
  HarnessTaskAdmissionService,
  type HarnessSkillManifestSnapshot,
  type HarnessSkillManifestResolver,
  type HarnessWorkflowInput,
} from './task-admission.js';
import { harnessRuntimeId } from './workspace-scope.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const now = '2026-07-29T09:30:00.000Z';
const expectedStages = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
];

test(
  'production image media assembly durably joins admission to ContentPackage delivery',
  {
    skip:
      databaseUrl && systemDatabaseUrl
        ? false
        : 'TEST_DATABASE_URL and TEST_DBOS_SYSTEM_DATABASE_URL are required',
  },
  async (t) => {
    if (!databaseUrl || !systemDatabaseUrl) {
      throw new Error('Production media assembly databases are unavailable.');
    }
    const suffix = randomUUID();
    const workflowId = `production-media-assembly-${suffix}`;
    const workspaceId = `workspace-production-media-assembly-${suffix}`;
    const providerRequests: ProviderExecutionRequest[] = [];
    const supply = productionModelSupply(providerRequests);
    const models = supply.models;
    const frozenRoute = await models.freezeFixedRouteForExecution({
      catalogModelId: 'model-production-media',
      dataClass: ['contains_face'],
      operation: 'image.generate',
      workspaceId,
    });
    const request = productionMediaRequest(
      workflowId,
      workspaceId,
      frozenRoute,
    );
    const snapshot = requireExecutionSnapshot(request);
    assert.equal(snapshot.route.id.includes(workflowId), false);
    const runtimeId = harnessRuntimeId(workspaceId, workflowId);
    const pool = new Pool({ connectionString: databaseUrl });
    const harnessStore = new PostgresHarnessStore(pool);
    const contentPackages = new PostgresContentPackageRevisionWritePort(pool);
    const foundationRoutes = new PostgresFoundationRepository(pool);
    const completedModelResults: ModelSupplyResult[] = [];
    const noteAdmission = new PostgresNoteMediaAdmissionCoordinator(pool);
    const langfuseRequests: Array<{
      authorization: string | undefined;
      url: string | undefined;
      body: {
        batch: Array<{ type: string; body: Record<string, unknown> }>;
      };
    }> = [];
    const langfuseServer = createServer(async (incoming, response) => {
      const body = await readJson(incoming);
      langfuseRequests.push({
        authorization: incoming.headers.authorization,
        url: incoming.url,
        body,
      });
      sendJson(response, 200, { successes: body.batch });
    });
    const langfuseBaseUrl = await listen(t, langfuseServer);
    let dbosLaunched = false;

    try {
      await new PostgresOperationsRepository(pool).migrate();
      await foundationRoutes.migrate();
      await harnessStore.applySchema();
      await contentPackages.applySchema();
      await noteAdmission.migrate();
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Production media assembly')`,
        [workspaceId],
      );
      const composerRoute = await new ModelSupplyComposerRouteResolver(
        models,
        foundationRoutes,
      ).resolve({
        catalogModel: {
          id: snapshot.catalogModel.id,
          revision: snapshot.catalogModel.revision,
        },
        dataClass: ['contains_face'],
        operation: snapshot.operation,
        workspaceId,
      });
      assert.equal(composerRoute?.id, snapshot.route.id);
      await seedContentPackage(pool, request);

      const structuredControllerBindings: Array<
        Parameters<HarnessStructuredNodeRunnerFactory['create']>[0]
      > = [];
      const runners: HarnessStructuredNodeRunnerFactory = {
        create(input) {
          const binding = structuredClone(input);
          structuredControllerBindings.push(binding);
          return new BoundaryAwareControllerFixture(snapshot, binding);
        },
      };
      const skillManifest: HarnessSkillManifestSnapshot = {
        skillRevisionRef: 'skill.production-media-controller@1',
        contentHash: createHash('sha256')
          .update('Production media controller instruction v1')
          .digest('hex'),
        requiredModelCapabilities: [],
        resolvedInstruction: {
          skillRevisionRef: 'skill.production-media-controller@1',
          instruction: 'Production media controller instruction v1',
          contentHash: createHash('sha256')
            .update('Production media controller instruction v1')
            .digest('hex'),
          requiredModelCapabilities: [],
          executionMode: 'prompt_materialized',
        },
      };
      let selectedSkillManifest: HarnessSkillManifestSnapshot =
        structuredClone(skillManifest);
      let providerStartedResolve!: () => void;
      let releaseProviderResolve!: () => void;
      const providerStarted = new Promise<void>((resolve) => {
        providerStartedResolve = resolve;
      });
      const releaseProvider = new Promise<void>((resolve) => {
        releaseProviderResolve = resolve;
      });
      let holdProvider = true;
      const skillManifests: HarnessSkillManifestResolver = {
        async select({ stage }) {
          return stage === 'intent_naming'
            ? [
                {
                  skillRevisionRef:
                    selectedSkillManifest.skillRevisionRef,
                  contentHash: selectedSkillManifest.contentHash,
                  requiredModelCapabilities: [
                    ...selectedSkillManifest.requiredModelCapabilities,
                  ],
                },
              ]
            : [];
        },
        async materialize({ manifests }) {
          return manifests.map((manifest) => {
            assert.equal(
              manifest.skillRevisionRef,
              selectedSkillManifest.skillRevisionRef,
            );
            return structuredClone(selectedSkillManifest);
          });
        },
      };
      const skillInstructions = {
        async resolve(input: {
          skillRevisionRefs?: readonly string[];
          stage: string;
        }) {
          assert.equal(input.stage, 'intent_naming');
          assert.deepEqual(input.skillRevisionRefs, [
            skillManifest.skillRevisionRef,
          ]);
          return {
            instructions: [
              {
                ...structuredClone(skillManifest),
                instruction: 'Production media controller instruction v1',
                executionMode: 'prompt_materialized' as const,
              },
            ],
            receipts: [],
          };
        },
      };
      const executionChildObservability = {
        create(observedRequest: HarnessWorkflowInput) {
          const observedSnapshot =
            requireExecutionSnapshot(observedRequest);
          return new AgentPrimitiveObservabilityAdapter(
            new HarnessObservabilityEventAudit(harnessStore),
            {
              resolve() {
                return {
                  kind: 'product_usage' as const,
                  productUsageTaskId: observedSnapshot.task.id,
                  quoteId: observedSnapshot.quote.id,
                };
              },
            },
          );
        },
      };
      const copy = new ProductionHarnessStagePorts(
        runners,
        new LedgerBackedHarnessContextPort(
          new MemoryStoreFactLedger(),
          new MemoryContextBundleRepository(),
          () => now,
          undefined,
          undefined,
          undefined,
          {
            async resolve({ assetIds }) {
              return {
                knownAssetIds: [...assetIds],
                unauthorizedAssetIds: [],
              };
            },
          },
        ),
        {
          async deliverCopyRevision() {
            throw new Error('Copy delivery is outside the frozen media route.');
          },
        },
        () => now,
        undefined,
        undefined,
        undefined,
        skillInstructions,
        undefined,
        undefined,
        executionChildObservability,
      );
      const stages = createProductionHarnessMediaAssembly({
        contentPackages,
        copy,
        models: {
          async submit(input) {
            if (holdProvider) {
              holdProvider = false;
              providerStartedResolve();
              await releaseProvider;
            }
            const providerStartedAt = performance.now();
            const result = await models.submit(input);
            const observedResult = {
              ...result,
              latencyMs: Math.max(0, performance.now() - providerStartedAt),
            };
            completedModelResults.push(structuredClone(observedResult));
            return observedResult;
          },
        },
        noteAdmission,
        noteEnhancementJudge: unconfiguredNotePlanEnhancementJudgeResolver,
        noteSettings: {
          async read() {
            throw new Error('Note settings are outside the frozen image route.');
          },
        },
        now: () => now,
        runners,
        sensitiveLexicon: {
          async listEnabled() {
            return [];
          },
        },
        executionChildObservability,
      });
      const workflow = registerHarnessDbosWorkflow(stages, harnessStore, {
        billing: {
          async commit() {},
          promoteMerchantExecution: (input) =>
            supply.merchantExecutionBilling.promoteMerchantExecution(input),
          async refund() {},
          async scheduleCompensation() {},
        },
      });
      DBOS.setConfig({
        name: 'beauty-marketing-production-media-assembly',
        systemDatabaseUrl,
        applicationVersion: `production-media-assembly-${suffix}`,
      });
      await DBOS.launch();
      dbosLaunched = true;

      let promptHead = productionPromptBundle('262-test-v1', true);
      const admission = new HarnessTaskAdmissionService(
        harnessStore,
        new DbosHarnessWorkflowStarter(workflow),
        {
          async resolve() {
            return structuredClone(promptHead);
          },
        },
        harnessStore,
        {
          async resolve() {
            return {
              maxIterations: 4,
              maxCostCents: 200,
              maxWallClockMs: 60_000,
              maxDelegations: 'unset' as const,
              requiredLimits: [
                'maxIterations',
                'maxCostCents',
                'maxWallClockMs',
              ] as const,
            };
          },
        },
        new ProductionHarnessFrozenRouteSnapshotResolver(
          foundationRoutes,
          models,
        ),
        skillManifests,
        harnessStore,
      );

      assert.deepEqual(
        await admission.submit({ taskId: workflowId, ...request }),
        { workflowId, replayed: false },
      );
      const confirmation = await waitForExecutionConfirmation(
        harnessStore,
        workspaceId,
        workflowId,
      );
      assert.deepEqual(confirmation.executionConfirmationAuthority, {
        kind: 'external_action',
        revision: 'execution-external-action/v1',
      });
      await resumeHarnessDbosWorkflow(workspaceId, workflowId, {
        decision: { state: 'accepted', value: 'approved' },
        idempotencyKey: `approve-paid-generation:${workflowId}`,
        patch: {
          field: confirmation.response.field,
          reason: confirmation.response.reason,
          value: 'approved',
        },
        questionId: confirmation.questionId,
        workflowRevision: confirmation.workflowRevision,
      });
      await providerStarted;
      promptHead = productionPromptBundle('262-test-v2');
      selectedSkillManifest = {
        skillRevisionRef: 'skill.production-media-controller@2',
        contentHash: createHash('sha256')
          .update('Production media controller instruction v2')
          .digest('hex'),
        requiredModelCapabilities: ['structured_output'],
        resolvedInstruction: {
          skillRevisionRef: 'skill.production-media-controller@2',
          instruction: 'Production media controller instruction v2',
          contentHash: createHash('sha256')
            .update('Production media controller instruction v2')
            .digest('hex'),
          requiredModelCapabilities: ['structured_output'],
          executionMode: 'prompt_materialized',
        },
      };
      supply.publishNextCatalogHead(workspaceId);
      supply.publishNextCapabilityHead();
      supply.publishNextCredentialHead();
      const nextRoute = await models.freezeFixedRouteForExecution({
        catalogModelId: 'model-production-media',
        dataClass: ['contains_face'],
        operation: 'image.generate',
        workspaceId,
      });
      assert.equal(nextRoute.catalogRevisionId, 'model-r2');
      assert.equal(
        nextRoute.capabilityRevisionId,
        'capability-production-media-r2',
      );
      assert.equal(nextRoute.credentialVersion, 'credential-r2');
      assert.equal(
        nextRoute.allowedCandidates?.[0]?.providerModel,
        'provider-model-production-media-v2',
      );
      assert.equal(
        nextRoute.allowedCandidates?.[0]?.deploymentLifecycleRevision,
        'deployment-r2',
      );
      assert.equal(
        nextRoute.allowedCandidates?.[0]?.modelVersion,
        'endpoint-r2',
      );
      releaseProviderResolve();
      const firstResult = await DBOS.retrieveWorkflow<{
        delivery: {
          packageId: string;
          revision: number;
          versionId: string;
        },
      }>(runtimeId).getResult();
      assert.equal(firstResult.delivery.packageId, request.packageId);
      assert.equal(firstResult.delivery.revision, 1);
      assert.ok(firstResult.delivery.versionId);
      assert.equal(
        await DBOS.retrieveWorkflow(runtimeId)
          .getStatus()
          .then((status) => status?.status),
        'SUCCESS',
      );

      const frozen = await pool.query<{ request: HarnessWorkflowInput }>(
        `SELECT request
           FROM harness_runtime.task_requests
          WHERE runtime_id=$1`,
        [runtimeId],
      );
      const durableRequest = frozen.rows[0]?.request;
      const executionAssembly = durableRequest?.executionAssembly;
      assert.ok(executionAssembly);
      assert.equal(executionAssembly.workflowId, workflowId);
      assert.match(
        executionAssembly.frozenRouteSnapshotDigest,
        /^[a-f0-9]{64}$/u,
      );
      assert.deepEqual(
        executionAssembly.skillStages.intent_naming,
        [skillManifest],
      );
      assert.equal(
        executionAssembly.promptRevisionRefs.intentNaming?.version,
        '262-test-v1',
      );
      assert.equal(
        executionAssembly.promptRevisionRefs.intentNaming?.isFallback,
        true,
      );
      assert.equal(
        executionAssembly.promptRevisionRefs.intentNaming?.fallbackReason,
        'langfuse_http_503',
      );
      assert.equal(
        Object.keys(executionAssembly.promptRevisionRefs).length,
        Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length,
      );
      assert.deepEqual(executionAssembly.rootAxes, {
        axisScope: 'task_root',
        skillRevision: {
          kind: 'bound',
          value: skillManifest.skillRevisionRef,
        },
        promptVersion: { kind: 'absent' },
        catalogRevision: {
          kind: 'bound',
          value: snapshot.catalogModel.revision,
        },
        scene: { kind: 'bound', value: '制作夏日护理项目图片' },
      });
      assert.deepEqual(frozen.rows[0]?.request.boundedExecution, {
        schemaVersion: 'bounded-execution-snapshot/v1',
        maxIterations: 4,
        maxCostCents: 200,
        maxWallClockMs: 60_000,
        maxDelegations: 'unset',
        requiredLimits: [
          'maxIterations',
          'maxCostCents',
          'maxWallClockMs',
        ],
        consumption: {
          iterations: 0,
          costCents: 0,
          wallClockMs: 0,
          delegations: 0,
        },
        stopReason: null,
        triggeredLimit: null,
      });
      const durableRoute = frozen.rows[0]?.request.frozenRouteSnapshot;
      assert.ok(durableRoute);
      assert.equal(durableRoute.id, snapshot.route.id);
      assert.equal(
        durableRoute.catalogRevisionId,
        snapshot.route.revision,
      );
      assert.equal(
        durableRoute.capabilityRevisionId,
        'capability-production-media-r1',
      );
      assert.equal(durableRoute.deploymentId, frozenRoute.deploymentId);
      const assemblyAudits = await pool.query<{
        audit_id: string;
        outbox_status: string;
        payload: {
          eventType: string;
          taskId: string;
          workspaceId: string;
          actorId: string;
          actorKind: string;
          idempotencyKey: string;
          axisScope: string;
          skillRevision: string | null;
          promptVersion: string | null;
          catalogRevision: string | null;
          scene: string | null;
          payload: { primitiveId: string; phase: string };
        };
      }>(
        `SELECT audit.id AS audit_id,
                audit.payload,
                outbox.status AS outbox_status
           FROM harness_runtime.audit_events audit
           JOIN harness_runtime.langfuse_outbox outbox
             ON outbox.audit_id=audit.id
          WHERE audit.workflow_id=$1
            AND audit.event_type='agent_primitive.lifecycle'
            AND audit.payload->'payload'->>'primitiveId'
                  LIKE 'harness-assembly:%'
          ORDER BY audit.created_at, audit.id`,
        [runtimeId],
      );
      assert.deepEqual(
        assemblyAudits.rows.map(({ payload, outbox_status }) => ({
          primitiveId: payload.payload.primitiveId,
          phase: payload.payload.phase,
          outboxStatus: outbox_status,
        })),
        [
          'manifest_resolution',
          'hot_assembly',
          'prompt_resolution',
          'task_pin',
          'execution_check',
          'event_persistence',
        ].map((step) => ({
          primitiveId: `harness-assembly:${step}`,
          phase: 'succeeded',
          outboxStatus: 'queued',
        })),
      );
      const assemblyAuditIds = assemblyAudits.rows.map(
        ({ audit_id }) => audit_id,
      );
      const claimedAssemblyAudits =
        await pool.query<HarnessLangfuseOutboxItem>(
          `WITH claimed AS (
             UPDATE harness_runtime.langfuse_outbox
                SET status='sending',
                    attempts=attempts+1,
                    updated_at=now()
              WHERE audit_id=ANY($1::text[])
                AND status='queued'
             RETURNING audit_id, attempts
           )
           SELECT claimed.audit_id AS "auditId",
                  audit.workflow_id AS "workflowId",
                  audit.stage,
                  audit.event_type AS "eventType",
                  audit.created_at AS "occurredAt",
                  audit.payload,
                  claimed.attempts
             FROM claimed
             JOIN harness_runtime.audit_events audit
               ON audit.id=claimed.audit_id
            ORDER BY claimed.audit_id`,
          [assemblyAuditIds],
        );
      assert.equal(
        claimedAssemblyAudits.rowCount,
        assemblyAuditIds.length,
      );
      const langfuseSender = new LangfuseHttpSender({
        baseUrl: langfuseBaseUrl,
        publicKey: 'pk-issue-262-fixture',
        secretKey: 'sk-issue-262-fixture',
      });
      for (const item of claimedAssemblyAudits.rows) {
        await langfuseSender.send({
          ...item,
          occurredAt: new Date(item.occurredAt).toISOString(),
        });
        await harnessStore.markLangfuseSent(item.auditId);
      }
      const delivery = {
        sent: claimedAssemblyAudits.rowCount,
        failed: 0,
        deadLettered: 0,
      };
      assert.deepEqual(delivery, {
        sent: assemblyAuditIds.length,
        failed: 0,
        deadLettered: 0,
      });
      const deliveredAssemblyAudits = await pool.query<{
        audit_id: string;
        status: string;
      }>(
        `SELECT audit_id, status
           FROM harness_runtime.langfuse_outbox
          WHERE audit_id=ANY($1::text[])
          ORDER BY audit_id`,
        [assemblyAuditIds],
      );
      assert.equal(deliveredAssemblyAudits.rowCount, assemblyAuditIds.length);
      assert.ok(
        deliveredAssemblyAudits.rows.every(
          ({ status }) => status === 'sent',
        ),
      );
      assert.equal(langfuseRequests.length, assemblyAuditIds.length);
      assert.ok(
        langfuseRequests.every(
          ({ url }) => url === '/api/public/ingestion',
        ),
      );
      assert.ok(
        langfuseRequests.every(
          ({ authorization }) =>
            authorization ===
            `Basic ${Buffer.from(
              'pk-issue-262-fixture:sk-issue-262-fixture',
            ).toString('base64')}`,
        ),
      );
      const langfuseSpans = langfuseRequests.map(({ body }) => {
        const span = body.batch.find(
          ({ type }) => type === 'span-create',
        )?.body;
        assert.ok(span);
        return span;
      });
      assert.equal(langfuseSpans.length, assemblyAuditIds.length);
      assert.deepEqual(
        langfuseSpans
          .map(({ metadata }) => {
            assert.ok(metadata && typeof metadata === 'object');
            return (metadata as Record<string, unknown>).primitiveId;
          })
          .sort(),
        [
          'manifest_resolution',
          'hot_assembly',
          'prompt_resolution',
          'task_pin',
          'execution_check',
          'event_persistence',
        ]
          .map((step) => `harness-assembly:${step}`)
          .sort(),
      );
      const expectedTraceId = langfuseTraceId(runtimeId);
      assert.ok(
        langfuseSpans.every(
          ({ traceId }) =>
            typeof traceId === 'string' && traceId === expectedTraceId,
        ),
      );
      const langfuseTraces = langfuseRequests.flatMap(({ body }) =>
        body.batch
          .filter(({ type }) => type === 'trace-create')
          .map(({ body: trace }) => trace),
      );
      assert.deepEqual(
        langfuseTraces.map(({ id }) => id),
        [expectedTraceId],
      );
      const fallbackAudits = await pool.query<{
        outbox_status: string;
      }>(
        `SELECT outbox.status AS outbox_status
           FROM harness_runtime.audit_events audit
           JOIN harness_runtime.langfuse_outbox outbox
             ON outbox.audit_id=audit.id
          WHERE audit.workflow_id=$1
            AND audit.event_type='langfuse_prompt_fallback'`,
        [runtimeId],
      );
      assert.equal(
        fallbackAudits.rowCount,
        Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length,
      );
      assert.ok(
        fallbackAudits.rows.every(
          ({ outbox_status }) => outbox_status === 'queued',
        ),
      );
      const rootAudit = assemblyAudits.rows.find(
        ({ payload }) =>
          payload.payload.primitiveId ===
          'harness-assembly:task_pin',
      )?.payload;
      assert.ok(rootAudit);
      assert.match(rootAudit.actorId, /^ref:[a-f0-9]{64}$/u);
      assert.match(rootAudit.idempotencyKey, /^harness-assembly-/u);
      assert.deepEqual(
        {
          eventType: rootAudit.eventType,
          taskId: rootAudit.taskId,
          workspaceId: rootAudit.workspaceId,
          actorKind: rootAudit.actorKind,
          axisScope: rootAudit.axisScope,
          skillRevision: rootAudit.skillRevision,
          promptVersion: rootAudit.promptVersion,
          catalogRevision: rootAudit.catalogRevision,
          scene: rootAudit.scene,
          payload: rootAudit.payload,
        },
        {
          eventType: 'agent_primitive.lifecycle',
          taskId: workflowId,
          workspaceId,
          actorKind: 'worker',
          axisScope: 'task_root',
          skillRevision: skillManifest.skillRevisionRef,
          promptVersion: null,
          catalogRevision: snapshot.catalogModel.revision,
          scene: '制作夏日护理项目图片',
          payload: {
            primitiveId: 'harness-assembly:task_pin',
            phase: 'succeeded',
            billing: { kind: 'not_billed' },
          },
        },
      );
      const eventPersistenceAudit = assemblyAudits.rows.find(
        ({ payload }) =>
          payload.payload.primitiveId ===
          'harness-assembly:event_persistence',
      )?.payload;
      assert.equal(eventPersistenceAudit?.axisScope, 'execution_child');
      const childAudits = await pool.query<{
        payload: {
          taskId: string;
          axisScope: string;
          skillRevision: string | null;
          promptVersion: string | null;
          catalogRevision: string | null;
          scene: string | null;
          payload: { primitiveId: string; phase: string };
        };
      }>(
        `SELECT payload
           FROM harness_runtime.audit_events
          WHERE workflow_id=$1
            AND event_type='agent_primitive.lifecycle'
            AND payload->'payload'->>'primitiveId'
                  NOT LIKE 'harness-assembly:%'
          ORDER BY payload->'payload'->>'phase'`,
        [runtimeId],
      );
      assert.deepEqual(
        childAudits.rows
          .map(({ payload }) => ({
            taskId: payload.taskId,
            axisScope: payload.axisScope,
            skillRevision: payload.skillRevision,
            promptVersion: payload.promptVersion,
            catalogRevision: payload.catalogRevision,
            scene: payload.scene,
            primitiveId: payload.payload.primitiveId,
            phase: payload.payload.phase,
          }))
          .sort((left, right) =>
            `${left.primitiveId}:${left.phase}`.localeCompare(
              `${right.primitiveId}:${right.phase}`,
            ),
          ),
        [
          ...(['invoked', 'succeeded'] as const).map((phase) => ({
            taskId: workflowId,
            axisScope: 'execution_child',
            skillRevision: null,
            promptVersion: null,
            catalogRevision: snapshot.catalogModel.revision,
            scene: '制作夏日护理项目图片',
            primitiveId: 'harness-media:image',
            phase,
          })),
          ...(['invoked', 'succeeded'] as const).map((phase) => ({
            taskId: workflowId,
            axisScope: 'execution_child',
            skillRevision: null,
            promptVersion: 'harness/brief-image@262-test-v1',
            catalogRevision: snapshot.catalogModel.revision,
            scene: '制作夏日护理项目图片',
            primitiveId: 'harness_image_brief_v1',
            phase,
          })),
          {
            taskId: workflowId,
            axisScope: 'execution_child',
            skillRevision: skillManifest.skillRevisionRef,
            promptVersion: 'harness/intent-naming@262-test-v1',
            catalogRevision: snapshot.catalogModel.revision,
            scene: '制作夏日护理项目图片',
            primitiveId: 'harness_intent_naming_v1',
            phase: 'invoked',
          },
          {
            taskId: workflowId,
            axisScope: 'execution_child',
            skillRevision: skillManifest.skillRevisionRef,
            promptVersion: 'harness/intent-naming@262-test-v1',
            catalogRevision: snapshot.catalogModel.revision,
            scene: '制作夏日护理项目图片',
            primitiveId: 'harness_intent_naming_v1',
            phase: 'succeeded',
          },
        ].sort((left, right) =>
          `${left.primitiveId}:${left.phase}`.localeCompare(
            `${right.primitiveId}:${right.phase}`,
          ),
        ),
      );
      assert.equal(structuredControllerBindings.length, 2);
      assert.deepEqual(
        structuredControllerBindings.map(
          ({ frozenRouteSnapshot }) => frozenRouteSnapshot,
        ),
        [undefined, undefined],
      );
      assert.equal(providerRequests.length, 1);
      const providerRequest = providerRequests[0];
      assert.ok(providerRequest);
      const submission = providerRequest.submission;
      assert.ok(submission);
      assert.equal(submission.billingTaskId, snapshot.task.id);
      assert.equal(submission.billingQuoteRevision, snapshot.quote.revision);
      assert.equal(submission.productUsageQuantity, 0);
      assert.deepEqual(supply.promotedEffects, [
        {
          quoteRevision: snapshot.quote.revision,
          sourceEffectKey: submission.idempotencyKey,
          taskId: snapshot.task.id,
          workspaceId,
        },
      ]);
      assert.deepEqual(submission.selection, {
        mode: 'fixed',
        catalogModelId: snapshot.catalogModel.id,
      });
      assert.equal(submission.correlationId, workflowId);
      assert.equal(
        submission.idempotencyKey,
        `merchant-execution:${workflowId}:harness-media:${workflowId}:image`,
      );
      assert.equal(submission.operation, 'image.generate');
      assert.equal(submission.workspaceId, workspaceId);
      assert.deepEqual(submission.dataClass, ['contains_face']);
      assert.equal(providerRequest.model.id, snapshot.catalogModel.id);
      assert.equal(providerRequest.model.version, 'endpoint-r1');
      assert.equal(
        providerRequest.deployment.id,
        frozenRoute.deploymentId,
      );
      assert.equal(
        providerRequest.deployment.providerModel,
        'provider-model-production-media',
      );
      assert.equal(
        providerRequest.deployment.lifecycleRevision,
        'deployment-r1',
      );
      assert.equal(
        providerRequest.deployment.endpointRevision,
        'endpoint-r1',
      );
      assert.equal(
        providerRequest.runtimeBinding?.credential?.version,
        'credential-r1',
      );
      assert.equal(
        providerRequest.routeSnapshot?.credentialVersion,
        'credential-r1',
      );
      assert.deepEqual(supply.credentialAssemblyRequests, [
        {
          credentialAccountId: 'credential-account-production-media',
          frozenVersion: 'credential-r1',
          requiredScope: 'platform',
        },
      ]);
      assert.equal(providerRequest.routeSnapshot?.id, snapshot.route.id);
      assert.equal(
        providerRequest.routeSnapshot?.catalogRevisionId,
        snapshot.catalogModel.revision,
      );
      assert.equal(
        providerRequest.routeSnapshot?.catalogRevisionId,
        snapshot.route.revision,
      );
      assert.equal(
        providerRequest.routeSnapshot?.actualCatalogModelId,
        snapshot.catalogModel.id,
      );
      assert.deepEqual(
        providerRequest.routeSnapshot?.requestedSelection,
        submission.selection,
      );
      assert.equal(
        providerRequest.routeSnapshot?.allowedCandidates?.[0]?.deploymentId,
        providerRequest.deployment.id,
      );
      assert.deepEqual(providerRequest.routeSnapshot, durableRoute);

      const completed = completedModelResults[0];
      assert.ok(completed);
      assert.equal(completed.snapshot.id, snapshot.route.id);
      assert.equal(
        completed.snapshot.catalogRevisionId,
        snapshot.catalogModel.revision,
      );
      assert.deepEqual(completed.snapshot.requestedSelection, submission.selection);
      await assertPersistedJoin(pool, request, runtimeId, completed);
      const effectsBeforeReplay = await DBOS.listWorkflowSteps(runtimeId);
      assert.ok(effectsBeforeReplay);

      const pinnedAssembly = structuredClone(executionAssembly);
      assert.deepEqual(
        await admission.submit({ taskId: workflowId, ...request }),
        { workflowId, replayed: true },
      );
      await DBOS.retrieveWorkflow(runtimeId).getResult();
      assert.equal(providerRequests.length, 1);
      assert.equal(completedModelResults.length, 1);
      const effectsAfterReplay = await DBOS.listWorkflowSteps(runtimeId);
      assert.ok(effectsAfterReplay);
      assert.equal(effectsAfterReplay.length, effectsBeforeReplay.length);
      assert.deepEqual(
        effectsAfterReplay.map(({ name }) => name),
        effectsBeforeReplay.map(({ name }) => name),
      );
      const replayedRequest = await pool.query<{
        request: HarnessWorkflowInput;
      }>(
        `SELECT request
           FROM harness_runtime.task_requests
          WHERE runtime_id=$1`,
        [runtimeId],
      );
      assert.deepEqual(
        replayedRequest.rows[0]?.request.executionAssembly,
        pinnedAssembly,
      );
      assert.equal(
        replayedRequest.rows[0]?.request.frozenRouteSnapshot
          ?.capabilityRevisionId,
        'capability-production-media-r1',
      );
      assert.equal(
        replayedRequest.rows[0]?.request.executionAssembly
          ?.promptRevisionRefs.intentNaming?.version,
        '262-test-v1',
      );
      assert.deepEqual(
        replayedRequest.rows[0]?.request.executionAssembly
          ?.skillStages.intent_naming,
        [skillManifest],
      );
      await assertPersistedJoin(pool, request, runtimeId, completed);
    } finally {
      try {
        if (dbosLaunched) {
          await DBOS.shutdown({ deregister: true });
        }
      } finally {
        try {
          await cleanup(pool, request, runtimeId);
        } finally {
          await pool.end();
        }
      }
    }
  },
);

test(
  'production credit media preserves its selected auxiliary claim across bounded resume',
  {
    skip:
      databaseUrl && systemDatabaseUrl
        ? false
        : 'TEST_DATABASE_URL and TEST_DBOS_SYSTEM_DATABASE_URL are required',
  },
  async () => {
    if (!databaseUrl || !systemDatabaseUrl) {
      throw new Error('Production media assembly databases are unavailable.');
    }
    const suffix = randomUUID();
    const suffixSafe = suffix.replaceAll('-', '').slice(0, 12);
    const workflowId = `production-credit-media-${suffix}`;
    const workspaceId = `workspace-production-credit-media-${suffix}`;
    const runtimeId = harnessRuntimeId(workspaceId, workflowId);
    const tracerTable = `issue298_tracer_${suffixSafe}`;
    const bossSchema = `issue298_boss_${suffixSafe}`;
    const primaryDeploymentId = 'gpt-image-2-managed';
    const fallbackDeploymentId = 'gpt-image-2-tuzi-relay';
    const pool = new Pool({ connectionString: databaseUrl, max: 12 });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const billing = new DurableProductBillingService(
      billingRepository,
      () => new Date(now),
    );
    const credits = new PostgresCreditLedger(pool);
    const harnessStore = new PostgresHarnessStore(pool);
    const contentPackages = new PostgresContentPackageRevisionWritePort(pool);
    const foundationRoutes = new PostgresFoundationRepository(pool);
    const noteAdmission = new PostgresNoteMediaAdmissionCoordinator(pool);
    const billingCompensations =
      new PostgresHarnessBillingCompensationStore(pool);
    const providerEffects: string[] = [];
    const mediaProviderEffects: string[] = [];
    const providerCalls = { primary: 0, fallback: 0, poll: 0, download: 0 };
    let request: HarnessWorkflowInput | undefined;
    let jobRuntime: PgBossJobPort | undefined;
    let mediaWorker: { stop(): Promise<void> } | undefined;
    let dbosLaunched = false;

    try {
      await operations.migrate();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id text PRIMARY KEY,
          name text NOT NULL
        )
      `);
      await billingRepository.migrate();
      const creditClient = await pool.connect();
      try {
        await credits.migrate(creditClient);
      } finally {
        creditClient.release();
      }
      await foundationRoutes.migrate();
      await harnessStore.applySchema();
      await billingCompensations.migrate();
      await contentPackages.applySchema();
      await noteAdmission.migrate();
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Production credit media assembly')`,
        [workspaceId],
      );
      jobRuntime = PgBossJobPort.connect({
        connection: { connectionString: databaseUrl, schema: bossSchema },
        queuePrefix: `issue298-${suffixSafe}`,
        retryDelaySeconds: 1,
        heartbeatSeconds: 10,
        terminalNotifier: async ({ envelope, status, output }) => {
          await sendHarnessMediaJobTerminal({
            workspaceId: envelope.workspaceId,
            jobId: envelope.jobId,
            kind: envelope.kind,
            payload: envelope.payload,
            status,
            ...(output ? { output } : {}),
          });
        },
      });
      const tracerRepository = new PostgresTracerJobRepository(
        pool,
        jobRuntime,
        { table: tracerTable },
      );
      await tracerRepository.migrate();
      const tracerJobs = new TracerJobApplicationService(tracerRepository);

      const assertClaimedBeforeProvider = async (
        providerRequest: Pick<ProviderExecutionRequest, 'submission'>,
      ) => {
        const effectKey = providerRequest.submission.idempotencyKey;
        const contract = await billing.readMerchantExecutionContract({
          taskId: workflowId,
          workspaceId,
        });
        assert.ok(contract.submissionPromptHash);
        assert.match(contract.submissionPromptHash, /^[a-f0-9]{64}$/u);
        assert.ok(contract.submissionReferenceAssetsHash);
        assert.match(
          contract.submissionReferenceAssetsHash,
          /^[a-f0-9]{64}$/u,
        );
        assert.ok(contract.submissionInputAssetsHash);
        assert.match(contract.submissionInputAssetsHash, /^[a-f0-9]{64}$/u);
        const execution = await billingRepository.getMerchantExecution(
          workspaceId,
          workflowId,
          effectKey,
        );
        assert.equal(execution?.status, 'claimed');
        assert.ok(execution);
        const exactHashes = merchantExecutionInputHashes(
          execution.inputSnapshot,
        );
        assert.match(exactHashes.inputAssetsHash, /^[a-f0-9]{64}$/u);
        assert.match(exactHashes.promptHash, /^[a-f0-9]{64}$/u);
        assert.match(exactHashes.referenceAssetsHash, /^[a-f0-9]{64}$/u);
        providerEffects.push(effectKey);
        return execution;
      };
      const structuredExecutor: StructuredObjectExecutor = {
        supportsCatalogModel(catalogModelId) {
          return catalogModelId === 'deepseek-v4-pro';
        },
        async generate<Output>(input: {
          instructions: string;
          prompt: string;
          providerRequest?: ProviderExecutionRequest;
          schema: ZodType<Output>;
          schemaName: string;
        }) {
          assert.ok(input.providerRequest);
          const execution = await assertClaimedBeforeProvider(
            input.providerRequest,
          );
          const structuredInput = JSON.parse(execution.inputSnapshot.prompt) as {
            instructions: string;
            prompt: string;
          };
          assert.equal(structuredInput.instructions, input.instructions);
          assert.equal(structuredInput.prompt, input.prompt);
          const output =
            input.schemaName === 'harness_intent_naming_v1'
              ? {
                  blockingGap: null,
                  deliveryLayer: 'finished_media',
                  implicitConstraints: ['只使用已授权素材'],
                  normalizedIntent: '制作夏日护理项目图片',
                  relevantAssetCategories: ['material'],
                  route: 'customized',
                  taskType: 'daily_service_exposure',
                  usedAssetCategories: ['material'],
                }
              : input.schemaName === 'harness_image_brief_v1'
                ? {
                    constraints: ['不得编造价格或护理效果'],
                    intent: {
                      changes: [],
                      composition: '竖版主视觉，主体清晰',
                      exactText: [],
                      factRefs: [],
                      invariants: [],
                      operation: 'image.generate',
                      outputPlan: { kind: 'single' },
                      purpose: '夏日护理活动海报',
                      references: [],
                      rightsRefs: [],
                      scene: '真实门店护理区',
                      subject: '夏日护理项目',
                    },
                    kind: 'image',
                    parameters: { ratio: '9:16', resolution: '1080p' },
                    prompt:
                      '为夏日护理项目生成一张竖版活动海报，保留真实门店护理氛围。',
                    referenceAssetIds: [],
                  }
                : undefined;
          if (!output) {
            throw new Error(`Unexpected production schema ${input.schemaName}.`);
          }
          return {
            output: input.schema.parse(output),
            providerTaskRef: `structured-${input.schemaName}-${suffix}`,
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        },
        providerCost(usage) {
          return { amount: 0.01, currency: 'CNY', usage };
        },
      };
      const catalogModels = createDefaultCatalogModels();
      const deployments = createDefaultDeployments({
        activatedDeploymentIds: [
          'deepseek-v4-pro-direct',
          primaryDeploymentId,
          fallbackDeploymentId,
        ],
        activationEvidenceStatus: 'recorded',
        deploymentPricingById: {
          [primaryDeploymentId]: {
            priceRevision: 'issue298-primary-cny-v1',
            unitPrice: {
              amountMicros: 10_000,
              currency: 'CNY',
              unit: 'image',
            },
          },
          [fallbackDeploymentId]: {
            priceRevision: 'issue298-fallback-cny-v1',
            unitPrice: {
              amountMicros: 10_000,
              currency: 'CNY',
              unit: 'image',
            },
          },
        },
      }).map((deployment) => ({
        ...deployment,
        ...(deployment.id === primaryDeploymentId
          ? {
              accountIdentity: 'issue298-primary-account',
              endpointFingerprint: 'issue298-primary-endpoint',
            }
          : deployment.id === fallbackDeploymentId
            ? {
                accountIdentity: 'issue298-fallback-account',
                endpointFingerprint: 'issue298-fallback-endpoint',
              }
            : {}),
        capabilityProfile: {
          vocabularyVersion: 'model-capability-v1' as const,
          protocolCapabilities: {},
          modalities: [
            {
              mime:
                deployment.catalogModelId === 'gpt-image-2'
                  ? 'image/*'
                  : 'text/*',
              supported: true,
              basis: 'inferred' as const,
              evidenceRef: `fixture://${deployment.id}/capability`,
            },
          ],
          businessTags: [],
          modalityCapabilities: [],
        },
      }));
      const capabilityHotAssembly = new CapabilityHotAssemblyRegistry();
      const capabilityEntries: RuntimeCapabilityEntry[] = deployments.map(
        (deployment) => ({
          deploymentId: deployment.id,
          catalogModelId: deployment.catalogModelId,
          apiFamily: deployment.apiFamily,
          channel: deployment.channel,
          region: deployment.region,
          executionChannelId: deployment.executionChannelId,
          ...(deployment.providerModel
            ? { providerModel: deployment.providerModel }
            : {}),
          ...(deployment.endpointRevision
            ? { endpointRevision: deployment.endpointRevision }
            : {}),
          ...(deployment.lifecycleRevision
            ? { lifecycleRevision: deployment.lifecycleRevision }
            : {}),
          ...(deployment.credentialVersion
            ? { credentialVersion: deployment.credentialVersion }
            : {}),
          adapterKey: 'recorded',
          capabilityProfile: structuredClone(deployment.capabilityProfile),
        }),
      );
      capabilityHotAssembly.applyCapabilityRevision({
        revisionId: `production-credit-media-capability-${suffix}`,
        number: 1,
        publishedAt: now,
        entries: capabilityEntries,
      });
      const supplyLedger = new FoundationModelSupplyLedger(
        new P1ApplicationService(foundationRoutes, {
          clock: () => new Date(now),
        }),
        undefined,
        undefined,
        {
          billingLifecycle: billing,
          clock: () => new Date(now),
          productUsage: billing,
        },
      );
      const models = new ModelSupplyApplicationService({
        assetStorage: new MemoryModelAssetStorage(),
        models: catalogModels,
        deployments,
        capabilityHotAssembly,
        inferFixtureMediaCapabilityProfiles: true,
        ledger: supplyLedger,
        execution: {
          async execute() {
            throw new Error(
              'Production media must execute through the durable provider lifecycle.',
            );
          },
        },
        merchantExecutionBilling: billing,
        planningControlPlane: {
          async readPlanningState(input) {
            if (input.operation !== 'image.generate') return {};
            return {
              routePolicyRevisionId: 'issue298-route-policy-v1',
              routePolicy: {
                operation: 'image.generate',
                qualityTier: 'quality',
                hardConstraints: ['deployment_active', 'data_class'],
                candidateDeploymentIds: [
                  primaryDeploymentId,
                  fallbackDeploymentId,
                ],
                maxAttempts: 2,
                fallbackAuthorized: true,
              },
            };
          },
        },
      });
      const mediaProvider: MediaProviderLifecyclePort = {
        async submit(providerRequest: MediaProviderEffectRequest) {
          const execution = await assertClaimedBeforeProvider(providerRequest);
          assert.equal(
            execution.inputSnapshot.prompt,
            providerRequest.submission.prompt ?? '',
          );
          assert.deepEqual(
            execution.inputSnapshot.input,
            providerRequest.submission.input ?? null,
          );
          mediaProviderEffects.push(
            providerRequest.submission.idempotencyKey,
          );
          if (providerRequest.deployment.id === primaryDeploymentId) {
            providerCalls.primary += 1;
            return {
              acceptance: 'rejected_before_accept',
              errorCode: 'issue298_primary_rejected',
              retryable: true,
              error: 'Primary rejected before accepting the request.',
              providerCost: { amount: 0, currency: 'CNY', usage: {} },
            };
          }
          assert.equal(providerRequest.deployment.id, fallbackDeploymentId);
          providerCalls.fallback += 1;
          return {
            acceptance: 'accepted',
            taskRef: `issue298-fallback-task-${suffixSafe}`,
            providerCost: {
              amount: 0.01,
              currency: 'CNY',
              usage: { mediaUnits: 1 },
            },
          };
        },
        async recover() {
          throw new Error('A rejected primary must recover from PostgreSQL.');
        },
        async poll(providerRequest) {
          await assertClaimedBeforeProvider(providerRequest);
          assert.equal(providerRequest.deployment.id, fallbackDeploymentId);
          mediaProviderEffects.push(
            providerRequest.submission.idempotencyKey,
          );
          providerCalls.poll += 1;
          return {
            status: 'completed',
            providerCost: {
              amount: 0.01,
              currency: 'CNY',
              usage: { mediaUnits: 1 },
            },
          };
        },
        async download(providerRequest) {
          await assertClaimedBeforeProvider(providerRequest);
          assert.equal(providerRequest.deployment.id, fallbackDeploymentId);
          mediaProviderEffects.push(
            providerRequest.submission.idempotencyKey,
          );
          providerCalls.download += 1;
          return {
            bytes: Buffer.from(`production-credit-media:${suffix}`),
            contentType: 'image/png',
          };
        },
        async cancel() {},
      };
      const mediaRuntime = new DurableMediaGenerationApplicationService({
        jobs: tracerJobs,
        models,
        provider: mediaProvider,
      });
      models.attachDurableMediaRuntime(mediaRuntime);
      const tracer = new DurableTracerWorker(
        tracerRepository,
        new ModelMediaGenerationEffect({
          models,
          provider: mediaProvider,
        }),
      );
      const frozenRoute = await models.freezeFixedRouteForExecution({
        catalogModelId: 'gpt-image-2',
        dataClass: [],
        fallbackConsent: true,
        operation: 'image.generate',
        workspaceId,
      });
      assert.deepEqual(
        frozenRoute.allowedCandidates?.map(({ deploymentId }) => deploymentId),
        [primaryDeploymentId, fallbackDeploymentId],
      );
      const quote = await billing.buildQuote({
        billingMode: 'per_request',
        catalogModelId: 'gpt-image-2',
        catalogModelRevision: frozenRoute.catalogRevisionId,
        creditCost: 5,
        failureRefundsCredits: true,
        operation: 'image.generate',
        outputCount: 1,
        quoteId: `quote-${workflowId}`,
        quotePolicyRevision: 'production-credit-media-policy-r1',
        submissionContractHash: `production-credit-media-${suffix}`,
        unitRate: 5,
        workspaceId,
      });
      const confirmed = await billing.confirm({
        quoteId: quote.quoteId,
        taskId: workflowId,
        workspaceId,
      });
      request = productionCreditMediaRequest({
        quoteRevision: confirmed.revision,
        route: frozenRoute,
        workflowId,
        workspaceId,
      });
      const snapshot = requireExecutionSnapshot(request);
      const composerRoute = {
        ...toFoundationRouteCheckpoint(
          fromModelSupplyRouteSnapshot(frozenRoute),
          {
            catalogRevision: snapshot.catalogModel.revision,
            dataClass: 'public',
            dataClasses: ['public'],
            fallbackConsent: true,
            requestedCatalogModelId: snapshot.catalogModel.id,
            selectionMode: 'fixed',
          },
        ),
        createdAt: frozenRoute.createdAt,
        workspaceId,
      };
      await foundationRoutes.insertRouteSnapshot(composerRoute);
      assert.equal(composerRoute.id, snapshot.route.id);
      const grounding: CreativeGroundingSnapshot = {
        assets: [],
        capturedAt: now,
        store: {
          address: '88 号',
          booking: '提前预约',
          brandVoice: '真诚、不夸张',
          city: '成都',
          confirmedAt: now,
          district: '锦江区',
          name: '春日护理',
          prohibitions: ['不虚构折扣'],
          projects: [
            {
              durationMinutes: 60,
              id: 'project-1',
              name: '夏日护理',
              price: 168,
            },
          ],
          regulated: false,
        },
      };
      const store = new PostgresCreationSubmissionStore(
        pool,
        new PostgresCreationSubmissionPersistence(
          new PostgresProductBillingUsageReservation(
            pool,
            undefined,
            credits,
            new ModelSupplyCreationInputResolver({
              async resolve(resolvedWorkspaceId, assetIds) {
                assert.equal(resolvedWorkspaceId, workspaceId);
                assert.deepEqual(assetIds, []);
                return {
                  snapshot: structuredClone(grounding),
                  status: 'ready' as const,
                };
              },
            }),
          ),
        ),
      );
      await store.applySchema();
      await credits.grant({
        createdAt: now,
        credits: 10,
        expirationDate: null,
        grantIdempotencyKey: `grant:package:${suffix}`,
        id: `credit-lot-${suffix}`,
        sourceRef: `payment-${suffix}`,
        transactionType: 'PURCHASE_PACKAGE',
        workspaceId,
      });
      const submission: CreationSubmissionRecord = {
        contentPackage: {
          expectedRevision: snapshot.contentPackage.expectedRevision,
          id: snapshot.contentPackage.id,
        },
        snapshot,
        task: { id: snapshot.task.id },
        usageReservation: request.usageReservation!,
        work: { id: snapshot.work.id },
      };
      assert.equal(
        (
          await store.claim({
            idempotencyKey: `submit-${workflowId}`,
            payloadHash: `payload-${workflowId}`,
            submission,
            workspaceId,
          })
        ).kind,
        'created',
      );
      const rootContract = await billing.readMerchantExecutionContract({
        taskId: workflowId,
        workspaceId,
      });
      assert.ok(rootContract.submissionPromptHash);
      assert.match(rootContract.submissionPromptHash, /^[a-f0-9]{64}$/u);
      assert.ok(rootContract.submissionReferenceAssetsHash);
      assert.match(
        rootContract.submissionReferenceAssetsHash,
        /^[a-f0-9]{64}$/u,
      );
      assert.ok(rootContract.submissionInputAssetsHash);
      assert.match(rootContract.submissionInputAssetsHash, /^[a-f0-9]{64}$/u);
      assert.deepEqual(providerEffects, []);

      const runners: HarnessStructuredNodeRunnerFactory = {
        create(input) {
          return new ModelSupplyStructuredNodeRunner({
            actorId: input.actorId,
            application: models,
            billingQuoteRevision: input.billingQuoteRevision,
            billingTaskId: input.billingTaskId,
            executor: structuredExecutor,
            selection: {
              catalogModelId: 'deepseek-v4-pro',
              mode: 'fixed',
            },
            workspaceId: input.workspaceId,
          });
        },
      };
      const executionChildObservability = {
        create(observedRequest: HarnessWorkflowInput) {
          const observedSnapshot = requireExecutionSnapshot(observedRequest);
          return new AgentPrimitiveObservabilityAdapter(
            new HarnessObservabilityEventAudit(harnessStore),
            {
              resolve() {
                return {
                  kind: 'product_usage' as const,
                  productUsageTaskId: observedSnapshot.task.id,
                  quoteId: observedSnapshot.quote.id,
                };
              },
            },
          );
        },
      };
      const copy = new ProductionHarnessStagePorts(
        runners,
        new LedgerBackedHarnessContextPort(
          new MemoryStoreFactLedger(),
          new MemoryContextBundleRepository(),
          () => now,
          undefined,
          undefined,
          undefined,
          {
            async resolve({ assetIds }) {
              return {
                knownAssetIds: [...assetIds],
                unauthorizedAssetIds: [],
              };
            },
          },
        ),
        {
          async deliverCopyRevision() {
            throw new Error('Copy delivery is outside the frozen media route.');
          },
        },
        () => now,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        executionChildObservability,
        undefined,
        undefined,
        new HarnessObservabilityEventAudit(harnessStore),
      );
      const stages = createProductionHarnessMediaAssembly({
        contentPackages,
        copy,
        models,
        noteAdmission,
        noteEnhancementJudge: unconfiguredNotePlanEnhancementJudgeResolver,
        noteSettings: {
          async read() {
            throw new Error('Note settings are outside the frozen image route.');
          },
        },
        now: () => now,
        runners,
        sensitiveLexicon: {
          async listEnabled() {
            return [];
          },
        },
        executionChildObservability,
      });
      const settlement = new HarnessProductBillingSettlementExecutor(
        billing,
        undefined,
        () => new Date(now),
        undefined,
        credits,
      );
      const workflow = registerHarnessDbosWorkflow(stages, harnessStore, {
        billing: {
          commit: (input) => settlement.commit(input),
          promoteMerchantExecution: (input) =>
            billing.promoteMerchantExecution(input),
          refund: (input) => settlement.refund(input),
          async scheduleCompensation(input) {
            await billingCompensations.enqueue(input);
          },
          async completeCompensation(input) {
            await billingCompensations.markCompleted(input);
          },
        },
        boundedContinuations: {
          async capability() {
            return { kind: 'available' as const };
          },
          async resolve() {
            return { limit: 'maxIterations' as const, value: 3 };
          },
        },
      });
      DBOS.setConfig({
        name: 'beauty-marketing-production-credit-media',
        systemDatabaseUrl,
        applicationVersion: `production-credit-media-${suffix}`,
      });
      await DBOS.launch();
      dbosLaunched = true;
      mediaWorker = await jobRuntime.startWorker((envelope, context) =>
        tracer.handle(envelope, context),
      );
      const resumeReconciler = new HarnessResumeReconciler(
        new PostgresHarnessResumeReconcilerStore(pool),
        {
          async resume() {
            throw new Error('A typed interaction must not use the legacy path.');
          },
          resumeInteraction: (
            resolvedWorkspaceId,
            resolvedWorkflowId,
            signal,
          ) =>
            resumeHarnessDbosInteractionWorkflow(
              resolvedWorkspaceId,
              resolvedWorkflowId,
              signal,
              harnessStore,
            ),
        },
      );
      const interactions = new HarnessInteractionService(harnessStore, {
        async resume({ eventId }) {
          if (!(await resumeReconciler.resumeEvent(eventId))) {
            throw new Error('The persisted interaction resume is unavailable.');
          }
        },
      });
      const admission = new HarnessTaskAdmissionService(
        harnessStore,
        new DbosHarnessWorkflowStarter(workflow),
        {
          async resolve() {
            return productionPromptBundle('298-credit-resume-v1');
          },
        },
        harnessStore,
        {
          async resolve() {
            return {
              maxIterations: 1,
              maxCostCents: 100,
              maxWallClockMs: 60_000,
              maxDelegations: 'unset' as const,
              requiredLimits: [
                'maxIterations',
                'maxCostCents',
                'maxWallClockMs',
              ] as const,
            };
          },
        },
        new ProductionHarnessFrozenRouteSnapshotResolver(
          foundationRoutes,
          models,
        ),
        undefined,
        harnessStore,
      );
      assert.deepEqual(
        await admission.submit({ taskId: workflowId, ...request }),
        { workflowId, replayed: false },
      );
      const confirmation = await waitForQuestionField(
        harnessStore,
        workspaceId,
        workflowId,
        'execution_confirmation',
      );
      assert.equal(
        await harnessStore.ackInteractionRenderer(workspaceId, workflowId, {
          carrier: 'conversation',
          requestId: confirmation.questionId,
          revision: confirmation.workflowRevision,
          step: 'execution_selection',
        }),
        'acked',
      );
      await interactions.submit(workspaceId, {
        requestId: confirmation.questionId,
        revision: confirmation.workflowRevision,
        idempotencyKey: `approve-paid-generation:${workflowId}`,
        resume: { runId: workflowId, step: 'execution_selection' },
        response: { kind: 'approved' },
      });
      const boundedQuestion = await waitForQuestionField(
        harnessStore,
        workspaceId,
        workflowId,
        'bounded_execution_continuation',
      );
      assert.deepEqual(providerCalls, {
        primary: 1,
        fallback: 0,
        poll: 0,
        download: 0,
      });
      assert.equal(new Set(mediaProviderEffects).size, 1);
      const mediaEffectKey = mediaProviderEffects[0]!;
      assert.match(
        mediaEffectKey,
        new RegExp(
          `^merchant-execution:${workflowId}:harness-media:${workflowId}:image$`,
          'u',
        ),
      );
      assert.equal(
        (
          await billingRepository.getMerchantExecution(
            workspaceId,
            workflowId,
            mediaEffectKey,
          )
        )?.status,
        'claimed',
      );
      const mediaJobId = modelSupplyJobIdForKey(
        workspaceId,
        mediaEffectKey,
      );
      const suspendedMediaJob = await tracerJobs.get(
        workspaceId,
        mediaJobId,
      );
      assert.equal(suspendedMediaJob.status, 'failed');
      assert.equal(
        (suspendedMediaJob.output?.result as ModelSupplyResult | undefined)
          ?.failureCode,
        'MEDIA_BOUNDED_ITERATION_EXCEEDED',
      );
      const boundedValue = boundedQuestion.options[0]?.label;
      assert.equal(boundedValue, '提高上限后继续');
      assert.equal(
        await harnessStore.ackInteractionRenderer(workspaceId, workflowId, {
          carrier: 'conversation',
          requestId: boundedQuestion.questionId,
          revision: boundedQuestion.workflowRevision,
          step: 'execution_selection',
        }),
        'acked',
      );
      await interactions.submit(workspaceId, {
        requestId: boundedQuestion.questionId,
        revision: boundedQuestion.workflowRevision,
        idempotencyKey: `raise-bounded-generation:${workflowId}`,
        resume: { runId: workflowId, step: 'execution_selection' },
        response: {
          kind: 'answer',
          items: [
            {
              itemId: boundedQuestion.response.field,
              result: { kind: 'answer', value: boundedValue! },
            },
          ],
        },
      });
      const result = await DBOS.retrieveWorkflow<{
        delivery: { packageId: string; revision: number; versionId: string };
      }>(runtimeId).getResult();
      assert.equal(result.delivery.packageId, request.packageId);
      assert.equal(result.delivery.revision, 1);
      assert.deepEqual(providerCalls, {
        primary: 1,
        fallback: 1,
        poll: 1,
        download: 1,
      });
      assert.equal(new Set(mediaProviderEffects).size, 1);
      assert.equal(mediaProviderEffects.at(-1), mediaEffectKey);
      const completedMediaJob = await tracerJobs.get(
        workspaceId,
        mediaJobId,
      );
      assert.equal(completedMediaJob.status, 'completed');
      const providerCallsBeforeReplay = { ...providerCalls };
      const replayedMedia = await models.getDurableMediaJob(
        workspaceId,
        mediaJobId,
      );
      assert.equal(replayedMedia.result.status, 'completed');
      assert.equal(
        replayedMedia.result.merchantExecutionEffectKey,
        mediaEffectKey,
      );
      assert.deepEqual(providerCalls, providerCallsBeforeReplay);

      const completedQuote = await billing.getQuote(quote.quoteId, workspaceId);
      const completedUsage = await billing.getUsage(workflowId, workspaceId);
      assert.equal(completedQuote?.lifecycleStatus, 'settled');
      assert.equal(completedUsage?.status, 'committed');
      assert.equal(
        (
          await pool.query<{ status: string }>(
            `SELECT status
               FROM harness_runtime.billing_compensations
              WHERE workspace_id=$1 AND task_id=$2`,
            [workspaceId, workflowId],
          )
        ).rows[0]?.status,
        'completed',
      );
      const executions = await pool.query<{
        effect_key: string;
        idempotency_key: string;
        result: ModelSupplyResult | null;
        status: string;
      }>(
        `SELECT effect_key, idempotency_key, result, status
           FROM p1_product_billing_merchant_executions
          WHERE workspace_id=$1 AND task_id=$2
          ORDER BY effect_key`,
        [workspaceId, workflowId],
      );
      assert.ok(providerEffects.length >= 3);
      for (const effectKey of providerEffects) {
        assert.equal(
          executions.rows.find((row) => row.effect_key === effectKey)?.status,
          'completed',
        );
      }
      const primary = executions.rows.find(
        ({ effect_key }) => effect_key === `merchant-execution:${workflowId}`,
      );
      const selectedEffect = mediaEffectKey;
      const selectedExecution = executions.rows.find(
        ({ effect_key }) => effect_key === selectedEffect,
      );
      assert.equal(selectedExecution?.status, 'completed');
      assert.deepEqual(selectedExecution?.result, replayedMedia.result);
      assert.equal(primary?.effect_key, `merchant-execution:${workflowId}`);
      assert.equal(
        primary?.idempotency_key,
        `merchant-execution-promotion:${selectedEffect}`,
      );
      assert.equal(primary?.status, 'completed');
      assert.deepEqual(primary?.result, replayedMedia.result);
      const promotion = {
        quoteRevision: confirmed.revision,
        sourceEffectKey: selectedEffect,
        taskId: workflowId,
        workspaceId,
      };
      await billing.promoteMerchantExecution(promotion);
      await assert.rejects(
        billing.promoteMerchantExecution({
          ...promotion,
          sourceEffectKey: providerEffects[0]!,
        }),
        /another canonical merchant execution/u,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*)::int AS count
               FROM p1_product_billing_merchant_executions
              WHERE workspace_id=$1 AND task_id=$2
                AND effect_key=$3`,
            [workspaceId, workflowId, `merchant-execution:${workflowId}`],
          )
        ).rows[0]?.count,
        1,
      );
    } finally {
      await mediaWorker?.stop().catch(() => undefined);
      await jobRuntime?.stop().catch(() => undefined);
      if (dbosLaunched) {
        await DBOS.shutdown({ deregister: true }).catch(() => undefined);
      }
      if (request) {
        await cleanup(pool, request, runtimeId).catch(() => undefined);
      }
      await pool
        .query(
          'DELETE FROM execution_spine.creation_submissions WHERE workspace_id=$1',
          [workspaceId],
        )
        .catch(() => undefined);
      await pool
        .query(
          'DELETE FROM p1_product_billing_merchant_executions WHERE workspace_id=$1',
          [workspaceId],
        )
        .catch(() => undefined);
      await pool
        .query('DELETE FROM p1_product_billing_usage WHERE workspace_id=$1', [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query('DELETE FROM p1_product_billing_quotes WHERE workspace_id=$1', [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query('DELETE FROM p1_credit_lot_transactions WHERE workspace_id=$1', [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query('DELETE FROM p1_credit_grant_lots WHERE workspace_id=$1', [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query(
          'DELETE FROM harness_runtime.billing_compensations WHERE workspace_id=$1',
          [workspaceId],
        )
        .catch(() => undefined);
      await pool
        .query('DELETE FROM workspaces WHERE id=$1', [workspaceId])
        .catch(() => undefined);
      await pool
        .query(`DROP TABLE IF EXISTS "public"."${tracerTable}" CASCADE`)
        .catch(() => undefined);
      await pool
        .query(`DROP SCHEMA IF EXISTS "${bossSchema}" CASCADE`)
        .catch(() => undefined);
      await pool.end();
    }
  },
);

class BoundaryAwareControllerFixture implements StructuredNodeRunner {
  constructor(
    private readonly snapshot: NonNullable<
      HarnessWorkflowInput['executionSnapshot']
    >,
    private readonly binding: Parameters<
      HarnessStructuredNodeRunnerFactory['create']
    >[0],
  ) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    await request.beforeProviderAttempt?.();
    let output: unknown;
    if (request.schemaName === 'harness_intent_naming_v1') {
      // The media controller is intentionally not assigned the image-generation
      // deployment. A second controller model pin is outside #262.
      assert.equal(this.binding.frozenRouteSnapshot, undefined);
      output = {
        normalizedIntent: '制作夏日护理项目图片',
        taskType: 'daily_service_exposure',
        deliveryLayer: 'finished_media',
        relevantAssetCategories: ['material'],
        usedAssetCategories: ['material'],
        route: 'customized',
        implicitConstraints: ['只使用已授权素材'],
        blockingGap: null,
      };
    } else if (request.schemaName === 'harness_image_brief_v1') {
      // #262 intentionally keeps one generation deployment pin. The existing
      // media-controller seam has no independent site-level or second-model pin,
      // so this recorded controller fixture must make that boundary explicit.
      assert.equal(this.binding.frozenRouteSnapshot, undefined);
      output = {
        kind: 'image',
        intent: {
          operation: 'image.generate',
          purpose: '夏日护理活动海报',
          subject: '夏日护理项目',
          scene: '真实门店护理区',
          composition: '竖版主视觉，主体清晰',
          references: [],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' },
        },
        prompt: '为夏日护理项目生成一张竖版活动海报，保留真实门店护理氛围。',
        referenceAssetIds: [],
        parameters: { ratio: '9:16', resolution: '1080p' },
        constraints: ['不得编造价格或护理效果'],
      };
    } else {
      throw new Error(`Unexpected production schema ${request.schemaName}.`);
    }
    return {
      output: request.schema.parse(output),
      attempts: 1,
      providerTaskRef: `brief-provider-${this.snapshot.task.id}`,
      replayed: false,
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  }
}

function productionMediaRequest(
  workflowId: string,
  workspaceId: string,
  route: { id: string; catalogRevisionId: string },
): HarnessWorkflowInput {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-production-media-assembly',
      workspaceId,
      idempotencyKey: `submission-${workflowId}`,
      taskId: workflowId,
      workId: `work-${workflowId}`,
      contentPackageId: `package-${workflowId}`,
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '制作夏日护理项目图片',
      surface: { id: 'surface-production-media', revision: 'surface-r1' },
      recipe: { id: 'recipe-production-media', revision: 'recipe-r1' },
      lens: 'image',
      operation: 'image.generate',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: {
        kind: 'image_set',
        quantity: 1,
        aspectRatio: '9:16',
      },
      deliverables: [
        {
          id: 'image-main',
          kind: 'image',
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
        },
      ],
      sources: {
        assets: [
          {
            id: `source-asset-${workflowId}`,
            revision: 'asset-r1',
            role: 'reference',
          },
        ],
      },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: OFFICIAL_NEUTRAL_IDENTITY,
      modelPolicy: {
        id: 'policy-production-media',
        revision: 'policy-r1',
        mode: 'fixed',
      },
      catalogModel: {
        id: 'model-production-media',
        revision: 'model-r1',
      },
      quote: { id: `quote-${workflowId}`, revision: 'quote-r1' },
      route: { id: route.id, revision: route.catalogRevisionId },
      briefContext: { id: `brief-${workflowId}`, revision: 1 },
      contentModules: ['social_cover'],
    },
    now,
  );
  return {
    actorId: snapshot.actorId,
    workspaceId,
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: snapshot.revision,
    creationMode: snapshot.creationMode,
    rawInput: snapshot.intent.text,
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: [],
      },
      assetReferences: snapshot.sources.assets.map(({ id }) => id),
    },
    executionSnapshot: snapshot,
    usageReservation: {
      credits: 5,
      id: `usage-${workflowId}`,
      units: [],
    },
  };
}

function productionCreditMediaRequest(input: {
  quoteRevision: string;
  route: { id: string; catalogRevisionId: string };
  workflowId: string;
  workspaceId: string;
}): HarnessWorkflowInput {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-production-credit-media',
      workspaceId: input.workspaceId,
      idempotencyKey: `submission-${input.workflowId}`,
      taskId: input.workflowId,
      workId: `work-${input.workflowId}`,
      contentPackageId: `package-${input.workflowId}`,
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '制作夏日护理项目图片',
      surface: { id: 'surface-production-credit-media', revision: 'surface-r1' },
      recipe: { id: 'recipe-production-credit-media', revision: 'recipe-r1' },
      lens: 'image',
      operation: 'image.generate',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: {
        kind: 'image_set',
        quantity: 1,
        aspectRatio: '9:16',
      },
      deliverables: [
        {
          id: 'image-main',
          kind: 'image',
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
        },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: OFFICIAL_NEUTRAL_IDENTITY,
      modelPolicy: {
        id: 'policy-production-credit-media',
        revision: 'policy-r1',
        mode: 'fixed',
      },
      catalogModel: {
        id: 'gpt-image-2',
        revision: input.route.catalogRevisionId,
      },
      quote: {
        id: `quote-${input.workflowId}`,
        revision: input.quoteRevision,
      },
      route: {
        id: input.route.id,
        revision: input.route.catalogRevisionId,
      },
      briefContext: { id: `brief-${input.workflowId}`, revision: 1 },
      contentModules: ['social_cover'],
    },
    now,
  );
  return {
    actorId: snapshot.actorId,
    workspaceId: input.workspaceId,
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
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
    usageReservation: {
      credits: 5,
      id: `usage-${input.workflowId}`,
      units: [],
    },
  };
}

function productionPromptBundle(
  version: string,
  fallback = false,
): HarnessFrozenPrompts {
  return Object.fromEntries(
    Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES).map(([key, name]) => {
      const content =
        HARNESS_BUILTIN_PROMPTS[key as keyof typeof HARNESS_BUILTIN_PROMPTS];
      return [
        key,
        {
          name,
          version,
          content,
          contentHash: createHash('sha256').update(content).digest('hex'),
          label: 'production',
          source: fallback ? 'builtin' : 'langfuse',
          isFallback: fallback,
          ...(fallback
            ? { fallbackReason: 'langfuse_http_503' }
            : {}),
        },
      ];
    }),
  ) as HarnessFrozenPrompts;
}

function productionModelSupply(providerRequests: ProviderExecutionRequest[]) {
  let credentialHead = 'credential-r1';
  const credentialAssemblyRequests: Array<{
    credentialAccountId: string;
    frozenVersion?: string;
    requiredScope: 'platform' | 'workspace_byok';
  }> = [];
  const secretBroker: CredentialSecretBrokerPort = {
    async assembleForRequest(request) {
      credentialAssemblyRequests.push(structuredClone(request));
      const version = request.frozenVersion ?? credentialHead;
      return {
        credentialAccountId: request.credentialAccountId,
        version,
        secretReference: `fixture://${request.credentialAccountId}/${version}`,
        secretVersion: version === 'credential-r1' ? 1 : 2,
        scope: request.requiredScope,
        secret: `fixture-secret-${version}`,
      };
    },
    async projectPublic() {
      throw new Error('Public credential projection is outside this test.');
    },
  };
  const capabilityProfile = {
    vocabularyVersion: 'model-capability-v1' as const,
    protocolCapabilities: {},
    modalities: [
      {
        mime: 'image/*',
        supported: true,
        basis: 'inferred' as const,
        evidenceRef: 'fixture://production-media/image',
      },
    ],
    businessTags: [],
    modalityCapabilities: [],
  };
  const deployment = {
    id: 'deployment-production-media',
    catalogModelId: 'model-production-media',
    providerProfileId: 'provider-profile-production-media',
    executionChannelId: 'channel-production-media',
    accountIdentity: 'account-production-media',
    endpointFingerprint: 'endpoint-production-media',
    providerModel: 'provider-model-production-media',
    endpointRevision: 'endpoint-r1',
    apiCounterparty: 'fixture-provider',
    credentialOwner: 'platform' as const,
    lifecycleRevision: 'deployment-r1',
    apiFamily: 'image' as const,
    channel: 'direct' as const,
    region: 'domestic' as const,
    status: 'active' as const,
    allowedDataClasses: ['contains_face' as const],
    policyRevision: 'policy-r1',
    priceRevision: 'price-r1',
    credentialMode: 'platform' as const,
    credentialVersion: 'credential-r1',
    unitPrice: {
      amountMicros: 1_000_000,
      currency: 'CNY' as const,
      unit: 'image',
    },
    activationEvidence: {
      status: 'recorded' as const,
      verifiedAt: now,
      evidenceRef: 'fixture-provider',
      configurationRevision: 'configuration-r1',
    },
    capabilityProfile,
  };
  const capabilityEntry: RuntimeCapabilityEntry = {
    deploymentId: deployment.id,
    catalogModelId: deployment.catalogModelId,
    apiFamily: deployment.apiFamily,
    channel: deployment.channel,
    region: deployment.region,
    executionChannelId: deployment.executionChannelId,
    providerModel: deployment.providerModel,
    endpointRevision: deployment.endpointRevision,
    lifecycleRevision: deployment.lifecycleRevision,
    credentialAccountId: 'credential-account-production-media',
    credentialVersion: deployment.credentialVersion,
    adapterKey: 'recorded',
    capabilityProfile,
  };
  const capabilityEntries = [capabilityEntry];
  const nextDeployment = {
    ...deployment,
    providerModel: 'provider-model-production-media-v2',
    endpointRevision: 'endpoint-r2',
    lifecycleRevision: 'deployment-r2',
    credentialVersion: 'credential-r2',
  };
  const nextCapabilityEntries: RuntimeCapabilityEntry[] = [
    {
      ...capabilityEntry,
      providerModel: nextDeployment.providerModel,
      endpointRevision: nextDeployment.endpointRevision,
      lifecycleRevision: nextDeployment.lifecycleRevision,
      credentialVersion: nextDeployment.credentialVersion,
    },
  ];
  const catalogModels: CatalogModel[] = [
    {
      id: 'model-production-media',
      modality: 'image' as const,
      operations: ['image.generate' as const],
      displayName: 'Production media fixture',
      qualityRank: 100,
      manufacturer: 'fixture',
      stableModelName: 'production-media-fixture',
      version: '1',
      capabilities: ['image.generate'],
    },
  ];
  const capabilityHotAssembly = new CapabilityHotAssemblyRegistry(
    undefined,
    secretBroker,
  );
  capabilityHotAssembly.applyCapabilityRevision({
    revisionId: 'capability-production-media-r1',
    number: 1,
    publishedAt: now,
    entries: capabilityEntries,
  });
  const promotedEffects: Array<
    Parameters<MerchantExecutionPromotionPort['promoteMerchantExecution']>[0]
  > = [];
  const merchantExecutionBilling =
    productionMerchantExecutionBilling(promotedEffects);
  const models = new ModelSupplyApplicationService({
    catalogRevisionId: 'model-r1',
    models: catalogModels,
    deployments: [deployment],
    capabilityHotAssembly,
    execution: {
      async execute(request) {
        providerRequests.push(structuredClone(request));
        return {
          kind: 'completed',
          assetBytes: Buffer.from(`production-media:${request.jobId}`),
          contentType: 'image/png',
          providerCost: {
            amount: 1,
            currency: 'CNY',
            usage: { mediaUnits: 1 },
          },
        };
      },
    },
    merchantExecutionBilling,
  });
  return {
    credentialAssemblyRequests,
    merchantExecutionBilling,
    models,
    promotedEffects,
    publishNextCatalogHead(workspaceId: string) {
      models.applyCatalogRevision(
        workspaceId,
        'model-r2',
        catalogModels.map((model) => ({ ...model, version: '2' })),
        [nextDeployment],
      );
    },
    publishNextCapabilityHead() {
      capabilityHotAssembly.applyCapabilityRevision({
        revisionId: 'capability-production-media-r2',
        number: 2,
        previousRevisionId: 'capability-production-media-r1',
        publishedAt: '2026-07-29T09:31:00.000Z',
        entries: nextCapabilityEntries,
      });
    },
    publishNextCredentialHead() {
      credentialHead = 'credential-r2';
    },
  };
}

function productionMerchantExecutionBilling(
  promotedEffects: Array<
    Parameters<MerchantExecutionPromotionPort['promoteMerchantExecution']>[0]
  >,
): MerchantExecutionBillingPort & MerchantExecutionPromotionPort {
  const executions = new Map<
    string,
    {
      inputSnapshot: ClaimMerchantExecutionInput['inputSnapshot'];
      result?: unknown;
    }
  >();
  return {
    async bindMerchantExecutionInput() {
      throw new Error('Auxiliary media execution must not bind the primary slot.');
    },
    async readMerchantExecutionContract() {
      return {
        catalogModelId: 'model-production-media',
        operation: 'image.generate',
        outputCount: 1,
        quoteRevision: 'quote-r1',
        submissionContractHash: 'production-media-assembly-contract',
      };
    },
    async claimMerchantExecution<T>(input: ClaimMerchantExecutionInput) {
      if (
        input.catalogModelId !== 'model-production-media' ||
        input.operation !== 'image.generate' ||
        input.outputCount !== 1 ||
        input.quoteRevision !== 'quote-r1'
      ) {
        throw new Error('Production media claim must retain its quoted contract.');
      }
      const key = `${input.workspaceId}:${input.taskId}:${input.effectKey}`;
      const existing = executions.get(key);
      if (existing?.result !== undefined) {
        return { decision: 'replay' as const, result: existing.result as T };
      }
      if (existing) return { decision: 'in_progress' as const };
      const inputSnapshot = structuredClone(input.inputSnapshot);
      executions.set(key, { inputSnapshot });
      return { decision: 'execute' as const, inputSnapshot };
    },
    async completeMerchantExecution<T>(
      input: ClaimMerchantExecutionInput & { result: T },
    ) {
      const key = `${input.workspaceId}:${input.taskId}:${input.effectKey}`;
      const existing = executions.get(key);
      if (!existing) throw new Error('Production media execution was not claimed.');
      existing.result = structuredClone(input.result);
      return input.result;
    },
    async promoteMerchantExecution(input) {
      const sourceKey =
        `${input.workspaceId}:${input.taskId}:${input.sourceEffectKey}`;
      const rootKey =
        `${input.workspaceId}:${input.taskId}:merchant-execution:${input.taskId}`;
      const source = executions.get(sourceKey);
      const existing = executions.get(rootKey);
      if (existing) {
        if (
          promotedEffects.some(
            (promotion) =>
              promotion.taskId === input.taskId &&
              promotion.workspaceId === input.workspaceId &&
              promotion.sourceEffectKey === input.sourceEffectKey,
          )
        ) {
          return;
        }
        throw new Error('Another production media effect is already canonical.');
      }
      if (source?.result === undefined) {
        throw new Error('Production media promotion requires a completed effect.');
      }
      executions.set(rootKey, structuredClone(source));
      promotedEffects.push(structuredClone(input));
    },
  };
}

async function seedContentPackage(
  pool: Pool,
  request: HarnessWorkflowInput,
) {
  const snapshot = requireExecutionSnapshot(request);
  const contentPackage = buildContentPackage({
    id: request.packageId,
    kind: 'image_text',
    source: {
      assetIds: snapshot.sources.assets.map(({ id }) => id),
      creationExecutionSnapshot: {
        id: snapshot.id,
        revision: snapshot.revision,
        schemaVersion: snapshot.schemaVersion,
      },
      targetPlatform: 'xiaohongshu',
      workflowId: snapshot.task.id,
      workflowRevision: snapshot.revision,
      workId: snapshot.work.id,
    },
    timestamp: now,
    workspaceId: request.workspaceId,
  });
  await pool.query(
    `INSERT INTO p1_content_packages
       (workspace_id, id, payload, revision, updated_at)
     VALUES ($1, $2, $3::jsonb, 0, $4::timestamptz)`,
    [
      request.workspaceId,
      request.packageId,
      JSON.stringify(contentPackage),
      now,
    ],
  );
}

async function assertPersistedJoin(
  pool: Pool,
  request: HarnessWorkflowInput,
  runtimeId: string,
  completed: ModelSupplyResult,
) {
  const snapshot = requireExecutionSnapshot(request);
  const asset = completed.asset;
  assert.ok(asset);
  const traces = await pool.query<{ stage: string }>(
    `SELECT stage
       FROM harness_runtime.decision_traces
      WHERE task_id=$1
      ORDER BY created_at, id`,
    [runtimeId],
  );
  assert.deepEqual(
    traces.rows.map(({ stage }) => stage),
    expectedStages,
  );

  const persisted = await pool.query<{
    payload: unknown;
    revision: string;
  }>(
    `SELECT payload, revision::text AS revision
       FROM p1_content_packages
      WHERE workspace_id=$1 AND id=$2`,
    [request.workspaceId, request.packageId],
  );
  assert.equal(persisted.rows[0]?.revision, '1');
  const contentPackage = contentPackageSchema.parse(
    persisted.rows[0]?.payload,
  );
  assert.equal(contentPackage.revision, 1);
  assert.equal(contentPackage.status, 'review_ready');
  assert.equal(contentPackage.source.creationExecutionSnapshot?.id, snapshot.id);
  assert.equal(contentPackage.source.workflowId, snapshot.task.id);
  assert.equal(contentPackage.source.workId, snapshot.work.id);
  assert.deepEqual(contentPackage.generated.assetIds, [asset.id]);
  assert.deepEqual(contentPackage.generated.ownedAssets, [asset]);
  assert.equal(contentPackage.generated.childRuns.length, 1);
  const childRun = contentPackage.generated.childRuns[0];
  assert.ok(childRun);
  assert.equal(childRun.runId, completed.jobId);
  assert.equal(childRun.actualCatalogModelId, snapshot.catalogModel.id);
  assert.equal(childRun.routeSnapshot?.id, snapshot.route.id);
  assert.equal(
    childRun.routeSnapshot?.catalogRevisionId,
    snapshot.catalogModel.revision,
  );
  assert.equal(childRun.providerAttempts?.length, 1);
  assert.equal(
    childRun.providerAttempts?.[0]?.providerTaskRef,
    completed.attempt.providerTaskRef,
  );
  assert.equal(childRun.providerAttempts?.[0]?.status, 'completed');
  assert.deepEqual(childRun.productUsage, {
    quantity: completed.usage.quantity,
    status: completed.usage.status,
  });
  assert.deepEqual(childRun.providerCost, {
    amount: completed.providerCost.amount,
    currency: completed.providerCost.currency,
    status: completed.providerCost.status,
  });
  assert.deepEqual(childRun.providerCosts, completed.providerCosts);
  const currentVersion = contentPackage.versions.find(
    ({ id }) => id === contentPackage.currentVersionId,
  );
  assert.equal(currentVersion?.title, '夏日护理活动海报');
  assert.deepEqual(currentVersion?.orderedAssetIds, [asset.id]);

  const receipts = await pool.query<{
    delivery: { packageId: string; revision: number; versionId: string };
    idempotency_key: string;
  }>(
    `SELECT idempotency_key, delivery
       FROM execution_spine.content_package_write_receipts
      WHERE workspace_id=$1 AND package_id=$2`,
    [request.workspaceId, request.packageId],
  );
  assert.deepEqual(receipts.rows, [
    {
      idempotency_key: `harness-media:${snapshot.task.id}:image`,
      delivery: {
        packageId: request.packageId,
        revision: 1,
        versionId: contentPackage.currentVersionId,
      },
    },
  ]);
}

async function waitForExecutionConfirmation(
  store: PostgresHarnessStore,
  workspaceId: string,
  workflowId: string,
) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const pending = await store.readPending(workspaceId, workflowId);
    if (pending?.executionConfirmationAuthority) return pending;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Paid media execution confirmation was not registered.');
}

async function waitForQuestionField(
  store: PostgresHarnessStore,
  workspaceId: string,
  workflowId: string,
  field: string,
) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const pending = await store.readPending(workspaceId, workflowId);
    if (pending?.response.field === field) return pending;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Harness question ${field} was not registered.`);
}

async function cleanup(
  pool: Pool,
  request: HarnessWorkflowInput,
  runtimeId: string,
) {
  await pool.query(
    `DELETE FROM harness_runtime.langfuse_outbox
      WHERE audit_id IN (
        SELECT id FROM harness_runtime.audit_events WHERE workflow_id=$1
      )`,
    [runtimeId],
  );
  await pool.query(
    'DELETE FROM harness_runtime.audit_events WHERE workflow_id=$1',
    [runtimeId],
  );
  await pool.query(
    'DELETE FROM harness_runtime.decision_traces WHERE task_id=$1',
    [runtimeId],
  );
  await pool.query(
    'DELETE FROM harness_runtime.task_requests WHERE runtime_id=$1',
    [runtimeId],
  );
  await pool.query(
    `DELETE FROM execution_spine.content_package_write_receipts
      WHERE workspace_id=$1 AND package_id=$2`,
    [request.workspaceId, request.packageId],
  );
  await pool.query(
    'DELETE FROM p1_content_packages WHERE workspace_id=$1 AND id=$2',
    [request.workspaceId, request.packageId],
  );
  await pool.query(
    'DELETE FROM p1_route_snapshots WHERE workspace_id=$1 AND id=$2',
    [request.workspaceId, requireExecutionSnapshot(request).route.id],
  );
  await pool.query('DELETE FROM workspaces WHERE id=$1', [
    request.workspaceId,
  ]);
}

function requireExecutionSnapshot(request: HarnessWorkflowInput) {
  if (!request.executionSnapshot) {
    throw new Error('Production media assembly requires a frozen snapshot.');
  }
  return request.executionSnapshot;
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    batch: Array<{ type: string; body: Record<string, unknown> }>;
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function listen(
  t: test.TestContext,
  server: ReturnType<typeof createServer>,
) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
