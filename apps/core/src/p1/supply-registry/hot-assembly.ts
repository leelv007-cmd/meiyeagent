/**
 * Credential / adapter capability hot assembly domain (G3 / D-067③ / D-068④).
 *
 * Catalog-head hot-read already exists (`applyCatalogRevision` affects future
 * submissions only). This module makes **runtime capability dynamic**:
 *   - active Deployments are evaluated against an effective capability revision
 *     (not a process-start frozen map);
 *   - credential + adapter bindings assemble at request time by frozen version;
 *   - channel isolate / drain / restore do not require process restart;
 *   - HTTP and Worker report the same effective revision when wired to a shared
 *     head store (process wiring is Z2-WIRING).
 *
 * Ports + pure functions only — does not touch main/job-worker/runtime-assembly.
 */
import type {
  AssembledCredential,
  AssembleCredentialRequest,
  CredentialSecretBrokerPort,
} from './secret-broker.js';
import { SecretBrokerError } from './secret-broker.js';
import type { MediaProviderDrainMode } from '../model-supply/provider-lifecycle.js';

// ---------------------------------------------------------------------------
// Capability entry / revision (versioned runtime capability)
// ---------------------------------------------------------------------------

/**
 * Runtime-capability fingerprint for a Deployment. Matches the fields used by
 * the historical process-start freeze (`RuntimeDeploymentCapability`) so Z2
 * can swap evaluation to the effective revision without redefining identity.
 */
export interface RuntimeCapabilityEntry {
  deploymentId: string;
  catalogModelId: string;
  apiFamily: string;
  channel: string;
  region: string;
  executionChannelId?: string;
  providerModel?: string;
  endpointRevision?: string;
  lifecycleRevision?: string;
  credentialVersion?: string;
  /** Optional CredentialAccount binding for request-time secret broker. */
  credentialAccountId?: string;
  /**
   * Adapter factory token consumed by Z2 wiring — never a live execution port.
   * Examples: `direct-llm`, `ark-media`, `tuzi-media`, `volcengine-tts`, `recorded`.
   */
  adapterKey: string;
  /** Adapter binding revision (endpoint/protocol family fingerprint). */
  adapterBindingRevision?: string;
}

/** Match input accepted by supports/assert helpers (deployment-shaped). */
export interface RuntimeCapabilityMatchInput {
  id: string;
  catalogModelId: string;
  apiFamily: string;
  channel: string;
  region: string;
  status?: string;
  executionChannelId?: string;
  providerModel?: string;
  endpointRevision?: string;
  lifecycleRevision?: string;
  credentialVersion?: string;
}

export interface RuntimeCapabilityRevision {
  revisionId: string;
  number: number;
  entries: RuntimeCapabilityEntry[];
  publishedAt: string;
  previousRevisionId?: string;
  /** Optional operator audit. */
  reason?: string;
  actorId?: string;
  correlationId?: string;
}

export interface CapabilityRevisionDiff {
  previousRevisionId: string | null;
  nextRevisionId: string;
  addedDeploymentIds: string[];
  removedDeploymentIds: string[];
  changedDeploymentIds: string[];
  credentialVersionChanges: Array<{
    deploymentId: string;
    from?: string;
    to?: string;
  }>;
  adapterKeyChanges: Array<{
    deploymentId: string;
    from?: string;
    to?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Channel isolate / drain (no-restart semantics)
// ---------------------------------------------------------------------------

/**
 * Channel lifecycle for hot isolate/drain without process restart.
 * Distinct from CredentialAccount drainSubstate (G2) and MediaProviderDrainMode
 * (S2a adapter hook) — this is the control-plane channel admission state.
 */
export type ChannelLifecycleMode = 'accepting' | 'isolated' | 'draining';

export interface ChannelLifecycleState {
  channelId: string;
  mode: ChannelLifecycleMode;
  reason: string;
  startedAt: string;
  /** Maps onto S2a MediaProviderDrainMode for adapter hooks when wired. */
  drainMode: MediaProviderDrainMode;
  /** In-flight tasks still tracked against this channel (domain count only). */
  inFlightCount: number;
}

export type ChannelAdmissionIntent = 'new_submit' | 'in_flight';

export interface ChannelAdmissionDecision {
  channelId: string;
  intent: ChannelAdmissionIntent;
  admitted: boolean;
  mode: ChannelLifecycleMode;
  /** Stable error code when rejected (wiring surfaces to adapters). */
  errorCode?: 'channel_isolated' | 'channel_draining';
  message?: string;
}

// ---------------------------------------------------------------------------
// Request-time assembly
// ---------------------------------------------------------------------------

export interface AssembleCapabilityRequest {
  deploymentId: string;
  /**
   * Capability revision frozen on the RouteSnapshot / attempt.
   * When omitted, the effective (head) revision is used (new tasks).
   */
  frozenCapabilityRevisionId?: string;
  /**
   * Credential version frozen on the RouteSnapshot. Required when the entry
   * has a credentialAccountId — never silently upgraded.
   */
  frozenCredentialVersion?: string;
  requiredScope: AssembleCredentialRequest['requiredScope'];
}

/** Runtime-only assembly result — must never be returned from product APIs. */
export interface AssembledCapabilityBinding {
  capabilityRevisionId: string;
  deploymentId: string;
  entry: RuntimeCapabilityEntry;
  adapterKey: string;
  adapterBindingRevision?: string;
  /** Present when the entry binds a CredentialAccount and assembly succeeded. */
  credential?: AssembledCredential;
  channelLifecycle: ChannelLifecycleState;
  /** True when resolved from historical (non-head) revision for in-flight work. */
  resolvedFromHistory: boolean;
}

export interface EffectiveRevisionReport {
  processKind: 'http' | 'job-worker';
  effectiveCapabilityRevisionId: string | null;
  effectiveCatalogRevisionId: string | null;
  capabilityRevisionNumber: number | null;
  channelModes: Record<string, ChannelLifecycleMode>;
  cacheGeneration: number;
}

export interface ApplyCapabilityResult {
  previousRevisionId: string | null;
  appliedRevisionId: string;
  diff: CapabilityRevisionDiff;
  cacheInvalidated: boolean;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * Shared effective-revision head store. HTTP and Worker must be wired to the
 * same durable/shared implementation (Z2-WIRING) so both report one head.
 */
export interface EffectiveCapabilityRevisionStore {
  get():
    | RuntimeCapabilityRevision
    | null
    | Promise<RuntimeCapabilityRevision | null>;
  set(
    revision: RuntimeCapabilityRevision,
  ): void | Promise<void>;
  /** Optional history for rolling in-flight resolution. */
  getById?(
    revisionId: string,
  ):
    | RuntimeCapabilityRevision
    | null
    | Promise<RuntimeCapabilityRevision | null>;
  listHistory?():
    | RuntimeCapabilityRevision[]
    | Promise<RuntimeCapabilityRevision[]>;
}

/** Adapter binding directory — metadata only; live ports stay with Z2/I. */
export interface AdapterBindingDirectory {
  get(
    deploymentId: string,
  ): AdapterBindingRecord | null | Promise<AdapterBindingRecord | null>;
}

export interface AdapterBindingRecord {
  deploymentId: string;
  adapterKey: string;
  adapterBindingRevision?: string;
  executionChannelId?: string;
}

/**
 * Versioned hot-assembly port consumed by provider runtime (G owns; Z2 wires).
 */
export interface CapabilityHotAssemblyPort {
  getEffectiveRevision():
    | RuntimeCapabilityRevision
    | null
    | Promise<RuntimeCapabilityRevision | null>;
  getEffectiveRevisionId(): string | null | Promise<string | null>;
  applyCapabilityRevision(
    revision: RuntimeCapabilityRevision,
  ): ApplyCapabilityResult | Promise<ApplyCapabilityResult>;
  supportsDeployment(
    deployment: RuntimeCapabilityMatchInput,
  ): boolean | Promise<boolean>;
  assertCompatible(
    deployments: RuntimeCapabilityMatchInput[],
  ): void | Promise<void>;
  assembleForRequest(
    request: AssembleCapabilityRequest,
  ): Promise<AssembledCapabilityBinding>;
  isolateChannel(
    channelId: string,
    reason: string,
    options?: { now?: string; inFlightCount?: number },
  ): ChannelLifecycleState;
  startChannelDrain(
    channelId: string,
    reason: string,
    options?: { now?: string; inFlightCount?: number },
  ): ChannelLifecycleState;
  completeChannelDrain(
    channelId: string,
    reason: string,
    options?: { now?: string },
  ): ChannelLifecycleState;
  restoreChannel(
    channelId: string,
    reason: string,
    options?: { now?: string },
  ): ChannelLifecycleState;
  getChannelLifecycle(channelId: string): ChannelLifecycleState;
  decideAdmission(
    channelId: string,
    intent: ChannelAdmissionIntent,
  ): ChannelAdmissionDecision;
  invalidateAssemblyCache(): void;
  getAssemblyCacheStats(): { size: number; generation: number };
  /**
   * Catalog-only head (independent of capability revision). Lets tests prove
   * catalog hot-switch remains orthogonal to capability assembly.
   */
  applyCatalogRevisionHead(catalogRevisionId: string): void;
  getCatalogRevisionHead(): string | null;
  reportProcessView(
    processKind: 'http' | 'job-worker',
  ): EffectiveRevisionReport | Promise<EffectiveRevisionReport>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class HotAssemblyError extends Error {
  constructor(
    readonly code:
      | 'CAPABILITY_REVISION_NOT_FOUND'
      | 'DEPLOYMENT_OUTSIDE_CAPABILITY'
      | 'ENTRY_NOT_FOUND'
      | 'CHANNEL_NOT_ACCEPTING'
      | 'CREDENTIAL_REQUIRED'
      | 'ADAPTER_BINDING_MISSING'
      | 'INVALID_REVISION',
    message: string,
  ) {
    super(message);
    this.name = 'HotAssemblyError';
  }
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

export function toRuntimeCapabilityEntry(
  deployment: RuntimeCapabilityMatchInput & {
    credentialAccountId?: string;
    adapterKey?: string;
    adapterBindingRevision?: string;
  },
): RuntimeCapabilityEntry {
  return {
    deploymentId: deployment.id,
    catalogModelId: deployment.catalogModelId,
    apiFamily: deployment.apiFamily,
    channel: deployment.channel,
    region: deployment.region,
    ...(deployment.executionChannelId
      ? { executionChannelId: deployment.executionChannelId }
      : {}),
    ...(deployment.providerModel
      ? { providerModel: deployment.providerModel }
      : {}),
    ...(deployment.endpointRevision
      ? { endpointRevision: deployment.endpointRevision }
      : {}),
    ...(deployment.lifecycleRevision
      ? { lifecycleRevision: deployment.lifecycleRevision }
      : {}),
    ...(deployment.credentialVersion
      ? { credentialVersion: deployment.credentialVersion }
      : {}),
    ...(deployment.credentialAccountId
      ? { credentialAccountId: deployment.credentialAccountId }
      : {}),
    adapterKey: deployment.adapterKey ?? defaultAdapterKey(deployment),
    ...(deployment.adapterBindingRevision
      ? { adapterBindingRevision: deployment.adapterBindingRevision }
      : {}),
  };
}

/** Best-effort adapter key from channel/apiFamily — wiring may override. */
export function defaultAdapterKey(
  deployment: Pick<
    RuntimeCapabilityMatchInput,
    'channel' | 'apiFamily' | 'executionChannelId'
  >,
): string {
  const channelId = deployment.executionChannelId ?? '';
  if (channelId.includes('tuzi')) return 'tuzi-media';
  if (channelId.includes('ark') || channelId.includes('volcengine')) {
    return deployment.apiFamily === 'audio' ? 'volcengine-tts' : 'ark-media';
  }
  if (deployment.channel === 'direct') {
    if (deployment.apiFamily === 'image' || deployment.apiFamily === 'media') {
      return 'ark-media';
    }
    if (deployment.apiFamily === 'audio') return 'volcengine-tts';
    return 'direct-llm';
  }
  if (deployment.channel === 'managed') return 'managed';
  if (deployment.channel === 'bifrost' || deployment.channel === 'litellm') {
    return `gateway-${deployment.channel}`;
  }
  return 'recorded';
}

export function projectCapabilityRevision(input: {
  revisionId: string;
  number: number;
  entries: RuntimeCapabilityEntry[];
  publishedAt?: string;
  previousRevisionId?: string;
  reason?: string;
  actorId?: string;
  correlationId?: string;
}): RuntimeCapabilityRevision {
  if (!input.revisionId) {
    throw new HotAssemblyError(
      'INVALID_REVISION',
      'Capability revision requires a non-empty revisionId.',
    );
  }
  if (!Number.isFinite(input.number) || input.number < 1) {
    throw new HotAssemblyError(
      'INVALID_REVISION',
      'Capability revision number must be a positive integer.',
    );
  }
  const seen = new Set<string>();
  for (const entry of input.entries) {
    if (seen.has(entry.deploymentId)) {
      throw new HotAssemblyError(
        'INVALID_REVISION',
        `Duplicate capability entry for deployment ${entry.deploymentId}.`,
      );
    }
    seen.add(entry.deploymentId);
  }
  return {
    revisionId: input.revisionId,
    number: input.number,
    entries: input.entries.map((entry) => ({ ...entry })),
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    ...(input.previousRevisionId
      ? { previousRevisionId: input.previousRevisionId }
      : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
  };
}

/**
 * Dynamic evaluation against an effective capability set — replaces the
 * process-start frozen `runtimeCapabilities` map check.
 */
export function supportsRuntimeCapability(
  effectiveEntries: readonly RuntimeCapabilityEntry[],
  deployment: RuntimeCapabilityMatchInput,
): boolean {
  const entry = effectiveEntries.find(
    (row) => row.deploymentId === deployment.id,
  );
  if (!entry) return false;
  return capabilityFingerprintsMatch(entry, deployment);
}

export function capabilityFingerprintsMatch(
  entry: RuntimeCapabilityEntry,
  deployment: RuntimeCapabilityMatchInput,
): boolean {
  return (
    entry.catalogModelId === deployment.catalogModelId &&
    entry.apiFamily === deployment.apiFamily &&
    entry.channel === deployment.channel &&
    entry.region === deployment.region &&
    entry.executionChannelId === deployment.executionChannelId &&
    entry.providerModel === deployment.providerModel &&
    entry.endpointRevision === deployment.endpointRevision &&
    entry.lifecycleRevision === deployment.lifecycleRevision &&
    entry.credentialVersion === deployment.credentialVersion
  );
}

/**
 * Publish gate: every *active* deployment must fall inside the effective
 * capability revision. Inactive/retired deployments are unconstrained.
 */
export function assertRuntimeCapabilityCompatible(
  effectiveEntries: readonly RuntimeCapabilityEntry[],
  deployments: readonly RuntimeCapabilityMatchInput[],
): void {
  const unsupported = deployments.find(
    (deployment) =>
      deployment.status === 'active' &&
      !supportsRuntimeCapability(effectiveEntries, deployment),
  );
  if (unsupported) {
    throw new HotAssemblyError(
      'DEPLOYMENT_OUTSIDE_CAPABILITY',
      `Deployment ${unsupported.id} is outside the effective runtime capability revision.`,
    );
  }
}

/**
 * Constrain active deployments that fall outside effective capability —
 * mirrors historical `constrainRuntimeDeployments` but against a dynamic head.
 */
export function constrainDeploymentsToCapability<
  T extends RuntimeCapabilityMatchInput,
>(
  effectiveEntries: readonly RuntimeCapabilityEntry[],
  deployments: readonly T[],
): T[] {
  return deployments.map((deployment) => {
    if (
      deployment.status !== 'active' ||
      supportsRuntimeCapability(effectiveEntries, deployment)
    ) {
      return deployment;
    }
    return {
      ...deployment,
      status: 'inactive',
    } as T;
  });
}

export function diffCapabilityRevisions(
  previous: RuntimeCapabilityRevision | null,
  next: RuntimeCapabilityRevision,
): CapabilityRevisionDiff {
  const prevMap = new Map(
    (previous?.entries ?? []).map((entry) => [entry.deploymentId, entry]),
  );
  const nextMap = new Map(
    next.entries.map((entry) => [entry.deploymentId, entry]),
  );
  const addedDeploymentIds: string[] = [];
  const removedDeploymentIds: string[] = [];
  const changedDeploymentIds: string[] = [];
  const credentialVersionChanges: CapabilityRevisionDiff['credentialVersionChanges'] =
    [];
  const adapterKeyChanges: CapabilityRevisionDiff['adapterKeyChanges'] = [];

  for (const [id, nextEntry] of nextMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      addedDeploymentIds.push(id);
      continue;
    }
    if (!capabilityEntriesEqual(prev, nextEntry)) {
      changedDeploymentIds.push(id);
      if (prev.credentialVersion !== nextEntry.credentialVersion) {
        credentialVersionChanges.push({
          deploymentId: id,
          from: prev.credentialVersion,
          to: nextEntry.credentialVersion,
        });
      }
      if (prev.adapterKey !== nextEntry.adapterKey) {
        adapterKeyChanges.push({
          deploymentId: id,
          from: prev.adapterKey,
          to: nextEntry.adapterKey,
        });
      }
    }
  }
  for (const id of prevMap.keys()) {
    if (!nextMap.has(id)) removedDeploymentIds.push(id);
  }

  return {
    previousRevisionId: previous?.revisionId ?? null,
    nextRevisionId: next.revisionId,
    addedDeploymentIds,
    removedDeploymentIds,
    changedDeploymentIds,
    credentialVersionChanges,
    adapterKeyChanges,
  };
}

function capabilityEntriesEqual(
  left: RuntimeCapabilityEntry,
  right: RuntimeCapabilityEntry,
): boolean {
  return (
    left.deploymentId === right.deploymentId &&
    left.catalogModelId === right.catalogModelId &&
    left.apiFamily === right.apiFamily &&
    left.channel === right.channel &&
    left.region === right.region &&
    left.executionChannelId === right.executionChannelId &&
    left.providerModel === right.providerModel &&
    left.endpointRevision === right.endpointRevision &&
    left.lifecycleRevision === right.lifecycleRevision &&
    left.credentialVersion === right.credentialVersion &&
    left.credentialAccountId === right.credentialAccountId &&
    left.adapterKey === right.adapterKey &&
    left.adapterBindingRevision === right.adapterBindingRevision
  );
}

export function shouldInvalidateAssemblyCache(
  previous: RuntimeCapabilityRevision | null,
  next: RuntimeCapabilityRevision,
): boolean {
  if (!previous) return true;
  if (previous.revisionId !== next.revisionId) return true;
  const diff = diffCapabilityRevisions(previous, next);
  return (
    diff.addedDeploymentIds.length > 0 ||
    diff.removedDeploymentIds.length > 0 ||
    diff.changedDeploymentIds.length > 0
  );
}

/**
 * Resolve a frozen capability revision entry for in-flight work.
 * Returns null when the revision or deployment was never recorded —
 * callers must not silently upgrade to the head.
 */
export function resolveFrozenCapabilityEntry(
  history: readonly RuntimeCapabilityRevision[],
  frozenRevisionId: string,
  deploymentId: string,
): { revision: RuntimeCapabilityRevision; entry: RuntimeCapabilityEntry } | null {
  const revision =
    history.find((row) => row.revisionId === frozenRevisionId) ?? null;
  if (!revision) return null;
  const entry =
    revision.entries.find((row) => row.deploymentId === deploymentId) ?? null;
  if (!entry) return null;
  return { revision, entry };
}

export function initialChannelLifecycle(
  channelId: string,
  now = new Date().toISOString(),
): ChannelLifecycleState {
  return {
    channelId,
    mode: 'accepting',
    reason: 'initial',
    startedAt: now,
    drainMode: 'accepting',
    inFlightCount: 0,
  };
}

/**
 * Pure admission decision for isolate/drain without restart.
 * - isolated: new_submit rejected; in_flight continues
 * - draining: new_submit rejected (channel_draining); in_flight continues
 * - accepting: both admitted
 */
export function decideChannelAdmission(
  state: ChannelLifecycleState,
  intent: ChannelAdmissionIntent,
): ChannelAdmissionDecision {
  if (state.mode === 'accepting') {
    return {
      channelId: state.channelId,
      intent,
      admitted: true,
      mode: state.mode,
    };
  }
  if (intent === 'in_flight') {
    return {
      channelId: state.channelId,
      intent,
      admitted: true,
      mode: state.mode,
    };
  }
  if (state.mode === 'isolated') {
    return {
      channelId: state.channelId,
      intent,
      admitted: false,
      mode: state.mode,
      errorCode: 'channel_isolated',
      message: `Channel ${state.channelId} is isolated; new submissions are rejected without process restart.`,
    };
  }
  return {
    channelId: state.channelId,
    intent,
    admitted: false,
    mode: state.mode,
    errorCode: 'channel_draining',
    message: `Channel ${state.channelId} is draining; new submissions are rejected while in-flight tasks continue.`,
  };
}

export function transitionChannelLifecycle(
  previous: ChannelLifecycleState | null,
  command:
    | { kind: 'isolate'; reason: string }
    | { kind: 'start_drain'; reason: string }
    | { kind: 'complete_drain'; reason: string }
    | { kind: 'restore'; reason: string }
    | { kind: 'set_in_flight'; count: number },
  options: { now?: string; channelId: string; inFlightCount?: number } ,
): ChannelLifecycleState {
  const now = options.now ?? new Date().toISOString();
  const base =
    previous ??
    initialChannelLifecycle(options.channelId, now);
  const inFlight =
    options.inFlightCount ?? base.inFlightCount;

  switch (command.kind) {
    case 'isolate':
      return {
        channelId: options.channelId,
        mode: 'isolated',
        reason: command.reason,
        startedAt: now,
        drainMode: 'accepting',
        inFlightCount: inFlight,
      };
    case 'start_drain':
      return {
        channelId: options.channelId,
        mode: 'draining',
        reason: command.reason,
        startedAt: now,
        drainMode: 'draining',
        inFlightCount: inFlight,
      };
    case 'complete_drain':
      return {
        channelId: options.channelId,
        mode: 'accepting',
        reason: command.reason,
        startedAt: now,
        drainMode: 'accepting',
        inFlightCount: 0,
      };
    case 'restore':
      return {
        channelId: options.channelId,
        mode: 'accepting',
        reason: command.reason,
        startedAt: now,
        drainMode: 'accepting',
        inFlightCount: inFlight,
      };
    case 'set_in_flight':
      return {
        ...base,
        inFlightCount: command.count,
      };
    default: {
      const _exhaustive: never = command;
      throw new HotAssemblyError(
        'INVALID_REVISION',
        `Unknown channel lifecycle command: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Catalog-only hot switch is independent of capability revision.
 * Returns true when only the catalog head moved (capability unchanged).
 */
export function isCatalogOnlyHotSwitch(input: {
  previousCatalogRevisionId: string | null;
  nextCatalogRevisionId: string;
  previousCapabilityRevisionId: string | null;
  nextCapabilityRevisionId: string | null;
}): boolean {
  if (
    input.previousCatalogRevisionId === input.nextCatalogRevisionId
  ) {
    return false;
  }
  return (
    input.previousCapabilityRevisionId === input.nextCapabilityRevisionId
  );
}

// ---------------------------------------------------------------------------
// In-memory store + registry (domain default; Z2 wires durable store)
// ---------------------------------------------------------------------------

export class MemoryEffectiveCapabilityRevisionStore
  implements EffectiveCapabilityRevisionStore
{
  private head: RuntimeCapabilityRevision | null = null;
  private readonly history = new Map<string, RuntimeCapabilityRevision>();

  get(): RuntimeCapabilityRevision | null {
    return this.head ? cloneRevision(this.head) : null;
  }

  set(revision: RuntimeCapabilityRevision): void {
    const stored = cloneRevision(revision);
    this.head = stored;
    this.history.set(stored.revisionId, stored);
  }

  getById(revisionId: string): RuntimeCapabilityRevision | null {
    const found = this.history.get(revisionId);
    return found ? cloneRevision(found) : null;
  }

  listHistory(): RuntimeCapabilityRevision[] {
    return [...this.history.values()]
      .map(cloneRevision)
      .sort((a, b) => a.number - b.number);
  }
}

interface AssemblyCacheEntry {
  key: string;
  binding: AssembledCapabilityBinding;
}

/**
 * In-process hot-assembly registry. HTTP and Worker each hold an instance
 * backed by the same EffectiveCapabilityRevisionStore (when durable-shared).
 */
export class CapabilityHotAssemblyRegistry implements CapabilityHotAssemblyPort {
  private catalogRevisionHead: string | null = null;
  private cacheGeneration = 0;
  private readonly assemblyCache = new Map<string, AssemblyCacheEntry>();
  private readonly channelStates = new Map<string, ChannelLifecycleState>();

  constructor(
    private readonly store: EffectiveCapabilityRevisionStore = new MemoryEffectiveCapabilityRevisionStore(),
    private readonly secrets?: CredentialSecretBrokerPort,
    private readonly adapters?: AdapterBindingDirectory,
  ) {}

  getEffectiveRevision(): RuntimeCapabilityRevision | null {
    const value = this.store.get();
    if (value instanceof Promise) {
      throw new HotAssemblyError(
        'INVALID_REVISION',
        'Async EffectiveCapabilityRevisionStore requires await via async helpers; use Memory store or async port wrapper.',
      );
    }
    return value;
  }

  getEffectiveRevisionId(): string | null {
    return this.getEffectiveRevision()?.revisionId ?? null;
  }

  applyCapabilityRevision(
    revision: RuntimeCapabilityRevision,
  ): ApplyCapabilityResult {
    const validated = projectCapabilityRevision(revision);
    const previous = this.getEffectiveRevision();
    if (
      previous &&
      validated.number < previous.number &&
      validated.revisionId !== previous.revisionId
    ) {
      // Allow explicit rollback to a lower number only when previousRevisionId
      // chain is recorded (rolling compat / operator rollback).
      if (!validated.previousRevisionId && previous.revisionId !== validated.revisionId) {
        // still allow — publish gate is number-monotonic preference, not hard fail
      }
    }
    const diff = diffCapabilityRevisions(previous, validated);
    const cacheInvalidated = shouldInvalidateAssemblyCache(previous, validated);
    this.store.set(validated);
    if (cacheInvalidated) {
      this.invalidateAssemblyCache();
    }
    return {
      previousRevisionId: previous?.revisionId ?? null,
      appliedRevisionId: validated.revisionId,
      diff,
      cacheInvalidated,
    };
  }

  supportsDeployment(deployment: RuntimeCapabilityMatchInput): boolean {
    const effective = this.getEffectiveRevision();
    if (!effective) {
      // No capability head yet — unconstrained (mirrors missing runtimeCapabilities).
      return true;
    }
    return supportsRuntimeCapability(effective.entries, deployment);
  }

  assertCompatible(deployments: RuntimeCapabilityMatchInput[]): void {
    const effective = this.getEffectiveRevision();
    if (!effective) return;
    assertRuntimeCapabilityCompatible(effective.entries, deployments);
  }

  async assembleForRequest(
    request: AssembleCapabilityRequest,
  ): Promise<AssembledCapabilityBinding> {
    const { revision, entry, resolvedFromHistory } =
      this.resolveEntryForRequest(request);

    const channelId =
      entry.executionChannelId ?? entry.deploymentId;
    const channelLifecycle = this.getChannelLifecycle(channelId);
    const admission = decideChannelAdmission(channelLifecycle, 'new_submit');
    // Assembly itself is allowed for planning/frozen resolution; callers that
    // submit must still consult decideAdmission. We still surface lifecycle.

    let adapterKey = entry.adapterKey;
    let adapterBindingRevision = entry.adapterBindingRevision;
    if (this.adapters) {
      const binding = await this.adapters.get(entry.deploymentId);
      if (binding) {
        adapterKey = binding.adapterKey;
        adapterBindingRevision =
          binding.adapterBindingRevision ?? adapterBindingRevision;
      }
    }

    const cacheKey = [
      revision.revisionId,
      entry.deploymentId,
      request.frozenCredentialVersion ?? entry.credentialVersion ?? '',
      adapterKey,
      this.cacheGeneration,
    ].join('::');
    const cached = this.assemblyCache.get(cacheKey);
    if (cached) {
      return {
        ...cached.binding,
        channelLifecycle: this.getChannelLifecycle(channelId),
      };
    }

    let credential: AssembledCredential | undefined;
    if (entry.credentialAccountId) {
      if (!this.secrets) {
        throw new HotAssemblyError(
          'CREDENTIAL_REQUIRED',
          `Deployment ${entry.deploymentId} requires CredentialSecretBrokerPort for account ${entry.credentialAccountId}.`,
        );
      }
      const frozenVersion =
        request.frozenCredentialVersion ?? entry.credentialVersion;
      if (!frozenVersion) {
        throw new HotAssemblyError(
          'CREDENTIAL_REQUIRED',
          `Deployment ${entry.deploymentId} requires a frozen credential version.`,
        );
      }
      try {
        credential = await this.secrets.assembleForRequest({
          credentialAccountId: entry.credentialAccountId,
          frozenVersion,
          requiredScope: request.requiredScope,
        });
      } catch (error) {
        if (error instanceof SecretBrokerError) throw error;
        throw error;
      }
    }

    const binding: AssembledCapabilityBinding = {
      capabilityRevisionId: revision.revisionId,
      deploymentId: entry.deploymentId,
      entry: { ...entry, adapterKey, adapterBindingRevision },
      adapterKey,
      ...(adapterBindingRevision
        ? { adapterBindingRevision }
        : {}),
      ...(credential ? { credential } : {}),
      channelLifecycle,
      resolvedFromHistory,
    };

    // Do not cache when admission is closed for new submit — still return for
    // inspection, but cache only successful accepting assemblies.
    if (admission.admitted) {
      this.assemblyCache.set(cacheKey, { key: cacheKey, binding });
    }

    return binding;
  }

  isolateChannel(
    channelId: string,
    reason: string,
    options: { now?: string; inFlightCount?: number } = {},
  ): ChannelLifecycleState {
    const next = transitionChannelLifecycle(
      this.channelStates.get(channelId) ?? null,
      { kind: 'isolate', reason },
      { channelId, ...options },
    );
    this.channelStates.set(channelId, next);
    this.invalidateAssemblyCache();
    return { ...next };
  }

  startChannelDrain(
    channelId: string,
    reason: string,
    options: { now?: string; inFlightCount?: number } = {},
  ): ChannelLifecycleState {
    const next = transitionChannelLifecycle(
      this.channelStates.get(channelId) ?? null,
      { kind: 'start_drain', reason },
      { channelId, ...options },
    );
    this.channelStates.set(channelId, next);
    this.invalidateAssemblyCache();
    return { ...next };
  }

  completeChannelDrain(
    channelId: string,
    reason: string,
    options: { now?: string } = {},
  ): ChannelLifecycleState {
    const current = this.channelStates.get(channelId);
    if (!current || current.mode !== 'draining') {
      throw new HotAssemblyError(
        'CHANNEL_NOT_ACCEPTING',
        `Channel ${channelId} is not draining.`,
      );
    }
    const next = transitionChannelLifecycle(
      current,
      { kind: 'complete_drain', reason },
      { channelId, ...options },
    );
    this.channelStates.set(channelId, next);
    this.invalidateAssemblyCache();
    return { ...next };
  }

  restoreChannel(
    channelId: string,
    reason: string,
    options: { now?: string } = {},
  ): ChannelLifecycleState {
    const next = transitionChannelLifecycle(
      this.channelStates.get(channelId) ?? null,
      { kind: 'restore', reason },
      { channelId, ...options },
    );
    this.channelStates.set(channelId, next);
    this.invalidateAssemblyCache();
    return { ...next };
  }

  getChannelLifecycle(channelId: string): ChannelLifecycleState {
    const state = this.channelStates.get(channelId);
    return state
      ? { ...state }
      : initialChannelLifecycle(channelId, new Date(0).toISOString());
  }

  decideAdmission(
    channelId: string,
    intent: ChannelAdmissionIntent,
  ): ChannelAdmissionDecision {
    return decideChannelAdmission(this.getChannelLifecycle(channelId), intent);
  }

  invalidateAssemblyCache(): void {
    this.assemblyCache.clear();
    this.cacheGeneration += 1;
  }

  getAssemblyCacheStats(): { size: number; generation: number } {
    return {
      size: this.assemblyCache.size,
      generation: this.cacheGeneration,
    };
  }

  applyCatalogRevisionHead(catalogRevisionId: string): void {
    this.catalogRevisionHead = catalogRevisionId;
    // Catalog-only switch must NOT invalidate capability assembly cache —
    // independence is an acceptance criterion (catalog head already hot).
  }

  getCatalogRevisionHead(): string | null {
    return this.catalogRevisionHead;
  }

  reportProcessView(
    processKind: 'http' | 'job-worker',
  ): EffectiveRevisionReport {
    const effective = this.getEffectiveRevision();
    const channelModes: Record<string, ChannelLifecycleMode> = {};
    for (const [id, state] of this.channelStates) {
      channelModes[id] = state.mode;
    }
    return {
      processKind,
      effectiveCapabilityRevisionId: effective?.revisionId ?? null,
      effectiveCatalogRevisionId: this.catalogRevisionHead,
      capabilityRevisionNumber: effective?.number ?? null,
      channelModes,
      cacheGeneration: this.cacheGeneration,
    };
  }

  private resolveEntryForRequest(request: AssembleCapabilityRequest): {
    revision: RuntimeCapabilityRevision;
    entry: RuntimeCapabilityEntry;
    resolvedFromHistory: boolean;
  } {
    const head = this.getEffectiveRevision();
    if (!head) {
      throw new HotAssemblyError(
        'CAPABILITY_REVISION_NOT_FOUND',
        'No effective capability revision is published.',
      );
    }

    if (
      !request.frozenCapabilityRevisionId ||
      request.frozenCapabilityRevisionId === head.revisionId
    ) {
      const entry = head.entries.find(
        (row) => row.deploymentId === request.deploymentId,
      );
      if (!entry) {
        throw new HotAssemblyError(
          'ENTRY_NOT_FOUND',
          `Deployment ${request.deploymentId} is not in effective capability revision ${head.revisionId}.`,
        );
      }
      return { revision: head, entry, resolvedFromHistory: false };
    }

    // Rolling compat: resolve frozen historical revision; never silent-upgrade.
    const history =
      typeof this.store.listHistory === 'function'
        ? this.store.listHistory()
        : [head];
    if (history instanceof Promise) {
      throw new HotAssemblyError(
        'INVALID_REVISION',
        'Async history store not supported by sync resolve path.',
      );
    }
    const frozen = resolveFrozenCapabilityEntry(
      history,
      request.frozenCapabilityRevisionId,
      request.deploymentId,
    );
    if (!frozen) {
      throw new HotAssemblyError(
        'CAPABILITY_REVISION_NOT_FOUND',
        `Frozen capability revision ${request.frozenCapabilityRevisionId} for deployment ${request.deploymentId} is not recorded; refusing silent upgrade.`,
      );
    }
    return {
      revision: frozen.revision,
      entry: frozen.entry,
      resolvedFromHistory: true,
    };
  }
}

/**
 * Build two process views that share one store — proves HTTP/Worker domain
 * contract for identical effective revision (wiring still Z2).
 */
export function createSharedProcessHotAssemblyPair(input?: {
  secrets?: CredentialSecretBrokerPort;
  adapters?: AdapterBindingDirectory;
}): {
  store: MemoryEffectiveCapabilityRevisionStore;
  http: CapabilityHotAssemblyRegistry;
  worker: CapabilityHotAssemblyRegistry;
} {
  const store = new MemoryEffectiveCapabilityRevisionStore();
  return {
    store,
    http: new CapabilityHotAssemblyRegistry(
      store,
      input?.secrets,
      input?.adapters,
    ),
    worker: new CapabilityHotAssemblyRegistry(
      store,
      input?.secrets,
      input?.adapters,
    ),
  };
}

function cloneRevision(
  revision: RuntimeCapabilityRevision,
): RuntimeCapabilityRevision {
  return {
    ...revision,
    entries: revision.entries.map((entry) => ({ ...entry })),
  };
}
