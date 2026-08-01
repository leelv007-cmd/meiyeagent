import { createHash } from "node:crypto";

import type {
	ContentPackage,
	ContentPackageRevisionDelivery,
	ImageModelRecipeProfile,
	NotePlan,
	SensitiveWordRecord,
	ThinkingLevel,
} from "@meiye/contracts";
import {
	boundedExecutionSnapshotSchema,
	mapThinkingLevelToModelOptions,
} from "@meiye/contracts";
import { z } from "zod";
import type { ContentPackageRevisionWritePort } from "../execution-spine/content-package-revision-port.js";
import { isOfficialNeutralIdentity } from "../execution-spine/creation-execution-snapshot.js";
import { JobRuntimeError } from "../job-runtime/job-contracts.js";
import type {
	MediaBoundedExecutionAuthorization,
	ModelSupplyResult,
	ModelSupplySubmission,
	RouteSnapshot,
} from "../model-supply/index.js";
import type { ResolvedSkillInstruction } from "../skills/types.js";
import { HARNESS_ACTION_CARRIERS } from "./action-carriers.js";
import { authorizeHarnessAction } from "./action-registry.js";
import {
	BoundedExecutionResumeError,
	type BoundedExecutionSuspension,
	evaluateBoundedExecution,
	resumeWithRaisedServerLimit,
} from "./bounded-execution-controller.js";
import {
	assessImageExactText,
	executeImageSelection,
	HarnessSelectionError,
	type ImageExactTextObservation,
} from "./execution-selection.js";
import {
	compileImageIntentForProfile,
	IMAGE_MODEL_RECIPE_PROFILE,
} from "./image-intent-compiler.js";
import { createMarketingPackageEvidence } from "./marketing-package-evidence.js";
import {
	type MediaBoundedCurrentBest,
	mediaBoundedCurrentBestSchema,
	mediaBoundedRequestFingerprint,
	parseMediaBoundedResume,
} from "./media-bounded-execution.js";
import {
	merchantExactTextMismatch,
	merchantExactTextVerificationUnavailable,
	merchantImageGenerationFailure,
	merchantNotePartialPageMarker,
	merchantNoteSelectionReason,
	merchantVideoGenerationFailure,
} from "./merchant-delivery-language.js";
import type {
	NoteMediaAdmissionPort,
	NoteMediaAdmissionToken,
} from "./note-media-admission.js";
import {
	NotePlanCompiler,
	type NotePlanEnhancementJudgeState,
	type NotePlanSettingsSource,
} from "./note-plan-compiler.js";
import {
	configuredNotePlanEnhancementJudgeResolver,
	ModelSupplyNotePlanStructuredPort,
	type NotePlanEnhancementJudgeResolver,
} from "./note-plan-structured-port.js";
import {
	assertImageRevisionAssemblyComplete,
	assertImageTextNoteRevisionAssemblyComplete,
	assertVideoRevisionAssemblyComplete,
	buildImagePlatformVariants,
	buildImageTextNotePlatformVariants,
	buildVideoPlatformVariants,
} from "./output-compiler.js";
import { validateHarnessPolicy } from "./policy-gates.js";
import {
	type HarnessExecutionChildObservabilityFactory,
	type HarnessStructuredNodeRunnerFactory,
	type SensitiveLexiconReadPort,
	harnessExecutionChildLifecycleInput,
	observeHarnessStructuredNodeRunner,
	validateHarnessVisibleDelivery,
} from "./production-stage-ports.js";
import {
	compileExecutionBrief,
	type ExecutionBrief,
	InMemoryStructuredNodeMetrics,
} from "./structured-nodes.js";
import type { HarnessWorkflowInput } from "./task-admission.js";
import { assertHarnessExecutionAssemblyPinned } from "./task-admission.js";
import {
	materializeViralImageVisionPrompt,
	type ViralAdaptPlanContext,
	type ViralImageVisionResult,
	viralImageVisionResultSchema,
} from "./viral-adapt.js";
import {
	type HarnessContextSnapshot,
	type HarnessEffectRunner,
	type HarnessMediaSelectionResult,
	type HarnessMediaStagePorts,
	type HarnessNoteBrief,
	type HarnessNoteSelectionResult,
	type HarnessNoteStagePorts,
	type HarnessSignalReceiver,
	type HarnessStagePorts,
	harnessMediaJobTopic,
	requireMeasuredVideoDuration,
} from "./workflow-core.js";
import {
	compileAiCoverImageParameters,
	mapXhsCoverSize,
	materializeXhsCoverPrompt,
} from "./xhs-cover.js";
import {
	consumeStyleAnalysisForImagePipeline,
	materializeStyleAnalysisSystemPrompt,
	parseStyleAnalysisOutput,
	type StyleAnalysisResult,
} from "./xhs-style-analysis.js";

const mediaBoundedRouteResultSchema = z
	.object({
		schemaVersion: z.literal("media-bounded-execution-result/v1"),
		snapshot: boundedExecutionSnapshotSchema,
		triggeredLimit: z.literal("maxIterations"),
		consumption: z
			.object({
				iterations: z.number().int().nonnegative().safe(),
				costCents: z.number().int().nonnegative().safe(),
				wallClockMs: z.number().int().nonnegative().safe(),
				delegations: z.number().int().nonnegative().safe(),
			})
			.strict(),
		consumedAttemptIds: z.array(z.string().trim().min(1)),
		consumedProviderCostIds: z.array(z.string().trim().min(1)),
	})
	.strict();

type MediaBrief = Exclude<ExecutionBrief, { kind: "copy" }>;

const MEDIA_JOB_WAIT_TIMEOUT_SECONDS = 150;
const NOTE_ADMISSION_WAIT_TIMEOUT_SECONDS = 300;
const NOTE_ADMISSION_POLL_INTERVAL_MS = 250;
const styleAnalysisModelOutputSchema = z
	.object({ raw: z.string().trim().min(1) })
	.strict();

export interface HarnessMediaExecutionPort {
	execute(input: {
		brief: MediaBrief;
		context: HarnessContextSnapshot;
		request: HarnessWorkflowInput;
		workflowId: string;
		/** DBOS workflow that owns the wait, distinct from page-level job keys. */
		orchestrationWorkflowId?: string;
		awaitSignal?: HarnessSignalReceiver;
		runStep?: HarnessEffectRunner;
	}): Promise<HarnessMediaSelectionResult>;
	analyzeViralReferenceImages?(input: {
		assetIds: readonly string[];
		request: HarnessWorkflowInput;
		shopContext: string;
		workflowId: string;
	}): Promise<ViralImageVisionResult>;
	executeBounded?(input: {
		brief: MediaBrief;
		context: HarnessContextSnapshot;
		request: HarnessWorkflowInput;
		workflowId: string;
		orchestrationWorkflowId?: string;
		skillInstructions?: readonly ResolvedSkillInstruction[];
		awaitSignal?: HarnessSignalReceiver;
		runStep?: HarnessEffectRunner;
		boundedResume?: BoundedExecutionSuspension<unknown>;
		boundedCheckpoint?: unknown;
	}): Promise<
		| HarnessMediaSelectionResult
		| BoundedExecutionSuspension<MediaBoundedCurrentBest>
	>;
}

/**
 * Adds image/video dispatch to the existing copy Harness ports. The shared
 * snapshot remains the only source of model, quote, platform and source facts.
 */
export class UnifiedHarnessStagePorts
	implements HarnessMediaStagePorts, HarnessNoteStagePorts
{
	constructor(
		private readonly copy: HarnessStagePorts,
		private readonly runners: HarnessStructuredNodeRunnerFactory,
		private readonly media: HarnessMediaExecutionPort,
		private readonly contentPackages: ContentPackageRevisionWritePort,
		private readonly now: () => string,
		private readonly noteSettings?: NotePlanSettingsSource,
		private readonly noteEnhancementJudge: NotePlanEnhancementJudgeResolver = configuredNotePlanEnhancementJudgeResolver,
		private readonly executionChildObservability?: HarnessExecutionChildObservabilityFactory,
		private readonly sensitiveLexicon?: SensitiveLexiconReadPort,
	) {}

	recordExecutionAssemblyStep(
		input: Parameters<
			NonNullable<HarnessStagePorts["recordExecutionAssemblyStep"]>
		>[0],
	) {
		if (!this.copy.recordExecutionAssemblyStep) {
			throw new Error(
				"Unified Harness requires workflow assembly observability.",
			);
		}
		return this.copy.recordExecutionAssemblyStep(input);
	}

	recordObservabilityEvent(
		input: Parameters<
			NonNullable<HarnessStagePorts["recordObservabilityEvent"]>
		>[0],
	) {
		if (!this.copy.recordObservabilityEvent) {
			throw new Error("Unified Harness requires canonical observability.");
		}
		return this.copy.recordObservabilityEvent(input);
	}

	resolveStageSkills(
		input: Parameters<NonNullable<HarnessStagePorts["resolveStageSkills"]>>[0],
	) {
		if (!this.copy.resolveStageSkills) {
			throw new Error(
				"Unified Harness requires the configured Skill resolver.",
			);
		}
		return this.copy.resolveStageSkills(input);
	}

	async nameIntent(input: Parameters<HarnessStagePorts["nameIntent"]>[0]) {
		return this.copy.nameIntent(input);
	}

	injectContext(input: Parameters<HarnessStagePorts["injectContext"]>[0]) {
		return this.copy.injectContext(input);
	}

	fenceContext(input: Parameters<HarnessStagePorts["fenceContext"]>[0]) {
		return this.copy.fenceContext(input);
	}

	assessFacts(
		input: Parameters<NonNullable<HarnessStagePorts["assessFacts"]>>[0],
	) {
		return this.copy.assessFacts?.(input) ?? Promise.resolve(null);
	}

	compileBrief(input: Parameters<HarnessStagePorts["compileBrief"]>[0]) {
		return this.copy.compileBrief(input);
	}

	executeAndSelect(
		input: Parameters<HarnessStagePorts["executeAndSelect"]>[0],
	) {
		return this.copy.executeAndSelect(input);
	}

	executeAndSelectBounded(
		input: Parameters<
			NonNullable<HarnessStagePorts["executeAndSelectBounded"]>
		>[0],
	) {
		if (!this.copy.executeAndSelectBounded) {
			throw new Error(
				"Configured bounded execution requires a bounded selection port.",
			);
		}
		return this.copy.executeAndSelectBounded(input);
	}

	assembleAndDeliver(
		input: Parameters<HarnessStagePorts["assembleAndDeliver"]>[0],
	) {
		return this.copy.assembleAndDeliver(input);
	}

	async compileMediaBrief(
		input: Parameters<HarnessMediaStagePorts["compileMediaBrief"]>[0],
	) {
		const kind = mediaKind(input.request);
		const metrics = new InMemoryStructuredNodeMetrics();
		const brief = await compileExecutionBrief(
			{
				workflowId: input.workflowId,
				unitId: `${kind}-r${input.context.bundle.revision}`,
				unitKind: kind,
				declaration: input.declaration,
				bundle: input.context.bundle,
				...(input.allowedFactRefs
					? { allowedFactRefs: input.allowedFactRefs }
					: {}),
				executionSnapshot: requireSnapshot(input.request),
				prompt:
					kind === "image"
						? input.request.prompts?.briefImage
						: input.request.prompts?.briefVideo,
				...(input.skillInstructions?.length
					? { skillInstructions: input.skillInstructions }
					: {}),
			},
			this.structuredRunner(input.request, "brief_compilation"),
			metrics,
		);
		if (brief.kind !== kind) {
			throw new HarnessMediaExecutionError(
				"MEDIA_BRIEF_KIND_MISMATCH",
				"The compiled media brief does not match the frozen deliverable.",
				409,
			);
		}
		const snapshot = requireSnapshot(input.request);
		const aiCover = snapshot.signedSubmission?.aiCover;
		const productionBrief =
			brief.kind === "image" && aiCover
				? applyAiCoverToImageBrief({
						brief,
						userPrompt: input.declaration.normalizedIntent,
						cover: aiCover,
						template: input.request.prompts?.xhsCoverPrompt?.content,
					})
				: brief;
		assertBriefMatchesSnapshot(productionBrief, snapshot);
		return { brief: productionBrief, metrics: metrics.snapshot() };
	}

	async executeMediaAndSelect(
		input: Parameters<HarnessMediaStagePorts["executeMediaAndSelect"]>[0],
	) {
		return this.observeModelExecution(
			{
				request: input.request,
				stage: "execution_selection",
				primitiveId: `harness-media:${input.brief.kind}`,
				baseIdempotencyKey: `harness-media:${input.workflowId}:${input.brief.kind}`,
			},
			() =>
				this.media.execute({
					...input,
					orchestrationWorkflowId: input.workflowId,
				}),
		);
	}

	async executeMediaAndSelectBounded(
		input: Parameters<
			NonNullable<HarnessMediaStagePorts["executeMediaAndSelectBounded"]>
		>[0],
	) {
		if (!this.media.executeBounded) {
			throw new Error(
				"Configured bounded execution requires a bounded media selection port.",
			);
		}
		return this.observeModelExecution(
			{
				request: input.request,
				stage: "execution_selection",
				primitiveId: `harness-media:${input.brief.kind}`,
				baseIdempotencyKey: boundedMediaLifecycleKey(input),
			},
			() =>
				this.media.executeBounded!({
					...input,
					orchestrationWorkflowId: input.workflowId,
				}),
		);
	}

	async assembleMediaAndDeliver(
		input: Parameters<HarnessMediaStagePorts["assembleMediaAndDeliver"]>[0],
	): Promise<ContentPackageRevisionDelivery> {
		const now = this.now();
		const sensitiveLexicon = await this.sensitiveLexicon?.listEnabled();
		const snapshot = requireSnapshot(input.request);
		if (input.brief.kind === "image") {
			const marketing = createMarketingPackageEvidence({
				declaration: input.declaration,
				context: input.context,
				authorizedFactRefs: input.allowedFactRefs ?? [],
				at: now,
			});
			const version = {
				body: `${input.brief.intent.subject}；${input.brief.intent.scene}。`,
				conversionHook: "私信了解详情并预约",
				createdAt: now,
				harnessCandidateId: input.selection.asset.id,
				harnessScore: 0,
				id: `${input.workflowId}:${input.selection.asset.id}`,
				orderedAssetIds: [input.selection.asset.id],
				source: "ai_generated" as const,
				title: input.brief.intent.purpose,
				topics: [],
			};
			const claimExtraction = assertMediaVisibleDelivery(
				input,
				version,
				now,
				sensitiveLexicon,
			);
			const revision = {
				claimExtraction,
				expectedRevision: input.request.expectedRevision,
				generated: {
					assetIds: [input.selection.asset.id],
					childRuns: [input.selection.childRun],
					ownedAssets: [input.selection.asset],
				},
				harnessSelection: {
					recommendedCandidateId: input.selection.asset.id,
				},
				idempotencyKey: `harness-media:${input.workflowId}:image`,
				kind: "image_text" as const,
				marketing,
				occurredAt: now,
				packageId: input.request.packageId,
				platform: mediaPlatform(snapshot.platform.id),
				snapshotId: snapshot.id,
				snapshot: {
					id: snapshot.id,
					revision: snapshot.revision,
					schemaVersion: snapshot.schemaVersion,
				},
				...(snapshot.sources.contentPackage
					? { sourceContentPackage: snapshot.sources.contentPackage }
					: {}),
				taskId: snapshot.task.id,
				version,
				variants: buildImagePlatformVariants({
					currentVersionId: version.id,
					packageId: input.request.packageId,
					versions: [version],
				}),
				workId: snapshot.work.id,
				workflowId: input.workflowId,
				workflowRevision: input.request.workflowRevision,
				workspaceId: input.request.workspaceId,
			};
			assertImageRevisionAssemblyComplete({
				...revision,
				sourceAssetIds: [...input.brief.referenceAssetIds],
			});
			return this.contentPackages.write(revision);
		}
		const marketing = createMarketingPackageEvidence({
			declaration: input.declaration,
			context: input.context,
			authorizedFactRefs: input.allowedFactRefs ?? [],
			at: now,
		});
		const version = {
			body: input.brief.storyboard
				.map(({ description }) => description)
				.join("；"),
			conversionHook: "私信了解详情并预约",
			createdAt: now,
			harnessCandidateId: input.selection.asset.id,
			harnessScore: 0,
			id: `${input.workflowId}:${input.selection.asset.id}`,
			orderedAssetIds: [input.selection.asset.id],
			source: "ai_generated" as const,
			title: "视频成品",
			topics: [],
		};
		const claimExtraction = assertMediaVisibleDelivery(
			input,
			version,
			now,
			sensitiveLexicon,
		);
		const revision = {
			billingTrustedUsage: {
				kind: "media_duration" as const,
				actualSeconds: requireMeasuredVideoDuration(input.selection),
				evidenceRef: `owned-asset:${input.selection.asset.id}`,
			},
			claimExtraction,
			expectedRevision: input.request.expectedRevision,
			generated: {
				assetIds: [input.selection.asset.id],
				childRuns: [input.selection.childRun],
				ownedAssets: [input.selection.asset],
			},
			harnessSelection: {
				recommendedCandidateId: input.selection.asset.id,
			},
			idempotencyKey: `harness-media:${input.workflowId}:${input.brief.kind}`,
			kind: "video" as const,
			marketing,
			occurredAt: now,
			packageId: input.request.packageId,
			platform: mediaPlatform(snapshot.platform.id),
			snapshotId: snapshot.id,
			snapshot: {
				id: snapshot.id,
				revision: snapshot.revision,
				schemaVersion: snapshot.schemaVersion,
				...(snapshot.semanticDecision
					? {
							semanticDecision: {
								sourceSnapshotId: snapshot.semanticDecision.sourceSnapshotId,
							},
						}
					: {}),
			},
			...(snapshot.sources.contentPackage
				? { sourceContentPackage: snapshot.sources.contentPackage }
				: {}),
			taskId: snapshot.task.id,
			version,
			variants: buildVideoPlatformVariants({
				currentVersionId: version.id,
				packageId: input.request.packageId,
				versions: [version],
			}),
			workId: snapshot.work.id,
			workflowId: input.workflowId,
			workflowRevision: input.request.workflowRevision,
			workspaceId: input.request.workspaceId,
		};
		assertVideoRevisionAssemblyComplete({
			...revision,
			sourceAssetIds: input.context.policyReferences.rightsRefs.map(
				(reference) => reference.assetId,
			),
		});
		return this.contentPackages.write(revision);
	}

	async compileNoteBrief(
		input: Parameters<HarnessNoteStagePorts["compileNoteBrief"]>[0],
	): Promise<HarnessNoteBrief> {
		const settings = await this.requireNoteSettings().read();
		const notePageBound = requireNotePageBound(input.request);
		const viralContext = await this.resolveViralAdaptPlanContext(input);
		const styleAnalysis = await this.analyzeStyleReferences(input);
		const stylePipeline = styleAnalysis
			? consumeStyleAnalysisForImagePipeline(
					styleAnalysis,
					input.request.prompts?.xhsOutline?.content,
				)
			: undefined;
		const compiler = this.noteCompiler(
			input,
			undefined,
			viralContext,
			styleAnalysis,
		);
		return {
			kind: "image_text_note",
			...(styleAnalysis ? { styleAnalysis } : {}),
			candidates: await compiler.compileDrafts({
				intent: input.declaration.normalizedIntent,
				factRefs: [...(input.allowedFactRefs ?? [])],
				rightsRefs: input.context.policyReferences.rightsRefs.map(
					({ assetId }) => assetId,
				),
				styles: settings.styles,
				notePageBound,
				...(stylePipeline
					? {
							styleAnalysisBlock: stylePipeline.styleAnalysisBlock,
							styleAnalysisOutlinePrompt: stylePipeline.outlinePrompt,
							consistencyRequirements:
								stylePipeline.consistencyRequirements,
						}
					: {}),
			}),
		};
	}

	async executeNoteAndSelect(
		input: Parameters<HarnessNoteStagePorts["executeNoteAndSelect"]>[0],
	): Promise<HarnessNoteSelectionResult> {
		const enhancementJudge = await this.noteEnhancementJudge.resolve({
			workflowId: input.workflowId,
			workspaceId: input.request.workspaceId,
		});
		const selected = await this.noteCompiler(
			input,
			enhancementJudge,
			undefined,
			input.brief.styleAnalysis,
		).selectAndGenerate({
			candidates: input.brief.candidates,
			selectedStyleId: input.selectedStyleId,
			notePageBound: requireNotePageBound(input.request),
		});
		return {
			...selected,
			enhancementJudge,
			trace: {
				stage: "execution_selection",
				winnerCandidateId: selected.selectedStyleId,
				candidateScores: input.brief.candidates.candidates.map(
					({ styleId }) => ({
						candidateId: styleId,
						score: styleId === selected.selectedStyleId ? 100 : 0,
						dimensions: {
							grounding: 1,
							usefulness: 1,
							platformFit: 1,
						},
						reason: merchantNoteSelectionReason(
							styleId === selected.selectedStyleId,
						),
					}),
				),
				blockedCandidates: [],
				rubricVersion: "note-style-user-choice-v1",
				rubricHash: createHash("sha256")
					.update("note-style-user-choice-v1")
					.digest("hex"),
			},
		};
	}

	async assembleNoteAndDeliver(
		input: Parameters<HarnessNoteStagePorts["assembleNoteAndDeliver"]>[0],
	): Promise<ContentPackageRevisionDelivery> {
		const now = this.now();
		const sensitiveLexicon = await this.sensitiveLexicon?.listEnabled();
		const snapshot = requireSnapshot(input.request);
		const marketing = createMarketingPackageEvidence({
			declaration: input.declaration,
			context: input.context,
			authorizedFactRefs: input.allowedFactRefs ?? [],
			at: now,
		});
		const versionFor = (
			candidate: HarnessNoteBrief["candidates"]["candidates"][number],
			selected: boolean,
		) => {
			const note = selected
				? input.selection.version
				: {
						schema: "image-text-note-version/v1" as const,
						plan: candidate.plan,
						regenerationReceipts: [],
					};
			const orderedAssetIds = selected
				? note.plan.pages.map(({ imageAssetId }) => imageAssetId!)
				: [];
			const unresolvedPageIds = new Set(
				selected ? (input.selection.partial?.unresolvedPageIds ?? []) : [],
			);
			return {
				body: note.plan.pages
					.map(({ id, textBlock }) =>
						unresolvedPageIds.has(id)
							? `${merchantNotePartialPageMarker()}\n${textBlock.body}`
							: textBlock.body,
					)
					.join("\n\n"),
				conversionHook: "私信了解详情并预约",
				createdAt: now,
				harnessCandidateId: candidate.styleId,
				harnessScore: selected ? 100 : 0,
				id: noteVersionId(
					input.workflowId,
					input.request.packageId,
					candidate.styleId,
				),
				note,
				orderedAssetIds,
				source: "ai_generated" as const,
				title: note.plan.themeAnchor,
				topics: [],
			};
		};
		const versions = input.brief.candidates.candidates.map((candidate) =>
			versionFor(
				candidate,
				candidate.styleId === input.selection.selectedStyleId,
			),
		);
		const winner = versions.find(
			({ harnessCandidateId }) =>
				harnessCandidateId === input.selection.selectedStyleId,
		);
		if (!winner) {
			throw new Error("The selected NotePlan style must be delivered.");
		}
		const claimExtraction = assertNoteVisibleDelivery(
			input,
			winner,
			now,
			sensitiveLexicon,
		);
		const enhancementJudge =
			input.selection.enhancementJudge ??
			(input.selection.version.evaluation
				? ({ status: "configured" } as const)
				: undefined);
		if (!enhancementJudge) {
			throw new Error(
				"NotePlan assembly requires the frozen enhancement judge state.",
			);
		}
		if (
			enhancementJudge.status === "unconfigured" &&
			!input.selection.auditSignals.some(
				({ eventType, payload }) =>
					eventType === "note_consistency_evaluated" &&
					payload.evaluationUnavailable === true &&
					payload.reason === enhancementJudge.reason &&
					payload.selfCorrectionDisabled === true,
			)
		) {
			throw new Error(
				"An unconfigured NotePlan enhancement judge requires an audit signal.",
			);
		}
		const revision = {
			additionalVersions: versions.filter(({ id }) => id !== winner.id),
			billingTrustedUsage: {
				kind: "product_units" as const,
				units: [
					{
						resource: "copy" as const,
						quantity: input.brief.candidates.candidates.length,
					},
					{
						resource: "image" as const,
						quantity: input.selection.version.plan.pages.length,
					},
				],
				evidenceRef: `note-plan-pages:${input.selection.version.plan.pages
					.map(({ id, revision }) => `${id}@${revision}`)
					.join(",")}`,
			},
			claimExtraction,
			expectedRevision: input.request.expectedRevision,
			generated: {
				assetIds: input.selection.ownedAssets.map(({ id }) => id),
				childRuns: input.selection.childRuns,
				ownedAssets: input.selection.ownedAssets,
			},
			harnessSelection: {
				recommendedCandidateId: input.selection.selectedStyleId,
			},
			idempotencyKey: `harness-note:${input.workflowId}`,
			kind: "image_text" as const,
			...(input.selection.partial ? { status: "partial" as const } : {}),
			marketing,
			occurredAt: now,
			packageId: input.request.packageId,
			platform: mediaPlatform(snapshot.platform.id),
			snapshotId: snapshot.id,
			snapshot: {
				id: snapshot.id,
				revision: snapshot.revision,
				schemaVersion: snapshot.schemaVersion,
				...(snapshot.semanticDecision
					? {
							semanticDecision: {
								sourceSnapshotId: snapshot.semanticDecision.sourceSnapshotId,
							},
						}
					: {}),
			},
			...(snapshot.sources.contentPackage
				? { sourceContentPackage: snapshot.sources.contentPackage }
				: {}),
			taskId: snapshot.task.id,
			version: winner,
			variants: buildImageTextNotePlatformVariants({
				currentVersionId: winner.id,
				packageId: input.request.packageId,
				versions,
			}),
			workId: snapshot.work.id,
			workflowId: input.workflowId,
			workflowRevision: input.request.workflowRevision,
			workspaceId: input.request.workspaceId,
		};
		assertImageTextNoteRevisionAssemblyComplete({
			...revision,
			enhancementJudge,
			...(input.selection.partial ? { partial: input.selection.partial } : {}),
		});
		return this.contentPackages.write(revision);
	}

	private async analyzeStyleReferences(
		input: Parameters<HarnessNoteStagePorts["compileNoteBrief"]>[0],
	): Promise<StyleAnalysisResult | undefined> {
		const styleAssets = requireSnapshot(input.request).sources.assets.filter(
			(asset) => asset.role === "style",
		);
		if (styleAssets.length === 0) return undefined;
		const result = await this.structuredRunner(
			input.request,
			"brief_compilation",
		).run({
			effectIdempotencyKey: `wf:${input.workflowId}:xhs:style-analysis`,
			schemaName: "harness_xhs_style_analysis_v1",
			schemaRevision: "xhs-style-analysis-v1",
			instructions: materializeStyleAnalysisSystemPrompt(
				input.request.prompts?.xhsStyleAnalysis?.content,
			),
			prompt: JSON.stringify({
				intent: input.declaration.normalizedIntent,
				referenceAssetIds: styleAssets.map(({ id }) => id),
			}),
			inputAssets: styleAssets.map(({ id }) => ({
				assetId: id,
				role: "reference_image" as const,
			})),
			schema: styleAnalysisModelOutputSchema,
		});
		const analysis = parseStyleAnalysisOutput(result.output.raw);
		if (!analysis) {
			throw new Error(
				"Reference style analysis did not return all seven dimensions.",
			);
		}
		return analysis;
	}

	private requireNoteSettings() {
		if (!this.noteSettings) {
			throw new Error("Image-text note settings are unavailable.");
		}
		return this.noteSettings;
	}

	private async resolveViralAdaptPlanContext(
		input: Parameters<HarnessNoteStagePorts["compileNoteBrief"]>[0],
	): Promise<ViralAdaptPlanContext | undefined> {
		const snapshot = requireSnapshot(input.request);
		const source = snapshot.viralAdaptSource;
		const usesViralRecipe = snapshot.recipe.id === "recipe.viral_adapt";
		if (!usesViralRecipe && !source) return undefined;
		if (!usesViralRecipe || !source) {
			throw new HarnessMediaExecutionError(
				"VIRAL_ADAPT_RECIPE_MISMATCH",
				"Viral adapt requires both the formal recipe.viral_adapt revision and a merchant paste source.",
				409,
			);
		}
		const frozenAssetIds = new Set(snapshot.sources.assets.map(({ id }) => id));
		const authorizedAssetIds = new Set(
			input.context.policyReferences.rightsRefs
				.filter(
					(reference) =>
						reference.status === "authorized" &&
						reference.allowedUses.includes("public_content"),
				)
				.map(({ assetId }) => assetId),
		);
		if (
			source.authorizedAssetIds.some(
				(assetId) =>
					!frozenAssetIds.has(assetId) || !authorizedAssetIds.has(assetId),
			)
		) {
			throw new HarnessMediaExecutionError(
				"VIRAL_ADAPT_SOURCE_MISMATCH",
				"Viral adapt reference images must belong to the frozen, authorized Composer source set.",
				409,
			);
		}
		const shopContext = viralAdaptShopContext({
			allowedFactRefs: input.allowedFactRefs ?? [],
			context: input.context,
			intent: input.declaration.normalizedIntent,
		});
		if (source.authorizedAssetIds.length === 0) {
			return { source, shopContext };
		}
		const analyzeViralReferenceImages =
			this.media.analyzeViralReferenceImages?.bind(this.media);
		if (!analyzeViralReferenceImages) {
			throw new HarnessMediaExecutionError(
				"VIRAL_IMAGE_VISION_UNAVAILABLE",
				"Viral adapt reference-image analysis is unavailable.",
				502,
			);
		}
		const imageVision = await this.observeModelExecution(
			{
				request: input.request,
				stage: "brief_compilation",
				primitiveId: "harness-text-response:viral-image-vision",
				baseIdempotencyKey: `harness-text-response:${input.workflowId}:viral-image-vision`,
				promptKey: "xhsViralImageVision",
			},
			() =>
				analyzeViralReferenceImages({
					assetIds: source.authorizedAssetIds,
					request: input.request,
					shopContext,
					workflowId: input.workflowId,
				}),
		);
		return { source, shopContext, imageVision };
	}

	private noteCompiler(
		input: {
			workflowId: string;
			request: HarnessWorkflowInput;
			context: HarnessContextSnapshot;
			awaitSignal?: HarnessSignalReceiver;
			runStep?: HarnessEffectRunner;
		},
		enhancementJudge?: NotePlanEnhancementJudgeState,
		viralContext?: ViralAdaptPlanContext,
		styleAnalysis?: StyleAnalysisResult,
	) {
		const snapshot = requireSnapshot(input.request);
		const isXhsNote = snapshot.contentPackagePlatform === "xiaohongshu";
		const runner = this.structuredRunner(
			input.request,
			"execution_selection",
			isXhsNote ? snapshot.thinkingLevel : undefined,
		);
		const marketingIdentityContext =
			isXhsNote && !snapshot.beautyVoiceRole
				? frozenMarketingIdentityContext(input.context, snapshot)
				: undefined;
		const xhsGenerationParams = isXhsNote
			? {
					...(snapshot.beautyVoiceRole
						? { beautyVoiceRole: snapshot.beautyVoiceRole }
						: {}),
					...(marketingIdentityContext ? { marketingIdentityContext } : {}),
					topic: snapshot.intent.text,
				}
			: undefined;
		return new NotePlanCompiler(
			new ModelSupplyNotePlanStructuredPort(
				runner,
				input.workflowId,
				this.now,
				input.runStep,
				input.request.prompts
					? {
							...(input.request.prompts.notePlan
								? { notePlan: input.request.prompts.notePlan }
								: {}),
							...(input.request.prompts.noteTextBlock
								? { noteTextBlock: input.request.prompts.noteTextBlock }
								: {}),
							...(input.request.prompts.noteConsistency
								? { noteConsistency: input.request.prompts.noteConsistency }
								: {}),
							...(input.request.prompts.xhsNoteGen
								? { xhsNoteGen: input.request.prompts.xhsNoteGen }
								: {}),
							// #324 paste-track viral rewrite (registered at admission freeze).
							...(input.request.prompts.xhsViralRewrite
								? { xhsViralRewrite: input.request.prompts.xhsViralRewrite }
								: {}),
						}
					: undefined,
				xhsGenerationParams,
				viralContext,
			),
			{
				generate: async ({ page, reason, evaluationReason }) => {
					const pageWorkflowId = `${input.workflowId}:note:${page.id}:${reason}:r${page.revision}`;
					const result = await this.observeModelExecution(
						{
							request: input.request,
							stage: "execution_selection",
							primitiveId: "harness-media:note-page-image",
							baseIdempotencyKey: pageWorkflowId,
						},
						() =>
							this.media.execute({
								brief: notePageImageBrief(
									page,
									snapshot,
									evaluationReason,
									styleAnalysis,
								),
								context: input.context,
								request: input.request,
								workflowId: pageWorkflowId,
								orchestrationWorkflowId: input.workflowId,
								...(input.awaitSignal
									? { awaitSignal: input.awaitSignal }
									: {}),
								...(input.runStep ? { runStep: input.runStep } : {}),
							}),
					);
					return {
						asset: result.asset,
						childRun: result.childRun,
					};
				},
			},
			enhancementJudge,
		);
	}

	private structuredRunner(
		request: HarnessWorkflowInput,
		stage: Parameters<typeof observeHarnessStructuredNodeRunner>[0]["stage"],
		thinkingLevel?: ThinkingLevel,
	) {
		assertHarnessExecutionAssemblyPinned(request);
		const snapshot = requireSnapshot(request);
		const modelOptions = thinkingLevel
			? mapThinkingLevelToModelOptions(thinkingLevel)
			: undefined;
		const runner = this.runners.create({
			actorId: request.actorId,
			billingQuoteRevision: snapshot.quote.revision,
			billingTaskId: snapshot.task.id,
			...(modelOptions
				? {
						selection: {
							mode: "auto" as const,
							profile: modelOptions.routeProfile,
						},
						providerOptions: {
							...(modelOptions.reasoningEffort
								? { reasoningEffort: modelOptions.reasoningEffort }
								: {}),
							thinking: modelOptions.thinking,
						},
					}
				: {}),
			workspaceId: request.workspaceId,
		});
		if (!request.executionAssembly) return runner;
		if (!this.executionChildObservability) {
			throw new Error(
				"Unified Harness requires child observability before structured execution.",
			);
		}
		return observeHarnessStructuredNodeRunner({
			runner,
			observer: this.executionChildObservability.create(request),
			request,
			stage,
		});
	}

	private async observeModelExecution<Output>(
		input: Parameters<typeof harnessExecutionChildLifecycleInput>[0],
		execute: () => Promise<Output>,
	): Promise<Output> {
		assertHarnessExecutionAssemblyPinned(input.request);
		if (!input.request.executionAssembly) return execute();
		if (!this.executionChildObservability) {
			throw new Error(
				"Unified Harness requires child observability before model execution.",
			);
		}
		const observer = this.executionChildObservability.create(input.request);
		const lifecycle = harnessExecutionChildLifecycleInput(input);
		await observer.append({ ...lifecycle, phase: "invoked" });
		let result: Output;
		try {
			result = await execute();
		} catch (error) {
			await observer.append({
				...lifecycle,
				phase: "rejected",
				rejectionClass: "execution_failed",
			});
			throw error;
		}
		await observer.append({ ...lifecycle, phase: "succeeded" });
		return result;
	}
}

function applyAiCoverToImageBrief(input: {
	brief: Extract<ExecutionBrief, { kind: "image" }>;
	cover: Parameters<typeof compileAiCoverImageParameters>[0] & { size: string };
	template?: string;
	userPrompt: string;
}): Extract<ExecutionBrief, { kind: "image" }> {
	const materialized = materializeXhsCoverPrompt({
		userPrompt: input.userPrompt,
		style: input.cover.style,
		aspectRatio: input.cover.aspectRatio,
		...(input.template ? { template: input.template } : {}),
	});
	if (materialized.size !== input.cover.size) {
		throw new Error("AI cover signed size does not match its aspect ratio.");
	}
	const parameters = compileAiCoverImageParameters(input.cover);
	return {
		...input.brief,
		prompt: materialized.prompt,
		parameters: {
			ratio: parameters.ratio,
			resolution: parameters.resolution,
		},
	};
}

function boundedMediaLifecycleKey(
	input: Parameters<
		NonNullable<HarnessMediaStagePorts["executeMediaAndSelectBounded"]>
	>[0],
) {
	const base = `harness-media:${input.workflowId}:${input.brief.kind}`;
	return input.boundedResume
		? `${base}:resume:${mediaBoundedRequestFingerprint(input.boundedResume)}`
		: base;
}

function notePageImageBrief(
	page: NotePlan["pages"][number],
	snapshot: NonNullable<HarnessWorkflowInput["executionSnapshot"]>,
	evaluationReason?: string,
	styleAnalysis?: StyleAnalysisResult,
): Extract<ExecutionBrief, { kind: "image" }> {
	const aspectRatio = snapshot.deliverable.aspectRatio ?? "3:4";
	const stylePipeline = styleAnalysis
		? consumeStyleAnalysisForImagePipeline(styleAnalysis)
		: undefined;
	return {
		kind: "image",
		intent: page.imageIntent,
		prompt:
			`为图文笔记第 ${page.order} 页生成配图：${page.imageIntent.purpose}。` +
			`图文必须围绕“${page.textBlock.title}”一致表达。` +
			(evaluationReason ? `本次回炉需要修正：${evaluationReason}` : "") +
			(stylePipeline?.styleAnalysisBlock ?? ""),
		referenceAssetIds: page.imageIntent.references.map(
			({ assetId }) => assetId,
		),
		parameters: {
			ratio: aspectRatio,
			resolution: "2048",
		},
		constraints: [
			"不得改写精确文字，不得使用未授权素材",
			...(stylePipeline?.consistencyRequirements ?? []),
		],
	};
}

function noteVersionId(workflowId: string, packageId: string, styleId: string) {
	return `${packageId}-note-${createHash("sha256")
		.update(JSON.stringify({ workflowId, styleId }))
		.digest("hex")
		.slice(0, 16)}`;
}

function frozenMarketingIdentityContext(
	context: HarnessContextSnapshot,
	snapshot: ReturnType<typeof requireSnapshot>,
) {
	if (isOfficialNeutralIdentity(snapshot.identity)) return undefined;
	const sourceRef = `marketing_identity:${snapshot.identity.id}:${snapshot.identity.revision}`;
	const registered = context.policyReferences.identityRefs.some(
		(reference) =>
			reference.id === sourceRef &&
			reference.workspaceId === snapshot.workspaceId &&
			reference.status === "registered",
	);
	if (!registered) return undefined;
	const contribution = Object.values(
		context.bundle.dimensions.expression_identity,
	).find((candidate) => candidate.sourceRef === sourceRef);
	return contribution ? JSON.stringify(contribution.value) : undefined;
}

function assertMediaVisibleDelivery(
	input: Parameters<HarnessMediaStagePorts["assembleMediaAndDeliver"]>[0],
	version: {
		body: string;
		conversionHook: string;
		id: string;
		title: string;
	},
	evaluatedAt: string,
	sensitiveLexicon?: readonly SensitiveWordRecord[],
) {
	const snapshot = requireSnapshot(input.request);
	const expressionIdentityRef = isOfficialNeutralIdentity(snapshot.identity)
		? undefined
		: `marketing_identity:${snapshot.identity.id}:${snapshot.identity.revision}`;
	const result = validateHarnessVisibleDelivery({
		assetRefs: [...input.brief.referenceAssetIds],
		brief: input.brief as unknown as Record<string, unknown>,
		candidateId: version.id,
		context: input.context,
		allowedFactRefs: input.allowedFactRefs ?? [],
		evaluatedAt,
		...(sensitiveLexicon ? { sensitiveLexicon } : {}),
		...(expressionIdentityRef ? { expressionIdentityRef } : {}),
		visibleText: [
			{ field: "title", text: version.title },
			{ field: "body", text: version.body },
			{ field: "cta", text: version.conversionHook },
			...(input.brief.kind === "image"
				? input.brief.intent.exactText
						.filter(({ treatment }) => treatment === "exact")
						.map(({ text }, index) => ({
							field: `image.exactText.${index}`,
							text,
						}))
				: []),
		],
		workspaceId: input.request.workspaceId,
	});
	if (!result.passed) {
		throw new HarnessSelectionError(
			[...new Set(result.failures.map(({ gateId }) => gateId))],
			result.failures[0]?.reason,
			result.failures.flatMap(({ triggeredClaims }) => triggeredClaims ?? []),
			[
				...new Set(
					result.failures.flatMap(({ alternativePath }) => alternativePath),
				),
			],
			structuredClone(result.failures),
		);
	}
	return result.claimExtraction!;
}

function assertNoteVisibleDelivery(
	input: Parameters<HarnessNoteStagePorts["assembleNoteAndDeliver"]>[0],
	version: {
		body: string;
		conversionHook: string;
		id: string;
		title: string;
	},
	evaluatedAt: string,
	sensitiveLexicon?: readonly SensitiveWordRecord[],
) {
	const snapshot = requireSnapshot(input.request);
	const expressionIdentityRef = isOfficialNeutralIdentity(snapshot.identity)
		? undefined
		: `marketing_identity:${snapshot.identity.id}:${snapshot.identity.revision}`;
	const result = validateHarnessVisibleDelivery({
		assetRefs: [],
		brief: input.brief as unknown as Record<string, unknown>,
		candidateId: version.id,
		context: input.context,
		allowedFactRefs: input.allowedFactRefs ?? [],
		evaluatedAt,
		...(sensitiveLexicon ? { sensitiveLexicon } : {}),
		...(expressionIdentityRef ? { expressionIdentityRef } : {}),
		visibleText: [
			{ field: "title", text: version.title },
			{ field: "body", text: version.body },
			{ field: "cta", text: version.conversionHook },
		],
		workspaceId: input.request.workspaceId,
	});
	if (!result.passed) {
		throw new HarnessSelectionError(
			[...new Set(result.failures.map(({ gateId }) => gateId))],
			result.failures[0]?.reason,
			result.failures.flatMap(({ triggeredClaims }) => triggeredClaims ?? []),
			[
				...new Set(
					result.failures.flatMap(({ alternativePath }) => alternativePath),
				),
			],
			structuredClone(result.failures),
		);
	}
	return result.claimExtraction!;
}

function mediaPlatform(
	platform: string,
): "xiaohongshu" | "douyin" | "video_account" {
	if (
		platform === "xiaohongshu" ||
		platform === "douyin" ||
		platform === "video_account"
	) {
		return platform;
	}
	throw new Error(`Platform ${platform} does not support media delivery.`);
}

function viralAdaptShopContext(input: {
	allowedFactRefs: readonly string[];
	context: HarnessContextSnapshot;
	intent: string;
}) {
	const allowed = new Set(input.allowedFactRefs);
	const facts = (input.context.activeFacts ?? [])
		.filter((fact) => allowed.has(fact.sourceRef) || allowed.has(fact.key))
		.map((fact) => `${fact.key}: ${JSON.stringify(fact.value)}`);
	const lines = [
		`当前创作意图：${input.intent}`,
		...(facts.length > 0
			? facts
			: input.allowedFactRefs.length > 0
				? [`已授权事实引用：${input.allowedFactRefs.join(", ")}`]
				: ["未提供可用门店事实；不得自行编造。"]),
	];
	return lines.join("\n").slice(0, 4_000);
}

export interface ImageExactTextVerifier {
	preauthorize?(input: {
		assetId: string;
		expected: string[];
		request: HarnessWorkflowInput;
		route: RouteSnapshot;
		workflowId: string;
	}):
		| {
				iterations: number;
				costCents: number;
		  }
		| Promise<{
				iterations: number;
				costCents: number;
		  }>;
	observe(input: {
		assetId: string;
		expected: string[];
		request: HarnessWorkflowInput;
		route?: RouteSnapshot;
		workflowId: string;
	}): Promise<
		ImageExactTextObservation & {
			modelResult?: ModelSupplyResult;
		}
	>;
}

const exactTextObservationSchema = z
	.object({
		observedText: z.array(z.string()),
		conflictingText: z.array(z.string()),
	})
	.strict();

const exactTextPreauthorizationSchema = z
	.object({
		iterations: z.number().int().nonnegative().safe(),
		costCents: z.number().int().nonnegative().safe(),
	})
	.strict();

export class ModelSupplyImageExactTextVerifier
	implements ImageExactTextVerifier
{
	constructor(
		private readonly models: {
			submit(input: ModelSupplySubmission): Promise<ModelSupplyResult>;
			freezeAutoTextRouteForExecution?(input: {
				workspaceId: string;
				dataClass: ModelSupplySubmission["dataClass"];
				promptRevision?: string;
			}): Promise<RouteSnapshot>;
		},
		private readonly executionChildObservability?: HarnessExecutionChildObservabilityFactory,
	) {}

	preauthorize(input: {
		assetId: string;
		expected: string[];
		request: HarnessWorkflowInput;
		route: RouteSnapshot;
		workflowId: string;
	}) {
		return exactTextFrozenRoutePreauthorization(input.route);
	}

	async observe(input: {
		assetId: string;
		expected: string[];
		request: HarnessWorkflowInput;
		route?: RouteSnapshot;
		workflowId: string;
	}) {
		if (input.expected.length === 0) {
			return {
				expected: [],
				observed: [],
				conflictingText: [],
			};
		}
		const idempotencyKey = `harness-media:${input.workflowId}:image:exact-text:${input.assetId}`;
		const frozenRouteSnapshot =
			input.route ?? (await this.freezeExactTextRoute(input.request));
		const submit = () =>
			this.models.submit({
				actorId: input.request.actorId,
					billingTaskId: requireSnapshot(input.request).task.id,
				billingQuoteRevision: requireSnapshot(input.request).quote.revision,
				correlationId: input.workflowId,
				dataClass: [...frozenRouteSnapshot.dataClass],
				idempotencyKey,
				input: {
					inputAssets: [{ assetId: input.assetId, role: "reference_image" }],
				},
				operation: "text.respond",
				...(input.request.prompts?.textResponse
					? { promptBinding: input.request.prompts.textResponse }
					: {}),
				prompt: JSON.stringify({
					task: "Read all visible text in the supplied image.",
					expectedExactText: input.expected,
					responseContract: {
						observedText: ["each visible text segment verbatim"],
						conflictingText: [
							"visible text that alters or contradicts an expected exact value",
						],
					},
				}),
				selection: structuredClone(frozenRouteSnapshot.requestedSelection),
				productUsageQuantity: 0,
				workspaceId: input.request.workspaceId,
				frozenRouteSnapshot: structuredClone(frozenRouteSnapshot),
			});
		assertHarnessExecutionAssemblyPinned(input.request);
		if (!input.request.executionAssembly) {
			const result = await submit();
			return {
				...exactTextObservationFromResult(result, input.expected),
				modelResult: result,
			};
		}
		if (!this.executionChildObservability) {
			throw new Error("Exact-text verification requires child observability.");
		}
		const observer = this.executionChildObservability.create(input.request);
		const lifecycle = harnessExecutionChildLifecycleInput({
			request: input.request,
			stage: "execution_selection",
			primitiveId: "harness-text-response:exact-text",
			baseIdempotencyKey: idempotencyKey,
			promptKey: "textResponse",
		});
		await observer.append({ ...lifecycle, phase: "invoked" });
		let result: ModelSupplyResult;
		try {
			result = await submit();
		} catch (error) {
			await observer.append({
				...lifecycle,
				phase: "rejected",
				rejectionClass: "execution_failed",
			});
			throw error;
		}
		const observation = exactTextObservationFromResult(result, input.expected);
		await observer.append({ ...lifecycle, phase: "succeeded" });
		return { ...observation, modelResult: result };
	}

	private async freezeExactTextRoute(request: HarnessWorkflowInput) {
		if (!this.models.freezeAutoTextRouteForExecution) {
			throw new Error(
				"Exact-text verification requires an independently frozen text.respond route.",
			);
		}
		return this.models.freezeAutoTextRouteForExecution({
			workspaceId: request.workspaceId,
			dataClass: [...(request.frozenRouteSnapshot?.dataClass ?? [])],
		});
	}
}

function exactTextFrozenRoutePreauthorization(route: RouteSnapshot) {
	if (
		route.requestedSelection.mode !== "fixed" ||
		!route.requestedSelection.catalogModelId ||
		route.requestedSelection.catalogModelId !== route.actualCatalogModelId ||
		route.requestedSelection.fallbackConsent !== false ||
		route.candidateCatalogModelIds.length !== 1 ||
		route.candidateCatalogModelIds[0] !== route.actualCatalogModelId ||
		route.maxAttempts !== 1 ||
		route.fallbackAuthorized !== false ||
		route.fallbackConsent !== false ||
		route.allowedCandidates?.length !== 1
	) {
		throw new Error(
			"Bounded exact-text verification requires one fixed frozen text.respond route without fallback.",
		);
	}
	const selected = route?.allowedCandidates?.find(
		(candidate) =>
			candidate.deploymentId === route.deploymentId &&
			candidate.catalogModelId === route.actualCatalogModelId &&
			candidate.modelOperations.includes("text.respond"),
	);
	if (!selected) {
		throw new Error(
			"Bounded exact-text verification requires a frozen text.respond route.",
		);
	}
	if (
		selected.pricingStatus === "unknown" ||
		!selected.priceRevision.trim() ||
		!Number.isSafeInteger(selected.unitPriceMicros) ||
		selected.unitPriceMicros <= 0
	) {
		throw new Error(
			"Bounded exact-text verification requires a positive frozen route price.",
		);
	}
	if (selected.currency !== "CNY") {
		throw new Error(
			"Bounded exact-text verification requires a frozen CNY route price.",
		);
	}
	if (selected.unit !== "request") {
		throw new Error(
			"Bounded exact-text verification cannot authorize a non-request price unit.",
		);
	}
	const cents = (BigInt(selected.unitPriceMicros) + 9_999n) / 10_000n;
	if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error(
			"Bounded exact-text frozen route price exceeds the safe CNY-cent range.",
		);
	}
	return { iterations: 1, costCents: Number(cents) };
}

function exactTextObservationFromResult(
	result: ModelSupplyResult,
	expected: readonly string[],
): ImageExactTextObservation {
	if (result.status !== "completed" || !result.text?.trim()) {
		throw new HarnessMediaExecutionError(
			"MEDIA_EXACT_TEXT_VERIFICATION_FAILED",
			"Image text verification did not return an observation.",
			502,
			result.jobId,
			result.attempt.acceptance,
			merchantExactTextVerificationUnavailable(),
		);
	}
	const observation = exactTextObservationSchema.parse(
		JSON.parse(jsonObject(result.text)),
	);
	return {
		expected: [...expected],
		observed: observation.observedText,
		conflictingText: observation.conflictingText,
	};
}

function viralImageVisionFromResult(
	result: ModelSupplyResult,
): ViralImageVisionResult {
	if (result.status !== "completed" || !result.text?.trim()) {
		throw new HarnessMediaExecutionError(
			"VIRAL_IMAGE_VISION_FAILED",
			"Viral reference-image analysis did not return a structured observation.",
			502,
			result.jobId,
			result.attempt.acceptance,
		);
	}
	try {
		return viralImageVisionResultSchema.parse(
			JSON.parse(jsonObject(result.text)),
		);
	} catch (error) {
		throw new HarnessMediaExecutionError(
			"VIRAL_IMAGE_VISION_FAILED",
			`Viral reference-image analysis returned invalid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
			502,
			result.jobId,
			result.attempt.acceptance,
		);
	}
}

export class FixtureImageExactTextVerifier implements ImageExactTextVerifier {
	preauthorize() {
		return { iterations: 0, costCents: 0 };
	}

	async observe(input: { expected: string[] }) {
		return {
			expected: [...input.expected],
			observed: [...input.expected],
			conflictingText: [],
		};
	}
}

interface DurableMediaJobResult {
	result: ModelSupplyResult;
	providerLifecycleLatencyMs?: number;
}

function withObservedProviderLifecycle(
	durable: DurableMediaJobResult,
): ModelSupplyResult {
	return durable.providerLifecycleLatencyMs === undefined
		? durable.result
		: {
				...durable.result,
				latencyMs: durable.providerLifecycleLatencyMs,
			};
}

/** Narrow adapter over the existing Model Supply durable media path. */
export class ModelSupplyHarnessMediaExecutionPort
	implements HarnessMediaExecutionPort
{
	constructor(
		private readonly models: Pick<
			{
				submit(input: ModelSupplySubmission): Promise<ModelSupplyResult>;
				getDurableMediaJob?(
					workspaceId: string,
					jobId: string,
				): Promise<DurableMediaJobResult>;
				resumeBoundedMediaJob?(input: {
					workspaceId: string;
					jobId: string;
					authorization: MediaBoundedExecutionAuthorization;
				}): Promise<{ result: ModelSupplyResult }>;
				freezeAutoTextRouteForExecution?(input: {
					workspaceId: string;
					dataClass: ModelSupplySubmission["dataClass"];
					promptRevision?: string;
				}): Promise<RouteSnapshot>;
			},
			| "submit"
			| "getDurableMediaJob"
			| "resumeBoundedMediaJob"
			| "freezeAutoTextRouteForExecution"
		>,
		private readonly exactText?: ImageExactTextVerifier,
		private readonly noteAdmission?: NoteMediaAdmissionPort,
		private readonly imageProfile: ImageModelRecipeProfile = IMAGE_MODEL_RECIPE_PROFILE,
	) {}

	async analyzeViralReferenceImages(input: {
		assetIds: readonly string[];
		request: HarnessWorkflowInput;
		shopContext: string;
		workflowId: string;
	}): Promise<ViralImageVisionResult> {
		assertHarnessExecutionAssemblyPinned(input.request);
		const assetIds = [...new Set(input.assetIds.map((id) => id.trim()))].filter(
			Boolean,
		);
		if (assetIds.length === 0) {
			throw new HarnessMediaExecutionError(
				"VIRAL_ADAPT_SOURCE_MISMATCH",
				"Viral image vision requires at least one attached source asset.",
				409,
			);
		}
		const frozenAssetIds = new Set(
			requireSnapshot(input.request).sources.assets.map(({ id }) => id),
		);
		if (assetIds.some((assetId) => !frozenAssetIds.has(assetId))) {
			throw new HarnessMediaExecutionError(
				"VIRAL_ADAPT_SOURCE_MISMATCH",
				"Viral image vision cannot read an asset outside the frozen source set.",
				409,
			);
		}
		if (!this.models.freezeAutoTextRouteForExecution) {
			throw new HarnessMediaExecutionError(
				"VIRAL_IMAGE_VISION_UNAVAILABLE",
				"Viral image vision requires an independently frozen text.respond route.",
				502,
			);
		}
		const promptBinding = input.request.prompts?.xhsViralImageVision;
		if (!promptBinding) {
			throw new HarnessMediaExecutionError(
				"VIRAL_IMAGE_VISION_UNAVAILABLE",
				"Viral image vision requires the frozen xhsViralImageVision prompt.",
				502,
			);
		}
		const frozenRouteSnapshot =
			await this.models.freezeAutoTextRouteForExecution({
				workspaceId: input.request.workspaceId,
				dataClass: [...(input.request.frozenRouteSnapshot?.dataClass ?? [])],
				promptRevision: promptBinding.version,
			});
		const result = await this.models.submit({
			actorId: input.request.actorId,
			billingTaskId: requireSnapshot(input.request).task.id,
			billingQuoteRevision: requireSnapshot(input.request).quote.revision,
			correlationId: input.workflowId,
			dataClass: [...frozenRouteSnapshot.dataClass],
			idempotencyKey: `harness-text-response:${input.workflowId}:viral-image-vision`,
			input: {
				inputAssets: assetIds.map((assetId) => ({
					assetId,
					role: "reference_image" as const,
				})),
			},
			operation: "text.respond",
			promptBinding,
			prompt: materializeViralImageVisionPrompt({
				assetIds,
				shopContext: input.shopContext,
				template: promptBinding.content,
			}),
			selection: structuredClone(frozenRouteSnapshot.requestedSelection),
			productUsageQuantity: 0,
			workspaceId: input.request.workspaceId,
			frozenRouteSnapshot: structuredClone(frozenRouteSnapshot),
		});
		return viralImageVisionFromResult(result);
	}

	async execute(input: {
		brief: MediaBrief;
		context: HarnessContextSnapshot;
		request: HarnessWorkflowInput;
		workflowId: string;
		orchestrationWorkflowId?: string;
		skillInstructions?: readonly ResolvedSkillInstruction[];
		awaitSignal?: HarnessSignalReceiver;
		runStep?: HarnessEffectRunner;
	}): Promise<HarnessMediaSelectionResult> {
		this.assertExecutionPolicy(input);
		const executionAssemblyRequired = Boolean(input.request.executionAssembly);
		const snapshot = requireSnapshot(input.request);
		const noteAdmissionInput =
			snapshot.lens === "image_text_note"
				? {
						taskId: snapshot.task.id,
						workflowId: input.workflowId,
						workspaceId: snapshot.workspaceId,
					}
				: undefined;
		if (input.brief.kind === "image") {
			const expected = input.brief.intent.exactText
				.filter(({ treatment }) => treatment === "exact")
				.map(({ text }) => text);
			if (expected.length > 0 && !this.exactText) {
				throw new HarnessMediaExecutionError(
					"MEDIA_EXACT_TEXT_VERIFIER_UNAVAILABLE",
					"Image text verification is unavailable.",
					502,
					undefined,
					undefined,
					merchantExactTextVerificationUnavailable(),
				);
			}
			const selected = await executeImageSelection<ModelSupplyResult>({
				candidateId(result) {
					return requireCompletedMediaResult(result, "image").asset!.id;
				},
				generate: async ({ attempt, exactTextFailure }) =>
					this.submitAndAwait(
						mediaSubmission(
							input.workflowId,
							input.request,
							input.brief,
							attempt,
							exactTextFailure?.reason,
							this.imageProfile,
							input.orchestrationWorkflowId,
							input.context.bundle.revision,
						),
						input.request,
						executionAssemblyRequired,
						noteAdmissionInput,
						input.awaitSignal,
						input.runStep,
					),
				observe: async (result) => {
					const completed = requireCompletedMediaResult(result, "image");
					if (expected.length === 0) {
						return {
							expected: [],
							observed: [],
							conflictingText: [],
						};
					}
					return this.runEffect(
						`verify:${completed.asset!.id}`,
						() =>
							this.exactText!.observe({
								assetId: completed.asset!.id,
								expected,
								request: input.request,
								workflowId: input.workflowId,
							}),
						input.runStep,
					);
				},
				merchantFailure: merchantExactTextMismatch,
			});
			const completed = requireCompletedMediaResult(selected.result, "image");
			return mediaSelection(
				completed,
				"image",
				selected.executions,
				selected.blockedCandidates,
			);
		}
		const result = await this.submitAndAwait(
			mediaSubmission(
				input.workflowId,
				input.request,
				input.brief,
				"primary",
				undefined,
				this.imageProfile,
				input.orchestrationWorkflowId,
				input.context.bundle.revision,
			),
			input.request,
			executionAssemblyRequired,
			noteAdmissionInput,
			input.awaitSignal,
			input.runStep,
		);
		const completed = requireCompletedMediaResult(result, input.brief.kind);
		return mediaSelection(completed, input.brief.kind, [completed], []);
	}

	async executeBounded(input: {
		brief: MediaBrief;
		context: HarnessContextSnapshot;
		request: HarnessWorkflowInput;
		workflowId: string;
		orchestrationWorkflowId?: string;
		skillInstructions?: readonly ResolvedSkillInstruction[];
		awaitSignal?: HarnessSignalReceiver;
		runStep?: HarnessEffectRunner;
		boundedResume?: BoundedExecutionSuspension<unknown>;
		boundedCheckpoint?: unknown;
	}): Promise<
		| HarnessMediaSelectionResult
		| BoundedExecutionSuspension<MediaBoundedCurrentBest>
	> {
		const startedAt = performance.now();
		let durableWaitMs = 0;
		let observedActiveMs = 0;
		const snapshot = input.request.boundedExecution;
		if (!snapshot) {
			throw new Error(
				"Bounded media execution requires a bounded execution snapshot.",
			);
		}
		if (
			typeof snapshot.maxIterations !== "number" ||
			typeof snapshot.maxCostCents !== "number" ||
			typeof snapshot.maxWallClockMs !== "number"
		) {
			throw new Error(
				"Bounded media execution requires explicit iteration, cost, and wall-clock limits.",
			);
		}
		this.assertExecutionPolicy(input);
		const fingerprint = mediaBoundedRequestFingerprint({
			workflowId: input.workflowId,
			workspaceId: input.request.workspaceId,
			actorId: input.request.actorId,
			workflowRevision: input.request.workflowRevision,
			executionSnapshot: input.request.executionSnapshot,
			frozenRouteSnapshot: input.request.frozenRouteSnapshot,
			prompts: input.request.prompts,
			promptRevisionRefs: input.request.promptRevisionRefs,
			executionAssembly: input.request.executionAssembly,
			skillInstructions: input.skillInstructions,
			contextRevision: input.context.bundle.revision,
			contextHash: input.context.bundle.hash,
			brief: input.brief,
		});
		const executionRootFingerprint = mediaBoundedRequestFingerprint({
			workflowId: input.workflowId,
			workspaceId: input.request.workspaceId,
			actorId: input.request.actorId,
			workflowRevision: input.request.workflowRevision,
			executionSnapshot: input.request.executionSnapshot,
			frozenRouteSnapshot: input.request.frozenRouteSnapshot,
			prompts: input.request.prompts,
			promptRevisionRefs: input.request.promptRevisionRefs,
			executionAssembly: input.request.executionAssembly,
			skillInstructions: input.skillInstructions,
		});
		const expectedExactText =
			input.brief.kind === "image"
				? input.brief.intent.exactText
						.filter(({ treatment }) => treatment === "exact")
						.map(({ text }) => text)
				: [];
		if (expectedExactText.length > 0 && !this.exactText) {
			throw new HarnessMediaExecutionError(
				"MEDIA_EXACT_TEXT_VERIFIER_UNAVAILABLE",
				"Image text verification is unavailable.",
				502,
				undefined,
				undefined,
				merchantExactTextVerificationUnavailable(),
			);
		}
		let checkpoint = input.boundedResume
			? parseMediaBoundedResume(
					input.boundedResume,
					snapshot,
					fingerprint,
					executionRootFingerprint,
					input.brief.kind,
				)
			: input.boundedCheckpoint !== undefined
				? nextMediaEffectCheckpoint(
						input.boundedCheckpoint,
						fingerprint,
						executionRootFingerprint,
						input.brief.kind,
					)
				: mediaBoundedCurrentBestSchema.parse({
						schemaVersion: "harness-media-current-best/v1",
						requestFingerprint: fingerprint,
						executionRootFingerprint,
						kind: input.brief.kind,
						phase: "before_submit",
						attempts: [],
						countedAttemptIds: [],
						countedProviderCostIds: [],
						attemptReceiptDigests: [],
						providerCostReceiptDigests: [],
					});
		let activeSnapshot = snapshot;
		const beforeSubmit = evaluateBoundedExecution(activeSnapshot, {
			consumption: activeSnapshot.consumption,
			currentBest: checkpoint,
			unmetExplanation: "媒体生成已达到本轮上限",
		});
		if (beforeSubmit.state === "suspended") {
			return beforeSubmit;
		}
		activeSnapshot = beforeSubmit.snapshot;

		const loadDurable = async (current: MediaBoundedCurrentBest) => {
			const finalAttempt = current.attempts.at(-1);
			if (!finalAttempt || !this.models.getDurableMediaJob) {
				throw new HarnessMediaExecutionError(
					"MEDIA_RECONCILIATION_PENDING",
					"Bounded media recovery requires the same durable provider job.",
					202,
					finalAttempt?.jobId,
				);
			}
			const results = await Promise.all(
				current.attempts.map(async (attempt) => {
					const durable = await this.models.getDurableMediaJob!(
						input.request.workspaceId,
						attempt.jobId,
					);
					const durableCompleted = requireCompletedMediaResult(
						withObservedProviderLifecycle(durable),
						input.brief.kind,
					);
					const completed = attempt.merchantExecutionEffectKey
						? {
								...durableCompleted,
								merchantExecutionEffectKey:
									attempt.merchantExecutionEffectKey,
							}
						: durableCompleted;
					if (completed.jobId !== attempt.jobId) {
						throw new HarnessMediaExecutionError(
							"MEDIA_SNAPSHOT_MISMATCH",
							"The durable media job does not match the bounded checkpoint.",
							409,
							attempt.jobId,
						);
					}
						if (
							attempt.merchantExecutionEffectKey !==
							durableCompleted.merchantExecutionEffectKey ||
						attempt.resultDigest &&
							mediaRouteDurableResultDigest(durableCompleted) !==
								attempt.resultDigest
					) {
						throw new HarnessMediaExecutionError(
							"MEDIA_SNAPSHOT_MISMATCH",
							"The durable media result does not match its selected merchant effect.",
							409,
							attempt.jobId,
						);
					}
					observeBoundedMediaReceipts(
						activeSnapshot,
						current,
							completed,
							0,
						);
					return completed;
				}),
			);
			const completed = results.at(-1)!;
			if (
				completed.asset?.id !== current.asset?.id ||
				completed.asset?.sha256 !== current.asset?.sha256
			) {
				throw new HarnessMediaExecutionError(
					"MEDIA_SNAPSHOT_MISMATCH",
					"The durable media result does not match the bounded checkpoint.",
					409,
					finalAttempt.jobId,
				);
			}
			return results;
		};
		let primary: ModelSupplyResult | undefined;
		let recoveredRetry: ModelSupplyResult | undefined;
		let primaryExactTextFailure: string | undefined;
		if (
			checkpoint.phase === "ready" ||
			checkpoint.phase === "verify_primary" ||
			checkpoint.phase === "exact_text_retry" ||
			checkpoint.phase === "verify_retry" ||
			checkpoint.phase === "exact_text_failed"
		) {
			const durableResults = await loadDurable(checkpoint);
			primary = durableResults[0];
			if (checkpoint.phase === "ready") {
				return {
					...mediaSelection(
						durableResults.at(-1)!,
						input.brief.kind,
						durableResults,
						durableResults.length === 2
							? [
									{
										candidateId: durableResults[0]!.asset!.id,
										gateIds: ["image_exact_text"],
									},
								]
							: [],
					),
					boundedCurrentBest: checkpoint,
					boundedExecution: activeSnapshot,
				};
			}
			if (checkpoint.phase === "exact_text_failed") {
				throw new HarnessSelectionError(
					["image_exact_text"],
					merchantExactTextMismatch({
						expected: expectedExactText,
						observed: [],
					}),
				);
			}
			primaryExactTextFailure = checkpoint.exactTextFailure;
			if (checkpoint.phase === "verify_retry") {
				recoveredRetry = durableResults.at(-1)!;
			}
		}

		const submitAttempt = async (
			role: "primary" | "exact_text_retry",
			exactTextFailure?: string,
		) => {
			const authorization: MediaBoundedExecutionAuthorization = {
				schemaVersion: "media-bounded-execution/v1",
				snapshot: activeSnapshot,
				countedAttemptIds: checkpoint.countedAttemptIds,
				countedProviderCostIds: checkpoint.countedProviderCostIds,
			};
			let result: ModelSupplyResult & {
				merchantExecutionEffectKey?: string;
			};
			if (
				role === "primary" &&
				checkpoint.phase === "provider_route_suspended"
			) {
				if (
					!checkpoint.providerRoute ||
					!this.models.getDurableMediaJob ||
					!this.models.resumeBoundedMediaJob
				) {
					throw new BoundedExecutionResumeError(
						"Bounded media route resume requires the same durable provider job.",
					);
				}
				const durableBeforeResume = await this.runEffect(
					`verify-resume:${checkpoint.providerRoute.jobId}`,
					() =>
						this.models.getDurableMediaJob!(
							input.request.workspaceId,
							checkpoint.providerRoute!.jobId,
						),
					input.runStep,
				);
				if (
					durableBeforeResume.result.jobId !== checkpoint.providerRoute.jobId ||
					durableBeforeResume.providerLifecycleLatencyMs !==
						checkpoint.providerRoute.lifecycleBaselineMs ||
					durableBeforeResume.result.merchantExecutionEffectKey !==
						checkpoint.providerRoute.merchantExecutionEffectKey ||
					mediaRouteDurableResultDigest(
						durableBeforeResume.result,
						durableBeforeResume.providerLifecycleLatencyMs,
					) !== checkpoint.providerRoute.resultDigest
				) {
					throw new BoundedExecutionResumeError(
						"Bounded media route resume checkpoint digest does not match the durable provider result.",
					);
				}
				const durableBounded = mediaBoundedRouteResultSchema.parse(
					(
						durableBeforeResume.result as ModelSupplyResult & {
							boundedExecution?: unknown;
						}
					).boundedExecution,
				);
				if (typeof activeSnapshot.maxIterations !== "number") {
					throw new BoundedExecutionResumeError(
						"Bounded media route resume requires a numeric iteration limit.",
					);
				}
				const durableAuthorization: MediaBoundedExecutionAuthorization = {
					schemaVersion: "media-bounded-execution/v1",
					snapshot: resumeWithRaisedServerLimit(durableBounded.snapshot, {
						limit: "maxIterations",
						value: activeSnapshot.maxIterations,
					}),
					countedAttemptIds: durableBounded.consumedAttemptIds,
					countedProviderCostIds:
						durableBounded.consumedProviderCostIds,
				};
				const resumed = await this.runEffect(
					`resume:${checkpoint.providerRoute.jobId}`,
					() =>
						this.models.resumeBoundedMediaJob!({
							workspaceId: input.request.workspaceId,
							jobId: checkpoint.providerRoute!.jobId,
							authorization: durableAuthorization,
						}),
					input.runStep,
				);
				result = resumed.result;
				if (result.status === "unknown" && this.models.getDurableMediaJob) {
					if (input.awaitSignal) {
						const waitStartedAt = performance.now();
						await input.awaitSignal(
							harnessMediaJobTopic(checkpoint.providerRoute.jobId),
							{ timeoutSeconds: MEDIA_JOB_WAIT_TIMEOUT_SECONDS },
						);
						durableWaitMs += Math.max(0, performance.now() - waitStartedAt);
					}
					const durable = await this.runEffect(
						`reconcile:${checkpoint.providerRoute.jobId}`,
						() =>
							this.models.getDurableMediaJob!(
								input.request.workspaceId,
								checkpoint.providerRoute!.jobId,
							),
						input.runStep,
					);
					result = withObservedProviderLifecycle(durable);
				}
				if (checkpoint.providerRoute.merchantExecutionEffectKey) {
					result = {
						...result,
						merchantExecutionEffectKey:
							checkpoint.providerRoute.merchantExecutionEffectKey,
					};
				}
			} else {
				result = await this.submitAndAwait(
					mediaBoundedSubmission(
						input.workflowId,
						input.request,
						input.brief,
						role === "primary" ? "primary" : "retry",
						exactTextFailure,
						this.imageProfile,
						input.orchestrationWorkflowId,
						input.context.bundle.revision,
						authorization,
					),
					input.request,
					Boolean(input.request.executionAssembly),
					undefined,
					input.awaitSignal,
					input.runStep,
					(waitedMs) => {
						durableWaitMs += waitedMs;
					},
				);
			}
			const routeActiveMs = Math.max(
				0,
				Math.ceil(performance.now() - startedAt - durableWaitMs),
			);
			const routeSuspension = mediaRouteBoundedSuspension(
				activeSnapshot,
				checkpoint,
				result,
				Math.max(0, routeActiveMs - observedActiveMs),
			);
			if (routeSuspension) {
				observedActiveMs = routeActiveMs;
				checkpoint = routeSuspension.currentBest;
				activeSnapshot = routeSuspension.snapshot;
				return { suspension: routeSuspension };
			}
			const durableCompleted = requireCompletedMediaResult(
				result,
				input.brief.kind,
			);
			const completed: ModelSupplyResult & {
				merchantExecutionEffectKey?: string;
			} = result.merchantExecutionEffectKey
				? {
						...durableCompleted,
						merchantExecutionEffectKey:
							result.merchantExecutionEffectKey,
					}
				: durableCompleted;
			const activeMs = Math.max(
				0,
				Math.ceil(performance.now() - startedAt - durableWaitMs),
			);
			const observed = observeBoundedMediaReceipts(
				activeSnapshot,
				checkpoint,
				completed,
				Math.max(0, activeMs - observedActiveMs),
				checkpoint.providerRoute?.lifecycleBaselineMs ?? 0,
			);
			observedActiveMs = activeMs;
			const {
				exactTextFailure: _discardedExactTextFailure,
				providerRoute: _discardedProviderRoute,
				...checkpointWithoutFailure
			} = checkpoint;
			checkpoint = mediaBoundedCurrentBestSchema.parse({
				...checkpointWithoutFailure,
				phase: "ready",
				attempts: [
					...checkpoint.attempts,
					{
						role,
						jobId: completed.jobId,
						status: "completed",
						...(completed.merchantExecutionEffectKey
							? {
									merchantExecutionEffectKey:
										completed.merchantExecutionEffectKey,
									resultDigest:
										mediaRouteDurableResultDigest(completed),
								}
							: {}),
					},
				],
				asset: {
					id: completed.asset!.id,
					sha256: completed.asset!.sha256,
				},
				countedAttemptIds: observed.countedAttemptIds,
				countedProviderCostIds: observed.countedProviderCostIds,
				attemptReceiptDigests: observed.attemptReceiptDigests,
				providerCostReceiptDigests: observed.providerCostReceiptDigests,
			});
			const decision = evaluateBoundedExecution(activeSnapshot, {
				consumption: observed.consumption,
				currentBest: checkpoint,
				unmetExplanation: "媒体生成已达到本轮上限",
			});
			activeSnapshot = decision.snapshot;
			return { completed, decision };
		};
		const checkpointActiveWall = () => {
			const activeMs = Math.max(
				0,
				Math.ceil(performance.now() - startedAt - durableWaitMs),
			);
			const decision = evaluateBoundedExecution(activeSnapshot, {
				consumption: {
					wallClockMs:
						activeSnapshot.consumption.wallClockMs +
						Math.max(0, activeMs - observedActiveMs),
				},
				currentBest: checkpoint,
				unmetExplanation: "媒体生成已达到本轮上限",
			});
			observedActiveMs = activeMs;
			activeSnapshot = decision.snapshot;
			return decision;
		};
		const accountExactTextResult = (result: ModelSupplyResult | undefined) => {
			if (!result) return undefined;
			const activeMs = Math.max(
				0,
				Math.ceil(performance.now() - startedAt - durableWaitMs),
			);
			const observed = observeBoundedMediaReceipts(
				activeSnapshot,
				checkpoint,
				result,
				Math.max(0, activeMs - observedActiveMs),
			);
			observedActiveMs = activeMs;
			checkpoint = mediaBoundedCurrentBestSchema.parse({
				...checkpoint,
				countedAttemptIds: observed.countedAttemptIds,
				countedProviderCostIds: observed.countedProviderCostIds,
				attemptReceiptDigests: observed.attemptReceiptDigests,
				providerCostReceiptDigests: observed.providerCostReceiptDigests,
			});
			const decision = evaluateBoundedExecution(activeSnapshot, {
				consumption: observed.consumption,
				currentBest: checkpoint,
				unmetExplanation: "媒体文字核验已达到本轮上限",
			});
			activeSnapshot = decision.snapshot;
			return decision;
		};
		const pinExactTextRoute = async () => {
			if (checkpoint.exactTextRoute) {
				return structuredClone(checkpoint.exactTextRoute.snapshot);
			}
			if (!this.models.freezeAutoTextRouteForExecution) {
				throw new Error(
					"Bounded exact-text verification requires an independent frozen text.respond route.",
				);
			}
			const frozenRoute = await this.runEffect(
				`freeze-exact-text-route:${input.workflowId}`,
				() =>
					this.models.freezeAutoTextRouteForExecution!({
						workspaceId: input.request.workspaceId,
						dataClass: [
							...(input.request.frozenRouteSnapshot?.dataClass ?? []),
						],
					}),
				input.runStep,
			);
			checkpoint = mediaBoundedCurrentBestSchema.parse({
				...checkpoint,
				exactTextRoute: {
					snapshot: structuredClone(frozenRoute),
					digest: mediaBoundedRequestFingerprint(frozenRoute),
				},
			});
			return structuredClone(checkpoint.exactTextRoute!.snapshot);
		};
		const preauthorizeExactText = async (assetId: string) => {
			const wallDecision = checkpointActiveWall();
			if (wallDecision.state === "suspended") {
				return wallDecision;
			}
			const route = await pinExactTextRoute();
			if (!this.exactText?.preauthorize) {
				throw new Error(
					"Bounded exact-text verification requires frozen-route preauthorization.",
				);
			}
			const projection = exactTextPreauthorizationSchema.parse(
				await this.exactText.preauthorize({
					assetId,
					expected: expectedExactText,
					request: input.request,
					route,
					workflowId: input.workflowId,
				}),
			);
			const maxIterations = activeSnapshot.maxIterations;
			const maxCostCents = activeSnapshot.maxCostCents;
			if (
				typeof maxIterations !== "number" ||
				typeof maxCostCents !== "number"
			) {
				throw new Error(
					"Bounded exact-text verification requires numeric iteration and cost limits.",
				);
			}
			if (
				activeSnapshot.consumption.iterations + projection.iterations >
				maxIterations
			) {
				throw new HarnessMediaExecutionError(
					"MEDIA_EXACT_TEXT_BUDGET_UNAVAILABLE",
					"Exact-text verification has insufficient remaining bounded iterations.",
					409,
				);
			}
			if (
				activeSnapshot.consumption.costCents + projection.costCents >
				maxCostCents
			) {
				throw new HarnessMediaExecutionError(
					"MEDIA_EXACT_TEXT_BUDGET_UNAVAILABLE",
					"Exact-text verification has insufficient remaining bounded cost.",
					409,
				);
			}
			return { route };
		};

		if (!primary) {
			const submitted = await submitAttempt("primary");
			if ("suspension" in submitted && submitted.suspension) {
				return submitted.suspension;
			}
			primary = submitted.completed;
			if (submitted.decision.state === "suspended") {
				if (expectedExactText.length > 0) {
					checkpoint = mediaBoundedCurrentBestSchema.parse({
						...checkpoint,
						phase: "verify_primary",
					});
				}
				return {
					...submitted.decision,
					currentBest: checkpoint,
				};
			}
		}
		if (input.brief.kind !== "image") {
			return {
				...mediaSelection(primary, input.brief.kind, [primary], []),
				boundedCurrentBest: checkpoint,
				boundedExecution: activeSnapshot,
			};
		}
		if (expectedExactText.length === 0) {
			return {
				...mediaSelection(primary, "image", [primary], []),
				boundedCurrentBest: checkpoint,
				boundedExecution: activeSnapshot,
			};
		}
		if (!primaryExactTextFailure) {
			const verificationPreflight = await preauthorizeExactText(
				primary.asset!.id,
			);
			if ("state" in verificationPreflight) return verificationPreflight;
			const verification = await this.runEffect(
				`verify:${primary.asset!.id}`,
				() =>
					this.exactText!.observe({
						assetId: primary.asset!.id,
						expected: expectedExactText,
						request: input.request,
						route: verificationPreflight.route,
						workflowId: input.workflowId,
					}),
				input.runStep,
			);
			const assessment = assessImageExactText(verification);
			if (!assessment.passed) {
				primaryExactTextFailure = assessment.reason;
				checkpoint = mediaBoundedCurrentBestSchema.parse({
					...checkpoint,
					phase: "exact_text_retry",
					exactTextFailure: assessment.reason,
				});
			}
			const verificationDecision = accountExactTextResult(
				verification.modelResult,
			);
			if (verificationDecision?.state === "suspended") {
				return {
					...verificationDecision,
					currentBest: checkpoint,
				};
			}
		}
		if (recoveredRetry) {
			const verificationPreflight = await preauthorizeExactText(
				recoveredRetry.asset!.id,
			);
			if ("state" in verificationPreflight) return verificationPreflight;
			const verification = await this.runEffect(
				`verify:${recoveredRetry.asset!.id}`,
				() =>
					this.exactText!.observe({
						assetId: recoveredRetry!.asset!.id,
						expected: expectedExactText,
						request: input.request,
						route: verificationPreflight.route,
						workflowId: input.workflowId,
					}),
				input.runStep,
			);
			const retryAssessment = assessImageExactText(verification);
			if (!retryAssessment.passed) {
				checkpoint = mediaBoundedCurrentBestSchema.parse({
					...checkpoint,
					phase: "exact_text_failed",
					exactTextFailure: retryAssessment.reason,
				});
				const verificationDecision = accountExactTextResult(
					verification.modelResult,
				);
				if (verificationDecision?.state === "suspended") {
					return {
						...verificationDecision,
						currentBest: checkpoint,
					};
				}
				throw new HarnessSelectionError(
					["image_exact_text"],
					merchantExactTextMismatch(retryAssessment),
				);
			}
			const verificationDecision = accountExactTextResult(
				verification.modelResult,
			);
			if (verificationDecision?.state === "suspended") {
				return {
					...verificationDecision,
					currentBest: checkpoint,
				};
			}
			const finalWall = checkpointActiveWall();
			if (finalWall.state === "suspended") {
				return finalWall;
			}
			return {
				...mediaSelection(
					recoveredRetry,
					"image",
					[primary, recoveredRetry],
					[
						{
							candidateId: primary.asset!.id,
							gateIds: ["image_exact_text"],
						},
					],
				),
				boundedCurrentBest: checkpoint,
				boundedExecution: activeSnapshot,
			};
		}
		if (!primaryExactTextFailure) {
			const finalWall = checkpointActiveWall();
			if (finalWall.state === "suspended") {
				return finalWall;
			}
			return {
				...mediaSelection(primary, "image", [primary], []),
				boundedCurrentBest: checkpoint,
				boundedExecution: activeSnapshot,
			};
		}
		checkpoint = mediaBoundedCurrentBestSchema.parse({
			...checkpoint,
			phase: "exact_text_retry",
			exactTextFailure: primaryExactTextFailure,
		});
		const retryAdmission = checkpointActiveWall();
		if (retryAdmission.state === "suspended") {
			return retryAdmission;
		}
		const retry = await submitAttempt(
			"exact_text_retry",
			primaryExactTextFailure,
		);
		if ("suspension" in retry && retry.suspension) {
			return retry.suspension;
		}
		if (retry.decision.state === "suspended") {
			checkpoint = mediaBoundedCurrentBestSchema.parse({
				...checkpoint,
				phase: "verify_retry",
				exactTextFailure: primaryExactTextFailure,
			});
			return {
				...retry.decision,
				currentBest: checkpoint,
			};
		}
		const verificationPreflight = await preauthorizeExactText(
			retry.completed.asset!.id,
		);
		if ("state" in verificationPreflight) return verificationPreflight;
		const verification = await this.runEffect(
			`verify:${retry.completed.asset!.id}`,
			() =>
				this.exactText!.observe({
					assetId: retry.completed.asset!.id,
					expected: expectedExactText,
					request: input.request,
					route: verificationPreflight.route,
					workflowId: input.workflowId,
				}),
			input.runStep,
		);
		const retryAssessment = assessImageExactText(verification);
		if (!retryAssessment.passed) {
			checkpoint = mediaBoundedCurrentBestSchema.parse({
				...checkpoint,
				phase: "exact_text_failed",
				exactTextFailure: retryAssessment.reason,
			});
			const verificationDecision = accountExactTextResult(
				verification.modelResult,
			);
			if (verificationDecision?.state === "suspended") {
				return {
					...verificationDecision,
					currentBest: checkpoint,
				};
			}
			throw new HarnessSelectionError(
				["image_exact_text"],
				merchantExactTextMismatch(retryAssessment),
			);
		}
		const verificationDecision = accountExactTextResult(
			verification.modelResult,
		);
		if (verificationDecision?.state === "suspended") {
			return {
				...verificationDecision,
				currentBest: checkpoint,
			};
		}
		const finalWall = checkpointActiveWall();
		if (finalWall.state === "suspended") {
			return finalWall;
		}
		return {
			...mediaSelection(
				retry.completed,
				"image",
				[primary, retry.completed],
				[
					{
						candidateId: primary.asset!.id,
						gateIds: ["image_exact_text"],
					},
				],
			),
			boundedCurrentBest: checkpoint,
			boundedExecution: activeSnapshot,
		};
	}

	private assertExecutionPolicy(input: {
		brief: MediaBrief;
		context: HarnessContextSnapshot;
		request: HarnessWorkflowInput;
		workflowId: string;
	}) {
		authorizeHarnessAction({
			actionId: HARNESS_ACTION_CARRIERS.mediaQueueSubmit,
			caller: "server",
		});
		const snapshot = requireSnapshot(input.request);
		assertBriefMatchesSnapshot(input.brief, snapshot);
		const expressionIdentityRef = isOfficialNeutralIdentity(snapshot.identity)
			? undefined
			: `marketing_identity:${snapshot.identity.id}:${snapshot.identity.revision}`;
		const preflight = validateHarnessPolicy({
			phase: "execution",
			bundle: {
				workspaceId: input.context.bundle.workspaceId,
				revision: input.context.bundle.revision,
			},
			brief: structuredClone(input.brief),
			candidate: {
				assetRefs: [...input.brief.referenceAssetIds],
				candidateId: `${input.workflowId}:media-policy-preflight`,
				factClaims: [],
				intendedUse: "public_content",
				...(expressionIdentityRef ? { expressionIdentityRef } : {}),
				workspaceId: input.request.workspaceId,
			},
			...input.context.policyReferences,
		});
		if (!preflight.passed) {
			throw new HarnessSelectionError(
				[...new Set(preflight.failures.map(({ gateId }) => gateId))],
				preflight.failures[0]?.reason,
				[],
				[
					...new Set(
						preflight.failures.flatMap(
							({ alternativePath }) => alternativePath,
						),
					),
				],
			);
		}
	}

	private async submitAndAwait(
		submission: ModelSupplySubmission,
		request: HarnessWorkflowInput,
		executionAssemblyRequired: boolean,
		noteAdmissionInput?: {
			taskId: string;
			workflowId: string;
			workspaceId: string;
		},
		awaitSignal?: HarnessSignalReceiver,
		runStep?: HarnessEffectRunner,
		onDurableWait?: (waitedMs: number) => void,
	) {
		const admissionToken = noteAdmissionInput
			? await this.runEffect(
					`admission-claim:${submission.idempotencyKey}`,
					() => this.acquireNoteAdmission(noteAdmissionInput, runStep),
					runStep,
				)
			: undefined;
		const admittedJobId = admissionToken?.jobId;
		let result =
			admittedJobId && this.models.getDurableMediaJob
				? await this.runEffect(
						`admission-reconcile:${admittedJobId}`,
						async () => {
							try {
								const durable = await this.models.getDurableMediaJob!(
									submission.workspaceId,
									admittedJobId,
								);
								return withObservedProviderLifecycle(durable);
							} catch (error) {
								if (
									!(error instanceof JobRuntimeError) ||
									error.code !== "NOT_FOUND"
								) {
									throw error;
								}
								if (executionAssemblyRequired) {
									assertHarnessExecutionAssemblyPinned(request);
								}
								return this.models.submit(submission);
							}
						},
						runStep,
					)
				: await this.runEffect(
						`submit:${submission.idempotencyKey}`,
						() => {
							if (executionAssemblyRequired) {
								assertHarnessExecutionAssemblyPinned(request);
							}
							return this.models.submit(submission);
						},
						runStep,
					);
		if (admissionToken) {
			const running = await this.runEffect(
				`admission-running:${submission.idempotencyKey}`,
				() => this.noteAdmission!.markRunning(admissionToken, result.jobId),
				runStep,
			);
			if (!running) {
				throw staleNoteAdmission();
			}
		}
		if (result.status === "unknown" && this.models.getDurableMediaJob) {
			if (awaitSignal) {
				const waitStartedAt = performance.now();
				await awaitSignal(harnessMediaJobTopic(result.jobId), {
					timeoutSeconds: MEDIA_JOB_WAIT_TIMEOUT_SECONDS,
				});
				onDurableWait?.(Math.max(0, performance.now() - waitStartedAt));
			}
			const jobId = result.jobId;
			result = await this.runEffect(
				`reconcile:${jobId}`,
				async () => {
					const durable = await this.models.getDurableMediaJob!(
						submission.workspaceId,
						jobId,
					);
					return withObservedProviderLifecycle(durable);
				},
				runStep,
			);
		}
		if (
			admissionToken &&
			(result.status === "completed" || result.status === "failed")
		) {
			const terminalStatus = result.status;
			const terminal = await this.runEffect(
				`admission-terminal:${submission.idempotencyKey}:${terminalStatus}`,
				() => this.noteAdmission!.markTerminal(admissionToken, terminalStatus),
				runStep,
			);
			if (!terminal) {
				throw staleNoteAdmission();
			}
		}
		if (
			executionAssemblyRequired &&
			submission.billingTaskId &&
			(result.merchantExecutionTaskId !== submission.billingTaskId ||
				!result.merchantExecutionEffectKey)
		) {
			throw new HarnessMediaExecutionError(
				"MEDIA_SNAPSHOT_MISMATCH",
				"Durable media result is missing its server-owned merchant execution authority.",
				409,
				result.jobId,
			);
		}
		return result;
	}

	private runEffect<Output>(
		effectIdempotencyKey: string,
		operation: () => Promise<Output>,
		runStep?: HarnessEffectRunner,
	) {
		return runStep ? runStep(effectIdempotencyKey, operation) : operation();
	}

	private async acquireNoteAdmission(
		input: {
			taskId: string;
			workflowId: string;
			workspaceId: string;
		},
		runStep?: HarnessEffectRunner,
	): Promise<NoteMediaAdmissionToken> {
		if (!this.noteAdmission) {
			throw new HarnessMediaExecutionError(
				"MEDIA_RECONCILIATION_PENDING",
				"图文笔记配图准入状态暂不可用，请稍后重试。",
				202,
			);
		}
		const claim = await this.noteAdmission.claim(input);
		if (claim) return claim;
		if (!runStep) {
			// A non-DBOS caller cannot durably own a 300-second polling loop;
			// preserve the rapid reconciliation response when the claim is busy.
			throw new HarnessMediaExecutionError(
				"MEDIA_RECONCILIATION_PENDING",
				"图文笔记上一页仍在生成，请稍后继续。",
				202,
			);
		}
		const attempts = Math.ceil(
			(NOTE_ADMISSION_WAIT_TIMEOUT_SECONDS * 1000) /
				NOTE_ADMISSION_POLL_INTERVAL_MS,
		);
		for (let attempt = 0; attempt < attempts; attempt += 1) {
			await new Promise<void>((resolve) =>
				setTimeout(resolve, NOTE_ADMISSION_POLL_INTERVAL_MS),
			);
			const retried = await this.noteAdmission.claim(input);
			if (retried) return retried;
		}
		throw new HarnessMediaExecutionError(
			"MEDIA_RECONCILIATION_PENDING",
			"图文笔记上一页仍在生成，请稍后继续。",
			202,
		);
	}
}

function staleNoteAdmission() {
	return new HarnessMediaExecutionError(
		"MEDIA_SNAPSHOT_MISMATCH",
		"图文笔记配图准入已被更新，请按当前任务状态继续。",
		409,
	);
}

function requireCompletedMediaResult(
	result: ModelSupplyResult,
	kind: MediaBrief["kind"],
) {
	if (result.status === "failed") {
		const timedOut = /(?:time.?out|timed.?out)/iu.test(
			result.failureCode ?? "",
		);
		throw new HarnessMediaExecutionError(
			"MEDIA_GENERATION_FAILED",
			result.failureCode ??
				"Media generation failed before a usable asset was recorded.",
			502,
			result.jobId,
			result.attempt.acceptance,
			kind === "video"
				? merchantVideoGenerationFailure(timedOut ? "timed_out" : "failed")
				: merchantImageGenerationFailure(timedOut ? "timed_out" : "failed"),
		);
	}
	if (result.status !== "completed" || !result.asset) {
		throw new HarnessMediaExecutionError(
			"MEDIA_RECONCILIATION_PENDING",
			"Media provider acceptance is recorded; recovery must query the same job before any retry.",
			202,
			result.jobId,
			result.attempt.acceptance,
		);
	}
	assertAssetKind(kind, result.asset.contentType);
	return result;
}

export class HarnessMediaExecutionError extends Error {
	constructor(
		readonly code:
			| "MEDIA_BRIEF_KIND_MISMATCH"
			| "MEDIA_EXACT_TEXT_BUDGET_UNAVAILABLE"
			| "MEDIA_EXACT_TEXT_VERIFICATION_FAILED"
			| "MEDIA_EXACT_TEXT_VERIFIER_UNAVAILABLE"
			| "MEDIA_GENERATION_FAILED"
			| "MEDIA_RECONCILIATION_PENDING"
			| "MEDIA_SELECTION_MISSING"
			| "MEDIA_SNAPSHOT_MISMATCH"
			| "VIRAL_ADAPT_RECIPE_MISMATCH"
			| "VIRAL_ADAPT_SOURCE_MISMATCH"
			| "VIRAL_IMAGE_VISION_FAILED"
			| "VIRAL_IMAGE_VISION_UNAVAILABLE",
		message: string,
		readonly status: 202 | 409 | 502,
		readonly jobId?: string,
		readonly acceptance?: string,
		readonly merchantMessage?: string,
	) {
		super(message);
		this.name = "HarnessMediaExecutionError";
	}
}

function requireSnapshot(request: HarnessWorkflowInput) {
	const snapshot = request.executionSnapshot;
	if (!snapshot) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SELECTION_MISSING",
			"Media Harness execution requires a frozen Composer snapshot.",
			409,
		);
	}
	return snapshot;
}

function requireNotePageBound(request: HarnessWorkflowInput) {
	const snapshot = requireSnapshot(request);
	const deliverable = snapshot.deliverables[0];
	if (
		snapshot.lens !== "image_text_note" ||
		!deliverable ||
		!Number.isSafeInteger(deliverable.notePageBound)
	) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SNAPSHOT_MISMATCH",
			"图文笔记配方缺少有效的页数上界，请重新选择配方后再试。",
			409,
		);
	}
	return deliverable.notePageBound as number;
}

function mediaKind(request: HarnessWorkflowInput): MediaBrief["kind"] {
	const lens = requireSnapshot(request).lens;
	if (lens === "image" || lens === "video") return lens;
	throw new HarnessMediaExecutionError(
		"MEDIA_SELECTION_MISSING",
		"A media Harness request must declare image or video execution.",
		409,
	);
}

function nextMediaEffectCheckpoint(
	input: unknown,
	requestFingerprint: string,
	executionRootFingerprint: string,
	kind: MediaBrief["kind"],
) {
	const previous = mediaBoundedCurrentBestSchema.parse(input);
	if (
		previous.kind !== kind ||
		previous.executionRootFingerprint !== executionRootFingerprint
	) {
		throw new Error(
			"Bounded media checkpoint execution root cannot change across a context fence.",
		);
	}
	return mediaBoundedCurrentBestSchema.parse({
		schemaVersion: "harness-media-current-best/v1",
		requestFingerprint,
		executionRootFingerprint,
		kind,
		phase: "next_effect",
		attempts: [],
		countedAttemptIds: previous.countedAttemptIds,
		countedProviderCostIds: previous.countedProviderCostIds,
		attemptReceiptDigests: previous.attemptReceiptDigests,
		providerCostReceiptDigests: previous.providerCostReceiptDigests,
	});
}

function mediaRouteBoundedSuspension(
	activeSnapshot: NonNullable<HarnessWorkflowInput["boundedExecution"]>,
	checkpoint: MediaBoundedCurrentBest,
	result: ModelSupplyResult & { merchantExecutionEffectKey?: string },
	activeWallClockMs = 0,
): BoundedExecutionSuspension<MediaBoundedCurrentBest> | undefined {
	const raw = (
		result as ModelSupplyResult & {
			boundedExecution?: unknown;
		}
	).boundedExecution;
	if (raw === undefined) return undefined;
	if (
		result.status !== "failed" ||
		result.failureCode !== "MEDIA_BOUNDED_ITERATION_EXCEEDED"
	) {
		throw new Error(
			"A bounded media route suspension requires the canonical iteration failure.",
		);
	}
	const bounded = mediaBoundedRouteResultSchema.parse(raw);
	if (
		bounded.snapshot.stopReason !== "limit_reached" ||
		bounded.snapshot.triggeredLimit !== bounded.triggeredLimit ||
		JSON.stringify(bounded.snapshot.consumption) !==
			JSON.stringify(bounded.consumption) ||
		bounded.snapshot.maxIterations !== activeSnapshot.maxIterations ||
		bounded.snapshot.maxCostCents !== activeSnapshot.maxCostCents ||
		bounded.snapshot.maxWallClockMs !== activeSnapshot.maxWallClockMs ||
		bounded.snapshot.maxDelegations !== activeSnapshot.maxDelegations ||
		JSON.stringify(bounded.snapshot.requiredLimits) !==
			JSON.stringify(activeSnapshot.requiredLimits)
	) {
		throw new Error(
			"The durable media route suspension does not match its bounded authorization.",
		);
	}
	const attemptsById = uniqueReceiptMap(result.attempts, "provider attempt");
	const consumedAttemptIds = new Set(bounded.consumedAttemptIds);
	if (
		consumedAttemptIds.size !== bounded.consumedAttemptIds.length ||
		bounded.consumedAttemptIds.some((id) => !attemptsById.has(id))
	) {
		throw new Error(
			"The durable media route suspension has invalid consumed attempts.",
		);
	}
	const newAttemptIds = bounded.consumedAttemptIds.filter(
		(id) => !checkpoint.countedAttemptIds.includes(id),
	);
	if (
		bounded.consumption.iterations !==
		activeSnapshot.consumption.iterations + newAttemptIds.length
	) {
		throw new Error(
			"The durable media route suspension iteration consumption is inconsistent.",
		);
	}
	const costsById = uniqueReceiptMap(result.providerCosts, "provider cost");
	const consumedProviderCostIds = new Set(bounded.consumedProviderCostIds);
	if (
		consumedProviderCostIds.size !== bounded.consumedProviderCostIds.length ||
		bounded.consumedProviderCostIds.some((id) => !costsById.has(id))
	) {
		throw new Error(
			"The durable media route suspension has invalid consumed costs.",
		);
	}
	let addedCostCents = 0;
	for (const id of bounded.consumedProviderCostIds) {
		if (checkpoint.countedProviderCostIds.includes(id)) continue;
		const cost = costsById.get(id)!;
		if (
			cost.status !== "observed" ||
			cost.currency !== "CNY" ||
			Object.keys(cost.usage).length === 0
		) {
			throw new Error(
				"A durable media route suspension can count only observed CNY costs.",
			);
		}
		addedCostCents += cnyAmountToCents(cost.amount);
	}
	if (
		bounded.consumption.costCents !==
		activeSnapshot.consumption.costCents + addedCostCents
	) {
		throw new Error(
			"The durable media route suspension cost consumption is inconsistent.",
		);
	}
	const attemptReceiptDigests = new Map(
		checkpoint.attemptReceiptDigests.map(({ id, digest }) => [id, digest]),
	);
	verifyAndRememberReceiptDigests(
		attemptReceiptDigests,
		bounded.consumedAttemptIds.map((id) => attemptsById.get(id)!),
	);
	const providerCostReceiptDigests = new Map(
		checkpoint.providerCostReceiptDigests.map(({ id, digest }) => [id, digest]),
	);
	verifyAndRememberReceiptDigests(
		providerCostReceiptDigests,
		bounded.consumedProviderCostIds.map((id) => costsById.get(id)!),
	);
	const lifecycleBaselineMs =
		checkpoint.providerRoute?.lifecycleBaselineMs ?? 0;
	const cumulativeLifecycleMs = observedLifecycleMilliseconds(result);
	if (cumulativeLifecycleMs < lifecycleBaselineMs) {
		throw new Error(
			"The durable media provider lifecycle cannot move behind its pinned baseline.",
		);
	}
	const currentBest = mediaBoundedCurrentBestSchema.parse({
		...checkpoint,
		phase: "provider_route_suspended",
		providerRoute: {
			jobId: result.jobId,
			resultDigest: mediaRouteDurableResultDigest(
				result,
				cumulativeLifecycleMs,
			),
			lifecycleBaselineMs: cumulativeLifecycleMs,
			...(result.merchantExecutionEffectKey
				? {
						merchantExecutionEffectKey:
							result.merchantExecutionEffectKey,
					}
				: {}),
		},
		countedAttemptIds: [
			...new Set([
				...checkpoint.countedAttemptIds,
				...bounded.consumedAttemptIds,
			]),
		],
		countedProviderCostIds: [
			...new Set([
				...checkpoint.countedProviderCostIds,
				...bounded.consumedProviderCostIds,
			]),
		],
		attemptReceiptDigests: [...attemptReceiptDigests].map(([id, digest]) => ({
			id,
			digest,
		})),
		providerCostReceiptDigests: [...providerCostReceiptDigests].map(
			([id, digest]) => ({ id, digest }),
		),
	});
	const snapshot = boundedExecutionSnapshotSchema.parse({
		...bounded.snapshot,
		consumption: {
			...bounded.consumption,
			wallClockMs:
				activeSnapshot.consumption.wallClockMs +
				Math.max(
					activeWallClockMs,
					cumulativeLifecycleMs - lifecycleBaselineMs,
				),
		},
	});
	return {
		state: "suspended",
		snapshot,
		currentBest,
		unmetExplanation: "媒体生成需要更多执行次数",
		resumable: true,
	};
}

function observeBoundedMediaReceipts(
	snapshot: NonNullable<HarnessWorkflowInput["boundedExecution"]>,
	checkpoint: MediaBoundedCurrentBest,
	result: ModelSupplyResult,
	activeWallClockMs: number,
	lifecycleBaselineMs = 0,
) {
	const countedAttemptIds = new Set(checkpoint.countedAttemptIds);
	const attemptsById = uniqueReceiptMap(
		[result.attempt, ...result.attempts],
		"provider attempt",
	);
	const attemptReceiptDigests = new Map(
		checkpoint.attemptReceiptDigests.map((receipt) => [
			receipt.id,
			receipt.digest,
		]),
	);
	verifyAndRememberReceiptDigests(attemptReceiptDigests, attemptsById.values());
	const newAttemptIds = [...attemptsById.keys()].filter(
		(id) => !countedAttemptIds.has(id),
	);
	const cumulativeLifecycleMs = observedLifecycleMilliseconds(result);
	if (cumulativeLifecycleMs < lifecycleBaselineMs) {
		throw new Error(
			"The durable media provider lifecycle cannot move behind its pinned baseline.",
		);
	}
	const countedProviderCostIds = new Set(checkpoint.countedProviderCostIds);
	const costsById = uniqueReceiptMap(
		[result.providerCost, ...result.providerCosts],
		"provider cost",
	);
	const providerCostReceiptDigests = new Map(
		checkpoint.providerCostReceiptDigests.map((receipt) => [
			receipt.id,
			receipt.digest,
		]),
	);
	const observedCosts = [...costsById.values()].filter(
		(cost) => cost.status === "observed",
	);
	verifyAndRememberReceiptDigests(providerCostReceiptDigests, observedCosts);
	const newCosts = observedCosts.filter(
		(cost) => !countedProviderCostIds.has(cost.id),
	);
	if (
		newAttemptIds.length > 0 &&
		(!Number.isFinite(result.latencyMs) ||
			!Number.isSafeInteger(Math.ceil(result.latencyMs!)) ||
			result.latencyMs! < 0)
	) {
		throw new Error(
			"Bounded media execution requires observed provider lifecycle latency.",
		);
	}
	const newBillableAttemptCount = newAttemptIds.filter(
		(id) => attemptsById.get(id)?.acceptance !== "rejected_before_accept",
	).length;
	if (newCosts.length < newBillableAttemptCount) {
		throw new Error(
			"Bounded media execution requires an observed provider cost receipt for every new attempt.",
		);
	}
	let addedCostCents = 0;
	for (const cost of newCosts) {
		if (
			cost.status !== "observed" ||
			cost.currency !== "CNY" ||
			!Number.isFinite(cost.amount) ||
			cost.amount < 0 ||
			Object.keys(cost.usage).length === 0
		) {
			throw new Error(
				"Bounded media execution requires observed provider cost in CNY with usage.",
			);
		}
		const cents = cnyAmountToCents(cost.amount);
		addedCostCents += cents;
		if (!Number.isSafeInteger(addedCostCents)) {
			throw new Error(
				"Bounded media accumulated provider cost exceeds the safe CNY-cent range.",
			);
		}
	}
	for (const id of newAttemptIds) countedAttemptIds.add(id);
	for (const cost of newCosts) countedProviderCostIds.add(cost.id);
	return {
		consumption: {
			iterations: snapshot.consumption.iterations + newAttemptIds.length,
			costCents: snapshot.consumption.costCents + addedCostCents,
			wallClockMs:
				snapshot.consumption.wallClockMs +
				(newAttemptIds.length > 0
					? Math.max(
							activeWallClockMs,
							cumulativeLifecycleMs - lifecycleBaselineMs,
						)
					: 0),
			delegations: snapshot.consumption.delegations,
		},
		countedAttemptIds: [...countedAttemptIds],
		countedProviderCostIds: [...countedProviderCostIds],
		attemptReceiptDigests: [...attemptReceiptDigests].map(([id, digest]) => ({
			id,
			digest,
		})),
		providerCostReceiptDigests: [...providerCostReceiptDigests].map(
			([id, digest]) => ({ id, digest }),
		),
	};
}

function observedLifecycleMilliseconds(result: ModelSupplyResult) {
	const milliseconds = Math.ceil(result.latencyMs ?? 0);
	if (
		!Number.isFinite(milliseconds) ||
		!Number.isSafeInteger(milliseconds) ||
		milliseconds < 0
	) {
		throw new Error(
			"Bounded media execution requires observed provider lifecycle latency.",
		);
	}
	return milliseconds;
}

function mediaRouteDurableResultDigest(
	result: ModelSupplyResult & { merchantExecutionEffectKey?: string },
	lifecycleBaselineMs = observedLifecycleMilliseconds(result),
) {
	const {
		endedAt: _durableTerminalTime,
		latencyMs: _providerLifecycleLatency,
		merchantExecutionEffectKey: _harnessMerchantEffectKey,
		...canonical
	} = result;
	return mediaBoundedRequestFingerprint({
		result: canonical,
		lifecycleBaselineMs,
		...(result.merchantExecutionEffectKey
			? { merchantExecutionEffectKey: result.merchantExecutionEffectKey }
			: {}),
	});
}

function cnyAmountToCents(amount: number) {
	if (!Number.isFinite(amount) || amount < 0) {
		throw new Error(
			"Bounded media provider cost exceeds the safe CNY-cent range.",
		);
	}
	const [coefficient, exponentText = "0"] = amount
		.toString()
		.toLowerCase()
		.split("e");
	const exponent = Number(exponentText);
	const [whole, fraction = ""] = coefficient!.split(".");
	const digits = BigInt(`${whole}${fraction}`);
	const decimalPlaces = fraction.length - exponent;
	const scaled =
		decimalPlaces <= 0
			? digits * 100n * 10n ** BigInt(-decimalPlaces)
			: (() => {
					const divisor = 10n ** BigInt(decimalPlaces);
					const numerator = digits * 100n;
					return (numerator + divisor - 1n) / divisor;
				})();
	if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error(
			"Bounded media provider cost exceeds the safe CNY-cent range.",
		);
	}
	return Number(scaled);
}

function verifyAndRememberReceiptDigests<Receipt extends { id: string }>(
	known: Map<string, string>,
	receipts: Iterable<Receipt>,
) {
	for (const receipt of receipts) {
		const digest = mediaBoundedRequestFingerprint(receipt);
		const previous = known.get(receipt.id);
		if (previous && previous !== digest) {
			throw new Error(
				"Bounded media receipt facts cannot change for a counted identifier.",
			);
		}
		known.set(receipt.id, digest);
	}
}

function uniqueReceiptMap<Receipt extends { id: string }>(
	receipts: Receipt[],
	label: string,
) {
	const byId = new Map<string, Receipt>();
	for (const receipt of receipts) {
		const previous = byId.get(receipt.id);
		if (previous && JSON.stringify(previous) !== JSON.stringify(receipt)) {
			throw new Error(
				`Bounded media ${label} receipt identifiers cannot conflict.`,
			);
		}
		byId.set(receipt.id, receipt);
	}
	return byId;
}

function mediaBoundedSubmission(
	workflowId: string,
	request: HarnessWorkflowInput,
	brief: MediaBrief,
	attempt: "primary" | "retry",
	exactTextFailure: string | undefined,
	imageProfile: ImageModelRecipeProfile,
	orchestrationWorkflowId: string | undefined,
	contextRevision: number,
	mediaBoundedExecution: MediaBoundedExecutionAuthorization,
): ModelSupplySubmission & {
	mediaBoundedExecution: MediaBoundedExecutionAuthorization;
} {
	return {
		...mediaSubmission(
			workflowId,
			request,
			brief,
			attempt,
			exactTextFailure,
			imageProfile,
			orchestrationWorkflowId,
			contextRevision,
		),
		mediaBoundedExecution,
	};
}

function mediaSubmission(
	workflowId: string,
	request: HarnessWorkflowInput,
	brief: MediaBrief,
	attempt: "primary" | "retry" = "primary",
	exactTextFailure?: string,
	imageProfile: ImageModelRecipeProfile = IMAGE_MODEL_RECIPE_PROFILE,
	orchestrationWorkflowId?: string,
	contextRevision = 1,
): ModelSupplySubmission {
	const snapshot = requireSnapshot(request);
	const frozenRoute = request.frozenRouteSnapshot;
	if (!frozenRoute) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SELECTION_MISSING",
			"Media Harness execution requires a frozen route snapshot.",
			409,
		);
	}
	if (snapshot.modelPolicy.mode !== "fixed") {
		throw new HarnessMediaExecutionError(
			"MEDIA_SELECTION_MISSING",
			"Media execution requires a fixed model selected by the published Recipe.",
			409,
		);
	}
	const compiledImage =
		brief.kind === "image"
			? compileImageIntentForProfile(brief.intent, imageProfile)
			: undefined;
	const aiCoverSize = snapshot.signedSubmission?.aiCover
		? mapXhsCoverSize(snapshot.signedSubmission.aiCover.aspectRatio)
		: undefined;
	return {
		actorId: request.actorId,
		billingTaskId: snapshot.task.id,
		billingQuoteRevision: snapshot.quote.revision,
		correlationId: orchestrationWorkflowId ?? workflowId,
		dataClass: [...frozenRoute.dataClass],
		idempotencyKey:
			attempt === "primary"
				? `harness-media:${workflowId}:${brief.kind}${contextRevision > 1 ? `:r${contextRevision}` : ""}`
				: `harness-media:${workflowId}:${brief.kind}${contextRevision > 1 ? `:r${contextRevision}` : ""}:exact-text-retry`,
		input:
			brief.kind === "image"
				? {
						inputAssets: compiledImage!.inputAssets,
						...(aiCoverSize
							? { width: aiCoverSize.width, height: aiCoverSize.height }
							: {}),
						ratio: brief.parameters.ratio,
						resolution: brief.parameters.resolution,
					}
				: {
						durationSeconds: brief.parameters.durationSeconds,
						ratio: brief.parameters.ratio,
						referenceAssetIds: [...brief.referenceAssetIds],
					},
		operation:
			brief.kind === "image" ? compiledImage!.operation : "video.generate",
		productUsageQuantity: 0,
		frozenRouteSnapshot: structuredClone(frozenRoute),
		...(request.boundedExecution
			? {
					mediaBoundedExecution: {
						schemaVersion: "media-bounded-execution/v1" as const,
						snapshot: structuredClone(request.boundedExecution),
						countedAttemptIds: [],
						countedProviderCostIds: [],
					},
				}
			: {}),
		prompt:
			brief.kind === "image"
				? [
						brief.prompt,
						JSON.stringify({
							imageIntent: brief.intent,
							imageModelRecipeProfile: compiledImage!.profile,
							...(exactTextFailure
								? { exactTextFailureToCorrect: exactTextFailure }
								: {}),
						}),
					].join("\n")
				: `${brief.firstFramePrompt}\n${brief.storyboard
						.map((shot) => `${shot.index}. ${shot.description}`)
						.join("\n")}`,
		selection: structuredClone(frozenRoute.requestedSelection),
		workspaceId: request.workspaceId,
	};
}

function assertBriefMatchesSnapshot(
	brief: MediaBrief,
	snapshot: NonNullable<HarnessWorkflowInput["executionSnapshot"]>,
) {
	const deliverable = snapshot.deliverables[0];
	const expectedKind =
		deliverable?.kind === "image_text_note" ? "image" : deliverable?.kind;
	if (
		!deliverable ||
		expectedKind !== brief.kind ||
		brief.parameters.ratio !== deliverable.aspectRatio
	) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SNAPSHOT_MISMATCH",
			"The media brief no longer matches the frozen Recipe delivery contract.",
			409,
		);
	}
	if (
		brief.kind === "video" &&
		brief.parameters.durationSeconds !== deliverable.durationSeconds
	) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SNAPSHOT_MISMATCH",
			"The video brief duration no longer matches the frozen Recipe delivery contract.",
			409,
		);
	}
	if (brief.kind === "image" && brief.intent.operation !== snapshot.operation) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SNAPSHOT_MISMATCH",
			"The image intent operation no longer matches the frozen merchant request.",
			409,
		);
	}
	if (brief.kind === "image") {
		const intentReferenceAssetIds = brief.intent.references.map(
			({ assetId }) => assetId,
		);
		if (
			intentReferenceAssetIds.length !== brief.referenceAssetIds.length ||
			intentReferenceAssetIds.some(
				(assetId, index) => assetId !== brief.referenceAssetIds[index],
			)
		) {
			throw new HarnessMediaExecutionError(
				"MEDIA_SNAPSHOT_MISMATCH",
				"The image intent references do not match the frozen media brief.",
				409,
			);
		}
	}
	const sourceAssetIds = new Set(
		snapshot.sources.assets.map((asset) => asset.id),
	);
	if (brief.referenceAssetIds.some((assetId) => !sourceAssetIds.has(assetId))) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SNAPSHOT_MISMATCH",
			"The media brief references an asset outside the frozen source set.",
			409,
		);
	}
}

function mediaSelection(
	result: ModelSupplyResult & { merchantExecutionEffectKey?: string },
	kind: MediaBrief["kind"],
	executions: ModelSupplyResult[],
	blockedCandidates: Array<{ candidateId: string; gateIds: string[] }>,
): HarnessMediaSelectionResult {
	const asset = result.asset;
	if (!asset) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SELECTION_MISSING",
			"A completed media generation must include an owned asset receipt.",
			502,
			result.jobId,
			result.attempt.acceptance,
		);
	}
	const ownedAsset: NonNullable<
		ContentPackage["generated"]["ownedAssets"]
	>[number] = {
		contentType: asset.contentType,
		id: asset.id,
		objectKey: asset.objectKey,
		sha256: asset.sha256,
		sizeBytes: asset.sizeBytes,
		...(asset.sourceTaskRef ? { sourceTaskRef: asset.sourceTaskRef } : {}),
		...(asset.compositionEvidence
			? { compositionEvidence: structuredClone(asset.compositionEvidence) }
			: {}),
	};
	return {
		asset: ownedAsset,
		...(result.merchantExecutionEffectKey
			? { merchantExecutionEffectKey: result.merchantExecutionEffectKey }
			: {}),
		childRun: {
			actualCatalogModelId: result.snapshot.actualCatalogModelId,
			assetIds: [asset.id],
			productUsage: {
				quantity: result.usage.quantity,
				status: result.usage.status,
			},
			providerAttempts: uniqueExecutionsProviderAttempts(executions).map(
				(attempt) => ({
					acceptance: attempt.acceptance,
					catalogModelId: attempt.catalogModelId,
					createdAt: attempt.createdAt,
					deploymentId: attempt.deploymentId,
					id: attempt.id,
					jobId: attempt.jobId,
					...(attempt.providerTaskRef
						? { providerTaskRef: attempt.providerTaskRef }
						: {}),
					status: attempt.status,
				}),
			),
			providerCost: {
				amount: result.providerCost.amount,
				currency: result.providerCost.currency,
				status: result.providerCost.status,
			},
			providerCosts: uniqueExecutionsProviderCosts(executions).map((cost) => ({
				amount: cost.amount,
				currency: cost.currency,
				id: cost.id,
				status: cost.status,
				usage: structuredClone(cost.usage),
			})),
			...(result.snapshot.providerModel
				? { providerModel: result.snapshot.providerModel }
				: {}),
			routeSnapshot: {
				actualCatalogModelId: result.snapshot.actualCatalogModelId,
				...(result.snapshot.apiCounterparty
					? { apiCounterparty: result.snapshot.apiCounterparty }
					: {}),
				catalogRevisionId: result.snapshot.catalogRevisionId,
				deploymentId: result.snapshot.deploymentId,
				...(result.snapshot.endpointRevision
					? { endpointRevision: result.snapshot.endpointRevision }
					: {}),
				id: result.snapshot.id,
				...(result.snapshot.providerModel
					? { providerModel: result.snapshot.providerModel }
					: {}),
			},
			routeSnapshotId: result.snapshot.id,
			runId: result.jobId,
			runType: "model_job",
			status: "succeeded",
		},
		kind,
		...(asset.technicalValidation?.playable === true &&
		asset.technicalValidation.evidenceKind === "measured" &&
		typeof asset.technicalValidation.durationSeconds === "number" &&
		Number.isFinite(asset.technicalValidation.durationSeconds) &&
		asset.technicalValidation.durationSeconds > 0
			? {
					measuredDurationSeconds: asset.technicalValidation.durationSeconds,
				}
			: {}),
		trace: {
			blockedCandidates,
			candidateScores: [],
			rubricHash: createHash("sha256")
				.update(
					JSON.stringify({
						asset: asset.sha256,
						jobId: result.jobId,
						route: result.snapshot.id,
					}),
				)
				.digest("hex"),
			rubricVersion: "media-provider-receipt-v1",
			stage: "execution_selection",
			winnerCandidateId: asset.id,
		},
	};
}

function assertAssetKind(kind: MediaBrief["kind"], contentType: string) {
	const matches =
		(kind === "image" && contentType.startsWith("image/")) ||
		(kind === "video" && contentType === "video/mp4");
	if (matches) return;
	throw new HarnessMediaExecutionError(
		"MEDIA_GENERATION_FAILED",
		"The provider result did not contain the requested media type.",
		502,
	);
}

function uniqueProviderAttempts(result: ModelSupplyResult) {
	return [
		...new Map(
			[result.attempt, ...result.attempts].map((attempt) => [
				attempt.id,
				attempt,
			]),
		).values(),
	];
}

function uniqueProviderCosts(result: ModelSupplyResult) {
	return [
		...new Map(
			[result.providerCost, ...result.providerCosts].map((cost) => [
				cost.id,
				cost,
			]),
		).values(),
	];
}

function uniqueExecutionsProviderAttempts(results: ModelSupplyResult[]) {
	return [
		...new Map(
			results
				.flatMap(uniqueProviderAttempts)
				.map((attempt) => [attempt.id, attempt]),
		).values(),
	];
}

function uniqueExecutionsProviderCosts(results: ModelSupplyResult[]) {
	return [
		...new Map(
			results.flatMap(uniqueProviderCosts).map((cost) => [cost.id, cost]),
		).values(),
	];
}

function jsonObject(value: string) {
	const start = value.indexOf("{");
	const end = value.lastIndexOf("}");
	if (start < 0 || end < start) {
		throw new HarnessMediaExecutionError(
			"MEDIA_EXACT_TEXT_VERIFICATION_FAILED",
			"Image text verification returned an invalid observation.",
			502,
		);
	}
	return value.slice(start, end + 1);
}
