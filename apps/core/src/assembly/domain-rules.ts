import {
  ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
  CREDIT_PLAN_CONFIG_KEYS,
  NOTE_STYLE_CONFIG_KEY,
} from '@meiye/contracts';
import type { Pool } from 'pg';
import {
  BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
  HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
  HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
  HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
  HARNESS_WOZ_RECIPE_CONFIG_KEY,
} from '../p1/admin-config/index.js';
import { AGENT_SEMANTIC_EVENT_ADAPTER_FLAG } from '../p1/agent-semantic-events/semantic-event-projector.js';
import {
  AGENT_MEMORY_FLAGS,
  AGENT_MEMORY_KILL_SWITCH_KEYS,
} from '../p1/operations/agent-memory-platform.js';
import {
  MAKE_STEERING_FLAG,
  MAKE_STEERING_KILL_SWITCH,
} from '../p1/agent-session/steering-service.js';
import { P1DomainError } from '../p1/foundation/index.js';
import {
  type ActivationEvidence,
  isLiveVerifiedActivationEvidence,
  type modelAssetStorageFromEnv,
} from '../p1/model-supply/index.js';
import {
  PLATFORM_DEFAULT_MODEL_CONFIG_KEYS,
  platformDefaultModelConfigName,
  type PlatformDefaultModelPort,
} from '../p1/foundation/workspace-provision.js';

const COMPLIANCE_CONFIG_KEYS = [
  'compliance.aigc_label.default',
  'compliance.regulated_mode.default',
  'compliance.watermark.default',
] as const;

const SHARED_HOT_AND_WIRED_CONFIG_KEYS = [
  ASSET_INTAKE_GUIDANCE_CONFIG_KEY,
  DUE_DELIVERY_RETENTION_DAYS_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_HOLD_TIMEOUT_CONFIG_KEY,
  HARNESS_CONFIRMATION_CARD_TIMEOUT_CONFIG_KEY,
  HARNESS_LANGFUSE_OUTBOX_CONFIG_KEY,
  HARNESS_RESERVATION_SWEEP_TTL_CONFIG_KEY,
  HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
  HARNESS_WOZ_RECIPE_CONFIG_KEY,
  BOUNDED_EXECUTION_LIVE_CALIBRATION_CONFIG_KEY,
  BOUNDED_EXECUTION_LIMITS_CONFIG_KEY,
  NOTE_STYLE_CONFIG_KEY,
  // V31-03: Semantic event adapter flag (hot-read by shadow dual-write reader).
  AGENT_SEMANTIC_EVENT_ADAPTER_FLAG,
  // V31-18: Memory platform flags + kill switches (hot-read by AgentMemoryPlatform).
  AGENT_MEMORY_FLAGS.read,
  AGENT_MEMORY_FLAGS.candidateWrite,
  AGENT_MEMORY_KILL_SWITCH_KEYS.disableWrite,
  AGENT_MEMORY_KILL_SWITCH_KEYS.disableRead,
  // V31-16: Make steering flag + kill switch (hot-read by SteeringService).
  MAKE_STEERING_FLAG,
  MAKE_STEERING_KILL_SWITCH,
  // Settlement hot-reads this key on every paid grant; no process-boot default.
  // Unwritten projection may leave effectiveValue empty (#371 / Spec C §支付映射).
  'plan.payment-mapping',
  ...CREDIT_PLAN_CONFIG_KEYS,
  ...PLATFORM_DEFAULT_MODEL_CONFIG_KEYS.map(platformDefaultModelConfigName),
  ...COMPLIANCE_CONFIG_KEYS,
] as const;

export const ADMIN_CONFIG_KEY_CLASSIFICATION = {
  hotReadKeys: SHARED_HOT_AND_WIRED_CONFIG_KEYS,
  wiredKeys: [
    ...SHARED_HOT_AND_WIRED_CONFIG_KEYS,
    'byok.adapter.assembly',
    'model.execution.mode',
    'model.media.execution.mode',
  ],
  readOnlyKeys: ['plan.addons', 'plan.trial.enabled'],
} as const;

export function assertAdminConfigKeyConsistency(
  classification: {
    hotReadKeys: readonly string[];
    wiredKeys: readonly string[];
    readOnlyKeys: readonly string[];
  } = ADMIN_CONFIG_KEY_CLASSIFICATION
) {
  const wired = new Set(classification.wiredKeys);
  const readOnly = new Set(classification.readOnlyKeys);
  const missingWiring = classification.hotReadKeys.filter(
    (key) => !wired.has(key)
  );
  const conflicting = classification.wiredKeys.filter((key) => readOnly.has(key));
  if (missingWiring.length > 0 || conflicting.length > 0) {
    throw new Error(
      `Admin config key classification drifted: missing wiring [${missingWiring.join(
        ', '
      )}], wired/read-only conflicts [${conflicting.join(', ')}].`
    );
  }
}

type PlatformDefaultOperation = Parameters<
  PlatformDefaultModelPort['validateDefault']
>[0];

export async function validatePlatformDefaultModel(input: {
  operation: PlatformDefaultOperation;
  modelId: string;
  models: readonly {
    id: string;
    operations: readonly string[];
  }[];
  deployments: readonly {
    id: string;
    catalogModelId: string;
    status: string;
    credentialMode?: string;
    credentialOwner?: string;
  }[];
  mode: string;
  fixtureDefaultModelIds: readonly string[];
  configurationRevisions: Readonly<Record<string, string>>;
  readActivationEvidence(deploymentId: string): Promise<ActivationEvidence | undefined>;
}) {
  const model = input.models.find(
    (candidate) =>
      candidate.id === input.modelId &&
      candidate.operations.includes(input.operation)
  );
  if (!model) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Platform default model ${input.modelId} does not support ${input.operation}.`
    );
  }
  const candidates = input.deployments.filter(
    (deployment) =>
      deployment.catalogModelId === input.modelId &&
      deployment.status === 'active' &&
      deployment.credentialMode !== 'byok_strict' &&
      deployment.credentialOwner !== 'workspace_byok'
  );
  if (
    input.mode === 'fixture' &&
    input.fixtureDefaultModelIds.includes(input.modelId) &&
    candidates.length > 0
  ) {
    return;
  }
  for (const deployment of candidates) {
    const configurationRevision = input.configurationRevisions[deployment.id];
    if (!configurationRevision) continue;
    const activationEvidence = await input.readActivationEvidence(deployment.id);
    if (
      isLiveVerifiedActivationEvidence(activationEvidence) &&
      activationEvidence?.configurationRevision === configurationRevision
    ) {
      return;
    }
  }
  throw new P1DomainError(
    'INVALID_STATE',
    `Platform default model ${input.modelId} is not live verified for ${input.operation}.`
  );
}

export function createMarketingIdentityReferenceResolver(drafts: {
  draftView(workspaceId: string, draftId: string, revision: number): Promise<{
    draftId: string;
    revision: number;
    target: string;
    origin: string;
    parsedDocumentId: string | null;
    fields: Array<{ key: string; value: unknown }>;
  }>;
}) {
  return {
    async resolve(input: {
      workspaceId: string;
      draftId: string;
      revision: number;
    }) {
      const draft = await drafts.draftView(
        input.workspaceId,
        input.draftId,
        input.revision
      );
      const summary = draft.fields.find(
        (field) => field.key === 'brand_reference.summary'
      );
      if (
        draft.target !== 'brand_reference' ||
        draft.origin !== 'parsed' ||
        !draft.parsedDocumentId ||
        typeof summary?.value !== 'string' ||
        !summary.value.trim()
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'The identity reference must be an exact parsed brand reference revision.'
        );
      }
      return {
        draftId: draft.draftId,
        draftRevision: draft.revision,
        parsedDocumentId: draft.parsedDocumentId,
        text: summary.value.trim(),
      };
    },
  };
}

export function createWriteOwnershipReader(pool: Pick<Pool, 'query'>) {
  return async (workspaceId: string) => {
    const result = await pool.query<{
      owner: 'legacy' | 'frozen' | 'p1';
    }>('SELECT owner FROM p1_write_ownership WHERE workspace_id = $1', [
      workspaceId,
    ]);
    return result.rows[0]?.owner ?? null;
  };
}

const READINESS_PROBE_WORKSPACE_ID = 'readiness-probe';
const READINESS_PROBE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=',
  'base64'
);

export async function probeObjectStorageReadWrite(
  storage: ReturnType<typeof modelAssetStorageFromEnv>
) {
  if (!storage.persistOwnedAsset) {
    throw new Error('Owned asset storage is unavailable for readiness probe.');
  }
  const persisted = await storage.persistOwnedAsset({
    bytes: READINESS_PROBE_BYTES,
    contentType: 'image/png',
    workspaceId: READINESS_PROBE_WORKSPACE_ID,
  });
  try {
    const stored = await storage.read(persisted.objectKey);
    if (
      stored.bytes.byteLength !== READINESS_PROBE_BYTES.byteLength ||
      stored.bytes.some(
        (byte, index) => byte !== READINESS_PROBE_BYTES[index]
      )
    ) {
      throw new Error(
        'Object storage returned different bytes than were written.'
      );
    }
  } finally {
    const deleteCached = (
      storage as { deleteCachedAsset?: (objectKey: string) => Promise<void> }
    ).deleteCachedAsset;
    await deleteCached?.call(storage, persisted.objectKey);
  }
}
