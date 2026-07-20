import assert from "node:assert/strict";
import test from "node:test";
import {
	buildAdoptionInput,
	buildAdoptionSelection,
	parseAdoptionResult,
} from "./adoption-adapter.js";

const nodes = [
	{
		data: { text: "美业文案" },
		id: "text-1",
		type: "text",
	},
	{
		data: { assetId: "asset-img-1", jobId: "job-img-1" },
		id: "img-1",
		type: "image",
	},
	{
		data: { assetId: "asset-img-2", jobId: "job-img-2" },
		id: "img-2",
		type: "image",
	},
	{
		data: {},
		id: "img-empty",
		type: "image",
	},
	{
		data: { assetId: "asset-vid", jobId: "job-vid" },
		id: "vid-1",
		type: "video",
	},
];

test("buildAdoptionSelection rejects selected media without a canonical job", () => {
	assert.throws(
		() =>
			buildAdoptionSelection(
				["img-no-job"],
				[
					{
						data: { assetId: "asset-img-no-job" },
						id: "img-no-job",
						type: "image",
					},
				],
			),
		/ADOPTION_SELECTION_CANONICAL_JOB_REQUIRED/,
	);
});

test("buildAdoptionSelection rejects audio nodes", () => {
	assert.throws(
		() =>
			buildAdoptionSelection(
				["audio-1"],
				[
					{
						data: { assetId: "asset-audio-1", jobId: "job-audio-1" },
						id: "audio-1",
						type: "audio",
					},
				],
			),
		/ADOPTION_SELECTION_AUDIO_UNSUPPORTED/,
	);
});

test("buildAdoptionSelection rejects mixed image and video media", () => {
	assert.throws(
		() => buildAdoptionSelection(["img-1", "vid-1"], nodes),
		/ADOPTION_SELECTION_MEDIA_MIXED/,
	);
});

test("buildAdoptionInput requires text for image adoption", () => {
	assert.throws(
		() =>
			buildAdoptionInput({
				expectedDraftVersion: 1,
				nodes,
				projectId: "proj-1",
				selectedNodeIds: ["img-1"],
			}),
		/ADOPTION_SELECTION_TEXT_REQUIRED/,
	);
});

test("buildAdoptionInput treats whitespace-only text as empty", () => {
	assert.throws(
		() =>
			buildAdoptionInput({
				expectedDraftVersion: 1,
				nodes: [
					{ data: { text: "   " }, id: "text-empty", type: "text" },
					{
						data: { assetId: "asset-img-1", jobId: "job-img-1" },
						id: "img-1",
						type: "image",
					},
				],
				projectId: "proj-1",
				selectedNodeIds: ["text-empty", "img-1"],
			}),
		/ADOPTION_SELECTION_TEXT_REQUIRED/,
	);
});

test("buildAdoptionInput rejects text in a video adoption", () => {
	assert.throws(
		() =>
			buildAdoptionInput({
				expectedDraftVersion: 1,
				nodes,
				projectId: "proj-1",
				selectedNodeIds: ["text-1", "vid-1"],
			}),
		/ADOPTION_SELECTION_VIDEO_TEXT_UNSUPPORTED/,
	);
});

test("buildAdoptionSelection keeps the ordered kernel selection", () => {
	const selection = buildAdoptionSelection(["img-2", "text-1", "img-1"], nodes);
	assert.deepEqual(selection, {
		orderedMediaNodeIds: ["img-2", "img-1"],
		textNodeId: "text-1",
	});
});

test("buildAdoptionInput freezes current draft with ordered media + text", () => {
	const input = buildAdoptionInput({
		expectedDraftVersion: 7,
		nodes,
		projectId: "proj-1",
		selectedNodeIds: ["text-1", "img-1", "img-2"],
	});
	assert.deepEqual(input, {
		projectId: "proj-1",
		revisionRef: {
			expectedDraftVersion: 7,
			kind: "freeze_current_draft",
		},
		selection: {
			orderedMediaNodeIds: ["img-1", "img-2"],
			textNodeId: "text-1",
		},
		target: { kind: "new_package" },
	});
});

test("buildAdoptionInput supports existing package target", () => {
	const input = buildAdoptionInput({
		expectedDraftVersion: 2,
		nodes,
		projectId: "proj-1",
		selectedNodeIds: ["text-1", "img-1"],
		target: {
			baseVersionId: "ver-1",
			expectedRevision: 0,
			kind: "existing_package",
			packageId: "pkg-1",
		},
	});
	assert.equal(input.target.kind, "existing_package");
	if (input.target.kind === "existing_package") {
		assert.equal(input.target.packageId, "pkg-1");
		assert.equal(input.target.baseVersionId, "ver-1");
	}
});

test("buildAdoptionInput rejects empty media selection", () => {
	assert.throws(
		() =>
			buildAdoptionInput({
				expectedDraftVersion: 1,
				nodes,
				projectId: "proj-1",
				selectedNodeIds: ["text-1"],
			}),
		/ADOPTION_SELECTION_EMPTY/,
	);
});

test("parseAdoptionResult extracts package projection fields", () => {
	assert.deepEqual(
		parseAdoptionResult({
			orderedMediaNodeIds: ["img-1"],
			packageId: "pkg-9",
			projectId: "proj-1",
			revisionId: "rev-3",
			selectedNodeIds: ["text-1", "img-1"],
			versionId: "ver-2",
		}),
		{
			orderedMediaNodeIds: ["img-1"],
			packageId: "pkg-9",
			projectId: "proj-1",
			revisionId: "rev-3",
			selectedNodeIds: ["text-1", "img-1"],
			versionId: "ver-2",
		},
	);
});

test("parseAdoptionResult rejects invalid payloads", () => {
	assert.throws(() => parseAdoptionResult(null), /ADOPTION_RESULT_INVALID/);
	assert.throws(
		() => parseAdoptionResult({ packageId: "only" }),
		/ADOPTION_RESULT_INVALID/,
	);
});
