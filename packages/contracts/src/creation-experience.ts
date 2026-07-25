import type {
  ComposerContentPackagePlatform,
  ComposerDeliverableKind,
  ComposerDistributionTarget,
} from './composer-submission.js';

/**
 * Creation Experience cross-lane contract
 * (S1 / #87 skeleton → A1 / #88 aggregate → A2 / #89 seeds → A3 / #90 Brief+events).
 *
 * WT-A exclusive owner — evolve this module on ticket/90-brief-events.
 * Consumers (WT-C Composer, etc.) import types only; no second catalog truth.
 *
 * D-078 / D-098 C3: only Recipe + Surface carry publish lifecycle.
 * Lens = static enum; ToolEntry = static registry seed.
 * D-094: conditional Brief trigger projection + revision bind.
 * D-078 evidence boundary: seven event kinds, audit channel only (no dashboard).
 */

/** D-081: user-facing creation lens (创作对口), not underlying operations. */
export const creationLensIds = ['copy', 'image_text', 'video'] as const;
export type CreationLensId = (typeof creationLensIds)[number];

/** Opaque revision ids frozen at submit; WT-A owns shape evolution. */
export type RecipeRevisionId = string;
export type SurfaceRevisionId = string;
export type CreationLensRevisionId = string;

export type RecipeId = string;
export type SurfaceId = string;
export type ToolEntryId = string;
export type CatalogSessionId = string;

/** Recipe / Surface publish lifecycle (D-078, D-098 C3). */
export const catalogArtifactStatuses = [
  'draft',
  'preview',
  'published',
  'retired',
] as const;
export type CatalogArtifactStatus = (typeof catalogArtifactStatuses)[number];

export type RecipeModelPolicyMode = 'auto' | 'fixed';

export interface RecipePresentation {
  title: string;
  summary: string;
  /** Server-derived action label; ops must not free-form override semantics. */
  actionLabel?: string;
  previewAssetRef?: string;
}

export interface RecipeDeliveryDefaults {
  /** @deprecated Use contentPackagePlatform. Published recipes fail validation without it. */
  platform?: ComposerContentPackagePlatform;
  contentPackagePlatform?: ComposerContentPackagePlatform;
  distributionTarget?: ComposerDistributionTarget;
  deliverableKind?: ComposerDeliverableKind;
  quantity?: number;
  aspectRatio?: string;
  durationSeconds?: number;
}

export interface RecipeSourceRequirement {
  slot: string;
  required: boolean;
  kinds?: string[];
}

/**
 * Server-enforced source policy frozen with a Recipe revision. This is kept
 * separate from the legacy browser hint above so execution never infers
 * authorization or fallback semantics from `sourceRequirements`.
 */
export type RecipeRequiredSourceObjectType =
  | 'asset'
  | 'content_package_revision'
  | 'store_fact'
  | 'work_revision';

export type RecipeRequiredSourcePlatform =
  | 'xiaohongshu'
  | 'douyin'
  | 'video_account'
  | 'wechat_moments';

export interface RecipeRequiredSourceSlot {
  allowedObjectTypes: RecipeRequiredSourceObjectType[];
  id: string;
  maximum: number;
  minimum: number;
  platforms: RecipeRequiredSourcePlatform[];
  required: boolean;
  rights: 'authorized';
  safeFallback?: {
    code: string;
    message: string;
  };
  usage: string;
  userLabel: string;
}

export interface RecipeRequiredSourcePolicy {
  schemaVersion: 'recipe-required-source-policy/v1';
  slots: RecipeRequiredSourceSlot[];
}

export interface RecipeModelPolicy {
  mode: RecipeModelPolicyMode;
  /** Required when mode is fixed; ignored when auto. */
  catalogModelId?: string;
}

/**
 * Full independently-validatable Recipe snapshot (D-082).
 * Hidden prompts are revision refs only — never prompt bodies.
 */
export interface CreationRecipeVersion {
  recipeId: RecipeId;
  revision: number;
  revisionId: RecipeRevisionId;
  status: CatalogArtifactStatus;
  lensId: CreationLensId;
  familyId?: string;
  presentation: RecipePresentation;
  delivery: RecipeDeliveryDefaults;
  /** User-visible context patches only. */
  contextPatches: Record<string, unknown>;
  factTypes: import('./context-bundle.js').StoreFactKind[];
  sourceRequirements: RecipeSourceRequirement[];
  /** Legacy recipes may omit this and fail closed at unified submit. */
  requiredSourcePolicy?: RecipeRequiredSourcePolicy;
  modelPolicy: RecipeModelPolicy;
  settingsPatches: Record<string, unknown>;
  outputContractRef?: string;
  quotePolicyRevisionRef?: string;
  workflowRevisionRef?: string;
  /** Server prompt revision ref — never a prompt body. */
  promptRevisionRef: string;
  /** Immutable product Skill revisions selected by the compiled Recipe. */
  skillRevisionRefs?: string[];
  targetWorkspaceKind: CreationLensId;
  contentHash: string;
  actorId: string;
  reason: string;
  correlationId: string;
  rolledBackToRevision: number | null;
  createdAt: string;
  publishedAt?: string;
}

/**
 * Browser-facing Recipe DTO.
 * Allowlisted fields only; prompts appear solely as revision refs.
 */
export interface BrowserRecipeProjection {
  recipeId: RecipeId;
  revision: number;
  revisionId: RecipeRevisionId;
  status: CatalogArtifactStatus;
  lensId: CreationLensId;
  familyId?: string;
  presentation: RecipePresentation;
  delivery: RecipeDeliveryDefaults;
  contextPatches: Record<string, unknown>;
  /** Legacy browser projections may omit this; formal server Recipes always emit it. */
  factTypes?: import('./context-bundle.js').StoreFactKind[];
  sourceRequirements: RecipeSourceRequirement[];
  requiredSourcePolicy?: RecipeRequiredSourcePolicy;
  modelPolicy: RecipeModelPolicy;
  settingsPatches: Record<string, unknown>;
  outputContractRef?: string;
  quotePolicyRevisionRef?: string;
  workflowRevisionRef?: string;
  promptRevisionRef: string;
  skillRevisionRefs?: string[];
  targetWorkspaceKind: CreationLensId;
  contentHash: string;
}

/** Surface → published recipe revision ref with orchestration flags. */
export interface SurfaceRecipeRef {
  recipeRevisionId: RecipeRevisionId;
  lensId: CreationLensId;
  order: number;
  featured: boolean;
  visible: boolean;
}

/** Surface → static tool entry ref (no tool publish lifecycle). */
export interface SurfaceToolRef {
  toolEntryId: ToolEntryId;
  order: number;
  visible: boolean;
}

/**
 * Pure orchestration Surface revision (D-078).
 * References only — no copied prompt / model / quote / route fields.
 */
export interface CreationSurfaceRevision {
  surfaceId: SurfaceId;
  revision: number;
  revisionId: SurfaceRevisionId;
  status: CatalogArtifactStatus;
  recipeRefs: SurfaceRecipeRef[];
  toolEntryRefs: SurfaceToolRef[];
  contentHash: string;
  actorId: string;
  reason: string;
  correlationId: string;
  rolledBackToRevision: number | null;
  createdAt: string;
  publishedAt?: string;
}

/** Browser-facing Surface DTO with nested recipe projections. */
export interface BrowserSurfaceProjection {
  surfaceId: SurfaceId;
  revision: number;
  revisionId: SurfaceRevisionId;
  status: CatalogArtifactStatus;
  recipeRefs: SurfaceRecipeRef[];
  toolEntryRefs: SurfaceToolRef[];
  contentHash: string;
  recipes: BrowserRecipeProjection[];
}

/** Static tool registry seed entry (D-098 C3 — no publish lifecycle). */
export type CreativeToolKind = 'composer_recipe' | 'standalone_tool';
export type CreativeToolContainer = 'dialog' | 'route' | 'workspace';

export interface CreativeToolEntry {
  id: ToolEntryId;
  label: string;
  summary: string;
  kind: CreativeToolKind;
  container?: CreativeToolContainer;
  order: number;
}

/** Static lens seed (enum projection; no publish lifecycle). */
export interface CreationLensSeed {
  id: CreationLensId;
  label: string;
}

/**
 * Composer session freeze snapshot (D-078).
 * New published revisions only affect NEW sessions.
 */
export interface CatalogSessionFreeze {
  sessionId: CatalogSessionId;
  workspaceId: string;
  surfaceRevisionId: SurfaceRevisionId;
  frozenAt: string;
  surface: BrowserSurfaceProjection;
}

/** Field-level patch action for Recipe apply preview (D-083). */
export type RecipePatchAction = 'preserve' | 'stash' | 'change';

/**
 * Conflict class for Recipe apply (D-083).
 * - none: cold or same-lens with no protected dirty fields → passthrough
 * - same_lens_dirty: same lens, user-owned model/params/template/quote would be overwritten
 * - cross_lens: user already selected a different lens
 */
export const recipePatchConflictKinds = [
  'none',
  'same_lens_dirty',
  'cross_lens',
] as const;
export type RecipePatchConflictKind = (typeof recipePatchConflictKinds)[number];

/** Single field-level diff entry in a RecipePatchPreview. */
export interface RecipePatchFieldDiff {
  field: string;
  action: RecipePatchAction;
  from?: unknown;
  to?: unknown;
}

/**
 * Server-authored preview before applying a Recipe onto a draft (D-083).
 * Preserve / stash / change are derived from actual diffs — never fixed copy.
 * Base revision ids freeze the apply target so later publishes do not move it.
 */
export interface RecipePatchPreview {
  recipeRevisionId: RecipeRevisionId;
  /** Target recipe lens after apply. */
  lensId: CreationLensId;
  /** Draft lens before apply; null when cold / unselected. */
  currentLensId: CreationLensId | null;
  /** Session / surface revision frozen at preview time (optional). */
  surfaceRevisionId?: SurfaceRevisionId;
  /** Alias for surface freeze — same revision the session holds. */
  baseSurfaceRevisionId?: SurfaceRevisionId;
  /** Recipe currently applied on the draft, if any. */
  baseRecipeRevisionId?: RecipeRevisionId | null;
  conflictKind: RecipePatchConflictKind;
  /** True when the client must show the conflict panel before apply. */
  requiresConfirmation: boolean;
  /** Field-level diffs with preserve | stash | change actions. */
  conflicts: RecipePatchFieldDiff[];
  /** Fields kept as-is (user text, sources, uploads). */
  preserve: string[];
  /** Fields stashed for undo after apply. */
  stash: string[];
  /** Fields that will change on confirm / apply. */
  change: string[];
  /**
   * Primary CTA when requiresConfirmation.
   * same_lens_dirty →「套用并更新设置」
   * cross_lens →「切换到{对口}并套用」
   * none → null
   */
  primaryCtaLabel: string | null;
  /** Cancel CTA when confirmation is required; null on passthrough. */
  cancelCtaLabel: string | null;
}

/**
 * Composer draft fields considered by RecipePatchPreview (D-083).
 * User text / sources / uploads are always preserve; only dirty settings
 * and cross-lens switches create confirmation conflicts.
 */
export interface RecipeDraftFields {
  /** Free-form user text — always preserve. */
  userText?: string | null;
  /** Selected sources / uploads — always preserve. */
  sources?: unknown[] | null;
  /** Current lens; null/undefined = cold (no selection). */
  lensId?: CreationLensId | null;
  /** Currently applied recipe revision id, if any. */
  recipeRevisionId?: RecipeRevisionId | null;
  /** Frozen surface revision for the open session. */
  surfaceRevisionId?: SurfaceRevisionId | null;
  /** Current delivery defaults on the draft (for actual-diff change list). */
  delivery?: RecipeDeliveryDefaults | null;
  /** Current model policy on the draft. */
  modelPolicy?: RecipeModelPolicy | null;
  /**
   * User-touched settings keys (model / params / template / quote, etc.).
   * Presence of a key marks that field as dirty for same-lens conflict.
   */
  dirtySettings?: Record<string, unknown> | null;
  /** Full settings bag used for from/to diffs (may include non-dirty defaults). */
  settings?: Record<string, unknown> | null;
  /** Confirmed quote snapshot ref — overwriting requires confirmation. */
  confirmedQuoteRef?: string | null;
}

// ---------------------------------------------------------------------------
// Conditional Brief trigger projection (A3 / #90, D-094)
// ---------------------------------------------------------------------------

/**
 * Seven Brief trigger conditions — code-level safety policy.
 * Ops config CANNOT disable any of these (D-094).
 */
export const briefTriggerConditionCodes = [
  'any_video',
  'multi_deliverable_or_cross_platform',
  'images_over_four',
  'restricted_assets',
  'high_risk_fact_missing_or_conflict',
  'quote_policy_threshold',
  'confirmation_invalid',
] as const;
export type BriefTriggerConditionCode =
  (typeof briefTriggerConditionCodes)[number];

/** Image count threshold: more than this many images fires the Brief. */
export const BRIEF_IMAGE_COUNT_THRESHOLD = 4 as const;

/**
 * Revisions sealed at Brief confirm.
 * Any drift on draft / recipe / model / quote / source re-triggers Brief.
 */
export interface BriefBoundRevisions {
  draftRevisionId: string;
  recipeRevisionId?: RecipeRevisionId | null;
  modelRevisionId?: string | null;
  quoteRevisionId?: string | null;
  sourceRevisionId?: string | null;
  surfaceRevisionId?: SurfaceRevisionId | null;
  lensId?: CreationLensId | null;
}

/** Source / asset signal used by restricted-asset and evidence projection. */
export interface BriefSourceSignal {
  id: string;
  kind?: string;
  /**
   * Restricted categories include customer_case, before_after, review,
   * testimonial, and any explicit restricted flag / containsPerson.
   */
  category?: string | null;
  containsPerson?: boolean;
  /** Explicit restriction marker from rights pipeline. */
  restricted?: boolean;
  rightsStatus?: string;
}

/** High-risk fact kinds that may force Brief when missing or conflicting. */
export const highRiskFactKinds = [
  'price',
  'term',
  'effect',
  'qualification',
] as const;
export type HighRiskFactKind = (typeof highRiskFactKinds)[number];

export type BriefFactProvenance =
  | 'system_suggested'
  | 'source_extracted'
  | 'user_entered';

export interface BriefHighRiskFactSignal {
  kind: HighRiskFactKind;
  status: 'present' | 'missing' | 'conflict';
  /** Provenance — only system_suggested / source_extracted feed evidence drawer. */
  provenance?: BriefFactProvenance | null;
  /** True when this fact actually participates in the current draft. */
  participatesInDraft?: boolean;
  sourceName?: string;
  sourceType?: string;
  /** Where the fact is applied in the draft (merchant-visible location). */
  appliedLocation?: string;
  updatedAt?: string;
  freshness?: string;
  rightsStatus?: string;
  factSummary?: string;
}

/** Quote signal vs QuotePolicy extra-confirm threshold. */
export interface BriefQuoteSignal {
  catalogModelId?: string;
  quoteRevisionId: string;
  amount: number;
  /**
   * Extra confirmation threshold from QuotePolicy.
   * Fires when amount >= extraConfirmThreshold.
   */
  extraConfirmThreshold: number;
  quotePolicyRevision: string;
}

/**
 * Server input for Brief trigger projection.
 * Pure signal bag — no hidden prompts, no user body text.
 */
export interface BriefTriggerInput {
  /** Server-owned revision context key created by brief_context_sync. */
  briefContextId?: string;
  /** Durable server confirmation key used for revalidation. */
  confirmationId?: string;
  lensId?: CreationLensId | null;
  /** Deliverable kind (video_* also fires any_video). */
  deliverableKind?: string | null;
  /** Distinct deliverable count (>1 = multi-deliverable). */
  deliverableCount?: number;
  /** Target platforms (length > 1 = cross-platform). */
  platforms?: string[];
  /**
   * Planned / attached image count.
   * Fires when strictly greater than BRIEF_IMAGE_COUNT_THRESHOLD (4).
   */
  imageCount?: number;
  sources?: BriefSourceSignal[];
  highRiskFacts?: BriefHighRiskFactSignal[];
  quote?: BriefQuoteSignal | null;
  /** Previously confirmed bound revisions, if any. */
  confirmedRevisions?: BriefBoundRevisions | null;
  /** Live revisions to bind / compare (required for bind + invalidation). */
  currentRevisions: BriefBoundRevisions;
  /**
   * Ops attempt to disable triggers — IGNORED.
   * Present so contract tests prove code-level safety cannot be overridden.
   */
  opsDisabledTriggers?: BriefTriggerConditionCode[] | null;
  /** Optional merchant-facing summary fragments (no body text). */
  summaryHints?: BriefSummaryFields | null;
}

export interface BriefTriggerHit {
  code: BriefTriggerConditionCode;
  /** Merchant-language reason; no provider / prompt internals. */
  reason: string;
}

/** Evidence drawer entry — only when real system/source facts participate. */
export interface BriefEvidenceEntry {
  sourceName: string;
  sourceType: string;
  factKind: string;
  factSummary?: string;
  appliedLocation?: string;
  updatedAt?: string;
  freshness?: string;
  rightsStatus?: string;
  uncertaintyOrConflict?: string;
  pendingConfirmation?: boolean;
}

/** Compact Brief summary — does not re-ask Composer fields. */
export interface BriefSummaryFields {
  targetDeliverable?: string | null;
  platforms?: string[];
  sourceRightsSummary?: string | null;
  keyFacts?: string[];
  modelAndSettings?: string | null;
  impactScope?: string | null;
  estimatedCost?: string | null;
  estimatedDuration?: string | null;
  pendingItems?: string[];
}

/**
 * Server Brief trigger projection (D-094).
 * requiresBrief is false for simple copy/single-image with complete facts
 * and either no prior confirm or still-valid confirmation.
 */
export interface BriefTriggerProjection {
  requiresBrief: boolean;
  triggers: BriefTriggerHit[];
  /** Revisions that will be sealed on confirm (current snapshot). */
  bindRevisions: BriefBoundRevisions;
  /** Prior confirmation drifted — must re-confirm. */
  confirmationInvalid: boolean;
  /** Prior confirmation still matches current revisions. */
  confirmationValid: boolean;
  /**
   * Evidence drawer data. Empty unless system-suggested or source-extracted
   * facts actually participate in the draft. Never decorative.
   */
  evidenceDrawer: BriefEvidenceEntry[];
  summary: BriefSummaryFields;
}

/** Result of confirming a conditional Brief — seals exact revisions. */
export interface BriefConfirmation {
  confirmedAt: string;
  boundRevisions: BriefBoundRevisions;
  triggerCodes: BriefTriggerConditionCode[];
}

// ---------------------------------------------------------------------------
// Creation experience event revisions (A3 / #90, D-078 evidence boundary)
// ---------------------------------------------------------------------------

/** Creation experience analytics / audit event kinds (D-078 evidence boundary). */
export const creationExperienceEventKinds = [
  'exposure',
  'select',
  'apply',
  'start',
  'complete',
  'correct',
  'cancel',
] as const;
export type CreationExperienceEventKind =
  (typeof creationExperienceEventKinds)[number];

/** Lightweight ref carried on other projections. */
export interface CreationExperienceEventRef {
  kind: CreationExperienceEventKind;
  lensId?: CreationLensId;
  surfaceRevisionId?: SurfaceRevisionId;
  recipeRevisionId?: RecipeRevisionId;
  actionId?: string;
}

/**
 * Append-only audit event record (no dashboard aggregation).
 * Carries surface / recipe / action / lens revision only.
 * MUST NOT contain hidden prompts or user-sensitive body text.
 */
export interface CreationExperienceEvent {
  eventId: string;
  kind: CreationExperienceEventKind;
  recordedAt: string;
  sessionId?: string;
  correlationId?: string;
  actorId?: string;
  lensId?: CreationLensId;
  lensRevisionId?: CreationLensRevisionId;
  surfaceRevisionId?: SurfaceRevisionId;
  recipeRevisionId?: RecipeRevisionId;
  actionId?: string;
  actionRevisionId?: string;
  /**
   * Allowlisted scalar meta only.
   * Forbidden keys (prompt/userText/body/…) are stripped at write time.
   */
  meta?: Record<string, string | number | boolean | null>;
}

/** Shared validation result for draft → preview → publish gates. */
export interface CatalogValidationResult {
  ok: boolean;
  errors: string[];
}
