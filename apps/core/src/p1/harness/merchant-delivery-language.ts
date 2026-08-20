import type { HarnessStage, MerchantReport } from '@meiye/contracts';
import { merchantReportSchema } from '@meiye/contracts';

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

export function merchantSelectionWhyNow() {
  return '这版先按你这次的要求整理，已经准备好直接使用。';
}

export function merchantIdentityVoiceNotice() {
  return '这次先用门店官方口吻生成；以后想换成你的个人口吻，直接在对话里告诉我就好。';
}

export function merchantConfirmationQuestion(question: string) {
  return `为了让成品更贴合你的想法，想确认一下：${question}`;
}

/** D-164③: paid generation confirmation (not D-013 class-7 external publish). */
export function merchantPaidGenerationConfirmationQuestion() {
  return '是否按当前方案开始生成？将按展示的参数与费用执行。';
}

export function merchantPaidGenerationConfirmationReason() {
  return '生成前需要商家确认本次执行参数与费用';
}

export function merchantPaidGenerationConfirmationAccepted() {
  return '已确认执行方案，开始生成。';
}

/**
 * V31-63: the confirmed plan's quote drifted before execution, so this run
 * hands over to a freshly admitted successor confirmation instead of failing.
 * Nothing was executed and nothing was charged — the successor transaction
 * already refunded the predecessor's hold.
 */
export function merchantPaidGenerationSupersededByReprice() {
  return '报价已更新，本次未执行也未扣费；新的确认卡已准备好，请确认最新方案后继续。';
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

/**
 * P2-11 / #323: independent style-analysis stage on the note/image timeline.
 * Keep wording aligned with `STYLE_ANALYSIS_STAGE_MESSAGE` in xhs-style-analysis.
 */
export function merchantStyleAnalysisProgress() {
  return '正在分析参考图风格（七维），后续配图会按同一风格保持一致';
}

export function merchantNoteStyleUnavailable() {
  return '你刚选的图文方向已不在当前配置中，请重新选择后再继续。';
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

export function merchantExactTextVerificationUnavailable() {
  return '这张图的文字暂时没法完成逐字核对，为了不写错没有交付。可以改成不带价格文字的图片，或稍后重新生成。';
}

export function merchantVideoGenerationFailure(
  reason: 'failed' | 'timed_out',
) {
  return reason === 'timed_out'
    ? '这次视频等待时间过长，暂时没有生成成品。你可以重新生成，或先改用图片发布方案。'
    : '这次视频没有顺利生成成品。你可以重新生成，或更换参考素材后再试。';
}

export function merchantImageGenerationFailure(
  reason: 'failed' | 'timed_out',
) {
  return reason === 'timed_out'
    ? '这次图片等待时间过长，暂时没有出图。你可以重新生成，或换一张参考素材再试。'
    : '这次图片没有顺利生成。你可以重新生成，或换一张参考素材再试。';
}

export function merchantContentSourceBlocked() {
  return '这次写出来的内容里有还没核对来源的经营信息，为了不说错，先没有交付。';
}

export function merchantDeliveryConflict() {
  return '这个作品刚才被更新过，这次的结果就没有再保存下来。';
}

export function merchantBriefFallbackNotice() {
  return '这次整理创作要求时不太顺利，已经按稳妥的通用写法继续，不影响你拿到成品。';
}

/**
 * 诚实交付要能落到页上 (D-122). The 申报卡 says how many pages did not come out
 * right; without a marker on the delivered copy itself the merchant still has no
 * way to tell which ones, and 「诚实」 stops at the summary. This rides in front
 * of the page body in the assembled version, so the distinction survives into
 * whatever they copy out.
 */
export function merchantNotePartialPageMarker() {
  return '【这一页的画面和文字还没对上，建议先别发这页】';
}

export function merchantNotePartialConsistency(unresolvedPages: number) {
  return merchantPartialFailure({
    completed: '整套图文已经生成好了',
    failed: `其中 ${unresolvedPages} 页的画面和文字还没完全对上`,
    nextStep: '你可以先用已经对好的页面，或者让我把没对上的那几页重做一次',
  });
}

/**
 * V31-36: video scene-level partial delivery (merchant language, D-061).
 * `failedSceneLabels` are 1-based scene numbers already formatted as strings.
 */
export function merchantVideoPartialScenes(input: {
  deliveredUsable: number;
  failedSceneLabels: readonly string[];
}) {
  const failedList = input.failedSceneLabels.join('、');
  return merchantPartialFailure({
    completed: `已完成 ${input.deliveredUsable} 个镜头`,
    failed:
      input.failedSceneLabels.length === 1
        ? `第 ${failedList} 个镜头没有做成`
        : `第 ${failedList} 个镜头没有做成`,
    nextStep: '可以先用已经做成的镜头，或者让我只重做没成的那几个镜头',
  });
}

/**
 * The one place a terminal failure becomes something a merchant can read and
 * act on. Deterministic on purpose: the same failure always produces the same
 * 申报, so the browser can render it without asking Core a second question and
 * without inventing wording of its own.
 *
 * `merchantMessage` is preferred when the throw site already wrote one (视频失败
 * / 逐字文字不符); the category and the recovery actions are derived here so
 * every failure ends with a way forward rather than a dead end.
 */
export function merchantFailureReport(
  failure: Record<string, unknown> | null | undefined,
): MerchantReport {
  const code = typeof failure?.code === 'string' ? failure.code : '';
  const gateIds = Array.isArray(failure?.gateIds)
    ? failure.gateIds.filter(
        (gateId): gateId is string => typeof gateId === 'string',
      )
    : [];
  const written =
    typeof failure?.merchantMessage === 'string' &&
    failure.merchantMessage.trim()
      ? failure.merchantMessage.trim()
      : undefined;
  // Absent means the failure predates the reservation or carried none; saying
  // 「已退回」 without knowing is exactly the dishonesty this card removes.
  const quotaRefunded = failure?.quotaRefunded === true;
  const report = (
    input: Omit<MerchantReport, 'kind' | 'quotaRefunded'>,
  ): MerchantReport =>
    merchantReportSchema.parse({
      ...input,
      kind: 'failure',
      quotaRefunded,
    });

  if (
    code === 'MEDIA_EXACT_TEXT_VERIFICATION_FAILED' ||
    code === 'MEDIA_EXACT_TEXT_VERIFIER_UNAVAILABLE' ||
    gateIds.includes('image_exact_text')
  ) {
    return report({
      category: 'exact_text',
      message:
        written ??
        '图片里的文字没有通过逐字核对，为了不写错价格，这张图没有交付。',
      nextStep:
        '请返回工作台，把图片文字改成不含价格，或补齐正确文字后重新发起。',
      actions: ['adjust_intent'],
    });
  }
  if (code === 'HARNESS_ALL_CANDIDATES_BLOCKED') {
    return report({
      category: 'content_source',
      message: written ?? merchantContentSourceBlocked(),
      nextStep:
        '可以直接再生成一次，或补一条已确认资料、去掉没依据的说法后再来。',
      actions: ['retry', 'adjust_intent'],
    });
  }
  if (
    code === 'MEDIA_GENERATION_FAILED' ||
    code === 'MEDIA_RECONCILIATION_PENDING' ||
    code === 'MEDIA_SNAPSHOT_MISMATCH' ||
    code === 'MEDIA_BRIEF_KIND_MISMATCH' ||
    code === 'MEDIA_SELECTION_MISSING'
  ) {
    return report({
      category: 'media_generation',
      message: written ?? merchantImageGenerationFailure('failed'),
      nextStep: '请返回工作台调整要求，或换成文案后重新发起。',
      actions: ['adjust_intent'],
    });
  }
  if (code === 'HARNESS_MEDIA_SCOPE_INVALID') {
    return report({
      category: 'consistency',
      message: written ?? merchantNoteStyleUnavailable(),
      nextStep: '请返回工作台重新选择图文方向后发起。',
      actions: ['adjust_intent'],
    });
  }
  if (code === 'WORK_EXECUTION_STALLED') {
    return report({
      category: 'unknown',
      message:
        written ?? '这次创作超时没有完成，积分已经退回。',
      nextStep: '请返回工作台重新发起本次创作。',
      actions: ['adjust_intent'],
    });
  }
  if (code === 'CONTENT_PACKAGE_REVISION_CONFLICT') {
    return report({
      category: 'consistency',
      message: written ?? merchantDeliveryConflict(),
      nextStep: '请返回工作台确认当前内容后重新发起。',
      actions: ['adjust_intent'],
    });
  }
  return report({
    category: 'unknown',
    message: written ?? '这次没能顺利完成，抱歉。',
    nextStep: '请返回工作台调整要求后，重新发起本次创作。',
    actions: ['adjust_intent'],
  });
}

/**
 * 诚实交付 (D-122): part of it landed. The run still ends in success because
 * the merchant has something usable — the card states what did not land next to
 * what did, instead of throwing the whole thing away.
 */
export function merchantPartialDeliveryReport(input: {
  message: string;
  nextStep: string;
  category?: MerchantReport['category'];
}): MerchantReport {
  return merchantReportSchema.parse({
    kind: 'partial',
    category: input.category ?? 'consistency',
    message: input.message,
    nextStep: input.nextStep,
    actions: ['review_partial', 'retry'],
    quotaRefunded: false,
  });
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
