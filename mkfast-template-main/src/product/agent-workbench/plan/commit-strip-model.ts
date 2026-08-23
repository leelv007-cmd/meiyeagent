/**
 * Commit strip projection (V31-10 / V3.1 §5.4).
 *
 * Ordinary Plan uses a compact confirmation bar that unifies the merchant-
 * facing signals previously split across Brief summary / quote line / confirm:
 *
 *   38 积分 · 余额 126 · 素材授权通过 · 事实可用 · 失败自动退回
 *   [返回修改] [开始制作]
 *
 * Amounts and rights come from deterministic facts only (D-061 dual-truth).
 */

import { formatRefundDualState } from '@meiye/contracts';

import type { LivingPlanRevisionFacts } from './living-plan-model';

export type CommitStripAction = 'revise' | 'start';

export type CommitStripView = {
  visible: boolean;
  /** Single line of merchant-safe status chips. */
  statusLine: string;
  chips: readonly {
    key: string;
    label: string;
  }[];
  actions: readonly {
    id: CommitStripAction;
    label: string;
  }[];
  /** True when start should be disabled (shortfall / blocked / missing quote). */
  startDisabled: boolean;
  startDisabledReason?: string;
  readiness?: LivingPlanRevisionFacts['readiness'];
};

export type CommitStripInput = {
  creditCost?: number;
  balanceCredits?: number;
  rightsOk?: boolean;
  rightsLabel?: string;
  factsOk?: boolean;
  factsLabel?: string;
  failureRefundsCredits?: boolean | null;
  readiness?: LivingPlanRevisionFacts['readiness'];
  /** When false, strip is hidden (no plan yet). */
  hasPlan?: boolean;
  /** EXEC-06: delivered / failed freeze start. Inferred confirmed/executing does not. */
  planLifecycle?: 'draft' | 'confirmed' | 'executing' | 'delivered' | 'failed';
  /**
   * Paid merchant_confirmed start needs the confirmation authority id first.
   * SUBMIT-01A can stream a priced plan before preparePendingConfirmation
   * persists that id; start stays disabled until it exists.
   */
  requiresMerchantConfirmation?: boolean;
  confirmationRequestId?: string | null;
  /**
   * V31-105 §10 — this Work's start was already accepted and the run has not
   * reported back yet.
   *
   * Deliberately not `planLifecycle === 'executing'`: that value is inferred
   * from Workbench activity and stays enabled on purpose (see the freeze note
   * below). This flag is the narrower fact the browser owns — the 202 it got
   * back from `composer.start_task`. During that window Core refuses a second
   * start (`COMPOSER_PLAN_START_RUN_STATE_UNSTARTABLE`), so leaving 开始制作
   * pressable offered the merchant a refusal.
   */
  runInFlight?: boolean;
};

const DEFAULT_ACTIONS = [
  { id: 'revise' as const, label: '返回修改' },
  { id: 'start' as const, label: '开始制作' },
];

/**
 * Project the §5.4 commit strip from deterministic billing + rights facts.
 */
export function projectCommitStrip(input: CommitStripInput): CommitStripView {
  if (input.hasPlan === false) {
    return {
      visible: false,
      statusLine: '',
      chips: [],
      actions: DEFAULT_ACTIONS,
      startDisabled: true,
      startDisabledReason: 'no_plan',
    };
  }

  const chips: { key: string; label: string }[] = [];

  if (
    typeof input.creditCost === 'number' &&
    Number.isSafeInteger(input.creditCost) &&
    input.creditCost > 0
  ) {
    chips.push({ key: 'credits', label: `${input.creditCost} 积分` });
  }

  if (
    typeof input.balanceCredits === 'number' &&
    Number.isSafeInteger(input.balanceCredits) &&
    input.balanceCredits >= 0
  ) {
    chips.push({ key: 'balance', label: `余额 ${input.balanceCredits}` });
  }

  if (input.rightsLabel) {
    chips.push({ key: 'rights', label: input.rightsLabel });
  } else if (input.rightsOk === true) {
    chips.push({ key: 'rights', label: '素材授权通过' });
  } else if (input.rightsOk === false) {
    chips.push({ key: 'rights', label: '素材授权待处理' });
  }

  if (input.factsLabel) {
    chips.push({ key: 'facts', label: input.factsLabel });
  } else if (input.factsOk === true) {
    chips.push({ key: 'facts', label: '事实可用' });
  } else if (input.factsOk === false) {
    chips.push({ key: 'facts', label: '事实待补齐' });
  }

  if (typeof input.failureRefundsCredits === 'boolean') {
    chips.push({
      key: 'refund',
      label: formatRefundDualState(input.failureRefundsCredits),
    });
  }

  let startDisabled = false;
  let startDisabledReason: string | undefined;

  if (
    typeof input.creditCost === 'number' &&
    typeof input.balanceCredits === 'number' &&
    input.balanceCredits < input.creditCost
  ) {
    startDisabled = true;
    startDisabledReason = 'balance_shortfall';
  }

  if (input.readiness === 'blocked') {
    startDisabled = true;
    startDisabledReason = 'plan_blocked';
  } else if (input.readiness === 'stale') {
    startDisabled = true;
    startDisabledReason = 'plan_stale';
  } else if (input.readiness === 'reprice_required') {
    startDisabled = true;
    startDisabledReason = 'reprice_required';
  }

  if (input.rightsOk === false) {
    startDisabled = true;
    startDisabledReason = startDisabledReason ?? 'rights_blocked';
  }

  if (
    chips.length === 0 ||
    !(
      typeof input.creditCost === 'number' &&
      Number.isSafeInteger(input.creditCost) &&
      input.creditCost > 0
    )
  ) {
    // Still visible when plan exists, but start disabled until quote is real.
    startDisabled = true;
    startDisabledReason = startDisabledReason ?? 'quote_missing';
  }

  if (
    input.requiresMerchantConfirmation === true &&
    !input.confirmationRequestId?.trim()
  ) {
    startDisabled = true;
    startDisabledReason = startDisabledReason ?? 'confirmation_pending';
  }

  // A start that is already running is the strongest current fact about this
  // button, so it replaces whatever reason came before rather than deferring
  // to it: 余额不足 stops being why the merchant cannot press start once she
  // already has.
  if (input.runInFlight === true) {
    startDisabled = true;
    startDisabledReason = 'run_in_flight';
  }

  // EXEC-06 freezes after the Work is delivered or failed. Inferred
  // confirmed/executing (pending interrupts, leftover Intent activity) is not
  // merchant start — a ready plan with quote + rights must stay pressable.
  const frozen =
    input.planLifecycle === 'delivered' || input.planLifecycle === 'failed';
  if (frozen) {
    const frozenLabel =
      input.planLifecycle === 'delivered' ? '已经做好' : '没做成';
    return {
      visible: true,
      statusLine: [frozenLabel, ...chips.map((chip) => chip.label)].join(' · '),
      chips,
      actions: [],
      startDisabled: true,
      startDisabledReason: `lifecycle_${input.planLifecycle}`,
      readiness: input.readiness,
    };
  }

  return {
    visible: true,
    statusLine: chips.map((chip) => chip.label).join(' · '),
    chips,
    actions: DEFAULT_ACTIONS,
    startDisabled,
    startDisabledReason,
    readiness: input.readiness,
  };
}

/** Derive commit-strip input from living-plan revision facts. */
export function commitStripInputFromPlanFacts(
  facts: LivingPlanRevisionFacts,
  overrides?: Partial<CommitStripInput>
): CommitStripInput {
  const rightsLabel = facts.factsAssets.rightsLabel;
  const rightsOk =
    overrides?.rightsOk ??
    (rightsLabel ? !/待|缺|拒|撤|受限/u.test(rightsLabel) : undefined);
  const factsSummary = facts.factsAssets.factsSummary;
  const factsOk =
    overrides?.factsOk ??
    (factsSummary ? !/待|缺|冲突/u.test(factsSummary) : undefined);

  return {
    creditCost: facts.costDuration.creditCost,
    balanceCredits: facts.costDuration.balanceCredits,
    failureRefundsCredits: facts.costDuration.failureRefundsCredits,
    readiness: facts.readiness,
    planLifecycle: facts.planLifecycle,
    rightsLabel,
    rightsOk,
    factsLabel: factsSummary ? undefined : overrides?.factsLabel,
    factsOk,
    ...overrides,
    hasPlan: overrides?.hasPlan ?? true,
  };
}
