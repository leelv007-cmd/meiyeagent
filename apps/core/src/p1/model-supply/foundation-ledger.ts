import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  P1ApplicationService,
  ZERO_VALUE_USAGE_RESERVATION_PREFIX,
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
  ProviderCostEvent,
  P1Context,
  UsageResource,
} from '../foundation/domain.js';
import { P1DomainError } from '../foundation/domain.js';
import type {
  GrantLotResource,
  GrantLotTransaction,
} from '../foundation/grant-lot.js';
import {
  buildProviderCostEventFromFreeze,
  buildSupplyRequestFreeze,
  SupplySideProductUsageBridge,
  type SupplySideProductUsageLookup,
  type SupplyRequestFreeze,
} from '../entitlement-pools/supply-ledger-fields.js';
import type { BillingLifecyclePort } from '../product-billing/lifecycle-port.js';
import { modelSupplyCheckpointToFoundationRoute } from '../route-snapshot-normalize.js';
import {
  evaluateModelFailover,
  usedModalityCapabilityIds,
} from './failover-semantics.js';
import type {
  ModelSupplyLedgerCheckpointInput,
  ModelSupplyLedgerPort,
  ModelSupplyResult,
  ProductUsage,
  ProviderAttempt,
  ProviderCost,
} from './index.js';

/**
 * Optional bilateral ledger bridge (Z2-WIRING / #92 + H2 + G1).
 * ProductUsage (#92) and supply freeze (H2) stay domain-owned; this ledger
 * only attaches durable freeze refs onto ProviderCost and ProductUsage facts.
 */
export interface FoundationModelSupplyLedgerBilateral {
  productUsage?: SupplySideProductUsageLookup;
  billingLifecycle?: BillingLifecyclePort;
  clock?: () => Date;
  /** Default shared pool id when freeze is synthesized from route snapshot. */
  defaultSupplyPoolId?: string;
  /** Durable H2 store shared by HTTP and Worker processes. */
  supplyFreezes?: {
    append(freeze: SupplyRequestFreeze): Promise<SupplyRequestFreeze>;
    get(freezeId: string): Promise<SupplyRequestFreeze | null>;
    getByProductUsageTask(
      workspaceId: string,
      productUsageTaskId: string,
    ): Promise<SupplyRequestFreeze | null>;
  };
}

export class FoundationModelSupplyLedger implements ModelSupplyLedgerPort {
  private readonly productUsageBridge?: SupplySideProductUsageBridge;
  private readonly billingLifecycle?: BillingLifecyclePort;
  private readonly clock: () => Date;
  private readonly defaultSupplyPoolId: string;
  private readonly supplyFreezes?: FoundationModelSupplyLedgerBilateral['supplyFreezes'];

  constructor(
    private readonly foundation: P1ApplicationService,
    private readonly entitlementPolicy?: ProductEntitlementPolicyPort,
    private readonly grantLots?: {
      consume(input: {
        workspaceId: string;
        resource: GrantLotResource;
        amount: number;
        transactionId: string;
        actorId: string;
        correlationId: string;
        createdAt: string;
      }): Promise<GrantLotTransaction[]> | GrantLotTransaction[];
      refundUsageOperation(input: {
        workspaceId: string;
        usageOperationId: string;
        refundOperationId: string;
        actorId: string;
        correlationId: string;
        createdAt: string;
      }): Promise<GrantLotTransaction[]> | GrantLotTransaction[];
    },
    bilateral: FoundationModelSupplyLedgerBilateral = {},
  ) {
    this.billingLifecycle = bilateral.billingLifecycle;
    this.clock = bilateral.clock ?? (() => new Date());
    this.productUsageBridge = bilateral.productUsage
      ? new SupplySideProductUsageBridge(bilateral.productUsage)
      : undefined;
    this.defaultSupplyPoolId =
      bilateral.defaultSupplyPoolId ?? 'pool-shared-default';
    this.supplyFreezes = bilateral.supplyFreezes;
  }

  /** Cross-process audit accessor for the durable ProductUsage association. */
  async getSupplyFreeze(
    workspaceId: string,
    taskId: string,
  ): Promise<SupplyRequestFreeze | null> {
    return this.supplyFreezes?.getByProductUsageTask(workspaceId, taskId) ?? null;
  }

  async checkpointAttempt(input: ModelSupplyLedgerCheckpointInput) {
    const context = contextFor(input);
    const resource = usageResource(input.submission.operation);
    const usageQuantity = input.submission.productUsageQuantity ?? 1;
    // Once the grant-lot ledger is assembled it is the sole allowance
    // authority. The generation job keeps a stable zero-value reservation
    // identity without creating a second ProductUsage event stream.
    const legacyUsageQuantity = this.grantLots ? 0 : usageQuantity;
    const usageOperationId = usageReservationIdFor(input.jobId);
    const usageReservationId = usageReservationIdFor(
      input.jobId,
      legacyUsageQuantity,
    );
    // S2b: snapshot conversion goes through canonical adapters (read-old → write-new).
    const routeSnapshot = modelSupplyCheckpointToFoundationRoute({
      snapshot: input.snapshot,
      model: input.model,
      deployment: input.deployment,
      submission: input.submission,
      ordinal: input.ordinal,
    });
    let replayed: boolean;

    if (input.ordinal === 1) {
      const alreadyCheckpointed = await this.hasGenerationCheckpoint(
        context,
        input.jobId,
      );
      if (alreadyCheckpointed) {
        // A pre-grant-lot ordinal-1 checkpoint already owns this job. Preserve
        // its persisted usage payload and never charge it a second time.
        replayed = true;
      } else {
        const openingEntitlement = legacyUsageQuantity === 0
          ? undefined
          : await resolveGenerationOpeningEntitlement(
              this.entitlementPolicy,
              input.submission.workspaceId,
              resource,
            );
        if (usageQuantity > 0 && this.grantLots) {
          // The grant-aware entitlement policy performs the one-time legacy
          // balance migration before grant lots become the execution authority.
          await resolveGenerationOpeningEntitlement(
            this.entitlementPolicy,
            input.submission.workspaceId,
            resource,
          );
          // Validate the permanent route and access facts before charging. The
          // stable operation id makes a successful consume replay-safe when the
          // following Foundation checkpoint has to be retried.
          await this.foundation.preflightGenerationCheckpoint(context, {
            routeSnapshot,
            deploymentId: input.deployment.id,
          });
          await this.grantLots.consume({
            workspaceId: input.submission.workspaceId,
            resource,
            amount: usageQuantity,
            transactionId: usageOperationId,
            actorId: input.submission.actorId,
            correlationId:
              input.submission.correlationId ?? `model:${input.jobId}`,
            createdAt: this.clock().toISOString(),
          });
        }
        const checkpoint = await this.foundation.checkpointGenerationAttempt(
          context,
          {
            jobId: input.jobId,
            operation: resource,
            usageReservationId,
            usageAmount: legacyUsageQuantity,
            ...(openingEntitlement ? { openingEntitlement } : {}),
            routeSnapshot,
            attempt: {
              id: input.attemptId,
              deploymentId: input.deployment.id,
            },
          },
          `model-checkpoint:${input.jobId}:1`,
        );
        replayed = checkpoint.replayed;
      }
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

    await this.checkpointProductBilling(input);
    if (!replayed) return { replayed: false };

    const job = await this.foundation.getGenerationJob(context, input.jobId);
    if (job.result && isModelSupplyResult(job.result)) {
      const recoveredResult = structuredClone(job.result);
      if (foundationOutcome(recoveredResult).status === 'failed') {
        await this.refundGrantUsage({
          workspaceId: input.submission.workspaceId,
          actorId: input.submission.actorId,
          correlationId: context.correlationId,
          jobId: recoveredResult.jobId,
          refundOperationId: `model-failure:${recoveredResult.jobId}`,
        });
      }
      await this.settleProductBilling({
        submission: input.submission,
        result: recoveredResult,
      });
      return {
        replayed: true,
        recoveredResult,
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
      input.snapshot.fallbackConsent === true &&
      (input.snapshot.fallbackAuthorized ??
        input.submission.selection.mode === 'auto') &&
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
      ...(input.submission.originRef
        ? { originRef: structuredClone(input.submission.originRef) }
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
    let freeze = await this.supplyFreezes?.get(
      `supply-freeze:${input.result.jobId}:${input.result.attempt.id}`,
    );
    if (!freeze) {
      const fallback = await this.attachBilateralFreeze(input);
      freeze =
        fallback && this.supplyFreezes
          ? await this.supplyFreezes.append(fallback)
          : fallback;
    }
    const stage = (
      cost.status === 'observed' ? 'observed' : 'estimated'
    ) as 'observed' | 'estimated';
    const amountMicros = Math.max(0, Math.round(cost.amount * 1_000_000));
    const payer =
      input.result.snapshot.credentialMode === 'byok_strict'
        ? ('workspace_byok' as const)
        : ('platform' as const);
    const existingProviderCost = (
      await this.foundation.listProviderCosts(
        context,
        input.result.attempt.id,
      )
    ).find((event) => event.id === cost.id && event.stage === stage);
    const existingProviderCostFacts = existingProviderCost
      ? providerCostEventFacts(existingProviderCost)
      : undefined;
    const providerCostSnapshot = freeze || cost.failover
      ? {
          attemptId: input.result.attempt.id,
          taskId:
            input.submission.billingTaskId ?? input.result.jobId,
          deploymentId: input.result.attempt.deploymentId,
          supplierPriceRevision:
            freeze?.supplierPriceRevision.id ??
            input.result.snapshot.priceRevision ??
            candidatePriceRevision(input.result) ??
            'unknown',
          billingMode: 'per_request' as const,
          unitPriceMicros:
            freeze?.supplierPriceRevision.amountMicros ??
            candidateUnitPriceMicros(input.result) ??
            amountMicros,
          currency:
            freeze?.supplierPriceRevision.currency ?? cost.currency,
          unit:
            freeze?.supplierPriceRevision.unit ?? providerCostUnit(cost),
          estimatedCostMicros:
            cost.status === 'estimated' ? amountMicros : null,
          ...(cost.status === 'observed'
            ? { observedCostMicros: amountMicros }
            : {}),
          ...(cost.failover
            ? { failover: structuredClone(cost.failover) }
            : {}),
          payer,
          billingStatus:
            cost.status === 'observed'
              ? ('known' as const)
              : ('estimated' as const),
        }
      : undefined;
    const providerCost: Omit<
      ProviderCostEvent,
      'workspaceId' | 'actorId' | 'correlationId' | 'createdAt'
    > = existingProviderCostFacts ?? (freeze
      ? (() => {
          const event = buildProviderCostEventFromFreeze({
            freeze,
            attemptId: input.result.attempt.id,
            stage,
            amountMicros,
            actorId: input.submission.actorId,
            correlationId: context.correlationId,
            createdAt: this.clock().toISOString(),
            payer,
          });
          return {
            id: cost.id,
            attemptId: input.result.attempt.id,
            stage,
            amountMicros: event.amountMicros ?? amountMicros,
            currency: event.currency as 'CNY' | 'USD',
            unit: event.unit,
            // Bridge H2 freeze refs onto ProviderCost evidence without dropping
            // the original settlement evidence token.
            evidence: `${input.evidence};${event.evidence}`,
            payer,
            ...(providerCostSnapshot
              ? { snapshot: structuredClone(providerCostSnapshot) }
              : {}),
          };
        })()
      : {
          id: input.result.providerCost.id,
          attemptId: input.result.attempt.id,
          stage,
          amountMicros,
          currency: cost.currency,
          unit: providerCostUnit(cost),
          evidence: input.evidence,
          payer,
          ...(providerCostSnapshot
            ? { snapshot: structuredClone(providerCostSnapshot) }
            : {}),
        });
    const settlement = {
      attemptId: input.result.attempt.id,
      acceptance: input.result.attempt.acceptance,
      ...(input.result.attempt.providerTaskRef
        ? { providerTaskRef: input.result.attempt.providerTaskRef }
        : {}),
      providerCost,
      result: { ...structuredClone(input.result) },
      outcome,
    };
    const settlementKey =
      `model-settlement:${input.result.attempt.id}:${input.result.status}:${input.result.providerCost.status}`;
    try {
      await this.foundation.settleProviderOutcome(
        context,
        settlement,
        settlementKey,
      );
    } catch (error) {
      if (
        !(error instanceof P1DomainError) ||
        error.code !== 'IDEMPOTENCY_CONFLICT'
      ) {
        throw error;
      }
      const winningProviderCost = (
        await this.foundation.listProviderCosts(
          context,
          input.result.attempt.id,
        )
      ).find((event) => event.id === cost.id && event.stage === stage);
      if (!winningProviderCost) throw error;
      const winningProviderCostFacts =
        providerCostEventFacts(winningProviderCost);
      if (isDeepStrictEqual(winningProviderCostFacts, providerCost)) {
        throw error;
      }
      await this.foundation.settleProviderOutcome(
        context,
        {
          ...settlement,
          providerCost: winningProviderCostFacts,
        },
        settlementKey,
      );
    }
    if (outcome.status === 'failed') {
      await this.refundGrantUsage({
        workspaceId: input.submission.workspaceId,
        actorId: input.submission.actorId,
        correlationId: context.correlationId,
        jobId: input.result.jobId,
        refundOperationId: `model-failure:${input.result.jobId}`,
      });
    }
    await this.settleProductBilling(input);
  }

  private async checkpointProductBilling(
    input: ModelSupplyLedgerCheckpointInput,
  ) {
    const taskId = input.submission.billingTaskId;
    if (!taskId) return;
    if (!this.billingLifecycle) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Product billing lifecycle is required for a billed model submission.',
      );
    }
    const candidate = input.snapshot.allowedCandidates?.find(
      (row) => row.deploymentId === input.deployment.id,
    );
    const unitPriceMicros =
      candidate?.unitPriceMicros ?? input.deployment.unitPrice?.amountMicros ?? 0;
    let failover:
      | import('@meiye/contracts').ProviderFailoverBillingEvent
      | undefined;
    if (input.previousAttempts.length > 0 && candidate) {
      const previousAttempt = input.previousAttempts.at(-1);
      const previous = input.snapshot.allowedCandidates?.find(
        (row) => row.deploymentId === previousAttempt?.deploymentId,
      );
      if (previous) {
        const decision = evaluateModelFailover({
          from: previous,
          to: candidate,
          degradationSurfaces: candidate.fallbackDegradationSurfaces,
          usedCapabilityIds: usedModalityCapabilityIds(
            input.snapshot.capabilityRequirements,
          ),
        });
        if (!decision.allowed) {
          throw new P1DomainError(
            'INVALID_STATE',
            `Fallback billing event rejected: ${decision.reason}.`,
          );
        }
        failover = decision.event;
      }
    }
    await this.billingLifecycle.dispatchAttempt({
      attemptId: input.attemptId,
      deploymentId: input.deployment.id,
      providerCost: {
        currency:
          candidate?.currency ?? input.deployment.unitPrice?.currency ?? 'CNY',
        estimatedCostMicros: unitPriceMicros,
        evidence: `routeSnapshotRef=${input.snapshot.id}`,
        evidenceKind: 'estimated',
        payer:
          input.snapshot.credentialMode === 'byok_strict'
            ? 'workspace_byok'
            : 'platform',
        ...(failover ? { failover } : {}),
        supplierPriceRevision:
          candidate?.priceRevision ??
          input.deployment.priceRevision ??
          input.snapshot.priceRevision ??
          'unknown',
        unit: candidate?.unit ?? input.deployment.unitPrice?.unit ?? 'request',
        unitPriceMicros,
      },
      taskId,
      workspaceId: input.submission.workspaceId,
    });
  }

  private async settleProductBilling(input: {
    submission: ModelSupplyLedgerCheckpointInput['submission'];
    result: ModelSupplyResult;
  }) {
    const taskId = input.submission.billingTaskId;
    if (!taskId || input.result.status === 'unknown') return;
    if (!this.billingLifecycle) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Product billing lifecycle is required for a billed model submission.',
      );
    }
    const snapshot = input.result.snapshot;
    const attempt = input.result.attempt;
    const candidate = snapshot.allowedCandidates?.find(
      (row) => row.deploymentId === attempt.deploymentId,
    );
    const canFallback =
      input.result.status === 'failed' &&
      input.result.usage.status === 'reserved' &&
      attempt.acceptance === 'rejected_before_accept' &&
      snapshot.fallbackConsent === true &&
      input.result.attempts.length < (snapshot.allowedCandidates?.length ?? 1);
    const cost = input.result.providerCost;
    const measuredDuration =
      input.result.asset?.technicalValidation?.evidenceKind === 'measured' &&
      Number.isFinite(input.result.asset.technicalValidation.durationSeconds) &&
      input.result.asset.technicalValidation.durationSeconds >= 0
        ? input.result.asset.technicalValidation.durationSeconds
        : undefined;
    const unitPriceMicros = candidate?.unitPriceMicros ?? 0;
    const providerCost = {
      currency: cost.currency,
      ...(cost.status === 'observed'
        ? {
            observedCostMicros: Math.max(
              0,
              Math.round(cost.amount * 1_000_000),
            ),
          }
        : {
            estimatedCostMicros: Math.max(
              0,
              Math.round(cost.amount * 1_000_000),
            ),
          }),
      evidence: `modelSupplyProviderCost=${cost.id}`,
      evidenceKind:
        cost.status === 'observed'
          ? ('provider_bill' as const)
          : ('estimated' as const),
      payer:
        snapshot.credentialMode === 'byok_strict'
          ? ('workspace_byok' as const)
          : ('platform' as const),
      supplierPriceRevision:
        candidate?.priceRevision ?? snapshot.priceRevision ?? 'unknown',
      unit: candidate?.unit ?? providerCostUnit(cost),
      unitPriceMicros,
      ...(cost.failover ? { failover: structuredClone(cost.failover) } : {}),
      ...(cost.usage.mediaUnits !== undefined
        ? { usageQuantity: cost.usage.mediaUnits, usageUnit: 'media_unit' }
        : {}),
    };
    if (input.result.usage.quantity === 0) {
      await this.billingLifecycle.dispatchAttempt({
        attemptId: attempt.id,
        deploymentId: attempt.deploymentId,
        providerCost,
        taskId,
        workspaceId: input.submission.workspaceId,
      });
      return;
    }
    if (canFallback) {
      await this.billingLifecycle.dispatchAttempt({
        attemptId: attempt.id,
        deploymentId: attempt.deploymentId,
        providerCost,
        taskId,
        workspaceId: input.submission.workspaceId,
      });
      return;
    }
    await this.billingLifecycle.settleTask({
      attemptId: attempt.id,
      deploymentId: attempt.deploymentId,
      providerCost,
      status: input.result.status,
      taskId,
      ...(measuredDuration !== undefined
        ? {
            trustedUsage: {
              actualSeconds: measuredDuration,
              evidenceRef: input.result.asset!.id,
              kind: 'media_duration' as const,
            },
          }
        : {}),
      workspaceId: input.submission.workspaceId,
    });
  }

  async freezeAttempt(input: ModelSupplyLedgerCheckpointInput) {
    return this.persistBilateralFreeze(input);
  }

  /**
   * Bilateral bridge: synthesize H2 SupplyRequestFreeze from the settled
   * RouteSnapshot (G1 credential/route fields) and optionally attach it to
   * the #92 ProductUsage task when that durable lookup is assembled.
   */
  private async attachBilateralFreeze(input: {
    submission: ModelSupplyLedgerCheckpointInput['submission'];
    result: ModelSupplyResult;
  }): Promise<SupplyRequestFreeze | null> {
    const snapshot = input.result.snapshot;
    const credentialVersion =
      snapshot.credentialVersion ??
      snapshot.allowedCandidates?.find(
        (candidate) => candidate.deploymentId === snapshot.deploymentId,
      )?.credentialVersion;
    if (!credentialVersion) return null;

    const candidate = snapshot.allowedCandidates?.find(
      (row) => row.deploymentId === snapshot.deploymentId,
    );
    if (!candidate || candidate.pricingStatus === 'unknown') return null;
    const resource = usageResource(input.submission.operation);
    const billingTaskId = input.submission.billingTaskId;
    const freeze = buildSupplyRequestFreeze({
      id: `supply-freeze:${input.result.jobId}:${input.result.attempt.id}`,
      workspaceId: input.submission.workspaceId,
      routeSnapshotRef: snapshot.id,
      credentialAccountVersion: credentialVersion,
      supplierRequestTaskId: input.result.attempt.id,
      usage: {
        resource,
        quantity: input.result.usage.quantity,
        unit: candidate.unit,
      },
      supplierPriceRevision: {
        id: candidate.priceRevision,
        deploymentId: snapshot.deploymentId,
        executionChannelId: candidate.executionChannelId ?? 'unknown',
        pricingTier: candidate.pricingTier ?? 'standard',
        amountMicros: candidate.unitPriceMicros,
        currency: candidate.currency,
        unit: candidate.unit,
        evidence: {
          source: 'gateway_estimate',
          note: 'z2_foundation_ledger_bridge',
        },
        revisionId: candidate.priceRevision,
      },
      supplyPoolId: snapshot.supplyPoolId ?? this.defaultSupplyPoolId,
      providerCostAttemptId: input.result.attempt.id,
      ...(billingTaskId ? { productUsageTaskId: billingTaskId } : {}),
      frozenAt: snapshot.createdAt,
    });

    if (this.productUsageBridge && billingTaskId) {
      return this.attachReservedProductUsage(billingTaskId, freeze);
    }
    return freeze;
  }

  private async attachReservedProductUsage(
    billingTaskId: string,
    freeze: SupplyRequestFreeze,
  ): Promise<SupplyRequestFreeze> {
    if (!this.productUsageBridge) return freeze;
    try {
      return await this.productUsageBridge.attachFreeze(
        billingTaskId,
        freeze,
      );
    } catch (error) {
      if (
        !(error instanceof P1DomainError) ||
        (error.code !== 'NOT_FOUND' && error.code !== 'INVALID_STATE')
      ) {
        throw error;
      }
      // Another process may persist the freeze and settle ProductUsage between
      // the initial freeze miss and the durable usage lookup.
      const competing = await this.supplyFreezes?.get(freeze.id);
      if (!competing) throw error;
      if (sameImmutableFreeze(competing, freeze)) return competing;
      return this.supplyFreezes!.append(freeze);
    }
  }

  private async persistBilateralFreeze(
    input: ModelSupplyLedgerCheckpointInput,
  ): Promise<SupplyRequestFreeze | null> {
    if (!this.supplyFreezes) return null;
    const snapshot = input.snapshot;
    const candidate = snapshot.allowedCandidates?.find(
      (row) => row.deploymentId === snapshot.deploymentId,
    );
    const credentialVersion =
      snapshot.credentialVersion ?? candidate?.credentialVersion;
    if (
      !credentialVersion ||
      !candidate ||
      candidate.pricingStatus === 'unknown'
    ) {
      return null;
    }
    const resource = usageResource(input.submission.operation);
    const billingTaskId = input.submission.billingTaskId;
    let freeze = buildSupplyRequestFreeze({
      id: `supply-freeze:${input.jobId}:${input.attemptId}`,
      workspaceId: input.submission.workspaceId,
      routeSnapshotRef: snapshot.id,
      credentialAccountVersion: credentialVersion,
      supplierRequestTaskId: input.attemptId,
      usage: {
        resource,
        quantity: input.submission.productUsageQuantity ?? 1,
        unit: candidate.unit,
      },
      supplierPriceRevision: {
        id: candidate.priceRevision,
        deploymentId: snapshot.deploymentId,
        executionChannelId: candidate.executionChannelId ?? 'unknown',
        pricingTier: candidate.pricingTier ?? 'standard',
        amountMicros: candidate.unitPriceMicros,
        currency: candidate.currency,
        unit: candidate.unit,
        evidence: {
          source: 'gateway_estimate',
          note: 'z2_foundation_ledger_bridge',
        },
        revisionId: candidate.priceRevision,
      },
      supplyPoolId: snapshot.supplyPoolId ?? this.defaultSupplyPoolId,
      ...(input.ordinal === 1 && billingTaskId
        ? { productUsageTaskId: billingTaskId }
        : {}),
      providerCostAttemptId: input.attemptId,
      frozenAt: snapshot.createdAt,
    });
    const existing = await this.supplyFreezes.get(freeze.id);
    if (existing) {
      // Replays after settlement may observe ProductUsage as committed. Let the
      // immutable durable store verify identical facts instead of requiring a
      // second reserved-state validation for an already-persisted freeze.
      if (isLegacyJobLinkedFreeze(existing, freeze, input.jobId)) {
        return existing;
      }
      if (sameImmutableFreeze(existing, freeze)) {
        return existing;
      }
      return this.supplyFreezes.append(freeze);
    }
    if (input.ordinal === 1 && billingTaskId && this.productUsageBridge) {
      freeze = await this.attachReservedProductUsage(billingTaskId, freeze);
    }
    const persisted = await this.supplyFreezes.append(freeze);
    return persisted;
  }

  /**
   * Td-2: outer video compose/label/validation failure after a child job
   * committed product usage — restore allowance via compensate (idempotent).
   */
  async compensateCommittedUsage(input: {
    workspaceId: string;
    actorId: string;
    correlationId?: string;
    jobId: string;
    reason: string;
  }) {
    const context: P1Context = {
      workspaceId: input.workspaceId,
      userId: input.actorId,
      correlationId: input.correlationId ?? `outer-fail:${input.jobId}`,
    };
    const compensation = await this.foundation.compensateCommittedUsage(
      context,
      { jobId: input.jobId, reason: input.reason },
      `outer-usage-compensate:${input.jobId}:${input.reason}`,
    );
    await this.refundGrantUsage({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      correlationId: context.correlationId,
      jobId: input.jobId,
      refundOperationId: `outer-failure:${input.jobId}`,
    });
    return compensation;
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

  private async refundGrantUsage(input: {
    workspaceId: string;
    actorId: string;
    correlationId: string;
    jobId: string;
    refundOperationId: string;
  }) {
    if (!this.grantLots) return [];
    return this.grantLots.refundUsageOperation({
      workspaceId: input.workspaceId,
      usageOperationId: usageReservationIdFor(input.jobId),
      refundOperationId: input.refundOperationId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      createdAt: this.clock().toISOString(),
    });
  }
}

function isLegacyJobLinkedFreeze(
  existing: SupplyRequestFreeze,
  replayed: SupplyRequestFreeze,
  jobId: string,
) {
  if (
    existing.productUsageTaskId !== jobId ||
    replayed.productUsageTaskId === jobId
  ) {
    return false;
  }
  const {
    productUsageTaskId: _existingProductUsageTaskId,
    frozenAt: _existingFrozenAt,
    ...existingFacts
  } = existing;
  const {
    productUsageTaskId: _replayedProductUsageTaskId,
    frozenAt: _replayedFrozenAt,
    ...replayedFacts
  } = replayed;
  return freezesMatchWithHistoricalPriceFields(
    existingFacts,
    replayedFacts,
  );
}

function sameImmutableFreeze(
  existing: SupplyRequestFreeze,
  replayed: SupplyRequestFreeze,
) {
  const { frozenAt: _existingFrozenAt, ...existingFacts } = existing;
  const { frozenAt: _replayedFrozenAt, ...replayedFacts } = replayed;
  return freezesMatchWithHistoricalPriceFields(
    existingFacts,
    replayedFacts,
  );
}

function freezesMatchWithHistoricalPriceFields(
  existing: Omit<SupplyRequestFreeze, 'frozenAt'>,
  replayed: Omit<SupplyRequestFreeze, 'frozenAt'>,
) {
  const comparableReplayed = structuredClone(replayed);
  if (!existing.supplierPriceRevision.executionChannelId) {
    delete comparableReplayed.supplierPriceRevision.executionChannelId;
  }
  if (!existing.supplierPriceRevision.pricingTier) {
    delete comparableReplayed.supplierPriceRevision.pricingTier;
  }
  return isDeepStrictEqual(existing, comparableReplayed);
}

function providerCostEventFacts(event: ProviderCostEvent) {
  const {
    workspaceId: _workspaceId,
    actorId: _actorId,
    correlationId: _correlationId,
    createdAt: _createdAt,
    ...facts
  } = event;
  return facts;
}

function usageReservationIdFor(jobId: string, quantity = 1) {
  const id = digest(jobId).slice(0, 28);
  return quantity === 0
    ? `${ZERO_VALUE_USAGE_RESERVATION_PREFIX}${id}`
    : `model-usage-${id}`;
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
              ...(result.asset.storageRevision
                ? { storageRevision: result.asset.storageRevision }
                : {}),
            },
          }
        : {}),
    };
  }
  if (result.status === 'unknown') {
    // Td-2: copy stream partial interrupt keeps acceptance_unknown evidence but
    // may mark usage refunded — still settle the refund terminal.
    if (result.usage.status === 'refunded') {
      return {
        status: 'failed' as const,
        reason: 'acceptance_unknown_refunded',
      };
    }
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

function resultCandidate(result: ModelSupplyResult) {
  return result.snapshot.allowedCandidates?.find(
    (candidate) => candidate.deploymentId === result.attempt.deploymentId,
  );
}

function candidatePriceRevision(result: ModelSupplyResult) {
  return resultCandidate(result)?.priceRevision;
}

function candidateUnitPriceMicros(result: ModelSupplyResult) {
  return resultCandidate(result)?.unitPriceMicros;
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
