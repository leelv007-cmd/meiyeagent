/**
 * EXEC-08 / EXEC-03a — merchant-visible P1/steering errors.
 * Upstream messages never render unless mapped.
 */

/** Exported for merchant-p1-error.static.test.ts's drift guard against Core. */
export const CODE_COPY: Record<string, string> = {
  NOT_FOUND: '现在还不能改这一页，等做出第一页再调。',
  QUEUE_NOT_READY: '现在还不能改这一页，等做出第一页再调。',
  INVALID_STATE: '现在还不能继续这一步，请稍后重试。',
  INVALID_INPUT: '这次调整没法这样改，请换一句再说。',
  CONFIRMATION_DECIDE_FAILED: '方案确认没能记下，请再试一次。',
  COMPOSER_PLAN_START_FAILED: '开始制作失败，请重试。',
  // FIND-B-004 / V31-91 — Core refuses a start for fifteen distinct reasons and
  // returns them all as one 409. Mapping each here is what makes the reason
  // merchant-visible; without it every refusal fell through to the generic
  // COMPOSER_PLAN_START_FAILED line above.
  //
  // These strings are copies of Core's own merchant copy, not paraphrases.
  // merchant-p1-error.static.test.ts reads the Core sources and fails if the
  // two ever disagree, which is the whole reason duplicating them is safe:
  // the alternative — rendering the upstream `message` directly — is what this
  // module exists to prevent ("白名单外永不渲染上游 message").
  COMPOSER_PLAN_START_UNAVAILABLE: '制作服务暂时不可用，请稍后再试。',
  COMPOSER_PLAN_START_TASK_NOT_FOUND:
    '没找到这次要开始的任务，请回到列表重新进入。',
  COMPOSER_PLAN_START_FREEZE_NOT_CONFIRMED:
    '这个方案还没有你确认过的版本，请先确认方案再开始。',
  COMPOSER_PLAN_START_AUTHORITY_UNAVAILABLE:
    '方案确认服务暂时不可用，请稍后再试。',
  COMPOSER_PLAN_START_AUTHORITY_INCOMPLETE:
    '方案确认服务暂时不可用，请稍后再试。',
  COMPOSER_PLAN_START_PLAN_AUTHORITY_MISMATCH:
    '方案已经更新过，请回到方案页重新确认后再开始。',
  COMPOSER_PLAN_START_DISPATCH_ID_MISSING:
    '这次确认的记录不完整，请重新确认方案。',
  COMPOSER_PLAN_START_REQUEST_MISMATCH:
    '这次确认对应的方案已经变了，请回到方案页重新确认。',
  COMPOSER_PLAN_START_NOT_DECIDED: '方案确认还没落实，请稍等一下再开始。',
  COMPOSER_PLAN_START_DECISION_NOT_CONFIRMED:
    '这次方案还没有确认通过，请先确认方案。',
  COMPOSER_PLAN_START_RUN_NOT_FOUND:
    '这次制作的会话已经不在了，请回到列表重新进入。',
  COMPOSER_PLAN_START_PLAN_REVISION_STALE:
    '方案刚刚更新过，请重新打开方案再开始。',
  COMPOSER_PLAN_START_FREEZE_DRIFTED:
    '你确认过的方案版本和当前方案对不上，请重新确认一次。',
  COMPOSER_PLAN_START_PLAN_NOT_READY:
    '这个方案还差点条件不能开始，请回到方案里看提示。',
  COMPOSER_PLAN_START_RUN_STATE_UNSTARTABLE:
    '这次制作正在进行或已经结束，不需要再开始了。',
};

const BANNED = /admitted|composer-task:|ExecutionPlanSnapshot|snapshotHash/i;

export function merchantMessageFromP1(input: {
  code?: string;
  message?: string;
  fallback?: string;
}): string {
  if (input.code && CODE_COPY[input.code]) return CODE_COPY[input.code];
  const raw = input.message?.trim() ?? '';
  if (!raw || BANNED.test(raw) || /[A-Za-z]{4,}/.test(raw)) {
    return input.fallback ?? '这次没能完成，请再试一次。';
  }
  return raw;
}
