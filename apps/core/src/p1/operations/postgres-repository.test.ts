import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import {
	MemoryFoundationRepository,
	P1ApplicationService,
} from "../foundation/index.js";
import {
	OperationsApplicationService,
	OperationsFoundationModule,
	PostgresOperationsRepository,
	RecordedCanvasExportAdapter,
	RecordedImageGenerationAdapter,
	type CreationExecutorPort,
	type ImageGenerationPort,
} from "./index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
	"Postgres P1 operations repository",
	{ skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured" },
	() => {
		const pool = new Pool({ connectionString: databaseUrl });
		const repository = new PostgresOperationsRepository(pool);
		const workspaceId = `workspace-${randomUUID()}`;
		const otherWorkspaceId = `workspace-${randomUUID()}`;
		const userId = `user-${randomUUID()}`;
		const context = {
			actor: "owner" as const,
			correlationId: "corr-pg-operations",
			userId,
			workspaceId,
		};
		const creationExecutor = {
			async inspect() {},
			async submit() {
				return {
					copyCandidates: [
						{ body: "Postgres 持久化候选一。", title: "持久化候选一" },
						{ body: "Postgres 持久化候选二。", title: "持久化候选二" },
						{ body: "Postgres 持久化候选三。", title: "持久化候选三" },
					],
					providerJobId: "provider-pg-creative",
					routeSnapshotId: "route-pg-creative",
					status: "completed" as const,
				};
			},
			async verify(input) {
				return {
					providerJobId: input.providerJobId,
					routeSnapshotId: input.routeSnapshotId,
					status: "unknown" as const,
				};
			},
		} satisfies CreationExecutorPort;
		const service = new OperationsApplicationService(repository, {
			canvasExporter: new RecordedCanvasExportAdapter(),
			creationExecutor,
			imageGenerator: new RecordedImageGenerationAdapter(),
			notifier: { async send() {} },
		});

		before(async () => {
			await pool.query(`
        CREATE TABLE IF NOT EXISTS "user" (
          id text PRIMARY KEY,
          name text NOT NULL,
          email text NOT NULL UNIQUE,
          email_verified boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS workspaces (
          id text PRIMARY KEY,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS workspace_memberships (
          workspace_id text NOT NULL,
          user_id text NOT NULL,
          role text NOT NULL DEFAULT 'owner',
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, user_id)
        );
      `);
			await repository.migrate();
			await pool.query(
				`INSERT INTO "user" (id, name, email) VALUES ($1, 'P1 owner', $2)`,
				[userId, `${userId}@example.test`],
			);
			await pool.query(
				`INSERT INTO workspaces (id, name) VALUES ($1, 'P1 workspace'), ($2, 'Other')`,
				[workspaceId, otherWorkspaceId],
			);
			await pool.query(
				`INSERT INTO workspace_memberships (workspace_id, user_id) VALUES ($1, $2)`,
				[workspaceId, userId],
			);
		});

		after(async () => {
			for (const table of [
				"p1_retrieval_evaluations",
				"p1_search_projection_heads",
				"p1_search_documents",
				"p1_operations_audit_events",
				"p1_operations_command_receipts",
				"p1_creation_events",
				"p1_content_packages",
				"p1_creative_contents",
				"p1_creative_assets",
				"p1_creative_jobs",
				"p1_creative_works",
				"p1_canvas_image_jobs",
				"p1_export_receipts",
				"p1_template_shortcuts",
				"p1_user_templates",
				"p1_canvas_works",
				"p1_weekly_reviews",
				"p1_weekly_batch_executions",
				"p1_weekly_facts",
				"p1_trigger_runs",
				"p1_trigger_configs",
				"p1_task_source_links",
				"p1_task_events",
				"p1_content_tasks",
			]) {
				await pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [
					workspaceId,
				]);
			}
			await pool.query(
				"DELETE FROM p1_template_command_receipts WHERE workspace_id = $1",
				[workspaceId],
			);
			const crashFamily = `crash-family-${workspaceId}`;
			await pool.query(
				`DELETE FROM p1_template_version_lifecycle
          WHERE template_id IN (
            SELECT id FROM p1_official_templates
             WHERE payload->>'family' = $1
          )`,
				[crashFamily],
			);
			await pool.query(
				`DELETE FROM p1_template_versions
          WHERE template_id IN (
            SELECT id FROM p1_official_templates
             WHERE payload->>'family' = $1
          )`,
				[crashFamily],
			);
			await pool.query(
				`DELETE FROM p1_official_templates
          WHERE payload->>'family' = $1`,
				[crashFamily],
			);
			await pool.query(
				"DELETE FROM workspace_memberships WHERE workspace_id = $1",
				[workspaceId],
			);
			await pool.query("DELETE FROM workspaces WHERE id = ANY($1::text[])", [
				[workspaceId, otherWorkspaceId],
			]);
			await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
			await pool.end();
		});

		it("persists independent task facts and keeps Chinese retrieval workspace-scoped", async () => {
			const task = await service.createTask(context, {
				dueAt: "2026-07-13T09:00:00.000Z",
				executable: true,
				risk: "normal",
				source: "manual",
				title: "确认透亮猫眼草稿",
			});
			await service.transitionTask(context, task.id, "done");
			await service.indexSearchDocument(context, {
				id: "content-cat-eye-pg",
				kind: "content",
				metadata: { platform: "xiaohongshu" },
				tags: ["猫眼"],
				text: "杭州暮色美甲透亮猫眼",
				title: "阴天也透亮",
			});

			const reloaded = await service.listInbox(context, { statuses: ["done"] });
			assert.equal(reloaded.tasks[0]?.id, task.id);
			assert.equal((await service.listTaskEvents(context, task.id)).length, 2);
			assert.deepEqual(
				(
					await service.search(context, {
						kinds: ["content"],
						query: "透亮猫眼",
					})
				).map((item) => item.id),
				["content-cat-eye-pg"],
			);
			assert.deepEqual(
				await repository.searchDocuments(otherWorkspaceId, {
					kinds: ["content"],
					query: "透亮猫眼",
				}),
				[],
			);

			const tableCounts = await pool.query<{ tasks: string; events: string }>(
				`SELECT
           (SELECT count(*) FROM p1_content_tasks WHERE workspace_id = $1)::text AS tasks,
           (SELECT count(*) FROM p1_task_events WHERE workspace_id = $1)::text AS events`,
				[workspaceId],
			);
			assert.deepEqual(tableCounts.rows[0], { events: "2", tasks: "1" });
		});

		it("persists the creative Work, Job, Asset, and accepted Content graph", async () => {
			const work = await service.createCreativeWork(context, {
				intent: "持久化一条可恢复的创作记录",
				mode: "agent",
				sessionId: "session-pg-creative",
				sourceReferences: [],
			});
			const generated = await service.submitCreativeWork(
				context,
				work.id,
				{
					aigcLabelEnabled: true,
					catalogModelId: "llm-pg-live",
					catalogRevision: "catalog-pg-live",
					currency: "CNY",
					dataClass: [],
					estimatedAmount: 0,
					operation: "copy.generate",
					outputCount: 3,
					outputLabel: "3 条内容候选",
					quoteAcceptedAt: "2026-07-12T12:00:00.000Z",
					quoteRevision: "quote-pg-live",
					watermarkEnabled: false,
				},
				"submit-pg-creative",
			);
			const content = await service.acceptCreativeAsset(
				context,
				generated.assets[0]!.id,
			);
			const reloaded = new OperationsApplicationService(
				new PostgresOperationsRepository(pool),
				{
					canvasExporter: new RecordedCanvasExportAdapter(),
					creationExecutor,
					imageGenerator: new RecordedImageGenerationAdapter(),
					notifier: { async send() {} },
				},
			);
			const projection = await reloaded.getCreativeWorkbench(context);

			assert.equal(projection.works[0]?.id, work.id);
			assert.equal(projection.jobs[0]?.id, generated.job.id);
			assert.equal(generated.assets.length, 3);
			assert.equal(projection.assets.length, 3);
			assert.deepEqual(
				[...projection.assets]
					.sort(
						(left, right) =>
							(left.candidateIndex ?? Number.MAX_SAFE_INTEGER) -
							(right.candidateIndex ?? Number.MAX_SAFE_INTEGER),
					)
					.map((asset) => asset.id),
				generated.assets.map((asset) => asset.id),
			);
			assert.equal(projection.contents[0]?.id, content.id);
			assert.equal(projection.contents[0]?.workspaceId, workspaceId);
			assert.deepEqual(projection.contents[0]?.assetIds, [
				generated.assets[0]?.id,
			]);
		});

		it("persists ContentPackage aggregates in a workspace-scoped transaction", async () => {
			const contentPackage = await service.createContentPackage(context, {
				kind: "image_text",
				source: {
					assetIds: ["copy-pg-1", "image-pg-1", "image-pg-2", "image-pg-3"],
					briefId: "brief-pg-1",
					groundingId: "grounding-pg-1",
					storeProfileId: "store-pg-1",
				},
			});
			const reloaded = new OperationsApplicationService(
				new PostgresOperationsRepository(pool),
				{
					canvasExporter: new RecordedCanvasExportAdapter(),
					creationExecutor,
					imageGenerator: new RecordedImageGenerationAdapter(),
					notifier: { async send() {} },
				},
			);

			assert.deepEqual(
				await reloaded.getContentPackage(context, contentPackage.id),
				contentPackage,
			);
			assert.deepEqual(
				(await repository.loadWorkspace(otherWorkspaceId))?.contentPackages ?? [],
				[],
			);
			const count = await pool.query<{ count: string }>(
				"SELECT count(*)::text AS count FROM p1_content_packages WHERE workspace_id = $1",
				[workspaceId],
			);
			assert.equal(count.rows[0]?.count, "1");
		});

		it("records the fixed beauty retrieval query set against real Postgres indexes", async () => {
			await service.indexSearchDocument(context, {
				id: "content-cat-eye-pg",
				kind: "content",
				metadata: { platform: "xiaohongshu", status: "draft" },
				tags: ["猫眼", "显白"],
				text: "杭州暮色美甲 透亮猫眼 新客到店",
				title: "阴天也透亮的猫眼",
			});
			await service.indexSearchDocument(context, {
				id: "asset-before-after-pg",
				kind: "asset",
				metadata: { authorization: "public_marketing", category: "case" },
				tags: ["前后对比"],
				text: "顾客授权的猫眼前后对比图",
				title: "猫眼 Before After",
			});

			const fixedQuerySet = {
				cases: [
					{
						category: "alias" as const,
						expectedIds: ["content-cat-eye-pg"],
						query: "星眸款",
						revised: false,
					},
					{
						category: "synonym" as const,
						expectedIds: ["asset-before-after-pg"],
						query: "效果反差图",
						revised: true,
					},
					{
						category: "typo" as const,
						expectedIds: ["content-cat-eye-pg"],
						query: "阴天也透亮的猫验",
						revised: false,
					},
					{
						category: "tag" as const,
						expectedIds: ["content-cat-eye-pg"],
						query: "",
						revised: false,
						tags: ["显白"],
					},
					{
						category: "negative" as const,
						expectedIds: [],
						query: "不存在的水光项目",
						revised: false,
					},
				],
				k: 5,
				revision: "postgres-beauty-fixed-query-set-v1",
			};
			const evaluation = await service.evaluateRetrieval(context, fixedQuerySet);
			const documentCount = await repository.countSearchDocuments(workspaceId);
			const physicalIndexSize = await pool.query<{ bytes: string }>(
				`SELECT pg_indexes_size('p1_search_documents'::regclass)::text AS bytes`,
			);
			const indexSizeBytes = Number(physicalIndexSize.rows[0]?.bytes ?? 0);

			assert.equal(evaluation.recallAtK, 1);
			assert.equal(evaluation.zeroResultRate, 1 / 5);
			assert.equal(evaluation.reformulationRate, 1 / 5);
			assert.equal(evaluation.reformulationSource, "fixed-query-set-annotation");
			assert.equal(evaluation.negativeControlPassRate, 1);
			assert.equal(evaluation.caseCount, 5);
			assert.deepEqual(
				evaluation.cases.map((testCase) => testCase.category),
				["alias", "synonym", "typo", "tag", "negative"],
			);
			assert.equal(evaluation.indexDocumentCount, documentCount);
			assert.equal(evaluation.indexSizeBytes, indexSizeBytes);
			assert.equal(evaluation.indexSizeKind, "postgres-index-relation-bytes");
			assert.equal(
				evaluation.indexSizeScope,
				"shared-p1-search-documents-relation",
			);
			assert.ok(evaluation.indexSizeBytes > 0);
			assert.match(evaluation.indexMode, /^postgres-fts-(?:bigram|trigram-bigram)$/u);
			assert.match(evaluation.querySetHash, /^[a-f0-9]{64}$/u);
			assert.equal(evaluation.revision, fixedQuerySet.revision);

			const persisted = await pool.query<{ payload: typeof evaluation }>(
				`SELECT payload
				   FROM p1_retrieval_evaluations
				  WHERE workspace_id = $1 AND revision = $2`,
				[workspaceId, fixedQuerySet.revision],
			);
			assert.equal(persisted.rowCount, 1);
			assert.deepEqual(persisted.rows[0]?.payload, evaluation);

			const reloadedService = new OperationsApplicationService(
				new PostgresOperationsRepository(pool),
				{
					canvasExporter: new RecordedCanvasExportAdapter(),
					imageGenerator: new RecordedImageGenerationAdapter(),
					notifier: { async send() {} },
				},
			);
			assert.deepEqual(
				await reloadedService.getLatestRetrievalEvaluation(context),
				evaluation,
			);
		});

		it("replays one Operations fact from Postgres after Foundation completion crashes", async () => {
			let now = Date.parse("2026-07-11T12:00:00.000Z");
			const foundation = new MemoryFoundationRepository(
				() => new Date(now),
				10,
			);
			foundation.grantOwner(workspaceId, userId);
			const complete = foundation.completeModuleCommand.bind(foundation);
			let failCompletion = true;
			foundation.completeModuleCommand = async (...args) => {
				if (failCompletion) {
					failCompletion = false;
					throw new Error("simulated postgres completion crash");
				}
				return complete(...args);
			};
			const command = {
				action: "create_task",
				payload: {
					dueAt: "2026-07-18T09:00:00.000Z",
					executable: true,
					risk: "normal",
					source: "manual",
					title: `PG crash task ${workspaceId}`,
				},
			};
			const createModuleService = () =>
				new P1ApplicationService(foundation, {
					moduleCommandHeartbeatMs: 60_000,
					operations: [
						new OperationsFoundationModule(
							new OperationsApplicationService(
								new PostgresOperationsRepository(pool),
								{
									canvasExporter: new RecordedCanvasExportAdapter(),
									imageGenerator: new RecordedImageGenerationAdapter(),
									notifier: { async send() {} },
								},
							),
							{ adminActorIds: [userId] },
						),
					],
				});

			await assert.rejects(
				createModuleService().executeModule(
					context,
					"operations",
					command,
					"pg-crash-create-task",
				),
				/simulated postgres completion crash/,
			);
			now += 11;
			const replayed = (await createModuleService().executeModule(
				context,
				"operations",
				command,
				"pg-crash-create-task",
			)) as { id: string };
			const facts = await pool.query<{ id: string }>(
				`SELECT id
           FROM p1_content_tasks
          WHERE workspace_id = $1 AND payload->>'title' = $2`,
				[workspaceId, command.payload.title],
			);

			assert.deepEqual(facts.rows, [{ id: replayed.id }]);
			const reloadedOperations = new PostgresOperationsRepository(pool);
			const workspaceReceipt = (
				await reloadedOperations.loadWorkspace(workspaceId)
			)?.commandReceipts.find(
				(receipt) => receipt.idempotencyKey === "pg-crash-create-task",
			);
			assert.equal(workspaceReceipt?.status, "completed");
			assert.equal(
				(workspaceReceipt?.result as { id?: string } | undefined)?.id,
				replayed.id,
			);

			const templateCommand = {
				action: "admin_create_template",
				payload: {
					document: {
						height: 1350,
						pages: [{ elements: [], id: `page-${workspaceId}` }],
						width: 1080,
					},
					family: `crash-family-${workspaceId}`,
					name: "PG crash template",
					tags: ["crash"],
				},
			};
			failCompletion = true;
			await assert.rejects(
				createModuleService().executeModule(
					context,
					"operations",
					templateCommand,
					"pg-crash-create-template",
				),
				/simulated postgres completion crash/,
			);
			now += 11;
			const templateReplay = (await createModuleService().executeModule(
				context,
				"operations",
				templateCommand,
				"pg-crash-create-template",
			)) as { template: { id: string } };
			const templateFacts = await pool.query<{ id: string }>(
				`SELECT id
           FROM p1_official_templates
          WHERE payload->>'family' = $1`,
				[templateCommand.payload.family],
			);
			assert.deepEqual(templateFacts.rows, [
				{ id: templateReplay.template.id },
			]);
			const templateReceipt = (
				await reloadedOperations.loadTemplateCatalog()
			).commandReceipts.find(
				(receipt) => receipt.idempotencyKey === "pg-crash-create-template",
			);
			assert.equal(templateReceipt?.status, "completed");
			assert.equal(
				(templateReceipt?.result as { template?: { id?: string } } | undefined)
					?.template?.id,
				templateReplay.template.id,
			);
		});

		it("reloads immutable official template version history", async () => {
			const admin = {
				...context,
				actor: "admin" as const,
				userId: `admin-${randomUUID()}`,
			};
			let lifecycleNow = Date.parse("2026-07-11T12:00:00.000Z");
			const lifecycleService = new OperationsApplicationService(repository, {
				canvasExporter: new RecordedCanvasExportAdapter(),
				clock: () => new Date(lifecycleNow),
				imageGenerator: new RecordedImageGenerationAdapter(),
				notifier: { async send() {} },
			});
			await lifecycleService.seedOfficialTemplateFamilies(admin);
			const [template] = await lifecycleService.listTemplates(admin, {
				families: ["shooting_checklist"],
			});
			assert.ok(template);
			const version = await lifecycleService.createTemplateVersion(admin, {
				document: {
					height: 1350,
					pages: [{ elements: [], id: `page-${randomUUID()}` }],
					width: 1080,
				},
				templateId: template.id,
			});
			await assert.rejects(
				lifecycleService.publishTemplateVersion(
					admin,
					template.id,
					version.id,
					20,
				),
				/Publishing is a full rollout/,
			);
			await lifecycleService.publishTemplateVersion(
				admin,
				template.id,
				version.id,
				100,
			);
			lifecycleNow = Date.parse("2026-07-11T11:59:00.000Z");
			await lifecycleService.retireTemplate(
				{ ...admin, correlationId: "corr-pg-template-retire" },
				template.id,
			);

			const reloaded = new OperationsApplicationService(
				new PostgresOperationsRepository(pool),
				{
					canvasExporter: new RecordedCanvasExportAdapter(),
					imageGenerator: new RecordedImageGenerationAdapter(),
					notifier: { async send() {} },
				},
			);
			const history = await reloaded.getTemplateCatalogHistory(
				admin,
				template.id,
			);
			assert.ok(history.versions.some((item) => item.id === version.id));
			assert.equal(
				history.versions.find((item) => item.id === version.id)?.rolloutPercent,
				100,
			);
			const reloadedVersion = history.versions.find(
				(item) => item.id === version.id,
			);
			assert.equal(reloadedVersion?.publishedBy, admin.userId);
			assert.equal(reloadedVersion?.publishCorrelationId, admin.correlationId);
			assert.equal(
				reloadedVersion?.retireCorrelationId,
				"corr-pg-template-retire",
			);
			assert.deepEqual(
				reloadedVersion?.lifecycle.map((event) => event.action),
				["published", "retired"],
			);
			assert.equal(reloadedVersion?.status, "retired");
		});

		it("recovers the latest canvas image job by work from Postgres", async () => {
			let now = Date.parse("2026-07-11T13:00:00.000Z");
			const imageGenerator: ImageGenerationPort = {
				jobId(request) {
					return `pg-recoverable-image-${workspaceId}-${request.prompt}`;
				},
				async submit(request) {
					return {
						actualModelId: request.requestedModelId,
						id: `pg-recoverable-image-${workspaceId}-${request.prompt}`,
						status: request.prompt.includes("运行中")
							? ("queued" as const)
							: ("failed" as const),
					};
				},
			};
			const imageService = new OperationsApplicationService(repository, {
				canvasExporter: new RecordedCanvasExportAdapter(),
				clock: () => new Date(now++),
				imageGenerator,
				notifier: { async send() {} },
			});
			const work = await imageService.createBlankWork(context, {
				height: 1350,
				name: "恢复 Postgres 生图任务",
				width: 1080,
			});
			const running = await imageService.startCanvasImageGeneration(context, {
				modelId: "gpt-image-2",
				operation: "generate",
				prompt: "较旧但仍运行中的 Postgres 任务",
				workId: work.id,
			});
			await imageService.startCanvasImageGeneration(context, {
				modelId: "seedream-5-pro",
				operation: "generate",
				prompt: "较新但已失败的 Postgres 任务",
				workId: work.id,
			});
			const reloaded = new OperationsApplicationService(
				new PostgresOperationsRepository(pool),
				{
					canvasExporter: new RecordedCanvasExportAdapter(),
					imageGenerator,
					notifier: { async send() {} },
				},
			);

			assert.equal(
				(await reloaded.getLatestCanvasImageJob(context, work.id))?.id,
				running.id,
			);
		});
	},
);
