import assert from "node:assert/strict";
import test from "node:test";
import {
	CoreGenerationProvider,
	CoreGenerationProviderError,
	type CoreGenerationSubmitInput,
} from "./core-generation-provider";

const submission: CoreGenerationSubmitInput = {
	checkpointId: "revision-1",
	count: 1,
	correlationId: "corr-canvas-1",
	dataClass: ["contains_face"],
	idempotencyKey: "canvas-generation-key-1",
	inputAssets: [
		{ assetId: "asset-input-1", role: "reference_image" },
		{ assetId: "asset-input-1", role: "reference_image" },
	],
	inputNodeBindings: [
		{
			assetId: "asset-input-1",
			nodeId: "image-input-1",
			role: "reference_image",
		},
		{
			assetId: "asset-input-1",
			nodeId: "image-input-1",
			role: "reference_image",
		},
	],
	itemId: "item-1",
	modelId: "image-model-1",
	operation: "image.generate",
	parameters: { height: 1024, width: 768 },
	projectId: "project-1",
	prompt: "Create a beauty campaign poster",
	quoteId: "quote-1",
	revisionId: "revision-1",
	userId: "user-a",
	workspaceId: "workspace/a",
};

test("submits a Canvas generation through the authoritative Core model-supply command", async () => {
	const requests: Array<{ init?: RequestInit; url: string }> = [];
	const provider = new CoreGenerationProvider({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100/root/ignored",
		fetcher: async (input, init) => {
			requests.push({ init, url: input.toString() });
			return jsonResponse(200, {
				data: {
					jobId: "core-job-1",
					providerCost: { amount: 12, currency: "CNY", status: "observed" },
					status: "unknown",
					usage: { id: "usage-1", quantity: 1, status: "reserved" },
				},
				meta: { correlationId: submission.correlationId },
			});
		},
	});

	const result = await provider.submit(submission);

	assert.equal(result.jobId, "core-job-1");
	assert.equal(result.status, "unknown");
	assert.equal(requests.length, 1);
	assert.equal(
		requests[0]?.url,
		"http://core.internal:4100/v1/workspaces/workspace%2Fa/p1/commands",
	);
	const headers = new Headers(requests[0]?.init?.headers);
	assert.equal(headers.get("x-service-token"), "service-secret");
	assert.equal(headers.get("x-core-actor"), "worker");
	assert.equal(headers.get("x-user-id"), "user-a");
	assert.equal(headers.get("x-workspace-id"), "workspace/a");
	assert.equal(headers.get("x-correlation-id"), "corr-canvas-1");
	assert.equal(headers.get("idempotency-key"), "canvas-generation-key-1");
	assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
		action: "canvas_generation_submit",
		module: "model-supply",
		payload: {
			checkpointId: "revision-1",
			count: 1,
			dataClass: ["contains_face"],
			inputAssets: [{ assetId: "asset-input-1", role: "reference_image" }],
			inputNodeBindings: [
				{
					assetId: "asset-input-1",
					nodeId: "image-input-1",
					role: "reference_image",
				},
			],
			itemId: "item-1",
			modelId: "image-model-1",
			operation: "image.generate",
			parameters: { height: 1024, width: 768 },
			projectId: "project-1",
			prompt: "Create a beauty campaign poster",
			quoteId: "quote-1",
			revisionId: "revision-1",
		},
	});
});

test("queries, retries, and cancels the Core job without substituting the Canvas job id", async () => {
	const requests: Array<{ init?: RequestInit; url: string }> = [];
	const provider = new CoreGenerationProvider({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async (input, init) => {
			requests.push({ init, url: input.toString() });
			return jsonResponse(200, {
				data: { jobId: "core-job-1", status: "cancel_requested" },
			});
		},
	});

	await provider.getJob({
		correlationId: "corr-query",
		jobId: "core-job-1",
		projectId: "project-1",
		userId: "user-a",
		workspaceId: "workspace-a",
	});
	await provider.retry({
		correlationId: "corr-retry",
		idempotencyKey: "retry-key-1",
		jobId: "core-job-1",
		projectId: "project-1",
		userId: "user-a",
		workspaceId: "workspace-a",
	});
	await provider.cancel({
		correlationId: "corr-cancel",
		idempotencyKey: "cancel-key-1",
		jobId: "core-job-1",
		projectId: "project-1",
		userId: "user-a",
		workspaceId: "workspace-a",
	});

	assert.equal(requests[0]?.url.endsWith("/p1/query"), true);
	assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
		action: "canvas_generation_job",
		module: "model-supply",
		payload: { jobId: "core-job-1", projectId: "project-1" },
	});
	assert.equal(requests[1]?.url.endsWith("/p1/commands"), true);
	assert.equal(
		new Headers(requests[1]?.init?.headers).get("idempotency-key"),
		"retry-key-1",
	);
	assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
		action: "canvas_generation_retry",
		module: "model-supply",
		payload: { jobId: "core-job-1", projectId: "project-1" },
	});
	assert.equal(
		new Headers(requests[2]?.init?.headers).get("idempotency-key"),
		"cancel-key-1",
	);
	assert.deepEqual(JSON.parse(String(requests[2]?.init?.body)), {
		action: "canvas_generation_cancel",
		module: "model-supply",
		payload: { jobId: "core-job-1", projectId: "project-1" },
	});
});

test("uses fixed catalog, quote, and project-list facade actions", async () => {
	const actions: string[] = [];
	const provider = new CoreGenerationProvider({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async (_input, init) => {
			const body = JSON.parse(String(init?.body));
			actions.push(body.action);
			return jsonResponse(200, { data: {} });
		},
	});
	await provider.getCatalog(submission);
	await provider.quote(submission);
	await provider.listProjectGenerations({
		...submission,
		projectId: "project-1",
	});
	assert.deepEqual(actions, [
		"canvas_generation_catalog",
		"canvas_generation_quote",
		"canvas_generation_jobs",
	]);
});

test("submits fixed text.respond without disguising it as copy generation", async () => {
	const requests: Array<{ init?: RequestInit; url: string }> = [];
	const provider = new CoreGenerationProvider({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async (input, init) => {
			requests.push({ init, url: input.toString() });
			return jsonResponse(200, {
				data: {
					jobId: "core-text-job-1",
					status: "completed",
					text: "A concise reverse prompt.",
				},
			});
		},
	});

	const result = await provider.submit({
		...submission,
		inputAssets: [],
		inputNodeBindings: [],
		modelId: "llm-openai",
		operation: "text.respond",
		parameters: {},
		prompt: "Describe this campaign direction",
	});

	assert.equal(result.jobId, "core-text-job-1");
	assert.equal(result.text, "A concise reverse prompt.");
	assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
		action: "canvas_generation_submit",
		module: "model-supply",
		payload: {
			checkpointId: "revision-1",
			count: 1,
			dataClass: ["contains_face"],
			inputAssets: [],
			inputNodeBindings: [],
			itemId: "item-1",
			modelId: "llm-openai",
			operation: "text.respond",
			parameters: {},
			projectId: "project-1",
			prompt: "Describe this campaign direction",
			quoteId: "quote-1",
			revisionId: "revision-1",
		},
	});
});

test("preserves multimodal roles and advanced parameters for Core capability validation", async () => {
	const requests: Record<string, unknown>[] = [];
	const provider = new CoreGenerationProvider({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async (_input, init) => {
			requests.push(JSON.parse(String(init?.body)));
			return jsonResponse(200, {
				data: { jobId: "core-job-1", status: "unknown" },
			});
		},
	});

	await provider.submit({
		...submission,
		operation: "text.respond",
		parameters: { maxOutputTokens: 512, temperature: 0.2 },
	});
	await provider.submit({
		...submission,
		inputAssets: [
			{ assetId: "asset-input-1", role: "reference_image" },
			{ assetId: "asset-audio-1", role: "reference_audio" },
			{ assetId: "asset-mask-1", role: "mask" },
		],
		inputNodeBindings: [
			{
				assetId: "asset-input-1",
				nodeId: "image-input-1",
				role: "reference_image",
			},
			{
				assetId: "asset-audio-1",
				nodeId: "audio-input-1",
				role: "reference_audio",
			},
			{ assetId: "asset-mask-1", nodeId: "mask-1", role: "mask" },
		],
	});
	await provider.submit({
		...submission,
		inputAssets: [
			{ assetId: "asset-image-1", role: "reference_image" },
			{ assetId: "asset-video-1", role: "reference_video" },
		],
		inputNodeBindings: [
			{
				assetId: "asset-image-1",
				nodeId: "image-input-1",
				role: "reference_image",
			},
			{
				assetId: "asset-video-1",
				nodeId: "video-input-1",
				role: "reference_video",
			},
		],
		operation: "video.generate",
		parameters: {
			durationSeconds: 5,
			generateAudio: false,
			ratio: "9:16",
			resolution: "1080p",
			watermark: false,
		},
	});
	assert.deepEqual(
		(requests[1]?.payload as { inputAssets: unknown[] }).inputAssets,
		[
			{ assetId: "asset-input-1", role: "reference_image" },
			{ assetId: "asset-audio-1", role: "reference_audio" },
			{ assetId: "asset-mask-1", role: "mask" },
		],
	);
	await assert.rejects(
		provider.submit({ ...submission, parameters: { unknownParameter: 0.7 } }),
		isProviderError("CORE_IMAGE_PARAMETERS_UNSUPPORTED", false),
	);
	assert.equal(requests.length, 3);
});

test("rejects batch counts before a single Core submission can be created", async () => {
	let calls = 0;
	const provider = new CoreGenerationProvider({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async () => {
			calls += 1;
			return jsonResponse(200, { data: {} });
		},
	});

	await assert.rejects(
		provider.submit({ ...submission, count: 2 }),
		isProviderError("CORE_GENERATION_COUNT_INVALID", false),
	);
	assert.equal(calls, 0);
});

test("surfaces an inactive Core deployment as a terminal failure", async () => {
	const provider = new CoreGenerationProvider({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async () =>
			jsonResponse(409, {
				error: {
					code: "INVALID_STATE",
					message: "No active model deployment is available.",
				},
			}),
	});

	await assert.rejects(
		provider.submit(submission),
		(error: unknown) =>
			error instanceof CoreGenerationProviderError &&
			error.code === "INVALID_STATE" &&
			error.options.status === 409 &&
			error.options.retryable === false &&
			/no active model deployment/i.test(error.message),
	);
});

test("preserves generation configuration and response error contracts", async () => {
	assert.throws(
		() =>
			new CoreGenerationProvider({
				coreServiceToken: " ",
				coreServiceUrl: "http://core.internal:4100",
			}),
		isProviderError("CORE_SERVICE_TOKEN_REQUIRED", false),
	);
	assert.throws(
		() =>
			new CoreGenerationProvider({
				coreServiceToken: "service-secret",
				coreServiceUrl: "://invalid",
			}),
		isProviderError("CORE_SERVICE_URL_INVALID", false),
	);

	const provider = new CoreGenerationProvider({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async () => new Response("not-json", { status: 502 }),
	});
	await assert.rejects(
		provider.getCatalog(submission),
		(error: unknown) =>
			error instanceof CoreGenerationProviderError &&
			error.code === "CORE_RESPONSE_INVALID" &&
			error.options.retryable === true &&
			error.options.status === 502 &&
			/non-JSON response/.test(error.message),
	);
});

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}

function isProviderError(code: string, retryable: boolean) {
	return (error: unknown) =>
		error instanceof CoreGenerationProviderError &&
		error.code === code &&
		error.options.retryable === retryable;
}
