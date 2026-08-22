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
import type { PreferenceView } from "../model-supply/catalog.js";
import type { ModelPreferencePort } from "../model-supply/control-plane-ports.js";
import type {
	DataClass,
	ModelOperation,
} from "../model-supply/supply-contracts.js";
import type { ContentPackageRightsResolverPort } from "../operations/types.js";
import type { MarketingIdentityRepository } from "../operations/marketing-identity.js";
import {
	isStoreFactActive,
	type StoreFactLedger,
} from "../operations/store-fact-ledger.js";
import { isMaterialStoreFact } from "../harness/execution-plan-live-facts.js";
import type { ProductBillingApplicationPort } from "../product-billing/durable-service.js";
import { fingerprintValue } from "../job-runtime/job-contracts.js";
import {
	decideChannelAdmission,
	type CapabilityHotAssemblyPort,
} from "../supply-registry/hot-assembly.js";
import { resolveImageIntentOperation } from "../harness/image-intent-compiler.js";
import type { NotePlanSettingsSource } from "../harness/note-plan-compiler.js";

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
	assets: Pick<ReferenceAssetResolverPort, "inspect">;
	briefs: Pick<BriefSubmissionGate, "assertCurrent">;
	briefConfirmations: Pick<BriefConfirmationRepository, "getBriefConfirmation">;
	capabilities: ComposerCapabilityReadinessPort;
	catalog: Pick<
		CreationExperienceCatalogRepository,
		"getRecipeByRevisionId" | "getSurfaceByRevisionId"
	>;
	identities: Pick<MarketingIdentityRepository, "listActive"> &
		Partial<Pick<MarketingIdentityRepository, "listDecisions" | "project">>;
	modelPreferences: Pick<ModelPreferencePort, "getPreferences">;
	quotes: Pick<ProductBillingApplicationPort, "getQuote"> &
		Partial<Pick<ProductBillingApplicationPort, "confirm">>;
	rights: ContentPackageRightsResolverPort;
	routeResolver: ComposerRouteResolverPort;
	sourcePackages: ComposerSourceContentPackageReader;
	now?: () => string;
	noteSettings?: Pick<NotePlanSettingsSource, "read">;
	/**
	 * Tenant fact authority: pins merchant-requested explicit grants, and lists
	 * the active material facts a customized run is implicitly grounded on.
	 */
	facts?: Pick<StoreFactLedger, "withPinnedHeads" | "listActive">;
}

const STORE_FACT_REVISION_REF = /^store_fact:(.+):(\d+)$/u;

/** Mirrors the frozen snapshot's own bound (creation-execution-snapshot.ts). */
const MAX_ALLOWED_FACT_REFS = 200;

/**
 * Resolves a merchant request into server-owned fact grants. The request is not
 * authority: every ref must be the current active head in the same workspace.
 */
export async function resolveExplicitFactGrants(input: {
	workspaceId: string;
	requestedFactRefs?: readonly string[];
	at: string;
	facts?: Pick<StoreFactLedger, "withPinnedHeads">;
}): Promise<string[]> {
	const requested = [...new Set(input.requestedFactRefs ?? [])];
	if (requested.length === 0) return [];
	if (!input.facts) {
		throw invalid("Explicit fact authorization is unavailable.");
	}
	const parsed = requested.map((reference) => {
		const match = STORE_FACT_REVISION_REF.exec(reference);
		const revision = Number(match?.[2]);
		if (!match || !Number.isSafeInteger(revision) || revision < 1) {
			throw invalid("An explicit fact reference is malformed.");
		}
		return { factId: match[1]!, reference, revision };
	});
	return input.facts.withPinnedHeads(
		input.workspaceId,
		parsed.map(({ factId }) => factId),
		async (heads) =>
			parsed.map(({ factId, reference, revision }) => {
				const fact = heads.get(factId);
				if (
					!fact ||
					fact.workspaceId !== input.workspaceId ||
					fact.revision !== revision ||
					!isStoreFactActive(fact, input.at)
				) {
					throw invalid(
						"An explicit fact reference is missing, stale, inactive, or outside this workspace.",
					);
				}
				return reference;
			}),
	);
}

/**
 * Derives the fact grants §37.4-E needs, without asking the browser for them.
 *
 * A 定制创作 submission never sends `requestedFactRefs` — the App Shell fills
 * that array only in 自由创作, where the merchant hand-picks facts
 * (composer-home.tsx:2625). So for every customized run the freeze carried an
 * empty `factRevisionRefs`, and admission's `sameIdSet` compared empty against
 * empty: a price revision landing before confirmation could never register as
 * stale, and the §37.4-E fence was structurally unreachable rather than broken.
 *
 * Grounding a customized plan on the merchant's live store facts is implicit, so
 * the server is the one to state which facts those are: every active *material*
 * fact — a price/promotion value, or anything carrying a validity window. That
 * predicate is `isMaterialStoreFact`, shared with the drift side
 * (execution-plan-live-facts `materialFactHeads`) precisely so the freeze side
 * and the drift side cannot disagree about the set.
 *
 * The derived refs are not trusted any more than a requested one: they go back
 * through `resolveExplicitFactGrants`, which re-reads each id under
 * `withPinnedHeads`. A fact revoked or superseded between this read and the pin
 * therefore still fails closed.
 */
export async function deriveMaterialFactRefs(input: {
	workspaceId: string;
	at: string;
	facts?: Pick<StoreFactLedger, "listActive">;
}): Promise<string[]> {
	if (!input.facts?.listActive) return [];
	const active = await input.facts.listActive({
		workspaceId: input.workspaceId,
		// Same default the drift side uses when a submission carries no explicit
		// factScope (execution-plan-live-facts: `request.factScope ?? { storeId }`).
		scope: { storeId: input.workspaceId },
		at: input.at,
	});
	return active
		.filter((fact) => isMaterialStoreFact(fact))
		.map((fact) => `store_fact:${fact.factId}:${fact.revision}`);
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

	async prepareResultTextSelection(input: {
		actorId: string;
		workspaceId: string;
	}) {
		const preferences = await this.dependencies.modelPreferences.getPreferences(
			input.workspaceId,
			input.actorId,
			"copy.generate",
		);
		const catalogModelId =
			preferences.userDefault ??
			preferences.workspaceDefault ??
			preferences.platformDefault;
		if (!catalogModelId?.trim()) {
			throw invalid("No canonical copy model is configured.");
		}
		return { catalogModelId, operation: "copy.generate" as const };
	}

	async authorizeFactRefs(input: {
		workspaceId: string;
		factRefs: readonly string[];
	}) {
		return resolveExplicitFactGrants({
			workspaceId: input.workspaceId,
			requestedFactRefs: input.factRefs,
			at: this.now(),
			facts: this.dependencies.facts,
		});
	}

	async admitResultTextSelection(input: {
		actorId: string;
		outputCount: number;
		quote: { id: string; revision: string };
		sourceSnapshot: CreationExecutionSnapshot;
		taskId: string;
		workspaceId: string;
	}) {
		const quote = await this.dependencies.quotes.getQuote(
			input.quote.id,
			input.workspaceId,
		);
		if (
			!quote ||
			quote.quoteId !== input.quote.id ||
			quote.revision !== input.quote.revision ||
			quote.lifecycleStatus !== "confirmed" ||
			quote.taskId !== input.taskId ||
			!quote.catalogModelRevision?.trim() ||
			quote.outputCount !== input.outputCount ||
			quote.outputLabel !== `${input.outputCount} 条内容候选`
		) {
			throw invalid(
				"The confirmed ProductQuote does not bind this text adjustment.",
			);
		}
		const sourceAssetIds = input.sourceSnapshot.sources.assets.map(
			({ id }) => id,
		);
		const inspectedAssets = await this.dependencies.assets.inspect(
			input.workspaceId,
			sourceAssetIds,
		);
		const inspectedById = new Map(
			inspectedAssets.map((asset) => [asset.assetId, asset]),
		);
		const dataClass = new Set<DataClass>();
		for (const source of input.sourceSnapshot.sources.assets) {
			const inspected = inspectedById.get(source.id);
			if (
				!inspected ||
				inspected.kind !== "resolved" ||
				inspected.sha256 !== source.revision
			) {
				throw invalid(
					"A text-adjustment source asset is missing or at a different revision.",
				);
			}
			for (const value of inspected.dataClass ?? []) dataClass.add(value);
		}
		const serverDataClass = [...dataClass].sort();
		const catalogModel = {
			id: quote.catalogModelId,
			revision: quote.catalogModelRevision,
		};
		const route = await this.dependencies.routeResolver.resolve({
			catalogModel,
			dataClass: serverDataClass,
			operation: "copy.generate",
			...(quote.routeSnapshotRef
				? { routeSnapshotId: quote.routeSnapshotRef }
				: {}),
			workspaceId: input.workspaceId,
		});
		if (
			!route ||
			route.workspaceId !== input.workspaceId ||
			(quote.routeSnapshotRef && route.id !== quote.routeSnapshotRef) ||
			route.catalogRevision !== catalogModel.revision ||
			route.requestedCatalogModelId !== catalogModel.id ||
			route.selectionMode !== "fixed" ||
			JSON.stringify(normalizeRouteDataClass(route.dataClasses)) !==
				JSON.stringify(
					serverDataClass.length > 0 ? serverDataClass : ["public"],
				) ||
			!route.allowedCandidates.some(
				(candidate) => candidate.catalogModelId === catalogModel.id,
			)
		) {
			throw invalid(
				"The copy route does not match the confirmed text-adjustment quote.",
			);
		}
		await this.dependencies.capabilities.assertReady({ catalogModel, route });
		const preferences = await this.dependencies.modelPreferences.getPreferences(
			input.workspaceId,
			input.actorId,
			"copy.generate",
		);
		return {
			catalogModel,
			modelPolicy: {
				id: "result-adjust-model-policy:copy.generate",
				mode: "fixed" as const,
				revision: `result-adjust:${quote.catalogModelRevision}`,
			},
			modelSelection: deriveModelSelection(catalogModel.id, preferences),
			operation: "copy.generate" as const,
			route: { id: route.id, revision: route.catalogRevision },
		};
	}

	async admit(input: ComposerSubmissionRequest) {
			const at = this.now();
			// 自由创作 sends its own picks and nothing else is implied; 定制创作
			// sends nothing, so the server derives what the plan is grounded on.
			const requestedFactRefs = input.requestedFactRefs ?? [];
			const derivedFactRefs =
				input.creationMode === "free"
					? []
					: await deriveMaterialFactRefs({
							workspaceId: input.workspaceId,
							at,
							facts: this.dependencies.facts,
						});
			const allowedFactRefs = await resolveExplicitFactGrants({
				workspaceId: input.workspaceId,
				// The frozen snapshot caps allowedFactRefs at 200
				// (creation-execution-snapshot.ts). Derivation must never push a
				// submission over that cap and turn a working run into a schema
				// rejection, so the merchant's own refs are kept whole and the
				// derived tail is what yields. `listActive` sorts by factId, so the
				// kept set is deterministic rather than whichever rows came back
				// first. A workspace with more than 200 material facts therefore
				// fences on a subset — registered on V31-28 rather than silently
				// traded away here.
				requestedFactRefs: [
					...requestedFactRefs,
					...derivedFactRefs.slice(
						0,
						Math.max(0, MAX_ALLOWED_FACT_REFS - requestedFactRefs.length),
					),
				],
				at,
				facts: this.dependencies.facts,
			});
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
		const recipeLens = composerLensForRecipe(
			recipe.lensId,
			input.deliverable.kind,
		);
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
					...(recipeValidation.binding.notePageBound
						? { notePageBound: recipeValidation.binding.notePageBound }
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
			input.sources.assets.filter((source) => source.role !== "style").length,
			input.creationMode,
			input.imageOperation,
		);
		const modelPreferences =
			await this.dependencies.modelPreferences.getPreferences(
				input.workspaceId,
				input.actorId,
				preferenceOperationForLens(recipeBinding.lens),
			);
		const modelSelection = deriveModelSelection(
			input.catalogModel.id,
			modelPreferences,
		);
		if (
			quote.lifecycleStatus !== "quoted" &&
			quote.taskId !== taskId
		) {
			throw invalid(
				"ProductQuote is already bound to a different Composer submission.",
			);
		}

		const assetIds = input.sources.assets.map((asset) => asset.id);
		if (new Set(assetIds).size !== assetIds.length) {
			throw invalid("Source assets must not be duplicated.");
		}
		const inspectedAssets = await this.dependencies.assets.inspect(
			input.workspaceId,
			assetIds,
		);
		if (inspectedAssets.length !== assetIds.length) {
			throw invalid("Source asset inspection returned an incomplete result.");
		}
		const byAssetId = new Map(
			inspectedAssets.map((asset) => [asset.assetId, asset]),
		);
		const dataClass = new Set<DataClass>();
		for (const source of input.sources.assets) {
			const inspected = byAssetId.get(source.id);
			if (
				!inspected ||
				inspected.kind !== "resolved" ||
				inspected.sha256 !== source.revision
			) {
				throw invalid(
					"A source asset is missing, unreadable, unauthorized, or at a different revision.",
				);
			}
			for (const value of inspected.dataClass ?? []) dataClass.add(value);
		}
		const serverDataClass = [...dataClass].sort();
		const route = await this.dependencies.routeResolver.resolve({
			catalogModel: input.catalogModel,
			dataClass: serverDataClass,
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
			JSON.stringify(normalizeRouteDataClass(route.dataClasses)) !==
				JSON.stringify(
					serverDataClass.length > 0 ? serverDataClass : ["public"],
				) ||
			!route.allowedCandidates.some(
				(candidate) => candidate.catalogModelId === input.catalogModel.id,
			)
		) {
			throw invalid(
				"Route snapshot is stale, cross-workspace, or incompatible with the selected model.",
			);
		}

		const identity = input.identity ?? OFFICIAL_NEUTRAL_IDENTITY;
		let identityDecision: { id: string; revision: number } | undefined;
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
		if (input.identityDecision) {
			const decisions = await this.dependencies.identities.listDecisions?.(
				input.workspaceId,
				input.actorId,
			);
			const decision = decisions?.find(
				(candidate) =>
					candidate.decisionId === input.identityDecision?.id &&
					candidate.decisionRevision === input.identityDecision?.revision,
			);
			if (
				!decision?.identity ||
				decision.identity.identityId !== identity.id ||
				String(decision.identity.version) !== identity.revision
			) {
				throw invalid(
					"Marketing identity decision is missing, stale, or does not match this submission.",
				);
			}
			if (decision.action === "select_marketing_identity_for_session") {
				if (
					!decision.sessionId ||
					input.briefContext.id !== `composer:${decision.sessionId}`
				) {
					throw invalid(
						"Marketing identity decision is missing, stale, or does not match this submission.",
					);
				}
			} else {
				const projection = await this.dependencies.identities.project?.(
					input.workspaceId,
					input.actorId,
					this.now(),
				);
				if (
					!projection?.defaultDecision ||
					projection.defaultDecision.decisionId !== decision.decisionId ||
					projection.defaultDecision.decisionRevision !==
						decision.decisionRevision ||
					projection.defaultDecision.identity.identityId !== identity.id ||
					String(projection.defaultDecision.identity.version) !==
						identity.revision
				) {
					throw invalid(
						"Marketing identity decision is missing, stale, or does not match this submission.",
					);
				}
			}
			identityDecision = input.identityDecision;
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
			assetContentTypes: inspectedAssets
				.filter(
					(
						asset,
					): asset is Extract<
						(typeof inspectedAssets)[number],
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
		const usageUnits =
			recipeBinding.lens === "image_text_note"
				? await this.noteUsageUnits(deliverable.notePageBound)
				: undefined;
			return {
				allowedFactRefs,
			identity,
			...(identityDecision ? { identityDecision } : {}),
			modelPolicy: {
				id: `recipe-model-policy:${recipe.recipeId}`,
				mode: "fixed" as const,
				revision: recipe.revisionId,
			},
			modelSelection,
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
			...(confirmedQuote.creditCost !== undefined
				? { creditCost: confirmedQuote.creditCost }
				: {}),
			...(usageUnits ? { usageUnits } : {}),
		};
	}

	private async noteUsageUnits(notePageBound: number | undefined) {
		if (!this.dependencies.noteSettings) {
			throw invalid(
				"Image-text note usage settings are unavailable for reservation.",
			);
		}
		if (!Number.isSafeInteger(notePageBound) || (notePageBound as number) <= 0) {
			throw invalid(
				"Image-text note page-bound usage is unavailable for reservation.",
			);
		}
		await this.dependencies.noteSettings.read();
		return [
			{ resource: "copy" as const, quantity: 1 },
			{ resource: "image" as const, quantity: notePageBound as number },
		];
	}
}

function deriveModelSelection(
	catalogModelId: string,
	preferences: PreferenceView,
): NonNullable<CreationExecutionSnapshot["modelSelection"]> {
	if (preferences.userDefault === catalogModelId) {
		return {
			source: "user_default",
			catalogModelId,
			platformConfigRevision: null,
		};
	}
	if (preferences.workspaceDefault === catalogModelId) {
		return {
			source: "workspace_default",
			catalogModelId,
			platformConfigRevision: null,
		};
	}
	if (preferences.platformDefault === catalogModelId) {
		if (!preferences.platformDefaultRevision?.trim()) {
			throw invalid(
				"Platform default model selection is missing its config revision.",
			);
		}
		return {
			source: "platform_default",
			catalogModelId,
			platformConfigRevision: preferences.platformDefaultRevision,
		};
	}
	return {
		source: "current_selection",
		catalogModelId,
		platformConfigRevision: null,
	};
}

function normalizeRouteDataClass(values: string[] | undefined) {
	return [...new Set(values ?? ["public"])].sort();
}

function composerLensForRecipe(
	lens: string,
	deliverableKind: ComposerSubmissionRequest["deliverable"]["kind"],
) {
	if (lens === "copy") return "copy" as const;
	if (lens === "image_text") {
		return deliverableKind === "note" ||
			deliverableKind === "image_text_package"
			? ("image_text_note" as const)
			: ("image" as const);
	}
	if (lens === "video") return "video" as const;
	return null;
}

function operationForRequest(
	lens: CreationExecutionSnapshot["lens"],
	referenceCount: number,
	creationMode: ComposerSubmissionRequest["creationMode"],
	imageOperation: ComposerSubmissionRequest["imageOperation"],
): CreativeOperation {
	if (lens === "copy") return "copy.generate";
	if (lens === "image_text_note") {
		// Note sources ground the multi-page plan; they are not a blanket request
		// to edit the same source into every generated page.
		return "image.generate";
	}
	if (lens === "image") {
		return resolveImageIntentOperation({
			creationMode,
			imageOperation,
			referenceCount,
		});
	}
	return "video.generate";
}

function preferenceOperationForLens(
	lens: CreationExecutionSnapshot["lens"],
): ModelOperation {
	if (lens === "copy") return "copy.generate";
	if (lens === "video") return "video.generate";
	return "image.generate";
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
