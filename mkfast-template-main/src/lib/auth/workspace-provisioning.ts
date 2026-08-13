import type { getDb as getDatabase } from '@/db';
import {
  PostgresRequestUnavailableError,
  withPostgresRequestBoundary,
} from '@/db/postgres-connection-safety';
import { APIError } from 'better-auth/api';
import { sql } from 'drizzle-orm';

type WorkspaceDatabase = ReturnType<typeof getDatabase>;

export const WORKSPACE_PROVISION_TRIAL_KEY = 'workspace-provision:trial:v1';
export const WORKSPACE_PROVISION_MODEL_DEFAULT_KEY =
  'workspace-provision:model-default:v1';

export type WorkspaceProvisioningStatus =
  | 'pending'
  | 'processing'
  | 'retry'
  | 'completed'
  | 'dead_letter';

export const WORKSPACE_PROVISIONING_MAX_ATTEMPTS = 20;
export const WORKSPACE_PROVISIONING_BACKOFF_CAP_MS = 15 * 60 * 1000;

export function nextWorkspaceProvisioningRetry(attemptCount: number): {
  delayMs: number;
  status: 'retry' | 'dead_letter';
} {
  const delayMs = Math.min(
    WORKSPACE_PROVISIONING_BACKOFF_CAP_MS,
    1000 * 2 ** Math.max(0, attemptCount - 1)
  );
  if (attemptCount >= WORKSPACE_PROVISIONING_MAX_ATTEMPTS) {
    return {
      delayMs: WORKSPACE_PROVISIONING_BACKOFF_CAP_MS,
      status: 'dead_letter',
    };
  }
  return { delayMs, status: 'retry' };
}

export function shouldAllowDegradedCoreForward(
  record: WorkspaceProvisioningRecord | null
) {
  return !record || record.trialStatus === 'completed';
}

export function isWorkspaceProvisioningDegraded(
  record: Pick<
    WorkspaceProvisioningRecord,
    'modelDefaultStatus' | 'status' | 'trialStatus'
  > | null
) {
  if (!record || record.status === 'completed') return false;
  return (
    record.trialStatus !== 'completed' ||
    record.modelDefaultStatus !== 'completed'
  );
}

export type WorkspaceProvisioningStepStatus = 'pending' | 'completed';
export type WorkspaceProvisioningStep = 'trial' | 'model_default';

export interface WorkspaceProvisioningRecord {
  workspaceId: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  workspaceName: string;
  status: WorkspaceProvisioningStatus;
  claimToken?: string | null;
  trialStatus: WorkspaceProvisioningStepStatus;
  modelDefaultStatus: WorkspaceProvisioningStepStatus;
  lastErrorCode?: string | null;
}

export interface WorkspaceProvisioningOutboxPort {
  claim(input: {
    workspaceId: string;
    ownerUserId: string;
  }): Promise<WorkspaceProvisioningRecord | null>;
  completeStep(
    workspaceId: string,
    claimToken: string,
    step: WorkspaceProvisioningStep
  ): Promise<void>;
  complete(workspaceId: string, claimToken: string): Promise<void>;
  retry(
    workspaceId: string,
    claimToken: string,
    errorCode: string
  ): Promise<void>;
  get(
    workspaceId: string,
    ownerUserId: string
  ): Promise<WorkspaceProvisioningRecord | null>;
}

export interface WorkspaceProvisioningCommand {
  workspaceId: string;
  ownerUserId: string;
  action: 'register_gift' | 'provision_model_defaults';
  idempotencyKey:
    | typeof WORKSPACE_PROVISION_TRIAL_KEY
    | typeof WORKSPACE_PROVISION_MODEL_DEFAULT_KEY;
}

export interface CoreWorkspaceProvisioner {
  execute(command: WorkspaceProvisioningCommand): Promise<void>;
}

export interface CoreWorkspaceBootstrapper {
  bootstrap(input: WorkspaceBootstrapIdentity): Promise<void>;
}

export type WorkspaceBootstrapIdentity = {
  idempotencyKey: string;
  ownerEmail: string;
  ownerUserId: string;
  ownerName: string;
  workspaceId: string;
  workspaceName: string;
};

export async function bootstrapVerifiedWorkspaceIdentity(
  input: { workspaceId: string; ownerUserId: string },
  dependencies: {
    outbox: Pick<WorkspaceProvisioningOutboxPort, 'get'>;
    bootstrapper: CoreWorkspaceBootstrapper;
  }
) {
  const record = await dependencies.outbox.get(
    input.workspaceId,
    input.ownerUserId
  );
  if (!record) {
    throw new Error('Verified workspace bootstrap identity is unavailable.');
  }
  if (
    record.workspaceId !== input.workspaceId ||
    record.ownerUserId !== input.ownerUserId
  ) {
    throw new Error(
      'Verified workspace bootstrap identity does not match the workspace.'
    );
  }
  if (
    !record.ownerEmail.trim() ||
    !record.ownerName.trim() ||
    !record.workspaceName.trim()
  ) {
    throw new Error('Verified workspace bootstrap identity is incomplete.');
  }
  await dependencies.bootstrapper.bootstrap({
    idempotencyKey: `workspace-bootstrap:${record.workspaceId}`,
    ownerEmail: record.ownerEmail,
    ownerName: record.ownerName,
    ownerUserId: record.ownerUserId,
    workspaceId: record.workspaceId,
    workspaceName: record.workspaceName,
  });
}

export async function consumeWorkspaceProvisioning(
  input: { workspaceId: string; ownerUserId: string },
  dependencies: {
    outbox: WorkspaceProvisioningOutboxPort;
    provisioner: CoreWorkspaceProvisioner;
    processingPoll?: { attempts: number; intervalMs: number };
  }
) {
  const processingPoll = dependencies.processingPoll ?? {
    attempts: 100,
    intervalMs: 100,
  };
  let claim: WorkspaceProvisioningRecord | null = null;
  for (let attempt = 0; attempt < processingPoll.attempts; attempt += 1) {
    claim = await dependencies.outbox.claim(input);
    if (claim) break;
    const current = await dependencies.outbox.get(
      input.workspaceId,
      input.ownerUserId
    );
    // A genuinely legacy database may have no outbox row. Never synthesize a
    // pending gift here because it could replace an existing paid plan.
    if (!current) return null;
    if (current.status === 'completed') return current;
    if (current.status !== 'processing') {
      if (shouldAllowDegradedCoreForward(current)) return current;
      throw new Error('Verified workspace trial provisioning is incomplete.');
    }
    if (attempt + 1 < processingPoll.attempts) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, processingPoll.intervalMs)
      );
    }
  }
  if (!claim) {
    const current = await dependencies.outbox.get(
      input.workspaceId,
      input.ownerUserId
    );
    if (!current) return null;
    if (current.status === 'completed') return current;
    if (shouldAllowDegradedCoreForward(current)) return current;
    throw new Error('Verified workspace provisioning is still processing.');
  }
  if (!claim.claimToken) {
    throw new Error('Verified workspace provisioning claim is invalid.');
  }

  try {
    if (claim.trialStatus !== 'completed') {
      await dependencies.provisioner.execute({
        ...input,
        action: 'register_gift',
        idempotencyKey: WORKSPACE_PROVISION_TRIAL_KEY,
      });
      await dependencies.outbox.completeStep(
        input.workspaceId,
        claim.claimToken,
        'trial'
      );
    }
    if (claim.modelDefaultStatus !== 'completed') {
      await dependencies.provisioner.execute({
        ...input,
        action: 'provision_model_defaults',
        idempotencyKey: WORKSPACE_PROVISION_MODEL_DEFAULT_KEY,
      });
      await dependencies.outbox.completeStep(
        input.workspaceId,
        claim.claimToken,
        'model_default'
      );
    }
    await dependencies.outbox.complete(input.workspaceId, claim.claimToken);
  } catch (error) {
    await dependencies.outbox.retry(
      input.workspaceId,
      claim.claimToken,
      safeErrorCode(error)
    );
    const degraded = await dependencies.outbox.get(
      input.workspaceId,
      input.ownerUserId
    );
    if (shouldAllowDegradedCoreForward(degraded)) return degraded;
    throw error;
  }

  const completed = await dependencies.outbox.get(
    input.workspaceId,
    input.ownerUserId
  );
  if (!completed || completed.status !== 'completed') {
    throw new Error('Verified workspace provisioning did not complete.');
  }
  return completed;
}

interface ProvisioningRow extends Record<string, unknown> {
  workspaceId: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  workspaceName: string;
  status: WorkspaceProvisioningStatus;
  trialStatus: WorkspaceProvisioningStepStatus;
  modelDefaultStatus: WorkspaceProvisioningStepStatus;
  claimToken: string | null;
  lastErrorCode: string | null;
}

export class PostgresWorkspaceProvisioningOutbox
  implements WorkspaceProvisioningOutboxPort
{
  constructor(private readonly database: WorkspaceDatabase) {}

  async claim(input: { workspaceId: string; ownerUserId: string }) {
    const claimToken = crypto.randomUUID();
    const rows = await this.database.execute<ProvisioningRow>(sql`
      UPDATE workspace_provisioning_outbox
      SET status = 'processing',
          claim_token = ${claimToken},
          attempt_count = attempt_count + 1,
          lease_expires_at = now() + interval '5 minutes',
          last_error_code = NULL,
          updated_at = now()
      WHERE workspace_id = ${input.workspaceId}
        AND owner_user_id = ${input.ownerUserId}
        AND (
          (status IN ('pending', 'retry', 'dead_letter') AND available_at <= now())
          OR (status = 'processing' AND lease_expires_at <= now())
        )
      RETURNING
        workspace_id AS "workspaceId",
        owner_user_id AS "ownerUserId",
        owner_email AS "ownerEmail",
        owner_name AS "ownerName",
        workspace_name AS "workspaceName",
        status,
        claim_token AS "claimToken",
        trial_status AS "trialStatus",
        model_default_status AS "modelDefaultStatus",
        last_error_code AS "lastErrorCode"
    `);
    return rows[0] ? provisioningRecord(rows[0]) : null;
  }

  async completeStep(
    workspaceId: string,
    claimToken: string,
    step: WorkspaceProvisioningStep
  ) {
    if (step === 'trial') {
      const rows = await this.database.execute(sql`
        UPDATE workspace_provisioning_outbox
        SET trial_status = 'completed', updated_at = now()
        WHERE workspace_id = ${workspaceId}
          AND status = 'processing'
          AND claim_token = ${claimToken}
        RETURNING workspace_id
      `);
      assertClaimMutation(rows);
      return;
    }
    const rows = await this.database.execute(sql`
      UPDATE workspace_provisioning_outbox
      SET model_default_status = 'completed', updated_at = now()
      WHERE workspace_id = ${workspaceId}
        AND status = 'processing'
        AND claim_token = ${claimToken}
      RETURNING workspace_id
    `);
    assertClaimMutation(rows);
  }

  async complete(workspaceId: string, claimToken: string) {
    const rows = await this.database.execute(sql`
      UPDATE workspace_provisioning_outbox
      SET status = 'completed',
          completed_at = COALESCE(completed_at, now()),
          claim_token = NULL,
          lease_expires_at = NULL,
          last_error_code = NULL,
          updated_at = now()
      WHERE workspace_id = ${workspaceId}
        AND status = 'processing'
        AND claim_token = ${claimToken}
        AND trial_status = 'completed'
        AND model_default_status = 'completed'
      RETURNING workspace_id
    `);
    assertClaimMutation(rows);
  }

  async retry(workspaceId: string, claimToken: string, errorCode: string) {
    const rows = await this.database.execute<{
      attemptCount: number;
      status: WorkspaceProvisioningStatus;
      workspaceId: string;
    }>(sql`
      UPDATE workspace_provisioning_outbox
      SET status = CASE
            WHEN attempt_count >= ${WORKSPACE_PROVISIONING_MAX_ATTEMPTS}
              THEN 'dead_letter'
            ELSE 'retry'
          END,
          available_at = now() + (
            LEAST(
              ${WORKSPACE_PROVISIONING_BACKOFF_CAP_MS / 1000},
              POWER(2, GREATEST(attempt_count - 1, 0))
            ) * interval '1 second'
          ),
          claim_token = NULL,
          lease_expires_at = NULL,
          last_error_code = ${errorCode},
          updated_at = now()
      WHERE workspace_id = ${workspaceId}
        AND status = 'processing'
        AND claim_token = ${claimToken}
      RETURNING
        workspace_id AS "workspaceId",
        status,
        attempt_count AS "attemptCount"
    `);
    const deadLettered = rows.find((row) => row.status === 'dead_letter');
    if (deadLettered) {
      console.warn('workspace provisioning dead-lettered', {
        attemptCount: deadLettered.attemptCount,
        errorCode,
        event: 'WORKSPACE_PROVISIONING_DEAD_LETTER',
        workspaceId: deadLettered.workspaceId,
      });
    }
  }

  async get(workspaceId: string, ownerUserId: string) {
    const rows = await this.database.execute<ProvisioningRow>(sql`
      SELECT
        workspace_id AS "workspaceId",
        owner_user_id AS "ownerUserId",
        owner_email AS "ownerEmail",
        owner_name AS "ownerName",
        workspace_name AS "workspaceName",
        status,
        claim_token AS "claimToken",
        trial_status AS "trialStatus",
        model_default_status AS "modelDefaultStatus",
        last_error_code AS "lastErrorCode"
      FROM workspace_provisioning_outbox
      WHERE workspace_id = ${workspaceId} AND owner_user_id = ${ownerUserId}
      LIMIT 1
    `);
    return rows[0] ? provisioningRecord(rows[0]) : null;
  }
}

export function createCoreWorkspaceProvisioner(options: {
  coreServiceUrl: string;
  coreServiceToken: string;
  fetch?: typeof fetch;
}): CoreWorkspaceProvisioner {
  const request = options.fetch ?? fetch;
  return {
    async execute(command) {
      const response = await request(
        `${options.coreServiceUrl}/v1/workspaces/${encodeURIComponent(command.workspaceId)}/p1/commands`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': command.idempotencyKey,
            'x-core-actor': 'worker',
            'x-correlation-id': `${command.idempotencyKey}:${command.workspaceId}`,
            'x-service-token': options.coreServiceToken,
            'x-user-id': command.ownerUserId,
            'x-workspace-id': command.workspaceId,
          },
          body: JSON.stringify({
            action: command.action,
            module: 'entitlements',
            payload: {},
          }),
        }
      );
      if (response.ok) return;
      const body = await response.json().catch(() => null);
      const coreError =
        body &&
        typeof body === 'object' &&
        'error' in body &&
        body.error &&
        typeof body.error === 'object'
          ? body.error
          : null;
      const coreCode =
        coreError &&
        'code' in coreError &&
        typeof coreError.code === 'string' &&
        /^[A-Z0-9_]{1,80}$/u.test(coreError.code)
          ? coreError.code
          : `CORE_HTTP_${response.status}`;
      const coreMessage =
        coreError &&
        'message' in coreError &&
        typeof coreError.message === 'string'
          ? coreError.message
          : `Workspace provisioning command failed (${response.status}).`;
      const error = new Error(coreMessage) as Error & { code: string };
      error.code = coreCode;
      throw error;
    },
  };
}

export function createCoreWorkspaceBootstrapper(options: {
  coreServiceUrl: string;
  coreServiceToken: string;
  fetch?: typeof fetch;
}): CoreWorkspaceBootstrapper {
  const request = options.fetch ?? fetch;
  return {
    async bootstrap(input) {
      const response = await request(
        `${options.coreServiceUrl}/v1/workspaces/${encodeURIComponent(input.workspaceId)}/bootstrap`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': input.idempotencyKey,
            'x-core-actor': 'worker',
            'x-correlation-id': input.idempotencyKey,
            'x-service-token': options.coreServiceToken,
            'x-user-id': input.ownerUserId,
            'x-workspace-id': input.workspaceId,
          },
          body: JSON.stringify({
            name: input.workspaceName,
            owner: { email: input.ownerEmail, name: input.ownerName },
          }),
        }
      );
      if (response.ok) return;
      throw await coreProvisioningError(
        response,
        'Workspace bootstrap request failed.'
      );
    },
  };
}

export async function ensureVerifiedWorkspaceProvisionedForCoreForward(input: {
  database: WorkspaceDatabase;
  workspaceId: string;
  ownerUserId: string;
  coreServiceUrl: string;
  coreServiceToken: string;
}) {
  try {
    return await ensureVerifiedWorkspaceProvisioned(input);
  } catch (error) {
    if (error instanceof APIError) throw error;
    const record = await new PostgresWorkspaceProvisioningOutbox(
      input.database
    ).get(input.workspaceId, input.ownerUserId);
    if (shouldAllowDegradedCoreForward(record)) return record;
    throw error;
  }
}

export async function ensureVerifiedWorkspaceProvisioned(input: {
  database: WorkspaceDatabase;
  workspaceId: string;
  ownerUserId: string;
  coreServiceUrl: string;
  coreServiceToken: string;
}) {
  const correlationId = `workspace-provisioning:${crypto.randomUUID()}`;
  try {
    return await withPostgresRequestBoundary(
      {
        correlationId,
        route: 'auth.workspace-provisioning',
        workspaceId: input.workspaceId,
      },
      async () => {
        const outbox = new PostgresWorkspaceProvisioningOutbox(input.database);
        const bootstrapper = createCoreWorkspaceBootstrapper(input);
        await bootstrapVerifiedWorkspaceIdentity(input, {
          outbox,
          bootstrapper,
        });
        return consumeWorkspaceProvisioning(input, {
          outbox,
          provisioner: createCoreWorkspaceProvisioner(input),
        });
      }
    );
  } catch (error) {
    if (!(error instanceof PostgresRequestUnavailableError)) throw error;
    throw new APIError(
      'SERVICE_UNAVAILABLE',
      {
        code: error.code,
        correlationId: error.correlationId,
        message: error.message,
      },
      { 'retry-after': '5' }
    );
  }
}

function provisioningRecord(row: ProvisioningRow): WorkspaceProvisioningRecord {
  return {
    workspaceId: row.workspaceId,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.ownerEmail,
    ownerName: row.ownerName,
    workspaceName: row.workspaceName,
    status: row.status,
    claimToken: row.claimToken,
    trialStatus: row.trialStatus,
    modelDefaultStatus: row.modelDefaultStatus,
    lastErrorCode: row.lastErrorCode,
  };
}

function assertClaimMutation(rows: unknown[]) {
  if (rows.length === 0) {
    throw new Error('Verified workspace provisioning claim was lost.');
  }
}

function safeErrorCode(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z0-9_]{1,80}$/u.test(error.code)
  ) {
    return error.code;
  }
  return 'WORKSPACE_PROVISIONING_FAILED';
}

async function coreProvisioningError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  const coreError =
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object'
      ? body.error
      : null;
  const coreCode =
    coreError &&
    'code' in coreError &&
    typeof coreError.code === 'string' &&
    /^[A-Z0-9_]{1,80}$/u.test(coreError.code)
      ? coreError.code
      : `CORE_HTTP_${response.status}`;
  const coreMessage =
    coreError && 'message' in coreError && typeof coreError.message === 'string'
      ? coreError.message
      : fallback;
  const error = new Error(coreMessage) as Error & { code: string };
  error.code = coreCode;
  return error;
}
