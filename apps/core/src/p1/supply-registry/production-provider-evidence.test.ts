import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { HealthFailureFact } from './health-overlay.js';
import { ProductionAdminProviderEvidence } from './production-provider-evidence.js';

const context = {
  actor: 'admin' as const,
  correlationId: 'corr-provider-evidence',
  userId: 'admin-1',
  workspaceId: 'workspace-1',
};

function dependencies(
  overrides: Partial<
    ConstructorParameters<typeof ProductionAdminProviderEvidence>[0]
  > = {},
) {
  const healthFacts: HealthFailureFact[] = [];
  const connectivityInputs: Array<{ slot: string; credential: string }> = [];
  const credentialTestInputs: Array<{
    credentialAccountId: string;
    requiredScope: string;
    version: string;
  }> = [];
  const verificationInputs: Array<Record<string, unknown>> = [];
  return {
    healthFacts,
    connectivityInputs,
    credentialTestInputs,
    verificationInputs,
    value: {
      registry: {
        async getCurrentRegistryRevision() {
          return {
            deployments: [
              {
                id: 'deployment-direct',
                credentialAccountId:
                  'credential-account:platform:model.direct',
                executionChannelId: 'channel-direct',
              },
            ],
          };
        },
      },
      pools: {
        async get() {
          return null;
        },
      },
      credentials: {
        async assembleForRequest() {
          throw new Error('normal request assembly must reject pending credentials');
        },
        async assembleForConnectivityTest(input: {
          credentialAccountId: string;
          requiredScope: string;
          version: string;
        }) {
          credentialTestInputs.push(input);
          return {
            credentialAccountId:
              'credential-account:platform:model.direct',
            version: 'credential-v3',
            secretReference: 'vault://provider/v3',
            secretVersion: 3,
            scope: 'platform' as const,
            secret: 'live-provider-secret',
          };
        },
        async projectPublic() {
          return {
            id: 'credential-account:platform:model.direct',
            label: 'Direct provider',
            providerProfileId: 'provider-direct',
            type: 'model.direct',
            scope: 'platform' as const,
            secretReference: 'vault://provider/v3',
            version: 'credential-v3',
            status: 'active' as const,
            drainSubstate: 'none' as const,
            source: 'registry' as const,
          };
        },
      },
      connectivity: {
        async probe(input: { slot: string; credential: string }) {
          connectivityInputs.push(input);
          return { status: 'passed' as const };
        },
      },
      verification: {
        async recordConnectivityResult(input: {
          workspaceId: string;
          accountId: string;
          expectedVersion: string;
          status: 'passed' | 'unauthorized' | 'network_failed' | 'unknown' | 'not_wired';
          testedAt: string;
          evidenceRef: string;
          errorCode?: string;
        }) {
          verificationInputs.push(input);
          return {
            account: {
              id: input.accountId,
              label: 'Direct provider',
              providerProfileId: 'provider-direct',
              type: 'model.direct',
              scope: 'platform' as const,
              secretReference: 'vault://provider/v3',
              version: input.expectedVersion,
              status: input.status === 'passed' ? ('active' as const) : ('pending' as const),
              drainSubstate: 'none' as const,
              source: 'registry' as const,
            },
            activated: input.status === 'passed',
          };
        },
      },
      credentialWorkspaceId: '__global__',
      conformance: {
        async runActivationProbe() {
          return {
            id: 'activation-probe-live-1',
            outcome: 'passed' as const,
            createdAt: '2026-07-20T10:00:00.000Z',
          };
        },
        async listActivationProbeRuns() {
          return [
            {
              id: 'activation-probe-live-1',
              outcome: 'passed' as const,
              createdAt: '2026-07-20T10:00:00.000Z',
              correlationId: context.correlationId,
              deploymentId: 'deployment-direct',
              operation: 'copy.generate' as const,
            },
          ];
        },
      },
      health: {
        async reportFact(fact: HealthFailureFact) {
          healthFacts.push(fact);
          return {
            targetKind: fact.targetKind,
            targetId: fact.targetId,
            state: fact.kind === 'success' ? ('healthy' as const) : ('degraded' as const),
            reason: fact.reason,
            source: fact.source,
            startedAt: fact.observedAt ?? '2026-07-20T10:00:00.000Z',
            ...(fact.auditRef ? { auditRef: fact.auditRef } : {}),
          };
        },
      },
      clock: () => new Date('2026-07-20T10:00:00.000Z'),
      ...overrides,
    },
  };
}

describe('ProductionAdminProviderEvidence', () => {
  it('uses the request-time credential for a real connectivity probe without echoing it', async () => {
    const fixture = dependencies();
    const adapter = new ProductionAdminProviderEvidence(fixture.value);

    const result = await adapter.runConnectivity({
      context,
      deploymentId: 'deployment-direct',
      operation: 'copy.generate',
      idempotencyKey: 'connectivity-1',
    });

    assert.deepEqual(fixture.connectivityInputs, [
      { slot: 'model.direct', credential: 'live-provider-secret' },
    ]);
    assert.deepEqual(fixture.credentialTestInputs, [
      {
        credentialAccountId: 'credential-account:platform:model.direct',
        requiredScope: 'platform',
        version: 'credential-v3',
      },
    ]);
    assert.deepEqual(fixture.verificationInputs, [
      {
        workspaceId: '__global__',
        accountId: 'credential-account:platform:model.direct',
        expectedVersion: 'credential-v3',
        status: 'passed',
        testedAt: '2026-07-20T10:00:00.000Z',
        evidenceRef: result.evidenceRef,
      },
    ]);
    assert.equal(result.probeKind, 'connectivity');
    assert.equal(result.outcome, 'passed');
    assert.doesNotMatch(JSON.stringify(result), /live-provider-secret|vault:\/\//);
  });

  it('delegates conformance to the activation probe instead of connectivity', async () => {
    const fixture = dependencies();
    const adapter = new ProductionAdminProviderEvidence(fixture.value);

    const result = await adapter.runConformance({
      context,
      deploymentId: 'deployment-direct',
      operation: 'copy.generate',
      idempotencyKey: 'conformance-1',
    });

    assert.equal(result.probeKind, 'conformance');
    assert.equal(result.evidenceRef, 'activation-probe-live-1');
    assert.equal(fixture.connectivityInputs.length, 0);
  });

  it('recovers conformance only from its durable activation run identity', async () => {
    const fixture = dependencies();
    const adapter = new ProductionAdminProviderEvidence(fixture.value);

    assert.deepEqual(
      await adapter.queryOutcome({
        context,
        deploymentId: 'deployment-direct',
        operation: 'copy.generate',
        probeKind: 'conformance',
        idempotencyKey: 'conformance-1',
      }),
      {
        probeKind: 'conformance',
        outcome: 'passed',
        observedAt: '2026-07-20T10:00:00.000Z',
        evidenceRef: 'activation-probe-live-1',
      },
    );
    assert.equal(
      await adapter.queryOutcome({
        context,
        deploymentId: 'deployment-direct',
        operation: 'copy.generate',
        probeKind: 'connectivity',
        idempotencyKey: 'connectivity-1',
      }),
      null,
    );
  });

  it('refreshes live health, persists its head, and reports unavailable balance and quota honestly', async () => {
    const fixture = dependencies();
    const adapter = new ProductionAdminProviderEvidence(fixture.value);

    const result = await adapter.refresh({
      context,
      targetKind: 'deployment',
      targetId: 'deployment-direct',
      idempotencyKey: 'health-1',
    });

    assert.equal(result.evidenceSource, 'live_provider');
    assert.deepEqual(result.health, { status: 'known', state: 'healthy' });
    assert.deepEqual(result.balance, {
      status: 'unknown',
      reason: 'provider_balance_adapter_unavailable',
    });
    assert.deepEqual(result.quota, {
      status: 'unknown',
      reason: 'provider_quota_adapter_unavailable',
    });
    assert.equal(fixture.healthFacts.length, 1);
    assert.equal(fixture.healthFacts[0]?.kind, 'success');
    assert.equal(fixture.healthFacts[0]?.targetId, 'deployment-direct');
  });

  it('returns unavailable unknown evidence when no real provider adapter can run', async () => {
    const fixture = dependencies({
      credentials: {
        async assembleForRequest() {
          throw new Error('secret unavailable');
        },
        async assembleForConnectivityTest() {
          throw new Error('secret unavailable');
        },
        async projectPublic() {
          return {
            id: 'credential-account:platform:unsupported',
            label: 'Unsupported provider',
            providerProfileId: 'provider-unsupported',
            type: 'unsupported.provider',
            scope: 'platform' as const,
            secretReference: 'vault://unsupported/v1',
            version: 'v1',
            status: 'active' as const,
            drainSubstate: 'none' as const,
            source: 'registry' as const,
          };
        },
      },
    });
    const adapter = new ProductionAdminProviderEvidence(fixture.value);

    const result = await adapter.refresh({
      context,
      targetKind: 'deployment',
      targetId: 'deployment-direct',
      idempotencyKey: 'health-unsupported-1',
    });

    assert.equal(result.evidenceSource, 'unavailable');
    assert.equal(result.health.status, 'unknown');
    assert.equal(fixture.connectivityInputs.length, 0);
    assert.equal(fixture.healthFacts.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /secret unavailable|vault:\/\//);
  });

  it('does not promote an indeterminate live response into a known health head', async () => {
    const fixture = dependencies({
      connectivity: {
        async probe() {
          return { status: 'unknown' as const, errorCode: 'http_500' };
        },
      },
    });
    const adapter = new ProductionAdminProviderEvidence(fixture.value);

    const result = await adapter.refresh({
      context,
      targetKind: 'deployment',
      targetId: 'deployment-direct',
      idempotencyKey: 'health-indeterminate-1',
    });

    assert.equal(result.evidenceSource, 'live_provider');
    assert.deepEqual(result.health, {
      status: 'unknown',
      reason: 'provider_health_evidence_partial',
    });
    assert.equal(fixture.healthFacts.length, 0);
  });

  it('serializes shared-account health probes so verification CAS cannot overlap', async () => {
    let verificationInFlight = false;
    let overlapped = false;
    const fixture = dependencies({
      registry: {
        async getCurrentRegistryRevision() {
          return {
            deployments: [
              {
                id: 'deployment-direct-a',
                credentialAccountId:
                  'credential-account:platform:model.direct',
                executionChannelId: 'channel-direct',
              },
              {
                id: 'deployment-direct-b',
                credentialAccountId:
                  'credential-account:platform:model.direct',
                executionChannelId: 'channel-direct',
              },
            ],
          };
        },
      },
      verification: {
        async recordConnectivityResult(input) {
          if (verificationInFlight) overlapped = true;
          verificationInFlight = true;
          await new Promise<void>((resolve) => setTimeout(resolve, 1));
          verificationInFlight = false;
          return {
            account: {
              id: input.accountId,
              label: 'Direct provider',
              providerProfileId: 'provider-direct',
              type: 'model.direct',
              scope: 'platform',
              secretReference: 'vault://provider/v3',
              version: input.expectedVersion,
              status: 'active',
              drainSubstate: 'none',
              source: 'registry',
            },
            activated: true,
          };
        },
      },
    });
    const adapter = new ProductionAdminProviderEvidence(fixture.value);

    const result = await adapter.refresh({
      context,
      targetKind: 'channel',
      targetId: 'channel-direct',
      idempotencyKey: 'health-shared-account-1',
    });

    assert.equal(result.evidenceSource, 'live_provider');
    assert.equal(overlapped, false);
  });
});
