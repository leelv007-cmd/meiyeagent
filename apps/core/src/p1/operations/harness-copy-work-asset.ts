import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type { PoolClient } from "pg";

import type { CreativeAssetProjection, CreativeWork } from "./types.js";

export type HarnessCopyWorkAsset = Pick<
	CreativeAssetProjection,
	| "candidateIndex"
	| "createdAt"
	| "id"
	| "jobId"
	| "title"
	| "workId"
	| "workspaceId"
> & {
	body: string;
	conversionHook?: string;
	kind: "text";
};

export class HarnessCopyWorkAssetWriteError extends Error {
	readonly status = 409;

	constructor(
		readonly code:
			| "HARNESS_COPY_ASSET_CONFLICT"
			| "HARNESS_COPY_WORK_MISMATCH"
			| "HARNESS_COPY_WORK_NOT_DELIVERABLE"
			| "HARNESS_COPY_WORK_NOT_FOUND",
		message: string,
	) {
		super(message);
		this.name = "HarnessCopyWorkAssetWriteError";
	}
}

export function harnessCopyWorkAssetId(input: {
	revisionId: string;
	workId: string;
	workspaceId: string;
}) {
	const digest = createHash("sha256")
		.update(
			JSON.stringify({
				revisionId: input.revisionId,
				workId: input.workId,
				workspaceId: input.workspaceId,
			}),
		)
		.digest("hex")
		.slice(0, 20);
	return `${input.workId}-harness-copy-${digest}`;
}

export async function writeHarnessCopyWorkAsset(
	client: PoolClient,
	asset: HarnessCopyWorkAsset,
) {
	const result = await client.query<{ payload: CreativeWork }>(
		`SELECT payload
		   FROM p1_creative_works
		  WHERE workspace_id=$1 AND id=$2
		  FOR UPDATE`,
		[asset.workspaceId, asset.workId],
	);
	const work = result.rows[0]?.payload;
	if (!work) {
		throw new HarnessCopyWorkAssetWriteError(
			"HARNESS_COPY_WORK_NOT_FOUND",
			"The Harness Copy work was not found in the active workspace.",
		);
	}
	if (work.workspaceId !== asset.workspaceId || work.id !== asset.workId) {
		throw new HarnessCopyWorkAssetWriteError(
			"HARNESS_COPY_WORK_MISMATCH",
			"The Harness Copy asset does not match its canonical work.",
		);
	}
	if (work.status === "failed") {
		throw new HarnessCopyWorkAssetWriteError(
			"HARNESS_COPY_WORK_NOT_DELIVERABLE",
			"A failed Harness Copy work cannot receive a delivered asset.",
		);
	}

	await client.query(
		`INSERT INTO p1_creative_assets (workspace_id, id, payload, updated_at)
		 VALUES ($1, $2, $3::jsonb, $4::timestamptz)
		 ON CONFLICT (workspace_id, id) DO NOTHING`,
		[
			asset.workspaceId,
			asset.id,
			JSON.stringify(asset),
			asset.createdAt,
		],
	);
	const stored = await client.query<{ payload: HarnessCopyWorkAsset }>(
		`SELECT payload
		   FROM p1_creative_assets
		  WHERE workspace_id=$1 AND id=$2`,
		[asset.workspaceId, asset.id],
	);
	if (!stored.rows[0] || !isDeepStrictEqual(stored.rows[0].payload, asset)) {
		throw new HarnessCopyWorkAssetWriteError(
			"HARNESS_COPY_ASSET_CONFLICT",
			"The deterministic Harness Copy asset ID already has different content.",
		);
	}

	if (work.status === "draft" || work.status === "running") {
		const completed = {
			...work,
			status: "completed" as const,
			updatedAt: asset.createdAt,
		};
		await client.query(
			`UPDATE p1_creative_works
			    SET payload=$3::jsonb, updated_at=$4::timestamptz
			  WHERE workspace_id=$1 AND id=$2`,
			[
				asset.workspaceId,
				asset.workId,
				JSON.stringify(completed),
				asset.createdAt,
			],
		);
	}
}
