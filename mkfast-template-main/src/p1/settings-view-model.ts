import {
  durationEstimateSchema,
  type DurationEstimate,
} from '@meiye/contracts';

import {
  p1_admin_model_operation_audio_sfx,
  p1_admin_model_operation_audio_speech,
  p1_admin_model_operation_copy,
  p1_admin_model_operation_image_edit,
  p1_admin_model_operation_image_generate,
  p1_admin_model_operation_video,
  p1_model_manufacturer_domestic,
  p1_model_name_domestic_llm,
  p1_model_name_grok_latest,
  p1_model_name_kling_latest,
  p1_model_name_veo_latest,
  p1_model_unavailable_activation_evidence_missing,
  p1_model_unavailable_credential,
  p1_model_unavailable_not_open,
  p1_model_unavailable_region,
  p1_model_unavailable_retired,
} from '@/locale/paraglide/messages';

export type ModelOperation =
  | 'copy.generate'
  | 'copy.adapt'
  | 'image.generate'
  | 'image.edit'
  | 'video.generate'
  | 'audio.speech'
  | 'audio.sfx';

export type ModelModality = 'llm' | 'image' | 'video' | 'audio';

export interface CatalogModelView {
  id: string;
  displayName: string;
  modality: ModelModality;
  qualityRank: number;
  manufacturer?: string;
  stableModelName?: string;
  version?: string;
  capabilityLabels: string[];
  available: boolean;
  availabilityKind: 'local_fixture' | 'production' | 'unavailable';
  durationEstimate?: DurationEstimate;
  unavailableReason?: string;
  unitPrice?: {
    amountMicros: number;
    currency: 'CNY' | 'USD';
    revision: string;
    unit: string;
  };
}

export interface CatalogView {
  models: CatalogModelView[];
}

export function selectAvailableCatalogModel(catalog: CatalogView) {
  return catalog.models.find((model) => model.available);
}

export interface ModelPreferencesView {
  workspaceDefault?: string;
  userDefault?: string;
  favorites: string[];
  recent: string[];
}

export type IntegrationProvider = 'model' | 'douyin' | 'feishu';

export interface IntegrationConnectionView {
  id: string;
  provider: IntegrationProvider;
  identityMode: string;
  requestedCapabilities: string[];
  grantedCapabilities: string[];
  activeCapabilities: string[];
  qualifiedCapabilities: string[];
  degradedCapabilities: Record<string, string>;
  status: string;
  subject?: string;
  refreshReauthorizationReminder?: boolean;
  credential: {
    mask: '••••••••';
    scope: string[];
    status: string;
    version: number;
    expiresAt?: string;
    refreshExpiresAt?: string;
    lastUsedAt?: string;
  };
}

export interface DouyinIntegrationStatusView {
  provider: 'douyin';
  integrated: boolean;
  executionMode: 'recorded' | 'live';
}

export type DouyinPublishAnchorKind = 'poi' | 'mini_program';

export function eligibleDouyinPublishAnchorKinds(
  connection: IntegrationConnectionView
): DouyinPublishAnchorKind[] {
  const candidates = [
    ['publish.poi', 'poi'],
    ['publish.mini_program', 'mini_program'],
  ] as const;
  return candidates.flatMap(([capability, kind]) =>
    connection.grantedCapabilities.includes(capability) &&
    connection.activeCapabilities.includes(capability) &&
    connection.qualifiedCapabilities.includes(capability)
      ? [kind]
      : []
  );
}

export interface IntegrationAuditView {
  id: string;
  connectionId: string;
  action: string;
  actorId?: string;
  correlationId?: string;
  details?: {
    endpointProfileId?: string;
    catalogModelId?: string;
    usageStatus?: 'committed' | 'refunded' | 'reserved';
    credentialVersion?: number;
  };
  createdAt: string;
}

export interface FeishuToolView {
  id: string;
  revision: string;
  risk: 'read' | 'write' | 'destructive' | 'open_world';
  status: 'draft' | 'published' | 'retired';
  discoveredAt: string;
  publishedAt?: string;
}

export interface FeishuShortcutView {
  toolId: string;
  order: number;
  hidden: boolean;
}

export interface FeishuActivityView {
  id: string;
  toolId: string;
  status: 'completed' | 'failed' | 'unknown';
  executedAt: string;
  externalUrl?: string;
}

export interface FeishuPendingIntentView {
  id: string;
  toolId: string;
  sideEffect: 'read' | 'create' | 'edit' | 'send' | 'delete' | 'overwrite';
  status: 'confirmation_pending';
  fields: string[];
  createdAt: string;
  confirmationTaskId?: string;
}

export interface FeishuRecoveryIntentView {
  id: string;
  toolId: string;
  status: 'authorized' | 'executed' | 'failed' | 'unknown';
  effectState?: 'claimed' | 'settled' | 'reconciliation_required';
  outcomeStatus?: 'completed' | 'failed' | 'unknown';
  lastErrorCode?: string;
  reconciliationAttempts?: number;
  nextReconcileAt?: string;
  lastReconciledAt?: string;
  createdAt: string;
}

export function canReconcileFeishuIntent(intent: FeishuRecoveryIntentView) {
  return (
    intent.status === 'unknown' &&
    intent.effectState === 'reconciliation_required'
  );
}

export interface DouyinPublishJobView {
  id: string;
  confirmationId: string;
  status:
    | 'submitting'
    | 'submitted'
    | 'reviewing'
    | 'published'
    | 'failed'
    | 'unknown'
    | 'manual_required';
  effectState?: 'claimed' | 'settled' | 'reconciliation_required';
  acceptance?: 'rejected_before_accept' | 'accepted' | 'acceptance_unknown';
  itemId?: string;
  videoId?: string;
  lastErrorCode?: string;
  nextPollAt?: string;
  pollAttempts?: number;
  pollDeadlineAt?: string;
  pollingState?: 'scheduled' | 'exhausted' | 'completed';
  pollLimit?: number;
  updatedAt: string;
}

export interface DouyinObserveSnapshotView {
  externalId: string;
  platformTime: string;
  source: 'product' | 'external';
  observedAt: string;
  evidenceRevision: string;
  missingFieldCount: number;
}

export interface DouyinObserveStateView {
  status: 'available' | 'empty' | 'unavailable' | 'unknown';
  reason?: string;
  evidenceRevision: string;
  lastAttemptAt: string;
  lastSuccessfulAt?: string;
  nextSyncAt?: string;
}

export interface DouyinContentSnapshotView {
  id: string;
  revision: string;
  contentId: string;
  contentVersionId: string;
  artifactId: string;
  title: string;
  createdAt: string;
}

export interface DouyinOperationsSnapshotView {
  connectionId: string;
  contentSnapshots: DouyinContentSnapshotView[];
  publishJobs: DouyinPublishJobView[];
  observeSnapshots: DouyinObserveSnapshotView[];
  observeState?: DouyinObserveStateView;
  refreshedAt: string;
}

const MODEL_NAMES: Record<string, () => string> = {
  'gpt-image-2': () => 'GPT Image 2',
  'grok-latest-video': p1_model_name_grok_latest,
  'kling-latest': p1_model_name_kling_latest,
  'llm-anthropic': () => 'Anthropic Claude',
  'llm-domestic': p1_model_name_domestic_llm,
  'llm-gemini': () => 'Google Gemini',
  'llm-openai': () => 'OpenAI',
  'nano-banana-2': () => 'Nano Banana 2',
  'nano-banana-pro': () => 'Nano Banana Pro',
  'seedance-2': () => 'Seedance 2.0',
  'seedream-5-pro': () => 'Seedream 5.0 Pro',
  'veo-latest': p1_model_name_veo_latest,
};

const CAPABILITY_LABELS: Record<ModelOperation, () => string> = {
  'copy.adapt': p1_admin_model_operation_copy,
  'copy.generate': p1_admin_model_operation_copy,
  'image.edit': p1_admin_model_operation_image_edit,
  'image.generate': p1_admin_model_operation_image_generate,
  'video.generate': p1_admin_model_operation_video,
  'audio.speech': p1_admin_model_operation_audio_speech,
  'audio.sfx': p1_admin_model_operation_audio_sfx,
};

const UNAVAILABLE_REASON_LABELS: Record<string, () => string> = {
  activation_evidence_missing: p1_model_unavailable_activation_evidence_missing,
  credential_unavailable: p1_model_unavailable_credential,
  region_unavailable: p1_model_unavailable_region,
  retired: p1_model_unavailable_retired,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function safeHttpsUrl(value: unknown) {
  const candidate = string(value);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function modality(value: unknown, operations: string[]): ModelModality {
  if (
    value === 'llm' ||
    value === 'image' ||
    value === 'video' ||
    value === 'audio'
  )
    return value;
  if (operations.some((operation) => operation.startsWith('image.'))) {
    return 'image';
  }
  if (operations.some((operation) => operation.startsWith('video.'))) {
    return 'video';
  }
  if (operations.some((operation) => operation.startsWith('audio.'))) {
    return 'audio';
  }
  return 'llm';
}

function publicModelName(id: string, rawName: unknown) {
  if (MODEL_NAMES[id]) return MODEL_NAMES[id]();
  return string(rawName, id)
    .replace(/\s+(Direct|Managed)$/i, '')
    .trim();
}

function publicCatalogIdentifier(value: unknown, hiddenValues: string[] = []) {
  const candidate = string(value).trim();
  if (
    !candidate ||
    hiddenValues.includes(candidate) ||
    /^recorded(?:-|$)/i.test(candidate)
  ) {
    return '';
  }
  return candidate;
}

function publicManufacturer(value: unknown) {
  const candidate = publicCatalogIdentifier(value, ['Unknown manufacturer']);
  return candidate === 'Domestic provider'
    ? p1_model_manufacturer_domestic()
    : candidate;
}

function publicUnavailableReason(reason: unknown) {
  const raw = string(reason);
  return UNAVAILABLE_REASON_LABELS[raw]?.() ?? p1_model_unavailable_not_open();
}

function catalogPayload(value: unknown) {
  const outer = record(value);
  const payload = record(outer.payload);
  return Object.keys(payload).length > 0 ? payload : outer;
}

export function normalizeCatalog(
  value: unknown,
  operation: ModelOperation
): CatalogView {
  const payload = catalogPayload(value);
  const rawModels = Array.isArray(payload.models)
    ? payload.models
    : Array.isArray(value)
      ? value
      : [];
  const deployments = Array.isArray(payload.deployments)
    ? payload.deployments.map(record)
    : [];

  const models = rawModels
    .map(record)
    .filter((model) => {
      const operations = stringArray(model.operations);
      return operations.length === 0 || operations.includes(operation);
    })
    .map((model): CatalogModelView => {
      const id = string(model.id);
      const operations = stringArray(model.operations).filter(
        (candidate): candidate is ModelOperation =>
          candidate in CAPABILITY_LABELS
      );
      const matchingDeployments = deployments.filter(
        (deployment) => deployment.catalogModelId === id
      );
      const activeDeployment = matchingDeployments.find(
        (deployment) => deployment.status === 'active'
      );
      const availability = string(model.availability);
      const activationStatus = string(
        record(model.activationEvidence).status ||
          record(activeDeployment?.activationEvidence).status
      );
      const available =
        model.available === true ||
        (activationStatus === 'live_verified' &&
          (availability === 'available' ||
            activeDeployment?.status === 'active'));
      const availabilityKind = !available
        ? ('unavailable' as const)
        : availability === 'recorded' && activationStatus === 'recorded'
          ? ('local_fixture' as const)
          : ('production' as const);
      const rawReason =
        model.unavailableReason ??
        matchingDeployments.find((deployment) => deployment.unavailableReason)
          ?.unavailableReason ??
        (activationStatus !== 'live_verified'
          ? 'activation_evidence_missing'
          : undefined);
      const capabilityLabels =
        stringArray(model.capabilityLabels).length > 0
          ? stringArray(model.capabilityLabels)
          : operations.map((candidate) => CAPABILITY_LABELS[candidate]());
      const manufacturer = publicManufacturer(model.manufacturer);
      const stableModelName = publicCatalogIdentifier(model.stableModelName, [
        id,
      ]);
      const version = publicCatalogIdentifier(model.version, ['unspecified']);
      const rawUnitPrice = record(
        model.unitPrice ?? activeDeployment?.unitPrice
      );
      const amountMicros = rawUnitPrice.amountMicros;
      const currency = string(rawUnitPrice.currency);
      const normalizedCurrency: 'CNY' | 'USD' | undefined =
        currency === 'CNY' ? 'CNY' : currency === 'USD' ? 'USD' : undefined;
      const unit = string(rawUnitPrice.unit);
      const priceRevision = string(
        rawUnitPrice.revision ?? activeDeployment?.priceRevision
      );
      const unitPrice =
        typeof amountMicros === 'number' &&
        Number.isInteger(amountMicros) &&
        amountMicros >= 0 &&
        normalizedCurrency &&
        unit &&
        priceRevision
          ? {
              amountMicros,
              currency: normalizedCurrency,
              revision: priceRevision,
              unit,
            }
          : undefined;
      const durationEstimateResult = durationEstimateSchema.safeParse(
        model.durationEstimate
      );
      return {
        id,
        displayName: publicModelName(id, model.displayName),
        modality: modality(model.modality, operations),
        qualityRank:
          typeof model.qualityRank === 'number' ? model.qualityRank : 0,
        ...(manufacturer ? { manufacturer } : {}),
        ...(stableModelName ? { stableModelName } : {}),
        ...(version ? { version } : {}),
        capabilityLabels,
        available,
        availabilityKind,
        ...(durationEstimateResult.success
          ? { durationEstimate: durationEstimateResult.data }
          : {}),
        ...(unitPrice ? { unitPrice } : {}),
        ...(!available
          ? { unavailableReason: publicUnavailableReason(rawReason) }
          : {}),
      };
    })
    .filter((model) => model.id.length > 0);

  return { models };
}

export function normalizePreferences(value: unknown): ModelPreferencesView {
  const payload = record(value);
  const workspaceDefault = string(payload.workspaceDefault);
  const userDefault = string(payload.userDefault);
  return {
    ...(workspaceDefault ? { workspaceDefault } : {}),
    ...(userDefault ? { userDefault } : {}),
    favorites: stringArray(payload.favorites),
    recent: stringArray(payload.recent),
  };
}

function provider(value: unknown): IntegrationProvider | undefined {
  return value === 'model' || value === 'douyin' || value === 'feishu'
    ? value
    : undefined;
}

export function normalizeConnections(
  value: unknown
): IntegrationConnectionView[] {
  const outer = record(value);
  const rawConnections = Array.isArray(value)
    ? value
    : Array.isArray(outer.connections)
      ? outer.connections
      : [];

  return rawConnections
    .map(record)
    .flatMap((connection) => {
      const normalizedProvider = provider(connection.provider);
      if (!normalizedProvider) return [];
      const credential = record(connection.credential);
      const evidence = record(connection.capabilityEvidence);
      const degradedCapabilities = Object.fromEntries(
        Object.entries(record(connection.degradedCapabilities)).flatMap(
          ([key, reason]) => (typeof reason === 'string' ? [[key, reason]] : [])
        )
      );
      const subject = string(connection.subject);
      const expiresAt = string(credential.expiresAt);
      const refreshExpiresAt = string(credential.refreshExpiresAt);
      const lastUsedAt = string(credential.lastUsedAt);
      const grantedCapabilities = stringArray(connection.grantedCapabilities);
      const activeCapabilities = Object.keys(evidence).filter(
        (capability) =>
          grantedCapabilities.includes(capability) &&
          !degradedCapabilities[capability]
      );
      return [
        {
          id: string(connection.id),
          provider: normalizedProvider,
          identityMode: string(connection.identityMode),
          requestedCapabilities: stringArray(connection.requestedCapabilities),
          grantedCapabilities,
          activeCapabilities,
          qualifiedCapabilities: activeCapabilities.filter(
            (capability) => record(evidence[capability]).qualified === true
          ),
          degradedCapabilities,
          status: string(connection.status, 'disabled'),
          ...(subject ? { subject } : {}),
          ...(connection.refreshReauthorizationReminder === true
            ? { refreshReauthorizationReminder: true }
            : {}),
          credential: {
            mask: '••••••••' as const,
            scope: stringArray(credential.scope),
            status: string(credential.status, 'unverified'),
            version:
              typeof credential.version === 'number' ? credential.version : 0,
            ...(expiresAt ? { expiresAt } : {}),
            ...(refreshExpiresAt ? { refreshExpiresAt } : {}),
            ...(lastUsedAt ? { lastUsedAt } : {}),
          },
        },
      ];
    })
    .filter((connection) => connection.id.length > 0);
}

export function normalizeDouyinIntegrationStatus(
  value: unknown
): DouyinIntegrationStatusView {
  const payload = record(value);
  const executionMode =
    payload.executionMode === 'live'
      ? ('live' as const)
      : ('recorded' as const);
  return {
    provider: 'douyin',
    integrated: executionMode === 'live' && payload.integrated === true,
    executionMode,
  };
}

export function normalizeIntegrationAudit(
  value: unknown
): IntegrationAuditView[] {
  const outer = record(value);
  const rawEvents = Array.isArray(value)
    ? value
    : Array.isArray(outer.events)
      ? outer.events
      : [];
  return rawEvents.map(record).flatMap((event) => {
    const id = string(event.id);
    if (!id) return [];
    const action = string(event.action);
    const actorId = string(event.actorId);
    const correlationId = string(event.correlationId);
    const rawDetails = record(event.details);
    const endpointProfileId = string(rawDetails.endpointProfileId);
    const catalogModelId = string(rawDetails.catalogModelId);
    const usageStatusRaw = rawDetails.usageStatus;
    const usageStatus =
      usageStatusRaw === 'committed' ||
      usageStatusRaw === 'refunded' ||
      usageStatusRaw === 'reserved'
        ? usageStatusRaw
        : undefined;
    const credentialVersion = rawDetails.credentialVersion;
    const details: IntegrationAuditView['details'] = action.startsWith('byok.')
      ? {
          ...(endpointProfileId ? { endpointProfileId } : {}),
          ...(catalogModelId ? { catalogModelId } : {}),
          ...(usageStatus ? { usageStatus } : {}),
          ...(typeof credentialVersion === 'number' &&
          Number.isSafeInteger(credentialVersion) &&
          credentialVersion >= 0
            ? { credentialVersion }
            : {}),
        }
      : undefined;
    return [
      {
        id,
        connectionId: string(event.connectionId),
        action,
        ...(actorId ? { actorId } : {}),
        ...(correlationId ? { correlationId } : {}),
        ...(details && Object.keys(details).length > 0 ? { details } : {}),
        createdAt: string(event.createdAt),
      },
    ];
  });
}

export function normalizeFeishuTools(value: unknown): FeishuToolView[] {
  const outer = record(value);
  const input = Array.isArray(value)
    ? value
    : Array.isArray(outer.tools)
      ? outer.tools
      : [];
  return input.map(record).flatMap((tool) => {
    const id = string(tool.id);
    const revision = string(tool.revision);
    const risk = tool.risk;
    const status = tool.status;
    if (
      !id ||
      !revision ||
      !['read', 'write', 'destructive', 'open_world'].includes(String(risk)) ||
      !['draft', 'published', 'retired'].includes(String(status))
    ) {
      return [];
    }
    const publishedAt = string(tool.publishedAt);
    return [
      {
        discoveredAt: string(tool.discoveredAt),
        id,
        ...(publishedAt ? { publishedAt } : {}),
        revision,
        risk: risk as FeishuToolView['risk'],
        status: status as FeishuToolView['status'],
      },
    ];
  });
}

export function normalizeFeishuShortcuts(value: unknown): FeishuShortcutView[] {
  const outer = record(value);
  const input = Array.isArray(value)
    ? value
    : Array.isArray(outer.shortcuts)
      ? outer.shortcuts
      : [];
  return input
    .map(record)
    .flatMap((shortcut): FeishuShortcutView[] => {
      const toolId = string(shortcut.toolId);
      if (!toolId || typeof shortcut.order !== 'number') return [];
      return [
        {
          hidden: shortcut.hidden === true,
          order: shortcut.order,
          toolId,
        },
      ];
    })
    .sort((left, right) => left.order - right.order);
}

export function normalizeFeishuActivity(value: unknown): FeishuActivityView[] {
  const outer = record(value);
  const input = Array.isArray(value)
    ? value
    : Array.isArray(outer.activities)
      ? outer.activities
      : [];
  return input.map(record).flatMap((activity) => {
    const id = string(activity.id);
    const toolId = string(activity.toolId);
    const status = activity.status;
    if (
      !id ||
      !toolId ||
      !['completed', 'failed', 'unknown'].includes(String(status))
    ) {
      return [];
    }
    const externalUrl = safeHttpsUrl(activity.externalUrl);
    return [
      {
        executedAt: string(activity.executedAt),
        ...(externalUrl ? { externalUrl } : {}),
        id,
        status: status as FeishuActivityView['status'],
        toolId,
      },
    ];
  });
}

export function normalizeFeishuPendingIntents(
  value: unknown
): FeishuPendingIntentView[] {
  const outer = record(value);
  const input = Array.isArray(value)
    ? value
    : Array.isArray(outer.intents)
      ? outer.intents
      : [];
  return input.map(record).flatMap((intent) => {
    const id = string(intent.id);
    const toolId = string(intent.toolId);
    const sideEffect = intent.sideEffect;
    if (
      !id ||
      !toolId ||
      intent.status !== 'confirmation_pending' ||
      !['read', 'create', 'edit', 'send', 'delete', 'overwrite'].includes(
        String(sideEffect)
      )
    ) {
      return [];
    }
    const confirmationTaskId = string(intent.confirmationTaskId);
    return [
      {
        confirmationTaskId: confirmationTaskId || undefined,
        createdAt: string(intent.createdAt),
        fields: stringArray(intent.fields),
        id,
        sideEffect: sideEffect as FeishuPendingIntentView['sideEffect'],
        status: 'confirmation_pending' as const,
        toolId,
      },
    ];
  });
}

export function normalizeFeishuRecoveryIntents(
  value: unknown
): FeishuRecoveryIntentView[] {
  const outer = record(value);
  const input = Array.isArray(value)
    ? value
    : Array.isArray(outer.intents)
      ? outer.intents
      : [];
  return input.map(record).flatMap((intent) => {
    const id = string(intent.id);
    const toolId = string(intent.toolId);
    const status = intent.status;
    if (
      !id ||
      !toolId ||
      !['authorized', 'executed', 'failed', 'unknown'].includes(String(status))
    ) {
      return [];
    }
    const effectState = intent.effectState;
    const outcomeStatus = intent.outcomeStatus;
    const lastErrorCode = string(intent.lastErrorCode);
    const nextReconcileAt = string(intent.nextReconcileAt);
    const lastReconciledAt = string(intent.lastReconciledAt);
    return [
      {
        createdAt: string(intent.createdAt),
        ...(effectState === 'claimed' ||
        effectState === 'settled' ||
        effectState === 'reconciliation_required'
          ? { effectState }
          : {}),
        id,
        ...(lastErrorCode ? { lastErrorCode } : {}),
        ...(lastReconciledAt ? { lastReconciledAt } : {}),
        ...(nextReconcileAt ? { nextReconcileAt } : {}),
        ...(typeof intent.reconciliationAttempts === 'number'
          ? { reconciliationAttempts: intent.reconciliationAttempts }
          : {}),
        ...(outcomeStatus === 'completed' ||
        outcomeStatus === 'failed' ||
        outcomeStatus === 'unknown'
          ? { outcomeStatus }
          : {}),
        status: status as FeishuRecoveryIntentView['status'],
        toolId,
      },
    ];
  });
}

export function normalizeDouyinOperationsSnapshot(
  value: unknown
): DouyinOperationsSnapshotView {
  const payload = record(value);
  const publishJobs = (
    Array.isArray(payload.publishJobs) ? payload.publishJobs : []
  )
    .map(record)
    .flatMap((job): DouyinPublishJobView[] => {
      const id = string(job.id);
      const confirmationId = string(job.confirmationId);
      const status = job.status;
      if (
        !id ||
        !confirmationId ||
        ![
          'submitting',
          'submitted',
          'reviewing',
          'published',
          'failed',
          'unknown',
          'manual_required',
        ].includes(String(status))
      ) {
        return [];
      }
      const effectState = job.effectState;
      const acceptance = job.acceptance;
      const itemId = string(job.itemId);
      const videoId = string(job.videoId);
      const lastErrorCode = string(job.lastErrorCode);
      const pollingState = job.pollingState;
      return [
        {
          ...(acceptance === 'rejected_before_accept' ||
          acceptance === 'accepted' ||
          acceptance === 'acceptance_unknown'
            ? { acceptance }
            : {}),
          confirmationId,
          ...(effectState === 'claimed' ||
          effectState === 'settled' ||
          effectState === 'reconciliation_required'
            ? { effectState }
            : {}),
          id,
          ...(itemId ? { itemId } : {}),
          ...(lastErrorCode ? { lastErrorCode } : {}),
          ...(string(job.nextPollAt)
            ? { nextPollAt: string(job.nextPollAt) }
            : {}),
          ...(typeof job.pollAttempts === 'number'
            ? { pollAttempts: job.pollAttempts }
            : {}),
          ...(string(job.pollDeadlineAt)
            ? { pollDeadlineAt: string(job.pollDeadlineAt) }
            : {}),
          ...(pollingState === 'scheduled' ||
          pollingState === 'exhausted' ||
          pollingState === 'completed'
            ? { pollingState }
            : {}),
          ...(typeof job.pollLimit === 'number'
            ? { pollLimit: job.pollLimit }
            : {}),
          status: status as DouyinPublishJobView['status'],
          updatedAt: string(job.updatedAt),
          ...(videoId ? { videoId } : {}),
        },
      ];
    });
  const observeSnapshots = (
    Array.isArray(payload.observeSnapshots) ? payload.observeSnapshots : []
  )
    .map(record)
    .flatMap((snapshot): DouyinObserveSnapshotView[] => {
      const externalId = string(snapshot.externalId);
      const source = snapshot.source;
      if (!externalId || (source !== 'product' && source !== 'external')) {
        return [];
      }
      return [
        {
          evidenceRevision: string(snapshot.evidenceRevision),
          externalId,
          missingFieldCount: Object.keys(record(snapshot.missingReasons))
            .length,
          observedAt: string(snapshot.observedAt),
          platformTime: string(snapshot.platformTime),
          source,
        },
      ];
    });
  const rawObserveState = record(payload.observeState);
  const observeStatus = rawObserveState.status;
  const observeState = [
    'available',
    'empty',
    'unavailable',
    'unknown',
  ].includes(String(observeStatus))
    ? {
        evidenceRevision: string(rawObserveState.evidenceRevision),
        lastAttemptAt: string(rawObserveState.lastAttemptAt),
        ...(string(rawObserveState.lastSuccessfulAt)
          ? { lastSuccessfulAt: string(rawObserveState.lastSuccessfulAt) }
          : {}),
        ...(string(rawObserveState.nextSyncAt)
          ? { nextSyncAt: string(rawObserveState.nextSyncAt) }
          : {}),
        ...(string(rawObserveState.reason)
          ? { reason: string(rawObserveState.reason) }
          : {}),
        status: observeStatus as DouyinObserveStateView['status'],
      }
    : undefined;
  return {
    connectionId: string(payload.connectionId),
    contentSnapshots: [],
    observeSnapshots,
    ...(observeState ? { observeState } : {}),
    publishJobs,
    refreshedAt: string(payload.refreshedAt),
  };
}

export function normalizeDouyinContentSnapshots(
  value: unknown
): DouyinContentSnapshotView[] {
  return (Array.isArray(value) ? value : [])
    .map(record)
    .flatMap((snapshot): DouyinContentSnapshotView[] => {
      const id = string(snapshot.id);
      const revision = string(snapshot.revision);
      const contentId = string(snapshot.contentId);
      const contentVersionId = string(snapshot.contentVersionId);
      const artifactId = string(snapshot.artifactId);
      const title = string(snapshot.title);
      const createdAt = string(snapshot.createdAt);
      if (
        !id ||
        !revision ||
        !contentId ||
        !contentVersionId ||
        !artifactId ||
        !title ||
        !createdAt
      ) {
        return [];
      }
      return [
        {
          artifactId,
          contentId,
          contentVersionId,
          createdAt,
          id,
          revision,
          title,
        },
      ];
    });
}
