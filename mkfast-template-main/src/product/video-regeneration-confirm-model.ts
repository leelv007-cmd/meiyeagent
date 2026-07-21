/**
 * Pure video regeneration confirm / settle display model (WT-E / #103).
 *
 * Mirrors core `video-regeneration` confirm+settle projectors for the
 * workbench Result surface. No Provider / Deployment / Credential fields.
 * Submit-time Composer confirm remains C4 — not this module.
 */

import type {
  ProductBillingMode,
  ProductQuoteSnapshot,
  ProductSettlementStatus,
} from '@meiye/contracts';

export type VideoRegenScope = 'shot' | 'full_compose';

export type VideoRegenConfirmModel = {
  actionLabel: string;
  scope: VideoRegenScope;
  catalogModelId: string;
  targetSeconds: number;
  billingMode: ProductBillingMode;
  /** 本次按请求计费 | 按生成成片 N 秒计费 */
  billingModeLabel: string;
  estimatedCredits: number;
  authorizedCeiling: number;
  quotedSeconds?: number;
  estimatedCompletionAt: string | null;
  etaHonestyNote: string;
  createsNewTaskNotice: string;
  quoteId: string;
};

export type VideoRegenSettleModel = {
  quoteId: string;
  taskId: string;
  scope: VideoRegenScope;
  settlementStatus: ProductSettlementStatus;
  confirmedAmount: number;
  settledAmount: number;
  refundedAmount: number;
  platformAbsorbedAmount: number;
  billedSeconds?: number;
  autoRefundApplied: boolean;
  honestyNote: string;
};

export function actionLabelForScope(scope: VideoRegenScope): string {
  return scope === 'shot' ? '重新生成此镜头' : '重新合成整段';
}

export function billingModeLabelFromQuote(
  quote: Pick<
    ProductQuoteSnapshot,
    'billingMode' | 'quotedSeconds' | 'targetSeconds'
  >
): string {
  if (quote.billingMode === 'per_request') {
    return '本次按请求计费';
  }
  const n = quote.quotedSeconds ?? quote.targetSeconds ?? 0;
  return `按生成成片 ${n} 秒计费`;
}

/** Build confirm-zone model from a product quote snapshot + scope. */
export function buildVideoRegenConfirmModel(input: {
  quote: ProductQuoteSnapshot;
  scope: VideoRegenScope;
  estimatedCompletionAt?: string | null;
  etaHonestyNote?: string;
}): VideoRegenConfirmModel {
  const { quote, scope } = input;
  const estimatedCredits =
    quote.confirmedAmount ?? quote.authorizedCeiling ?? 0;
  return {
    actionLabel: actionLabelForScope(scope),
    scope,
    catalogModelId: quote.catalogModelId,
    targetSeconds: quote.targetSeconds ?? 0,
    billingMode: quote.billingMode,
    billingModeLabel: billingModeLabelFromQuote(quote),
    estimatedCredits,
    authorizedCeiling: quote.authorizedCeiling ?? estimatedCredits,
    ...(quote.quotedSeconds !== undefined
      ? { quotedSeconds: quote.quotedSeconds }
      : {}),
    estimatedCompletionAt: input.estimatedCompletionAt ?? null,
    etaHonestyNote:
      input.etaHonestyNote ??
      (input.estimatedCompletionAt
        ? '预计完成时间基于观测分位'
        : '预计完成时间暂无足够观测样本'),
    createsNewTaskNotice: '提交后会创建新的生成任务并单独计费',
    quoteId: quote.quoteId,
  };
}

/** Build settle/refund display from a settled product quote. */
export function buildVideoRegenSettleModel(input: {
  quote: ProductQuoteSnapshot;
  scope: VideoRegenScope;
}): VideoRegenSettleModel {
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
  };
}
