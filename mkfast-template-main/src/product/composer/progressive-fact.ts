/**
 * Day-0 progressive store fact questions (P1-A1 / #148).
 *
 * One blocking fact at a time from Recipe/snapshot readiness gaps.
 * Non-critical facts may be skipped with an explicit safe fallback and
 * impact note. Confirmation is one finalize_store_intake batch so the server
 * can project the same event into StoreFact and StoreProfile.
 */

import type {
  FinalizeStoreIntakeCommand,
  StoreFact,
  StoreFactCandidateDraft,
  StoreProfile,
  StoreProfilePatch,
} from '@meiye/contracts';

export type ProgressiveFactId =
  | 'name'
  | 'city'
  | 'projectName'
  | 'projectPrice'
  | 'district'
  | 'address'
  | 'booking'
  | 'brandVoice';

export type ProgressiveFactCriticality = 'blocking' | 'skippable';

/**
 * Where a draft value came from. Mirrors the parse contract's
 * `ASSET_FIELD_PROVENANCE` plus `import` for D-151③ historical staging, so the
 * five-step wizard can render an honest badge next to every prefilled field
 * instead of presenting machine guesses as merchant answers.
 */
export type ProgressiveFactProvenance =
  | 'user'
  | 'photo_extract'
  | 'ai_suggestion'
  | 'import';

export type ProgressiveFactDraft = {
  name: string;
  city: string;
  district: string;
  address: string;
  booking: string;
  brandVoice: string;
  projectId: string;
  projectDurationMinutes: number;
  projectName: string;
  projectPrice: string;
  /** Facts explicitly answered during this confirmation session. */
  answered: ProgressiveFactId[];
  /** Prefilled values that still require explicit merchant confirmation. */
  unconfirmed: ProgressiveFactId[];
  /** Facts the merchant chose to skip (only skippable ids). */
  skipped: ProgressiveFactId[];
  /** Origin of each prefilled value; absent means the merchant typed it. */
  provenance: Partial<Record<ProgressiveFactId, ProgressiveFactProvenance>>;
};

export type ProgressiveFactQuestion = {
  id: ProgressiveFactId;
  criticality: ProgressiveFactCriticality;
  /** Why this fact is asked for the current delivery. */
  why: string;
  /** Impact if answered / skipped. */
  impact: string;
  /** Safe fallback applied when skippable and skipped. */
  safeFallback?: string;
  inputKind: 'text' | 'number';
};

export type ProgressiveFactView = {
  draft: ProgressiveFactDraft;
  current: ProgressiveFactQuestion | null;
  answeredIds: ProgressiveFactId[];
  readyToConfirm: boolean;
  /** Human-readable impact of all current skips. */
  skipImpacts: string[];
};

export type FinalizeStoreIntakeRequest = {
  action: 'finalize_store_intake';
  payload: FinalizeStoreIntakeCommand;
};

export type FinalizeStoreIntakeOptions = {
  batchId: string;
  capturedAt: string;
  expectedRevision: number;
  factRevisions?: Record<string, number>;
  referenceId: string;
  /**
   * Platform default for `regulated` (`compliance.regulated_mode.default`),
   * only read when this patch creates the profile (revision 0). `regulated` is
   * a platform/category admission call, never a merchant answer, so the web
   * side seeds the admin default instead of inventing one; when the default is
   * unknown the revision-0 command is withheld rather than guessed.
   */
  regulatedDefault?: boolean;
  taskId: string;
  workspaceId: string;
};

const FACT_ORDER: ProgressiveFactId[] = [
  'name',
  'city',
  'projectName',
  'projectPrice',
  'district',
  'address',
  'booking',
  'brandVoice',
];

const BLOCKING = new Set<ProgressiveFactId>([
  'name',
  'city',
  'projectName',
  'projectPrice',
]);

const FALLBACKS: Record<
  Extract<ProgressiveFactId, 'district' | 'address' | 'booking' | 'brandVoice'>,
  string
> = {
  district: '本区',
  address: '门店地址待补充',
  booking: '到店咨询预约',
  brandVoice: '真实、克制、像熟客推荐',
};

const WHY: Record<ProgressiveFactId, string> = {
  name: '成品文案需要可引用的门店名称，避免示例店名混入商家内容。',
  city: '同城曝光与平台投放表述依赖城市，缺失时无法写出可信到店引导。',
  projectName: '本次交付需要至少一个已确认项目，作为主推与价格锚点。',
  projectPrice: '价格进入事实账本后才能引用；未确认价格不会被编造。',
  district: '区县帮助同城检索，但不阻塞基础文案生成。',
  address: '详细地址用于到店指引，可先跳过并用安全占位。',
  booking: '预约方式影响 CTA，可先用通用到店咨询回退。',
  brandVoice: '语气偏好可稍后完善；跳过时使用克制默认语气。',
};

const IMPACT: Record<ProgressiveFactId, string> = {
  name: '回答后，本次及后续创作会复用该店名。',
  city: '回答后，同城与到店表述会绑定此城市。',
  projectName: '回答后，主推项目会写入已确认项目列表。',
  projectPrice: '回答后，报价与促销表述可引用此价格。',
  district: '跳过将使用“本区”占位，同城精度下降。',
  address: '跳过将使用“门店地址待补充”，成品不写具体导航。',
  booking: '跳过将使用“到店咨询预约”，不写具体预约渠道。',
  brandVoice: '跳过将使用默认克制语气，可稍后在门店资料改。',
};

export function createProgressiveFactDraft(
  input?: Partial<ProgressiveFactDraft> | StoreProfile,
  activeFacts?: Array<Pick<StoreFact, 'factId' | 'revision'>>
): ProgressiveFactDraft {
  const profile: StoreProfile | undefined =
    input && 'projects' in input ? input : undefined;
  const partial: Partial<ProgressiveFactDraft> | undefined = profile
    ? undefined
    : (input as Partial<ProgressiveFactDraft> | undefined);
  const project = profile?.projects[0];
  const activeFactIds = new Set(activeFacts?.map((fact) => fact.factId));
  const projectUnconfirmed: ProgressiveFactId[] =
    profile && project
      ? !project.confirmed
        ? ['projectName', 'projectPrice']
        : activeFacts === undefined
          ? []
          : [
              ...(activeFactIds.has(`store-project:${project.id}:service`)
                ? []
                : (['projectName'] as const)),
              ...(activeFactIds.has(`store-project:${project.id}:price`)
                ? []
                : (['projectPrice'] as const)),
            ]
      : [];
  return {
    name: profile?.name ?? partial?.name ?? '',
    city: profile?.city ?? partial?.city ?? '',
    district: profile?.district ?? partial?.district ?? '',
    address: profile?.address ?? partial?.address ?? '',
    booking: profile?.booking ?? partial?.booking ?? '',
    brandVoice: profile?.brandVoice ?? partial?.brandVoice ?? '',
    projectId: project?.id ?? partial?.projectId ?? 'progressive-project-1',
    projectDurationMinutes:
      project?.durationMinutes ?? partial?.projectDurationMinutes ?? 60,
    projectName: project?.name ?? partial?.projectName ?? '',
    projectPrice:
      project === undefined
        ? (partial?.projectPrice ?? '')
        : String(project.price),
    answered: partial?.answered ? [...partial.answered] : [],
    unconfirmed: profile
      ? projectUnconfirmed
      : partial?.unconfirmed
        ? [...partial.unconfirmed]
        : [],
    skipped: partial?.skipped ? [...partial.skipped] : [],
    provenance: partial?.provenance ? { ...partial.provenance } : {},
  };
}

/**
 * Fold server-extracted values into a draft (W02 step 4 → step 5).
 *
 * Everything folded in lands as *unconfirmed*: an extraction is a proposal, and
 * `isAnswered` keeps returning false until the merchant explicitly confirms the
 * field, which is what stops a photo reading from being finalized behind their
 * back.
 */
export function applyExtractedFacts(
  draft: ProgressiveFactDraft,
  entries: Array<{
    id: ProgressiveFactId;
    provenance: ProgressiveFactProvenance;
    value: string;
  }>
): ProgressiveFactDraft {
  const next: ProgressiveFactDraft = {
    ...draft,
    answered: [...draft.answered],
    skipped: [...draft.skipped],
    unconfirmed: [...draft.unconfirmed],
    provenance: { ...draft.provenance },
  };
  for (const entry of entries) {
    if (entry.value.trim().length === 0) continue;
    next[entry.id] = entry.value;
    next.answered = next.answered.filter((item) => item !== entry.id);
    next.skipped = next.skipped.filter((item) => item !== entry.id);
    if (!next.unconfirmed.includes(entry.id)) next.unconfirmed.push(entry.id);
    next.provenance[entry.id] = entry.provenance;
  }
  return next;
}

function fieldValue(draft: ProgressiveFactDraft, id: ProgressiveFactId) {
  return draft[id].trim();
}

function isAnswered(draft: ProgressiveFactDraft, id: ProgressiveFactId) {
  if (draft.skipped.includes(id)) return true;
  if (draft.unconfirmed.includes(id) && !draft.answered.includes(id)) {
    return false;
  }
  if (id === 'projectPrice') {
    const price = Number(draft.projectPrice);
    return (
      draft.projectPrice.trim().length > 0 &&
      Number.isFinite(price) &&
      price >= 0
    );
  }
  return fieldValue(draft, id).length > 0;
}

export function progressiveFactQuestion(
  id: ProgressiveFactId
): ProgressiveFactQuestion {
  const criticality: ProgressiveFactCriticality = BLOCKING.has(id)
    ? 'blocking'
    : 'skippable';
  return {
    id,
    criticality,
    why: WHY[id],
    impact: IMPACT[id],
    ...(criticality === 'skippable'
      ? {
          safeFallback:
            FALLBACKS[id as 'district' | 'address' | 'booking' | 'brandVoice'],
        }
      : {}),
    inputKind: id === 'projectPrice' ? 'number' : 'text',
  };
}

export function projectProgressiveFactView(
  draft: ProgressiveFactDraft
): ProgressiveFactView {
  const answeredIds = FACT_ORDER.filter((id) => isAnswered(draft, id));
  const currentId = FACT_ORDER.find((id) => !isAnswered(draft, id)) ?? null;
  const readyToConfirm = [...BLOCKING].every((id) => isAnswered(draft, id));
  const skipImpacts = draft.skipped.map((id) => IMPACT[id]);
  return {
    draft,
    current: currentId ? progressiveFactQuestion(currentId) : null,
    answeredIds,
    readyToConfirm,
    skipImpacts,
  };
}

export function answerProgressiveFact(
  draft: ProgressiveFactDraft,
  id: ProgressiveFactId,
  value: string
): ProgressiveFactDraft {
  const next: ProgressiveFactDraft = {
    ...draft,
    answered: draft.answered.includes(id)
      ? draft.answered
      : [...draft.answered, id],
    unconfirmed: draft.unconfirmed.filter((item) => item !== id),
    skipped: draft.skipped.filter((item) => item !== id),
    // Confirming a prefill unchanged keeps its origin — only an edit makes the
    // merchant the author of the value.
    provenance:
      value === draft[id]
        ? draft.provenance
        : { ...draft.provenance, [id]: 'user' },
    [id]: value,
  };
  return next;
}

export function skipProgressiveFact(
  draft: ProgressiveFactDraft,
  id: ProgressiveFactId
): ProgressiveFactDraft | null {
  if (BLOCKING.has(id)) return null;
  const fallback =
    FALLBACKS[id as 'district' | 'address' | 'booking' | 'brandVoice'];
  if (!fallback) return null;
  return {
    ...draft,
    [id]: fallback,
    skipped: draft.skipped.includes(id)
      ? draft.skipped
      : [...draft.skipped, id],
  };
}

export function buildFinalizeStoreIntakeCommand(
  draft: ProgressiveFactDraft,
  options: FinalizeStoreIntakeOptions
): FinalizeStoreIntakeRequest | null {
  const view = projectProgressiveFactView(draft);
  if (!view.readyToConfirm) return null;

  const price = Number(draft.projectPrice);
  if (!Number.isFinite(price) || price < 0) return null;

  const candidates = draft.answered.flatMap((id) => {
    const projection = storeFactProjection(draft, id, options);
    if (!projection) return [];
    return [
      {
        candidateId: `${projection.factId}:candidate`,
        status: 'pending' as const,
        objectKind: 'store_fact' as const,
        fact: projection.fact,
      },
    ];
  });
  if (candidates.length === 0) return null;

  const changed = new Set([...draft.answered, ...draft.skipped]);
  const initializingProfile = options.expectedRevision === 0;
  const profilePatch: StoreProfilePatch = {
    expectedRevision: options.expectedRevision,
  };
  if (initializingProfile || changed.has('name')) {
    profilePatch.name = draft.name.trim();
  }
  if (initializingProfile || changed.has('city')) {
    profilePatch.city = draft.city.trim();
  }
  if (initializingProfile || changed.has('district')) {
    profilePatch.district = (
      draft.district.trim() || FALLBACKS.district
    ).trim();
  }
  if (initializingProfile || changed.has('address')) {
    profilePatch.address = (draft.address.trim() || FALLBACKS.address).trim();
  }
  if (initializingProfile || changed.has('booking')) {
    profilePatch.booking = (draft.booking.trim() || FALLBACKS.booking).trim();
  }
  if (initializingProfile || changed.has('brandVoice')) {
    profilePatch.brandVoice = (
      draft.brandVoice.trim() || FALLBACKS.brandVoice
    ).trim();
  }
  if (initializingProfile) {
    // Core requires `regulated` on the first patch (STORE_PROFILE_INCOMPLETE),
    // so the platform default has to be loaded before Day-0 can be confirmed.
    if (options.regulatedDefault === undefined) return null;
    profilePatch.regulated = options.regulatedDefault;
  }
  if (
    initializingProfile ||
    changed.has('projectName') ||
    changed.has('projectPrice')
  ) {
    profilePatch.projects = {
      upsert: [
        {
          id: draft.projectId,
          name: draft.projectName.trim(),
          price,
          durationMinutes: draft.projectDurationMinutes,
          confirmed: true,
        },
      ],
    };
  }

  return {
    action: 'finalize_store_intake',
    payload: {
      batch: {
        batchId: options.batchId,
        taskId: options.taskId,
        source: {
          sourceId: options.referenceId,
          kind: 'manual',
          referenceId: options.referenceId,
          capabilityStatus: 'assisted',
          sourceWorkspaceId: options.workspaceId,
          capturedAt: options.capturedAt,
          example: false,
        },
        summary: 'Merchant confirmed progressive store facts.',
        candidates,
      },
      confirmations: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        factId: candidate.candidateId.slice(0, -':candidate'.length),
        expectedFactRevision:
          options.factRevisions?.[
            candidate.candidateId.slice(0, -':candidate'.length)
          ] ?? 0,
      })),
      profilePatch,
    },
  };
}

function storeFactProjection(
  draft: ProgressiveFactDraft,
  id: ProgressiveFactId,
  options: FinalizeStoreIntakeOptions
): { factId: string; fact: StoreFactCandidateDraft } | null {
  const base = {
    scope: { storeId: options.workspaceId },
    source: {
      kind: 'user_confirmation' as const,
      referenceId: options.referenceId,
      capturedAt: options.capturedAt,
    },
    effectiveFrom: options.capturedAt,
    expiresAt: null,
  };
  switch (id) {
    case 'name':
      return {
        factId: 'store-profile:name:other',
        fact: {
          ...base,
          kind: 'other',
          key: 'store.profile.name',
          value: { name: draft.name.trim() },
        },
      };
    case 'city':
      return {
        factId: 'store-profile:city:other',
        fact: {
          ...base,
          kind: 'other',
          key: 'store.profile.city',
          value: { city: draft.city.trim() },
        },
      };
    case 'district':
      return {
        factId: 'store-profile:district:other',
        fact: {
          ...base,
          kind: 'other',
          key: 'store.profile.district',
          value: { district: draft.district.trim() },
        },
      };
    case 'address':
      return {
        factId: 'store-profile:address:fulfillment',
        fact: {
          ...base,
          kind: 'fulfillment',
          key: 'store.fulfillment.address',
          value: { address: draft.address.trim() },
        },
      };
    case 'booking':
      return {
        factId: 'store-profile:booking:fulfillment',
        fact: {
          ...base,
          kind: 'fulfillment',
          key: 'store.fulfillment.booking',
          value: { booking: draft.booking.trim() },
        },
      };
    case 'projectName':
      return {
        factId: `store-project:${draft.projectId}:service`,
        fact: {
          ...base,
          kind: 'service',
          key: `service.${draft.projectId}.name`,
          value: { name: draft.projectName.trim() },
        },
      };
    case 'projectPrice':
      return {
        factId: `store-project:${draft.projectId}:price`,
        fact: {
          ...base,
          kind: 'price',
          key: `service.${draft.projectId}.price`,
          value: { amount: Number(draft.projectPrice), currency: 'CNY' },
        },
      };
    case 'brandVoice':
      return null;
  }
}

export function progressiveFactRevisionMap(
  facts: Array<Pick<StoreFact, 'factId' | 'revision'>>
) {
  return facts.reduce<Record<string, number>>((revisions, fact) => {
    revisions[fact.factId] = Math.max(
      revisions[fact.factId] ?? 0,
      fact.revision
    );
    return revisions;
  }, {});
}

export function hasMissingProgressiveStoreFacts(
  store: StoreProfile | undefined,
  facts: Array<Pick<StoreFact, 'factId' | 'revision'>>
) {
  if (!store?.projects[0]) return false;
  return createProgressiveFactDraft(store, facts).unconfirmed.some(
    (id) => id === 'projectName' || id === 'projectPrice'
  );
}

export function shouldShowProgressiveFactCard(input: {
  groundingRequested: boolean;
  hasProductState: boolean;
  hasStore: boolean;
  ledgerReady: boolean;
  missingStoreFacts: boolean;
  productLoading: boolean;
}) {
  if (!input.hasProductState || input.productLoading) return false;
  if (!input.hasStore) return true;
  if (!input.ledgerReady) return false;
  return input.groundingRequested || input.missingStoreFacts;
}

/** Next single missing grounding fact from product readiness. */
export function nextGroundingFactFocus(input: {
  storeConfirmed: boolean;
  projectConfirmed: boolean;
}): ProgressiveFactId | null {
  if (!input.storeConfirmed) return 'name';
  if (!input.projectConfirmed) return 'projectName';
  return null;
}
