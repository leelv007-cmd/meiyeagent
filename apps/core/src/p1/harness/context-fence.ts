/**
 * Context Fence classification (V3.1 §23.4 / V31-14).
 *
 * | When              | Change                         | Behavior              |
 * |-------------------|--------------------------------|-----------------------|
 * | Pre-confirm       | fact change                    | auto plan revision    |
 * | Post-confirm/pre  | material fact/rights/cost      | plan stale + reconfirm|
 * | In-flight         | unused fact change             | continue              |
 * | In-flight         | referenced price/date change   | pause + prompt        |
 * | In-flight         | asset rights revoked           | fail closed stop      |
 * | In-flight         | soft non-material change       | finish + review note  |
 *
 * Pre-run staleness stays in execution-plan-admission.ts.
 * This module owns mid-execution fence decisions and safe-stop semantics
 * (no double charge on rights revocation).
 */

import type { SnapshotLiveFacts } from './execution-plan-admission.js';
import type { ExecutionPlanSnapshot } from '@meiye/contracts';
import {
  evaluateExecutionPlanStaleness,
  type SnapshotStaleDiff,
} from './execution-plan-admission.js';

export type ContextFencePhase =
  | 'pre_confirm'
  | 'post_confirm_pre_execute'
  | 'in_flight';

export type ContextFenceChangeKind =
  | 'unused_fact_change'
  | 'referenced_price_or_date_change'
  | 'rights_revoked'
  | 'material_fact_or_cost_change'
  | 'soft_non_material_change'
  | 'none';

export type ContextFenceAction =
  | { action: 'continue' }
  | { action: 'auto_update_plan'; reason: string }
  | { action: 'stale_reconfirm'; diff: SnapshotStaleDiff }
  | {
      action: 'pause_prompt';
      reason: 'referenced_price_or_date_change';
      message: string;
      diff: SnapshotStaleDiff;
    }
  | {
      action: 'safe_stop';
      reason: 'rights_revoked';
      message: string;
      /** Billing: do not re-charge / re-reserve on this stop. */
      noAdditionalCharge: true;
      refundIfReserved: true;
    }
  | {
      action: 'complete_with_review';
      reason: 'soft_non_material_change';
      message: string;
    };

export type MidExecutionFenceInput = {
  snapshot: ExecutionPlanSnapshot;
  live: SnapshotLiveFacts;
  /**
   * Fact revision ids that this run has already cited in generated content.
   * Used to distinguish unused vs referenced fact drift (§23.4).
   */
  referencedFactRevisionIds?: readonly string[];
  /**
   * When true, fact drift is treated as price/date material (caller classified).
   */
  referencedPriceOrDateChanged?: boolean;
};

/**
 * Pure mid-execution fence (§23.4 rows for 执行中).
 */
export function evaluateMidExecutionContextFence(
  input: MidExecutionFenceInput,
): ContextFenceAction {
  if (input.live.rightsRevoked === true) {
    return {
      action: 'safe_stop',
      reason: 'rights_revoked',
      message: '素材授权已撤销，已安全停止且不会重复扣费。',
      noAdditionalCharge: true,
      refundIfReserved: true,
    };
  }

  if (input.referencedPriceOrDateChanged === true) {
    const staleness = evaluateExecutionPlanStaleness({
      snapshot: input.snapshot,
      live: input.live,
    });
    return {
      action: 'pause_prompt',
      reason: 'referenced_price_or_date_change',
      message: '已引用的价格或日期发生变化，请确认后继续。',
      diff: staleness.status === 'stale' ? staleness.diff : {},
    };
  }

  const staleness = evaluateExecutionPlanStaleness({
    snapshot: input.snapshot,
    live: input.live,
  });
  if (staleness.status === 'current') {
    return { action: 'continue' };
  }

  const referenced = new Set(input.referencedFactRevisionIds ?? []);
  const driftedFacts = staleness.diff.factRevisionRefs;
  if (driftedFacts) {
    const liveSet = new Set(driftedFacts.live);
    const frozenSet = new Set(driftedFacts.frozen);
    const changed = [...frozenSet].filter((id) => !liveSet.has(id));
    const anyReferenced = changed.some((id) => referenced.has(id));
    if (!anyReferenced && referenced.size >= 0 && changed.length > 0) {
      // Unused fact change → continue
      if (
        !staleness.diff.quote &&
        !staleness.diff.rightsRevisionRefs &&
        !staleness.diff.rightsRevoked &&
        !staleness.diff.contextDrifted
      ) {
        return { action: 'continue' };
      }
    }
    if (anyReferenced) {
      return {
        action: 'pause_prompt',
        reason: 'referenced_price_or_date_change',
        message: '已引用的事实发生变化，请确认后继续。',
        diff: staleness.diff,
      };
    }
  }

  if (staleness.diff.quote || staleness.diff.rightsRevisionRefs) {
    return {
      action: 'pause_prompt',
      reason: 'referenced_price_or_date_change',
      message: '报价或权利版本已变化，执行已暂停等待确认。',
      diff: staleness.diff,
    };
  }

  if (staleness.diff.contextDrifted) {
    return {
      action: 'complete_with_review',
      reason: 'soft_non_material_change',
      message: '非关键信息有更新，可完成当前稿，发布前请复核。',
    };
  }

  return { action: 'continue' };
}

/**
 * Post-confirm / pre-execute: material drift → stale reconfirm (delegates).
 */
export function evaluatePostConfirmPreExecuteFence(input: {
  snapshot: ExecutionPlanSnapshot;
  live: SnapshotLiveFacts;
}): ContextFenceAction {
  if (input.live.rightsRevoked === true) {
    return {
      action: 'safe_stop',
      reason: 'rights_revoked',
      message: '素材授权已撤销，无法按确认方案执行。',
      noAdditionalCharge: true,
      refundIfReserved: true,
    };
  }
  const staleness = evaluateExecutionPlanStaleness(input);
  if (staleness.status === 'stale') {
    return { action: 'stale_reconfirm', diff: staleness.diff };
  }
  return { action: 'continue' };
}
