/**
 * V31-17 Publish Handoff + merchant self-report journey contracts.
 *
 * Authority: V3.1 §6.2–§6.3, A19 (MobilePublishHandoff = merchant self-publish),
 * D-155 whitelist, U2 frequency. OutcomeEvidence write contract lives in
 * agent-domain (V31-19); this module only models handoff presentation +
 * journey control that *consume* that contract.
 */

import { z } from 'zod';

import {
  OUTCOME_SELF_REPORT_CHIP_SIGNALS,
  OUTCOME_SELF_REPORT_FREQUENCY_PARAMS,
} from './agent-domain.js';
import {
  identifierSchema,
  nonEmptyTrimmedStringSchema,
} from './identifiers.js';

const timestampSchema = z.iso.datetime();

export const PUBLISH_HANDOFF_SCHEMA_VERSION = 'publish-handoff/v1' as const;

/** Capability three-state for publish paths (D-086 / V3.1 §6.2). */
export const publishCapabilityModeSchema = z.enum([
  'automatic_verified',
  'assisted',
  'unavailable',
]);
export type PublishCapabilityMode = z.infer<typeof publishCapabilityModeSchema>;

/**
 * Merchant-facing capability presentation. Unverified modes never claim
 * direct publish is available (A19 / D-155).
 */
export const publishCapabilityPresentationSchema = z
  .object({
    mode: publishCapabilityModeSchema,
    /** Chinese merchant label. */
    label: nonEmptyTrimmedStringSchema.max(40),
    /** Why this mode; never implies automatic success when not verified. */
    description: nonEmptyTrimmedStringSchema.max(200),
    /** Direct-publish CTA is never shown (D-155 / RET-05 automatic publisher archived). */
    showDirectPublish: z.boolean(),
    /** Assisted handoff / copy-export path available. */
    showAssistedHandoff: z.boolean(),
    /** Floor path: copy + ZIP always preferred over fake direct publish. */
    showExportAndCopy: z.boolean(),
  })
  .strict();
export type PublishCapabilityPresentation = z.infer<
  typeof publishCapabilityPresentationSchema
>;

export const PUBLISH_CAPABILITY_LABEL: Record<
  PublishCapabilityMode,
  string
> = {
  automatic_verified: '暂不可用',
  assisted: '辅助交接',
  unavailable: '暂不可用',
};

/**
 * Project honest capability UI from runtime mode.
 * Main chain never projects automatic_verified as available (D-155 / RET-05).
 */
export function projectPublishCapabilityPresentation(
  mode: PublishCapabilityMode,
): PublishCapabilityPresentation {
  switch (mode) {
    case 'automatic_verified':
      return {
        mode: 'unavailable',
        label: PUBLISH_CAPABILITY_LABEL.unavailable,
        description:
          '平台代发已归档：仅可导出与复制材料，请勿将导出误认为已发布。',
        showDirectPublish: false,
        showAssistedHandoff: false,
        showExportAndCopy: true,
      };
    case 'assisted':
      return {
        mode,
        label: PUBLISH_CAPABILITY_LABEL.assisted,
        description:
          '未完成直发验证：请复制/下载后由你在平台 App 自行发布，或使用辅助交接。',
        showDirectPublish: false,
        showAssistedHandoff: true,
        showExportAndCopy: true,
      };
    case 'unavailable':
      return {
        mode,
        label: PUBLISH_CAPABILITY_LABEL.unavailable,
        description:
          '当前没有可用的发布通道：仅可导出与复制材料，请勿将导出误认为已发布。',
        showDirectPublish: false,
        showAssistedHandoff: false,
        showExportAndCopy: true,
      };
  }
}

/** Copy blocks for handoff (title / body / topics / CTA). */
export const publishHandoffCopyBlockRoleSchema = z.enum([
  'title',
  'body',
  'topics',
  'cta',
]);
export type PublishHandoffCopyBlockRole = z.infer<
  typeof publishHandoffCopyBlockRoleSchema
>;

export const publishHandoffCopyBlockSchema = z
  .object({
    role: publishHandoffCopyBlockRoleSchema,
    label: nonEmptyTrimmedStringSchema.max(40),
    value: z.string().max(8_000),
  })
  .strict();
export type PublishHandoffCopyBlock = z.infer<
  typeof publishHandoffCopyBlockSchema
>;

const COPY_BLOCK_LABEL: Record<PublishHandoffCopyBlockRole, string> = {
  title: '标题',
  body: '正文',
  topics: '话题',
  cta: '行动号召',
};

/**
 * Build ordered copy blocks; empty values are omitted (still ordered).
 */
export function buildPublishHandoffCopyBlocks(input: {
  title?: string;
  body?: string;
  topics?: readonly string[];
  cta?: string;
}): PublishHandoffCopyBlock[] {
  const blocks: PublishHandoffCopyBlock[] = [];
  const title = input.title?.trim() ?? '';
  const body = input.body?.trim() ?? '';
  const topics = (input.topics ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const cta = input.cta?.trim() ?? '';
  if (title) {
    blocks.push({
      role: 'title',
      label: COPY_BLOCK_LABEL.title,
      value: title,
    });
  }
  if (body) {
    blocks.push({
      role: 'body',
      label: COPY_BLOCK_LABEL.body,
      value: body,
    });
  }
  if (topics.length > 0) {
    blocks.push({
      role: 'topics',
      label: COPY_BLOCK_LABEL.topics,
      value: topics.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' '),
    });
  }
  if (cta) {
    blocks.push({
      role: 'cta',
      label: COPY_BLOCK_LABEL.cta,
      value: cta,
    });
  }
  return blocks;
}

/**
 * MobilePublishHandoff material (A19).
 * QR / one-shot link moves the handoff page to the phone so the *merchant*
 * publishes in their own platform app. Never encodes system-driven publish.
 */
export const mobilePublishHandoffSchema = z
  .object({
    schemaVersion: z.literal(PUBLISH_HANDOFF_SCHEMA_VERSION),
    handoffId: identifierSchema,
    /** One-shot token for /dashboard/handoff/$token. */
    token: nonEmptyTrimmedStringSchema.max(200),
    /** Absolute or app-relative URL shown as QR payload. */
    handoffUrl: nonEmptyTrimmedStringSchema.max(2_000),
    expiresAt: timestampSchema,
    contentPackageRef: z
      .object({
        id: identifierSchema,
        revision: z.union([
          z.number().int().nonnegative(),
          nonEmptyTrimmedStringSchema,
        ]),
      })
      .strict(),
    platform: nonEmptyTrimmedStringSchema.max(40),
    /**
     * Always merchant_self_publish. Driven publish is not a valid value here
     * (A19 / D-155).
     */
    publishActor: z.literal('merchant_self_publish'),
    /** Explicit negative: system must not auto-publish after scan. */
    systemDrivenPublishAllowed: z.literal(false),
  })
  .strict();
export type MobilePublishHandoff = z.infer<typeof mobilePublishHandoffSchema>;

/**
 * Intent attempted after scanning QR / opening handoff link.
 * Only merchant_self_publish is accepted; driven paths reject (A19).
 */
export const publishFromHandoffIntentSchema = z.enum([
  'merchant_self_publish',
  'system_driven_publish',
  'automatic_verified_publish',
  'platform_api_publish',
]);
export type PublishFromHandoffIntent = z.infer<
  typeof publishFromHandoffIntentSchema
>;

export const drivenPublishRejectSchema = z
  .object({
    ok: z.literal(false),
    code: z.literal('DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED'),
    /** Stable product reason (Chinese merchant-safe). */
    message: nonEmptyTrimmedStringSchema.max(200),
    intent: publishFromHandoffIntentSchema,
    authority: z.literal('A19'),
  })
  .strict();
export type DrivenPublishReject = z.infer<typeof drivenPublishRejectSchema>;

export const merchantSelfPublishAllowSchema = z
  .object({
    ok: z.literal(true),
    intent: z.literal('merchant_self_publish'),
    /** Materials only — caller still records「我已发布」separately. */
    next: z.literal('show_handoff_materials'),
  })
  .strict();
export type MerchantSelfPublishAllow = z.infer<
  typeof merchantSelfPublishAllowSchema
>;

export type PublishFromHandoffDecision =
  | DrivenPublishReject
  | MerchantSelfPublishAllow;

/**
 * A19 gate: QR / handoff path never drives publish for the merchant.
 */
export function decidePublishFromHandoff(
  intent: PublishFromHandoffIntent,
): PublishFromHandoffDecision {
  if (intent === 'merchant_self_publish') {
    return {
      ok: true,
      intent: 'merchant_self_publish',
      next: 'show_handoff_materials',
    };
  }
  return {
    ok: false,
    code: 'DRIVEN_PUBLISH_FROM_HANDOFF_REJECTED',
    message:
      '扫码后请你自己在平台 App 发布；系统不会代发或自动发布（A19）。',
    intent,
    authority: 'A19',
  };
}

/** Ordered image path inside deterministic ZIP (01.jpg …). */
export function orderedExportImagePath(
  index: number,
  extension: string,
): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('image index must be a non-negative integer');
  }
  const ext = extension.replace(/^\./u, '').toLowerCase() || 'jpg';
  return `images/${String(index + 1).padStart(2, '0')}.${ext}`;
}

/**
 * Video package platform safety-zone checklist (V3.1 §6.2).
 * V31-37 path A / V31-61: cover/subtitle are not product deliverables — no
 * checklist expectation slots for them.
 */
export const videoHandoffSafetyChecklistSchema = z
  .object({
    platformSafeZoneReminder: nonEmptyTrimmedStringSchema.max(200),
    items: z.array(nonEmptyTrimmedStringSchema.max(200)).min(1).max(20),
  })
  .strict();
export type VideoHandoffSafetyChecklist = z.infer<
  typeof videoHandoffSafetyChecklistSchema
>;

export function buildVideoHandoffSafetyChecklist(input: {
  platform: string;
}): VideoHandoffSafetyChecklist {
  return {
    platformSafeZoneReminder:
      '发布页注意平台安全区：标题与关键文案勿贴边，勿遮挡互动按钮。',
    items: [
      '确认视频文件可播放',
      `${input.platform}：避开底部互动栏与顶部状态栏安全区`,
    ],
  };
}

// ─── Self-report journey (U2 / §6.3) ─────────────────────────────────────────

export const selfReportAskStatusSchema = z.enum([
  'asked',
  'answered',
  'ignored',
]);
export type SelfReportAskStatus = z.infer<typeof selfReportAskStatusSchema>;

export const selfReportAskEventSchema = z
  .object({
    askId: identifierSchema,
    workId: identifierSchema,
    contentPackageId: identifierSchema,
    contentPackageRevision: z.union([
      z.number().int().nonnegative(),
      nonEmptyTrimmedStringSchema,
    ]),
    askedAt: timestampSchema,
    status: selfReportAskStatusSchema,
    answeredAt: timestampSchema.optional(),
    ignoredAt: timestampSchema.optional(),
  })
  .strict();
export type SelfReportAskEvent = z.infer<typeof selfReportAskEventSchema>;

export const selfReportAskDecisionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('ask'),
      prompt: nonEmptyTrimmedStringSchema.max(120),
      chips: z.array(z.enum(OUTCOME_SELF_REPORT_CHIP_SIGNALS)).min(1),
      workId: identifierSchema,
      contentPackageId: identifierSchema,
      contentPackageRevision: z.union([
        z.number().int().nonnegative(),
        nonEmptyTrimmedStringSchema,
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('skip'),
      reason: z.enum([
        'not_yet_next_day',
        'already_asked_this_work',
        'already_answered',
        'store_backoff',
        'no_publish_handoff',
        'coverage_observation_only',
      ]),
      detail: nonEmptyTrimmedStringSchema.max(200).optional(),
    })
    .strict(),
]);
export type SelfReportAskDecision = z.infer<typeof selfReportAskDecisionSchema>;

const MS_PER_DAY = 86_400_000;

function calendarDayUtc(iso: string): string {
  return iso.slice(0, 10);
}

function isNextCalendarDayOrLater(
  publishHandoffCompletedAt: string,
  now: string,
): boolean {
  const start = Date.parse(publishHandoffCompletedAt);
  const end = Date.parse(now);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  if (end < start) return false;
  // Next calendar day (UTC date boundary) or later — U2=A next_day_once.
  if (calendarDayUtc(now) > calendarDayUtc(publishHandoffCompletedAt)) {
    return true;
  }
  // Same calendar day never asks; also allow ≥24h as belt-and-suspenders.
  return end - start >= MS_PER_DAY;
}

/**
 * U2 self-report ask gate. Pure — consumers pass journey history + store
 * consecutive-ignore count. Coverage 40% is observation only (never blocks).
 */
export function evaluateSelfReportAsk(input: {
  workId: string;
  contentPackageId: string;
  contentPackageRevision: number | string;
  /** When publish handoff /「我已发布」completed; null = not ready. */
  publishHandoffCompletedAt: string | null;
  now: string;
  /** Asks already recorded for this work (max 1 per U2). */
  workAskHistory: readonly SelfReportAskEvent[];
  /**
   * Store-level consecutive ignored asks across works.
   * At/above threshold → backoff (skip further asks).
   */
  storeConsecutiveIgnores: number;
}): SelfReportAskDecision {
  const params = OUTCOME_SELF_REPORT_FREQUENCY_PARAMS;
  if (!input.publishHandoffCompletedAt) {
    return { kind: 'skip', reason: 'no_publish_handoff' };
  }
  if (
    input.storeConsecutiveIgnores >=
    params.consecutiveIgnoreThresholdForStoreBackoff
  ) {
    return {
      kind: 'skip',
      reason: 'store_backoff',
      detail: `连续 ${params.consecutiveIgnoreThresholdForStoreBackoff} 次未回应，本店已降频。`,
    };
  }
  const forWork = input.workAskHistory.filter(
    (row) => row.workId === input.workId,
  );
  if (forWork.some((row) => row.status === 'answered')) {
    return { kind: 'skip', reason: 'already_answered' };
  }
  if (forWork.length >= params.maxAsksPerWork) {
    return { kind: 'skip', reason: 'already_asked_this_work' };
  }
  if (
    !isNextCalendarDayOrLater(input.publishHandoffCompletedAt, input.now)
  ) {
    return { kind: 'skip', reason: 'not_yet_next_day' };
  }
  return {
    kind: 'ask',
    prompt: '昨天的笔记有人来问吗？',
    chips: [...OUTCOME_SELF_REPORT_CHIP_SIGNALS],
    workId: input.workId,
    contentPackageId: input.contentPackageId,
    contentPackageRevision: input.contentPackageRevision,
  };
}

/**
 * Project store consecutive ignores from an ordered ask history
 * (newest last). Stops counting at the first non-ignored event from the end.
 */
export function projectStoreConsecutiveIgnores(
  history: readonly SelfReportAskEvent[],
): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const row = history[i];
    if (!row) break;
    if (row.status === 'ignored') {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

/** Full publish handoff view (Delivered rail). */
export const publishHandoffViewSchema = z
  .object({
    schemaVersion: z.literal(PUBLISH_HANDOFF_SCHEMA_VERSION),
    contentPackageRef: z
      .object({
        id: identifierSchema,
        revision: z.union([
          z.number().int().nonnegative(),
          nonEmptyTrimmedStringSchema,
        ]),
      })
      .strict(),
    workId: identifierSchema.optional(),
    platform: nonEmptyTrimmedStringSchema.max(40),
    copyBlocks: z.array(publishHandoffCopyBlockSchema).max(10),
    /**
     * Deterministic ZIP download name projected for UI
     * (`{门店}-{类型}-{平台}-{YYYYMMDD}-{rN}.zip` style).
     */
    zipFileName: nonEmptyTrimmedStringSchema.max(200).optional(),
    orderedImagePaths: z.array(nonEmptyTrimmedStringSchema.max(120)).max(50),
    videoSafety: videoHandoffSafetyChecklistSchema.optional(),
    capability: publishCapabilityPresentationSchema,
    mobileHandoff: mobilePublishHandoffSchema.optional(),
    /** Exact revision frozen for「我已发布」binding. */
    publicationBindingRevision: z.union([
      z.number().int().nonnegative(),
      nonEmptyTrimmedStringSchema,
    ]),
  })
  .strict();
export type PublishHandoffView = z.infer<typeof publishHandoffViewSchema>;

// ─── Commands (P1 action surface) ───────────────────────────────────────────

export const prepareMobilePublishHandoffCommandSchema = z
  .object({
    packageId: identifierSchema,
    expectedRevision: z.number().int().nonnegative(),
    platform: nonEmptyTrimmedStringSchema.max(40),
    variantVersionId: identifierSchema,
    workId: identifierSchema.optional(),
    /** Relative path prefix for QR URL (default /dashboard/handoff/). */
    handoffPathPrefix: nonEmptyTrimmedStringSchema.max(100).optional(),
  })
  .strict();
export type PrepareMobilePublishHandoffCommand = z.infer<
  typeof prepareMobilePublishHandoffCommandSchema
>;

export const attemptPublishFromHandoffCommandSchema = z
  .object({
    handoffToken: nonEmptyTrimmedStringSchema.max(200),
    intent: publishFromHandoffIntentSchema,
    packageId: identifierSchema.optional(),
  })
  .strict();
export type AttemptPublishFromHandoffCommand = z.infer<
  typeof attemptPublishFromHandoffCommandSchema
>;

export const recordMerchantPublishedCommandSchema = z
  .object({
    packageId: identifierSchema,
    /** Exact ContentPackage revision binding (OCC + evidence). */
    expectedRevision: z.number().int().nonnegative(),
    platform: nonEmptyTrimmedStringSchema.max(40),
    variantVersionId: identifierSchema,
    publishedAt: timestampSchema.optional(),
    platformUrl: z.url().optional(),
    note: nonEmptyTrimmedStringSchema.max(120).optional(),
    accountDisplayLabel: nonEmptyTrimmedStringSchema.max(80).optional(),
    workId: identifierSchema.optional(),
  })
  .strict();
export type RecordMerchantPublishedCommand = z.infer<
  typeof recordMerchantPublishedCommandSchema
>;

export const recordSelfReportAskCommandSchema = z
  .object({
    workId: identifierSchema,
    contentPackageId: identifierSchema,
    contentPackageRevision: z.number().int().nonnegative(),
    action: z.enum(['mark_asked', 'mark_ignored', 'mark_answered']),
    askId: identifierSchema.optional(),
  })
  .strict();
export type RecordSelfReportAskCommand = z.infer<
  typeof recordSelfReportAskCommandSchema
>;

export const PUBLISH_HANDOFF_COMMAND_SCHEMAS = {
  prepare_mobile_publish_handoff: prepareMobilePublishHandoffCommandSchema,
  attempt_publish_from_handoff: attemptPublishFromHandoffCommandSchema,
  record_merchant_published: recordMerchantPublishedCommandSchema,
  record_self_report_ask: recordSelfReportAskCommandSchema,
} as const;
