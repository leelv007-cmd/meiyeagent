import assert from "node:assert/strict";
import test from "node:test";
import {
	removeCanvasTextStreamProgress,
	restoreCanvasNodeGenerationState,
	serializeCanvasNodeGenerationState,
	upsertCanvasTextStreamProgress,
} from "./node-generation-persistence.js";

test("node generation state restores frozen batch input and governed mention draft", () => {
	const state = restoreCanvasNodeGenerationState(
		{
			batchSnapshot: {
				batchKey: "canvas-ui-batch-1",
				confirmation: "aggregate-N-quotes-once",
				items: [],
				schemaVersion: 1,
				strategy: "fan-out",
				totalEstimatedProviderCost: {
					amountMicros: 10_000,
					currency: "CNY",
					unit: "request",
				},
			},
			resourceDraft: {
				mentions: [],
				operation: "video.generate",
				prompt: "生成活动预告",
				schemaVersion: 1,
			},
			schemaVersion: 1,
			textStreams: [
				{
					cursor: "12",
					jobId: "job-private-1",
					preview: "临时预览",
					sequence: 12,
					state: "disconnected",
					textNodeId: "generated-private-1",
				},
			],
		},
		"image.generate",
	);
	assert.equal(state.resourceDraft.operation, "video.generate");
	assert.equal(state.batchSnapshot?.batchKey, "canvas-ui-batch-1");
	assert.deepEqual(serializeCanvasNodeGenerationState(state).textStreams, [
		{
			cursor: "12",
			jobId: "job-private-1",
			preview: "临时预览",
			sequence: 12,
			state: "disconnected",
			textNodeId: "generated-private-1",
		},
	]);
});

test("text stream progress replaces the cursor in graph state and is cleared after durable text", () => {
	const initial = restoreCanvasNodeGenerationState(undefined, "text.respond");
	const streaming = upsertCanvasTextStreamProgress(initial, {
		cursor: "3",
		jobId: "job-private-2",
		preview: "前三个字",
		sequence: 3,
		state: "streaming",
		textNodeId: "generated-private-2",
	});
	const resumed = upsertCanvasTextStreamProgress(streaming, {
		cursor: "4",
		jobId: "job-private-2",
		preview: "前三个字更多",
		sequence: 4,
		state: "disconnected",
		textNodeId: "generated-private-2",
	});
	assert.deepEqual(resumed.textStreams, [
		{
			cursor: "4",
			jobId: "job-private-2",
			preview: "前三个字更多",
			sequence: 4,
			state: "disconnected",
			textNodeId: "generated-private-2",
		},
	]);
	assert.deepEqual(
		removeCanvasTextStreamProgress(resumed, "job-private-2").textStreams,
		[],
	);
});
