import assert from "node:assert/strict";
import test from "node:test";

import {
	DEFAULT_STALLED_WORK_TIMEOUT_MS,
	resolveStalledWorkTimeoutMs,
	type StalledWorkSweep,
	StalledWorkSweeper,
	type StalledWorkSweepStore,
	type StalledWorkTerminalReason,
	stalledWorkRefundOperationId,
} from "./stalled-work-sweeper.js";

const noJob: StalledWorkSweep = {
	workspaceId: "workspace-stall",
	submissionId: "submission-no-job",
	workId: "work-no-job",
	taskId: "task-no-job",
	window: "work_running_no_job",
};

const staleJob: StalledWorkSweep = {
	workspaceId: "workspace-stall",
	submissionId: "submission-stale-job",
	workId: "work-stale-job",
	taskId: "task-stale-job",
	window: "job_stale_no_progress",
};

test("timeout env injects a short value and rejects non-positive integers", () => {
	assert.equal(
		resolveStalledWorkTimeoutMs({}),
		DEFAULT_STALLED_WORK_TIMEOUT_MS,
	);
	assert.equal(
		resolveStalledWorkTimeoutMs({ STALLED_WORK_TIMEOUT_MS: "1500" }),
		1_500,
	);
	assert.throws(
		() => resolveStalledWorkTimeoutMs({ STALLED_WORK_TIMEOUT_MS: "0" }),
		/positive integer/u,
	);
});

test("refund operation id is stable per task so a second pass cannot double-credit", () => {
	assert.equal(
		stalledWorkRefundOperationId("task-1"),
		stalledWorkRefundOperationId("task-1"),
	);
	assert.notEqual(
		stalledWorkRefundOperationId("task-1"),
		stalledWorkRefundOperationId("task-2"),
	);
});

test("sweeper terminals both stall windows on an injected short clock", async () => {
	const store = new MemorySweepStore([noJob, staleJob]);
	const sweeper = new StalledWorkSweeper(store, {
		now: () => new Date("2026-08-13T00:20:00.000Z"),
		timeoutMs: 60_000,
	});

	assert.deepEqual(await sweeper.runOnce(), {
		claimed: 2,
		terminated: 2,
		alreadyTerminal: 0,
		failed: 0,
	});
	assert.deepEqual(store.terminated.map((item) => item.sweep.window).sort(), [
		"job_stale_no_progress",
		"work_running_no_job",
	]);
	assert.equal(store.claimInputs[0]?.expiresBefore, "2026-08-13T00:19:00.000Z");
});

test("a second sweep is a no-op once the work is already terminal", async () => {
	const store = new MemorySweepStore([noJob]);
	const sweeper = new StalledWorkSweeper(store, { timeoutMs: 1_000 });
	assert.equal((await sweeper.runOnce()).terminated, 1);
	store.queue = [noJob];
	assert.deepEqual(await sweeper.runOnce(), {
		claimed: 1,
		terminated: 0,
		alreadyTerminal: 1,
		failed: 0,
	});
	assert.equal(store.terminated.length, 1);
});

test("fresh work inside the timeout window is not claimed", async () => {
	const store = new MemorySweepStore([]);
	const sweeper = new StalledWorkSweeper(store, {
		now: () => new Date("2026-08-13T00:15:00.000Z"),
		timeoutMs: 15 * 60 * 1_000,
	});
	assert.deepEqual(await sweeper.runOnce(), {
		claimed: 0,
		terminated: 0,
		alreadyTerminal: 0,
		failed: 0,
	});
	assert.equal(store.claimInputs[0]?.expiresBefore, "2026-08-13T00:00:00.000Z");
});

class MemorySweepStore implements StalledWorkSweepStore {
	claimInputs: Array<{ expiresBefore: string; limit: number }> = [];
	terminated: Array<{ sweep: StalledWorkSweep; reason: string }> = [];
	private seen = new Set<string>();

	constructor(public queue: StalledWorkSweep[]) {}

	async claimBatch(input: { expiresBefore: string; limit: number }) {
		this.claimInputs.push(input);
		return this.queue.slice(0, input.limit);
	}

	async terminate(input: {
		sweep: StalledWorkSweep;
		reason: StalledWorkTerminalReason;
	}) {
		if (this.seen.has(input.sweep.workId)) return "already_terminal" as const;
		this.seen.add(input.sweep.workId);
		this.terminated.push({ sweep: input.sweep, reason: input.reason });
		return "terminated" as const;
	}
}
