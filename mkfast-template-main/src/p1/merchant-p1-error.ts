/**
 * EXEC-08 / EXEC-03a — merchant-visible P1/steering errors.
 * Upstream messages never render unless mapped.
 */

const CODE_COPY: Record<string, string> = {
  NOT_FOUND: '现在还不能改这一页，等做出第一页再调。',
  QUEUE_NOT_READY: '现在还不能改这一页，等做出第一页再调。',
  INVALID_STATE: '现在还不能继续这一步，请稍后重试。',
  INVALID_INPUT: '这次调整没法这样改，请换一句再说。',
  CONFIRMATION_DECIDE_FAILED: '方案确认没能记下，请再试一次。',
  COMPOSER_PLAN_START_FAILED: '开始制作失败，请重试。',
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
