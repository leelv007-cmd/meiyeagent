import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
import type {
	CanvasGenerationInputAssetRole,
	CanvasGenerationRequest,
} from "../client/generation-ui-contract";

export type RetouchGenerationKind = "angle" | "mask" | "reversePrompt";

export type RetouchGenerationCapability = {
	activation: "active" | "inactive";
	allowedInputAssetRoles: CanvasGenerationInputAssetRole[];
	allowedParameters: string[];
	operation: CanvasGenerationOperation;
};

export type RetouchImageNode = {
	data: Record<string, unknown>;
	id: string;
	type: string;
};

export type RetouchAngleParams = {
	cameraDistance: number;
	horizontalAngle: number;
	pitchAngle: number;
	wideAngle: boolean;
};

export type ReversePromptConfigData = {
	jobId: string;
	prompt: string;
	retouchKind: "reversePrompt";
	status: "loading" | "success";
};

const defaultAngleParams: RetouchAngleParams = {
	cameraDistance: 4.8,
	horizontalAngle: 0,
	pitchAngle: 9,
	wideAngle: false,
};

const reversePromptInstruction =
	"请根据该参考图片反推出可复用的中文图片生成提示词。描述主体、构图、镜头、光线、材质、色彩与风格；只输出提示词，不臆造未见事实。";

export function retouchGenerationLabel(kind: RetouchGenerationKind) {
	switch (kind) {
		case "mask":
			return "局部蒙版编辑";
		case "angle":
			return "AI 多角度";
		case "reversePrompt":
			return "反推提示词";
	}
}

export function retouchOperationForKind(
	kind: RetouchGenerationKind,
): "image.edit" | "text.respond" {
	return kind === "reversePrompt" ? "text.respond" : "image.edit";
}

/** Select only an active, operation-exact Core capability. */
export function activeRetouchCapability(
	operations: readonly RetouchGenerationCapability[],
	kind: RetouchGenerationKind,
): RetouchGenerationCapability {
	const operation = retouchOperationForKind(kind);
	const capability = operations.find(
		(candidate) =>
			candidate.operation === operation && candidate.activation === "active",
	);
	if (!capability) throw new Error("RETOUCH_OPERATION_UNAVAILABLE");
	return capability;
}

/**
 * Normalize angle UI values into a descriptive image.edit prompt. The frozen
 * Core contract deliberately has no angle-specific parameter fields.
 */
export function normalizeAngleParams(
	params: Partial<RetouchAngleParams> = {},
): RetouchAngleParams {
	return {
		cameraDistance: clampNumber(
			params.cameraDistance,
			defaultAngleParams.cameraDistance,
			1,
			10,
			0.1,
		),
		horizontalAngle: clampNumber(
			params.horizontalAngle,
			defaultAngleParams.horizontalAngle,
			-60,
			60,
			1,
		),
		pitchAngle: clampNumber(
			params.pitchAngle,
			defaultAngleParams.pitchAngle,
			-45,
			45,
			1,
		),
		wideAngle: params.wideAngle === true,
	};
}

export function retouchAnglePrompt(params: RetouchAngleParams): string {
	return [
		"基于参考图片重新生成同一主体，不修改源图。",
		`目标视角：水平 ${params.horizontalAngle}°，俯仰 ${params.pitchAngle}°，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角镜头" : "标准镜头"}。`,
		"保持主体身份、材质、光线和构图意图。",
	].join("");
}

export function reversePromptConfigData(
	jobId: string,
	prompt?: string,
): ReversePromptConfigData {
	const normalizedJobId = requiredId(jobId, "RETOUCH_JOB_REQUIRED");
	const normalizedPrompt = prompt?.trim();
	return {
		jobId: normalizedJobId,
		prompt: normalizedPrompt || "反推提示词生成中…",
		retouchKind: "reversePrompt",
		status: normalizedPrompt ? "success" : "loading",
	};
}

export function isReversePromptConfigNode(
	node: RetouchImageNode,
	jobId: string,
) {
	return (
		node.type === "config" &&
		node.data.retouchKind === "reversePrompt" &&
		node.data.jobId === jobId
	);
}

/** Build an exact Core request from the durable source and optional mask node. */
export function buildRetouchGenerationInput(input: {
	angleParams?: Partial<RetouchAngleParams>;
	capability: RetouchGenerationCapability;
	kind: RetouchGenerationKind;
	maskNode?: RetouchImageNode;
	prompt?: string;
	projectId: string;
	revisionId: string;
	sourceNode: RetouchImageNode;
}): CanvasGenerationRequest {
	const operation = retouchOperationForKind(input.kind);
	if (
		input.capability.activation !== "active" ||
		input.capability.operation !== operation
	) {
		throw new Error("RETOUCH_OPERATION_UNAVAILABLE");
	}
	const source = imageAssetBinding(input.sourceNode, "reference_image");
	const roles = new Set(input.capability.allowedInputAssetRoles);
	if (!roles.has("reference_image")) {
		throw new Error("RETOUCH_CAPABILITY_ROLE_UNAVAILABLE");
	}
	const bindings = [source];
	if (input.kind === "mask") {
		if (!roles.has("mask")) {
			throw new Error("RETOUCH_CAPABILITY_ROLE_UNAVAILABLE");
		}
		if (!input.maskNode) throw new Error("MASK_NODE_REQUIRED");
		if (input.maskNode.data.retouchRole !== "mask") {
			throw new Error("MASK_NODE_REQUIRED");
		}
		bindings.push(imageAssetBinding(input.maskNode, "mask"));
	}

	const prompt = promptForRetouch(input);
	const allowedParameters = new Set(input.capability.allowedParameters);
	return {
		inputAssets: bindings.map(({ assetId, role }) => ({ assetId, role })),
		inputNodeBindings: bindings,
		operation,
		parameters: supportedRetouchParameters(input.kind, allowedParameters),
		projectId: requiredId(input.projectId, "PROJECT_REQUIRED"),
		prompt,
		revisionId: requiredId(input.revisionId, "REVISION_REQUIRED"),
	};
}

function imageAssetBinding(
	node: RetouchImageNode,
	role: CanvasGenerationInputAssetRole,
) {
	if (node.type !== "image") throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
	const assetId =
		typeof node.data.assetId === "string" ? node.data.assetId.trim() : "";
	if (!assetId) throw new Error("SOURCE_ASSET_REQUIRED");
	return {
		assetId,
		nodeId: requiredId(node.id, "SOURCE_IMAGE_NODE_REQUIRED"),
		role,
	};
}

function promptForRetouch(input: {
	angleParams?: Partial<RetouchAngleParams>;
	kind: RetouchGenerationKind;
	prompt?: string;
}) {
	if (input.kind === "angle") {
		return retouchAnglePrompt(normalizeAngleParams(input.angleParams));
	}
	if (input.kind === "reversePrompt") return reversePromptInstruction;
	const prompt = input.prompt?.trim() ?? "";
	if (!prompt) throw new Error("RETOUCH_PROMPT_REQUIRED");
	return prompt;
}

function supportedRetouchParameters(
	kind: RetouchGenerationKind,
	allowed: Set<string>,
): Record<string, boolean | number | string> {
	const parameters: Record<string, boolean | number | string> = {};
	if (kind === "reversePrompt") {
		if (allowed.has("maxOutputTokens")) parameters.maxOutputTokens = 1200;
		if (allowed.has("temperature")) parameters.temperature = 0.2;
		return parameters;
	}
	if (allowed.has("strength")) parameters.strength = 0.7;
	return parameters;
}

function requiredId(value: string, code: string) {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(code);
	return trimmed;
}

function clampNumber(
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
	step: number,
) {
	const numeric = Number(value);
	const bounded = Number.isFinite(numeric)
		? Math.min(max, Math.max(min, numeric))
		: fallback;
	return Math.round(bounded / step) * step;
}
