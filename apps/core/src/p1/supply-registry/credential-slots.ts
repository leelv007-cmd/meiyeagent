/**
 * Three fixed credential slots → CredentialAccount metadata registry migration
 * (D-060 / G1).
 *
 * Reality baseline (must not be papered over):
 *  - 3 slot metadata records always exist (model.direct / ark.media / douyin.platform)
 *  - 2 runtime vault bindings exist (model.direct / ark.media)
 *  - douyin.platform is explicitly not_wired for runtime assembly
 *
 * Migration acceptance asserts metadata and real assembly separately — never
 * treat "three slots visible" as "three slots hot-assembled".
 */
import type {
  CredentialAccountLifecycle,
  CredentialAccountMetadata,
} from '@meiye/contracts';

export const FIXED_CREDENTIAL_SLOTS = [
  'model.direct',
  'ark.media',
  'douyin.platform',
] as const;

export type FixedCredentialSlot = (typeof FIXED_CREDENTIAL_SLOTS)[number];

/** Runtime assembly state — independent of metadata presence. */
export type CredentialSlotRuntimeAssembly =
  | { kind: 'vault'; credentialVersion: number }
  | { kind: 'env_fallback' }
  | { kind: 'env' }
  | { kind: 'not_wired'; reason: string };

export interface CredentialSlotMigrationRecord {
  slot: FixedCredentialSlot;
  /** Integration connection id used by admin credential APIs. */
  connectionId: string;
  metadata: CredentialAccountMetadata;
  /** Real assembly state — not inferred from metadata alone. */
  runtimeAssembly: CredentialSlotRuntimeAssembly;
  /** True only when runtime can actually load a secret for this slot. */
  runtimeBound: boolean;
}

export interface CredentialSlotMigrationView {
  slots: CredentialSlotMigrationRecord[];
  metadataCount: number;
  runtimeBoundCount: number;
  notWiredSlots: FixedCredentialSlot[];
}

export interface FixedSlotRuntimeSources {
  modelDirect?: { source: 'vault' | 'env_fallback'; credentialVersion?: number };
  arkMedia?: { source: 'vault' | 'env_fallback'; credentialVersion?: number };
}

const SLOT_PROVIDER_PROFILE: Record<FixedCredentialSlot, string> = {
  'model.direct': 'provider-tu-zi',
  'ark.media': 'provider-bytedance-volcengine',
  'douyin.platform': 'provider-douyin-platform',
};

const SLOT_LABEL: Record<FixedCredentialSlot, string> = {
  'model.direct': 'Platform model.direct',
  'ark.media': 'Platform ark.media',
  'douyin.platform': 'Platform douyin.platform',
};

function assemblyForSlot(
  slot: FixedCredentialSlot,
  sources: FixedSlotRuntimeSources | undefined,
): CredentialSlotRuntimeAssembly {
  if (slot === 'douyin.platform') {
    return {
      kind: 'not_wired',
      reason: 'recorded_adapter',
    };
  }
  if (slot === 'model.direct') {
    const source = sources?.modelDirect;
    if (source?.source === 'vault' && typeof source.credentialVersion === 'number') {
      return { kind: 'vault', credentialVersion: source.credentialVersion };
    }
    if (source?.source === 'env_fallback') {
      return { kind: 'env_fallback' };
    }
    return { kind: 'env' };
  }
  // ark.media
  const source = sources?.arkMedia;
  if (source?.source === 'vault' && typeof source.credentialVersion === 'number') {
    return { kind: 'vault', credentialVersion: source.credentialVersion };
  }
  if (source?.source === 'env_fallback') {
    return { kind: 'env_fallback' };
  }
  return { kind: 'env' };
}

function isRuntimeBound(assembly: CredentialSlotRuntimeAssembly): boolean {
  return assembly.kind === 'vault' || assembly.kind === 'env_fallback' || assembly.kind === 'env';
}

function lifecycleForAssembly(
  assembly: CredentialSlotRuntimeAssembly,
): CredentialAccountLifecycle {
  if (assembly.kind === 'not_wired') return 'pending';
  if (assembly.kind === 'vault') return 'active';
  // env / env_fallback still serve traffic but are migration risk.
  return 'active';
}

function sourceForAssembly(
  assembly: CredentialSlotRuntimeAssembly,
): CredentialAccountMetadata['source'] {
  if (assembly.kind === 'env_fallback' || assembly.kind === 'env') {
    return 'env_fallback';
  }
  if (assembly.kind === 'not_wired') return 'migration';
  return 'registry';
}

/**
 * Migrate the three fixed platform credential slots into CredentialAccount
 * metadata records. Runtime assembly is attached as a separate fact.
 */
export function migrateFixedCredentialSlots(options: {
  runtimeSources?: FixedSlotRuntimeSources;
  /** Optional secret reference map by connection id (never secret values). */
  secretReferences?: Partial<Record<`platform:${FixedCredentialSlot}`, string>>;
  versionBySlot?: Partial<Record<FixedCredentialSlot, string>>;
  statusBySlot?: Partial<Record<FixedCredentialSlot, CredentialAccountLifecycle>>;
} = {}): CredentialSlotMigrationView {
  const slots: CredentialSlotMigrationRecord[] = FIXED_CREDENTIAL_SLOTS.map(
    (slot) => {
      const connectionId = `platform:${slot}` as const;
      const runtimeAssembly = assemblyForSlot(slot, options.runtimeSources);
      const metadata: CredentialAccountMetadata = {
        id: `credential-account:${slot}`,
        label: SLOT_LABEL[slot],
        providerProfileId: SLOT_PROVIDER_PROFILE[slot],
        type: slot,
        scope: 'platform',
        secretReference:
          options.secretReferences?.[connectionId] ??
          `secret-ref:${connectionId}`,
        version:
          options.versionBySlot?.[slot] ??
          (runtimeAssembly.kind === 'vault'
            ? String(runtimeAssembly.credentialVersion)
            : '0'),
        status:
          options.statusBySlot?.[slot] ?? lifecycleForAssembly(runtimeAssembly),
        source: sourceForAssembly(runtimeAssembly),
      };
      return {
        slot,
        connectionId,
        metadata,
        runtimeAssembly,
        runtimeBound: isRuntimeBound(runtimeAssembly) && slot !== 'douyin.platform',
      };
    },
  );

  // Explicit assembly rule: douyin is never runtime-bound in this migration.
  for (const record of slots) {
    if (record.slot === 'douyin.platform') {
      record.runtimeBound = false;
      record.runtimeAssembly = {
        kind: 'not_wired',
        reason: 'recorded_adapter',
      };
    }
  }

  return {
    slots,
    metadataCount: slots.length,
    runtimeBoundCount: slots.filter((s) => s.runtimeBound).length,
    notWiredSlots: slots
      .filter((s) => s.runtimeAssembly.kind === 'not_wired')
      .map((s) => s.slot),
  };
}

/**
 * Project CredentialAccount metadata only — never includes secret material or
 * pretends not_wired slots are assembled.
 */
export function projectCredentialAccountMetadata(
  view: CredentialSlotMigrationView,
): CredentialAccountMetadata[] {
  return view.slots.map((slot) => structuredClone(slot.metadata));
}

/**
 * Assert migration shape matches baseline: 3 metadata / 2 runtime-bound /
 * douyin not_wired. Throws on mismatch (used by dual-read style tests).
 */
export function assertFixedSlotMigrationBaseline(
  view: CredentialSlotMigrationView,
): void {
  if (view.metadataCount !== 3) {
    throw new Error(
      `Expected 3 credential slot metadata records, got ${view.metadataCount}.`,
    );
  }
  if (view.runtimeBoundCount !== 2) {
    throw new Error(
      `Expected 2 runtime-bound credential slots, got ${view.runtimeBoundCount}.`,
    );
  }
  if (
    view.notWiredSlots.length !== 1 ||
    view.notWiredSlots[0] !== 'douyin.platform'
  ) {
    throw new Error(
      `Expected douyin.platform as the sole not_wired slot, got ${view.notWiredSlots.join(',')}.`,
    );
  }
  const bySlot = new Map(view.slots.map((s) => [s.slot, s]));
  for (const slot of FIXED_CREDENTIAL_SLOTS) {
    if (!bySlot.has(slot)) {
      throw new Error(`Missing credential slot metadata for ${slot}.`);
    }
  }
  const douyin = bySlot.get('douyin.platform')!;
  if (douyin.runtimeBound) {
    throw new Error('douyin.platform must not report runtimeBound=true.');
  }
  if (douyin.runtimeAssembly.kind !== 'not_wired') {
    throw new Error('douyin.platform runtime assembly must be not_wired.');
  }
}
