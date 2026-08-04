import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";
import { contentPackageSchema } from "@meiye/contracts";
import {
	MemoryFoundationRepository,
	P1ApplicationService,
} from "../foundation/index.js";
import { ResultDeliveryFoundationModule } from "../result-delivery/foundation-module.js";
import { OperationsVisualAdoptionPort } from "../result-delivery/operations-visual-adoption.js";
import {
	OperationsApplicationService,
	OperationsFoundationModule,
	PostgresOperationsRepository,
	RecordedCanvasExportAdapter,
	RecordedImageGenerationAdapter,
	type CreationExecutorPort,
	type ImageGenerationPort,
} from "./index.js";
import {
	buildContentPackage,
	transitionContentPackage,
} from "./content-package.js";

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


			it("persists the creative Work, Job, and Asset graph without new legacy Content", async () => {
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
				assert.deepEqual(projection.contents, []);
		});




		it("persists public visual adoption and revision idempotency across service restarts", async () => {
			const suffix = randomUUID();
			const sessionId = `session-visual-adoption-${suffix}`;
			const sourceWork = await service.createCreativeWork(context, {
				intent: "生成图文成品",
				mode: "agent",
				sessionId,
				sourceReferences: [],
			});
			const visualWork = await service.createCreativeWork(context, {
				intent: "生成配套图片",
				mode: "agent",
				sessionId,
				sourceReferences: [],
			});
			const copyJobId = `copy-job-${suffix}`;
			const copyAssetIds = [0, 1, 2].map(
				(index) => `copy-${index + 1}-${suffix}`,
			);
			const visualAssetIds = [0, 1].map(
				(index) => `visual-${index + 1}-${suffix}`,
			);
			const now = "2026-07-20T09:00:00.000Z";
			const contract = {
				aigcLabelEnabled: true,
				catalogModelId: "model-postgres-adoption",
				catalogRevision: "catalog-v1",
				currency: "CNY" as const,
				dataClass: [],
				estimatedAmount: 1,
				operation: "copy.generate" as const,
				outputCount: 3,
				outputLabel: "3 条内容候选",
				quoteAcceptedAt: now,
				quoteRevision: "quote-v1",
				watermarkEnabled: false,
			};
			const state = await repository.loadWorkspace(workspaceId);
			assert.ok(state);
			state.creativeJobs.push(
				{
					contract,
					createdAt: now,
					id: copyJobId,
					outputAssetIds: copyAssetIds,
					outputContentIds: [],
					status: "completed",
					submissionKey: `copy-submit-${suffix}`,
					updatedAt: now,
					workId: sourceWork.id,
					workspaceId,
				},
				...visualAssetIds.map((assetId, index) => ({
					contract: {
						...contract,
						operation: "image.generate" as const,
						outputCount: 1,
						outputLabel: "1 张图片",
					},
					createdAt: now,
					id: `image-job-${index + 1}-${suffix}`,
					outputAssetIds: [assetId],
					outputContentIds: [],
					status: "completed" as const,
					submissionKey: `image-submit-${index + 1}-${suffix}`,
					updatedAt: now,
					workId: visualWork.id,
					workspaceId,
				})),
			);
			state.creativeAssets.push(
				...copyAssetIds.map((id, candidateIndex) => ({
					body: `正文 ${candidateIndex + 1}`,
					candidateIndex,
					createdAt: now,
					id,
					jobId: copyJobId,
					kind: "text" as const,
					title: `候选 ${candidateIndex + 1}`,
					workId: sourceWork.id,
					workspaceId,
				})),
				...visualAssetIds.map((id, index) => ({
					contentType: "image/png" as const,
					createdAt: now,
					id,
					jobId: `image-job-${index + 1}-${suffix}`,
					kind: "image" as const,
					objectKey: `${workspaceId}/generated/${id}.png`,
					ownedAssetId: `owned-${id}`,
					sha256: `${index + 1}`.repeat(64),
					sizeBytes: 100 + index,
					title: `图片 ${index + 1}`,
					workId: visualWork.id,
					workspaceId,
				})),
			);
			const storedSourceWork = state.creativeWorks.find(
				(work) => work.id === sourceWork.id,
			);
			assert.ok(storedSourceWork);
			storedSourceWork.currentJobId = copyJobId;
			storedSourceWork.status = "completed";
			await repository.saveWorkspace(state);

			const command = {
				action: "adopt_into_content_package",
				payload: {
					copyCandidateAssetId: copyAssetIds[1]!,
					visualAssetIds,
					workId: sourceWork.id,
				},
			};
			const module = new ResultDeliveryFoundationModule(
				new OperationsVisualAdoptionPort(service),
			);
			const adopted = (await module.execute({
				context,
				idempotencyKey: `adopt-${suffix}`,
				input: command,
			})) as {
				currentVersionId: string;
				id: string;
				revision: number;
				versions: Array<{ id: string; orderedAssetIds: string[] }>;
			};

			const restartedService = new OperationsApplicationService(
				new PostgresOperationsRepository(pool),
				{
					canvasExporter: new RecordedCanvasExportAdapter(),
					creationExecutor,
					imageGenerator: new RecordedImageGenerationAdapter(),
					notifier: { async send() {} },
				},
			);
			const restartedModule = new ResultDeliveryFoundationModule(
				new OperationsVisualAdoptionPort(restartedService),
			);
			const replay = (await restartedModule.execute({
				context: { ...context, correlationId: `replay-${suffix}` },
				idempotencyKey: `adopt-${suffix}`,
				input: command,
			})) as typeof adopted;
			const reviseCommand = {
				action: "revise_content_package_visuals",
				payload: {
					baseVersionId: adopted.currentVersionId,
					expectedRevision: adopted.revision,
					orderedVisualAssetIds: [...visualAssetIds].reverse(),
					packageId: adopted.id,
					roleAction: "replace_set" as const,
				},
			};
			const revised = (await restartedModule.execute({
				context: { ...context, correlationId: `revise-${suffix}` },
				idempotencyKey: `revise-${suffix}`,
				input: reviseCommand,
			})) as typeof adopted;
			const secondRestart = new OperationsApplicationService(
				new PostgresOperationsRepository(pool),
				{
					canvasExporter: new RecordedCanvasExportAdapter(),
					creationExecutor,
					imageGenerator: new RecordedImageGenerationAdapter(),
					notifier: { async send() {} },
				},
			);
			const replayedRevision = (await new ResultDeliveryFoundationModule(
				new OperationsVisualAdoptionPort(secondRestart),
			).execute({
				context: { ...context, correlationId: `revise-replay-${suffix}` },
				idempotencyKey: `revise-${suffix}`,
				input: reviseCommand,
			})) as typeof adopted;
			const persisted = await secondRestart.getContentPackage(
				{ ...context, actor: "owner" },
				adopted.id,
			);

			assert.equal(replay.id, adopted.id);
			assert.equal(replay.revision, adopted.revision);
			assert.equal(revised.revision, adopted.revision + 1);
			assert.equal(replayedRevision.revision, revised.revision);
			assert.equal(persisted.revision, revised.revision);
			assert.equal(persisted.currentVersionId, revised.currentVersionId);
			assert.deepEqual(
				persisted.versions.at(-1)?.orderedAssetIds.map(
					(ownedAssetId) =>
						persisted.generated.ownedAssets?.find(
							(asset) => asset.id === ownedAssetId,
						)?.sourceAssetId,
				),
				[...visualAssetIds].reverse(),
			);
			const receiptCount = await pool.query<{ count: string }>(
				`SELECT count(*) FILTER (
				          WHERE payload->>'status' = 'completed'
				        )::text AS count
				   FROM p1_operations_command_receipts
				  WHERE workspace_id = $1
				    AND payload->>'idempotencyKey' = ANY($2::text[])`,
				[workspaceId, [`adopt-${suffix}`, `revise-${suffix}`]],
			);
			assert.equal(receiptCount.rows[0]?.count, "2");
		});



		it("serializes external transaction clients with the workspace advisory lock", async () => {
			const client = await pool.connect();
			await client.query("BEGIN");
			let release = () => {};
			let markLocked = () => {};
			const locked = new Promise<void>((resolve) => {
				markLocked = resolve;
			});
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const externalRepository = new PostgresOperationsRepository(pool, client);
			const first = externalRepository.withWorkspaceLock(
				workspaceId,
				async () => {
					markLocked();
					await gate;
				},
			);
			await locked;
			let secondEntered = false;
			const second = repository.withWorkspaceLock(workspaceId, async () => {
				secondEntered = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 25));
			assert.equal(secondEntered, false);
			release();
			await first;
			await client.query("COMMIT");
			client.release();
			await second;
			assert.equal(secondEntered, true);
		});




		it("replays one Operations template fact from Postgres after Foundation completion crashes", async () => {
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
			const adminContext = { ...context, actor: "admin" as const };
			failCompletion = true;
			await assert.rejects(
				createModuleService().executeModule(
					adminContext,
					"operations",
					templateCommand,
					"pg-crash-create-template",
				),
				/simulated postgres completion crash/,
			);
			now += 11;
			const templateReplay = (await createModuleService().executeModule(
				adminContext,
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
			const reloadedOperations = new PostgresOperationsRepository(pool);
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

	},
);
