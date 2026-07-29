import { createHash, randomUUID } from 'node:crypto';
import type { SupplierPriceRevision, SupplyOperation } from '@meiye/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import type { PermissionAuditProjection } from '../capability-permission/audit.js';
import type { PermissionAuthorizerPort } from '../capability-permission/port.js';
import { P1DomainError } from '../foundation/domain.js';
import type {
  ModelSupplyJobListQuery,
  ModelSupplyJobListStatus,
  ModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
} from '../model-supply/foundation-module.js';
import type { ModelSupplyResult } from '../model-supply/ledger-contracts.js';
import type { RouteDecisionExplanation } from './route-explanation.js';
import { transitionCredentialLifecycle } from './credential-lifecycle.js';
import {
  PLATFORM_CREDENTIAL_WORKSPACE_ID,
  toPublicMetadata,
  type CredentialAccount,
} from './credential-account.js';
import {
  AdminSupplyControlPlane,
  DEFAULT_SUPPLY_RUN_QUERY,
  type AdminSupplyGovernedActionRequest,
  type AdminSupplyGovernedDomainPort,
  type AdminSupplyIdempotencyPort,
  type GovernedSupplyActionExecution,
  type GovernedSupplyDomainResult,
  type GovernedSupplyImpactPreview,
  type PendingAdminSupplyExecution,
  type SupplyAuditChange,
  type SupplyControlSnapshotPorts,
  type SupplyGatewayDeepLink,
  type SupplyRunPage,
  type SupplyRunQuery,
  type SupplyRunRecord,
} from './admin-control-plane.js';
import type {
  PostgresAccountAllocationStore,
  PostgresEntitlementPolicyStore,
  PostgresSupplyPoolStore,
} from '../entitlement-pools/postgres-repository.js';
import type { PostgresSupplyControlPlaneRepository } from './postgres-control-plane.js';
import type { PostgresCapabilityHotAssemblyPort } from './postgres-hot-assembly.js';
import type { PostgresSupplyPlanningControlPlane } from './postgres-planning-control-plane.js';
import {
  HotAssemblyError,
  type ChannelLifecycleState,
} from './hot-assembly.js';

type StoredErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_ENTITLEMENT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_STATE'
  | 'COMMANDS_FROZEN'
  | 'P1_WRITE_DISABLED';

interface IdempotencyRow<T> extends QueryResultRow {
  payload_hash: string;
  status: 'pending' | 'completed' | 'rejected';
  result: T | null;
  recovery_context: unknown | null;
  error_code: StoredErrorCode | null;
  error_message: string | null;
  created_at?: Date | string;
  executed_at?: Date | string | null;
}

interface AdminActionResult {
  action?: string;
  target?: { resourceType?: string; resourceId?: string };
  audit?: PermissionAuditProjection;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function storedError(error: unknown): {
  code: StoredErrorCode;
  message: string;
} {
  if (error instanceof P1DomainError) {
    return { code: error.code, message: error.message.slice(0, 1_000) };
  }
  return {
    code: 'INVALID_STATE',
    message:
      'The governed supply action failed. Inspect the immutable audit correlation for details.',
  };
}

export class PostgresAdminSupplyMigration implements PostgresSchemaMigrator {
  async migrate(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS p1_admin_supply_idempotency (
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
        result jsonb,
        error_code text,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS p1_admin_supply_actions (
        workspace_id text NOT NULL,
        action_id text NOT NULL,
        idempotency_key text NOT NULL,
        action text NOT NULL,
        target_type text NOT NULL,
        target_id text NOT NULL,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        summary text NOT NULL,
        audit jsonb NOT NULL,
        result jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, action_id),
        UNIQUE (workspace_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS p1_admin_supply_actions_recent_idx
        ON p1_admin_supply_actions (workspace_id, occurred_at DESC, action_id DESC);
      ALTER TABLE p1_admin_supply_idempotency
        ADD COLUMN IF NOT EXISTS executed_at timestamptz;
      ALTER TABLE p1_admin_supply_idempotency
        ADD COLUMN IF NOT EXISTS recovery_context jsonb;
      CREATE TABLE IF NOT EXISTS p1_admin_supply_secure_write_receipts (
        receipt_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        account_id text NOT NULL,
        next_secret_version integer NOT NULL CHECK (next_secret_version > 0),
        secret_reference text NOT NULL,
        issued_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        consumed_record_revision bigint,
        CHECK (expires_at > issued_at),
        FOREIGN KEY (workspace_id, account_id)
          REFERENCES p1_supply_credential_accounts (workspace_id, account_id)
          ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS p1_admin_supply_secure_write_receipts_account_idx
        ON p1_admin_supply_secure_write_receipts
          (workspace_id, account_id, next_secret_version, issued_at DESC);
    `);
  }
}

interface CredentialRotationReceiptRow extends QueryResultRow {
  workspace_id: string;
  account_id: string;
  next_secret_version: number;
  secret_reference: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}

interface CredentialAccountRow extends QueryResultRow {
  account: CredentialAccount;
  record_revision: string | number;
}

export interface CredentialRotationSecretBinding {
  workspaceId: string;
  credentialId: string;
  provider: CredentialAccount['provider'];
  secretReference: string;
  secretVersion: number;
}

export type CredentialRotationSecretVerifier = (
  binding: CredentialRotationSecretBinding
) => Promise<void>;

export interface CredentialRotationReceipt {
  id: string;
  workspaceId: string;
  accountId: string;
  nextSecretVersion: number;
  expiresAt: string;
}

/**
 * Durable hand-off between the secret-write boundary and credential metadata.
 *
 * The issuer accepts only a SecretStore reference. It verifies the referenced
 * next-version secret before saving a short-lived receipt. Consumption locks
 * the receipt and CredentialAccount in one PostgreSQL transaction, verifies
 * the secret again, advances the account with CAS, and consumes the receipt.
 * Raw secret material is never accepted, persisted, or returned.
 */
export class PostgresCredentialRotationReceiptStore {
  constructor(
    private readonly pool: Pool,
    private readonly verifySecret: CredentialRotationSecretVerifier
  ) {}

  async issue(input: {
    workspaceId: string;
    accountId: string;
    secretReference: string;
    expiresAt: string;
    now?: string;
  }): Promise<CredentialRotationReceipt> {
    const issuedAt = input.now ?? new Date().toISOString();
    if (
      !input.workspaceId.trim() ||
      !input.accountId.trim() ||
      !input.secretReference.trim() ||
      !Number.isFinite(Date.parse(issuedAt)) ||
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(issuedAt)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'A secure-write receipt requires a valid account binding and future expiry.'
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const accountResult = await client.query<CredentialAccountRow>(
        `SELECT account, record_revision
           FROM p1_supply_credential_accounts
          WHERE workspace_id = $1 AND account_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.accountId]
      );
      const account = accountResult.rows[0]?.account;
      if (!account) {
        throw new P1DomainError('NOT_FOUND', 'CredentialAccount not found.');
      }
      const nextSecretVersion = account.secretVersion + 1;
      await this.assertSecretAvailable({
        workspaceId: input.workspaceId,
        credentialId: account.credentialId,
        provider: account.provider,
        secretReference: input.secretReference,
        secretVersion: nextSecretVersion,
      });
      const receiptId = `secure-write-${randomUUID()}`;
      await client.query(
        `INSERT INTO p1_admin_supply_secure_write_receipts
           (receipt_id, workspace_id, account_id, next_secret_version,
            secret_reference, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          receiptId,
          input.workspaceId,
          input.accountId,
          nextSecretVersion,
          input.secretReference,
          issuedAt,
          input.expiresAt,
        ]
      );
      await client.query('COMMIT');
      return {
        id: receiptId,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        nextSecretVersion,
        expiresAt: new Date(input.expiresAt).toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async consumeAndRotate(input: {
    workspaceId: string;
    accountId: string;
    receiptId: string;
    expectedAccountVersion: string;
    now?: string;
  }): Promise<CredentialAccount> {
    const now = input.now ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(now))) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Credential rotation requires a valid execution timestamp.'
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const receiptResult = await client.query<CredentialRotationReceiptRow>(
        `SELECT workspace_id, account_id, next_secret_version,
                secret_reference, expires_at, consumed_at
           FROM p1_admin_supply_secure_write_receipts
          WHERE receipt_id = $1
          FOR UPDATE`,
        [input.receiptId]
      );
      const receipt = receiptResult.rows[0];
      if (
        !receipt ||
        receipt.workspace_id !== input.workspaceId ||
        receipt.account_id !== input.accountId
      ) {
        throw new P1DomainError(
          'NOT_FOUND',
          'The secure-write receipt was not found for this credential account.'
        );
      }
      if (receipt.consumed_at !== null) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The secure-write receipt has already been consumed.'
        );
      }
      if (Date.parse(String(receipt.expires_at)) <= Date.parse(now)) {
        throw new P1DomainError(
          'INVALID_STATE',
          'The secure-write receipt has expired.'
        );
      }
      const accountResult = await client.query<CredentialAccountRow>(
        `SELECT account, record_revision
           FROM p1_supply_credential_accounts
          WHERE workspace_id = $1 AND account_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.accountId]
      );
      const accountRow = accountResult.rows[0];
      if (!accountRow) {
        throw new P1DomainError('NOT_FOUND', 'CredentialAccount not found.');
      }
      const account = accountRow.account;
      if (
        account.version !== input.expectedAccountVersion ||
        receipt.next_secret_version !== account.secretVersion + 1
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The CredentialAccount changed after the secure-write receipt was issued.'
        );
      }
      await this.assertSecretAvailable({
        workspaceId: input.workspaceId,
        credentialId: account.credentialId,
        provider: account.provider,
        secretReference: receipt.secret_reference,
        secretVersion: receipt.next_secret_version,
      });
      const next = transitionCredentialLifecycle(
        account,
        {
          kind: 'rotate',
          next: {
            version: String(receipt.next_secret_version),
            secretReference: receipt.secret_reference,
            secretVersion: receipt.next_secret_version,
          },
        },
        { now }
      );
      const recordRevision = Number(accountRow.record_revision);
      const updated = await client.query<{ record_revision: string | number }>(
        `UPDATE p1_supply_credential_accounts
            SET account = $3::jsonb,
                record_revision = record_revision + 1,
                updated_at = now()
          WHERE workspace_id = $1 AND account_id = $2
            AND record_revision = $4
          RETURNING record_revision`,
        [
          input.workspaceId,
          input.accountId,
          JSON.stringify(next),
          recordRevision,
        ]
      );
      const consumedRecordRevision = updated.rows[0]?.record_revision;
      if (consumedRecordRevision === undefined) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The CredentialAccount changed before rotation could be committed.'
        );
      }
      const consumed = await client.query(
        `UPDATE p1_admin_supply_secure_write_receipts
            SET consumed_at = $2, consumed_record_revision = $3
          WHERE receipt_id = $1 AND consumed_at IS NULL`,
        [input.receiptId, now, consumedRecordRevision]
      );
      if (consumed.rowCount !== 1) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The secure-write receipt was consumed concurrently.'
        );
      }
      await client.query('COMMIT');
      return structuredClone(next);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertSecretAvailable(
    binding: CredentialRotationSecretBinding
  ): Promise<void> {
    try {
      await this.verifySecret(binding);
    } catch {
      throw new P1DomainError(
        'INVALID_STATE',
        'The secure-write receipt secret is unavailable or does not match the credential binding.'
      );
    }
  }
}

/**
 * Durable at-most-once envelope for governed actions.
 *
 * A pending identity is never retried automatically. Recovery context is
 * persisted before execution so a crash after the domain side effect can be
 * reconciled through a read-only outcome query. Terminal result + audit append
 * are committed together and are replayed without re-execution.
 */
export class PostgresAdminSupplyStore implements AdminSupplyIdempotencyPort {
  constructor(private readonly pool: Pool) {}

  async executeIdempotent<T>(input: {
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
    prepare?: () => Promise<unknown>;
    execute: (recoveryContext?: unknown) => Promise<T>;
  }): Promise<{ replayed: boolean; value: T }> {
    const inserted = await this.pool.query(
      `INSERT INTO p1_admin_supply_idempotency
         (workspace_id, idempotency_key, payload_hash, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
       RETURNING idempotency_key`,
      [input.workspaceId, input.idempotencyKey, input.payloadHash]
    );
    if (inserted.rowCount !== 1) {
      const existing = await this.read<T>(
        input.workspaceId,
        input.idempotencyKey
      );
      if (!existing || existing.payload_hash !== input.payloadHash) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The governed action idempotency key is bound to another payload.'
        );
      }
      if (existing.status === 'completed' && existing.result !== null) {
        return { replayed: true, value: structuredClone(existing.result) };
      }
      if (existing.status === 'rejected') {
        throw new P1DomainError(
          existing.error_code ?? 'INVALID_STATE',
          existing.error_message ?? 'The governed action was rejected.'
        );
      }
      throw new P1DomainError(
        'INVALID_STATE',
        'The governed action has an unresolved pending execution and must be reconciled before retry.'
      );
    }

    let value: T;
    try {
      const recoveryContext = input.prepare ? await input.prepare() : undefined;
      if (recoveryContext !== undefined) {
        await this.recordRecoveryContext(input, recoveryContext);
      }
      value = await input.execute(recoveryContext);
    } catch (error) {
      const rejected = storedError(error);
      await this.pool.query(
        `UPDATE p1_admin_supply_idempotency
            SET status = 'rejected', error_code = $4,
                error_message = $5, completed_at = now()
          WHERE workspace_id = $1 AND idempotency_key = $2
            AND payload_hash = $3 AND status = 'pending'`,
        [
          input.workspaceId,
          input.idempotencyKey,
          input.payloadHash,
          rejected.code,
          rejected.message,
        ]
      );
      throw error;
    }

    // The domain side effect has succeeded. If completion/audit persistence
    // now fails, retain `pending` so retries fail closed for reconciliation;
    // marking it rejected would incorrectly authorize a fresh execution.
    await this.recordExecutedResult(input, value);
    await this.complete(input, value);
    return { replayed: false, value: structuredClone(value) };
  }

  async listRecentSupplyChanges(
    workspaceId: string
  ): Promise<SupplyAuditChange[]> {
    const result = await this.pool.query<{
      action_id: string;
      occurred_at: Date | string;
      actor_id: string;
      action: string;
      target_type: string;
      target_id: string;
      summary: string;
      correlation_id: string;
    }>(
      `SELECT action_id, occurred_at, actor_id, action, target_type,
              target_id, summary, correlation_id
         FROM p1_admin_supply_actions
        WHERE workspace_id = $1
        ORDER BY occurred_at DESC, action_id DESC
        LIMIT 100`,
      [workspaceId]
    );
    return result.rows.map((row) => ({
      id: row.action_id,
      at:
        typeof row.occurred_at === 'string'
          ? new Date(row.occurred_at).toISOString()
          : row.occurred_at.toISOString(),
      actorId: row.actor_id,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      summary: row.summary,
      correlationId: row.correlation_id,
    }));
  }

  async listPendingExecutions(
    workspaceId: string
  ): Promise<PendingAdminSupplyExecution[]> {
    const result = await this.pool.query<{
      idempotency_key: string;
      payload_hash: string;
      result: unknown | null;
      recovery_context: unknown | null;
      created_at: Date | string;
      executed_at: Date | string | null;
    }>(
      `SELECT idempotency_key, payload_hash, result, recovery_context,
              created_at, executed_at
         FROM p1_admin_supply_idempotency
        WHERE workspace_id = $1 AND status = 'pending'
        ORDER BY created_at ASC, idempotency_key ASC`,
      [workspaceId]
    );
    return result.rows.map((row) => ({
      idempotencyKey: row.idempotency_key,
      payloadHash: row.payload_hash,
      outcome:
        row.result !== null
          ? 'recorded'
          : row.recovery_context !== null
            ? 'recoverable'
            : 'outcome_unknown',
      createdAt: new Date(row.created_at).toISOString(),
      ...(row.executed_at === null
        ? {}
        : { executedAt: new Date(row.executed_at).toISOString() }),
    }));
  }

  async reconcilePendingExecution<T = AdminActionResult>(input: {
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
    recover?: (recoveryContext: unknown) => Promise<T | null>;
  }): Promise<{ replayed: boolean; value: T }> {
    const existing = await this.read<T>(
      input.workspaceId,
      input.idempotencyKey
    );
    if (!existing || existing.payload_hash !== input.payloadHash) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'The pending governed action identity does not match the reconciliation request.'
      );
    }
    if (existing.status === 'completed' && existing.result !== null) {
      return { replayed: true, value: structuredClone(existing.result) };
    }
    if (existing.status === 'rejected') {
      throw new P1DomainError(
        existing.error_code ?? 'INVALID_STATE',
        existing.error_message ?? 'The governed action was rejected.'
      );
    }
    let recovered = existing.result;
    if (
      recovered === null &&
      existing.recovery_context !== null &&
      input.recover
    ) {
      recovered = await input.recover(
        structuredClone(existing.recovery_context)
      );
      if (recovered !== null) {
        await this.recordExecutedResult(input, recovered);
      }
    }
    if (recovered === null) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The pending governed action outcome could not be confirmed by domain-specific recovery.'
      );
    }
    const recorded = recovered as AdminActionResult;
    if (!recorded.action || !recorded.target?.resourceId || !recorded.audit) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The recorded governed action result is missing its immutable audit contract and cannot be reconciled.'
      );
    }
    await this.complete(input, recovered);
    return { replayed: false, value: structuredClone(recovered) };
  }

  private async read<T>(workspaceId: string, idempotencyKey: string) {
    const result = await this.pool.query<IdempotencyRow<T>>(
      `SELECT payload_hash, status, result, recovery_context,
              error_code, error_message
         FROM p1_admin_supply_idempotency
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey]
    );
    return result.rows[0] ?? null;
  }

  private async recordRecoveryContext(
    input: {
      workspaceId: string;
      idempotencyKey: string;
      payloadHash: string;
    },
    recoveryContext: unknown
  ): Promise<void> {
    const recorded = await this.pool.query(
      `UPDATE p1_admin_supply_idempotency
          SET recovery_context = $4::jsonb
        WHERE workspace_id = $1 AND idempotency_key = $2
          AND payload_hash = $3 AND status = 'pending'
          AND recovery_context IS NULL AND result IS NULL`,
      [
        input.workspaceId,
        input.idempotencyKey,
        input.payloadHash,
        JSON.stringify(recoveryContext),
      ]
    );
    if (recorded.rowCount !== 1) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'The governed action recovery context could not be persisted before execution.'
      );
    }
  }

  private async recordExecutedResult<T>(
    input: {
      workspaceId: string;
      idempotencyKey: string;
      payloadHash: string;
    },
    value: T
  ): Promise<void> {
    const recorded = await this.pool.query(
      `UPDATE p1_admin_supply_idempotency
          SET result = $4::jsonb, executed_at = now()
        WHERE workspace_id = $1 AND idempotency_key = $2
          AND payload_hash = $3 AND status = 'pending' AND result IS NULL`,
      [
        input.workspaceId,
        input.idempotencyKey,
        input.payloadHash,
        JSON.stringify(value),
      ]
    );
    if (recorded.rowCount !== 1) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'The governed action execution result could not be recorded for reconciliation.'
      );
    }
  }

  private async complete<T>(
    input: {
      workspaceId: string;
      idempotencyKey: string;
      payloadHash: string;
    },
    value: T
  ): Promise<void> {
    const result = value as AdminActionResult;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const completed = await client.query(
        `UPDATE p1_admin_supply_idempotency
            SET status = 'completed', result = $4::jsonb, completed_at = now()
          WHERE workspace_id = $1 AND idempotency_key = $2
            AND payload_hash = $3 AND status = 'pending'`,
        [
          input.workspaceId,
          input.idempotencyKey,
          input.payloadHash,
          JSON.stringify(value),
        ]
      );
      if (completed.rowCount !== 1) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The governed action execution identity changed before completion.'
        );
      }
      if (result.audit && result.action && result.target?.resourceId) {
        const actionId = `admin-supply-${digest({
          workspaceId: input.workspaceId,
          key: input.idempotencyKey,
        }).slice(0, 32)}`;
        await client.query(
          `INSERT INTO p1_admin_supply_actions
             (workspace_id, action_id, idempotency_key, action, target_type,
              target_id, actor_id, correlation_id, summary, audit, result,
              occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb,
                   $11::jsonb, $12)
           ON CONFLICT (workspace_id, action_id) DO NOTHING`,
          [
            input.workspaceId,
            actionId,
            input.idempotencyKey,
            result.action,
            result.target.resourceType ?? 'unknown',
            result.target.resourceId,
            result.audit.actor.userId,
            result.audit.correlationId,
            result.audit.reason,
            JSON.stringify(result.audit),
            JSON.stringify(value),
            result.audit.occurredAt,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

type RuntimeDependencies = {
  pool: Pool;
  permission: PermissionAuthorizerPort;
  registry: PostgresSupplyControlPlaneRepository;
  pools: PostgresSupplyPoolStore;
  entitlementPolicies: PostgresEntitlementPolicyStore;
  accountAllocations: PostgresAccountAllocationStore;
  planning: PostgresSupplyPlanningControlPlane;
  hotAssembly: PostgresCapabilityHotAssemblyPort;
  modelControlPlane: ModelSupplyControlPlaneService;
  modelRepository: ModelSupplyControlPlaneRepository;
  credentialRotations: PostgresCredentialRotationReceiptStore;
  providerProbes?: AdminProviderProbeExecutionPort;
  operationalEvidence?: AdminOperationalEvidenceRefreshPort;
  clock?: () => Date;
};

export interface AdminProviderProbeResult {
  probeKind: 'connectivity' | 'conformance';
  outcome: 'passed' | 'failed' | 'unknown';
  observedAt: string;
  evidenceRef: string;
}

export interface AdminProviderProbeExecutionPort {
  runConnectivity(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    deploymentId: string;
    operation: SupplyOperation;
    idempotencyKey: string;
  }): Promise<AdminProviderProbeResult & { probeKind: 'connectivity' }>;
  runConformance(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    deploymentId: string;
    operation: SupplyOperation;
    idempotencyKey: string;
  }): Promise<AdminProviderProbeResult & { probeKind: 'conformance' }>;
  /** Read durable provider evidence by the original execution identity. */
  queryOutcome?(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    deploymentId: string;
    operation: SupplyOperation;
    probeKind: AdminProviderProbeResult['probeKind'];
    idempotencyKey: string;
  }): Promise<AdminProviderProbeResult | null>;
}

type UnknownOperationalFact = { status: 'unknown'; reason: string };

type RefreshedHealthFact =
  | {
      status: 'known';
      state:
        | 'healthy'
        | 'degraded'
        | 'cooldown'
        | 'circuit_open'
        | 'unavailable';
    }
  | UnknownOperationalFact;

type RefreshedBalanceFact =
  | {
      status: 'known';
      amount: number;
      currency: 'CNY' | 'USD';
    }
  | UnknownOperationalFact;

type RefreshedQuotaFact =
  | {
      status: 'known';
      remaining: number;
      unit: string;
    }
  | UnknownOperationalFact;

export interface AdminOperationalEvidenceRefreshResult {
  evidenceSource: 'live_provider';
  observedAt: string;
  evidenceRef: string;
  health: RefreshedHealthFact;
  balance: RefreshedBalanceFact;
  quota: RefreshedQuotaFact;
}

export interface AdminOperationalEvidenceUnavailableResult {
  evidenceSource: 'unavailable';
  observedAt: string;
  evidenceRef: null;
  health: UnknownOperationalFact;
  balance: UnknownOperationalFact;
  quota: UnknownOperationalFact;
}

export interface AdminOperationalEvidenceRefreshPort {
  /** Execute live provider refresh and persist its resulting operational heads. */
  refresh(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    targetKind: AdminSupplyGovernedActionRequest['target']['resourceType'];
    targetId: string;
    idempotencyKey: string;
  }): Promise<
    | AdminOperationalEvidenceRefreshResult
    | AdminOperationalEvidenceUnavailableResult
  >;
  /** Read durable refresh evidence by the original execution identity. */
  queryOutcome?(input: {
    context: AdminSupplyGovernedActionRequest['context'];
    targetKind: AdminSupplyGovernedActionRequest['target']['resourceType'];
    targetId: string;
    idempotencyKey: string;
  }): Promise<
    | AdminOperationalEvidenceRefreshResult
    | AdminOperationalEvidenceUnavailableResult
    | null
  >;
}

function modality(operation: SupplyOperation): SupplyRunRecord['modality'] {
  if (operation.startsWith('image.')) return 'image';
  if (operation.startsWith('video.')) return 'video';
  if (operation.startsWith('audio.')) return 'audio';
  return 'llm';
}

function runStatus(result: ModelSupplyResult): SupplyRunRecord['status'] {
  if (result.status === 'completed') return 'succeeded';
  if (result.status === 'failed') return 'failed';
  if (result.attempt.acceptance === 'accepted') return 'accepted';
  if (result.attempt.acceptance === 'acceptance_unknown') {
    return 'acceptance_unknown';
  }
  return 'rejected_before_accept';
}

function routeSimulationInput(request: AdminSupplyGovernedActionRequest) {
  if (
    request.action !== 'route_simulate' &&
    request.action !== 'candidate_config_validate'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Route simulation input required.'
    );
  }
  const parameters = request.parameters;
  return {
    operation: parameters.operation,
    selection: parameters.selection,
    dataClass: parameters.dataClass,
    failureScenario: parameters.failureScenario,
    unavailableDeploymentIds: parameters.unavailableDeploymentIds,
    ...(request.action === 'candidate_config_validate'
      ? { routePolicyRevisionId: parameters.routePolicyRevisionId }
      : {}),
  };
}

export class ProductionAdminSupplyDomain
  implements AdminSupplyGovernedDomainPort
{
  constructor(private readonly dependencies: RuntimeDependencies) {}

  async preview(
    request: AdminSupplyGovernedActionRequest
  ): Promise<GovernedSupplyImpactPreview> {
    const before = await this.readBefore(request);
    await this.assertCas(request);
    let after: unknown = { action: request.action, target: request.target };
    let routeDecision: RouteDecisionExplanation | undefined;
    if (
      request.action === 'route_simulate' ||
      request.action === 'candidate_config_validate'
    ) {
      const simulation =
        await this.dependencies.modelControlPlane.simulateRoute(
          request.context,
          routeSimulationInput(request)
        );
      after = simulation;
      routeDecision = simulation.decisionExplanation;
    } else if (request.action === 'candidate_config_save') {
      after = structuredClone(request.parameters.candidate);
    } else if (
      request.action === 'isolate' ||
      request.action === 'stop_new_tasks'
    ) {
      after = { mode: 'isolated', reason: request.reason.trim() };
    } else if (request.action === 'drain') {
      after = { mode: 'draining', reason: request.reason.trim() };
    } else if (request.action === 'recover') {
      after = { mode: 'accepting', reason: request.reason.trim() };
    } else if (request.action === 'credential_rotate') {
      after = {
        version: String(
          ((before as { secretVersion?: number } | null)?.secretVersion ?? 0) +
            1
        ),
        status: (before as { status?: string } | null)?.status ?? 'unknown',
        requiresConnectivityRetest: true,
      };
    }
    const previewBase = {
      action: request.action,
      target: request.target,
      expectedRevisionId: request.expectedRevisionId,
      before,
      after,
      parameters: request.parameters ?? null,
    };
    return {
      id: `supply-preview-${digest(previewBase).slice(0, 32)}`,
      scope: `${request.target.resourceType}:${request.target.resourceId}`,
      changes: [
        `${request.action} ${request.target.resourceType} ${request.target.resourceId}`,
      ],
      warnings:
        request.action === 'credential_rotate'
          ? ['The new credential version requires a fresh connectivity probe.']
          : [],
      reversible: ['isolate', 'recover', 'stop_new_tasks', 'drain'].includes(
        request.action
      ),
      expectedRevisionId: request.expectedRevisionId,
      before,
      after,
      ...(routeDecision ? { routeDecision } : {}),
    };
  }

  async execute(
    input: GovernedSupplyActionExecution
  ): Promise<GovernedSupplyDomainResult> {
    const currentPreview = await this.preview(input.request);
    if (currentPreview.id !== input.preview.id) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'The governed supply target changed after preview approval.'
      );
    }
    const request = input.request;
    let value: unknown;
    let routeDecision:
      | {
          simulator: RouteDecisionExplanation;
          taskAudit: RouteDecisionExplanation;
        }
      | undefined;
    switch (request.action) {
      case 'connectivity_probe':
        value = await this.runConnectivityProbe(request);
        break;
      case 'conformance_probe':
        value = await this.runConformanceProbe(request);
        break;
      case 'route_simulate':
      case 'candidate_config_validate': {
        const simulator = input.preview.routeDecision!;
        value = input.preview.after;
        routeDecision = {
          simulator,
          taskAudit: { ...structuredClone(simulator), surface: 'task_audit' },
        };
        break;
      }
      case 'candidate_config_save':
        value = await this.saveRoutePolicyCandidate(request);
        break;
      case 'publish':
        value = await this.publish(request);
        break;
      case 'rollback':
        value = await this.rollback(request);
        break;
      case 'isolate':
      case 'stop_new_tasks':
        value = await this.executeChannelLifecycleTransition(
          request,
          (options) =>
            this.dependencies.hotAssembly.isolateChannel(
              request.target.resourceId,
              request.reason.trim(),
              options
            )
        );
        break;
      case 'recover':
        value = await this.executeChannelLifecycleTransition(
          request,
          (options) =>
            this.dependencies.hotAssembly.restoreChannel(
              request.target.resourceId,
              request.reason.trim(),
              options
            )
        );
        break;
      case 'drain':
        value = await this.executeChannelLifecycleTransition(
          request,
          (options) =>
            this.dependencies.hotAssembly.startChannelDrain(
              request.target.resourceId,
              request.reason.trim(),
              options
            )
        );
        break;
      case 'credential_pre_revoke':
        value = {
          account: input.preview.before,
          impactedDeploymentIds: await this.credentialDeploymentIds(request),
          decision: 'manual_confirmation_required',
        };
        break;
      case 'credential_rotate':
        value = await this.rotateCredential(request);
        break;
      case 'health_refresh':
        value = await this.refreshOperationalEvidence(request);
        break;
      default: {
        const exhaustive: never = request;
        throw new P1DomainError(
          'INVALID_STATE',
          `Unsupported governed request ${JSON.stringify(exhaustive)}.`
        );
      }
    }
    return {
      value,
      audit: structuredClone(input.audit),
      ...(routeDecision ? { routeDecision } : {}),
    };
  }

  async queryOutcome(
    input: GovernedSupplyActionExecution
  ): Promise<GovernedSupplyDomainResult | null> {
    const request = input.request;
    const recovered = (value: unknown): GovernedSupplyDomainResult => ({
      value: structuredClone(value),
      audit: structuredClone(input.audit),
    });
    switch (request.action) {
      case 'route_simulate':
      case 'candidate_config_validate': {
        const simulator = input.preview.routeDecision;
        if (!simulator) return null;
        return {
          ...recovered(input.preview.after),
          routeDecision: {
            simulator: structuredClone(simulator),
            taskAudit: {
              ...structuredClone(simulator),
              surface: 'task_audit',
            },
          },
        };
      }
      case 'candidate_config_save': {
        const candidate = request.parameters.candidate;
        const stored = await this.dependencies.planning.getRoutePolicyRevision(
          request.context.workspaceId,
          candidate.revisionId
        );
        return stored && digest(stored) === digest(candidate)
          ? recovered(stored)
          : null;
      }
      case 'publish':
      case 'rollback': {
        if (request.target.resourceType === 'catalog_revision') {
          if (request.action === 'publish') {
            const current =
              await this.dependencies.modelRepository.getCurrentPublishedCatalogRevision(
                request.context.workspaceId
              );
            return current?.id === request.target.resourceId
              ? recovered(current)
              : null;
          }
          const rollbackAudit = (
            await this.dependencies.modelControlPlane.listRevisionRollbackAudits(
              request.context.workspaceId
            )
          ).find(
            (audit) =>
              audit.kind === 'catalog' &&
              audit.correlationId === request.context.correlationId &&
              audit.actorId === request.context.userId &&
              audit.toRevisionId === request.target.resourceId &&
              audit.reason === request.reason.trim()
          );
          return rollbackAudit
            ? recovered({
                audit: rollbackAudit,
                currentRevisionId: request.target.resourceId,
              })
            : null;
        }
        const target = await this.dependencies.planning.getRoutePolicyRevision(
          request.context.workspaceId,
          request.target.resourceId
        );
        if (!target) return null;
        const current = (
          await this.dependencies.planning.listPublishedRoutePolicies(
            request.context.workspaceId
          )
        ).find(
          (revision) =>
            revision.operation === target.operation &&
            (revision.qualityTier ?? 'quality') ===
              (target.qualityTier ?? 'quality')
        );
        return current?.revisionId === target.revisionId
          ? recovered(target)
          : null;
      }
      case 'isolate':
      case 'stop_new_tasks':
      case 'drain':
      case 'recover': {
        const current = await this.dependencies.hotAssembly.getChannelLifecycle(
          request.target.resourceId
        );
        const expectedMode =
          request.action === 'drain'
            ? 'draining'
            : request.action === 'recover'
              ? 'accepting'
              : 'isolated';
        return current.mode === expectedMode &&
          current.reason === request.reason.trim()
          ? recovered(current)
          : null;
      }
      case 'credential_pre_revoke':
        return recovered({
          account: input.preview.before,
          impactedDeploymentIds: await this.credentialDeploymentIds(request),
          decision: 'manual_confirmation_required',
        });
      case 'credential_rotate': {
        const row = await this.dependencies.registry.getCredentialAccount(
          PLATFORM_CREDENTIAL_WORKSPACE_ID,
          request.target.resourceId
        );
        const previousSecretVersion = Number(
          (input.preview.before as { secretVersion?: unknown } | null)
            ?.secretVersion
        );
        return row &&
          Number.isInteger(previousSecretVersion) &&
          row.account.secretVersion === previousSecretVersion + 1
          ? recovered(toPublicMetadata(row.account))
          : null;
      }
      case 'connectivity_probe':
      case 'conformance_probe': {
        const probes = this.dependencies.providerProbes;
        let result: AdminProviderProbeResult | null = null;
        if (probes?.queryOutcome) {
          result = await probes.queryOutcome({
            context: request.context,
            deploymentId: request.parameters.deploymentId,
            operation: request.parameters.operation,
            probeKind: request.parameters.probeKind,
            idempotencyKey: request.idempotencyKey,
          });
        } else if (request.action === 'conformance_probe' && !probes) {
          const run = (
            await this.dependencies.modelControlPlane.listActivationProbeRuns(
              request.context.workspaceId
            )
          ).find(
            (candidate) =>
              candidate.correlationId === request.context.correlationId &&
              candidate.deploymentId === request.parameters.deploymentId &&
              candidate.operation === request.parameters.operation
          );
          if (run) {
            result = {
              probeKind: 'conformance',
              outcome: run.outcome,
              observedAt: run.createdAt,
              evidenceRef: run.id,
            };
          }
        }
        return result
          ? recovered(
              normalizeProviderProbeResult(result, request.parameters.probeKind)
            )
          : null;
      }
      case 'health_refresh': {
        const refresher = this.dependencies.operationalEvidence;
        if (!refresher) {
          return recovered(
            unavailableOperationalEvidence(
              new Date(input.audit.occurredAt),
              'provider_operational_evidence_refresh_unavailable'
            )
          );
        }
        const result = await refresher.queryOutcome?.({
          context: request.context,
          targetKind: request.target.resourceType,
          targetId: request.target.resourceId,
          idempotencyKey: request.idempotencyKey,
        });
        return result
          ? recovered(
              normalizeOperationalEvidence(
                result,
                new Date(input.audit.occurredAt)
              )
            )
          : null;
      }
    }
  }

  private async executeChannelLifecycleTransition(
    request: Extract<
      AdminSupplyGovernedActionRequest,
      { action: 'isolate' | 'stop_new_tasks' | 'recover' | 'drain' }
    >,
    transition: (options: {
      expectedLifecycleRevision?: string;
    }) => Promise<ChannelLifecycleState>
  ): Promise<ChannelLifecycleState> {
    try {
      return await transition(
        request.expectedRevisionId
          ? { expectedLifecycleRevision: request.expectedRevisionId }
          : {}
      );
    } catch (error) {
      if (
        error instanceof HotAssemblyError &&
        error.code === 'LIFECYCLE_REVISION_CONFLICT'
      ) {
        throw new P1DomainError('IDEMPOTENCY_CONFLICT', error.message);
      }
      throw error;
    }
  }

  private async assertCas(request: AdminSupplyGovernedActionRequest) {
    if (request.expectedRevisionId === null) return;
    const current = await this.currentRevision(request);
    if (current !== request.expectedRevisionId) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `The governed supply target revision changed from ${request.expectedRevisionId} to ${current ?? 'missing'}.`
      );
    }
  }

  private async currentRevision(
    request: AdminSupplyGovernedActionRequest
  ): Promise<string | null> {
    const registry =
      await this.dependencies.registry.getCurrentRegistryRevision(
        request.context.workspaceId
      );
    switch (request.target.resourceType) {
      case 'catalog_revision':
        return registry?.catalogRevisionId ?? null;
      case 'deployment':
        return (
          registry?.deployments.find(
            (row) => row.id === request.target.resourceId
          )?.revisionId ?? null
        );
      case 'channel':
        return (
          await this.dependencies.hotAssembly.getChannelLifecycle(
            request.target.resourceId
          )
        ).lifecycleRevision;
      case 'credential_account':
        return (
          (
            await this.dependencies.registry.getCredentialAccount(
              PLATFORM_CREDENTIAL_WORKSPACE_ID,
              request.target.resourceId
            )
          )?.account.version ?? null
        );
      case 'pool':
        return (
          (await this.dependencies.pools.get(request.target.resourceId))
            ?.revisionId ?? null
        );
      case 'route_policy': {
        const published =
          await this.dependencies.planning.listPublishedRoutePolicies(
            request.context.workspaceId
          );
        const target = await this.dependencies.planning.getRoutePolicyRevision(
          request.context.workspaceId,
          request.target.resourceId
        );
        if (!target) return null;
        return (
          published.find(
            (row) =>
              row.operation === target.operation &&
              (row.qualityTier ?? 'quality') ===
                (target.qualityTier ?? 'quality')
          )?.revisionId ?? null
        );
      }
      case 'operation':
        return (
          (
            await this.dependencies.planning.listPublishedRoutePolicies(
              request.context.workspaceId
            )
          ).find((row) => row.operation === request.target.resourceId)
            ?.revisionId ??
          registry?.catalogRevisionId ??
          null
        );
    }
  }

  private async readBefore(request: AdminSupplyGovernedActionRequest) {
    const registry =
      await this.dependencies.registry.getCurrentRegistryRevision(
        request.context.workspaceId
      );
    switch (request.target.resourceType) {
      case 'catalog_revision':
        return { revisionId: registry?.catalogRevisionId ?? null };
      case 'deployment':
        return (
          registry?.deployments.find(
            (row) => row.id === request.target.resourceId
          ) ?? null
        );
      case 'channel':
        return this.dependencies.hotAssembly.getChannelLifecycle(
          request.target.resourceId
        );
      case 'credential_account': {
        const row = await this.dependencies.registry.getCredentialAccount(
          PLATFORM_CREDENTIAL_WORKSPACE_ID,
          request.target.resourceId
        );
        return row
          ? {
              ...toPublicMetadata(row.account),
              secretVersion: row.account.secretVersion,
            }
          : null;
      }
      case 'pool':
        return this.dependencies.pools.get(request.target.resourceId);
      case 'route_policy':
        return this.dependencies.planning.getRoutePolicyRevision(
          request.context.workspaceId,
          request.target.resourceId
        );
      case 'operation':
        return (
          (
            await this.dependencies.planning.listPublishedRoutePolicies(
              request.context.workspaceId
            )
          ).find((row) => row.operation === request.target.resourceId) ?? null
        );
    }
  }

  private async publish(request: AdminSupplyGovernedActionRequest) {
    if (request.action !== 'publish') {
      throw new P1DomainError('INVALID_STATE', 'Publish request required.');
    }
    if (request.target.resourceType === 'catalog_revision') {
      const current =
        await this.dependencies.modelRepository.getCurrentPublishedCatalogRevision(
          request.context.workspaceId
        );
      if (current?.id === request.target.resourceId) return current;
      return this.dependencies.modelControlPlane.publishCatalog(
        request.context.workspaceId,
        request.target.resourceId,
        request.expectedRevisionId,
        request.reason.trim(),
        {
          actorId: request.context.userId,
          correlationId: request.context.correlationId,
        }
      );
    }
    const revision = await this.dependencies.planning.getRoutePolicyRevision(
      request.context.workspaceId,
      request.target.resourceId
    );
    if (!revision) {
      throw new P1DomainError('NOT_FOUND', 'RoutePolicy revision not found.');
    }
    await this.dependencies.planning.publishRoutePolicy(
      request.context.workspaceId,
      revision,
      request.expectedRevisionId
    );
    return revision;
  }

  private async saveRoutePolicyCandidate(
    request: AdminSupplyGovernedActionRequest
  ) {
    if (request.action !== 'candidate_config_save') {
      throw new P1DomainError(
        'INVALID_STATE',
        'RoutePolicy candidate save request required.'
      );
    }
    const base = await this.dependencies.planning.getRoutePolicyRevision(
      request.context.workspaceId,
      request.target.resourceId
    );
    const candidate = request.parameters.candidate;
    if (
      !base ||
      base.id !== candidate.id ||
      base.operation !== candidate.operation ||
      (base.qualityTier ?? 'quality') !==
        (candidate.qualityTier ?? 'quality') ||
      candidate.revisionId === base.revisionId
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'RoutePolicy candidate must derive from the selected current policy identity and use a new revision id.'
      );
    }
    await this.dependencies.planning.saveRoutePolicyCandidate(
      request.context.workspaceId,
      candidate
    );
    return structuredClone(candidate);
  }

  private async rollback(request: AdminSupplyGovernedActionRequest) {
    if (request.action !== 'rollback') {
      throw new P1DomainError('INVALID_STATE', 'Rollback request required.');
    }
    if (request.target.resourceType === 'catalog_revision') {
      return this.dependencies.modelControlPlane.rollbackCatalogRevision(
        request.context,
        request.target.resourceId,
        request.reason.trim()
      );
    }
    const target = await this.dependencies.planning.getRoutePolicyRevision(
      request.context.workspaceId,
      request.target.resourceId
    );
    if (!target || request.expectedRevisionId === null) {
      throw new P1DomainError(
        'NOT_FOUND',
        'RoutePolicy rollback target or current head was not found.'
      );
    }
    await this.dependencies.planning.rollbackRoutePolicy({
      workspaceId: request.context.workspaceId,
      operation: target.operation,
      qualityTier: target.qualityTier ?? 'quality',
      expectedHeadRevisionId: request.expectedRevisionId,
      targetRevisionId: target.revisionId,
    });
    return target;
  }

  private async credentialDeploymentIds(
    request: AdminSupplyGovernedActionRequest
  ) {
    const registry =
      await this.dependencies.registry.getCurrentRegistryRevision(
        request.context.workspaceId
      );
    return (
      registry?.deployments
        .filter((row) => row.credentialAccountId === request.target.resourceId)
        .map((row) => row.id) ?? []
    );
  }

  private async rotateCredential(request: AdminSupplyGovernedActionRequest) {
    if (request.action !== 'credential_rotate') {
      throw new P1DomainError('INVALID_STATE', 'Credential rotation required.');
    }
    if (request.expectedRevisionId === null) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Credential rotation requires the current account version.'
      );
    }
    const next = await this.dependencies.credentialRotations.consumeAndRotate({
      workspaceId: PLATFORM_CREDENTIAL_WORKSPACE_ID,
      accountId: request.target.resourceId,
      receiptId: request.parameters.secureWriteReceiptId,
      expectedAccountVersion: request.expectedRevisionId,
      now: (this.dependencies.clock ?? (() => new Date()))().toISOString(),
    });
    return toPublicMetadata(next);
  }

  private async runConnectivityProbe(request: {
    context: AdminSupplyGovernedActionRequest['context'];
    parameters: {
      deploymentId: string;
      operation: SupplyOperation;
    };
    idempotencyKey: string;
  }) {
    const probes = this.dependencies.providerProbes;
    if (!probes) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Provider connectivity probe execution is unavailable.'
      );
    }
    const result = await probes.runConnectivity({
      context: request.context,
      deploymentId: request.parameters.deploymentId,
      operation: request.parameters.operation,
      idempotencyKey: request.idempotencyKey,
    });
    return normalizeProviderProbeResult(result, 'connectivity');
  }

  private async runConformanceProbe(request: {
    context: AdminSupplyGovernedActionRequest['context'];
    parameters: {
      deploymentId: string;
      operation: SupplyOperation;
    };
    idempotencyKey: string;
  }): Promise<AdminProviderProbeResult & { probeKind: 'conformance' }> {
    const probes = this.dependencies.providerProbes;
    if (probes) {
      const result = await probes.runConformance({
        context: request.context,
        deploymentId: request.parameters.deploymentId,
        operation: request.parameters.operation,
        idempotencyKey: request.idempotencyKey,
      });
      return normalizeProviderProbeResult(result, 'conformance');
    }
    const run = await this.dependencies.modelControlPlane.runActivationProbe(
      request.context,
      request.parameters.deploymentId,
      request.parameters.operation,
      request.idempotencyKey
    );
    return {
      probeKind: 'conformance',
      outcome: run.outcome,
      observedAt: run.createdAt,
      evidenceRef: run.id,
    };
  }

  private async refreshOperationalEvidence(
    request: Extract<
      AdminSupplyGovernedActionRequest,
      { action: 'health_refresh' }
    >
  ): Promise<
    | AdminOperationalEvidenceRefreshResult
    | {
        evidenceSource: 'unavailable';
        observedAt: string;
        evidenceRef: null;
        health: { status: 'unknown'; reason: string };
        balance: { status: 'unknown'; reason: string };
        quota: { status: 'unknown'; reason: string };
      }
  > {
    const refresher = this.dependencies.operationalEvidence;
    if (refresher) {
      const refreshed = await refresher.refresh({
        context: request.context,
        targetKind: request.target.resourceType,
        targetId: request.target.resourceId,
        idempotencyKey: request.idempotencyKey,
      });
      return normalizeOperationalEvidence(
        refreshed,
        (this.dependencies.clock ?? (() => new Date()))()
      );
    }
    return unavailableOperationalEvidence(
      (this.dependencies.clock ?? (() => new Date()))(),
      'provider_operational_evidence_refresh_unavailable'
    );
  }
}

function normalizeProviderProbeResult<
  Kind extends AdminProviderProbeResult['probeKind'],
>(
  result: AdminProviderProbeResult,
  expectedKind: Kind
): AdminProviderProbeResult & { probeKind: Kind } {
  if (
    result.probeKind !== expectedKind ||
    !['passed', 'failed', 'unknown'].includes(result.outcome) ||
    !Number.isFinite(Date.parse(result.observedAt)) ||
    !result.evidenceRef.trim()
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Provider ${expectedKind} probe returned invalid evidence.`
    );
  }
  return {
    probeKind: expectedKind,
    outcome: result.outcome,
    observedAt: result.observedAt,
    evidenceRef: result.evidenceRef,
  };
}

function normalizeOperationalEvidence(
  result:
    | AdminOperationalEvidenceRefreshResult
    | AdminOperationalEvidenceUnavailableResult,
  now: Date
):
  | AdminOperationalEvidenceRefreshResult
  | ReturnType<typeof unavailableOperationalEvidence> {
  if (result.evidenceSource === 'unavailable') {
    return unavailableOperationalEvidence(
      now,
      'provider_operational_evidence_unavailable'
    );
  }
  const healthStates = [
    'healthy',
    'degraded',
    'cooldown',
    'circuit_open',
    'unavailable',
  ];
  const healthValid =
    (result.health.status === 'known' &&
      healthStates.includes(result.health.state)) ||
    (result.health.status === 'unknown' && Boolean(result.health.reason));
  const balanceValid =
    (result.balance.status === 'known' &&
      Number.isFinite(result.balance.amount) &&
      result.balance.amount >= 0 &&
      ['CNY', 'USD'].includes(result.balance.currency)) ||
    (result.balance.status === 'unknown' && Boolean(result.balance.reason));
  const quotaValid =
    (result.quota.status === 'known' &&
      Number.isFinite(result.quota.remaining) &&
      result.quota.remaining >= 0 &&
      Boolean(result.quota.unit.trim())) ||
    (result.quota.status === 'unknown' && Boolean(result.quota.reason));
  if (
    result.evidenceSource !== 'live_provider' ||
    !Number.isFinite(Date.parse(result.observedAt)) ||
    !result.evidenceRef.trim() ||
    !healthValid ||
    !balanceValid ||
    !quotaValid
  ) {
    return unavailableOperationalEvidence(
      now,
      'provider_operational_evidence_invalid'
    );
  }
  return {
    evidenceSource: 'live_provider',
    observedAt: result.observedAt,
    evidenceRef: result.evidenceRef,
    health:
      result.health.status === 'known'
        ? { status: 'known', state: result.health.state }
        : { status: 'unknown', reason: result.health.reason },
    balance:
      result.balance.status === 'known'
        ? {
            status: 'known',
            amount: result.balance.amount,
            currency: result.balance.currency,
          }
        : { status: 'unknown', reason: result.balance.reason },
    quota:
      result.quota.status === 'known'
        ? {
            status: 'known',
            remaining: result.quota.remaining,
            unit: result.quota.unit,
          }
        : { status: 'unknown', reason: result.quota.reason },
  };
}

function unavailableOperationalEvidence(now: Date, reason: string) {
  return {
    evidenceSource: 'unavailable' as const,
    observedAt: now.toISOString(),
    evidenceRef: null,
    health: { status: 'unknown' as const, reason },
    balance: { status: 'unknown' as const, reason },
    quota: { status: 'unknown' as const, reason },
  };
}

function supplierPrices(
  catalog: Awaited<
    ReturnType<ModelSupplyControlPlaneService['getAdminCatalogControl']>
  >
): SupplierPriceRevision[] {
  return catalog.catalog.prices.flatMap((price) => {
    const deployment = catalog.catalog.deployments.find(
      (candidate) =>
        candidate.catalogModelId === price.catalogModelId &&
        (!price.executionChannelId ||
          candidate.executionChannelId === price.executionChannelId),
    );
    return deployment
      ? [{
        id: price.id,
        deploymentId: deployment.id,
        executionChannelId: deployment.executionChannelId ?? 'unknown',
        pricingTier: price.pricingTier ?? 'standard',
        amountMicros: Math.round(price.amount * 1_000_000),
        currency: price.currency,
        unit: price.unit ?? 'request',
        evidence: { source: 'gateway_estimate' as const },
        revisionId: `${price.id}:r${price.revision}`,
      }]
      : [];
  });
}

export async function projectPostgresSupplyRuns(
  workspaceId: string,
  repository: ModelSupplyControlPlaneRepository,
  registry: PostgresSupplyControlPlaneRepository,
  query: SupplyRunQuery = DEFAULT_SUPPLY_RUN_QUERY
): Promise<SupplyRunPage> {
  const current = await registry.getCurrentRegistryRevision(workspaceId);
  const channelDeploymentIds = query.channelKind
    ? (current?.deployments
        .filter((deployment) => {
          const channel = current.executionChannels.find(
            (candidate) => candidate.id === deployment.executionChannelId
          );
          return channel?.kind === query.channelKind;
        })
        .map((deployment) => deployment.id) ?? [])
    : undefined;
  const queryableStatuses = new Set<ModelSupplyJobListStatus>([
    'succeeded',
    'failed',
    'accepted',
    'acceptance_unknown',
    'rejected_before_accept',
  ]);
  const status = query.status;
  const unsupportedStatus =
    status !== undefined &&
    !queryableStatuses.has(status as ModelSupplyJobListStatus);
  const jobQuery: ModelSupplyJobListQuery = {
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    dir: query.dir,
    ...(query.operation ? { operation: query.operation } : {}),
    ...(status && !unsupportedStatus
      ? { status: status as ModelSupplyJobListStatus }
      : {}),
    ...(query.modality ? { modality: query.modality } : {}),
    ...(query.catalogModelId ? { catalogModelId: query.catalogModelId } : {}),
    ...(query.deploymentId ? { deploymentId: query.deploymentId } : {}),
    ...(unsupportedStatus
      ? { deploymentIds: [] }
      : channelDeploymentIds
        ? { deploymentIds: channelDeploymentIds }
        : {}),
    ...(query.dataClass
      ? {
          dataClass:
            query.dataClass === 'medical-health'
              ? ('medical' as const)
              : query.dataClass,
        }
      : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.taskId ? { taskId: query.taskId } : {}),
  };
  const jobs = await repository.listJobs(workspaceId, jobQuery);
  const rows: SupplyRunRecord[] = jobs.items.map((job) => {
    const operation = job.operation ?? 'copy.generate';
    const deployment = current?.deployments.find(
      (row) => row.id === job.attempt.deploymentId
    );
    const channel = current?.executionChannels.find(
      (row) => row.id === deployment?.executionChannelId
    );
    return {
      id: job.attempt.id,
      taskId: job.jobId,
      operation,
      modality: modality(operation),
      status: runStatus(job),
      catalogModelId: job.attempt.catalogModelId,
      deploymentId: job.attempt.deploymentId,
      providerProfileId: deployment?.providerProfileId ?? 'unknown',
      executionChannelId: deployment?.executionChannelId ?? 'unknown',
      channelKind: channel?.kind ?? 'official_direct',
      workspaceId,
      accountId: deployment?.credentialAccountId ?? 'unassigned',
      dataClass: (job.snapshot.dataClass[0] ??
        'public') as SupplyRunRecord['dataClass'],
      startedAt: job.attempt.createdAt,
      ...(job.endedAt ? { endedAt: job.endedAt } : {}),
      ...(typeof job.latencyMs === 'number'
        ? { latencyMs: job.latencyMs }
        : {}),
      ...(job.providerCost.amount > 0
        ? {
            costMicros: Math.round(job.providerCost.amount * 1_000_000),
            currency: job.providerCost.currency,
          }
        : {}),
      ...(job.failureCode ? { errorCode: job.failureCode } : {}),
      ...(job.asset
        ? {
            artifactPreviewUrl: `/api/p1/assets/${encodeURIComponent(job.asset.id)}`,
          }
        : {}),
      attemptCount: job.attempts.length,
      lifecycle: (job.status === 'unknown'
        ? 'async_poll'
        : 'terminal') as SupplyRunRecord['lifecycle'],
      ...((job.snapshot.routePolicyRevisionId ?? job.snapshot.policyRevision)
        ? {
            routePolicyRevisionId:
              job.snapshot.routePolicyRevisionId ?? job.snapshot.policyRevision,
          }
        : {}),
      ...(job.snapshot.supplyPoolId
        ? { poolId: job.snapshot.supplyPoolId }
        : {}),
      ...(job.snapshot.decisionExplanation
        ? {
            decisionExplanation: structuredClone(
              job.snapshot.decisionExplanation
            ),
          }
        : {}),
    };
  });
  const channelKinds = [
    ...new Set(current?.executionChannels.map((channel) => channel.kind) ?? []),
  ].sort();
  return {
    query: structuredClone(query),
    total: jobs.total,
    totalPages: Math.max(1, Math.ceil(jobs.total / jobs.pageSize)),
    rows,
    facets: {
      operations: jobs.facets.operations,
      statuses: jobs.facets.statuses,
      modalities: jobs.facets.modalities,
      channelKinds,
      dataClasses: jobs.facets.dataClasses,
    },
  };
}

function gatewayLinks(
  profiles: Array<{
    id: string;
    displayName: string;
    gatewayFingerprint?: string;
  }>
): SupplyGatewayDeepLink[] {
  return profiles.map((profile) => ({
    id: `gateway:${profile.id}`,
    label: profile.displayName,
    href: `/admin/integrations?providerProfileId=${encodeURIComponent(profile.id)}`,
    gatewayFingerprint: profile.gatewayFingerprint ?? 'none',
    evidenceOnly: true,
  }));
}

export function createPostgresAdminSupplyControlPlane(
  dependencies: RuntimeDependencies
): AdminSupplyControlPlane {
  const store = new PostgresAdminSupplyStore(dependencies.pool);
  const domain = new ProductionAdminSupplyDomain(dependencies);
  const snapshot: SupplyControlSnapshotPorts = {
    registry: dependencies.registry,
    channelLifecycle: dependencies.hotAssembly,
    pools: {
      listSupplyPools: async () => dependencies.pools.list(),
    },
    entitlements: {
      listEntitlementPolicies: async () =>
        dependencies.entitlementPolicies.listAll(),
      listAccountAllocations: async (workspaceId) =>
        dependencies.accountAllocations.listForWorkspace(
          workspaceId,
          dependencies.clock?.() ?? new Date()
        ),
    },
    routes: dependencies.planning,
    prices: {
      listSupplierPriceRevisions: async (workspaceId) =>
        supplierPrices(
          await dependencies.modelControlPlane.getAdminCatalogControl(
            workspaceId
          )
        ),
    },
    health: dependencies.planning.health,
    runs: {
      listSupplyRuns: async (workspaceId, query) =>
        projectPostgresSupplyRuns(
          workspaceId,
          dependencies.modelRepository,
          dependencies.registry,
          query
        ),
    },
    changes: store,
    gateways: {
      listGatewayDeepLinks: async (workspaceId) => {
        const registry =
          await dependencies.registry.getCurrentRegistryRevision(workspaceId);
        return gatewayLinks(registry?.providerProfiles ?? []);
      },
    },
    featuredModels: {
      getFeaturedCoreModelIds: async (workspaceId) => {
        const registry =
          await dependencies.registry.getCurrentRegistryRevision(workspaceId);
        const featured: Partial<
          Record<'copy.generate' | 'image.generate' | 'video.generate', string>
        > = {};
        for (const operation of [
          'copy.generate',
          'image.generate',
          'video.generate',
        ] as const) {
          const model = registry?.models.find(
            (candidate) =>
              candidate.operations.includes(operation) &&
              registry.deployments.some(
                (deployment) =>
                  deployment.catalogModelId === candidate.id &&
                  deployment.lifecycleStatus === 'active'
              )
          );
          if (model) featured[operation] = model.id;
        }
        return featured;
      },
    },
  };
  return new AdminSupplyControlPlane({
    snapshot,
    permission: dependencies.permission,
    idempotency: store,
    governed: {
      routes: domain,
      channels: domain,
      credentials: domain,
      health: domain,
    },
    clock: dependencies.clock,
  });
}
