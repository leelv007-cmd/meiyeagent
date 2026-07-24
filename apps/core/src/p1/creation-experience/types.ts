/**
 * Creation Experience Catalog domain types (A1 / #88).
 *
 * Cross-lane shapes live in @meiye/contracts; this module adds
 * server-only draft inputs and audit metadata.
 */

export type {
  BriefBoundRevisions,
  BriefConfirmation,
  BriefEvidenceEntry,
  BriefFactProvenance,
  BriefHighRiskFactSignal,
  BriefQuoteSignal,
  BriefSourceSignal,
  BriefSummaryFields,
  BriefTriggerConditionCode,
  BriefTriggerHit,
  BriefTriggerInput,
  BriefTriggerProjection,
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  CatalogArtifactStatus,
  CatalogSessionFreeze,
  CatalogSessionId,
  CatalogValidationResult,
  CreationExperienceEvent,
  CreationExperienceEventKind,
  CreationExperienceEventRef,
  CreationLensId,
  CreationLensRevisionId,
  CreationLensSeed,
  CreationRecipeVersion,
  CreationSurfaceRevision,
  CreativeToolContainer,
  CreativeToolEntry,
  CreativeToolKind,
  HighRiskFactKind,
  RecipeDeliveryDefaults,
  RecipeDraftFields,
  RecipeId,
  RecipeModelPolicy,
  RecipePatchAction,
  RecipePatchConflictKind,
  RecipePatchFieldDiff,
  RecipePatchPreview,
  RecipePresentation,
  RecipeRevisionId,
  RecipeSourceRequirement,
  StoreFactKind,
  SurfaceId,
  SurfaceRecipeRef,
  SurfaceRevisionId,
  SurfaceToolRef,
  ToolEntryId,
} from '@meiye/contracts';

import type {
  CreationLensId,
  RecipeDeliveryDefaults,
  RecipeId,
  RecipeModelPolicy,
  RecipePresentation,
  RecipeRevisionId,
  RecipeSourceRequirement,
  StoreFactKind,
  SurfaceId,
  SurfaceRecipeRef,
  SurfaceRevisionId,
  SurfaceToolRef,
  ToolEntryId,
} from '@meiye/contracts';

/** Actor / reason / correlation carried on every mutating catalog write. */
export interface CatalogAuditMeta {
  actorId: string;
  reason: string;
  correlationId: string;
}

/** CAS head expectation — null means "no revision exists yet". */
export interface CatalogCasMeta extends CatalogAuditMeta {
  expectedRevision: number | null;
}

/**
 * Mutable recipe body (excludes revision / status / audit / hash).
 * Hidden prompts are refs only — never bodies.
 */
export interface RecipeBodyInput {
  lensId: CreationLensId;
  familyId?: string;
  presentation: RecipePresentation;
  delivery?: RecipeDeliveryDefaults;
  contextPatches?: Record<string, unknown>;
  factTypes?: StoreFactKind[];
  sourceRequirements?: RecipeSourceRequirement[];
  modelPolicy: RecipeModelPolicy;
  settingsPatches?: Record<string, unknown>;
  outputContractRef?: string;
  quotePolicyRevisionRef?: string;
  workflowRevisionRef?: string;
  promptRevisionRef: string;
  targetWorkspaceKind: CreationLensId;
  /**
   * Server-only test/debug hook. NEVER projected to browser.
   * Production drafts must leave this undefined.
   */
  hiddenPromptBody?: string;
}

export interface DraftRecipeInput extends CatalogCasMeta {
  recipeId: RecipeId;
  body: RecipeBodyInput;
}

export interface RecipeTransitionInput extends CatalogCasMeta {
  recipeId: RecipeId;
}

export interface RollbackRecipeInput extends CatalogCasMeta {
  recipeId: RecipeId;
  targetRevision: number;
  /** expectedRevision is required (non-null) for rollback CAS. */
  expectedRevision: number;
}

export interface SurfaceBodyInput {
  recipeRefs: SurfaceRecipeRef[];
  toolEntryRefs?: SurfaceToolRef[];
}

export interface DraftSurfaceInput extends CatalogCasMeta {
  surfaceId: SurfaceId;
  body: SurfaceBodyInput;
}

export interface SurfaceTransitionInput extends CatalogCasMeta {
  surfaceId: SurfaceId;
}

export interface RollbackSurfaceInput extends CatalogCasMeta {
  surfaceId: SurfaceId;
  targetRevision: number;
  expectedRevision: number;
}

export interface FreezeSessionInput {
  workspaceId: string;
  surfaceRevisionId: SurfaceRevisionId;
  sessionId?: string;
}

/**
 * Server-held recipe record may retain a non-projected hidden prompt body
 * for migration/debug — browser projection strips it unconditionally.
 */
export interface ServerRecipeRecord {
  recipeId: RecipeId;
  revision: number;
  revisionId: RecipeRevisionId;
  status: import('@meiye/contracts').CatalogArtifactStatus;
  lensId: CreationLensId;
  familyId?: string;
  presentation: RecipePresentation;
  delivery: RecipeDeliveryDefaults;
  contextPatches: Record<string, unknown>;
  factTypes: StoreFactKind[];
  sourceRequirements: RecipeSourceRequirement[];
  modelPolicy: RecipeModelPolicy;
  settingsPatches: Record<string, unknown>;
  outputContractRef?: string;
  quotePolicyRevisionRef?: string;
  workflowRevisionRef?: string;
  promptRevisionRef: string;
  targetWorkspaceKind: CreationLensId;
  contentHash: string;
  actorId: string;
  reason: string;
  correlationId: string;
  rolledBackToRevision: number | null;
  createdAt: string;
  publishedAt?: string;
  /** Server-only — never serialized to browser projection. */
  hiddenPromptBody?: string;
}

export interface ServerSurfaceRecord {
  surfaceId: SurfaceId;
  revision: number;
  revisionId: SurfaceRevisionId;
  status: import('@meiye/contracts').CatalogArtifactStatus;
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

export function recipeRevisionId(
  recipeId: RecipeId,
  revision: number,
): RecipeRevisionId {
  return `${recipeId}@${revision}`;
}

export function surfaceRevisionId(
  surfaceId: SurfaceId,
  revision: number,
): SurfaceRevisionId {
  return `${surfaceId}@${revision}`;
}

export function parseRecipeRevisionId(
  revisionId: RecipeRevisionId,
): { recipeId: RecipeId; revision: number } | null {
  const at = revisionId.lastIndexOf('@');
  if (at <= 0) return null;
  const recipeId = revisionId.slice(0, at);
  const revision = Number(revisionId.slice(at + 1));
  if (!recipeId || !Number.isInteger(revision) || revision < 1) return null;
  return { recipeId, revision };
}

export function isKnownToolEntryId(
  toolEntryId: ToolEntryId,
  known: ReadonlySet<string>,
): boolean {
  return known.has(toolEntryId);
}
