/**
 * Beauty-industry self-built sensitive lexicon (spec §6.3 / issue #320).
 *
 * Structure matches xhswork `sensitive_words` (word/category/replacements/status)
 * but **does not** copy the 31-row xhswork seed. Words below are drafted for
 * medical-beauty / salon / spa marketing compliance and go through the human
 * review flow documented in docs/ops/issue-320-*.
 *
 * Used as: fixture for tests, platform baseline seed when DB is empty.
 */
import type { SensitiveWordRecord } from '@meiye/contracts';

const FIXED_AT = '2026-08-01T00:00:00.000Z';

function row(
  id: string,
  word: string,
  category: SensitiveWordRecord['category'],
  replacements: string[],
): SensitiveWordRecord {
  return {
    id,
    word,
    category,
    replacements,
    status: 'enabled',
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
  };
}

/** Platform baseline — beauty vertical only; not the xhswork demo seed. */
export const BEAUTY_FIXTURE_SENSITIVE_LEXICON: readonly SensitiveWordRecord[] = [
  row('sw-extreme-001', '根治', 'extreme', ['明显改善', '持续护理后改善']),
  row('sw-extreme-002', '永不反弹', 'extreme', ['科学维养', '坚持护理效果更稳']),
  row('sw-extreme-003', '100%有效', 'extreme', ['多数顾客反馈改善', '因人而异']),
  row('sw-extreme-004', '绝对安全', 'extreme', ['规范操作', '专业评估后进行']),
  row('sw-medical-001', '治愈色斑', 'medical', ['淡化色斑', '改善肤色均匀度']),
  row('sw-medical-002', '药效级', 'medical', ['专业护理级', '高效护理']),
  row('sw-medical-003', '手术级效果', 'medical', ['精细护理效果', '进阶护理体验']),
  row('sw-medical-004', '处方同款', 'medical', ['院线同源思路', '专业配方思路']),
  row('sw-cosmetic-001', '纯天然无添加', 'cosmetic', ['精简成分', '温和配方']),
  row('sw-cosmetic-002', '无任何副作用', 'cosmetic', ['温和友好', '敏感肌可先小范围试用']),
  row('sw-cosmetic-003', '激素级美白', 'cosmetic', ['提亮肤色', '均匀肤色护理']),
  row('sw-finance-001', '稳赚不赔', 'finance', ['性价比高', '按效果分期沟通']),
  row('sw-finance-002', '包回本', 'finance', ['透明报价', '按项目收费']),
  row('sw-legal-001', '永久免责', 'legal', ['服务说明见门店告知', '效果因人而异']),
  row('sw-legal-002', '国家级最优认证', 'legal', ['持证上岗', '规范资质展示']),
  row('sw-vulgar-001', '一夜见效变白', 'vulgar', ['循序渐进提亮', '按疗程护理']),
  row('sw-other-001', '秒变婴儿肌', 'other', ['肌肤更细腻', '护理后更水润']),
  row('sw-other-002', '一次瘦十斤', 'other', ['体态管理建议', '配合生活习惯调整']),
];

export const BEAUTY_FIXTURE_LEXICON_REVISION = 'beauty-sensitive-lexicon/v1';
