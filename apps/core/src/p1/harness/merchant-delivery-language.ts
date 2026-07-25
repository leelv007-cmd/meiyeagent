import type { HarnessStage } from '@meiye/contracts';

const PROGRESS_MESSAGES = {
  intent_naming: '已听懂这次想表达的重点',
  context_injection: '已整理本次可用的门店资料',
  brief_compilation: '已把想法整理成创作要求',
  execution_selection: '已准备好本次主推荐',
  assembly_delivery: '已把成品和使用说明整理完毕',
} as const satisfies Record<HarnessStage, string>;

const FORBIDDEN_LANGUAGE = [
  { label: 'workspace id', pattern: /workspace\s+id/iu },
  { label: 'task id', pattern: /task\s+id/iu },
  { label: 'work id', pattern: /work\s+id/iu },
  { label: 'provider', pattern: /\bprovider\b/iu },
  { label: 'DeepSeek', pattern: /\bdeepseek\b/iu },
  { label: 'HTTP code', pattern: /\bhttp\s*[1-5]\d{2}\b/iu },
  { label: 'workflow', pattern: /\bworkflow\b/iu },
  { label: 'industry category', pattern: /\bindustry_category\b/iu },
  { label: 'intent', pattern: /\bintent\b/iu },
  { label: 'snapshot', pattern: /\bsnapshot\b/iu },
  { label: 'revision', pattern: /\brevision\b/iu },
  { label: 'candidate', pattern: /\bcandidate\b/iu },
  { label: 'schema', pattern: /\bschema\b/iu },
  { label: 'DBOS', pattern: /\bdbos\b/iu },
  { label: 'LLM', pattern: /\bllm\b/iu },
  { label: 'MinerU', pattern: /\bmineru\b/iu },
  { label: 'parse', pattern: /\bparse\b/iu },
  { label: 'pipeline', pattern: /\bpipeline\b/iu },
  { label: 'internal cost', pattern: /成本价|毛利/iu },
] as const;

export function merchantProgressMessage(stage: HarnessStage) {
  return PROGRESS_MESSAGES[stage];
}

export function merchantIdentityVoiceNotice() {
  return '这次先用门店官方口吻生成；以后想换成你的个人口吻，直接在对话里告诉我就好。';
}

export function merchantConfirmationQuestion(question: string) {
  return `为了让成品更贴合你的想法，想确认一下：${question}`;
}

export function merchantGenericModeNotice() {
  return '这次先按通用模式生成；以后补充门店、项目或风格资料，内容会更像你的店。';
}

export function merchantConfirmedMaterialsContinuationNotice() {
  return '这次会参考你已确认的资料，直接继续生成。';
}

export function merchantNeutralIndustryContinuationNotice() {
  return '这次先按通用方式继续生成，不需要补充行业信息。';
}

export function merchantNoteStyleQuestion() {
  return {
    question: '两种图文方向都已准备好，这次想用哪一种？',
    responseReason: '按你选中的版本继续配图',
  } as const;
}

export function merchantNoteProgressMessage(
  state: 'styles_ready' | 'style_selected' | 'consistency_checked',
) {
  return {
    styles_ready: '两种图文方向已经整理好，请选一个继续配图。',
    style_selected: '已按你选的方向继续准备整套图文。',
    consistency_checked: '已逐页核对图文对应关系和整篇一致性。',
  }[state];
}

export function merchantNoteSelectionReason(selected: boolean) {
  return selected ? '店主选择了这一图文方向' : '保留为未选中的风格草稿';
}

export function merchantTaskSummary(input: {
  revision: number;
  strategyBasis: string;
  versionPositioning: string;
  useSuggestion: string;
}) {
  return (
    `第 ${input.revision} 版已经准备好。` +
    `策略依据：${input.strategyBasis}。` +
    `版本定位：${input.versionPositioning}。` +
    `使用建议：${input.useSuggestion}。`
  );
}

export function merchantPartialFailure(input: {
  completed: string;
  failed: string;
  nextStep: string;
}) {
  return `${input.completed}；${input.failed}。接下来：${input.nextStep}。`;
}

export function merchantExactTextMismatch(input: {
  expected: string[];
  observed: string[];
}) {
  const expected = input.expected.join('、');
  const observed =
    input.observed.length > 0 ? input.observed.join('、') : '未识别到对应文字';
  return `图片中的文字没有通过逐字核对：需要“${expected}”，实际为“${observed}”。这张图没有交付，请调整为不带价格文字，或稍后重新生成。`;
}

export function merchantVideoGenerationFailure(
  reason: 'failed' | 'timed_out',
) {
  return reason === 'timed_out'
    ? '这次视频等待时间过长，暂时没有生成成品。你可以重新生成，或先改用图片发布方案。'
    : '这次视频没有顺利生成成品。你可以重新生成，或更换参考素材后再试。';
}

export function merchantParseDisclosure() {
  return '为了帮你少打字，上传的内容会交给第三方解析服务处理；也可以随时跳过，直接手动填写。';
}

export function merchantParseProgress(input: {
  completed: number;
  total: number;
}) {
  return `正在整理你上传的资料，已完成 ${input.completed}/${input.total} 份；离开后也会继续处理。`;
}

export function merchantParseFallback(reason: 'failed' | 'timeout' | 'rate_limited') {
  const detail =
    reason === 'timeout'
      ? '这份资料暂时没有按时整理好'
      : reason === 'rate_limited'
        ? '现在上传资料的人有点多'
        : '这份资料暂时没有整理成功';
  return `${detail}，可以一键转为手动填写，已经上传的内容会为你保留。`;
}

export function merchantSensitiveDocumentFallback() {
  return '证件类资料不会交给外部服务整理，请直接确认关键信息；已经上传的内容会为你保留。';
}

export function merchantParseTaskFailed() {
  return '这批资料的自动整理已经停止，请直接转为手动填写；已经上传的内容会为你保留。';
}

export function merchantAssetRightsSoftPrompt() {
  return '如果照片里有顾客，请确认已经获得对方同意；这一步可以稍后补充，不影响继续整理。';
}

export function merchantVisibleLanguageIssues(message: string) {
  return FORBIDDEN_LANGUAGE.filter(({ pattern }) => pattern.test(message)).map(
    ({ label }) => label,
  );
}
