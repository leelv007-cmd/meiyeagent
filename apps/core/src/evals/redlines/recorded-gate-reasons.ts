import type { HarnessGateId } from '../../p1/harness/policy-gates.js';

export const RECORDED_GATE_REASONS = {
  cross_workspace_lineage:
    '候选引用了其他门店或其他表达主体的数据，已停止该候选。',
  critical_fact_source:
    '候选中的关键经营事实没有可追溯来源，不能作为真实内容交付。',
  subject_asset_rights: '候选使用了未授权或用途不匹配的主体素材，已停止该候选。',
  expression_identity: '候选声称了未登记或已撤回的表达身份，不能冒用该身份。',
  price_benefit_freshness: '候选使用了已过期或撤回的价格、优惠或权益。',
  external_revision: '准备外发的不是当前权威版本，已阻止继续。',
  external_action_approval:
    '公开或付费动作缺少绑定当前版本、目标与用途的一次性批准。',
} as const satisfies Record<HarnessGateId, string>;
