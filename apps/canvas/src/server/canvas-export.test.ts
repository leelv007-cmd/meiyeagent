import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { P1ModelSupply, P1Operations } from "@meiye/core";
import type { AdvancedCanvasRevision } from "@meiye/core/pro-studio";
import {
	CanvasAssetFacade,
	MemoryCanvasAssetRepository,
	MemoryCanvasExportReceiptRepository,
} from "@meiye/core/pro-studio";
import { AudioAssetPipeline } from "@meiye/core/pro-studio-runtime";
import { unzipSync } from "fflate";
import {
	type CanvasRevisionExportAsset,
	type CanvasRevisionExportAssetDecision,
	type CanvasRevisionExportAssetPort,
	CanvasRevisionExportError,
	CanvasRevisionExportService,
} from "./canvas-export";

const revision: AdvancedCanvasRevision = {
	createdAt: "2026-07-23T00:00:00.000Z",
	createdBy: "user-1",
	draftVersion: 3,
	graph: {
		edges: [],
		nodes: [
			{ data: { assetId: "asset-a" }, id: "image-a", type: "image" },
			{ data: { assetId: "asset-b" }, id: "image-b", type: "image" },
		],
		schemaVersion: 1,
	},
	id: "revision-1",
	projectId: "project-1",
	reason: "checkpoint",
	workspaceId: "workspace-1",
};

const exportInput = {
	idempotencyKey: "canvas-export-1",
	includeAvailableOnly: false,
	revision,
	userId: "user-1",
	workspaceId: "workspace-1",
};

const canvasPng = Uint8Array.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
]);
const canvasMp3 = Uint8Array.from([
	0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90,
	0x64,
]);

test("reuses one completed receipt for same-key frozen retries and records its retrieval audit", async () => {
	const requests: Array<{
		assetId: string;
		userId: string;
		workspaceId: string;
	}> = [];
	const receipts = memoryReceipts();
	const service = exportService(
		{
			async resolve(input) {
				requests.push(input);
				return availableAsset(input.assetId);
			},
		},
		receipts,
	);

	const first = await service.export(exportInput);
	const second = await service.export(exportInput);

	assert.equal(first.receiptId, "canvas-export-receipt-1");
	assert.equal(second.receiptId, first.receiptId);
	assert.equal(first.manifest.exportReceiptId, first.receiptId);
	assert.equal(first.manifestSha256, second.manifestSha256);
	assert.equal(first.zipSha256, second.zipSha256);
	assert.deepEqual(
		first.manifest.assets.map((asset) => asset.id),
		["asset-a", "asset-b"],
	);
	assert.deepEqual(
		first.manifest.assets.map((asset) => asset.fileName),
		["asset-001.png", "asset-002.png"],
	);
	assert.deepEqual(Object.keys(unzipSync(first.zipBytes)).sort(), [
		"assets/asset-001.png",
		"assets/asset-002.png",
		"manifest.json",
		"revision.json",
	]);
	assert.deepEqual(
		first.retrievals.map((retrieval) => retrieval.id),
		first.manifest.assets.map((asset) => asset.retrievalReceiptId),
	);
	assert.notEqual(first.retrievals[0]?.id, "asset-a");
	assert.deepEqual(
		receipts.inspectAudit().map((event) => event.action),
		["canvas_export_receipt_started", "canvas_export_receipt_completed"],
	);
	assert.equal(
		JSON.stringify(receipts.inspectAudit()).includes(
			exportInput.idempotencyKey,
		),
		false,
	);
	assert.deepEqual(requests, [
		{ assetId: "asset-a", userId: "user-1", workspaceId: "workspace-1" },
		{ assetId: "asset-b", userId: "user-1", workspaceId: "workspace-1" },
		{ assetId: "asset-a", userId: "user-1", workspaceId: "workspace-1" },
		{ assetId: "asset-b", userId: "user-1", workspaceId: "workspace-1" },
	]);
});

test("recovers an interrupted same-key export with its original audit receipt", async () => {
	const receipts = memoryReceipts();
	let unavailable = true;
	const assets: CanvasRevisionExportAssetPort = {
		async resolve(input) {
			return unavailable && input.assetId === "asset-a"
				? { code: "ASSET_STORAGE_UNAVAILABLE", kind: "unavailable" }
				: availableAsset(input.assetId);
		},
	};

	await assert.rejects(
		exportService(assets, receipts).export(exportInput),
		isExportUnavailable,
	);
	unavailable = false;
	const recovered = await exportService(assets, receipts).export(exportInput);

	assert.equal(recovered.receiptId, "canvas-export-receipt-1");
	assert.deepEqual(
		receipts.inspectAudit().map((event) => event.action),
		[
			"canvas_export_receipt_started",
			"canvas_export_receipt_failed",
			"canvas_export_receipt_resumed",
			"canvas_export_receipt_completed",
		],
	);
	const completed = receipts.inspectAudit().at(-1);
	assert.ok(completed && "id" in completed.detail);
	assert.equal(completed.detail.id, recovered.receiptId);
	assert.equal(completed?.projectId, revision.projectId);
});

test("exports governed local imports and generated audio through Core into a real ZIP manifest", async () => {
	const rootDirectory = await mkdtemp(join(tmpdir(), "meiye-canvas-export-"));
	try {
		const assetStorage = new P1ModelSupply.FileSystemAssetStorage({
			rootDirectory,
		});
		const repository = new MemoryCanvasAssetRepository();
		const workspaceId = "workspace-1";
		const storage = {
			async delete(objectKey: string) {
				await assetStorage.deleteCanvasAsset({
					objectKey,
					workspaceId: objectKey.split("/")[0] ?? "",
				});
			},
			async put(objectKey: string, bytes: Uint8Array) {
				await assetStorage.putCanvasAsset({
					bytes,
					objectKey,
					workspaceId: objectKey.split("/")[0] ?? "",
				});
			},
			async putVerifiedCanvasAsset(objectKey: string, bytes: Uint8Array) {
				await assetStorage.putCanvasAsset({
					bytes,
					objectKey,
					workspaceId: objectKey.split("/")[0] ?? "",
				});
			},
			async read(objectKey: string) {
				try {
					return (await assetStorage.read(objectKey)).bytes;
				} catch {
					return null;
				}
			},
		};
		const imports = new CanvasAssetFacade({
			clock: () => new Date("2026-07-23T00:00:00.000Z"),
			nextId: () => "asset-local",
			repository,
			storage,
		});
		const localImport = await imports.persistLocalCanvasArtifact(
			{ userId: "user-1", workspaceId },
			{
				bytes: canvasPng,
				contentType: "image/png",
				derivation: "retouch",
				fileName: "imported.png",
			},
		);
		const pipeline = new AudioAssetPipeline({
			clock: () => new Date("2026-07-23T00:00:00.000Z"),
			inspector: {
				async inspect() {
					return {
						bitRate: 128_000,
						codec: "mp3",
						container: "mp3",
						durationSeconds: 2,
						metadata: {},
						sampleRate: 44_100,
					};
				},
			},
			nextAssetId: () => "asset-audio",
			nextObjectToken: () => "c".repeat(48),
			repository,
			storage,
		});
		const generation = await pipeline.persistGeneratedAudio({
			bytes: canvasMp3,
			contentType: "audio/mpeg",
			fileName: "generated.mp3",
			jobId: "job-audio",
			ownerId: "user-1",
			workspaceId,
		});
		let storageReads = 0;
		const access = new P1Operations.OperationsCanvasExportAssetAccessService({
			canvasAssets: repository,
			contentPackageAssets: {
				async readOwnedAsset() {
					throw new Error(
						"No ContentPackage asset is referenced by this export.",
					);
				},
			},
			contentPackageRights: {
				async resolve() {
					return { knownAssetIds: [], unauthorizedAssetIds: [] };
				},
			},
			generationJobs: {
				async getGenerationJob() {
					return { result: { inputAssets: [] } };
				},
			},
			ownedAssetStorage: {
				async read(objectKey) {
					storageReads += 1;
					return assetStorage.read(objectKey);
				},
				async verifyCanvasAssetReceipt(input) {
					return assetStorage.verifyCanvasAssetReceipt(input);
				},
			},
			productAssets: {
				async resolve() {
					return [];
				},
			},
			productPolicy: {
				async resolveExportPolicy() {
					return { kind: "unknown" as const };
				},
			},
		});
		const service = exportService({
			async resolve(input) {
				const decision = await access.resolve({
					assetId: input.assetId,
					contentPackages: [],
					workspaceId: input.workspaceId,
				});
				if (decision.kind === "unavailable") return decision;
				return {
					asset: {
						...decision.asset,
						bytes: Uint8Array.from(
							Buffer.from(decision.asset.bytesBase64, "base64"),
						),
					},
					kind: "available" as const,
				};
			},
		});
		const artifact = await service.export({
			...exportInput,
			revision: revisionFor(
				[localImport.id, generation.id],
				"revision-governed",
			),
		});

		assert.deepEqual(
			artifact.manifest.assets.map((asset) => asset.id),
			["asset-audio", "asset-local"],
		);
		assert.deepEqual(Object.keys(unzipSync(artifact.zipBytes)).sort(), [
			"assets/asset-001.mp3",
			"assets/asset-002.png",
			"manifest.json",
			"revision.json",
		]);
		assert.equal(storageReads, 2);
	} finally {
		await rm(rootDirectory, { force: true, recursive: true });
	}
});

test("fails closed with the stable generic code for current policy and receipt failures", async () => {
	for (const code of [
		"ASSET_EXPIRED",
		"ASSET_PRIVATE_RETRIEVAL_DENIED",
		"ASSET_REVOKED",
		"ASSET_STORAGE_UNAVAILABLE",
	] as const) {
		await assert.rejects(
			exportService({
				async resolve(input) {
					return input.assetId === "asset-a"
						? { code, kind: "unavailable" as const }
						: availableAsset(input.assetId);
				},
			}).export(exportInput),
			isExportUnavailable,
		);
	}

	for (const corrupt of ["foreign", "receipt"] as const) {
		await assert.rejects(
			exportService({
				async resolve(input) {
					if (input.assetId !== "asset-a") return availableAsset(input.assetId);
					return corrupt === "foreign"
						? availableAsset(input.assetId, { workspaceId: "workspace-2" })
						: availableAsset(input.assetId, { receipt: { id: "" } });
				},
			}).export(exportInput),
			isExportUnavailable,
		);
	}
});

test("includeAvailableOnly keeps explicit policy warnings but all-unavailable remains closed", async () => {
	const partial = await exportService({
		async resolve(input) {
			return input.assetId === "asset-a"
				? { code: "ASSET_REVOKED", kind: "unavailable" as const }
				: availableAsset(input.assetId);
		},
	}).export({ ...exportInput, includeAvailableOnly: true });
	assert.deepEqual(
		partial.manifest.assets.map((asset) => asset.id),
		["asset-b"],
	);
	assert.deepEqual(partial.manifest.warnings, [
		{ assetId: "asset-a", code: "ASSET_REVOKED" },
	]);

	await assert.rejects(
		exportService({
			async resolve() {
				return { code: "ASSET_ACCESS_DENIED", kind: "unavailable" as const };
			},
		}).export({ ...exportInput, includeAvailableOnly: true }),
		isExportUnavailable,
	);
});

test("deduplicates repeated assets and separates colliding malicious source filenames", async () => {
	const calls: string[] = [];
	const sourceUrl =
		"https://cdn.example.invalid/file.png?X-Amz-Signature=secret";
	const sourceData = "data:image/png;base64,AAAABBBBCCCCDDDDEEEE";
	const artifact = await exportService({
		async resolve(input) {
			calls.push(input.assetId);
			return availableAsset(input.assetId, {
				fileName: input.assetId === "asset-a" ? sourceUrl : sourceData,
			});
		},
	}).export({
		...exportInput,
		revision: revisionFor(["asset-b", "asset-a", "asset-a"]),
	});

	assert.deepEqual(calls, ["asset-a", "asset-b"]);
	assert.deepEqual(
		artifact.manifest.assets.map(({ fileName, path }) => ({ fileName, path })),
		[
			{ fileName: "asset-001.png", path: "assets/asset-001.png" },
			{ fileName: "asset-002.png", path: "assets/asset-002.png" },
		],
	);
	assert.equal(artifact.manifest.assets[0]?.id, "asset-a");
	assert.equal(
		JSON.stringify(artifact.manifest.assets).includes(sourceUrl),
		false,
	);
	assert.equal(
		JSON.stringify(artifact.manifest.assets).includes(sourceData),
		false,
	);
});

test("redacts nested graph secrets and malicious filenames before writing revision and manifest", async () => {
	const signedUrl =
		"https://objects.example.invalid/a?X-Amz-Signature=top-secret";
	const objectKey = "workspace-1/private/object-key";
	const base64 = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB";
	const persistedId = "persisted-asset-7";
	const artifact = await exportService({
		async resolve() {
			return availableAsset(persistedId, {
				fileName: `${signedUrl}&token=credential&asset=${persistedId}`,
			});
		},
	}).export({
		...exportInput,
		revision: {
			...revisionFor([persistedId]),
			graph: {
				edges: [],
				nodes: [
					{
						data: {
							assetId: persistedId,
							base64,
							dataUrl: "data:image/png;base64,secret",
							generationProviderSnapshot: {
								jobId: "job-internal-7",
								modelId: "model-internal-7",
								inputNodeBindings: [{ nodeId: "node-internal-7" }],
							},
							nested: {
								objectKey,
								providerSecret: "provider-secret",
								visible: "keep-this-value",
								values: [{ remoteUrl: signedUrl, safe: "still-visible" }],
							},
							unlabeledUrl: signedUrl,
						},
						id: "image-secret",
						type: "image",
					},
				],
				schemaVersion: 1,
			},
		},
	});

	const files = unzipSync(artifact.zipBytes);
	const revisionFile = files["revision.json"];
	const manifestFile = files["manifest.json"];
	assert.ok(revisionFile);
	assert.ok(manifestFile);
	const revisionJson = text(revisionFile);
	const manifestJson = text(manifestFile);
	for (const forbidden of [
		signedUrl,
		objectKey,
		base64,
		"provider-secret",
		"data:image/png;base64,secret",
		"job-internal-7",
		"model-internal-7",
		"node-internal-7",
	]) {
		assert.equal(revisionJson.includes(forbidden), false);
		assert.equal(manifestJson.includes(forbidden), false);
	}
	assert.match(revisionJson, /keep-this-value/);
	assert.match(revisionJson, /still-visible/);
	assert.deepEqual(
		artifact.manifest.assets.map((asset) => asset.fileName),
		["asset-001.png"],
	);
	assert.equal(artifact.manifest.assets[0]?.id, persistedId);
	assert.equal(artifact.manifest.assets[0]?.path.includes(persistedId), false);
});

test("enforces a fail-closed total export cap while available-only may skip oversized assets", async () => {
	const oversized = new Uint8Array(12_000);
	const service = (includeAvailableOnly: boolean) =>
		exportService(
			{
				async resolve(input) {
					return input.assetId === "asset-a"
						? availableAsset(input.assetId, { bytes: oversized })
						: availableAsset(input.assetId);
				},
			},
			memoryReceipts(),
			{ maxUncompressedBytes: 10_000 },
		).export({ ...exportInput, includeAvailableOnly });

	await assert.rejects(service(false), isExportUnavailable);
	const partial = await service(true);
	assert.deepEqual(
		partial.manifest.assets.map((asset) => asset.id),
		["asset-b"],
	);
	assert.deepEqual(partial.manifest.warnings, [
		{ assetId: "asset-a", code: "EXPORT_SIZE_LIMIT_EXCEEDED" },
	]);
});

function exportService(
	assets: CanvasRevisionExportAssetPort,
	receipts = memoryReceipts(),
	options?: { maxUncompressedBytes?: number },
) {
	return new CanvasRevisionExportService(assets, receipts, options);
}

function memoryReceipts() {
	let id = 0;
	return new MemoryCanvasExportReceiptRepository({
		clock: () => new Date("2026-07-23T00:00:00.000Z"),
		nextId: () => `canvas-export-receipt-${++id}`,
	});
}

function revisionFor(
	assetIds: string[],
	id = revision.id,
): AdvancedCanvasRevision {
	return {
		...revision,
		graph: {
			edges: [],
			nodes: assetIds.map((assetId, index) => ({
				data: { assetId },
				id: `node-${index + 1}`,
				type: "image",
			})),
			schemaVersion: 1,
		},
		id,
	};
}

function availableAsset(
	assetId: string,
	overrides: Partial<CanvasRevisionExportAsset> = {},
): Extract<CanvasRevisionExportAssetDecision, { kind: "available" }> {
	const bytes = overrides.bytes ?? new TextEncoder().encode(`bytes:${assetId}`);
	return {
		asset: {
			bytes,
			contentType: "image/png",
			fileName: assetId,
			id: assetId,
			receipt: { id: `receipt-${assetId}`, storageRevision: "storage-v1" },
			sha256: sha256(bytes),
			sizeBytes: bytes.byteLength,
			workspaceId: "workspace-1",
			...overrides,
		},
		kind: "available",
	};
}

function isExportUnavailable(error: unknown) {
	return (
		error instanceof CanvasRevisionExportError &&
		error.code === "EXPORT_NOT_AVAILABLE"
	);
}

function sha256(value: Uint8Array) {
	return createHash("sha256").update(value).digest("hex");
}

function text(value: Uint8Array) {
	return new TextDecoder().decode(value);
}
