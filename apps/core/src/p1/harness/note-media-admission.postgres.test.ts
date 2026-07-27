import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";

import {
	NOTE_MEDIA_ADMISSION_CLAIM_TTL_SECONDS,
	PostgresNoteMediaAdmissionCoordinator,
} from "./note-media-admission.js";

const connectionString = process.env.TEST_DATABASE_URL;

test(
	"note media admission uses a short claim lock and fences stale writers",
	{ skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
	async () => {
		const firstPool = new Pool({ connectionString });
		const secondPool = new Pool({ connectionString });
		const first = new PostgresNoteMediaAdmissionCoordinator(firstPool);
		const second = new PostgresNoteMediaAdmissionCoordinator(secondPool);
		const suffix = randomUUID();
		const taskId = `note-task-${suffix}`;
		const workspaceId = `note-workspace-${suffix}`;
		try {
			await first.migrate();
			const firstToken = await first.claim({
				taskId,
				workflowId: "workflow-page-1",
				workspaceId,
			});
			assert.ok(firstToken);

			const blocked = await Promise.race([
				second.claim({
					taskId,
					workflowId: "workflow-page-2",
					workspaceId,
				}),
				new Promise<"lock-held-too-long">((resolve) =>
					setTimeout(() => resolve("lock-held-too-long"), 500),
				),
			]);
			assert.equal(blocked, null);
			assert.equal(await first.markRunning(firstToken, "media-job-1"), true);

			const replay = await second.claim({
				taskId,
				workflowId: "workflow-page-1",
				workspaceId,
			});
			assert.deepEqual(replay, { ...firstToken, jobId: "media-job-1" });
			assert.equal(await first.markTerminal(firstToken, "completed"), true);

			const secondToken = await second.claim({
				taskId,
				workflowId: "workflow-page-2",
				workspaceId,
			});
			assert.equal(secondToken?.generation, firstToken.generation + 1);
			assert.equal(await first.markTerminal(firstToken, "failed"), false);

			const state = await secondPool.query<{
				generation: string;
				status: string;
				workflow_id: string;
			}>(
				`SELECT generation::text, status, workflow_id
           FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2`,
				[workspaceId, taskId],
			);
			assert.deepEqual(state.rows, [
				{
					generation: String(secondToken?.generation),
					status: "claimed",
					workflow_id: "workflow-page-2",
				},
			]);
		} finally {
			await firstPool.query(
				`DELETE FROM harness_runtime.note_media_admission_claims
          WHERE workspace_id = $1 AND task_id = $2`,
				[workspaceId, taskId],
			);
			await Promise.all([firstPool.end(), secondPool.end()]);
		}
	},
);

test(
	"an expired note media claim is taken over and fences the old generation",
	{ skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
	async () => {
		const firstPool = new Pool({ connectionString });
		const secondPool = new Pool({ connectionString });
		const first = new PostgresNoteMediaAdmissionCoordinator(firstPool);
		const second = new PostgresNoteMediaAdmissionCoordinator(secondPool);
		const suffix = randomUUID();
		const taskId = `note-expired-task-${suffix}`;
		const workspaceId = `note-expired-workspace-${suffix}`;
		try {
			await first.migrate();
			const oldToken = await first.claim({
				taskId,
				workflowId: "workflow-expired-old",
				workspaceId,
			});
			assert.ok(oldToken);
			await firstPool.query(
				`UPDATE harness_runtime.note_media_admission_claims
				    SET updated_at = now() - make_interval(secs => $3)
				  WHERE workspace_id = $1 AND task_id = $2`,
				[workspaceId, taskId, NOTE_MEDIA_ADMISSION_CLAIM_TTL_SECONDS + 1],
			);

			const takeover = await second.claim({
				taskId,
				workflowId: "workflow-expired-new",
				workspaceId,
			});
			assert.equal(takeover?.generation, oldToken.generation + 1);
			assert.equal(await first.markRunning(oldToken, "old-job"), false);
			assert.equal(await first.markTerminal(oldToken, "failed"), false);
			assert.equal(
				await second.markRunning(takeover!, "new-job"),
				true,
			);
		} finally {
			await firstPool.query(
				`DELETE FROM harness_runtime.note_media_admission_claims
				  WHERE workspace_id = $1 AND task_id = $2`,
				[workspaceId, taskId],
			);
			await Promise.all([firstPool.end(), secondPool.end()]);
		}
	},
);
