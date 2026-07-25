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
  { label: 'revision', pattern: /\brevision\b/iu },
  { label: 'candidate', pattern: /\bcandidate\b/iu },
  { label: 'schema', pattern: /\bschema\b/iu },
  { label: 'DBOS', pattern: /\bdbos\b/iu },
  { label: 'LLM', pattern: /\bllm\b/iu },
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

export function merchantVisibleLanguageIssues(message: string) {
  return FORBIDDEN_LANGUAGE.filter(({ pattern }) => pattern.test(message)).map(
    ({ label }) => label,
  );
}
