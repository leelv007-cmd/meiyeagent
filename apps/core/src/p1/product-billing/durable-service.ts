import { createHash } from 'node:crypto';
import type {
  BuildProductQuoteInput,
  ProductQuoteSnapshot,
  ProductUsageRecord,
  ProviderCostSnapshot,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import {
  providerBillingMode,
  type BillingAttemptCost,
  type BillingLifecyclePort,
  type BillingResource,
} from './lifecycle-port.js';
import type {
  ProductBillingRepository,
  ProductBillingTransaction,
  ProductUsageProjection,
} from './postgres-repository.js';
import {
  ProductQuoteService,
  productUsageUnitsForQuote,
  type ConfirmQuoteInput,
  type DispatchQuoteInput,
  type FallbackDispatchInput,
  type ReserveQuoteInput,
  type SettleQuoteInput,
  type TrustedUsageEvidence,
} from './quote-service.js';

type MaybePromise<T> = T | Promise<T>;
type WorkspaceInput = { workspaceId?: string };
const MERCHANT_EXECUTION_CLAIM_LEASE_MS = 60_000;

export interface MerchantExecutionContract {
  catalogModelId: string;
  operation: string;
  outputCount: number;
  quoteRevision: string;
  targetSeconds?: number;
}

export interface ClaimMerchantExecutionInput extends MerchantExecutionContract {
  idempotencyKey: string;
  taskId: string;
  workspaceId: string;
}

export interface MerchantExecutionBillingPort {
  readMerchantExecutionContract(
    input: Pick<ClaimMerchantExecutionInput, 'taskId' | 'workspaceId'>,
  ): MaybePromise<MerchantExecutionContract>;
  claimMerchantExecution<T = unknown>(
    input: ClaimMerchantExecutionInput,
  ): MaybePromise<
    | { decision: 'execute' }
    | { decision: 'in_progress' }
    | { decision: 'replay'; result: T }
  >;
  completeMerchantExecution<T>(
    input: ClaimMerchantExecutionInput & { result: T },
  ): MaybePromise<T>;
}

function merchantExecutionContractHash(
  input: MerchantExecutionContract,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        catalogModelId: input.catalogModelId,
        operation: input.operation,
        outputCount: input.outputCount,
        quoteRevision: input.quoteRevision,
        targetSeconds: input.targetSeconds ?? null,
      }),
    )
    .digest('hex');
}

function merchantExecutionClaimExpired(
  updatedAt: string | undefined,
  now: Date,
) {
  const claimedAt = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  return (
    Number.isFinite(claimedAt) &&
    now.getTime() - claimedAt >= MERCHANT_EXECUTION_CLAIM_LEASE_MS
  );
}

export interface ProductBillingApplicationPort {
  buildQuote(input: BuildProductQuoteInput): MaybePromise<ProductQuoteSnapshot>;
  getQuote(
    quoteId: string,
    workspaceId?: string,
  ): MaybePromise<ProductQuoteSnapshot | null>;
  getQuoteByTask(
    taskId: string,
    workspaceId?: string,
  ): MaybePromise<ProductQuoteSnapshot | null>;
  confirm(
    input: ConfirmQuoteInput & WorkspaceInput,
  ): MaybePromise<ProductQuoteSnapshot>;
  reserve(input: ReserveQuoteInput & WorkspaceInput): MaybePromise<{
    quote: ProductQuoteSnapshot;
    usage: ProductUsageRecord;
  }>;
  dispatch(input: DispatchQuoteInput & WorkspaceInput): MaybePromise<{
    quote: ProductQuoteSnapshot;
    providerCost?: ProviderCostSnapshot;
  }>;
  fallbackDispatch(
    input: FallbackDispatchInput & WorkspaceInput,
  ): MaybePromise<{
    quote: ProductQuoteSnapshot;
    providerCost?: ProviderCostSnapshot;
  }>;
  settle(input: SettleQuoteInput & WorkspaceInput): MaybePromise<{
    quote: ProductQuoteSnapshot;
    usage: ProductUsageRecord;
  }>;
  failAndRefund(input: {
    quoteId: string;
    workspaceId?: string;
    trustedUsage?: TrustedUsageEvidence;
    reason?: string;
    forceCreditRefund?: boolean;
  }): MaybePromise<{ quote: ProductQuoteSnapshot; usage: ProductUsageRecord }>;
  listProviderCosts(
    taskId: string,
    workspaceId?: string,
  ): MaybePromise<ProviderCostSnapshot[]>;
  getUsage(
    taskId: string,
    workspaceId?: string,
  ): MaybePromise<ProductUsageRecord | null>;
  getUsageProjection?(
    workspaceId: string,
  ): MaybePromise<ProductUsageProjection>;
  getMonthlyOutput?(
    workspaceId: string,
    month: string,
  ): MaybePromise<{ copy: number; image: number; video: number }>;
}

/** Durable, transaction-scoped use of the canonical ProductQuote algorithms. */
export class DurableProductBillingService
  implements
    ProductBillingApplicationPort,
    BillingLifecyclePort,
    MerchantExecutionBillingPort
{
  constructor(
    private readonly repository: ProductBillingRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async buildQuote(input: BuildProductQuoteInput) {
    const workspaceId = this.workspace(input.workspaceId);
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`quote:${input.quoteId}`],
        async (transaction) => {
          const existing = await transaction.getQuote(workspaceId, input.quoteId);
          const service = await this.localService(transaction, workspaceId, existing);
          const quote = service.buildQuote({ ...input, workspaceId });
          await transaction.saveQuote(workspaceId, quote);
          return quote;
        },
      ),
    );
  }

  getQuote(quoteId: string, workspaceId?: string) {
    return this.repository.getQuote(this.workspace(workspaceId), quoteId);
  }

  getQuoteByTask(taskId: string, workspaceId?: string) {
    return this.repository.getQuoteByTask(this.workspace(workspaceId), taskId);
  }

  async confirm(input: ConfirmQuoteInput & WorkspaceInput) {
    const workspaceId = this.workspace(input.workspaceId);
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`quote:${input.quoteId}`, `task:${input.taskId}`],
        async (transaction) => {
          const service = await this.requireLocalByQuote(
            transaction,
            workspaceId,
            input.quoteId,
          );
          const quote = service.confirm(input);
          await transaction.saveQuote(workspaceId, quote);
          return quote;
        },
      ),
    );
  }

  async reserve(input: ReserveQuoteInput & WorkspaceInput) {
    const workspaceId = this.workspace(input.workspaceId);
    return this.mutateQuote(workspaceId, input.quoteId, (service) =>
      service.reserve(input),
    );
  }

  async dispatch(input: DispatchQuoteInput & WorkspaceInput) {
    const workspaceId = this.workspace(input.workspaceId);
    return this.mutateQuote(workspaceId, input.quoteId, (service) =>
      service.dispatch(input),
    );
  }

  async fallbackDispatch(input: FallbackDispatchInput & WorkspaceInput) {
    const workspaceId = this.workspace(input.workspaceId);
    return this.mutateQuote(workspaceId, input.quoteId, (service) =>
      service.fallbackDispatch(input),
    );
  }

  async settle(input: SettleQuoteInput & WorkspaceInput) {
    const workspaceId = this.workspace(input.workspaceId);
    return this.mutateQuote(workspaceId, input.quoteId, (service) =>
      service.settle(input),
    );
  }

  async failAndRefund(
    input: {
      quoteId: string;
      trustedUsage?: TrustedUsageEvidence;
      reason?: string;
      forceCreditRefund?: boolean;
    } & WorkspaceInput,
  ) {
    const workspaceId = this.workspace(input.workspaceId);
    return this.mutateQuote(workspaceId, input.quoteId, (service) =>
      service.failAndRefund(input),
    );
  }

  listProviderCosts(taskId: string, workspaceId?: string) {
    return this.repository.listProviderCosts(this.workspace(workspaceId), taskId);
  }

  getUsage(taskId: string, workspaceId?: string) {
    return this.repository.getUsage(this.workspace(workspaceId), taskId);
  }

  async readMerchantExecutionContract(input: {
    taskId: string;
    workspaceId: string;
  }): Promise<MerchantExecutionContract> {
    const workspaceId = this.workspace(input.workspaceId);
    const quote = await this.repository.getQuoteByTask(workspaceId, input.taskId);
    const outputCount = quote?.outputCount;
    if (
      !quote ||
      quote.workspaceId !== workspaceId ||
      quote.taskId !== input.taskId ||
      !quote.catalogModelId ||
      !quote.operation ||
      !quote.revision ||
      typeof outputCount !== 'number' ||
      !Number.isSafeInteger(outputCount) ||
      outputCount < 1
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Merchant execution requires a complete reserved credit quote contract.',
      );
    }
    return {
      catalogModelId: quote.catalogModelId,
      operation: quote.operation,
      outputCount,
      quoteRevision: quote.revision,
      ...(quote.targetSeconds === undefined
        ? {}
        : { targetSeconds: quote.targetSeconds }),
    };
  }

  async claimMerchantExecution<T = unknown>(
    input: ClaimMerchantExecutionInput,
  ): Promise<
    | { decision: 'execute' }
    | { decision: 'in_progress' }
    | { decision: 'replay'; result: T }
  > {
    const workspaceId = this.workspace(input.workspaceId);
    const contractHash = merchantExecutionContractHash(input);
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`task:${input.taskId}`],
        async (transaction) => {
          const existing = await transaction.getMerchantExecution(
            workspaceId,
            input.taskId,
          );
          if (existing) {
            if (
              existing.contractHash !== contractHash ||
              existing.idempotencyKey !== input.idempotencyKey
            ) {
              throw new P1DomainError(
                'IDEMPOTENCY_CONFLICT',
                `Billing task ${input.taskId} is already bound to another merchant execution.`,
              );
            }
            if (existing.status === 'completed') {
              return { decision: 'replay' as const, result: existing.result as T };
            }
            if (!merchantExecutionClaimExpired(existing.updatedAt, this.clock())) {
              return { decision: 'in_progress' as const };
            }
            await transaction.saveMerchantExecution({
              ...existing,
              status: 'claimed',
            });
            return { decision: 'execute' as const };
          }

          const [quote, usage] = await Promise.all([
            transaction.getQuoteByTask(workspaceId, input.taskId),
            transaction.getUsage(workspaceId, input.taskId),
          ]);
          if (
            !quote ||
            !usage ||
            quote.workspaceId !== workspaceId ||
            quote.taskId !== input.taskId ||
            quote.revision !== input.quoteRevision ||
            quote.lifecycleStatus !== 'reserved' ||
            quote.operation !== input.operation ||
            quote.catalogModelId !== input.catalogModelId ||
            quote.outputCount !== input.outputCount ||
            (quote.targetSeconds ?? null) !== (input.targetSeconds ?? null) ||
            usage.workspaceId !== workspaceId ||
            usage.taskId !== input.taskId ||
            usage.quoteId !== quote.quoteId ||
            usage.status !== 'reserved'
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Merchant execution must exactly match the reserved credit quote contract.',
            );
          }
          await transaction.saveMerchantExecution({
            contractHash,
            idempotencyKey: input.idempotencyKey,
            status: 'claimed',
            taskId: input.taskId,
            workspaceId,
          });
          return { decision: 'execute' as const };
        },
      ),
    );
  }

  async completeMerchantExecution<T>(
    input: ClaimMerchantExecutionInput & { result: T },
  ): Promise<T> {
    const workspaceId = this.workspace(input.workspaceId);
    const contractHash = merchantExecutionContractHash(input);
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`task:${input.taskId}`],
        async (transaction) => {
          const existing = await transaction.getMerchantExecution(
            workspaceId,
            input.taskId,
          );
          if (
            !existing ||
            existing.contractHash !== contractHash ||
            existing.idempotencyKey !== input.idempotencyKey
          ) {
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              `Billing task ${input.taskId} merchant execution claim no longer matches.`,
            );
          }
          if (existing.status === 'completed') return existing.result as T;
          await transaction.saveMerchantExecution({
            ...existing,
            result: structuredClone(input.result),
            status: 'completed',
          });
          return input.result;
        },
      ),
    );
  }

  getUsageProjection(workspaceId: string) {
    return this.repository.getUsageProjection(this.workspace(workspaceId));
  }

  getMonthlyOutput(workspaceId: string, month: string) {
    return this.repository.getMonthlyOutput(this.workspace(workspaceId), month);
  }

  async assertAcceptedQuote(input: {
    workspaceId: string;
    taskId: string;
    quoteId: string;
    quoteRevision: string;
  }) {
    const quote = await this.repository.getQuote(input.workspaceId, input.quoteId);
    if (!quote) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Product quote ${input.quoteId} was not found.`,
      );
    }
    if (quote.taskId !== input.taskId) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} is not bound to task ${input.taskId}.`,
      );
    }
    if (quote.revision !== input.quoteRevision) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} revision no longer matches the accepted execution contract.`,
      );
    }
    if (
      quote.lifecycleStatus !== 'confirmed' &&
      quote.lifecycleStatus !== 'reserved'
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Product quote ${quote.quoteId} is not confirmed for submission.`,
      );
    }
    return quote;
  }

  async beforeSubmit(input: {
    workspaceId: string;
    taskId: string;
    quoteId?: string;
    quoteRevision: string;
    resource: BillingResource;
  }) {
    await this.run(() =>
      this.repository.withTransaction(
        input.workspaceId,
        [
          ...(input.quoteId ? [`quote:${input.quoteId}`] : []),
          `task:${input.taskId}`,
        ],
        async (transaction) => {
          const quote = input.quoteId
            ? await transaction.getQuote(input.workspaceId, input.quoteId)
            : await transaction.getQuoteByTask(input.workspaceId, input.taskId);
          if (!quote) {
            throw new P1DomainError(
              'NOT_FOUND',
              `Product quote for task ${input.taskId} was not found.`,
            );
          }
          if (quote.revision !== input.quoteRevision) {
            throw new P1DomainError(
              'INVALID_STATE',
              `Product quote ${quote.quoteId} revision no longer matches the accepted execution contract.`,
            );
          }
          // Confirm is an explicit user/product step; never auto-promote
          // quoted → confirmed inside reserve/submit.
          if (
            quote.lifecycleStatus !== 'confirmed' &&
            quote.lifecycleStatus !== 'reserved'
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              `Product quote ${quote.quoteId} is not confirmed for submission.`,
            );
          }
          if (quote.taskId !== input.taskId) {
            throw new P1DomainError(
              'INVALID_STATE',
              `Product quote ${quote.quoteId} is not bound to task ${input.taskId}.`,
            );
          }
          const service = await this.localService(
            transaction,
            input.workspaceId,
            quote,
          );
          const result = service.reserve({
            quoteId: quote.quoteId,
            units: productUsageUnitsForQuote(quote, input.resource),
          });
          await this.saveLocal(transaction, input.workspaceId, service, result.quote);
        },
      ),
    );
  }

  async dispatchAttempt(input: {
    workspaceId: string;
    taskId: string;
    attemptId: string;
    deploymentId: string;
    providerCost: BillingAttemptCost;
  }) {
    await this.mutateTask(input.workspaceId, input.taskId, (service, quote) => {
      const providerCost = {
        ...input.providerCost,
        billingMode: providerBillingMode(input.providerCost, quote.billingMode),
      };
      const costs = service.listProviderCosts(input.taskId);
      return costs.some((cost) => cost.attemptId === input.attemptId) ||
        costs.length === 0
        ? service.dispatch({
            attemptId: input.attemptId,
            deploymentId: input.deploymentId,
            providerCost,
            quoteId: quote.quoteId,
          })
        : service.fallbackDispatch({
            attemptId: input.attemptId,
            deploymentId: input.deploymentId,
            providerCost,
            quoteId: quote.quoteId,
          });
    });
  }

  async settleTask(input: {
    workspaceId: string;
    taskId: string;
    attemptId: string;
    deploymentId: string;
    status: 'completed' | 'failed';
    providerCost?: BillingAttemptCost;
    trustedUsage?: TrustedUsageEvidence;
    forceCreditRefund?: boolean;
  }) {
    await this.mutateTask(input.workspaceId, input.taskId, (service, quote) => {
      if (quote.lifecycleStatus === 'settled' || quote.lifecycleStatus === 'refunded') {
        return { quote };
      }
      if (input.providerCost) {
        const providerCost = {
          ...input.providerCost,
          billingMode: providerBillingMode(
            input.providerCost,
            quote.billingMode,
          ),
        };
        const costs = service.listProviderCosts(input.taskId);
        if (costs.some((cost) => cost.attemptId === input.attemptId)) {
          service.dispatch({
            attemptId: input.attemptId,
            deploymentId: input.deploymentId,
            providerCost,
            quoteId: quote.quoteId,
          });
        }
      }
      return input.status === 'completed'
        ? service.settle({
            attemptId: input.attemptId,
            quoteId: quote.quoteId,
            ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
          })
        : service.failAndRefund({
            quoteId: quote.quoteId,
            ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
            ...(input.forceCreditRefund ? { forceCreditRefund: true } : {}),
          });
    });
  }

  private async mutateQuote<T>(
    workspaceId: string,
    quoteId: string,
    mutation: (service: ProductQuoteService) => T,
  ) {
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`quote:${quoteId}`],
        async (transaction) => {
          const service = await this.requireLocalByQuote(
            transaction,
            workspaceId,
            quoteId,
          );
          const result = mutation(service);
          const quote = service.getQuote(quoteId)!;
          await this.saveLocal(transaction, workspaceId, service, quote);
          return result;
        },
      ),
    );
  }

  private async mutateTask<T extends { quote: ProductQuoteSnapshot }>(
    workspaceId: string,
    taskId: string,
    mutation: (
      service: ProductQuoteService,
      quote: ProductQuoteSnapshot,
    ) => T,
  ) {
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`task:${taskId}`],
        async (transaction) => {
          const quote = await transaction.getQuoteByTask(workspaceId, taskId);
          if (!quote) {
            throw new P1DomainError(
              'NOT_FOUND',
              `Product quote for task ${taskId} was not found.`,
            );
          }
          const service = await this.localService(transaction, workspaceId, quote);
          const result = mutation(service, quote);
          const current = service.getQuote(quote.quoteId)!;
          await this.saveLocal(transaction, workspaceId, service, current);
          return result;
        },
      ),
    );
  }

  private async requireLocalByQuote(
    transaction: ProductBillingTransaction,
    workspaceId: string,
    quoteId: string,
  ) {
    const quote = await transaction.getQuote(workspaceId, quoteId);
    if (!quote) {
      throw new P1DomainError('NOT_FOUND', `Quote ${quoteId} was not found.`);
    }
    return this.localService(transaction, workspaceId, quote);
  }

  private async localService(
    transaction: ProductBillingTransaction,
    workspaceId: string,
    quote: ProductQuoteSnapshot | null,
  ) {
    const service = new ProductQuoteService({ clock: this.clock });
    if (!quote) return service;
    const usage = quote.taskId
      ? await transaction.getUsage(workspaceId, quote.taskId)
      : null;
    const providerCosts = quote.taskId
      ? await transaction.listProviderCosts(workspaceId, quote.taskId)
      : [];
    service.restoreState({ quote, usage, providerCosts });
    return service;
  }

  private async saveLocal(
    transaction: ProductBillingTransaction,
    workspaceId: string,
    service: ProductQuoteService,
    quote: ProductQuoteSnapshot,
  ) {
    await transaction.saveQuote(workspaceId, quote);
    if (!quote.taskId) return;
    const usage = service.getUsage(quote.taskId);
    if (usage) await transaction.saveUsage(workspaceId, usage);
    for (const cost of service.listProviderCosts(quote.taskId)) {
      await transaction.saveProviderCost(workspaceId, cost);
    }
  }

  private workspace(workspaceId: string | undefined) {
    if (!workspaceId?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'workspaceId is required for durable product billing.',
      );
    }
    return workspaceId;
  }

  private async run<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'A ProductQuote, ProductUsage, or ProviderCost idempotency key is already bound to different facts.',
        );
      }
      throw error;
    }
  }
}
