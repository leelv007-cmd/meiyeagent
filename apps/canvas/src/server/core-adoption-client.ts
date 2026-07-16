import {
	type AdvancedCanvasAdoptionCommand,
	type AdvancedCanvasAdoptionContext,
	AdvancedCanvasAdoptionError,
	type AdvancedCanvasAdoptionPort,
	type AdvancedCanvasAdoptionResult,
} from "@meiye/core/pro-studio-runtime";

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

export class CoreAdvancedCanvasAdoptionClient
	implements AdvancedCanvasAdoptionPort
{
	private readonly fetcher: typeof fetch;
	private readonly serviceUrl: URL;

	constructor(
		private readonly options: CoreAdvancedCanvasAdoptionClientOptions,
	) {
		if (!options.coreServiceToken.trim()) {
			throw new CoreAdvancedCanvasAdoptionError(
				"CORE_SERVICE_TOKEN_REQUIRED",
				"Core adoption requires a service token.",
				503,
			);
		}
		try {
			this.serviceUrl = new URL(options.coreServiceUrl);
		} catch {
			throw new CoreAdvancedCanvasAdoptionError(
				"CORE_SERVICE_URL_INVALID",
				"Core adoption requires a valid service URL.",
				503,
			);
		}
		this.fetcher = options.fetcher ?? fetch;
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

	private async request(
		context: AdvancedCanvasAdoptionContext,
		kind: "commands" | "query",
		body: Record<string, unknown>,
		idempotencyKey?: string,
	): Promise<unknown> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			"x-core-actor": "worker",
			"x-correlation-id": requireText(context.correlationId, "correlationId"),
			"x-service-token": this.options.coreServiceToken,
			"x-user-id": requireText(context.userId, "userId"),
			"x-workspace-id": requireText(context.workspaceId, "workspaceId"),
		};
		if (idempotencyKey !== undefined) {
			headers["idempotency-key"] = requireText(
				idempotencyKey,
				"idempotencyKey",
			);
		}

		let response: Response;
		try {
			response = await this.fetcher(
				new URL(
					`/v1/workspaces/${encodeURIComponent(context.workspaceId)}/p1/${kind}`,
					this.serviceUrl,
				),
				{
					body: JSON.stringify(body),
					cache: "no-store",
					headers,
					method: "POST",
				},
			);
		} catch {
			throw new CoreAdvancedCanvasAdoptionError(
				"CORE_UNREACHABLE",
				"Core adoption is unavailable.",
				503,
			);
		}

		const envelope = await responseJson(response);
		if (!response.ok) {
			const error = remoteError(envelope);
			throw new CoreAdvancedCanvasAdoptionError(
				error?.code ?? "CORE_ADOPTION_REJECTED",
				error?.message ?? "Core adoption request was rejected.",
				response.status,
			);
		}
		if (!isRecord(envelope) || !("data" in envelope)) {
			throw invalidResponse();
		}
		return envelope.data;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function responseJson(response: Response) {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw invalidResponse();
	}
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
