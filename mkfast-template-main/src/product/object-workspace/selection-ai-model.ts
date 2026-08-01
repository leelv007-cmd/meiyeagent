/**
 * Selection AI six actions for the object workspace (P2-10 / #322).
 *
 * Spec §3.5 / §4.4: 续写 / 改写 / 扩写 / 精简 / 语气 / 自定义.
 * Prompt path (实施时定): local beauty-context templates for fixture/preview;
 * production may later pin Langfuse sites without changing action ids.
 *
 * Promo chips (weaker_promo / stronger_cta) stay on the worksurface as legacy
 * QuickEdit shortcuts — they are not part of the six-action selection bar.
 */

export const SELECTION_AI_ACTIONS = [
  'continue',
  'rewrite',
  'expand',
  'shorten',
  'tone',
  'custom',
] as const;

export type SelectionAiAction = (typeof SELECTION_AI_ACTIONS)[number];

export const SELECTION_AI_LABELS: Record<SelectionAiAction, string> = {
  continue: '续写',
  rewrite: '改写',
  expand: '扩写',
  shorten: '精简',
  tone: '语气',
  custom: '自定义',
};

/**
 * Local templates (beauty retail). Placeholders: {selection}, {instruction}.
 * Not copied from generic xhswork prompts (spec §6).
 */
export const SELECTION_AI_LOCAL_TEMPLATES: Record<SelectionAiAction, string> = {
  continue:
    '你是美业门店内容助手。在保持事实与口吻一致的前提下，自然续写以下选区，不编造未提供的项目/价格/疗效：\n\n{selection}',
  rewrite:
    '你是美业门店内容助手。改写以下选区，使表达更自然、可信、适合小红书/门店宣发，不编造事实：\n\n{selection}',
  expand:
    '你是美业门店内容助手。在不编造项目细节与价格的前提下，扩写以下选区，补充感受与到店理由：\n\n{selection}',
  shorten:
    '你是美业门店内容助手。精简以下选区，保留关键卖点与行动号召，去掉空话：\n\n{selection}',
  tone: '你是美业门店内容助手。按指定语气调整以下选区（语气：{instruction}），不改变事实：\n\n{selection}',
  custom:
    '你是美业门店内容助手。按商家自定义要求处理以下选区（要求：{instruction}），不编造事实：\n\n{selection}',
};

/** Actions that need a free-text instruction before preview. */
export function selectionAiNeedsInstruction(action: SelectionAiAction): boolean {
  return action === 'tone' || action === 'custom';
}

export function buildSelectionAiPrompt(input: {
  action: SelectionAiAction;
  selection: string;
  instruction?: string;
}): string {
  const template = SELECTION_AI_LOCAL_TEMPLATES[input.action];
  const instruction = input.instruction?.trim() || defaultInstruction(input.action);
  return template
    .replaceAll('{selection}', input.selection)
    .replaceAll('{instruction}', instruction);
}

function defaultInstruction(action: SelectionAiAction): string {
  switch (action) {
    case 'tone':
      return '专业温和的美容顾问口吻';
    case 'custom':
      return '按美业宣发习惯优化';
    default:
      return '';
  }
}

/**
 * Deterministic local preview for interaction tests / offline fixture.
 * Confirm still routes through derived Task / QuickEdit — display only.
 */
export function applySelectionAiPreview(
  before: string,
  action: SelectionAiAction,
  instruction?: string
): string {
  const note = instruction?.trim();
  switch (action) {
    case 'continue':
      return `${before} 到店可再细聊适合你的护理方案。`;
    case 'rewrite':
      return note ? note : `改写：${before}`;
    case 'expand':
      return `${before}，结合本店真实项目说明，欢迎到店了解。`;
    case 'shorten':
      return before.slice(0, Math.max(1, Math.floor(before.length * 0.6)));
    case 'tone':
      return note ? `【${note}】${before}` : `换个说法：${before}`;
    case 'custom':
      return note ? `${note}：${before}` : `自定义调整：${before}`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function selectionAiToolbarItems(): {
  action: SelectionAiAction;
  label: string;
}[] {
  return SELECTION_AI_ACTIONS.map((action) => ({
    action,
    label: SELECTION_AI_LABELS[action],
  }));
}
