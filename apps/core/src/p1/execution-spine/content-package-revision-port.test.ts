import assert from "node:assert/strict";
import test from "node:test";

import { buildContentPackage } from "../operations/content-package.js";

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
			scene: "daily_service_exposure" as const,
			capabilities: {
				mainRecommendation: true as const,
				platformDeliverables: true as const,
				factsAndRights: true as const,
				quickEdit: true as const,
				publishExport: true as const,
				asyncRecovery: true as const,
				remix: true as const,
			},
			contextBundle: {
				bundleId: "bundle-1",
				revision: 1,
				hash: "b".repeat(64),
			},
			factRefs: ["store_fact:service-1:1"],
			rightsRefs: ["selected-asset-1"],
			identityRefs: [],
			identityFallback: "none" as const,
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
