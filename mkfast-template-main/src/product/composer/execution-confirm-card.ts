/**
 * 执行确认卡 — D-164③ / D-159③. Pure projection + state machine, no React.
 *
 * D-109 named the merchant-facing view of a quote `UserDebitPreview`, which is
 * a 口径 (the merchant sees quota spent, never a technical quote) rather than a
 * component — nothing in the repo carried that name. This is that view built as
 * a card: what this run will use, and what it will cost, at the moment of
 * submitting.
 *
 * Read-only is a type guarantee here, not a convention. There is no write-back
 * channel in the props, parameters arrive as finished merchant-language strings
 * rather than value+options pairs, every field is `readonly`, and the assertion
 * at the bottom turns any future control-shaped key into a tsc error. A card
 * you can configure from is a configuration surface, and D-159③ says the
 * interaction here may only be confirm-shaped.
 *
 * Money never appears (D1, ratified 2026-07-29): the merchant sees bucket
 * counts, on exactly the wording `projectQuotaPassiveView` already produces, so
 * one run cannot be described two ways on one screen. Amounts stay in the
 * settings detail view.
 */

import type { CreationLensId } from '@meiye/contracts';

import type { ComposerInputSnapshot } from './brief-surface';
import {
  projectQuotaPassiveView,
  type ComposerQuotaResource,
  type QuotaRequirement,
} from './quota-blocking';

/* ── 0. Trigger mode ──────────────────────────────────────────────────── */

/**
 * 执行确认卡触发口径. D-164 left it open: 「是否所有生成都拦，还是仅超过成本
 * 阈值时拦」.
 *
 * v1 is 'existing_gates': the card appears only where this app already stops
 * to ask, so it costs the merchant zero extra taps. That matters because the
 * copy lens submits in one tap today (`decideSubmitPath` → `direct_submit`),
 * and 全拦 would add a second — against D-043 ≤2 击, and a larger change than
 * the minimal form the ticket asks for.
 *
 * Ratified by the user on 2026-07-29 (DECISIONS.md D2). The other two values
 * are a recorded switch, not open options — changing one changes a ratified
 * 口径 and needs D2 changed first:
 *   'all_generative' → stop on every generative run
 *   'cost_threshold' → follow the server's ProductQuoteSnapshot
 *                      extraConfirmThreshold (the number belongs to #255; the
 *                      browser must never write a threshold of its own)
 * Reasoning: docs/tickets/261/02-confirm-card-and-cost.md §7.
 */
export const EXECUTION_CONFIRM_TRIGGER_MODE: ExecutionConfirmTriggerMode =
  'existing_gates';

export type ExecutionConfirmTriggerMode =
  | 'existing_gates'
  | 'all_generative'
  | 'cost_threshold';

export type ExecutionConfirmTriggerInput = {
  /** True when this run is generative at all — deterministic edits never ask. */
  readonly generative: boolean;
  /** True when the host was already going to stop here (brief / video / adjust). */
  readonly existingGate: boolean;
  /**
   * Server-side verdict that this quote crosses the extra-confirmation
   * threshold. Read only in 'cost_threshold' mode, and supplied by the quote —
   * never computed here.
   */
  readonly overThreshold?: boolean;
  readonly mode?: ExecutionConfirmTriggerMode;
};

/**
 * The single place this decision is made. Call sites must not write their own
 * `if`: the mode switch is only one edit if every caller comes through here.
 */
export function shouldOpenExecutionConfirm(
  input: ExecutionConfirmTriggerInput
): boolean {
  // D-164⑥ 决定 A: a deterministic edit calls no model, so it is never gated
  // and never carries a cost notice.
  if (!input.generative) return false;
  switch (input.mode ?? EXECUTION_CONFIRM_TRIGGER_MODE) {
    case 'all_generative':
      return true;
    case 'cost_threshold':
      // Absent a verdict, fall back to the gates that already exist rather
      // than to「不拦」: silence from the server is not permission.
      return input.overThreshold ?? input.existingGate;
    case 'existing_gates':
      return input.existingGate;
  }
}

/* ── 1. Parameter rows ────────────────────────────────────────────────── */

export type ExecutionParamKey =
  | 'model'
  | 'aspectRatio'
  | 'quantity'
  | 'durationSeconds'
  | 'destination'
  | 'deliverable';

/**
 * One parameter row. Note what is missing: no value/options/onChange. The card
 * receives finished copy, so it has no raw material to build a picker from.
 */
export type ExecutionParamRow = {
  /** Stable test/telemetry handle, never shown to the merchant. */
  readonly key: ExecutionParamKey;
  /** Merchant-language label, e.g.「画面比例」. */
  readonly label: string;
  /** Merchant-language value, e.g.「3:4 竖版」. */
  readonly value: string;
  /**
   * D-164③「用商家语言解释技术参数」lands here. Null when no stable mapping
   * exists — better unexplained than invented (D-024 的同一精神).
   */
  readonly hint: string | null;
};

/**
 * 比例 is a closed three-value enum, so the whole table can be written down.
 * The explanations follow D-164③'s own example (「3:4 竖版，适合朋友圈/展架双用」).
 */
const ASPECT_RATIO_ROWS: Record<
  string,
  { readonly value: string; readonly hint: string }
> = {
  '1:1': { value: '1:1 方图', hint: '适合头像位、九宫格拼图' },
  '3:4': { value: '3:4 竖版', hint: '适合朋友圈、小红书，也够印展架' },
  '9:16': { value: '9:16 全屏竖版', hint: '抖音、视频号满屏不留黑边' },
};

/**
 * Which rows a lens shows. Mirrors the field selection in `settings-row.ts`,
 * and deliberately does NOT reuse its labels: those read「比例」/「数量」, which
 * are engineering labels with no explanation attached. This card owes the
 * merchant a sentence, so it keeps its own table.
 */
const LENS_PARAM_KEYS: Record<CreationLensId, readonly ExecutionParamKey[]> = {
  copy: ['model', 'quantity', 'destination', 'deliverable'],
  image_text: [
    'model',
    'aspectRatio',
    'quantity',
    'destination',
    'deliverable',
  ],
  video: [
    'model',
    'aspectRatio',
    'durationSeconds',
    'destination',
    'deliverable',
  ],
};

export type ExecutionParamsInput = {
  readonly lensId: CreationLensId;
  /** Operator-authored display name; already merchant language. */
  readonly modelName?: string | null;
  readonly aspectRatio?: string | null;
  readonly quantity?: number | null;
  readonly durationSeconds?: number | null;
  /** Merchant-language platform line, from `projectComposerSignedPreview`. */
  readonly destination?: string | null;
  /** Merchant-language deliverable line, from the same projection. */
  readonly deliverable?: string | null;
  /**
   * Server-owned deliverable label bound to the output count. Preferred over
   * the local quantity wording whenever the quote carried one — the server is
   * the authority on what this run produces.
   */
  readonly outputLabel?: string | null;
};

function quantityRow(input: ExecutionParamsInput): ExecutionParamRow | null {
  if (input.outputLabel) {
    return {
      key: 'quantity',
      label: '这次出什么',
      value: input.outputLabel,
      hint: null,
    };
  }
  const quantity = input.quantity;
  if (quantity == null || quantity < 1) return null;
  if (quantity === 1) {
    return { key: 'quantity', label: '数量', value: '1 份', hint: null };
  }
  return {
    key: 'quantity',
    label: '数量',
    value:
      input.lensId === 'copy' ? `${quantity} 条文案候选` : `${quantity} 张图`,
    hint:
      input.lensId === 'copy'
        ? '从里面挑一条用，其余留着换着发'
        : '一次多出几张，挑顺眼的发',
  };
}

function paramRow(
  key: ExecutionParamKey,
  input: ExecutionParamsInput
): ExecutionParamRow | null {
  switch (key) {
    case 'model': {
      // v1 shows the operator's display name and no explanation. Ranking a
      // model as「高清档」would need a capability vocabulary that does not
      // exist yet (#252); writing one here would be inventing the product.
      if (!input.modelName) return null;
      return { key, label: '用哪个模型', value: input.modelName, hint: null };
    }
    case 'aspectRatio': {
      const ratio = input.aspectRatio;
      if (!ratio) return null;
      const mapped = ASPECT_RATIO_ROWS[ratio];
      return {
        key,
        label: '画面比例',
        value: mapped?.value ?? ratio,
        hint: mapped?.hint ?? null,
      };
    }
    case 'quantity':
      return quantityRow(input);
    case 'durationSeconds': {
      const seconds = input.durationSeconds;
      if (seconds == null || seconds < 1) return null;
      return {
        key,
        label: '时长',
        value: `${seconds} 秒`,
        // Same sentence the video confirm zone already uses, so the two places
        // that mention video billing do not disagree.
        hint: '按生成成片秒数计费',
      };
    }
    case 'destination': {
      if (!input.destination) return null;
      return { key, label: '发到哪', value: input.destination, hint: null };
    }
    case 'deliverable': {
      if (!input.deliverable) return null;
      return { key, label: '出什么', value: input.deliverable, hint: null };
    }
  }
}

/**
 * Rows for this run, in lens order, dropping anything with no value. A row
 * whose value is unknown is omitted rather than shown empty: 「画面比例：—」
 * reads as a setting the merchant failed to make.
 */
export function projectExecutionParams(
  input: ExecutionParamsInput
): ExecutionParamRow[] {
  return LENS_PARAM_KEYS[input.lensId]
    .map((key) => paramRow(key, input))
    .filter((row): row is ExecutionParamRow => row !== null);
}

/* ── 2. Cost ──────────────────────────────────────────────────────────── */

export type ExecutionCostUnit = {
  readonly resource: ComposerQuotaResource;
  readonly cost: number;
};

export type ExecutionCostView = {
  /** 「本次用 1 条文案额度 · 还剩 4 条」— straight from the passive view. */
  readonly notice: string;
  readonly units: readonly ExecutionCostUnit[];
  /** Video's per-second billing note; null for every other lens. */
  readonly billingNote: string | null;
  /** D-123 缺额提醒. True disables 确认. */
  readonly short: boolean;
  readonly shortNotice: string | null;
};

export function projectExecutionCost(input: {
  requirements: QuotaRequirement[];
  available: Partial<Record<ComposerQuotaResource, number | null | undefined>>;
  billingNote?: string | null;
}): ExecutionCostView {
  const passive = projectQuotaPassiveView({
    available: input.available,
    requirements: input.requirements,
  });
  return {
    billingNote: input.billingNote ?? null,
    // An unloaded balance makes the passive view go silent rather than print a
    // half sentence. The card keeps that discipline instead of inventing a
    // number to fill its own row.
    notice: passive.visible ? passive.notice : '',
    short: passive.short,
    shortNotice: passive.shortNotice,
    units: input.requirements.map((requirement) => ({
      cost: requirement.cost,
      resource: requirement.resource,
    })),
  };
}

/* ── 3. Card props ────────────────────────────────────────────────────── */

export type ExecutionConfirmCardProps = {
  readonly visible: boolean;
  readonly title: string;
  readonly params: readonly ExecutionParamRow[];
  readonly cost: ExecutionCostView;
  /** 拒绝 — the host must render feedback, because work already happened. */
  readonly onReject: () => void;
  /** 确认 — the only way through. */
  readonly onConfirm: () => void;
  readonly rejectLabel: string;
  readonly confirmLabel: string;
  /** Both buttons disabled while a submission is in flight. */
  readonly busy?: boolean;
  /** Quote expired: the card stays up but cannot be confirmed. */
  readonly staleNotice?: string | null;
  readonly className?: string;
};

/**
 * The shape of any write-back channel. Adding a key like this to the props
 * makes the alias below resolve to a tuple, and the `satisfies` line then fails
 * to compile. This is a build gate, not a comment.
 */
type EditableControlKey =
  | `on${string}Change`
  | `set${string}`
  | 'value'
  | 'defaultValue'
  | 'options'
  | 'choices'
  | 'editable'
  | 'onEdit'
  | 'onParamChange';

type AssertNoEditableControls<T> =
  Extract<keyof T, EditableControlKey> extends never
    ? T
    : ['ExecutionConfirmCard 不得含可编辑控件（D-164③ / D-159③）', never];

export type ExecutionConfirmCardPropsReadOnly =
  AssertNoEditableControls<ExecutionConfirmCardProps>;

const _readOnlyGuard = null as unknown as ExecutionConfirmCardPropsReadOnly;
void (_readOnlyGuard satisfies ExecutionConfirmCardProps);

/* ── 4. State machine ─────────────────────────────────────────────────── */

/**
 * Its own enum. `BriefSurfacePhase` is D-094's safety card and its 'cancelled'
 * means「abandon this attempt, restore the input」— rejecting an execution
 * carries the extra claim that cost has already been accounted for. D-164③
 * keeps all seven HITL classes untouched, and sharing that machine would be
 * changing one.
 */
export type ExecutionConfirmPhase = 'idle' | 'open' | 'confirmed' | 'rejected';

export type ExecutionConfirmState = {
  readonly phase: ExecutionConfirmPhase;
  readonly params: readonly ExecutionParamRow[];
  readonly cost: ExecutionCostView | null;
  readonly composerSnapshot: ComposerInputSnapshot | null;
};

const EMPTY_COST: ExecutionCostView = {
  billingNote: null,
  notice: '',
  short: false,
  shortNotice: null,
  units: [],
};

export function createExecutionConfirmState(): ExecutionConfirmState {
  return { composerSnapshot: null, cost: null, params: [], phase: 'idle' };
}

export function openExecutionConfirm(
  state: ExecutionConfirmState,
  input: {
    params: readonly ExecutionParamRow[];
    cost: ExecutionCostView;
    composerSnapshot: ComposerInputSnapshot;
  }
): ExecutionConfirmState {
  // Opening over an open card would swap the numbers under a merchant who is
  // reading them. The first card stands until it is answered.
  if (state.phase === 'open') return state;
  return {
    composerSnapshot: input.composerSnapshot,
    cost: input.cost,
    params: input.params,
    phase: 'open',
  };
}

export function confirmExecution(
  state: ExecutionConfirmState
): ExecutionConfirmState {
  if (state.phase !== 'open') return state;
  return { ...state, phase: 'confirmed' };
}

export function rejectExecution(state: ExecutionConfirmState): {
  state: ExecutionConfirmState;
  restored: ComposerInputSnapshot | null;
} {
  if (state.phase !== 'open') return { restored: null, state };
  return {
    restored: state.composerSnapshot,
    state: { ...createExecutionConfirmState(), phase: 'rejected' },
  };
}

export function projectExecutionConfirmCard(
  state: ExecutionConfirmState,
  options?: {
    busy?: boolean;
    staleNotice?: string | null;
    onConfirm?: () => void;
    onReject?: () => void;
  }
): ExecutionConfirmCardProps {
  const noop = () => undefined;
  return {
    busy: options?.busy ?? false,
    confirmLabel: '确认，开始生成',
    cost: state.cost ?? EMPTY_COST,
    onConfirm: options?.onConfirm ?? noop,
    onReject: options?.onReject ?? noop,
    params: state.params,
    rejectLabel: '先不生成',
    staleNotice: options?.staleNotice ?? null,
    title: '这一次会这样跑',
    visible: state.phase === 'open',
  };
}
