import { createHash } from "node:crypto";
import type {
	AdvancedCanvasRevision,
	CanvasExportReceiptFailureReason,
	CanvasExportReceiptRepository,
	CanvasExportRetrievalReceipt,
	JsonValue,
} from "@meiye/core/pro-studio";
import { zipSync } from "fflate";

export type CanvasExportAssetUnavailableCode =
	| "ASSET_ACCESS_DENIED"
	| "ASSET_EXPIRED"
	| "ASSET_PRIVATE_RETRIEVAL_DENIED"
	| "ASSET_RECEIPT_INVALID"
	| "ASSET_REVOKED"
	| "ASSET_STORAGE_UNAVAILABLE";

/** Internal availability reasons. They are never default export HTTP errors. */
export type CanvasExportUnavailableCode =
	| CanvasExportAssetUnavailableCode
	| "EXPORT_NOT_AVAILABLE";

export type CanvasRevisionExportErrorCode =
	| "EXPORT_NOT_AVAILABLE"
	| "REVISION_NOT_FOUND";

export type CanvasExportWarningCode =
	| CanvasExportAssetUnavailableCode
	| "EXPORT_SIZE_LIMIT_EXCEEDED";

export class CanvasRevisionExportError extends Error {
	constructor(
		readonly code: CanvasRevisionExportErrorCode,
		message: string,
	) {
		super(message);
		this.name = "CanvasRevisionExportError";
	}
}

export type CanvasRevisionExportAsset = {
	bytes: Uint8Array;
	contentType: string;
	fileName: string;
	id: string;
	receipt: {
		id: string;
		storageRevision?: string;
	};
	sha256: string;
	sizeBytes: number;
	workspaceId: string;
};

export type CanvasRevisionExportAssetDecision =
	| { kind: "available"; asset: CanvasRevisionExportAsset }
	| { code: CanvasExportAssetUnavailableCode; kind: "unavailable" };

/**
 * The owning Asset boundary must check current workspace access, rights,
 * revocation, expiry, export policy, and private retrieval eligibility before
 * returning bytes. Canvas never reconstructs those facts from graph metadata.
 */
export interface CanvasRevisionExportAssetPort {
	resolve(input: {
		assetId: string;
		userId: string;
		workspaceId: string;
	}): Promise<CanvasRevisionExportAssetDecision>;
}

export interface CanvasRevisionExportPort {
	export(input: {
		idempotencyKey: string;
		includeAvailableOnly: boolean;
		revision: AdvancedCanvasRevision;
		userId: string;
		workspaceId: string;
	}): Promise<CanvasRevisionExportArtifact>;
}

export type CanvasRevisionExportArtifact = {
	contentType: "application/zip";
	fileName: string;
	manifest: CanvasRevisionExportManifest;
	manifestSha256: string;
	receiptId: string;
	retrievals: CanvasExportRetrievalReceipt[];
	totalBytes: number;
	zipBytes: Uint8Array;
	zipSha256: string;
};

export type CanvasRevisionExportManifest = {
	assets: Array<{
		contentType: string;
		fileName: string;
		id: string;
		path: string;
		retrievalReceiptId: string;
		sha256: string;
		sizeBytes: number;
		storageRevision?: string;
	}>;
	exportReceiptId: string;
	format: "pro-studio-canvas-export/v1";
	project: {
		id: string;
		revisionId: string;
	};
	revision: AdvancedCanvasRevision;
	warnings: Array<{
		assetId: string;
		code: CanvasExportWarningCode;
	}>;
};

export const CANVAS_EXPORT_FILE_NAME = "canvas-export.zip";
/** zipSync is bounded until the Core delivery contract can safely stream bytes. */
export const MAX_CANVAS_EXPORT_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;

const ZIP_MTIME = new Date(1980, 0, 1);

type PreparedExportAsset = {
	asset: CanvasRevisionExportAsset;
	fileName: string;
	path: string;
	retrievalReceiptId: string;
};

class CanvasExportBuildFailure extends Error {
	constructor(
		readonly reason: CanvasExportReceiptFailureReason,
		readonly assetId?: string,
	) {
		super(reason);
		this.name = "CanvasExportBuildFailure";
	}
}

/**
 * Builds a bounded deterministic download from an already-frozen Canvas
 * revision. A durable Core audit receipt pins idempotent retries to the same
 * export facts; every retry still re-reads current Core authorization before
 * it can return bytes.
 */
export class CanvasRevisionExportService implements CanvasRevisionExportPort {
	private readonly maxUncompressedBytes: number;

	constructor(
		private readonly assets: CanvasRevisionExportAssetPort,
		private readonly receipts: CanvasExportReceiptRepository,
		options: { maxUncompressedBytes?: number } = {},
	) {
		this.maxUncompressedBytes =
			options.maxUncompressedBytes ?? MAX_CANVAS_EXPORT_UNCOMPRESSED_BYTES;
	}

	async export(input: {
		idempotencyKey: string;
		includeAvailableOnly: boolean;
		revision: AdvancedCanvasRevision;
		userId: string;
		workspaceId: string;
	}): Promise<CanvasRevisionExportArtifact> {
		let safeRevision: AdvancedCanvasRevision;
		try {
			safeRevision = safeRevisionForExport(input.revision);
		} catch {
			throw unavailableExport();
		}
		if (
			input.revision.workspaceId !== input.workspaceId ||
			!validExportLimit(this.maxUncompressedBytes)
		) {
			throw unavailableExport();
		}

		let claim: Awaited<ReturnType<CanvasExportReceiptRepository["claim"]>>;
		try {
			claim = await this.receipts.claim({
				idempotencyKeyHash: sha256Text(input.idempotencyKey),
				projectId: input.revision.projectId,
				requestHash: sha256(
					jsonBytes({
						includeAvailableOnly: input.includeAvailableOnly,
						revision: input.revision,
						userId: input.userId,
						workspaceId: input.workspaceId,
					}),
				),
				revisionId: input.revision.id,
				userId: input.userId,
				workspaceId: input.workspaceId,
			});
		} catch {
			throw unavailableExport();
		}
		if (claim.kind === "conflict") throw unavailableExport();
		const receipt = claim.receipt;

		try {
			const artifact = await this.build({
				includeAvailableOnly: input.includeAvailableOnly,
				receiptId: receipt.id,
				revision: safeRevision,
				userId: input.userId,
				workspaceId: input.workspaceId,
			});
			await this.receipts.complete({
				manifestSha256: artifact.manifestSha256,
				receipt,
				retrievals: artifact.retrievals,
				totalBytes: artifact.totalBytes,
				warnings: artifact.manifest.warnings,
				zipSha256: artifact.zipSha256,
			});
			return { ...artifact, receiptId: receipt.id };
		} catch (error) {
			const failure =
				error instanceof CanvasExportBuildFailure
					? error
					: new CanvasExportBuildFailure("receipt_persistence_failed");
			try {
				await this.receipts.recordFailure({
					...(failure.assetId ? { assetId: failure.assetId } : {}),
					reason: failure.reason,
					receipt,
				});
			} catch {
				// Receipt/audit failure must never turn into a successful export.
			}
			throw unavailableExport();
		}
	}

	private async build(input: {
		includeAvailableOnly: boolean;
		receiptId: string;
		revision: AdvancedCanvasRevision;
		userId: string;
		workspaceId: string;
	}) {
		const assetIds = referencedAssetIds(input.revision);
		const revisionBytes = jsonBytes(input.revision);
		const prepared: PreparedExportAsset[] = [];
		const warnings: CanvasRevisionExportManifest["warnings"] = [];
		let selectedBytes = revisionBytes.byteLength;

		for (const assetId of assetIds) {
			const decision = await this.resolve(
				assetId,
				input.userId,
				input.workspaceId,
			);
			if (decision.kind === "unavailable") {
				if (input.includeAvailableOnly) {
					warnings.push({ assetId, code: decision.code });
					continue;
				}
				throw assetFailure(assetId, decision.code);
			}
			const asset = decision.asset;
			const validation = validateExportAsset(asset, assetId, input.workspaceId);
			if (validation) {
				if (input.includeAvailableOnly) {
					warnings.push({ assetId, code: validation });
					continue;
				}
				throw assetFailure(assetId, validation);
			}
			const fileName = safeArchiveFileName(
				asset.contentType,
				prepared.length + 1,
			);
			const path = `assets/${fileName}`;
			if (selectedBytes + asset.sizeBytes > this.maxUncompressedBytes) {
				if (input.includeAvailableOnly) {
					warnings.push({ assetId, code: "EXPORT_SIZE_LIMIT_EXCEEDED" });
					continue;
				}
				throw new CanvasExportBuildFailure(
					"export_size_limit_exceeded",
					assetId,
				);
			}
			selectedBytes += asset.sizeBytes;
			prepared.push({
				asset,
				fileName,
				path,
				retrievalReceiptId: retrievalReceiptId(input.receiptId, asset),
			});
		}

		if (assetIds.length > 0 && prepared.length === 0) {
			throw new CanvasExportBuildFailure(
				warnings.some(
					(warning) => warning.code === "EXPORT_SIZE_LIMIT_EXCEEDED",
				)
					? "export_size_limit_exceeded"
					: "asset_access_denied",
			);
		}

		const manifest: CanvasRevisionExportManifest = {
			assets: prepared
				.map(({ asset, fileName, path, retrievalReceiptId }) => ({
					contentType: asset.contentType,
					fileName,
					id: asset.id,
					path,
					retrievalReceiptId,
					sha256: asset.sha256,
					sizeBytes: asset.sizeBytes,
					...(asset.receipt.storageRevision
						? { storageRevision: asset.receipt.storageRevision }
						: {}),
				}))
				.sort((left, right) => left.id.localeCompare(right.id)),
			exportReceiptId: input.receiptId,
			format: "pro-studio-canvas-export/v1",
			project: {
				id: input.revision.projectId,
				revisionId: input.revision.id,
			},
			revision: structuredClone(input.revision),
			warnings: warnings.sort((left, right) =>
				left.assetId.localeCompare(right.assetId),
			),
		};
		const manifestBytes = jsonBytes(manifest);
		if (selectedBytes + manifestBytes.byteLength > this.maxUncompressedBytes) {
			throw new CanvasExportBuildFailure("export_size_limit_exceeded");
		}
		const files: Record<string, Uint8Array> = {
			"manifest.json": manifestBytes,
			"revision.json": revisionBytes,
		};
		for (const entry of prepared) {
			files[entry.path] = Uint8Array.from(entry.asset.bytes);
		}
		const zipBytes = deterministicZip(files);
		if (zipBytes.byteLength > this.maxUncompressedBytes) {
			throw new CanvasExportBuildFailure("export_size_limit_exceeded");
		}
		const retrievals = prepared
			.slice()
			.sort((left, right) => left.asset.id.localeCompare(right.asset.id))
			.map(({ asset, retrievalReceiptId }) => ({
				assetId: asset.id,
				id: retrievalReceiptId,
				sha256: asset.sha256,
				sizeBytes: asset.sizeBytes,
				sourceReceiptId: asset.receipt.id,
				...(asset.receipt.storageRevision
					? { storageRevision: asset.receipt.storageRevision }
					: {}),
			}));
		return {
			contentType: "application/zip" as const,
			fileName: CANVAS_EXPORT_FILE_NAME,
			manifest,
			manifestSha256: sha256(manifestBytes),
			retrievals,
			totalBytes: selectedBytes + manifestBytes.byteLength,
			zipBytes,
			zipSha256: sha256(zipBytes),
		};
	}

	private async resolve(assetId: string, userId: string, workspaceId: string) {
		try {
			return await this.assets.resolve({ assetId, userId, workspaceId });
		} catch {
			return {
				code: "ASSET_STORAGE_UNAVAILABLE" as const,
				kind: "unavailable" as const,
			};
		}
	}
}

export function exportUnavailablePort(): CanvasRevisionExportPort {
	return {
		async export() {
			throw unavailableExport();
		},
	};
}

function referencedAssetIds(revision: AdvancedCanvasRevision) {
	return [
		...new Set(
			revision.graph.nodes
				.map((node) => node.data.assetId)
				.filter(
					(assetId): assetId is string =>
						typeof assetId === "string" && assetId.length > 0,
				),
		),
	].sort((left, right) => left.localeCompare(right));
}

function validateExportAsset(
	asset: CanvasRevisionExportAsset,
	expectedAssetId: string,
	workspaceId: string,
): CanvasExportAssetUnavailableCode | undefined {
	if (asset.id !== expectedAssetId || asset.workspaceId !== workspaceId) {
		return "ASSET_ACCESS_DENIED";
	}
	if (
		!asset.receipt.id.trim() ||
		!asset.contentType.trim() ||
		!asset.fileName.trim() ||
		!Number.isSafeInteger(asset.sizeBytes) ||
		asset.sizeBytes < 0 ||
		!/^[a-f0-9]{64}$/u.test(asset.sha256)
	) {
		return "ASSET_RECEIPT_INVALID";
	}
	if (
		asset.bytes.byteLength !== asset.sizeBytes ||
		sha256(asset.bytes) !== asset.sha256
	) {
		return "ASSET_RECEIPT_INVALID";
	}
	return undefined;
}

function assetFailure(assetId: string, code: CanvasExportAssetUnavailableCode) {
	return new CanvasExportBuildFailure(assetFailureReason(code), assetId);
}

function assetFailureReason(
	code: CanvasExportAssetUnavailableCode,
): CanvasExportReceiptFailureReason {
	switch (code) {
		case "ASSET_EXPIRED":
			return "asset_expired";
		case "ASSET_PRIVATE_RETRIEVAL_DENIED":
			return "asset_private_retrieval_denied";
		case "ASSET_RECEIPT_INVALID":
			return "asset_receipt_invalid";
		case "ASSET_REVOKED":
			return "asset_revoked";
		case "ASSET_STORAGE_UNAVAILABLE":
			return "asset_storage_unavailable";
		default:
			return "asset_access_denied";
	}
}

function retrievalReceiptId(
	exportReceiptId: string,
	asset: CanvasRevisionExportAsset,
) {
	return `canvas-retrieval-${sha256Text(
		[
			exportReceiptId,
			asset.id,
			asset.receipt.id,
			asset.receipt.storageRevision ?? "",
			asset.sha256,
		].join("\0"),
	).slice(0, 32)}`;
}

function safeRevisionForExport(
	revision: AdvancedCanvasRevision,
): AdvancedCanvasRevision {
	return {
		...revision,
		graph: {
			edges: revision.graph.edges.map((edge) => ({ ...edge })),
			nodes: revision.graph.nodes.map((node) => ({
				data: sanitizeData(node.data),
				id: node.id,
				type: node.type,
			})),
			schemaVersion: 1,
		},
	};
}

function sanitizeData(
	value: Record<string, JsonValue>,
): Record<string, JsonValue> {
	const sanitized = sanitizeJson(value, 0);
	if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== "object") {
		throw new Error("Canvas node data is invalid.");
	}
	return sanitized;
}

function sanitizeJson(value: JsonValue, depth: number): JsonValue | undefined {
	if (depth > 64) throw new Error("Canvas export graph is too deep.");
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string")
		return sensitiveValue(value) ? undefined : value;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeJson(item, depth + 1) ?? null);
	}
	if (typeof value !== "object")
		throw new Error("Canvas node data is invalid.");
	const sanitized: Record<string, JsonValue> = {};
	for (const [key, child] of Object.entries(value)) {
		if (sensitiveKey(key)) continue;
		const next = sanitizeJson(child, depth + 1);
		if (next !== undefined) sanitized[key] = next;
	}
	return sanitized;
}

function sensitiveKey(key: string) {
	return /(?:base64|data[_-]?url|storage[_-]?key|object[_-]?key|remote[_-]?url|server[_-]?url|signed(?:[_-]?(?:url|uri))?|provider|deployment|credential|secret|token|authorization|api[_-]?key|access[_-]?key|signature)/iu.test(
		key.normalize("NFKC"),
	);
}

function sensitiveValue(value: string) {
	const trimmed = value.trim();
	if (/^data:[^,]*,/iu.test(trimmed) || /^bearer\s+/iu.test(trimmed)) {
		return true;
	}
	if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(trimmed)) {
		return true;
	}
	if (
		trimmed.length >= 16 &&
		trimmed.length % 4 === 0 &&
		/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
			trimmed,
		) &&
		(/[+/=]/u.test(trimmed) || trimmed.length >= 128)
	) {
		return true;
	}
	try {
		const url = new URL(trimmed);
		return [...url.searchParams.keys()].some((key) =>
			/(?:signature|sig|token|credential|expires|x-amz|x-goog|access[_-]?key)/iu.test(
				key,
			),
		);
	} catch {
		return /(?:[?&](?:signature|sig|token|credential|expires|x-amz|x-goog|access[_-]?key)=)/iu.test(
			trimmed,
		);
	}
}

function deterministicZip(files: Record<string, Uint8Array>) {
	const ordered: Record<string, Uint8Array> = {};
	for (const path of Object.keys(files).sort((left, right) =>
		left.localeCompare(right),
	)) {
		const bytes = files[path];
		if (!bytes) throw new Error("Canvas export ZIP entry is unavailable.");
		ordered[path] = bytes;
	}
	return zipSync(ordered, { level: 6, mtime: ZIP_MTIME });
}

function jsonBytes(value: unknown) {
	return new TextEncoder().encode(`${stableJson(value)}\n`);
}

function stableJson(value: unknown): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number"
	) {
		return JSON.stringify(value);
	}
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, child]) => child !== undefined)
			.sort(([left], [right]) => left.localeCompare(right));
		return `{${entries
			.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
			.join(",")}}`;
	}
	throw new Error("Canvas export contains unsupported revision data.");
}

function sha256(value: Uint8Array) {
	return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function safeArchiveFileName(contentType: string, ordinal: number) {
	const extension = extensionFor(contentType);
	return `asset-${String(ordinal).padStart(3, "0")}.${extension}`;
}

function extensionFor(contentType: string) {
	if (contentType === "image/jpeg") return "jpg";
	if (contentType === "image/png") return "png";
	if (contentType === "image/webp") return "webp";
	if (contentType === "video/mp4") return "mp4";
	if (contentType === "audio/mpeg") return "mp3";
	if (contentType === "audio/wav") return "wav";
	return "bin";
}

function validExportLimit(value: number) {
	return Number.isSafeInteger(value) && value > 0;
}

function unavailableExport() {
	return new CanvasRevisionExportError(
		"EXPORT_NOT_AVAILABLE",
		"Canvas export is not available.",
	);
}
