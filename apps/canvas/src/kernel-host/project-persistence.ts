import type {
	AdvancedCanvasProject,
	AdvancedCanvasRevision,
	CanvasGraph,
} from "@meiye/core/pro-studio";
import type { CanvasM1Action } from "../server/backend-port";
import {
	emptyKernelGraph,
	fromKernelGraph,
	type KernelSessionGraph,
	toKernelGraph,
} from "./graph-bridge";

export type CanvasCaller = <T>(
	action: CanvasM1Action,
	input?: Record<string, unknown>,
	options?: { idempotencyKey?: string },
) => Promise<T>;

export class DraftVersionConflictError extends Error {
	readonly code = "DRAFT_VERSION_CONFLICT" as const;

	constructor(message = "Draft already updated elsewhere.") {
		super(message);
		this.name = "DraftVersionConflictError";
	}
}

function isDraftVersionConflict(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code: unknown }).code === "DRAFT_VERSION_CONFLICT"
	);
}

/** Map BackendPort / client errors into a typed draft CAS conflict. */
export function mapDraftConflict(error: unknown): never {
	if (isDraftVersionConflict(error)) {
		const message =
			error instanceof Error && error.message
				? error.message
				: "Draft already updated elsewhere.";
		throw new DraftVersionConflictError(message);
	}
	throw error;
}

export class ProjectPersistenceAdapter {
	constructor(private readonly callCanvas: CanvasCaller) {}

	async listProjects(): Promise<AdvancedCanvasProject[]> {
		return this.callCanvas("listProjects");
	}

	async loadProject(projectId: string): Promise<{
		kernel: KernelSessionGraph;
		project: AdvancedCanvasProject;
		revisions: AdvancedCanvasRevision[];
	}> {
		const [project, revisions] = await Promise.all([
			this.callCanvas<AdvancedCanvasProject>("loadProject", { projectId }),
			this.listRevisions(projectId),
		]);
		return {
			kernel: toKernelGraph(project.graph),
			project,
			revisions,
		};
	}

	async saveDraft(
		projectId: string,
		expectedDraftVersion: number,
		kernelGraph: KernelSessionGraph,
	): Promise<AdvancedCanvasProject> {
		const graph: CanvasGraph = fromKernelGraph(kernelGraph);
		try {
			return await this.callCanvas("saveProjectDraft", {
				expectedDraftVersion,
				graph,
				projectId,
			});
		} catch (error) {
			mapDraftConflict(error);
		}
	}

	async createProject(name: string, kernel?: KernelSessionGraph) {
		return this.callCanvas<AdvancedCanvasProject>("createProject", {
			graph: fromKernelGraph(kernel ?? emptyKernelGraph()),
			name,
		});
	}

	async renameProject(projectId: string, name: string) {
		return this.callCanvas<AdvancedCanvasProject>("renameProject", {
			name,
			projectId,
		});
	}

	async duplicateProject(projectId: string, name?: string) {
		return this.callCanvas<AdvancedCanvasProject>("duplicateProject", {
			...(name ? { name } : {}),
			projectId,
		});
	}

	async deleteProject(projectId: string) {
		return this.callCanvas<{ projectId: string; retentionDays: number }>(
			"deleteProject",
			{ projectId },
		);
	}

	async createCheckpoint(input: {
		expectedDraftVersion: number;
		label?: string;
		projectId: string;
	}) {
		try {
			return await this.callCanvas("createCheckpoint", input);
		} catch (error) {
			mapDraftConflict(error);
		}
	}

	async restoreRevision(input: {
		expectedDraftVersion: number;
		projectId: string;
		revisionId: string;
	}): Promise<AdvancedCanvasProject> {
		try {
			return await this.callCanvas<AdvancedCanvasProject>(
				"restoreRevision",
				input,
			);
		} catch (error) {
			mapDraftConflict(error);
		}
	}

	async listRevisions(projectId: string): Promise<AdvancedCanvasRevision[]> {
		return this.callCanvas("listRevisions", { projectId });
	}

	async getRevision(
		projectId: string,
		revisionId: string,
	): Promise<AdvancedCanvasRevision> {
		return this.callCanvas("getRevision", { projectId, revisionId });
	}
}
