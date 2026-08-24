import assert from "node:assert/strict";
import test from "node:test";

import { failCreationForPrepareTerminalRejection } from "./prepare-terminal-rejection.js";

test("V31-108 helper fails closed when terminateRunningWork is missing", async () => {
	await assert.rejects(
		() =>
			failCreationForPrepareTerminalRejection(
				{},
				{ workspaceId: "ws-1", taskId: "task-1" },
			),
		/terminateRunningWork is missing/u,
	);
});

test("V31-108 helper terminals with prepare_rejected and never timeout", async () => {
	const calls: Array<{ reason: string; detail?: string }> = [];
	const outcome = await failCreationForPrepareTerminalRejection(
		{
			async terminateRunningWork(input) {
				calls.push({ reason: input.reason, detail: input.detail });
				return "terminated";
			},
		},
		{
			workspaceId: "ws-1",
			taskId: "task-1",
			detail: "这次的创作方案无法按当前要求开始",
		},
	);
	assert.equal(outcome, "terminated");
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.reason, "prepare_rejected");
	assert.notEqual(calls[0]?.reason, "timeout");
	assert.equal(calls[0]?.detail, "这次的创作方案无法按当前要求开始");
});
