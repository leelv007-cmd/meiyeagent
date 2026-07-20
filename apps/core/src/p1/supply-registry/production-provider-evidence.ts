import { createHash } from 'node:crypto';
import type { HealthOverlayRecord, SupplyOperation } from '@meiye/contracts';
import type {
  ProviderConnectivityProbePort,
  ProviderConnectivityStatus,
  ProviderCredentialSlot,
} from '../integrations/provider-connectivity.js';
import type { ProviderCredentialConnectivityVerificationPort } from '../integrations/provider-credential-runtime.js';
import type { CredentialConnectivityTestBrokerPort } from './secret-broker.js';
import type { HealthFailureFact } from './health-overlay.js';
import type { AdminSupplyGovernedActionRequest } from './admin-control-plane.js';
import type {
  AdminOperationalEvidenceRefreshPort,
  AdminOperationalEvidenceRefreshResult,
  AdminOperationalEvidenceUnavailableResult,
  AdminProviderProbeExecutionPort,
  AdminProviderProbeResult,
} from './postgres-admin-supply-runtime.js';

type RegistryDeployment = {
  id: string;
  credentialAccountId?: string;
  executionChannelId?: string;
};

type ProviderEvidenceDependencies = {
  registry: {
    getCurrentRegistryRevision(workspaceId: string): Promise<{
      deployments: RegistryDeployment[];
    } | null>;
  };
  pools: {
    get(id: string): Promise<{ deploymentIds: string[] } | null>;
  };
  credentials: CredentialConnectivityTestBrokerPort;
  verification: ProviderCredentialConnectivityVerificationPort;
  credentialWorkspaceId: string;
  connectivity: ProviderConnectivityProbePort;
  conformance: {
    runActivationProbe(
      context: AdminSupplyGovernedActionRequest['context'],
      deploymentId: string,
      operation: SupplyOperation,
      idempotencyKey: string
    ): Promise<{
      id: string;
      outcome: AdminProviderProbeResult['outcome'];
      createdAt: string;
    }>;
    listActivationProbeRuns(workspaceId: string): Promise<
      Array<{
        id: string;
        outcome: AdminProviderProbeResult['outcome'];
        createdAt: string;
        correlationId: string;
        deploymentId: string;
        operation: SupplyOperation;
      }>
    >;
  };
  health: {
    reportFact(fact: HealthFailureFact): Promise<HealthOverlayRecord>;
  };
  clock?: () => Date;
};

type ProviderOutcomeQuery = Parameters<
  NonNullable<AdminProviderProbeExecutionPort['queryOutcome']>
>[0];

type OperationalOutcomeQuery = Parameters<
  NonNullable<AdminOperationalEvidenceRefreshPort['queryOutcome']>
>[0];

type ConnectivityAttempt = {
  result: AdminProviderProbeResult & { probeKind: 'connectivity' };
  deploymentId: string;
  executed: boolean;
  status: ProviderConnectivityStatus;
};

const UNKNOWN_BALANCE = {
  status: 'unknown' as const,
  reason: 'provider_balance_adapter_unavailable',
};

const UNKNOWN_QUOTA = {
  status: 'unknown' as const,
  reason: 'provider_quota_adapter_unavailable',
};

export class ProductionAdminProviderEvidence
  implements
    AdminProviderProbeExecutionPort,
    AdminOperationalEvidenceRefreshPort
{
  constructor(private readonly dependencies: ProviderEvidenceDependencies) {}

  async runConnectivity(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    deploymentId: string;
    operation: SupplyOperation;
    idempotencyKey: string;
  }) {
    return (await this.probeConnectivity(input)).result;
  }

  async runConformance(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    deploymentId: string;
    operation: SupplyOperation;
    idempotencyKey: string;
  }) {
    const result = await this.dependencies.conformance.runActivationProbe(
      input.context,
      input.deploymentId,
      input.operation,
      input.idempotencyKey
    );
    return {
      probeKind: 'conformance' as const,
      outcome: result.outcome,
      observedAt: result.createdAt,
      evidenceRef: result.id,
    };
  }

  queryOutcome(
    input: ProviderOutcomeQuery
  ): Promise<AdminProviderProbeResult | null>;
  queryOutcome(
    input: OperationalOutcomeQuery
  ): Promise<
    | AdminOperationalEvidenceRefreshResult
    | AdminOperationalEvidenceUnavailableResult
    | null
  >;
  async queryOutcome(
    input: ProviderOutcomeQuery | OperationalOutcomeQuery
  ): Promise<
    | AdminProviderProbeResult
    | AdminOperationalEvidenceRefreshResult
    | AdminOperationalEvidenceUnavailableResult
    | null
  > {
    if (!('probeKind' in input) || input.probeKind !== 'conformance') {
      return null;
    }
    const run = (
      await this.dependencies.conformance.listActivationProbeRuns(
        input.context.workspaceId
      )
    ).find(
      (candidate) =>
        candidate.correlationId === input.context.correlationId &&
        candidate.deploymentId === input.deploymentId &&
        candidate.operation === input.operation
    );
    return run
      ? {
          probeKind: 'conformance',
          outcome: run.outcome,
          observedAt: run.createdAt,
          evidenceRef: run.id,
        }
      : null;
  }

  async refresh(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    targetKind: AdminSupplyGovernedActionRequest['target']['resourceType'];
    targetId: string;
    idempotencyKey: string;
  }): Promise<
    | AdminOperationalEvidenceRefreshResult
    | AdminOperationalEvidenceUnavailableResult
  > {
    const deploymentIds = await this.resolveDeploymentIds(input);
    const attempts: ConnectivityAttempt[] = [];
    for (const deploymentId of deploymentIds) {
      attempts.push(
        await this.probeConnectivity({
          context: input.context,
          deploymentId,
          operation: 'copy.generate',
          idempotencyKey: `${input.idempotencyKey}:${deploymentId}`,
        })
      );
    }
    const executed = attempts.filter((attempt) => attempt.executed);
    if (executed.length === 0) {
      return this.unavailable('provider_operational_adapter_unavailable');
    }

    const knownHealth = executed.filter(
      (attempt) =>
        attempt.status !== 'unknown' && attempt.status !== 'not_wired'
    );
    const persisted = await Promise.all(
      knownHealth.map((attempt) => this.persistDeploymentHealth(attempt))
    );
    const complete = knownHealth.length === deploymentIds.length;
    const health = complete
      ? {
          status: 'known' as const,
          state: worstHealthState(persisted.map((record) => record.state)),
        }
      : {
          status: 'unknown' as const,
          reason: 'provider_health_evidence_partial',
        };
    const observedAt = this.now().toISOString();
    return {
      evidenceSource: 'live_provider',
      observedAt,
      evidenceRef: aggregateEvidenceRef(input.targetId, attempts, observedAt),
      health,
      balance: UNKNOWN_BALANCE,
      quota: UNKNOWN_QUOTA,
    };
  }

  private async probeConnectivity(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    deploymentId: string;
    operation: SupplyOperation;
    idempotencyKey: string;
  }): Promise<ConnectivityAttempt> {
    const observedAt = this.now().toISOString();
    const unavailable = (): ConnectivityAttempt => ({
      deploymentId: input.deploymentId,
      executed: false,
      status: 'unknown',
      result: {
        probeKind: 'connectivity',
        outcome: 'unknown',
        observedAt,
        evidenceRef: safeEvidenceRef(
          'provider-connectivity-unavailable',
          input.deploymentId,
          input.idempotencyKey,
          observedAt
        ),
      },
    });
    let verifiedInput:
      | {
          accountId: string;
          credentialVersion: string;
          deploymentId: string;
          errorCode?: string;
          status: ProviderConnectivityStatus;
        }
      | undefined;
    try {
      const registry =
        await this.dependencies.registry.getCurrentRegistryRevision(
          input.context.workspaceId
        );
      const deployment = registry?.deployments.find(
        (candidate) => candidate.id === input.deploymentId
      );
      if (!deployment?.credentialAccountId) return unavailable();
      const account = await this.dependencies.credentials.projectPublic(
        deployment.credentialAccountId
      );
      const slot = providerSlot(account.type);
      if (!slot) return unavailable();
      const credential =
        await this.dependencies.credentials.assembleForConnectivityTest({
          credentialAccountId: deployment.credentialAccountId,
          requiredScope: account.scope,
          version: account.version,
        });
      const providerResult = await this.dependencies.connectivity.probe({
        slot,
        credential: credential.secret,
      });
      verifiedInput = {
        accountId: account.id,
        credentialVersion: credential.version,
        deploymentId: deployment.id,
        status: providerResult.status,
        ...(providerResult.errorCode
          ? { errorCode: providerResult.errorCode }
          : {}),
      };
    } catch {
      return unavailable();
    }
    const evidenceRef = safeEvidenceRef(
      'provider-connectivity',
      verifiedInput.deploymentId,
      input.idempotencyKey,
      observedAt
    );
    await this.dependencies.verification.recordConnectivityResult({
      workspaceId: this.dependencies.credentialWorkspaceId,
      accountId: verifiedInput.accountId,
      expectedVersion: verifiedInput.credentialVersion,
      status: verifiedInput.status,
      testedAt: observedAt,
      evidenceRef,
      ...(verifiedInput.errorCode
        ? { errorCode: verifiedInput.errorCode }
        : {}),
    });
    const executed =
      verifiedInput.status !== 'not_wired' &&
      verifiedInput.errorCode !== 'endpoint_not_configured';
    return {
      deploymentId: verifiedInput.deploymentId,
      executed,
      status: verifiedInput.status,
      result: {
        probeKind: 'connectivity',
        outcome: connectivityOutcome(verifiedInput.status),
        observedAt,
        evidenceRef,
      },
    };
  }

  private async resolveDeploymentIds(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    targetKind: AdminSupplyGovernedActionRequest['target']['resourceType'];
    targetId: string;
  }): Promise<string[]> {
    const registry =
      await this.dependencies.registry.getCurrentRegistryRevision(
        input.context.workspaceId
      );
    if (!registry) return [];
    switch (input.targetKind) {
      case 'deployment':
        return registry.deployments.some(({ id }) => id === input.targetId)
          ? [input.targetId]
          : [];
      case 'channel':
        return registry.deployments
          .filter(
            ({ executionChannelId }) => executionChannelId === input.targetId
          )
          .map(({ id }) => id);
      case 'credential_account':
        return registry.deployments
          .filter(
            ({ credentialAccountId }) => credentialAccountId === input.targetId
          )
          .map(({ id }) => id);
      case 'pool': {
        const pool = await this.dependencies.pools.get(input.targetId);
        if (!pool) return [];
        const existing = new Set(registry.deployments.map(({ id }) => id));
        return pool.deploymentIds.filter((id) => existing.has(id));
      }
      default:
        return [];
    }
  }

  private persistDeploymentHealth(attempt: ConnectivityAttempt) {
    const fact = connectivityHealthFact(attempt);
    return this.dependencies.health.reportFact(fact);
  }

  private unavailable(
    reason: string
  ): AdminOperationalEvidenceUnavailableResult {
    return {
      evidenceSource: 'unavailable',
      observedAt: this.now().toISOString(),
      evidenceRef: null,
      health: { status: 'unknown', reason },
      balance: { status: 'unknown', reason },
      quota: { status: 'unknown', reason },
    };
  }

  private now() {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}

function providerSlot(type: string): ProviderCredentialSlot | null {
  if (type === 'model.direct' || type === 'ark.media') return type;
  return null;
}

function connectivityOutcome(
  status: ProviderConnectivityStatus
): AdminProviderProbeResult['outcome'] {
  if (status === 'passed') return 'passed';
  if (status === 'unauthorized' || status === 'network_failed') return 'failed';
  return 'unknown';
}

function connectivityHealthFact(
  attempt: ConnectivityAttempt
): HealthFailureFact {
  const kind =
    attempt.status === 'passed'
      ? 'success'
      : attempt.status === 'network_failed'
        ? 'connection_error'
        : 'hard_failure';
  return {
    targetKind: 'deployment',
    targetId: attempt.deploymentId,
    kind,
    reason: `provider_connectivity_${attempt.status}`,
    source: 'admin_provider_connectivity',
    auditRef: attempt.result.evidenceRef,
    observedAt: attempt.result.observedAt,
  };
}

function worstHealthState(
  states: HealthOverlayRecord['state'][]
): HealthOverlayRecord['state'] {
  const rank: Record<HealthOverlayRecord['state'], number> = {
    healthy: 0,
    degraded: 1,
    cooldown: 2,
    circuit_open: 3,
    unavailable: 4,
  };
  return states.reduce(
    (worst, state) => (rank[state] > rank[worst] ? state : worst),
    'healthy'
  );
}

function safeEvidenceRef(
  kind: string,
  targetId: string,
  idempotencyKey: string,
  observedAt: string
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ idempotencyKey, observedAt, targetId }))
    .digest('hex')
    .slice(0, 24);
  return `${kind}://${encodeURIComponent(targetId)}/${digest}`;
}

function aggregateEvidenceRef(
  targetId: string,
  attempts: ConnectivityAttempt[],
  observedAt: string
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        observedAt,
        refs: attempts.map(({ result }) => result.evidenceRef).sort(),
        targetId,
      })
    )
    .digest('hex')
    .slice(0, 24);
  return `provider-operational://${encodeURIComponent(targetId)}/${digest}`;
}
