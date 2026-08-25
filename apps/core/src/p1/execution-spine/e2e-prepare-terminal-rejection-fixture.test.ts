/**
 * V31-108 AC3 fixture runner — must drive recoverPendingStarts / the
 * production helper, not a second terminate writer.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
	PREPARE_TERMINAL_REJECTION_FIXTURE_REASON,
	runE2ePrepareTerminalRejectionFixture,
} from "./e2e-prepare-terminal-rejection-fixture.js";
import { failCreationForPrepareTerminalRejection } from "./prepare-terminal-rejection.js";
import { prepareRejectedMerchantMessage } from "./stalled-work-sweeper.js";
import type {
	CreationSubmissionRecord,
	CreationSubmissionStore,
} from "./submission-coordinator.js";

function submission(
	workspaceId: string,
	id: string,
	workId: string,
): CreationSubmissionRecord {
	return {
		snapshot: { id, workspaceId },
		task: { id: `task-${id}` },
		work: { id: workId },
	} as unknown as CreationSubmissionRecord;
}

function recoveryStore(
	overrides: Partial<CreationSubmissionStore>,
): CreationSubmissionStore {
	const unavailable = async (): Promise<never> => {
		throw new Error("fixture test store method was not configured");
	};
	return {
		readReceipt: unavailable,
		claim: unavailable,
		persistAgentPlanning: unavailable,
		claimHarnessStart: unavailable,
		markHarnessStartDispatched: unavailable,
		completeHarnessStart: unavailable,
		releaseHarnessStart: unavailable,
		failHarnessStart: unavailable,
		listRecoverableHarnessStarts: unavailable,
		...overrides,
	};
}

test("V31-108 fixture recoverPendingStarts terminals via the production helper", async () => {
	const listCalls: Array<{ limit: number }> = [];
	const terminateCalls: Array<{
		reason: string;
		detail?: string;
		workId?: string;
	}> = [];
	const row = submission("ws-fix", "sub-fix", "work-fix");
	let workStatus = "running";
	let failureReason: string | null = null;
	const store = recoveryStore({
		async listRecoverableHarnessStarts(input) {
			listCalls.push({ limit: input.limit });
			return [{ submission: structuredClone(row) }];
		},
		async recordPrepareFailure(input) {
			return { attempts: 1, terminalized: input.terminal };
		},
		async terminateRunningWork(input) {
			terminateCalls.push({
				reason: input.reason,
				detail: input.detail,
				workId: input.workId,
			});
			workStatus = "failed";
			failureReason = input.reason;
			return "terminated";
		},
	});

	const outcome = await runE2ePrepareTerminalRejectionFixture({
		store,
		workspaceId: "ws-fix",
		workId: "work-fix",
		inspectWork: async () => ({
			status: workStatus,
			failureReason,
			failureCode:
				workStatus === "failed" ? "WORK_EXECUTION_STALLED" : null,
		}),
	});

	assert.equal(outcome.rejected, true);
	assert.equal(outcome.alreadyTerminal, undefined);
	assert.equal(listCalls.length, 1);
	assert.equal(terminateCalls.length, 1);
	assert.equal(terminateCalls[0]?.reason, "prepare_rejected");
	assert.notEqual(terminateCalls[0]?.reason, "timeout");
	assert.equal(
		terminateCalls[0]?.detail,
		PREPARE_TERMINAL_REJECTION_FIXTURE_REASON,
	);
	assert.equal(
		prepareRejectedMerchantMessage(terminateCalls[0]?.detail),
		prepareRejectedMerchantMessage(PREPARE_TERMINAL_REJECTION_FIXTURE_REASON),
	);
	assert.match(
		prepareRejectedMerchantMessage(terminateCalls[0]?.detail),
		/没能开始/u,
	);
	assert.doesNotMatch(
		prepareRejectedMerchantMessage(terminateCalls[0]?.detail),
		/超时/u,
	);
});

test("V31-108 fixture fails closed when terminateRunningWork is missing", async () => {
	const row = submission("ws-hang", "sub-hang", "work-hang");
	const store = recoveryStore({
		async listRecoverableHarnessStarts() {
			return [{ submission: structuredClone(row) }];
		},
		async recordPrepareFailure(input) {
			return { attempts: 1, terminalized: input.terminal };
		},
	});

	await assert.rejects(
		() =>
			runE2ePrepareTerminalRejectionFixture({
				store,
				workspaceId: "ws-hang",
				workId: "work-hang",
				inspectWork: async () => ({ status: "running" }),
			}),
		/terminateRunningWork is missing/u,
	);
});

test("V31-108 fixture reverse: skipping recoverPendingStarts leaves the work running", async () => {
	const terminateCalls: string[] = [];
	const store = recoveryStore({
		async listRecoverableHarnessStarts() {
			return [];
		},
		async terminateRunningWork(input) {
			terminateCalls.push(input.reason);
			return "missing";
		},
	});

	await assert.rejects(
		() =>
			runE2ePrepareTerminalRejectionFixture({
				store,
				workspaceId: "ws-skip",
				workId: "work-skip",
				inspectWork: async () => ({ status: "running" }),
			}),
		/status=running/u,
	);
	assert.deepEqual(terminateCalls, []);
});

test("V31-108 fixture second call is already_terminal and does not terminate again", async () => {
	const terminateCalls: string[] = [];
	const store = recoveryStore({
		async listRecoverableHarnessStarts() {
			throw new Error("already-terminal replay must not recover again");
		},
		async terminateRunningWork(input) {
			terminateCalls.push(input.reason);
			return "already_terminal";
		},
	});

	const outcome = await runE2ePrepareTerminalRejectionFixture({
		store,
		workspaceId: "ws-again",
		workId: "work-again",
		inspectWork: async () => ({
			status: "failed",
			failureReason: "prepare_rejected",
			failureCode: "WORK_EXECUTION_STALLED",
		}),
	});

	assert.equal(outcome.rejected, true);
	assert.equal(outcome.alreadyTerminal, true);
	assert.deepEqual(terminateCalls, []);
	assert.equal(
		await failCreationForPrepareTerminalRejection(store, {
			workspaceId: "ws-again",
			workId: "work-again",
		}),
		"already_terminal",
	);
	assert.deepEqual(terminateCalls, ["prepare_rejected"]);
});
