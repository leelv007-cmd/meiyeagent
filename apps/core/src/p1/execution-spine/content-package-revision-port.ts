import { createHash } from "node:crypto";

import {
	contentPackageSchema,
	type ContentPackage,
	type ContentPackageKind,
	type ContentPackagePlatform,
	type ContentPackageRevisionDelivery,
	type ContentPackageVersion,
} from "@meiye/contracts";
import type { Pool, PoolClient } from "pg";

import { harnessRuntimeId } from "../harness/workspace-scope.js";
import type { VisibleClaimExtraction } from "../harness/policy-gates.js";
import type { TrustedUsageEvidence } from "../product-billing/quote-service.js";
import {
	HarnessCopyWorkAssetWriteError,
	type HarnessCopyWorkAsset,
	writeHarnessCopyWorkAsset,
} from "../operations/harness-copy-work-asset.js";
import { updateContentPackageRow } from "../operations/postgres-content-package-write-adapter.js";
import type { ContentPackageRightsResolverPort } from "../operations/types.js";

export interface ContentPackageRevisionWriteInput {
	additionalVersions?: ContentPackageVersion[];
	billingTrustedUsage?: TrustedUsageEvidence;
	claimExtraction?: VisibleClaimExtraction;
	expectedRevision: number;
	generated: Pick<
		ContentPackage["generated"],
		"assetIds" | "childRuns" | "ownedAssets"
	>;
	harnessSelection?: ContentPackage["harnessSelection"];
	idempotencyKey: string;
	kind: ContentPackageKind;
	status?: 'partial' | 'review_ready';
	marketing?: ContentPackage["marketing"];
	occurredAt: string;
	packageId: string;
	platform?: ContentPackagePlatform;
	variants?: ContentPackage["variants"];
	workAsset?: HarnessCopyWorkAsset;
	snapshotId: string;
	snapshot: {
		id: string;
		revision: number;
		schemaVersion: "creation-execution-snapshot/v1";
		semanticDecision?: {
			sourceSnapshotId: string;
		};
	};
	sourceContentPackage?: {
		id: string;
		revision: string;
	};
	taskId: string;
	version: ContentPackageVersion;
	workId: string;
	workflowId: string;
	workflowRevision: number;
	workspaceId: string;
}

export interface ContentPackageRevisionWritePort {
	write(
		input: ContentPackageRevisionWriteInput,
	): Promise<ContentPackageRevisionDelivery>;
}

export class ContentPackageRevisionWriteError extends Error {
	readonly status = 409;

	constructor(
		readonly code:
			| "CONTENT_PACKAGE_ASSET_MISMATCH"
			| "CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE"
			| "CONTENT_PACKAGE_NOT_FOUND"
			| "CONTENT_PACKAGE_KIND_MISMATCH"
			| "CONTENT_PACKAGE_EXECUTION_MISMATCH"
			| "CONTENT_PACKAGE_SOURCE_UNAVAILABLE"
			| "CONTENT_PACKAGE_REVISION_CONFLICT"
			| "CONTENT_PACKAGE_WRITE_IDEMPOTENCY_CONFLICT"
			| "CONTENT_PACKAGE_VERSION_ALREADY_EXISTS",
		message: string,
		readonly currentRevision?: number,
	) {
		super(message);
		this.name = "ContentPackageRevisionWriteError";
	}
}

/**
 * One revision/OCC write boundary for Composer delivery. Provider output reaches
 * this port only after Model Supply has recorded any required asset receipt.
 */
export class PostgresContentPackageRevisionWritePort
	implements ContentPackageRevisionWritePort
{
	constructor(
		private readonly pool: Pool,
		private readonly assetRights?: ContentPackageRightsResolverPort,
	) {}

	async applySchema() {
		await this.pool.query(`
			CREATE SCHEMA IF NOT EXISTS execution_spine;
			CREATE TABLE IF NOT EXISTS execution_spine.content_package_write_receipts (
				workspace_id text NOT NULL,
				package_id text NOT NULL,
				idempotency_key text NOT NULL,
				fingerprint text NOT NULL,
				delivery jsonb NOT NULL,
				created_at timestamptz NOT NULL DEFAULT now(),
				PRIMARY KEY (workspace_id, package_id, idempotency_key)
			);

			CREATE SCHEMA IF NOT EXISTS harness_runtime;
			CREATE TABLE IF NOT EXISTS harness_runtime.audit_events (
				id text PRIMARY KEY,
				workflow_id text NOT NULL,
				stage text NOT NULL,
				event_type text NOT NULL,
				payload jsonb NOT NULL,
				created_at timestamptz NOT NULL DEFAULT now()
			);
			CREATE TABLE IF NOT EXISTS harness_runtime.langfuse_outbox (
				audit_id text PRIMARY KEY REFERENCES harness_runtime.audit_events(id)
					ON DELETE CASCADE,
				status text NOT NULL CHECK (status IN ('queued', 'sending', 'failed', 'sent', 'dead_letter', 'discarded')),
				attempts integer NOT NULL DEFAULT 0,
				next_attempt_at timestamptz NOT NULL DEFAULT now(),
				last_error text,
				dead_lettered_at timestamptz,
				updated_at timestamptz NOT NULL DEFAULT now()
			);
			ALTER TABLE harness_runtime.langfuse_outbox
				ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
			ALTER TABLE harness_runtime.langfuse_outbox
				DROP CONSTRAINT IF EXISTS langfuse_outbox_status_check;
			ALTER TABLE harness_runtime.langfuse_outbox
				ADD CONSTRAINT langfuse_outbox_status_check
				CHECK (status IN ('queued', 'sending', 'failed', 'sent', 'dead_letter', 'discarded'));
		`);
	}

	async write(input: ContentPackageRevisionWriteInput) {
		const fingerprint = writeFingerprint(input);
		const versions = versionsForInput(input);
		const client = await this.pool.connect();
		let inTransaction = false;
		try {
			await client.query("BEGIN");
			inTransaction = true;
			if (this.assetRights) {
				// Product mutations acquire this same workspace lock. Holding it while
				// resolving rights makes the final permission read stable through the
				// ContentPackage write transaction.
				await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
					input.workspaceId,
				]);
			}
			await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
				`${input.workspaceId}:${input.packageId}`,
			]);
			const receipt = await client.query<{
				delivery: ContentPackageRevisionDelivery;
				fingerprint: string;
			}>(
				`SELECT delivery, fingerprint
				   FROM execution_spine.content_package_write_receipts
				  WHERE workspace_id=$1 AND package_id=$2 AND idempotency_key=$3`,
				[input.workspaceId, input.packageId, input.idempotencyKey],
			);
			const existing = receipt.rows[0];
			if (existing) {
				await client.query("COMMIT");
				inTransaction = false;
				if (existing.fingerprint !== fingerprint) {
					throw new ContentPackageRevisionWriteError(
						"CONTENT_PACKAGE_WRITE_IDEMPOTENCY_CONFLICT",
						"This ContentPackage write key was reused with a different payload.",
					);
				}
				return structuredClone(existing.delivery);
			}

			const current = await client.query<{
				payload: unknown;
				revision: string;
			}>(
				`SELECT payload, revision::text AS revision
				   FROM p1_content_packages
				  WHERE workspace_id=$1 AND id=$2
				  FOR UPDATE`,
				[input.workspaceId, input.packageId],
			);
			const row = current.rows[0];
			if (!row) {
				throw new ContentPackageRevisionWriteError(
					"CONTENT_PACKAGE_NOT_FOUND",
					"The ContentPackage was not found in the active workspace.",
				);
			}
			const contentPackage = contentPackageSchema.parse(row.payload);
			if (contentPackage.kind !== input.kind) {
				throw new ContentPackageRevisionWriteError(
					"CONTENT_PACKAGE_KIND_MISMATCH",
					"The ContentPackage kind does not match the requested deliverable.",
				);
			}
			assertExecutionBinding(contentPackage, input);
			const sourceContentPackage =
				await assertPostgresSourceContentPackageAvailable(client, input);
				assertDeliveredAssetBinding(
					contentPackage,
					sourceContentPackage,
					versions,
					generatedAssetIds(input),
				);
				await assertLiveDeliveredAssetRights(this.assetRights, input, versions);
			const currentRevision = Number(row.revision);
			if (currentRevision !== input.expectedRevision) {
				throw new ContentPackageRevisionWriteError(
					"CONTENT_PACKAGE_REVISION_CONFLICT",
					`ContentPackage expected revision ${input.expectedRevision}, current revision is ${currentRevision}.`,
					currentRevision,
				);
			}
			if (
				new Set(versions.map((version) => version.id)).size !==
					versions.length ||
				versions.some((version) =>
					contentPackage.versions.some(
						(currentVersion) => currentVersion.id === version.id,
					),
				)
			) {
				throw new ContentPackageRevisionWriteError(
					"CONTENT_PACKAGE_VERSION_ALREADY_EXISTS",
					"The ContentPackage already contains a requested version ID.",
					currentRevision,
				);
			}

			const revision = currentRevision + 1;
			const delivery = {
				packageId: input.packageId,
				revision,
				versionId: input.version.id,
			};
			if (input.workAsset) {
				await writeHarnessCopyWorkAsset(client, input.workAsset);
			}
			const updated = contentPackageSchema.parse({
				...contentPackage,
				currentVersionId: input.version.id,
				...(input.harnessSelection
					? { harnessSelection: structuredClone(input.harnessSelection) }
					: {}),
				...(input.marketing ? { marketing: structuredClone(input.marketing) } : {}),
				generated: {
					assetIds: unique([
						...contentPackage.generated.assetIds,
						...input.generated.assetIds,
					]),
					childRuns: uniqueByRunId([
						...contentPackage.generated.childRuns,
						...input.generated.childRuns,
					]),
					...((contentPackage.generated.ownedAssets?.length ?? 0) > 0 ||
						(input.generated.ownedAssets?.length ?? 0) > 0
						? {
							ownedAssets: uniqueByAssetId([
								...(contentPackage.generated.ownedAssets ?? []),
								...(input.generated.ownedAssets ?? []),
							]),
						}
						: {}),
				},
				revision,
				source: {
					...contentPackage.source,
					...(input.platform ? { targetPlatform: input.platform } : {}),
					workflowId: input.taskId,
					workflowRevision: input.workflowRevision,
					workId: input.workId,
				},
				status: input.status ?? "review_ready",
				updatedAt: input.occurredAt,
				variants: input.variants ?? contentPackage.variants,
				versions: [...contentPackage.versions, ...versions],
			});
			const written = await updateContentPackageRow(client, {
				expectedRevision: input.expectedRevision,
				id: input.packageId,
				payload: updated,
				revision,
				updatedAt: input.occurredAt,
				workspaceId: input.workspaceId,
			});
			if (!written) {
				throw new Error("ContentPackage OCC failed while holding its write lock.");
			}
			await writeHarnessDeliveryAuditAndOutbox(
				client,
				input,
				delivery,
				fingerprint,
			);
			await client.query(
				`INSERT INTO execution_spine.content_package_write_receipts
				   (workspace_id, package_id, idempotency_key, fingerprint, delivery)
				 VALUES ($1, $2, $3, $4, $5::jsonb)`,
				[
					input.workspaceId,
					input.packageId,
					input.idempotencyKey,
					fingerprint,
					JSON.stringify(delivery),
				],
			);
			await client.query("COMMIT");
			inTransaction = false;
			return delivery;
		} catch (error) {
			if (inTransaction) await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
}

/** Test seam with the same revision and idempotency guarantees. */
export class MemoryContentPackageRevisionWritePort
	implements ContentPackageRevisionWritePort
{
	private readonly receipts = new Map<
		string,
		{ delivery: ContentPackageRevisionDelivery; fingerprint: string }
	>();
	private readonly packages = new Map<string, ContentPackage>();
	private readonly workAssets = new Map<string, HarnessCopyWorkAsset>();

	constructor(private readonly assetRights?: ContentPackageRightsResolverPort) {}

	seed(contentPackage: ContentPackage) {
		this.packages.set(
			`${contentPackage.workspaceId}:${contentPackage.id}`,
			structuredClone(contentPackage),
		);
	}

	get(workspaceId: string, packageId: string) {
		const value = this.packages.get(`${workspaceId}:${packageId}`);
		return value ? structuredClone(value) : null;
	}

	getWorkAsset(workspaceId: string, assetId: string) {
		const value = this.workAssets.get(`${workspaceId}:${assetId}`);
		return value ? structuredClone(value) : null;
	}

	async write(input: ContentPackageRevisionWriteInput) {
		const receiptKey = `${input.workspaceId}:${input.packageId}:${input.idempotencyKey}`;
		const fingerprint = writeFingerprint(input);
		const versions = versionsForInput(input);
		const prior = this.receipts.get(receiptKey);
		if (prior) {
			if (prior.fingerprint !== fingerprint) {
				throw new ContentPackageRevisionWriteError(
					"CONTENT_PACKAGE_WRITE_IDEMPOTENCY_CONFLICT",
					"This ContentPackage write key was reused with a different payload.",
				);
			}
			return structuredClone(prior.delivery);
		}
		const packageKey = `${input.workspaceId}:${input.packageId}`;
		const contentPackage = this.packages.get(packageKey);
		if (!contentPackage) {
			throw new ContentPackageRevisionWriteError(
				"CONTENT_PACKAGE_NOT_FOUND",
				"The ContentPackage was not found in the active workspace.",
			);
		}
		if (contentPackage.kind !== input.kind) {
			throw new ContentPackageRevisionWriteError(
				"CONTENT_PACKAGE_KIND_MISMATCH",
				"The ContentPackage kind does not match the requested deliverable.",
			);
		}
		assertExecutionBinding(contentPackage, input);
		const sourceContentPackage = assertSourceContentPackageAvailable(
			input.sourceContentPackage
				? this.packages.get(
						`${input.workspaceId}:${input.sourceContentPackage.id}`,
					)
				: undefined,
			input,
		);
		assertDeliveredAssetBinding(
			contentPackage,
			sourceContentPackage,
			versions,
			generatedAssetIds(input),
		);
		await assertLiveDeliveredAssetRights(this.assetRights, input, versions);
		if (contentPackage.revision !== input.expectedRevision) {
			throw new ContentPackageRevisionWriteError(
				"CONTENT_PACKAGE_REVISION_CONFLICT",
				`ContentPackage expected revision ${input.expectedRevision}, current revision is ${contentPackage.revision}.`,
				contentPackage.revision,
			);
		}
		if (
			new Set(versions.map((version) => version.id)).size !==
				versions.length ||
			versions.some((version) =>
				contentPackage.versions.some(
					(currentVersion) => currentVersion.id === version.id,
				),
			)
		) {
			throw new ContentPackageRevisionWriteError(
				"CONTENT_PACKAGE_VERSION_ALREADY_EXISTS",
				"The ContentPackage already contains a requested version ID.",
				contentPackage.revision,
			);
		}
		const revision = contentPackage.revision + 1;
		const delivery = {
			packageId: input.packageId,
			revision,
			versionId: input.version.id,
		};
		const updated = contentPackageSchema.parse({
			...contentPackage,
			currentVersionId: input.version.id,
			...(input.harnessSelection
				? { harnessSelection: structuredClone(input.harnessSelection) }
				: {}),
			...(input.marketing ? { marketing: structuredClone(input.marketing) } : {}),
			generated: {
				assetIds: unique([
					...contentPackage.generated.assetIds,
					...input.generated.assetIds,
				]),
				childRuns: uniqueByRunId([
					...contentPackage.generated.childRuns,
					...input.generated.childRuns,
				]),
				...((contentPackage.generated.ownedAssets?.length ?? 0) > 0 ||
					(input.generated.ownedAssets?.length ?? 0) > 0
					? {
						ownedAssets: uniqueByAssetId([
							...(contentPackage.generated.ownedAssets ?? []),
							...(input.generated.ownedAssets ?? []),
						]),
					}
					: {}),
			},
			revision,
			source: {
				...contentPackage.source,
				...(input.platform ? { targetPlatform: input.platform } : {}),
				workflowId: input.taskId,
				workflowRevision: input.workflowRevision,
				workId: input.workId,
			},
			status: input.status ?? "review_ready",
			updatedAt: input.occurredAt,
			variants: input.variants ?? contentPackage.variants,
			versions: [...contentPackage.versions, ...versions],
		});
		if (input.workAsset) {
			const assetKey = `${input.workspaceId}:${input.workAsset.id}`;
			const priorAsset = this.workAssets.get(assetKey);
			if (
				priorAsset &&
				JSON.stringify(canonicalValue(priorAsset)) !==
					JSON.stringify(canonicalValue(input.workAsset))
			) {
				throw new HarnessCopyWorkAssetWriteError(
					"HARNESS_COPY_ASSET_CONFLICT",
					"The deterministic Harness Copy asset ID already has different content.",
				);
			}
			this.workAssets.set(assetKey, structuredClone(input.workAsset));
		}
		this.packages.set(packageKey, updated);
		this.receipts.set(receiptKey, { delivery, fingerprint });
		return structuredClone(delivery);
	}
}

function writeFingerprint(input: ContentPackageRevisionWriteInput) {
	const {
		additionalVersions,
		billingTrustedUsage: _billingTrustedUsage,
		marketing: _marketing,
		occurredAt: _occurredAt,
		version,
		...semanticInput
	} = input;
	// Server-derived delivery evidence may be recomputed during a retry; the
	// durable receipt remains keyed by the immutable execution payload.
	return createHash("sha256")
		.update(
			JSON.stringify(
				canonicalValue({
					...semanticInput,
					...(additionalVersions
						? {
							additionalVersions:
								additionalVersions.map(versionWithoutCreatedAt),
						}
						: {}),
					version: versionWithoutCreatedAt(version),
				}),
			),
		)
		.digest("hex");
}

function versionsForInput(input: ContentPackageRevisionWriteInput) {
	return [
		structuredClone(input.version),
		...(input.additionalVersions ?? []).map((version) =>
			structuredClone(version),
		),
	];
}

function assertExecutionBinding(
	contentPackage: ContentPackage,
	input: ContentPackageRevisionWriteInput,
) {
	const snapshot = contentPackage.source.creationExecutionSnapshot;
	const sourceContentPackage = contentPackage.source.sourceContentPackage;
	const boundSnapshotId =
		input.snapshot.semanticDecision?.sourceSnapshotId ?? input.snapshotId;
	if (
		!snapshot ||
		input.snapshotId !== input.snapshot.id ||
		snapshot.id !== boundSnapshotId ||
		snapshot.revision !== input.snapshot.revision ||
		snapshot.schemaVersion !== input.snapshot.schemaVersion ||
		input.taskId !== input.workflowId ||
		contentPackage.source.targetPlatform !== input.platform ||
		contentPackage.source.workflowId !== input.taskId ||
		contentPackage.source.workflowRevision !== input.workflowRevision ||
		contentPackage.source.workId !== input.workId ||
		!sameSourceContentPackageReference(
			sourceContentPackage,
			input.sourceContentPackage,
		)
	) {
		throw new ContentPackageRevisionWriteError(
			"CONTENT_PACKAGE_EXECUTION_MISMATCH",
			"The ContentPackage shell is not bound to this execution snapshot and workflow.",
		);
	}
}

function sameSourceContentPackageReference(
	left: ContentPackage["source"]["sourceContentPackage"],
	right: ContentPackageRevisionWriteInput["sourceContentPackage"],
) {
	return (
		left?.id === right?.id &&
		left?.revision === right?.revision
	);
}

async function assertPostgresSourceContentPackageAvailable(
	client: PoolClient,
	input: ContentPackageRevisionWriteInput,
): Promise<ContentPackage | undefined> {
	if (!input.sourceContentPackage) return undefined;
	const source = await client.query<{
		payload: unknown;
		revision: string;
	}>(
		`SELECT payload, revision::text AS revision
		   FROM p1_content_packages
		  WHERE workspace_id=$1 AND id=$2
		  FOR SHARE`,
		[input.workspaceId, input.sourceContentPackage.id],
	);
	const row = source.rows[0];
	const contentPackage = row ? contentPackageSchema.parse(row.payload) : undefined;
	return assertSourceContentPackageAvailable(contentPackage, input, row?.revision);
}

function assertSourceContentPackageAvailable(
	contentPackage: ContentPackage | undefined,
	input: ContentPackageRevisionWriteInput,
	storedRevision?: string,
): ContentPackage | undefined {
	const source = input.sourceContentPackage;
	if (!source) return undefined;
	if (
		!contentPackage ||
		contentPackage.workspaceId !== input.workspaceId ||
		contentPackage.id !== source.id ||
		String(contentPackage.revision) !== source.revision ||
		(storedRevision !== undefined && storedRevision !== source.revision) ||
		contentPackage.rights.state !== "authorized" ||
		(contentPackage.status !== "accepted" &&
			contentPackage.status !== "review_ready") ||
		!contentPackage.currentVersionId ||
		!contentPackage.versions.some(
			(version) => version.id === contentPackage.currentVersionId,
		)
	) {
		throw new ContentPackageRevisionWriteError(
			"CONTENT_PACKAGE_SOURCE_UNAVAILABLE",
			"The frozen source ContentPackage is no longer available for delivery.",
		);
	}
	return contentPackage;
}

function assertDeliveredAssetBinding(
	contentPackage: ContentPackage,
	sourceContentPackage: ContentPackage | undefined,
	versions: ContentPackageVersion[],
	ownedGeneratedAssetIds: readonly string[] = [],
) {
	const allowedAssetIds = new Set(contentPackage.source.assetIds);
	const sourceCurrentVersion = sourceContentPackage?.versions.find(
		(version) => version.id === sourceContentPackage.currentVersionId,
	);
	for (const assetId of sourceCurrentVersion?.orderedAssetIds ?? []) {
		allowedAssetIds.add(assetId);
	}
	// Newly produced Model Supply receipts may be ordered on the version while
	// remaining outside the frozen source set; they must still be owned here.
	for (const assetId of ownedGeneratedAssetIds) {
		allowedAssetIds.add(assetId);
	}
	const foreignAssetIds = [
		...new Set(
			versions
				.flatMap((version) => version.orderedAssetIds)
				.filter((assetId) => !allowedAssetIds.has(assetId)),
		),
	];
	if (foreignAssetIds.length > 0) {
		throw new ContentPackageRevisionWriteError(
			"CONTENT_PACKAGE_ASSET_MISMATCH",
			`The delivery references assets outside the execution snapshot: ${foreignAssetIds.join(", ")}.`,
		);
	}
}

function generatedAssetIds(input: ContentPackageRevisionWriteInput) {
	return [
		...new Set([
			...input.generated.assetIds,
			...(input.generated.ownedAssets?.map((asset) => asset.id) ?? []),
		]),
	];
}

async function assertLiveDeliveredAssetRights(
	rights: ContentPackageRightsResolverPort | undefined,
	input: ContentPackageRevisionWriteInput,
	versions: ContentPackageVersion[],
) {
	// Owned Model Supply receipts are recorded by generation, not merchant
	// source rights. Only freeze-bound source/order assets need live rights.
	const ownedGenerated = new Set(generatedAssetIds(input));
	const assetIds = [
		...new Set(
			versions
				.flatMap((version) => version.orderedAssetIds)
				.filter((assetId) => !ownedGenerated.has(assetId)),
		),
	];
	if (assetIds.length === 0) return;
	if (!rights) {
		throw new ContentPackageRevisionWriteError(
			"CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE",
			"Live asset-rights verification is unavailable for this delivery.",
		);
	}
	const resolution = await rights.resolve({
		assetIds,
		workspaceId: input.workspaceId,
	});
	const knownAssetIds = resolution.knownAssetIds
		? new Set(resolution.knownAssetIds)
		: undefined;
	if (
		resolution.unauthorizedAssetIds.length > 0 ||
		(knownAssetIds && assetIds.some((assetId) => !knownAssetIds.has(assetId)))
	) {
		throw new ContentPackageRevisionWriteError(
			"CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE",
			"Live asset rights no longer permit this delivery.",
		);
	}
}

async function writeHarnessDeliveryAuditAndOutbox(
	client: PoolClient,
	input: ContentPackageRevisionWriteInput,
	delivery: ContentPackageRevisionDelivery,
	requestFingerprint: string,
) {
	const runtimeWorkflowId = harnessRuntimeId(input.workspaceId, input.workflowId);
	const auditId = harnessRuntimeId(
		input.workspaceId,
		`audit-${input.workflowId}-package-delivered`,
	);
	await client.query(
		`INSERT INTO harness_runtime.audit_events
		   (id, workflow_id, stage, event_type, payload)
		 VALUES ($1,$2,'assembly_delivery','package_delivered',$3::jsonb)
		 ON CONFLICT (id) DO NOTHING`,
		[
			auditId,
			runtimeWorkflowId,
			JSON.stringify({
				workspaceId: input.workspaceId,
				expectedRevision: input.expectedRevision,
				requestFingerprint,
				...(input.claimExtraction
					? { claimExtraction: input.claimExtraction }
					: {}),
				...(input.billingTrustedUsage
					? { billingTrustedUsage: input.billingTrustedUsage }
					: {}),
				...delivery,
			}),
		],
	);
	await client.query(
		`INSERT INTO harness_runtime.langfuse_outbox (audit_id, status)
		 VALUES ($1,'queued') ON CONFLICT (audit_id) DO NOTHING`,
		[auditId],
	);
}

function versionWithoutCreatedAt(version: ContentPackageVersion) {
	const { createdAt: _createdAt, ...semanticVersion } = version;
	return semanticVersion;
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, item]) => [key, canonicalValue(item)]),
		);
	}
	return value;
}

function unique(values: string[]) {
	return [...new Set(values)];
}

function uniqueByRunId(values: ContentPackage["generated"]["childRuns"]) {
	return [...new Map(values.map((value) => [value.runId, value])).values()];
}

function uniqueByAssetId(
	values: NonNullable<ContentPackage["generated"]["ownedAssets"]>,
) {
	return [...new Map(values.map((value) => [value.id, value])).values()];
}
