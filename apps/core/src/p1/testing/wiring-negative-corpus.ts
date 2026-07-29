export const WIRING_NEGATIVE_CASE_IDS = [
  'available-but-unbound',
  'dynamic-not-in-inventory',
  'inventory-blind-to-closure',
  'invalid-shape-silently-inert',
  'duplicate-authority-key',
] as const;

export type WiringNegativeCaseId =
  (typeof WIRING_NEGATIVE_CASE_IDS)[number];

export interface WiringEvidenceProbe {
  authorityKeys: readonly string[];
  availableKeys: readonly string[];
  boundKeys: readonly string[];
  closureRequiredKeys: readonly string[];
  dynamicKeys: readonly string[];
  inventoryKeys: readonly string[];
  invalidShapeKeys: readonly string[];
}

export function defineWiringNegativeCorpus<T>(
  cases: Readonly<Record<WiringNegativeCaseId, T>>,
) {
  return WIRING_NEGATIVE_CASE_IDS.map((caseId) => ({
    caseId,
    value: cases[caseId],
  }));
}

export function detectWiringEvidenceFailures(
  probe: WiringEvidenceProbe,
): WiringNegativeCaseId[] {
  const available = new Set(probe.availableKeys);
  const bound = new Set(probe.boundKeys);
  const inventory = new Set(probe.inventoryKeys);
  const duplicateAuthorityKeys = duplicateKeys(probe.authorityKeys);

  return WIRING_NEGATIVE_CASE_IDS.filter((caseId) => {
    switch (caseId) {
      case 'available-but-unbound':
        return [...available].some((key) => !bound.has(key));
      case 'dynamic-not-in-inventory':
        return probe.dynamicKeys.some((key) => !inventory.has(key));
      case 'inventory-blind-to-closure':
        return probe.closureRequiredKeys.some((key) => !inventory.has(key));
      case 'invalid-shape-silently-inert':
        return probe.invalidShapeKeys.length > 0;
      case 'duplicate-authority-key':
        return duplicateAuthorityKeys.size > 0;
    }
  });
}

function duplicateKeys(keys: readonly string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return duplicates;
}
