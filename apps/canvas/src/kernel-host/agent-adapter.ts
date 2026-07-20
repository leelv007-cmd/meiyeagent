import type {
	AgentAuditEvent,
	AgentPlan,
} from "@meiye/core/pro-studio-runtime";
import type { CanvasCaller } from "./project-persistence";

const pattern = (...parts: string[]) => new RegExp(parts.join(""), "i");

const FORBIDDEN_LOCAL_AGENT: RegExp[] = [
	pattern("agent", "Token"),
	pattern("local", "Storage\\.getItem\\(\\s*['\"]agent"),
	pattern("canvas", "-agent"),
	pattern("child", "_process"),
];

/**
 * Build/source negative scan helper for unsafe local bridge credentials,
 * browser-persisted bridge state, local shells, and process execution.
 */
export function assertNoLocalAgentBridge(source: string): void {
	for (const pattern of FORBIDDEN_LOCAL_AGENT) {
		if (pattern.test(source)) {
			throw new Error(
				`Forbidden local agent bridge pattern: ${pattern.source}`,
			);
		}
	}
}

export type AgentOperationConfirmationState = {
	confirmed: boolean[];
	rejected: boolean;
};

export function createAgentOperationConfirmationState(
	operationCount: number,
): AgentOperationConfirmationState {
	return {
		confirmed: Array.from({ length: operationCount }, () => false),
		rejected: false,
	};
}

export function setAgentOperationConfirmed(
	state: AgentOperationConfirmationState,
	operationIndex: number,
	confirmed: boolean,
): AgentOperationConfirmationState {
	return {
		confirmed: state.confirmed.map((value, index) =>
			index === operationIndex ? confirmed : value,
		),
		rejected: false,
	};
}

export function isAgentPlanFullyConfirmed(
	state: AgentOperationConfirmationState,
) {
	return (
		!state.rejected &&
		state.confirmed.length > 0 &&
		state.confirmed.every(Boolean)
	);
}

export function rejectAgentPlan(
	state: AgentOperationConfirmationState,
): AgentOperationConfirmationState {
	return {
		confirmed: state.confirmed.map(() => false),
		rejected: true,
	};
}

export type AgentApplyFailure = {
	code: string;
	discardCredential: boolean;
	message: string;
	requiresReloadAndReplan: boolean;
};

export function mapAgentApplyError(error: unknown): AgentApplyFailure {
	const code =
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
			? error.code
			: "REQUEST_FAILED";
	if (code === "REVISION_CONFLICT") {
		return {
			code,
			discardCredential: true,
			message:
				"画布版本已经变化。旧确认凭据已失效，请重新加载工程并生成新计划。",
			requiresReloadAndReplan: true,
		};
	}
	if (code === "READ_SET_CHANGED") {
		return {
			code,
			discardCredential: true,
			message:
				"计划依赖的素材、权限或额度已经变化。请重新加载工程并生成新计划。",
			requiresReloadAndReplan: true,
		};
	}
	return {
		code,
		discardCredential: false,
		message:
			error instanceof Error ? error.message : "Agent 操作失败，请重试。",
		requiresReloadAndReplan: false,
	};
}

export type AgentApplyInput = {
	credentialId: string;
	expectedRevision: number;
	projectId: string;
};

export type AgentCredential = {
	affectedAssetIds: string[];
	credentialId: string;
	diff: AgentPlan["diff"];
	expiresAt: string;
	maxCostMicros: number;
	maxGenerationCount: number;
};

export type AgentApplyResult = {
	revision: number;
	status: "changed" | "executed";
};

export async function applyAgentAndRefreshAudit<TApply, TAudit>(
	port: {
		apply(
			input: AgentApplyInput,
			options?: { idempotencyKey?: string },
		): Promise<TApply>;
		listAudit(projectId: string): Promise<TAudit>;
	},
	input: AgentApplyInput,
	options?: { idempotencyKey?: string },
) {
	let applyOutcome:
		| { failure: null; result: TApply }
		| { failure: AgentApplyFailure; result: null };
	try {
		applyOutcome = {
			failure: null,
			result: await port.apply(input, options),
		};
	} catch (error) {
		applyOutcome = { failure: mapAgentApplyError(error), result: null };
	}
	let audit: TAudit | null = null;
	let auditWarning: string | null = null;
	try {
		audit = await port.listAudit(input.projectId);
	} catch {
		auditWarning = "审计记录暂时无法刷新，请稍后重试。";
	}
	return applyOutcome.failure
		? {
				audit,
				auditWarning,
				failure: applyOutcome.failure,
				outcome: "failed" as const,
				result: null,
			}
		: {
				audit,
				auditWarning,
				failure: null,
				outcome: "applied" as const,
				result: applyOutcome.result,
			};
}

export class AgentAdapter {
	constructor(private readonly callCanvas: CanvasCaller) {}

	plan(
		input: {
			intent: string;
			maxCostMicros: number;
			maxGenerationCount: number;
			projectId: string;
		},
		options?: Parameters<CanvasCaller>[2],
	) {
		return this.callCanvas<AgentPlan>(
			"planAgent",
			{
				intent: input.intent,
				maxCostMicros: input.maxCostMicros,
				maxGenerationCount: input.maxGenerationCount,
				projectId: input.projectId,
			},
			options,
		);
	}

	confirm(input: { planId: string }, options?: Parameters<CanvasCaller>[2]) {
		return this.callCanvas<AgentCredential>(
			"confirmAgent",
			{ planId: input.planId },
			options,
		);
	}

	apply(
		input: {
			credentialId: string;
			expectedRevision: number;
			projectId: string;
		},
		options?: Parameters<CanvasCaller>[2],
	) {
		return this.callCanvas<AgentApplyResult>(
			"applyAgentOps",
			{
				credentialId: input.credentialId,
				expectedRevision: input.expectedRevision,
				projectId: input.projectId,
			},
			options,
		);
	}

	listAudit(projectId: string) {
		return this.callCanvas<AgentAuditEvent[]>("listAgentAudit", { projectId });
	}
}
