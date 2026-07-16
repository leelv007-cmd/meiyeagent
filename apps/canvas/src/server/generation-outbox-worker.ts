import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
	type CoreGenerationJobResult,
	type CoreGenerationProvider,
	CoreGenerationProviderError,
	type CoreGenerationSubmitInput,
} from "./core-generation-provider";

export type CanvasGenerationOutboxSource =
	| "canvas_generation"
	| "agent_run_generation";

export interface CanvasGenerationOutboxEntry {
	id: string;
	localJobId: string;
	request: CoreGenerationSubmitInput;
	source: CanvasGenerationOutboxSource;
	workspaceId: string;
}

export interface CanvasGenerationOutboxClaim
	extends CanvasGenerationOutboxEntry {
	attemptCount: number;
	claimToken: string;
}

export interface CanvasGenerationOutboxRepository {
	claimNext(input: {
		claimToken: string;
		leaseMs: number;
		now: Date;
		workerId: string;
	}): Promise<CanvasGenerationOutboxClaim | null>;
	markFailed(input: {
		claimToken: string;
		code: string;
		id: string;
		message: string;
		now: Date;
		retryAt?: Date;
	}): Promise<boolean>;
	markSubmitted(input: {
		claimToken: string;
		coreJobId: string;
		coreStatus: CoreGenerationJobResult["status"];
		id: string;
		now: Date;
	}): Promise<boolean>;
}

export type CanvasGenerationOutboxSqlClient = Pick<PoolClient, "query">;

export class PostgresCanvasGenerationOutboxRepository
	implements CanvasGenerationOutboxRepository
{
	constructor(private readonly pool: Pool) {}

	async migrate() {
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS canvas_core_generation_outbox (
				id text PRIMARY KEY,
				workspace_id text NOT NULL,
				local_job_id text NOT NULL,
				source text NOT NULL CHECK (
					source IN ('canvas_generation', 'agent_run_generation')
				),
				payload jsonb NOT NULL,
				status text NOT NULL DEFAULT 'pending' CHECK (
					status IN ('pending', 'claimed', 'retry', 'submitted', 'failed')
				),
				attempt_count integer NOT NULL DEFAULT 0,
				available_at timestamptz NOT NULL DEFAULT now(),
				claimed_by text,
				claim_token text,
				lease_expires_at timestamptz,
				core_job_id text,
				core_status text,
				last_error_code text,
				last_error_message text,
				created_at timestamptz NOT NULL DEFAULT now(),
				updated_at timestamptz NOT NULL DEFAULT now(),
				UNIQUE (workspace_id, local_job_id)
			)
		`);
		await this.pool.query(`
			CREATE INDEX IF NOT EXISTS canvas_core_generation_outbox_claim_idx
			ON canvas_core_generation_outbox (available_at, created_at)
			WHERE status IN ('pending', 'retry', 'claimed')
		`);
	}

	async enqueue(
		entry: CanvasGenerationOutboxEntry,
		client: CanvasGenerationOutboxSqlClient = this.pool,
	) {
		const result = await client.query(
			`INSERT INTO canvas_core_generation_outbox (
				id, workspace_id, local_job_id, source, payload
			 ) VALUES ($1, $2, $3, $4, $5::jsonb)
			 ON CONFLICT (workspace_id, local_job_id) DO NOTHING
			 RETURNING id`,
			[
				entry.id,
				entry.workspaceId,
				entry.localJobId,
				entry.source,
				JSON.stringify(entry.request),
			],
		);
		return result.rows.length === 1;
	}

	async claimNext(input: {
		claimToken: string;
		leaseMs: number;
		now: Date;
		workerId: string;
	}) {
		const result = await this.pool.query<OutboxRow>(
			`WITH candidate AS (
				SELECT id
				FROM canvas_core_generation_outbox
				WHERE (
					status IN ('pending', 'retry') AND available_at <= $1
				) OR (
					status = 'claimed' AND lease_expires_at <= $1
				)
				ORDER BY available_at, created_at
				FOR UPDATE SKIP LOCKED
				LIMIT 1
			)
			UPDATE canvas_core_generation_outbox AS outbox
			SET status = 'claimed',
				claimed_by = $2,
				claim_token = $3,
				lease_expires_at = $1 + ($4::bigint * interval '1 millisecond'),
				attempt_count = attempt_count + 1,
				updated_at = $1
			FROM candidate
			WHERE outbox.id = candidate.id
			RETURNING outbox.*`,
			[input.now, input.workerId, input.claimToken, input.leaseMs],
		);
		const row = result.rows[0];
		return row ? claimFromRow(row) : null;
	}

	async markSubmitted(input: {
		claimToken: string;
		coreJobId: string;
		coreStatus: CoreGenerationJobResult["status"];
		id: string;
		now: Date;
	}) {
		const result = await this.pool.query(
			`UPDATE canvas_core_generation_outbox
			 SET status = 'submitted',
				core_job_id = $3,
				core_status = $4,
				claimed_by = NULL,
				claim_token = NULL,
				lease_expires_at = NULL,
				updated_at = $5
			 WHERE id = $1 AND status = 'claimed' AND claim_token = $2
			 RETURNING id`,
			[
				input.id,
				input.claimToken,
				input.coreJobId,
				input.coreStatus,
				input.now,
			],
		);
		return result.rows.length === 1;
	}

	async markFailed(input: {
		claimToken: string;
		code: string;
		id: string;
		message: string;
		now: Date;
		retryAt?: Date;
	}) {
		const result = await this.pool.query(
			`UPDATE canvas_core_generation_outbox
			 SET status = $3,
				available_at = COALESCE($4, available_at),
				last_error_code = $5,
				last_error_message = $6,
				claimed_by = NULL,
				claim_token = NULL,
				lease_expires_at = NULL,
				updated_at = $7
			 WHERE id = $1 AND status = 'claimed' AND claim_token = $2
			 RETURNING id`,
			[
				input.id,
				input.claimToken,
				input.retryAt ? "retry" : "failed",
				input.retryAt ?? null,
				input.code,
				input.message,
				input.now,
			],
		);
		return result.rows.length === 1;
	}
}

export class CanvasGenerationOutboxWorker {
	private readonly clock: () => Date;
	private readonly claimToken: () => string;
	private readonly leaseMs: number;
	private readonly retryDelayMs: number;

	constructor(
		private readonly repository: CanvasGenerationOutboxRepository,
		private readonly provider: Pick<CoreGenerationProvider, "submit">,
		options: {
			claimToken?: () => string;
			clock?: () => Date;
			leaseMs?: number;
			retryDelayMs?: number;
		} = {},
	) {
		this.clock = options.clock ?? (() => new Date());
		this.claimToken = options.claimToken ?? randomUUID;
		this.leaseMs = options.leaseMs ?? 60_000;
		this.retryDelayMs = options.retryDelayMs ?? 5_000;
	}

	async runOnce(workerId: string) {
		const now = this.clock();
		const claim = await this.repository.claimNext({
			claimToken: this.claimToken(),
			leaseMs: this.leaseMs,
			now,
			workerId,
		});
		if (!claim) return { status: "idle" as const };

		try {
			const result = await this.provider.submit(claim.request);
			const persisted = await this.repository.markSubmitted({
				claimToken: claim.claimToken,
				coreJobId: result.jobId,
				coreStatus: result.status,
				id: claim.id,
				now: this.clock(),
			});
			return {
				claimId: claim.id,
				coreJobId: result.jobId,
				persisted,
				status: "submitted" as const,
			};
		} catch (error) {
			const known =
				error instanceof CoreGenerationProviderError ? error : undefined;
			const failedAt = this.clock();
			const retryAt =
				known?.options.retryable === false
					? undefined
					: new Date(failedAt.getTime() + this.retryDelayMs);
			const persisted = await this.repository.markFailed({
				claimToken: claim.claimToken,
				code: known?.code ?? "CORE_GENERATION_WORKER_FAILED",
				id: claim.id,
				message:
					error instanceof Error ? error.message : "Unknown worker failure.",
				now: failedAt,
				...(retryAt ? { retryAt } : {}),
			});
			return {
				claimId: claim.id,
				persisted,
				status: retryAt ? ("retry" as const) : ("failed" as const),
			};
		}
	}
}

interface OutboxRow extends QueryResultRow {
	id: string;
	workspace_id: string;
	local_job_id: string;
	source: CanvasGenerationOutboxSource;
	payload: CoreGenerationSubmitInput;
	attempt_count: number;
	claim_token: string;
}

function claimFromRow(row: OutboxRow): CanvasGenerationOutboxClaim {
	return {
		attemptCount: row.attempt_count,
		claimToken: row.claim_token,
		id: row.id,
		localJobId: row.local_job_id,
		request: row.payload,
		source: row.source,
		workspaceId: row.workspace_id,
	};
}
