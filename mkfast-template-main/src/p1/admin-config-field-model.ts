/**
 * 受控配置的「schema → 表单件」映射层（U05 / D-107）。
 *
 * 后台改配置以前只有一个 JSON 文本域：运营要照着契约手敲花括号，敲错了才在
 * 提交时被告知「不是有效 JSON」。这一层把每个配置项的 zod 契约读成一棵字段树，
 * 由 `admin-config-form.tsx` 渲染成开关、选择器、步进器和成组的行编辑，
 * 于是运营看到的是「默认加水印 / 试用期几天 / 这个风格适用哪些平台」，
 * 而不是一段要自己拼对的文本。
 *
 * 契约仍然只有一份：字段树是从 `admin-config-view-model.ts` 里那份 zod 读出来的，
 * 不是另抄一份。契约改了字段树跟着改，提交前后端也仍各校验一次。
 */
import { DEFAULT_NOTE_STYLES, NOTE_STYLE_CONFIG_KEY } from '@meiye/contracts';
import type { z } from 'zod';

import {
  adminConfigSchemaFor,
  type AdminConfigKey,
} from '@/p1/admin-config-view-model';
import {
  admin_config_field_amount_micros,
  admin_config_field_amount_micros_hint,
  admin_config_field_currency,
  admin_config_field_id,
  admin_config_field_interval,
  admin_config_field_mappings,
  admin_config_field_payment_product_id,
  admin_config_field_platforms,
  admin_config_field_quantity,
  admin_config_field_resource,
  admin_config_field_structure_template,
  admin_config_field_style_name,
  admin_config_field_styles,
  admin_config_field_tier,
  admin_config_field_writing_guide,
  admin_config_key_aigc_label_default,
  admin_config_key_default_model_audio,
  admin_config_key_default_model_copy,
  admin_config_key_default_model_image,
  admin_config_key_default_model_video,
  admin_config_key_note_styles,
  admin_config_key_plan_addons,
  admin_config_key_plan_allowances,
  admin_config_key_payment_mapping,
  admin_config_key_regulated_mode_default,
  admin_config_key_trial_enabled,
  admin_config_key_watermark_default,
  admin_config_option_interval_any,
  admin_config_option_interval_lifetime,
  admin_config_option_interval_month,
  admin_config_option_interval_one_time,
  admin_config_option_interval_year,
  admin_config_option_platform_douyin,
  admin_config_option_platform_video_account,
  admin_config_option_platform_xiaohongshu,
  admin_config_option_tier_growth,
  admin_config_option_tier_pro,
  admin_config_option_tier_starter,
  admin_config_unsupported_shape,
  admin_plan_audio,
  admin_plan_concurrency,
  admin_plan_copy,
  admin_plan_expire_days,
  admin_plan_image,
  admin_plan_priority_support,
  admin_plan_queue_priority,
  admin_plan_standard_support,
  admin_plan_support,
  admin_plan_video,
} from '@/locale/paraglide/messages';

export type AdminConfigFieldPath = readonly (number | string)[];

export interface AdminConfigFieldOption {
  label: string;
  value: string;
}

interface FieldBase {
  /** DOM id 前缀，同时是测试与 e2e 的落点。 */
  id: string;
  label: string;
  path: AdminConfigFieldPath;
}

export type AdminConfigField =
  | (FieldBase & { kind: 'boolean' })
  | (FieldBase & { kind: 'enum'; options: AdminConfigFieldOption[] })
  | (FieldBase & {
      kind: 'number';
      /** 有界小量程用滑杆调，开放计数用步进器敲。 */
      control: 'slider' | 'stepper';
      hint?: string;
      integer: boolean;
      max?: number;
      min?: number;
    })
  | (FieldBase & { kind: 'text'; maxLength?: number; multiline: boolean })
  | (FieldBase & {
      kind: 'toggle-set';
      minItems?: number;
      options: AdminConfigFieldOption[];
    })
  | (FieldBase & { kind: 'group'; fields: AdminConfigField[] })
  | (FieldBase & {
      kind: 'list';
      itemFields: AdminConfigField[];
      /** 每格都是短标量时排成表格，带长文时改成一张张卡片。 */
      layout: 'cards' | 'grid';
      maxItems?: number;
      minItems?: number;
      template: Record<string, unknown>;
    })
  | (FieldBase & { kind: 'unsupported'; reason: string });

/** 滑杆只服务这个量程以内的整数，再大就退回步进器。 */
const SLIDER_MAX_RANGE = 100;
/** 超过这个长度的文本按长文处理，给多行输入。 */
const SINGLE_LINE_MAX_LENGTH = 200;

type AnySchema = z.ZodType & {
  def?: Record<string, unknown>;
  maxLength?: null | number;
  maxValue?: bigint | null | number;
  minLength?: null | number;
  minValue?: bigint | null | number;
};

function schemaDef(schema: AnySchema) {
  return (schema.def ?? {}) as {
    element?: AnySchema;
    entries?: Record<string, string>;
    innerType?: AnySchema;
    shape?: Record<string, AnySchema>;
    type?: string;
    values?: readonly unknown[];
  };
}

/** 剥掉 optional / default / nullable 这层壳，拿到真正决定控件的那个 schema。 */
function unwrap(schema: AnySchema): AnySchema {
  const def = schemaDef(schema);
  if (
    (def.type === 'optional' ||
      def.type === 'default' ||
      def.type === 'nullable' ||
      def.type === 'prefault') &&
    def.innerType
  ) {
    return unwrap(def.innerType);
  }
  return schema;
}

function isOptional(schema: AnySchema) {
  const type = schemaDef(schema).type;
  return type === 'optional' || type === 'default' || type === 'prefault';
}

interface LengthBounds {
  max?: number;
  min?: number;
}

/** 数组长度写在 checks 上，不像 string 那样有现成的 getter。 */
function arrayLengthBounds(schema: AnySchema): LengthBounds {
  const checks =
    (
      schema as unknown as {
        _zod?: { def?: { checks?: readonly unknown[] } };
      }
    )._zod?.def?.checks ?? [];
  const bounds: LengthBounds = {};
  for (const entry of checks) {
    const def = (entry as { _zod?: { def?: Record<string, unknown> } })._zod
      ?.def;
    if (!def) continue;
    const value = typeof def.value === 'number' ? def.value : undefined;
    if (def.check === 'min_length') {
      const minimum = typeof def.minimum === 'number' ? def.minimum : value;
      if (minimum !== undefined) bounds.min = minimum;
    }
    if (def.check === 'max_length') {
      const maximum = typeof def.maximum === 'number' ? def.maximum : value;
      if (maximum !== undefined) bounds.max = maximum;
    }
    if (def.check === 'length_equals' && value !== undefined) {
      bounds.min = value;
      bounds.max = value;
    }
  }
  return bounds;
}

function numberBound(value: bigint | null | number | undefined) {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

function hasFormatCheck(schema: AnySchema) {
  const checks =
    (
      schema as unknown as {
        _zod?: { def?: { checks?: readonly unknown[] } };
      }
    )._zod?.def?.checks ?? [];
  return checks.some((entry) => {
    const def = (entry as { _zod?: { def?: Record<string, unknown> } })._zod
      ?.def;
    return def?.check === 'string_format';
  });
}

function isIntegerSchema(schema: AnySchema) {
  const checks =
    (
      schema as unknown as {
        _zod?: { def?: { checks?: readonly unknown[] } };
      }
    )._zod?.def?.checks ?? [];
  return checks.some((entry) => {
    const def = (entry as { _zod?: { def?: Record<string, unknown> } })._zod
      ?.def;
    return def?.check === 'number_format' && String(def.format ?? '') !== '';
  });
}

/* ── 文案：字段名 → 运营看得懂的说法（D-116） ───────────────────────────── */

const SEGMENT_LABELS: Record<string, () => string> = {
  amountMicros: admin_config_field_amount_micros,
  audio: admin_plan_audio,
  concurrencyLimit: admin_plan_concurrency,
  copy: admin_plan_copy,
  currency: admin_config_field_currency,
  expireDays: admin_plan_expire_days,
  id: admin_config_field_id,
  image: admin_plan_image,
  interval: admin_config_field_interval,
  mappings: admin_config_field_mappings,
  name: admin_config_field_style_name,
  paymentProductId: admin_config_field_payment_product_id,
  platforms: admin_config_field_platforms,
  quantity: admin_config_field_quantity,
  queuePriority: admin_plan_queue_priority,
  resource: admin_config_field_resource,
  structureTemplate: admin_config_field_structure_template,
  styles: admin_config_field_styles,
  supportLabel: admin_plan_support,
  tier: admin_config_field_tier,
  video: admin_plan_video,
  writingGuide: admin_config_field_writing_guide,
};

/** `allowance` 这一层没有自己的说法，直接把四个桶摊平展示。 */
const TRANSPARENT_GROUPS = new Set(['allowance']);

/**
 * 契约对这几个字段没给长度上限，但它们按语义就是一行的东西。
 * 少了这条，风格「名称」会被当成长文渲染成一个多行框，看着像要写一段话。
 */
const SHORT_TEXT_SEGMENTS = new Set(['id', 'name']);

const KEY_LABELS: Record<string, () => string> = {
  'compliance.aigc_label.default': admin_config_key_aigc_label_default,
  'compliance.regulated_mode.default': admin_config_key_regulated_mode_default,
  'compliance.watermark.default': admin_config_key_watermark_default,
  'harness.note.styles': admin_config_key_note_styles,
  'plan.addons': admin_config_key_plan_addons,
  'plan.allowances.growth': admin_config_key_plan_allowances,
  'plan.allowances.pro': admin_config_key_plan_allowances,
  'plan.allowances.starter': admin_config_key_plan_allowances,
  'plan.allowances.trial': admin_config_key_plan_allowances,
  'plan.payment-mapping': admin_config_key_payment_mapping,
  'plan.trial.enabled': admin_config_key_trial_enabled,
  'platform.defaultModel.audio': admin_config_key_default_model_audio,
  'platform.defaultModel.copy': admin_config_key_default_model_copy,
  'platform.defaultModel.image': admin_config_key_default_model_image,
  'platform.defaultModel.video': admin_config_key_default_model_video,
};

const OPTION_LABELS: Record<string, () => string> = {
  any: admin_config_option_interval_any,
  audio: admin_plan_audio,
  copy: admin_plan_copy,
  douyin: admin_config_option_platform_douyin,
  growth: admin_config_option_tier_growth,
  image: admin_plan_image,
  lifetime: admin_config_option_interval_lifetime,
  month: admin_config_option_interval_month,
  one_time: admin_config_option_interval_one_time,
  priority: admin_plan_priority_support,
  pro: admin_config_option_tier_pro,
  standard: admin_plan_standard_support,
  starter: admin_config_option_tier_starter,
  video: admin_plan_video,
  video_account: admin_config_option_platform_video_account,
  xiaohongshu: admin_config_option_platform_xiaohongshu,
  year: admin_config_option_interval_year,
};

const FIELD_HINTS: Record<string, () => string> = {
  amountMicros: admin_config_field_amount_micros_hint,
};

/** 配置项本身的说法；没有登记的键退回键名，测试会盯住这条不许出现。 */
export function adminConfigKeyLabel(key: string) {
  return KEY_LABELS[key]?.() ?? key;
}

function segmentLabel(segment: number | string) {
  if (typeof segment === 'number') return String(segment + 1);
  return SEGMENT_LABELS[segment]?.() ?? segment;
}

function optionLabel(value: string) {
  return OPTION_LABELS[value]?.() ?? value;
}

/**
 * 字段的 DOM id。列表里的字段树带的是模板路径（下标恒为 0），所以渲染时
 * 必须拿**解析后的**路径再算一次——否则第二行的输入框会顶着第一行的 id，
 * 页面上出现两个同名控件，`<label for>` 也会指错。
 */
export function adminConfigFieldId(key: string, path: AdminConfigFieldPath) {
  const suffix = path.length === 0 ? 'value' : path.join('-');
  return `admin-config-${key.replaceAll('.', '-')}-${String(suffix).replaceAll('.', '-')}`;
}

/* ── 值读写：字段树按 path 定位，写回时不改原对象 ─────────────────────────── */

export function readFieldValue(root: unknown, path: AdminConfigFieldPath) {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[segment as string];
  }
  return current;
}

export function writeFieldValue(
  root: unknown,
  path: AdminConfigFieldPath,
  value: unknown
): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const list = Array.isArray(root) ? [...root] : [];
    list[head] = writeFieldValue(list[head], rest, value);
    return list;
  }
  const object = {
    ...((root as Record<string, unknown> | undefined) ?? {}),
  };
  object[head] = writeFieldValue(object[head], rest, value);
  return object;
}

/* ── 映射：zod → 字段树 ──────────────────────────────────────────────────── */

function buildField(
  key: string,
  schema: AnySchema,
  path: AdminConfigFieldPath,
  label: string
): AdminConfigField {
  const base = { id: adminConfigFieldId(key, path), label, path };
  const inner = unwrap(schema);
  const def = schemaDef(inner);

  if (def.type === 'boolean') return { ...base, kind: 'boolean' };

  if (def.type === 'enum' || def.type === 'literal') {
    const values =
      def.type === 'enum'
        ? Object.values(def.entries ?? {})
        : (def.values ?? []).map((value) => String(value));
    return {
      ...base,
      kind: 'enum',
      options: values.map((value) => ({
        label: optionLabel(String(value)),
        value: String(value),
      })),
    };
  }

  if (def.type === 'number') {
    const min = numberBound(inner.minValue);
    const max = numberBound(inner.maxValue);
    const integer = isIntegerSchema(inner);
    const bounded =
      integer && min !== undefined && max !== undefined
        ? max - min <= SLIDER_MAX_RANGE
        : false;
    const segment = path.at(-1);
    return {
      ...base,
      control: bounded ? 'slider' : 'stepper',
      hint: typeof segment === 'string' ? FIELD_HINTS[segment]?.() : undefined,
      integer,
      kind: 'number',
      max,
      min,
    };
  }

  if (def.type === 'string') {
    const maxLength = inner.maxLength ?? undefined;
    const segment = path.at(-1);
    // 有格式约束的（币种这类）一定是短值；只有既不封顶又无格式的才当长文。
    const multiline =
      !hasFormatCheck(inner) &&
      !(typeof segment === 'string' && SHORT_TEXT_SEGMENTS.has(segment)) &&
      (maxLength === undefined || maxLength > SINGLE_LINE_MAX_LENGTH);
    return {
      ...base,
      kind: 'text',
      maxLength: maxLength ?? undefined,
      multiline,
    };
  }

  if (def.type === 'object' && def.shape) {
    return {
      ...base,
      fields: buildShapeFields(key, def.shape, path),
      kind: 'group',
    };
  }

  if (def.type === 'array' && def.element) {
    const element = unwrap(def.element);
    const elementDef = schemaDef(element);
    const bounds = arrayLengthBounds(inner);

    if (elementDef.type === 'enum' || elementDef.type === 'literal') {
      const values =
        elementDef.type === 'enum'
          ? Object.values(elementDef.entries ?? {})
          : (elementDef.values ?? []).map((value) => String(value));
      return {
        ...base,
        kind: 'toggle-set',
        minItems: bounds.min,
        options: values.map((value) => ({
          label: optionLabel(String(value)),
          value: String(value),
        })),
      };
    }

    if (elementDef.type === 'object' && elementDef.shape) {
      const itemFields = buildShapeFields(key, elementDef.shape, [...path, 0]);
      return {
        ...base,
        itemFields,
        kind: 'list',
        layout: itemFields.every(
          (field) =>
            (field.kind === 'text' && !field.multiline) ||
            field.kind === 'enum' ||
            field.kind === 'number' ||
            field.kind === 'boolean'
        )
          ? 'grid'
          : 'cards',
        maxItems: bounds.max,
        minItems: bounds.min,
        template: defaultObject(elementDef.shape),
      };
    }
  }

  return {
    ...base,
    kind: 'unsupported',
    reason: admin_config_unsupported_shape(),
  };
}

function buildShapeFields(
  key: string,
  shape: Record<string, AnySchema>,
  path: AdminConfigFieldPath
): AdminConfigField[] {
  return Object.entries(shape).flatMap(([name, child]) => {
    const childPath = [...path, name];
    if (TRANSPARENT_GROUPS.has(name)) {
      const inner = unwrap(child);
      const def = schemaDef(inner);
      if (def.type === 'object' && def.shape) {
        return buildShapeFields(key, def.shape, childPath);
      }
    }
    return [buildField(key, child, childPath, segmentLabel(name))];
  });
}

function defaultObject(shape: Record<string, AnySchema>) {
  const value: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(shape)) {
    if (isOptional(child)) continue;
    value[name] = defaultForSchema(child);
  }
  return value;
}

function defaultForSchema(schema: AnySchema): unknown {
  const inner = unwrap(schema);
  const def = schemaDef(inner);
  if (def.type === 'boolean') return false;
  if (def.type === 'enum') return Object.values(def.entries ?? {})[0] ?? '';
  if (def.type === 'literal') return def.values?.[0] ?? '';
  if (def.type === 'number') return numberBound(inner.minValue) ?? 0;
  if (def.type === 'string') return '';
  if (def.type === 'object' && def.shape) return defaultObject(def.shape);
  if (def.type === 'array') {
    const bounds = arrayLengthBounds(inner);
    if (!bounds.min || !def.element) return [];
    const element = unwrap(def.element);
    return Array.from({ length: bounds.min }, () => defaultForSchema(element));
  }
  return null;
}

/** 某个配置项的字段树；未登记的键返回空数组，调用方据此退回只读展示。 */
export function buildAdminConfigFields(key: string): AdminConfigField[] {
  const schema = adminConfigSchemaFor(key as AdminConfigKey);
  if (!schema) return [];
  const root = schema as AnySchema;
  const def = schemaDef(unwrap(root));
  if (def.type === 'object' && def.shape) {
    return buildShapeFields(key, def.shape, []);
  }
  return [buildField(key, root, [], adminConfigKeyLabel(key))];
}

/**
 * 从没写过的配置项，表单从哪里起步。
 *
 * 能拿到「此刻真正在用的那份」就用它——运营打开编辑器看到的应当是现状，
 * 不是一张要从零填的空表；拿不到才退回按契约生成的空模板。
 */
const RUNTIME_SEEDS: Record<string, () => unknown> = {
  [NOTE_STYLE_CONFIG_KEY]: () => structuredClone(DEFAULT_NOTE_STYLES),
};

export function defaultAdminConfigValue(key: string): unknown {
  const seed = RUNTIME_SEEDS[key];
  if (seed) return seed();
  const schema = adminConfigSchemaFor(key as AdminConfigKey);
  if (!schema) return null;
  return defaultForSchema(schema as AnySchema);
}

/** 列表新增一行时的模板值。 */
export function listItemTemplate(
  field: Extract<AdminConfigField, { kind: 'list' }>
) {
  return structuredClone(field.template);
}

export function flattenFields(
  fields: readonly AdminConfigField[]
): AdminConfigField[] {
  return fields.flatMap((field) =>
    field.kind === 'group'
      ? [field, ...flattenFields(field.fields)]
      : field.kind === 'list'
        ? [field, ...flattenFields(field.itemFields)]
        : [field]
  );
}
