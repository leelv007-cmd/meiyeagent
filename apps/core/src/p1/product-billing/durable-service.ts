import { createHash } from 'node:crypto';
import type {
  BuildProductQuoteInput,
  ProductQuoteSnapshot,
  ProductUsageRecord,
  ProviderCostSnapshot,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
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
  type ReplaceReservedQuoteInput,
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
  submissionContractHash: string;
  submissionInputAssetsHash?: string;
  submissionPromptHash?: string;
  submissionReferenceAssetsHash?: string;
  targetSeconds?: number;
}

export interface ClaimMerchantExecutionInput extends MerchantExecutionContract {
  effectKey: string;
  inputAssetsHash: string;
  idempotencyKey: string;
  inputSnapshot: MerchantExecutionInputSnapshot;
  promptHash: string;
  providerCatalogModelId: string;
  providerOperation: string;
  referenceAssetsHash: string;
  taskId: string;
  workspaceId: string;
}

export interface MerchantExecutionInputSnapshot {
  input: Record<string, unknown> | null;
  /** Exact provider system instructions, when the upstream API accepts them separately. */
  instructions?: string;
  prompt: string;
  /** JSON schema handed to a structured-output provider. */
  schema?: Record<string, unknown>;
  schemaName?: string;
  schemaRevision?: string;
  streaming?: boolean;
}

/** Server-only binding of the exact primary submission that will reach a provider. */
export interface MerchantExecutionInputBindingPort {
  bindMerchantExecutionInput(input: {
    inputSnapshot: MerchantExecutionInputSnapshot;
    quoteRevision: string;
    taskId: string;
    workspaceId: string;
  }): MaybePromise<void>;
}

/** Selects one completed auxiliary provider effect as the task's canonical result. */
export interface MerchantExecutionPromotionPort {
  promoteMerchantExecution(input: {
    quoteRevision: string;
    sourceEffectKey: string;
    taskId: string;
    workspaceId: string;
  }): MaybePromise<void>;
}

/**
 * Freezes the submitted intent text and role-tagged source assets as the task's
 * admission identity, before the first auxiliary effect runs. This is not the
 * exact provider input: that authority is each effect's own claim binding, plus
 * promotion of the effect chosen as the primary result.
 */
export interface MerchantSubmissionInputBindingPort {
  bindMerchantSubmissionInput(input: {
    inputSnapshot: MerchantExecutionInputSnapshot;
    quoteRevision: string;
    taskId: string;
    workspaceId: string;
  }): MaybePromise<void>;
}

export function merchantExecutionInputHashes(input: MerchantExecutionInputSnapshot) {
  const source = input.input ?? {};
  const referenceAssetIds = Array.isArray(source.referenceAssetIds)
    ? source.referenceAssetIds.filter((value): value is string => typeof value === 'string').sort()
    : [];
  const inputAssets = Array.isArray(source.inputAssets)
    ? source.inputAssets
        .filter(
          (value): value is { assetId: string; role: string } =>
            typeof value === 'object' &&
            value !== null &&
            typeof (value as { assetId?: unknown }).assetId === 'string' &&
            typeof (value as { role?: unknown }).role === 'string',
        )
        .map(({ assetId, role }) => ({ assetId, role }))
        .sort((left, right) => fingerprintValue(left).localeCompare(fingerprintValue(right)))
    : [];
  return {
    inputAssetsHash: fingerprintValue(inputAssets),
    promptHash: fingerprintValue(input.prompt),
    referenceAssetsHash: fingerprintValue(referenceAssetIds),
  };
}

export interface MerchantExecutionBillingPort
  extends MerchantExecutionInputBindingPort {
  readMerchantExecutionContract(
    input: Pick<ClaimMerchantExecutionInput, 'taskId' | 'workspaceId'>,
  ): MaybePromise<MerchantExecutionContract>;
  claimMerchantExecution<T = unknown>(
    input: ClaimMerchantExecutionInput,
  ): MaybePromise<
    | { decision: 'execute'; inputSnapshot: MerchantExecutionInputSnapshot }
    | { decision: 'in_progress' }
    | { decision: 'replay'; result: T }
  >;
  completeMerchantExecution<T>(
    input: ClaimMerchantExecutionInput & { result: T },
  ): MaybePromise<T>;
  settleDurableMerchantExecutionResult?<T>(input: {
    effectKey: string;
    result: T;
    taskId: string;
    workspaceId: string;
  }): MaybePromise<T>;
}

function merchantExecutionContractHash(
  input: MerchantExecutionContract | ClaimMerchantExecutionInput,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        catalogModelId: input.catalogModelId,
        operation: input.operation,
        outputCount: input.outputCount,
        quoteRevision: input.quoteRevision,
        submissionContractHash: input.submissionContractHash,
        submissionPromptHash: input.submissionPromptHash,
        submissionReferenceAssetsHash: input.submissionReferenceAssetsHash,
        submissionInputAssetsHash: input.submissionInputAssetsHash,
        targetSeconds: input.targetSeconds ?? null,
        promptHash: 'promptHash' in input ? input.promptHash : null,
        referenceAssetsHash:
          'referenceAssetsHash' in input ? input.referenceAssetsHash : null,
        inputAssetsHash:
          'inputAssetsHash' in input ? input.inputAssetsHash : null,
        effectKey: 'effectKey' in input ? input.effectKey : null,
        inputSnapshot:
          'inputSnapshot' in input ? input.inputSnapshot : null,
        providerCatalogModelId:
          'providerCatalogModelId' in input ? input.providerCatalogModelId : null,
        providerOperation:
          'providerOperation' in input ? input.providerOperation : null,
      }),
    )
    .digest('hex');
}

function merchantExecutionResultJobId(result: unknown) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const jobId = (result as { jobId?: unknown }).jobId;
  return typeof jobId === 'string' && jobId.trim().length > 0 ? jobId : null;
}

function merchantExecutionMatchesReservation(
  input: ClaimMerchantExecutionInput,
  quote: ProductQuoteSnapshot | null,
  usage: ProductUsageRecord | null,
) {
  return Boolean(
    quote &&
      usage &&
      quote.workspaceId === input.workspaceId &&
      quote.taskId === input.taskId &&
      quote.revision === input.quoteRevision &&
      (quote.lifecycleStatus === 'reserved' ||
        quote.lifecycleStatus === 'dispatched') &&
      quote.operation === input.operation &&
      quote.catalogModelId === input.catalogModelId &&
      quote.outputCount === input.outputCount &&
      quote.submissionContractHash === input.submissionContractHash &&
      quote.submissionPromptHash === input.submissionPromptHash &&
      quote.submissionReferenceAssetsHash ===
        input.submissionReferenceAssetsHash &&
      quote.submissionInputAssetsHash === input.submissionInputAssetsHash &&
      (quote.targetSeconds ?? null) === (input.targetSeconds ?? null) &&
      usage.workspaceId === input.workspaceId &&
      usage.taskId === input.taskId &&
      usage.quoteId === quote.quoteId &&
      usage.status === 'reserved',
  );
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
  replaceReservedQuote(
    input: ReplaceReservedQuoteInput & WorkspaceInput,
  ): MaybePromise<{
    previous: ProductQuoteSnapshot;
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
    MerchantExecutionBillingPort,
    MerchantExecutionInputBindingPort,
    MerchantExecutionPromotionPort,
    MerchantSubmissionInputBindingPort
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

  async replaceReservedQuote(
    input: ReplaceReservedQuoteInput & WorkspaceInput,
  ) {
    const workspaceId = this.workspace(input.workspaceId);
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [
          `quote:${input.previousQuoteId}`,
          `quote:${input.successor.quoteId}`,
          `task:${input.taskId}`,
        ],
        async (transaction) => {
          const service = await this.requireLocalByQuote(
            transaction,
            workspaceId,
            input.previousQuoteId,
          );
          const result = service.replaceReservedQuote(input);
          await transaction.saveQuote(workspaceId, result.previous);
          await transaction.saveQuote(workspaceId, result.quote);
          await transaction.saveUsage(workspaceId, result.usage);
          return result;
        },
      ),
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

  async bindMerchantExecutionInput(input: {
    inputSnapshot: MerchantExecutionInputSnapshot;
    quoteRevision: string;
    taskId: string;
    workspaceId: string;
  }): Promise<void> {
    const workspaceId = this.workspace(input.workspaceId);
    const effectKey = `merchant-execution:${input.taskId}`;
    const inputFingerprint = fingerprintValue(input.inputSnapshot);
    await this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`task:${input.taskId}`, `merchant-effect:${effectKey}`],
        async (transaction) => {
          const quote = await transaction.getQuoteByTask(
            workspaceId,
            input.taskId,
          );
          const usage = await transaction.getUsage(workspaceId, input.taskId);
          const existing = await transaction.getMerchantExecution(
            workspaceId,
            input.taskId,
            effectKey,
          );
          if (existing) {
            if (
              fingerprintValue(existing.inputSnapshot) !== inputFingerprint
            ) {
              throw new P1DomainError(
                'INVALID_STATE',
                'Primary merchant execution input is already bound to another provider submission.',
              );
            }
            if (
              quote?.workspaceId === workspaceId &&
              quote.taskId === input.taskId &&
              quote.revision === input.quoteRevision
            ) {
              return;
            }
          }
          if (
            !quote ||
            !usage ||
            quote.workspaceId !== workspaceId ||
            quote.taskId !== input.taskId ||
            quote.revision !== input.quoteRevision ||
            (quote.lifecycleStatus !== 'reserved' &&
              quote.lifecycleStatus !== 'dispatched') ||
            usage.workspaceId !== workspaceId ||
            usage.taskId !== input.taskId ||
            usage.quoteId !== quote.quoteId ||
            usage.status !== 'reserved'
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Primary merchant execution input must bind to the exact reserved credit quote.',
            );
          }
          const rootBinding = [
            quote.submissionPromptHash,
            quote.submissionReferenceAssetsHash,
            quote.submissionInputAssetsHash,
          ];
          if (rootBinding.some(Boolean) && rootBinding.some((value) => !value)) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Merchant submission input binding is incomplete.',
            );
          }
          if (rootBinding.every((value) => !value)) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Merchant submission input must bind before primary provider input.',
            );
          }
          await transaction.saveMerchantExecution({
            contractHash: fingerprintValue({
              inputSnapshot: input.inputSnapshot,
              quoteRevision: input.quoteRevision,
            }),
            effectKey,
            idempotencyKey: `merchant-execution-binding:${input.taskId}:${input.quoteRevision}`,
            inputSnapshot: structuredClone(input.inputSnapshot),
            status: 'bound',
            taskId: input.taskId,
            workspaceId,
          });
        },
      ),
    );
  }

  async promoteMerchantExecution(input: {
    quoteRevision: string;
    sourceEffectKey: string;
    taskId: string;
    workspaceId: string;
  }): Promise<void> {
    const workspaceId = this.workspace(input.workspaceId);
    const rootEffectKey = `merchant-execution:${input.taskId}`;
    if (
      input.sourceEffectKey === rootEffectKey ||
      !input.sourceEffectKey.startsWith(`${rootEffectKey}:`)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Canonical merchant execution promotion requires an auxiliary task effect.',
      );
    }
    const promotionKey = `merchant-execution-promotion:${input.sourceEffectKey}`;
    await this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [
          `task:${input.taskId}`,
          `merchant-effect:${input.sourceEffectKey}`,
          `merchant-effect:${rootEffectKey}`,
        ],
        async (transaction) => {
          const existing = await transaction.getMerchantExecution(
            workspaceId,
            input.taskId,
            rootEffectKey,
          );
          if (existing) {
            if (
              existing.status === 'completed' &&
              existing.idempotencyKey === promotionKey
            ) {
              return;
            }
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              `Billing task ${input.taskId} already selected another canonical merchant execution.`,
            );
          }
          const [quote, usage, source] = await Promise.all([
            transaction.getQuoteByTask(workspaceId, input.taskId),
            transaction.getUsage(workspaceId, input.taskId),
            transaction.getMerchantExecution(
              workspaceId,
              input.taskId,
              input.sourceEffectKey,
            ),
          ]);
          if (
            !quote ||
            !usage ||
            quote.workspaceId !== workspaceId ||
            quote.taskId !== input.taskId ||
            quote.revision !== input.quoteRevision ||
            (quote.lifecycleStatus !== 'reserved' &&
              quote.lifecycleStatus !== 'dispatched') ||
            usage.workspaceId !== workspaceId ||
            usage.taskId !== input.taskId ||
            usage.quoteId !== quote.quoteId ||
            usage.status !== 'reserved' ||
            !source ||
            source.status !== 'completed' ||
            source.idempotencyKey !== input.sourceEffectKey ||
            source.result === undefined
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Canonical merchant execution requires a completed auxiliary effect on the exact reserved quote.',
            );
          }
          await transaction.saveMerchantExecution({
            contractHash: fingerprintValue({
              quoteRevision: input.quoteRevision,
              sourceContractHash: source.contractHash,
              sourceEffectKey: input.sourceEffectKey,
            }),
            effectKey: rootEffectKey,
            idempotencyKey: promotionKey,
            inputSnapshot: structuredClone(source.inputSnapshot),
            result: structuredClone(source.result),
            status: 'completed',
            taskId: input.taskId,
            workspaceId,
          });
        },
      ),
    );
  }

  async settleDurableMerchantExecutionResult<T>(input: {
    effectKey: string;
    result: T;
    taskId: string;
    workspaceId: string;
  }): Promise<T> {
    const workspaceId = this.workspace(input.workspaceId);
    const rootEffectKey = `merchant-execution:${input.taskId}`;
    if (
      input.effectKey !== rootEffectKey &&
      !input.effectKey.startsWith(`${rootEffectKey}:`)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Durable merchant execution result does not belong to its billing task.',
      );
    }
    if (merchantExecutionResultJobId(input.result) === null) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Durable merchant execution result requires its persisted provider job.',
      );
    }
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`task:${input.taskId}`, `merchant-effect:${input.effectKey}`],
        async (transaction) => {
          const existing = await transaction.getMerchantExecution(
            workspaceId,
            input.taskId,
            input.effectKey,
          );
          if (
            !existing ||
            existing.idempotencyKey !== input.effectKey ||
            existing.status === 'bound'
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Durable merchant execution result requires its exact claimed effect.',
            );
          }
          if (existing.status === 'completed') {
            if (fingerprintValue(existing.result) === fingerprintValue(input.result)) {
              return existing.result as T;
            }
            throw new P1DomainError(
              'IDEMPOTENCY_CONFLICT',
              'Durable merchant execution already completed with another result.',
            );
          }
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

  async bindMerchantSubmissionInput(input: {
    inputSnapshot: MerchantExecutionInputSnapshot;
    quoteRevision: string;
    taskId: string;
    workspaceId: string;
  }): Promise<void> {
    const workspaceId = this.workspace(input.workspaceId);
    const hashes = merchantExecutionInputHashes(input.inputSnapshot);
    await this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`task:${input.taskId}`],
        async (transaction) => {
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
            (quote.lifecycleStatus !== 'reserved' &&
              quote.lifecycleStatus !== 'dispatched') ||
            usage.workspaceId !== workspaceId ||
            usage.taskId !== input.taskId ||
            usage.quoteId !== quote.quoteId ||
            usage.status !== 'reserved'
          ) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Merchant execution input must bind to the exact reserved credit quote.',
            );
          }
          const existing = [
            quote.submissionPromptHash,
            quote.submissionReferenceAssetsHash,
            quote.submissionInputAssetsHash,
          ];
          if (existing.some(Boolean) && existing.some((value) => !value)) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Merchant execution input binding is incomplete.',
            );
          }
          if (existing.every(Boolean)) {
            if (
              quote.submissionPromptHash !== hashes.promptHash ||
              quote.submissionReferenceAssetsHash !== hashes.referenceAssetsHash ||
              quote.submissionInputAssetsHash !== hashes.inputAssetsHash
            ) {
              throw new P1DomainError(
                'INVALID_STATE',
                'Merchant execution input is already bound to another submission.',
              );
            }
            return;
          }
          await transaction.saveQuote(workspaceId, {
            ...quote,
            submissionInputAssetsHash: hashes.inputAssetsHash,
            submissionPromptHash: hashes.promptHash,
            submissionReferenceAssetsHash: hashes.referenceAssetsHash,
          });
        },
      ),
    );
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
      !quote.submissionContractHash ||
      !quote.submissionPromptHash ||
      !quote.submissionReferenceAssetsHash ||
      !quote.submissionInputAssetsHash ||
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
      submissionContractHash: quote.submissionContractHash,
      submissionPromptHash: quote.submissionPromptHash,
      submissionReferenceAssetsHash: quote.submissionReferenceAssetsHash,
      submissionInputAssetsHash: quote.submissionInputAssetsHash,
      ...(quote.targetSeconds === undefined
        ? {}
        : { targetSeconds: quote.targetSeconds }),
    };
  }

  async claimMerchantExecution<T = unknown>(
    input: ClaimMerchantExecutionInput,
  ): Promise<
    | { decision: 'execute'; inputSnapshot: MerchantExecutionInputSnapshot }
    | { decision: 'in_progress' }
    | { decision: 'replay'; result: T }
  > {
    const workspaceId = this.workspace(input.workspaceId);
    const suppliedHashes = merchantExecutionInputHashes(input.inputSnapshot);
    if (
      suppliedHashes.promptHash !== input.promptHash ||
      suppliedHashes.referenceAssetsHash !== input.referenceAssetsHash ||
      suppliedHashes.inputAssetsHash !== input.inputAssetsHash
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Merchant execution hashes must match the exact provider input snapshot.',
      );
    }
    const contractHash = merchantExecutionContractHash(input);
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        [`task:${input.taskId}`, `merchant-effect:${input.effectKey}`],
        async (transaction) => {
          const existing = await transaction.getMerchantExecution(
            workspaceId,
            input.taskId,
            input.effectKey,
          );
          const primaryMerchantEffect =
            input.effectKey === `merchant-execution:${input.taskId}`;
          if (existing) {
            if (existing.status === 'bound') {
              if (
                !primaryMerchantEffect ||
                fingerprintValue(existing.inputSnapshot) !==
                  fingerprintValue(input.inputSnapshot)
              ) {
                throw new P1DomainError(
                  'INVALID_STATE',
                  `Billing task ${input.taskId} primary merchant execution does not match its server binding.`,
                );
              }
              const quote = await transaction.getQuoteByTask(
                workspaceId,
                input.taskId,
              );
              const usage = await transaction.getUsage(
                workspaceId,
                input.taskId,
              );
              if (!merchantExecutionMatchesReservation(input, quote, usage)) {
                throw new P1DomainError(
                  'INVALID_STATE',
                  'Merchant execution must exactly match the reserved credit quote contract.',
                );
              }
              await transaction.saveMerchantExecution({
                ...existing,
                contractHash,
                idempotencyKey: input.idempotencyKey,
                status: 'claimed',
              });
              return {
                decision: 'execute' as const,
                inputSnapshot: structuredClone(existing.inputSnapshot),
              };
            }
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
            const quote = await transaction.getQuoteByTask(
              workspaceId,
              input.taskId,
            );
            const usage = await transaction.getUsage(
              workspaceId,
              input.taskId,
            );
            if (!merchantExecutionMatchesReservation(input, quote, usage)) {
              throw new P1DomainError(
                'INVALID_STATE',
                'Merchant execution must exactly match the reserved credit quote contract.',
              );
            }
            await transaction.saveMerchantExecution({
              ...existing,
              status: 'claimed',
            });
            return {
              decision: 'execute' as const,
              inputSnapshot: structuredClone(existing.inputSnapshot),
            };
          }

          const quote = await transaction.getQuoteByTask(
            workspaceId,
            input.taskId,
          );
          const usage = await transaction.getUsage(
            workspaceId,
            input.taskId,
          );
          if (primaryMerchantEffect) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Primary merchant execution requires an exact server-owned provider input binding.',
            );
          }
          if (!merchantExecutionMatchesReservation(input, quote, usage)) {
            throw new P1DomainError(
              'INVALID_STATE',
              'Merchant execution must exactly match the reserved credit quote contract.',
            );
          }
          await transaction.saveMerchantExecution({
            contractHash,
            effectKey: input.effectKey,
            idempotencyKey: input.idempotencyKey,
            inputSnapshot: structuredClone(input.inputSnapshot),
            status: 'claimed',
            taskId: input.taskId,
            workspaceId,
          });
          return {
            decision: 'execute' as const,
            inputSnapshot: structuredClone(input.inputSnapshot),
          };
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
        [`task:${input.taskId}`, `merchant-effect:${input.effectKey}`],
        async (transaction) => {
          const existing = await transaction.getMerchantExecution(
            workspaceId,
            input.taskId,
            input.effectKey,
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
    const current = await this.repository.getQuote(workspaceId, quoteId);
    const lockKeys = [
      `quote:${quoteId}`,
      ...(current?.taskId ? [`task:${current.taskId}`] : []),
    ];
    return this.run(() =>
      this.repository.withTransaction(
        workspaceId,
        lockKeys,
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
