/**
 * S2b: normalize four RouteSnapshot shapes onto CanonicalRouteSnapshot.
 *
 * Shapes:
 *  1. foundation durable checkpoint (foundation/domain.ts)
 *  2. model-supply rich snapshot (model-supply/route-contracts.ts)
 *  3. StrictByok public shape (integrations/contracts.ts)
 *  4. ledger checkpoint converters (foundation-ledger / foundation-byok-ledger)
 *
 * Read-old → write-new: adapters produce the canonical view; ledger writers
 * rebuild foundation checkpoints from that view so frozen evidence is stable.
 */
import type {
  CanonicalRouteCandidate,
  CanonicalRouteSnapshot,
  SupplyChannelKind,
} from '@meiye/contracts';
import type {
  GenerationDataClass,
  RouteCandidate as FoundationRouteCandidate,
  RouteSnapshot as FoundationRouteSnapshot,
} from './foundation/domain.js';
import type {
  StrictByokRouteSnapshot,
} from './integrations/contracts.js';
import type {
  RouteSnapshot as ModelSupplyRouteSnapshot,
} from './model-supply/route-contracts.js';
import type {
  CatalogModel,
  ModelDeployment,
} from './model-supply/supply-contracts.js';
import type {
  ModelSupplySubmission,
} from './model-supply/route-contracts.js';

/** Foundation checkpoint payload (workspaceId/createdAt assigned by store). */
export type FoundationRouteCheckpoint = Omit<
  FoundationRouteSnapshot,
  'workspaceId' | 'createdAt'
>;

export type ModelSupplyChannel = ModelDeployment['channel'];

/**
 * F-S2-05: revision completeness mode.
 * - production: missing catalog/policy/price/credential revisions throw
 * - recorded_harness: inject recorded-*-v1 placeholders (tests / recorded adapters only)
 */
export type RouteRevisionMode = 'production' | 'recorded_harness';

export const RECORDED_REVISION_DEFAULTS = {
  catalog: 'recorded-catalog-v1',
  policy: 'recorded-policy-v1',
  price: 'recorded-price-v1',
  credential: 'recorded-credential-v1',
} as const;

export class IncompleteRouteRevisionError extends Error {
  readonly code = 'INCOMPLETE_ROUTE_REVISION' as const;
  constructor(readonly field: string) {
    super(
      `RouteSnapshot missing required revision field "${field}" (production fail-closed; set P1_ROUTE_REVISION_MODE=recorded_harness only for harness).`,
    );
    this.name = 'IncompleteRouteRevisionError';
  }
}

export function resolveRouteRevisionMode(
  explicit?: RouteRevisionMode,
): RouteRevisionMode {
  if (explicit) return explicit;
  const env = process.env.P1_ROUTE_REVISION_MODE;
  if (env === 'production' || env === 'recorded_harness') return env;
  return process.env.NODE_ENV === 'production'
    ? 'production'
    : 'recorded_harness';
}

export function requireRouteRevision(
  value: string | null | undefined,
  field: string,
  mode: RouteRevisionMode,
  recordedDefault: string,
): string {
  if (value !== undefined && value !== null && value !== '') return value;
  if (mode === 'recorded_harness') return recordedDefault;
  throw new IncompleteRouteRevisionError(field);
}

// ---------------------------------------------------------------------------
// Serialize / replay (field-stable JSON)
// ---------------------------------------------------------------------------

/** Deterministic JSON for contract tests — key order does not affect equality. */
export function serializeCanonicalRouteSnapshot(
  snapshot: CanonicalRouteSnapshot,
): string {
  return JSON.stringify(stableValue(snapshot));
}

export function parseCanonicalRouteSnapshot(
  serialized: string,
): CanonicalRouteSnapshot {
  return JSON.parse(serialized) as CanonicalRouteSnapshot;
}

/** Round-trip through serialize+parse; used by field-level replay tests. */
export function replayCanonicalRouteSnapshot(
  snapshot: CanonicalRouteSnapshot,
): CanonicalRouteSnapshot {
  return parseCanonicalRouteSnapshot(serializeCanonicalRouteSnapshot(snapshot));
}

// ---------------------------------------------------------------------------
// from* adapters (read old → canonical)
// ---------------------------------------------------------------------------

export function fromFoundationRouteSnapshot(
  snapshot: FoundationRouteSnapshot | FoundationRouteCheckpoint,
  options?: {
    actualDeploymentId?: string;
    sourceKind?: SupplyChannelKind;
    runtimeExclusionReasons?: string[];
    createdAt?: string;
  },
): CanonicalRouteSnapshot {
  const ranked = rankFoundationCandidates(snapshot.allowedCandidates);
  const primary =
    ranked.find((c) => c.deploymentId === options?.actualDeploymentId) ??
    ranked[0];
  if (!primary) {
    throw new Error('CanonicalRouteSnapshot requires at least one candidate.');
  }

  const fallbackChain = snapshot.fallbackConsent
    ? ranked.map((c) => c.deploymentId)
    : ranked.slice(0, 1).map((c) => c.deploymentId);

  // F-S2-03: prefer options, then foundation top-level, then primary candidate.
  const sourceKind =
    options?.sourceKind ??
    (snapshot.sourceKind as SupplyChannelKind | undefined) ??
    primary.sourceKind;

  return {
    id: snapshot.id,
    catalogModelId: primary.catalogModelId,
    requestedCatalogModelId: snapshot.requestedCatalogModelId,
    providerProfileId: undefined,
    executionChannelId: primary.executionChannelId,
    deploymentId: primary.deploymentId,
    credentialAccountVersion: primary.credentialVersion,
    credentialMode: primary.credentialMode,
    policyRevisionId: snapshot.policyRevision,
    priceRevisionId: snapshot.priceRevision,
    endpointRevisionId: primary.endpointRevision,
    dataPolicyRevisionId: snapshot.dataPolicyRevisionId,
    catalogRevisionId: snapshot.catalogRevision,
    allowedCandidates: ranked,
    actualDeploymentId: options?.actualDeploymentId ?? primary.deploymentId,
    runtimeExclusionReasons: options?.runtimeExclusionReasons,
    fallbackChain,
    fallbackConsent: snapshot.fallbackConsent,
    maxAttempts: snapshot.maxAttempts,
    fallbackAuthorized: snapshot.fallbackAuthorized,
    sourceKind,
    selectionMode: snapshot.selectionMode,
    primaryDataClass: snapshot.dataClass,
    dataClasses: snapshot.dataClasses ?? [snapshot.dataClass],
    workspaceId: 'workspaceId' in snapshot ? snapshot.workspaceId : undefined,
    createdAt:
      options?.createdAt ??
      ('createdAt' in snapshot ? snapshot.createdAt : ''),
  };
}

/**
 * F-S2-01: shared resolution for route-level policy revision.
 * Prefer request-level routePolicyRevisionId, then snapshot policyRevision,
 * then primary candidate deployment policy. Ledger + adapter must share this.
 */
export function resolveRoutePolicyRevisionId(
  snapshot: {
    routePolicyRevisionId?: string | null;
    policyRevision?: string | null;
  },
  primary?: { policyRevision?: string | null } | null,
): string | undefined {
  return (
    snapshot.routePolicyRevisionId ??
    snapshot.policyRevision ??
    primary?.policyRevision ??
    undefined
  );
}

export function fromModelSupplyRouteSnapshot(
  snapshot: ModelSupplyRouteSnapshot,
  options?: {
    sourceKind?: SupplyChannelKind;
    runtimeExclusionReasons?: string[];
  },
): CanonicalRouteSnapshot {
  const candidates = modelSupplyCandidates(snapshot);
  const primary =
    candidates.find((c) => c.deploymentId === snapshot.deploymentId) ??
    candidates[0];
  if (!primary) {
    throw new Error('CanonicalRouteSnapshot requires at least one candidate.');
  }

  const sourceKind =
    options?.sourceKind ??
    primary.sourceKind ??
    channelToSourceKind(
      snapshot.allowedCandidates?.find((c) => c.deploymentId === snapshot.deploymentId)
        ?.channel,
    );

  const fallbackConsent = snapshot.fallbackConsent ?? false;
  const fallbackChain = fallbackConsent
    ? candidates.map((c) => c.deploymentId)
    : [snapshot.deploymentId];

  return {
    id: snapshot.id,
    catalogModelId: snapshot.actualCatalogModelId,
    requestedCatalogModelId:
      snapshot.requestedSelection.mode === 'auto'
        ? 'auto'
        : snapshot.requestedSelection.catalogModelId ??
          snapshot.actualCatalogModelId,
    providerProfileId: snapshot.providerProfileId ?? primary.providerProfileId,
    executionChannelId:
      snapshot.executionChannelId ?? primary.executionChannelId,
    deploymentId: snapshot.deploymentId,
    credentialAccountVersion:
      snapshot.credentialVersion ?? primary.credentialVersion,
    credentialMode: snapshot.credentialMode ?? primary.credentialMode,
    policyRevisionId: resolveRoutePolicyRevisionId(snapshot, primary),
    priceRevisionId: snapshot.priceRevision ?? primary.priceRevision,
    endpointRevisionId: snapshot.endpointRevision ?? primary.endpointRevision,
    catalogRevisionId: snapshot.catalogRevisionId,
    allowedCandidates: candidates,
    actualDeploymentId: snapshot.deploymentId,
    dataPolicyRevisionId: snapshot.dataPolicyRevisionId,
    runtimeExclusionReasons:
      options?.runtimeExclusionReasons ?? snapshot.runtimeExclusionReasons,
    fallbackChain,
    fallbackConsent,
    maxAttempts: snapshot.maxAttempts,
    fallbackAuthorized: snapshot.fallbackAuthorized,
    sourceKind,
    selectionMode:
      snapshot.requestedSelection.mode === 'auto' ? 'auto' : 'fixed',
    primaryDataClass:
      [...snapshot.dataClass].sort()[0] ?? 'public',
    dataClasses:
      snapshot.dataClass.length === 0
        ? ['public']
        : [...snapshot.dataClass].sort(),
    createdAt: snapshot.createdAt,
  };
}

export function fromStrictByokRouteSnapshot(
  snapshot: StrictByokRouteSnapshot,
  options?: {
    region?: 'cn' | 'global';
    createdAt?: string;
    deploymentId?: string;
  },
): CanonicalRouteSnapshot {
  const deploymentId =
    options?.deploymentId ??
    `byok:${snapshot.endpointProfileId}:v${snapshot.credentialVersion}`;
  const credentialVersion = String(snapshot.credentialVersion);
  const candidate: CanonicalRouteCandidate = {
    catalogModelId: snapshot.catalogModelId,
    deploymentId,
    rank: 1,
    region: options?.region ?? 'global',
    credentialMode: 'byok_strict',
    credentialVersion,
    policyRevision: 'byok-strict-no-fallback-v1',
    priceRevision: 'workspace-external-billing-v1',
  };

  return {
    id: snapshot.id,
    catalogModelId: snapshot.catalogModelId,
    requestedCatalogModelId: snapshot.catalogModelId,
    deploymentId,
    credentialAccountVersion: credentialVersion,
    credentialMode: 'byok_strict',
    policyRevisionId: 'byok-strict-no-fallback-v1',
    priceRevisionId: 'workspace-external-billing-v1',
    catalogRevisionId: 'controlled-byok-endpoints-v1',
    allowedCandidates: [candidate],
    actualDeploymentId: deploymentId,
    // Strict BYOK: no alternate hops — chain is the single authorized deployment.
    fallbackChain: [deploymentId],
    fallbackConsent: false,
    selectionMode: 'fixed',
    primaryDataClass: 'public',
    dataClasses: ['public'],
    workspaceId: snapshot.workspaceId,
    endpointProfileId: snapshot.endpointProfileId,
    createdAt: options?.createdAt ?? '',
  };
}

/**
 * Discriminated helper: accept any of the three public shapes.
 * Ledger converters use the dedicated from* + toFoundation helpers instead.
 */
export function toCanonicalRouteSnapshot(
  input:
    | { kind: 'foundation'; snapshot: FoundationRouteSnapshot | FoundationRouteCheckpoint }
    | { kind: 'model_supply'; snapshot: ModelSupplyRouteSnapshot }
    | {
        kind: 'strict_byok';
        snapshot: StrictByokRouteSnapshot;
        region?: 'cn' | 'global';
        deploymentId?: string;
      },
): CanonicalRouteSnapshot {
  switch (input.kind) {
    case 'foundation':
      return fromFoundationRouteSnapshot(input.snapshot);
    case 'model_supply':
      return fromModelSupplyRouteSnapshot(input.snapshot);
    case 'strict_byok':
      return fromStrictByokRouteSnapshot(input.snapshot, {
        region: input.region,
        deploymentId: input.deploymentId,
      });
  }
}

// ---------------------------------------------------------------------------
// toFoundation (write new checkpoint from canonical)
// ---------------------------------------------------------------------------

export function toFoundationRouteCheckpoint(
  canonical: CanonicalRouteSnapshot,
  product?: Partial<{
    catalogRevision: string;
    policyRevision: string;
    priceRevision: string;
    requestedCatalogModelId: string;
    selectionMode: 'fixed' | 'llm_auto';
    dataClass: GenerationDataClass;
    dataClasses: GenerationDataClass[];
    fallbackConsent: boolean;
    maxAttempts: number;
    fallbackAuthorized: boolean;
    retryOwner: 'product';
    providerRetryDisabled: true;
    revisionMode: RouteRevisionMode;
  }>,
): FoundationRouteCheckpoint {
  const revisionMode = resolveRouteRevisionMode(product?.revisionMode);
  const selectionMode =
    product?.selectionMode ??
    (canonical.selectionMode === 'auto' || canonical.selectionMode === 'llm_auto'
      ? 'llm_auto'
      : 'fixed');

  const dataClass = (product?.dataClass ??
    canonical.primaryDataClass ??
    'public') as GenerationDataClass;

  const dataClasses = (product?.dataClasses ??
    (canonical.dataClasses as GenerationDataClass[] | undefined) ??
    [dataClass]) as GenerationDataClass[];

  return {
    id: canonical.id,
    catalogRevision: requireRouteRevision(
      product?.catalogRevision ?? canonical.catalogRevisionId,
      'catalogRevision',
      revisionMode,
      RECORDED_REVISION_DEFAULTS.catalog,
    ),
    policyRevision: requireRouteRevision(
      product?.policyRevision ?? canonical.policyRevisionId,
      'policyRevision',
      revisionMode,
      RECORDED_REVISION_DEFAULTS.policy,
    ),
    priceRevision: requireRouteRevision(
      product?.priceRevision ?? canonical.priceRevisionId,
      'priceRevision',
      revisionMode,
      RECORDED_REVISION_DEFAULTS.price,
    ),
    requestedCatalogModelId:
      product?.requestedCatalogModelId ??
      canonical.requestedCatalogModelId ??
      canonical.catalogModelId,
    selectionMode,
    dataClass,
    dataClasses,
    fallbackConsent:
      product?.fallbackConsent ?? canonical.fallbackConsent ?? false,
    maxAttempts: product?.maxAttempts ?? canonical.maxAttempts,
    fallbackAuthorized:
      product?.fallbackAuthorized ?? canonical.fallbackAuthorized,
    allowedCandidates: canonical.allowedCandidates.map((candidate) =>
      toFoundationCandidate(candidate, revisionMode),
    ),
    // F-S2-03: persist top-level dataPolicy/sourceKind on foundation checkpoint.
    dataPolicyRevisionId: canonical.dataPolicyRevisionId,
    sourceKind: canonical.sourceKind,
    retryOwner: product?.retryOwner ?? 'product',
    providerRetryDisabled: product?.providerRetryDisabled ?? true,
  };
}

// ---------------------------------------------------------------------------
// Ledger converters (shape 4 — snapshot conversion only)
// ---------------------------------------------------------------------------

export interface ModelSupplyLedgerRouteInput {
  snapshot: ModelSupplyRouteSnapshot;
  model: Pick<CatalogModel, 'id'>;
  deployment: ModelDeployment;
  submission: Pick<ModelSupplySubmission, 'selection' | 'dataClass'>;
  ordinal: number;
  /** F-S2-05: production fail-closed vs harness recorded defaults. */
  revisionMode?: RouteRevisionMode;
}

/**
 * model-supply rich snapshot + deployment → foundation checkpoint.
 * Replaces the hand-built object in foundation-ledger.ts.
 */
export function modelSupplyCheckpointToFoundationRoute(
  input: ModelSupplyLedgerRouteInput,
): FoundationRouteCheckpoint {
  const base = fromModelSupplyRouteSnapshot(input.snapshot);
  // Every provider attempt for one frozen route reuses the same Foundation
  // snapshot id. Keep route-level evidence anchored to the frozen candidate
  // order instead of rewriting it to the current attempt channel.
  const sourceKind =
    base.sourceKind ?? channelToSourceKind(input.deployment.channel);

  // Match prior ledger behavior: prefer frozen allowedCandidates; otherwise
  // synthesize a single candidate from the live deployment binding.
  const allowedCandidates = input.snapshot.allowedCandidates?.length
    ? base.allowedCandidates
    : [
        deploymentToCanonicalCandidate(
          input.deployment,
          input.model.id,
          input.ordinal,
          revisionMode,
        ),
      ];

  // F-S2-01: share resolveRoutePolicyRevisionId with adapter (route > policy > primary).
  const policyRevision = requireRouteRevision(
    resolveRoutePolicyRevisionId(input.snapshot, {
      policyRevision: input.deployment.policyRevision,
    }),
    'policyRevision',
    revisionMode,
    RECORDED_REVISION_DEFAULTS.policy,
  );
  const priceRevision = requireRouteRevision(
    input.snapshot.priceRevision ?? input.deployment.priceRevision,
    'priceRevision',
    revisionMode,
    RECORDED_REVISION_DEFAULTS.price,
  );

  const selectionMode =
    input.submission.selection.mode === 'auto' ? 'llm_auto' as const : 'fixed' as const;
  const requestedCatalogModelId =
    input.submission.selection.mode === 'auto'
      ? 'auto'
      : (input.submission.selection.catalogModelId ??
        input.snapshot.actualCatalogModelId);

  const dataClasses =
    input.submission.dataClass.length === 0
      ? (['public'] as GenerationDataClass[])
      : ([...input.submission.dataClass].sort() as GenerationDataClass[]);
  const dataClass = dataClasses[0] ?? 'public';

  const canonical: CanonicalRouteSnapshot = {
    ...base,
    catalogModelId: input.snapshot.actualCatalogModelId,
    requestedCatalogModelId,
    providerProfileId:
      input.snapshot.providerProfileId ?? input.deployment.providerProfileId,
    executionChannelId:
      input.snapshot.executionChannelId ?? input.deployment.executionChannelId,
    deploymentId: input.snapshot.deploymentId || input.deployment.id,
    actualDeploymentId: input.deployment.id,
    credentialAccountVersion:
      input.snapshot.credentialVersion ??
      input.deployment.credentialVersion ??
      allowedCandidates[0]?.credentialVersion,
    credentialMode:
      input.snapshot.credentialMode ??
      input.deployment.credentialMode ??
      'platform',
    policyRevisionId: policyRevision,
    priceRevisionId: priceRevision,
    endpointRevisionId:
      input.snapshot.endpointRevision ?? input.deployment.endpointRevision,
    catalogRevisionId: input.snapshot.catalogRevisionId,
    allowedCandidates,
    fallbackConsent: input.snapshot.fallbackConsent ?? false,
    maxAttempts: input.snapshot.maxAttempts,
    fallbackAuthorized: input.snapshot.fallbackAuthorized,
    fallbackChain: (input.snapshot.fallbackConsent ?? false)
      ? allowedCandidates.map((c) => c.deploymentId)
      : [input.deployment.id],
    sourceKind,
    selectionMode,
    primaryDataClass: dataClass,
    dataClasses,
  };

  return toFoundationRouteCheckpoint(canonical, {
    catalogRevision: input.snapshot.catalogRevisionId,
    policyRevision,
    priceRevision,
    requestedCatalogModelId,
    selectionMode,
    dataClass,
    dataClasses,
    fallbackConsent: canonical.fallbackConsent,
    retryOwner: 'product',
    providerRetryDisabled: true,
    revisionMode,
  });
}

export interface StrictByokLedgerRouteInput {
  idempotencyKey: string;
  workspaceId: string;
  endpointProfileId: string;
  catalogModelId: string;
  credentialVersion: number;
  region: 'cn' | 'global';
}

/**
 * Build the public StrictByokRouteSnapshot + foundation checkpoint together
 * so strict BYOK semantics stay aligned (single candidate, no-fallback chain).
 */
export function strictByokLedgerRouteSnapshots(
  input: StrictByokLedgerRouteInput,
): {
  publicSnapshot: StrictByokRouteSnapshot;
  foundationCheckpoint: FoundationRouteCheckpoint;
  canonical: CanonicalRouteSnapshot;
} {
  const publicSnapshot: StrictByokRouteSnapshot = {
    id: `${input.idempotencyKey}:route`,
    workspaceId: input.workspaceId,
    endpointProfileId: input.endpointProfileId,
    catalogModelId: input.catalogModelId,
    credentialMode: 'byok_strict',
    credentialVersion: input.credentialVersion,
    fallbackConsent: false,
  };

  const canonical = fromStrictByokRouteSnapshot(publicSnapshot, {
    region: input.region,
  });

  const foundationCheckpoint = toFoundationRouteCheckpoint(canonical, {
    catalogRevision: 'controlled-byok-endpoints-v1',
    policyRevision: 'byok-strict-no-fallback-v1',
    priceRevision: 'workspace-external-billing-v1',
    requestedCatalogModelId: input.catalogModelId,
    selectionMode: 'fixed',
    dataClass: 'public',
    dataClasses: ['public'],
    fallbackConsent: false,
    retryOwner: 'product',
    providerRetryDisabled: true,
  });

  return { publicSnapshot, foundationCheckpoint, canonical };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function rankFoundationCandidates(
  candidates: FoundationRouteCandidate[],
): CanonicalRouteCandidate[] {
  return candidates
    .map((candidate, index) => ({
      catalogModelId: candidate.catalogModelId,
      deploymentId: candidate.deploymentId,
      rank: candidate.fallbackRank ?? index + 1,
      region: candidate.region,
      credentialMode: candidate.credentialMode,
      credentialVersion: candidate.credentialVersion,
      ...(candidate.providerModel
        ? { providerModel: candidate.providerModel }
        : {}),
      ...(candidate.endpointRevision
        ? { endpointRevision: candidate.endpointRevision }
        : {}),
      ...(candidate.executionChannelId
        ? { executionChannelId: candidate.executionChannelId }
        : {}),
      ...(candidate.accountIdentity
        ? { accountIdentity: candidate.accountIdentity }
        : {}),
      ...(candidate.endpointFingerprint
        ? { endpointFingerprint: candidate.endpointFingerprint }
        : {}),
      ...(candidate.dataPolicyRevisionId
        ? { dataPolicyRevisionId: candidate.dataPolicyRevisionId }
        : {}),
      ...(candidate.lifecycleRevision
        ? { lifecycleRevision: candidate.lifecycleRevision }
        : {}),
      ...(candidate.policyRevision
        ? { policyRevision: candidate.policyRevision }
        : {}),
      ...(candidate.priceRevision
        ? { priceRevision: candidate.priceRevision }
        : {}),
      ...(candidate.unitPriceMicros !== undefined
        ? { unitPriceMicros: candidate.unitPriceMicros }
        : {}),
      ...(candidate.currency ? { currency: candidate.currency } : {}),
      ...(candidate.unit ? { unit: candidate.unit } : {}),
      ...(candidate.activationStatus
        ? { activationStatus: candidate.activationStatus }
        : {}),
    }))
    .sort((a, b) => a.rank - b.rank);
}

function modelSupplyCandidates(
  snapshot: ModelSupplyRouteSnapshot,
): CanonicalRouteCandidate[] {
  if (snapshot.allowedCandidates?.length) {
    return snapshot.allowedCandidates
      .map((candidate) => ({
        catalogModelId: candidate.catalogModelId,
        deploymentId: candidate.deploymentId,
        rank: candidate.fallbackRank,
        region:
          candidate.region === 'domestic' ? 'cn' : 'global',
        credentialMode: candidate.credentialMode,
        credentialVersion: candidate.credentialVersion,
        ...(candidate.providerProfileId
          ? { providerProfileId: candidate.providerProfileId }
          : {}),
        ...(candidate.executionChannelId
          ? { executionChannelId: candidate.executionChannelId }
          : {}),
        ...(candidate.accountIdentity
          ? { accountIdentity: candidate.accountIdentity }
          : {}),
        ...(candidate.endpointFingerprint
          ? { endpointFingerprint: candidate.endpointFingerprint }
          : {}),
        ...(candidate.dataPolicyRevisionId
          ? { dataPolicyRevisionId: candidate.dataPolicyRevisionId }
          : {}),
        ...(candidate.providerModel
          ? { providerModel: candidate.providerModel }
          : {}),
        ...(candidate.endpointRevision
          ? { endpointRevision: candidate.endpointRevision }
          : {}),
        ...(candidate.deploymentLifecycleRevision
          ? { lifecycleRevision: candidate.deploymentLifecycleRevision }
          : {}),
        policyRevision: candidate.policyRevision,
        priceRevision: candidate.priceRevision,
        unitPriceMicros: candidate.unitPriceMicros,
        currency: candidate.currency,
        unit: candidate.unit,
        ...(candidate.activationStatus
          ? { activationStatus: candidate.activationStatus }
          : {}),
        sourceKind: channelToSourceKind(candidate.channel),
      }))
      .sort((a, b) => a.rank - b.rank);
  }

  // Minimal single-candidate fallback when rich list is absent.
  return [
    {
      catalogModelId: snapshot.actualCatalogModelId,
      deploymentId: snapshot.deploymentId,
      rank: 1,
      credentialMode: snapshot.credentialMode,
      credentialVersion: snapshot.credentialVersion,
      ...(snapshot.providerProfileId
        ? { providerProfileId: snapshot.providerProfileId }
        : {}),
      ...(snapshot.executionChannelId
        ? { executionChannelId: snapshot.executionChannelId }
        : {}),
      ...(snapshot.providerModel
        ? { providerModel: snapshot.providerModel }
        : {}),
      ...(snapshot.endpointRevision
        ? { endpointRevision: snapshot.endpointRevision }
        : {}),
      ...(snapshot.deploymentLifecycleRevision
        ? { lifecycleRevision: snapshot.deploymentLifecycleRevision }
        : {}),
      ...(snapshot.policyRevision
        ? { policyRevision: snapshot.policyRevision }
        : {}),
      ...(snapshot.priceRevision
        ? { priceRevision: snapshot.priceRevision }
        : {}),
    },
  ];
}

function deploymentToCanonicalCandidate(
  deployment: ModelDeployment,
  catalogModelId: string,
  rank: number,
  revisionMode: RouteRevisionMode = resolveRouteRevisionMode(),
): CanonicalRouteCandidate {
  return {
    catalogModelId,
    deploymentId: deployment.id,
    rank,
    region: deployment.region === 'domestic' ? 'cn' : 'global',
    credentialMode: deployment.credentialMode ?? 'platform',
    credentialVersion: requireRouteRevision(
      deployment.credentialVersion,
      'credentialVersion',
      revisionMode,
      RECORDED_REVISION_DEFAULTS.credential,
    ),
    ...(deployment.providerProfileId
      ? { providerProfileId: deployment.providerProfileId }
      : {}),
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
    policyRevision: requireRouteRevision(
      deployment.policyRevision,
      'policyRevision',
      revisionMode,
      RECORDED_REVISION_DEFAULTS.policy,
    ),
    priceRevision: requireRouteRevision(
      deployment.priceRevision,
      'priceRevision',
      revisionMode,
      RECORDED_REVISION_DEFAULTS.price,
    ),
    unitPriceMicros: deployment.unitPrice?.amountMicros ?? 0,
    currency:
      deployment.unitPrice?.currency ??
      (deployment.region === 'domestic' ? 'CNY' : 'USD'),
    unit: deployment.unitPrice?.unit ?? 'request',
    ...(deployment.activationEvidence
      ? { activationStatus: deployment.activationEvidence.status }
      : {}),
    sourceKind: channelToSourceKind(deployment.channel),
  };
}

function toFoundationCandidate(
  candidate: CanonicalRouteCandidate,
  revisionMode: RouteRevisionMode = resolveRouteRevisionMode(),
): FoundationRouteCandidate {
  const region =
    candidate.region === 'cn' || candidate.region === 'global'
      ? candidate.region
      : candidate.region === 'domestic'
        ? ('cn' as const)
        : ('global' as const);

  return {
    catalogModelId: candidate.catalogModelId,
    deploymentId: candidate.deploymentId,
    region,
    credentialMode: candidate.credentialMode ?? 'platform',
    credentialVersion: requireRouteRevision(
      candidate.credentialVersion,
      'credentialVersion',
      revisionMode,
      RECORDED_REVISION_DEFAULTS.credential,
    ),
    ...(candidate.providerModel
      ? { providerModel: candidate.providerModel }
      : {}),
    ...(candidate.endpointRevision
      ? { endpointRevision: candidate.endpointRevision }
      : {}),
    ...(candidate.executionChannelId
      ? { executionChannelId: candidate.executionChannelId }
      : {}),
    ...(candidate.accountIdentity
      ? { accountIdentity: candidate.accountIdentity }
      : {}),
    ...(candidate.endpointFingerprint
      ? { endpointFingerprint: candidate.endpointFingerprint }
      : {}),
    ...(candidate.dataPolicyRevisionId
      ? { dataPolicyRevisionId: candidate.dataPolicyRevisionId }
      : {}),
    ...(candidate.lifecycleRevision
      ? { lifecycleRevision: candidate.lifecycleRevision }
      : {}),
    ...(candidate.policyRevision
      ? { policyRevision: candidate.policyRevision }
      : {}),
    ...(candidate.priceRevision
      ? { priceRevision: candidate.priceRevision }
      : {}),
    ...(candidate.unitPriceMicros !== undefined
      ? { unitPriceMicros: candidate.unitPriceMicros }
      : {}),
    ...(candidate.currency ? { currency: candidate.currency } : {}),
    ...(candidate.unit ? { unit: candidate.unit } : {}),
    fallbackRank: candidate.rank,
    ...(candidate.activationStatus
      ? { activationStatus: candidate.activationStatus }
      : {}),
  };
}

/** Map legacy model-supply channel enum onto SupplyChannelKind. */
export function channelToSourceKind(
  channel: ModelSupplyChannel | string | null | undefined,
): SupplyChannelKind | undefined {
  if (!channel) return undefined;
  if (channel === 'direct' || channel === 'official_direct') {
    return 'official_direct';
  }
  if (
    channel === 'managed' ||
    channel === 'bifrost' ||
    channel === 'litellm' ||
    channel === 'upstream_reseller'
  ) {
    return 'upstream_reseller';
  }
  return undefined;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) {
        sorted[key] = stableValue(entry);
      }
    }
    return sorted;
  }
  return value;
}
