/**
 * #141 contract: copy / image / video share one ContentPackage revision write
 * port (OCC + idempotency). New top-level Composer traffic must not invent a
 * second package write path.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildContentPackage } from "../operations/content-package.js";

import {
	ContentPackageRevisionWriteError,
	MemoryContentPackageRevisionWritePort,
} from "./content-package-revision-port.js";

const here = dirname(fileURLToPath(import.meta.url));

test("copy, image, and video share one OCC revision write port and idempotency rules", async () => {
	const writer = new MemoryContentPackageRevisionWritePort();
	const base = {
		expectedRevision: 0,
		generated: {
			assetIds: [] as string[],
			childRuns: [] as [],
			ownedAssets: [
				{
					contentType: "image/png" as const,
					id: "owned-asset-1",
					objectKey: "packages/package-1/owned-asset-1.png",
					sha256: "b".repeat(64),
				},
			],
		},
		occurredAt: "2026-07-22T12:00:00.000Z",
		packageId: "package-1",
		platform: "xiaohongshu" as const,
		snapshot: {
			id: "snapshot-1",
			revision: 1,
			schemaVersion: "creation-execution-snapshot/v1" as const,
		},
		snapshotId: "snapshot-1",
		taskId: "task-1",
		workId: "work-1",
		workflowId: "task-1",
		workflowRevision: 1,
		workspaceId: "workspace-1",
	};

	writer.seed({
		...buildContentPackage({
			id: "package-1",
			kind: "image_text",
			source: {
				assetIds: [],
				creationExecutionSnapshot: base.snapshot,
				targetPlatform: "xiaohongshu",
				workId: "work-1",
				workflowId: "task-1",
				workflowRevision: 1,
			},
			timestamp: "2026-07-22T12:00:00.000Z",
			workspaceId: "workspace-1",
		}),
		generated: { assetIds: [], childRuns: [], ownedAssets: [] },
	});

	const version = {
		body: "文案正文",
		conversionHook: "私信",
		createdAt: "2026-07-22T12:00:00.000Z",
		createdBy: "harness-task-1",
		harnessCandidateId: "copy-1",
		harnessScore: 90,
		id: "version-copy",
		orderedAssetIds: ["owned-asset-1"],
		source: "ai_generated" as const,
		title: "文案标题",
		topics: [] as string[],
	};
	const writeInput = {
		...base,
		harnessSelection: { recommendedCandidateId: "copy-1" },
		idempotencyKey: "harness-copy:task-1",
		kind: "image_text" as const,
		version,
	};

	const copyDelivery = await writer.write(writeInput);
	assert.deepEqual(copyDelivery, {
		packageId: "package-1",
		revision: 1,
		versionId: "version-copy",
	});

	// Same key + payload is idempotent for every modality family.
	assert.deepEqual(await writer.write(writeInput), copyDelivery);

	// Same key with a different payload conflicts (sole write-port contract).
	await assert.rejects(
		writer.write({
			...writeInput,
			version: {
				...version,
				body: "另一版",
				id: "version-other",
				title: "另一标题",
			},
		}),
		(error: unknown) =>
			error instanceof ContentPackageRevisionWriteError &&
			error.code === "CONTENT_PACKAGE_WRITE_IDEMPOTENCY_CONFLICT",
	);
});

test("Composer HTTP is the sole public submission entry (static route contract)", () => {
	const serverSource = readFileSync(join(here, "../../server.ts"), "utf8");
	assert.match(serverSource, /p1\/composer\/submissions/);
	assert.match(serverSource, /composerSubmission/);
	// Old multi-command top-level create is not a dedicated public Composer route.
	assert.doesNotMatch(
		serverSource,
		/p1\/composer\/create_content_package|composer\/confirmQuote|composer\/create-then-submit/,
	);
});
