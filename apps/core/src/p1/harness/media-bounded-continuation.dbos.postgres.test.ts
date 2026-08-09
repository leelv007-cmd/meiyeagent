import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';

import { PgBossJobPort } from '../job-runtime/pg-boss-job-port.js';
import {
  DurableTracerWorker,
  PostgresTracerJobRepository,
  TracerJobApplicationService,
} from '../job-runtime/tracer-worker.js';
import {
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  RecordedAdapterRouter,
  createDefaultCatalogModels,
  createDefaultDeployments,
  modelSupplyJobIdForKey,
  type MediaProviderLifecyclePort,
  type ModelSupplyLedgerCheckpointInput,
  type ModelSupplyLedgerPort,
  type ModelSupplyResult,
  type ModelSupplySubmission,
} from '../model-supply/index.js';
import {
  DurableMediaGenerationApplicationService,
  ModelMediaGenerationEffect,
} from '../model-supply/media-generation-workflow.js';
import { resumeWithRaisedServerLimit } from './bounded-execution-controller.js';
import { harnessRuntimeId } from './workspace-scope.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;

test(
  'DBOS raises one bounded route while PostgreSQL resumes the same media job',
  {
    skip:
      databaseUrl && systemDatabaseUrl
        ? false
        : 'TEST_DATABASE_URL and TEST_DBOS_SYSTEM_DATABASE_URL are required',
  },
  async () => {
    if (!databaseUrl || !systemDatabaseUrl) {
      throw new Error('The business and DBOS system databases are required.');
    }
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const workspaceId = `workspace_issue247_${suffix}`;
    const orchestrationId = `issue247_bounded_${suffix}`;
    const runtimeId = harnessRuntimeId(workspaceId, orchestrationId);
    const tracerTable = `issue247_tracer_${suffix}`;
    const ledgerTable = `issue247_ledger_${suffix}`;
    const bossSchema = `issue247_boss_${suffix}`;
    const primaryDeploymentId = 'gpt-image-2-managed';
    const fallbackDeploymentId = 'gpt-image-2-tuzi-relay';
    const providerCalls = { primary: 0, fallback: 0 };
    const pool = new Pool({ connectionString: databaseUrl, max: 8 });
    const ledger = new PostgresSmokeModelSupplyLedger(pool, ledgerTable);
    let runtime: PgBossJobPort | undefined;
    let dbosLaunched = false;

    try {
      await ledger.migrate();
      runtime = PgBossJobPort.connect({
        connection: { connectionString: databaseUrl, schema: bossSchema },
        queuePrefix: `issue247-${suffix}`,
        retryDelaySeconds: 1,
        heartbeatSeconds: 10,
      });
      const repository = new PostgresTracerJobRepository(pool, runtime, {
        table: tracerTable,
      });
      const jobs = new TracerJobApplicationService(repository);
      const deployments = createDefaultDeployments(
        {
          activatedDeploymentIds: [
            primaryDeploymentId,
            fallbackDeploymentId,
          ],
          activationEvidenceStatus: 'recorded',
          deploymentPricingById: {
            [primaryDeploymentId]: {
              priceRevision: 'issue247-primary-cny-v1',
              unitPrice: {
                amountMicros: 10_000,
                currency: 'CNY',
                unit: 'image',
              },
            },
            [fallbackDeploymentId]: {
              priceRevision: 'issue247-fallback-cny-v1',
              unitPrice: {
                amountMicros: 10_000,
                currency: 'CNY',
                unit: 'image',
              },
            },
          },
        },
      ).map((deployment) =>
        deployment.id === primaryDeploymentId
          ? {
              ...deployment,
              accountIdentity: 'issue247-primary-account',
              endpointFingerprint: 'issue247-primary-endpoint',
            }
          : deployment.id === fallbackDeploymentId
            ? {
                ...deployment,
                accountIdentity: 'issue247-fallback-account',
                endpointFingerprint: 'issue247-fallback-endpoint',
              }
            : deployment,
      );
      const models = new ModelSupplyApplicationService({
        assetStorage: new MemoryModelAssetStorage(),
        deployments,
        execution: new RecordedAdapterRouter(),
        ledger,
        models: createDefaultCatalogModels(),
        planningControlPlane: {
          async readPlanningState() {
            return {
              routePolicyRevisionId: 'issue247-route-policy-v1',
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
      const provider: MediaProviderLifecyclePort = {
        async submit(request) {
          if (request.deployment.id === primaryDeploymentId) {
            providerCalls.primary += 1;
            return {
              acceptance: 'rejected_before_accept',
              errorCode: 'issue247_primary_rejected',
              retryable: true,
              error: 'Primary rejected before accepting the request.',
              providerCost: { amount: 0, currency: 'CNY', usage: {} },
            };
          }
          assert.equal(request.deployment.id, fallbackDeploymentId);
          providerCalls.fallback += 1;
          return {
            acceptance: 'accepted',
            taskRef: `issue247-fallback-task-${suffix}`,
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
        async poll(request) {
          assert.equal(request.deployment.id, fallbackDeploymentId);
          return {
            status: 'completed',
            providerCost: {
              amount: 0.01,
              currency: 'CNY',
              usage: { mediaUnits: 1 },
            },
          };
        },
        async download(request) {
          assert.equal(request.deployment.id, fallbackDeploymentId);
          return {
            bytes: Buffer.from(`issue247:${request.jobId}`),
            contentType: 'image/png',
          };
        },
        async cancel() {},
      };
      const media = new DurableMediaGenerationApplicationService({
        jobs,
        models,
        provider,
      });
      models.attachDurableMediaRuntime(media);
      const tracer = new DurableTracerWorker(
        repository,
        new ModelMediaGenerationEffect({ models, provider }),
      );
      const submission: ModelSupplySubmission = {
        actorId: 'owner-issue247',
        correlationId: orchestrationId,
        dataClass: [],
        idempotencyKey: `harness-media:${orchestrationId}:image`,
        mediaBoundedExecution: {
          schemaVersion: 'media-bounded-execution/v1',
          snapshot: {
            schemaVersion: 'bounded-execution-snapshot/v1',
            maxIterations: 1,
            maxCostCents: 100,
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
          },
          countedAttemptIds: [],
          countedProviderCostIds: [],
        },
        operation: 'image.generate',
        prompt: 'Generate one bounded image with a legal fallback.',
        selection: {
          catalogModelId: 'gpt-image-2',
          fallbackConsent: true,
          mode: 'fixed',
        },
        workspaceId,
      };
      const jobId = modelSupplyJobIdForKey(
        workspaceId,
        submission.idempotencyKey,
      );
      const workflow = DBOS.registerWorkflow(
        async () => {
          await DBOS.runStep(() => models.submit(submission), {
            name: 'submit-bounded-media',
          });
          const initialRecord = await DBOS.runStep(
            () => jobs.get(workspaceId, jobId),
            { name: 'read-initial-media-job' },
          );
          const primaryOutcome = await DBOS.runStep(
            () => tracer.handle(tracerEnvelope(initialRecord)),
            { name: 'run-primary-media-attempt' },
          );
          if (primaryOutcome.status !== 'dead_letter') {
            throw new Error(
              'The primary attempt did not enter a durable bounded suspension.',
            );
          }
          const suspended = await DBOS.runStep(
            () => models.getDurableMediaJob(workspaceId, jobId),
            { name: 'read-bounded-suspension' },
          );
          const bounded = suspended.result.boundedExecution;
          if (
            suspended.result.failureCode !==
              'MEDIA_BOUNDED_ITERATION_EXCEEDED' ||
            !bounded
          ) {
            throw new Error('The provider route did not durably suspend.');
          }
          await DBOS.setEvent('issue-247-bounded-continuation-pending', {
            jobId,
          });
          await DBOS.recv('issue-247-server-owned-raise', {
            timeoutSeconds: 30,
          });
          const raised = resumeWithRaisedServerLimit(bounded.snapshot, {
            limit: 'maxIterations',
            value: 2,
          });
          const authorization = {
            schemaVersion: 'media-bounded-execution/v1' as const,
            snapshot: raised,
            countedAttemptIds: bounded.consumedAttemptIds,
            countedProviderCostIds: bounded.consumedProviderCostIds,
          };
          await DBOS.runStep(
            () =>
              models.resumeBoundedMediaJob({
                workspaceId,
                jobId,
                authorization,
              }),
            { name: 'resume-same-bounded-media-job' },
          );
          const resumedRecord = await DBOS.runStep(
            () => jobs.get(workspaceId, jobId),
            { name: 'read-resumed-media-job' },
          );
          await DBOS.runStep(
            () => tracer.handle(tracerEnvelope(resumedRecord)),
            { name: 'run-fallback-media-submit' },
          );
          await DBOS.runStep(
            () => tracer.handle(tracerEnvelope(resumedRecord)),
            { name: 'run-fallback-media-terminal' },
          );
          const completed = await DBOS.runStep(
            () => models.getDurableMediaJob(workspaceId, jobId),
            { name: 'read-bounded-completion' },
          );
          return { jobId, result: completed.result };
        },
        { name: `issue247BoundedContinuation${suffix}` },
      );

      DBOS.setConfig({
        name: 'beauty-marketing-issue247-bounded-continuation',
        runAdminServer: false,
        systemDatabaseUrl,
        applicationVersion: `issue247-bounded-${suffix}`,
      });
      await DBOS.launch();
      dbosLaunched = true;
      const handle = await DBOS.startWorkflow(workflow, {
        workflowID: runtimeId,
      })();

      await DBOS.getEvent(
        runtimeId,
        'issue-247-bounded-continuation-pending',
        { timeoutSeconds: 30 },
      );
      const suspended = await jobs.get(workspaceId, jobId);
      const suspendedResult = suspended.output?.result as
        | ModelSupplyResult
        | undefined;
      assert.equal(suspended.status, 'failed');
      assert.equal(
        suspendedResult?.failureCode,
        'MEDIA_BOUNDED_ITERATION_EXCEEDED',
      );
      assert.equal(suspendedResult?.attempts.length, 1);
      assert.equal(
        suspendedResult?.attempt.deploymentId,
        primaryDeploymentId,
      );
      assert.deepEqual(providerCalls, { primary: 1, fallback: 0 });
      assert.deepEqual(await ledger.frozenDeploymentIds(), [
        primaryDeploymentId,
      ]);

      await DBOS.send(
        runtimeId,
        { approved: true },
        'issue-247-server-owned-raise',
        `issue247-server-owned-raise:${runtimeId}`,
      );
      const first = await handle.getResult();
      assert.equal(first.jobId, jobId);
      assert.equal(first.result.status, 'completed');
      assert.deepEqual(
        first.result.attempts.map((attempt) => attempt.deploymentId),
        [primaryDeploymentId, fallbackDeploymentId],
      );
      assert.deepEqual(providerCalls, { primary: 1, fallback: 1 });
      assert.deepEqual(await ledger.frozenDeploymentIds(), [
        primaryDeploymentId,
        fallbackDeploymentId,
      ]);
      assert.equal(
        await DBOS.retrieveWorkflow(runtimeId)
          .getStatus()
          .then((status) => status?.status),
        'SUCCESS',
      );

      const callsBeforeReplay = { ...providerCalls };
      const replay = await DBOS.retrieveWorkflow<typeof first>(
        runtimeId,
      ).getResult();
      assert.equal(replay.jobId, jobId);
      assert.deepEqual(providerCalls, callsBeforeReplay);
    } finally {
      await runtime?.stop().catch(() => undefined);
      if (dbosLaunched) {
        await DBOS.shutdown({ deregister: true }).catch(() => undefined);
      }
      await pool
        .query(`DROP TABLE IF EXISTS "public"."${tracerTable}" CASCADE`)
        .catch(() => undefined);
      await pool
        .query(`DROP TABLE IF EXISTS "public"."${ledgerTable}" CASCADE`)
        .catch(() => undefined);
      await pool
        .query(`DROP SCHEMA IF EXISTS "${bossSchema}" CASCADE`)
        .catch(() => undefined);
      await pool.end();
    }
  },
);

function tracerEnvelope(
  record: Awaited<ReturnType<TracerJobApplicationService['get']>>,
) {
  return {
    jobId: record.jobId,
    workspaceId: record.workspaceId,
    kind: record.kind,
    payload: record.payload,
    fingerprint: record.payloadHash,
    enqueuedAt: record.createdAt,
  };
}

class PostgresSmokeModelSupplyLedger implements ModelSupplyLedgerPort {
  constructor(
    private readonly pool: Pool,
    private readonly table: string,
  ) {}

  async migrate() {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS "public"."${this.table}" (
         job_id text PRIMARY KEY,
         result jsonb,
         frozen_deployments jsonb NOT NULL DEFAULT '[]'::jsonb
       )`,
    );
  }

  async checkpointAttempt(input: ModelSupplyLedgerCheckpointInput) {
    const persisted = await this.pool.query<{ result: ModelSupplyResult }>(
      `INSERT INTO "public"."${this.table}" (job_id)
       VALUES ($1)
       ON CONFLICT (job_id) DO UPDATE SET job_id=EXCLUDED.job_id
       RETURNING result`,
      [input.jobId],
    );
    const result = persisted.rows[0]?.result;
    return result
      ? { replayed: true, recoveredResult: structuredClone(result) }
      : { replayed: false };
  }

  async freezeAttempt(input: ModelSupplyLedgerCheckpointInput) {
    await this.pool.query(
      `INSERT INTO "public"."${this.table}" (job_id, frozen_deployments)
       VALUES ($1, jsonb_build_array($2::text))
       ON CONFLICT (job_id) DO UPDATE
         SET frozen_deployments = CASE
           WHEN "public"."${this.table}".frozen_deployments ? $2
             THEN "public"."${this.table}".frozen_deployments
           ELSE "public"."${this.table}".frozen_deployments || to_jsonb($2::text)
         END`,
      [input.jobId, input.deployment.id],
    );
    return { persisted: true };
  }

  async settleAttempt(input: { result: ModelSupplyResult }) {
    await this.pool.query(
      `INSERT INTO "public"."${this.table}" (job_id, result)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (job_id) DO UPDATE SET result=EXCLUDED.result`,
      [input.result.jobId, JSON.stringify(input.result)],
    );
  }

  async frozenDeploymentIds() {
    const result = await this.pool.query<{
      frozen_deployments: string[];
    }>(
      `SELECT frozen_deployments
         FROM "public"."${this.table}"
        ORDER BY job_id
        LIMIT 1`,
    );
    return result.rows[0]?.frozen_deployments ?? [];
  }
}
