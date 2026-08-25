/**
 * E2E-only prepare-terminal-rejection injector. Absent from production
 * assemblies. Aims CreationSubmissionCoordinator.recoverPendingStarts at one
 * work so prepare() throws PrepareTerminalRejectionError — the same path as
 * the V31-108 postgres proof, not a second terminate writer.
 */
import type { Pool } from "pg";

import {
	CreationSubmissionCoordinator,
	PrepareTerminalRejectionError,
	type CreationSubmissionRecord,
	type CreationSubmissionStore,
} from "./submission-coordinator.js";
import { STALLED_WORK_FAILURE_CODE } from "./stalled-work-sweeper.js";

export const PREPARE_TERMINAL_REJECTION_FIXTURE_REASON =
	"这次的创作方案无法按当前要求开始";

export type PrepareTerminalRejectionWorkInspection = {
	status: string;
	failureReason?: string | null;
	failureCode?: string | null;
};

export type PrepareTerminalRejectionFixtureStore = CreationSubmissionStore & {
	refundPrepareTerminalReservation?(
		submission: CreationSubmissionRecord,
	): Promise<void>;
};

export type PrepareTerminalRejectionFixtureOutcome = {
	rejected: true;
	alreadyTerminal?: true;
};

export async function runE2ePrepareTerminalRejectionFixture(input: {
	store: PrepareTerminalRejectionFixtureStore;
	workspaceId: string;
	workId: string;
	inspectWork: () => Promise<PrepareTerminalRejectionWorkInspection | null>;
	forceRecoverablePendingPrepare?: () => Promise<void>;
}): Promise<PrepareTerminalRejectionFixtureOutcome> {
	const before = await input.inspectWork();
	if (!before) {
		throw new Error(
			`Prepare-terminal-rejection work ${input.workId} was not found.`,
		);
	}
	if (
		before.status === "failed" &&
		before.failureReason === "prepare_rejected"
	) {
		return { rejected: true, alreadyTerminal: true };
	}
	if (before.status !== "running") {
		throw new Error(
			`Prepare-terminal-rejection fixture left ${input.workId} at status=${before.status}.`,
		);
	}

	await input.forceRecoverablePendingPrepare?.();

	const aimed = aimRecoverableStartsAtWork(
		input.store,
		input.workspaceId,
		input.workId,
	);
	const coordinator = new CreationSubmissionCoordinator(
		aimed,
		{
			async start() {
				throw new Error("start must not run after prepare terminalizes");
			},
		},
		{
			createId(prefix) {
				return `e2e-prepare-terminal-${prefix}`;
			},
			now() {
				return new Date().toISOString();
			},
		},
		{
			async admit() {
				throw new Error("Recovery must not run a new-submission admission.");
			},
		},
		undefined,
		{
			async prepare() {
				throw new PrepareTerminalRejectionError(
					PREPARE_TERMINAL_REJECTION_FIXTURE_REASON,
				);
			},
		},
	);

	const refund = input.store.refundPrepareTerminalReservation;
	const canReconcile =
		typeof input.store.claimPrepareTerminalRefunds === "function" &&
		typeof input.store.completePrepareTerminalRefund === "function" &&
		typeof input.store.recordPrepareTerminalRefundFailure === "function" &&
		typeof refund === "function";

	await coordinator.recoverPendingStarts(
		100,
		canReconcile
			? {
					onPrepareTerminalRefund: async (record) => {
						await refund!.call(input.store, record);
					},
				}
			: undefined,
	);

	const after = await input.inspectWork();
	const status = after?.status ?? "missing";
	const reason = after?.failureReason ?? null;
	const code = after?.failureCode ?? null;
	if (
		status !== "failed" ||
		reason !== "prepare_rejected" ||
		code !== STALLED_WORK_FAILURE_CODE
	) {
		throw new Error(
			`Prepare-terminal-rejection fixture left ${input.workId} at status=${status} reason=${reason} code=${code}.`,
		);
	}
	return { rejected: true };
}

export function createE2ePrepareTerminalRejectionRunner(input: {
	pool: Pool;
	store: PrepareTerminalRejectionFixtureStore;
}) {
	return {
		async reject(request: { workspaceId: string; workId: string }) {
			return runE2ePrepareTerminalRejectionFixture({
				store: input.store,
				workspaceId: request.workspaceId,
				workId: request.workId,
				inspectWork: () =>
					inspectPostgresWork(
						input.pool,
						request.workspaceId,
						request.workId,
					),
				forceRecoverablePendingPrepare: () =>
					forcePostgresRecoverablePendingPrepare(
						input.pool,
						request.workspaceId,
						request.workId,
					),
			});
		},
	};
}

function aimRecoverableStartsAtWork(
	store: PrepareTerminalRejectionFixtureStore,
	workspaceId: string,
	workId: string,
): CreationSubmissionStore {
	const isTarget = (submission: CreationSubmissionRecord) =>
		submission.snapshot.workspaceId === workspaceId &&
		submission.work?.id === workId;

	return new Proxy(store, {
		get(target, prop, receiver) {
			if (prop === "listRecoverableHarnessStarts") {
				return async (query: {
					limit: number;
					perWorkspaceLimit?: number;
				}) => {
					const rows = await target.listRecoverableHarnessStarts(query);
					return rows.filter((row) => isTarget(row.submission));
				};
			}
			if (prop === "claimPrepareTerminalRefunds") {
				const claim = target.claimPrepareTerminalRefunds;
				if (typeof claim !== "function") return undefined;
				return async (query: { limit: number; leaseMs: number }) => {
					const rows = await claim.call(target, query);
					return rows.filter((row) => isTarget(row.submission));
				};
			}
			if (prop === "expireUndispatchedConfirmationHolds") {
				if (typeof target.expireUndispatchedConfirmationHolds !== "function") {
					return undefined;
				}
				return async () => 0;
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}

async function inspectPostgresWork(
	pool: Pool,
	workspaceId: string,
	workId: string,
): Promise<PrepareTerminalRejectionWorkInspection | null> {
	const work = await pool.query<{
		status: string | null;
		reason: string | null;
		code: string | null;
	}>(
		`SELECT payload->>'status' AS status,
		        payload->>'failureReason' AS reason,
		        payload->>'failureCode' AS code
		   FROM p1_creative_works
		  WHERE workspace_id = $1 AND id = $2`,
		[workspaceId, workId],
	);
	const row = work.rows[0];
	if (!row) return null;
	return {
		status: row.status ?? "missing",
		failureReason: row.reason,
		failureCode: row.code,
	};
}

async function forcePostgresRecoverablePendingPrepare(
	pool: Pool,
	workspaceId: string,
	workId: string,
): Promise<void> {
	const updated = await pool.query<{ id: string }>(
		`UPDATE execution_spine.creation_submissions
		    SET harness_state = 'reserved',
		        harness_lease_id = NULL,
		        harness_lease_expires_at = NULL,
		        harness_started_lease_id = NULL,
		        harness_start_attempts = 0,
		        submission = (
		          submission
		          - 'agentBinding'
		          - 'executionPlanFreeze'
		          - 'executionPlanFreezes'
		          - 'agentPlanPending'
		          - 'confirmationDispatch'
		        ),
		        updated_at = clock_timestamp() - interval '10 seconds'
		  WHERE workspace_id = $1
		    AND (work_id = $2 OR submission->'work'->>'id' = $2)
		  RETURNING id`,
		[workspaceId, workId],
	);
	if ((updated.rowCount ?? 0) < 1) {
		throw new Error(
			`Prepare-terminal-rejection submission was not found for ${workId}.`,
		);
	}
}
