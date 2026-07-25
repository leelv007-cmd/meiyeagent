import {
	pickComposerSubmissionSignedFields,
	type CreativeOperation,
} from "@meiye/contracts";

import type { BriefSubmissionGate } from "../creation-experience/brief-submission-gate.js";
import { briefSourceRevisionId } from "../creation-experience/postgres-brief-revision-context.js";
import type { BriefConfirmationRepository } from "../creation-experience/brief-confirmation-repository.js";
import type { CreationExperienceCatalogRepository } from "../creation-experience/memory-repository.js";
import { validateRecipeForComposer } from "../creation-experience/recipe-validator.js";
import { P1DomainError, type RouteSnapshot } from "../foundation/domain.js";
import type { ReferenceAssetResolverPort } from "../model-supply/reference-asset-resolver.js";
import type { ContentPackageRightsResolverPort } from "../operations/types.js";
import type { MarketingIdentityRepository } from "../operations/marketing-identity.js";
import type { ProductBillingApplicationPort } from "../product-billing/durable-service.js";
import { fingerprintValue } from "../job-runtime/job-contracts.js";
import {
	decideChannelAdmission,
	type CapabilityHotAssemblyPort,
} from "../supply-registry/hot-assembly.js";
import { selectImageIntentOperation } from "../harness/image-intent-compiler.js";

import type {
	ComposerSubmissionRequest,
	CreationExecutionSnapshot,
} from "./creation-execution-snapshot.js";
import { OFFICIAL_NEUTRAL_IDENTITY } from "./creation-execution-snapshot.js";
import type { ComposerRouteResolverPort } from "./composer-route-resolver.js";
import type { CreationSubmissionAdmissionPort } from "./submission-coordinator.js";

export interface ComposerSourceContentPackageReader {
	get(input: { packageId: string; workspaceId: string }): Promise<{
		id: string;
		revision: string | number;
		rightsState: "authorized" | "revoked";
		status: string;
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
	briefs: Pick<BriefSubmissionGate, "assertCurrent">;
	briefConfirmations: Pick<BriefConfirmationRepository, "getBriefConfirmation">;
	capabilities: ComposerCapabilityReadinessPort;
	catalog: Pick<
		CreationExperienceCatalogRepository,
		"getRecipeByRevisionId" | "getSurfaceByRevisionId"
	>;
	identities: Pick<MarketingIdentityRepository, "listActive">;
	quotes: Pick<ProductBillingApplicationPort, "getQuote"> &
		Partial<Pick<ProductBillingApplicationPort, "confirm">>;
	rights: ContentPackageRightsResolverPort;
	routeResolver: ComposerRouteResolverPort;
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
			throw invalid(
				"Route snapshot has no candidate for the selected catalog model.",
			);
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
			throw invalid(
				"No route candidate currently has an accepting capability channel.",
			);
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

	constructor(
		private readonly dependencies: ComposerSubmissionAdmissionDependencies,
	) {
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
			throw invalid(
				"Recipe revision is missing, unpublished, or does not match this submission.",
			);
		}
		const recipeLens = composerLensForRecipe(recipe.lensId);
		if (!recipeLens || recipe.targetWorkspaceKind !== recipe.lensId) {
			throw invalid(
				"Recipe is not published for the selected Composer modality.",
			);
		}
		const signedFields = pickComposerSubmissionSignedFields(input);
		const recipeValidation = validateRecipeForComposer(recipe, signedFields);
		if (!recipeValidation.binding) {
			throw invalid(
				`Recipe and submitted delivery contract do not match: ${recipeValidation.errors.join("; ")}`,
			);
		}
		const recipeBinding = {
			contentModules: recipeValidation.binding.contentModules,
			deliverables: [
				{
					id: `recipe-deliverable:${recipe.revisionId}`,
					kind: recipeValidation.binding.lens,
					order: 0,
					quantity: recipeValidation.binding.deliverable.quantity,
					...(recipeValidation.binding.deliverable.aspectRatio
						? {
								aspectRatio:
									recipeValidation.binding.deliverable.aspectRatio,
							}
						: {}),
					...(recipeValidation.binding.deliverable.durationSeconds
						? {
								durationSeconds:
									recipeValidation.binding.deliverable.durationSeconds,
							}
						: {}),
				},
			],
			lens: recipeValidation.binding.lens,
		};
		if (
			recipe.modelPolicy.mode === "fixed" &&
			recipe.modelPolicy.catalogModelId !== input.catalogModel.id
		) {
			throw invalid(
				"Recipe fixed model policy no longer matches the selected catalog model.",
			);
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
			throw invalid(
				"Surface revision is missing, unpublished, or does not match this submission.",
			);
		}
		if (
			!surface.recipeRefs.some(
				(reference) =>
					reference.visible &&
					reference.lensId === recipe.lensId &&
					reference.recipeRevisionId === recipe.revisionId,
			)
		) {
			throw invalid(
				"Surface does not expose the selected published Composer recipe.",
			);
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
			quote.submissionContractHash !== fingerprintValue(signedFields) ||
			(quote.lifecycleStatus !== "quoted" &&
				quote.lifecycleStatus !== "confirmed" &&
				quote.lifecycleStatus !== "reserved")
		) {
			throw invalid(
				"A current ProductQuote preview for these exact submitted fields is required.",
			);
		}
		const taskId = `composer-task:${fingerprintValue({
			idempotencyKey: input.idempotencyKey,
			workspaceId: input.workspaceId,
		})}`;
		const operation = operationForRequest(
			recipeBinding.lens,
			input.sources.assets.length,
		);
		if (
			quote.lifecycleStatus !== "quoted" &&
			quote.taskId !== taskId
		) {
			throw invalid(
				"ProductQuote is already bound to a different Composer submission.",
			);
		}

		const route = await this.dependencies.routeResolver.resolve({
			catalogModel: input.catalogModel,
			operation,
			...(quote.routeSnapshotRef
				? { routeSnapshotId: quote.routeSnapshotRef }
				: {}),
			workspaceId: input.workspaceId,
		});
		if (
			!route ||
			route.workspaceId !== input.workspaceId ||
			(quote.routeSnapshotRef && route.id !== quote.routeSnapshotRef) ||
			route.catalogRevision !== input.catalogModel.revision ||
			route.requestedCatalogModelId !== input.catalogModel.id ||
			route.selectionMode !== "fixed" ||
			!route.allowedCandidates.some(
				(candidate) => candidate.catalogModelId === input.catalogModel.id,
			)
		) {
			throw invalid(
				"Route snapshot is stale, cross-workspace, or incompatible with the selected model.",
			);
		}

		const identity = input.identity ?? OFFICIAL_NEUTRAL_IDENTITY;
		if (input.identity) {
			const activeIdentities = await this.dependencies.identities.listActive(
				input.workspaceId,
				this.now(),
			);
			if (
				!activeIdentities.some(
					(candidate) =>
						candidate.identityId === input.identity?.id &&
						String(candidate.version) === input.identity?.revision,
				)
			) {
				throw invalid(
					"Marketing identity is missing, inactive, or at a different revision.",
				);
			}
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
		const byAssetId = new Map(
			resolvedAssets.map((asset) => [asset.assetId, asset]),
		);
		for (const source of input.sources.assets) {
			const resolved = byAssetId.get(source.id);
			if (
				!resolved ||
				resolved.kind !== "resolved" ||
				resolved.sha256 !== source.revision
			) {
				throw invalid(
					"A source asset is missing, unreadable, unauthorized, or at a different revision.",
				);
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
			throw invalid(
				"Every source asset must be known and authorized in this workspace.",
			);
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
				sourcePackage.rightsState !== "authorized" ||
				(sourcePackage.status !== "accepted" &&
					sourcePackage.status !== "review_ready") ||
				String(sourcePackage.revision) !== input.sources.contentPackage.revision
			) {
				throw invalid(
					"Source ContentPackage is missing, cross-workspace, or at a different revision.",
				);
			}
		}

		assertSourceRequirements({
			assetContentTypes: resolvedAssets
				.filter(
					(
						asset,
					): asset is Extract<
						(typeof resolvedAssets)[number],
						{ kind: "resolved" }
					> => asset.kind === "resolved",
				)
				.map((asset) => asset.contentType),
			hasContentPackage: Boolean(sourcePackage),
			requirements: recipe.sourceRequirements,
		});

		const sourceIds = [
			...assetIds,
			...(input.sources.contentPackage
				? [input.sources.contentPackage.id]
				: []),
		];
		if (input.briefConfirmation) {
			const confirmation =
				await this.dependencies.briefConfirmations.getBriefConfirmation(
					input.workspaceId,
					input.briefConfirmation.id,
				);
			if (
				!confirmation ||
				confirmation.boundRevisions.draftRevisionId !==
					input.briefConfirmation.revision ||
				confirmation.boundRevisions.recipeRevisionId !== recipe.revisionId ||
				confirmation.boundRevisions.surfaceRevisionId !== surface.revisionId ||
				confirmation.boundRevisions.modelRevisionId !==
					input.catalogModel.revision ||
				confirmation.boundRevisions.quoteRevisionId !== quote.revision ||
				confirmation.boundRevisions.sourceRevisionId !==
					briefSourceRevisionId(sourceIds) ||
				confirmation.boundRevisions.lensId !== recipe.lensId
			) {
				throw invalid(
					"Durable Brief confirmation is missing or does not bind these exact submission facts.",
				);
			}
		}

		const deliverable = recipeBinding.deliverables[0]!;
		await this.dependencies.briefs.assertCurrent({
			...(deliverable.aspectRatio
				? { aspectRatio: deliverable.aspectRatio }
				: {}),
			...(input.briefConfirmation
				? { briefConfirmationId: input.briefConfirmation.id }
				: {}),
			briefContextId: input.briefContext.id,
			catalogModelId: input.catalogModel.id,
			catalogRevision: input.catalogModel.revision,
			...(deliverable.durationSeconds
				? { durationSeconds: deliverable.durationSeconds }
				: {}),
			expectedContextRevision: input.briefContext.revision,
			intent: input.intent,
			operation,
			outputCount: deliverable.quantity,
			sourceReferenceIds: sourceIds,
			quoteRevision: quote.revision,
			workspaceId: input.workspaceId,
		});

		await this.dependencies.capabilities.assertReady({
			catalogModel: input.catalogModel,
			route,
		});
		const confirmedQuote =
			quote.lifecycleStatus === "quoted"
				? await this.dependencies.quotes.confirm?.({
						quoteId: quote.quoteId,
						taskId,
						workspaceId: input.workspaceId,
					})
				: quote;
		if (!confirmedQuote || confirmedQuote.taskId !== taskId) {
			throw invalid(
				"ProductQuote confirmation did not bind the admitted Composer task.",
			);
		}
		return {
			identity,
			modelPolicy: {
				id: `recipe-model-policy:${recipe.recipeId}`,
				mode: "fixed" as const,
				revision: recipe.revisionId,
			},
			operation,
			recipeBinding,
			route: {
				id: route.id,
				revision: route.catalogRevision,
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
			taskId,
		};
	}
}

function composerLensForRecipe(lens: string) {
	if (lens === "copy") return "copy" as const;
	if (lens === "image_text") return "image" as const;
	if (lens === "video") return "video" as const;
	return null;
}

function operationForRequest(
	lens: CreationExecutionSnapshot["lens"],
	referenceCount: number,
): CreativeOperation {
	if (lens === "copy") return "copy.generate";
	if (lens === "image") return selectImageIntentOperation({ referenceCount });
	return "video.generate";
}

function assertSourceRequirements(input: {
	assetContentTypes: string[];
	hasContentPackage: boolean;
	requirements: Array<{ kinds?: string[]; required: boolean; slot: string }>;
}) {
	for (const requirement of input.requirements) {
		if (!requirement.required) continue;
		const kinds =
			requirement.kinds
				?.map((kind) => kind.trim().toLowerCase())
				.filter(Boolean) ?? [];
		const hasMatchingAsset = input.assetContentTypes.some((contentType) =>
			kinds.length === 0
				? true
				: kinds.some((kind) => contentTypeMatches(kind, contentType)),
		);
		const contentPackageMatches =
			input.hasContentPackage &&
			(kinds.length === 0 ||
				kinds.includes("content") ||
				kinds.includes("content_package"));
		if (!hasMatchingAsset && !contentPackageMatches) {
			throw invalid(
				`Required source slot ${requirement.slot} is not satisfied by the current workspace sources.`,
			);
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
