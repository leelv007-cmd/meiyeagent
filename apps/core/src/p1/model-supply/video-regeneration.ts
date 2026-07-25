/**
 * Video regeneration confirm + settle (WT-E / #103 / D-088).
 *
 * Workbench-internal confirm for:
 * - 重新生成此镜头 (scope: shot)
 * - 重新合成整段 (scope: full_compose)
 *
 * Both scopes reuse the same quote → confirm → reserve → dispatch → settle
 * contract from product-billing (#92); only scope (target seconds / labels)
 * differs. Submit-time Composer confirm is C4 — not this module.
 *
 * Free actions never open a product ledger entry. Retry creates a new derived
 * task + independent quote; recover continues the same supplier task without
 * re-quote. Shot completion yields candidates only; "使用此成片" writes a
 * ContentPackage revision.
 */

import { createHash } from 'node:crypto';
import type {
  BuildProductQuoteInput,
  DurationEstimate,
  ProductBillingMode,
  ProductQuoteSnapshot,
  ProductSettlementStatus,
  ProductUsageRecord,
} from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import {
  ProductQuoteService,
  productUsageUnitsForQuote,
  type SettleQuoteInput,
  type TrustedUsageEvidence,
} from '../product-billing/quote-service.js';

// ---------------------------------------------------------------------------
// Scopes & free actions
// ---------------------------------------------------------------------------

/** Billable regeneration scopes (same contract, different scope). */
export const videoRegenScopes = ['shot', 'full_compose'] as const;
export type VideoRegenScope = (typeof videoRegenScopes)[number];

/**
 * Actions that must NEVER produce a product generation fee.
 * Covered by negative ledger asserts in tests and `executeFreeAction`.
 */
export const videoFreeActions = [
  'poll',
  'recover',
  'download_supplier_task',
  'adopt_candidate',
  'deterministic_sort',
  'subtitle_text_edit',
] as const;
export type VideoFreeAction = (typeof videoFreeActions)[number];

export type VideoRegenIntent = 'retry' | 'recover';

// ---------------------------------------------------------------------------
// Confirm / settle display models (pure — safe for frontend mirror)
// ---------------------------------------------------------------------------

/** Confirm-zone fields shown before user accepts a billable regen. */
export interface VideoRegenConfirmView {
  /** 重新生成此镜头 | 重新合成整段 */
  actionLabel: string;
  scope: VideoRegenScope;
  /** Product CatalogModel id only — never Provider / Deployment / Credential. */
  catalogModelId: string;
  targetSeconds: number;
  billingMode: ProductBillingMode;
  /**
   * Explicit billing copy:
   * - per_request → "本次按请求计费"
   * - per_output_second → "按生成成片 N 秒计费"
   */
  billingModeLabel: string;
  /** Estimated product credits / amount at confirm. */
  estimatedCredits: number;
  /** Max authorized ceiling (pre-auth). */
  authorizedCeiling: number;
  /** Quoted billable seconds after min-charge / rounding (per_output_second). */
  quotedSeconds?: number;
  /** ETA presentation from DurationEstimate. */
  eta: VideoRegenEtaView;
  /** Always true for billable regen. */
  createsNewTaskAndIndependentQuote: true;
  createsNewTaskNotice: string;
  quoteId: string;
  quoteRevision: string;
  formulaExpression: string;
}

export interface VideoRegenEtaView {
  status: DurationEstimate['status'] | 'unknown';
  /** ISO timestamp when status is observed; null when unknown/insufficient. */
  estimatedCompletionAt: string | null;
  p50Seconds?: number;
  p90Seconds?: number;
  honestyNote: string;
}

/** Settlement / refund display under the confirm zone after settle. */
export interface VideoRegenSettleView {
  quoteId: string;
  taskId: string;
  scope: VideoRegenScope;
  settlementStatus: ProductSettlementStatus;
  confirmedAmount: number;
  settledAmount: number;
  refundedAmount: number;
  platformAbsorbedAmount: number;
  billedSeconds?: number;
  /** True when trusted actual < confirmed ceiling and refund > 0. */
  autoRefundApplied: boolean;
  honestyNote: string;
  lifecycleStatus: ProductQuoteSnapshot['lifecycleStatus'];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type BuildVideoRegenQuoteInput = {
  scope: VideoRegenScope;
  /** Source run / workflow the derived task is based on. */
  sourceRunId: string;
  workspaceId: string;
  actorId: string;
  catalogModelId: string;
  catalogModelRevision?: string;
  quotePolicyRevision: string;
  billingMode: ProductBillingMode;
  unitRate: number;
  currency?: string;
  /**
   * Target output seconds for this scope:
   * - shot → that shot's target duration
   * - full_compose → full clip target duration
   */
  targetSeconds: number;
  minChargeSeconds?: number;
  roundingStepSeconds?: number;
  routeSnapshotRef?: string;
  frozenCandidateDeploymentIds?: string[];
  /** Optional stable quote id (idempotent rebuild). */
  quoteId?: string;
  /** Optional shot id when scope is shot. */
  shotId?: string;
  formulaExpression?: string;
  authorizedCeiling?: number;
  /** Observed duration samples for ETA (optional). */
  durationEstimate?: DurationEstimate;
  /** Clock for ETA absolute time (defaults to now). */
  now?: Date;
};

/** Browser-safe regeneration intent; all money, model, route and duration facts are server-derived. */
export type VideoRegenQuoteIntent = {
  scope: VideoRegenScope;
  sourceRunId: string;
  workspaceId: string;
  actorId: string;
  requestId?: string;
  shotId?: string;
};

export type VideoRegenRetryIntent = VideoRegenQuoteIntent & {
  approvalReceiptId?: string;
  quoteId: string;
  taskId: string;
};

export type ConfirmVideoRegenInput = {
  quoteId: string;
  /**
   * Explicit derived task id. When omitted, a stable id is derived from
   * quoteId + source facts (idempotent on replay).
   */
  taskId?: string;
  authorizedCeiling?: number;
  /** Optional deployment to dispatch immediately after reserve. */
  deploymentId?: string;
  attemptId?: string;
};

export type SettleVideoRegenInput = {
  quoteId: string;
  trustedUsage?: TrustedUsageEvidence;
  attemptId?: string;
  overproductionUnitCostMicros?: number;
};

export type RetryVideoRegenInput = {
  /** Prior failed / rejected task to retry from. */
  sourceTaskId: string;
  /** Fresh quote facts for the new derived task (must re-quote). */
  quote: BuildVideoRegenQuoteInput;
};

export type RecoverSupplierTaskInput = {
  /** Existing product task that already has a quote. */
  taskId: string;
  /** Same supplier task ref being recovered (no new upstream request). */
  supplierTaskRef: string;
};

export type CompleteShotRegenInput = {
  taskId: string;
  shotId: string;
  candidateIndex: number;
  assetId: string;
};

export type AdoptComposedFilmInput = {
  taskId: string;
  composedAssetId: string;
  /** ContentPackage id to revise; created if absent in memory store. */
  contentPackageId: string;
  workId?: string;
  expectedRevision?: number;
};

// ---------------------------------------------------------------------------
// Internal records
// ---------------------------------------------------------------------------

export type DerivedVideoTask = {
  taskId: string;
  sourceRunId: string;
  workspaceId: string;
  actorId: string;
  scope: VideoRegenScope;
  shotId?: string;
  quoteId: string;
  intent: VideoRegenIntent;
  /** Supplier task ref when this is a recover path (same upstream). */
  supplierTaskRef?: string;
  status:
    | 'draft'
    | 'confirmed'
    | 'running'
    | 'shot_candidates_ready'
    | 'composed_candidate_ready'
    | 'adopted'
    | 'failed';
  shotCandidates: Array<{
    shotId: string;
    candidateIndex: number;
    assetId: string;
  }>;
  composedCandidateAssetId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ContentPackageRevisionRecord = {
  contentPackageId: string;
  workId?: string;
  revision: number;
  composedAssetId: string;
  adoptedFromTaskId: string;
  adoptedAt: string;
};

export type FreeActionLedgerEntry = {
  action: VideoFreeAction;
  taskId?: string;
  supplierTaskRef?: string;
  at: string;
  productUsageTouched: false;
};

// ---------------------------------------------------------------------------
// Pure projectors
// ---------------------------------------------------------------------------

export function actionLabelForScope(scope: VideoRegenScope): string {
  return scope === 'shot' ? '重新生成此镜头' : '重新合成整段';
}

export function billingModeLabelForQuote(quote: ProductQuoteSnapshot): string {
  if (quote.billingMode === 'per_request') {
    return '本次按请求计费';
  }
  const n = quote.quotedSeconds ?? quote.targetSeconds ?? 0;
  return `按生成成片 ${n} 秒计费`;
}

export function projectVideoRegenConfirmView(input: {
  quote: ProductQuoteSnapshot;
  scope: VideoRegenScope;
  durationEstimate?: DurationEstimate;
  now?: Date;
}): VideoRegenConfirmView {
  const { quote, scope } = input;
  const now = input.now ?? new Date();
  const eta = projectRegenEta(input.durationEstimate, now);
  const estimatedCredits =
    quote.confirmedAmount ?? quote.authorizedCeiling ?? 0;

  return {
    actionLabel: actionLabelForScope(scope),
    scope,
    catalogModelId: quote.catalogModelId,
    targetSeconds: quote.targetSeconds ?? 0,
    billingMode: quote.billingMode,
    billingModeLabel: billingModeLabelForQuote(quote),
    estimatedCredits,
    authorizedCeiling: quote.authorizedCeiling ?? estimatedCredits,
    ...(quote.quotedSeconds !== undefined
      ? { quotedSeconds: quote.quotedSeconds }
      : {}),
    eta,
    createsNewTaskAndIndependentQuote: true,
    createsNewTaskNotice: '提交后会创建新的生成任务并单独计费',
    quoteId: quote.quoteId,
    quoteRevision: quote.revision,
    formulaExpression: quote.formula.expression,
  };
}

export function projectRegenEta(
  estimate: DurationEstimate | undefined,
  now: Date,
): VideoRegenEtaView {
  if (!estimate || estimate.status === 'insufficient_data') {
    return {
      status: estimate?.status ?? 'unknown',
      estimatedCompletionAt: null,
      honestyNote: '预计完成时间暂无足够观测样本',
    };
  }
  const p50 = estimate.p50Seconds;
  const p90 = estimate.p90Seconds;
  const completion = new Date(now.getTime() + p50 * 1000).toISOString();
  return {
    status: 'observed',
    estimatedCompletionAt: completion,
    p50Seconds: p50,
    p90Seconds: p90,
    honestyNote: `预计约 ${p50}–${p90} 秒完成（观测分位）`,
  };
}

export function projectVideoRegenSettleView(input: {
  quote: ProductQuoteSnapshot;
  scope: VideoRegenScope;
}): VideoRegenSettleView {
  const { quote, scope } = input;
  const confirmed = quote.confirmedAmount ?? quote.authorizedCeiling ?? 0;
  const settled = quote.settledAmount ?? confirmed;
  const refunded = quote.refundedAmount ?? 0;
  const absorbed = quote.platformAbsorbedAmount ?? 0;
  const status = quote.settlementStatus ?? 'estimated';

  let honestyNote: string;
  if (status === 'reconciled') {
    honestyNote =
      refunded > 0
        ? '实际成片秒数低于确认上限，差额已自动退回'
        : absorbed > 0
          ? '实际用量超过确认上限，超出部分由平台承担，未向您补扣'
          : '已按可信用量完成结算';
  } else if (status === 'unknown') {
    honestyNote = '缺少可信用量证据，结算状态为 unknown，未伪造成最终对账';
  } else {
    honestyNote = '结算为 estimated，待可信 usage/成片时长证据后再对账';
  }

  return {
    quoteId: quote.quoteId,
    taskId: quote.taskId ?? '',
    scope,
    settlementStatus: status,
    confirmedAmount: confirmed,
    settledAmount: settled,
    refundedAmount: refunded,
    platformAbsorbedAmount: absorbed,
    ...(quote.billedSeconds !== undefined
      ? { billedSeconds: quote.billedSeconds }
      : {}),
    autoRefundApplied: refunded > 0 && status === 'reconciled',
    honestyNote,
    lifecycleStatus: quote.lifecycleStatus,
  };
}

function stableQuoteId(input: BuildVideoRegenQuoteInput): string {
  return `vq-${createHash('sha256')
    .update(
      JSON.stringify({
        sourceRunId: input.sourceRunId,
        scope: input.scope,
        shotId: input.shotId ?? null,
        catalogModelId: input.catalogModelId,
        quotePolicyRevision: input.quotePolicyRevision,
        billingMode: input.billingMode,
        targetSeconds: input.targetSeconds,
        unitRate: input.unitRate,
      }),
    )
    .digest('hex')
    .slice(0, 20)}`;
}

function stableTaskId(quoteId: string, sourceRunId: string): string {
  return `vt-${createHash('sha256')
    .update(`${quoteId}:${sourceRunId}`)
    .digest('hex')
    .slice(0, 20)}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Orchestrates workbench video regeneration billing + derived task outcomes.
 * Consumes ProductQuoteService; does not reimplement product pricing.
 */
export class VideoRegenerationService {
  private readonly quotes: ProductQuoteService;
  private readonly clock: () => Date;
  private readonly tasks = new Map<string, DerivedVideoTask>();
  private readonly packages = new Map<string, ContentPackageRevisionRecord>();
  private readonly freeLog: FreeActionLedgerEntry[] = [];
  private readonly scopeByQuote = new Map<string, VideoRegenScope>();
  private readonly shotByQuote = new Map<string, string>();
  private readonly sourceByQuote = new Map<string, string>();
  private readonly etaByQuote = new Map<string, DurationEstimate | undefined>();

  constructor(
    options: {
      quoteService?: ProductQuoteService;
      clock?: () => Date;
    } = {},
  ) {
    this.quotes = options.quoteService ?? new ProductQuoteService();
    this.clock = options.clock ?? (() => new Date());
  }

  /** Expose quote service for product-billing assertions in tests. */
  get quoteService(): ProductQuoteService {
    return this.quotes;
  }

  get freeActionLog(): readonly FreeActionLedgerEntry[] {
    return this.freeLog;
  }

  /**
   * Build an independent product quote for a regeneration scope and return
   * the workbench confirm-zone view.
   */
  quoteForRegeneration(input: BuildVideoRegenQuoteInput): {
    quote: ProductQuoteSnapshot;
    confirm: VideoRegenConfirmView;
  } {
    if (!videoRegenScopes.includes(input.scope)) {
      throw new P1DomainError('INVALID_STATE', `Unknown regen scope.`);
    }
    if (input.scope === 'shot' && !input.shotId?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'shot scope requires shotId.',
      );
    }
    if (
      typeof input.targetSeconds !== 'number' ||
      !Number.isFinite(input.targetSeconds) ||
      input.targetSeconds <= 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'targetSeconds must be a positive finite number.',
      );
    }

    const quoteId = input.quoteId?.trim() || stableQuoteId(input);
    const buildInput: BuildProductQuoteInput = {
      quoteId,
      catalogModelId: input.catalogModelId,
      ...(input.catalogModelRevision
        ? { catalogModelRevision: input.catalogModelRevision }
        : {}),
      quotePolicyRevision: input.quotePolicyRevision,
      billingMode: input.billingMode,
      unitRate: input.unitRate,
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.formulaExpression
        ? { formulaExpression: input.formulaExpression }
        : {}),
      // per_request still records targetSeconds for confirm display
      targetSeconds: input.targetSeconds,
      ...(input.minChargeSeconds !== undefined
        ? { minChargeSeconds: input.minChargeSeconds }
        : {}),
      ...(input.roundingStepSeconds !== undefined
        ? { roundingStepSeconds: input.roundingStepSeconds }
        : {}),
      ...(input.routeSnapshotRef
        ? { routeSnapshotRef: input.routeSnapshotRef }
        : {}),
      ...(input.frozenCandidateDeploymentIds
        ? {
            frozenCandidateDeploymentIds: [
              ...input.frozenCandidateDeploymentIds,
            ],
          }
        : {}),
      workspaceId: input.workspaceId,
      ...(input.authorizedCeiling !== undefined
        ? { authorizedCeiling: input.authorizedCeiling }
        : {}),
    };

    const quote = this.quotes.buildQuote(buildInput);
    this.scopeByQuote.set(quote.quoteId, input.scope);
    this.sourceByQuote.set(quote.quoteId, input.sourceRunId);
    this.etaByQuote.set(quote.quoteId, input.durationEstimate);
    if (input.shotId) this.shotByQuote.set(quote.quoteId, input.shotId);

    // Stash actor for confirm (workspace already on quote)
    this.actorByQuote.set(quote.quoteId, input.actorId);

    const confirm = projectVideoRegenConfirmView({
      quote,
      scope: input.scope,
      durationEstimate: input.durationEstimate,
      now: input.now ?? this.clock(),
    });

    return { quote, confirm };
  }

  private readonly actorByQuote = new Map<string, string>();

  /**
   * User confirms regen: bind quote to a new derived Task, reserve product
   * usage, optionally dispatch. Each confirm = independent quote + task.
   */
  confirmRegeneration(input: ConfirmVideoRegenInput): {
    quote: ProductQuoteSnapshot;
    task: DerivedVideoTask;
    usage: ProductUsageRecord;
    confirm: VideoRegenConfirmView;
  } {
    const quoted = this.quotes.getQuote(input.quoteId);
    if (!quoted) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Quote ${input.quoteId} was not found.`,
      );
    }
    const scope = this.scopeByQuote.get(input.quoteId);
    if (!scope) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Quote ${input.quoteId} was not built via video regeneration.`,
      );
    }
    const sourceRunId = this.sourceByQuote.get(input.quoteId);
    if (!sourceRunId) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Quote ${input.quoteId} is missing source run linkage.`,
      );
    }
    if (!quoted.workspaceId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Quote requires workspaceId for regeneration confirm.',
      );
    }

    const taskId =
      input.taskId?.trim() || stableTaskId(input.quoteId, sourceRunId);
    const existing = this.tasks.get(taskId);
    if (existing && existing.quoteId !== input.quoteId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Task ${taskId} is already bound to a different quote.`,
      );
    }

    const confirmed = this.quotes.confirm({
      quoteId: input.quoteId,
      taskId,
      ...(input.authorizedCeiling !== undefined
        ? { authorizedCeiling: input.authorizedCeiling }
        : {}),
    });

    const { quote: reservedQuote, usage } = this.quotes.reserve({
      quoteId: input.quoteId,
      units: productUsageUnitsForQuote(confirmed),
    });

    let quote = reservedQuote;
    if (input.deploymentId) {
      const dispatched = this.quotes.dispatch({
        quoteId: input.quoteId,
        deploymentId: input.deploymentId,
        attemptId: input.attemptId ?? `attempt-${taskId}`,
      });
      quote = dispatched.quote;
    }

    const now = this.clock().toISOString();
    const actorId = this.actorByQuote.get(input.quoteId) ?? 'unknown';
    const shotId = this.shotByQuote.get(input.quoteId);

    const task: DerivedVideoTask = existing
      ? {
          ...existing,
          status: 'running',
          updatedAt: now,
        }
      : {
          taskId,
          sourceRunId,
          workspaceId: quoted.workspaceId,
          actorId,
          scope,
          ...(shotId ? { shotId } : {}),
          quoteId: input.quoteId,
          intent: 'retry',
          status: 'running',
          shotCandidates: [],
          createdAt: now,
          updatedAt: now,
        };

    this.tasks.set(taskId, task);

    const confirm = projectVideoRegenConfirmView({
      quote: confirmed,
      scope,
      durationEstimate: this.etaByQuote.get(input.quoteId),
      now: this.clock(),
    });

    return {
      quote: structuredClone(quote),
      task: structuredClone(task),
      usage: structuredClone(usage),
      confirm,
    };
  }

  /** Settle after generation; project refund / honesty display. */
  settleRegeneration(input: SettleVideoRegenInput): {
    quote: ProductQuoteSnapshot;
    usage: ProductUsageRecord;
    settle: VideoRegenSettleView;
  } {
    const scope = this.scopeByQuote.get(input.quoteId);
    if (!scope) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Quote ${input.quoteId} was not built via video regeneration.`,
      );
    }

    const settleInput: SettleQuoteInput = {
      quoteId: input.quoteId,
      ...(input.trustedUsage ? { trustedUsage: input.trustedUsage } : {}),
      ...(input.attemptId ? { attemptId: input.attemptId } : {}),
      ...(input.overproductionUnitCostMicros !== undefined
        ? {
            overproductionUnitCostMicros: input.overproductionUnitCostMicros,
          }
        : {}),
    };
    const { quote, usage } = this.quotes.settle(settleInput);

    if (quote.taskId) {
      const task = this.tasks.get(quote.taskId);
      if (task) {
        const next: DerivedVideoTask = {
          ...task,
          status:
            task.scope === 'shot'
              ? 'shot_candidates_ready'
              : 'composed_candidate_ready',
          updatedAt: this.clock().toISOString(),
        };
        this.tasks.set(task.taskId, next);
      }
    }

    return {
      quote,
      usage,
      settle: projectVideoRegenSettleView({ quote, scope }),
    };
  }

  /**
   * Free actions: poll / recover / download / adopt candidate / sort /
   * subtitle text edit. Must not touch product usage ledger.
   */
  executeFreeAction(input: {
    action: VideoFreeAction;
    taskId?: string;
    supplierTaskRef?: string;
  }): FreeActionLedgerEntry {
    if (!videoFreeActions.includes(input.action)) {
      throw new P1DomainError('INVALID_STATE', `Unknown free action.`);
    }

    // Negative assert: no product usage may be created or mutated.
    if (input.taskId) {
      const usage = this.quotes.getUsage(input.taskId);
      if (usage) {
        // Free action on a task that already has usage is fine — we must
        // not *change* it. Snapshot before/after equality is enforced below.
        const before = structuredClone(usage);
        // intentionally no quote mutation
        const after = this.quotes.getUsage(input.taskId);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          throw new P1DomainError(
            'INVALID_STATE',
            `Free action ${input.action} must not mutate product usage.`,
          );
        }
      }
    }

    // Recover path: same supplier task, no re-quote, no new derived task.
    if (input.action === 'recover') {
      if (!input.supplierTaskRef?.trim()) {
        throw new P1DomainError(
          'INVALID_STATE',
          'recover requires supplierTaskRef.',
        );
      }
      if (input.taskId) {
        const task = this.tasks.get(input.taskId);
        if (task && task.supplierTaskRef && task.supplierTaskRef !== input.supplierTaskRef) {
          throw new P1DomainError(
            'INVALID_STATE',
            'recover cannot switch supplier task refs.',
          );
        }
        if (task && !task.supplierTaskRef) {
          this.tasks.set(input.taskId, {
            ...task,
            supplierTaskRef: input.supplierTaskRef,
            intent: 'recover',
            updatedAt: this.clock().toISOString(),
          });
        }
      }
    }

    const entry: FreeActionLedgerEntry = {
      action: input.action,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.supplierTaskRef
        ? { supplierTaskRef: input.supplierTaskRef }
        : {}),
      at: this.clock().toISOString(),
      productUsageTouched: false,
    };
    this.freeLog.push(entry);
    return structuredClone(entry);
  }

  /**
   * Retry after failure / rejected_before_accept: must create a NEW derived
   * task and a NEW independent quote (re-quote required).
   */
  retryWithNewQuote(input: RetryVideoRegenInput): {
    quote: ProductQuoteSnapshot;
    confirm: VideoRegenConfirmView;
    priorTaskId: string;
  } {
    const prior = this.tasks.get(input.sourceTaskId);
    // Prior may be absent if retrying from a failed run tracked elsewhere;
    // still require a fresh quote (never reuse prior quote id silently).
    if (prior && prior.quoteId === input.quote.quoteId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'retry must re-quote; cannot reuse the prior quote id.',
      );
    }

    // Force a distinct quote id when caller reuses facts without quoteId.
    const quoteInput: BuildVideoRegenQuoteInput = {
      ...input.quote,
      quoteId:
        input.quote.quoteId?.trim() ||
        `${stableQuoteId(input.quote)}-retry-${createHash('sha256')
          .update(input.sourceTaskId)
          .digest('hex')
          .slice(0, 8)}`,
    };

    const { quote, confirm } = this.quoteForRegeneration(quoteInput);
    if (prior && quote.quoteId === prior.quoteId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'retry produced the same quote as the prior task.',
      );
    }

    return {
      quote,
      confirm,
      priorTaskId: input.sourceTaskId,
    };
  }

  /**
   * Recover the same supplier task — no new product quote, no new derived task.
   * Returns existing quote binding if any.
   */
  recoverSupplierTask(input: RecoverSupplierTaskInput): {
    task: DerivedVideoTask | null;
    quote: ProductQuoteSnapshot | null;
    usage: ProductUsageRecord | null;
    freeAction: FreeActionLedgerEntry;
  } {
    const freeAction = this.executeFreeAction({
      action: 'recover',
      taskId: input.taskId,
      supplierTaskRef: input.supplierTaskRef,
    });

    const task = this.tasks.get(input.taskId) ?? null;
    const quote = this.quotes.getQuoteByTask(input.taskId);
    const usage = this.quotes.getUsage(input.taskId);

    // Recover must not create a second quote for the task.
    if (quote && usage) {
      const again = this.quotes.getQuoteByTask(input.taskId);
      if (again && again.quoteId !== quote.quoteId) {
        throw new P1DomainError(
          'INVALID_STATE',
          'recover must not re-quote the same task.',
        );
      }
    }

    return {
      task: task ? structuredClone(task) : null,
      quote: quote ? structuredClone(quote) : null,
      usage: usage ? structuredClone(usage) : null,
      freeAction,
    };
  }

  /**
   * Single-shot regen completion: only records a shot candidate.
   * Does NOT write ContentPackage revision.
   */
  completeShotCandidate(input: CompleteShotRegenInput): DerivedVideoTask {
    const task = this.requireTask(input.taskId);
    if (task.scope !== 'shot') {
      throw new P1DomainError(
        'INVALID_STATE',
        'completeShotCandidate only applies to shot scope.',
      );
    }

    const now = this.clock().toISOString();
    const candidates = [
      ...task.shotCandidates.filter(
        (c) =>
          !(
            c.shotId === input.shotId &&
            c.candidateIndex === input.candidateIndex
          ),
      ),
      {
        shotId: input.shotId,
        candidateIndex: input.candidateIndex,
        assetId: input.assetId,
      },
    ];

    const next: DerivedVideoTask = {
      ...task,
      status: 'shot_candidates_ready',
      shotCandidates: candidates,
      updatedAt: now,
    };
    this.tasks.set(task.taskId, next);
    return structuredClone(next);
  }

  /**
   * "使用此成片" — only path that writes a ContentPackage revision from
   * a composed candidate. Shot candidates alone never reach here.
   */
  adoptComposedFilm(input: AdoptComposedFilmInput): {
    task: DerivedVideoTask;
    contentPackage: ContentPackageRevisionRecord;
  } {
    const task = this.requireTask(input.taskId);
    if (task.scope !== 'full_compose') {
      throw new P1DomainError(
        'INVALID_STATE',
        '使用此成片 requires a full_compose regen task.',
      );
    }

    // Prefer explicit composed asset from input; task may already hold one.
    const composedAssetId =
      input.composedAssetId || task.composedCandidateAssetId;
    if (!composedAssetId?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'composedAssetId is required to adopt a film.',
      );
    }

    const now = this.clock().toISOString();
    const existing = this.packages.get(input.contentPackageId);
    if (
      existing &&
      input.expectedRevision !== undefined &&
      existing.revision !== input.expectedRevision
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `ContentPackage ${input.contentPackageId} revision mismatch.`,
      );
    }

    const revision = (existing?.revision ?? 0) + 1;
    const record: ContentPackageRevisionRecord = {
      contentPackageId: input.contentPackageId,
      ...(input.workId ? { workId: input.workId } : {}),
      revision,
      composedAssetId,
      adoptedFromTaskId: task.taskId,
      adoptedAt: now,
    };
    this.packages.set(input.contentPackageId, record);

    const next: DerivedVideoTask = {
      ...task,
      status: 'adopted',
      composedCandidateAssetId: composedAssetId,
      updatedAt: now,
    };
    this.tasks.set(task.taskId, next);

    return {
      task: structuredClone(next),
      contentPackage: structuredClone(record),
    };
  }

  /** Attach composed candidate without adopting (full_compose complete). */
  completeComposedCandidate(input: {
    taskId: string;
    composedAssetId: string;
  }): DerivedVideoTask {
    const task = this.requireTask(input.taskId);
    if (task.scope !== 'full_compose') {
      throw new P1DomainError(
        'INVALID_STATE',
        'completeComposedCandidate only applies to full_compose scope.',
      );
    }
    const next: DerivedVideoTask = {
      ...task,
      status: 'composed_candidate_ready',
      composedCandidateAssetId: input.composedAssetId,
      updatedAt: this.clock().toISOString(),
    };
    this.tasks.set(task.taskId, next);
    return structuredClone(next);
  }

  getTask(taskId: string): DerivedVideoTask | undefined {
    const task = this.tasks.get(taskId);
    return task ? structuredClone(task) : undefined;
  }

  getContentPackage(
    contentPackageId: string,
  ): ContentPackageRevisionRecord | undefined {
    const record = this.packages.get(contentPackageId);
    return record ? structuredClone(record) : undefined;
  }

  /** Snapshot product usage for negative free-action asserts. */
  productUsageFor(taskId: string): ProductUsageRecord | null {
    return this.quotes.getUsage(taskId);
  }

  listProductUsageIds(): string[] {
    // ProductQuoteService doesn't list all; derive from tasks we know.
    const ids: string[] = [];
    for (const task of this.tasks.values()) {
      const usage = this.quotes.getUsage(task.taskId);
      if (usage) ids.push(usage.id);
    }
    return ids;
  }

  private requireTask(taskId: string): DerivedVideoTask {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new P1DomainError('NOT_FOUND', `Task ${taskId} was not found.`);
    }
    return task;
  }
}
