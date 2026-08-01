import assert from "node:assert/strict";
import test from "node:test";

import type { ContentPackage } from "@meiye/contracts";

import { buildContentPackage } from "../operations/content-package.js";
import {
	ExecutionSourceContentPackageResolver,
	SourceContentPackageUnavailableError,
} from "./source-content-package-resolver.js";

test("runtime source resolver projects only the frozen reusable ContentPackage material", async () => {
	const source = sourcePackage();
	const resolver = new ExecutionSourceContentPackageResolver({
		async get() {
			return source;
		},
	}, authorizedAssetRights());

	const resolved = await resolver.resolve({
		workspaceId: "workspace-1",
		source: { id: "source-package-1", revision: "3" },
	});

	assert.deepEqual(resolved, {
		reference: { id: "source-package-1", revision: "3" },
		document: {
			body: "限时团购 398元，旧活动仅限本周。",
			conversionHook: "398元私信预约",
			id: "source-version-1",
			orderedAssetIds: ["selected-asset-1"],
			title: "旧活动 398元",
			topics: ["限时团购", "398元"],
		},
		structure: {
			slots: ["headline", "body", "conversion_hook"],
		},
		style: { kind: "image_text", sourcePlatform: "xiaohongshu" },
		assets: [
			{ id: "source-asset-1", role: "source" },
			{ id: "selected-asset-1", role: "selected" },
		],
	});
});

for (const [name, mutate] of [
	[
		"a revised source",
		(contentPackage: ContentPackage) => ({ ...contentPackage, revision: 4 }),
	],
	[
		"a revoked source",
		(contentPackage: ContentPackage) => ({
			...contentPackage,
			rights: {
				state: "revoked" as const,
				revokedAt: "2026-07-22T10:00:00.000Z",
			},
		}),
	],
	[
		"a non-usable source",
		(contentPackage: ContentPackage) => ({ ...contentPackage, status: "needs_replacement" as const }),
	],
	[
		"a cross-workspace source",
		(contentPackage: ContentPackage) => ({ ...contentPackage, workspaceId: "workspace-other" }),
	],
	[
		"a source without a current version",
		(contentPackage: ContentPackage) => ({ ...contentPackage, currentVersionId: undefined }),
	],
] as const) {
	test(`runtime source resolver rejects ${name}`, async () => {
		const resolver = new ExecutionSourceContentPackageResolver({
			async get() {
				return mutate(sourcePackage());
			},
		});
		await assert.rejects(
			resolver.resolve({
				workspaceId: "workspace-1",
				source: { id: "source-package-1", revision: "3" },
			}),
			SourceContentPackageUnavailableError,
		);
	});
}

test("runtime source resolver leaves submissions without a ContentPackage source unchanged", async () => {
	const resolver = new ExecutionSourceContentPackageResolver({
		async get() {
			throw new Error("A source-free submission must not read ContentPackages.");
		},
	});
	assert.equal(await resolver.resolve({ workspaceId: "workspace-1" }), undefined);
});

test("runtime source resolver rejects a selected asset whose live rights were withdrawn", async () => {
	const resolver = new ExecutionSourceContentPackageResolver(
		{
			async get() {
				return sourcePackage();
			},
		},
		{
			async resolve({ assetIds }) {
				return {
					knownAssetIds: assetIds,
					unauthorizedAssetIds: ["selected-asset-1"],
				};
			},
		},
	);

	await assert.rejects(
		resolver.resolve({
			workspaceId: "workspace-1",
			source: { id: "source-package-1", revision: "3" },
		}),
		SourceContentPackageUnavailableError,
	);
});

test("runtime source resolver accepts a package-owned selected asset without external rights lookup", async () => {
	const source = sourcePackage();
	source.generated.ownedAssets = [
		{
			contentType: "image/jpeg",
			id: "selected-asset-1",
			objectKey: "owned/source-package-1/selected-asset-1",
			sha256: "owned-selected-asset-sha256",
		},
	];
	const resolver = new ExecutionSourceContentPackageResolver(
		{
			async get() {
				return source;
			},
		},
		{
			async resolve() {
				throw new Error("Package-owned assets must not use external rights.");
			},
		},
	);

	const resolved = await resolver.resolve({
		workspaceId: "workspace-1",
		source: { id: "source-package-1", revision: "3" },
	});

	assert.deepEqual(resolved?.assets, [
		{ id: "source-asset-1", role: "source" },
		{ id: "selected-asset-1", role: "selected" },
	]);
});

test("runtime source resolver binds an explicit platform variant without canonical fallback", async () => {
	const source = sourcePackage();
	source.variants = [
		{
			currentVersionId: "variant-version-1",
			id: "source-package-1-douyin",
			platform: "douyin",
			versions: [
				{
					body: "抖音当前正文。",
					conversionHook: "私信预约",
					createdAt: "2026-07-22T09:30:00.000Z",
					id: "variant-version-1",
					orderedAssetIds: ["selected-asset-1"],
					title: "抖音标题",
					topics: ["抖音"],
				},
			],
		},
	];
	const resolver = new ExecutionSourceContentPackageResolver(
		{ async get() { return source; } },
		authorizedAssetRights(),
	);

	const resolved = await resolver.resolve({
		textSelection: {
			contentPackagePlatform: "douyin",
			platform: "douyin",
		},
		source: { id: "source-package-1", revision: "3" },
		workspaceId: "workspace-1",
	});
	assert.deepEqual(resolved?.document, {
		body: "抖音当前正文。",
		conversionHook: "私信预约",
		id: "variant-version-1",
		orderedAssetIds: ["selected-asset-1"],
		platform: "douyin",
		title: "抖音标题",
		topics: ["抖音"],
	});

	await assert.rejects(
		resolver.resolve({
			textSelection: {
				contentPackagePlatform: "xiaohongshu",
				platform: "xiaohongshu",
			},
			source: { id: "source-package-1", revision: "3" },
			workspaceId: "workspace-1",
		}),
		SourceContentPackageUnavailableError,
	);
});

function authorizedAssetRights() {
	return {
		async resolve({ assetIds }: { assetIds: string[] }) {
			return { knownAssetIds: assetIds, unauthorizedAssetIds: [] };
		},
	};
}

function sourcePackage(): ContentPackage {
	return {
		...buildContentPackage({
			id: "source-package-1",
			kind: "image_text",
			source: {
				assetIds: ["source-asset-1"],
				targetPlatform: "xiaohongshu",
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
		currentVersionId: "source-version-1",
		revision: 3,
		status: "accepted",
		versions: [
			{
				body: "限时团购 398元，旧活动仅限本周。",
				conversionHook: "398元私信预约",
				createdAt: "2026-07-22T09:00:00.000Z",
				id: "source-version-1",
				orderedAssetIds: ["selected-asset-1"],
				title: "旧活动 398元",
				topics: ["限时团购", "398元"],
			},
		],
	};
}
