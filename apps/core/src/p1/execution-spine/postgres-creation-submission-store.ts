import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { P1DomainError } from "../foundation/domain.js";
import { buildContentPackage } from "../operations/content-package.js";
import { DurableProductBillingService } from "../product-billing/durable-service.js";
import { PostgresProductBillingRepository } from "../product-billing/postgres-repository.js";
import { creationExecutionSnapshotSchema } from "./creation-execution-snapshot.js";
import type {
  CreationSubmissionRecord,
  CreationSubmissionStore,
  CreationSubmissionStoreClaim,
} from "./submission-coordinator.js";

type HarnessStartState = "reserved" | "starting" | "started";

interface StoredSubmissionRow {
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
}

export interface CreationUsageReservationPort {
  reserve(
    client: PoolClient,
    submission: CreationSubmissionRecord,
  ): Promise<void>;
}

/**
 * Uses the canonical durable ProductQuote/ProductUsage service in the same
 * PostgreSQL transaction as the Snapshot, Work, Task and ContentPackage shell.
 */
export class PostgresProductBillingUsageReservation implements CreationUsageReservationPort {
  constructor(private readonly pool: Pool) {}

  async reserve(client: PoolClient, submission: CreationSubmissionRecord) {
    const snapshot = submission.snapshot;
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
    const reserved = await billing.reserve({
      quoteId: quote.quoteId,
      resource: billingResource(snapshot.lens),
      usageId: submission.usageReservation.id,
      workspaceId: snapshot.workspaceId,
    });
    if (reserved.usage.id !== submission.usageReservation.id) {
      throw new P1DomainError(
        "IDEMPOTENCY_CONFLICT",
        `Product usage for task ${submission.task.id} has a different reservation identity.`,
      );
    }
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
          id: submission.work.id,
          intent: snapshot.intent.text,
          mode: "agent",
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
        },
        ...(snapshot.sources.contentPackage
          ? { sourceContentPackage: snapshot.sources.contentPackage }
          : {}),
        targetPlatform: snapshot.platform.id,
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
    await insertOnce(
      client,
      `INSERT INTO p1_content_packages
         (workspace_id, id, payload, revision, updated_at)
       VALUES ($1, $2, $3::jsonb, 0, $4::timestamptz)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        snapshot.workspaceId,
        submission.contentPackage.id,
        JSON.stringify(contentPackageWithLineage),
        timestamp,
      ],
      `ContentPackage ${submission.contentPackage.id} already exists.`,
    );
    await this.usage.reserve(client, submission);
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
          CHECK (harness_state IN ('reserved', 'starting', 'started')),
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
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_created_idx
        ON execution_spine.creation_submissions (workspace_id, created_at, id);
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_task_idx
        ON execution_spine.creation_submissions (workspace_id, task_id);
      CREATE INDEX IF NOT EXISTS creation_submissions_workspace_package_idx
        ON execution_spine.creation_submissions (workspace_id, content_package_id);
    `);
  }

  async applySchema() {
    await this.migrate();
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
      const leaseId = randomUUID();
      const expiresAt = new Date(
        now.getTime() + this.harnessStartLeaseMs,
      ).toISOString();
      await client.query(
        `UPDATE execution_spine.creation_submissions
            SET harness_state = 'starting',
                harness_lease_id = $3,
                harness_lease_expires_at = $4::timestamptz,
                harness_started_lease_id = NULL,
                harness_start_attempts = harness_start_attempts + 1,
                updated_at = $5::timestamptz
          WHERE workspace_id = $1 AND id = $2`,
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
      return { kind: "start" as const, leaseId };
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

  async listRecoverableHarnessStarts(input: { limit: number }) {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Recoverable Harness start limit must be an integer from 1 through 100.");
    }
    const result = await this.pool.query<{ submission: unknown }>(
      `SELECT submission
         FROM execution_spine.creation_submissions
        WHERE harness_state = 'reserved'
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
              harness_lease_expires_at, harness_started_lease_id
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
    snapshot?: unknown;
    task?: { id?: unknown };
    usageReservation?: { id?: unknown };
    work?: { id?: unknown };
  };
  const snapshot = creationExecutionSnapshotSchema.parse(candidate.snapshot);
  const contentPackageId = requiredId(
    candidate.contentPackage?.id,
    "contentPackage.id",
  );
  const taskId = requiredId(candidate.task?.id, "task.id");
  const usageReservationId = requiredId(
    candidate.usageReservation?.id,
    "usageReservation.id",
  );
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
    snapshot,
    task: { id: taskId },
    usageReservation: { id: usageReservationId },
    work: { id: workId },
  };
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

async function databaseNow(client: PoolClient) {
  const result = await client.query<{ now: Date | string }>(
    "SELECT clock_timestamp() AS now",
  );
  const value = result.rows[0]?.now;
  if (!value) throw new Error("PostgreSQL clock timestamp was unavailable.");
  return new Date(value);
}

function billingResource(lens: CreationSubmissionRecord["snapshot"]["lens"]) {
  return lens;
}

function contentPackageKind(lens: CreationSubmissionRecord["snapshot"]["lens"]) {
  return lens === "video" ? "video" : "image_text";
}
