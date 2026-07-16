import { rankSearchDocuments } from "./search.js";
import type {
	CanvasImageJob,
	OperationsWorkspaceState,
	RetrievalEvaluation,
	SearchDocument,
	SearchQuery,
	SearchResult,
	TemplateCatalogState,
} from "./types.js";

export interface OperationsRepository {
	withWorkspaceLock<T>(
		workspaceId: string,
		action: (repository: OperationsRepository) => Promise<T>,
	): Promise<T>;
	hasMembership(userId: string, workspaceId: string): Promise<boolean>;
	loadWorkspace(workspaceId: string): Promise<OperationsWorkspaceState | null>;
	saveWorkspace(state: OperationsWorkspaceState): Promise<void>;
	getLatestCanvasImageJob(
		workspaceId: string,
		workId: string,
	): Promise<CanvasImageJob | null>;
	loadTemplateCatalog(): Promise<TemplateCatalogState>;
	loadTemplateCatalogHistory(
		templateId?: string,
	): Promise<TemplateCatalogState>;
	saveTemplateCatalog(catalog: TemplateCatalogState): Promise<void>;
	upsertSearchDocument(document: SearchDocument): Promise<void>;
	replaceSearchDocuments(
		workspaceId: string,
		kinds: SearchDocument["kind"][],
		documents: SearchDocument[],
		snapshotUpdatedAt: string,
		projectionOwner: string,
	): Promise<void>;
	deleteSearchDocument(
		workspaceId: string,
		kind: SearchDocument["kind"],
		id: string,
	): Promise<void>;
	searchDocuments(
		workspaceId: string,
		query: SearchQuery,
	): Promise<SearchResult[]>;
	searchSnapshot(
		workspaceId: string,
		queries: SearchQuery[],
	): Promise<{
		results: SearchResult[][];
		documentCount: number;
		indexSizeBytes: number;
		indexMode: RetrievalEvaluation["indexMode"];
		templateCatalog: TemplateCatalogState;
	}>;
	saveRetrievalEvaluation(evaluation: RetrievalEvaluation): Promise<void>;
	getRetrievalEvaluation(
		workspaceId: string,
		revision: string,
	): Promise<RetrievalEvaluation | null>;
	getLatestRetrievalEvaluation(
		workspaceId: string,
	): Promise<RetrievalEvaluation | null>;
	countSearchDocuments(workspaceId: string): Promise<number>;
	getSearchIndexSizeBytes(workspaceId: string): Promise<number>;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

export class MemoryOperationsRepository implements OperationsRepository {
	private readonly memberships = new Set<string>();
	private readonly states = new Map<string, OperationsWorkspaceState>();
	private readonly searchIndex = new Map<string, Map<string, SearchDocument>>();
	private readonly searchProjectionHeads = new Map<string, string>();
	private readonly evaluations = new Map<string, RetrievalEvaluation[]>();
	private readonly locks = new Map<string, Promise<void>>();
	private catalog: TemplateCatalogState = {
		commandReceipts: [],
		templates: [],
		versionLifecycle: [],
		versions: [],
	};

	grantMembership(userId: string, workspaceId: string) {
		this.memberships.add(`${userId}:${workspaceId}`);
	}

	async withWorkspaceLock<T>(
		workspaceId: string,
		action: (repository: OperationsRepository) => Promise<T>,
	): Promise<T> {
		const previous = this.locks.get(workspaceId) ?? Promise.resolve();
		let release = () => {};
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.locks.set(
			workspaceId,
			previous.then(() => current),
		);
		await previous;
		try {
			return await action(this);
		} finally {
			release();
			if (this.locks.get(workspaceId) === current)
				this.locks.delete(workspaceId);
		}
	}

	async hasMembership(userId: string, workspaceId: string) {
		return this.memberships.has(`${userId}:${workspaceId}`);
	}

	async loadWorkspace(workspaceId: string) {
		const state = this.states.get(workspaceId);
		return state ? clone(state) : null;
	}

	async saveWorkspace(state: OperationsWorkspaceState) {
		this.states.set(state.workspaceId, clone(state));
	}

	async getLatestCanvasImageJob(workspaceId: string, workId: string) {
		const terminalStatuses = new Set<CanvasImageJob["status"]>([
			"cancelled",
			"completed",
			"failed",
		]);
		const jobs = this.states
			.get(workspaceId)
			?.imageJobs.filter(
				(job) => job.origin.kind === "layout_work" && job.origin.id === workId,
			)
			.sort(
				(left, right) =>
					Number(terminalStatuses.has(left.status)) -
						Number(terminalStatuses.has(right.status)) ||
					right.createdAt.localeCompare(left.createdAt) ||
					right.id.localeCompare(left.id),
			);
		return jobs?.[0] ? clone(jobs[0]) : null;
	}

	async loadTemplateCatalog() {
		return clone(this.catalog);
	}

	async loadTemplateCatalogHistory(templateId?: string) {
		const catalog = clone(this.catalog);
		if (!templateId) return catalog;
		return {
			commandReceipts: catalog.commandReceipts,
			templates: catalog.templates.filter(
				(template) => template.id === templateId,
			),
			versionLifecycle: catalog.versionLifecycle.filter(
				(event) => event.templateId === templateId,
			),
			versions: catalog.versions.filter(
				(version) => version.templateId === templateId,
			),
		};
	}

	async saveTemplateCatalog(catalog: TemplateCatalogState) {
		const existingVersions = new Map(
			this.catalog.versions.map((version) => [version.id, version]),
		);
		const nextVersions = new Map(
			catalog.versions.map((version) => [version.id, version]),
		);
		for (const versionId of existingVersions.keys()) {
			if (!nextVersions.has(versionId)) {
				throw new Error(`Template version ${versionId} cannot be deleted.`);
			}
		}
		for (const version of catalog.versions) {
			const existing = existingVersions.get(version.id);
			if (existing && JSON.stringify(existing) !== JSON.stringify(version)) {
				throw new Error(`Template version ${version.id} is immutable.`);
			}
		}
		const immutableCollections = [
			[this.catalog.versionLifecycle, catalog.versionLifecycle],
		] as const;
		for (const [existingItems, nextItems] of immutableCollections) {
			const existingById = new Map(
				existingItems.map((item) => [item.id, item]),
			);
			const nextById = new Map(nextItems.map((item) => [item.id, item]));
			for (const itemId of existingById.keys()) {
				if (!nextById.has(itemId)) {
					throw new Error(
						`Immutable catalog fact ${itemId} cannot be deleted.`,
					);
				}
			}
			for (const item of nextItems) {
				const existing = existingById.get(item.id);
				if (existing && JSON.stringify(existing) !== JSON.stringify(item)) {
					throw new Error(`Immutable catalog fact ${item.id} changed.`);
				}
			}
		}
		this.catalog = clone(catalog);
	}

	async upsertSearchDocument(document: SearchDocument) {
		const workspace = this.searchIndex.get(document.workspaceId) ?? new Map();
		const key = `${document.kind}:${document.id}`;
		const existing = workspace.get(key);
		if (!existing || document.updatedAt >= existing.updatedAt) {
			workspace.set(key, clone(document));
		}
		this.searchIndex.set(document.workspaceId, workspace);
	}

	async replaceSearchDocuments(
		workspaceId: string,
		kinds: SearchDocument["kind"][],
		documents: SearchDocument[],
		snapshotUpdatedAt: string,
		projectionOwner: string,
	) {
		if (
			documents.some(
				(document) =>
					document.workspaceId !== workspaceId ||
					!kinds.includes(document.kind) ||
					document.metadata.projectionOwner !== projectionOwner,
			)
		) {
			throw new Error(
				"Search projection snapshot is outside its workspace or kinds.",
			);
		}
		const headKey = `${workspaceId}:${projectionOwner}:${[...kinds].sort().join(",")}`;
		const currentHead = this.searchProjectionHeads.get(headKey);
		if (currentHead && snapshotUpdatedAt < currentHead) return;
		const workspace = this.searchIndex.get(workspaceId) ?? new Map();
		for (const [key, document] of workspace) {
			if (
				kinds.includes(document.kind) &&
				document.metadata.projectionOwner === projectionOwner
			) {
				workspace.delete(key);
			}
		}
		for (const document of documents) {
			workspace.set(`${document.kind}:${document.id}`, clone(document));
		}
		this.searchIndex.set(workspaceId, workspace);
		this.searchProjectionHeads.set(headKey, snapshotUpdatedAt);
	}

	async deleteSearchDocument(
		workspaceId: string,
		kind: SearchDocument["kind"],
		id: string,
	) {
		this.searchIndex.get(workspaceId)?.delete(`${kind}:${id}`);
	}

	async searchDocuments(workspaceId: string, query: SearchQuery) {
		return rankSearchDocuments(
			[...(this.searchIndex.get(workspaceId)?.values() ?? [])],
			query,
		);
	}

	async searchSnapshot(workspaceId: string, queries: SearchQuery[]) {
		const documents = [
			...(this.searchIndex.get(workspaceId)?.values() ?? []),
		].map(clone);
		return {
			documentCount: documents.length,
			indexSizeBytes: Buffer.byteLength(JSON.stringify(documents), "utf8"),
			indexMode: "memory-bigram-trigram" as const,
			results: queries.map((query) => rankSearchDocuments(documents, query)),
			templateCatalog: clone(this.catalog),
		};
	}

	async saveRetrievalEvaluation(evaluation: RetrievalEvaluation) {
		const values = this.evaluations.get(evaluation.workspaceId) ?? [];
		const existing = values.find((item) => item.id === evaluation.id);
		if (!existing) values.push(clone(evaluation));
		this.evaluations.set(evaluation.workspaceId, values);
	}

	async getRetrievalEvaluation(workspaceId: string, revision: string) {
		const value = this.evaluations
			.get(workspaceId)
			?.find((evaluation) => evaluation.revision === revision);
		return value ? clone(value) : null;
	}

	async getLatestRetrievalEvaluation(workspaceId: string) {
		const value = [...(this.evaluations.get(workspaceId) ?? [])].sort(
			(left, right) => right.createdAt.localeCompare(left.createdAt),
		)[0];
		return value ? clone(value) : null;
	}

	async countSearchDocuments(workspaceId: string) {
		return this.searchIndex.get(workspaceId)?.size ?? 0;
	}

	async getSearchIndexSizeBytes(workspaceId: string) {
		return Buffer.byteLength(
			JSON.stringify([...(this.searchIndex.get(workspaceId)?.values() ?? [])]),
			"utf8",
		);
	}
}
