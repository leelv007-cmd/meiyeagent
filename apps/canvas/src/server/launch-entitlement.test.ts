import assert from "node:assert/strict";
import test from "node:test";
import { canIssueProStudioLaunch } from "./launch-entitlement.js";

const input = {
	mainSessionId: "main-session",
	userId: "user-1",
	workspaceId: "workspace-1",
};

test("rejects launch issuance while Pro Studio is locked", async () => {
	const allowed = await canIssueProStudioLaunch(input, {
		async assertCanEnter() {
			throw new Error("locked");
		},
		async resolveRole() {
			return "owner";
		},
		async validateMainSession() {
			return true;
		},
	});

	assert.equal(allowed, false);
});

test("allows launch immediately after a verified entitlement is active", async () => {
	const allowed = await canIssueProStudioLaunch(input, {
		async assertCanEnter(context) {
			assert.equal(context.role, "owner");
			assert.equal(context.workspaceId, "workspace-1");
		},
		async resolveRole() {
			return "owner";
		},
		async validateMainSession() {
			return true;
		},
	});

	assert.equal(allowed, true);
});

test("fails closed for invalid sessions and unknown workspace roles", async () => {
	let roleLookups = 0;
	assert.equal(
		await canIssueProStudioLaunch(input, {
			async assertCanEnter() {},
			async resolveRole() {
				roleLookups += 1;
				return "owner";
			},
			async validateMainSession() {
				return false;
			},
		}),
		false,
	);
	assert.equal(roleLookups, 0);
	assert.equal(
		await canIssueProStudioLaunch(input, {
			async assertCanEnter() {},
			async resolveRole() {
				return null;
			},
			async validateMainSession() {
				return true;
			},
		}),
		false,
	);
});
