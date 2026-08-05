import type {
  ActionableInboxStatusKind,
  ContentPackageStatus,
  ContentPackageStatusGroup,
} from '@meiye/contracts';
import {
  contentPackageStatusGroup,
  publicContentPackageSchema,
} from '@meiye/contracts';
import { z } from 'zod';

export const CONTENT_PACKAGE_STATUS_GROUP_LABELS = {
  creating: '创作中',
  needs_attention: '需处理',
  usable: '可使用',
} as const satisfies Record<ContentPackageStatusGroup, string>;

export function contentPackageStatusLabel(status: ContentPackageStatus) {
  return CONTENT_PACKAGE_STATUS_GROUP_LABELS[contentPackageStatusGroup(status)];
}

/**
 * `listContentPackages` spreads `contentPackageVisibleStatus(status)` over every
 * package it returns, so `statusGroup` arrives on the wire even though the
 * ContentPackage contract — which is strict — never declared it. Drop the
 * derived key before validating and recompute it below: how a status reads to a
 * merchant is presentation, and presentation is this side's to own. Every other
 * undeclared key still fails the parse.
 */
export const contentPackageProjectionSchema = z
  .preprocess((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return value;
    }
    const { statusGroup: _derived, ...wire } = value as Record<string, unknown>;
    return wire;
  }, publicContentPackageSchema)
  .transform((contentPackage) => ({
    ...contentPackage,
    statusGroup: contentPackageStatusGroup(contentPackage.status),
    statusLabel: contentPackageStatusLabel(contentPackage.status),
  }));

export const contentPackageProjectionListSchema = z.array(
  contentPackageProjectionSchema
);

export type ContentPackageProjection = z.infer<
  typeof contentPackageProjectionSchema
>;

export const ACTIONABLE_INBOX_STATUS_LABEL: Record<
  ActionableInboxStatusKind,
  string
> = {
  acceptance_unknown_recovery: '需恢复核验',
  delivery_completed: '交付完成',
  delivery_partial_or_unknown: '交付部分成功/失败/未知',
  needs_choice_or_confirm: '需要选择/补确认',
  result_available: '结果可用',
  task_failed: '任务最终失败',
};
