import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("production kernel surface imports the authorized VozebCanvas without its local store", () => {
	const source = readFileSync(
		join(process.cwd(), "src/kernel-host/kernel-canvas-surface.tsx"),
		"utf8",
	);

	assert.match(
		source,
		/src\/vendor\/vozeb\/app\/\(user\)\/canvas\/components\/vozeb-canvas/u,
	);
	assert.doesNotMatch(source, /use-canvas-store|localForage|localforage/u);
	// G23–G25 residual: merchant-safe hover chrome is host-ported (not dead vendor).
	assert.match(source, /ported\/kernel-node-hover-toolbar/u);
	assert.match(source, /onHoverStart=\{\(nodeId\) => keepHover\(nodeId\)\}/u);
	assert.match(source, /onHoverEnd=\{leaveHover\}/u);
});

test("CanvasShell uses the production persistence and bootstrap coordinators", () => {
	const source = readFileSync(
		join(process.cwd(), "src/client/canvas-shell.tsx"),
		"utf8",
	);

	assert.match(source, /new ProjectPersistenceAdapter\(callCanvas\)/u);
	assert.match(source, /projectIdFromAudience\(context\.audience\)/u);
	assert.match(source, /runAfterDirtyDraftFlush/u);
	assert.match(source, /cropOwnedImageAsset/u);
	assert.match(source, /applyAndPersistKernelGraph/u);
	assert.match(source, /onViewportChange=\{applyKernelViewport\}/u);
	assert.match(source, /<KernelCanvasSurface\s+key=\{selected\.id\}/u);
	assert.match(source, /<RuntimePanel\s+key=\{selected\?\.id/u);
	assert.doesNotMatch(source, /kernelGraph\.nodes\.length === 0/u);
	assert.doesNotMatch(
		source,
		/callCanvas(?:<[^>]+>)?\("(?:saveProjectDraft|loadProject|createCheckpoint|restoreRevision)"/u,
	);
	// K2 residual hygiene: top bar must not paint raw workspaceId.
	assert.match(source, /workspace-name">当前工作区</u);
	assert.doesNotMatch(source, /workspace-name">[^<]*\{context\.workspaceId\}/u);
});

test("RuntimePanel seed options omit internal fileName labels", () => {
	const source = readFileSync(
		join(process.cwd(), "src/client/runtime-panel.tsx"),
		"utf8",
	);

	assert.match(source, /\{seed\.group\} · \{seed\.id\}/u);
	assert.doesNotMatch(
		source,
		/\{seed\.group\} · \{seed\.id\} · \{seed\.fileName\}/u,
	);
});
