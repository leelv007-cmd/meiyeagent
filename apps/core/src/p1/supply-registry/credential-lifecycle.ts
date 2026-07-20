/**
 * CredentialAccount three-state lifecycle (G2 / D-060 / D-080 C4).
 *
 * Trunk: pending → active → retired
 * tested  = activation gate (not a state)
 * draining = async media sub-state only (active + drainSubstate)
 *
 * Rotation appends a version snapshot; historical snapshots are never rewritten.
 * In-flight tasks keep their frozen credential version.
 */
import type {
  CredentialAccountLifecycle,
  CredentialDrainSubstate,
} from '@meiye/contracts';
import type {
  CredentialAccount,
  CredentialTestEvidence,
  CredentialVersionSnapshot,
} from './credential-account.js';

export type CredentialLifecycleCommand =
  | { kind: 'record_test'; evidence: CredentialTestEvidence }
  | { kind: 'activate' }
  | { kind: 'start_drain' }
  | { kind: 'complete_drain' }
  | { kind: 'retire' }
  | { kind: 'revoke' }
  | {
      kind: 'rotate';
      next: {
        version: string;
        secretReference: string;
        secretVersion: number;
        source?: CredentialAccount['source'];
        expiresAt?: string;
      };
    };

export class CredentialLifecycleError extends Error {
  constructor(
    readonly code:
      | 'INVALID_TRANSITION'
      | 'ACTIVATION_GATE_FAILED'
      | 'ALREADY_RETIRED'
      | 'NOT_DRAINING'
      | 'VERSION_ALREADY_EXISTS',
    message: string,
  ) {
    super(message);
    this.name = 'CredentialLifecycleError';
  }
}

/** Max age of a passed connectivity probe accepted by activate (default 24h). */
export const DEFAULT_TEST_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isActivationGateSatisfied(
  account: CredentialAccount,
  options: { now?: string; maxAgeMs?: number } = {},
): boolean {
  const evidence = account.lastTest;
  if (!evidence || evidence.status !== 'passed') return false;
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const testedMs = Date.parse(evidence.testedAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(testedMs)) return false;
  const maxAge = options.maxAgeMs ?? DEFAULT_TEST_EVIDENCE_MAX_AGE_MS;
  return nowMs - testedMs <= maxAge;
}

function assertNotRetired(account: CredentialAccount): void {
  if (account.status === 'retired') {
    throw new CredentialLifecycleError(
      'ALREADY_RETIRED',
      `CredentialAccount ${account.id} is retired.`,
    );
  }
}

function withUpdated(
  account: CredentialAccount,
  patch: Partial<CredentialAccount>,
  now: string,
): CredentialAccount {
  return {
    ...account,
    ...patch,
    updatedAt: now,
  };
}

/**
 * Pure lifecycle transition. Returns a new account; never mutates input.
 * Secret values are never accepted or produced by this function.
 */
export function transitionCredentialLifecycle(
  account: CredentialAccount,
  command: CredentialLifecycleCommand,
  options: { now?: string; maxTestAgeMs?: number } = {},
): CredentialAccount {
  const now = options.now ?? new Date().toISOString();

  switch (command.kind) {
    case 'record_test': {
      assertNotRetired(account);
      const evidence = command.evidence;
      return withUpdated(
        account,
        {
          lastTest: evidence,
          lastTestEvidenceRef: evidence.evidenceRef,
          ...(evidence.status === 'passed'
            ? { verifiedAt: evidence.testedAt }
            : {}),
        },
        now,
      );
    }

    case 'activate': {
      if (account.status === 'active') {
        // Idempotent re-activate when already active (e.g. after drain complete).
        if (!isActivationGateSatisfied(account, {
          now,
          maxAgeMs: options.maxTestAgeMs,
        })) {
          throw new CredentialLifecycleError(
            'ACTIVATION_GATE_FAILED',
            'Activate requires a recent passed connectivity/capability probe.',
          );
        }
        return withUpdated(
          account,
          { status: 'active', drainSubstate: 'none' },
          now,
        );
      }
      if (account.status !== 'pending') {
        throw new CredentialLifecycleError(
          'INVALID_TRANSITION',
          `Cannot activate CredentialAccount in status=${account.status}.`,
        );
      }
      if (
        !isActivationGateSatisfied(account, {
          now,
          maxAgeMs: options.maxTestAgeMs,
        })
      ) {
        throw new CredentialLifecycleError(
          'ACTIVATION_GATE_FAILED',
          'Activate requires a recent passed connectivity/capability probe.',
        );
      }
      return withUpdated(
        account,
        {
          status: 'active',
          drainSubstate: 'none',
          verifiedAt: account.lastTest?.testedAt ?? now,
        },
        now,
      );
    }

    case 'start_drain': {
      if (account.status !== 'active') {
        throw new CredentialLifecycleError(
          'INVALID_TRANSITION',
          'Drain is only allowed on active CredentialAccount (async media sub-state).',
        );
      }
      return withUpdated(account, { drainSubstate: 'draining' }, now);
    }

    case 'complete_drain': {
      if (account.status !== 'active') {
        throw new CredentialLifecycleError(
          'INVALID_TRANSITION',
          'complete_drain requires active status.',
        );
      }
      if (account.drainSubstate !== 'draining') {
        throw new CredentialLifecycleError(
          'NOT_DRAINING',
          'CredentialAccount is not draining.',
        );
      }
      return withUpdated(account, { drainSubstate: 'none' }, now);
    }

    case 'retire':
    case 'revoke': {
      // Retire/revoke allowed from pending or active (including draining).
      if (account.status === 'retired') {
        return account;
      }
      return withUpdated(
        account,
        { status: 'retired', drainSubstate: 'none' },
        now,
      );
    }

    case 'rotate': {
      assertNotRetired(account);
      if (account.status !== 'active' && account.status !== 'pending') {
        throw new CredentialLifecycleError(
          'INVALID_TRANSITION',
          `Cannot rotate CredentialAccount in status=${account.status}.`,
        );
      }
      const exists = account.versionHistory.some(
        (row) =>
          row.version === command.next.version ||
          row.secretVersion === command.next.secretVersion,
      );
      if (exists) {
        throw new CredentialLifecycleError(
          'VERSION_ALREADY_EXISTS',
          `Credential version ${command.next.version} already exists; rotation never rewrites history.`,
        );
      }
      const snapshot: CredentialVersionSnapshot = {
        version: command.next.version,
        secretReference: command.next.secretReference,
        secretVersion: command.next.secretVersion,
        createdAt: now,
        source: command.next.source ?? account.source,
        mask: '••••••••',
      };
      // Append-only history: prior snapshots retained for frozen in-flight tasks.
      const versionHistory = [...account.versionHistory, snapshot];
      return withUpdated(
        account,
        {
          version: command.next.version,
          secretReference: command.next.secretReference,
          secretVersion: command.next.secretVersion,
          source: command.next.source ?? account.source,
          // Rotation clears activation evidence — must re-test before activate
          // when pending, or re-verify when already active (caller decides).
          lastTest: undefined,
          lastTestEvidenceRef: undefined,
          verifiedAt: undefined,
          ...(command.next.expiresAt
            ? { expiresAt: command.next.expiresAt }
            : { expiresAt: account.expiresAt }),
          // New secret starts pending verification unless already active and
          // operator keeps serving the prior frozen version for in-flight work.
          // Head version becomes current; status stays active but drain may be set
          // by a separate start_drain command for media.
          versionHistory,
        },
        now,
      );
    }

    default: {
      const _exhaustive: never = command;
      throw new CredentialLifecycleError(
        'INVALID_TRANSITION',
        `Unknown command: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Resolve a frozen version snapshot for an in-flight task.
 * Returns null when the version was never recorded (must not silently upgrade).
 */
export function resolveFrozenCredentialVersion(
  account: CredentialAccount,
  frozenVersion: string,
): CredentialVersionSnapshot | null {
  return (
    account.versionHistory.find((row) => row.version === frozenVersion) ?? null
  );
}

export function credentialLifecycleLabel(
  status: CredentialAccountLifecycle,
  drainSubstate: CredentialDrainSubstate,
): string {
  if (status === 'active' && drainSubstate === 'draining') {
    return 'active+draining';
  }
  return status;
}
