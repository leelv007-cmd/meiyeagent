/**
 * Copy / image_text worksurface pure model (D-085 / D-046 / WT-D2 / #100).
 *
 * Edit · selection rewrite · fact sources · platform preview.
 * Persistent "还想怎么改？": model path → derived Task (D-046);
 * deterministic hand edit → OCC derived revision. Never client-concat
 * platform variants (formal copy.adapt only).
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
// Selection rewrite (preview then confirm → new revision)
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

export type SelectionRewritePreview = {
  field: SelectionRewriteRequest['field'];
  before: string;
  after: string;
  /** Full field after applying the preview patch. */
  fieldAfter: string;
  /** Always model-path: derived Task on confirm. */
  execution: 'derived_task';
};

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
  if (
    request.start < 0 ||
    request.end > source.length ||
    request.start >= request.end
  ) {
    return { kind: 'invalid', message: '请先选择一段文字' };
  }
  const before = source.slice(request.start, request.end);
  let after = before;
  switch (request.action) {
    case 'shorten':
      after = before.slice(0, Math.max(1, Math.floor(before.length * 0.6)));
      break;
    case 'expand':
      after = `${before}，结合本店真实项目说明，欢迎到店了解。`;
      break;
    case 'weaker_promo':
      after =
        before
          .replace(/(?:限时|优惠|抢购|必买|冲|立即)/gu, '')
          .replace(/\s{2,}/gu, ' ')
          .trim() || before;
      break;
    case 'stronger_cta':
      after = `${before} 现在可预约到店咨询。`;
      break;
    case 'tone_shift':
      after = request.instruction?.trim()
        ? `【${request.instruction.trim()}】${before}`
        : `换个说法：${before}`;
      break;
    case 'rewrite':
      after = request.instruction?.trim()
        ? request.instruction.trim()
        : `改写：${before}`;
      break;
    default: {
      const _exhaustive: never = request.action;
      return _exhaustive;
    }
  }
  const fieldAfter =
    source.slice(0, request.start) + after + source.slice(request.end);
  return {
    field: request.field,
    before,
    after,
    fieldAfter,
    execution: 'derived_task',
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
  | 'customer_case';

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

/** P0 preview carriers for copy / image_text (D-085). */
export type CopyPreviewCarrier = 'xiaohongshu' | 'wechat_moments';

export const COPY_PREVIEW_CARRIER_LABELS: Record<CopyPreviewCarrier, string> = {
  xiaohongshu: '小红书',
  wechat_moments: '朋友圈',
};

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
      message: `正在生成${COPY_PREVIEW_CARRIER_LABELS[input.request.carrier]}版本…`,
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
  factSources?: readonly FactSourceItem[];
  platformPreviews?: readonly PlatformPreviewVariant[];
  selectedCarrier?: CopyPreviewCarrier;
  lifecycle: 'candidate' | 'adopted' | 'delivered';
  /** Viewport for action budget assertions. */
  viewport?: 'desktop' | 'mobile';
};

export type CopyImageTextWorksurfaceView = {
  document: CopyDocumentDraft;
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

  return {
    document: draft,
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
