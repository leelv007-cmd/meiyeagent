/**
 * Day-0 store-profile platform defaults (V31-86).
 *
 * These three strings are the only values that may reach an initializing
 * profile patch without a StoreFact confirmation. Gate 1 still requires the
 * fields; gate 2 exempts only this exact trio, and only on revision 0.
 * `brandVoice` stays a frontend-only fallback — it is not a mapped fact.
 */

export const STORE_PROFILE_PLATFORM_DEFAULTS = {
  district: '本区',
  address: '门店地址待补充',
  booking: '到店咨询预约',
} as const;

export type StoreProfilePlatformDefaultField =
  keyof typeof STORE_PROFILE_PLATFORM_DEFAULTS;

export const STORE_PROFILE_PLATFORM_DEFAULT_FIELDS = [
  'district',
  'address',
  'booking',
] as const satisfies readonly StoreProfilePlatformDefaultField[];

export const STORE_INTAKE_FIELD_PROVENANCE = [
  'merchant_stated',
  'ai_suggestion',
  'platform_default',
] as const;

export type StoreIntakeFieldProvenance =
  (typeof STORE_INTAKE_FIELD_PROVENANCE)[number];

export function isStoreProfilePlatformDefaultField(
  field: string,
): field is StoreProfilePlatformDefaultField {
  return (STORE_PROFILE_PLATFORM_DEFAULT_FIELDS as readonly string[]).includes(
    field,
  );
}

export function isStoreProfilePlatformDefault(
  field: string,
  value: unknown,
): boolean {
  return (
    isStoreProfilePlatformDefaultField(field) &&
    value === STORE_PROFILE_PLATFORM_DEFAULTS[field]
  );
}
