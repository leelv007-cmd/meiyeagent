/**
 * D-044 compatibility under the expanded supply registry:
 *  - verified-workspace provisioning writes platform default model preferences
 *  - preferences must reference platform-global activation evidence
 *  - strict BYOK overrides platform defaults and never shares credentials
 *
 * This port is domain-only (Z2-WIRING owns process wiring).
 */
import type { ActivationEvidenceStatus } from '@meiye/contracts';
import {
  PLATFORM_DEFAULT_MODEL_CONFIG_KEY_BY_OPERATION,
  PLATFORM_DEFAULT_MODEL_OPERATION_BY_CONFIG_KEY,
  type PlatformDefaultModelConfigKey,
  type PlatformDefaultModelOperation,
  type PlatformDefaultModelPort,
} from '../foundation/workspace-provision.js';
import type { ExpandedSupplyRegistrySnapshot } from './expand.js';

export type CredentialScope = 'platform' | 'workspace_byok';

export interface PlatformDefaultBinding {
  configKey: PlatformDefaultModelConfigKey;
  operation: PlatformDefaultModelOperation;
  catalogModelId: string;
  deploymentId: string;
  activationEvidenceStatus: ActivationEvidenceStatus;
  /** Always platform for D-044 defaults — never workspace_byok. */
  credentialScope: 'platform';
  activationEvidenceRef?: string;
  configurationRevision?: string;
  verifiedAt?: string;
}

export interface ByokOverride {
  workspaceId: string;
  catalogModelId: string;
  credentialScope: 'workspace_byok';
  credentialAccountId: string;
}

// The config-key ↔ operation table is canonical in foundation/workspace-provision
// (#240①). Re-declaring it here is how the two halves drift apart.
const OPERATION_BY_CONFIG_KEY = PLATFORM_DEFAULT_MODEL_OPERATION_BY_CONFIG_KEY;
const CONFIG_KEY_BY_OPERATION = PLATFORM_DEFAULT_MODEL_CONFIG_KEY_BY_OPERATION;

/**
 * Narrow a full defaults snapshot to the single operation being resolved.
 *
 * Callers that resolve one operation must not carry the other modalities'
 * defaults into the resolution: `resolvePlatformDefaultBindings` reports an
 * error per unusable default, so an image default without activation evidence
 * would otherwise reject a copy request. Returns an empty map for operations
 * that have no platform default at all, which resolves to no binding.
 */
export function platformDefaultsForOperation(
  defaults: Partial<Record<PlatformDefaultModelConfigKey, string>>,
  operation: PlatformDefaultModelOperation | string,
): Partial<Record<PlatformDefaultModelConfigKey, string>> {
  const configKey = (
    CONFIG_KEY_BY_OPERATION as Partial<
      Record<string, PlatformDefaultModelConfigKey>
    >
  )[operation];
  if (!configKey) return {};
  const catalogModelId = defaults[configKey];
  return catalogModelId ? { [configKey]: catalogModelId } : {};
}

/**
 * Resolve platform default bindings from the expanded registry. Only
 * platform-owned deployments with activation evidence qualify.
 */
export function resolvePlatformDefaultBindings(
  snapshot: ExpandedSupplyRegistrySnapshot,
  defaults: Partial<Record<PlatformDefaultModelConfigKey, string>>,
): {
  bindings: PlatformDefaultBinding[];
  errors: string[];
} {
  const bindings: PlatformDefaultBinding[] = [];
  const errors: string[] = [];
  const modelById = new Map(snapshot.models.map((m) => [m.id, m]));
  const deploymentsByModel = new Map<string, typeof snapshot.deployments>();
  for (const deployment of snapshot.deployments) {
    const list = deploymentsByModel.get(deployment.catalogModelId) ?? [];
    list.push(deployment);
    deploymentsByModel.set(deployment.catalogModelId, list);
  }
  const channelById = new Map(
    snapshot.executionChannels.map((c) => [c.id, c]),
  );

  for (const configKey of Object.keys(defaults) as PlatformDefaultModelConfigKey[]) {
    const catalogModelId = defaults[configKey]?.trim();
    if (!catalogModelId) continue;
    const operation = OPERATION_BY_CONFIG_KEY[configKey];
    const model = modelById.get(catalogModelId);
    if (!model) {
      errors.push(
        `Platform default model ${configKey}=${catalogModelId} is not in the supply registry.`,
      );
      continue;
    }
    if (!model.operations.includes(operation)) {
      errors.push(
        `Platform default model ${catalogModelId} does not support ${operation}.`,
      );
      continue;
    }
    const candidates = (deploymentsByModel.get(catalogModelId) ?? []).filter(
      (deployment) => {
        const channel = channelById.get(deployment.executionChannelId);
        return (
          channel?.accountOwnership === 'platform' &&
          Boolean(deployment.activationEvidence)
        );
      },
    );
    // Prefer live_verified platform deployment; else any platform with evidence.
    const chosen =
      candidates.find(
        (d) => d.activationEvidence?.status === 'live_verified',
      ) ??
      candidates.find((d) => d.lifecycleStatus === 'active') ??
      candidates[0];
    if (!chosen || !chosen.activationEvidence) {
      errors.push(
        `Platform default model ${catalogModelId} has no platform-global activation evidence.`,
      );
      continue;
    }
    bindings.push({
      configKey,
      operation,
      catalogModelId,
      deploymentId: chosen.id,
      activationEvidenceStatus: chosen.activationEvidence.status,
      credentialScope: 'platform',
      ...(chosen.activationEvidence.evidenceRef
        ? { activationEvidenceRef: chosen.activationEvidence.evidenceRef }
        : {}),
      ...(chosen.activationEvidence.configurationRevision
        ? {
            configurationRevision:
              chosen.activationEvidence.configurationRevision,
          }
        : {}),
      ...(chosen.activationEvidence.verifiedAt
        ? { verifiedAt: chosen.activationEvidence.verifiedAt }
        : {}),
    });
  }

  return { bindings, errors };
}

/**
 * PlatformDefaultModelPort backed by the expanded supply registry.
 * validateDefault enforces platform-global activation evidence (D-044).
 */
export function createRegistryPlatformDefaultModelPort(input: {
  snapshot: ExpandedSupplyRegistrySnapshot;
  defaults: Partial<Record<PlatformDefaultModelConfigKey, string>>;
  /** Require live_verified for validateDefault (production posture). */
  requireLiveVerified?: boolean;
}): PlatformDefaultModelPort & {
  getBindings(): PlatformDefaultBinding[];
  getWorkspaceDefaults(): Map<string, Map<PlatformDefaultModelOperation, string>>;
} {
  const workspaceDefaults = new Map<
    string,
    Map<PlatformDefaultModelOperation, string>
  >();
  const requireLive = input.requireLiveVerified ?? true;

  const port = {
    async getSnapshot() {
      return Object.fromEntries(
        Object.entries(input.defaults).map(([configKey, catalogModelId]) => [
          configKey,
          {
            catalogModelId,
            configRevision: `supply-registry:${catalogModelId}`,
          },
        ]),
      );
    },
    async validateDefault(
      operation: PlatformDefaultModelOperation,
      modelId: string,
    ) {
      const configKey = CONFIG_KEY_BY_OPERATION[operation];
      const { bindings, errors } = resolvePlatformDefaultBindings(
        input.snapshot,
        { [configKey]: modelId },
      );
      if (errors.length > 0) {
        throw new Error(errors[0]);
      }
      const binding = bindings[0];
      if (!binding) {
        throw new Error(
          `Platform default model ${modelId} is not live verified.`,
        );
      }
      if (binding.credentialScope !== 'platform') {
        throw new Error(
          'Platform default model must reference platform credential scope.',
        );
      }
      if (requireLive && binding.activationEvidenceStatus !== 'live_verified') {
        throw new Error(
          'Platform default model is not live verified.',
        );
      }
    },
    async setWorkspaceDefault(
      workspaceId: string,
      operation: PlatformDefaultModelOperation,
      modelId: string,
    ) {
      const byOp =
        workspaceDefaults.get(workspaceId) ??
        new Map<PlatformDefaultModelOperation, string>();
      byOp.set(operation, modelId);
      workspaceDefaults.set(workspaceId, byOp);
    },
    getBindings() {
      return resolvePlatformDefaultBindings(input.snapshot, input.defaults)
        .bindings;
    },
    getWorkspaceDefaults() {
      return workspaceDefaults;
    },
  };
  return port;
}

/**
 * Strict BYOK overrides platform defaults for a workspace and proves mutual
 * credential isolation (platform path never reads BYOK; BYOK never falls back).
 */
export function applyStrictByokOverride(input: {
  platformBindings: readonly PlatformDefaultBinding[];
  override: ByokOverride;
}): {
  effectiveCatalogModelId: string;
  credentialScope: CredentialScope;
  usedPlatformCredential: boolean;
  usedByokCredential: boolean;
  platformFallbackAttempted: false;
} {
  // BYOK always wins when present — no platform fallback.
  void input.platformBindings;
  return {
    effectiveCatalogModelId: input.override.catalogModelId,
    credentialScope: 'workspace_byok',
    usedPlatformCredential: false,
    usedByokCredential: true,
    platformFallbackAttempted: false,
  };
}

/**
 * Platform task path: never reads workspace BYOK credentials.
 */
export function resolvePlatformTaskCredentialScope(input: {
  platformBindings: readonly PlatformDefaultBinding[];
  workspaceByokCredentials: readonly ByokOverride[];
  catalogModelId: string;
}): {
  credentialScope: 'platform';
  readWorkspaceByok: false;
  binding: PlatformDefaultBinding | null;
} {
  const binding =
    input.platformBindings.find(
      (b) => b.catalogModelId === input.catalogModelId,
    ) ?? null;
  // Explicitly ignore workspace BYOK on platform path.
  void input.workspaceByokCredentials;
  return {
    credentialScope: 'platform',
    readWorkspaceByok: false,
    binding,
  };
}
