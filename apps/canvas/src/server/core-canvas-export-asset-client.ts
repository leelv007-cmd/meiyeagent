import { createHash } from "node:crypto";
import type {
	CanvasExportUnavailableCode,
	CanvasRevisionExportAssetDecision,
	CanvasRevisionExportAssetPort,
} from "./canvas-export";
import {
	CoreRemoteCall,
	CoreRemoteCallConfigurationError,
} from "./core-remote-call";

type ExportAssetUnavailableCode = Exclude<
	CanvasExportUnavailableCode,
	"EXPORT_NOT_AVAILABLE"
>;

interface CoreCanvasExportAssetClientOptions {
	coreServiceToken: string;
	coreServiceUrl: string;
	fetcher?: typeof fetch;
}

/**
 * Reads bytes only through Core's current ContentPackage/Product/OwnedAsset
 * decision point. An invalid or unreachable Core response is deliberately an
 * unavailable asset, never a browser-visible alternate retrieval path.
 */
export class CoreCanvasExportAssetClient
	implements CanvasRevisionExportAssetPort
{
	private readonly remoteCall: CoreRemoteCall;

	constructor(options: CoreCanvasExportAssetClientOptions) {
		try {
			this.remoteCall = new CoreRemoteCall(options);
		} catch (error) {
			if (error instanceof CoreRemoteCallConfigurationError) {
				throw new Error("Canvas export requires configured Core asset access.");
			}
			throw error;
		}
	}

	async resolve(input: {
		assetId: string;
		userId: string;
		workspaceId: string;
	}): Promise<CanvasRevisionExportAssetDecision> {
		const result = await this.remoteCall.request({
			body: {
				action: "canvas_export_asset",
				module: "operations",
				payload: { assetId: input.assetId },
			},
			identity: {
				correlationId: `canvas-export-${createHash("sha256")
					.update(input.assetId)
					.digest("hex")
					.slice(0, 24)}`,
				userId: input.userId,
				workspaceId: input.workspaceId,
			},
			kind: "query",
		});
		if (result.kind === "success") return exportAssetDecision(result.data);
		if (result.kind === "rejected")
			return unavailable(remoteUnavailableCode(result.envelope));
		return unavailable("ASSET_STORAGE_UNAVAILABLE");
	}
}

function exportAssetDecision(
	value: unknown,
): CanvasRevisionExportAssetDecision {
	if (!record(value) || typeof value.kind !== "string") {
		return unavailable("ASSET_RECEIPT_INVALID");
	}
	if (value.kind === "unavailable" && isUnavailableCode(value.code)) {
		return unavailable(value.code);
	}
	if (value.kind !== "available" || !record(value.asset)) {
		return unavailable("ASSET_RECEIPT_INVALID");
	}
	const asset = value.asset;
	const sizeBytes = asset.sizeBytes;
	if (
		!text(asset.bytesBase64) ||
		!text(asset.contentType) ||
		!text(asset.fileName) ||
		!text(asset.id) ||
		!record(asset.receipt) ||
		!text(asset.receipt.id) ||
		!text(asset.sha256) ||
		typeof sizeBytes !== "number" ||
		!Number.isSafeInteger(sizeBytes) ||
		sizeBytes < 0 ||
		!text(asset.workspaceId)
	) {
		return unavailable("ASSET_RECEIPT_INVALID");
	}
	const bytes = strictBase64(asset.bytesBase64);
	if (
		!bytes ||
		bytes.byteLength !== sizeBytes ||
		createHash("sha256").update(bytes).digest("hex") !== asset.sha256
	) {
		return unavailable("ASSET_RECEIPT_INVALID");
	}
	const storageRevision = text(asset.receipt.storageRevision)
		? asset.receipt.storageRevision
		: undefined;
	return {
		asset: {
			bytes,
			contentType: asset.contentType,
			fileName: asset.fileName,
			id: asset.id,
			receipt: {
				id: asset.receipt.id,
				...(storageRevision ? { storageRevision } : {}),
			},
			sha256: asset.sha256,
			sizeBytes,
			workspaceId: asset.workspaceId,
		},
		kind: "available",
	};
}

function strictBase64(value: string) {
	if (
		value.length % 4 !== 0 ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
			value,
		)
	) {
		return null;
	}
	const bytes = Uint8Array.from(Buffer.from(value, "base64"));
	return Buffer.from(bytes).toString("base64") === value ? bytes : null;
}

function remoteUnavailableCode(value: unknown): ExportAssetUnavailableCode {
	const code =
		record(value) && record(value.error) ? value.error.code : undefined;
	if (code === "RIGHTS_REVOKED") return "ASSET_REVOKED";
	if (code === "WORKSPACE_FORBIDDEN" || code === "NOT_FOUND") {
		return "ASSET_ACCESS_DENIED";
	}
	return "ASSET_STORAGE_UNAVAILABLE";
}

function unavailable(
	code: ExportAssetUnavailableCode,
): CanvasRevisionExportAssetDecision {
	return { code, kind: "unavailable" };
}

function isUnavailableCode(
	value: unknown,
): value is ExportAssetUnavailableCode {
	return (
		value === "ASSET_ACCESS_DENIED" ||
		value === "ASSET_EXPIRED" ||
		value === "ASSET_PRIVATE_RETRIEVAL_DENIED" ||
		value === "ASSET_RECEIPT_INVALID" ||
		value === "ASSET_REVOKED" ||
		value === "ASSET_STORAGE_UNAVAILABLE"
	);
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
