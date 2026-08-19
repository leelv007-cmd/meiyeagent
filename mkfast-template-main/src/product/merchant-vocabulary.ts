/**
 * Merchant vocabulary projector (UX-01A).
 *
 * Internal Thread / artifact / delivery / outcome / Memory tokens stay in
 * data attributes and contracts. Visible copy must go through this dictionary.
 * Unknown values fail closed — they never echo the raw engineering token.
 */

export class UnmappedMerchantVocabularyError extends Error {
  readonly kind: string;
  readonly raw: string;

  constructor(kind: string, raw: string) {
    super(`Unmapped merchant vocabulary: ${kind}=${JSON.stringify(raw)}`);
    this.name = 'UnmappedMerchantVocabularyError';
    this.kind = kind;
    this.raw = raw;
  }
}

/** Recent-list description. Never names Agent Thread. */
export const MERCHANT_THREAD_LIST_DESCRIPTION =
  '从这里回到同一条对话，接着上次的创作。';

export const MERCHANT_OBJECT_NAME = {
  'Agent Thread': '这次对话',
  thread: '这次对话',
} as const;

export const MERCHANT_THREAD_STATUS = {
  idle: '待开始',
  active: '活跃',
  waiting: '等你处理',
  delivered: '已完成',
  failed: '没做成',
  archived: '已归档',
} as const;

export const MERCHANT_ARTIFACT_STATUS = {
  skeleton: '起草中',
  partial: '还在生成',
  ready: '已就绪',
  failed: '没做成',
} as const;

export const MERCHANT_MEDIA_STATUS = {
  pending: '待生成',
  generating: '生成中',
  ready: '已就绪',
  failed: '没做成',
} as const;

export const MERCHANT_DELIVERY_MODE = {
  automatic_verified: '可直发',
  assisted: '辅助交接',
  unavailable: '暂不可用',
} as const;

export const MERCHANT_OUTCOME_SIGNAL = {
  inquiry: '有人问',
  wechat: '加微信',
  booking: '预约了',
  purchase: '买券',
  visit: '到店',
  no_activity: '没动静',
} as const;

export const MERCHANT_MEMORY_KEY = {
  memoryId: '这条经验',
  entryId: '这条经验',
  kind: '类型',
  authority: '效力',
  state: '状态',
  memoryState: '状态',
  statement: '内容',
  revision: '版本',
  source: '来源',
  preference: '门店偏好',
  correction: '你的纠正',
  procedure: '常用做法',
  observation: '观察',
  session: '这次对话',
  strong: '已确认',
  confirmed: '已确认',
  active: '生效中',
  proposed: '待确认',
  superseded: '已替换',
  revoked: '已撤销',
  expired: '已过期',
  proposedAt: '记录时间',
} as const;

const RAW_VOCABULARY_LEAK = [
  { label: 'Agent Thread', pattern: /Agent Thread/iu },
  { label: 'rN revision', pattern: /\br\d+\b/u },
  { label: 'artifact status', pattern: /\b(?:skeleton|partial)\b/u },
  {
    label: 'delivery mode',
    pattern: /\b(?:automatic_verified|unavailable)\b/u,
  },
  {
    label: 'outcome enum',
    pattern: /\b(?:no_activity|inquiry|wechat|booking)\b/u,
  },
  {
    label: 'memory key',
    pattern: /\b(?:memoryId|entryId|memoryState|semanticKey)\b/u,
  },
] as const;

function lookup(
  kind: string,
  table: Record<string, string>,
  raw: string
): string {
  const mapped = table[raw];
  if (!mapped || mapped === raw) {
    throw new UnmappedMerchantVocabularyError(kind, raw);
  }
  return mapped;
}

export function projectMerchantObjectName(raw: string): string {
  return lookup('objectName', MERCHANT_OBJECT_NAME, raw);
}

export function projectMerchantThreadStatus(raw: string): string {
  return lookup('threadStatus', MERCHANT_THREAD_STATUS, raw);
}

export function projectMerchantArtifactStatus(raw: string): string {
  return lookup('artifactStatus', MERCHANT_ARTIFACT_STATUS, raw);
}

export function projectMerchantMediaStatus(raw: string): string {
  return lookup('mediaStatus', MERCHANT_MEDIA_STATUS, raw);
}

export function projectMerchantDeliveryMode(raw: string): string {
  return lookup('deliveryMode', MERCHANT_DELIVERY_MODE, raw);
}

export function projectMerchantOutcomeSignal(raw: string): string {
  return lookup('outcomeSignal', MERCHANT_OUTCOME_SIGNAL, raw);
}

export function projectMerchantMemoryKey(raw: string): string {
  return lookup('memoryKey', MERCHANT_MEMORY_KEY, raw);
}

export function projectMerchantRevision(revision: number): string {
  if (!Number.isInteger(revision) || revision < 0) {
    throw new UnmappedMerchantVocabularyError('revision', String(revision));
  }
  return `第 ${revision} 版`;
}

function isInternalMemoryKey(key: string): boolean {
  return (
    /(?:Id|Revision|Ref)$/u.test(key) ||
    key === 'semanticKey' ||
    key === 'memoryState'
  );
}

/**
 * Label for a Memory value-object field. Known schema keys are projected.
 * Internal identifier shapes are hidden. Shop-owned field names stay readable.
 */
export function projectMerchantMemoryFieldLabel(key: string): string | null {
  if (Object.hasOwn(MERCHANT_MEMORY_KEY, key)) {
    return projectMerchantMemoryKey(key);
  }
  if (isInternalMemoryKey(key)) {
    return null;
  }
  return key.replace(/[._]/g, ' ');
}

/** Visible-copy leak detector for behavior tests. */
export function merchantVocabularyIssues(text: string): string[] {
  return RAW_VOCABULARY_LEAK.filter(({ pattern }) => pattern.test(text)).map(
    ({ label }) => label
  );
}
