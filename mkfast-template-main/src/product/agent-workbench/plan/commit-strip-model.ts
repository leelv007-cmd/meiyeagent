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

  if (input.failureRefundsCredits === true) {
    chips.push({ key: 'refund', label: '失败自动退回' });
  } else if (input.failureRefundsCredits === false) {
    chips.push({ key: 'refund', label: '该模型失败不退回' });
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
    rightsLabel,
    rightsOk,
    factsLabel: factsSummary ? undefined : overrides?.factsLabel,
    factsOk,
    ...overrides,
    hasPlan: overrides?.hasPlan ?? true,
  };
}
