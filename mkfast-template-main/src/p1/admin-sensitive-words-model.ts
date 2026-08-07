import {
  SENSITIVE_WORD_CATEGORIES,
  type SensitiveWordCategory,
  type SensitiveWordRecord,
  type SensitiveWordStatus,
} from '@meiye/contracts';

import {
  admin_sensitive_word_category_cosmetic,
  admin_sensitive_word_category_extreme,
  admin_sensitive_word_category_finance,
  admin_sensitive_word_category_legal,
  admin_sensitive_word_category_medical,
  admin_sensitive_word_category_other,
  admin_sensitive_word_category_vulgar,
  admin_sensitive_word_error_empty,
  admin_sensitive_word_error_invalid_category,
  admin_sensitive_word_error_too_long,
} from '@/locale/paraglide/messages';

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
  if (!draft.word.trim()) return admin_sensitive_word_error_empty();
  if (draft.word.trim().length > 100)
    return admin_sensitive_word_error_too_long();
  if (!ADMIN_SENSITIVE_WORD_CATEGORIES.includes(draft.category)) {
    return admin_sensitive_word_error_invalid_category();
  }
  return null;
}

export function categoryLabel(category: SensitiveWordCategory): string {
  switch (category) {
    case 'extreme':
      return admin_sensitive_word_category_extreme();
    case 'medical':
      return admin_sensitive_word_category_medical();
    case 'cosmetic':
      return admin_sensitive_word_category_cosmetic();
    case 'finance':
      return admin_sensitive_word_category_finance();
    case 'legal':
      return admin_sensitive_word_category_legal();
    case 'vulgar':
      return admin_sensitive_word_category_vulgar();
    case 'other':
      return admin_sensitive_word_category_other();
  }
}
