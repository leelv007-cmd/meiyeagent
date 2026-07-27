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
  AssetDraftTarget,
  AssetDraftView,
  AssetIntakeBatch,
  AssetIntakeExperience,
  FinalizeStoreIntakeCommand,
  ParseSourceAssetInput,
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
  stepIndex: number;
  target: StoreIntakeTarget;
  upload: WorkspaceAssetUpload | null;
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
    stepIndex: 0,
    target: 'price_list',
    upload: null,
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

export function toggleRecommendation(
  state: StoreIntakeWizardState,
  recommendationId: string
): StoreIntakeWizardState {
  return {
    ...state,
    selectedRecommendations: state.selectedRecommendations.includes(
      recommendationId
    )
      ? state.selectedRecommendations.filter((id) => id !== recommendationId)
      : [...state.selectedRecommendations, recommendationId],
  };
}

/** Step 4 can only run once the merchant gave it something to work from. */
export function canArrange(state: StoreIntakeWizardState) {
  return state.upload !== null || state.sentence.trim().length > 0;
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
    sourceUrl: null,
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
        ...(input.sentence.trim()
          ? [{ key: 'store.profile.summary', value: input.sentence.trim() }]
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
  // A project only becomes confirmable as a unit: the finalize reverse-mapping
  // requires the service and price confirmations to travel with the upsert.
  return [...groups.values()].filter(
    (group) => group.kind === 'profile' || group.confirmations.length === 2
  );
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
