/**
 * Result Center Run Detail pure projection (P1-B1 / #150).
 *
 * Safe diagnostic surface for merchants: stage, fee summary, failure and
 * recovery in product language. Never exposes provider secrets, model slugs,
 * raw payloads, stack traces, or Work/Job UUIDs.
 */

import type { ResultShellPhase } from '@meiye/contracts';

import type { ResultShellProgressState } from './result-shell-model';

export type ResultRunDetailJobStatus =
  | 'submitting'
  | 'running'
  | 'recoverable'
  | 'unknown'
  | 'completed'
  | 'failed'
  | 'none';

export type ResultRunDetailStageState =
  | 'done'
  | 'current'
  | 'pending'
  | 'failed';

export type ResultRunDetailStage = {
  id: 'submit' | 'generate' | 'ready' | 'recover';
  label: string;
  state: ResultRunDetailStageState;
};

export type ResultRunDetailFacts = {
  phase: ResultShellPhase;
  progressState?: ResultShellProgressState;
  jobStatus?: ResultRunDetailJobStatus;
  /** Product-facing model name only — never providerModel / catalog id. */
  modelDisplayName?: string;
  /** 0 | 1 product usage units frozen on the job, when known. */
  productUsageQuantity?: 0 | 1;
  /** Ledger refund when known. Absent means do not claim a refund. */
  quotaRefunded?: boolean;
  failureCode?: string;
  recoveredAt?: string;
  /** Short support code from formatMerchantSupportReference — never UUID. */
  supportReference: string;
  workspaceKind?: 'copy' | 'image' | 'video';
};

export type ResultRunDetailPanelView = {
  heading: string;
  /** Always true — main product must not be drowned by diagnostics. */
  collapsedByDefault: true;
  stageSummary: string;
  stages: ResultRunDetailStage[];
  costSummary: string;
  modelSummary?: string;
  failureSummary?: string;
  recoveryHint?: string;
  supportHint: string;
};

const FAILURE_MESSAGES: Record<string, string> = {
  TIMEOUT: '生成超时，请返回工作台重新发起。',
  RATE_LIMITED: '当前排队较多，请稍后再试。',
  CONTENT_FILTER: '内容未通过合规检查，请调整后再试。',
  PROVIDER_ERROR: '生成服务暂时不可用，请稍后重试。',
  QUOTA_EXCEEDED: '积分不足，请确认套餐后再试。',
  CANCELLED: '本次任务已取消。',
  UNKNOWN: '生成未完成，请重试或联系支持。',
};

function isTimeoutFailure(code: string | undefined): boolean {
  return (code ?? '').trim().toUpperCase() === 'TIMEOUT';
}

function hasRetryableJob(facts: ResultRunDetailFacts): boolean {
  return (
    (facts.jobStatus ?? 'none') !== 'none' &&
    !isTimeoutFailure(facts.failureCode)
  );
}

function merchantFailureMessage(
  code: string | undefined,
  workspaceKind: ResultRunDetailFacts['workspaceKind']
): string | undefined {
  if (!code) return undefined;
  if (workspaceKind === 'video') {
    return '成片接收未完成，请返回工作台查看任务状态或联系支持。';
  }
  const normalized = code.trim().toUpperCase();
  if (FAILURE_MESSAGES[normalized]) return FAILURE_MESSAGES[normalized];
  // Never echo raw internal codes / provider names to merchants.
  return '生成未完成，请重试或联系支持。';
}

function stageSummaryFor(facts: ResultRunDetailFacts): string {
  if (facts.workspaceKind === 'video' && facts.phase === 'failed') {
    return '成片接收未完成';
  }
  switch (facts.phase) {
    case 'running':
      if (facts.progressState === 'suspended') return '等待你确认后继续';
      if (facts.progressState === 'waiting') return '已提交，正在排队';
      return '正在生成';
    case 'needs_input':
      return '需要你处理当前问题';
    case 'ready':
      return '结果可用';
    case 'failed':
      // #358 / D-176 / UX-01B: 「可恢复」 is only true while the shell actually
      // offers 「重试」. TIMEOUT and Job-less composer runs both exit to
      // 「返回工作台」; name it here, because this line is the badge on the
      // collapsed summary and may be all the merchant ever reads.
      return hasRetryableJob(facts)
        ? '生成失败，可恢复'
        : '生成失败，请返回工作台重新发起';
    case 'delivered':
      return '已交付';
    default: {
      const _exhaustive: never = facts.phase;
      return _exhaustive;
    }
  }
}

function projectStages(facts: ResultRunDetailFacts): ResultRunDetailStage[] {
  const job = facts.jobStatus ?? 'none';
  const failed = facts.phase === 'failed' || job === 'failed';
  const ready =
    facts.phase === 'ready' ||
    facts.phase === 'delivered' ||
    job === 'completed';
  const running =
    facts.phase === 'running' ||
    job === 'running' ||
    job === 'submitting' ||
    facts.progressState === 'running' ||
    facts.progressState === 'waiting';
  const recovering =
    job === 'recoverable' ||
    job === 'unknown' ||
    facts.progressState === 'suspended' ||
    Boolean(facts.recoveredAt);

  const submitState: ResultRunDetailStageState =
    job === 'none' && !running && !ready && !failed ? 'pending' : 'done';

  let generateState: ResultRunDetailStageState = 'pending';
  if (failed) generateState = 'failed';
  else if (ready) generateState = 'done';
  // `running` already covers job === 'submitting' | 'running' and progress waiting.
  else if (running) generateState = 'current';

  let readyState: ResultRunDetailStageState = 'pending';
  if (ready) readyState = 'done';
  else if (failed) readyState = 'pending';
  else if (generateState === 'done') readyState = 'current';

  let recoverState: ResultRunDetailStageState = 'pending';
  if (facts.recoveredAt) recoverState = 'done';
  else if (recovering && !ready) recoverState = 'current';
  else if (failed) recoverState = 'current';

  return [
    { id: 'submit', label: '已提交', state: submitState },
    { id: 'generate', label: '生成中', state: generateState },
    { id: 'ready', label: '结果可用', state: readyState },
    { id: 'recover', label: '恢复与核验', state: recoverState },
  ];
}

function costSummaryFor(facts: ResultRunDetailFacts): string {
  if (facts.quotaRefunded === true) {
    return '本次预扣的积分已退回；请以账单记录为准。';
  }
  if (facts.productUsageQuantity === 0) {
    return '本次没有扣积分；最终以账单记录为准。';
  }
  if (facts.phase === 'failed' && !hasRetryableJob(facts)) {
    // UX-01B: a reserved unit is not "1 次创作" once the run failed, and this
    // page cannot start another one. Name Credits/refund + the real exit.
    return '积分扣费与退回请以账单记录为准；当前页面不会重新发起本次创作。';
  }
  if (facts.phase === 'failed') {
    return '本次预扣过积分，失败是否退回请以账单记录为准。';
  }
  if (facts.productUsageQuantity === 1) {
    return '本次按积分计费；是否扣费以账单记录为准。';
  }
  if (facts.workspaceKind === 'video') {
    return '费用以账单记录为准；当前页面不会发起新的成片生成。';
  }
  return '费用以账单记录为准；重新生成前会再次确认。';
}

function recoveryHintFor(facts: ResultRunDetailFacts): string | undefined {
  if (facts.recoveredAt) {
    return '任务已恢复，可继续查看结果。';
  }
  if (
    facts.workspaceKind === 'video' &&
    (facts.jobStatus === 'recoverable' ||
      facts.jobStatus === 'unknown' ||
      facts.progressState === 'suspended')
  ) {
    return '可点「恢复或核验」继续接收同一上游任务，不会创建新的成片任务。';
  }
  if (facts.workspaceKind === 'video' && facts.phase === 'failed') {
    return '请返回工作台查看上游任务状态；当前页面不会重新生成成片。';
  }
  if (
    facts.jobStatus === 'recoverable' ||
    facts.jobStatus === 'unknown' ||
    facts.progressState === 'suspended'
  ) {
    return '可点「恢复或核验」继续，不会重复盲提交。';
  }
  if (facts.phase === 'failed') {
    // #350 / #353 / UX-01B: 「重试」 dispatches `retry_creative_job`. TIMEOUT
    // and Job-less composer runs have no such button, so the hint names
    // 「返回工作台」 — the exit the shell actually offers.
    return hasRetryableJob(facts)
      ? '可点「重试」重新生成；重试前会确认费用。'
      : '请返回工作台重新发起本次创作。';
  }
  return undefined;
}

/**
 * Project the Run Detail panel. Always collapsed-by-default.
 * Pure — no I/O.
 */
export function projectResultRunDetail(
  facts: ResultRunDetailFacts
): ResultRunDetailPanelView {
  const modelName = facts.modelDisplayName?.trim();
  const safeModel =
    modelName &&
    !/provider|openai|claude|gpt-|seedance|sub2api|new\s*api/iu.test(
      modelName
    ) &&
    !/[0-9a-f]{8}-[0-9a-f]{4}-/iu.test(modelName)
      ? modelName
      : undefined;
  const failureSummary = merchantFailureMessage(
    facts.failureCode,
    facts.workspaceKind
  );
  const recoveryHint = recoveryHintFor(facts);

  return {
    heading: '运行详情',
    collapsedByDefault: true,
    stageSummary: stageSummaryFor(facts),
    stages: projectStages(facts),
    costSummary: costSummaryFor(facts),
    ...(safeModel ? { modelSummary: `使用模型：${safeModel}` } : {}),
    ...(failureSummary ? { failureSummary } : {}),
    ...(recoveryHint ? { recoveryHint } : {}),
    supportHint: `联系支持时请提供编号 ${facts.supportReference}`,
  };
}
