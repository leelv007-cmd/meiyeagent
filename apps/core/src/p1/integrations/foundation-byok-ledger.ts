import type { P1ApplicationService, P1Context } from '../foundation/index.js';
import {
  resolveGenerationOpeningEntitlement,
  type ProductEntitlementPolicyPort,
} from '../foundation/entitlement-policy.js';
import type {
  IntegrationContext,
  StrictByokLedgerPort,
  StrictByokRouteSnapshot,
  StrictByokSubmissionResult,
} from './contracts.js';

export class FoundationStrictByokLedger implements StrictByokLedgerPort {
  constructor(
    private readonly foundation: P1ApplicationService,
    private readonly entitlementPolicy?: ProductEntitlementPolicyPort,
  ) {}

  async getUsageProjection(context: IntegrationContext) {
    const projection = await this.foundation.getUsageProjection(
      foundationContext(context),
      'copy',
    );
    if (
      projection.allowance !== 0 ||
      projection.reserved !== 0 ||
      projection.committed !== 0
    ) {
      return projection;
    }
    const opening = await resolveGenerationOpeningEntitlement(
      this.entitlementPolicy,
      context.workspaceId,
      'copy',
    );
    return opening
      ? {
          allowance: opening.amount,
          reserved: 0,
          committed: 0,
          available: opening.amount,
        }
      : projection;
  }

  async prepare(input: Parameters<StrictByokLedgerPort['prepare']>[0]) {
    const context = foundationContext(input.context);
    const routeSnapshot: StrictByokRouteSnapshot = {
      id: `${input.idempotencyKey}:route`,
      workspaceId: input.context.workspaceId,
      endpointProfileId: input.endpointProfileId,
      catalogModelId: input.catalogModelId,
      credentialMode: 'byok_strict',
      credentialVersion: input.credentialVersion,
      fallbackConsent: false,
    };
    const jobId = `${routeSnapshot.id}:job`;
    const attemptId = `${routeSnapshot.id}:attempt`;
    const openingEntitlement = await resolveGenerationOpeningEntitlement(
      this.entitlementPolicy,
      input.context.workspaceId,
      'copy',
    );
    const checkpoint = await this.foundation.checkpointGenerationAttempt(
      context,
      {
        jobId,
        operation: 'copy',
        usageReservationId: `${routeSnapshot.id}:usage`,
        usageAmount: 1,
        ...(openingEntitlement ? { openingEntitlement } : {}),
        routeSnapshot: {
          id: routeSnapshot.id,
          catalogRevision: 'controlled-byok-endpoints-v1',
          policyRevision: 'byok-strict-no-fallback-v1',
          priceRevision: 'workspace-external-billing-v1',
          requestedCatalogModelId: input.catalogModelId,
          selectionMode: 'fixed',
          dataClass: 'public',
          dataClasses: ['public'],
          fallbackConsent: false,
          allowedCandidates: [
            {
              catalogModelId: input.catalogModelId,
              deploymentId: `byok:${input.endpointProfileId}:v${input.credentialVersion}`,
              region: input.region,
              credentialMode: 'byok_strict',
              credentialVersion: String(input.credentialVersion),
              policyRevision: 'byok-strict-no-fallback-v1',
              priceRevision: 'workspace-external-billing-v1',
              fallbackRank: 1,
            },
          ],
          retryOwner: 'product',
          providerRetryDisabled: true,
        },
        attempt: {
          id: attemptId,
          deploymentId: `byok:${input.endpointProfileId}:v${input.credentialVersion}`,
        },
      },
      `byok-checkpoint:${input.idempotencyKey}`,
    );
    if (!checkpoint.replayed) {
      return {
        decision: 'execute' as const,
        jobId,
        attemptId,
        routeSnapshot,
      };
    }

    const job = await this.foundation.getGenerationJob(context, jobId);
    const stored = readStoredOutcome(job.result);
    if (stored) {
      return {
        decision: 'recovered' as const,
        result: await this.publicResult(context, routeSnapshot, stored),
      };
    }
    return {
      decision: 'recovered' as const,
      result: await this.settle({
        context: input.context,
        idempotencyKey: input.idempotencyKey,
        jobId,
        attemptId,
        routeSnapshot,
        outcome: { status: 'failed' },
      }),
    };
  }

  async settle(input: Parameters<StrictByokLedgerPort['settle']>[0]) {
    const context = foundationContext(input.context);
    const publicStatus =
      input.outcome.status === 'completed'
        ? ('completed' as const)
        : input.outcome.status === 'unauthorized'
          ? ('failed' as const)
          : ('unknown' as const);
    const acceptance =
      input.outcome.status === 'completed'
        ? ('accepted' as const)
        : input.outcome.status === 'unauthorized'
          ? ('rejected_before_accept' as const)
          : ('acceptance_unknown' as const);
    const providerCostStatus =
      input.outcome.status === 'completed'
        ? ('externally_billed' as const)
        : ('unknown' as const);
    await this.foundation.settleProviderOutcome(
      context,
      {
        attemptId: input.attemptId,
        acceptance,
        providerCost: {
          id: `${input.attemptId}:cost:${publicStatus}`,
          attemptId: input.attemptId,
          stage: 'observed',
          amountMicros: null,
          currency: 'EXTERNAL',
          unit: 'provider_invoice',
          evidence:
            providerCostStatus === 'externally_billed'
              ? 'workspace_byok_billed_by_provider'
              : 'workspace_byok_cost_unknown',
          payer: 'workspace_byok',
          billingStatus: providerCostStatus,
        },
        result: {
          jobId: input.jobId,
          byokStatus: publicStatus,
          providerCostStatus,
          ...(input.outcome.status === 'completed'
            ? { output: input.outcome.output }
            : {}),
        },
        outcome:
          publicStatus === 'completed'
            ? { status: 'completed' }
            : publicStatus === 'failed'
              ? { status: 'failed', reason: 'provider_authorization_rejected' }
              : { status: 'unknown', reason: 'provider_acceptance_unknown' },
      },
      `byok-settlement:${input.idempotencyKey}:${publicStatus}`,
    );
    return this.publicResult(context, input.routeSnapshot, {
      status: publicStatus,
      providerCostStatus,
      ...(input.outcome.status === 'completed'
        ? { output: input.outcome.output }
        : {}),
    });
  }

  private async publicResult(
    context: P1Context,
    routeSnapshot: StrictByokRouteSnapshot,
    stored: StoredByokOutcome,
  ): Promise<StrictByokSubmissionResult> {
    const projection = await this.foundation.getUsageProjection(context, 'copy');
    if (stored.status === 'completed') {
      return {
        status: 'completed',
        output: stored.output ?? '',
        routeSnapshot,
        usage: {
          resource: 'copy',
          amount: 1,
          status: 'committed',
          available: projection.available,
        },
        providerCost: {
          status: 'externally_billed',
          billedTo: 'workspace',
        },
      };
    }
    if (stored.status === 'failed') {
      return {
        status: 'failed',
        routeSnapshot,
        usage: {
          resource: 'copy',
          amount: 1,
          status: 'refunded',
          available: projection.available,
        },
        providerCost: { status: 'unknown', billedTo: 'workspace' },
      };
    }
    return {
      status: 'unknown',
      routeSnapshot,
      usage: {
        resource: 'copy',
        amount: 1,
        status: 'reserved',
        available: projection.available,
      },
      providerCost: { status: 'unknown', billedTo: 'workspace' },
    };
  }
}

interface StoredByokOutcome {
  status: 'completed' | 'failed' | 'unknown';
  providerCostStatus: 'externally_billed' | 'unknown';
  output?: string;
}

function readStoredOutcome(
  value: Record<string, unknown> | undefined,
): StoredByokOutcome | undefined {
  if (!value) return undefined;
  const status = value.byokStatus;
  const providerCostStatus = value.providerCostStatus;
  if (
    (status !== 'completed' && status !== 'failed' && status !== 'unknown') ||
    (providerCostStatus !== 'externally_billed' &&
      providerCostStatus !== 'unknown')
  ) {
    return undefined;
  }
  return {
    status,
    providerCostStatus,
    ...(typeof value.output === 'string' ? { output: value.output } : {}),
  };
}

function foundationContext(context: IntegrationContext): P1Context {
  return {
    workspaceId: context.workspaceId,
    userId: context.userId,
    correlationId: context.correlationId,
  };
}
