import assert from "node:assert/strict";
import test from "node:test";
import {
	activeRetouchCapability,
	buildRetouchGenerationInput,
	isReversePromptConfigNode,
	normalizeAngleParams,
	type RetouchGenerationCapability,
	retouchAnglePrompt,
	reversePromptConfigData,
} from "./retouch-generation.js";

const sourceNode = {
	data: { assetId: "asset-source" },
	height: 160,
	id: "image-source",
	type: "image",
	width: 200,
	x: 20,
	y: 30,
};

const maskNode = {
	data: { assetId: "asset-mask", retouchRole: "mask" },
	height: 160,
	id: "image-mask",
	type: "image",
	width: 200,
	x: 268,
	y: 30,
};

test("mask generation freezes source and mask nodes in the supported image.edit contract", () => {
	const input = buildRetouchGenerationInput({
		capability: {
			activation: "active",
			allowedInputAssetRoles: ["reference_image", "mask"],
			allowedParameters: ["strength"],
			operation: "image.edit",
		},
		kind: "mask",
		maskNode,
		prompt: "把选中区域改成金属材质，保持原图光影",
		projectId: "project-1",
		revisionId: "revision-1",
		sourceNode,
	});

	assert.deepEqual(input, {
		inputAssets: [
			{ assetId: "asset-source", role: "reference_image" },
			{ assetId: "asset-mask", role: "mask" },
		],
		inputNodeBindings: [
			{
				assetId: "asset-source",
				nodeId: "image-source",
				role: "reference_image",
			},
			{ assetId: "asset-mask", nodeId: "image-mask", role: "mask" },
		],
		operation: "image.edit",
		parameters: { strength: 0.7 },
		projectId: "project-1",
		prompt: "把选中区域改成金属材质，保持原图光影",
		revisionId: "revision-1",
	});
	assert.equal("modelId" in input, false);
});

test("angle normalization is bounded and expressed through the frozen prompt contract", () => {
	const params = normalizeAngleParams({
		cameraDistance: 99,
		horizontalAngle: 88,
		pitchAngle: -70,
		wideAngle: true,
	});
	assert.deepEqual(params, {
		cameraDistance: 10,
		horizontalAngle: 60,
		pitchAngle: -45,
		wideAngle: true,
	});
	assert.match(retouchAnglePrompt(params), /水平 60°/u);
	assert.match(retouchAnglePrompt(params), /俯仰 -45°/u);
	assert.match(retouchAnglePrompt(params), /广角/u);
	const input = buildRetouchGenerationInput({
		angleParams: params,
		capability: {
			activation: "active",
			allowedInputAssetRoles: ["reference_image"],
			allowedParameters: ["strength"],
			operation: "image.edit",
		},
		kind: "angle",
		projectId: "project-1",
		revisionId: "revision-1",
		sourceNode,
	});
	assert.deepEqual(input.parameters, { strength: 0.7 });
	assert.equal(input.operation, "image.edit");
	assert.doesNotMatch(
		JSON.stringify(input.parameters),
		/angle|pitch|distance/u,
	);
});

test("reverse prompt only uses text.respond with an authorized reference image", () => {
	const input = buildRetouchGenerationInput({
		capability: {
			activation: "active",
			allowedInputAssetRoles: ["reference_image"],
			allowedParameters: ["maxOutputTokens", "temperature"],
			operation: "text.respond",
		},
		kind: "reversePrompt",
		projectId: "project-1",
		revisionId: "revision-2",
		sourceNode,
	});

	assert.deepEqual(input.inputAssets, [
		{ assetId: "asset-source", role: "reference_image" },
	]);
	assert.deepEqual(input.parameters, {
		maxOutputTokens: 1200,
		temperature: 0.2,
	});
	assert.equal(input.operation, "text.respond");
	assert.match(input.prompt, /反推出可复用/u);
});

test("reverse prompt result data is a durable Config-node marker", () => {
	const pending = reversePromptConfigData("job-reverse-1");
	assert.deepEqual(pending, {
		jobId: "job-reverse-1",
		prompt: "反推提示词生成中…",
		retouchKind: "reversePrompt",
		status: "loading",
	});
	const completed = reversePromptConfigData("job-reverse-1", "人物半身特写");
	assert.equal(completed.status, "success");
	assert.equal(
		isReversePromptConfigNode(
			{
				data: completed,
				id: "config-reverse-1",
				type: "config",
			},
			"job-reverse-1",
		),
		true,
	);
});

test("retouch generation fails closed when the active capability cannot accept its inputs", () => {
	assert.throws(
		() =>
			buildRetouchGenerationInput({
				capability: {
					activation: "active",
					allowedInputAssetRoles: ["reference_image"],
					allowedParameters: [],
					operation: "image.edit",
				},
				kind: "mask",
				maskNode,
				prompt: "只改选区",
				projectId: "project-1",
				revisionId: "revision-1",
				sourceNode,
			}),
		/RETOUCH_CAPABILITY_ROLE_UNAVAILABLE/,
	);
});

test("mask generation refuses an arbitrary image node as a mask binding", () => {
	assert.throws(
		() =>
			buildRetouchGenerationInput({
				capability: {
					activation: "active",
					allowedInputAssetRoles: ["reference_image", "mask"],
					allowedParameters: [],
					operation: "image.edit",
				},
				kind: "mask",
				maskNode: { ...maskNode, data: { assetId: "asset-not-a-mask" } },
				prompt: "只改选区",
				projectId: "project-1",
				revisionId: "revision-1",
				sourceNode,
			}),
		/MASK_NODE_REQUIRED/,
	);
});

test("retouch capability selection fails closed when the operation is missing or inactive (honest degradation)", () => {
	const activeImageEdit: RetouchGenerationCapability = {
		activation: "active",
		allowedInputAssetRoles: ["reference_image", "mask"],
		allowedParameters: ["strength"],
		operation: "image.edit",
	};
	const inactiveImageEdit: RetouchGenerationCapability = {
		...activeImageEdit,
		activation: "inactive",
	};
	const inactiveTextRespond: RetouchGenerationCapability = {
		activation: "inactive",
		allowedInputAssetRoles: ["reference_image"],
		allowedParameters: ["maxOutputTokens", "temperature"],
		operation: "text.respond",
	};

	// No supply at all → mask/angle/reverse must refuse, never fake availability.
	assert.throws(
		() => activeRetouchCapability([], "mask"),
		/RETOUCH_OPERATION_UNAVAILABLE/,
	);
	// Present but inactive image.edit → still refused (no unverified capability).
	assert.throws(
		() => activeRetouchCapability([inactiveImageEdit], "angle"),
		/RETOUCH_OPERATION_UNAVAILABLE/,
	);
	// Inactive text.respond → reverse prompt refused.
	assert.throws(
		() => activeRetouchCapability([inactiveTextRespond], "reversePrompt"),
		/RETOUCH_OPERATION_UNAVAILABLE/,
	);
	// Only an active, operation-exact capability is selected.
	assert.equal(
		activeRetouchCapability([inactiveImageEdit, activeImageEdit], "mask"),
		activeImageEdit,
	);
});
