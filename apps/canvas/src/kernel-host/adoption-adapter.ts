import type { KernelNode } from "./graph-bridge";

export type AdoptionSelection = {
	orderedMediaNodeIds: string[];
	textNodeId?: string;
};

export type AdoptionTarget =
	| { kind: "new_package" }
	| {
			baseVersionId: string;
			expectedRevision: number;
			kind: "existing_package";
			packageId: string;
	  };

export type AdoptionResultLike = {
	orderedMediaNodeIds?: string[];
	packageId: string;
	projectId: string;
	revisionId: string;
	selectedNodeIds?: string[];
	versionId: string;
};

/** Build adoption selection from the ordered kernel selection. */
export function buildAdoptionSelection(
	selectedNodeIds: string[],
	nodes: Array<Pick<KernelNode, "data" | "id" | "type">>,
): AdoptionSelection {
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const ordered = selectedNodeIds
		.map((id) => byId.get(id))
		.filter((node): node is Pick<KernelNode, "data" | "id" | "type"> =>
			Boolean(node),
		);

	const text = ordered.find(
		(node) =>
			node.type === "text" &&
			typeof node.data.text === "string" &&
			node.data.text.trim().length > 0,
	);
	const media = ordered.filter((node) =>
		["audio", "image", "video"].includes(node.type),
	);
	if (media.some((node) => node.type === "audio")) {
		throw new Error("ADOPTION_SELECTION_AUDIO_UNSUPPORTED");
	}
	if (new Set(media.map((node) => node.type)).size > 1) {
		throw new Error("ADOPTION_SELECTION_MEDIA_MIXED");
	}
	if (
		media.some(
			(node) =>
				typeof node.data.assetId !== "string" ||
				!node.data.assetId.trim() ||
				typeof node.data.jobId !== "string" ||
				!node.data.jobId.trim(),
		)
	) {
		throw new Error("ADOPTION_SELECTION_CANONICAL_JOB_REQUIRED");
	}
	if (media.some((node) => node.type === "image") && !text) {
		throw new Error("ADOPTION_SELECTION_TEXT_REQUIRED");
	}
	if (media.some((node) => node.type === "video") && text) {
		throw new Error("ADOPTION_SELECTION_VIDEO_TEXT_UNSUPPORTED");
	}

	return {
		orderedMediaNodeIds: media.map((node) => node.id),
		...(text ? { textNodeId: text.id } : {}),
	};
}

export function buildAdoptionInput(input: {
	expectedDraftVersion: number;
	nodes: Array<Pick<KernelNode, "data" | "id" | "type">>;
	projectId: string;
	selectedNodeIds: string[];
	target?: AdoptionTarget;
}) {
	const selection = buildAdoptionSelection(input.selectedNodeIds, input.nodes);
	if (selection.orderedMediaNodeIds.length === 0) {
		throw new Error("ADOPTION_SELECTION_EMPTY");
	}
	return {
		projectId: input.projectId,
		revisionRef: {
			expectedDraftVersion: input.expectedDraftVersion,
			kind: "freeze_current_draft" as const,
		},
		selection: {
			orderedMediaNodeIds: selection.orderedMediaNodeIds,
			...(selection.textNodeId ? { textNodeId: selection.textNodeId } : {}),
		},
		target: input.target ?? { kind: "new_package" as const },
	};
}

export function parseAdoptionResult(raw: unknown): AdoptionResultLike {
	if (!raw || typeof raw !== "object") {
		throw new Error("ADOPTION_RESULT_INVALID");
	}
	const value = raw as Record<string, unknown>;
	const packageId = value.packageId;
	const versionId = value.versionId;
	const projectId = value.projectId;
	const revisionId = value.revisionId;
	if (
		typeof packageId !== "string" ||
		typeof versionId !== "string" ||
		typeof projectId !== "string" ||
		typeof revisionId !== "string"
	) {
		throw new Error("ADOPTION_RESULT_INVALID");
	}
	return {
		packageId,
		projectId,
		revisionId,
		versionId,
		...(Array.isArray(value.orderedMediaNodeIds)
			? {
					orderedMediaNodeIds: value.orderedMediaNodeIds.filter(
						(id): id is string => typeof id === "string",
					),
				}
			: {}),
		...(Array.isArray(value.selectedNodeIds)
			? {
					selectedNodeIds: value.selectedNodeIds.filter(
						(id): id is string => typeof id === "string",
					),
				}
			: {}),
	};
}
