import type {
  BuildProductQuoteInput,
  ProductQuoteSnapshot,
  ProductUsageRecord,
  ProviderCostSnapshot,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import type {
  BillingAttemptCost,
  BillingLifecyclePort,
  BillingResource,
} from './lifecycle-port.js';
import type {
  ProductBillingRepository,
  ProductBillingTransaction,
  ProductUsageProjection,
} from './postgres-repository.js';
import {
  ProductQuoteService,
  type ConfirmQuoteInput,
  type DispatchQuoteInput,
  type FallbackDispatchInput,
  type ReserveQuoteInput,
  type SettleQuoteInput,
  type TrustedUsageEvidence,
} from './quote-service.js';

type MaybePromise<T> = T | Promise<T>;
type WorkspaceInput = { workspaceId?: string };

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
  implements ProductBillingApplicationPort, BillingLifecyclePort
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
            resource: input.resource,
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
        billingMode: quote.billingMode,
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
  }) {
    await this.mutateTask(input.workspaceId, input.taskId, (service, quote) => {
      if (quote.lifecycleStatus === 'settled' || quote.lifecycleStatus === 'refunded') {
        return { quote };
      }
      if (input.providerCost) {
        const providerCost = {
          ...input.providerCost,
          billingMode: quote.billingMode,
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
