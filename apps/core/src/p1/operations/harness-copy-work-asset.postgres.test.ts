import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { contentPackageSchema } from "@meiye/contracts";
import { Pool } from "pg";

import {
	PostgresContentPackageRevisionWritePort,
	type ContentPackageRevisionWriteInput,
} from "../execution-spine/content-package-revision-port.js";
import { buildContentPackage } from "./content-package.js";
import {
	harnessCopyWorkAssetId,
	type HarnessCopyWorkAsset,
} from "./harness-copy-work-asset.js";
import { PostgresOperationsRepository } from "./postgres-repository.js";
import type { CreativeWork } from "./types.js";

const connectionString = process.env.TEST_DATABASE_URL;

test("Harness Copy delivery lands one deterministic winner text asset atomically", {
	skip: connectionString ? false : "TEST_DATABASE_URL is not configured",
}, async () => {
	const pool = new Pool({ connectionString });
	const suffix = randomUUID();
	const workspaceId = `copy-asset-workspace-${suffix}`;
	const workId = `copy-asset-work-${suffix}`;
	const packageId = `copy-asset-package-${suffix}`;
	const taskId = `copy-asset-task-${suffix}`;
	const snapshotId = `copy-asset-snapshot-${suffix}`;
	const versionId = `copy-asset-version-${suffix}`;
	const occurredAt = "2026-07-25T12:00:00.000Z";
	const assetId = harnessCopyWorkAssetId({
		revisionId: versionId,
		workId,
		workspaceId,
	});
	const workAsset: HarnessCopyWorkAsset = {
		body: "确定性交付正文",
		candidateIndex: 0,
		conversionHook: "私信预约",
		createdAt: occurredAt,
		id: assetId,
		jobId: taskId,
		kind: "text",
		title: "确定性交付标题",
		workId,
		workspaceId,
	};
	const work: CreativeWork = {
		createdAt: occurredAt,
		id: workId,
		intent: "生成护理预约文案",
		mode: "agent",
		sessionId: `session-${suffix}`,
		sourceReferences: [],
		status: "running",
		updatedAt: occurredAt,
		workspaceId,
	};
	const contentPackage = buildContentPackage({
		id: packageId,
		kind: "image_text",
		source: {
			assetIds: [],
			creationExecutionSnapshot: {
				id: snapshotId,
				revision: 1,
				schemaVersion: "creation-execution-snapshot/v1",
			},
			targetPlatform: "douyin",
			workflowId: taskId,
			workflowRevision: 1,
			workId,
		},
		timestamp: occurredAt,
		workspaceId,
	});
	const version = {
		body: workAsset.body,
		conversionHook: workAsset.conversionHook,
		createdAt: occurredAt,
		createdBy: `harness-${taskId}`,
		harnessCandidateId: "candidate-winner",
		harnessScore: 95,
		id: versionId,
		orderedAssetIds: [],
		source: "ai_generated" as const,
		title: workAsset.title,
		topics: [],
	};
	const input: ContentPackageRevisionWriteInput = {
		expectedRevision: 0,
		generated: { assetIds: [assetId], childRuns: [] },
		harnessSelection: { recommendedCandidateId: "candidate-winner" },
		idempotencyKey: `harness-copy:${taskId}`,
		kind: "image_text",
		occurredAt,
		packageId,
		platform: "douyin",
		snapshot: {
			id: snapshotId,
			revision: 1,
			schemaVersion: "creation-execution-snapshot/v1",
		},
		snapshotId,
		taskId,
		variants: (["xiaohongshu", "douyin", "video_account"] as const).map(
			(platform) => ({
				currentVersionId: `${versionId}-${platform}`,
				id: `${packageId}-${platform}`,
				platform,
				versions: [{ ...version, id: `${versionId}-${platform}` }],
			}),
		),
		version,
		workAsset,
		workId,
		workflowId: taskId,
		workflowRevision: 1,
		workspaceId,
	};

	try {
		const repository = new PostgresOperationsRepository(pool);
		await repository.migrate();
		const writer = new PostgresContentPackageRevisionWritePort(pool);
		await writer.applySchema();
		await pool.query(
			`INSERT INTO p1_creative_works (workspace_id, id, payload, updated_at)
			 VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
			[workspaceId, workId, JSON.stringify(work), occurredAt],
		);
		await pool.query(
			`INSERT INTO p1_content_packages
			   (workspace_id, id, payload, revision, updated_at)
			 VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)`,
			[
				workspaceId,
				packageId,
				JSON.stringify(contentPackage),
				contentPackage.revision,
				occurredAt,
			],
		);

		const deliveries = await Promise.all([writer.write(input), writer.write(input)]);
		assert.deepEqual(deliveries[0], deliveries[1]);
		const persisted = await pool.query<{
			asset_count: number;
			asset_payload: HarnessCopyWorkAsset;
			package_payload: unknown;
			work_status: CreativeWork["status"];
		}>(
			`SELECT
			   (SELECT count(*)::int FROM p1_creative_assets
			     WHERE workspace_id=$1 AND payload->>'workId'=$2) AS asset_count,
			   (SELECT payload FROM p1_creative_assets
			     WHERE workspace_id=$1 AND id=$3) AS asset_payload,
			   (SELECT payload FROM p1_content_packages
			     WHERE workspace_id=$1 AND id=$4) AS package_payload,
			   (SELECT payload->>'status' FROM p1_creative_works
			     WHERE workspace_id=$1 AND id=$2) AS work_status`,
			[workspaceId, workId, assetId, packageId],
		);
		const row = persisted.rows[0]!;
		const deliveredPackage = contentPackageSchema.parse(row.package_payload);
		assert.equal(row.asset_count, 1);
		assert.deepEqual(row.asset_payload, workAsset);
		assert.equal(row.work_status, "completed");
		assert.equal(deliveredPackage.status, "review_ready");
		assert.equal(deliveredPackage.versions.length, 1);
		assert.equal(deliveredPackage.variants.length, 3);
		assert.equal(deliveredPackage.harnessSelection?.adoptedCandidateId, undefined);
		assert.deepEqual(deliveredPackage.generated.assetIds, [assetId]);
	} finally {
		await pool.query(
			`DELETE FROM harness_runtime.langfuse_outbox
			  WHERE audit_id IN (
			    SELECT id
			      FROM harness_runtime.audit_events
			     WHERE payload->>'workspaceId'=$1
			  )`,
			[workspaceId],
		);
		await pool.query(
			"DELETE FROM harness_runtime.audit_events WHERE payload->>'workspaceId'=$1",
			[workspaceId],
		);
		await pool.query(
			"DELETE FROM execution_spine.content_package_write_receipts WHERE workspace_id=$1",
			[workspaceId],
		);
		await pool.query("DELETE FROM p1_creative_assets WHERE workspace_id=$1", [
			workspaceId,
		]);
		await pool.query("DELETE FROM p1_creative_works WHERE workspace_id=$1", [
			workspaceId,
		]);
		await pool.query("DELETE FROM p1_content_packages WHERE workspace_id=$1", [
			workspaceId,
		]);
		await pool.end();
	}
});

test("Harness Copy work asset ID is stable for the same revision", () => {
	const input = {
		revisionId: "revision-1",
		workId: "work-1",
		workspaceId: "workspace-1",
	};
	assert.equal(harnessCopyWorkAssetId(input), harnessCopyWorkAssetId(input));
	assert.notEqual(
		harnessCopyWorkAssetId(input),
		harnessCopyWorkAssetId({ ...input, revisionId: "revision-2" }),
	);
});
