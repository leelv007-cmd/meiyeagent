import { briefSourceRevisionId } from "../creation-experience/postgres-brief-revision-context.js";
import type { BriefConfirmationRepository } from "../creation-experience/brief-confirmation-repository.js";
import type { CreationExperienceCatalogRepository } from "../creation-experience/memory-repository.js";
import { P1DomainError, type RouteSnapshot } from "../foundation/domain.js";
import type { FoundationRepository } from "../foundation/ports.js";
import type { ReferenceAssetResolverPort } from "../model-supply/reference-asset-resolver.js";
import type { ContentPackageRightsResolverPort } from "../operations/types.js";
import type { MarketingIdentityRepository } from "../operations/marketing-identity.js";
import type { ProductBillingApplicationPort } from "../product-billing/durable-service.js";
import { fingerprintValue } from "../job-runtime/job-contracts.js";
import {
	decideChannelAdmission,
	type CapabilityHotAssemblyPort,
} from "../supply-registry/hot-assembly.js";

import type { ComposerSubmissionRequest } from "./creation-execution-snapshot.js";
import type { CreationSubmissionAdmissionPort } from "./submission-coordinator.js";

export interface ComposerSourceContentPackageReader {
	get(input: {
		packageId: string;
		workspaceId: string;
	}): Promise<{
		id: string;
		revision: string | number;
		status: "accepted" | "review_ready";
		workspaceId: string;
	} | null>;
}

/** Read-only capability check. It must not acquire capacity or reserve usage. */
export interface ComposerCapabilityReadinessPort {
	assertReady(input: {
		catalogModel: { id: string; revision: string };
		route: RouteSnapshot;
	}): Promise<void>;
}

export interface ComposerSubmissionAdmissionDependencies {
	assets: Pick<ReferenceAssetResolverPort, "resolve">;
	briefConfirmations: Pick<BriefConfirmationRepository, "getBriefConfirmation">;
	capabilities: ComposerCapabilityReadinessPort;
	catalog: Pick<
		CreationExperienceCatalogRepository,
		"getRecipeByRevisionId" | "getSurfaceByRevisionId"
	>;
	identities: Pick<MarketingIdentityRepository, "listActive">;
	quotes: Pick<ProductBillingApplicationPort, "getQuote">;
	rights: ContentPackageRightsResolverPort;
	routes: Pick<FoundationRepository, "getRouteSnapshot">;
	sourcePackages: ComposerSourceContentPackageReader;
	now?: () => string;
}

/**
 * Reads the live capability assembly and channel lifecycle without acquiring
 * capacity. Reservation remains exclusively inside the durable billing write.
 */
export class CapabilityHotAssemblyComposerReadiness
	implements ComposerCapabilityReadinessPort
{
	constructor(
		private readonly hotAssembly: Pick<
			CapabilityHotAssemblyPort,
			"assembleForRequest"
		>,
	) {}

	async assertReady(input: {
		catalogModel: { id: string; revision: string };
		route: RouteSnapshot;
	}) {
		const candidates = input.route.allowedCandidates.filter(
			(candidate) => candidate.catalogModelId === input.catalogModel.id,
		);
		if (candidates.length === 0) {
			throw invalid("Route snapshot has no candidate for the selected catalog model.");
		}
		const checked = await Promise.all(
			candidates.map(async (candidate) => {
				try {
					const binding = await this.hotAssembly.assembleForRequest({
						deploymentId: candidate.deploymentId,
						requiredScope:
							candidate.credentialMode === "byok_strict"
								? "workspace_byok"
								: "platform",
					});
					return decideChannelAdmission(binding.channelLifecycle, "new_submit");
				} catch {
					return null;
				}
			}),
		);
		if (!checked.some((decision) => decision?.admitted)) {
			throw invalid("No route candidate currently has an accepting capability channel.");
		}
	}
}

/**
 * Composer's fail-closed admission gate. Browser selections are references;
 * this boundary re-resolves all mutable facts in the requesting workspace and
 * returns the Task already bound by an explicit quote confirmation.
 */
export class ComposerSubmissionAdmissionGate
	implements CreationSubmissionAdmissionPort
{
	private readonly now: () => string;

	constructor(private readonly dependencies: ComposerSubmissionAdmissionDependencies) {
		this.now = dependencies.now ?? (() => new Date().toISOString());
	}

	async admit(input: ComposerSubmissionRequest) {
		const recipe = await this.dependencies.catalog.getRecipeByRevisionId(
			input.recipe.revision,
		);
		if (
			!recipe ||
			recipe.recipeId !== input.recipe.id ||
			recipe.revisionId !== input.recipe.revision ||
			recipe.status !== "published"
		) {
			throw invalid("Recipe revision is missing, unpublished, or does not match this submission.");
		}
		if (recipe.lensId !== "copy" || recipe.targetWorkspaceKind !== "copy") {
			throw invalid("Recipe is not published for the Copy Composer.");
		}
		if (recipe.modelPolicy.mode !== input.modelPolicy.mode) {
			throw invalid("Recipe model policy mode no longer matches the submission.");
		}
		if (
			input.modelPolicy.mode === "fixed" &&
			recipe.modelPolicy.catalogModelId !== input.catalogModel.id
		) {
			throw invalid("Recipe fixed model policy no longer matches the selected catalog model.");
		}

		const surface = await this.dependencies.catalog.getSurfaceByRevisionId(
			input.surface.revision,
		);
		if (
			!surface ||
			surface.surfaceId !== input.surface.id ||
			surface.revisionId !== input.surface.revision ||
			surface.status !== "published"
		) {
			throw invalid("Surface revision is missing, unpublished, or does not match this submission.");
		}
		if (
			!surface.recipeRefs.some(
				(reference) =>
					reference.visible &&
					reference.lensId === "copy" &&
					reference.recipeRevisionId === recipe.revisionId,
			)
		) {
			throw invalid("Surface does not expose the selected published Copy recipe.");
		}

		const route = await this.dependencies.routes.getRouteSnapshot(
			input.workspaceId,
			input.route.id,
		);
		if (
			!route ||
			route.workspaceId !== input.workspaceId ||
			route.id !== input.route.id ||
			route.catalogRevision !== input.route.revision ||
			route.catalogRevision !== input.catalogModel.revision ||
			route.requestedCatalogModelId !== input.catalogModel.id ||
			!selectionModeMatches(input.modelPolicy.mode, route.selectionMode) ||
			!route.allowedCandidates.some(
				(candidate) => candidate.catalogModelId === input.catalogModel.id,
			)
		) {
			throw invalid("Route snapshot is stale, cross-workspace, or incompatible with the selected model.");
		}

		const quote = await this.dependencies.quotes.getQuote(
			input.quote.id,
			input.workspaceId,
		);
		if (
			!quote ||
			quote.quoteId !== input.quote.id ||
			quote.revision !== input.quote.revision ||
			quote.catalogModelId !== input.catalogModel.id ||
			quote.catalogModelRevision !== input.catalogModel.revision ||
			quote.routeSnapshotRef !== route.id ||
			(quote.lifecycleStatus !== "confirmed" && quote.lifecycleStatus !== "reserved") ||
			!quote.taskId?.trim()
		) {
			throw invalid("A current, explicitly confirmed ProductQuote bound to a Task is required.");
		}

		const activeIdentities = await this.dependencies.identities.listActive(
			input.workspaceId,
			this.now(),
		);
		if (
			!activeIdentities.some(
				(identity) =>
					identity.identityId === input.identity.id &&
					String(identity.version) === input.identity.revision,
			)
		) {
			throw invalid("Marketing identity is missing, inactive, or at a different revision.");
		}

		const assetIds = input.sources.assets.map((asset) => asset.id);
		if (new Set(assetIds).size !== assetIds.length) {
			throw invalid("Source assets must not be duplicated.");
		}
		const resolvedAssets = await this.dependencies.assets.resolve(
			input.workspaceId,
			assetIds,
		);
		if (resolvedAssets.length !== assetIds.length) {
			throw invalid("Source asset resolution returned an incomplete result.");
		}
		const byAssetId = new Map(resolvedAssets.map((asset) => [asset.assetId, asset]));
		for (const source of input.sources.assets) {
			const resolved = byAssetId.get(source.id);
			if (
				!resolved ||
				resolved.kind !== "resolved" ||
				resolved.sha256 !== source.revision
			) {
				throw invalid("A source asset is missing, unreadable, unauthorized, or at a different revision.");
			}
		}

		const rights = await this.dependencies.rights.resolve({
			assetIds,
			workspaceId: input.workspaceId,
		});
		const knownAssetIds = new Set(rights.knownAssetIds ?? []);
		if (
			rights.unauthorizedAssetIds.length > 0 ||
			assetIds.some((assetId) => !knownAssetIds.has(assetId))
		) {
			throw invalid("Every source asset must be known and authorized in this workspace.");
		}

		let sourcePackage: Awaited<
			ReturnType<ComposerSourceContentPackageReader["get"]>
		> = null;
		if (input.sources.contentPackage) {
			sourcePackage = await this.dependencies.sourcePackages.get({
				packageId: input.sources.contentPackage.id,
				workspaceId: input.workspaceId,
			});
			if (
				!sourcePackage ||
				sourcePackage.workspaceId !== input.workspaceId ||
				sourcePackage.id !== input.sources.contentPackage.id ||
				(sourcePackage.status !== "accepted" &&
					sourcePackage.status !== "review_ready") ||
				String(sourcePackage.revision) !== input.sources.contentPackage.revision
			) {
				throw invalid("Source ContentPackage is missing, cross-workspace, or at a different revision.");
			}
		}

		assertSourceRequirements({
			assetContentTypes: resolvedAssets
				.filter((asset): asset is Extract<(typeof resolvedAssets)[number], { kind: "resolved" }> =>
					asset.kind === "resolved",
				)
				.map((asset) => asset.contentType),
			hasContentPackage: Boolean(sourcePackage),
			requirements: recipe.sourceRequirements,
		});

		const confirmation = await this.dependencies.briefConfirmations.getBriefConfirmation(
			input.workspaceId,
			input.briefConfirmation.id,
		);
		const sourceIds = [
			...assetIds,
			...(input.sources.contentPackage ? [input.sources.contentPackage.id] : []),
		];
		if (
			!confirmation ||
			confirmation.boundRevisions.draftRevisionId !== input.briefConfirmation.revision ||
			confirmation.boundRevisions.recipeRevisionId !== recipe.revisionId ||
			confirmation.boundRevisions.surfaceRevisionId !== surface.revisionId ||
			confirmation.boundRevisions.modelRevisionId !== input.catalogModel.revision ||
			confirmation.boundRevisions.quoteRevisionId !== quote.revision ||
			confirmation.boundRevisions.sourceRevisionId !== briefSourceRevisionId(sourceIds) ||
			confirmation.boundRevisions.lensId !== "copy"
		) {
			throw invalid("Durable Brief confirmation is missing or does not bind these exact submission facts.");
		}

		await this.dependencies.capabilities.assertReady({
			catalogModel: input.catalogModel,
			route,
		});
		return {
			modelPolicy: {
				id: `recipe-model-policy:${recipe.recipeId}`,
				mode: recipe.modelPolicy.mode,
				revision: recipe.revisionId,
			},
			rights: {
				revision: `rights:${fingerprintValue(
					[
						...input.sources.assets.map((source) => ({
							id: source.id,
							revision: source.revision,
							type: "asset",
						})),
						...(input.sources.contentPackage
							? [
								{
									id: input.sources.contentPackage.id,
									revision: input.sources.contentPackage.revision,
									type: "content_package",
								},
							]
							: []),
					].sort((left, right) => left.id.localeCompare(right.id)),
				)}`,
				summary: `Server verified ${assetIds.length} source asset${assetIds.length === 1 ? "" : "s"} in workspace ${input.workspaceId}.`,
			},
			taskId: quote.taskId,
		};
	}
}

function selectionModeMatches(
	modelPolicyMode: "auto" | "fixed",
	routeSelectionMode: RouteSnapshot["selectionMode"],
) {
	return (
		(modelPolicyMode === "fixed" && routeSelectionMode === "fixed") ||
		(modelPolicyMode === "auto" && routeSelectionMode === "llm_auto")
	);
}

function assertSourceRequirements(input: {
	assetContentTypes: string[];
	hasContentPackage: boolean;
	requirements: Array<{ kinds?: string[]; required: boolean; slot: string }>;
}) {
	for (const requirement of input.requirements) {
		if (!requirement.required) continue;
		const kinds = requirement.kinds?.map((kind) => kind.trim().toLowerCase()).filter(Boolean) ?? [];
		const hasMatchingAsset = input.assetContentTypes.some((contentType) =>
			kinds.length === 0 ? true : kinds.some((kind) => contentTypeMatches(kind, contentType)),
		);
		const contentPackageMatches =
			input.hasContentPackage &&
			(kinds.length === 0 ||
				kinds.includes("content") ||
				kinds.includes("content_package"));
		if (!hasMatchingAsset && !contentPackageMatches) {
			throw invalid(`Required source slot ${requirement.slot} is not satisfied by the current workspace sources.`);
		}
	}
}

function contentTypeMatches(kind: string, contentType: string) {
	const normalized = contentType.toLowerCase();
	return (
		kind === normalized ||
		(kind.endsWith("/*") && normalized.startsWith(kind.slice(0, -1))) ||
		(kind === "image" && normalized.startsWith("image/")) ||
		(kind === "video" && normalized.startsWith("video/")) ||
		(kind === "text" && normalized.startsWith("text/"))
	);
}

function invalid(message: string) {
	return new P1DomainError("INVALID_STATE", message);
}
