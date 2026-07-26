import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

export type NoteMediaAdmissionToken = {
	generation: number;
	jobId?: string;
	taskId: string;
	workflowId: string;
	workspaceId: string;
};

export interface NoteMediaAdmissionPort {
	claim(input: {
		taskId: string;
		workflowId: string;
		workspaceId: string;
	}): Promise<NoteMediaAdmissionToken | null>;
	markRunning(
		token: NoteMediaAdmissionToken,
		jobId: string,
	): Promise<boolean>;
	markTerminal(
		token: NoteMediaAdmissionToken,
		status: "completed" | "failed",
	): Promise<boolean>;
}

type ClaimRow = {
	generation: string;
	job_id: string | null;
	status: "claimed" | "completed" | "failed" | "running";
	workflow_id: string;
};

export class PostgresNoteMediaAdmissionCoordinator
	implements NoteMediaAdmissionPort
{
	constructor(private readonly pool: Pool) {}

	async migrate() {
		await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS harness_runtime;
      CREATE TABLE IF NOT EXISTS harness_runtime.note_media_admission_claims (
        workspace_id text NOT NULL,
        task_id text NOT NULL,
        workflow_id text NOT NULL,
        generation bigint NOT NULL CHECK (generation > 0),
        status text NOT NULL CHECK (status IN ('claimed', 'running', 'completed', 'failed')),
        job_id text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, task_id)
      );
    `);
	}

	async claim(input: {
		taskId: string;
		workflowId: string;
		workspaceId: string;
	}) {
		return this.locked(input, async (client) => {
			const current = await client.query<ClaimRow>(
				`SELECT workflow_id, generation::text, status, job_id
           FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2
          FOR UPDATE`,
				[input.workspaceId, input.taskId],
			);
			const row = current.rows[0];
			if (
				row &&
				(row.status === "claimed" || row.status === "running")
			) {
				return row.workflow_id === input.workflowId
					? token(input, Number(row.generation), row.job_id)
					: null;
			}
			const generation = row ? Number(row.generation) + 1 : 1;
			await client.query(
				`INSERT INTO harness_runtime.note_media_admission_claims
           (workspace_id, task_id, workflow_id, generation, status, job_id, updated_at)
         VALUES ($1, $2, $3, $4, 'claimed', NULL, now())
         ON CONFLICT (workspace_id, task_id) DO UPDATE
           SET workflow_id = EXCLUDED.workflow_id,
               generation = EXCLUDED.generation,
               status = 'claimed',
               job_id = NULL,
               updated_at = now()`,
				[input.workspaceId, input.taskId, input.workflowId, generation],
			);
			return token(input, generation, null);
		});
	}

	async markRunning(token: NoteMediaAdmissionToken, jobId: string) {
		const updated = await this.pool.query(
			`UPDATE harness_runtime.note_media_admission_claims
          SET status = 'running', job_id = $5, updated_at = now()
        WHERE workspace_id = $1
          AND task_id = $2
          AND workflow_id = $3
          AND generation = $4
          AND status IN ('claimed', 'running')
          AND (job_id IS NULL OR job_id = $5)`,
			[
				token.workspaceId,
				token.taskId,
				token.workflowId,
				token.generation,
				jobId,
			],
		);
		return updated.rowCount === 1;
	}

	async markTerminal(
		token: NoteMediaAdmissionToken,
		status: "completed" | "failed",
	) {
		const updated = await this.pool.query(
			`UPDATE harness_runtime.note_media_admission_claims
          SET status = $5, updated_at = now()
        WHERE workspace_id = $1
          AND task_id = $2
          AND workflow_id = $3
          AND generation = $4
          AND status IN ('claimed', 'running')`,
			[
				token.workspaceId,
				token.taskId,
				token.workflowId,
				token.generation,
				status,
			],
		);
		return updated.rowCount === 1;
	}

	private async locked<T>(
		input: { taskId: string; workspaceId: string },
		operation: (client: PoolClient) => Promise<T>,
	) {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
				createHash("sha256")
					.update(`${input.workspaceId}\0${input.taskId}`)
					.digest("hex"),
			]);
			const result = await operation(client);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
}

function token(
	input: { taskId: string; workflowId: string; workspaceId: string },
	generation: number,
	jobId: string | null,
): NoteMediaAdmissionToken {
	return {
		generation,
		...(jobId ? { jobId } : {}),
		taskId: input.taskId,
		workflowId: input.workflowId,
		workspaceId: input.workspaceId,
	};
}
