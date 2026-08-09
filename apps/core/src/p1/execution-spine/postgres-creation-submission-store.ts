import { randomUUID } from "node:crypto";
import {
  isComposerVariantPlatform,
  type BuildProductQuoteInput,
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
import type {
  CreationSubmissionRecord,
  CreationSubmissionStore,
  CreationSubmissionStoreClaim,
  CreationSubmissionUsageUnit,
} from "./submission-coordinator.js";

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
		const usageOperationId = creditUsageOperationId(submission.task.id);
		submission.usageReservation.creditUsageOperationId = usageOperationId;
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
		const previousUsageOperationId =
			submission.usageReservation.creditUsageOperationId ??
			creditUsageOperationId(submission.task.id);
		await this.credits.refundUsageOperationWithClient(client, {
			workspaceId: snapshot.workspaceId,
			usageOperationId: previousUsageOperationId,
			refundOperationId: `plan-reprice-refund:${submission.task.id}:r${input.freeze.planRevision}`,
			actorId: snapshot.actorId,
			correlationId: `plan-reprice:${submission.task.id}`,
			createdAt: snapshot.createdAt,
		});
		const successorUsageOperationId = creditUsageOperationId(
			`${submission.task.id}:plan-r${input.freeze.planRevision}:quote-${input.freeze.quoteRef.id}@${input.freeze.quoteRef.revision}`,
		);
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
    options: { harnessStartLeaseMs?: number } = {},
  ) {
    this.harnessStartLeaseMs = options.harnessStartLeaseMs ?? 60_000;
  }

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
        harness_start_attempts integer NOT NULL DEFAULT 0,
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
        ADD COLUMN IF NOT EXISTS harness_start_attempts integer NOT NULL DEFAULT 0;
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
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_created_idx
        ON execution_spine.creation_submissions (workspace_id, created_at, id);
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_task_idx
        ON execution_spine.creation_submissions (workspace_id, task_id);
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_package_idx
        ON execution_spine.creation_submissions (workspace_id, content_package_id);
      CREATE INDEX IF NOT EXISTS creation_submissions_harness_recovery_idx
        ON execution_spine.creation_submissions (updated_at, id)
        WHERE harness_state IN ('reserved', 'starting');
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

  async saveExecutionPlanFreeze(input: {
    workspaceId: string;
    submissionId: string;
    freeze: CreationSubmissionRecord['executionPlanFreeze'];
    quoteRef?: CreationSubmissionRecord['snapshot']['quote'];
    credits?: number;
  }) {
    if (!input.freeze) {
      throw new Error('Execution plan freeze is required.');
    }
    const result = await this.pool.query<{ submission: unknown }>(
      `UPDATE execution_spine.creation_submissions
          SET submission = jsonb_set(jsonb_set(
              jsonb_set(
                jsonb_set(submission,
                '{executionPlanFreeze}',
                $3::jsonb,
                true
                ),
                '{snapshot,quote}',
                COALESCE($4::jsonb, submission#>'{snapshot,quote}'),
                true
              ),
              '{usageReservation,credits}',
              COALESCE($5::jsonb, submission#>'{usageReservation,credits}'),
              true
            ), '{agentPlanPending}', 'false'::jsonb, true),
              updated_at = clock_timestamp()
        WHERE workspace_id = $1
          AND id = $2
          AND harness_state = 'reserved'
          AND (
            submission->'executionPlanFreeze' IS NULL
            OR submission->'executionPlanFreeze' = $3::jsonb
            OR (
              submission#>>'{executionPlanFreeze,planId}' = $6
              AND (submission#>>'{executionPlanFreeze,planRevision}')::integer < $7
            )
          )
        RETURNING submission`,
      [
        input.workspaceId,
        input.submissionId,
        JSON.stringify(input.freeze),
        input.quoteRef ? JSON.stringify(input.quoteRef) : null,
        input.credits !== undefined ? JSON.stringify(input.credits) : null,
        input.freeze.planId,
        input.freeze.planRevision,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      const existing = await this.pool.query<{ submission: unknown }>(
        `SELECT submission
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2`,
        [input.workspaceId, input.submissionId],
      );
      const stored = existing.rows[0];
      if (!stored) {
        throw new Error(`Creation submission ${input.submissionId} was not found.`);
      }
      const submission = storedSubmission(stored.submission);
      if (
        JSON.stringify(submission.executionPlanFreeze) !==
        JSON.stringify(input.freeze)
      ) {
        throw new Error(
          `Creation submission ${input.submissionId} cannot change its execution plan freeze after Harness admission.`,
        );
      }
      return submission;
    }
    return storedSubmission(row.submission);
  }

	async saveRepricedExecutionPlanFreeze(input: {
		workspaceId: string;
		submissionId: string;
		expectedFreeze: CreationSubmissionRecord["executionPlanFreeze"] | null;
		previousQuoteRef: { id: string; revision: string };
		freeze: NonNullable<CreationSubmissionRecord["executionPlanFreeze"]>;
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
      const row = await this.lockSubmission(client, input);
      const now = await databaseNow(client);
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
                updated_at = $4::timestamptz
          WHERE workspace_id = $1 AND id = $2`,
        [
          input.workspaceId,
          input.submissionId,
          input.leaseId,
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

  async listRecoverableHarnessStarts(input: { limit: number }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Recoverable Harness start limit must be an integer from 1 through 100.");
    }
    const result = await this.pool.query<{ submission: unknown }>(
      `SELECT submission
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
        ORDER BY updated_at ASC, id ASC
        LIMIT $1`,
      [input.limit],
    );
    return result.rows.map((row) => ({ submission: storedSubmission(row.submission) }));
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
    contentPackage?: { expectedRevision?: unknown; id?: unknown };
    decisionReferences?: unknown;
    executionPlanFreeze?: unknown;
    executionConfirmationContext?: unknown;
    snapshot?: unknown;
    task?: { id?: unknown };
    usageReservation?: { id?: unknown; credits?: unknown; units?: unknown };
    work?: { id?: unknown };
  };
  const snapshot = creationExecutionSnapshotSchema.parse(candidate.snapshot);
  const decisionReferences = storedDecisionReferences(
    candidate.decisionReferences,
  );
  const executionPlanFreeze = storedExecutionPlanFreeze(
    candidate.executionPlanFreeze,
  );
  const executionConfirmationContext = storedExecutionConfirmationContext(
    candidate.executionConfirmationContext,
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
    ...(executionConfirmationContext ? { executionConfirmationContext } : {}),
    snapshot,
    task: { id: taskId },
    usageReservation: {
      id: usageReservationId,
      units: usageUnits,
      ...(credits !== undefined ? { credits } : {}),
    },
    work: { id: workId },
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
