import assert from "node:assert/strict";
import test from "node:test";
import {
	applyAndPersistKernelGraph,
	applyCanvasBootstrapAppearance,
	kernelInsertPosition,
	projectIdFromAudience,
	runAfterDirtyDraftFlush,
	warnBeforeCanvasUnload,
} from "./canvas-shell-coordinator.js";

test("new kernel nodes use a non-overlapping grid", () => {
	assert.deepEqual(kernelInsertPosition(0), { x: 80, y: 80 });
	assert.deepEqual(kernelInsertPosition(1), { x: 340, y: 80 });
	assert.deepEqual(kernelInsertPosition(3), { x: 80, y: 300 });
	assert.deepEqual(kernelInsertPosition(4), { x: 340, y: 300 });
});

test("derived graph mutations are applied before the server draft is persisted", async () => {
	const calls: string[] = [];
	const graph = { id: "derived-graph" };
	const saved = await applyAndPersistKernelGraph({
		applyGraph(next) {
			assert.equal(next, graph);
			calls.push("apply");
		},
		graph,
		persistDraft: async () => {
			calls.push("persist");
			return "saved";
		},
	});

	assert.equal(saved, "saved");
	assert.deepEqual(calls, ["apply", "persist"]);
});

test("bootstrap appearance applies locale and an explicit theme", () => {
	const applied: string[] = [];
	const cleanup = applyCanvasBootstrapAppearance(
		{ locale: "en-US", theme: "light" },
		{
			applyLanguage: (locale) => applied.push(`locale:${locale}`),
			applyTheme: (theme) => applied.push(`theme:${theme}`),
			prefersDark: () => true,
			subscribeToSystemTheme: () => () => undefined,
		},
	);

	assert.deepEqual(applied, ["locale:en-US", "theme:light"]);
	cleanup();
});

test("bootstrap appearance follows system theme changes", () => {
	const applied: string[] = [];
	let listener: (() => void) | undefined;
	let dark = false;
	const cleanup = applyCanvasBootstrapAppearance(
		{ locale: "zh-CN", theme: "system" },
		{
			applyLanguage: (locale) => applied.push(`locale:${locale}`),
			applyTheme: (theme) => applied.push(`theme:${theme}`),
			prefersDark: () => dark,
			subscribeToSystemTheme: (next) => {
				listener = next;
				return () => applied.push("unsubscribed");
			},
		},
	);

	dark = true;
	listener?.();
	cleanup();
	assert.deepEqual(applied, [
		"locale:zh-CN",
		"theme:light",
		"theme:dark",
		"unsubscribed",
	]);
});

test("project audience selects its project while workspace audience stays neutral", () => {
	assert.equal(
		projectIdFromAudience({ kind: "project", projectId: "project-1" }),
		"project-1",
	);
	assert.equal(projectIdFromAudience({ kind: "workspace" }), null);
});

test("project actions flush a dirty server draft before running", async () => {
	const calls: string[] = [];
	await runAfterDirtyDraftFlush({
		action: async () => calls.push("action"),
		flushDraft: async () => calls.push("flush"),
		isDirty: () => true,
	});
	assert.deepEqual(calls, ["flush", "action"]);
});

test("project actions do not flush a clean draft", async () => {
	const calls: string[] = [];
	await runAfterDirtyDraftFlush({
		action: async () => calls.push("action"),
		flushDraft: async () => calls.push("flush"),
		isDirty: () => false,
	});
	assert.deepEqual(calls, ["action"]);
});

test("beforeunload warning blocks only a dirty canvas draft", () => {
	let prevented = 0;
	const cleanEvent = {
		preventDefault: () => {
			prevented += 1;
		},
		returnValue: "unchanged",
	};
	assert.equal(warnBeforeCanvasUnload(false, cleanEvent), false);
	assert.equal(cleanEvent.returnValue, "unchanged");

	const dirtyEvent = {
		preventDefault: () => {
			prevented += 1;
		},
		returnValue: "unchanged",
	};
	assert.equal(warnBeforeCanvasUnload(true, dirtyEvent), true);
	assert.equal(dirtyEvent.returnValue, "");
	assert.equal(prevented, 1);
});
