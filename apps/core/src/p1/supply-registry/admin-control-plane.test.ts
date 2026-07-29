import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  HealthOverlayPort,
  RoutePolicyRevision,
  SupplierPriceRevision,
  SupplyPool,
} from '@meiye/contracts';
import { createPermissionAuthorizer } from '../capability-permission/authorizer.js';
import type { PermissionAuditProjection } from '../capability-permission/audit.js';
import type { CredentialAccount } from './credential-account.js';
import type { ExpandedSupplyRegistrySnapshot } from './expand.js';
import { buildRouteDecisionExplanation } from './route-explanation.js';
import {
  AdminSupplyControlPlane,
  type AdminSupplyGovernedActionRequest,
  type AdminSupplyGovernedDomainPort,
  type AdminSupplyGovernedPorts,
  type AdminSupplyIdempotencyPort,
  type GovernedSupplyActionExecution,
  type GovernedSupplyImpactPreview,
  type SupplyControlSnapshotPorts,
} from './admin-control-plane.js';

const context = {
  workspaceId: 'workspace-a',
  userId: 'admin-a',
  correlationId: 'corr-a',
  actor: 'admin' as const,
};

function registrySnapshot(): ExpandedSupplyRegistrySnapshot {
  return {
    catalogRevisionId: 'catalog-r7',
    catalogRevisionNumber: 7,
    models: [
      {
        id: 'seedream-5',
        displayName: 'Seedream 5',
        manufacturer: 'ByteDance',
        modality: 'image',
        operations: ['image.generate'],
      },
    ],
    providerProfiles: [
      {
        id: 'provider-ark',
        displayName: 'Volcengine Ark',
        counterparty: 'ByteDance',
        revisionId: 'provider-ark:r2',
      },
    ],
    executionChannels: [
      {
        id: 'channel-ark-cn',
        providerProfileId: 'provider-ark',
        kind: 'official_direct',
        region: 'domestic',
        accountOwnership: 'platform',
        revisionId: 'channel-ark-cn:r3',
      },
    ],
    deployments: [
      {
        id: 'seedream-5-ark',
        catalogModelId: 'seedream-5',
        providerProfileId: 'provider-ark',
        executionChannelId: 'channel-ark-cn',
        credentialAccountId: 'credential-ark',
        lifecycleStatus: 'active',
        revisionId: 'deployment-ark:r4',
      },
    ],
    contracts: [
      {
        id: 'contract-ark',
        providerProfileId: 'provider-ark',
        termsRevisionId: 'contract-ark:r1',
        effectiveFrom: '2026-07-01T00:00:00.000Z',
      },
    ],
    source: {
      providerProfileRevisions: [],
      executionChannelRevisions: [],
      publishedDeployments: [],
    },
  };
}

function credentialAccount(): CredentialAccount {
  return {
    id: 'credential-ark',
    label: 'Ark production',
    providerProfileId: 'provider-ark',
    type: 'api_key',
    scope: 'platform',
    secretReference: 'kms://ark/production',
    version: '4',
    status: 'active',
    drainSubstate: 'none',
    source: 'registry',
    verifiedAt: '2026-07-20T01:00:00.000Z',
    connectionId: 'platform:ark.media',
    workspaceId: 'workspace-a',
    provider: 'model',
    credentialId: 'ark-production',
    secretVersion: 4,
    versionHistory: [
      {
        version: '4',
        secretReference: 'kms://ark/production',
        secretVersion: 4,
        createdAt: '2026-07-20T01:00:00.000Z',
        source: 'registry',
        mask: '••••••••',
      },
    ],
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T01:00:00.000Z',
  };
}

function snapshotPorts(
  current: ExpandedSupplyRegistrySnapshot | null = registrySnapshot(),
): SupplyControlSnapshotPorts {
  const pool: SupplyPool = {
    id: 'pool-shared',
    kind: 'shared',
    displayName: 'Shared production',
    credentialAccountIds: ['credential-ark'],
    deploymentIds: ['seedream-5-ark'],
    revisionId: 'pool-shared:r2',
  };
  const route: RoutePolicyRevision = {
    id: 'route-image-quality',
    operation: 'image.generate',
    qualityTier: 'quality',
    hardConstraints: ['deployment_active'],
    candidateDeploymentIds: ['seedream-5-ark'],
    maxAttempts: 2,
    fallbackAuthorized: true,
    revisionId: 'route-image-quality:r5',
  };
  const price: SupplierPriceRevision = {
    id: 'price-seedream',
    deploymentId: 'seedream-5-ark',
    executionChannelId: 'channel-volcengine-ark',
    pricingTier: 'standard',
    amountMicros: 40_000,
    currency: 'CNY',
    unit: 'image',
    evidence: {
      source: 'invoice',
      observedAt: '2026-07-20T02:00:00.000Z',
    },
    revisionId: 'price-seedream:r6',
  };
  const health: HealthOverlayPort = {
    async get() {
      return null;
    },
    async list() {
      return [
        {
          targetKind: 'deployment',
          targetId: 'seedream-5-ark',
          state: 'healthy',
          reason: 'live_probe_passed',
          source: 'provider-live',
          startedAt: '2026-07-20T03:00:00.000Z',
        },
      ];
    },
    async upsert() {},
    async clear() {},
  };
  return {
    registry: {
      async getCurrentRegistryRevision(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return current;
      },
      async listCredentialAccounts(workspaceId) {
        assert.equal(workspaceId, '__global__');
        const account = credentialAccount() as CredentialAccount & {
          apiKey?: string;
        };
        account.apiKey = 'must-never-leave-domain';
        return [{ account, recordRevision: 12 }];
      },
    },
    channelLifecycle: {
      async getChannelLifecycle(channelId) {
        assert.equal(channelId, 'channel-ark-cn');
        return { lifecycleRevision: 'channel-ark-cn:lifecycle:r9' };
      },
    },
    pools: {
      async listSupplyPools(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return [pool];
      },
    },
    entitlements: {
      async listEntitlementPolicies(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return [
          {
            id: 'entitlement-policy:growth:r7',
            tier: 'growth',
            body: {
              tier: 'growth',
              allowance: { copy: 100, image: 20, video: 5, audio: 10 },
              concurrencyLimit: 7,
              queuePriority: 9,
              supportLabel: 'priority',
              rateLabel: 'elevated',
              allowedCatalogModelIds: ['seedream-5'],
              allowedQualityTiers: ['quality'],
              availableSupplyPoolIds: ['pool-shared'],
              overage: { mode: 'block' },
              validity: { validFrom: null, validUntil: null },
            },
            revision: 7,
            stage: 'published',
            actorId: 'admin-a',
            reason: 'Publish growth policy r7',
            correlationId: 'corr-entitlement-r7',
            createdAt: '2026-07-20T03:30:00.000Z',
            rolledBackToRevision: null,
          },
        ];
      },
      async listAccountAllocations(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return [
          {
            id: 'allocation-a',
            accountId: 'account-a',
            workspaceId,
            kind: 'grant',
            target: { type: 'supply_pool', supplyPoolId: 'pool-shared' },
            delta: { mode: 'set', enabled: true },
            source: 'enterprise_contract',
            reason: 'Dedicated commercial allocation',
            actorId: 'admin-a',
            startsAt: '2026-07-20T00:00:00.000Z',
            endsAt: null,
            status: 'active',
            rolledBackAt: null,
            correlationId: 'corr-allocation-a',
            createdAt: '2026-07-20T03:40:00.000Z',
          },
        ];
      },
    },
    routes: {
      async listRoutePolicyRevisions(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return [route];
      },
      async listRoutePolicyPublicationHistory(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return [route];
      },
      async listPublishedRoutePolicies(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return [route];
      },
    },
    prices: {
      async listSupplierPriceRevisions(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return [price];
      },
    },
    health,
    runs: {
      async listSupplyRuns(workspaceId, query) {
        assert.equal(workspaceId, 'workspace-a');
        assert.deepEqual(query, {
          page: 1,
          pageSize: 20,
          sort: 'startedAt',
          dir: 'desc',
        });
        const row = {
            id: 'run-1',
            taskId: 'task-1',
            operation: 'image.generate',
            modality: 'image',
            status: 'succeeded',
            catalogModelId: 'seedream-5',
            deploymentId: 'seedream-5-ark',
            providerProfileId: 'provider-ark',
            executionChannelId: 'channel-ark-cn',
            channelKind: 'official_direct',
            workspaceId,
            accountId: 'account-a',
            dataClass: 'public',
            startedAt: '2026-07-20T04:00:00.000Z',
            endedAt: '2026-07-20T04:00:01.000Z',
            latencyMs: 1_000,
            attemptCount: 1,
            lifecycle: 'terminal',
          } as const;
        return {
          query,
          total: 1,
          totalPages: 1,
          rows: [row],
          facets: {
            operations: ['image.generate'],
            statuses: ['succeeded'],
            modalities: ['image'],
            channelKinds: ['official_direct'],
            dataClasses: ['public'],
          },
        };
      },
    },
    changes: {
      async listRecentSupplyChanges(workspaceId) {
        assert.equal(workspaceId, 'workspace-a');
        return [
          {
            id: 'change-1',
            at: '2026-07-20T04:00:02.000Z',
            actorId: 'admin-a',
            action: 'catalog_publish',
            targetType: 'catalog_revision',
            targetId: 'catalog-r7',
            summary: 'Published catalog r7',
            correlationId: 'corr-publish',
          },
        ];
      },
    },
    gateways: {
      async listGatewayDeepLinks() {
        return [
          {
            id: 'gateway-ark',
            label: 'Ark console evidence',
            href: 'https://console.volcengine.com/ark',
            gatewayFingerprint: 'none',
            evidenceOnly: true,
          },
        ];
      },
    },
    featuredModels: {
      async getFeaturedCoreModelIds() {
        return { 'image.generate': 'seedream-5' };
      },
    },
  };
}

describe('AdminSupplyControlPlane snapshot', () => {
  it('composes the Web SupplyControlSnapshot from current domain ports without leaking secret material', async () => {
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(),
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts(),
      clock: () => new Date('2026-07-20T05:00:00.000Z'),
    });

    const snapshot = await control.getSnapshot(context);

    assert.equal(snapshot.catalogRevisionId, 'catalog-r7');
    assert.equal(snapshot.catalogRevisionNumber, 7);
    assert.equal(snapshot.capturedAt, '2026-07-20T05:00:00.000Z');
    assert.equal(snapshot.models[0]?.id, 'seedream-5');
    assert.equal(
      snapshot.executionChannels[0]?.lifecycleRevision,
      'channel-ark-cn:lifecycle:r9',
    );
    assert.equal(snapshot.credentials[0]?.id, 'credential-ark');
    assert.equal(snapshot.credentials[0]?.secretReference, 'kms://ark/production');
    assert.equal('apiKey' in (snapshot.credentials[0] ?? {}), false);
    assert.equal(snapshot.pools[0]?.id, 'pool-shared');
    assert.deepEqual(snapshot.entitlementPolicies[0], {
      id: 'entitlement-policy:growth:r7',
      tier: 'growth',
      revision: 7,
      stage: 'published',
      revisionId: 'entitlement-policy:growth:r7',
      concurrencyLimit: 7,
      queuePriority: 9,
      supportLabel: 'priority',
      allowanceSummary: 'audio=10, copy=100, image=20, video=5',
      publishedAt: '2026-07-20T03:30:00.000Z',
      actorId: 'admin-a',
      reason: 'Publish growth policy r7',
    });
    assert.deepEqual(snapshot.accountAllocations[0], {
      id: 'allocation-a',
      accountId: 'account-a',
      workspaceId: 'workspace-a',
      kind: 'grant',
      targetLabel: 'supply_pool:pool-shared',
      source: 'enterprise_contract',
      status: 'active',
      reason: 'Dedicated commercial allocation',
      startsAt: '2026-07-20T00:00:00.000Z',
      endsAt: null,
    });
    assert.equal(snapshot.routePolicies[0]?.revisionId, 'route-image-quality:r5');
    assert.equal(
      snapshot.routePolicyRevisions?.[0]?.revisionId,
      'route-image-quality:r5',
    );
    assert.equal(
      snapshot.routePolicyPublicationHistory?.[0]?.revisionId,
      'route-image-quality:r5',
    );
    assert.equal(snapshot.priceRevisions[0]?.evidence.source, 'invoice');
    assert.equal(snapshot.healthOverlays[0]?.state, 'healthy');
    assert.equal(snapshot.runs[0]?.taskId, 'task-1');
    assert.equal(snapshot.runPage.total, 1);
    assert.equal(snapshot.recentChanges[0]?.correlationId, 'corr-publish');
    assert.equal(snapshot.gatewayDeepLinks[0]?.evidenceOnly, true);
    assert.equal(snapshot.featuredCoreModelIds['image.generate'], 'seedream-5');
  });

  it('fails honestly when no effective registry head exists instead of falling back to a fixture', async () => {
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(null),
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts(),
    });

    await assert.rejects(
      control.getSnapshot(context),
      /effective supply registry|not found/i,
    );
  });

  it('passes the requested run page contract to the server reporter', async () => {
    const ports = snapshotPorts();
    const requested = {
      page: 2,
      pageSize: 10,
      sort: 'costMicros' as const,
      dir: 'asc' as const,
      operation: 'image.generate' as const,
      status: 'failed' as const,
    };
    ports.runs = {
      async listSupplyRuns(workspaceId, query) {
        assert.equal(workspaceId, 'workspace-a');
        assert.deepEqual(query, requested);
        return {
          query,
          total: 0,
          totalPages: 1,
          rows: [],
          facets: {
            operations: ['image.generate'],
            statuses: ['failed'],
            modalities: ['image'],
            channelKinds: ['official_direct'],
            dataClasses: ['public'],
          },
        };
      },
    };
    const control = new AdminSupplyControlPlane({
      snapshot: ports,
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts(),
    });

    const snapshot = await control.getSnapshot(context, requested);

    assert.deepEqual(snapshot.runPage.query, requested);
    assert.deepEqual(snapshot.runs, []);
  });
});

class MemoryIdempotencyPort implements AdminSupplyIdempotencyPort {
  readonly records = new Map<
    string,
    | { payloadHash: string; status: 'fulfilled'; value: unknown }
    | { payloadHash: string; status: 'rejected'; error: unknown }
  >();

  async executeIdempotent<T>(input: {
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
    prepare?: () => Promise<unknown>;
    execute: (recoveryContext?: unknown) => Promise<T>;
  }): Promise<{ replayed: boolean; value: T }> {
    const key = `${input.workspaceId}:${input.idempotencyKey}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) {
        throw new Error('idempotency payload conflict');
      }
      if (existing.status === 'rejected') throw existing.error;
      return { replayed: true, value: existing.value as T };
    }
    try {
      const recoveryContext = await input.prepare?.();
      const value = await input.execute(recoveryContext);
      this.records.set(key, {
        payloadHash: input.payloadHash,
        status: 'fulfilled',
        value,
      });
      return { replayed: false, value };
    } catch (error) {
      this.records.set(key, {
        payloadHash: input.payloadHash,
        status: 'rejected',
        error,
      });
      throw error;
    }
  }

  async listPendingExecutions() {
    return [];
  }

  async reconcilePendingExecution<T>(): Promise<{
    replayed: boolean;
    value: T;
  }> {
    throw new Error('No pending execution in memory test port.');
  }
}

type GovernedCall = {
  domain: keyof AdminSupplyGovernedPorts;
  phase: 'preview' | 'execute';
  request: AdminSupplyGovernedActionRequest;
  audit?: PermissionAuditProjection;
  idempotency?: GovernedSupplyActionExecution['idempotency'];
};

function routeExplanation(
  surface: 'simulator' | 'task_audit',
  passedDeploymentIds: string[] = ['seedream-5-ark'],
) {
  return buildRouteDecisionExplanation({
    surface,
    requestedDataClasses: [],
    hardFilterPassedDeploymentIds: passedDeploymentIds,
    hardFilterExcluded: [],
    acceptanceBranch: {
      acceptance: 'not_attempted',
      decision: 'awaiting_selection',
      reason: 'Simulation only',
    },
  });
}

function governedPorts(
  calls: GovernedCall[] = [],
  overrides: {
    preview?: (
      request: AdminSupplyGovernedActionRequest,
    ) => GovernedSupplyImpactPreview;
    value?: unknown;
    audit?: (audit: PermissionAuditProjection) => PermissionAuditProjection;
    onCommit?: () => void;
    divergentRouteExplanation?: boolean;
  } = {},
): AdminSupplyGovernedPorts {
  const port = (
    domain: keyof AdminSupplyGovernedPorts,
  ): AdminSupplyGovernedDomainPort => ({
    async preview(request) {
      calls.push({ domain, phase: 'preview', request });
      return (
        overrides.preview?.(request) ?? {
          id: `preview:${request.action}:${request.target.resourceId}:${request.expectedRevisionId ?? 'none'}`,
          scope: `${request.target.resourceType}:${request.target.resourceId}`,
          changes: [`Apply ${request.action}`],
          warnings: ['No blind retry for accepted or acceptance_unknown media'],
          reversible: [
            'isolate',
            'recover',
            'stop_new_tasks',
            'drain',
          ].includes(request.action),
          expectedRevisionId: request.expectedRevisionId,
          before: { revisionId: request.expectedRevisionId },
          after: { action: request.action },
          ...(request.action === 'route_simulate' ||
          request.action === 'candidate_config_validate'
            ? { routeDecision: routeExplanation('simulator') }
            : {}),
        }
      );
    },
    async execute(input: GovernedSupplyActionExecution) {
      const audit = overrides.audit?.(input.audit) ?? input.audit;
      calls.push({
        domain,
        phase: 'execute',
        request: input.request,
        audit,
        idempotency: input.idempotency,
      });
      overrides.onCommit?.();
      const isRouteDecision =
        input.request.action === 'route_simulate' ||
        input.request.action === 'candidate_config_validate';
      const simulator = routeExplanation('simulator');
      const taskAudit = routeExplanation(
        'task_audit',
        overrides.divergentRouteExplanation ? [] : ['seedream-5-ark'],
      );
      return {
        value: overrides.value ?? {
          action: input.request.action,
          targetId: input.request.target.resourceId,
        },
        audit,
        ...(isRouteDecision
          ? { routeDecision: { simulator, taskAudit } }
          : {}),
      };
    },
    async queryOutcome(input: GovernedSupplyActionExecution) {
      const audit = overrides.audit?.(input.audit) ?? input.audit;
      return {
        value: overrides.value ?? {
          action: input.request.action,
          targetId: input.request.target.resourceId,
        },
        audit,
      };
    },
  });
  return {
    routes: port('routes'),
    channels: port('channels'),
    credentials: port('credentials'),
    health: port('health'),
  };
}

function requestFor(
  action: AdminSupplyGovernedActionRequest['action'],
  suffix: string = action,
): AdminSupplyGovernedActionRequest {
  const base = {
    context,
    reason: `Operational reason for ${action}`,
    expectedRevisionId: `revision-${suffix}`,
    idempotencyKey: `idempotency-${suffix}`,
  };
  switch (action) {
    case 'connectivity_probe':
    case 'conformance_probe':
      return {
        ...base,
        action,
        target: { resourceType: 'deployment', resourceId: 'seedream-5-ark' },
        parameters: {
          deploymentId: 'seedream-5-ark',
          operation: 'image.generate',
          probeKind:
            action === 'conformance_probe' ? 'conformance' : 'connectivity',
        },
      };
    case 'candidate_config_save':
      return {
        ...base,
        action,
        target: { resourceType: 'route_policy', resourceId: 'route-r7' },
        parameters: {
          candidate: {
            id: 'route-image-quality',
            operation: 'image.generate',
            qualityTier: 'quality',
            hardConstraints: ['deployment_active'],
            candidateDeploymentIds: ['seedream-5-ark'],
            maxAttempts: 2,
            fallbackAuthorized: true,
            revisionId: 'route-image-quality:r8',
          },
        },
      };
    case 'candidate_config_validate':
      return {
        ...base,
        action,
        target: { resourceType: 'route_policy', resourceId: 'route-r7' },
        parameters: {
          routePolicyRevisionId: 'route-r7',
          operation: 'image.generate',
          selection: {
            mode: 'auto',
            profile: 'balanced',
            fallbackConsent: true,
          },
          dataClass: [],
          failureScenario: 'success',
          unavailableDeploymentIds: [],
        },
      };
    case 'route_simulate':
      return {
        ...base,
        action,
        target: { resourceType: 'operation', resourceId: 'image.generate' },
        parameters: {
          operation: 'image.generate',
          selection: {
            mode: 'auto',
            profile: 'balanced',
            fallbackConsent: true,
          },
          dataClass: [],
          failureScenario: 'success',
          unavailableDeploymentIds: [],
        },
      };
    case 'publish':
    case 'rollback':
      return {
        ...base,
        action,
        target: { resourceType: 'route_policy', resourceId: 'route-r7' },
      };
    case 'isolate':
    case 'recover':
    case 'stop_new_tasks':
    case 'drain':
      return {
        ...base,
        action,
        target: { resourceType: 'channel', resourceId: 'channel-ark-cn' },
      };
    case 'credential_pre_revoke':
      return {
        ...base,
        action,
        target: {
          resourceType: 'credential_account',
          resourceId: 'credential-ark',
        },
      };
    case 'credential_rotate':
      return {
        ...base,
        action,
        target: {
          resourceType: 'credential_account',
          resourceId: 'credential-ark',
        },
        parameters: { secureWriteReceiptId: 'secure-write-receipt-1' },
      };
    case 'health_refresh':
      return {
        ...base,
        action,
        target: { resourceType: 'deployment', resourceId: 'seedream-5-ark' },
      };
  }
}

const EXPECTED_PERMISSION = {
  connectivity_probe: 'platform.manage',
  conformance_probe: 'platform.manage',
  candidate_config_save: 'platform.manage',
  candidate_config_validate: 'platform.manage',
  route_simulate: 'platform.manage',
  publish: 'config.publish',
  rollback: 'config.publish',
  isolate: 'channel.lifecycle.manage',
  recover: 'channel.lifecycle.manage',
  stop_new_tasks: 'channel.lifecycle.manage',
  drain: 'channel.lifecycle.manage',
  credential_pre_revoke: 'credential.govern',
  credential_rotate: 'credential.govern',
  health_refresh: 'platform.manage',
} as const;

const EXPECTED_DOMAIN: Record<
  keyof typeof EXPECTED_PERMISSION,
  keyof AdminSupplyGovernedPorts
> = {
  connectivity_probe: 'routes',
  conformance_probe: 'routes',
  candidate_config_save: 'routes',
  candidate_config_validate: 'routes',
  route_simulate: 'routes',
  publish: 'routes',
  rollback: 'routes',
  isolate: 'channels',
  recover: 'channels',
  stop_new_tasks: 'channels',
  drain: 'channels',
  credential_pre_revoke: 'credentials',
  credential_rotate: 'credentials',
  health_refresh: 'health',
};

describe('AdminSupplyControlPlane governed dispatcher', () => {
  it('routes every J5 action through permission, approved impact, CAS, idempotency, and immutable audit', async () => {
    const actions = Object.keys(EXPECTED_PERMISSION) as Array<
      keyof typeof EXPECTED_PERMISSION
    >;

    for (const action of actions) {
      const calls: GovernedCall[] = [];
      const idempotency = new MemoryIdempotencyPort();
      const control = new AdminSupplyControlPlane({
        snapshot: snapshotPorts(),
        permission: createPermissionAuthorizer(),
        idempotency,
        governed: governedPorts(calls),
        clock: () => new Date('2026-07-20T06:00:00.000Z'),
      });
      const request = requestFor(action);
      const preview = await control.previewAction(request);
      const first = await control.dispatchAction({
        ...request,
        approvedPreviewId: preview.id,
      });
      const replay = await control.dispatchAction({
        ...request,
        approvedPreviewId: preview.id,
      });

      assert.equal(first.replayed, false, action);
      assert.equal(replay.replayed, true, action);
      assert.deepEqual(replay.audit, first.audit, action);
      assert.equal(first.audit.permission, EXPECTED_PERMISSION[action], action);
      assert.equal(first.audit.actor.userId, context.userId, action);
      assert.equal(first.audit.target.resourceId, request.target.resourceId, action);
      assert.equal(first.audit.reason, request.reason, action);
      assert.equal(first.audit.correlationId, context.correlationId, action);
      assert.equal(first.audit.occurredAt, '2026-07-20T06:00:00.000Z', action);
      assert.deepEqual(
        calls.find((call) => call.phase === 'execute')?.idempotency,
        {
          workspaceId: context.workspaceId,
          key: request.idempotencyKey,
          payloadHash: idempotency.records.get(
            `${context.workspaceId}:${request.idempotencyKey}`,
          )?.payloadHash,
        },
        action,
      );
      assert.deepEqual(first.audit.before, {
        revisionId: request.expectedRevisionId,
      });
      assert.deepEqual(first.audit.after, { action });
      if (
        action === 'route_simulate' ||
        action === 'candidate_config_validate'
      ) {
        assert.equal(first.routeDecision?.simulator.surface, 'simulator');
        assert.equal(first.routeDecision?.taskAudit.surface, 'task_audit');
        assert.deepEqual(replay.routeDecision, first.routeDecision);
      } else {
        assert.equal(first.routeDecision, undefined);
      }
      assert.equal(
        calls.filter((call) => call.phase === 'execute').length,
        1,
        `${action} must execute once`,
      );
      assert.deepEqual(
        new Set(calls.map((call) => call.domain)),
        new Set([EXPECTED_DOMAIN[action]]),
        `${action} must use its declared domain port`,
      );
      assert.equal(idempotency.records.size, 1, action);
    }
  });

  it('rejects missing reason, CAS, idempotency, wrong target, stale preview, and denied permission before execute', async () => {
    const calls: GovernedCall[] = [];
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(),
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts(calls),
    });
    const publish = requestFor('publish');

    await assert.rejects(
      control.previewAction({ ...publish, reason: 'short' }),
      /reason/i,
    );
    await assert.rejects(
      control.previewAction({
        ...publish,
        expectedRevisionId: undefined as never,
      }),
      /expectedRevisionId|CAS/i,
    );
    await assert.rejects(
      control.previewAction({ ...publish, idempotencyKey: ' ' }),
      /idempotency/i,
    );
    await assert.rejects(
      control.previewAction({
        ...publish,
        target: {
          resourceType: 'credential_account',
          resourceId: 'credential-ark',
        },
      } as AdminSupplyGovernedActionRequest),
      /target/i,
    );
    const preview = await control.previewAction(publish);
    await assert.rejects(
      control.dispatchAction({
        ...publish,
        approvedPreviewId: `${preview.id}:stale`,
      }),
      /preview/i,
    );
    await assert.rejects(
      control.previewAction({
        ...requestFor('credential_rotate'),
        context: { ...context, actor: 'operator' },
      }),
      /cannot perform|forbidden|permission/i,
    );
    assert.equal(
      calls.filter((call) => call.phase === 'execute').length,
      0,
    );
  });

  it('does not expose secrets or authenticated endpoint queries from any domain result', async () => {
    const unsafeValues = [
      { apiKey: 'sk-super-secret-value' },
      { authorization: 'Bearer unsafe-token-value' },
      { endpoint: 'https://provider.test/run?access_token=unsafe' },
      { credential: { value: 'unsafe-plain-value' } },
    ];

    for (const [index, value] of unsafeValues.entries()) {
      const control = new AdminSupplyControlPlane({
        snapshot: snapshotPorts(),
        permission: createPermissionAuthorizer(),
        idempotency: new MemoryIdempotencyPort(),
        governed: governedPorts([], { value }),
      });
      const request = requestFor('credential_rotate', `secret-${index}`);
      const preview = await control.previewAction(request);

      await assert.rejects(
        control.dispatchAction({
          ...request,
          approvedPreviewId: preview.id,
        }),
        /secret|echo/i,
      );
    }
  });

  it('memoizes an unsafe terminal result so the committed domain action is not repeated', async () => {
    let commits = 0;
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(),
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts([], {
        value: { apiKey: 'sk-unsafe-after-commit' },
        onCommit: () => {
          commits += 1;
        },
      }),
    });
    const request = requestFor('credential_rotate', 'unsafe-replay');
    const preview = await control.previewAction(request);
    const dispatch = () =>
      control.dispatchAction({ ...request, approvedPreviewId: preview.id });

    await assert.rejects(dispatch(), /secret|echo/i);
    await assert.rejects(dispatch(), /secret|echo/i);
    assert.equal(commits, 1);
  });

  it('rejects a domain port that mutates actor role or occurredAt in immutable audit', async () => {
    for (const field of ['role', 'occurredAt'] as const) {
      const control = new AdminSupplyControlPlane({
        snapshot: snapshotPorts(),
        permission: createPermissionAuthorizer(),
        idempotency: new MemoryIdempotencyPort(),
        governed: governedPorts([], {
          audit(audit) {
            return field === 'role'
              ? { ...audit, actor: { ...audit.actor, role: 'operator' } }
              : { ...audit, occurredAt: '2026-07-20T23:59:59.000Z' };
          },
        }),
      });
      const request = requestFor('publish', `audit-${field}`);
      const preview = await control.previewAction(request);

      await assert.rejects(
        control.dispatchAction({
          ...request,
          approvedPreviewId: preview.id,
        }),
        /immutable governed-action audit/i,
      );
    }
  });

  it('records route-policy publish/rollback as route-policy audit actions', async () => {
    for (const action of ['publish', 'rollback'] as const) {
      const control = new AdminSupplyControlPlane({
        snapshot: snapshotPorts(),
        permission: createPermissionAuthorizer(),
        idempotency: new MemoryIdempotencyPort(),
        governed: governedPorts(),
      });
      const request = requestFor(action, `route-${action}`);
      const preview = await control.previewAction(request);
      const result = await control.dispatchAction({
        ...request,
        approvedPreviewId: preview.id,
      });

      assert.equal(result.audit.target.action, `route_policy_${action}`);
    }
  });

  it('rejects blind resubmission after accepted or unknown media acceptance', async () => {
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(),
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts(),
    });

    for (const acceptance of ['accepted', 'acceptance_unknown'] as const) {
      const request = requestFor('route_simulate', acceptance);
      await assert.rejects(
        control.previewAction({
          ...request,
          parameters: {
            ...request.parameters,
            acceptance,
            resubmitAfterAcceptance: true,
          } as never,
        }),
        /never blindly resubmitted|accepted|unknown/i,
      );
    }
  });

  it('requires complete route/probe parameters and a secure credential write receipt', async () => {
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(),
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts(),
    });

    await assert.rejects(
      control.previewAction({
        ...requestFor('route_simulate'),
        parameters: { operation: 'image.generate' },
      } as never),
      /selection.*dataClass|route simulation/i,
    );
    await assert.rejects(
      control.previewAction({
        ...requestFor('connectivity_probe'),
        parameters: {},
      } as never),
      /deployment|operation|probe/i,
    );
    await assert.rejects(
      control.previewAction({
        ...requestFor('candidate_config_validate'),
        parameters: {
          ...requestFor('candidate_config_validate').parameters,
          routePolicyRevisionId: 'route-r8',
        },
      } as never),
      /routePolicyRevisionId|target revision/i,
    );
    await assert.rejects(
      control.previewAction({
        ...requestFor('credential_rotate'),
        parameters: {},
      } as never),
      /secureWriteReceiptId|raw secret/i,
    );
    await assert.rejects(
      control.previewAction({
        ...requestFor('credential_rotate'),
        parameters: {
          secureWriteReceiptId: 'secure-write-receipt-1',
          apiKey: 'raw-credential-must-not-enter-control-plane',
        },
      } as never),
      /secret|echo/i,
    );
  });

  it('accepts secondary supply operations for probes and route simulation', async () => {
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(),
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts(),
    });
    const probe = requestFor(
      'connectivity_probe',
      'secondary-probe',
    ) as Extract<
      AdminSupplyGovernedActionRequest,
      { action: 'connectivity_probe' | 'conformance_probe' }
    >;
    const route = requestFor(
      'route_simulate',
      'secondary-route',
    ) as Extract<
      AdminSupplyGovernedActionRequest,
      { action: 'route_simulate' }
    >;

    await control.previewAction({
      ...probe,
      parameters: { ...probe.parameters, operation: 'image.edit' },
    });
    await control.previewAction({
      ...route,
      target: { resourceType: 'operation', resourceId: 'image.edit' },
      parameters: { ...route.parameters, operation: 'image.edit' },
    });
  });

  it('requires simulator and task audit to share the same route explanation projection', async () => {
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(),
      permission: createPermissionAuthorizer(),
      idempotency: new MemoryIdempotencyPort(),
      governed: governedPorts([], { divergentRouteExplanation: true }),
    });
    const request = requestFor('route_simulate', 'divergent-explanation');
    const preview = await control.previewAction(request);

    await assert.rejects(
      control.dispatchAction({ ...request, approvedPreviewId: preview.id }),
      /explanation projections diverged/i,
    );
  });

  it('binds idempotency replay to the original actor and correlation', async () => {
    const idempotency = new MemoryIdempotencyPort();
    const control = new AdminSupplyControlPlane({
      snapshot: snapshotPorts(),
      permission: createPermissionAuthorizer(),
      idempotency,
      governed: governedPorts(),
    });
    const request = requestFor('publish', 'actor-bound');
    const preview = await control.previewAction(request);
    await control.dispatchAction({
      ...request,
      approvedPreviewId: preview.id,
    });

    await assert.rejects(
      control.dispatchAction({
        ...request,
        context: {
          ...request.context,
          userId: 'admin-b',
          correlationId: 'corr-b',
        },
        approvedPreviewId: preview.id,
      }),
      /idempotency payload conflict/i,
    );
  });
});
