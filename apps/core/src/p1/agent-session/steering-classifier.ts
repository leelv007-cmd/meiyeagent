/**
 * Steering classifier (V3.1 §5.6 / §23.3 / §24 / V31-16).
 *
 * Pure function: merchant natural-language instruction + unit progress →
 * one of four classifications. Does not write commands or touch billing.
 */

import type {
  ExecutionUnitId,
  SteeringClassification,
} from '@meiye/contracts';
import {
  executionUnitIdSchema,
  steeringQueueModeSchema,
} from '@meiye/contracts';
import type { z } from 'zod';

/** Dual queue mode — inferred from contracts schema (V31-01; no local rewrite). */
export type SteeringQueueMode = z.infer<typeof steeringQueueModeSchema>;

export type SteeringUnitStatus = 'pending' | 'running' | 'completed' | 'failed';

export type SteeringUnitProgress = {
  unitId: string;
  status: SteeringUnitStatus;
  /** Optional merchant-facing label (e.g. "封面", "第2页"). */
  label?: string;
  /** Optional page index for note units (0-based). */
  pageIndex?: number;
};

export type SteeringClassifySignals = {
  /** Explicit unit targets from upstream intent parsing (optional). */
  affectedUnitIds?: readonly string[];
  changesQuantity?: boolean;
  changesPlatform?: boolean;
  changesModel?: boolean;
  changesCost?: boolean;
  changesFacts?: boolean;
  /** Hard conflict / unsafe content the merchant must correct. */
  conflictReason?: string;
};

export type SteeringClassifyInput = {
  instruction: string;
  units: readonly SteeringUnitProgress[];
  /**
   * Composer dual-queue hint. Classifier may still override classification
   * (e.g. plan_change), but queue mode is preserved for insertion timing.
   */
  queueModeHint?: SteeringQueueMode;
  signals?: SteeringClassifySignals;
};

export type SteeringClassifyResult = {
  classification: SteeringClassification;
  affectedUnitIds: ExecutionUnitId[];
  queueMode: SteeringQueueMode;
  /** Merchant-facing impact line (no internal ids). */
  impactSummary: string;
  /** Units that must remain untouched by this command. */
  preservedUnitIds: ExecutionUnitId[];
};

const QUANTITY_RE =
  /增加.{0,4}页|加一页|加页|加两页|多做一页|多做几页|减少.{0,4}页|少做一页|改成\s*\d+\s*页|做成\s*\d+\s*页|页数|数量改|多生成|少生成/u;
const PLATFORM_RE =
  /换平台|改平台|换到|发到|改成抖音|改成小红书|换成朋友圈|视频号|换渠道/u;
const MODEL_RE = /换模型|改模型|换个模型|用更好的模型|换成.*模型/u;
const COST_RE = /加预算|提高费用|加积分|更贵|更便宜|降成本|加钱/u;
const FACT_RE =
  /价格改成|改价|活动改|日期改成|换成真的|事实改|权利撤回|素材撤权/u;
const UNSAFE_RE =
  /忽略.*确认|跳过.*确认|绕过.*计费|伪造发布|自动发布|代发|改别人|跨店/u;
const FOLLOW_UP_RE =
  /做完再|全部做完|完成后|做完以后|做完之后|全部完成再|回头再|等全部/u;
const STEER_RE = /等下|先别|马上改|当前|立刻|现在就|先改/u;
const COVER_RE = /封面/u;
const PAGE_RE = /第\s*([一二三四五六七八九十\d]+)\s*页/gu;
const STYLE_RE = /换.*风格|风格改|少点字|字少点|别写最后两个名额|不要写最后/u;

const CN_ORDINALS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function parseOrdinal(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+$/u.test(trimmed)) return Number(trimmed);
  if (trimmed in CN_ORDINALS) return CN_ORDINALS[trimmed] ?? null;
  return null;
}

function asUnitId(id: string): ExecutionUnitId {
  return executionUnitIdSchema.parse(id);
}

function resolveQueueMode(
  instruction: string,
  hint?: SteeringQueueMode,
): SteeringQueueMode {
  if (hint) return hint;
  if (FOLLOW_UP_RE.test(instruction)) return 'follow_up';
  if (STEER_RE.test(instruction)) return 'steer';
  return 'steer';
}

function unitsByPage(units: readonly SteeringUnitProgress[]): Map<number, SteeringUnitProgress> {
  const map = new Map<number, SteeringUnitProgress>();
  for (const unit of units) {
    if (typeof unit.pageIndex === 'number') {
      map.set(unit.pageIndex, unit);
    }
  }
  return map;
}

function findCoverUnit(
  units: readonly SteeringUnitProgress[],
): SteeringUnitProgress | undefined {
  return (
    units.find((u) => u.label?.includes('封面') || u.pageIndex === 0) ??
    units.find((u) => /cover/iu.test(u.unitId))
  );
}

function inferAffectedFromInstruction(
  instruction: string,
  units: readonly SteeringUnitProgress[],
): SteeringUnitProgress[] {
  const hit = new Map<string, SteeringUnitProgress>();
  if (COVER_RE.test(instruction)) {
    const cover = findCoverUnit(units);
    if (cover) hit.set(cover.unitId, cover);
  }
  for (const match of instruction.matchAll(PAGE_RE)) {
    const ordinal = parseOrdinal(match[1] ?? '');
    if (ordinal == null) continue;
    const pageIndex = ordinal - 1;
    const byPage = unitsByPage(units).get(pageIndex);
    if (byPage) hit.set(byPage.unitId, byPage);
    else {
      const byLabel = units.find((u) => u.label?.includes(`第${ordinal}页`));
      if (byLabel) hit.set(byLabel.unitId, byLabel);
    }
  }
  if (hit.size === 0 && STYLE_RE.test(instruction)) {
    // Style changes without page targets: prefer incomplete units.
    for (const unit of units) {
      if (unit.status === 'pending' || unit.status === 'running') {
        hit.set(unit.unitId, unit);
      }
    }
  }
  return [...hit.values()];
}

function isPlanChangeInstruction(instruction: string, signals?: SteeringClassifySignals): boolean {
  return Boolean(
    signals?.changesQuantity ||
      signals?.changesPlatform ||
      signals?.changesModel ||
      signals?.changesCost ||
      signals?.changesFacts ||
      QUANTITY_RE.test(instruction) ||
      PLATFORM_RE.test(instruction) ||
      MODEL_RE.test(instruction) ||
      COST_RE.test(instruction) ||
      FACT_RE.test(instruction),
  );
}

function impactLine(input: {
  classification: SteeringClassification;
  affected: readonly SteeringUnitProgress[];
  preserved: readonly SteeringUnitProgress[];
  wholeNote?: boolean;
}): string {
  const { classification, affected, preserved } = input;
  if (classification.kind === 'unsafe_or_conflicting') {
    return `该指令无法安全执行：${classification.reason}。请修正后再试。`;
  }
  if (classification.kind === 'plan_change') {
    return `该指令会改变方案范围或费用（${classification.reason}），需回到方案层重新报价并确认。`;
  }
  // V31-105 §1 (B): nothing in the instruction named a page, so the whole note
  // is the scope. Say that out loud — a merchant who meant one page needs to see
  // that it was read as all of them while there is still time to say otherwise.
  const target = input.wholeNote
    ? '整篇'
    : targetName(affected);
  if (classification.kind === 'derived_revision') {
    return input.wholeNote
      ? '未指明页面，按整篇处理：已完成内容将产生派生版本；如只想改某一页，请指明页码。'
      : `已完成内容将产生派生版本（${target}）；其他页面保持不变。`;
  }
  // future_step_patch
  return input.wholeNote
    ? '未指明页面，按整篇处理：将应用到全部页面；如只想改某一页，请指明页码。'
    : `已应用到${target}${preserved.length > 0 ? '；其他页面不变' : ''}。`;
}

function targetName(affected: readonly SteeringUnitProgress[]): string {
  const names = affected.map((u) => {
    if (u.label) return u.label;
    if (typeof u.pageIndex === 'number') {
      return u.pageIndex === 0 ? '封面' : `第${u.pageIndex + 1}页`;
    }
    return '目标单元';
  });
  if (names.length === 0) return '目标范围';
  if (names.length === 1) return names[0] ?? '目标范围';
  return names.join('和');
}

/**
 * Classify a mid-run merchant instruction into one of four steering kinds.
 */
export function classifySteeringInstruction(
  input: SteeringClassifyInput,
): SteeringClassifyResult {
  const instruction = input.instruction.trim();
  if (!instruction) {
    throw new Error('Steering instruction must be non-empty.');
  }
  const queueMode = resolveQueueMode(instruction, input.queueModeHint);
  const units = input.units;

  if (input.signals?.conflictReason || UNSAFE_RE.test(instruction)) {
    const reason =
      input.signals?.conflictReason?.trim() ||
      '指令与安全边界冲突，需要商家修正';
    const classification: SteeringClassification = {
      kind: 'unsafe_or_conflicting',
      reason,
    };
    return {
      classification,
      affectedUnitIds: [],
      queueMode,
      impactSummary: impactLine({
        classification,
        affected: [],
        preserved: [...units],
      }),
      preservedUnitIds: units.map((u) => asUnitId(u.unitId)),
    };
  }

  if (isPlanChangeInstruction(instruction, input.signals)) {
    const reason = QUANTITY_RE.test(instruction)
      ? '数量变化'
      : PLATFORM_RE.test(instruction)
        ? '平台变化'
        : MODEL_RE.test(instruction)
          ? '模型变化'
          : COST_RE.test(instruction)
            ? '费用变化'
            : FACT_RE.test(instruction)
              ? '事实或权利变化'
              : input.signals?.changesQuantity
                ? '数量变化'
                : input.signals?.changesPlatform
                  ? '平台变化'
                  : input.signals?.changesModel
                    ? '模型变化'
                    : input.signals?.changesCost
                      ? '费用变化'
                      : '方案关键字段变化';
    const classification: SteeringClassification = {
      kind: 'plan_change',
      reason,
      requiresReplan: true,
    };
    return {
      classification,
      affectedUnitIds: [],
      queueMode,
      impactSummary: impactLine({
        classification,
        affected: [],
        preserved: [...units],
      }),
      preservedUnitIds: units.map((u) => asUnitId(u.unitId)),
    };
  }

  const explicitIds = new Set(input.signals?.affectedUnitIds ?? []);
  let affected =
    explicitIds.size > 0
      ? units.filter((u) => explicitIds.has(u.unitId))
      : inferAffectedFromInstruction(instruction, units);

  // V31-105 §1 (B): no page target and no plan-change signal used to be a
  // rejection. It is not one. The progress rows this classifier sees carry only
  // `(unit_id, status)` — no label, no page index — so 「封面不要写最后两个名额」
  // finds nothing to match and a perfectly ordinary instruction came back as
  // 「无法安全执行」. Not knowing which page the merchant meant is a reason to
  // treat the instruction as covering the note, and to say so in the readback;
  // it is not a reason to refuse. Safety is unaffected: the branches below still
  // route completed units through derived_revision rather than overwriting them,
  // and genuinely unsafe or plan-changing instructions were already handled above.
  //
  // Full targeting (schema label/pageIndex + the §5.6 rebilled/settled ruling)
  // is scheme A and stays on its own ticket.
  const wholeNote = affected.length === 0 && units.length > 0;
  if (wholeNote) affected = [...units];

  if (affected.length === 0) {
    // Nothing to steer at all — there are no units in this task.
    const classification: SteeringClassification = {
      kind: 'unsafe_or_conflicting',
      reason: '无法确定影响范围，请指明要改的页面或步骤',
    };
    return {
      classification,
      affectedUnitIds: [],
      queueMode,
      impactSummary: impactLine({
        classification,
        affected: [],
        preserved: [...units],
      }),
      preservedUnitIds: units.map((u) => asUnitId(u.unitId)),
    };
  }

  const completedAffected = affected.filter((u) => u.status === 'completed');
  const futureAffected = affected.filter(
    (u) => u.status === 'pending' || u.status === 'running' || u.status === 'failed',
  );
  const preserved = units.filter((u) => !affected.some((a) => a.unitId === u.unitId));

  if (completedAffected.length > 0) {
    // Completed content → derived revision (never silent overwrite).
    // Requote only when cost-bearing regeneration is implied by signals.
    const requiresRequote = Boolean(input.signals?.changesCost);
    const classification: SteeringClassification = {
      kind: 'derived_revision',
      completedUnits: completedAffected.map((u) => asUnitId(u.unitId)),
      requiresRequote,
    };
    // Scope includes completed + any still-open siblings the merchant named.
    const allAffected = [...completedAffected, ...futureAffected];
    const unique = new Map(allAffected.map((u) => [u.unitId, u]));
    const list = [...unique.values()];
    return {
      classification,
      affectedUnitIds: list.map((u) => asUnitId(u.unitId)),
      queueMode,
      impactSummary: impactLine({
        classification,
        affected: list,
        preserved,
        wholeNote,
      }),
      preservedUnitIds: preserved.map((u) => asUnitId(u.unitId)),
    };
  }

  // Only future / failed units — patch without requote.
  const classification: SteeringClassification = {
    kind: 'future_step_patch',
    affectedUnits: futureAffected.map((u) => asUnitId(u.unitId)),
    requiresRequote: false,
  };
  return {
    classification,
    affectedUnitIds: futureAffected.map((u) => asUnitId(u.unitId)),
    queueMode,
    impactSummary: impactLine({
      classification,
      affected: futureAffected,
      preserved,
      wholeNote,
    }),
    preservedUnitIds: preserved.map((u) => asUnitId(u.unitId)),
  };
}
