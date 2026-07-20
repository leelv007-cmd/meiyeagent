export interface CoreRemoteCallOptions {
	coreServiceToken: string;
	coreServiceUrl: string;
	fetcher?: typeof fetch;
}

export interface CoreRemoteIdentity {
	correlationId: string;
	userId: string;
	workspaceId: string;
}

export type CoreRemoteCallResult =
	| { data: unknown; kind: "success"; status: number }
	| { cause: unknown; kind: "unreachable" }
	| { kind: "non-json"; status: number }
	| { envelope: unknown; kind: "rejected"; status: number }
	| { kind: "invalid-envelope"; status: number };

export class CoreRemoteCallConfigurationError extends Error {
	constructor(readonly reason: "service-token" | "service-url") {
		super(`Invalid Core remote call ${reason}.`);
		this.name = "CoreRemoteCallConfigurationError";
	}
}

export class CoreRemoteCall {
	private readonly fetcher: typeof fetch;
	private readonly serviceUrl: URL;

	constructor(private readonly options: CoreRemoteCallOptions) {
		if (!options.coreServiceToken.trim()) {
			throw new CoreRemoteCallConfigurationError("service-token");
		}
		try {
			this.serviceUrl = new URL(options.coreServiceUrl);
		} catch {
			throw new CoreRemoteCallConfigurationError("service-url");
		}
		this.fetcher = options.fetcher ?? fetch;
	}

	async request(input: {
		body: Record<string, unknown>;
		identity: CoreRemoteIdentity;
		idempotencyKey?: string;
		kind: "commands" | "query";
	}): Promise<CoreRemoteCallResult> {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			"x-core-actor": "worker",
			"x-correlation-id": input.identity.correlationId,
			"x-service-token": this.options.coreServiceToken,
			"x-user-id": input.identity.userId,
			"x-workspace-id": input.identity.workspaceId,
		};
		if (input.idempotencyKey !== undefined) {
			headers["idempotency-key"] = input.idempotencyKey;
		}

		let response: Response;
		try {
			response = await this.fetcher(
				new URL(
					`/v1/workspaces/${encodeURIComponent(input.identity.workspaceId)}/p1/${input.kind}`,
					this.serviceUrl,
				),
				{
					body: JSON.stringify(input.body),
					cache: "no-store",
					headers,
					method: "POST",
				},
			);
		} catch (cause) {
			return { cause, kind: "unreachable" };
		}

		let envelope: unknown;
		try {
			envelope = await response.json();
		} catch {
			return { kind: "non-json", status: response.status };
		}
		if (!response.ok) {
			return { envelope, kind: "rejected", status: response.status };
		}
		if (!isRecord(envelope) || !("data" in envelope)) {
			return { kind: "invalid-envelope", status: response.status };
		}
		return { data: envelope.data, kind: "success", status: response.status };
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
