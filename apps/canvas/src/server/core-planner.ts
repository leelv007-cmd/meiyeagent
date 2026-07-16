import { createHash } from "node:crypto";

import {
	type CanvasAgentContext,
	CanvasAgentError,
	type CanvasAgentGraph,
	type CanvasAgentPlannerPort,
	parseCanvasAgentPlanText,
} from "@meiye/core/pro-studio-runtime";
import type {
	CoreGenerationIdentity,
	CoreTextResponseInput,
} from "./core-generation-provider";

interface CorePlanningFacade {
	getCatalog(input: CoreGenerationIdentity): Promise<unknown>;
	respondText(input: CoreTextResponseInput): Promise<Record<string, unknown>>;
}

export class CoreCanvasAgentPlanner implements CanvasAgentPlannerPort {
	constructor(private readonly core: CorePlanningFacade) {}

	async isAvailable(workspaceId: string) {
		if (!workspaceId.trim()) return false;
		try {
			const catalog = await this.core.getCatalog({
				correlationId: "canvas-planner-readiness",
				userId: "canvas-planner-readiness",
				workspaceId,
			});
			return coreTextPlanningActive(catalog);
		} catch {
			return false;
		}
	}

	async plan(input: {
		context: CanvasAgentContext;
		intent: string;
		graph: CanvasAgentGraph;
	}) {
		const payload = JSON.stringify({
			canvas: input.graph,
			intent: input.intent,
		});
		const result = await this.core.respondText({
			...identity(input.context),
			idempotencyKey: `canvas-agent-plan-${createHash("sha256")
				.update(`${input.context.userId}:${payload}`)
				.digest("hex")}`,
			prompt: [
				"Return strict JSON for the fixed seven Canvas tools only:",
				"read_canvas, create_node, update_node, delete_node, connect_nodes, disconnect_nodes, run_generation.",
				"Never return provider routing, URLs, credentials, tokens, arbitrary tools, shell commands, or prose.",
				payload,
			].join("\n"),
		});
		if (result.status !== "completed" || typeof result.text !== "string") {
			throw new CanvasAgentError(
				"AGENT_PLANNER_UNAVAILABLE",
				"Core text planning did not return a completed result.",
			);
		}
		return parseCanvasAgentPlanText(result.text);
	}
}

function identity(context: CanvasAgentContext): CoreGenerationIdentity {
	return {
		correlationId: context.correlationId,
		userId: context.userId,
		workspaceId: context.workspaceId,
	};
}

function coreTextPlanningActive(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const operations = (value as { operations?: unknown }).operations;
	return (
		Array.isArray(operations) &&
		operations.some(
			(candidate) =>
				candidate !== null &&
				typeof candidate === "object" &&
				(candidate as { activation?: unknown }).activation === "active" &&
				(candidate as { operation?: unknown }).operation === "text.respond",
		)
	);
}
