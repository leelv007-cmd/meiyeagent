import assert from "node:assert/strict";
import test from "node:test";
import {
	canvasCacheNamespace,
	clearSensitiveCanvasCaches,
} from "./cache-scope.js";

test("cache namespaces include user, workspace and schema version", () => {
	assert.equal(
		canvasCacheNamespace({
			userId: "user-1",
			workspaceId: "workspace-1",
			schemaVersion: 1,
		}),
		"canvas:v1:user-1:workspace-1",
	);
});

test("logout aborts in-flight work and clears sensitive browser stores", async () => {
	const calls: string[] = [];
	await clearSensitiveCanvasCaches({
		abortInFlight() {
			calls.push("abort");
		},
		broadcastLogout() {
			calls.push("broadcast");
		},
		async clearBlobCache() {
			calls.push("blob");
		},
		async clearIndexedDb() {
			calls.push("indexeddb");
		},
		async clearLocalForage() {
			calls.push("localforage");
		},
	});
	assert.deepEqual(calls, [
		"abort",
		"indexeddb",
		"localforage",
		"blob",
		"broadcast",
	]);
});
