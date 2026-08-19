import { canonicalJson } from "../canonical-json.js";
import type { OperationsHotPathRepository } from "./operations-hot-path.js";
import { rankSearchDocuments } from "./search.js";
import type {
	OperationsWorkspaceState,
	RetrievalEvaluation,
	SearchDocument,
	SearchQuery,
	SearchResult,
	TemplateCatalogState,
} from "./types.js";

export interface ContentPackageRevisionConflictRecord {
	actorId: string;
	correlationId: string;
	currentRevision: number;
	expectedRevision: number;
	occurredAt: string;
	packageId: string;
	workspaceId: string;
}

/**
 * Write semantics shared by every OperationsRepository adapter: these
 * collections are append-only — an existing (workspaceId, id) row is never
 * updated by saveWorkspace (PostgreSQL: ON CONFLICT DO NOTHING; memory keeps
 * the stored row). Declared here so the memory double cannot drift from the
 * production adapter's rules.
 */
export const IMMUTABLE_WORKSPACE_COLLECTIONS = [
	"auditEvents",
	"creationEvents",
	"creativeAssets",
	"exportReceipts",
	"taskEvents",
	"taskSourceLinks",
	"weeklyFacts",
] as const;

export class ContentPackageRevisionConflictError extends Error {
	readonly code = "CONTENT_PACKAGE_REVISION_CONFLICT";
	readonly status = 409;

	constructor(
		public readonly packageId: string,
		public readonly expectedRevision: number,
		public readonly currentRevision: number,
	) {
		super(
			`ContentPackage ${packageId} expected revision ${expectedRevision}, current revision is ${currentRevision}.`,
		);
		this.name = "ContentPackageRevisionConflictError";
	}
}

export class TaskBlockingNodeConflictError extends Error {
	readonly code = "TASK_BLOCKING_NODE_CONFLICT";
	readonly status = 409;

	constructor(readonly taskId: string) {
		super(`Task ${taskId} already has a pending blocking node.`);
		this.name = "TaskBlockingNodeConflictError";
	}
}

export interface OperationsRepository {
	lockBriefRevisionContext(
		workspaceId: string,
		briefContextId: string,
	): Promise<number | null>;
	assertTaskHasNoPendingQuestion(
		workspaceId: string,
		taskId: string,
	): Promise<void>;
	withWorkspaceLock<T>(
		workspaceId: string,
		action: (repository: OperationsRepository) => Promise<T>,
	): Promise<T>;
	hasMembership(userId: string, workspaceId: string): Promise<boolean>;
	loadWorkspace(workspaceId: string): Promise<OperationsWorkspaceState | null>;
	saveWorkspace(state: OperationsWorkspaceState): Promise<void>;
	recordContentPackageRevisionConflict(
		conflict: ContentPackageRevisionConflictRecord,
	): Promise<void>;
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
	countSearchDocuments(workspaceId: string): Promise<number>;
	getSearchIndexSizeBytes(workspaceId: string): Promise<number>;
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

export function revisionConflictAuditId(
	conflict: Pick<
		ContentPackageRevisionConflictRecord,
		"correlationId" | "expectedRevision" | "packageId"
	>,
) {
	return `content-package-revision-conflict:${conflict.packageId}:${conflict.expectedRevision}:${conflict.correlationId}`;
}

export class MemoryOperationsRepository implements OperationsRepository {
	private readonly memberships = new Set<string>();
	private readonly states = new Map<string, OperationsWorkspaceState>();
	private readonly searchIndex = new Map<string, Map<string, SearchDocument>>();
	private readonly searchProjectionHeads = new Map<string, string>();
	private readonly evaluations = new Map<string, RetrievalEvaluation[]>();
	private readonly locks = new Map<string, Promise<void>>();
	private readonly pendingQuestionTasks = new Set<string>();
	private catalog: TemplateCatalogState = {
		commandReceipts: [],
		templates: [],
		versionLifecycle: [],
		versions: [],
	};

	grantMembership(userId: string, workspaceId: string) {
		this.memberships.add(`${userId}:${workspaceId}`);
	}

	seedPendingQuestion(workspaceId: string, taskId: string) {
		this.pendingQuestionTasks.add(`${workspaceId}:${taskId}`);
	}

	async lockBriefRevisionContext() {
		return null;
	}

	async assertTaskHasNoPendingQuestion(workspaceId: string, taskId: string) {
		if (this.pendingQuestionTasks.has(`${workspaceId}:${taskId}`)) {
			throw new TaskBlockingNodeConflictError(taskId);
		}
	}

	private async enqueueLock<T>(key: string, action: () => Promise<T>): Promise<T> {
		const previous = this.locks.get(key) ?? Promise.resolve();
		let release = () => {};
		const current = new Promise<void>((resolve) => {
			release = resolve;
		});
		this.locks.set(
			key,
			previous.then(() => current),
		);
		await previous;
		try {
			return await action();
		} finally {
			release();
			if (this.locks.get(key) === current) this.locks.delete(key);
		}
	}

	async withWorkspaceLock<T>(
		workspaceId: string,
		action: (repository: OperationsRepository) => Promise<T>,
	): Promise<T> {
		return this.enqueueLock(workspaceId, () => action(this));
	}

	async withHotPathLock<T>(
		workspaceId: string,
		scope: string,
		action: (repository: OperationsHotPathRepository) => Promise<T>,
	): Promise<T> {
		return this.enqueueLock(`${workspaceId}:${scope}`, () => action(this));
	}

	async hasMembership(userId: string, workspaceId: string) {
		return this.memberships.has(`${userId}:${workspaceId}`);
	}

	async loadWorkspace(workspaceId: string) {
		const state = this.states.get(workspaceId);
		return state ? clone(state) : null;
	}

	/**
	 * Test fixture backdoor: install workspace state verbatim, bypassing the
	 * production write protocol (the PostgreSQL equivalent is a raw INSERT in a
	 * test). Production code paths must use saveWorkspace.
	 */
	seedWorkspace(state: OperationsWorkspaceState) {
		this.states.set(state.workspaceId, clone(state));
	}

	async saveWorkspace(state: OperationsWorkspaceState) {
		// Mirror the production adapter's write semantics instead of
		// last-write-wins, so a test that passes here cannot fail in Postgres:
		// append-only collections keep the stored row on id conflict
		// (ON CONFLICT DO NOTHING), and ContentPackage writes follow the
		// aggregate revision protocol including its 409 conflict.
		const previous = this.states.get(state.workspaceId);
		const next = clone(state);
		if (previous) {
			for (const collection of IMMUTABLE_WORKSPACE_COLLECTIONS) {
				const stored = previous[collection] as Array<{ id: string }>;
				const storedById = new Map(stored.map((row) => [row.id, row]));
				(next[collection] as Array<{ id: string }>) = (
					next[collection] as Array<{ id: string }>
				).map((row) => storedById.get(row.id) ?? row);
			}
		}
		const previousPackages = new Map(
			(previous?.contentPackages ?? []).map((row) => [row.id, row]),
		);
		for (const row of next.contentPackages) {
			const revision = row.revision;
			if (!Number.isSafeInteger(revision) || revision < 0) {
				throw new Error(
					`ContentPackage ${row.id} has an invalid aggregate revision.`,
				);
			}
			const stored = previousPackages.get(row.id);
			if (!stored) {
				if (revision !== 0) {
					throw new ContentPackageRevisionConflictError(
						row.id,
						revision - 1,
						-1,
					);
				}
				continue;
			}
			if (
				stored.revision === revision &&
				canonicalJson(stored) === canonicalJson(row)
			) {
				continue;
			}
			if (stored.revision !== revision - 1) {
				throw new ContentPackageRevisionConflictError(
					row.id,
					revision - 1,
					stored.revision ?? -1,
				);
			}
		}
		this.states.set(state.workspaceId, next);
	}

	async recordContentPackageRevisionConflict(
		conflict: ContentPackageRevisionConflictRecord,
	) {
		const state = this.states.get(conflict.workspaceId);
		if (!state) return;
		const id = revisionConflictAuditId(conflict);
		if (state.auditEvents.some((event) => event.id === id)) return;
		state.auditEvents.push({
			action: "content_package.revision_conflict",
			actorId: conflict.actorId,
			correlationId: conflict.correlationId,
			createdAt: conflict.occurredAt,
			details: {
				correlationId: conflict.correlationId,
				currentRevision: conflict.currentRevision,
				expectedRevision: conflict.expectedRevision,
			},
			entityId: conflict.packageId,
			entityType: "content_package",
			id,
			workspaceId: conflict.workspaceId,
		});
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

	async countSearchDocuments(workspaceId: string) {
		return this.searchIndex.get(workspaceId)?.size ?? 0;
	}

	async getSearchIndexSizeBytes(workspaceId: string) {
		return Buffer.byteLength(
			JSON.stringify([...(this.searchIndex.get(workspaceId)?.values() ?? [])]),
			"utf8",
		);
	}

	async getContentPackage(workspaceId: string, packageId: string) {
		const row = this.states
			.get(workspaceId)
			?.contentPackages.find((item) => item.id === packageId);
		return row ? clone(row) : null;
	}

	async listContentPackages(workspaceId: string) {
		return cloneCollection(this.states.get(workspaceId)?.contentPackages);
	}

	async saveContentPackageRevision(input: {
		auditEvents?: OperationsWorkspaceState["auditEvents"];
		contentPackage: OperationsWorkspaceState["contentPackages"][number];
		expectedRevision: number;
	}) {
		const workspaceId = input.contentPackage.workspaceId;
		const state = this.states.get(workspaceId);
		if (!state) {
			throw new ContentPackageRevisionConflictError(
				input.contentPackage.id,
				input.expectedRevision,
				-1,
			);
		}
		const index = state.contentPackages.findIndex(
			(item) => item.id === input.contentPackage.id,
		);
		const stored = state.contentPackages[index];
		if (!stored) {
			throw new ContentPackageRevisionConflictError(
				input.contentPackage.id,
				input.expectedRevision,
				-1,
			);
		}
		if (
			stored.revision === input.contentPackage.revision &&
			canonicalJson(stored) === canonicalJson(input.contentPackage)
		) {
			this.appendAuditEvents(state, input.auditEvents);
			return clone(stored);
		}
		if (stored.revision !== input.expectedRevision) {
			throw new ContentPackageRevisionConflictError(
				input.contentPackage.id,
				input.expectedRevision,
				stored.revision,
			);
		}
		if (input.contentPackage.revision !== input.expectedRevision + 1) {
			throw new ContentPackageRevisionConflictError(
				input.contentPackage.id,
				input.expectedRevision,
				stored.revision,
			);
		}
		state.contentPackages[index] = clone(input.contentPackage);
		this.appendAuditEvents(state, input.auditEvents);
		return clone(state.contentPackages[index]!);
	}

	async listCreativeWorks(workspaceId: string) {
		return cloneCollection(this.states.get(workspaceId)?.creativeWorks);
	}

	async listCreativeJobs(workspaceId: string) {
		return cloneCollection(this.states.get(workspaceId)?.creativeJobs);
	}

	async listCreativeAssets(workspaceId: string) {
		return cloneCollection(this.states.get(workspaceId)?.creativeAssets);
	}

	async listTasks(workspaceId: string) {
		return cloneCollection(this.states.get(workspaceId)?.tasks);
	}

	async listTaskEvents(workspaceId: string) {
		return cloneCollection(this.states.get(workspaceId)?.taskEvents);
	}

	async listLegacyCanvasWorks(workspaceId: string) {
		return cloneCollection(this.states.get(workspaceId)?.works);
	}

	async listAuditEvents(workspaceId: string, action?: string) {
		const events = this.states.get(workspaceId)?.auditEvents ?? [];
		return clone(
			action
				? events.filter((event) => event.action === action)
				: events,
		);
	}

	async appendAuditEvent(
		event: OperationsWorkspaceState["auditEvents"][number],
	) {
		const state = this.states.get(event.workspaceId);
		if (!state) return;
		this.appendAuditEvents(state, [event]);
	}

	private appendAuditEvents(
		state: OperationsWorkspaceState,
		events: OperationsWorkspaceState["auditEvents"] | undefined,
	) {
		if (!events?.length) return;
		const existing = new Set(state.auditEvents.map((event) => event.id));
		for (const event of events) {
			if (existing.has(event.id)) continue;
			state.auditEvents.push(clone(event));
			existing.add(event.id);
		}
	}
}

function cloneCollection<T>(values: readonly T[] | undefined): T[] {
	return clone([...(values ?? [])]);
}
