import { randomUUID } from "node:crypto";
import {
  isComposerVariantPlatform,
  type BuildProductQuoteInput,
  type ProductQuoteSnapshot,
} from "@meiye/contracts";
import type { Pool, PoolClient } from "pg";

import { P1DomainError } from "../foundation/domain.js";
import { PostgresGrantLotLedger } from "../foundation/postgres-grant-lot.js";
import { creditUsageOperationId } from "../credit-billing/credit-ledger.js";
import {
  lockWorkspaceCreditsWithClient,
  PostgresCreditLedger,
} from "../credit-billing/postgres-credit-ledger.js";
import { buildContentPackage } from "../operations/content-package.js";
import { insertContentPackageRow } from "../operations/postgres-content-package-write-adapter.js";
import { DurableProductBillingService } from "../product-billing/durable-service.js";
import { PostgresProductBillingRepository } from "../product-billing/postgres-repository.js";
import {
  grantLotUsageOperationId,
  reservedProductUsageUnits,
} from "../product-billing/product-usage-ledger.js";
import { creationExecutionSnapshotSchema } from "./creation-execution-snapshot.js";
import {
  confirmationSuccessorReservationIdempotencyKey,
  expiredConfirmationSuccessorRequestId,
	 repricedConfirmationSuccessorRequestId,
} from "../agent-session/execution-confirmation-authority.js";
import { confirmationCreditTransactionFromPostgresClient } from "../agent-session/postgres-execution-confirmation-store.js";
import { fingerprintValue } from "../job-runtime/job-contracts.js";
import type {
	ComposerAgentBinding,
  CreationSubmissionRecord,
  CreationSubmissionStore,
  CreationSubmissionStoreClaim,
  CreationSubmissionUsageUnit,
  HarnessSubmissionState,
  ExpiredConfirmationSuccessorPreparation,
	 RepricedConfirmationSuccessorPreparation,
} from "./submission-coordinator.js";

import {
  asAgentThreadIdentity,
  composerPreparedAttemptId,
	RepricedPaidExecutionSuccessorUnavailableError,
} from "./submission-coordinator.js";
import type { RepricedPaidExecutionSuccessorBuilder } from './postgres-repriced-paid-execution-successor-builder.js';
import {
  STALLED_WORK_FAILURE_CODE,
  stalledWorkRefundOperationId,
  type StalledWorkSweep,
  type StalledWorkSweepStore,
  type StalledWorkTerminalReason,
  type StalledWorkWindow,
} from './stalled-work-sweeper.js';

type HarnessStartState = "failed" | "reserved" | "starting" | "started";

interface StoredSubmissionRow {
  harness_start_attempts: number;
  harness_lease_expires_at: Date | string | null;
  harness_lease_id: string | null;
  harness_started_lease_id: string | null;
  harness_state: HarnessStartState;
  payload_hash: string;
  submission: unknown;
}

type ConfirmationRefundAudit = {
  status:
    | "refunded"
    | "already_refunded"
    | "settled_with_credit_mismatch"
    | "dead_letter";
  requestedCredits: number;
  usageCredits: number;
  refundedCredits: number;
  reasonCode?:
    | "CREDIT_USAGE_OPERATION_MISSING"
    | "CREDIT_USAGE_PARTIALLY_REFUNDED"
    | "CREDIT_USAGE_REFUND_MISMATCH";
  recordedAt: string;
};

type ConfirmationCreditRefundPlan =
  | {
      kind: "refund";
      audit: ConfirmationRefundAudit;
      credits: number;
    }
  | {
      kind: "settled" | "dead_letter";
      audit: ConfirmationRefundAudit;
    };

/**
 * A submission only reaches this port after its immutable Snapshot is built.
 * It deliberately delegates the product usage mutation to the existing billing
 * lifecycle instead of creating a second usage ledger in the execution spine.
 */
export interface CreationSubmissionPersistencePort {
  reserve(
    client: PoolClient,
    submission: CreationSubmissionRecord,
  ): Promise<void>;
	reprice?(client: PoolClient, input: {
		submission: CreationSubmissionRecord;
		expectedFreeze: CreationSubmissionRecord["executionPlanFreeze"] | null;
		previousQuoteRef: { id: string; revision: string };
		freeze: NonNullable<CreationSubmissionRecord["executionPlanFreeze"]>;
		successorQuote: BuildProductQuoteInput;
		credits: number;
	}): Promise<void>;
}

export interface CreationUsageReservationPort {
  reserve(
    client: PoolClient,
    submission: CreationSubmissionRecord,
  ): Promise<void>;
	reprice?(client: PoolClient, input: {
		submission: CreationSubmissionRecord;
		expectedFreeze: CreationSubmissionRecord["executionPlanFreeze"] | null;
		previousQuoteRef: { id: string; revision: string };
		freeze: NonNullable<CreationSubmissionRecord["executionPlanFreeze"]>;
		successorQuote: BuildProductQuoteInput;
		credits: number;
	}): Promise<void>;
}

/**
 * Uses the canonical durable ProductQuote/ProductUsage service in the same
 * PostgreSQL transaction as the Snapshot, Work, Task and ContentPackage shell.
 */
export class PostgresProductBillingUsageReservation implements CreationUsageReservationPort {
  constructor(
    private readonly pool: Pool,
    private readonly grantLots?: Pick<PostgresGrantLotLedger, 'consumeWithClient'>,
    private readonly credits?: Pick<
      PostgresCreditLedger,
      'consumeWithClient' | 'refundUsageOperationWithClient'
    >,
  ) {}

  async reserve(client: PoolClient, submission: CreationSubmissionRecord) {
    freezeCreditUsageOperationAtAdmission(submission);
    const snapshot = submission.snapshot;
    const credits = storedUsageCredits(submission.usageReservation.credits);
    const creditLedger = this.credits;
    if (credits !== undefined) {
      if (!creditLedger) {
        throw new P1DomainError(
          "INVALID_STATE",
          "Merchant credit ledger is unavailable for a credit-priced submission.",
        );
      }
      await lockWorkspaceCreditsWithClient(client, snapshot.workspaceId);
    }
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [snapshot.workspaceId, `quote:${snapshot.quote.id}`],
    );
    const repository = new PostgresProductBillingRepository(this.pool, client);
    const billing = new DurableProductBillingService(
      repository,
      () => new Date(snapshot.createdAt),
    );
    const quote = await billing.getQuote(
      snapshot.quote.id,
      snapshot.workspaceId,
    );
    if (!quote) {
      throw new P1DomainError(
        "NOT_FOUND",
        `Product quote ${snapshot.quote.id} was not found.`,
      );
    }
    if (quote.revision !== snapshot.quote.revision) {
      throw new P1DomainError(
        "INVALID_STATE",
        `Product quote ${quote.quoteId} revision no longer matches the submission.`,
      );
    }
    if (
      quote.lifecycleStatus !== "confirmed" &&
      quote.lifecycleStatus !== "reserved"
    ) {
      throw new P1DomainError(
        "INVALID_STATE",
        `Product quote ${quote.quoteId} requires explicit confirmation before reservation.`,
      );
    }
    if (quote.taskId !== submission.task.id) {
      throw new P1DomainError(
        "IDEMPOTENCY_CONFLICT",
        `Product quote ${quote.quoteId} is not bound to this submission task.`,
      );
    }
    const units = storedUsageUnits(submission.usageReservation.units, {
      allowEmpty: credits !== undefined,
    });
    if ((quote.creditCost !== undefined) !== (credits !== undefined)) {
      throw new P1DomainError(
        "INVALID_STATE",
        "Submission credit reservation must match its frozen quote.",
      );
    }
    if (credits !== undefined && quote.creditCost !== credits) {
      throw new P1DomainError(
        "INVALID_STATE",
        "Submission credit reservation no longer matches the frozen quote.",
      );
    }
    const reserved = await billing.reserve({
      quoteId: quote.quoteId,
      units,
      usageId: submission.usageReservation.id,
      workspaceId: snapshot.workspaceId,
    });
    if (reserved.usage.id !== submission.usageReservation.id) {
      throw new P1DomainError(
        "IDEMPOTENCY_CONFLICT",
        `Product usage for task ${submission.task.id} has a different reservation identity.`,
      );
    }
    await billing.bindMerchantSubmissionInput({
      inputSnapshot: creationSubmissionMerchantInput(submission),
      quoteRevision: quote.revision,
      taskId: submission.task.id,
      workspaceId: snapshot.workspaceId,
    });
    if (credits !== undefined && creditLedger) {
		const usageOperationId = requiredCreditUsageOperationId(
			submission,
			'reserve',
		);
		if (submission.usageReservation.confirmationOwnsCreditReservation) {
			return;
		}
      await creditLedger.consumeWithClient(client, {
        workspaceId: snapshot.workspaceId,
        credits,
        transactionId: usageOperationId,
        actorId: snapshot.actorId,
        correlationId: `coordinator:${submission.task.id}`,
        createdAt: snapshot.createdAt,
      });
      return;
    }
    if (!this.grantLots) {
      throw new P1DomainError(
        "INVALID_STATE",
        "Legacy grant-lot ledger is unavailable for a historical submission.",
      );
    }
    const reservedUnits = reservedProductUsageUnits(reserved.usage);
    for (const unit of reservedUnits) {
      await this.grantLots.consumeWithClient(client, {
        workspaceId: snapshot.workspaceId,
        resource: unit.resource,
        amount: unit.quantity,
        transactionId: grantLotUsageOperationId(
          submission.task.id,
          unit.resource,
          reservedUnits.length,
        ),
        actorId: snapshot.actorId,
        correlationId: `coordinator:${submission.task.id}`,
        createdAt: snapshot.createdAt,
      });
    }
  }

	async reprice(client: PoolClient, input: {
		submission: CreationSubmissionRecord;
		expectedFreeze: CreationSubmissionRecord["executionPlanFreeze"] | null;
		previousQuoteRef: { id: string; revision: string };
		freeze: NonNullable<CreationSubmissionRecord["executionPlanFreeze"]>;
		successorQuote: BuildProductQuoteInput;
		credits: number;
	}) {
		const { submission } = input;
		const snapshot = submission.snapshot;
		if (!this.credits) {
			throw new P1DomainError(
				"INVALID_STATE",
				"Plan reprice requires the durable merchant credit ledger.",
			);
		}
		await lockWorkspaceCreditsWithClient(client, snapshot.workspaceId);
		const billing = new DurableProductBillingService(
			new PostgresProductBillingRepository(this.pool, client),
			() => new Date(snapshot.createdAt),
		);
		const replaced = await billing.replaceReservedQuote({
			workspaceId: snapshot.workspaceId,
			previousQuoteId: input.previousQuoteRef.id,
			previousQuoteRevision: input.previousQuoteRef.revision,
			successor: input.successorQuote,
			taskId: submission.task.id,
			usageId: submission.usageReservation.id,
		});
		if (
			replaced.quote.quoteId !== input.freeze.quoteRef.id ||
			replaced.quote.revision !== String(input.freeze.quoteRef.revision) ||
			replaced.usage.reservedCredits !== input.credits
		) {
			throw new P1DomainError(
				"INVALID_STATE",
				"Repriced quote and execution freeze do not bind the same ledger amount.",
			);
		}
		const previousUsageOperationId = requiredCreditUsageOperationId(
			submission,
			'reprice',
		);
		// New key per plan revision. The admission/confirm hold stays on
		// `creditUsageOperationId(taskId)`. preparePendingConfirmation must
		// replay this successor key, not consume:task:<taskId>.
		const successorUsageOperationId = `consume:plan-reprice:${submission.task.id}:r${input.freeze.planRevision}:${input.freeze.quoteRef.id}@${input.freeze.quoteRef.revision}`;
		await this.credits.refundUsageOperationWithClient(client, {
			workspaceId: snapshot.workspaceId,
			usageOperationId: previousUsageOperationId,
			refundOperationId: `plan-reprice-refund:${submission.task.id}:r${input.freeze.planRevision}`,
			actorId: snapshot.actorId,
			correlationId: `plan-reprice:${submission.task.id}`,
			createdAt: snapshot.createdAt,
		});
		await this.credits.consumeWithClient(client, {
			workspaceId: snapshot.workspaceId,
			credits: input.credits,
			transactionId: successorUsageOperationId,
			actorId: snapshot.actorId,
			correlationId: `plan-reprice:${submission.task.id}`,
			createdAt: snapshot.createdAt,
		});
		await billing.bindMerchantSubmissionInput({
			inputSnapshot: creationSubmissionMerchantInput(submission),
			quoteRevision: replaced.quote.revision,
			taskId: submission.task.id,
			workspaceId: snapshot.workspaceId,
		});
		submission.usageReservation.creditUsageOperationId = successorUsageOperationId;
	}
}

/**
 * Writes the three product shells inside the Coordinator transaction. The
 * Harness owns subsequent revision writes through its existing OCC port.
 */
export class PostgresCreationSubmissionPersistence implements CreationSubmissionPersistencePort {
  constructor(private readonly usage: CreationUsageReservationPort) {}

  async reserve(client: PoolClient, submission: CreationSubmissionRecord) {
    const snapshot = submission.snapshot;
    const timestamp = snapshot.createdAt;
    await insertOnce(
      client,
      `INSERT INTO p1_creative_works (workspace_id, id, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        snapshot.workspaceId,
        submission.work.id,
        JSON.stringify({
          contentModules: snapshot.contentModules,
          createdAt: timestamp,
          creationMode: snapshot.creationMode,
          id: submission.work.id,
          intent: snapshot.intent.text,
          mode: "agent",
          operation: snapshot.operation,
          sessionId: `composer:${snapshot.surface.id}:${snapshot.surface.revision}`,
          sourceReferences: [
            ...snapshot.sources.assets.map((asset) => ({
              id: asset.id,
              kind: "asset",
            })),
            ...(snapshot.sources.contentPackage
              ? [
                  {
                    id: snapshot.sources.contentPackage.id,
                    kind: "content",
                  },
                ]
              : []),
          ],
          status: "running",
          updatedAt: timestamp,
          workspaceId: snapshot.workspaceId,
        }),
        timestamp,
      ],
      `Work ${submission.work.id} already exists.`,
    );
    await insertOnce(
      client,
      `INSERT INTO p1_content_tasks (workspace_id, id, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        snapshot.workspaceId,
        submission.task.id,
        JSON.stringify({
          createdAt: timestamp,
          dueAt: timestamp,
          executable: true,
          id: submission.task.id,
          relatedObject: { id: submission.work.id, kind: "work" },
          risk: "normal",
          source: "manual",
          status: "in_progress",
          title: snapshot.intent.text.slice(0, 200),
          updatedAt: timestamp,
          workspaceId: snapshot.workspaceId,
        }),
        timestamp,
      ],
      `Task ${submission.task.id} already exists.`,
    );
    const contentPackage = buildContentPackage({
      id: submission.contentPackage.id,
      kind: contentPackageKind(snapshot.lens),
      source: {
        assetIds: snapshot.sources.assets.map((asset) => asset.id),
        creationExecutionSnapshot: {
          id: snapshot.id,
          revision: snapshot.revision,
          schemaVersion: snapshot.schemaVersion,
          ...(snapshot.modelSelection
            ? { modelSelection: snapshot.modelSelection }
            : {}),
        },
        ...(snapshot.sources.contentPackage
          ? { sourceContentPackage: snapshot.sources.contentPackage }
          : {}),
        ...(isComposerVariantPlatform(snapshot.contentPackagePlatform)
          ? { targetPlatform: snapshot.contentPackagePlatform }
          : {}),
        workId: submission.work.id,
        workflowId: submission.task.id,
        workflowRevision: snapshot.revision,
      },
      timestamp,
      workspaceId: snapshot.workspaceId,
    });
    const contentPackageWithLineage = {
      ...contentPackage,
      lineage: snapshot.sources.contentPackage
        ? { reusedFromPackageId: snapshot.sources.contentPackage.id }
        : {},
    };
    const inserted = await insertContentPackageRow(client, {
      id: submission.contentPackage.id,
      payload: contentPackageWithLineage,
      revision: 0,
      updatedAt: timestamp,
      workspaceId: snapshot.workspaceId,
    });
    if (!inserted) {
      throw new Error(
        `ContentPackage ${submission.contentPackage.id} already exists.`,
      );
    }
    await this.usage.reserve(client, submission);
  }

	reprice(
		client: PoolClient,
		input: Parameters<NonNullable<CreationUsageReservationPort["reprice"]>>[1],
	) {
		if (!this.usage.reprice) {
			throw new Error("Product billing reprice persistence is unavailable.");
		}
		return this.usage.reprice(client, input);
	}
}

/**
 * Durable idempotency root and reclaimable Harness admission lease. The lease
 * only protects dispatch; Harness admission itself remains idempotent by Task
 * ID, so a process crash between DBOS start and completion can safely recover.
 */
export class PostgresCreationSubmissionStore implements CreationSubmissionStore {
  private readonly harnessStartLeaseMs: number;

  constructor(
    private readonly pool: Pool,
    private readonly persistence: CreationSubmissionPersistencePort,
    options: {
      harnessStartLeaseMs?: number;
      creditLedger?: Pick<
        PostgresCreditLedger,
        | 'projectWithClient'
        | 'consumeWithClient'
        | 'refundUsageOperationWithClient'
      >;
		repricedSuccessorBuilder?: RepricedPaidExecutionSuccessorBuilder;
    } = {},
  ) {
    this.harnessStartLeaseMs = options.harnessStartLeaseMs ?? 60_000;
    this.creditLedger = options.creditLedger;
		this.repricedSuccessorBuilder = options.repricedSuccessorBuilder;
  }

  private readonly creditLedger?: Pick<
    PostgresCreditLedger,
    | 'projectWithClient'
    | 'consumeWithClient'
    | 'refundUsageOperationWithClient'
  >;
	private readonly repricedSuccessorBuilder?: RepricedPaidExecutionSuccessorBuilder;

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE SCHEMA IF NOT EXISTS execution_spine;

      CREATE TABLE IF NOT EXISTS execution_spine.creation_submissions (
        id text PRIMARY KEY,
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        submission jsonb NOT NULL,
        harness_state text NOT NULL
          CHECK (harness_state IN ('failed', 'reserved', 'starting', 'started')),
        harness_lease_id text,
        harness_lease_expires_at timestamptz,
        harness_started_lease_id text,
        predecessor_confirmation_request_id text,
        superseded_by_submission_id text,
        superseded_at timestamptz,
        harness_start_attempts integer NOT NULL DEFAULT 0,
        prepare_terminal_refund_state text NOT NULL DEFAULT 'not_required'
          CONSTRAINT creation_submissions_prepare_terminal_refund_state_check
          CHECK (prepare_terminal_refund_state IN (
            'not_required', 'pending', 'processing', 'completed', 'dead_letter'
          )),
        prepare_terminal_refund_attempts integer NOT NULL DEFAULT 0,
        prepare_terminal_refund_lease_id text,
        prepare_terminal_refund_lease_expires_at timestamptz,
        prepare_terminal_refund_next_attempt_at timestamptz,
        prepare_terminal_refund_last_error text,
        prepare_terminal_refund_dead_lettered_at timestamptz,
        task_id text,
        work_id text,
        content_package_id text,
        usage_reservation_id text,
        quote_id text,
        route_snapshot_id text,
        snapshot_revision integer,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workspace_id, idempotency_key)
      );
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS harness_lease_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS harness_lease_expires_at timestamptz;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS harness_started_lease_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS predecessor_confirmation_request_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS superseded_by_submission_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS harness_start_attempts integer NOT NULL DEFAULT 0;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS prepare_terminal_refund_state text NOT NULL DEFAULT 'not_required';
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS prepare_terminal_refund_attempts integer NOT NULL DEFAULT 0;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS prepare_terminal_refund_lease_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS prepare_terminal_refund_lease_expires_at timestamptz;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS prepare_terminal_refund_next_attempt_at timestamptz;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS prepare_terminal_refund_last_error text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS prepare_terminal_refund_dead_lettered_at timestamptz;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS task_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS work_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS content_package_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS usage_reservation_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS quote_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS route_snapshot_id text;
      ALTER TABLE execution_spine.creation_submissions
        ADD COLUMN IF NOT EXISTS snapshot_revision integer;
      DO $migration$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid='execution_spine.creation_submissions'::regclass
            AND conname='creation_submissions_harness_state_check'
            AND pg_get_constraintdef(oid) NOT LIKE '%failed%'
        ) THEN
          ALTER TABLE execution_spine.creation_submissions
            DROP CONSTRAINT creation_submissions_harness_state_check;
          ALTER TABLE execution_spine.creation_submissions
            ADD CONSTRAINT creation_submissions_harness_state_check
            CHECK (
              harness_state IN ('failed', 'reserved', 'starting', 'started')
            );
        END IF;
      END
      $migration$;
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid='execution_spine.creation_submissions'::regclass
            AND conname='creation_submissions_prepare_terminal_refund_state_check'
        ) THEN
          ALTER TABLE execution_spine.creation_submissions
            ADD CONSTRAINT creation_submissions_prepare_terminal_refund_state_check
            CHECK (prepare_terminal_refund_state IN (
              'not_required', 'pending', 'processing', 'completed', 'dead_letter'
            ));
        END IF;
      END
      $migration$;
      UPDATE execution_spine.creation_submissions
         SET prepare_terminal_refund_state = 'pending',
             prepare_terminal_refund_next_attempt_at = COALESCE(
               prepare_terminal_refund_next_attempt_at,
               updated_at
             )
       WHERE harness_state = 'failed'
         AND submission ? 'prepareTerminalReason'
         AND prepare_terminal_refund_state = 'not_required';
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_created_idx
        ON execution_spine.creation_submissions (workspace_id, created_at, id);
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_task_idx
        ON execution_spine.creation_submissions (workspace_id, task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS creation_submissions_expired_successor_uidx
        ON execution_spine.creation_submissions (
          workspace_id, predecessor_confirmation_request_id
        )
        WHERE predecessor_confirmation_request_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_package_idx
        ON execution_spine.creation_submissions (workspace_id, content_package_id);
      CREATE INDEX IF NOT EXISTS creation_submissions_harness_recovery_idx
        ON execution_spine.creation_submissions (updated_at, id)
        WHERE harness_state IN ('reserved', 'starting');
      CREATE INDEX IF NOT EXISTS creation_submissions_prepare_terminal_refund_recovery_idx
        ON execution_spine.creation_submissions (
          prepare_terminal_refund_next_attempt_at,
          updated_at,
          id
        )
        WHERE prepare_terminal_refund_state IN ('pending', 'processing');
      CREATE TABLE IF NOT EXISTS execution_spine.composer_plan_outbox (
        event_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        submission_id text NOT NULL,
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS composer_plan_outbox_workspace_created_idx
        ON execution_spine.composer_plan_outbox (workspace_id, created_at, event_id);
    `);
  }

  async applySchema() {
    await this.migrate();
  }

  async readReceipt(input: {
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
  }) {
    const existing = await this.pool.query<StoredSubmissionRow>(
      `SELECT payload_hash, submission, harness_state, harness_lease_id,
              harness_lease_expires_at, harness_started_lease_id
         FROM execution_spine.creation_submissions
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [input.workspaceId, input.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) return { kind: "missing" as const };
    return row.payload_hash === input.payloadHash
      ? {
          kind: "existing" as const,
          submission: storedSubmission(row.submission),
          harnessState: row.harness_state satisfies HarnessSubmissionState,
        }
      : { kind: "conflict" as const };
  }

  async readByTask(input: { workspaceId: string; taskId: string }) {
    const result = await this.pool.query<{ submission: unknown }>(
      `SELECT submission
         FROM execution_spine.creation_submissions
        WHERE workspace_id = $1 AND task_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [input.workspaceId, input.taskId],
    );
    const row = result.rows[0];
    return row ? storedSubmission(row.submission) : null;
  }

  async claim(input: CreationSubmissionStoreClaim) {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.workspaceId, input.idempotencyKey],
      );
      const existing = await client.query<StoredSubmissionRow>(
        `SELECT payload_hash, submission, harness_state, harness_lease_id,
                harness_lease_expires_at, harness_started_lease_id
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [input.workspaceId, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row) {
        await client.query("COMMIT");
        inTransaction = false;
        return row.payload_hash === input.payloadHash
          ? {
              kind: "existing" as const,
              submission: storedSubmission(row.submission),
            }
          : { kind: "conflict" as const };
      }

      freezeCreditUsageOperationAtAdmission(input.submission);
      await this.persistence.reserve(client, input.submission);
      await client.query(
        `INSERT INTO execution_spine.creation_submissions
           (id, workspace_id, idempotency_key, payload_hash, submission,
            harness_state, task_id, work_id, content_package_id,
            usage_reservation_id, quote_id, route_snapshot_id,
            snapshot_revision, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'reserved', $6, $7, $8, $9,
                 $10, $11, $12, $13::timestamptz, $13::timestamptz)`,
        [
          input.submission.snapshot.id,
          input.workspaceId,
          input.idempotencyKey,
          input.payloadHash,
          JSON.stringify(input.submission),
          input.submission.task.id,
          input.submission.work.id,
          input.submission.contentPackage.id,
          input.submission.usageReservation.id,
          input.submission.snapshot.quote.id,
          input.submission.snapshot.route.id,
          input.submission.snapshot.revision,
          input.submission.snapshot.createdAt,
        ],
      );
      await client.query("COMMIT");
      inTransaction = false;
      return {
        kind: "created" as const,
        submission: cloneSubmission(input.submission),
      };
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The only expired-hold successor writer. Its transaction contains the new
   * product shells, exact quote/freeze, pending authority, confirmation hold,
   * frozen BillingIdentity and task request, then terminalizes the predecessor.
   */
  async createExpiredConfirmationSuccessor(input: {
    workspaceId: string;
    sourceSubmissionId: string;
    predecessorRequestId: string;
    successor: {
      submissionId: string;
      contentPackageId: string;
      workId: string;
      taskId: string;
      createdAt: string;
    };
    prepare(input: ExpiredConfirmationSuccessorPreparation): Promise<void>;
  }) {
    if (!this.creditLedger) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Expired confirmation successor requires the PostgreSQL credit ledger.',
      );
    }
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query('BEGIN');
      inTransaction = true;
      await lockWorkspaceCreditsWithClient(client, input.workspaceId);
      const predecessor = await client.query<{ status: string }>(
        `SELECT status
           FROM p1_execution_confirmation_requests
          WHERE workspace_id = $1 AND request_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.predecessorRequestId],
      );
      if (predecessor.rows[0]?.status !== 'expired') {
        throw new P1DomainError(
          'INVALID_STATE',
          'Only an expired confirmation may create a same-plan successor.',
        );
      }
      const alreadyCreated = await client.query<{ submission: unknown }>(
        `SELECT submission
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1
            AND predecessor_confirmation_request_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.predecessorRequestId],
      );
      if (alreadyCreated.rows[0]) {
        const replay = storedSubmission(alreadyCreated.rows[0].submission);
        if (
          replay.confirmationDispatch?.requestId !==
          expiredConfirmationSuccessorRequestId(input.predecessorRequestId)
        ) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Expired confirmation successor does not carry the exact durable request id.',
          );
        }
        await client.query('COMMIT');
        inTransaction = false;
        return { kind: 'existing' as const, submission: replay };
      }
      const sourceRow = await client.query<{
        submission: unknown;
        harness_state: HarnessStartState;
      }>(
        `SELECT submission, harness_state
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2
          FOR UPDATE`,
        [input.workspaceId, input.sourceSubmissionId],
      );
      const sourceStored = sourceRow.rows[0];
      if (!sourceStored) {
        throw new P1DomainError('NOT_FOUND', 'Expired confirmation source submission was not found.');
      }
      const source = storedSubmission(sourceStored.submission);
      if (
        source.confirmationDispatch?.requestId !== input.predecessorRequestId ||
        !source.executionPlanFreeze ||
        source.executionPlanFreeze.approvalBasis !== 'merchant_confirmed' ||
        (source.executionPlanFreezes?.length ?? 1) > 1
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Expired confirmation successor supports one durable primary carrier only.',
        );
      }
      const sourceTaskRequest = await client.query<{ request: unknown }>(
        `SELECT request
           FROM harness_runtime.task_requests
          WHERE request->>'workspaceId' = $1
            AND confirmation_request_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.predecessorRequestId],
      );
      const persistedRequest = sourceTaskRequest.rows[0]?.request as
        | import('../harness/task-admission.js').HarnessWorkflowInput
        | undefined;
      if (
        !persistedRequest ||
        persistedRequest.executionConfirmationRequestId !== input.predecessorRequestId ||
        persistedRequest.executionSnapshot?.task.id !== source.task.id ||
        !persistedRequest.pendingExecutionPlanSnapshot
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Expired confirmation successor requires the locked durable task request.',
        );
      }
      const sourceQuoteService = new DurableProductBillingService(
        new PostgresProductBillingRepository(this.pool, client),
        () => new Date(input.successor.createdAt),
      );
      const sourceQuote = await sourceQuoteService.getQuote(
        source.snapshot.quote.id,
        input.workspaceId,
      );
      if (
        !sourceQuote ||
        sourceQuote.taskId !== source.task.id ||
        sourceQuote.packageContract ||
        source.executionPlanFreeze.packageBilling
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Expired confirmation successor requires one exact single-carrier product quote.',
        );
      }
      const quoteId = `quote-${input.successor.taskId}`;
      const successorQuote = await sourceQuoteService.buildQuote(
        cloneExpiredSuccessorQuote({
          source,
          sourceQuote,
          quoteId,
          taskId: input.successor.taskId,
          createdAt: input.successor.createdAt,
        }),
      );
      const confirmedQuote = await sourceQuoteService.confirm({
        quoteId: successorQuote.quoteId,
        taskId: input.successor.taskId,
        workspaceId: input.workspaceId,
      });
      if (!Number.isSafeInteger(confirmedQuote.creditCost) || !confirmedQuote.creditCost) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Expired confirmation successor requires a positive frozen credit quote.',
        );
      }
      const snapshot = creationExecutionSnapshotSchema.parse({
        ...structuredClone(source.snapshot),
        id: input.successor.submissionId,
        createdAt: input.successor.createdAt,
        contentPackage: {
          ...source.snapshot.contentPackage,
          id: input.successor.contentPackageId,
          expectedRevision: 0,
        },
        work: { ...source.snapshot.work, id: input.successor.workId },
        task: { ...source.snapshot.task, id: input.successor.taskId },
        quote: { id: confirmedQuote.quoteId, revision: confirmedQuote.revision },
      });
      const freeze = {
        ...structuredClone(source.executionPlanFreeze),
        quoteRef: { id: confirmedQuote.quoteId, revision: confirmedQuote.revision },
      };
      const workflowId = composerPreparedAttemptId({
        ...source,
        snapshot,
        task: { id: input.successor.taskId },
        executionPlanFreeze: freeze,
      });
      const requestId = expiredConfirmationSuccessorRequestId(
        input.predecessorRequestId,
      );
      const reservationIdempotencyKey = confirmationSuccessorReservationIdempotencyKey(
        input.successor.taskId,
        requestId,
      );
      const holdExpiresAt = new Date(
        Date.parse(input.successor.createdAt) + 48 * 60 * 60 * 1_000,
      ).toISOString();
      const successor: CreationSubmissionRecord = {
        ...structuredClone(source),
        snapshot,
        contentPackage: { id: input.successor.contentPackageId, expectedRevision: 0 },
        work: { id: input.successor.workId },
        task: { id: input.successor.taskId },
        usageReservation: {
          id: `usage-reservation-${input.successor.taskId}`,
          credits: confirmedQuote.creditCost,
          units: [],
          creditUsageOperationId: reservationIdempotencyKey,
          confirmationOwnsCreditReservation: true,
        },
        executionPlanFreeze: freeze,
        executionPlanFreezes: undefined,
        packageConfirmationDecisionRef: undefined,
        confirmationDispatch: {
          requestId,
          predecessorRequestId: input.predecessorRequestId,
          state: 'pending',
          expiresAt: holdExpiresAt,
        },
      };
      await this.persistence.reserve(client, successor);
      const transaction = confirmationCreditTransactionFromPostgresClient(
        this.creditLedger,
        client,
      );
      await input.prepare({
        transaction,
        workflowId,
        predecessorRequestId: input.predecessorRequestId,
        requestId,
        reservationIdempotencyKey,
        holdExpiresAt,
        sourceRequest: structuredClone(persistedRequest),
        successor: {
          snapshot: successor.snapshot,
          usageReservation: successor.usageReservation,
          executionPlanFreeze: successor.executionPlanFreeze,
        },
      });
      await client.query(
        `INSERT INTO execution_spine.creation_submissions
           (id, workspace_id, idempotency_key, payload_hash, submission,
            harness_state, predecessor_confirmation_request_id,
            task_id, work_id, content_package_id, usage_reservation_id,
            quote_id, route_snapshot_id, snapshot_revision, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'reserved', $6, $7, $8, $9, $10,
                 $11, $12, $13, $14::timestamptz, $14::timestamptz)`,
        [
          snapshot.id,
          input.workspaceId,
          `expired-confirmation-successor:${input.predecessorRequestId}`,
          fingerprintValue({
            predecessorRequestId: input.predecessorRequestId,
            requestId,
            snapshot,
          }),
          JSON.stringify(successor),
          input.predecessorRequestId,
          successor.task.id,
          successor.work.id,
          successor.contentPackage.id,
          successor.usageReservation.id,
          successor.snapshot.quote.id,
          successor.snapshot.route.id,
          successor.snapshot.revision,
          successor.snapshot.createdAt,
        ],
      );
      const superseded = await client.query(
        `UPDATE execution_spine.creation_submissions
            SET harness_state = 'failed',
                superseded_by_submission_id = $3,
                superseded_at = $4::timestamptz,
                updated_at = $4::timestamptz
          WHERE workspace_id = $1 AND id = $2
            AND superseded_by_submission_id IS NULL`,
        [
          input.workspaceId,
          input.sourceSubmissionId,
          snapshot.id,
          input.successor.createdAt,
        ],
      );
      if (superseded.rowCount !== 1) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Expired confirmation predecessor was already superseded.',
        );
      }
      const taskSuperseded = await client.query(
        `UPDATE harness_runtime.task_requests
            SET admission_state = 'superseded', successor_task_id = $3
          WHERE request->>'workspaceId' = $1
            AND confirmation_request_id = $2
            AND admission_state = 'awaiting_confirmation'`,
        [input.workspaceId, input.predecessorRequestId, workflowId],
      );
      if (taskSuperseded.rowCount !== 1) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Expired confirmation predecessor task request is not awaiting confirmation.',
        );
      }
      await client.query('COMMIT');
      inTransaction = false;
      return { kind: 'created' as const, submission: cloneSubmission(successor) };
    } catch (error) {
      if (inTransaction) await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

	/**
	 * Replaces one confirmed-but-stale paid attempt with a new immutable
	 * workflow. The injected builder reads current server authority on this
	 * client; browser input contributes only predecessor coordinates and the
	 * stale fence.
	 */
	async createRepricedPaidExecutionSuccessor(
		input: import("./submission-coordinator.js").RepricedPaidExecutionSuccessorRequest & {
			successor?: {
				submissionId: string;
				contentPackageId: string;
				workId: string;
				taskId: string;
				createdAt: string;
			};
			prepare?: (input: RepricedConfirmationSuccessorPreparation) => Promise<void>;
		},
	): Promise<
		| { kind: "created"; submission: CreationSubmissionRecord }
		| { kind: "existing"; submission: CreationSubmissionRecord }
	> {
		const builder = this.repricedSuccessorBuilder;
		const successorInput = input.successor;
		const prepare = input.prepare;
		if (!this.creditLedger || !builder || !successorInput || !prepare) {
			throw new RepricedPaidExecutionSuccessorUnavailableError();
		}
		const client = await this.pool.connect();
		let inTransaction = false;
		try {
			await client.query('BEGIN');
			inTransaction = true;
			await lockWorkspaceCreditsWithClient(client, input.workspaceId);
			const predecessor = await client.query<{ status: string }>(
				`SELECT status
				   FROM p1_execution_confirmation_requests
				  WHERE workspace_id = $1 AND request_id = $2
				  FOR UPDATE`,
				[input.workspaceId, input.predecessor.confirmationRequestId],
			);
			if (predecessor.rows[0]?.status !== 'decided') {
				throw new P1DomainError(
					'INVALID_STATE',
					'Only a decided confirmation may create a price-drift successor.',
				);
			}
			const decision = await client.query<{ decision: string }>(
				`SELECT decision
				   FROM p1_plan_confirmation_decisions
				  WHERE request_id = $1
				  FOR UPDATE`,
				[input.predecessor.confirmationRequestId],
			);
			if (decision.rows[0]?.decision !== 'confirmed') {
				throw new P1DomainError(
					'INVALID_STATE',
					'Rejected confirmation requires a merchant revision, not a price-drift successor.',
				);
			}
			const requestId = repricedConfirmationSuccessorRequestId(
				input.predecessor.confirmationRequestId,
			);
			const alreadyCreated = await client.query<{ submission: unknown }>(
				`SELECT submission
				   FROM execution_spine.creation_submissions
				  WHERE workspace_id = $1
					AND predecessor_confirmation_request_id = $2
				  FOR UPDATE`,
				[input.workspaceId, input.predecessor.confirmationRequestId],
			);
			if (alreadyCreated.rows[0]) {
				const replay = storedSubmission(alreadyCreated.rows[0].submission);
				if (replay.confirmationDispatch?.requestId !== requestId) {
					throw new P1DomainError(
						'IDEMPOTENCY_CONFLICT',
						'Price-drift successor does not carry the exact durable request id.',
					);
				}
				await client.query('COMMIT');
				inTransaction = false;
				return { kind: 'existing', submission: replay };
			}
			const sourceRow = await client.query<{
				submission: unknown;
				harness_state: HarnessStartState;
			}>(
				`SELECT submission, harness_state
				   FROM execution_spine.creation_submissions
				  WHERE workspace_id = $1 AND id = $2
				  FOR UPDATE`,
				[input.workspaceId, input.predecessor.submissionId],
			);
			const stored = sourceRow.rows[0];
			if (!stored) {
				throw new P1DomainError('NOT_FOUND', 'Price-drift source submission was not found.');
			}
			const source = storedSubmission(stored.submission);
			// V31-63: the gate detects post-confirm staleness *inside* the started
			// DBOS attempt — completeHarnessStart has already moved the predecessor
			// to 'started' ('starting' during a crash-replay window) before the
			// admission staleness check runs. The precondition therefore accepts any
			// primary attempt that has not produced billable execution output yet
			// (the same-transaction failAndRefund below settles it), and rejects only
			// a predecessor that already terminalized as 'failed'.
			if (
				stored.harness_state === 'failed' ||
				source.task.id !== input.predecessor.taskId ||
				source.confirmationDispatch?.requestId !== input.predecessor.confirmationRequestId ||
				!source.executionPlanFreeze ||
				source.executionPlanFreeze.approvalBasis !== 'merchant_confirmed' ||
				(source.executionPlanFreezes?.length ?? 1) > 1
			) {
				throw new P1DomainError(
					'INVALID_STATE',
					'Price-drift successor requires a primary predecessor attempt that has not produced billable execution output.',
				);
			}
			const sourceTaskRequest = await client.query<{ request: unknown }>(
				`SELECT request
				   FROM harness_runtime.task_requests
				  WHERE request->>'workspaceId' = $1
					AND confirmation_request_id = $2
				  FOR UPDATE`,
				[input.workspaceId, input.predecessor.confirmationRequestId],
			);
			const sourceRequest = sourceTaskRequest.rows[0]?.request as
				| import('../harness/task-admission.js').HarnessWorkflowInput
				| undefined;
			if (
				!sourceRequest ||
				sourceRequest.executionConfirmationRequestId !==
					input.predecessor.confirmationRequestId ||
				sourceRequest.executionSnapshot?.task.id !== source.task.id ||
				!sourceRequest.pendingExecutionPlanSnapshot
			) {
				throw new P1DomainError(
					'INVALID_STATE',
					'Price-drift successor requires the locked durable task request.',
				);
			}
			const rebuilt = await builder.rebuildInTransaction({
				client,
				workspaceId: input.workspaceId,
				source,
				sourceRequest: structuredClone(sourceRequest),
					successor: {
						taskId: successorInput.taskId,
						createdAt: successorInput.createdAt,
				},
				staleFence: input.staleFence,
			});
			if (
				rebuilt.quote.taskId !== successorInput.taskId ||
				rebuilt.freeze.quoteRef.id !== rebuilt.quote.quoteId ||
				String(rebuilt.freeze.quoteRef.revision) !== String(rebuilt.quote.revision) ||
				!Number.isSafeInteger(rebuilt.quote.creditCost) ||
				(rebuilt.quote.creditCost ?? 0) <= 0
			) {
				throw new P1DomainError(
					'INVALID_STATE',
					'Authoritative price-drift builder returned mismatched successor facts.',
				);
			}
			const snapshot = creationExecutionSnapshotSchema.parse({
				...structuredClone(source.snapshot),
				id: successorInput.submissionId,
				createdAt: successorInput.createdAt,
				contentPackage: {
					...source.snapshot.contentPackage,
					id: successorInput.contentPackageId,
					expectedRevision: 0,
				},
				work: { ...source.snapshot.work, id: successorInput.workId },
				task: { ...source.snapshot.task, id: successorInput.taskId },
				quote: { id: rebuilt.quote.quoteId, revision: rebuilt.quote.revision },
			});
			const workflowId = composerPreparedAttemptId({
				...source,
				snapshot,
				task: { id: successorInput.taskId },
				executionPlanFreeze: rebuilt.freeze,
			});
			const reservationIdempotencyKey = confirmationSuccessorReservationIdempotencyKey(
				successorInput.taskId,
				requestId,
			);
			const holdExpiresAt = new Date(
				Date.parse(successorInput.createdAt) + 48 * 60 * 60 * 1_000,
			).toISOString();
			const successor: CreationSubmissionRecord = {
				...structuredClone(source),
				snapshot,
				contentPackage: { id: successorInput.contentPackageId, expectedRevision: 0 },
				work: { id: successorInput.workId },
				task: { id: successorInput.taskId },
				usageReservation: {
					id: `usage-reservation-${successorInput.taskId}`,
					credits: rebuilt.quote.creditCost,
					units: [],
					creditUsageOperationId: reservationIdempotencyKey,
					confirmationOwnsCreditReservation: true,
				},
				executionPlanFreeze: rebuilt.freeze,
				executionPlanFreezes: undefined,
				packageConfirmationDecisionRef: undefined,
				confirmationDispatch: {
					requestId,
					predecessorRequestId: input.predecessor.confirmationRequestId,
					state: 'pending',
					expiresAt: holdExpiresAt,
				},
			};
			const sourceQuote = new DurableProductBillingService(
				new PostgresProductBillingRepository(this.pool, client),
				() => new Date(successorInput.createdAt),
			);
			await sourceQuote.failAndRefund({
				workspaceId: input.workspaceId,
				quoteId: source.snapshot.quote.id,
				reason: 'confirmed_price_drift_successor',
				forceCreditRefund: true,
			});
			const sourceCreditOperation = source.usageReservation.creditUsageOperationId;
			if (!sourceCreditOperation) {
				throw new P1DomainError(
					'INVALID_STATE',
					'Price-drift successor requires predecessor credit-reservation lineage.',
				);
			}
			await this.creditLedger.refundUsageOperationWithClient(client, {
				workspaceId: input.workspaceId,
				usageOperationId: sourceCreditOperation,
				refundOperationId: `confirmed-price-drift-refund:${input.predecessor.confirmationRequestId}`,
				actorId: source.snapshot.actorId,
				correlationId: `confirmed-price-drift:${input.predecessor.confirmationRequestId}`,
				createdAt: successorInput.createdAt,
			});
			await this.persistence.reserve(client, successor);
			const transaction = confirmationCreditTransactionFromPostgresClient(
				this.creditLedger,
				client,
			);
			await prepare({
				transaction,
				workflowId,
				predecessorRequestId: input.predecessor.confirmationRequestId,
				requestId,
				reservationIdempotencyKey,
				holdExpiresAt,
				sourceRequest: structuredClone(sourceRequest),
				successor: {
					snapshot: successor.snapshot,
					usageReservation: successor.usageReservation,
					executionPlanFreeze: successor.executionPlanFreeze,
				},
				currentFactRevisionRefs: rebuilt.factRevisionRefs,
			});
			await client.query(
				`INSERT INTO execution_spine.creation_submissions
				   (id, workspace_id, idempotency_key, payload_hash, submission,
					harness_state, predecessor_confirmation_request_id,
					task_id, work_id, content_package_id, usage_reservation_id,
					quote_id, route_snapshot_id, snapshot_revision, created_at, updated_at)
				 VALUES ($1, $2, $3, $4, $5::jsonb, 'reserved', $6, $7, $8, $9, $10,
					$11, $12, $13, $14::timestamptz, $14::timestamptz)`,
				[
					snapshot.id,
					input.workspaceId,
					`repriced-confirmation-successor:${input.predecessor.confirmationRequestId}`,
					fingerprintValue({
						predecessorRequestId: input.predecessor.confirmationRequestId,
						requestId,
						snapshot,
					}),
					JSON.stringify(successor),
					input.predecessor.confirmationRequestId,
					successor.task.id,
					successor.work.id,
					successor.contentPackage.id,
					successor.usageReservation.id,
					successor.snapshot.quote.id,
					successor.snapshot.route.id,
					successor.snapshot.revision,
					successor.snapshot.createdAt,
				],
			);
			const superseded = await client.query(
				`UPDATE execution_spine.creation_submissions
					SET harness_state = 'failed',
						superseded_by_submission_id = $3,
						superseded_at = $4::timestamptz,
						updated_at = $4::timestamptz
					  WHERE workspace_id = $1 AND id = $2
						AND superseded_by_submission_id IS NULL`,
				[input.workspaceId, input.predecessor.submissionId, snapshot.id, successorInput.createdAt],
			);
			if (superseded.rowCount !== 1) {
				throw new P1DomainError(
					'IDEMPOTENCY_CONFLICT',
					'Price-drift predecessor was already superseded.',
				);
			}
			const taskSuperseded = await client.query(
				`UPDATE harness_runtime.task_requests
					SET admission_state = 'superseded', successor_task_id = $3
					  WHERE request->>'workspaceId' = $1
						AND confirmation_request_id = $2
						AND admission_state = 'awaiting_confirmation'`,
				[input.workspaceId, input.predecessor.confirmationRequestId, workflowId],
			);
			if (taskSuperseded.rowCount !== 1) {
				throw new P1DomainError(
					'INVALID_STATE',
					'Price-drift predecessor task request is not awaiting confirmation.',
				);
			}
			await client.query('COMMIT');
			inTransaction = false;
			return { kind: 'created', submission: cloneSubmission(successor) };
		} catch (error) {
			if (inTransaction) await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

  async persistAgentPlanning(input: {
	workspaceId: string;
	submissionId: string;
	agentBinding: ComposerAgentBinding;
	executionPlanFreeze: NonNullable<CreationSubmissionRecord["executionPlanFreeze"]>;
	executionPlanFreezes?: CreationSubmissionRecord["executionPlanFreezes"];
	packageConfirmationDecisionRef?: string;
	quoteRef?: CreationSubmissionRecord['snapshot']['quote'];
	credits?: number;
	confirmationDispatch?: CreationSubmissionRecord['confirmationDispatch'];
	clarificationResolution?: {
	  interruptId: string;
	  revision: number;
	  threadId: string;
	  runId: string;
	};
  }) {
	// `makeReady` is transient turn state; only the identity is durable.
	const durableBinding = {
	  threadId: input.agentBinding.threadId,
	  runId: input.agentBinding.runId,
	};
	const client = await this.pool.connect();
	try {
	  await client.query('BEGIN');
	  const row = await this.lockSubmission(client, input);
	  const current = storedSubmission(row.submission);
	  // Canonical, not `JSON.stringify`: `current` came back through jsonb,
	  // which stores object keys in its own order, so a byte comparison
	  // against the in-memory literal reports a conflict for values that are
	  // equal. `{ threadId, runId }` round-trips as `{ runId, threadId }` —
	  // every idempotent replay of a bound submission raised a 500.
	  if (
		current.agentBinding &&
		canonicalJson(current.agentBinding) !== canonicalJson(durableBinding)
	  ) {
		throw new Error('Agent planning persistence conflict.');
	  }
	  const freezeReplayed =
		canonicalJson(current.executionPlanFreeze) ===
		canonicalJson(input.executionPlanFreeze);
	  if (current.executionPlanFreeze && !freezeReplayed) {
		// The only permitted change is the revise path: the same plan at a
		// strictly higher compiled revision (V31-12 append-only).
		const revised =
		  current.executionPlanFreeze.planId ===
			input.executionPlanFreeze.planId &&
		  current.executionPlanFreeze.planRevision <
			input.executionPlanFreeze.planRevision;
		if (!revised) {
		  throw new Error(
			`Creation submission ${input.submissionId} cannot change its execution plan freeze after Harness admission.`,
		  );
		}
	  }
	  const dispatchReplayed =
		input.confirmationDispatch === undefined ||
		canonicalJson(current.confirmationDispatch) ===
		  canonicalJson(input.confirmationDispatch);
	  if (
		current.agentBinding &&
		current.executionPlanFreeze &&
		freezeReplayed &&
		dispatchReplayed
	  ) {
	  if (input.clarificationResolution) {
		await client.query(
		  `INSERT INTO execution_spine.composer_plan_outbox
			(event_id, workspace_id, submission_id, event_type, payload)
		   VALUES ($1, $2, $3, 'interrupt.resolved', $4::jsonb)
		   ON CONFLICT (event_id) DO NOTHING`,
		  [
			`${input.clarificationResolution.interruptId}:resolved`,
			input.workspaceId,
			input.submissionId,
			JSON.stringify(input.clarificationResolution),
		  ],
		);
	  }
		await client.query('COMMIT');
		return current;
	  }
	  current.agentBinding = durableBinding;
	  current.agentPlanPending = false;
	  current.executionPlanFreeze = input.executionPlanFreeze;
	  if (input.executionPlanFreezes && input.executionPlanFreezes.length > 0) {
		current.executionPlanFreezes = structuredClone(input.executionPlanFreezes);
	  }
	  if (input.packageConfirmationDecisionRef) {
		current.packageConfirmationDecisionRef = input.packageConfirmationDecisionRef;
	  }
	  if (input.confirmationDispatch !== undefined) {
		current.confirmationDispatch = input.confirmationDispatch;
	  }
	  if (input.quoteRef) {
		current.snapshot.quote = input.quoteRef;
	  }
	  if (input.credits !== undefined) {
		current.usageReservation.credits = input.credits;
	  }
	  const update = await client.query(
		`UPDATE execution_spine.creation_submissions
			SET submission = $3::jsonb, updated_at = clock_timestamp()
		  WHERE workspace_id = $1 AND id = $2
			AND (
			  harness_state = 'reserved'
			  OR (
				harness_state = 'starting'
				AND harness_lease_expires_at <= clock_timestamp()
			  )
			)`,
		[input.workspaceId, input.submissionId, JSON.stringify(current)],
	  );
	  if (update.rowCount !== 1) {
		throw new Error(
		  `Creation submission ${input.submissionId} cannot change its execution plan freeze after Harness admission.`,
		);
	  }
	  if (input.clarificationResolution) {
		await client.query(
		  `INSERT INTO execution_spine.composer_plan_outbox
			(event_id, workspace_id, submission_id, event_type, payload)
		   VALUES ($1, $2, $3, 'interrupt.resolved', $4::jsonb)
		   ON CONFLICT (event_id) DO NOTHING`,
		  [
			`${input.clarificationResolution.interruptId}:resolved`,
			input.workspaceId,
			input.submissionId,
			JSON.stringify(input.clarificationResolution),
		  ],
		);
	  }
	  await client.query('COMMIT');
	  return current;
	} catch (error) {
	  await client.query('ROLLBACK');
	  throw error;
	} finally {
	  client.release();
	}
  }

	async saveRepricedExecutionPlanFreeze(input: {
		workspaceId: string;
		submissionId: string;
		expectedFreeze: CreationSubmissionRecord["executionPlanFreeze"] | null;
		previousQuoteRef: { id: string; revision: string };
		freeze: NonNullable<CreationSubmissionRecord["executionPlanFreeze"]>;
		executionPlanFreezes?: CreationSubmissionRecord["executionPlanFreezes"];
		successorQuote: BuildProductQuoteInput;
		credits: number;
    clarificationResolution?: {
      interruptId: string;
      revision: number;
      threadId: string;
      runId: string;
    };
	}) {
		if (!this.persistence.reprice) {
			throw new Error("Atomic product billing reprice persistence is unavailable.");
		}
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			const selected = await client.query<{
				harness_state: HarnessStartState;
				submission: unknown;
			}>(
				`SELECT harness_state, submission
				   FROM execution_spine.creation_submissions
				  WHERE workspace_id=$1 AND id=$2
				  FOR UPDATE`,
				[input.workspaceId, input.submissionId],
			);
			const row = selected.rows[0];
			if (!row) throw new Error(`Creation submission ${input.submissionId} was not found.`);
			const current = storedSubmission(row.submission);
			if (
				JSON.stringify(current.executionPlanFreeze) === JSON.stringify(input.freeze)
			) {
				await client.query("COMMIT");
				return current;
			}
			if (
				row.harness_state !== "reserved" ||
				JSON.stringify(current.executionPlanFreeze ?? null) !==
					JSON.stringify(input.expectedFreeze)
			) {
				throw new Error(
					`Creation submission ${input.submissionId} reprice lost its freeze CAS.`,
				);
			}
			const next: CreationSubmissionRecord = {
				...current,
        agentPlanPending: false,
				snapshot: {
					...current.snapshot,
					quote: {
						id: input.freeze.quoteRef.id,
						revision: String(input.freeze.quoteRef.revision),
					},
				},
				usageReservation: {
					...current.usageReservation,
					credits: input.credits,
				},
				executionPlanFreeze: structuredClone(input.freeze),
				...(input.executionPlanFreezes && input.executionPlanFreezes.length > 0
					? { executionPlanFreezes: structuredClone(input.executionPlanFreezes) }
					: {}),
			};
			await this.persistence.reprice(client, {
				submission: next,
				expectedFreeze: input.expectedFreeze,
				previousQuoteRef: input.previousQuoteRef,
				freeze: input.freeze,
				successorQuote: input.successorQuote,
				credits: input.credits,
			});
			await client.query(
				`UPDATE execution_spine.creation_submissions
				    SET submission=$3::jsonb,
				        quote_id=$4,
				        updated_at=clock_timestamp()
				  WHERE workspace_id=$1 AND id=$2 AND harness_state='reserved'`,
				[
					input.workspaceId,
					input.submissionId,
					JSON.stringify(next),
					input.freeze.quoteRef.id,
				],
			);
			if (input.clarificationResolution) {
				await client.query(
					`INSERT INTO execution_spine.composer_plan_outbox
					  (event_id, workspace_id, submission_id, event_type, payload)
					 VALUES ($1, $2, $3, 'interrupt.resolved', $4::jsonb)
					 ON CONFLICT (event_id) DO NOTHING`,
					[
						`${input.clarificationResolution.interruptId}:resolved`,
						input.workspaceId,
						input.submissionId,
						JSON.stringify(input.clarificationResolution),
					],
				);
			}
			await client.query(
				`INSERT INTO execution_spine.composer_plan_outbox
				  (event_id, workspace_id, submission_id, event_type, payload)
				 VALUES ($1, $2, $3, 'plan.repriced', $4::jsonb)
				 ON CONFLICT (event_id) DO NOTHING`,
				[
					`plan-repriced:${input.submissionId}:r${input.freeze.planRevision}`,
					input.workspaceId,
					input.submissionId,
					JSON.stringify({
						planId: input.freeze.planId,
						planRevision: input.freeze.planRevision,
						previousQuoteRef: input.previousQuoteRef,
						quoteRef: input.freeze.quoteRef,
						credits: input.credits,
					}),
				],
			);
			await client.query("COMMIT");
			return next;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

  /**
   * Persists the immutable successor snapshot for a semantic answer without
   * creating another Work, Task, ContentPackage, or usage reservation. The
   * existing DBOS workflow continues with this submission, so its dispatch
   * state is already started.
   */
  async claimSemanticDecisionResumption(input: {
    sourceSnapshotId: string;
    workspaceId: string;
    idempotencyKey: string;
    payloadHash: string;
    submission: CreationSubmissionRecord;
  }) {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [input.workspaceId, input.idempotencyKey],
      );
      const existing = await client.query<StoredSubmissionRow>(
        `SELECT payload_hash, submission, harness_state, harness_lease_id,
                harness_lease_expires_at, harness_started_lease_id
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [input.workspaceId, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.payload_hash !== input.payloadHash) {
          throw new Error(
            "Semantic decision idempotency key conflicts with another resumption.",
          );
        }
        await client.query("COMMIT");
        inTransaction = false;
        return "replayed" as const;
      }

      const source = await client.query<{
        task_id: string | null;
        work_id: string | null;
        content_package_id: string | null;
        usage_reservation_id: string | null;
      }>(
        `SELECT task_id, work_id, content_package_id, usage_reservation_id
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2
          FOR UPDATE`,
        [input.workspaceId, input.sourceSnapshotId],
      );
      const sourceRow = source.rows[0];
      if (
        !sourceRow ||
        input.submission.snapshot.semanticDecision?.sourceSnapshotId !==
          input.sourceSnapshotId ||
        sourceRow.task_id !== input.submission.task.id ||
        sourceRow.work_id !== input.submission.work.id ||
        sourceRow.content_package_id !== input.submission.contentPackage.id ||
        sourceRow.usage_reservation_id !== input.submission.usageReservation.id
      ) {
        throw new Error(
          "Semantic decision resumption must preserve the source task, work, content package, and usage reservation.",
        );
      }

      await client.query(
        `INSERT INTO execution_spine.creation_submissions
           (id, workspace_id, idempotency_key, payload_hash, submission,
            harness_state, task_id, work_id, content_package_id,
            usage_reservation_id, quote_id, route_snapshot_id,
            snapshot_revision, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'started', $6, $7, $8, $9,
                 $10, $11, $12, $13::timestamptz, $13::timestamptz)`,
        [
          input.submission.snapshot.id,
          input.workspaceId,
          input.idempotencyKey,
          input.payloadHash,
          JSON.stringify(input.submission),
          input.submission.task.id,
          input.submission.work.id,
          input.submission.contentPackage.id,
          input.submission.usageReservation.id,
          input.submission.snapshot.quote.id,
          input.submission.snapshot.route.id,
          input.submission.snapshot.revision,
          input.submission.snapshot.createdAt,
        ],
      );
      await client.query("COMMIT");
      inTransaction = false;
      return "created" as const;
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async claimHarnessStart(input: {
    workspaceId: string;
    submissionId: string;
  }) {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      if (this.creditLedger) {
        // Global settlement/successor order: credits -> submission row ->
        // quote/task. An expired stale DBOS start may refund below, so it must
        // not take the submission row before the successor takes credits.
        await lockWorkspaceCreditsWithClient(client, input.workspaceId);
      }
      const row = await this.lockSubmission(client, input);
      const now = await databaseNow(client);
      if (this.creditLedger) {
        const submission = storedSubmission(row.submission);
        if (confirmationDispatchExpired(submission, now)) {
          await this.expireLockedConfirmationHold(
            client,
            submission,
            input.submissionId,
            now.toISOString(),
          );
          await client.query("COMMIT");
          inTransaction = false;
          return { kind: "failed" as const };
        }
      }
      const leaseExpiresAt = row.harness_lease_expires_at
        ? new Date(row.harness_lease_expires_at)
        : null;
      if (
        row.harness_state === "started" ||
        (row.harness_state === "starting" &&
          leaseExpiresAt &&
          leaseExpiresAt.getTime() > now.getTime())
      ) {
        await client.query("COMMIT");
        inTransaction = false;
        return { kind: "started" as const };
      }
      if (row.harness_state === "failed") {
        await client.query("COMMIT");
        inTransaction = false;
        return { kind: "failed" as const };
      }
      const leaseId = randomUUID();
      const expiresAt = new Date(
        now.getTime() + this.harnessStartLeaseMs,
      ).toISOString();
      const updated = await client.query<{ harness_start_attempts: number }>(
        `UPDATE execution_spine.creation_submissions
            SET harness_state = 'starting',
                harness_lease_id = $3,
                harness_lease_expires_at = $4::timestamptz,
                harness_started_lease_id = NULL,
                harness_start_attempts = harness_start_attempts + 1,
                updated_at = $5::timestamptz
          WHERE workspace_id = $1 AND id = $2
        RETURNING harness_start_attempts`,
        [
          input.workspaceId,
          input.submissionId,
          leaseId,
          expiresAt,
          now.toISOString(),
        ],
      );
      await client.query("COMMIT");
      inTransaction = false;
      return {
        kind: "start" as const,
        attempts: updated.rows[0]!.harness_start_attempts,
        leaseId,
      };
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeHarnessStart(input: {
    leaseId: string;
    workspaceId: string;
    submissionId: string;
    confirmationDispatch?: CreationSubmissionRecord['confirmationDispatch'];
  }) {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      const row = await this.lockSubmission(client, input);
      if (row.harness_state === "started") {
        if (row.harness_started_lease_id !== input.leaseId) {
          throw new Error(
            `Harness start lease ${input.leaseId} is no longer current.`,
          );
        }
        await client.query("COMMIT");
        inTransaction = false;
        return;
      }
      if (
        row.harness_state !== "starting" ||
        row.harness_lease_id !== input.leaseId
      ) {
        throw new Error(
          `Harness start lease ${input.leaseId} is no longer current.`,
        );
      }
      await client.query(
        `UPDATE execution_spine.creation_submissions
            SET harness_state = 'started',
                harness_lease_id = NULL,
                harness_lease_expires_at = NULL,
                harness_started_lease_id = $3,
                submission = CASE
                  WHEN $4::jsonb IS NOT NULL
                    THEN jsonb_set(
                      submission,
                      '{confirmationDispatch}',
                      jsonb_set(
                        COALESCE($4::jsonb, '{}'::jsonb),
                        '{state}',
                        '"dispatched"'::jsonb,
                        true
                      ),
                      true
                    )
                  ELSE submission
                END,
                updated_at = $5::timestamptz
          WHERE workspace_id = $1 AND id = $2`,
        [
          input.workspaceId,
          input.submissionId,
          input.leaseId,
          input.confirmationDispatch
            ? JSON.stringify(input.confirmationDispatch)
            : null,
          (await databaseNow(client)).toISOString(),
        ],
      );
      await client.query("COMMIT");
      inTransaction = false;
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markHarnessStartDispatched(input: {
    leaseId: string;
    workspaceId: string;
    submissionId: string;
  }) {
    const client = await this.pool.connect();
    let inTransaction = false;
    try {
      await client.query("BEGIN");
      inTransaction = true;
      const row = await this.lockSubmission(client, input);
      if (
        row.harness_state !== "starting" ||
        row.harness_lease_id !== input.leaseId
      ) {
        throw new Error(
          `Harness start lease ${input.leaseId} is no longer current.`,
        );
      }
      const submission = storedSubmission(row.submission);
      if (!submission.confirmationDispatch) {
        await client.query("COMMIT");
        inTransaction = false;
        return submission;
      }
      if (
        submission.confirmationDispatch.state !== "pending" &&
        submission.confirmationDispatch.state !== "dispatched"
      ) {
        throw new Error(
          `Confirmation dispatch for ${input.submissionId} already expired.`,
        );
      }
      const updated = await client.query<{ submission: unknown }>(
        `UPDATE execution_spine.creation_submissions
            SET submission = jsonb_set(
                  submission,
                  '{confirmationDispatch,state}',
                  '"dispatched"'::jsonb,
                  true
                ),
                updated_at = $4::timestamptz
          WHERE workspace_id = $1
            AND id = $2
            AND harness_state = 'starting'
            AND harness_lease_id = $3
        RETURNING submission`,
        [
          input.workspaceId,
          input.submissionId,
          input.leaseId,
          (await databaseNow(client)).toISOString(),
        ],
      );
      const persisted = updated.rows[0];
      if (!persisted) {
        throw new Error(
          `Harness start lease ${input.leaseId} is no longer current.`,
        );
      }
      await client.query("COMMIT");
      inTransaction = false;
      return storedSubmission(persisted.submission);
    } catch (error) {
      if (inTransaction) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async releaseHarnessStart(input: {
    leaseId: string;
    workspaceId: string;
    submissionId: string;
  }) {
    await this.pool.query(
      `UPDATE execution_spine.creation_submissions
          SET harness_state = 'reserved',
              harness_lease_id = NULL,
              harness_lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE workspace_id = $1
          AND id = $2
          AND harness_state = 'starting'
          AND harness_lease_id = $3`,
      [
        input.workspaceId,
        input.submissionId,
        input.leaseId,
      ],
    );
  }

  async failHarnessStart(input: {
    leaseId: string;
    workspaceId: string;
    submissionId: string;
  }) {
    const result = await this.pool.query(
      `UPDATE execution_spine.creation_submissions
          SET harness_state = 'failed',
              harness_lease_id = NULL,
              harness_lease_expires_at = NULL,
              updated_at = clock_timestamp()
        WHERE workspace_id = $1
          AND id = $2
          AND harness_state = 'starting'
          AND harness_lease_id = $3`,
      [
        input.workspaceId,
        input.submissionId,
        input.leaseId,
      ],
    );
    return result.rowCount === 1;
  }

  /**
   * V31-33: global recoverable scan with per-workspace fairness.
   * One workspace cannot exhaust the entire LIMIT budget; each workspace is
   * capped so multi-tenant recovery stays round-robin fair under backlog.
   */
  async listRecoverableHarnessStarts(input: {
    limit: number;
    /** Max rows claimed per workspace in one sweep (default: fair share). */
    perWorkspaceLimit?: number;
  }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Recoverable Harness start limit must be an integer from 1 through 100.");
    }
    const perWorkspaceLimit =
      input.perWorkspaceLimit !== undefined
        ? input.perWorkspaceLimit
        : Math.max(1, Math.ceil(input.limit / 4));
    if (
      !Number.isInteger(perWorkspaceLimit) ||
      perWorkspaceLimit < 1 ||
      perWorkspaceLimit > input.limit
    ) {
      throw new Error(
        "Recoverable Harness per-workspace limit must be an integer from 1 through the sweep limit.",
      );
    }
    const result = await this.pool.query<{ submission: unknown }>(
      `WITH recoverable AS (
         SELECT id,
                workspace_id,
                submission,
                updated_at,
                ROW_NUMBER() OVER (
                  PARTITION BY workspace_id
                  ORDER BY updated_at ASC, id ASC
                ) AS workspace_rank
           FROM execution_spine.creation_submissions
          WHERE (
               harness_state = 'reserved'
               AND updated_at <= clock_timestamp() - make_interval(
                 secs => LEAST(
                   300::double precision,
                   power(
                     2,
                     LEAST(GREATEST(harness_start_attempts - 1, 0), 8)
                   )
                 )
               )
             )
             OR (
               harness_state = 'starting'
               AND (
                 harness_lease_expires_at IS NULL
                 OR harness_lease_expires_at <= clock_timestamp()
               )
             )
       )
       SELECT submission
         FROM recoverable
        WHERE workspace_rank <= $2
        ORDER BY updated_at ASC, id ASC
        LIMIT $1`,
      [input.limit, perWorkspaceLimit],
    );
    return result.rows.map((row) => ({ submission: storedSubmission(row.submission) }));
  }

  /**
   * V31-41: prepare-side failure counter + optional terminalization without a
   * start lease. Reuses harness_start_attempts so the same exponential backoff
   * in listRecoverableHarnessStarts becomes effective for prepare failures.
   */
  async recordPrepareFailure(input: {
    workspaceId: string;
    submissionId: string;
    terminal: boolean;
    reason?: string;
    /** When true, do not bump attempts (used for budget-exhaust terminalization). */
    skipAttemptIncrement?: boolean;
  }): Promise<{ attempts: number; terminalized: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{
        harness_start_attempts: number;
        harness_state: string;
      }>(
        `SELECT harness_start_attempts, harness_state
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2
          FOR UPDATE`,
        [input.workspaceId, input.submissionId],
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        throw new Error(
          `Creation submission ${input.submissionId} not found for prepare failure recording.`,
        );
      }
      if (row.harness_state === 'failed' || row.harness_state === 'started') {
        await client.query('COMMIT');
        return {
          attempts: row.harness_start_attempts,
          terminalized: row.harness_state === 'failed',
        };
      }
      const attempts = input.skipAttemptIncrement
        ? row.harness_start_attempts
        : row.harness_start_attempts + 1;
      if (input.terminal) {
        await client.query(
          `UPDATE execution_spine.creation_submissions
              SET harness_state = 'failed',
                  harness_start_attempts = $3,
                  harness_lease_id = NULL,
                  harness_lease_expires_at = NULL,
                  prepare_terminal_refund_state = CASE
                    WHEN prepare_terminal_refund_state = 'completed' THEN 'completed'
                    ELSE 'pending'
                  END,
                  prepare_terminal_refund_lease_id = NULL,
                  prepare_terminal_refund_lease_expires_at = NULL,
                  prepare_terminal_refund_next_attempt_at = CASE
                    WHEN prepare_terminal_refund_state = 'completed' THEN NULL
                    ELSE clock_timestamp()
                  END,
                  prepare_terminal_refund_last_error = NULL,
                  prepare_terminal_refund_dead_lettered_at = NULL,
                  submission = CASE
                    WHEN $4::text IS NULL THEN submission
                    ELSE jsonb_set(
                      submission,
                      '{prepareTerminalReason}',
                      to_jsonb($4::text),
                      true
                    )
                  END,
                  updated_at = clock_timestamp()
            WHERE workspace_id = $1 AND id = $2`,
          [
            input.workspaceId,
            input.submissionId,
            attempts,
            input.reason ?? null,
          ],
        );
        await client.query('COMMIT');
        return { attempts, terminalized: true };
      }
      await client.query(
        `UPDATE execution_spine.creation_submissions
            SET harness_start_attempts = $3,
                updated_at = clock_timestamp()
          WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.submissionId, attempts],
      );
      await client.query('COMMIT');
      return { attempts, terminalized: false };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimPrepareTerminalRefunds(input: {
    limit: number;
    leaseMs: number;
  }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Prepare terminal refund limit must be an integer from 1 through 100.");
    }
    if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1) {
      throw new Error("Prepare terminal refund lease must be a positive integer.");
    }
    const leaseId = randomUUID();
    const result = await this.pool.query<{
      lease_id: string;
      submission: unknown;
    }>(
      `WITH candidates AS (
         SELECT id
           FROM execution_spine.creation_submissions
          WHERE (
            prepare_terminal_refund_state = 'pending'
            AND (
              prepare_terminal_refund_next_attempt_at IS NULL
              OR prepare_terminal_refund_next_attempt_at <= clock_timestamp()
            )
          )
          OR (
            prepare_terminal_refund_state = 'processing'
            AND (
              prepare_terminal_refund_lease_expires_at IS NULL
              OR prepare_terminal_refund_lease_expires_at <= clock_timestamp()
            )
          )
          ORDER BY prepare_terminal_refund_next_attempt_at ASC NULLS FIRST, updated_at ASC, id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       ), claimed AS (
         UPDATE execution_spine.creation_submissions AS submission
            SET prepare_terminal_refund_state = 'processing',
                prepare_terminal_refund_lease_id = $2,
                prepare_terminal_refund_lease_expires_at =
                  clock_timestamp() + make_interval(secs => $3::double precision / 1000),
                updated_at = clock_timestamp()
           FROM candidates
          WHERE submission.id = candidates.id
          RETURNING submission.submission, submission.prepare_terminal_refund_lease_id AS lease_id
       )
       SELECT submission, lease_id
         FROM claimed`,
      [input.limit, leaseId, input.leaseMs],
    );
    return result.rows.map((row) => ({
      leaseId: row.lease_id,
      submission: storedSubmission(row.submission),
    }));
  }

  async completePrepareTerminalRefund(input: {
    workspaceId: string;
    submissionId: string;
    leaseId: string;
  }) {
    const result = await this.pool.query(
      `UPDATE execution_spine.creation_submissions
          SET prepare_terminal_refund_state = 'completed',
              prepare_terminal_refund_lease_id = NULL,
              prepare_terminal_refund_lease_expires_at = NULL,
              prepare_terminal_refund_next_attempt_at = NULL,
              prepare_terminal_refund_last_error = NULL,
              updated_at = clock_timestamp()
        WHERE workspace_id = $1
          AND id = $2
          AND prepare_terminal_refund_state = 'processing'
          AND prepare_terminal_refund_lease_id = $3`,
      [input.workspaceId, input.submissionId, input.leaseId],
    );
    return result.rowCount === 1;
  }

  async recordPrepareTerminalRefundFailure(input: {
    workspaceId: string;
    submissionId: string;
    leaseId: string;
    reason: string;
    maxAttempts: number;
  }) {
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new Error("Prepare terminal refund max attempts must be a positive integer.");
    }
    const result = await this.pool.query<{
      attempts: number;
      state: "pending" | "dead_letter";
    }>(
      `UPDATE execution_spine.creation_submissions
          SET prepare_terminal_refund_attempts = prepare_terminal_refund_attempts + 1,
              prepare_terminal_refund_state = CASE
                WHEN prepare_terminal_refund_attempts + 1 >= $5 THEN 'dead_letter'
                ELSE 'pending'
              END,
              prepare_terminal_refund_lease_id = NULL,
              prepare_terminal_refund_lease_expires_at = NULL,
              prepare_terminal_refund_next_attempt_at = CASE
                WHEN prepare_terminal_refund_attempts + 1 >= $5 THEN NULL
                ELSE clock_timestamp() + make_interval(
                  secs => LEAST(
                    300::double precision,
                    power(
                      2::double precision,
                      LEAST(prepare_terminal_refund_attempts, 8)
                    )
                  )
                )
              END,
              prepare_terminal_refund_last_error = $4,
              prepare_terminal_refund_dead_lettered_at = CASE
                WHEN prepare_terminal_refund_attempts + 1 >= $5 THEN clock_timestamp()
                ELSE NULL
              END,
              updated_at = clock_timestamp()
        WHERE workspace_id = $1
          AND id = $2
          AND prepare_terminal_refund_state = 'processing'
          AND prepare_terminal_refund_lease_id = $3
      RETURNING prepare_terminal_refund_attempts AS attempts,
                prepare_terminal_refund_state AS state`,
      [
        input.workspaceId,
        input.submissionId,
        input.leaseId,
        input.reason,
        input.maxAttempts,
      ],
    );
    const row = result.rows[0];
    if (!row) return { attempts: 0, state: "stale" as const };
    return {
      attempts: row.attempts,
      state:
        row.state === "dead_letter"
          ? ("dead_letter" as const)
          : ("retry_scheduled" as const),
    };
  }

  /**
   * V31-41: release product usage + merchant credits after prepare terminalizes.
   * Idempotent: failAndRefund no-ops on already-refunded quotes; credit refund
   * keys on a stable prepare-terminal operation id so a second call credits once.
   */
  async refundPrepareTerminalReservation(
    submission: CreationSubmissionRecord,
  ): Promise<void> {
    if (!this.creditLedger) return;
    const quoteId = submission.snapshot.quote?.id;
    if (!quoteId) {
      throw new Error(
        `Prepare terminal refund requires quote id on submission ${submission.snapshot.id}.`,
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockWorkspaceCreditsWithClient(
        client,
        submission.snapshot.workspaceId,
      );
      const now = (await databaseNow(client)).toISOString();
      const billing = new DurableProductBillingService(
        new PostgresProductBillingRepository(this.pool, client),
        () => new Date(now),
      );
      const refunded = await billing.failAndRefund({
        quoteId,
        workspaceId: submission.snapshot.workspaceId,
        forceCreditRefund: true,
        reason: 'prepare_terminal_failure',
      });
      const credits = storedUsageCredits(submission.usageReservation.credits);
      if (
        credits !== undefined &&
        refunded.quote.lifecycleStatus === 'refunded'
      ) {
        await this.creditLedger.refundUsageOperationWithClient(client, {
          workspaceId: submission.snapshot.workspaceId,
          usageOperationId: requiredCreditUsageOperationId(
            submission,
            'prepare terminal refund',
          ),
          refundOperationId: `prepare-terminal-refund:${submission.task.id}`,
          credits,
          actorId: 'system',
          correlationId: `prepare-terminal:${submission.task.id}`,
          createdAt: now,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * V31-82: running works whose execution chain has not advanced for the
   * injected timeout. Two windows — work exists but no generation job, or a
   * job exists with zero progress.
   */
  async listStalledWorks(input: {
    expiresBefore: string;
    limit: number;
  }): Promise<StalledWorkSweep[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('Stalled work claim limit must be from 1 through 100.');
    }
    const result = await this.pool.query<{
      workspace_id: string;
      submission_id: string;
      work_id: string;
      task_id: string;
      stall_window: StalledWorkWindow;
    }>(
      `SELECT s.workspace_id,
              s.id AS submission_id,
              s.work_id,
              s.task_id,
              CASE
                WHEN NOT EXISTS (
                  SELECT 1
                    FROM p1_generation_jobs jobs
                   WHERE jobs.workspace_id = s.workspace_id
                     AND (
                       jobs.usage_reservation_id = s.usage_reservation_id
                       OR jobs.correlation_id = s.task_id
                       OR jobs.correlation_id LIKE s.task_id || ':%'
                     )
                ) THEN 'work_running_no_job'
                ELSE 'job_stale_no_progress'
              END AS stall_window
         FROM execution_spine.creation_submissions s
         JOIN p1_creative_works works
           ON works.workspace_id = s.workspace_id
          AND works.id = s.work_id
        WHERE s.harness_state IN ('reserved', 'starting', 'started')
          AND works.payload->>'status' = 'running'
          AND (
            (
              works.updated_at <= $1::timestamptz
              AND NOT EXISTS (
                SELECT 1
                  FROM p1_generation_jobs jobs
                 WHERE jobs.workspace_id = s.workspace_id
                   AND (
                     jobs.usage_reservation_id = s.usage_reservation_id
                     OR jobs.correlation_id = s.task_id
                     OR jobs.correlation_id LIKE s.task_id || ':%'
                   )
              )
            )
            OR EXISTS (
              SELECT 1
                FROM p1_generation_jobs jobs
               WHERE jobs.workspace_id = s.workspace_id
                 AND (
                   jobs.usage_reservation_id = s.usage_reservation_id
                   OR jobs.correlation_id = s.task_id
                   OR jobs.correlation_id LIKE s.task_id || ':%'
                 )
                 AND jobs.status IN ('queued', 'running')
                 AND jobs.updated_at <= $1::timestamptz
            )
          )
        ORDER BY works.updated_at, s.id
        LIMIT $2`,
      [input.expiresBefore, input.limit],
    );
    return result.rows.map((row) => ({
      workspaceId: row.workspace_id,
      submissionId: row.submission_id,
      workId: row.work_id,
      taskId: row.task_id,
      window: row.stall_window,
    }));
  }

  /**
   * V31-82: fail the work, refund reserved usage/credits once, and leave a
   * workflow_failed audit so the Composer time-bridge drops the lock.
   * Same transaction holds the workspace credit lock.
   */
  async terminateRunningWork(input: {
    workspaceId: string;
    workId?: string;
    taskId?: string;
    reason: StalledWorkTerminalReason;
    window?: StalledWorkWindow;
    now?: string;
  }): Promise<'terminated' | 'already_terminal' | 'missing'> {
    if (!this.creditLedger) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Stalled work terminalization requires the merchant credit ledger.',
      );
    }
    if (!input.workId && !input.taskId) {
      throw new Error('Stalled work terminalization requires a work or task id.');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockWorkspaceCreditsWithClient(client, input.workspaceId);
      const located = await client.query<{
        id: string;
        submission: unknown;
        work_id: string;
        task_id: string;
        usage_reservation_id: string | null;
      }>(
        `SELECT id, submission, work_id, task_id, usage_reservation_id
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1
            AND (
              ($2::text IS NOT NULL AND work_id = $2)
              OR ($3::text IS NOT NULL AND task_id = $3)
            )
          ORDER BY created_at DESC
          LIMIT 1
          FOR UPDATE`,
        [input.workspaceId, input.workId ?? null, input.taskId ?? null],
      );
      const row = located.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return 'missing';
      }
      const work = await client.query<{
        status: string | null;
        payload: Record<string, unknown>;
      }>(
        `SELECT payload->>'status' AS status, payload
           FROM p1_creative_works
          WHERE workspace_id = $1 AND id = $2
          FOR UPDATE`,
        [input.workspaceId, row.work_id],
      );
      const workRow = work.rows[0];
      if (!workRow) {
        await client.query('ROLLBACK');
        return 'missing';
      }
      if (workRow.status === 'failed' || workRow.status === 'completed') {
        await client.query('COMMIT');
        return 'already_terminal';
      }
      const submission = storedSubmission(row.submission);
      const now = input.now ?? (await databaseNow(client)).toISOString();
      const quoteId = submission.snapshot.quote?.id;
      if (!quoteId) {
        throw new Error(
          `Stalled work refund requires quote id on submission ${submission.snapshot.id}.`,
        );
      }
      const billing = new DurableProductBillingService(
        new PostgresProductBillingRepository(this.pool, client),
        () => new Date(now),
      );
      const refunded = await billing.failAndRefund({
        quoteId,
        workspaceId: input.workspaceId,
        forceCreditRefund: true,
        reason:
          input.reason === 'cancelled'
            ? 'merchant_cancelled_running_work'
            : 'stalled_work_timeout',
      });
      const credits = storedUsageCredits(submission.usageReservation.credits);
      if (
        credits !== undefined &&
        refunded.quote.lifecycleStatus === 'refunded'
      ) {
        await this.creditLedger.refundUsageOperationWithClient(client, {
          workspaceId: input.workspaceId,
          usageOperationId: requiredCreditUsageOperationId(
            submission,
            'stalled work refund',
          ),
          refundOperationId: stalledWorkRefundOperationId(row.task_id),
          credits,
          actorId: 'system',
          correlationId: `stalled-work:${row.task_id}`,
          createdAt: now,
        });
      }
      const nextPayload = {
        ...workRow.payload,
        status: 'failed',
        failureReason: input.reason,
        failureCode: STALLED_WORK_FAILURE_CODE,
        updatedAt: now,
      };
      const failedWork = await client.query(
        `UPDATE p1_creative_works
            SET payload = $3::jsonb,
                updated_at = $4::timestamptz
          WHERE workspace_id = $1 AND id = $2
            AND payload->>'status' = 'running'`,
        [input.workspaceId, row.work_id, JSON.stringify(nextPayload), now],
      );
      if (failedWork.rowCount !== 1) {
        await client.query('COMMIT');
        return 'already_terminal';
      }
      await client.query(
        `UPDATE p1_generation_jobs
            SET status = 'failed',
                updated_at = $3::timestamptz
          WHERE workspace_id = $1
            AND status IN ('queued', 'running')
            AND (
              usage_reservation_id = $2
              OR correlation_id = $4
              OR correlation_id LIKE $4 || ':%'
            )`,
        [
          input.workspaceId,
          row.usage_reservation_id,
          now,
          row.task_id,
        ],
      );
      await client.query(
        `UPDATE p1_content_tasks
            SET payload = jsonb_set(
                  jsonb_set(payload, '{status}', '"failed"'),
                  '{updatedAt}',
                  to_jsonb($3::text)
                ),
                updated_at = $3::timestamptz
          WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, row.task_id, now],
      );
      const falseDelivery = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM harness_runtime.audit_events
          WHERE workflow_id IN ($1, $2)
            AND event_type = 'package_delivered'`,
        [row.task_id, composerPreparedAttemptId(submission)],
      );
      const correction =
        Number(falseDelivery.rows[0]?.n ?? 0) > 0
          ? {
              kind: 'semantic_delivery_without_terminal_work',
            }
          : undefined;
      const failurePayload = {
        code: STALLED_WORK_FAILURE_CODE,
        reason: input.reason,
        window: input.window ?? null,
        quotaRefunded: true,
        merchantMessage:
          input.reason === 'cancelled'
            ? '这次创作已取消，积分已经退回。'
            : '这次创作超时没有完成，积分已经退回。',
        ...(correction ? { correction } : {}),
      };
      const workflowIds = new Set<string>([
        row.task_id,
        composerPreparedAttemptId(submission),
      ]);
      for (const workflowId of workflowIds) {
        await client.query(
          `INSERT INTO harness_runtime.audit_events
             (id, workflow_id, stage, event_type, payload)
           VALUES ($1, $2, 'workflow', 'workflow_failed', $3::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [
            `audit-${workflowId}-workflow-failed`,
            workflowId,
            JSON.stringify(failurePayload),
          ],
        );
      }
      await client.query('COMMIT');
      return 'terminated';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async expireUndispatchedConfirmationHolds(input: { limit: number }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('Confirmation expiry limit must be from 1 through 100.');
    }
    if (!this.creditLedger) return 0;
    // Discover candidates without holding their row locks. Each settlement
    // transaction then follows the global cross-domain order used by successor
    // creation: workspace credits -> submission row -> quote/task.
    const candidates = await this.pool.query<{ id: string; workspace_id: string }>(
      `SELECT id, workspace_id
         FROM execution_spine.creation_submissions
        WHERE harness_state IN ('reserved', 'starting')
          AND submission->'confirmationDispatch'->>'state' = 'pending'
          AND COALESCE(
                (submission->'confirmationDispatch'->>'expiresAt')::timestamptz,
                (submission->'snapshot'->>'createdAt')::timestamptz
                  + interval '48 hours'
              ) <= clock_timestamp()
        ORDER BY updated_at, id
        LIMIT $1`,
      [input.limit],
    );
    let expired = 0;
    for (const candidate of candidates.rows) {
      if (await this.expireConfirmationHoldCandidate(candidate)) expired += 1;
    }
    return expired;
  }

  private async expireConfirmationHoldCandidate(input: {
    id: string;
    workspace_id: string;
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await lockWorkspaceCreditsWithClient(client, input.workspace_id);
      const locked = await client.query<{ submission: unknown }>(
        `SELECT submission
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2
            AND harness_state IN ('reserved', 'starting')
            AND submission->'confirmationDispatch'->>'state' = 'pending'
            AND COALESCE(
                  (submission->'confirmationDispatch'->>'expiresAt')::timestamptz,
                  (submission->'snapshot'->>'createdAt')::timestamptz
                    + interval '48 hours'
                ) <= clock_timestamp()
          FOR UPDATE SKIP LOCKED`,
        [input.workspace_id, input.id],
      );
      const row = locked.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return false;
      }
      const now = (await databaseNow(client)).toISOString();
      await this.expireLockedConfirmationHold(
        client,
        storedSubmission(row.submission),
        input.id,
        now,
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async expireLockedConfirmationHold(
    client: PoolClient,
    submission: CreationSubmissionRecord,
    submissionId: string,
    now: string,
  ) {
    if (!this.creditLedger) return;
    const billing = new DurableProductBillingService(
      new PostgresProductBillingRepository(this.pool, client),
      () => new Date(now),
    );
    const refunded = await billing.failAndRefund({
      quoteId: submission.snapshot.quote.id,
      workspaceId: submission.snapshot.workspaceId,
      forceCreditRefund: true,
      reason: 'confirmation_outbox_expired_before_dispatch',
    });
    const credits = storedUsageCredits(submission.usageReservation.credits);
    let refundAudit: ConfirmationRefundAudit | undefined;
    if (
      credits !== undefined &&
      refunded.quote.lifecycleStatus === 'refunded'
    ) {
      const refundPlan = await this.planConfirmationCreditRefund(client, {
        workspaceId: submission.snapshot.workspaceId,
        usageOperationId: submission.usageReservation.creditUsageOperationId,
        requestedCredits: credits,
        recordedAt: now,
      });
      refundAudit = refundPlan.audit;
      if (refundPlan.kind === "refund") {
        const usageOperationId = requiredCreditUsageOperationId(
          submission,
          'confirmation outbox expiry refund',
        );
        await this.creditLedger.refundUsageOperationWithClient(client, {
          workspaceId: submission.snapshot.workspaceId,
          usageOperationId,
          refundOperationId: `confirmation-outbox-expiry:${submission.task.id}:${submission.confirmationDispatch?.requestId ?? 'initial'}`,
          credits: refundPlan.credits,
          actorId: 'system',
          correlationId: `confirmation:${submission.task.id}`,
          createdAt: now,
        });
      }
    }
    await client.query(
      `UPDATE execution_spine.creation_submissions
          SET harness_state = 'failed',
              harness_lease_id = NULL,
              harness_lease_expires_at = NULL,
              submission = jsonb_set(
                submission,
                '{confirmationDispatch,state}',
                '"expired"'::jsonb,
                true
              )
              || CASE
                WHEN $4::jsonb IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('confirmationRefundAudit', $4::jsonb)
              END,
              updated_at = $3::timestamptz
        WHERE workspace_id = $1 AND id = $2`,
      [
        submission.snapshot.workspaceId,
        submissionId,
        now,
        refundAudit ? JSON.stringify(refundAudit) : null,
      ],
    );
  }

  /**
   * The ledger's refund API rightfully rejects an amount larger than the
   * original usage. Historical submission snapshots can carry a stale usage
   * amount or operation ID, so reconcile from the locked ledger facts before
   * refunding. Known settled/drift cases are terminally audited, while any
   * unknown ledger failure still aborts the transaction and remains retryable.
   */
  private async planConfirmationCreditRefund(
    client: PoolClient,
    input: {
      workspaceId: string;
      usageOperationId?: string;
      requestedCredits: number;
      recordedAt: string;
    },
  ): Promise<ConfirmationCreditRefundPlan> {
    const usageOperationId = input.usageOperationId?.trim();
    if (!usageOperationId) {
      return {
        kind: "dead_letter",
        audit: {
          status: "dead_letter",
          requestedCredits: input.requestedCredits,
          usageCredits: 0,
          refundedCredits: 0,
          reasonCode: "CREDIT_USAGE_OPERATION_MISSING",
          recordedAt: input.recordedAt,
        },
      };
    }
    await lockWorkspaceCreditsWithClient(client, input.workspaceId);
    const rows = await client.query<{
      usage_credits: number;
      refund_credits: number | null;
    }>(
      `SELECT usage.credits AS usage_credits,
              refund.credits AS refund_credits
         FROM p1_credit_lot_transactions AS usage
         LEFT JOIN p1_credit_lot_transactions AS refund
           ON refund.workspace_id = usage.workspace_id
          AND refund.related_transaction_id = usage.id
          AND refund.transaction_type = 'REFUND'
        WHERE usage.workspace_id = $1
          AND usage.transaction_type = 'USAGE'
          AND usage.operation_id = $2
        ORDER BY usage.id
        FOR UPDATE OF usage`,
      [input.workspaceId, usageOperationId],
    );
    const usageCredits = rows.rows.reduce(
      (total, row) => total + row.usage_credits,
      0,
    );
    const refundedCredits = rows.rows.reduce(
      (total, row) => total + (row.refund_credits ?? 0),
      0,
    );
    const audit = (
      status: ConfirmationRefundAudit["status"],
      reasonCode?: ConfirmationRefundAudit["reasonCode"],
    ): ConfirmationRefundAudit => ({
      status,
      requestedCredits: input.requestedCredits,
      usageCredits,
      refundedCredits,
      ...(reasonCode ? { reasonCode } : {}),
      recordedAt: input.recordedAt,
    });
    if (rows.rowCount === 0) {
      return {
        kind: "dead_letter",
        audit: audit("dead_letter", "CREDIT_USAGE_OPERATION_MISSING"),
      };
    }
    const hasPartialRefund = rows.rows.some(
      (row) =>
        row.refund_credits !== null && row.refund_credits !== row.usage_credits,
    );
    const hasExistingRefund = rows.rows.some(
      (row) => row.refund_credits !== null,
    );
    if (hasPartialRefund || (hasExistingRefund && refundedCredits !== usageCredits)) {
      return {
        kind: "dead_letter",
        audit: audit("dead_letter", "CREDIT_USAGE_PARTIALLY_REFUNDED"),
      };
    }
    if (refundedCredits === usageCredits) {
      return {
        kind: "settled",
        audit:
          usageCredits === input.requestedCredits
            ? audit("already_refunded")
            : audit("settled_with_credit_mismatch", "CREDIT_USAGE_REFUND_MISMATCH"),
      };
    }
    if (hasExistingRefund) {
      return {
        kind: "dead_letter",
        audit: audit("dead_letter", "CREDIT_USAGE_PARTIALLY_REFUNDED"),
      };
    }
    return {
      kind: "refund",
      credits: usageCredits,
      audit:
        usageCredits === input.requestedCredits
          ? audit("refunded")
          : audit("settled_with_credit_mismatch", "CREDIT_USAGE_REFUND_MISMATCH"),
    };
  }

  private async lockSubmission(
    client: PoolClient,
    input: { workspaceId: string; submissionId: string },
  ) {
    const result = await client.query<StoredSubmissionRow>(
      `SELECT payload_hash, submission, harness_state, harness_lease_id,
              harness_lease_expires_at, harness_started_lease_id,
              harness_start_attempts
         FROM execution_spine.creation_submissions
        WHERE workspace_id = $1 AND id = $2
        FOR UPDATE`,
      [input.workspaceId, input.submissionId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `Creation submission ${input.submissionId} was not found.`,
      );
    }
    return row;
  }
}

async function insertOnce(
  client: PoolClient,
  query: string,
  values: unknown[],
  conflictMessage: string,
) {
  const result = await client.query(query, values);
  if (result.rowCount !== 1) throw new Error(conflictMessage);
}

function storedSubmission(value: unknown): CreationSubmissionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored creation submission is invalid.");
  }
  const candidate = value as {
	agentBinding?: unknown;
	agentContinuationThreadId?: unknown;
	artifactLineage?: unknown;
    agentPlanPending?: unknown;
    confirmationDispatch?: unknown;
    contentPackage?: { expectedRevision?: unknown; id?: unknown };
    decisionReferences?: unknown;
    executionPlanFreeze?: unknown;
    executionPlanFreezes?: unknown;
    packageConfirmationDecisionRef?: unknown;
    executionConfirmationContext?: unknown;
    snapshot?: unknown;
    task?: { id?: unknown };
    usageReservation?: {
      id?: unknown;
      credits?: unknown;
      creditUsageOperationId?: unknown;
			confirmationOwnsCreditReservation?: unknown;
      units?: unknown;
    };
    work?: { id?: unknown };
  };
  const snapshot = creationExecutionSnapshotSchema.parse(candidate.snapshot);
  const decisionReferences = storedDecisionReferences(
    candidate.decisionReferences,
  );
  const executionPlanFreeze = storedExecutionPlanFreeze(
    candidate.executionPlanFreeze,
  );
  const executionPlanFreezes = storedExecutionPlanFreezes(
    candidate.executionPlanFreezes,
  );
  const packageConfirmationDecisionRef =
    typeof candidate.packageConfirmationDecisionRef === "string" &&
    candidate.packageConfirmationDecisionRef.trim().length > 0
      ? candidate.packageConfirmationDecisionRef.trim()
      : undefined;
  const executionConfirmationContext = storedExecutionConfirmationContext(
    candidate.executionConfirmationContext,
  );
  const confirmationDispatch = storedConfirmationDispatch(
    candidate.confirmationDispatch,
  );
  const contentPackageId = requiredId(
    candidate.contentPackage?.id,
    "contentPackage.id",
  );
  const taskId = requiredId(candidate.task?.id, "task.id");
  const usageReservationId = requiredId(
    candidate.usageReservation?.id,
    "usageReservation.id",
  );
  const credits = storedUsageCredits(candidate.usageReservation?.credits);
  const creditUsageOperationId =
    candidate.usageReservation?.creditUsageOperationId;
  if (
    creditUsageOperationId !== undefined &&
    (typeof creditUsageOperationId !== "string" || !creditUsageOperationId)
  ) {
    throw new Error(
      "Stored creation submission has an invalid credit usage operation.",
    );
  }
	const confirmationOwnsCreditReservation =
		candidate.usageReservation?.confirmationOwnsCreditReservation;
	if (
		confirmationOwnsCreditReservation !== undefined &&
		typeof confirmationOwnsCreditReservation !== 'boolean'
	) {
		throw new Error(
			"Stored creation submission has an invalid confirmation credit reservation owner.",
		);
	}
  if (
    candidate.agentPlanPending !== undefined &&
    typeof candidate.agentPlanPending !== "boolean"
  ) {
    throw new Error(
      "Stored creation submission has an invalid Agent plan state.",
    );
  }
  const usageUnits = storedUsageUnits(candidate.usageReservation?.units, {
    allowEmpty: credits !== undefined,
  });
  const workId = requiredId(candidate.work?.id, "work.id");
  if (
    typeof candidate.contentPackage?.expectedRevision !== "number" ||
    !Number.isInteger(candidate.contentPackage.expectedRevision) ||
    candidate.contentPackage.expectedRevision < 0
  ) {
    throw new Error(
      "Stored creation submission has an invalid expected revision.",
    );
  }
  return {
    contentPackage: {
      expectedRevision: candidate.contentPackage.expectedRevision,
      id: contentPackageId,
    },
    ...(decisionReferences ? { decisionReferences } : {}),
    ...(executionPlanFreeze ? { executionPlanFreeze } : {}),
    ...(executionPlanFreezes ? { executionPlanFreezes } : {}),
    ...(packageConfirmationDecisionRef
      ? { packageConfirmationDecisionRef }
      : {}),
    ...(executionConfirmationContext ? { executionConfirmationContext } : {}),
    ...(confirmationDispatch ? { confirmationDispatch } : {}),
    ...(typeof candidate.agentPlanPending === "boolean"
      ? { agentPlanPending: candidate.agentPlanPending }
      : {}),
    snapshot,
    task: { id: taskId },
    usageReservation: {
      id: usageReservationId,
      units: usageUnits,
      ...(credits !== undefined ? { credits } : {}),
      ...(typeof creditUsageOperationId === "string"
        ? { creditUsageOperationId }
        : {}),
		...(confirmationOwnsCreditReservation === true
			? { confirmationOwnsCreditReservation: true }
			: {}),
    },
    work: { id: workId },
	...(storedContinuationThreadId(candidate.agentContinuationThreadId)
		? { agentContinuationThreadId: storedContinuationThreadId(candidate.agentContinuationThreadId) }
		: {}),
	...(storedArtifactLineage(candidate.artifactLineage) ? { artifactLineage: storedArtifactLineage(candidate.artifactLineage) } : {}),
	...(storedAgentBinding(candidate.agentBinding) ? { agentBinding: storedAgentBinding(candidate.agentBinding) } : {}),
	...(storedExecutionPlanFreeze(candidate.executionPlanFreeze)
		? { executionPlanFreeze: storedExecutionPlanFreeze(candidate.executionPlanFreeze) }
		: {}),
  };
}

function storedConfirmationDispatch(
  value: unknown,
): CreationSubmissionRecord['confirmationDispatch'] {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored creation submission has invalid confirmation dispatch.');
  }
  const dispatch = value as Record<string, unknown>;
  if (
    (dispatch.requestId !== undefined &&
      typeof dispatch.requestId !== 'string') ||
		(dispatch.predecessorRequestId !== undefined &&
			typeof dispatch.predecessorRequestId !== 'string') ||
    (dispatch.expiresAt !== undefined &&
      typeof dispatch.expiresAt !== 'string') ||
    (dispatch.state !== 'pending' &&
      dispatch.state !== 'dispatched' &&
      dispatch.state !== 'expired')
  ) {
    throw new Error('Stored creation submission has invalid confirmation dispatch.');
  }
  return {
    ...(typeof dispatch.requestId === 'string'
      ? { requestId: dispatch.requestId }
      : {}),
		...(typeof dispatch.predecessorRequestId === 'string'
			? { predecessorRequestId: dispatch.predecessorRequestId }
			: {}),
    state: dispatch.state,
    ...(typeof dispatch.expiresAt === 'string'
      ? { expiresAt: dispatch.expiresAt }
      : {}),
  };
}

function confirmationDispatchExpired(
  submission: CreationSubmissionRecord,
  now: Date,
) {
  const dispatch = submission.confirmationDispatch;
  if (!dispatch || dispatch.state !== 'pending') return false;
  const expiresAt = dispatch.expiresAt
    ? Date.parse(dispatch.expiresAt)
    : Date.parse(submission.snapshot.createdAt) + 48 * 60 * 60 * 1_000;
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function storedArtifactLineage(value: unknown): CreationSubmissionRecord["artifactLineage"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored creation submission has invalid artifact lineage.");
	const candidate = value as {
	  artifactId?: unknown;
	  parentRevision?: unknown;
	  targetUnitIds?: unknown;
	  sourceUnitMappings?: unknown;
	};
  if (typeof candidate.artifactId !== "string" || !candidate.artifactId.trim() || !Number.isSafeInteger(candidate.parentRevision) || (candidate.parentRevision as number) < 1) {
	throw new Error("Stored creation submission has invalid artifact lineage.");
  }
	if (candidate.targetUnitIds !== undefined && (
	  !Array.isArray(candidate.targetUnitIds) ||
	  candidate.targetUnitIds.length === 0 ||
	  candidate.targetUnitIds.some((id) => typeof id !== "string" || !id.trim())
	)) throw new Error("Stored creation submission has invalid artifact target units.");
	if (candidate.sourceUnitMappings !== undefined && (
	  !Array.isArray(candidate.sourceUnitMappings) ||
	  candidate.sourceUnitMappings.length === 0 ||
	  candidate.sourceUnitMappings.some((mapping) => {
		if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return true;
		const item = mapping as { sourceUnitId?: unknown; executionUnitId?: unknown };
		return typeof item.sourceUnitId !== "string" || !item.sourceUnitId.trim() ||
		  typeof item.executionUnitId !== "string" || !item.executionUnitId.trim();
	  })
	)) throw new Error("Stored creation submission has invalid artifact unit mappings.");
	return {
	  artifactId: candidate.artifactId,
	  parentRevision: candidate.parentRevision as number,
	  ...(candidate.targetUnitIds ? { targetUnitIds: candidate.targetUnitIds as string[] } : {}),
	  ...(candidate.sourceUnitMappings
		? { sourceUnitMappings: candidate.sourceUnitMappings as Array<{ sourceUnitId: string; executionUnitId: string }> }
		: {}),
	};
}

function storedExecutionPlanFreeze(
  value: unknown,
): CreationSubmissionRecord['executionPlanFreeze'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored creation submission has an invalid execution plan freeze.');
  }
  const freeze = value as Record<string, unknown>;
  if (
    typeof freeze.planId !== 'string' ||
    !Number.isSafeInteger(freeze.planRevision) ||
    !freeze.executionPlan ||
    !Array.isArray(freeze.deliverables) ||
    !freeze.quoteRef ||
    !Array.isArray(freeze.rightsRevisionRefs) ||
    typeof freeze.harnessReleaseId !== 'string' ||
    (freeze.approvalBasis !== 'merchant_confirmed' &&
      freeze.approvalBasis !== 'policy_exempt_copy')
  ) {
    throw new Error('Stored creation submission has an invalid execution plan freeze.');
  }
  return structuredClone(value) as CreationSubmissionRecord['executionPlanFreeze'];
}

function storedExecutionPlanFreezes(
  value: unknown,
): CreationSubmissionRecord['executionPlanFreezes'] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      'Stored creation submission has an invalid execution plan freeze set.',
    );
  }
  return value.map((entry) => {
    const freeze = storedExecutionPlanFreeze(entry);
    if (!freeze) {
      throw new Error(
        'Stored creation submission has an invalid execution plan freeze set.',
      );
    }
    return freeze;
  });
}

function storedExecutionConfirmationContext(
  value: unknown,
): CreationSubmissionRecord['executionConfirmationContext'] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Stored creation submission has invalid Campaign confirmation context.');
  }
  const context = value as Record<string, unknown>;
  const campaign = context.campaignPlanRef;
  if (
    !campaign ||
    typeof campaign !== 'object' ||
    Array.isArray(campaign) ||
    typeof (campaign as Record<string, unknown>).id !== 'string' ||
    !Number.isSafeInteger(context.workOrdinal) ||
    (context.workOrdinal as number) < 1 ||
    context.approvalScope !== 'single_work'
  ) {
    throw new Error('Stored creation submission has invalid Campaign confirmation context.');
  }
  return structuredClone(value) as CreationSubmissionRecord['executionConfirmationContext'];
}

function storedAgentBinding(value: unknown): ComposerAgentBinding | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
	throw new Error("Stored creation submission has an invalid Agent binding.");
  }
  const candidate = value as { threadId?: unknown; runId?: unknown };
  if (typeof candidate.threadId !== "string" || typeof candidate.runId !== "string" || !candidate.runId.trim()) {
	throw new Error("Stored creation submission has an invalid Agent binding.");
  }
  return { threadId: asAgentThreadIdentity(candidate.threadId), runId: candidate.runId };
}

/**
 * Key-order-independent JSON for comparing a jsonb round-trip against an
 * in-memory value. Keeps `JSON.stringify`'s treatment of `undefined` members so
 * it agrees with what the column can hold.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}


function storedContinuationThreadId(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
	throw new Error("Stored creation submission has an invalid continuation Thread.");
  }
  return asAgentThreadIdentity(value);
}

function storedDecisionReferences(
  value: unknown,
): CreationSubmissionRecord["decisionReferences"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Stored creation submission has invalid decision references.");
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        "Stored creation submission has invalid decision references.",
      );
    }
    const candidate = entry as {
      field?: unknown;
      id?: unknown;
      revision?: unknown;
      value?: unknown;
    };
    if (
      typeof candidate.field !== "string" ||
      candidate.field.trim().length === 0 ||
      typeof candidate.id !== "string" ||
      candidate.id.trim().length === 0 ||
      !Number.isSafeInteger(candidate.revision) ||
      (candidate.revision as number) < 0 ||
      typeof candidate.value !== "string" ||
      candidate.value.trim().length === 0
    ) {
      throw new Error(
        "Stored creation submission has invalid decision references.",
      );
    }
    return {
      field: candidate.field,
      id: candidate.id,
      revision: candidate.revision as number,
      value: candidate.value,
    };
  });
}

function cloneSubmission(submission: CreationSubmissionRecord) {
  return storedSubmission(structuredClone(submission));
}

/**
 * Paid credit usage needs one durable operation id before the reservation
 * transaction starts. Settlement, expiry, and replay must consume this frozen
 * fact rather than deriving an id from a later workflow axis.
 */
function freezeCreditUsageOperationAtAdmission(
  submission: CreationSubmissionRecord,
): void {
  const credits = storedUsageCredits(submission.usageReservation.credits);
  if (
    credits === undefined ||
    submission.usageReservation.confirmationOwnsCreditReservation === true
  ) {
    return;
  }
  const canonical = creditUsageOperationId(submission.task.id);
  const supplied = submission.usageReservation.creditUsageOperationId?.trim();
  if (supplied && supplied !== canonical) {
    throw new P1DomainError(
      "INVALID_STATE",
      "Submission credit usage operation does not match its admitted task.",
    );
  }
  submission.usageReservation.creditUsageOperationId = canonical;
}

/** Rebuilds a new quote solely from the locked terminal submission facts. */
function cloneExpiredSuccessorQuote(input: {
  source: CreationSubmissionRecord;
  sourceQuote: ProductQuoteSnapshot;
  quoteId: string;
  taskId: string;
  createdAt: string;
}): BuildProductQuoteInput {
  const { source, sourceQuote } = input;
  const expiresAt = new Date(
    Date.parse(input.createdAt) + 48 * 60 * 60 * 1_000,
  ).toISOString();
  return {
    authorizedCeiling: sourceQuote.authorizedCeiling,
    billingMode: sourceQuote.billingMode,
    catalogModelId: sourceQuote.catalogModelId,
    ...(sourceQuote.catalogModelRevision
      ? { catalogModelRevision: sourceQuote.catalogModelRevision }
      : {}),
    ...(sourceQuote.creditCost !== undefined
      ? { creditCost: sourceQuote.creditCost }
      : {}),
    ...(sourceQuote.debitUnits
      ? { debitUnits: structuredClone(sourceQuote.debitUnits) }
      : {}),
    ...(sourceQuote.failureRefundsCredits !== undefined
      ? { failureRefundsCredits: sourceQuote.failureRefundsCredits }
      : {}),
    formulaExpression: sourceQuote.formula.expression,
    ...(sourceQuote.formula.currency
      ? { currency: sourceQuote.formula.currency }
      : {}),
    ...(sourceQuote.frozenCandidateDeploymentIds
      ? {
          frozenCandidateDeploymentIds: [
            ...sourceQuote.frozenCandidateDeploymentIds,
          ],
        }
      : {}),
    ...(sourceQuote.minChargeSeconds !== undefined
      ? { minChargeSeconds: sourceQuote.minChargeSeconds }
      : {}),
    ...(sourceQuote.operation ? { operation: sourceQuote.operation } : {}),
    ...(sourceQuote.outputCount !== undefined
      ? { outputCount: sourceQuote.outputCount }
      : {}),
    ...(sourceQuote.outputLabel ? { outputLabel: sourceQuote.outputLabel } : {}),
    quoteId: input.quoteId,
    quotePolicyRevision: sourceQuote.quotePolicyRevision,
    ...(sourceQuote.roundingStepSeconds !== undefined
      ? { roundingStepSeconds: sourceQuote.roundingStepSeconds }
      : {}),
    ...(sourceQuote.routeSnapshotRef
      ? { routeSnapshotRef: sourceQuote.routeSnapshotRef }
      : {}),
    submissionContractHash:
      sourceQuote.submissionContractHash ??
      fingerprintValue({
        freeze: source.executionPlanFreeze,
        snapshot: source.snapshot,
      }),
    ...(sourceQuote.submissionPromptHash
      ? { submissionPromptHash: sourceQuote.submissionPromptHash }
      : {}),
    ...(sourceQuote.submissionReferenceAssetsHash
      ? {
          submissionReferenceAssetsHash:
            sourceQuote.submissionReferenceAssetsHash,
        }
      : {}),
    ...(sourceQuote.submissionInputAssetsHash
      ? { submissionInputAssetsHash: sourceQuote.submissionInputAssetsHash }
      : {}),
    taskId: input.taskId,
    ...(sourceQuote.targetSeconds !== undefined
      ? { targetSeconds: sourceQuote.targetSeconds }
      : {}),
    unitRate: sourceQuote.formula.unitRate,
    workspaceId: source.snapshot.workspaceId,
    expiresAt,
  };
}

function requiredId(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Stored creation submission has an invalid ${field}.`);
  }
  return value;
}

function storedUsageCredits(value: unknown) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error("Stored creation submission has invalid credit usage.");
  }
  return value as number;
}

/**
 * A credit-priced submission must carry the operation id frozen by admission.
 * Recreating `consume:${taskId}` here would let an old workflow/task axis
 * redirect a refund or consume after a replay, so missing lineage is terminal.
 */
function requiredCreditUsageOperationId(
  submission: CreationSubmissionRecord,
  phase: string,
): string {
  const operationId = submission.usageReservation.creditUsageOperationId?.trim();
  if (!operationId) {
    throw new P1DomainError(
      "INVALID_STATE",
      `Credit usage operation is missing from the frozen submission during ${phase}.`,
    );
  }
  return operationId;
}

function storedUsageUnits(
  value: unknown,
  options: { allowEmpty?: boolean } = {},
): CreationSubmissionUsageUnit[] {
  if (!Array.isArray(value) || (value.length === 0 && !options.allowEmpty)) {
    throw new Error(
      "Stored creation submission requires explicit product usage units.",
    );
  }
  const resources = new Set<CreationSubmissionUsageUnit["resource"]>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Stored creation submission has invalid usage units.");
    }
    const candidate = entry as { quantity?: unknown; resource?: unknown };
    if (
      !["copy", "image", "video"].includes(
        candidate.resource as string,
      ) ||
      !Number.isSafeInteger(candidate.quantity) ||
      (candidate.quantity as number) < 1 ||
      resources.has(candidate.resource as CreationSubmissionUsageUnit["resource"])
    ) {
      throw new Error("Stored creation submission has invalid usage units.");
    }
    const resource =
      candidate.resource as CreationSubmissionUsageUnit["resource"];
    resources.add(resource);
    return { resource, quantity: candidate.quantity as number };
  });
}

async function databaseNow(client: PoolClient) {
  const result = await client.query<{ now: Date | string }>(
    "SELECT clock_timestamp() AS now",
  );
  const value = result.rows[0]?.now;
  if (!value) throw new Error("PostgreSQL clock timestamp was unavailable.");
  return new Date(value);
}

function contentPackageKind(lens: CreationSubmissionRecord["snapshot"]["lens"]) {
  return lens === "video" ? "video" : "image_text";
}

function creationSubmissionMerchantInput(
  submission: CreationSubmissionRecord,
) {
  const snapshot = submission.snapshot;
  return {
    input: {
      inputAssets: snapshot.sources.assets.map((asset) => ({
        assetId: asset.id,
        role: asset.role,
      })),
      referenceAssetIds: snapshot.sources.assets.map((asset) => asset.id),
    },
    prompt: snapshot.intent.text,
  };
}

export class PostgresStalledWorkSweepStore implements StalledWorkSweepStore {
  constructor(private readonly store: PostgresCreationSubmissionStore) {}

  claimBatch(input: { expiresBefore: string; limit: number }) {
    return this.store.listStalledWorks(input);
  }

  terminate(input: {
    sweep: StalledWorkSweep;
    reason: StalledWorkTerminalReason;
    now: string;
  }) {
    return this.store.terminateRunningWork({
      workspaceId: input.sweep.workspaceId,
      workId: input.sweep.workId,
      taskId: input.sweep.taskId,
      reason: input.reason,
      window: input.sweep.window,
      now: input.now,
    });
  }
}
