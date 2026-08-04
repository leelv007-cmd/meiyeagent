import type {
  ActionableInboxStatusKind,
  ContentPackageStatus,
  ContentPackageStatusGroup,
} from '@meiye/contracts';
import { contentPackageStatusGroup } from '@meiye/contracts';

export const CONTENT_PACKAGE_STATUS_GROUP_LABELS = {
  creating: '创作中',
  needs_attention: '需处理',
  usable: '可使用',
} as const satisfies Record<ContentPackageStatusGroup, string>;

export function contentPackageStatusLabel(status: ContentPackageStatus) {
  return CONTENT_PACKAGE_STATUS_GROUP_LABELS[contentPackageStatusGroup(status)];
}

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
