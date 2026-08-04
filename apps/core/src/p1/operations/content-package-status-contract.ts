import type { ContentPackageStatus } from '@meiye/contracts';

export type ContentPackageAction =
  | 'adopt'
  | 'cancel'
  | 'edit_text'
  | 'export'
  | 'recreate'
  | 'retry_export'
  | 'reuse'
  | 'view';

export const CONTENT_PACKAGE_ACTIONS_BY_STATUS = {
  accepted: ['view', 'edit_text', 'export', 'reuse', 'cancel'],
  cancelled: ['view'],
  cancelling: ['view'],
  draft: ['view', 'cancel'],
  export_failed: ['view', 'edit_text', 'retry_export'],
  generating: ['view', 'cancel'],
  needs_input: ['view', 'cancel'],
  needs_replacement: ['view', 'edit_text', 'recreate', 'cancel'],
  partial: ['view', 'cancel'],
  review_ready: ['view', 'edit_text', 'adopt', 'cancel'],
  save_unknown: ['view'],
  verifying: ['view', 'cancel'],
} as const satisfies Record<
  ContentPackageStatus,
  readonly ContentPackageAction[]
>;

export function contentPackageActions(
  status: ContentPackageStatus,
): readonly ContentPackageAction[] {
  return CONTENT_PACKAGE_ACTIONS_BY_STATUS[status];
}

export const CONTENT_PACKAGE_STATUS_CONTRACTS = [
  {
    mustBehavior: '不创建付费任务，原地补齐',
    scenario: '信息或授权缺失',
    status: 'draft / needs_input',
    statuses: ['draft', 'needs_input'],
  },
  {
    mustBehavior: '使用原幂等键，只查询',
    scenario: '已持久化但受理未知',
    status: 'generating / verifying',
    statuses: ['generating', 'verifying'],
  },
  {
    mustBehavior: '保留成功，仅重试失败子任务',
    scenario: '子任务部分成功',
    status: 'partial',
    statuses: ['partial'],
  },
  {
    mustBehavior: '不再显示 running',
    scenario: '供应商完成',
    status: 'review_ready',
    statuses: ['review_ready'],
  },
  {
    mustBehavior: '展示真实状态，限制重提',
    scenario: '取消中/已取消',
    status: 'cancelling / cancelled',
    statuses: ['cancelling', 'cancelled'],
  },
  {
    mustBehavior: '幂等查询/重放，不重复版本',
    scenario: '保存结果未知',
    status: 'save_unknown',
    statuses: ['save_unknown'],
  },
  {
    mustBehavior: '进入唯一内容库并形成版本',
    scenario: '用户采用',
    status: 'accepted',
    statuses: ['accepted'],
  },
  {
    mustBehavior: '阻止新导出，提示替换',
    scenario: '授权撤销',
    status: 'needs_replacement',
    statuses: ['needs_replacement'],
  },
  {
    mustBehavior: '成品不回退，只重试导出',
    scenario: '单个平台导出失败',
    status: 'accepted / export_failed',
    statuses: ['accepted', 'export_failed'],
  },
  {
    mustBehavior: '使用已归档本地文件',
    scenario: '供应商 URL 过期',
    status: '状态不变',
    statuses: [],
  },
] as const satisfies ReadonlyArray<{
  mustBehavior: string;
  scenario: string;
  status: string;
  statuses: readonly ContentPackageStatus[];
}>;
