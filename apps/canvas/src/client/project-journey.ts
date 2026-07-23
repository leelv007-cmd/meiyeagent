import type { AdvancedCanvasProject } from "@meiye/core/pro-studio";

export const WORKSPACE_DISPLAY_FALLBACK = "当前工作区";

export type ProjectCardMetadata = {
	edgeCount: number;
	nodeCount: number;
	updatedAt: string;
};

/**
 * Keep the project rail limited to merchant-facing project facts.  In
 * particular, the graph's node types and all persistence identifiers stay out
 * of this projection.
 */
export function projectCardMetadata(
	project: Pick<AdvancedCanvasProject, "graph" | "updatedAt">,
): ProjectCardMetadata {
	return {
		edgeCount: project.graph.edges.length,
		nodeCount: project.graph.nodes.length,
		updatedAt: formatProjectUpdatedAt(project.updatedAt),
	};
}

export function formatProjectUpdatedAt(value: string) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return "更新时间未知";
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

/** A server display name may be unavailable, but an identifier is never a UI fallback. */
export function merchantSafeWorkspaceDisplayName(
	value: unknown,
	workspaceId?: string,
) {
	if (typeof value !== "string") return WORKSPACE_DISPLAY_FALLBACK;
	const displayName = value.trim();
	if (
		displayName.length === 0 ||
		displayName.length > 200 ||
		(workspaceId !== undefined && displayName === workspaceId) ||
		displayName.toLocaleLowerCase() === "workspace" ||
		looksLikeInternalWorkspaceIdentifier(displayName)
	) {
		return WORKSPACE_DISPLAY_FALLBACK;
	}
	return displayName;
}

export function toggleProjectSelection(
	selectedProjectIds: string[],
	projectId: string,
	selected: boolean,
) {
	const current = new Set(selectedProjectIds);
	if (selected) current.add(projectId);
	else current.delete(projectId);
	return [...current];
}

export function selectedProjectsForDeletion(
	projects: Array<Pick<AdvancedCanvasProject, "id" | "name">>,
	selectedProjectIds: string[],
) {
	const selected = new Set(selectedProjectIds);
	return projects.filter((project) => selected.has(project.id));
}

function looksLikeInternalWorkspaceIdentifier(value: string) {
	return (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
			value,
		) ||
		/^(?:workspace|ws|tenant|organization|org)[_-][a-z0-9_-]+$/iu.test(value)
	);
}
