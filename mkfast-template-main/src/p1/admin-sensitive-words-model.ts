import {
  SENSITIVE_WORD_CATEGORIES,
  type SensitiveWordCategory,
  type SensitiveWordRecord,
  type SensitiveWordStatus,
} from '@meiye/contracts';

export const ADMIN_SENSITIVE_WORD_CATEGORIES = SENSITIVE_WORD_CATEGORIES;

export type AdminSensitiveWordDraft = {
  word: string;
  category: SensitiveWordCategory;
  replacementsText: string;
  status: SensitiveWordStatus;
};

export function emptySensitiveWordDraft(): AdminSensitiveWordDraft {
  return {
    word: '',
    category: 'other',
    replacementsText: '',
    status: 'enabled',
  };
}

export function parseReplacementsText(value: string): string[] {
  return value
    .split(/[,，\n]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 20);
}

export function formatReplacements(replacements: readonly string[]): string {
  return replacements.join('，');
}

export function draftFromRecord(
  row: SensitiveWordRecord
): AdminSensitiveWordDraft {
  return {
    word: row.word,
    category: row.category,
    replacementsText: formatReplacements(row.replacements),
    status: row.status,
  };
}

export function validateSensitiveWordDraft(
  draft: AdminSensitiveWordDraft
): string | null {
  if (!draft.word.trim()) return '违禁词不能为空';
  if (draft.word.trim().length > 100) return '违禁词过长';
  if (!ADMIN_SENSITIVE_WORD_CATEGORIES.includes(draft.category)) {
    return '分类无效';
  }
  return null;
}

export function categoryLabel(category: SensitiveWordCategory): string {
  switch (category) {
    case 'extreme':
      return '极限用语';
    case 'medical':
      return '医疗用语';
    case 'cosmetic':
      return '化妆品禁用语';
    case 'finance':
      return '金融用语';
    case 'legal':
      return '法律风险词';
    case 'vulgar':
      return '低俗用语';
    case 'other':
      return '其他';
  }
}
