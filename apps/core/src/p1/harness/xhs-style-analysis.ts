/**
 * P2-11 / #323 — Reference-image style analysis (七维).
 *
 * Independent step whose output is injected into batch image style consistency
 * (`consistencyRequirements` / `{styleAnalysisBlock}` on xhsOutline).
 *
 * Prompt body: `HARNESS_BUILTIN_PROMPTS.xhsStyleAnalysis` (#315).
 * Product hang points: Composer @素材 → timeline stage → inject into 配图链.
 */

import { HARNESS_BUILTIN_PROMPTS } from './langfuse-prompts.js';

/** Seven-dimension Chinese colon protocol (strict, one line per dimension). */
export const STYLE_ANALYSIS_DIMENSIONS = [
  '画风',
  '配色',
  '背景',
  '文字风格',
  '装饰元素',
  '排版结构',
  '整体调性',
] as const;

export type StyleAnalysisDimension = (typeof STYLE_ANALYSIS_DIMENSIONS)[number];

export type StyleAnalysisResult = {
  dimensions: Record<StyleAnalysisDimension, string>;
  /** Raw model text (trimmed), kept for audit/replay. */
  raw: string;
};

/** Merchant-facing timeline stage copy (§4.8 / §4.10). */
export const STYLE_ANALYSIS_STAGE_MESSAGE =
  '正在分析参考图风格（七维），后续配图会按同一风格保持一致' as const;

export const STYLE_ANALYSIS_STAGE_ID = 'xhs_style_analysis' as const;

/**
 * Whether the pipeline should run the independent style-analysis step.
 * Trigger: at least one `style_ref` image reference (Composer @素材 / slot).
 */
export function shouldRunStyleAnalysis(input: {
  referenceSlots?: readonly string[];
  styleReferenceAssetIds?: readonly string[];
}): boolean {
  if (
    input.styleReferenceAssetIds &&
    input.styleReferenceAssetIds.some((id) => id.trim().length > 0)
  ) {
    return true;
  }
  return (input.referenceSlots ?? []).some((slot) => slot === 'style_ref');
}

/**
 * Parse the seven-line Chinese colon protocol.
 * Tolerates optional full-width colon and surrounding whitespace.
 * Returns null when any dimension is missing or empty (fail closed for inject).
 */
export function parseStyleAnalysisOutput(
  raw: string,
): StyleAnalysisResult | null {
  const text = raw.trim();
  if (!text) return null;

  const dimensions = {} as Record<StyleAnalysisDimension, string>;
  for (const key of STYLE_ANALYSIS_DIMENSIONS) {
    const match = text.match(
      new RegExp(`^\\s*${key}\\s*[:：]\\s*(.+?)\\s*$`, 'mu'),
    );
    const value = match?.[1]?.trim();
    if (!value) return null;
    dimensions[key] = value;
  }

  return { dimensions, raw: text };
}

/**
 * Format the block injected into outline / image prompts as `{styleAnalysisBlock}`.
 * Empty analysis → empty string (caller leaves placeholder blank).
 */
export function formatStyleAnalysisBlock(
  analysis: StyleAnalysisResult | null | undefined,
): string {
  if (!analysis) return '';
  const lines = STYLE_ANALYSIS_DIMENSIONS.map(
    (key) => `${key}：${analysis.dimensions[key]}`,
  );
  return `\n【风格参考（七维）】\n${lines.join('\n')}\n`;
}

/**
 * Replace `{styleAnalysisBlock}` in a frozen/builtin template.
 * Missing analysis clears the placeholder so outline still runs.
 */
export function injectStyleAnalysisBlock(
  template: string,
  analysis: StyleAnalysisResult | null | undefined,
): string {
  return template.replaceAll(
    '{styleAnalysisBlock}',
    formatStyleAnalysisBlock(analysis),
  );
}

/**
 * Map seven dimensions into image-set `consistencyRequirements` so the batch
 * 配图链 reuses the same style contract (ticket acceptance: 被配图链消费).
 */
export function styleAnalysisToConsistencyRequirements(
  analysis: StyleAnalysisResult,
): string[] {
  return STYLE_ANALYSIS_DIMENSIONS.map(
    (key) => `${key}保持一致：${analysis.dimensions[key]}`,
  );
}

/**
 * Apply style analysis onto an image set output plan fragment.
 * Does not invent pages — only enriches consistency requirements.
 */
export function applyStyleAnalysisToImageSetPlan(input: {
  analysis: StyleAnalysisResult;
  existingRequirements?: readonly string[];
}): {
  consistencyRequirements: string[];
} {
  const fromStyle = styleAnalysisToConsistencyRequirements(input.analysis);
  const existing = (input.existingRequirements ?? []).map((item) => item.trim()).filter(Boolean);
  // Style dims first so batch generation prefers visual lock; de-dupe by exact string.
  const seen = new Set<string>();
  const consistencyRequirements: string[] = [];
  for (const item of [...fromStyle, ...existing]) {
    if (seen.has(item)) continue;
    seen.add(item);
    consistencyRequirements.push(item);
  }
  return { consistencyRequirements };
}

/** Materialize the vision analysis user instruction from the frozen site. */
export function materializeStyleAnalysisSystemPrompt(template?: string): string {
  return (template?.trim() || HARNESS_BUILTIN_PROMPTS.xhsStyleAnalysis).trim();
}

/**
 * Consumer proof helper: given a parsed analysis, produce both injection forms
 * the outline + image-set paths need.
 */
export function consumeStyleAnalysisForImagePipeline(
  analysis: StyleAnalysisResult,
  outlineTemplate: string = HARNESS_BUILTIN_PROMPTS.xhsOutline,
): {
  outlinePrompt: string;
  styleAnalysisBlock: string;
  consistencyRequirements: string[];
  stageMessage: typeof STYLE_ANALYSIS_STAGE_MESSAGE;
} {
  const styleAnalysisBlock = formatStyleAnalysisBlock(analysis);
  return {
    outlinePrompt: injectStyleAnalysisBlock(outlineTemplate, analysis),
    styleAnalysisBlock,
    consistencyRequirements: styleAnalysisToConsistencyRequirements(analysis),
    stageMessage: STYLE_ANALYSIS_STAGE_MESSAGE,
  };
}
