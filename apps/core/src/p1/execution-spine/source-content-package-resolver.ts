import {
	type ContentPackage,
	type ContentPackageKind,
	type ContentPackagePlatform,
	type ComposerContentPackagePlatform,
} from "@meiye/contracts";

import type { ContentPackageRightsResolverPort } from "../operations/types.js";

/**
 * Reads the complete source package at execution time. Admission only proves
 * that the browser selected a valid package; every provider-facing stage must
 * resolve this exact reference again before it can use or deliver the work.
 */
export interface SourceContentPackageReader {
	get(input: {
		packageId: string;
		workspaceId: string;
	}): Promise<ContentPackage | null>;
}

export interface SourceContentPackageReference {
	id: string;
	revision: string;
}

export interface ResolvedSourceContentPackage {
	reference: SourceContentPackageReference;
	/** Internal write-back source; never copied into provider context. */
	document?: {
		body: string;
		conversionHook?: string;
		id: string;
		orderedAssetIds: string[];
		platform?: ContentPackagePlatform;
		title: string;
		topics: string[];
	};
	structure: {
		slots: Array<"headline" | "body" | "conversion_hook">;
	};
	style: {
		kind: ContentPackageKind;
		sourcePlatform: ContentPackagePlatform | null;
	};
	assets: Array<{
		id: string;
		role: "source" | "selected";
	}>;
}

export interface ExecutionSourceContentPackageResolverPort {
	resolve(input: {
		textSelection?: {
			contentPackagePlatform: ComposerContentPackagePlatform;
			platform?: ContentPackagePlatform;
		};
		workspaceId: string;
		source?: SourceContentPackageReference;
	}): Promise<ResolvedSourceContentPackage | undefined>;
}

export class SourceContentPackageUnavailableError extends Error {
	readonly code = "SOURCE_CONTENT_PACKAGE_UNAVAILABLE";
	readonly status = 409;

	constructor(readonly reference: SourceContentPackageReference) {
		super(
			"The source ContentPackage is missing, unavailable, or no longer at the frozen revision.",
		);
		this.name = "SourceContentPackageUnavailableError";
	}
}

/**
 * The only runtime projection of a source ContentPackage. It deliberately
 * exports content structure, source style and asset roles plus one internal
 * current-version document used only by exact-range delivery. Provider context
 * projection deliberately omits that document.
 */
export class ExecutionSourceContentPackageResolver
	implements ExecutionSourceContentPackageResolverPort
{
	constructor(
		private readonly reader: SourceContentPackageReader,
		private readonly assetRights?: ContentPackageRightsResolverPort,
	) {}

	async resolve(input: {
		textSelection?: {
			contentPackagePlatform: ComposerContentPackagePlatform;
			platform?: ContentPackagePlatform;
		};
		workspaceId: string;
		source?: SourceContentPackageReference;
	}) {
		const source = input.source;
		if (!source) return undefined;
		const contentPackage = await this.reader.get({
			packageId: source.id,
			workspaceId: input.workspaceId,
		});
		if (!isAvailableSource(contentPackage, { ...input, source })) {
			throw new SourceContentPackageUnavailableError(source);
		}
		const platform = input.textSelection
			? resolveAuthoritativeContentPackageVersionPlatform(
					contentPackage,
					input.textSelection.contentPackagePlatform,
				)
			: undefined;
		if (input.textSelection && input.textSelection.platform !== platform) {
			throw new SourceContentPackageUnavailableError(source);
		}
		const variant = platform
			? contentPackage.variants.find(
					(candidate) => candidate.platform === platform,
				)
			: undefined;
		const currentVersion = platform
			? variant?.versions.find(
					(version) => version.id === variant.currentVersionId,
				)
			: contentPackage.versions.find(
					(version) => version.id === contentPackage.currentVersionId,
				);
		if (!currentVersion) {
			throw new SourceContentPackageUnavailableError(source);
		}
		const slots: ResolvedSourceContentPackage["structure"]["slots"] = [
			"headline",
			"body",
		];
		if (currentVersion.conversionHook) slots.push("conversion_hook");
		const assets = sourceAssets(contentPackage, currentVersion);
		await this.assertSelectedAssetsAvailable(
			input.workspaceId,
			assets,
			new Set(
				(contentPackage.generated.ownedAssets ?? []).map((asset) => asset.id),
			),
			source,
		);
		return {
			reference: { ...source },
			document: {
				body: currentVersion.body,
				...(currentVersion.conversionHook
					? { conversionHook: currentVersion.conversionHook }
					: {}),
				id: currentVersion.id,
				orderedAssetIds: [...currentVersion.orderedAssetIds],
				...(platform ? { platform } : {}),
				title: currentVersion.title,
				topics: [...currentVersion.topics],
			},
			structure: {
				slots,
			},
			style: {
				kind: contentPackage.kind,
				sourcePlatform:
					platform ?? contentPackage.source.targetPlatform ?? null,
			},
			assets,
		};
	}

	private async assertSelectedAssetsAvailable(
		workspaceId: string,
		assets: ResolvedSourceContentPackage["assets"],
		ownedAssetIds: ReadonlySet<string>,
		source: SourceContentPackageReference,
	) {
		const selectedAssetIds = assets
			.filter(
				(asset) =>
					asset.role === "selected" && !ownedAssetIds.has(asset.id),
			)
			.map((asset) => asset.id);
		if (selectedAssetIds.length === 0) return;
		if (!this.assetRights) {
			throw new SourceContentPackageUnavailableError(source);
		}
		const rights = await this.assetRights.resolve({
			assetIds: selectedAssetIds,
			workspaceId,
		});
		const knownAssetIds = rights.knownAssetIds
			? new Set(rights.knownAssetIds)
			: undefined;
		if (
			rights.unauthorizedAssetIds.length > 0 ||
			(knownAssetIds &&
				selectedAssetIds.some((assetId) => !knownAssetIds.has(assetId)))
		) {
			throw new SourceContentPackageUnavailableError(source);
		}
	}
}

export function resolveAuthoritativeContentPackageVersionPlatform(
	contentPackage: ContentPackage,
	contentPackagePlatform: ComposerContentPackagePlatform,
): ContentPackagePlatform | undefined {
	if (
		contentPackagePlatform !== "xiaohongshu" &&
		contentPackagePlatform !== "douyin" &&
		contentPackagePlatform !== "video_account"
	) {
		return undefined;
	}
	const variant = contentPackage.variants.find(
		(candidate) => candidate.platform === contentPackagePlatform,
	);
	return variant?.versions.some(
		(version) => version.id === variant.currentVersionId,
	)
		? contentPackagePlatform
		: undefined;
}

function isAvailableSource(
	contentPackage: ContentPackage | null,
	input: {
		workspaceId: string;
		source: SourceContentPackageReference;
	},
): contentPackage is ContentPackage {
	return Boolean(
		contentPackage &&
			contentPackage.workspaceId === input.workspaceId &&
			contentPackage.id === input.source.id &&
			String(contentPackage.revision) === input.source.revision &&
			contentPackage.rights.state === "authorized" &&
			(contentPackage.status === "accepted" ||
				contentPackage.status === "review_ready"),
	);
}

function sourceAssets(
	contentPackage: ContentPackage,
	currentVersion: ContentPackage['versions'][number],
) {
	const roles = new Map<string, "source" | "selected">();
	for (const assetId of contentPackage.source.assetIds) {
		roles.set(assetId, "source");
	}
	for (const assetId of currentVersion.orderedAssetIds) {
		roles.set(assetId, "selected");
	}
	return [...roles].map(([id, role]) => ({ id, role }));
}
