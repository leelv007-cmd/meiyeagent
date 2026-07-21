export type CatalogEntry = {
	/** Loose adapter flag used by kernel-host fixtures. */
	active?: boolean;
	/** BackendPort catalog activation field. */
	activation?: "active" | "inactive";
	modelId?: string | null;
	operation: string;
	unavailableReason?: string;
};

export type GenerationSubmitInput = {
	assetIds: string[];
	maskAssetId?: string;
	operation: string;
	projectId: string;
	prompt: string;
	revisionId: string;
};

export type GenerationJobLike = {
	deliverable?:
		| { kind: "asset"; asset: { id: string } }
		| { kind: "text"; text: string }
		| null;
	jobId: string;
	status: string;
};

export function isCatalogOperationActive(
	entry: CatalogEntry | undefined,
): boolean {
	if (!entry) return false;
	if (entry.active === false) return false;
	if (entry.activation === "inactive") return false;
	if (entry.modelId === null || entry.modelId === "") return false;
	if (entry.activation === "active") return Boolean(entry.modelId);
	if (entry.active === true)
		return entry.modelId !== undefined ? Boolean(entry.modelId) : true;
	// No explicit active flag: require a non-empty modelId.
	return typeof entry.modelId === "string" && entry.modelId.length > 0;
}

export function honestAvailability(
	operation: string,
	catalog: CatalogEntry[],
): { available: boolean; reason?: string } {
	const entry = catalog.find((item) => item.operation === operation);
	if (!entry) {
		return { available: false, reason: "目录未声明该能力" };
	}
	if (!isCatalogOperationActive(entry)) {
		return {
			available: false,
			reason:
				entry.unavailableReason ??
				"能力未激活（无模型/价/live 证据）— 非假可用",
		};
	}
	return { available: true };
}

export function buildSubmitPayload(input: GenerationSubmitInput) {
	const inputAssets =
		input.operation === "image.edit" && input.maskAssetId
			? [
					...input.assetIds.map((assetId) => ({
						assetId,
						role: "reference_image" as const,
					})),
					{ assetId: input.maskAssetId, role: "mask" as const },
				]
			: input.assetIds.map((assetId) => ({
					assetId,
					role: roleForOperation(input.operation),
				}));

	return {
		inputAssets,
		operation: input.operation,
		parameters: {} as Record<string, never>,
		projectId: input.projectId,
		prompt: input.prompt,
		revisionId: input.revisionId,
	};
}

function roleForOperation(
	operation: string,
): "reference_audio" | "reference_image" | "reference_video" {
	if (operation.startsWith("video")) return "reference_video";
	if (operation.startsWith("audio")) return "reference_audio";
	return "reference_image";
}

export function mapJobToNodeData(
	job: GenerationJobLike,
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		jobId: job.jobId,
		status: job.status,
	};
	if (!job.deliverable) return base;
	if (job.deliverable.kind === "asset") {
		return { ...base, assetId: job.deliverable.asset.id };
	}
	return { ...base, text: job.deliverable.text };
}
