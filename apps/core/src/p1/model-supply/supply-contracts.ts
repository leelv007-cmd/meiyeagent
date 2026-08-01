/**
 * S2a behavior-preserving extract: supply entity contracts from model-supply/index.ts.
 * No behavior changes. Video workflow segment remains in index.ts (#102).
 */
import type {
  AdvancedCanvasEditingContext,
  ImageIntent,
  ModelCapabilityProfile,
  SupplierPricingTier,
  VideoCompositionEvidence,
} from '@meiye/contracts';

export const MODEL_MODALITIES = ['llm', 'image', 'video', 'audio'] as const;
export type ModelModality = (typeof MODEL_MODALITIES)[number];
export const MODEL_OPERATIONS = [
  'copy.generate',
  'copy.adapt',
  'text.respond',
  'image.generate',
  'image.edit',
  'video.generate',
  'audio.speech',
  'audio.sfx',
] as const;
export type ModelOperation = (typeof MODEL_OPERATIONS)[number];
export const CREDIT_PRICING_OPERATIONS = [
  'copy.generate',
  'copy.adapt',
  'image.generate',
  'image.edit',
  'image.reference_transform',
  'video.generate',
  'audio.speech',
  'audio.sfx',
] as const;
export type CreditPricingOperation = (typeof CREDIT_PRICING_OPERATIONS)[number];
export type VideoCreditDuration = 15 | 30 | 60;

/** Merchant-facing pricing, governed with the CatalogModel revision. */
export interface CreditPricingEntry {
  creditCost: number;
  failureRefundsCredits: boolean;
  /** Required only for video.generate; price each supported duration explicitly. */
  videoCreditCosts?: Partial<Record<VideoCreditDuration, number>>;
}

export type CreditPricing = Partial<
  Record<CreditPricingOperation, CreditPricingEntry>
>;
export type DataClass = 'contains_face' | 'pii' | 'medical';
export const CANVAS_GENERATION_PARAMETER_NAMES = [
  'width',
  'height',
  'durationSeconds',
  'ratio',
  'resolution',
  'generateAudio',
  'watermark',
  'maxOutputTokens',
  'temperature',
  'strength',
  'format',
  'language',
  'maxDurationSeconds',
  'speed',
  'tone',
  'voice',
] as const;
export type CanvasGenerationParameterName =
  (typeof CANVAS_GENERATION_PARAMETER_NAMES)[number];
export const CANVAS_GENERATION_INPUT_ASSET_ROLES = [
  'reference_image',
  'reference_video',
  'reference_audio',
  'mask',
] as const;
export type CanvasGenerationInputAssetRole =
  (typeof CANVAS_GENERATION_INPUT_ASSET_ROLES)[number];
export interface CanvasGenerationInputAsset {
  assetId: string;
  role: CanvasGenerationInputAssetRole;
  /**
   * ImageIntent semantics frozen by the selected ImageModelRecipeProfile.
   * Non-image callers omit both fields.
   */
  imageSlot?: ImageIntent['references'][number]['slot'];
  nativeField?: string;
}
export interface CanvasGenerationInputNodeBinding
  extends CanvasGenerationInputAsset {
  nodeId: string;
}
export type AdvancedCanvasGenerationOrigin = AdvancedCanvasEditingContext & {
	/** Present only on historical Canvas-local dispatches. */
	localJobId?: string;
};

/**
 * Product-Core lineage for Canvas executions. It is deliberately separate
 * from EditingContext so older Canvas records remain readable while all new
 * quote/submit paths retain the immutable generation checkpoint and item.
 */
export interface AdvancedCanvasGenerationOriginRef {
	checkpointId: string;
	count: number;
	itemId?: string;
	modelId: string;
	nodeId?: string;
	parameters: Record<string, unknown>;
	prompt: string;
	projectId: string;
	revisionId: string;
	type: 'advanced_canvas_project_revision';
}
export interface CanvasGenerationCapability {
  operation: ModelOperation;
  parameters: CanvasGenerationParameterName[];
  inputAssetRoles: CanvasGenerationInputAssetRole[];
}
export type DeploymentStatus = 'active' | 'inactive' | 'retired';
export type Acceptance =
  | 'rejected_before_accept'
  | 'accepted'
  | 'acceptance_unknown';

export const QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE = 20;

export interface CatalogModel {
  id: string;
  modality: ModelModality;
  operations: ModelOperation[];
  displayName: string;
  qualityRank: number;
  /** Models marked manual_only are eligible only for an explicit fixed selection. */
  selectionPolicy?: 'automatic' | 'manual_only';
  /** Frontend-safe business metadata. Legacy fixtures may omit these fields. */
  manufacturer?: string;
  stableModelName?: string;
  version?: string;
  capabilities?: ModelOperation[];
  /** Product-side credits; supplier costs remain on ModelDeployment.unitPrice. */
  creditPricing?: CreditPricing;
}

export interface ModelDeployment {
  id: string;
  catalogModelId: string;
  providerProfileId?: string;
  executionChannelId?: string;
  /** Stable upstream account identity; credential aliases must share it. */
  accountIdentity?: string;
  /** Stable endpoint/fault-domain identity; endpoint aliases must share it. */
  endpointFingerprint?: string;
  providerModel?: string;
  endpointRevision?: string;
  apiCounterparty?: string;
  credentialOwner?: 'platform' | 'workspace_byok' | 'provider_managed';
  credentialAccountId?: string;
  lifecycleRevision?: string;
  apiFamily:
    | 'openai'
    | 'anthropic'
    | 'gemini'
    | 'custom'
    | 'image'
    | 'media'
    | 'audio';
  channel: 'direct' | 'managed' | 'bifrost' | 'litellm';
  region: 'domestic' | 'overseas';
  status: DeploymentStatus;
  allowedDataClasses?: Array<'public' | DataClass>;
  policyRevision?: string;
  priceRevision?: string;
  pricingTier?: SupplierPricingTier;
  credentialMode?: 'platform' | 'byok_strict';
  credentialVersion?: string;
  unitPrice?: {
    amountMicros: number;
    currency: 'CNY' | 'USD';
    unit: string;
  };
  canvasGenerationCapabilities?: CanvasGenerationCapability[];
  activationEvidence?: {
    status: 'documented' | 'recorded' | 'live_verified';
    verifiedAt?: string;
    evidenceRef?: string;
    configurationRevision?: string;
  };
  /** Versioned request-time capability claims for D-165 hot assembly. */
  capabilityProfile?: ModelCapabilityProfile;
}

export type RuntimeDeploymentCapability = Pick<
  ModelDeployment,
  | 'id'
  | 'catalogModelId'
  | 'apiFamily'
  | 'channel'
  | 'region'
  | 'executionChannelId'
  | 'providerModel'
  | 'endpointRevision'
  | 'lifecycleRevision'
  | 'credentialAccountId'
  | 'credentialVersion'
  | 'capabilityProfile'
>;

export const AUDIO_ASSET_FORMATS = [
  { codec: 'mp3', container: 'mp3', contentType: 'audio/mpeg' },
  { codec: 'pcm_s16le', container: 'wav', contentType: 'audio/wav' },
  { codec: 'opus', container: 'ogg', contentType: 'audio/ogg' },
  { codec: 'aac', container: 'mp4', contentType: 'audio/mp4' },
] as const;
export const OWNED_ASSET_CONTENT_TYPES = [
  'application/zip',
  'image/png',
  'video/mp4',
  ...AUDIO_ASSET_FORMATS.map(({ contentType }) => contentType),
] as const;

export interface OwnedAsset {
  id: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  contentType: (typeof OWNED_ASSET_CONTENT_TYPES)[number];
  storageRevision?: string;
  sourceTaskRef?: string;
  sourceTtlEvidence?: {
    providerTaskRef: string;
    expiresAt: string;
    recordedAt: string;
  };
  compositionEvidence?: VideoCompositionEvidence;
  technicalValidation?: {
    playable: boolean;
    codec: 'h264';
    durationSeconds: number;
    width?: number;
    height?: number;
    hashVerified?: boolean;
    evidenceKind?: 'measured' | 'recorded_synthetic';
  };
}

export type CustodyOwnedAssetContentType =
  | OwnedAsset['contentType']
  | 'image/jpeg'
  | 'image/webp'
  | 'video/webm';

export type PersistedCustodyOwnedAsset = Omit<OwnedAsset, 'contentType'> & {
  contentType: CustodyOwnedAssetContentType;
};
