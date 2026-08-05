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
  | 'projectPriceValidity'
  | 'district'
  | 'address'
  | 'booking'
  | 'brandVoice'
  | 'industry';

/**
 * The merchant's answer to "how long is this price good for" (#244).
 *
 * Three states, and the empty one is not a default — it is "unanswered", and it
 * blocks confirmation. The product used to store a limited-time promotion as a
 * standing price nobody asked about, which then kept turning up in content long
 * after the promotion ended.
 *
 *   ''            — unanswered.
 *   'long_term'   — the merchant said it is a standing price.
 *   'YYYY-MM-DD'  — the merchant said it runs to the end of that day.
 */
export const PRICE_VALIDITY_LONG_TERM = 'long_term';

const PRICE_VALIDITY_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * The chosen answer as the instant the price stops counting: `null` for a
 * standing price, an ISO timestamp for a dated one, `undefined` when the
 * merchant has not answered and nothing may be written.
 */
export function priceValidityExpiresAt(
  validity: string
): string | null | undefined {
  const answer = validity.trim();
  if (answer === PRICE_VALIDITY_LONG_TERM) return null;
  if (!PRICE_VALIDITY_DATE.test(answer)) return undefined;
  const [year, month, day] = answer.split('-').map(Number);
  const endOfDay = new Date(year!, month! - 1, day!, 23, 59, 59, 999);
  return Number.isNaN(endOfDay.getTime()) ? undefined : endOfDay.toISOString();
}

/** Stored validity → the answer the wizard shows back, round-tripped. */
export function priceValidityFromStored(
  priceValidUntil: string | null | undefined
): string {
  if (priceValidUntil === undefined) return '';
  if (priceValidUntil === null) return PRICE_VALIDITY_LONG_TERM;
  const stored = new Date(priceValidUntil);
  if (Number.isNaN(stored.getTime())) return '';
  const month = `${stored.getMonth() + 1}`.padStart(2, '0');
  const day = `${stored.getDate()}`.padStart(2, '0');
  return `${stored.getFullYear()}-${month}-${day}`;
}

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
  /** D-174 store-wide beauty category; '' means the merchant has not stated it. */
  industry: string;
  projectId: string;
  projectDurationMinutes: number;
  projectName: string;
  projectPrice: string;
  /** See `PRICE_VALIDITY_LONG_TERM` — '' means the merchant has not answered. */
  projectPriceValidity: string;
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
  inputKind: 'text' | 'number' | 'price_validity';
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
  'projectPriceValidity',
  'district',
  'address',
  'booking',
  'brandVoice',
];

/**
 * Ids that project onto the fact ledger when answered.
 *
 * Deliberately not the same list as FACT_ORDER: industry is collected by the
 * store intake wizard, not by the Day-0 question flow, because D-119 keeps
 * intake from ever becoming a precondition and D-174 makes industry skippable.
 * It still has to reach the ledger on the wizard lane, which is what this list
 * is for — FACT_ORDER decides what gets *asked*, this decides what gets *sent*.
 */
const LEDGER_PROJECTED_FACTS: ProgressiveFactId[] = [...FACT_ORDER, 'industry'];

const BLOCKING = new Set<ProgressiveFactId>([
  'name',
  'city',
  'projectName',
  'projectPrice',
  'projectPriceValidity',
]);

const FALLBACKS: Record<
  Extract<
    ProgressiveFactId,
    'district' | 'address' | 'booking' | 'brandVoice' | 'industry'
  >,
  string
> = {
  district: '本区',
  address: '门店地址待补充',
  booking: '到店咨询预约',
  brandVoice: '真实、克制、像熟客推荐',
  // Unlike the others this fallback is not written anywhere: skipping industry
  // means the profile stays silent about it, and the recommendation falls back
  // to its platform / weekday reasons. Saying nothing beats guessing a trade.
  industry: '不按行业定制开场',
};

const WHY: Record<ProgressiveFactId, string> = {
  name: '成品文案需要可引用的门店名称，避免示例店名混入商家内容。',
  city: '同城曝光与平台投放表述依赖城市，缺失时无法写出可信到店引导。',
  projectName: '文案里要提到你的招牌项目，得先有一个。',
  projectPrice: '价格你说了我才敢写，不会自己编。',
  projectPriceValidity:
    '活动价过了期还被写进文案，是要挨骂的。你说到哪天，我就写到哪天。',
  district: '区县帮助同城检索，但不阻塞基础文案生成。',
  address: '详细地址用于到店指引，可先跳过并用安全占位。',
  booking: '预约方式决定文案结尾怎么请顾客来。',
  brandVoice: '语气偏好可稍后完善；跳过时使用克制默认语气。',
  industry: '说清主营哪一类美业服务，今日推荐才能按你的行业给理由。',
};

const IMPACT: Record<ProgressiveFactId, string> = {
  name: '回答后，本次及后续创作会复用该店名。',
  city: '回答后，同城与到店表述会绑定此城市。',
  projectName: '回答后，主推项目会写入已确认项目列表。',
  projectPrice: '回答后，报价与促销表述可引用此价格。',
  projectPriceValidity: '说了用到哪天，过了这天我就自动不再提这个价。',
  district: '跳过将使用“本区”占位，同城精度下降。',
  address: '跳过将使用“门店地址待补充”，成品不写具体导航。',
  booking: '跳过将使用“到店咨询预约”，不写具体预约渠道。',
  brandVoice: '跳过将使用默认克制语气，可稍后在门店资料改。',
  industry: '回答后，今日推荐会按你的行业说明为什么适合现在做。',
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
  /**
   * #244 historical prices. A stored project that carries no `priceValidUntil`
   * at all was never asked how long its price runs — it predates the question.
   * Nothing about it is discarded; it is simply shown as still waiting on the
   * merchant, exactly like a photo reading nobody has confirmed yet. Derived
   * from what is stored rather than stamped by a migration, so it survives any
   * number of replays and needs no backfill.
   */
  const priceValidityNeverStated =
    project !== undefined && project.priceValidUntil === undefined;
  const projectUnconfirmed: ProgressiveFactId[] =
    profile && project
      ? !project.confirmed
        ? ['projectName', 'projectPrice', 'projectPriceValidity']
        : activeFacts === undefined
          ? priceValidityNeverStated
            ? ['projectPriceValidity']
            : []
          : [
              ...(activeFactIds.has(`store-project:${project.id}:service`)
                ? []
                : (['projectName'] as const)),
              ...(activeFactIds.has(`store-project:${project.id}:price`)
                ? []
                : (['projectPrice'] as const)),
              ...(priceValidityNeverStated
                ? (['projectPriceValidity'] as const)
                : []),
            ]
      : [];
  return {
    name: profile?.name ?? partial?.name ?? '',
    city: profile?.city ?? partial?.city ?? '',
    district: profile?.district ?? partial?.district ?? '',
    address: profile?.address ?? partial?.address ?? '',
    booking: profile?.booking ?? partial?.booking ?? '',
    brandVoice: profile?.brandVoice ?? partial?.brandVoice ?? '',
    industry: profile?.industry ?? partial?.industry ?? '',
    projectId: project?.id ?? partial?.projectId ?? 'progressive-project-1',
    projectDurationMinutes:
      project?.durationMinutes ?? partial?.projectDurationMinutes ?? 60,
    projectName: project?.name ?? partial?.projectName ?? '',
    projectPrice:
      project === undefined
        ? (partial?.projectPrice ?? '')
        : String(project.price),
    projectPriceValidity:
      project === undefined
        ? (partial?.projectPriceValidity ?? '')
        : priceValidityFromStored(project.priceValidUntil),
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
  if (id === 'projectPriceValidity') {
    // No implicit "they left it blank, call it permanent": an unreadable or
    // absent answer is unanswered, and unanswered blocks the confirmation.
    return priceValidityExpiresAt(draft.projectPriceValidity) !== undefined;
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
    inputKind:
      id === 'projectPrice'
        ? 'number'
        : id === 'projectPriceValidity'
          ? 'price_validity'
          : 'text',
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

  // The validity answer has no fact of its own — it *is* the price fact's
  // expiry. Restating it therefore has to rewrite the price stream, or the
  // ledger would keep the old window while the profile claims the new one.
  const priceExpiresAt = priceValidityExpiresAt(draft.projectPriceValidity);
  if (priceExpiresAt === undefined) return null;
  if (
    priceExpiresAt !== null &&
    Date.parse(priceExpiresAt) <= Date.parse(options.capturedAt)
  ) {
    return null;
  }
  const answered = new Set(draft.answered);
  if (answered.has('projectPriceValidity')) answered.add('projectPrice');

  const candidates = LEDGER_PROJECTED_FACTS.filter((id) =>
    answered.has(id)
  ).flatMap((id) => {
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
  // No fallback value here on purpose: an unstated industry stays absent from
  // the patch, which is what keeps "skipped" different from "answered blank".
  // Core also pairs this field with the industry fact candidate, so writing a
  // placeholder would claim a trade the merchant never named.
  if (changed.has('industry') && draft.industry.trim()) {
    profilePatch.industry = draft.industry.trim();
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
    changed.has('projectPrice') ||
    changed.has('projectPriceValidity')
  ) {
    profilePatch.projects = {
      upsert: [
        {
          id: draft.projectId,
          name: draft.projectName.trim(),
          price,
          durationMinutes: draft.projectDurationMinutes,
          confirmed: true,
          // Always carried, never inferred: Core rejects a merchant-confirmed
          // price whose profile side stays silent about how long it runs.
          priceValidUntil: priceExpiresAt,
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
    case 'industry': {
      // Blank never becomes a fact: Core checks this candidate against
      // profilePatch.industry, which stays absent unless the merchant stated
      // one, and a fact claiming an empty trade would fail that pairing.
      const industry = draft.industry.trim();
      if (!industry) return null;
      return {
        factId: 'store-profile:industry:other',
        fact: {
          ...base,
          kind: 'other',
          key: 'store.profile.industry',
          value: { industry },
        },
      };
    }
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
    case 'projectPrice': {
      const expiresAt = priceValidityExpiresAt(draft.projectPriceValidity);
      if (expiresAt === undefined) return null;
      return {
        factId: `store-project:${draft.projectId}:price`,
        fact: {
          ...base,
          kind: 'price',
          key: `service.${draft.projectId}.price`,
          value: { amount: Number(draft.projectPrice), currency: 'CNY' },
          expiresAt,
        },
      };
    }
    // The validity answer rides on the price fact above rather than opening a
    // stream of its own — one price, one window, one thing to keep in step.
    case 'projectPriceValidity':
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
    (id) =>
      id === 'projectName' ||
      id === 'projectPrice' ||
      id === 'projectPriceValidity'
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
