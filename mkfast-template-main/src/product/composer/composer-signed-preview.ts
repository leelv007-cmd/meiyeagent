/**
 * Read-only preview of the fields the server signs and admission freezes
 * (T08 / M-01 / D-112).
 *
 * The submission body carries three merchant-confirmed things — 发到哪/用在哪,
 * 交付物, 模型设置. This module projects them into merchant language for
 * display only. It is deliberately a projection and not a form: the signed
 * fields belong to `composerSubmissionSignedFieldsSchema`, the server re-parses
 * the body and freezes it at admission, and turning any of these back into an
 * editable control would recreate the D-031 槽位填表 that D-114 replaced with the
 * conversation.
 *
 * Merchant-facing rules honoured here: no internal ids (D-116), no engineering
 * vocabulary, and no cost figures (D-123 内部成本基准永不进前台).
 */

import type {
  ComposerContentPackagePlatform,
  ComposerDeliverableKind,
  ComposerDistributionTarget,
  ComposerSubmissionSignedFields,
} from '@meiye/contracts';

const PLATFORM_LABELS: Record<ComposerContentPackagePlatform, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  video_account: '视频号',
  wechat_moments: '朋友圈',
  offline_material: '线下物料',
  generic: '通用素材',
};

const DELIVERABLE_LABELS: Record<ComposerDeliverableKind, string> = {
  copy_document: '文案',
  note: '图文笔记',
  image_set: '图片',
  poster: '海报',
  image_text_package: '图文全包',
  video_package: '视频成片',
};

const DISTRIBUTION_LABELS: Record<ComposerDistributionTarget, string> = {
  export: '生成后导出',
  manual_copy: '生成后手动复制',
  assisted_handoff: '生成后协办交接',
  'publish:xiaohongshu': '生成后发布到小红书',
  'publish:douyin': '生成后发布到抖音',
  'publish:video_account': '生成后发布到视频号',
};

export type ComposerSignedPreviewRow = {
  /** Stable test/telemetry handle — never shown to the merchant. */
  key: 'destination' | 'deliverable' | 'model';
  label: string;
  value: string;
};

export type ComposerSignedPreview = {
  rows: ComposerSignedPreviewRow[];
  /** What the merchant gets to do with the result once it exists. */
  capability: string;
};

function deliverableValue(
  deliverable: ComposerSubmissionSignedFields['deliverable']
): string {
  const parts = [DELIVERABLE_LABELS[deliverable.kind]];
  if (deliverable.quantity > 1) parts.push(`${deliverable.quantity} 份`);
  if (deliverable.aspectRatio) parts.push(deliverable.aspectRatio);
  if (deliverable.durationSeconds) {
    parts.push(`${deliverable.durationSeconds} 秒`);
  }
  return parts.join(' · ');
}

/**
 * Project the signed fields for display. `modelName` is the catalog model's
 * merchant-facing display name — the signed `catalogModel.id`/`revision` are
 * identifiers and never rendered.
 */
export function projectComposerSignedPreview(input: {
  signed: ComposerSubmissionSignedFields;
  modelName?: string | null;
}): ComposerSignedPreview {
  const rows: ComposerSignedPreviewRow[] = [
    {
      key: 'destination',
      label: '发到哪',
      value: PLATFORM_LABELS[input.signed.contentPackagePlatform],
    },
    {
      key: 'deliverable',
      label: '交付物',
      value: deliverableValue(input.signed.deliverable),
    },
  ];
  const modelName = input.modelName?.trim();
  if (modelName) {
    rows.push({ key: 'model', label: '生成方式', value: modelName });
  }
  return {
    rows,
    capability: DISTRIBUTION_LABELS[input.signed.distributionTarget],
  };
}

/**
 * Admission freeze check: what the merchant saw must equal what the server
 * froze. Compares the signed shape the container submitted against the values
 * the server echoed back, so a silent override fails loudly instead of being
 * absorbed by the UI (D-112「无静默覆盖」).
 */
export function composerSignedPreviewMatchesFrozen(
  shown: ComposerSubmissionSignedFields,
  frozen: ComposerSubmissionSignedFields
): boolean {
  return (
    shown.contentPackagePlatform === frozen.contentPackagePlatform &&
    shown.distributionTarget === frozen.distributionTarget &&
    shown.catalogModel.id === frozen.catalogModel.id &&
    shown.catalogModel.revision === frozen.catalogModel.revision &&
    shown.recipe.id === frozen.recipe.id &&
    shown.recipe.revision === frozen.recipe.revision &&
    shown.deliverable.kind === frozen.deliverable.kind &&
    shown.deliverable.quantity === frozen.deliverable.quantity &&
    (shown.deliverable.aspectRatio ?? null) ===
      (frozen.deliverable.aspectRatio ?? null) &&
    (shown.deliverable.durationSeconds ?? null) ===
      (frozen.deliverable.durationSeconds ?? null)
  );
}
