/**
 * High-sensitivity CredentialAccount action audits (G2 / D-057 / D-060).
 *
 * Actions: view_meta / write_rotate / test / activate / drain / revoke
 * Uses K1 permission audit helpers; permission key = credential.govern.
 * Audit payloads never include secret material.
 */
import type { ProductCapability } from '@meiye/contracts';
import {
  assertPermissionAuditFields,
  projectPermissionAudit,
  type PermissionAuditActor,
  type PermissionAuditProjection,
} from '../capability-permission/audit.js';
import type { CredentialAccount } from './credential-account.js';
import {
  assertNoSecretEcho,
  toPublicMetadata,
  type CredentialSensitiveAction,
} from './credential-account.js';
import { redactCredentialLogDetails } from './secret-broker.js';

export const CREDENTIAL_GOVERN_PERMISSION =
  'credential.govern' as const satisfies ProductCapability;

export const CREDENTIAL_SENSITIVE_ACTIONS: readonly CredentialSensitiveAction[] =
  [
    'view_meta',
    'write_rotate',
    'test',
    'activate',
    'drain',
    'revoke',
  ] as const;

const ACTION_REASON: Record<CredentialSensitiveAction, string> = {
  view_meta: 'View CredentialAccount metadata (no secret echo)',
  write_rotate: 'Write or rotate CredentialAccount secret reference',
  test: 'Test CredentialAccount connectivity/capability probe',
  activate: 'Activate CredentialAccount after passed probe gate',
  drain: 'Start or complete async media drain sub-state',
  revoke: 'Revoke or retire CredentialAccount',
};

export interface ProjectCredentialSensitiveAuditInput {
  action: CredentialSensitiveAction;
  actor: PermissionAuditActor;
  account: CredentialAccount;
  correlationId: string;
  reason?: string;
  before?: unknown | null;
  after?: unknown | null;
  occurredAt?: string;
  /** Extra log details — will be redacted. */
  details?: Record<string, unknown>;
}

/**
 * Project a high-sensitivity credential audit row.
 * before/after default to public metadata only.
 */
export function projectCredentialSensitiveAudit(
  input: ProjectCredentialSensitiveAuditInput,
): PermissionAuditProjection {
  const before =
    input.before === undefined
      ? toPublicMetadata(input.account)
      : input.before;
  const after =
    input.after === undefined ? toPublicMetadata(input.account) : input.after;

  const projection = projectPermissionAudit({
    actor: input.actor,
    permission: CREDENTIAL_GOVERN_PERMISSION,
    target: {
      kind: 'command',
      module: 'supply-registry.credential',
      action: input.action,
      resourceId: input.account.id,
      resourceType: 'credential_account',
    },
    reason: input.reason ?? ACTION_REASON[input.action],
    before,
    after,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
  });

  // Hard guarantee: audit never carries secrets.
  assertNoSecretEcho(projection);
  if (input.details) {
    assertNoSecretEcho(redactCredentialLogDetails(input.details));
  }
  assertPermissionAuditFields(projection);
  return projection;
}

/**
 * Assert every high-sensitivity action is covered by a distinct audit projection.
 * Used by contract tests (D-057 split audit assertions).
 */
export function assertCredentialSensitiveActionsAudited(
  audits: readonly PermissionAuditProjection[],
): void {
  const actions = new Set(
    audits.map((a) => a.target.action as CredentialSensitiveAction),
  );
  for (const required of CREDENTIAL_SENSITIVE_ACTIONS) {
    if (!actions.has(required)) {
      throw new Error(
        `Missing high-sensitivity credential audit for action=${required}`,
      );
    }
  }
  for (const audit of audits) {
    assertPermissionAuditFields(audit);
    if (audit.permission !== CREDENTIAL_GOVERN_PERMISSION) {
      throw new Error(
        `Credential sensitive audit must use permission=${CREDENTIAL_GOVERN_PERMISSION}`,
      );
    }
    if (audit.target.module !== 'supply-registry.credential') {
      throw new Error(
        'Credential sensitive audit target.module must be supply-registry.credential',
      );
    }
    assertNoSecretEcho(audit);
  }
}
