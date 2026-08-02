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
import {
  CREDIT_PLAN_CONFIG_DEFAULTS,
  DEFAULT_NOTE_STYLES,
  NOTE_STYLE_CONFIG_KEY,
} from '@meiye/contracts';
import type { z } from 'zod';

import {
  adminConfigSchemaFor,
  type AdminConfigKey,
} from '@/p1/admin-config-view-model';
import {
  admin_config_field_amount_micros,
  admin_config_field_amount_micros_hint,
  admin_config_field_currency,
  admin_config_field_cycle_monthly,
  admin_config_field_cycle_single_month,
  admin_config_field_cycle_yearly,
  admin_config_field_credits,
  admin_config_field_id,
  admin_config_field_interval,
  admin_config_field_mappings,
  admin_config_field_monthly_price_micros,
  admin_config_field_payment_product_id,
  admin_config_field_platforms,
  admin_config_field_quantity,
  admin_config_field_resource,
  admin_config_field_structure_template,
  admin_config_field_storage_mb,
  admin_config_field_style_name,
  admin_config_field_styles,
  admin_config_field_tier,
  admin_config_field_writing_guide,
  admin_config_key_aigc_label_default,
  admin_config_key_confirmation_hold_timeout,
  admin_config_key_default_model_audio,
  admin_config_key_default_model_copy,
  admin_config_key_default_model_image,
  admin_config_key_default_model_video,
  admin_config_key_note_styles,
  admin_config_key_plan_addons,
  admin_config_key_plan_allowances,
  admin_config_key_plan_credits,
  admin_config_key_plan_credits_addons,
  admin_config_key_plan_credits_cycle_coefficients,
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
  admin_runtime_assembly_byok_live_description,
  admin_runtime_assembly_byok_recorded_description,
  admin_runtime_assembly_byok_title,
  admin_runtime_assembly_live_label,
  admin_runtime_assembly_recorded_label,
  admin_runtime_mode_ark_description,
  admin_runtime_mode_ark_label,
  admin_runtime_mode_ark_tuzi_description,
  admin_runtime_mode_ark_tuzi_label,
  admin_runtime_mode_direct_description,
  admin_runtime_mode_direct_label,
  admin_runtime_mode_disabled_description,
  admin_runtime_mode_disabled_label,
  admin_runtime_mode_fixture_description,
  admin_runtime_mode_fixture_label,
  admin_runtime_mode_gateway_description,
  admin_runtime_mode_gateway_label,
  admin_runtime_mode_media_title,
  admin_runtime_mode_model_title,
  admin_runtime_mode_recorded_description,
  admin_runtime_mode_recorded_label,
  admin_runtime_mode_tuzi_description,
  admin_runtime_mode_tuzi_label,
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
  /** 这个选项意味着什么；只有需要解释的枚举才有。 */
  description?: string;
  /** 契约不接受，但产品要如实说明「还没接」而不是当它不存在。 */
  disabled?: boolean;
  disabledReason?: string;
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
  | (FieldBase & {
      kind: 'enum';
      options: AdminConfigFieldOption[];
      /**
       * 整个配置项就是一个枚举时摊成单选卡片（每个选项要解释自己）；
       * 嵌在表单/行内的枚举收成下拉。
       */
      presentation: 'radio' | 'select';
    })
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

/**
 * 装配那几条文案是后加的 message，编译产物里可能还没有；
 * 取不到就退回中文原句，不让界面出现空标签。
 */
const assemblyMessages = {
  admin_runtime_assembly_byok_live_description,
  admin_runtime_assembly_byok_recorded_description,
  admin_runtime_assembly_byok_title,
  admin_runtime_assembly_live_label,
  admin_runtime_assembly_recorded_label,
} satisfies Record<string, (() => string) | undefined>;

function assemblyMessage(key: keyof typeof assemblyMessages, fallback: string) {
  return assemblyMessages[key]?.() ?? fallback;
}

const SEGMENT_LABELS: Record<string, () => string> = {
  amountMicros: admin_config_field_amount_micros,
  audio: admin_plan_audio,
  concurrencyLimit: admin_plan_concurrency,
  copy: admin_plan_copy,
  currency: admin_config_field_currency,
  monthly: admin_config_field_cycle_monthly,
  single_month: admin_config_field_cycle_single_month,
  yearly: admin_config_field_cycle_yearly,
  credits: admin_config_field_credits,
  expireDays: admin_plan_expire_days,
  id: admin_config_field_id,
  image: admin_plan_image,
  interval: admin_config_field_interval,
  mappings: admin_config_field_mappings,
  monthlyPriceMicros: admin_config_field_monthly_price_micros,
  name: admin_config_field_style_name,
  paymentProductId: admin_config_field_payment_product_id,
  platforms: admin_config_field_platforms,
  quantity: admin_config_field_quantity,
  queuePriority: admin_plan_queue_priority,
  resource: admin_config_field_resource,
  structureTemplate: admin_config_field_structure_template,
  styles: admin_config_field_styles,
  storageMb: admin_config_field_storage_mb,
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
  'byok.adapter.assembly': () =>
    assemblyMessage('admin_runtime_assembly_byok_title', 'BYOK 适配器装配'),
  'model.execution.mode': admin_runtime_mode_model_title,
  'model.media.execution.mode': admin_runtime_mode_media_title,
  'compliance.aigc_label.default': admin_config_key_aigc_label_default,
  'compliance.regulated_mode.default': admin_config_key_regulated_mode_default,
  'compliance.watermark.default': admin_config_key_watermark_default,
  'harness.confirmation_card.hold_timeout_seconds':
    admin_config_key_confirmation_hold_timeout,
  'harness.note.styles': admin_config_key_note_styles,
  'plan.addons': admin_config_key_plan_addons,
  'plan.allowances.growth': admin_config_key_plan_allowances,
  'plan.allowances.pro': admin_config_key_plan_allowances,
  'plan.allowances.starter': admin_config_key_plan_allowances,
  'plan.allowances.trial': admin_config_key_plan_allowances,
  'plan.credits.addons': admin_config_key_plan_credits_addons,
  'plan.credits.cycle_coefficients':
    admin_config_key_plan_credits_cycle_coefficients,
  'plan.credits.growth': admin_config_key_plan_credits,
  'plan.credits.pro': admin_config_key_plan_credits,
  'plan.credits.starter': admin_config_key_plan_credits,
  'plan.credits.trial': admin_config_key_plan_credits,
  'plan.credits.trial.enabled': admin_config_key_trial_enabled,
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

/**
 * 执行模式与适配装配这几个选项，光看值（`gateway`／`ark,tuzi`）没人知道选了会怎样，
 * 所以每个值配一句解释。
 *
 * 注意这里**只有文案**：能选哪些值仍然只有 `configSchemas` 一个来源。
 * 契约加了一个值而这里没配文案，选项照样出现，只是没有那句解释——
 * 不会出现「界面上有、契约不认」的漂移。
 */
const OPTION_COPY: Record<
  string,
  Record<string, { description: () => string; label: () => string }>
> = {
  'byok.adapter.assembly': {
    live: {
      description: () =>
        assemblyMessage(
          'admin_runtime_assembly_byok_live_description',
          '使用已配置的真实 BYOK 适配器；保存后需重启生效。'
        ),
      label: () => assemblyMessage('admin_runtime_assembly_live_label', 'Live'),
    },
    recorded: {
      description: () =>
        assemblyMessage(
          'admin_runtime_assembly_byok_recorded_description',
          '使用录制适配器，不发起真实供应商调用。'
        ),
      label: () =>
        assemblyMessage('admin_runtime_assembly_recorded_label', 'Recorded'),
    },
  },
  'model.execution.mode': {
    direct: {
      description: admin_runtime_mode_direct_description,
      label: admin_runtime_mode_direct_label,
    },
    disabled: {
      description: admin_runtime_mode_disabled_description,
      label: admin_runtime_mode_disabled_label,
    },
    fixture: {
      description: admin_runtime_mode_fixture_description,
      label: admin_runtime_mode_fixture_label,
    },
    gateway: {
      description: admin_runtime_mode_gateway_description,
      label: admin_runtime_mode_gateway_label,
    },
    recorded: {
      description: admin_runtime_mode_recorded_description,
      label: admin_runtime_mode_recorded_label,
    },
  },
  'model.media.execution.mode': {
    ark: {
      description: admin_runtime_mode_ark_description,
      label: admin_runtime_mode_ark_label,
    },
    'ark,tuzi': {
      description: admin_runtime_mode_ark_tuzi_description,
      label: admin_runtime_mode_ark_tuzi_label,
    },
    disabled: {
      description: admin_runtime_mode_disabled_description,
      label: admin_runtime_mode_disabled_label,
    },
    tuzi: {
      description: admin_runtime_mode_tuzi_description,
      label: admin_runtime_mode_tuzi_label,
    },
  },
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

/** 枚举值来自契约；这里只给它配上说法和解释。 */
function enumOptions(
  key: string,
  values: readonly string[]
): AdminConfigFieldOption[] {
  const copy = OPTION_COPY[key];
  return values.map((value) => ({
    description: copy?.[value]?.description(),
    label: copy?.[value]?.label() ?? optionLabel(value),
    value,
  }));
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
        ? Object.values(def.entries ?? {}).map(String)
        : (def.values ?? []).map(String);
    return {
      ...base,
      kind: 'enum',
      options: enumOptions(key, values),
      // 整个配置项就是一个枚举时，每个选项都要解释自己，摊成单选卡片；
      // 嵌在表单或行内格子里的枚举收成下拉。
      presentation: path.length === 0 ? 'radio' : 'select',
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
  if (key in CREDIT_PLAN_CONFIG_DEFAULTS) {
    return structuredClone(
      CREDIT_PLAN_CONFIG_DEFAULTS[
        key as keyof typeof CREDIT_PLAN_CONFIG_DEFAULTS
      ]
    );
  }
  const seed = RUNTIME_SEEDS[key];
  if (seed) return seed();
  const schema = adminConfigSchemaFor(key as AdminConfigKey);
  if (!schema) return null;
  return defaultForSchema(schema as AnySchema);
}

/**
 * 这个配置项该不该常驻展开，而不是藏在「先选一项」的下拉后面。
 *
 * 判据从字段树来，不是一张硬编码的键名清单：整项就是一个单选枚举时，
 * 几个选项本来就该并排让人比较（执行模式、适配装配都是这种）。
 */
export function isInlineConfigKey(key: string) {
  const fields = buildAdminConfigFields(key);
  const [only] = fields;
  return (
    fields.length === 1 && only.kind === 'enum' && only.presentation === 'radio'
  );
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
