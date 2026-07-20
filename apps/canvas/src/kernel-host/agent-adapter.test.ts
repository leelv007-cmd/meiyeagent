import assert from "node:assert/strict";
import test from "node:test";
import {
	AgentAdapter,
	applyAgentAndRefreshAudit,
	assertNoLocalAgentBridge,
	createAgentOperationConfirmationState,
	isAgentPlanFullyConfirmed,
	mapAgentApplyError,
	rejectAgentPlan,
	setAgentOperationConfirmed,
} from "./agent-adapter.js";

test("agent plan requires every operation to be confirmed and can be rejected", () => {
	const initial = createAgentOperationConfirmationState(2);
	assert.equal(isAgentPlanFullyConfirmed(initial), false);

	const firstConfirmed = setAgentOperationConfirmed(initial, 0, true);
	assert.equal(isAgentPlanFullyConfirmed(firstConfirmed), false);
	assert.deepEqual(initial.confirmed, [false, false]);

	const allConfirmed = setAgentOperationConfirmed(firstConfirmed, 1, true);
	assert.equal(isAgentPlanFullyConfirmed(allConfirmed), true);
	assert.deepEqual(rejectAgentPlan(allConfirmed), {
		confirmed: [false, false],
		rejected: true,
	});
});

test("applyAgentAndRefreshAudit refreshes audit after an apply conflict", async () => {
	const calls: string[] = [];
	const outcome = await applyAgentAndRefreshAudit(
		{
			async apply(_input, options) {
				calls.push(`apply:${options?.idempotencyKey}`);
				throw Object.assign(new Error("stale"), {
					code: "REVISION_CONFLICT",
				});
			},
			async listAudit() {
				calls.push("audit");
				return [{ id: "audit-error" }];
			},
		},
		{
			credentialId: "cred-1",
			expectedRevision: 4,
			projectId: "proj-1",
		},
		{ idempotencyKey: "intent-apply" },
	);

	assert.deepEqual(calls, ["apply:intent-apply", "audit"]);
	assert.equal(outcome.outcome, "failed");
	assert.equal(outcome.result, null);
	assert.deepEqual(outcome.audit, [{ id: "audit-error" }]);
	assert.equal(outcome.failure?.code, "REVISION_CONFLICT");
});

test("applyAgentAndRefreshAudit preserves apply success when audit refresh fails", async () => {
	const outcome = await applyAgentAndRefreshAudit(
		{
			async apply() {
				return { revision: 5, status: "changed" as const };
			},
			async listAudit() {
				throw new Error("audit unavailable");
			},
		},
		{
			credentialId: "cred-1",
			expectedRevision: 4,
			projectId: "proj-1",
		},
	);

	assert.equal(outcome.outcome, "applied");
	assert.deepEqual(outcome.result, { revision: 5, status: "changed" });
	assert.equal(outcome.failure, null);
	assert.equal(outcome.audit, null);
	assert.equal(outcome.auditWarning, "审计记录暂时无法刷新，请稍后重试。");
});

test("mapAgentApplyError localizes stale confirmation conflicts", () => {
	assert.deepEqual(mapAgentApplyError({ code: "REVISION_CONFLICT" }), {
		code: "REVISION_CONFLICT",
		discardCredential: true,
		message: "画布版本已经变化。旧确认凭据已失效，请重新加载工程并生成新计划。",
		requiresReloadAndReplan: true,
	});
	assert.deepEqual(mapAgentApplyError({ code: "READ_SET_CHANGED" }), {
		code: "READ_SET_CHANGED",
		discardCredential: true,
		message: "计划依赖的素材、权限或额度已经变化。请重新加载工程并生成新计划。",
		requiresReloadAndReplan: true,
	});
});

test("AgentAdapter plan/confirm/apply call BackendPort actions", async () => {
	const calls: Array<{
		action: string;
		input?: Record<string, unknown>;
		options?: { idempotencyKey?: string };
	}> = [];
	const adapter = new AgentAdapter(async (action, input, options) => {
		calls.push({ action, input, options });
		if (action === "planAgent") return { id: "plan-1" } as never;
		if (action === "confirmAgent") return { credentialId: "cred-1" } as never;
		if (action === "applyAgentOps") return { status: "executed" } as never;
		return null as never;
	});

	await adapter.plan(
		{
			intent: "align selected nodes",
			maxCostMicros: 1000,
			maxGenerationCount: 2,
			projectId: "proj-1",
		},
		{ idempotencyKey: "intent-plan" },
	);
	await adapter.confirm(
		{ planId: "plan-1" },
		{ idempotencyKey: "intent-confirm" },
	);
	await adapter.apply(
		{
			credentialId: "cred-1",
			expectedRevision: 4,
			projectId: "proj-1",
		},
		{ idempotencyKey: "intent-apply" },
	);
	await adapter.listAudit("proj-1");

	assert.deepEqual(calls, [
		{
			action: "planAgent",
			input: {
				intent: "align selected nodes",
				maxCostMicros: 1000,
				maxGenerationCount: 2,
				projectId: "proj-1",
			},
			options: { idempotencyKey: "intent-plan" },
		},
		{
			action: "confirmAgent",
			input: { planId: "plan-1" },
			options: { idempotencyKey: "intent-confirm" },
		},
		{
			action: "applyAgentOps",
			input: {
				credentialId: "cred-1",
				expectedRevision: 4,
				projectId: "proj-1",
			},
			options: { idempotencyKey: "intent-apply" },
		},
		{
			action: "listAgentAudit",
			input: { projectId: "proj-1" },
			options: undefined,
		},
	]);
});

test("assertNoLocalAgentBridge throws on forbidden patterns", () => {
	assert.throws(
		() => assertNoLocalAgentBridge("const t = agentToken"),
		/Forbidden local agent bridge pattern: agentToken/i,
	);
	assert.throws(
		() => assertNoLocalAgentBridge(`localStorage.getItem("agent-session")`),
		/localStorage/,
	);
	assert.throws(
		() => assertNoLocalAgentBridge("import { shell } from 'canvas-agent'"),
		/canvas-agent/,
	);
	assert.throws(
		() => assertNoLocalAgentBridge("require('child_process')"),
		/child_process/,
	);
});

test("assertNoLocalAgentBridge allows clean BackendPort agent source", () => {
	assert.doesNotThrow(() =>
		assertNoLocalAgentBridge(`
      await callCanvas("planAgent", { intent, projectId, maxCostMicros, maxGenerationCount });
      await callCanvas("confirmAgent", { planId });
      await callCanvas("applyAgentOps", { credentialId, expectedRevision, projectId });
    `),
	);
});
