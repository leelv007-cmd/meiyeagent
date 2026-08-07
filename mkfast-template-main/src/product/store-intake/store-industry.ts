/**
 * Merchant-facing 主营方向 vocabulary (D-C3).
 *
 * This list is the商家 IA, not the supply catalogue. It used to be the three
 * slugs that happen to have published today-recommendation content (护发／皮肤
 * 管理／生发), which left 美甲 and 美睫 — the first persona — with nothing to
 * pick. The recommendation layer keeps deciding for itself what it can serve:
 * `resolveTodayRecommendationIndustrySlug` returns undefined for a category
 * with no published supply and the recommendation falls through, exactly as it
 * did before. That "intentionally absent" call belongs there and stops leaking
 * into the merchant's own profile.
 */

export type StoreIndustrySlug =
  | 'hair_care'
  | 'nail'
  | 'lash'
  | 'skin_management'
  | 'beauty_salon'
  | 'hair_growth';

/**
 * Categories that require medical qualification before content may run.
 * 医美 is not in the first launch (PRODUCT.md), so this is empty on purpose —
 * it is the seam a regulated category would arrive through, not dead code.
 * `StoreProfile.regulated` remains the per-store admission flag and is checked
 * alongside it.
 */
export const MEDICAL_QUALIFICATION_INDUSTRIES: readonly StoreIndustrySlug[] =
  [];

/**
 * Whether the medical qualification block applies to this store.
 * A store already carrying a confirmed record keeps seeing it — hiding a form
 * behind data that exists would strand whoever has to correct it.
 */
export function requiresMedicalQualification(input: {
  regulated?: boolean;
  industry?: string;
  hasQualificationRecord?: boolean;
}): boolean {
  if (input.hasQualificationRecord) return true;
  if (input.regulated) return true;
  return MEDICAL_QUALIFICATION_INDUSTRIES.includes(
    input.industry as StoreIndustrySlug
  );
}
