import assert from "node:assert/strict";
import test from "node:test";

import { createCreationExecutionSnapshot } from "../execution-spine/creation-execution-snapshot.js";
import {
	MemoryContentPackageRevisionWritePort,
} from "../execution-spine/content-package-revision-port.js";
import type { ModelSupplyResult, ModelSupplySubmission } from "../model-supply/index.js";
import { buildContentPackage } from "../operations/content-package.js";
import type { ExecutionBrief } from "./structured-nodes.js";
import type { HarnessWorkflowInput } from "./task-admission.js";
import {
	HarnessMediaExecutionError,
	ModelSupplyHarnessMediaExecutionPort,
	UnifiedHarnessStagePorts,
} from "./unified-media-stage-ports.js";
import type {
	HarnessContextSnapshot,
	HarnessStagePorts,
} from "./workflow-core.js";

test("image and video use the existing Model Supply path with stable submission facts", async () => {
	for (const kind of ["image", "video"] as const) {
		const submissions: ModelSupplySubmission[] = [];
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult(kind);
			},
		});
		const request = harnessInput(kind, `package-${kind}`);
		const selection = await adapter.execute({
			brief: mediaBrief(kind),
			context: {} as HarnessContextSnapshot,
			request,
			workflowId: `task-${kind}`,
		});

		assert.deepEqual(submissions, [
			{
				actorId: "owner-1",
				billingQuoteRevision: "quote-r1",
				billingTaskId: `task-${kind}`,
				correlationId: `task-${kind}`,
				dataClass: [],
				idempotencyKey: `harness-media:task-${kind}:${kind}`,
				input:
					kind === "image"
						? {
								ratio: "9:16",
								referenceAssetIds: ["asset-1"],
								resolution: "1080p",
							}
						: {
								durationSeconds: 8,
								ratio: "9:16",
								referenceAssetIds: ["asset-1"],
							},
				operation: kind === "image" ? "image.generate" : "video.generate",
				prompt:
					kind === "image"
						? mediaBrief(kind).prompt
						: `${mediaBrief(kind).firstFramePrompt}\n1. ${mediaBrief(kind).storyboard[0]?.description}`,
				selection: { catalogModelId: `model-${kind}-1`, mode: "fixed" },
				workspaceId: "workspace-1",
			},
		]);
		assert.equal(selection.kind, kind);
		assert.equal(selection.asset.id, `${kind}-asset-1`);
		assert.equal(selection.childRun.productUsage?.status, "committed");
		assert.equal(selection.childRun.providerAttempts?.length, 1);
		assert.equal(selection.childRun.providerCosts?.length, 1);
	}
});

test("media delivery writes the shared ContentPackage once with asset, usage, cost, and snapshot lineage", async () => {
	for (const kind of ["image", "video"] as const) {
		const packageId = `package-${kind}`;
		const request = harnessInput(kind, packageId);
		const snapshot = request.executionSnapshot!;
		const writer = new MemoryContentPackageRevisionWritePort();
		writer.seed(
			buildContentPackage({
				id: packageId,
				kind: kind === "image" ? "image_text" : "video",
				source: {
					assetIds: ["asset-1"],
					creationExecutionSnapshot: {
						id: snapshot.id,
						revision: snapshot.revision,
						schemaVersion: snapshot.schemaVersion,
					},
					targetPlatform: "douyin",
					workId: snapshot.work.id,
					workflowId: snapshot.task.id,
					workflowRevision: snapshot.revision,
				},
				timestamp: "2026-07-22T09:00:00.000Z",
				workspaceId: "workspace-1",
			}),
		);
		const media = new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				return completedResult(kind);
			},
		});
		const ports = new UnifiedHarnessStagePorts(
			unsupportedCopyPorts(),
			{ create() { throw new Error("Media delivery does not compile a copy brief."); } },
			media,
			writer,
			() => "2026-07-22T09:00:01.000Z",
		);
		const brief = mediaBrief(kind);
		const selection = await media.execute({
			brief,
			context: {} as HarnessContextSnapshot,
			request,
			workflowId: snapshot.task.id,
		});
		const input = {
			workflowId: snapshot.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购成片",
				taskType: "promotion_groupbuy_conversion" as const,
				deliveryLayer: "finished_media" as const,
				relevantAssetCategories: ["promotion_activity" as const],
				usedAssetCategories: ["promotion_activity" as const],
				route: "customized" as const,
				routingSource: "model" as const,
				implicitConstraints: [],
			},
			context: {} as HarnessContextSnapshot,
			brief,
			selection,
		};
		const delivery = await ports.assembleMediaAndDeliver(input);
		const replayed = await ports.assembleMediaAndDeliver(input);

		assert.deepEqual(replayed, delivery);
		assert.deepEqual(delivery, {
			packageId,
			revision: 1,
			versionId: `${snapshot.task.id}:${kind}-asset-1`,
		});
		const contentPackage = writer.get("workspace-1", packageId);
		assert.ok(contentPackage);
		assert.equal(contentPackage?.revision, 1);
		assert.deepEqual(contentPackage?.source.creationExecutionSnapshot, {
			id: snapshot.id,
			revision: 1,
			schemaVersion: "creation-execution-snapshot/v1",
		});
		assert.deepEqual(contentPackage?.generated.assetIds, [`${kind}-asset-1`]);
		assert.equal(contentPackage?.generated.ownedAssets?.[0]?.id, `${kind}-asset-1`);
		assert.deepEqual(contentPackage?.generated.childRuns[0]?.productUsage, {
			quantity: 1,
			status: "committed",
		});
		assert.equal(contentPackage?.generated.childRuns[0]?.providerCost?.amount, 1.2);
		assert.equal(contentPackage?.generated.childRuns[0]?.providerAttempts?.length, 1);
		assert.equal(contentPackage?.generated.childRuns[0]?.providerCosts?.length, 1);
	}
});

test("an unknown durable media outcome stays on its stable reconciliation key", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit(input) {
			submissions.push(structuredClone(input));
			return { ...completedResult("video"), status: "unknown", asset: undefined };
		},
	});
	const request = harnessInput("video", "package-video");

	await assert.rejects(
		adapter.execute({
			brief: mediaBrief("video"),
			context: {} as HarnessContextSnapshot,
			request,
			workflowId: "task-video",
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "MEDIA_RECONCILIATION_PENDING" &&
			error.status === 202,
	);
	assert.equal(submissions.length, 1);
	assert.equal(submissions[0]?.idempotencyKey, "harness-media:task-video:video");
});

function harnessInput(
	kind: "image" | "video",
	packageId: string,
): HarnessWorkflowInput {
	const snapshot = createCreationExecutionSnapshot(
		{
			actorId: "owner-1",
			workspaceId: "workspace-1",
			idempotencyKey: `submission-${kind}-1`,
			taskId: `task-${kind}`,
			workId: "work-1",
			contentPackageId: packageId,
			expectedContentPackageRevision: 0,
			creationMode: "customized",
			intent: "把夏日护理项目做成可发布的素材",
			surface: { id: "surface-1", revision: "surface-r1" },
			recipe: { id: `recipe-${kind}-1`, revision: `recipe-${kind}-r1` },
			lens: kind,
			platform: { id: "douyin" },
			deliverables: [
				{
					id: `${kind}-main`,
					kind,
					order: 0,
					quantity: 1,
					aspectRatio: "9:16",
					...(kind === "video" ? { durationSeconds: 8 } : {}),
				},
			],
			sources: {
				assets: [
					{ id: "asset-1", revision: "asset-r1", role: "reference" },
				],
			},
			rights: { revision: "rights-r1", summary: "authorized" },
			identity: { id: "identity-1", revision: "identity-r1" },
			modelPolicy: { id: "policy-1", revision: "policy-r1", mode: "fixed" },
			catalogModel: { id: `model-${kind}-1`, revision: `model-${kind}-r1` },
			quote: { id: "quote-1", revision: "quote-r1" },
			route: { id: "route-1", revision: "route-r1" },
			briefContext: { id: "brief-context-1", revision: 1 },
			briefConfirmation: { id: "brief-1", revision: "brief-r1" },
			contentModules: ["social_cover"],
		},
		"2026-07-22T09:00:00.000Z",
	);
	return {
		actorId: snapshot.actorId,
		workspaceId: snapshot.workspaceId,
		packageId,
		expectedRevision: snapshot.contentPackage.expectedRevision,
		workflowRevision: snapshot.revision,
		creationMode: snapshot.creationMode,
		rawInput: snapshot.intent.text,
		intent: {
			context: {
				workId: snapshot.work.id,
				intent: snapshot.intent.text,
				sourceSummaries: [],
			},
			assetReferences: ["asset-1"],
		},
		executionSnapshot: snapshot,
	};
}

function mediaBrief(kind: "image"): Extract<ExecutionBrief, { kind: "image" }>;
function mediaBrief(kind: "video"): Extract<ExecutionBrief, { kind: "video" }>;
function mediaBrief(
	kind: "image" | "video",
): Exclude<ExecutionBrief, { kind: "copy" }>;
function mediaBrief(kind: "image" | "video"): Exclude<ExecutionBrief, { kind: "copy" }> {
	if (kind === "image") {
		return {
			kind,
			prompt: "为夏日护理项目生成竖版门店活动海报，保留品牌主视觉和预约行动号召。",
			referenceAssetIds: ["asset-1"],
			parameters: { ratio: "9:16", resolution: "1080p" },
			constraints: ["不得编造价格"],
		};
	}
	return {
		kind,
		firstFramePrompt: "夏日护理项目门店开场，展示明确的品牌主视觉和预约行动号召。",
		storyboard: [
			{
				index: 1,
				description: "门店护理场景与主视觉展示。",
				durationSeconds: 8,
			},
		],
		referenceAssetIds: ["asset-1"],
		parameters: { durationSeconds: 8, ratio: "9:16" },
		constraints: ["不得编造价格"],
	};
}

function completedResult(kind: "image" | "video"): ModelSupplyResult {
	const attempt = {
		acceptance: "accepted" as const,
		catalogModelId: `model-${kind}-1`,
		createdAt: "2026-07-22T09:00:00.000Z",
		deploymentId: `deployment-${kind}-1`,
		id: `attempt-${kind}-1`,
		jobId: `job-${kind}-1`,
		status: "completed" as const,
	};
	const providerCost = {
		amount: 1.2,
		currency: "CNY" as const,
		id: `cost-${kind}-1`,
		status: "observed" as const,
		usage: { mediaUnits: 1 },
	};
	return {
		jobId: `job-${kind}-1`,
		status: "completed",
		snapshot: {
			actualCatalogModelId: `model-${kind}-1`,
			catalogRevisionId: `model-${kind}-r1`,
			deploymentId: `deployment-${kind}-1`,
			id: `route-${kind}-1`,
		} as ModelSupplyResult["snapshot"],
		attempt,
		attempts: [attempt],
		asset: {
			contentType: kind === "image" ? "image/png" : "video/mp4",
			id: `${kind}-asset-1`,
			objectKey: `owned/${kind}-asset-1`,
			sha256: `${kind}-sha-1`,
			sizeBytes: 1024,
		},
		usage: { id: `usage-${kind}-1`, quantity: 1, status: "committed" },
		providerCost,
		providerCosts: [providerCost],
	};
}

function unsupportedCopyPorts(): HarnessStagePorts {
	const unsupported = async (): Promise<never> => {
		throw new Error("Copy stage must not run for a frozen media snapshot.");
	};
	return {
		nameIntent: unsupported,
		injectContext: unsupported,
		fenceContext: unsupported,
		compileBrief: unsupported,
		executeAndSelect: unsupported,
		assembleAndDeliver: unsupported,
	};
}
