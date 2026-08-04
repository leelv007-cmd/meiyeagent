import {
  CONTEXT_DIMENSIONS,
  harnessExperienceBasisSchema,
  type ContextBundle,
  type HarnessExperienceBasis,
} from '@meiye/contracts';

export function projectHarnessExperienceBasis(
  bundle: ContextBundle,
): HarnessExperienceBasis {
  const resolved = CONTEXT_DIMENSIONS.flatMap((dimension) =>
    Object.entries(bundle.dimensions[dimension])
      .filter(([, value]) => value.layer === 'confirmed_preference')
      .map(([key, value]) => ({ key, ...value })),
  ).sort(
    (left, right) =>
      left.sourceRef.localeCompare(right.sourceRef) ||
      left.key.localeCompare(right.key),
  );
  const seen = new Set<string>();
  const confirmedPreferences = resolved.flatMap((preference) => {
    if (seen.has(preference.sourceRef)) return [];
    seen.add(preference.sourceRef);
    return [
      {
        sourceRef: preference.sourceRef,
        label: harnessExperienceLabel(
          preference.value,
          preference.sourceRef,
        ),
        value: preference.value,
      },
    ];
  });
  return harnessExperienceBasisSchema.parse({
    taskId: bundle.taskId,
    contextBundleId: bundle.bundleId,
    contextBundleRevision: bundle.revision,
    confirmedPreferences,
  });
}

function harnessExperienceLabel(value: unknown, fallback: string) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .filter(
        (item): item is string | number | boolean =>
          typeof item === 'string' ||
          typeof item === 'number' ||
          typeof item === 'boolean',
      )
      .map(String)
      .filter((item) => item.trim());
    if (parts.length > 0) return parts.slice(0, 3).join(' · ');
  }
  if (value && typeof value === 'object') {
    const parts = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([, nested]) => {
        if (typeof nested === 'string' && nested.trim()) {
          return [nested.trim()];
        }
        if (typeof nested === 'number' || typeof nested === 'boolean') {
          return [String(nested)];
        }
        return [];
      });
    if (parts.length > 0) return parts.slice(0, 3).join(' · ');
  }
  return fallback;
}
