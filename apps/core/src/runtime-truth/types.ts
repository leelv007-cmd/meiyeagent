/**
 * Runtime truth surfaces for #143 / P0-D2:
 * - live: process lifecycle only
 * - ready: environment can deliver traffic
 * - capabilities: merchant three-state only
 * - release identity/manifest: commit + digest + config revision
 */

/** Merchant-facing capability states only. Never expose internal evidence layers. */
export type MerchantCapabilityState =
  | 'verified'
  | 'assisted'
  | 'unavailable';

/**
 * Merchant-safe channel posture. Never invent multi-channel without ≥2 domains.
 * `none` means no verified channel posture to advertise.
 */
export type MerchantChannelMode =
  | 'single_channel'
  | 'multi_channel'
  | 'none';

/**
 * Internal evidence layers kept separate from merchant projection.
 * These must never appear on `/capabilities`.
 */
export type InternalCapabilityEvidence =
  | 'implemented'
  | 'recorded_verified'
  | 'live_verified'
  | 'merchant_validated';

export type ReadinessCheckStatus = 'pass' | 'fail' | 'skip';

export type ReadinessCheckName =
  | 'postgresql'
  | 'dbos'
  | 'schema'
  | 'objectStorage'
  | 'workerFreshness'
  | 'providerMode'
  | 'providerLive'
  | 'outbox'
  | 'canvas';

export interface ReadinessCheckResult {
  detail?: string;
  name: ReadinessCheckName;
  status: ReadinessCheckStatus;
}

export interface ReleaseIdentity {
  artifactDigest?: string;
  commitSha: string;
  configRevision?: string;
}

export interface ReleaseUnitIdentity extends ReleaseIdentity {
  unit: 'web' | 'core' | 'worker' | 'canvas';
}

export interface ReleaseManifest {
  capturedAt: string;
  units: ReleaseUnitIdentity[];
}

/** Redacted staging evidence required before P0 may be called a release candidate. */
export interface P0ReleaseCandidateManifest extends ReleaseManifest {
  completedAt: string;
  environment: 'staging';
  expiresAt: string;
  releaseRef: string;
  result: 'pass';
  schemaVersion: 1;
  startedAt: string;
  verification: {
    journeyEvidenceRefs: {
      copy: string;
      image: string;
      video: string;
    };
    readinessEvidenceRef: string;
    recoveryEvidenceRef: string;
  };
  workflowRun: string;
}

export interface LiveStatus {
  role?: 'api' | 'worker';
  service: 'meiye-core';
  status: 'live';
}

export interface ReadyStatus {
  checks: ReadinessCheckResult[];
  ready: boolean;
  release?: ReleaseIdentity;
  service: 'meiye-core';
  status: 'ready' | 'not_ready';
}

export interface MerchantCapability {
  id: string;
  /**
   * Merchant-safe channel label when a verified posture exists
   * (e.g. `single-channel/no-fallback`). Never internal evidence vocabulary.
   */
  channelLabel?: string;
  channelMode?: MerchantChannelMode;
  safeExplanation: string;
  state: MerchantCapabilityState;
}

export interface MerchantCapabilitiesSnapshot {
  capabilities: MerchantCapability[];
  /** Explicit policy marker so clients never confuse internal evidence. */
  evidencePolicy: 'merchant_three_state_only';
  release?: ReleaseIdentity;
}

export interface InternalCapabilityRecord {
  id: string;
  /** Optional assisted path that remains usable without live verification. */
  assistedPathAvailable?: boolean;
  /**
   * Merchant-safe channel label carried through projection.
   * Must not contain internal evidence tokens (live_verified, etc.).
   */
  channelLabel?: string;
  channelMode?: MerchantChannelMode;
  evidence: InternalCapabilityEvidence[];
  /** Optional human-readable purpose used only to craft safe explanations. */
  purpose?: string;
}

export interface RuntimeTruthPort {
  evaluateReadiness(): Promise<ReadyStatus>;
  listMerchantCapabilities(): Promise<MerchantCapabilitiesSnapshot>;
  releaseIdentity(): ReleaseIdentity | undefined;
}
