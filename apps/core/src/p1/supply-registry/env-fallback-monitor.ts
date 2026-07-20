/**
 * Bare env → monitored env_fallback migration projection (G2 / D-060).
 *
 * Reality: boot still often sources platform keys from process env.
 * Target: treat bare `env` as monitored `env_fallback` with persistent risk
 * and a migration entry to vault/CredentialAccount registry.
 *
 * Cloudflare Worker Secrets only manage Worker runtime keys — they never
 * replace Node Core CredentialAccount registry truth.
 */
import type {
  CredentialSlotRuntimeAssembly,
  FixedCredentialSlot,
} from './credential-slots.js';
import { FIXED_CREDENTIAL_SLOTS } from './credential-slots.js';

export type EnvFallbackRiskLevel =
  | 'none'
  | 'monitored_fallback'
  | 'bare_env'
  | 'not_wired';

export interface EnvFallbackMigrationEntry {
  action: 'migrate_to_vault';
  /** Admin path / command key — UI binds this as the migration CTA. */
  entryKey: 'admin.credential.migrate_env_fallback';
  label: string;
  target: 'credential_account_registry';
  /** Explicit: Worker Secrets are out of scope as registry truth. */
  workerSecretsNotRegistry: true;
}

export interface EnvFallbackRiskProjection {
  slot: FixedCredentialSlot;
  /** Effective monitored source (bare env is projected as env_fallback). */
  effectiveSource: 'vault' | 'env_fallback' | 'not_wired';
  /** Raw assembly kind before monitoring projection. */
  rawAssemblyKind: CredentialSlotRuntimeAssembly['kind'];
  riskLevel: EnvFallbackRiskLevel;
  riskMessage: string;
  migrationEntry: EnvFallbackMigrationEntry | null;
  runtimeBound: boolean;
}

export interface EnvFallbackMonitorView {
  projections: EnvFallbackRiskProjection[];
  /** Slots still on bare env or env_fallback that need vault migration. */
  migrationRequiredSlots: FixedCredentialSlot[];
  vaultBoundCount: number;
  monitoredFallbackCount: number;
  bareEnvCount: number;
  notWiredCount: number;
  /** Always true — Worker Secrets are not CredentialAccount registry. */
  workerSecretsAreNotRegistryTruth: true;
}

const MIGRATION_ENTRY: EnvFallbackMigrationEntry = {
  action: 'migrate_to_vault',
  entryKey: 'admin.credential.migrate_env_fallback',
  label: 'Migrate env credential into CredentialAccount vault',
  target: 'credential_account_registry',
  workerSecretsNotRegistry: true,
};

/**
 * Project a single slot's runtime assembly into a monitored risk row.
 * Bare `env` is reclassified as monitored `env_fallback`.
 */
export function projectEnvFallbackRisk(
  slot: FixedCredentialSlot,
  assembly: CredentialSlotRuntimeAssembly,
  options: { runtimeBound?: boolean } = {},
): EnvFallbackRiskProjection {
  if (assembly.kind === 'vault') {
    return {
      slot,
      effectiveSource: 'vault',
      rawAssemblyKind: 'vault',
      riskLevel: 'none',
      riskMessage: 'Credential assembled from vault by CredentialAccount version.',
      migrationEntry: null,
      runtimeBound: options.runtimeBound ?? true,
    };
  }
  if (assembly.kind === 'not_wired') {
    return {
      slot,
      effectiveSource: 'not_wired',
      rawAssemblyKind: 'not_wired',
      riskLevel: 'not_wired',
      riskMessage: `Slot ${slot} is recorded but not wired for runtime assembly (${assembly.reason}).`,
      migrationEntry: null,
      runtimeBound: false,
    };
  }
  if (assembly.kind === 'env') {
    return {
      slot,
      effectiveSource: 'env_fallback',
      rawAssemblyKind: 'env',
      riskLevel: 'bare_env',
      riskMessage:
        `Bare process env is serving ${slot}; treat as monitored env_fallback and migrate to CredentialAccount vault. ` +
        'Cloudflare Worker Secrets must not replace Node Core registry truth.',
      migrationEntry: MIGRATION_ENTRY,
      runtimeBound: options.runtimeBound ?? true,
    };
  }
  // env_fallback
  return {
    slot,
    effectiveSource: 'env_fallback',
    rawAssemblyKind: 'env_fallback',
    riskLevel: 'monitored_fallback',
    riskMessage:
      `Slot ${slot} is on monitored env_fallback; migrate to CredentialAccount vault. ` +
      'Worker Secrets remain out of scope as registry truth.',
    migrationEntry: MIGRATION_ENTRY,
    runtimeBound: options.runtimeBound ?? true,
  };
}

/**
 * Build monitor view for the three fixed platform slots (or any provided map).
 */
export function buildEnvFallbackMonitorView(
  assemblies: Partial<
    Record<
      FixedCredentialSlot,
      { assembly: CredentialSlotRuntimeAssembly; runtimeBound?: boolean }
    >
  >,
): EnvFallbackMonitorView {
  const projections = FIXED_CREDENTIAL_SLOTS.map((slot) => {
    const entry = assemblies[slot];
    const assembly: CredentialSlotRuntimeAssembly =
      entry?.assembly ??
      (slot === 'douyin.platform'
        ? { kind: 'not_wired', reason: 'recorded_adapter' }
        : { kind: 'env' });
    return projectEnvFallbackRisk(slot, assembly, {
      runtimeBound: entry?.runtimeBound,
    });
  });

  return {
    projections,
    migrationRequiredSlots: projections
      .filter(
        (p) =>
          p.riskLevel === 'bare_env' || p.riskLevel === 'monitored_fallback',
      )
      .map((p) => p.slot),
    vaultBoundCount: projections.filter((p) => p.effectiveSource === 'vault')
      .length,
    monitoredFallbackCount: projections.filter(
      (p) => p.riskLevel === 'monitored_fallback',
    ).length,
    bareEnvCount: projections.filter((p) => p.riskLevel === 'bare_env').length,
    notWiredCount: projections.filter((p) => p.riskLevel === 'not_wired')
      .length,
    workerSecretsAreNotRegistryTruth: true,
  };
}

/**
 * Classify a boot runtime source for monitoring. Bare env inputs that still
 * hold process values are reported as env_fallback with bare_env risk.
 */
export function classifyBootCredentialSource(input: {
  source: 'vault' | 'env_fallback' | 'env';
  credentialVersion?: number;
}): { assembly: CredentialSlotRuntimeAssembly; monitoredAs: 'vault' | 'env_fallback' } {
  if (input.source === 'vault' && typeof input.credentialVersion === 'number') {
    return {
      assembly: {
        kind: 'vault',
        credentialVersion: input.credentialVersion,
      },
      monitoredAs: 'vault',
    };
  }
  if (input.source === 'env') {
    return { assembly: { kind: 'env' }, monitoredAs: 'env_fallback' };
  }
  return { assembly: { kind: 'env_fallback' }, monitoredAs: 'env_fallback' };
}
