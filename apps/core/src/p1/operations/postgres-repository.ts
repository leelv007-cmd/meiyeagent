import type { Pool, PoolClient, QueryResultRow } from "pg";
import { chineseBigrams, mapProductSearchQuery } from "./search.js";
import type { OperationsRepository } from "./repository.js";
import type {
	CanvasImageJob,
	OperationsWorkspaceState,
	RetrievalEvaluation,
	SearchDocument,
	SearchQuery,
	SearchResult,
	TemplateCatalogState,
} from "./types.js";

interface PostgresCapabilities {
	trigram: boolean;
}

const WORKSPACE_TABLES = {
	auditEvents: "p1_operations_audit_events",
	commandReceipts: "p1_operations_command_receipts",
	creationEvents: "p1_creation_events",
	contentPackages: "p1_content_packages",
	creativeAssets: "p1_creative_assets",
	creativeContents: "p1_creative_contents",
	creativeJobs: "p1_creative_jobs",
	creativeWorks: "p1_creative_works",
	exportReceipts: "p1_export_receipts",
	imageJobs: "p1_canvas_image_jobs",
	taskEvents: "p1_task_events",
	taskSourceLinks: "p1_task_source_links",
	tasks: "p1_content_tasks",
	templateShortcuts: "p1_template_shortcuts",
	triggerConfigs: "p1_trigger_configs",
	triggerRuns: "p1_trigger_runs",
	userTemplates: "p1_user_templates",
	weeklyFacts: "p1_weekly_facts",
	weeklyReviews: "p1_weekly_reviews",
	weeklyBatchExecutions: "p1_weekly_batch_executions",
	works: "p1_canvas_works",
} as const;

const MUTABLE_COLLECTIONS = new Set<keyof typeof WORKSPACE_TABLES>([
	"commandReceipts",
	"contentPackages",
	"creativeContents",
	"creativeJobs",
	"creativeWorks",
	"imageJobs",
	"tasks",
	"templateShortcuts",
	"triggerConfigs",
	"triggerRuns",
	"userTemplates",
	"weeklyReviews",
	"weeklyBatchExecutions",
	"works",
]);

export class PostgresOperationsRepository implements OperationsRepository {
	constructor(
		private readonly pool: Pool,
		private readonly transactionClient?: PoolClient,
		private readonly capabilities: PostgresCapabilities = { trigram: false },
	) {}

	private get database() {
		return this.transactionClient ?? this.pool;
	}

	async migrate(client?: PoolClient) {
		const database = client ?? this.database;
		if (client) {
			await database.query("SAVEPOINT p1_operations_pg_trgm");
			try {
				await database.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
				await database.query("RELEASE SAVEPOINT p1_operations_pg_trgm");
				this.capabilities.trigram = true;
			} catch {
				await database.query("ROLLBACK TO SAVEPOINT p1_operations_pg_trgm");
				await database.query("RELEASE SAVEPOINT p1_operations_pg_trgm");
				this.capabilities.trigram = false;
			}
		} else {
			try {
				await database.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
				this.capabilities.trigram = true;
			} catch {
				this.capabilities.trigram = false;
			}
		}

		await database.query(`
      CREATE TABLE IF NOT EXISTS p1_content_tasks (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_content_tasks_workspace_updated_idx
        ON p1_content_tasks (workspace_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS p1_task_events (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_task_events_workspace_created_idx
        ON p1_task_events (workspace_id, updated_at);

      CREATE TABLE IF NOT EXISTS p1_task_source_links (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_trigger_configs (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_trigger_runs (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_weekly_facts (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_weekly_reviews (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_weekly_batch_executions (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_weekly_batch_executions_task_idx
        ON p1_weekly_batch_executions
        (workspace_id, ((payload ->> 'taskId')), updated_at DESC);
      CREATE TABLE IF NOT EXISTS p1_canvas_works (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_user_templates (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_template_shortcuts (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_export_receipts (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_canvas_image_jobs (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      UPDATE p1_canvas_image_jobs
         SET payload = (payload - 'workId' - 'workRevisionId') ||
             jsonb_build_object(
               'origin',
               jsonb_build_object(
                 'kind', 'layout_work',
                 'id', payload->>'workId',
                 'revisionId', payload->>'workRevisionId'
               )
             )
       WHERE payload->'origin' IS NULL
         AND payload->>'workId' IS NOT NULL
         AND payload->>'workRevisionId' IS NOT NULL;
      DROP INDEX IF EXISTS p1_canvas_image_jobs_work_created_idx;
      CREATE INDEX IF NOT EXISTS p1_canvas_image_jobs_origin_created_idx
        ON p1_canvas_image_jobs
        (
          workspace_id,
          ((payload->'origin'->>'kind')),
          ((payload->'origin'->>'id')),
          ((payload->>'createdAt')) DESC
        );
      CREATE TABLE IF NOT EXISTS p1_operations_audit_events (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_operations_command_receipts (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );

      CREATE TABLE IF NOT EXISTS p1_creative_works (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_creative_works_session_updated_idx
        ON p1_creative_works
        (workspace_id, ((payload->>'sessionId')), updated_at DESC);
      CREATE TABLE IF NOT EXISTS p1_creative_jobs (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_creative_jobs_work_updated_idx
        ON p1_creative_jobs
        (workspace_id, ((payload->>'workId')), updated_at DESC);
      CREATE TABLE IF NOT EXISTS p1_creative_assets (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_creative_contents (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_creative_contents_work_updated_idx
        ON p1_creative_contents
        (workspace_id, ((payload->>'workId')), updated_at DESC);
      CREATE TABLE IF NOT EXISTS p1_content_packages (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_content_packages_status_updated_idx
        ON p1_content_packages
        (workspace_id, ((payload->>'status')), updated_at DESC);
      CREATE TABLE IF NOT EXISTS p1_creation_events (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );

      CREATE TABLE IF NOT EXISTS p1_official_templates (
        id text PRIMARY KEY,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS p1_template_versions (
        id text PRIMARY KEY,
        template_id text NOT NULL,
        revision integer NOT NULL,
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL,
        UNIQUE (template_id, revision)
      );
      CREATE TABLE IF NOT EXISTS p1_template_version_lifecycle (
        id text PRIMARY KEY,
        template_id text NOT NULL,
        version_id text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_template_version_lifecycle_version_idx
        ON p1_template_version_lifecycle (template_id, version_id, occurred_at);
      CREATE UNIQUE INDEX IF NOT EXISTS p1_template_version_lifecycle_sequence_idx
        ON p1_template_version_lifecycle (version_id, ((payload->>'sequence')::integer));
      CREATE TABLE IF NOT EXISTS p1_template_command_receipts (
        id text PRIMARY KEY,
        workspace_id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p1_search_documents (
        workspace_id text NOT NULL,
        id text NOT NULL,
        kind text NOT NULL,
        title text NOT NULL,
        search_text text NOT NULL,
        tags text[] NOT NULL DEFAULT '{}',
        metadata jsonb NOT NULL DEFAULT '{}',
        search_tokens text[] NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, kind, id)
      );
      CREATE INDEX IF NOT EXISTS p1_search_documents_workspace_kind_idx
        ON p1_search_documents (workspace_id, kind, updated_at DESC);
      CREATE INDEX IF NOT EXISTS p1_search_documents_fts_idx
        ON p1_search_documents USING gin (to_tsvector('simple', search_text));
      CREATE INDEX IF NOT EXISTS p1_search_documents_tags_idx
        ON p1_search_documents USING gin (tags);
      CREATE INDEX IF NOT EXISTS p1_search_documents_tokens_idx
        ON p1_search_documents USING gin (search_tokens);

      CREATE TABLE IF NOT EXISTS p1_search_projection_heads (
        workspace_id text NOT NULL,
        projection_key text NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, projection_key)
      );

      CREATE TABLE IF NOT EXISTS p1_retrieval_evaluations (
        workspace_id text NOT NULL,
        id text NOT NULL,
        revision text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_retrieval_evaluations_revision_idx
        ON p1_retrieval_evaluations (workspace_id, revision, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS p1_retrieval_evaluations_workspace_revision_idx
        ON p1_retrieval_evaluations (workspace_id, revision);
		`);
		if (this.capabilities.trigram) {
			await database.query(`
        CREATE INDEX IF NOT EXISTS p1_search_documents_trgm_idx
          ON p1_search_documents USING gin (search_text gin_trgm_ops)
      `);
		}
	}

	async withWorkspaceLock<T>(
		workspaceId: string,
		action: (repository: OperationsRepository) => Promise<T>,
	): Promise<T> {
		if (this.transactionClient) return action(this);
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
				workspaceId,
			]);
			const result = await action(
				new PostgresOperationsRepository(this.pool, client, this.capabilities),
			);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	private async withReadSnapshot<T>(
		action: (repository: PostgresOperationsRepository) => Promise<T>,
	): Promise<T> {
		if (this.transactionClient) return action(this);
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
			const result = await action(
				new PostgresOperationsRepository(this.pool, client, this.capabilities),
			);
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}

	async hasMembership(userId: string, workspaceId: string) {
		const result = await this.database.query(
			`SELECT 1
         FROM workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2
        LIMIT 1`,
			[workspaceId, userId],
		);
		return result.rowCount === 1;
	}

	private async readRows<T>(table: string, workspaceId: string) {
		const result = await this.database.query<{ payload: T }>(
			`SELECT payload FROM ${table} WHERE workspace_id = $1 ORDER BY updated_at, id`,
			[workspaceId],
		);
		return result.rows.map((row) => row.payload);
	}

	async loadWorkspace(
		workspaceId: string,
	): Promise<OperationsWorkspaceState | null> {
		if (!this.transactionClient) {
			return this.withReadSnapshot((repository) =>
				repository.loadWorkspace(workspaceId),
			);
		}
		const entries: Array<[string, unknown[]]> = [];
		for (const [collection, table] of Object.entries(WORKSPACE_TABLES)) {
			entries.push([
				collection,
				await this.readRows<unknown>(table, workspaceId),
			]);
		}
		const collections = Object.fromEntries(entries) as Omit<
			OperationsWorkspaceState,
			"workspaceId"
		>;
		if (Object.values(collections).every((values) => values.length === 0)) {
			return null;
		}
		return { ...collections, workspaceId } as OperationsWorkspaceState;
	}

	private async saveRows(
		table: string,
		workspaceId: string,
		rows: Array<Record<string, unknown>>,
		mutable: boolean,
		identity: (row: Record<string, unknown>, index: number) => string,
	) {
		for (const [index, row] of rows.entries()) {
			const id = identity(row, index);
			const updatedAt =
				(typeof row.updatedAt === "string" && row.updatedAt) ||
				(typeof row.createdAt === "string" && row.createdAt) ||
				new Date().toISOString();
			await this.database.query(
				`INSERT INTO ${table} (workspace_id, id, payload, updated_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)
         ON CONFLICT (workspace_id, id) DO ${
						mutable
							? "UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at"
							: "NOTHING"
					}`,
				[workspaceId, id, JSON.stringify(row), updatedAt],
			);
		}
	}

	async saveWorkspace(state: OperationsWorkspaceState) {
		for (const [collection, table] of Object.entries(WORKSPACE_TABLES) as Array<
			[keyof typeof WORKSPACE_TABLES, string]
		>) {
			const rows = state[collection] as unknown as Array<
				Record<string, unknown>
			>;
			if (collection === "templateShortcuts") {
				await this.database.query(
					"DELETE FROM p1_template_shortcuts WHERE workspace_id = $1",
					[state.workspaceId],
				);
			}
			await this.saveRows(
				table,
				state.workspaceId,
				rows,
				MUTABLE_COLLECTIONS.has(collection),
				(row, index) =>
					typeof row.id === "string"
						? row.id
						: `${String(row.templateId ?? row.userTemplateId ?? "shortcut")}:${index}`,
			);
		}
	}

	async getLatestCanvasImageJob(workspaceId: string, workId: string) {
		const result = await this.database.query<{ payload: CanvasImageJob }>(
			`SELECT payload
         FROM p1_canvas_image_jobs
        WHERE workspace_id = $1
          AND payload->'origin'->>'kind' = 'layout_work'
          AND payload->'origin'->>'id' = $2
        ORDER BY CASE
                   WHEN payload->>'status' IN ('cancelled', 'completed', 'failed')
                     THEN 1
                   ELSE 0
                 END,
                 payload->>'createdAt' DESC,
                 id DESC
        LIMIT 1`,
			[workspaceId, workId],
		);
		return result.rows[0]?.payload ?? null;
	}

	async loadTemplateCatalog(): Promise<TemplateCatalogState> {
		return this.loadTemplateCatalogHistory();
	}

	async loadTemplateCatalogHistory(
		templateId?: string,
	): Promise<TemplateCatalogState> {
		if (!this.transactionClient) {
			return this.withReadSnapshot((repository) =>
				repository.loadTemplateCatalogHistory(templateId),
			);
		}
		const templates = await this.database.query<{
			payload: TemplateCatalogState["templates"][number];
		}>(
			`SELECT payload
         FROM p1_official_templates
         WHERE $1::text IS NULL OR id = $1
         ORDER BY id`,
			[templateId ?? null],
		);
		const versions = await this.database.query<{
			payload: TemplateCatalogState["versions"][number];
		}>(
			`SELECT payload
         FROM p1_template_versions
         WHERE $1::text IS NULL OR template_id = $1
         ORDER BY template_id, revision`,
			[templateId ?? null],
		);
		const versionLifecycle = await this.database.query<{
			payload: TemplateCatalogState["versionLifecycle"][number];
		}>(
			`SELECT payload
         FROM p1_template_version_lifecycle
         WHERE $1::text IS NULL OR template_id = $1
         ORDER BY template_id, version_id,
                  COALESCE((payload->>'sequence')::integer, 0),
                  occurred_at, id`,
			[templateId ?? null],
		);
		const commandReceipts = await this.database.query<{
			payload: TemplateCatalogState["commandReceipts"][number];
		}>(
			`SELECT payload
         FROM p1_template_command_receipts
         ORDER BY created_at, id`,
		);
		return {
			commandReceipts: commandReceipts.rows.map((row) => row.payload),
			templates: templates.rows.map((row) => row.payload),
			versionLifecycle: versionLifecycle.rows.map((row) => row.payload),
			versions: versions.rows.map((row) => row.payload),
		};
	}

	async saveTemplateCatalog(catalog: TemplateCatalogState) {
		for (const template of catalog.templates) {
			await this.database.query(
				`INSERT INTO p1_official_templates (id, payload, updated_at)
         VALUES ($1, $2::jsonb, $3::timestamptz)
         ON CONFLICT (id) DO UPDATE
         SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at`,
				[template.id, JSON.stringify(template), template.updatedAt],
			);
		}
		for (const version of catalog.versions) {
			await this.database.query(
				`INSERT INTO p1_template_versions
           (id, template_id, revision, payload, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
				[
					version.id,
					version.templateId,
					version.revision,
					JSON.stringify(version),
					version.publishedAt ?? version.createdAt,
				],
			);
		}
		for (const event of catalog.versionLifecycle) {
			await this.database.query(
				`INSERT INTO p1_template_version_lifecycle
           (id, template_id, version_id, payload, occurred_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
         ON CONFLICT (id) DO NOTHING`,
				[
					event.id,
					event.templateId,
					event.versionId,
					JSON.stringify(event),
					event.occurredAt,
				],
			);
		}
		for (const receipt of catalog.commandReceipts) {
			await this.database.query(
				`INSERT INTO p1_template_command_receipts
           (id, workspace_id, payload, created_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)
         ON CONFLICT (id) DO UPDATE
         SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
				[
					receipt.id,
					receipt.workspaceId,
					JSON.stringify(receipt),
					receipt.createdAt,
				],
			);
		}
	}

	async upsertSearchDocument(document: SearchDocument) {
		const searchText = `${document.title} ${document.text} ${document.tags.join(" ")}`;
		await this.database.query(
			`INSERT INTO p1_search_documents
         (workspace_id, id, kind, title, search_text, tags, metadata,
          search_tokens, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7::jsonb, $8::text[], $9)
       ON CONFLICT (workspace_id, kind, id) DO UPDATE
       SET title = EXCLUDED.title,
           search_text = EXCLUDED.search_text,
           tags = EXCLUDED.tags,
           metadata = EXCLUDED.metadata,
           search_tokens = EXCLUDED.search_tokens,
           updated_at = EXCLUDED.updated_at
       WHERE EXCLUDED.updated_at >= p1_search_documents.updated_at`,
			[
				document.workspaceId,
				document.id,
				document.kind,
				document.title,
				searchText,
				document.tags,
				JSON.stringify(document.metadata),
				chineseBigrams(searchText),
				document.updatedAt,
			],
		);
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
		const projectionKey = `${projectionOwner}:${[...kinds].sort().join(",")}`;
		const accepted = await this.database.query(
			`INSERT INTO p1_search_projection_heads
         (workspace_id, projection_key, updated_at)
       VALUES ($1, $2, $3::timestamptz)
       ON CONFLICT (workspace_id, projection_key) DO UPDATE
       SET updated_at = EXCLUDED.updated_at
       WHERE EXCLUDED.updated_at >= p1_search_projection_heads.updated_at
       RETURNING 1`,
			[workspaceId, projectionKey, snapshotUpdatedAt],
		);
		if (accepted.rowCount !== 1) return;
		await this.database.query(
			`DELETE FROM p1_search_documents
        WHERE workspace_id = $1 AND kind = ANY($2::text[])
          AND metadata->>'projectionOwner' = $3`,
			[workspaceId, kinds, projectionOwner],
		);
		for (const document of documents) {
			await this.upsertSearchDocument(document);
		}
	}

	async deleteSearchDocument(
		workspaceId: string,
		kind: SearchDocument["kind"],
		id: string,
	) {
		await this.database.query(
			`DELETE FROM p1_search_documents
        WHERE workspace_id = $1 AND kind = $2 AND id = $3`,
			[workspaceId, kind, id],
		);
	}

	async searchDocuments(
		workspaceId: string,
		query: SearchQuery,
	): Promise<SearchResult[]> {
		const values: unknown[] = [workspaceId];
		const clauses = ["workspace_id = $1"];
		if (query.kinds?.length) {
			values.push(query.kinds);
			clauses.push(`kind = ANY($${values.length}::text[])`);
		}
		if (query.tags?.length) {
			values.push(query.tags);
			clauses.push(`tags @> $${values.length}::text[]`);
		}
		if (query.metadata && Object.keys(query.metadata).length > 0) {
			values.push(JSON.stringify(query.metadata));
			clauses.push(`metadata @> $${values.length}::jsonb`);
		}

		const text = mapProductSearchQuery(query.query?.trim() ?? "");
		let scoreSql = "1::float";
		let modeSql = "'structured'::text";
		if (text) {
			values.push(text);
			const textParam = `$${values.length}`;
			values.push(chineseBigrams(text));
			const tokensParam = `$${values.length}`;
			const predicates = [
				`search_text ILIKE '%' || ${textParam} || '%'`,
				`to_tsvector('simple', search_text) @@ plainto_tsquery('simple', ${textParam})`,
				`search_tokens && ${tokensParam}::text[]`,
			];
			if (this.capabilities.trigram) {
				predicates.push(`similarity(search_text, ${textParam}) >= 0.15`);
			}
			clauses.push(`(${predicates.join(" OR ")})`);
			scoreSql = `CASE
        WHEN lower(title) = lower(${textParam}) THEN 10
        WHEN search_text ILIKE '%' || ${textParam} || '%' THEN 8
        WHEN to_tsvector('simple', search_text) @@ plainto_tsquery('simple', ${textParam}) THEN 6
        ${
					this.capabilities.trigram
						? `WHEN similarity(search_text, ${textParam}) >= 0.15 THEN 2 + similarity(search_text, ${textParam})`
						: ""
				}
        ELSE 4
      END`;
			modeSql = `CASE
        WHEN lower(title) = lower(${textParam}) THEN 'exact'
        WHEN search_text ILIKE '%' || ${textParam} || '%' THEN 'fts'
        WHEN to_tsvector('simple', search_text) @@ plainto_tsquery('simple', ${textParam}) THEN 'fts'
        ${
					this.capabilities.trigram
						? `WHEN similarity(search_text, ${textParam}) >= 0.15 THEN 'trigram'`
						: ""
				}
        ELSE 'bigram'
      END`;
		}
		values.push(Math.min(Math.max(query.limit ?? 20, 1), 100));
		const limitParam = `$${values.length}`;
		const result = await this.database.query<
			QueryResultRow & {
				id: string;
				kind: SearchDocument["kind"];
				title: string;
				search_text: string;
				tags: string[];
				metadata: Record<string, string>;
				updated_at: Date;
				score: number;
				match_mode: SearchResult["matchMode"];
			}
		>(
			`SELECT id, kind, title, search_text, tags, metadata, updated_at,
              ${scoreSql} AS score,
              ${modeSql} AS match_mode
         FROM p1_search_documents
        WHERE ${clauses.join(" AND ")}
        ORDER BY score DESC, updated_at DESC
        LIMIT ${limitParam}`,
			values,
		);
		return result.rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			matchMode: row.match_mode,
			metadata: row.metadata,
			score: Number(row.score),
			tags: row.tags,
			text: row.search_text,
			title: row.title,
			updatedAt: row.updated_at.toISOString(),
			workspaceId,
		}));
	}

	async searchSnapshot(workspaceId: string, queries: SearchQuery[]) {
		return this.withReadSnapshot(async (repository) => {
			const results: SearchResult[][] = [];
			for (const query of queries) {
				results.push(await repository.searchDocuments(workspaceId, query));
			}
			return {
				documentCount: await repository.countSearchDocuments(workspaceId),
				indexSizeBytes: await repository.getSearchIndexSizeBytes(workspaceId),
				indexMode: repository.capabilities.trigram
					? ("postgres-fts-trigram-bigram" as const)
					: ("postgres-fts-bigram" as const),
				results,
				templateCatalog: await repository.loadTemplateCatalog(),
			};
		});
	}

	async saveRetrievalEvaluation(evaluation: RetrievalEvaluation) {
		await this.database.query(
			`INSERT INTO p1_retrieval_evaluations
         (workspace_id, id, revision, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
			[
				evaluation.workspaceId,
				evaluation.id,
				evaluation.revision,
				JSON.stringify(evaluation),
				evaluation.createdAt,
			],
		);
	}

	async getRetrievalEvaluation(workspaceId: string, revision: string) {
		const result = await this.database.query<{ payload: RetrievalEvaluation }>(
			`SELECT payload
         FROM p1_retrieval_evaluations
        WHERE workspace_id = $1 AND revision = $2
        ORDER BY created_at DESC
        LIMIT 1`,
			[workspaceId, revision],
		);
		return result.rows[0]?.payload ?? null;
	}

	async getLatestRetrievalEvaluation(workspaceId: string) {
		const result = await this.database.query<{ payload: RetrievalEvaluation }>(
			`SELECT payload
         FROM p1_retrieval_evaluations
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
			[workspaceId],
		);
		return result.rows[0]?.payload ?? null;
	}

	async countSearchDocuments(workspaceId: string) {
		const result = await this.database.query<{ count: string }>(
			`SELECT count(*)::text AS count
         FROM p1_search_documents
        WHERE workspace_id = $1`,
			[workspaceId],
		);
		return Number(result.rows[0]?.count ?? 0);
	}

	async getSearchIndexSizeBytes(workspaceId: string) {
		void workspaceId;
		const result = await this.database.query<{ bytes: string }>(
			`SELECT pg_indexes_size('p1_search_documents'::regclass)::text AS bytes`,
		);
		return Number(result.rows[0]?.bytes ?? 0);
	}
}
