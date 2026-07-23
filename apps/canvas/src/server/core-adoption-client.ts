import {
	type AdvancedCanvasAdoptionCommand,
	type AdvancedCanvasAdoptionContext,
	AdvancedCanvasAdoptionError,
	type AdvancedCanvasAdoptionPort,
	type AdvancedCanvasAdoptionResult,
} from "@meiye/core/pro-studio-runtime";
import {
	CoreRemoteCall,
	CoreRemoteCallConfigurationError,
} from "./core-remote-call";

interface CoreAdvancedCanvasAdoptionClientOptions {
	coreServiceToken: string;
	coreServiceUrl: string;
	fetcher?: typeof fetch;
}

export class CoreAdvancedCanvasAdoptionError extends AdvancedCanvasAdoptionError {
	constructor(
		code: string,
		message: string,
		readonly status: number,
	) {
		super(code, message);
		this.name = "CoreAdvancedCanvasAdoptionError";
	}
}

export type CanvasAdoptionTarget = {
	handle: {
		baseVersionId: string;
		expectedRevision: number;
		packageId: string;
	};
	id: string;
	title: string;
};

export class CoreAdvancedCanvasAdoptionClient
	implements AdvancedCanvasAdoptionPort
{
	private readonly remoteCall: CoreRemoteCall;

	constructor(options: CoreAdvancedCanvasAdoptionClientOptions) {
		try {
			this.remoteCall = new CoreRemoteCall(options);
		} catch (error) {
			if (
				error instanceof CoreRemoteCallConfigurationError &&
				error.reason === "service-token"
			) {
				throw new CoreAdvancedCanvasAdoptionError(
					"CORE_SERVICE_TOKEN_REQUIRED",
					"Core adoption requires a service token.",
					503,
				);
			}
			if (!(error instanceof CoreRemoteCallConfigurationError)) throw error;
			throw new CoreAdvancedCanvasAdoptionError(
				"CORE_SERVICE_URL_INVALID",
				"Core adoption requires a valid service URL.",
				503,
			);
		}
	}

	async adopt(
		context: AdvancedCanvasAdoptionContext,
		command: AdvancedCanvasAdoptionCommand,
	) {
		const { idempotencyKey, ...payload } = command;
		return adoptionResult(
			await this.request(
				context,
				"commands",
				{
					action: "adopt_advanced_canvas_output",
					module: "advanced-canvas",
					payload,
				},
				idempotencyKey,
			),
		);
	}

	async listAdoptions(
		context: AdvancedCanvasAdoptionContext,
		projectId: string,
	) {
		const value = await this.request(context, "query", {
			action: "list_adoptions",
			module: "advanced-canvas",
			payload: { projectId },
		});
		if (!Array.isArray(value)) {
			throw invalidResponse();
		}
		return value.map(adoptionResult);
	}

	/**
	 * Read the Core-owned ContentPackage list only. Canvas does not synthesize
	 * adoption targets or persist any package state of its own.
	 */
	async listAdoptionTargets(context: AdvancedCanvasAdoptionContext) {
		const value = await this.request(context, "query", {
			action: "content_packages",
			module: "operations",
			payload: {},
		});
		if (!Array.isArray(value)) throw invalidResponse();
		return value
			.map(adoptionTarget)
			.filter((target): target is CanvasAdoptionTarget => target !== null)
			.sort((left, right) =>
				left.handle.packageId.localeCompare(right.handle.packageId),
			);
	}

	private async request(
		context: AdvancedCanvasAdoptionContext,
		kind: "commands" | "query",
		body: Record<string, unknown>,
		idempotencyKey?: string,
	): Promise<unknown> {
		const result = await this.remoteCall.request({
			body,
			identity: {
				correlationId: requireText(context.correlationId, "correlationId"),
				userId: requireText(context.userId, "userId"),
				workspaceId: requireText(context.workspaceId, "workspaceId"),
			},
			...(idempotencyKey === undefined
				? {}
				: {
						idempotencyKey: requireText(idempotencyKey, "idempotencyKey"),
					}),
			kind,
		});
		if (result.kind === "unreachable") {
			throw new CoreAdvancedCanvasAdoptionError(
				"CORE_UNREACHABLE",
				"Core adoption is unavailable.",
				503,
			);
		}
		if (result.kind === "non-json") throw invalidResponse();
		if (result.kind === "rejected") {
			const error = remoteError(result.envelope);
			throw new CoreAdvancedCanvasAdoptionError(
				error?.code ?? "CORE_ADOPTION_REJECTED",
				error?.message ?? "Core adoption request was rejected.",
				result.status,
			);
		}
		if (result.kind === "invalid-envelope") throw invalidResponse();
		return result.data;
	}
}

function adoptionResult(value: unknown): AdvancedCanvasAdoptionResult {
	if (!isRecord(value)) throw invalidResponse();
	return {
		orderedMediaNodeIds: stringArray(value.orderedMediaNodeIds),
		packageId: requireText(value.packageId, "packageId"),
		projectId: requireText(value.projectId, "projectId"),
		revisionId: requireText(value.revisionId, "revisionId"),
		selectedNodeIds: stringArray(value.selectedNodeIds),
		versionId: requireText(value.versionId, "versionId"),
	};
}

function adoptionTarget(value: unknown) {
	if (!isRecord(value) || !isText(value.id)) throw invalidResponse();
	if (!isRecord(value.rights) || value.rights.state !== "authorized") {
		return null;
	}
	if (!isText(value.currentVersionId) || !nonNegativeInteger(value.revision)) {
		return null;
	}
	const currentVersionId = value.currentVersionId;
	const versions = Array.isArray(value.versions) ? value.versions : [];
	const currentVersion = versions.find(
		(candidate) => isRecord(candidate) && candidate.id === currentVersionId,
	);
	if (!isRecord(currentVersion)) return null;
	return {
		handle: {
			baseVersionId: currentVersionId,
			expectedRevision: value.revision,
			packageId: value.id,
		},
		id: value.id,
		title: isText(currentVersion.title) ? currentVersion.title : "未命名成品",
	};
}

function stringArray(value: unknown) {
	if (!Array.isArray(value) || value.some((item) => !isText(item))) {
		throw invalidResponse();
	}
	return [...value] as string[];
}

function requireText(value: unknown, field: string) {
	if (!isText(value)) {
		throw new CoreAdvancedCanvasAdoptionError(
			"CORE_ADOPTION_INPUT_INVALID",
			`Core adoption requires ${field}.`,
			400,
		);
	}
	return value;
}

function isText(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function remoteError(value: unknown) {
	if (!isRecord(value) || !isRecord(value.error)) return undefined;
	return {
		code: isText(value.error.code) ? value.error.code : undefined,
		message: isText(value.error.message) ? value.error.message : undefined,
	};
}

function invalidResponse() {
	return new CoreAdvancedCanvasAdoptionError(
		"CORE_RESPONSE_INVALID",
		"Core adoption returned an invalid response.",
		503,
	);
}
