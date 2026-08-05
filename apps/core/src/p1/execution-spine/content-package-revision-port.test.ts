import assert from "node:assert/strict";
import test from "node:test";

import { buildContentPackage } from "../operations/content-package.js";
import { ContentPackageRightsBasisResolver } from "../operations/content-package-rights-basis.js";

import {
	ContentPackageRevisionWriteError,
	MemoryContentPackageRevisionWritePort,
} from "./content-package-revision-port.js";

test("Copy revision writes are idempotent and retain existing owned receipts", async () => {
	let selectedAssetAvailable = true;
	const writer = new MemoryContentPackageRevisionWritePort({
		async resolve({ assetIds }) {
			return {
				knownAssetIds: assetIds,
				unauthorizedAssetIds: selectedAssetAvailable
					? []
					: assetIds.filter((assetId) => assetId === "selected-asset-1"),
			};
		},
	});
	writer.seed(sourceContentPackage());
	writer.seed({
		...buildContentPackage({
			id: "package-1",
			kind: "image_text",
			source: {
				assetIds: [],
				creationExecutionSnapshot: {
					id: "snapshot-task-1",
						revision: 1,
						schemaVersion: "creation-execution-snapshot/v1",
					},
					sourceContentPackage: {
						id: "source-package-1",
						revision: "3",
					},
					targetPlatform: "douyin",
				workflowId: "task-1",
				workflowRevision: 1,
				workId: "work-1",
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
		generated: {
			assetIds: [],
			childRuns: [],
			ownedAssets: [
				{
					contentType: "image/png",
					id: "owned-asset-1",
					objectKey: "packages/package-1/owned-asset-1.png",
					sha256: "a".repeat(64),
				},
			],
		},
	});
	const input = {
		expectedRevision: 0,
		generated: { assetIds: [], childRuns: [] },
		harnessSelection: { recommendedCandidateId: "candidate-1" },
		idempotencyKey: "harness-copy:task-1",
		kind: "image_text" as const,
		marketing: {
			declaration: {
				normalizedIntent: "介绍本店已确认服务",
				taskType: "daily_service_exposure" as const,
				deliveryLayer: "copy" as const,
				relevantAssetCategories: ["product_service"],
				usedAssetCategories: ["product_service"],
				route: "customized" as const,
				routingSource: "model" as const,
				implicitConstraints: [],
			},
			contextBundle: {
				bundleId: "bundle-1",
				revision: 1,
				hash: "b".repeat(64),
			},
			factRefs: ["store_fact:service-1:1"],
			rightsRefs: ["selected-asset-1"],
			identityRefs: [],
			identityFallback: "brand_official" as const,
		},
		occurredAt: "2026-07-22T09:00:00.000Z",
		packageId: "package-1",
		platform: "douyin" as const,
		snapshotId: "snapshot-task-1",
			snapshot: {
				id: "snapshot-task-1",
				revision: 1,
				schemaVersion: "creation-execution-snapshot/v1" as const,
			},
			sourceContentPackage: { id: "source-package-1", revision: "3" },
			taskId: "task-1",
		version: {
			body: "预约文案正文",
			conversionHook: "私信预约",
			createdAt: "2026-07-22T09:00:00.000Z",
			createdBy: "harness-task-1",
			harnessCandidateId: "candidate-1",
			harnessScore: 92,
			id: "version-1",
			orderedAssetIds: ["selected-asset-1"],
			source: "ai_generated" as const,
			title: "夏日护理预约",
			topics: [],
		},
		workId: "work-1",
		workflowId: "task-1",
		workflowRevision: 1,
		workspaceId: "workspace-1",
	};
	const inputWithVariants = {
		...input,
		variants: (["xiaohongshu", "douyin", "video_account"] as const).map(
			(platform) => ({
				currentVersionId: `version-1-${platform}`,
				id: `package-1-${platform}`,
				platform,
				versions: [
					{
						...input.version,
						id: `version-1-${platform}`,
					},
				],
			}),
		),
	};

	await assert.rejects(
		writer.write({
			...input,
			idempotencyKey: "harness-copy:other-task",
			snapshotId: "snapshot-other-task",
			snapshot: { ...input.snapshot, id: "snapshot-other-task" },
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
			error.code === "CONTENT_PACKAGE_EXECUTION_MISMATCH",
	);
	const resumedInput = {
		...input,
		idempotencyKey: "harness-copy:semantic-decision",
		snapshotId: "snapshot-decision-1",
		snapshot: {
			...input.snapshot,
			id: "snapshot-decision-1",
			semanticDecision: { sourceSnapshotId: "snapshot-task-1" },
		},
	};
	const resumedDelivery = await writer.write(resumedInput);
	assert.deepEqual(resumedDelivery, {
		packageId: "package-1",
		revision: 1,
		versionId: "version-1",
	});
	assert.equal(
		writer.get("workspace-1", "package-1")?.source.creationExecutionSnapshot?.id,
		"snapshot-task-1",
	);
	writer.seed({
		...writer.get("workspace-1", "package-1")!,
		currentVersionId: undefined,
		revision: 0,
		versions: [],
	});
	await assert.rejects(
		writer.write({
			...input,
			idempotencyKey: "harness-copy:other-workflow-revision",
			workflowRevision: 2,
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
			error.code === "CONTENT_PACKAGE_EXECUTION_MISMATCH",
	);
	await assert.rejects(
		writer.write({
			...input,
			idempotencyKey: "harness-copy:other-task",
			taskId: "task-other",
			workflowId: "task-other",
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
			error.code === "CONTENT_PACKAGE_EXECUTION_MISMATCH",
	);
	await assert.rejects(
		writer.write({
			...input,
			idempotencyKey: "harness-copy:other-work",
			workId: "work-other",
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
				error.code === "CONTENT_PACKAGE_EXECUTION_MISMATCH",
	);
	await assert.rejects(
		writer.write({
			...input,
			idempotencyKey: "harness-copy:other-platform",
			platform: "xiaohongshu",
		}),
		(error: unknown) =>
				error instanceof ContentPackageRevisionWriteError &&
				error.code === "CONTENT_PACKAGE_EXECUTION_MISMATCH",
	);
	await assert.rejects(
		writer.write({
			...input,
			idempotencyKey: "harness-copy:other-source-package",
			sourceContentPackage: { id: "source-package-1", revision: "4" },
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
				error.code === "CONTENT_PACKAGE_EXECUTION_MISMATCH",
	);
	await assert.rejects(
		writer.write({
			...input,
			idempotencyKey: "harness-copy:source-role-is-not-deliverable",
			version: {
				...input.version,
				id: "version-source-role",
				orderedAssetIds: ["source-asset-1"],
			},
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
			error.code === "CONTENT_PACKAGE_ASSET_MISMATCH",
	);
	const delivered = await writer.write(inputWithVariants);
	assert.deepEqual(delivered, {
		packageId: "package-1",
		revision: 1,
		versionId: "version-1",
	});
	assert.deepEqual(
		await writer.write({
			...inputWithVariants,
			occurredAt: "2026-07-22T10:00:00.000Z",
		}),
		delivered,
	);
	assert.deepEqual(writer.get("workspace-1", "package-1")?.generated.ownedAssets, [
		{
			contentType: "image/png",
			id: "owned-asset-1",
			objectKey: "packages/package-1/owned-asset-1.png",
			sha256: "a".repeat(64),
		},
	]);
	assert.deepEqual(
		writer.get("workspace-1", "package-1")?.source.sourceContentPackage,
		{ id: "source-package-1", revision: "3" },
	);
	assert.deepEqual(
		writer.get("workspace-1", "package-1")?.source.assetIds,
		["selected-asset-1"],
	);
	assert.deepEqual(
		writer.get("workspace-1", "package-1")?.variants,
		inputWithVariants.variants,
	);
	assert.deepEqual(
		writer.get("workspace-1", "package-1")?.marketing?.factRefs,
		["store_fact:service-1:1"],
	);
	assert.deepEqual(
		writer.get("workspace-1", "package-1")?.marketing?.rightsRefs,
		["selected-asset-1"],
	);
	assert.equal(
		writer.get("workspace-1", "package-1")?.versions.at(-1)?.conversionHook,
		"私信预约",
	);
	selectedAssetAvailable = false;
	await assert.rejects(
		writer.write({
			...inputWithVariants,
			idempotencyKey: "harness-copy:after-selected-asset-revocation",
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
			error.code === "CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE",
	);
	selectedAssetAvailable = true;
	writer.seed({
		...sourceContentPackage(),
		rights: {
			state: "revoked",
			revokedAt: "2026-07-22T10:01:00.000Z",
		},
	});
	await assert.rejects(
		writer.write({
			...input,
			idempotencyKey: "harness-copy:after-source-revocation",
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
			error.code === "CONTENT_PACKAGE_SOURCE_UNAVAILABLE",
	);
});

test("video delivery resolves source rights from a frozen source ContentPackage", async () => {
	const rightsRequests: Array<{
		assetIds: string[];
		platform?: string;
		workspaceId: string;
	}> = [];
	const assetRights = {
		async resolve(input: {
			assetIds: string[];
			platform?: string;
			workspaceId: string;
		}) {
			rightsRequests.push(input);
			return {
				knownAssetIds: input.assetIds,
				unauthorizedAssetIds: [],
			};
		},
	};
	const writer = new MemoryContentPackageRevisionWritePort(assetRights);
	writer.seed(sourceContentPackage());
	writer.seed(
		buildContentPackage({
			id: "package-video-1",
			kind: "video",
			source: {
				assetIds: [],
				creationExecutionSnapshot: {
					id: "snapshot-video-1",
					revision: 1,
					schemaVersion: "creation-execution-snapshot/v1",
				},
				sourceContentPackage: {
					id: "source-package-1",
					revision: "3",
				},
				targetPlatform: "douyin",
				workflowId: "task-video-1",
				workflowRevision: 1,
				workId: "work-video-1",
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
	);
	const version = {
		body: "视频正文",
		createdAt: "2026-07-22T09:00:00.000Z",
		id: "version-video-1",
		orderedAssetIds: ["generated-video-1"],
		source: "ai_generated" as const,
		title: "夏日护理视频",
		topics: [],
	};
	const variants = (["xiaohongshu", "douyin", "video_account"] as const).map(
		(platform) => ({
			currentVersionId: `${version.id}-${platform}`,
			id: `package-video-1-${platform}`,
			platform,
			versions: [{ ...version, id: `${version.id}-${platform}` }],
		}),
	);

	await writer.write({
		expectedRevision: 0,
		generated: {
			assetIds: ["generated-video-1"],
			childRuns: [],
			ownedAssets: [
				{
					contentType: "video/mp4",
					id: "generated-video-1",
					objectKey: "packages/package-video-1/generated-video-1.mp4",
					sha256: "c".repeat(64),
				},
			],
		},
		idempotencyKey: "harness-video:task-video-1",
		kind: "video",
		marketing: {
			contextBundle: {
				bundleId: "bundle-video-1",
				hash: "d".repeat(64),
				revision: 1,
			},
			declaration: {
				deliveryLayer: "finished_media",
				implicitConstraints: [],
				normalizedIntent: "生成门店宣传视频",
				relevantAssetCategories: ["product_service"],
				route: "customized",
				routingSource: "model",
				taskType: "daily_service_exposure",
				usedAssetCategories: ["product_service"],
			},
			factRefs: [],
			identityRefs: [],
			identityFallback: "brand_official",
			rightsRefs: ["selected-asset-1"],
		},
		occurredAt: "2026-07-22T09:00:00.000Z",
		packageId: "package-video-1",
		platform: "douyin",
		snapshot: {
			id: "snapshot-video-1",
			revision: 1,
			schemaVersion: "creation-execution-snapshot/v1",
		},
		snapshotId: "snapshot-video-1",
		sourceContentPackage: { id: "source-package-1", revision: "3" },
		taskId: "task-video-1",
		variants,
		version,
		workId: "work-video-1",
		workflowId: "task-video-1",
		workflowRevision: 1,
		workspaceId: "workspace-1",
	});

	const persisted = writer.get("workspace-1", "package-video-1");
	assert.ok(persisted);
	const douyinVariant = persisted.variants.find(
		(variant) => variant.platform === "douyin",
	);
	const douyinVersion = douyinVariant?.versions.find(
		(candidate) => candidate.id === douyinVariant.currentVersionId,
	);
	assert.ok(douyinVersion);
	const resolver = new ContentPackageRightsBasisResolver(assetRights, {
		async getRegistryRevision() {
			throw new Error("Source authorization must not consult generation terms.");
		},
	});

	assert.deepEqual(
		await resolver.resolve({
			contentPackage: persisted,
			platform: "douyin",
			version: douyinVersion,
			workspaceId: "workspace-1",
		}),
		{
			kind: "source_asset_authorizations",
			rightsRefs: ["selected-asset-1"],
		},
	);
	assert.deepEqual(rightsRequests.at(-1), {
		assetIds: ["selected-asset-1"],
		platform: "douyin",
		workspaceId: "workspace-1",
	});
});

test("delivery inherits generation receipts across two lineage hops", async () => {
	const rightsRequests: Array<{ assetIds: string[]; workspaceId: string }> =
		[];
	const writer = new MemoryContentPackageRevisionWritePort({
		async resolve(input) {
			rightsRequests.push({
				assetIds: [...input.assetIds],
				workspaceId: input.workspaceId,
			});
			return {
				knownAssetIds: input.assetIds,
				unauthorizedAssetIds: [],
			};
		},
	});

	const grandmother = {
		...buildContentPackage({
			id: "pkg-grandmother",
			kind: "image_text" as const,
			source: {
				assetIds: [],
				targetPlatform: "xiaohongshu" as const,
				workflowId: "task-g",
				workflowRevision: 1,
				workId: "work-g",
			},
			timestamp: "2026-07-22T08:00:00.000Z",
			workspaceId: "workspace-lineage",
		}),
		currentVersionId: "version-g",
		generated: {
			assetIds: ["gen-g"],
			childRuns: [],
			ownedAssets: [
				{
					contentType: "image/png",
					id: "gen-g",
					objectKey: "packages/pkg-grandmother/gen-g.png",
					sha256: "g".repeat(64),
				},
			],
		},
		revision: 1,
		status: "accepted" as const,
		versions: [
			{
				body: "grandmother body",
				createdAt: "2026-07-22T08:00:00.000Z",
				id: "version-g",
				orderedAssetIds: ["gen-g"],
				source: "ai_generated" as const,
				title: "grandmother",
				topics: [],
			},
		],
	};
	const mother = {
		...buildContentPackage({
			id: "pkg-mother",
			kind: "image_text" as const,
			source: {
				assetIds: [],
				sourceContentPackage: {
					id: "pkg-grandmother",
					revision: "1",
				},
				targetPlatform: "xiaohongshu" as const,
				workflowId: "task-m",
				workflowRevision: 1,
				workId: "work-m",
			},
			timestamp: "2026-07-22T08:30:00.000Z",
			workspaceId: "workspace-lineage",
		}),
		currentVersionId: "version-m",
		generated: {
			assetIds: ["gen-m"],
			childRuns: [],
			ownedAssets: [
				{
					contentType: "image/png",
					id: "gen-m",
					objectKey: "packages/pkg-mother/gen-m.png",
					sha256: "m".repeat(64),
				},
			],
		},
		lineage: { reusedFromPackageId: "pkg-grandmother" },
		revision: 1,
		status: "accepted" as const,
		versions: [
			{
				body: "mother body",
				createdAt: "2026-07-22T08:30:00.000Z",
				id: "version-m",
				// Re-delivers grandmother generation receipt plus own generation.
				orderedAssetIds: ["gen-g", "gen-m"],
				source: "ai_generated" as const,
				title: "mother",
				topics: [],
			},
		],
	};
	const derived = buildContentPackage({
		id: "pkg-derived",
		kind: "image_text",
		source: {
			assetIds: [],
			creationExecutionSnapshot: {
				id: "snapshot-derived",
				revision: 1,
				schemaVersion: "creation-execution-snapshot/v1",
			},
			sourceContentPackage: { id: "pkg-mother", revision: "1" },
			targetPlatform: "xiaohongshu",
			workflowId: "task-derived",
			workflowRevision: 1,
			workId: "work-derived",
		},
		timestamp: "2026-07-22T09:00:00.000Z",
		workspaceId: "workspace-lineage",
	});
	writer.seed(grandmother);
	writer.seed(mother);
	writer.seed({
		...derived,
		lineage: { reusedFromPackageId: "pkg-mother" },
	});

	const version = {
		body: "derived body",
		createdAt: "2026-07-22T09:00:00.000Z",
		id: "version-derived",
		// Two-hop inheritance: gen-g (grandmother) + gen-m (mother) + gen-d (this write).
		orderedAssetIds: ["gen-g", "gen-m", "gen-d"],
		source: "ai_generated" as const,
		title: "derived",
		topics: [],
	};
	const delivery = await writer.write({
		expectedRevision: 0,
		generated: {
			assetIds: ["gen-d"],
			childRuns: [],
			ownedAssets: [
				{
					contentType: "image/png",
					id: "gen-d",
					objectKey: "packages/pkg-derived/gen-d.png",
					sha256: "d".repeat(64),
				},
			],
		},
		idempotencyKey: "harness-note:task-derived",
		kind: "image_text",
		occurredAt: "2026-07-22T09:00:00.000Z",
		packageId: "pkg-derived",
		platform: "xiaohongshu",
		snapshot: {
			id: "snapshot-derived",
			revision: 1,
			schemaVersion: "creation-execution-snapshot/v1",
		},
		snapshotId: "snapshot-derived",
		sourceContentPackage: { id: "pkg-mother", revision: "1" },
		taskId: "task-derived",
		version,
		workId: "work-derived",
		workflowId: "task-derived",
		workflowRevision: 1,
		workspaceId: "workspace-lineage",
	});

	assert.deepEqual(delivery, {
		packageId: "pkg-derived",
		revision: 1,
		versionId: "version-derived",
	});
	// Inherited generation receipts must not be sent to merchant rights.
	assert.deepEqual(rightsRequests, []);
	assert.deepEqual(
		writer.get("workspace-lineage", "pkg-derived")?.generated.assetIds,
		["gen-d"],
	);
});

test("delivery still refuses a non-generated merchant asset after lineage exemption", async () => {
	const writer = new MemoryContentPackageRevisionWritePort({
		async resolve({ assetIds }) {
			return {
				knownAssetIds: assetIds,
				// Merchant source is known but no longer authorized.
				unauthorizedAssetIds: assetIds.filter(
					(assetId) => assetId === "merchant-source-1",
				),
			};
		},
	});

	const grandmother = {
		...buildContentPackage({
			id: "pkg-g2",
			kind: "image_text" as const,
			source: {
				assetIds: [],
				targetPlatform: "xiaohongshu" as const,
				workflowId: "task-g2",
				workflowRevision: 1,
				workId: "work-g2",
			},
			timestamp: "2026-07-22T08:00:00.000Z",
			workspaceId: "workspace-lineage-2",
		}),
		currentVersionId: "version-g2",
		generated: {
			assetIds: ["gen-g2"],
			childRuns: [],
			ownedAssets: [
				{
					contentType: "image/png",
					id: "gen-g2",
					objectKey: "packages/pkg-g2/gen-g2.png",
					sha256: "g".repeat(64),
				},
			],
		},
		revision: 1,
		status: "accepted" as const,
		versions: [
			{
				body: "g2 body",
				createdAt: "2026-07-22T08:00:00.000Z",
				id: "version-g2",
				orderedAssetIds: ["gen-g2"],
				source: "ai_generated" as const,
				title: "g2",
				topics: [],
			},
		],
	};
	const mother = {
		...buildContentPackage({
			id: "pkg-m2",
			kind: "image_text" as const,
			source: {
				// Merchant asset is freeze-bound source material on the mother package.
				assetIds: ["merchant-source-1"],
				sourceContentPackage: { id: "pkg-g2", revision: "1" },
				targetPlatform: "xiaohongshu" as const,
				workflowId: "task-m2",
				workflowRevision: 1,
				workId: "work-m2",
			},
			timestamp: "2026-07-22T08:30:00.000Z",
			workspaceId: "workspace-lineage-2",
		}),
		currentVersionId: "version-m2",
		generated: {
			assetIds: ["gen-m2"],
			childRuns: [],
			ownedAssets: [
				{
					contentType: "image/png",
					id: "gen-m2",
					objectKey: "packages/pkg-m2/gen-m2.png",
					sha256: "m".repeat(64),
				},
			],
		},
		lineage: { reusedFromPackageId: "pkg-g2" },
		revision: 1,
		status: "accepted" as const,
		versions: [
			{
				body: "m2 body",
				createdAt: "2026-07-22T08:30:00.000Z",
				id: "version-m2",
				orderedAssetIds: ["merchant-source-1", "gen-g2", "gen-m2"],
				source: "ai_generated" as const,
				title: "m2",
				topics: [],
			},
		],
	};
	writer.seed(grandmother);
	writer.seed(mother);
	writer.seed({
		...buildContentPackage({
			id: "pkg-d2",
			kind: "image_text",
			source: {
				assetIds: [],
				creationExecutionSnapshot: {
					id: "snapshot-d2",
					revision: 1,
					schemaVersion: "creation-execution-snapshot/v1",
				},
				sourceContentPackage: { id: "pkg-m2", revision: "1" },
				targetPlatform: "xiaohongshu",
				workflowId: "task-d2",
				workflowRevision: 1,
				workId: "work-d2",
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-lineage-2",
		}),
		lineage: { reusedFromPackageId: "pkg-m2" },
	});

	await assert.rejects(
		writer.write({
			expectedRevision: 0,
			generated: {
				assetIds: ["gen-d2"],
				childRuns: [],
				ownedAssets: [
					{
						contentType: "image/png",
						id: "gen-d2",
						objectKey: "packages/pkg-d2/gen-d2.png",
						sha256: "d".repeat(64),
					},
				],
			},
			idempotencyKey: "harness-note:task-d2",
			kind: "image_text",
			occurredAt: "2026-07-22T09:00:00.000Z",
			packageId: "pkg-d2",
			platform: "xiaohongshu",
			snapshot: {
				id: "snapshot-d2",
				revision: 1,
				schemaVersion: "creation-execution-snapshot/v1",
			},
			snapshotId: "snapshot-d2",
			sourceContentPackage: { id: "pkg-m2", revision: "1" },
			taskId: "task-d2",
			version: {
				body: "d2 body",
				createdAt: "2026-07-22T09:00:00.000Z",
				id: "version-d2",
				// Inherited gens + unauthorized merchant freeze-bound source.
				orderedAssetIds: [
					"merchant-source-1",
					"gen-g2",
					"gen-m2",
					"gen-d2",
				],
				source: "ai_generated" as const,
				title: "d2",
				topics: [],
			},
			workId: "work-d2",
			workflowId: "task-d2",
			workflowRevision: 1,
			workspaceId: "workspace-lineage-2",
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
			error.code === "CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE" &&
			error.message ===
				"Live asset rights no longer permit this delivery.",
	);
	assert.equal(writer.get("workspace-lineage-2", "pkg-d2")?.revision, 0);
	assert.equal(
		writer.get("workspace-lineage-2", "pkg-d2")?.currentVersionId,
		undefined,
	);
});

function sourceContentPackage() {
	return {
		...buildContentPackage({
			id: "source-package-1",
			kind: "image_text",
			source: { assetIds: ["source-asset-1"] },
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
		currentVersionId: "source-version-1",
		revision: 3,
		status: "accepted" as const,
		versions: [
			{
				body: "来源内容正文",
				createdAt: "2026-07-22T09:00:00.000Z",
				id: "source-version-1",
				orderedAssetIds: ["selected-asset-1"],
				title: "来源内容",
				topics: [],
			},
		],
	};
}
