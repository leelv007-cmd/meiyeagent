/**
 * Living Plan merchant-facing projection (V31-10 / V3.1 §5.3).
 *
 * Five document sections in Workstream:
 * 目标 / 本次制作 / 表达策略 / 事实与素材 / 预计积分与时长
 *
 * Consumes MarketingPlanRevision or a thin semantic-event payload.
 * Does not invent quote/balance/rights — those come from deterministic facts.
 */

import {
  formatRefundDualState,
  type MarketingPlanReadiness,
  type MarketingPlanRevision,
  type PlanDeliverable,
} from '@meiye/contracts';

export const LIVING_PLAN_SECTION_KEYS = [
  'goal',
  'deliverables',
  'expression',
  'facts_assets',
  'cost_duration',
] as const;

export type LivingPlanSectionKey = (typeof LIVING_PLAN_SECTION_KEYS)[number];

export const LIVING_PLAN_SECTION_TITLES: Record<LivingPlanSectionKey, string> =
  {
    goal: '目标',
    deliverables: '本次制作',
    expression: '表达策略',
    facts_assets: '事实与素材',
    cost_duration: '预计积分与时长',
  };

export type LivingPlanSectionRow = {
  label: string;
  value: string;
};

export type LivingPlanSectionView = {
  key: LivingPlanSectionKey;
  title: string;
  /** Primary prose for the section (document body). */
  body: string;
  rows: readonly LivingPlanSectionRow[];
};

/** Merchant-safe plan revision facts for UI (event payload or projected). */
export type LivingPlanRevisionFacts = {
  planId: string;
  revision: number;
  goal: {
    summary: string;
    whyNow?: string | null;
    desiredAction?: string;
  };
  deliverables: readonly {
    kind: string;
    platform?: string;
    quantity: number;
    purpose?: string;
  }[];
  expression: {
    voice?: string;
    openingMechanism?: string;
    narrativeStructure?: string;
    promotionIntensity?: string;
    cta?: string;
  };
  factsAssets: {
    factsSummary?: string;
    authoritySummary?: string;
    assetsSummary?: string;
    rightsLabel?: string;
  };
  costDuration: {
    creditCost?: number;
    durationLabel?: string;
    failureRefundsCredits?: boolean | null;
    balanceCredits?: number;
  };
  readiness?: MarketingPlanReadiness;
  /** EXEC-06: workbench stamps this so commit strip can freeze after start. */
  planLifecycle?: 'draft' | 'confirmed' | 'executing' | 'delivered' | 'failed';
  /** Present on adjustments (plan.revised). */
  adjustmentSummary?: string;
  streamOffset?: string;
  occurredAt?: string;
};

export type LivingPlanView = {
  planId: string;
  revision: number;
  sections: readonly LivingPlanSectionView[];
  readiness?: MarketingPlanReadiness;
  adjustmentSummary?: string;
  /** Compact one-line summary for collapsed / chip use. */
  compactSummary: string;
};

export type LivingPlanBillingFacts = {
  creditCost?: number;
  balanceCredits?: number;
  failureRefundsCredits?: boolean | null;
  durationLabel?: string;
  rightsLabel?: string;
  factsSummary?: string;
  assetsSummary?: string;
};

const KIND_LABEL: Record<string, string> = {
  copy: '文案',
  note: '图文笔记',
  media: '媒体',
  image_text: '图文笔记',
  video: '视频',
};

export function deliverableKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function formatDeliverableLine(item: {
  kind: string;
  platform?: string;
  quantity: number;
  purpose?: string;
}): string {
  const kind = deliverableKindLabel(item.kind);
  const platform = item.platform?.trim();
  const qty =
    item.quantity > 1
      ? `${item.quantity}${item.kind === 'note' || item.kind === 'image_text' ? ' 页' : ' 份'}`
      : null;
  const parts = [platform ? `${platform}${kind}` : kind, qty, item.purpose]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => part.trim());
  return parts.join(' · ');
}

/**
 * Project a Living Plan view from revision facts (+ optional billing overlay).
 * Billing overlay never invents numbers — only fills when provided.
 */
export function projectLivingPlanView(
  facts: LivingPlanRevisionFacts,
  billing?: LivingPlanBillingFacts
): LivingPlanView {
  const cost = {
    creditCost: billing?.creditCost ?? facts.costDuration.creditCost,
    durationLabel: billing?.durationLabel ?? facts.costDuration.durationLabel,
    failureRefundsCredits:
      billing?.failureRefundsCredits ??
      facts.costDuration.failureRefundsCredits,
    balanceCredits:
      billing?.balanceCredits ?? facts.costDuration.balanceCredits,
  };
  const factsAssets = {
    factsSummary: billing?.factsSummary ?? facts.factsAssets.factsSummary,
    authoritySummary: facts.factsAssets.authoritySummary,
    assetsSummary: billing?.assetsSummary ?? facts.factsAssets.assetsSummary,
    rightsLabel: billing?.rightsLabel ?? facts.factsAssets.rightsLabel,
  };

  const goalRows: LivingPlanSectionRow[] = [
    { label: '目标', value: facts.goal.summary },
  ];
  if (facts.goal.whyNow) {
    goalRows.push({ label: '为何现在', value: facts.goal.whyNow });
  }
  if (facts.goal.desiredAction) {
    goalRows.push({ label: '期望动作', value: facts.goal.desiredAction });
  }

  const deliverableLines = facts.deliverables.map(formatDeliverableLine);
  const deliverableRows = facts.deliverables.map((item, index) => ({
    label: `交付 ${index + 1}`,
    value: formatDeliverableLine(item),
  }));

  const expressionRows: LivingPlanSectionRow[] = [];
  if (facts.expression.voice) {
    expressionRows.push({ label: '语气', value: facts.expression.voice });
  }
  if (facts.expression.openingMechanism) {
    expressionRows.push({
      label: '开场',
      value: facts.expression.openingMechanism,
    });
  }
  if (facts.expression.narrativeStructure) {
    expressionRows.push({
      label: '结构',
      value: facts.expression.narrativeStructure,
    });
  }
  if (facts.expression.promotionIntensity) {
    expressionRows.push({
      label: '促销强度',
      value: facts.expression.promotionIntensity,
    });
  }
  if (facts.expression.cta) {
    expressionRows.push({ label: 'CTA', value: facts.expression.cta });
  }

  const factsRows: LivingPlanSectionRow[] = [];
  if (factsAssets.factsSummary) {
    factsRows.push({ label: '事实', value: factsAssets.factsSummary });
  }
  if (factsAssets.authoritySummary) {
    factsRows.push({ label: '执行依据', value: factsAssets.authoritySummary });
  }
  if (factsAssets.assetsSummary) {
    factsRows.push({ label: '素材', value: factsAssets.assetsSummary });
  }
  if (factsAssets.rightsLabel) {
    factsRows.push({ label: '权利', value: factsAssets.rightsLabel });
  }
  if (factsRows.length === 0) {
    factsRows.push({
      label: '事实与素材',
      value: '待系统补齐（不编造门店事实）',
    });
  }

  const costRows: LivingPlanSectionRow[] = [];
  if (
    typeof cost.creditCost === 'number' &&
    Number.isSafeInteger(cost.creditCost) &&
    cost.creditCost > 0
  ) {
    costRows.push({ label: '预计积分', value: `${cost.creditCost} 分` });
  }
  if (typeof cost.balanceCredits === 'number') {
    costRows.push({ label: '余额', value: `${cost.balanceCredits} 分` });
  }
  if (cost.durationLabel) {
    costRows.push({ label: '预计时长', value: cost.durationLabel });
  }
  if (typeof cost.failureRefundsCredits === 'boolean') {
    costRows.push({
      label: '失败退还',
      value: formatRefundDualState(cost.failureRefundsCredits),
    });
  }
  if (costRows.length === 0) {
    costRows.push({ label: '报价', value: '报价由系统补齐后显示' });
  }

  const sections: LivingPlanSectionView[] = [
    {
      key: 'goal',
      title: LIVING_PLAN_SECTION_TITLES.goal,
      body: facts.goal.summary,
      rows: goalRows,
    },
    {
      key: 'deliverables',
      title: LIVING_PLAN_SECTION_TITLES.deliverables,
      body: deliverableLines.join('；') || '待确认交付',
      rows: deliverableRows,
    },
    {
      key: 'expression',
      title: LIVING_PLAN_SECTION_TITLES.expression,
      body:
        expressionRows.map((row) => row.value).join(' · ') ||
        '表达策略将在方案中逐步明确',
      rows: expressionRows,
    },
    {
      key: 'facts_assets',
      title: LIVING_PLAN_SECTION_TITLES.facts_assets,
      body: factsRows.map((row) => `${row.label}：${row.value}`).join('；'),
      rows: factsRows,
    },
    {
      key: 'cost_duration',
      title: LIVING_PLAN_SECTION_TITLES.cost_duration,
      body: costRows.map((row) => `${row.label} ${row.value}`).join(' · '),
      rows: costRows,
    },
  ];

  const compactSummary = [
    deliverableLines[0] ?? facts.goal.summary,
    typeof cost.creditCost === 'number' ? `${cost.creditCost} 分` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    planId: facts.planId,
    revision: facts.revision,
    sections,
    readiness: facts.readiness,
    adjustmentSummary: facts.adjustmentSummary,
    compactSummary,
  };
}

/**
 * Project LivingPlanRevisionFacts from a full MarketingPlanRevision.
 * Quote amounts are NOT read from revision (quoteRef only) — pass billing.
 */
export function livingPlanFactsFromRevision(
  revision: MarketingPlanRevision,
  extras?: {
    readiness?: MarketingPlanReadiness;
    adjustmentSummary?: string;
    billing?: LivingPlanBillingFacts;
    factsSummary?: string;
    assetsSummary?: string;
    rightsLabel?: string;
  }
): LivingPlanRevisionFacts {
  return {
    planId: revision.planId,
    revision: revision.revision,
    goal: {
      summary: revision.goal.summary,
      whyNow: revision.goal.whyNow,
      desiredAction: revision.goal.desiredAction,
    },
    deliverables: revision.deliverables.map((item: PlanDeliverable) => ({
      kind: item.kind,
      platform: item.platform,
      quantity: item.quantity,
      purpose: item.purpose,
    })),
    expression: {
      voice: revision.expression.voice,
      openingMechanism: revision.expression.openingMechanism,
      narrativeStructure: revision.expression.narrativeStructure,
      promotionIntensity: revision.expression.promotionIntensity,
      cta: revision.expression.cta,
    },
    factsAssets: {
      factsSummary: extras?.factsSummary,
      assetsSummary: extras?.assetsSummary,
      rightsLabel: extras?.rightsLabel,
    },
    costDuration: {
      creditCost: extras?.billing?.creditCost,
      durationLabel: extras?.billing?.durationLabel,
      failureRefundsCredits: extras?.billing?.failureRefundsCredits,
      balanceCredits: extras?.billing?.balanceCredits,
    },
    readiness: extras?.readiness,
    adjustmentSummary: extras?.adjustmentSummary,
    occurredAt: revision.createdAt,
  };
}

/**
 * Parse a thin semantic-event payload into LivingPlanRevisionFacts.
 * Fail closed: missing planId/revision/goal.summary → null.
 */
export function parseLivingPlanEventPayload(
  payload: unknown
): LivingPlanRevisionFacts | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const planId = typeof record.planId === 'string' ? record.planId.trim() : '';
  const revision =
    typeof record.revision === 'number' &&
    Number.isSafeInteger(record.revision) &&
    record.revision > 0
      ? record.revision
      : null;
  if (!planId || revision === null) return null;

  const goalRecord = asRecord(record.goal);
  const goalSummary =
    readString(goalRecord, 'summary') ??
    readString(record, 'goalSummary') ??
    readString(record, 'summary');
  if (!goalSummary) return null;

  const deliverablesRaw = Array.isArray(record.deliverables)
    ? record.deliverables
    : [];
  const deliverables = deliverablesRaw
    .map((item) => {
      const row = asRecord(item);
      const kind = readString(row, 'kind');
      const quantity = readPositiveInt(row, 'quantity') ?? 1;
      if (!kind) return null;
      return {
        kind,
        platform: readString(row, 'platform'),
        quantity,
        purpose: readString(row, 'purpose'),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Allow empty deliverables from partial stream; UI shows placeholder.
  const expression = asRecord(record.expression);
  const factsAssets = asRecord(record.factsAssets);
  const costDuration = asRecord(record.costDuration);

  return {
    planId,
    revision,
    goal: {
      summary: goalSummary,
      whyNow: readString(goalRecord, 'whyNow') ?? null,
      desiredAction: readString(goalRecord, 'desiredAction'),
    },
    deliverables,
    expression: {
      voice: readString(expression, 'voice'),
      openingMechanism: readString(expression, 'openingMechanism'),
      narrativeStructure: readString(expression, 'narrativeStructure'),
      promotionIntensity: readString(expression, 'promotionIntensity'),
      cta: readString(expression, 'cta'),
    },
    factsAssets: {
      factsSummary:
        readString(factsAssets, 'factsSummary') ??
        readString(record, 'factsSummary'),
      authoritySummary:
        readString(factsAssets, 'authoritySummary') ??
        readString(record, 'authoritySummary'),
      assetsSummary:
        readString(factsAssets, 'assetsSummary') ??
        readString(record, 'assetsSummary'),
      rightsLabel:
        readString(factsAssets, 'rightsLabel') ??
        readString(record, 'rightsLabel'),
    },
    costDuration: {
      creditCost:
        readPositiveInt(costDuration, 'creditCost') ??
        readPositiveInt(record, 'creditCost'),
      durationLabel:
        readString(costDuration, 'durationLabel') ??
        readString(record, 'durationLabel'),
      failureRefundsCredits: readBoolean(
        costDuration,
        'failureRefundsCredits',
        record
      ),
      balanceCredits:
        readNonNegativeInt(costDuration, 'balanceCredits') ??
        readNonNegativeInt(record, 'balanceCredits'),
    },
    readiness: readReadiness(record.readiness),
    adjustmentSummary: readString(record, 'adjustmentSummary'),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function readString(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readPositiveInt(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  return undefined;
}

function readNonNegativeInt(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return undefined;
}

function readBoolean(
  primary: Record<string, unknown>,
  key: string,
  fallback: Record<string, unknown>
): boolean | null | undefined {
  const value = primary[key] ?? fallback[key];
  if (typeof value === 'boolean') return value;
  return undefined;
}

function readReadiness(value: unknown): MarketingPlanReadiness | undefined {
  if (
    value === 'ready' ||
    value === 'stale' ||
    value === 'blocked' ||
    value === 'reprice_required'
  ) {
    return value;
  }
  return undefined;
}
