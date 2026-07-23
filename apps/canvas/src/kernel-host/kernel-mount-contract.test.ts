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
	// K3 retouch callbacks stay host-owned; live provider evidence remains external.
	assert.match(source, /onAngleSelected/u);
	assert.match(source, /onMaskEditSelected/u);
	assert.match(source, /onReversePromptSelected/u);
	assert.match(source, /onUpscaleSelected/u);
	assert.match(source, /onSplitSelected/u);
	assert.match(source, />\s*局部编辑\s*</u);
	assert.match(source, />\s*AI多角度\s*</u);
	assert.match(source, />\s*反推提示词\s*</u);
	assert.match(source, /onUpscale=/u);
	assert.match(source, /onSplit=/u);
	assert.match(source, /data-image-preview/u);
	assert.match(source, /onViewImage=\{\(\) => openImagePreview\(node\)\}/u);
	assert.match(source, /canvasClipboardPayload/u);
	assert.match(source, /onRetryFrozenJob/u);
	assert.match(source, /if \(!onRetryFrozenJob\)/u);
	assert.match(source, /setSelectedConnectionId\(edge\.id\)/u);
	assert.doesNotMatch(source, /window\.confirm/u);
	assert.doesNotMatch(source, /status: "idle"/u);
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
	assert.match(source, /persistMaskOwnedImageAsset/u);
	assert.match(source, /upscaleOwnedImageAsset/u);
	assert.match(source, /splitOwnedImageAsset/u);
	assert.match(source, /loadSourceImageDataUrl/u);
	assert.match(source, /RetouchDialogs/u);
	assert.match(source, /RetouchQuoteDialog/u);
	assert.match(source, /buildRetouchGenerationInput/u);
	assert.match(source, /canvasGenerationSubmitPayload/u);
	assert.match(source, /createReversePromptConfig/u);
	assert.match(source, /isReversePromptConfigNode/u);
	assert.match(source, /openRetouchDialog\("angle"/u);
	assert.match(source, /openRetouchDialog\("crop"/u);
	assert.match(source, /openRetouchDialog\("mask"/u);
	assert.match(source, /openRetouchDialog\("upscale"/u);
	assert.match(source, /openRetouchDialog\("split"/u);
	assert.match(source, /requestReversePrompt/u);
	assert.match(source, /applyAndPersistKernelGraph/u);
	assert.match(source, /onViewportChange=\{applyKernelViewport\}/u);
	assert.match(source, /<KernelCanvasSurface\s+key=\{selected\.id\}/u);
	assert.match(source, /<RuntimePanel\s+key=\{.*selected\?\.id/su);
	assert.match(source, /<CanvasAssetPicker/u);
	assert.match(source, /onResourceDraftChange=\{saveResourceDraft\}/u);
	assert.match(source, /<CanvasNodeGenerationWorkbench/u);
	assert.match(
		source,
		/onResourceDraftChange=\{commitNodeGenerationResourceDraft\}/u,
	);
	assert.match(
		source,
		/prepareQuoteCheckpoint=\{createNodeGenerationCheckpoint\}/u,
	);
	assert.match(
		source,
		/await callCanvas<CanvasGenerationCatalog>\("getCatalog"\)/u,
	);
	assert.match(source, /streamCanvasTextGeneration/u);
	assert.match(source, /"getGenerationJob"/u);
	assert.match(source, /Deliberately no AbortSignal/u);
	assert.match(source, /applyTextStreamProgress/u);
	assert.match(source, /removeCanvasTextStreamProgress/u);
	assert.doesNotMatch(source, /setInterval\(/u);
	assert.match(source, /CanvasCursorPage<CanvasAssetListItem>/u);
	assert.doesNotMatch(
		source,
		/CanvasOwnedAsset|setAssets|assetLibraryRef|fileRef/u,
	);
	assert.doesNotMatch(source, /kernelGraph\.nodes\.length === 0/u);
	assert.doesNotMatch(
		source,
		/callCanvas(?:<[^>]+>)?\("(?:saveProjectDraft|loadProject|createCheckpoint|restoreRevision)"/u,
	);
	// K2/#168: title consumes only the server-owned display projection.
	assert.match(source, /getSessionContext/u);
	assert.match(source, /merchantSafeWorkspaceDisplayName/u);
	assert.match(source, /workspace-name">\{workspaceDisplayName\}/u);
	assert.doesNotMatch(source, /workspace-name">[^<]*\{context\.workspaceId\}/u);
	assert.doesNotMatch(source, /window\.(?:prompt|confirm)/u);
	assert.match(source, /<ProjectNameDialog/u);
	assert.match(source, /<DeleteProjectsDialog/u);
	assert.match(source, /CanvasAssetPicker.*resource-workflow-ui/su);
	assert.match(source, /serializeResourceDraft/u);
	assert.doesNotMatch(source, /CanvasOwnedAsset/u);
});

test("RuntimePanel uses the governed prompt catalog instead of local seed corpus", () => {
	const source = readFileSync(
		join(process.cwd(), "src/client/runtime-panel.tsx"),
		"utf8",
	);

	assert.match(source, /<PromptLibrary/u);
	assert.match(source, /"listPrompts"/u);
	assert.match(source, /<ResourceMentionComposer/u);
	assert.doesNotMatch(
		source,
		/CANVAS_PROMPT_SEEDS|prompt-seeds|selectedSeedId|seed\./u,
	);
	assert.doesNotMatch(source, /freezeCanvasGenerationInputs/u);
});

test("resource composer is a rich, governed @mention editor", () => {
	const source = readFileSync(
		join(process.cwd(), "src/client/resource-workflow-ui.tsx"),
		"utf8",
	);

	assert.match(source, /contentEditable/u);
	assert.match(source, /role="textbox"/u);
	assert.match(source, /mentionKeyboardAction/u);
	assert.match(source, /listbox/u);
	assert.doesNotMatch(source, /textareaRef|<textarea/u);
});

test("RuntimePanel uses the server target picker without exposing package or node identifiers", () => {
	const source = readFileSync(
		join(process.cwd(), "src/client/runtime-panel.tsx"),
		"utf8",
	);

	assert.match(source, /<AdoptionTargetPicker/u);
	assert.match(source, /requestPage=\{requestAdoptionTargetPage\}/u);
	assert.doesNotMatch(
		source,
		/targetPackageId|targetBaseVersionId|targetExpectedRevision/u,
	);
	assert.doesNotMatch(source, /selectedNodeIds\.join/u);
	assert.doesNotMatch(source, /画布连线输入：\{binding\.nodeId\}/u);
	assert.doesNotMatch(source, />\s*\{node\.nodeId\}\s*<\/option>/u);
	assert.doesNotMatch(source, /affectedAssetIds\.join/u);
	assert.doesNotMatch(
		source,
		/\{adoption\.packageId\}\s*·\s*\{adoption\.versionId\}/u,
	);
});
