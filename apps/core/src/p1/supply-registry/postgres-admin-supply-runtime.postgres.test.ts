import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import type { RoutePolicyRevision } from '@meiye/contracts';
import { createPermissionAuthorizer } from '../capability-permission/authorizer.js';
import { P1DomainError } from '../foundation/domain.js';
import { FakeKmsSecretStore } from '../integrations/secret-store.js';
import {
  createCredentialAccount,
  type CredentialAccount,
} from './credential-account.js';
import {
  PostgresAdminSupplyMigration,
  PostgresAdminSupplyStore,
  PostgresCredentialRotationReceiptStore,
  ProductionAdminSupplyDomain,
  projectPostgresSupplyRuns,
} from './postgres-admin-supply-runtime.js';
import { PostgresSupplyControlPlaneRepository } from './postgres-control-plane.js';
import {
  PostgresSupplyPlanningControlPlane,
  PostgresSupplyPlanningMigration,
} from './postgres-planning-control-plane.js';
import type { ChannelLifecycleState } from './hot-assembly.js';
import { buildRouteDecisionExplanation } from './route-explanation.js';
import {
  AdminSupplyControlPlane,
  type AdminSupplyGovernedActionRequest,
} from './admin-control-plane.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('ProductionAdminSupplyDomain global credential truth', () => {
  it('previews and rotates a platform credential in the global workspace', async () => {
    const account = createCredentialAccount({
      id: 'credential-account:platform:model.direct',
      label: 'Platform model.direct',
      providerProfileId: 'provider-tu-zi',
      type: 'model.direct',
      scope: 'platform',
      secretReference: 'kms://__global__/cred-model-direct/v1',
      version: '1',
      secretVersion: 1,
      credentialId: 'cred-model-direct',
      connectionId: 'platform:model.direct',
      workspaceId: '__global__',
      provider: 'model',
      status: 'active',
      now: '2026-07-20T00:00:00.000Z',
    });
    const accountReads: string[] = [];
    let rotationWorkspaceId = '';
    const domain = new ProductionAdminSupplyDomain({
      registry: {
        async getCurrentRegistryRevision() {
          return null;
        },
        async getCredentialAccount(workspaceId: string) {
          accountReads.push(workspaceId);
          return { account, recordRevision: 1 };
        },
      },
      credentialRotations: {
        async consumeAndRotate(input: { workspaceId: string }) {
          rotationWorkspaceId = input.workspaceId;
          return { ...account, version: '2', secretVersion: 2 };
        },
      },
    } as never);
    const request = {
      action: 'credential_rotate',
      context: {
        workspaceId: 'tenant-request-workspace',
        userId: 'admin-a',
        correlationId: 'corr-global-credential-rotate',
        actor: 'admin',
      },
      target: {
        resourceType: 'credential_account',
        resourceId: account.id,
      },
      reason: 'rotate the platform credential safely',
      expectedRevisionId: '1',
      idempotencyKey: 'global-credential-rotate',
      parameters: { secureWriteReceiptId: 'receipt-v2' },
    } as const;
    const preview = await domain.preview(request);
    await domain.execute({
      request,
      preview,
      audit: {} as never,
      idempotency: {
        workspaceId: request.context.workspaceId,
        key: request.idempotencyKey,
        payloadHash: request.idempotencyKey,
      },
    });

    assert.equal(accountReads.length > 0, true);
    assert.equal(accountReads.every((id) => id === '__global__'), true);
    assert.equal(rotationWorkspaceId, '__global__');
  });
});

describe('ProductionAdminSupplyDomain channel CAS', () => {
  it('rejects a stale preview after a concurrent persisted lifecycle transition', async () => {
    let lifecycle: ChannelLifecycleState = {
      channelId: 'channel-ark-cn',
      mode: 'accepting',
      reason: 'initial',
      startedAt: '2026-07-20T00:00:00.000Z',
      drainMode: 'accepting',
      inFlightCount: 0,
      lifecycleRevision: 'channel-ark-cn:lifecycle:r0',
    };
    const domain = new ProductionAdminSupplyDomain({
      registry: {
        async getCurrentRegistryRevision() {
          return {
            executionChannels: [
              {
                id: 'channel-ark-cn',
                revisionId: 'channel-ark-cn:catalog:r7',
              },
            ],
          };
        },
      },
      hotAssembly: {
        async getChannelLifecycle() {
          return lifecycle;
        },
      },
    } as never);
    const request = {
      context: {
        workspaceId: 'workspace-a',
        userId: 'admin-a',
        correlationId: 'corr-a',
        actor: 'admin',
      },
      action: 'isolate',
      target: { resourceType: 'channel', resourceId: 'channel-ark-cn' },
      reason: 'isolate a degraded supply channel',
      expectedRevisionId: lifecycle.lifecycleRevision,
      idempotencyKey: 'isolate-channel-ark-cn',
    } as const;

    const preview = await domain.preview(request);
    assert.equal(preview.expectedRevisionId, 'channel-ark-cn:lifecycle:r0');

    lifecycle = {
      ...lifecycle,
      mode: 'isolated',
      reason: 'concurrent operator action',
      lifecycleRevision: 'channel-ark-cn:lifecycle:r1',
    };
    await assert.rejects(
      domain.preview(request),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });
});

describe('ProductionAdminSupplyDomain provider evidence actions', () => {
  const context = {
    workspaceId: 'workspace-a',
    userId: 'admin-a',
    correlationId: 'corr-provider-evidence',
    actor: 'admin',
  } as const;
  const audit = {
    actor: { userId: 'admin-a', role: 'admin' },
    permission: 'platform.manage',
    target: {
      kind: 'command',
      module: 'model-supply',
      action: 'provider_probe',
      resourceId: 'deployment-a',
      resourceType: 'deployment',
    },
    reason: 'refresh provider evidence',
    before: null,
    after: null,
    correlationId: 'corr-provider-evidence',
    occurredAt: '2026-07-20T00:00:00.000Z',
  } as const;

  it('executes connectivity and conformance through different real-semantics ports', async () => {
    const calls: string[] = [];
    const domain = new ProductionAdminSupplyDomain({
      registry: {
        async getCurrentRegistryRevision() {
          return null;
        },
      },
      providerProbes: {
        async runConnectivity(input: { deploymentId: string }) {
          calls.push(`connectivity:${input.deploymentId}`);
          return {
            probeKind: 'connectivity' as const,
            outcome: 'passed' as const,
            observedAt: '2026-07-20T00:00:01.000Z',
            evidenceRef: 'connectivity://deployment-a/run-1',
          };
        },
        async runConformance(input: { deploymentId: string }) {
          calls.push(`conformance:${input.deploymentId}`);
          return {
            probeKind: 'conformance' as const,
            outcome: 'passed' as const,
            observedAt: '2026-07-20T00:00:02.000Z',
            evidenceRef: 'conformance://deployment-a/run-1',
          };
        },
      },
      modelControlPlane: {
        async runActivationProbe() {
          throw new Error('generic activation probe must not receive both actions');
        },
      },
    } as never);

    const execute = async (
      action: 'connectivity_probe' | 'conformance_probe',
      idempotencyKey: string,
    ) => {
      const request = {
        action,
        context,
        target: { resourceType: 'deployment', resourceId: 'deployment-a' },
        reason: `run ${action} against provider`,
        expectedRevisionId: null,
        idempotencyKey,
        parameters: {
          deploymentId: 'deployment-a',
          operation: 'copy.generate',
          probeKind:
            action === 'connectivity_probe'
              ? ('connectivity' as const)
              : ('conformance' as const),
        },
      } as const;
      const preview = await domain.preview(request);
      return domain.execute({
        request,
        preview,
        audit: audit as never,
        idempotency: {
          workspaceId: context.workspaceId,
          key: idempotencyKey,
          payloadHash: idempotencyKey,
        },
      });
    };

    const connectivity = await execute('connectivity_probe', 'connectivity-1');
    const conformance = await execute('conformance_probe', 'conformance-1');
    assert.deepEqual(calls, [
      'connectivity:deployment-a',
      'conformance:deployment-a',
    ]);
    assert.equal(
      (connectivity.value as { probeKind: string }).probeKind,
      'connectivity',
    );
    assert.equal(
      (conformance.value as { probeKind: string }).probeKind,
      'conformance',
    );
  });

  it('refreshes health, balance, and quota through the operational evidence port', async () => {
    let refreshCalls = 0;
    const domain = new ProductionAdminSupplyDomain({
      registry: {
        async getCurrentRegistryRevision() {
          return null;
        },
      },
      operationalEvidence: {
        async refresh(input: { targetId: string }) {
          refreshCalls += 1;
          assert.equal(input.targetId, 'deployment-a');
          return {
            evidenceSource: 'live_provider' as const,
            observedAt: '2026-07-20T00:00:03.000Z',
            evidenceRef: 'operational://deployment-a/run-1',
            health: { status: 'known' as const, state: 'healthy' as const },
            balance: {
              status: 'known' as const,
              amount: 42,
              currency: 'USD' as const,
            },
            quota: {
              status: 'known' as const,
              remaining: 7,
              unit: 'requests',
            },
          };
        },
      },
      planning: {
        health: {
          async get() {
            throw new Error('health refresh must not return the stale overlay');
          },
        },
      },
    } as never);
    const request = {
      action: 'health_refresh',
      context,
      target: { resourceType: 'deployment', resourceId: 'deployment-a' },
      reason: 'refresh live provider operational evidence',
      expectedRevisionId: null,
      idempotencyKey: 'health-refresh-1',
    } as const;
    const preview = await domain.preview(request);
    const result = await domain.execute({
      request,
      preview,
      audit: audit as never,
      idempotency: {
        workspaceId: context.workspaceId,
        key: request.idempotencyKey,
        payloadHash: request.idempotencyKey,
      },
    });

    assert.equal(refreshCalls, 1);
    assert.deepEqual(result.value, {
      evidenceSource: 'live_provider',
      observedAt: '2026-07-20T00:00:03.000Z',
      evidenceRef: 'operational://deployment-a/run-1',
      health: { status: 'known', state: 'healthy' },
      balance: { status: 'known', amount: 42, currency: 'USD' },
      quota: { status: 'known', remaining: 7, unit: 'requests' },
    });
  });

  it('fails connectivity closed and reports unavailable operational evidence as unknown', async () => {
    const domain = new ProductionAdminSupplyDomain({
      clock: () => new Date('2026-07-20T00:00:04.000Z'),
      registry: {
        async getCurrentRegistryRevision() {
          return null;
        },
      },
    } as never);
    const connectivityRequest = {
      action: 'connectivity_probe',
      context,
      target: { resourceType: 'deployment', resourceId: 'deployment-a' },
      reason: 'run unavailable connectivity probe',
      expectedRevisionId: null,
      idempotencyKey: 'connectivity-unavailable-1',
      parameters: {
        deploymentId: 'deployment-a',
        operation: 'copy.generate',
        probeKind: 'connectivity',
      },
    } as const;
    const connectivityPreview = await domain.preview(connectivityRequest);
    await assert.rejects(
      domain.execute({
        request: connectivityRequest,
        preview: connectivityPreview,
        audit: audit as never,
        idempotency: {
          workspaceId: context.workspaceId,
          key: connectivityRequest.idempotencyKey,
          payloadHash: connectivityRequest.idempotencyKey,
        },
      }),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'INVALID_STATE' &&
        /connectivity probe execution is unavailable/i.test(error.message),
    );

    const healthRequest = {
      action: 'health_refresh',
      context,
      target: { resourceType: 'deployment', resourceId: 'deployment-a' },
      reason: 'refresh unavailable provider evidence',
      expectedRevisionId: null,
      idempotencyKey: 'health-unavailable-1',
    } as const;
    const healthPreview = await domain.preview(healthRequest);
    const health = await domain.execute({
      request: healthRequest,
      preview: healthPreview,
      audit: audit as never,
      idempotency: {
        workspaceId: context.workspaceId,
        key: healthRequest.idempotencyKey,
        payloadHash: healthRequest.idempotencyKey,
      },
    });
    assert.deepEqual(health.value, {
      evidenceSource: 'unavailable',
      observedAt: '2026-07-20T00:00:04.000Z',
      evidenceRef: null,
      health: {
        status: 'unknown',
        reason: 'provider_operational_evidence_refresh_unavailable',
      },
      balance: {
        status: 'unknown',
        reason: 'provider_operational_evidence_refresh_unavailable',
      },
      quota: {
        status: 'unknown',
        reason: 'provider_operational_evidence_refresh_unavailable',
      },
    });
  });

  it('uses the activation smoke only for conformance and labels its evidence honestly', async () => {
    let activationCalls = 0;
    const domain = new ProductionAdminSupplyDomain({
      registry: {
        async getCurrentRegistryRevision() {
          return null;
        },
      },
      modelControlPlane: {
        async runActivationProbe() {
          activationCalls += 1;
          return {
            id: 'activation-probe-conformance-a',
            outcome: 'passed' as const,
            createdAt: '2026-07-20T00:00:05.000Z',
          };
        },
      },
    } as never);
    const request = {
      action: 'conformance_probe',
      context,
      target: { resourceType: 'deployment', resourceId: 'deployment-a' },
      reason: 'run provider conformance smoke',
      expectedRevisionId: null,
      idempotencyKey: 'conformance-default-1',
      parameters: {
        deploymentId: 'deployment-a',
        operation: 'copy.generate',
        probeKind: 'conformance',
      },
    } as const;
    const preview = await domain.preview(request);
    const result = await domain.execute({
      request,
      preview,
      audit: audit as never,
      idempotency: {
        workspaceId: context.workspaceId,
        key: request.idempotencyKey,
        payloadHash: request.idempotencyKey,
      },
    });
    assert.equal(activationCalls, 1);
    assert.deepEqual(result.value, {
      probeKind: 'conformance',
      outcome: 'passed',
      observedAt: '2026-07-20T00:00:05.000Z',
      evidenceRef: 'activation-probe-conformance-a',
    });
  });

  it('never promotes recorded operational fixtures as refreshed provider evidence', async () => {
    const domain = new ProductionAdminSupplyDomain({
      clock: () => new Date('2026-07-20T00:00:06.000Z'),
      registry: {
        async getCurrentRegistryRevision() {
          return null;
        },
      },
      operationalEvidence: {
        async refresh() {
          return {
            evidenceSource: 'recorded_fixture',
            observedAt: '2026-07-20T00:00:05.000Z',
            evidenceRef: 'fixture://operational/deployment-a',
            health: { status: 'known', state: 'healthy' },
            balance: { status: 'known', amount: 999, currency: 'USD' },
            quota: { status: 'known', remaining: 999, unit: 'requests' },
          };
        },
      },
    } as never);
    const request = {
      action: 'health_refresh',
      context,
      target: { resourceType: 'deployment', resourceId: 'deployment-a' },
      reason: 'reject recorded provider evidence',
      expectedRevisionId: null,
      idempotencyKey: 'health-recorded-fixture-1',
    } as const;
    const preview = await domain.preview(request);
    const result = await domain.execute({
      request,
      preview,
      audit: audit as never,
      idempotency: {
        workspaceId: context.workspaceId,
        key: request.idempotencyKey,
        payloadHash: request.idempotencyKey,
      },
    });
    assert.deepEqual(result.value, {
      evidenceSource: 'unavailable',
      observedAt: '2026-07-20T00:00:06.000Z',
      evidenceRef: null,
      health: {
        status: 'unknown',
        reason: 'provider_operational_evidence_invalid',
      },
      balance: {
        status: 'unknown',
        reason: 'provider_operational_evidence_invalid',
      },
      quota: {
        status: 'unknown',
        reason: 'provider_operational_evidence_invalid',
      },
    });
  });
});

describe('ProductionAdminSupplyDomain RoutePolicy candidate validation', () => {
  it('passes the requested candidate revision to the route simulator', async () => {
    const candidateRevisionId = 'route-policy-candidate-r8';
    let receivedRevisionId: string | undefined;
    const decisionExplanation = buildRouteDecisionExplanation({
      surface: 'simulator',
      requestedDataClasses: [],
      hardFilterPassedDeploymentIds: ['deployment-a'],
      hardFilterExcluded: [],
      acceptanceBranch: {
        acceptance: 'not_attempted',
        decision: 'complete',
        reason: 'candidate_validated',
      },
    });
    const domain = new ProductionAdminSupplyDomain({
      registry: {
        async getCurrentRegistryRevision() {
          return null;
        },
      },
      planning: {
        async getRoutePolicyRevision() {
          return {
            id: candidateRevisionId,
            revisionId: candidateRevisionId,
            operation: 'copy.generate',
            qualityTier: 'quality',
            hardConstraints: ['deployment_active'],
            candidateDeploymentIds: ['deployment-a'],
            maxAttempts: 1,
            fallbackAuthorized: false,
          };
        },
      },
      modelControlPlane: {
        async simulateRoute(
          _context: unknown,
          input: { routePolicyRevisionId?: string },
        ) {
          receivedRevisionId = input.routePolicyRevisionId;
          return {
            decisionExplanation,
            routePolicyRevisionId: input.routePolicyRevisionId ?? null,
          };
        },
      },
    } as never);

    const preview = await domain.preview({
      action: 'candidate_config_validate',
      context: {
        workspaceId: 'workspace-a',
        userId: 'admin-a',
        correlationId: 'corr-candidate-r8',
        actor: 'admin',
      },
      target: {
        resourceType: 'route_policy',
        resourceId: candidateRevisionId,
      },
      reason: 'validate candidate revision before publication',
      expectedRevisionId: null,
      idempotencyKey: 'validate-candidate-r8',
      parameters: {
        routePolicyRevisionId: candidateRevisionId,
        operation: 'copy.generate',
        selection: {
          mode: 'auto',
          profile: 'quality',
          fallbackConsent: true,
        },
        dataClass: [],
        failureScenario: 'success',
        unavailableDeploymentIds: [],
      },
    });

    assert.equal(receivedRevisionId, candidateRevisionId);
    assert.equal(
      (preview.after as { routePolicyRevisionId: string }).routePolicyRevisionId,
      candidateRevisionId,
    );
  });
});

describe('Postgres admin supply run projection', () => {
  it('preserves the complete task-audit explanation frozen on the real run', async () => {
    const decisionExplanation = buildRouteDecisionExplanation({
      surface: 'task_audit',
      requestedDataClasses: ['contains_face'],
      hardFilterPassedDeploymentIds: ['deployment-a'],
      hardFilterExcluded: [
        { deploymentId: 'deployment-b', reasons: ['data_class_disallowed'] },
      ],
      liveExclusions: [
        { deploymentId: 'deployment-c', reasons: ['health_overlay_blocking'] },
      ],
      acceptanceBranch: {
        acceptance: 'accepted',
        decision: 'safe_auto_fallback',
        reason: 'provider_completed_after_safe_fallback',
        primaryDeploymentId: 'deployment-b',
        fallbackDeploymentId: 'deployment-a',
      },
    });
    const runs = await projectPostgresSupplyRuns(
      'workspace-a',
      {
        async listJobs() {
          return {
            items: [
              {
              jobId: 'job-a',
              endedAt: '2026-07-20T00:00:01.250Z',
              latencyMs: 1_250,
              operation: 'copy.generate',
              status: 'completed',
              snapshot: {
                routePolicyRevisionId: 'route-policy-r9',
                policyRevision: 'route-policy-r9',
                dataClass: ['contains_face'],
                decisionExplanation,
                supplyPoolId: 'pool-a',
              },
              attempt: {
                id: 'attempt-a',
                catalogModelId: 'model-a',
                deploymentId: 'deployment-a',
                createdAt: '2026-07-20T00:00:00.000Z',
              },
              attempts: [{ id: 'attempt-a' }],
              providerCost: { amount: 0.02, currency: 'USD' },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            facets: {
              operations: ['copy.generate'],
              statuses: ['succeeded'],
              modalities: ['llm'],
              dataClasses: ['contains_face'],
            },
          };
        },
      } as never,
      {
        async getCurrentRegistryRevision() {
          return null;
        },
      } as never,
    );

    assert.equal(runs.rows[0]?.routePolicyRevisionId, 'route-policy-r9');
    assert.equal(runs.rows[0]?.poolId, 'pool-a');
    assert.equal(runs.rows[0]?.endedAt, '2026-07-20T00:00:01.250Z');
    assert.equal(runs.rows[0]?.latencyMs, 1_250);
    assert.deepEqual(runs.rows[0]?.decisionExplanation, decisionExplanation);
    assert.notEqual(runs.rows[0]?.decisionExplanation, decisionExplanation);
  });
});

describe('ProductionAdminSupplyDomain RoutePolicy candidate save', () => {
  it('persists a new immutable candidate without moving the published head', async () => {
    const current: RoutePolicyRevision = {
      id: 'route-image-generate',
      revisionId: 'route-image-generate:r2',
      operation: 'image.generate',
      qualityTier: 'quality',
      hardConstraints: ['deployment_active'],
      candidateDeploymentIds: ['deployment-a'],
      maxAttempts: 1,
      fallbackAuthorized: false,
    };
    const candidate: RoutePolicyRevision = {
      ...current,
      revisionId: 'route-image-generate:r3',
      candidateDeploymentIds: ['deployment-a', 'deployment-b'],
    };
    const saved: unknown[] = [];
    const domain = new ProductionAdminSupplyDomain({
      registry: {
        async getCurrentRegistryRevision() {
          return null;
        },
      },
      planning: {
        async listPublishedRoutePolicies() {
          return [current];
        },
        async getRoutePolicyRevision(
          _workspaceId: string,
          revisionId: string,
        ) {
          return revisionId === current.revisionId ? current : null;
        },
        async saveRoutePolicyCandidate(workspaceId: string, revision: unknown) {
          saved.push({ workspaceId, revision });
        },
      },
    } as never);
    const request = {
      action: 'candidate_config_save',
      context: {
        workspaceId: 'workspace-a',
        userId: 'admin-a',
        correlationId: 'corr-candidate-save-r3',
        actor: 'admin',
      },
      target: {
        resourceType: 'route_policy',
        resourceId: current.revisionId,
      },
      reason: 'save reviewed route policy candidate',
      expectedRevisionId: current.revisionId,
      idempotencyKey: 'save-candidate-r3',
      parameters: { candidate },
    } satisfies AdminSupplyGovernedActionRequest;

    const preview = await domain.preview(request);
    assert.deepEqual(preview.before, current);
    assert.deepEqual(preview.after, candidate);
    const result = await domain.execute({
      request,
      preview,
      audit: {
        actor: { userId: 'admin-a', role: 'admin' },
        permission: 'platform.manage',
        target: {
          kind: 'command',
          module: 'model-supply',
          action: 'candidate_config_save',
          resourceId: current.revisionId,
          resourceType: 'route_policy',
        },
        reason: request.reason,
        before: current,
        after: candidate,
        correlationId: request.context.correlationId,
        occurredAt: '2026-07-20T00:00:00.000Z',
      },
      idempotency: {
        workspaceId: 'workspace-a',
        key: request.idempotencyKey,
        payloadHash: 'payload-save-r3',
      },
    });

    assert.deepEqual(saved, [{ workspaceId: 'workspace-a', revision: candidate }]);
    assert.deepEqual(result.value, candidate);
  });
});

describe('PostgresAdminSupplyStore', { skip: !databaseUrl }, () => {
  it('persists terminal success/rejection and never re-executes the same identity', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `admin-supply-${randomUUID()}`;
    try {
      const client = await pool.connect();
      try {
        await new PostgresAdminSupplyMigration().migrate(client);
      } finally {
        client.release();
      }
      const store = new PostgresAdminSupplyStore(pool);
      let executions = 0;
      const success = await store.executeIdempotent({
        workspaceId,
        idempotencyKey: 'isolate-channel-a',
        payloadHash: 'payload-a',
        execute: async () => {
          executions += 1;
          return {
            action: 'isolate',
            target: { resourceType: 'channel', resourceId: 'channel-a' },
            value: { mode: 'isolated' },
            audit: {
              actor: { userId: 'admin-a', role: 'admin' },
              permission: 'channel.lifecycle.manage',
              target: {
                kind: 'command',
                module: 'model-supply',
                action: 'isolate_channel',
                resourceId: 'channel-a',
                resourceType: 'channel',
              },
              reason: 'provider error rate exceeded threshold',
              before: { mode: 'accepting' },
              after: { mode: 'isolated' },
              correlationId: 'corr-a',
              occurredAt: '2026-07-20T00:00:00.000Z',
            },
          };
        },
      });
      const replay = await store.executeIdempotent({
        workspaceId,
        idempotencyKey: 'isolate-channel-a',
        payloadHash: 'payload-a',
        execute: async () => {
          executions += 1;
          throw new Error('must not execute');
        },
      });

      assert.equal(success.replayed, false);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.value, success.value);
      assert.equal(executions, 1);
      const recentChanges = await store.listRecentSupplyChanges(workspaceId);
      assert.equal(recentChanges.length, 1);
      assert.equal(
        recentChanges[0]?.summary,
        'provider error rate exceeded threshold',
      );

      await assert.rejects(
        store.executeIdempotent({
          workspaceId,
          idempotencyKey: 'isolate-channel-a',
          payloadHash: 'payload-b',
          execute: async () => success.value,
        }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );

      let rejectedExecutions = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(
          store.executeIdempotent({
            workspaceId,
            idempotencyKey: 'rejected-action',
            payloadHash: 'rejected-payload',
            execute: async () => {
              rejectedExecutions += 1;
              throw new P1DomainError('INVALID_STATE', 'domain rejected');
            },
          }),
          (error: unknown) =>
            error instanceof P1DomainError &&
            error.code === 'INVALID_STATE' &&
            error.message === 'domain rejected',
        );
      }
      assert.equal(rejectedExecutions, 1);
    } finally {
      await pool.query(
        'DELETE FROM p1_admin_supply_idempotency WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_admin_supply_actions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    }
  });

  it('leaves an executed action pending when completion or audit persistence fails', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `admin-supply-complete-failure-${randomUUID()}`;
    try {
      const client = await pool.connect();
      try {
        await new PostgresAdminSupplyMigration().migrate(client);
      } finally {
        client.release();
      }
      const store = new PostgresAdminSupplyStore(pool);
      let executions = 0;
      const execute = async () => {
        executions += 1;
        return {
          action: 'isolate',
          target: { resourceType: 'channel', resourceId: 'channel-a' },
          value: { mode: 'isolated' },
          audit: {
            actor: { userId: 'admin-a', role: 'admin' },
            permission: 'channel.lifecycle.manage',
            target: {
              kind: 'command',
              module: 'model-supply',
              action: 'isolate_channel',
              resourceId: 'channel-a',
              resourceType: 'channel',
            },
            reason: 'force audit persistence failure after domain success',
            before: { mode: 'accepting' },
            after: { mode: 'isolated' },
            correlationId: 'corr-a',
            occurredAt: 'not-a-postgres-timestamp',
          },
        };
      };

      await assert.rejects(
        store.executeIdempotent({
          workspaceId,
          idempotencyKey: 'complete-failure',
          payloadHash: 'payload-complete-failure',
          execute,
        }),
        /timestamp|date\/time field value/i,
      );
      const status = await pool.query<{ status: string }>(
        `SELECT status FROM p1_admin_supply_idempotency
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, 'complete-failure'],
      );
      assert.equal(status.rows[0]?.status, 'pending');
      const actions = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM p1_admin_supply_actions
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, 'complete-failure'],
      );
      assert.equal(actions.rows[0]?.count, '0');
      const pending = await store.listPendingExecutions(workspaceId);
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.idempotencyKey, 'complete-failure');
      assert.equal(pending[0]?.payloadHash, 'payload-complete-failure');
      assert.equal(pending[0]?.outcome, 'recorded');
      assert.match(pending[0]?.createdAt ?? '', /^\d{4}-/u);
      assert.match(pending[0]?.executedAt ?? '', /^\d{4}-/u);

      await assert.rejects(
        store.executeIdempotent({
          workspaceId,
          idempotencyKey: 'complete-failure',
          payloadHash: 'payload-complete-failure',
          execute,
        }),
        /unresolved pending execution/i,
      );
      assert.equal(executions, 1);
    } finally {
      await pool.query(
        'DELETE FROM p1_admin_supply_actions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_admin_supply_idempotency WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    }
  });

  it('reconciles a recorded pending result without repeating the domain side effect', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `admin-supply-reconcile-${randomUUID()}`;
    const suffix = randomUUID().replaceAll('-', '');
    const triggerName = `p1_test_admin_supply_audit_${suffix}`;
    const functionName = `p1_test_admin_supply_audit_${suffix}`;
    try {
      const client = await pool.connect();
      try {
        await new PostgresAdminSupplyMigration().migrate(client);
      } finally {
        client.release();
      }
      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          IF NEW.workspace_id = '${workspaceId}' THEN
            RAISE EXCEPTION 'forced transient admin supply audit failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER ${triggerName}
          BEFORE INSERT ON p1_admin_supply_actions
          FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `);
      const store = new PostgresAdminSupplyStore(pool);
      let executions = 0;
      const execute = async () => {
        executions += 1;
        return {
          action: 'isolate',
          target: { resourceType: 'channel', resourceId: 'channel-a' },
          value: { mode: 'isolated' },
          audit: {
            actor: { userId: 'admin-a', role: 'admin' },
            permission: 'channel.lifecycle.manage',
            target: {
              kind: 'command',
              module: 'model-supply',
              action: 'isolate_channel',
              resourceId: 'channel-a',
              resourceType: 'channel',
            },
            reason: 'reconcile audit after transient persistence failure',
            before: { mode: 'accepting' },
            after: { mode: 'isolated' },
            correlationId: 'corr-reconcile-a',
            occurredAt: '2026-07-20T00:00:00.000Z',
          },
        };
      };

      await assert.rejects(
        store.executeIdempotent({
          workspaceId,
          idempotencyKey: 'reconcile-pending',
          payloadHash: 'payload-reconcile-pending',
          execute,
        }),
        /forced transient admin supply audit failure/i,
      );
      assert.equal(executions, 1);
      assert.equal(
        (await store.listPendingExecutions(workspaceId))[0]?.outcome,
        'recorded',
      );

      await pool.query(`DROP TRIGGER ${triggerName} ON p1_admin_supply_actions`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
      const reconciled = await store.reconcilePendingExecution({
        workspaceId,
        idempotencyKey: 'reconcile-pending',
        payloadHash: 'payload-reconcile-pending',
      });
      assert.equal(reconciled.replayed, false);
      assert.equal(reconciled.value.action, 'isolate');
      assert.deepEqual(await store.listPendingExecutions(workspaceId), []);

      const replay = await store.executeIdempotent({
        workspaceId,
        idempotencyKey: 'reconcile-pending',
        payloadHash: 'payload-reconcile-pending',
        execute,
      });
      assert.equal(replay.replayed, true);
      assert.equal(executions, 1);
      const actions = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM p1_admin_supply_actions
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, 'reconcile-pending'],
      );
      assert.equal(actions.rows[0]?.count, '1');
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON p1_admin_supply_actions`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await pool.query(
        'DELETE FROM p1_admin_supply_actions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_admin_supply_idempotency WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    }
  });

  it('keeps an unknown pending outcome fail-closed for domain-specific recovery', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `admin-supply-unknown-${randomUUID()}`;
    try {
      const client = await pool.connect();
      try {
        await new PostgresAdminSupplyMigration().migrate(client);
      } finally {
        client.release();
      }
      await pool.query(
        `INSERT INTO p1_admin_supply_idempotency
           (workspace_id, idempotency_key, payload_hash, status)
         VALUES ($1, $2, $3, 'pending')`,
        [workspaceId, 'unknown-pending', 'payload-unknown-pending'],
      );
      const store = new PostgresAdminSupplyStore(pool);

      assert.equal(
        (await store.listPendingExecutions(workspaceId))[0]?.outcome,
        'outcome_unknown',
      );
      await assert.rejects(
        store.reconcilePendingExecution({
          workspaceId,
          idempotencyKey: 'unknown-pending',
          payloadHash: 'payload-unknown-pending',
        }),
        /outcome is unknown|domain-specific recovery/i,
      );
      assert.equal(
        (await store.listPendingExecutions(workspaceId))[0]?.outcome,
        'outcome_unknown',
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_admin_supply_idempotency WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    }
  });

  it('recovers a persisted candidate outcome when result recording fails without repeating the save', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `admin-supply-recovery-context-${randomUUID()}`;
    const suffix = randomUUID().replaceAll('-', '');
    const triggerName = `p1_test_admin_supply_result_${suffix}`;
    const functionName = `p1_test_admin_supply_result_${suffix}`;
    const current: RoutePolicyRevision = {
      id: 'route-image-generate',
      operation: 'image.generate',
      qualityTier: 'quality',
      hardConstraints: ['deployment_active'],
      candidateDeploymentIds: ['deployment-a'],
      maxAttempts: 1,
      fallbackAuthorized: false,
      revisionId: 'route-image-generate:r2',
    };
    const candidate: RoutePolicyRevision = {
      ...current,
      candidateDeploymentIds: ['deployment-a', 'deployment-b'],
      revisionId: 'route-image-generate:r3',
    };
    try {
      const client = await pool.connect();
      try {
        await new PostgresSupplyPlanningMigration().migrate(client);
        await new PostgresAdminSupplyMigration().migrate(client);
      } finally {
        client.release();
      }
      const durablePlanning = new PostgresSupplyPlanningControlPlane(pool);
      await durablePlanning.publishRoutePolicy(workspaceId, current, null);
      let saves = 0;
      const planning = {
        listPublishedRoutePolicies: (scopeId: string) =>
          durablePlanning.listPublishedRoutePolicies(scopeId),
        getRoutePolicyRevision: (scopeId: string, revisionId: string) =>
          durablePlanning.getRoutePolicyRevision(scopeId, revisionId),
        async saveRoutePolicyCandidate(
          scopeId: string,
          revision: typeof candidate,
        ) {
          saves += 1;
          await durablePlanning.saveRoutePolicyCandidate(scopeId, revision);
        },
      };
      const domain = new ProductionAdminSupplyDomain({
        registry: {
          async getCurrentRegistryRevision() {
            return null;
          },
        },
        planning,
      } as never);
      const store = new PostgresAdminSupplyStore(pool);
      const control = new AdminSupplyControlPlane({
        snapshot: {} as never,
        permission: createPermissionAuthorizer(),
        idempotency: store,
        governed: {
          routes: domain,
          channels: domain,
          credentials: domain,
          health: domain,
        },
        clock: () => new Date('2026-07-20T00:00:00.000Z'),
      });
      const context = {
        workspaceId,
        userId: 'admin-a',
        correlationId: 'corr-candidate-recovery-r3',
        actor: 'admin' as const,
      };
      const request = {
        action: 'candidate_config_save' as const,
        context,
        target: {
          resourceType: 'route_policy' as const,
          resourceId: current.revisionId,
        },
        reason: 'save candidate with recoverable outcome evidence',
        expectedRevisionId: current.revisionId,
        idempotencyKey: 'candidate-save-recovery-r3',
        parameters: { candidate },
      };
      const preview = await control.previewAction(request);
      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          IF NEW.workspace_id = '${workspaceId}'
             AND OLD.result IS NULL AND NEW.result IS NOT NULL THEN
            RAISE EXCEPTION 'forced admin supply result persistence failure';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER ${triggerName}
          BEFORE UPDATE ON p1_admin_supply_idempotency
          FOR EACH ROW EXECUTE FUNCTION ${functionName}();
      `);

      await assert.rejects(
        control.dispatchAction({ ...request, approvedPreviewId: preview.id }),
        /forced admin supply result persistence failure/i,
      );
      assert.equal(saves, 1);
      assert.deepEqual(
        await durablePlanning.getRoutePolicyRevision(
          workspaceId,
          candidate.revisionId,
        ),
        candidate,
      );
      const pending = await control.listPendingActions(context);
      assert.equal(pending[0]?.outcome, 'recoverable');

      await pool.query(
        `DROP TRIGGER ${triggerName} ON p1_admin_supply_idempotency`,
      );
      await pool.query(`DROP FUNCTION ${functionName}()`);
      const reconciled = await control.reconcilePendingAction(context, {
        idempotencyKey: request.idempotencyKey,
        payloadHash: pending[0]!.payloadHash,
      });
      assert.equal(reconciled.replayed, false);
      assert.equal(
        (reconciled.value as { action: string }).action,
        'candidate_config_save',
      );
      assert.equal(saves, 1);
      assert.deepEqual(await control.listPendingActions(context), []);
      assert.equal(
        (await store.listRecentSupplyChanges(workspaceId))[0]?.correlationId,
        context.correlationId,
      );
      const replay = await control.dispatchAction({
        ...request,
        approvedPreviewId: preview.id,
      });
      assert.equal(replay.replayed, true);
      assert.equal(saves, 1);
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS ${triggerName} ON p1_admin_supply_idempotency`,
      );
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await pool.query(
        'DELETE FROM p1_admin_supply_actions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_admin_supply_idempotency WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_route_policy_publications WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_route_policy_heads WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_supply_route_policy_revisions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    }
  });

  it('binds a one-time secure-write receipt to the next secret and consumes it with the credential CAS', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `credential-receipt-${randomUUID()}`;
    const accountId = 'credential-ark';
    const secrets = new FakeKmsSecretStore();
    const repository = new PostgresSupplyControlPlaneRepository(pool);
    const verifySecret = async (input: {
      workspaceId: string;
      credentialId: string;
      provider: CredentialAccount['provider'];
      secretReference: string;
      secretVersion: number;
    }) => {
      await secrets.use(input.secretReference, {
        workspaceId: input.workspaceId,
        credentialId: input.credentialId,
        provider: input.provider,
        version: input.secretVersion,
      });
    };
    const receipts = new PostgresCredentialRotationReceiptStore(
      pool,
      verifySecret,
    );
    const now = '2026-07-20T00:00:00.000Z';
    const initial: CredentialAccount = {
      id: accountId,
      label: 'Ark primary',
      providerProfileId: 'provider-ark',
      type: 'api_key',
      scope: 'platform',
      secretReference: `kms://${workspaceId}/ark-credential/v1`,
      version: '1',
      status: 'active',
      drainSubstate: 'none',
      source: 'registry',
      connectionId: 'integration-ark',
      workspaceId,
      provider: 'model',
      credentialId: 'ark-credential',
      secretVersion: 1,
      versionHistory: [
        {
          version: '1',
          secretReference: `kms://${workspaceId}/ark-credential/v1`,
          secretVersion: 1,
          createdAt: now,
          source: 'registry',
          mask: '••••••••',
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    try {
      const client = await pool.connect();
      try {
        await repository.migrate(client);
        await new PostgresAdminSupplyMigration().migrate(client);
      } finally {
        client.release();
      }
      await secrets.put(
        {
          workspaceId,
          credentialId: initial.credentialId,
          provider: initial.provider,
          version: 1,
        },
        'old-secret',
      );
      await repository.saveCredentialAccount(workspaceId, initial, null);
      const nextSecretReference = await secrets.put(
        {
          workspaceId,
          credentialId: initial.credentialId,
          provider: initial.provider,
          version: 2,
        },
        'new-secret-never-persisted-in-postgres',
      );

      const receipt = await receipts.issue({
        workspaceId,
        accountId,
        secretReference: nextSecretReference,
        expiresAt: '2026-07-20T00:10:00.000Z',
        now,
      });
      assert.equal(receipt.accountId, accountId);
      assert.equal(receipt.nextSecretVersion, 2);
      assert.equal('secretReference' in receipt, false);
      const competingReceipt = await receipts.issue({
        workspaceId,
        accountId,
        secretReference: nextSecretReference,
        expiresAt: '2026-07-20T00:10:00.000Z',
        now,
      });
      await assert.rejects(
        receipts.consumeAndRotate({
          workspaceId: `${workspaceId}-other`,
          accountId,
          receiptId: receipt.id,
          expectedAccountVersion: '1',
          now: '2026-07-20T00:00:30.000Z',
        }),
        (error: unknown) =>
          error instanceof P1DomainError && error.code === 'NOT_FOUND',
      );

      const nextSecretContext = {
        workspaceId,
        credentialId: initial.credentialId,
        provider: initial.provider,
        version: 2,
      } as const;
      await secrets.revoke(nextSecretReference, nextSecretContext);
      await assert.rejects(
        receipts.consumeAndRotate({
          workspaceId,
          accountId,
          receiptId: receipt.id,
          expectedAccountVersion: '1',
          now: '2026-07-20T00:01:00.000Z',
        }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'INVALID_STATE' &&
          /unavailable/i.test(error.message),
      );
      assert.equal(
        (
          await repository.getCredentialAccount(workspaceId, accountId)
        )?.account.secretVersion,
        1,
      );
      const unconsumed = await pool.query<{ consumed_at: Date | null }>(
        `SELECT consumed_at
           FROM p1_admin_supply_secure_write_receipts
          WHERE receipt_id = $1`,
        [receipt.id],
      );
      assert.equal(unconsumed.rows[0]?.consumed_at, null);
      await secrets.put(
        nextSecretContext,
        'new-secret-never-persisted-in-postgres',
      );

      const rotated = await receipts.consumeAndRotate({
        workspaceId,
        accountId,
        receiptId: receipt.id,
        expectedAccountVersion: '1',
        now: '2026-07-20T00:01:00.000Z',
      });
      assert.equal(rotated.secretVersion, 2);
      assert.equal(rotated.secretReference, nextSecretReference);
      assert.equal(rotated.versionHistory.length, 2);

      const persisted = await repository.getCredentialAccount(
        workspaceId,
        accountId,
      );
      assert.equal(persisted?.account.secretVersion, 2);
      assert.equal(persisted?.recordRevision, 2);
      const storedReceipt = await pool.query<{
        consumed_at: Date | null;
        secret_reference: string;
      }>(
        `SELECT consumed_at, secret_reference
           FROM p1_admin_supply_secure_write_receipts
          WHERE receipt_id = $1`,
        [receipt.id],
      );
      assert.ok(storedReceipt.rows[0]?.consumed_at);
      assert.equal(
        storedReceipt.rows[0]?.secret_reference,
        nextSecretReference,
      );

      await assert.rejects(
        receipts.consumeAndRotate({
          workspaceId,
          accountId,
          receiptId: competingReceipt.id,
          expectedAccountVersion: '1',
          now: '2026-07-20T00:01:30.000Z',
        }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT' &&
          /changed/i.test(error.message),
      );

      await assert.rejects(
        receipts.consumeAndRotate({
          workspaceId,
          accountId,
          receiptId: receipt.id,
          expectedAccountVersion: '1',
          now: '2026-07-20T00:02:00.000Z',
        }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'IDEMPOTENCY_CONFLICT' &&
          /consumed/i.test(error.message),
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_admin_supply_secure_write_receipts WHERE workspace_id = $1',
        [workspaceId],
      );
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  });

  it('refuses to issue a receipt when the bound next-version secret does not exist', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `credential-receipt-missing-${randomUUID()}`;
    const accountId = 'credential-ark';
    const repository = new PostgresSupplyControlPlaneRepository(pool);
    const secrets = new FakeKmsSecretStore();
    const receipts = new PostgresCredentialRotationReceiptStore(
      pool,
      async (input) => {
        await secrets.use(input.secretReference, {
          workspaceId: input.workspaceId,
          credentialId: input.credentialId,
          provider: input.provider,
          version: input.secretVersion,
        });
      },
    );
    const now = '2026-07-20T00:00:00.000Z';
    const account: CredentialAccount = {
      id: accountId,
      label: 'Ark primary',
      providerProfileId: 'provider-ark',
      type: 'api_key',
      scope: 'platform',
      secretReference: `kms://${workspaceId}/ark-credential/v1`,
      version: '1',
      status: 'active',
      drainSubstate: 'none',
      source: 'registry',
      connectionId: 'integration-ark',
      workspaceId,
      provider: 'model',
      credentialId: 'ark-credential',
      secretVersion: 1,
      versionHistory: [],
      createdAt: now,
      updatedAt: now,
    };
    try {
      const client = await pool.connect();
      try {
        await repository.migrate(client);
        await new PostgresAdminSupplyMigration().migrate(client);
      } finally {
        client.release();
      }
      await repository.saveCredentialAccount(workspaceId, account, null);
      await assert.rejects(
        receipts.issue({
          workspaceId,
          accountId,
          secretReference: `kms://${workspaceId}/ark-credential/v2`,
          expiresAt: '2026-07-20T00:10:00.000Z',
          now,
        }),
        (error: unknown) =>
          error instanceof P1DomainError &&
          error.code === 'INVALID_STATE' &&
          /unavailable/i.test(error.message),
      );
      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_admin_supply_secure_write_receipts
          WHERE workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(count.rows[0]?.count, '0');
    } finally {
      await pool.query(
        'DELETE FROM p1_admin_supply_secure_write_receipts WHERE workspace_id = $1',
        [workspaceId],
      );
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  });
});
