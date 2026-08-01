/**
 * P2-11 / #323 — Composer @素材 style-analysis entry + timeline stage copy.
 *
 * Pure browser model. Core owns parse/inject (`xhs-style-analysis.ts`);
 * this surface owns when the merchant opts in via attached/referenced assets.
 */

/** Mirror of core STYLE_ANALYSIS_DIMENSIONS (consumer-facing labels). */
export const STYLE_ANALYSIS_DIMENSION_LABELS = [
  '画风',
  '配色',
  '背景',
  '文字风格',
  '装饰元素',
  '排版结构',
  '整体调性',
] as const;

/** Timeline stage message (§4.8). Keep in lockstep with core. */
export const STYLE_ANALYSIS_STAGE_MESSAGE =
  '正在分析参考图风格（七维），后续配图会按同一风格保持一致' as const;

export const STYLE_ANALYSIS_STAGE_ID = 'xhs_style_analysis' as const;

/**
 * Merchant language for the Composer @素材 control that marks an uploaded
 * image as a style reference (hang point: Composer @素材).
 */
export const STYLE_ANALYSIS_MENTION_LABEL = '用作风格参考' as const;
export const STYLE_ANALYSIS_MENTION_HINT =
  '标记后会先分析参考图七维风格，再注入批量配图保持一致' as const;

export type StyleAnalysisEntryState = {
  /** Asset ids the merchant marked as style references (@素材). */
  styleReferenceAssetIds: readonly string[];
  /** Whether the independent analysis step should run. */
  willAnalyze: boolean;
  /** Timeline stage copy when analysis is active. */
  stageMessage: string | null;
  stageId: typeof STYLE_ANALYSIS_STAGE_ID | null;
};

export function projectStyleAnalysisEntry(input: {
  /** Uploaded / mentioned asset ids available in the draft. */
  attachedAssetIds?: readonly string[];
  /** Explicit style-reference selection (Composer @素材). */
  styleReferenceAssetIds?: readonly string[];
}): StyleAnalysisEntryState {
  const attached = new Set(
    (input.attachedAssetIds ?? []).map((id) => id.trim()).filter(Boolean)
  );
  const styleRefs = (input.styleReferenceAssetIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && (attached.size === 0 || attached.has(id)));

  const willAnalyze = styleRefs.length > 0;
  return {
    styleReferenceAssetIds: styleRefs,
    willAnalyze,
    stageMessage: willAnalyze ? STYLE_ANALYSIS_STAGE_MESSAGE : null,
    stageId: willAnalyze ? STYLE_ANALYSIS_STAGE_ID : null,
  };
}

/** Toggle one asset into / out of the style-reference set. */
export function toggleStyleReferenceAsset(
  current: readonly string[],
  assetId: string
): string[] {
  const id = assetId.trim();
  if (!id) return [...current];
  if (current.includes(id)) return current.filter((item) => item !== id);
  return [...current, id];
}

/** Map the mounted control state onto the canonical Composer source role. */
export function submissionRoleForStyleReference(
  assetId: string,
  styleReferenceAssetIds: readonly string[]
): 'style' | 'reference' {
  return styleReferenceAssetIds.includes(assetId) ? 'style' : 'reference';
}

/**
 * Detect @素材 intent from free text (lightweight mention parse).
 * Matches「@素材」or「@风格参考」tokens; does not invent asset ids.
 */
export function detectStyleAnalysisMention(intent: string): boolean {
  return /@\s*(素材|风格参考|参考图)/u.test(intent);
}

/**
 * When mention text is present but no asset yet, surface the stage as a
 * pending explanation (honest: analysis waits for an attached image).
 */
export function projectStyleAnalysisMentionNotice(input: {
  intent: string;
  attachedAssetIds?: readonly string[];
}): { pending: boolean; message: string | null } {
  const mentioned = detectStyleAnalysisMention(input.intent);
  if (!mentioned) return { pending: false, message: null };
  const hasAsset = (input.attachedAssetIds ?? []).some(
    (id) => id.trim().length > 0
  );
  if (hasAsset) {
    return {
      pending: false,
      message: STYLE_ANALYSIS_STAGE_MESSAGE,
    };
  }
  return {
    pending: true,
    message: '已识别风格参考意图，请先上传或点选一张素材图再分析七维风格',
  };
}
