import { createHash } from 'node:crypto';
import {
  P1ApplicationService,
} from '../foundation/application-service.js';
import {
  resolveGenerationOpeningEntitlement,
  type ProductEntitlementPolicyPort,
} from '../foundation/entitlement-policy.js';
export type {
  ProductEntitlementPolicy,
  ProductEntitlementPolicyPort,
} from '../foundation/entitlement-policy.js';
import type {
  GenerationDataClass,
  P1Context,
  UsageResource,
} from '../foundation/domain.js';
import { P1DomainError } from '../foundation/domain.js';
import type {
  ModelSupplyLedgerCheckpointInput,
  ModelSupplyLedgerPort,
  ModelSupplyResult,
  ProductUsage,
  ProviderAttempt,
  ProviderCost,
} from './index.js';

export class FoundationModelSupplyLedger implements ModelSupplyLedgerPort {
  constructor(
    private readonly foundation: P1ApplicationService,
    private readonly entitlementPolicy?: ProductEntitlementPolicyPort,
  ) {}

  async checkpointAttempt(input: ModelSupplyLedgerCheckpointInput) {
    const context = contextFor(input);
    const resource = usageResource(input.submission.operation);
    const usageQuantity = input.submission.productUsageQuantity ?? 1;
    const usageReservationId = `model-usage-${digest(input.jobId).slice(0, 28)}`;
    let replayed: boolean;

    if (input.ordinal === 1) {
      const alreadyCheckpointed = await this.hasGenerationCheckpoint(
        context,
        input.jobId,
      );
      const openingEntitlement = alreadyCheckpointed || usageQuantity === 0
        ? undefined
        : await resolveGenerationOpeningEntitlement(
            this.entitlementPolicy,
            input.submission.workspaceId,
            resource,
          );
      const checkpoint = await this.foundation.checkpointGenerationAttempt(
        context,
        {
          jobId: input.jobId,
          operation: resource,
          usageReservationId,
          usageAmount: usageQuantity,
          ...(openingEntitlement ? { openingEntitlement } : {}),
          routeSnapshot: {
            id: input.snapshot.id,
            catalogRevision: input.snapshot.catalogRevisionId,
            policyRevision:
              input.snapshot.policyRevision ??
              input.deployment.policyRevision ??
              'recorded-policy-v1',
            priceRevision:
              input.snapshot.priceRevision ??
              input.deployment.priceRevision ??
              'recorded-price-v1',
            requestedCatalogModelId:
              input.submission.selection.mode === 'auto'
                ? 'auto'
                : (input.submission.selection.catalogModelId ??
                  input.snapshot.actualCatalogModelId),
            selectionMode:
              input.submission.selection.mode === 'auto' ? 'llm_auto' : 'fixed',
            dataClass: primaryDataClass(input.submission.dataClass),
            dataClasses:
              input.submission.dataClass.length === 0
                ? ['public']
                : [...input.submission.dataClass].sort(),
            fallbackConsent: input.snapshot.fallbackConsent ?? false,
            allowedCandidates: routeCandidates(input),
            retryOwner: 'product',
            providerRetryDisabled: true,
          },
          attempt: {
            id: input.attemptId,
            deploymentId: input.deployment.id,
          },
        },
        `model-checkpoint:${input.jobId}:1`,
      );
      replayed = checkpoint.replayed;
    } else {
      const checkpoint = await this.foundation.checkpointProviderAttempt(
        context,
        {
          id: input.attemptId,
          jobId: input.jobId,
          deploymentId: input.deployment.id,
        },
        `model-checkpoint:${input.jobId}:${input.ordinal}`,
      );
      replayed = checkpoint.replayed;
    }

    if (!replayed) return { replayed: false };

    const job = await this.foundation.getGenerationJob(context, input.jobId);
    if (job.result && isModelSupplyResult(job.result)) {
      return {
        replayed: true,
        recoveredResult: structuredClone(job.result),
      };
    }

    const persistedAttempt = await this.foundation.getProviderAttempt(
      context,
      input.attemptId,
    );
    const acceptance =
      persistedAttempt.acceptance === 'pending'
        ? 'acceptance_unknown'
        : persistedAttempt.acceptance;
    const canSafelyFallback =
      acceptance === 'rejected_before_accept' &&
      input.submission.selection.mode === 'auto' &&
      input.snapshot.fallbackConsent === true &&
      input.ordinal < (input.snapshot.allowedCandidates?.length ?? 1);
    const attempt: ProviderAttempt = {
      id: persistedAttempt.id,
      jobId: persistedAttempt.jobId,
      catalogModelId: input.model.id,
      deploymentId: persistedAttempt.deploymentId,
      acceptance,
      ...(persistedAttempt.providerTaskRef
        ? { providerTaskRef: persistedAttempt.providerTaskRef }
        : {}),
      status: canSafelyFallback ? 'failed' : 'unknown',
      createdAt: persistedAttempt.createdAt,
    };
    const providerCost = recoveryCost(input.attemptId, input.deployment.region);
    const usage: ProductUsage = {
      id: usageReservationId,
      status: canSafelyFallback ? 'reserved' : acceptance === 'rejected_before_accept' ? 'refunded' : 'reserved',
      quantity: usageQuantity,
    };
    const recovered: ModelSupplyResult = {
      jobId: input.jobId,
      operation: input.submission.operation,
      status: canSafelyFallback ? 'failed' : 'unknown',
      ...(input.submission.origin
        ? { origin: structuredClone(input.submission.origin) }
        : {}),
      snapshot: structuredClone(input.snapshot),
      attempt,
      attempts: [...structuredClone(input.previousAttempts), attempt],
      usage,
      providerCost,
      providerCosts: [
        ...structuredClone(input.previousProviderCosts),
        providerCost,
      ],
    };
    await this.settleAttempt({
      submission: input.submission,
      result: recovered,
      evidence: 'recovered_checkpoint_without_outcome',
    });
    return { replayed: true, recoveredResult: recovered };
  }

  async settleAttempt(input: {
    submission: ModelSupplyLedgerCheckpointInput['submission'];
    result: ModelSupplyResult;
    evidence: string;
  }) {
    const context: P1Context = {
      workspaceId: input.submission.workspaceId,
      userId: input.submission.actorId,
      correlationId:
        input.submission.correlationId ??
        `model:${input.result.jobId}`,
    };
    const cost = input.result.providerCost;
    const outcome = foundationOutcome(input.result);
    await this.foundation.settleProviderOutcome(
      context,
      {
        attemptId: input.result.attempt.id,
        acceptance: input.result.attempt.acceptance,
        ...(input.result.attempt.providerTaskRef
          ? { providerTaskRef: input.result.attempt.providerTaskRef }
          : {}),
        providerCost: {
          id: input.result.providerCost.id,
          attemptId: input.result.attempt.id,
          stage: cost.status === 'observed' ? 'observed' : 'estimated',
          amountMicros: Math.max(0, Math.round(cost.amount * 1_000_000)),
          currency: cost.currency,
          unit: providerCostUnit(cost),
          evidence: input.evidence,
          payer:
            input.result.snapshot.credentialMode === 'byok_strict'
              ? 'workspace_byok'
              : 'platform',
        },
        result: { ...structuredClone(input.result) },
        outcome,
      },
      `model-settlement:${input.result.attempt.id}:${input.result.status}:${input.result.providerCost.status}`,
    );
  }

  async recordCancelledProviderTerminal(input: {
    submission: ModelSupplyLedgerCheckpointInput['submission'];
    result: ModelSupplyResult;
    evidence: string;
  }) {
    const context: P1Context = {
      workspaceId: input.submission.workspaceId,
      userId: input.submission.actorId,
      correlationId:
        input.submission.correlationId ?? `model:${input.result.jobId}`,
    };
    const cost = input.result.providerCost;
    await this.foundation.appendProviderCost(
      context,
      {
        id: cost.id,
        attemptId: input.result.attempt.id,
        stage: 'observed',
        amountMicros: Math.max(0, Math.round(cost.amount * 1_000_000)),
        currency: cost.currency,
        unit: providerCostUnit(cost),
        evidence: input.evidence,
        payer:
          input.result.snapshot.credentialMode === 'byok_strict'
            ? 'workspace_byok'
            : 'platform',
      },
      `model-late-provider-terminal:${cost.id}`,
    );
  }

  private async hasGenerationCheckpoint(context: P1Context, jobId: string) {
    try {
      await this.foundation.getGenerationJob(context, jobId);
      return true;
    } catch (error) {
      if (error instanceof P1DomainError && error.code === 'NOT_FOUND') {
        return false;
      }
      throw error;
    }
  }
}

function contextFor(input: ModelSupplyLedgerCheckpointInput): P1Context {
  return {
    workspaceId: input.submission.workspaceId,
    userId: input.submission.actorId,
    correlationId:
      input.submission.correlationId ?? `model:${input.jobId}`,
  };
}

function usageResource(
  operation: ModelSupplyLedgerCheckpointInput['submission']['operation'],
): UsageResource {
  if (operation.startsWith('copy.') || operation === 'text.respond') {
    return 'copy';
  }
  if (operation.startsWith('audio.')) return 'audio';
  if (operation === 'video.generate') return 'video';
  return 'image';
}

function primaryDataClass(
  dataClasses: ModelSupplyLedgerCheckpointInput['submission']['dataClass'],
): GenerationDataClass {
  return [...dataClasses].sort()[0] ?? 'public';
}

function routeCandidates(input: ModelSupplyLedgerCheckpointInput) {
  if (input.snapshot.allowedCandidates?.length) {
    return input.snapshot.allowedCandidates.map((candidate) => ({
      catalogModelId: candidate.catalogModelId,
      deploymentId: candidate.deploymentId,
      region: candidate.region === 'domestic' ? ('cn' as const) : ('global' as const),
      credentialMode: candidate.credentialMode,
      credentialVersion: candidate.credentialVersion,
      ...(candidate.providerModel
        ? { providerModel: candidate.providerModel }
        : {}),
      ...(candidate.endpointRevision
        ? { endpointRevision: candidate.endpointRevision }
        : {}),
      ...(candidate.executionChannelId
        ? { executionChannelId: candidate.executionChannelId }
        : {}),
      ...(candidate.deploymentLifecycleRevision
        ? { lifecycleRevision: candidate.deploymentLifecycleRevision }
        : {}),
      policyRevision: candidate.policyRevision,
      priceRevision: candidate.priceRevision,
      unitPriceMicros: candidate.unitPriceMicros,
      currency: candidate.currency,
      unit: candidate.unit,
      fallbackRank: candidate.fallbackRank,
      ...(candidate.activationStatus
        ? { activationStatus: candidate.activationStatus }
        : {}),
    }));
  }
  return [
    {
      catalogModelId: input.model.id,
      deploymentId: input.deployment.id,
      region:
        input.deployment.region === 'domestic'
          ? ('cn' as const)
          : ('global' as const),
      credentialMode: input.deployment.credentialMode ?? 'platform',
      credentialVersion:
        input.deployment.credentialVersion ?? 'recorded-credential-v1',
      ...(input.deployment.providerModel
        ? { providerModel: input.deployment.providerModel }
        : {}),
      ...(input.deployment.endpointRevision
        ? { endpointRevision: input.deployment.endpointRevision }
        : {}),
      ...(input.deployment.executionChannelId
        ? { executionChannelId: input.deployment.executionChannelId }
        : {}),
      ...(input.deployment.lifecycleRevision
        ? { lifecycleRevision: input.deployment.lifecycleRevision }
        : {}),
      policyRevision: input.deployment.policyRevision ?? 'recorded-policy-v1',
      priceRevision: input.deployment.priceRevision ?? 'recorded-price-v1',
      unitPriceMicros: input.deployment.unitPrice?.amountMicros ?? 0,
      currency:
        input.deployment.unitPrice?.currency ??
        (input.deployment.region === 'domestic' ? 'CNY' : 'USD'),
      unit: input.deployment.unitPrice?.unit ?? 'request',
      fallbackRank: input.ordinal,
      ...(input.deployment.activationEvidence
        ? {
            activationStatus:
              input.deployment.activationEvidence.status,
          }
        : {}),
    },
  ];
}

function foundationOutcome(result: ModelSupplyResult) {
  if (result.status === 'completed') {
    return {
      status: 'completed' as const,
      ...(result.asset
        ? {
            asset: {
              id: result.asset.id,
              jobId: result.jobId,
              attemptId: result.attempt.id,
              objectKey: result.asset.objectKey,
              sha256: result.asset.sha256,
              sizeBytes: result.asset.sizeBytes,
              mediaType: result.asset.contentType,
            },
          }
        : {}),
    };
  }
  if (result.status === 'unknown') {
    return {
      status: 'unknown' as const,
      reason: 'provider_acceptance_or_delivery_unknown',
    };
  }
  if (
    result.attempt.acceptance === 'rejected_before_accept' &&
    result.usage.status === 'reserved'
  ) {
    return {
      status: 'retryable_rejection' as const,
      reason: 'provider_rejected_before_accept',
    };
  }
  return { status: 'failed' as const, reason: 'provider_failed' };
}

function providerCostUnit(cost: ProviderCost) {
  if (cost.usage.mediaUnits !== undefined) return 'media_unit';
  if (
    cost.usage.inputTokens !== undefined ||
    cost.usage.outputTokens !== undefined
  ) {
    return 'token';
  }
  return 'request';
}

function recoveryCost(
  attemptId: string,
  region: 'domestic' | 'overseas',
): ProviderCost {
  return {
    id: `provider-cost-${digest(`${attemptId}:estimated`).slice(0, 24)}`,
    status: 'estimated',
    amount: 0,
    currency: region === 'domestic' ? 'CNY' : 'USD',
    usage: {},
  };
}

function isModelSupplyResult(
  value: Record<string, unknown>,
): value is Record<string, unknown> & ModelSupplyResult {
  return (
    typeof value.jobId === 'string' &&
    (value.status === 'completed' ||
      value.status === 'unknown' ||
      value.status === 'failed') &&
    typeof value.snapshot === 'object' &&
    typeof value.attempt === 'object' &&
    Array.isArray(value.attempts) &&
    typeof value.usage === 'object' &&
    typeof value.providerCost === 'object' &&
    Array.isArray(value.providerCosts)
  );
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
