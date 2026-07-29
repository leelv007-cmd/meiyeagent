import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { DBOS } from '@dbos-inc/dbos-sdk';
import { contentPackageSchema } from '@meiye/contracts';
import { Pool } from 'pg';

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
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import {
  ModelSupplyApplicationService,
  type CatalogModel,
  type ModelSupplyResult,
  type ProviderExecutionRequest,
} from '../model-supply/index.js';
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
} from './dbos-workflow.js';
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
            const result = await models.submit(input);
            completedModelResults.push(structuredClone(result));
            return result;
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
        executionChildObservability,
      });
      const workflow = registerHarnessDbosWorkflow(stages, harnessStore);
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
              maxCostCents: 'unset' as const,
              maxWallClockMs: 'unset' as const,
              maxDelegations: 'unset' as const,
              requiredLimits: ['maxIterations'] as const,
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
        maxCostCents: 'unset',
        maxWallClockMs: 'unset',
        maxDelegations: 'unset',
        requiredLimits: ['maxIterations'],
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
      assert.deepEqual(submission.selection, {
        mode: 'fixed',
        catalogModelId: snapshot.catalogModel.id,
      });
      assert.equal(submission.correlationId, workflowId);
      assert.equal(
        submission.idempotencyKey,
        `harness-media:${workflowId}:image`,
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
  });
  return {
    credentialAssemblyRequests,
    models,
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
