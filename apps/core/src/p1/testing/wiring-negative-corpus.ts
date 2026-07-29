export const WIRING_NEGATIVE_CASE_IDS = [
  'available-but-unbound',
  'dynamic-not-in-inventory',
  'inventory-blind-to-closure',
  'invalid-shape-silently-inert',
  'duplicate-authority-key',
] as const;

export type WiringNegativeCaseId =
  (typeof WIRING_NEGATIVE_CASE_IDS)[number];

export function defineWiringNegativeCorpus<T>(
  cases: Readonly<Record<WiringNegativeCaseId, T>>,
) {
  if (
    new Set<WiringNegativeCaseId>(WIRING_NEGATIVE_CASE_IDS).size !==
    WIRING_NEGATIVE_CASE_IDS.length
  ) {
    throw new Error('Wiring negative corpus case ids must be unique.');
  }
  return cases;
}
