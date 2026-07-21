/**
 * Dynamic settings row for the Composer (D-076 / D-081 T2).
 *
 * Shows 3–5 high-frequency product fields for the current lens,
 * always including the visible CatalogModel name. Channel-side fields
 * (Provider / Deployment / Credential / fallback) are never listed.
 */

import type { CreationLensId } from '@meiye/contracts';

export type SettingsFieldKey =
  | 'catalogModel'
  | 'aspectRatio'
  | 'quantity'
  | 'durationSeconds'
  | 'platform'
  | 'deliverableKind'
  | 'referenceCount';

export type SettingsFieldKind = 'model' | 'enum' | 'number' | 'text';

export interface SettingsFieldDef {
  key: SettingsFieldKey;
  kind: SettingsFieldKind;
  label: string;
  /** True when this field is the visible CatalogModel product name (T2). */
  isCatalogModel?: boolean;
}

export interface CatalogModelOption {
  id: string;
  /** Merchant-facing product name only — never a provider model string. */
  displayName: string;
  revision?: string;
}

export interface DynamicSettingsRowInput {
  lensId: CreationLensId | null;
  catalogModel?: CatalogModelOption | null;
  aspectRatio?: string | null;
  quantity?: number | null;
  durationSeconds?: number | null;
  platform?: string | null;
  deliverableKind?: string | null;
  referenceCount?: number | null;
}

export interface DynamicSettingsFieldValue {
  def: SettingsFieldDef;
  value: string | number | null;
  /** Display string for the UI. */
  displayValue: string;
}

/** High-frequency field sets per lens (3–5 items, CatalogModel always first). */
const LENS_FIELD_KEYS: Record<CreationLensId, readonly SettingsFieldKey[]> = {
  copy: ['catalogModel', 'quantity', 'platform', 'deliverableKind'],
  image_text: [
    'catalogModel',
    'aspectRatio',
    'quantity',
    'platform',
    'deliverableKind',
  ],
  video: [
    'catalogModel',
    'aspectRatio',
    'durationSeconds',
    'platform',
    'deliverableKind',
  ],
};

const FIELD_DEFS: Record<SettingsFieldKey, SettingsFieldDef> = {
  catalogModel: {
    key: 'catalogModel',
    kind: 'model',
    label: '模型',
    isCatalogModel: true,
  },
  aspectRatio: {
    key: 'aspectRatio',
    kind: 'enum',
    label: '比例',
  },
  quantity: {
    key: 'quantity',
    kind: 'number',
    label: '数量',
  },
  durationSeconds: {
    key: 'durationSeconds',
    kind: 'number',
    label: '时长',
  },
  platform: {
    key: 'platform',
    kind: 'text',
    label: '平台',
  },
  deliverableKind: {
    key: 'deliverableKind',
    kind: 'text',
    label: '交付物',
  },
  referenceCount: {
    key: 'referenceCount',
    kind: 'number',
    label: '参考',
  },
};

/**
 * Build the 3–5 field settings row for the current lens.
 * Cold (unselected) → empty row (settings only appear after explicit lens pick).
 */
export function buildDynamicSettingsRow(
  input: DynamicSettingsRowInput
): DynamicSettingsFieldValue[] {
  if (!input.lensId) return [];

  const keys = LENS_FIELD_KEYS[input.lensId];
  return keys.map((key) => {
    const def = FIELD_DEFS[key];
    const raw = readFieldValue(input, key);
    return {
      def,
      value: raw,
      displayValue: formatFieldValue(key, raw, input.catalogModel),
    };
  });
}

function readFieldValue(
  input: DynamicSettingsRowInput,
  key: SettingsFieldKey
): string | number | null {
  switch (key) {
    case 'catalogModel':
      return input.catalogModel?.id ?? null;
    case 'aspectRatio':
      return input.aspectRatio ?? null;
    case 'quantity':
      return input.quantity ?? null;
    case 'durationSeconds':
      return input.durationSeconds ?? null;
    case 'platform':
      return input.platform ?? null;
    case 'deliverableKind':
      return input.deliverableKind ?? null;
    case 'referenceCount':
      return input.referenceCount ?? null;
  }
}

function formatFieldValue(
  key: SettingsFieldKey,
  raw: string | number | null,
  catalogModel?: CatalogModelOption | null
): string {
  if (key === 'catalogModel') {
    return catalogModel?.displayName ?? '智能匹配';
  }
  if (key === 'durationSeconds' && typeof raw === 'number') {
    return `${raw} 秒`;
  }
  if (raw === null || raw === undefined || raw === '') return '—';
  return String(raw);
}

/** Assert the row never exceeds 5 fields and always leads with CatalogModel. */
export function assertSettingsRowContract(
  fields: DynamicSettingsFieldValue[]
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (fields.length > 0 && fields.length < 3) {
    errors.push(
      `settings row must have at least 3 fields, got ${fields.length}`
    );
  }
  if (fields.length > 5) {
    errors.push(
      `settings row must have at most 5 fields, got ${fields.length}`
    );
  }
  if (fields.length > 0 && !fields[0]?.def.isCatalogModel) {
    errors.push('first settings field must be visible CatalogModel name (T2)');
  }
  for (const field of fields) {
    if (
      field.def.key === 'catalogModel' &&
      /provider|deployment|credential|fallback/i.test(field.displayValue)
    ) {
      errors.push('CatalogModel display must not leak channel terms');
    }
  }
  return { ok: errors.length === 0, errors };
}
