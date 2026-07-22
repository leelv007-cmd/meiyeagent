/**
 * Copy / image_text worksurface pure model
 * (D-085 / D-046 / WT-D2 / #100 / P1-B2 / #151).
 *
 * Document-first primary recommendation · on-demand alternatives ·
 * edit · selection rewrite with stable anchors · fact sources ·
 * platform preview. Persistent "还想怎么改？": model path → derived Task
 * (D-046); deterministic hand edit → OCC derived revision. Never
 * client-concat platform variants (formal copy.adapt only).
 */

// ---------------------------------------------------------------------------
// Document fields (P0 editable)
// ---------------------------------------------------------------------------

export type CopyDocumentFields = {
  title: string;
  body: string;
  conversionHook: string;
  topics: string[];
  /** Ordered visual asset ids for image_text media strip. */
  orderedAssetIds: string[];
};

export type CopyDocumentDraft = CopyDocumentFields & {
  baseRevisionId: string;
  dirty: boolean;
};

export function createCopyDocumentDraft(
  fields: CopyDocumentFields,
  baseRevisionId: string
): CopyDocumentDraft {
  return {
    ...fields,
    topics: [...fields.topics],
    orderedAssetIds: [...fields.orderedAssetIds],
    baseRevisionId,
    dirty: false,
  };
}

export type CopyFieldKey =
  | 'title'
  | 'body'
  | 'conversionHook'
  | 'topics'
  | 'orderedAssetIds';

export function applyCopyFieldEdit(
  draft: CopyDocumentDraft,
  field: CopyFieldKey,
  value: string | string[]
): CopyDocumentDraft {
  if (field === 'topics' || field === 'orderedAssetIds') {
    const next = Array.isArray(value) ? [...value] : [value];
    return { ...draft, [field]: next, dirty: true };
  }
  return { ...draft, [field]: String(value), dirty: true };
}

// ---------------------------------------------------------------------------
// Selection rewrite (stable anchor · base drift · derived Task)
// ---------------------------------------------------------------------------

export type SelectionRewriteAction =
  | 'rewrite'
  | 'shorten'
  | 'expand'
  | 'tone_shift'
  | 'weaker_promo'
  | 'stronger_cta';

export const SELECTION_REWRITE_LABELS: Record<SelectionRewriteAction, string> =
  {
    rewrite: '改写选区',
    shorten: '缩短',
    expand: '扩写',
    tone_shift: '换语气',
    weaker_promo: '弱促销',
    stronger_cta: '加强 CTA',
  };

export type SelectionRewriteRequest = {
  action: SelectionRewriteAction;
  /** Full field value. */
  field: Extract<CopyFieldKey, 'title' | 'body' | 'conversionHook'>;
  /** Inclusive start / exclusive end into the field string. */
  start: number;
  end: number;
  /** Optional free instruction for rewrite / tone_shift. */
  instruction?: string;
};

/**
 * Stable text anchor for selection rewrite (P1-B2).
 * Binds selected text + surrounding context so offsets are not reapplied
 * blindly after base revision drift.
 */
export type StableSelectionAnchor = {
  field: Extract<CopyFieldKey, 'title' | 'body' | 'conversionHook'>;
  /** Selected substring at capture time. */
  selectedText: string;
  /** Up to 24 chars before the selection (context prefix). */
  prefix: string;
  /** Up to 24 chars after the selection (context suffix). */
  suffix: string;
  /** FNV-1a style hash of field|prefix|selected|suffix for equality. */
  anchorHash: string;
  /** Offsets at capture time — informational only after drift. */
  start: number;
  end: number;
};

export type SelectionRewritePreview = {
  field: SelectionRewriteRequest['field'];
  before: string;
  after: string;
  /** Full field after applying the preview patch. */
  fieldAfter: string;
  /** Always model-path: derived Task on confirm. */
  execution: 'derived_task';
  anchor: StableSelectionAnchor;
  baseRevisionId: string;
};

export type SelectionRewriteCommand = {
  kind: 'selection_rewrite';
  workId: string;
  baseRevisionId: string;
  action: SelectionRewriteAction;
  instruction: string;
  anchor: StableSelectionAnchor;
  /** Always derived Task — never OCC hand-edit. */
  execution: 'derived_task';
};

export type SelectionRewriteResolveResult =
  | {
      kind: 'ok';
      command: SelectionRewriteCommand;
      preview: SelectionRewritePreview;
      resolvedStart: number;
      resolvedEnd: number;
    }
  | {
      kind: 'conflict';
      code: 'BASE_REVISION_DRIFT' | 'ANCHOR_NOT_FOUND';
      message: string;
      baseRevisionId: string;
      currentRevisionId: string;
      choices: readonly ['compare', 'discard', 'reapply'];
      /** Anchor as captured — for compare UI. */
      anchor: StableSelectionAnchor;
      /** Current field text for side-by-side compare. */
      currentFieldText: string;
    }
  | { kind: 'invalid'; message: string };

/** Lightweight stable hash (FNV-1a 32-bit) — no crypto dependency. */
export function hashSelectionAnchorParts(
  field: string,
  prefix: string,
  selected: string,
  suffix: string
): string {
  const input = `${field}|${prefix}|${selected}|${suffix}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Capture a stable selection anchor from field offsets at the current base.
 */
export function captureStableSelectionAnchor(
  fieldText: string,
  field: StableSelectionAnchor['field'],
  start: number,
  end: number
): StableSelectionAnchor | { kind: 'invalid'; message: string } {
  if (start < 0 || end > fieldText.length || start >= end) {
    return { kind: 'invalid', message: '请先选择一段文字' };
  }
  const selectedText = fieldText.slice(start, end);
  const prefix = fieldText.slice(Math.max(0, start - 24), start);
  const suffix = fieldText.slice(end, Math.min(fieldText.length, end + 24));
  return {
    field,
    selectedText,
    prefix,
    suffix,
    anchorHash: hashSelectionAnchorParts(field, prefix, selectedText, suffix),
    start,
    end,
  };
}

/**
 * Resolve an anchor against live field text without relying on stale offsets.
 * Prefers prefix+selected+suffix match; falls back to unique selectedText.
 */
export function resolveSelectionAnchor(
  fieldText: string,
  anchor: StableSelectionAnchor
):
  | { kind: 'ok'; start: number; end: number }
  | { kind: 'not_found'; message: string } {
  const needle = `${anchor.prefix}${anchor.selectedText}${anchor.suffix}`;
  if (needle.length > 0) {
    const at = fieldText.indexOf(needle);
    if (at >= 0) {
      const start = at + anchor.prefix.length;
      return {
        kind: 'ok',
        start,
        end: start + anchor.selectedText.length,
      };
    }
  }
  // Unique selected-text fallback.
  const first = fieldText.indexOf(anchor.selectedText);
  if (first >= 0) {
    const second = fieldText.indexOf(
      anchor.selectedText,
      first + anchor.selectedText.length
    );
    if (second < 0) {
      return {
        kind: 'ok',
        start: first,
        end: first + anchor.selectedText.length,
      };
    }
  }
  return {
    kind: 'not_found',
    message: '选区已随正文变化失效，请重新选择后再改写。',
  };
}

function applyRewriteAction(
  before: string,
  action: SelectionRewriteAction,
  instruction?: string
): string {
  switch (action) {
    case 'shorten':
      return before.slice(0, Math.max(1, Math.floor(before.length * 0.6)));
    case 'expand':
      return `${before}，结合本店真实项目说明，欢迎到店了解。`;
    case 'weaker_promo':
      return (
        before
          .replace(/(?:限时|优惠|抢购|必买|冲|立即)/gu, '')
          .replace(/\s{2,}/gu, ' ')
          .trim() || before
      );
    case 'stronger_cta':
      return `${before} 现在可预约到店咨询。`;
    case 'tone_shift':
      return instruction?.trim()
        ? `【${instruction.trim()}】${before}`
        : `换个说法：${before}`;
    case 'rewrite':
      return instruction?.trim() ? instruction.trim() : `改写：${before}`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

/**
 * Local deterministic preview for selection rewrite chips.
 * Confirm still routes through derived Task (D-046) — this is display only.
 */
export function previewSelectionRewrite(
  draft: CopyDocumentDraft,
  request: SelectionRewriteRequest
): SelectionRewritePreview | { kind: 'invalid'; message: string } {
  const source = draft[request.field];
  if (typeof source !== 'string') {
    return { kind: 'invalid', message: '选区字段无效' };
  }
  const anchor = captureStableSelectionAnchor(
    source,
    request.field,
    request.start,
    request.end
  );
  if ('kind' in anchor) return anchor;
  const before = anchor.selectedText;
  const after = applyRewriteAction(before, request.action, request.instruction);
  const fieldAfter =
    source.slice(0, anchor.start) + after + source.slice(anchor.end);
  return {
    field: request.field,
    before,
    after,
    fieldAfter,
    execution: 'derived_task',
    anchor,
    baseRevisionId: draft.baseRevisionId,
  };
}

/**
 * Build a selection-rewrite derived Task command bound to base revision +
 * stable anchor. Base drift or lost anchor returns conflict with compare.
 */
export function resolveSelectionRewrite(input: {
  workId: string;
  /** Revision the selection was captured against. */
  baseRevisionId: string;
  /** Live canonical revision id. */
  currentRevisionId: string;
  /** Live field text for the anchor field. */
  currentFieldText: string;
  action: SelectionRewriteAction;
  instruction?: string;
  anchor: StableSelectionAnchor;
}): SelectionRewriteResolveResult {
  if (input.baseRevisionId !== input.currentRevisionId) {
    return {
      kind: 'conflict',
      code: 'BASE_REVISION_DRIFT',
      message: '正文已有新版本。请比较后再决定是否重新应用选区改写。',
      baseRevisionId: input.baseRevisionId,
      currentRevisionId: input.currentRevisionId,
      choices: ['compare', 'discard', 'reapply'],
      anchor: input.anchor,
      currentFieldText: input.currentFieldText,
    };
  }
  const resolved = resolveSelectionAnchor(input.currentFieldText, input.anchor);
  if (resolved.kind === 'not_found') {
    return {
      kind: 'conflict',
      code: 'ANCHOR_NOT_FOUND',
      message: resolved.message,
      baseRevisionId: input.baseRevisionId,
      currentRevisionId: input.currentRevisionId,
      choices: ['compare', 'discard', 'reapply'],
      anchor: input.anchor,
      currentFieldText: input.currentFieldText,
    };
  }
  const before = input.currentFieldText.slice(resolved.start, resolved.end);
  const after = applyRewriteAction(before, input.action, input.instruction);
  const instruction =
    input.instruction?.trim() ||
    `${SELECTION_REWRITE_LABELS[input.action]}：「${before}」`;
  const fieldAfter =
    input.currentFieldText.slice(0, resolved.start) +
    after +
    input.currentFieldText.slice(resolved.end);
  const command: SelectionRewriteCommand = {
    kind: 'selection_rewrite',
    workId: input.workId,
    baseRevisionId: input.baseRevisionId,
    action: input.action,
    instruction,
    anchor: input.anchor,
    execution: 'derived_task',
  };
  return {
    kind: 'ok',
    command,
    preview: {
      field: input.anchor.field,
      before,
      after,
      fieldAfter,
      execution: 'derived_task',
      anchor: input.anchor,
      baseRevisionId: input.baseRevisionId,
    },
    resolvedStart: resolved.start,
    resolvedEnd: resolved.end,
  };
}

// ---------------------------------------------------------------------------
// Document-first primary + on-demand alternatives (P1-B2)
// ---------------------------------------------------------------------------

export type DocumentCandidate = {
  candidateId: string;
  title: string;
  body: string;
  conversionHook: string;
  topics?: string[];
};

export type DocumentWorksurfaceProjection = {
  /** Primary recommendation is always expanded as the document face. */
  primary: DocumentCandidate;
  primaryExpanded: true;
  /** Alternatives stay collapsed until the merchant expands them. */
  alternatives: DocumentCandidate[];
  alternativesExpandedDefault: false;
  /** Editable draft bound to the primary (or selected alternative). */
  activeDocument: CopyDocumentFields;
  activeCandidateId: string;
};

/**
 * Project the document worksurface: primary expanded, alternatives on demand.
 * Never renders three technical candidate cards as the default face.
 */
export function projectDocumentWorksurface(input: {
  candidates: readonly DocumentCandidate[];
  /** Which candidate is active for edit; defaults to primary. */
  activeCandidateId?: string;
  orderedAssetIds?: string[];
}): DocumentWorksurfaceProjection | { kind: 'empty' } {
  const [primary, ...rest] = input.candidates;
  if (!primary) return { kind: 'empty' };
  const active =
    input.candidates.find((c) => c.candidateId === input.activeCandidateId) ??
    primary;
  return {
    primary,
    primaryExpanded: true,
    alternatives: rest,
    alternativesExpandedDefault: false,
    activeDocument: {
      title: active.title,
      body: active.body,
      conversionHook: active.conversionHook,
      topics: active.topics ? [...active.topics] : [],
      orderedAssetIds: input.orderedAssetIds ? [...input.orderedAssetIds] : [],
    },
    activeCandidateId: active.candidateId,
  };
}

// ---------------------------------------------------------------------------
// Fact sources (high-risk facts)
// ---------------------------------------------------------------------------

export type FactSourceKind =
  | 'price'
  | 'deadline'
  | 'effect_claim'
  | 'credential'
  | 'customer_case'
  | 'material'
  | 'identity'
  | 'rights';

export type FactSourceStatus = 'confirmed' | 'pending' | 'missing';

export type FactSourceItem = {
  id: string;
  kind: FactSourceKind;
  label: string;
  summary: string;
  status: FactSourceStatus;
  sourceRef?: string;
};

export const FACT_SOURCE_KIND_LABELS: Record<FactSourceKind, string> = {
  price: '价格',
  deadline: '期限',
  effect_claim: '项目效果',
  credential: '资质',
  customer_case: '顾客案例',
  material: '素材',
  identity: '门店身份',
  rights: '权利摘要',
};

export function projectFactSources(items: readonly FactSourceItem[]): {
  items: FactSourceItem[];
  pendingCount: number;
  hasHighRiskPending: boolean;
} {
  const pending = items.filter((i) => i.status !== 'confirmed');
  return {
    items: [...items],
    pendingCount: pending.length,
    hasHighRiskPending: pending.some(
      (i) =>
        i.kind === 'price' ||
        i.kind === 'deadline' ||
        i.kind === 'effect_claim' ||
        i.kind === 'credential'
    ),
  };
}

// ---------------------------------------------------------------------------
// Platform preview — formal copy.adapt only (dual-track convergence)
// ---------------------------------------------------------------------------

/** Locked public platforms plus the export-only moments destination (D-023). */
export type CopyPreviewCarrier =
  | 'xiaohongshu'
  | 'douyin'
  | 'video_account'
  | 'wechat_moments';

export const COPY_PREVIEW_CARRIER_LABELS: Record<CopyPreviewCarrier, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  video_account: '微信视频号',
  wechat_moments: '朋友圈导出',
};

export const COPY_PREVIEW_PLATFORM_CARRIERS = [
  'xiaohongshu',
  'douyin',
  'video_account',
] as const satisfies readonly CopyPreviewCarrier[];

export const COPY_PREVIEW_EXPORT_CARRIERS = [
  'wechat_moments',
] as const satisfies readonly CopyPreviewCarrier[];

/**
 * Platform preview payload produced by formal `copy.adapt` (server).
 * Client-side prefix concatenation is explicitly rejected.
 */
export type PlatformPreviewVariant = {
  carrier: CopyPreviewCarrier;
  title: string;
  body: string;
  conversionHook: string;
  topics: string[];
  /** Provenance: must be formal adapt, never client_concat. */
  source: 'copy.adapt';
  /** Optional model / job id for audit (no provider name). */
  derivedTaskId?: string;
};

export type PlatformPreviewRequest =
  | {
      kind: 'formal_adapt';
      carrier: CopyPreviewCarrier;
      baseRevisionId: string;
      packageId: string;
    }
  | {
      /** Forbidden dual-track path — rejected by projectPlatformPreview. */
      kind: 'client_concat';
      carrier: CopyPreviewCarrier;
      prefix: string;
      body: string;
    };

export type PlatformPreviewProjection =
  | {
      kind: 'ready';
      variant: PlatformPreviewVariant;
    }
  | {
      kind: 'pending';
      carrier: CopyPreviewCarrier;
      message: string;
    }
  | {
      kind: 'rejected';
      code: 'CLIENT_CONCAT_FORBIDDEN' | 'MISSING_VARIANT';
      message: string;
    };

/**
 * Project platform preview. Rejects client-side string concatenation that
 * pretends to be platform adaptation (copy.adapt dual-track convergence).
 */
export function projectPlatformPreview(input: {
  request: PlatformPreviewRequest;
  /** Server-produced variant when formal adapt completed. */
  formalVariant?: PlatformPreviewVariant | null;
}): PlatformPreviewProjection {
  if (input.request.carrier === 'wechat_moments') {
    return {
      kind: 'rejected',
      code: 'MISSING_VARIANT',
      message: '朋友圈仅作为导出成品，不生成或暗示自动发布版本。',
    };
  }
  if (input.request.kind === 'client_concat') {
    return {
      kind: 'rejected',
      code: 'CLIENT_CONCAT_FORBIDDEN',
      message:
        '平台预览必须通过正式 copy.adapt 生成，不能用客户端拼接前缀冒充平台适配。',
    };
  }
  if (!input.formalVariant) {
    return {
      kind: 'pending',
      carrier: input.request.carrier,
      message: `采用此版本后即可生成${COPY_PREVIEW_CARRIER_LABELS[input.request.carrier]}正式平台版本。`,
    };
  }
  if (input.formalVariant.source !== 'copy.adapt') {
    return {
      kind: 'rejected',
      code: 'CLIENT_CONCAT_FORBIDDEN',
      message: '平台预览来源无效。',
    };
  }
  if (input.formalVariant.carrier !== input.request.carrier) {
    return {
      kind: 'rejected',
      code: 'MISSING_VARIANT',
      message: '尚未生成该平台版本。',
    };
  }
  return { kind: 'ready', variant: input.formalVariant };
}

/**
 * Detect legacy client-concat patterns (e.g. quick-edit `平台版\n` prefix).
 * Used to refuse showing them as formal platform variants on this surface.
 */
export function isClientConcatPlatformBody(body: string): boolean {
  return (
    body.startsWith('平台版\n') ||
    body.startsWith('【朋友圈】') ||
    body.startsWith('【小红书】')
  );
}

// ---------------------------------------------------------------------------
// Persistent free-text adjust ("还想怎么改？")
// ---------------------------------------------------------------------------

export const ADJUST_PROMPT_PLACEHOLDER = '还想怎么改？';
export const ADJUST_PROMPT_SUBMIT_LABEL = '提交调整';

export type AdjustExecutionPath =
  | {
      path: 'derived_task';
      /** Model-executed free text or structured AI chip. */
      instruction: string;
      baseRevisionId: string;
      workId: string;
    }
  | {
      path: 'occ_derived_revision';
      /** Deterministic hand edit fields. */
      changes: Partial<
        Pick<
          CopyDocumentFields,
          'title' | 'body' | 'conversionHook' | 'topics' | 'orderedAssetIds'
        >
      >;
      baseRevisionId: string;
      expectedRevision: number;
      packageId: string;
      reason: string;
    };

/**
 * Route free-text / hand edit into the correct execution path.
 * Model text → derived Task; pure field patch → OCC revision.
 * Never client-concat for platform_variant.
 */
export function routeAdjustExecution(input: {
  kind: 'free_text' | 'hand_edit' | 'selection_rewrite' | 'platform_adapt';
  workId: string;
  baseRevisionId: string;
  instruction?: string;
  handEdit?: {
    changes: Extract<
      AdjustExecutionPath,
      { path: 'occ_derived_revision' }
    >['changes'];
    expectedRevision: number;
    packageId: string;
    reason: string;
  };
}): AdjustExecutionPath | { kind: 'rejected'; code: string; message: string } {
  switch (input.kind) {
    case 'free_text':
    case 'selection_rewrite': {
      const instruction = input.instruction?.trim();
      if (!instruction) {
        return {
          kind: 'rejected',
          code: 'EMPTY_INSTRUCTION',
          message: '请输入调整方向',
        };
      }
      return {
        path: 'derived_task',
        instruction,
        baseRevisionId: input.baseRevisionId,
        workId: input.workId,
      };
    }
    case 'hand_edit': {
      if (!input.handEdit) {
        return {
          kind: 'rejected',
          code: 'MISSING_CHANGES',
          message: '缺少手改内容',
        };
      }
      return {
        path: 'occ_derived_revision',
        changes: input.handEdit.changes,
        baseRevisionId: input.baseRevisionId,
        expectedRevision: input.handEdit.expectedRevision,
        packageId: input.handEdit.packageId,
        reason: input.handEdit.reason,
      };
    }
    case 'platform_adapt':
      // Platform adapt always goes through formal copy.adapt derived Task —
      // never client string concat.
      return {
        path: 'derived_task',
        instruction: input.instruction?.trim() || '生成平台适配版本',
        baseRevisionId: input.baseRevisionId,
        workId: input.workId,
      };
    default: {
      const _exhaustive: never = input.kind;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Surface projection
// ---------------------------------------------------------------------------

export type CopyImageTextWorksurfaceFacts = {
  workId: string;
  baseRevisionId: string;
  document: CopyDocumentFields;
  /** Optional alternative candidates (on-demand, not three technical cards). */
  alternativeCandidates?: readonly DocumentCandidate[];
  factSources?: readonly FactSourceItem[];
  platformPreviews?: readonly PlatformPreviewVariant[];
  selectedCarrier?: CopyPreviewCarrier;
  lifecycle: 'candidate' | 'adopted' | 'delivered';
  /** Viewport for action budget assertions. */
  viewport?: 'desktop' | 'mobile';
};

export type CopyImageTextWorksurfaceView = {
  document: CopyDocumentDraft;
  /** Primary is the editable document; alternatives stay collapsed by default. */
  documentFace: DocumentWorksurfaceProjection | null;
  factSources: ReturnType<typeof projectFactSources>;
  platformPreview: PlatformPreviewProjection | null;
  adjustPrompt: {
    placeholder: typeof ADJUST_PROMPT_PLACEHOLDER;
    submitLabel: typeof ADJUST_PROMPT_SUBMIT_LABEL;
    persistent: true;
  };
  selectionRewriteActions: {
    action: SelectionRewriteAction;
    label: string;
  }[];
  /** Mobile P0 must expose the full action set — never "请到桌面继续". */
  mobileDesktopGate: null;
  panels: {
    edit: true;
    selectionRewrite: true;
    factSources: true;
    platformPreview: true;
    adjustPrompt: true;
    alternatives: true;
  };
};

export function projectCopyImageTextWorksurface(
  facts: CopyImageTextWorksurfaceFacts
): CopyImageTextWorksurfaceView {
  const draft = createCopyDocumentDraft(facts.document, facts.baseRevisionId);
  const factSources = projectFactSources(facts.factSources ?? []);
  const carrier = facts.selectedCarrier ?? 'xiaohongshu';
  const formal = facts.platformPreviews?.find((v) => v.carrier === carrier);
  // Guard: refuse client-concat bodies even if mis-tagged.
  const safeFormal =
    formal && !isClientConcatPlatformBody(formal.body) ? formal : null;
  const platformPreview = projectPlatformPreview({
    request: {
      kind: 'formal_adapt',
      carrier,
      baseRevisionId: facts.baseRevisionId,
      packageId: facts.workId,
    },
    formalVariant: safeFormal ?? null,
  });

  const primaryCandidate: DocumentCandidate = {
    candidateId: 'primary',
    title: facts.document.title,
    body: facts.document.body,
    conversionHook: facts.document.conversionHook,
    topics: facts.document.topics,
  };
  const documentFaceResult = projectDocumentWorksurface({
    candidates: [primaryCandidate, ...(facts.alternativeCandidates ?? [])],
    orderedAssetIds: facts.document.orderedAssetIds,
  });
  const documentFace =
    'kind' in documentFaceResult && documentFaceResult.kind === 'empty'
      ? null
      : (documentFaceResult as DocumentWorksurfaceProjection);

  return {
    document: draft,
    documentFace,
    factSources,
    platformPreview,
    adjustPrompt: {
      placeholder: ADJUST_PROMPT_PLACEHOLDER,
      submitLabel: ADJUST_PROMPT_SUBMIT_LABEL,
      persistent: true,
    },
    selectionRewriteActions: (
      Object.keys(SELECTION_REWRITE_LABELS) as SelectionRewriteAction[]
    ).map((action) => ({
      action,
      label: SELECTION_REWRITE_LABELS[action],
    })),
    mobileDesktopGate: null,
    panels: {
      edit: true,
      selectionRewrite: true,
      factSources: true,
      platformPreview: true,
      adjustPrompt: true,
      alternatives: true,
    },
  };
}

/** Mobile P0 action ids that must be available (no desktop gate). */
export const COPY_MOBILE_P0_ACTIONS = [
  'view',
  'adopt',
  'free_text_adjust',
  'copy_text',
  'download',
  'share_or_fallback',
  'save_revision',
  'save_to_library',
  'create_from_this',
  'version_restore',
  'async_recover_retry_cancel',
] as const;

export type CopyMobileP0Action = (typeof COPY_MOBILE_P0_ACTIONS)[number];

export function projectCopyMobileP0Actions(): {
  actions: readonly CopyMobileP0Action[];
  desktopOnlyMessage: null;
} {
  return {
    actions: COPY_MOBILE_P0_ACTIONS,
    desktopOnlyMessage: null,
  };
}
