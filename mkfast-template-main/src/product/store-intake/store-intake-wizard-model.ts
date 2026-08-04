/**
 * W02 五步录入 — the front-end consumer of the parse-service five-step contract
 * (`asset_intake_experience`) and of the D-151① single write channel.
 *
 * The five steps are the server's, not this file's: the order and which ones
 * are optional come straight off `AssetIntakeExperience.steps`, so a contract
 * change moves the UI rather than silently diverging from it. Everything the
 * merchant states still leaves through exactly one command —
 * `finalize_store_intake` — reusing the ProgressiveFact projection so there is
 * one mapping from answer to fact, not two.
 */

import type {
  AssetDraftSupply,
  AssetDraftTarget,
  AssetDraftView,
  AssetIntakeBatch,
  AssetIntakeExperience,
  FinalizeStoreIntakeCommand,
  ParseSourceAssetInput,
  ParseTask,
  StoreProfile,
} from '@meiye/contracts';

import {
  applyExtractedFacts,
  type ProgressiveFactDraft,
  type ProgressiveFactId,
  type ProgressiveFactProvenance,
} from '@/product/composer/progressive-fact';
import type { WorkspaceAssetUpload } from '@/p1/workspace-asset-upload';

export type StoreIntakeStep = AssetIntakeExperience['steps'][number];
export type StoreIntakeStepId = StoreIntakeStep['id'];

/** Fields the wizard collects, in the order it walks them. */
export const STORE_INTAKE_FIELDS: ProgressiveFactId[] = [
  'name',
  'city',
  'projectName',
  'projectPrice',
  'projectPriceValidity',
  'district',
  'address',
  'booking',
];

/**
 * Asset-draft field keys → ProgressiveFact ids. The parse compiler emits
 * `offer.price` for a price list; the manual lane emits the profile keys the
 * finalize mapping already understands, so both lanes converge on one schema —
 * which is what makes "解析失败一键转手填" a lane switch rather than a
 * different form.
 */
const DRAFT_FIELD_FACTS: Record<string, ProgressiveFactId> = {
  'offer.price': 'projectPrice',
  'service.name': 'projectName',
  'service.price': 'projectPrice',
  'store.fulfillment.address': 'address',
  'store.fulfillment.booking': 'booking',
  'store.profile.city': 'city',
  'store.profile.district': 'district',
  'store.profile.name': 'name',
};

export const MANUAL_FIELD_KEYS: Record<ProgressiveFactId, string | undefined> =
  {
    address: 'store.fulfillment.address',
    booking: 'store.fulfillment.booking',
    brandVoice: undefined,
    city: 'store.profile.city',
    district: 'store.profile.district',
    name: 'store.profile.name',
    projectName: 'service.name',
    projectPrice: 'service.price',
    // No manual-draft key: the validity answer is the price fact's own expiry,
    // not a field of its own (#244).
    projectPriceValidity: undefined,
  };

/**
 * The two intake targets this wizard covers. Both are members of the parse
 * contract's `ASSET_DRAFT_TARGETS`; picking one decides whether the server
 * reads the photo as a document (price list → fact candidates) or classifies it
 * as a visual asset (→ one of the four contract slots).
 */
export type StoreIntakeTarget = Extract<
  AssetDraftTarget,
  'price_list' | 'visual_asset'
>;

export interface StoreIntakeWizardState {
  arrangeFailed: boolean;
  /** Server draft origin once step 4 has run; null before it does. */
  arrangedOrigin: AssetDraftView['origin'] | null;
  /** Server's four-slot reading of a visual asset; null on the document lane. */
  classification: AssetDraftView['visualClassification'];
  draft: ProgressiveFactDraft;
  exampleIndex: number;
  /** Merchant said "I have the right to use this photo" (soft, non-blocking). */
  rightsConfirmed: boolean;
  selectedRecommendations: string[];
  sentence: string;
  /**
   * The merchant has typed in the sentence box at least once. Tracked as an
   * event rather than inferred from the value: clearing the box is an edit too,
   * and "it looks like an untouched scaffold" would let the next tick refill a
   * box the merchant deliberately emptied.
   */
  sentenceEdited: boolean;
  stepIndex: number;
  target: StoreIntakeTarget;
  /** Single-file lane (kept for one-photo parse / manual fallback). */
  upload: WorkspaceAssetUpload | null;
  /**
   * Multi-file lane for batch parse. Independent of `upload` so single-file
   * and batch can coexist without replacing each other.
   */
  uploads: WorkspaceAssetUpload[];
}

export function createStoreIntakeWizardState(
  draft: ProgressiveFactDraft
): StoreIntakeWizardState {
  return {
    arrangeFailed: false,
    arrangedOrigin: null,
    classification: null,
    draft,
    exampleIndex: 0,
    rightsConfirmed: false,
    selectedRecommendations: [],
    sentence: '',
    sentenceEdited: false,
    stepIndex: 0,
    target: 'price_list',
    upload: null,
    uploads: [],
  };
}

/**
 * These readers stay total on purpose. The experience is server data crossing a
 * network boundary, and a truncated payload should degrade to "the guide could
 * not load" — not throw inside render and take the surrounding page down with
 * it, which is exactly what a half-shaped response did to the store page's
 * qualification block.
 */
export function currentStep(
  experience: AssetIntakeExperience,
  state: StoreIntakeWizardState
) {
  // Typed as a general array on purpose: the contract declares a fixed 5-tuple,
  // but this value crossed the wire and a truncated payload is a real shape.
  const steps: StoreIntakeStep[] = experience.steps ?? [];
  if (steps.length === 0) return undefined;
  return steps[Math.min(state.stepIndex, steps.length - 1)];
}

export function goToStep(
  experience: AssetIntakeExperience,
  state: StoreIntakeWizardState,
  delta: number
): StoreIntakeWizardState {
  const steps: StoreIntakeStep[] = experience.steps ?? [];
  if (steps.length === 0) return state;
  const stepIndex = Math.min(
    Math.max(state.stepIndex + delta, 0),
    steps.length - 1
  );
  return stepIndex === state.stepIndex ? state : { ...state, stepIndex };
}

/** "换一换" — cycle the platform sample without pretending it is the merchant's. */
export function rotateExample(
  experience: AssetIntakeExperience,
  state: StoreIntakeWizardState
): StoreIntakeWizardState {
  const examples: AssetIntakeExperience['examples'] = experience.examples ?? [];
  if (examples.length === 0) return state;
  return {
    ...state,
    exampleIndex: (state.exampleIndex + 1) % examples.length,
  };
}

export function selectedExample(
  experience: AssetIntakeExperience,
  state: StoreIntakeWizardState
) {
  const examples: AssetIntakeExperience['examples'] = experience.examples ?? [];
  if (examples.length === 0) return undefined;
  return examples[state.exampleIndex % examples.length];
}

/**
 * A recommendation is admin-authored free text ("项目名称、日常价、活动价"), so the
 * link from a tick to the fields it names is a *reading* of that text, not a
 * contract. It stays deliberately forgiving: a label nothing matches simply
 * contributes no fields, and ticking nothing keeps the wizard asking about
 * everything — the behaviour before the step existed.
 */
const RECOMMENDATION_FIELD_HINTS: ReadonlyArray<
  readonly [RegExp, ProgressiveFactId]
> = [
  [/项目名|服务名|品项/u, 'projectName'],
  [/价/u, 'projectPrice'],
  [/价/u, 'projectPriceValidity'],
  [/地址|位置/u, 'address'],
  [/预约|到店|联系|微信|电话/u, 'booking'],
  [/城市/u, 'city'],
  [/商圈|城区|区域/u, 'district'],
  [/店名|门店名称|品牌名/u, 'name'],
];

function selectedLabels(
  experience: AssetIntakeExperience,
  selectedRecommendations: string[]
) {
  const recommendations: AssetIntakeExperience['recommendations'] =
    experience.recommendations ?? [];
  return recommendations
    .filter((recommendation) =>
      selectedRecommendations.includes(recommendation.recommendationId)
    )
    .map((recommendation) => recommendation.label);
}

/** Fields the ticked recommendations name, in the wizard's own field order. */
export function recommendedFactIds(
  experience: AssetIntakeExperience,
  state: StoreIntakeWizardState
): ProgressiveFactId[] {
  const labels = selectedLabels(experience, state.selectedRecommendations);
  if (labels.length === 0) return [];
  return STORE_INTAKE_FIELDS.filter((id) =>
    RECOMMENDATION_FIELD_HINTS.some(
      ([pattern, target]) =>
        target === id && labels.some((label) => pattern.test(label))
    )
  );
}

/** Recommended fields first — the rest keep their order behind them. */
export function orderedIntakeFields(recommended: ProgressiveFactId[]) {
  return [
    ...STORE_INTAKE_FIELDS.filter((id) => recommended.includes(id)),
    ...STORE_INTAKE_FIELDS.filter((id) => !recommended.includes(id)),
  ];
}

/**
 * "少打字" made literal: the ticked labels become the skeleton of the sentence,
 * so the merchant fills in values instead of composing a description from
 * nothing. It is a prompt, not an answer — `statedSentence` drops it again if
 * nothing was written into it.
 */
export function recommendationScaffold(
  experience: AssetIntakeExperience,
  selectedRecommendations: string[]
) {
  return selectedLabels(experience, selectedRecommendations)
    .flatMap((label) => label.split(/[、,，]/u))
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => `${item}：`)
    .join('\n');
}

export function toggleRecommendation(
  experience: AssetIntakeExperience,
  state: StoreIntakeWizardState,
  recommendationId: string
): StoreIntakeWizardState {
  const selectedRecommendations = state.selectedRecommendations.includes(
    recommendationId
  )
    ? state.selectedRecommendations.filter((id) => id !== recommendationId)
    : [...state.selectedRecommendations, recommendationId];
  // Only a box the merchant never touched is re-scaffolded: whatever they typed
  // — including an emptied box — is theirs, and a checkbox must not rewrite it.
  return {
    ...state,
    selectedRecommendations,
    sentence: state.sentenceEdited
      ? state.sentence
      : recommendationScaffold(experience, selectedRecommendations),
  };
}

/** The merchant writing in the sentence box — the only writer that marks it theirs. */
export function editSentence(
  state: StoreIntakeWizardState,
  sentence: string
): StoreIntakeWizardState {
  return { ...state, sentence, sentenceEdited: true };
}

/**
 * An unfilled scaffold is a form, not a statement — sending it would record
 * "项目名称：" as something the merchant said about their store. Filtered line by
 * line, because a half-filled scaffold is the normal case: the merchant answers
 * the prompts they know and leaves the rest, and only the answered ones are
 * something they said.
 */
export function statedSentence(sentence: string) {
  return sentence
    .split('\n')
    .filter((line) => !/^[^：]*：\s*$/u.test(line))
    .join('\n')
    .trim();
}

/** Step 4 can only run once the merchant gave it something to work from. */
export function canArrange(state: StoreIntakeWizardState) {
  return (
    state.upload !== null ||
    state.uploads.length > 0 ||
    statedSentence(state.sentence).length > 0
  );
}

/** Batch parse needs at least two verified sources (contract min 2). */
export function canBatchParse(state: StoreIntakeWizardState) {
  return state.uploads.length >= 2;
}

/**
 * Core draftSupply is the only authority for fixture labeling and
 * fail-closed photo parse. FE must not invent a second env-based guess.
 */
export function draftSupplyFromExperience(
  experience: AssetIntakeExperience | null | undefined
): AssetDraftSupply | null {
  const supply = experience?.draftSupply;
  if (!supply || typeof supply.kind !== 'string') return null;
  if (supply.kind !== 'fixture' && supply.kind !== 'production') return null;
  return {
    kind: supply.kind,
    open: supply.open === true,
  };
}

/** Fixture demo stack → show the merchant-visible demo badge. */
export function shouldShowFixtureParseLabel(
  supply: AssetDraftSupply | null
): boolean {
  return supply?.kind === 'fixture' && supply.open === true;
}

/**
 * Photo parse (single + batch) may run only when Core marks supply open.
 * Closed until a complete production compiler lands (B3).
 */
export function isPhotoParseOpen(supply: AssetDraftSupply | null): boolean {
  return supply?.open === true;
}

export function parseSourceInput(input: {
  assetId: string;
  rightsConfirmed: boolean;
  target: StoreIntakeTarget;
  upload: WorkspaceAssetUpload;
}): ParseSourceAssetInput {
  return {
    assetId: input.assetId,
    contentType: input.upload.contentType,
    inputKind:
      input.target === 'visual_asset' ? 'visual_asset' : 'document_image',
    objectKey: input.upload.objectKey,
    // The rights prompt is `blocking: false` in the parse contract, so an
    // unanswered prompt travels as `unconfirmed` rather than stopping intake.
    rightsStatus: input.rightsConfirmed ? 'confirmed' : 'unconfirmed',
    sha256: input.upload.sha256,
    sizeBytes: input.upload.sizeBytes,
    sourceUrl: input.upload.sourceUrl,
    target: input.target,
  };
}

export function parseSingleAssetRequest(input: {
  assetId: string;
  rightsConfirmed: boolean;
  target: StoreIntakeTarget;
  taskId: string;
  upload: WorkspaceAssetUpload;
}) {
  return {
    action: 'parse_single_asset' as const,
    payload: {
      taskId: input.taskId,
      source: parseSourceInput(input),
    },
  };
}

/**
 * Batch command assembly for `start_parse_asset_batch`. Asset ids stay unique
 * even when two receipts share a sha256 prefix (index suffix).
 */
export function parseAssetBatchRequest(input: {
  rightsConfirmed: boolean;
  target: StoreIntakeTarget;
  taskId: string;
  uploads: WorkspaceAssetUpload[];
}) {
  return {
    action: 'start_parse_asset_batch' as const,
    payload: {
      taskId: input.taskId,
      sources: input.uploads.map((upload, index) =>
        parseSourceInput({
          assetId: `intake-asset:${upload.sha256.slice(0, 20)}-${index}`,
          rightsConfirmed: input.rightsConfirmed,
          target: input.target,
          upload,
        })
      ),
    },
  };
}

export function assetParseTaskQuery(taskId: string) {
  return {
    action: 'asset_parse_task' as const,
    payload: { taskId },
  };
}

export function assetParseTaskDraftsQuery(taskId: string) {
  return {
    action: 'asset_parse_task_drafts' as const,
    payload: { taskId },
  };
}

/* ------------------------------------------------------------------ *
 * Batch poll control (D-158: every wait state has a stop condition).
 * ------------------------------------------------------------------ */

/** Hard cap so the UI cannot poll forever if Core never reaches a terminal. */
export const BATCH_POLL_MAX_ATTEMPTS = 40;
export const BATCH_POLL_BASE_MS = 500;
export const BATCH_POLL_MAX_MS = 4_000;

export type ParseTaskTerminalStatus = Extract<
  ParseTask['status'],
  'completed' | 'completed_with_fallback' | 'failed'
>;

export function isParseTaskTerminal(
  status: ParseTask['status']
): status is ParseTaskTerminalStatus {
  return (
    status === 'completed' ||
    status === 'completed_with_fallback' ||
    status === 'failed'
  );
}

/**
 * Whether the client should keep polling. Stops on terminal Core status,
 * attempt budget, or when the caller already decided to cancel.
 */
export function shouldContinueBatchPolling(input: {
  attempt: number;
  cancelled?: boolean;
  maxAttempts?: number;
  status: ParseTask['status'] | null;
}): boolean {
  if (input.cancelled) return false;
  if (input.status !== null && isParseTaskTerminal(input.status)) return false;
  const max = input.maxAttempts ?? BATCH_POLL_MAX_ATTEMPTS;
  return input.attempt < max;
}

/** Exponential backoff capped at BATCH_POLL_MAX_MS. */
export function batchPollDelayMs(attempt: number): number {
  const exp = Math.min(Math.max(attempt, 0), 4);
  return Math.min(BATCH_POLL_BASE_MS * 2 ** exp, BATCH_POLL_MAX_MS);
}

export type BatchPollOutcome =
  | { kind: 'completed'; task: ParseTask }
  | { kind: 'failed'; task: ParseTask }
  | { kind: 'timeout'; lastStatus: ParseTask['status'] | null }
  | { kind: 'cancelled' };

/**
 * Pure decision after a progress poll: keep going, finish, fail, or time out.
 * The UI owns the sleep / fetch; this only names the next exit.
 */
export function resolveBatchPollTick(input: {
  attempt: number;
  cancelled?: boolean;
  maxAttempts?: number;
  task: ParseTask | null;
}):
  | { kind: 'continue' }
  | { kind: 'completed'; task: ParseTask }
  | { kind: 'failed'; task: ParseTask }
  | { kind: 'timeout' }
  | { kind: 'cancelled' } {
  if (input.cancelled) return { kind: 'cancelled' };
  if (input.task && isParseTaskTerminal(input.task.status)) {
    if (input.task.status === 'failed') {
      return { kind: 'failed', task: input.task };
    }
    return { kind: 'completed', task: input.task };
  }
  if (
    !shouldContinueBatchPolling({
      attempt: input.attempt,
      cancelled: input.cancelled,
      maxAttempts: input.maxAttempts,
      status: input.task?.status ?? null,
    })
  ) {
    return { kind: 'timeout' };
  }
  return { kind: 'continue' };
}

/**
 * "解析失败一键转手填同 schema" — the same verified source, re-opened as a
 * manual draft. The parse contract only accepts a source Core has already
 * verified (sha256 + sizeBytes), which is why this lane needs the upload and
 * why a sentence-only intake has no server draft at all: there would be
 * nothing to re-read.
 */
export function prepareManualDraftRequest(input: {
  assetId: string;
  draft: ProgressiveFactDraft;
  rightsConfirmed: boolean;
  sentence: string;
  target: StoreIntakeTarget;
  taskId: string;
  upload: WorkspaceAssetUpload;
}) {
  const fields = STORE_INTAKE_FIELDS.flatMap((id) => {
    const key = MANUAL_FIELD_KEYS[id];
    const value = input.draft[id].trim();
    if (!key || value.length === 0) return [];
    return [{ key, value }];
  });
  return {
    action: 'prepare_manual_asset_draft' as const,
    payload: {
      taskId: input.taskId,
      source: parseSourceInput({
        assetId: input.assetId,
        rightsConfirmed: input.rightsConfirmed,
        target: input.target,
        upload: input.upload,
      }),
      fields: [
        ...fields,
        ...(statedSentence(input.sentence)
          ? [
              {
                key: 'store.profile.summary',
                value: statedSentence(input.sentence),
              },
            ]
          : []),
      ],
      factCandidates: [],
    },
  };
}

/** Server draft → per-field prefill with the origin the server reported. */
export function draftPrefillEntries(draft: {
  fields: Array<{ key: string; provenance: string; value: unknown }>;
}) {
  return draft.fields.flatMap((field) => {
    const id = DRAFT_FIELD_FACTS[field.key];
    if (!id) return [];
    const value = draftFieldText(field.value);
    if (!value) return [];
    return [
      {
        id,
        provenance: field.provenance as ProgressiveFactProvenance,
        value,
      },
    ];
  });
}

function draftFieldText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.amount === 'number') return String(record.amount);
    if (typeof record.name === 'string') return record.name.trim();
    for (const entry of Object.values(record)) {
      if (typeof entry === 'string' && entry.trim()) return entry.trim();
    }
  }
  return '';
}

export function applyArrangedDraft(
  state: StoreIntakeWizardState,
  draft: {
    fields: Array<{ key: string; provenance: string; value: unknown }>;
    origin: AssetDraftView['origin'];
    visualClassification?: AssetDraftView['visualClassification'];
  }
): StoreIntakeWizardState {
  return {
    ...state,
    arrangeFailed: draft.origin === 'fallback',
    arrangedOrigin: draft.origin,
    // The slot is the server's four-way contract enum (`VISUAL_ASSET_SLOTS`),
    // not a category this UI invents — the merchant sees what was decided and
    // a rights prompt the contract marks `blocking: false`.
    classification: draft.visualClassification ?? null,
    draft: applyExtractedFacts(state.draft, draftPrefillEntries(draft)),
  };
}

/**
 * Merge every produced batch draft into the progressive fact draft in source
 * order. Confirmation still leaves only through finalize_store_intake.
 */
export function applyBatchDrafts(
  state: StoreIntakeWizardState,
  items: Array<{
    draft: {
      fields: Array<{ key: string; provenance: string; value: unknown }>;
      origin: AssetDraftView['origin'];
      visualClassification?: AssetDraftView['visualClassification'];
    } | null;
    sourceAssetId: string;
  }>
): StoreIntakeWizardState {
  const ready = items
    .map((item) => item.draft)
    .filter((draft): draft is NonNullable<typeof draft> => draft !== null);
  if (ready.length === 0) {
    return {
      ...state,
      arrangeFailed: true,
      arrangedOrigin: null,
      classification: null,
    };
  }
  let next = state;
  for (const draft of ready) {
    next = applyArrangedDraft(next, draft);
  }
  const allFallback = ready.every((draft) => draft.origin === 'fallback');
  return {
    ...next,
    arrangeFailed: allFallback,
  };
}

/** Nothing came back that the merchant has to re-read — say so, don't hide it. */
export function arrangementRecognizedFields(state: StoreIntakeWizardState) {
  return STORE_INTAKE_FIELDS.filter(
    (id) =>
      state.draft.provenance[id] !== undefined &&
      state.draft.provenance[id] !== 'user' &&
      state.draft.unconfirmed.includes(id)
  );
}

/* ------------------------------------------------------------------ *
 * D-151③ import candidates — confirm a staged historical value as-is.
 * ------------------------------------------------------------------ */

export interface ImportCandidateGroup {
  /** All confirmations this group must send together. */
  confirmations: Array<{ candidateId: string; factId: string }>;
  groupId: string;
  kind: 'profile' | 'project';
  label: string;
  value: string;
}

const IMPORT_PROFILE_FIELDS: Record<string, ProgressiveFactId> = {
  'store-profile:address:fulfillment': 'address',
  'store-profile:booking:fulfillment': 'booking',
  'store-profile:city:other': 'city',
  'store-profile:district:other': 'district',
  'store-profile:name:other': 'name',
};

export function importCandidateGroups(
  batch: AssetIntakeBatch | null
): ImportCandidateGroup[] {
  if (!batch) return [];
  const groups = new Map<string, ImportCandidateGroup>();
  for (const candidate of batch.candidates) {
    if (candidate.objectKind !== 'store_fact') continue;
    const factId = candidate.candidateId.replace(/:import$/u, '');
    const projectId = /^store-project:([^:]+):(service|price)$/u.exec(factId);
    if (projectId) {
      const groupId = `project:${projectId[1]}`;
      const group = groups.get(groupId) ?? {
        confirmations: [],
        groupId,
        kind: 'project' as const,
        label: '',
        value: '',
      };
      group.confirmations.push({
        candidateId: candidate.candidateId,
        factId,
      });
      const value = candidate.fact.value as Record<string, unknown> | null;
      if (projectId[2] === 'service' && typeof value?.name === 'string') {
        group.label = value.name;
      }
      if (projectId[2] === 'price' && typeof value?.amount === 'number') {
        group.value = String(value.amount);
      }
      groups.set(groupId, group);
      continue;
    }
    const field = IMPORT_PROFILE_FIELDS[factId];
    if (!field) continue;
    const value = candidate.fact.value as Record<string, unknown> | null;
    groups.set(`profile:${field}`, {
      confirmations: [{ candidateId: candidate.candidateId, factId }],
      groupId: `profile:${field}`,
      kind: 'profile',
      label: field,
      value: typeof value?.[field] === 'string' ? (value[field] as string) : '',
    });
  }
  // A project group carries whichever streams were staged. When only one was —
  // the merchant already confirmed the other through the wizard — the finalize
  // reverse-mapping accepts the upsert on the strength of the fact already in
  // the ledger, so the missing half stays reachable instead of stranded.
  return [...groups.values()];
}

/**
 * One finalize command that confirms the selected staged candidates *as they
 * were staged*. The patch echoes the stored profile, never the merchant's edit
 * buffer — an imported value is confirmed or left alone, and a correction goes
 * through the normal wizard lane as a fresh user confirmation.
 */
export function buildImportFinalizeCommand(input: {
  batch: AssetIntakeBatch;
  selectedGroupIds: string[];
  store: StoreProfile;
}): {
  action: 'finalize_store_intake';
  payload: FinalizeStoreIntakeCommand;
} | null {
  const groups = importCandidateGroups(input.batch).filter((group) =>
    input.selectedGroupIds.includes(group.groupId)
  );
  if (groups.length === 0) return null;
  const profilePatch: FinalizeStoreIntakeCommand['profilePatch'] = {
    expectedRevision: input.store.revision ?? 0,
  };
  const upsert: NonNullable<
    NonNullable<FinalizeStoreIntakeCommand['profilePatch']>['projects']
  >['upsert'] = [];
  for (const group of groups) {
    if (group.kind === 'profile') {
      const field = group.label as
        | 'name'
        | 'city'
        | 'district'
        | 'address'
        | 'booking';
      profilePatch[field] = input.store[field];
      continue;
    }
    const projectId = group.groupId.slice('project:'.length);
    const project = input.store.projects.find((item) => item.id === projectId);
    if (!project) return null;
    upsert.push(project);
  }
  if (upsert.length > 0) profilePatch.projects = { upsert };
  return {
    action: 'finalize_store_intake',
    payload: {
      batch: { batchId: input.batch.batchId },
      confirmations: groups.flatMap((group) =>
        group.confirmations.map((confirmation) => ({
          ...confirmation,
          expectedFactRevision: 0,
        }))
      ),
      profilePatch,
    },
  };
}
