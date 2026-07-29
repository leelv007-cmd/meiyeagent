import { createHash } from "node:crypto";

import type {
	ContentPackage,
	ContentPackageRevisionDelivery,
	ImageModelRecipeProfile,
	NotePlan,
} from "@meiye/contracts";
import { questionCardSchema } from "@meiye/contracts";
import { z } from "zod";

import type {
	ModelSupplyResult,
	ModelSupplySubmission,
} from "../model-supply/index.js";
import { isOfficialNeutralIdentity } from "../execution-spine/creation-execution-snapshot.js";
import type { ContentPackageRevisionWritePort } from "../execution-spine/content-package-revision-port.js";
import {
	compileExecutionBrief,
	InMemoryStructuredNodeMetrics,
	type ExecutionBrief,
} from "./structured-nodes.js";
import {
	type HarnessStructuredNodeRunnerFactory,
	validateHarnessVisibleDelivery,
} from "./production-stage-ports.js";
import { validateHarnessPolicy } from "./policy-gates.js";
import { authorizeHarnessAction } from "./action-registry.js";
import { HARNESS_ACTION_CARRIERS } from "./action-carriers.js";
import {
  harnessMediaJobTopic,
  type HarnessContextSnapshot,
  type HarnessEffectRunner,
  type HarnessMediaSelectionResult,
  type HarnessMediaStagePorts,
  type HarnessNoteBrief,
  type HarnessNoteSelectionResult,
  type HarnessNoteStagePorts,
  type HarnessSignalReceiver,
  type HarnessStagePorts,
} from "./workflow-core.js";
import type { HarnessWorkflowInput } from "./task-admission.js";
import {
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
	merchantExactTextMismatch,
	merchantExactTextVerificationUnavailable,
	merchantImageGenerationFailure,
	merchantNoteConfirmationCard,
	merchantNotePartialPageMarker,
	merchantNoteSelectionReason,
	merchantVideoGenerationFailure,
} from "./merchant-delivery-language.js";
import {
	assertImageRevisionAssemblyComplete,
	assertImageTextNoteRevisionAssemblyComplete,
	assertVideoRevisionAssemblyComplete,
	buildImagePlatformVariants,
	buildImageTextNotePlatformVariants,
	buildVideoPlatformVariants,
} from "./output-compiler.js";
import {
	type NotePlanEnhancementJudgeState,
	NotePlanCompiler,
	type NotePlanSettingsSource,
} from "./note-plan-compiler.js";
import type {
	NoteMediaAdmissionPort,
	NoteMediaAdmissionToken,
} from "./note-media-admission.js";
import {
	configuredNotePlanEnhancementJudgeResolver,
	type NotePlanEnhancementJudgeResolver,
	ModelSupplyNotePlanStructuredPort,
} from "./note-plan-structured-port.js";

type MediaBrief = Exclude<ExecutionBrief, { kind: "copy" }>;

const MEDIA_JOB_WAIT_TIMEOUT_SECONDS = 150;
const NOTE_ADMISSION_WAIT_TIMEOUT_SECONDS = 300;
const NOTE_ADMISSION_POLL_INTERVAL_MS = 250;

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
		private readonly noteEnhancementJudge: NotePlanEnhancementJudgeResolver =
			configuredNotePlanEnhancementJudgeResolver,
	) {}

	resolveStageSkills(
		input: Parameters<
			NonNullable<HarnessStagePorts["resolveStageSkills"]>
		>[0],
	) {
		if (!this.copy.resolveStageSkills) {
			throw new Error(
				"Unified Harness requires the configured Skill resolver.",
			);
		}
		return this.copy.resolveStageSkills(input);
	}

	async nameIntent(input: Parameters<HarnessStagePorts["nameIntent"]>[0]) {
		const result = await this.copy.nameIntent(input);
		if (
			input.request.executionSnapshot?.lens !== "image_text_note" ||
			input.request.decisionReferences?.some(
				({ field }) => field === "note_plan_confirmation",
			)
		) {
			return result;
		}
		const language = merchantNoteConfirmationCard();
		return {
			...result,
			blockingQuestion: questionCardSchema.parse({
				questionId: `${input.workflowId}:note-confirmation`,
				workflowId: input.workflowId,
				workflowRevision: input.request.workflowRevision,
				question: language.question,
				options: language.options,
				freeText: language.freeText,
				response: language.response,
				unattended: "continue",
				scope: "current_task",
			}),
		};
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
			this.runners.create({
				actorId: input.request.actorId,
				billingQuoteRevision: requireSnapshot(input.request).quote.revision,
				billingTaskId: requireSnapshot(input.request).task.id,
				workspaceId: input.request.workspaceId,
			}),
			metrics,
		);
		if (brief.kind !== kind) {
			throw new HarnessMediaExecutionError(
				"MEDIA_BRIEF_KIND_MISMATCH",
				"The compiled media brief does not match the frozen deliverable.",
				409,
			);
		}
		assertBriefMatchesSnapshot(brief, requireSnapshot(input.request));
		return { brief, metrics: metrics.snapshot() };
	}

	executeMediaAndSelect(
		input: Parameters<HarnessMediaStagePorts["executeMediaAndSelect"]>[0],
	) {
		return this.media.execute({
			...input,
			orchestrationWorkflowId: input.workflowId,
		});
	}

	async assembleMediaAndDeliver(
		input: Parameters<HarnessMediaStagePorts["assembleMediaAndDeliver"]>[0],
	): Promise<ContentPackageRevisionDelivery> {
		const now = this.now();
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
			const claimExtraction = assertMediaVisibleDelivery(input, version, now);
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
			assertImageRevisionAssemblyComplete(revision);
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
		const claimExtraction = assertMediaVisibleDelivery(input, version, now);
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
		assertVideoRevisionAssemblyComplete(revision);
		return this.contentPackages.write(revision);
	}

	async compileNoteBrief(
		input: Parameters<HarnessNoteStagePorts["compileNoteBrief"]>[0],
	): Promise<HarnessNoteBrief> {
		const settings = await this.requireNoteSettings().read();
		const notePageBound = requireNotePageBound(input.request);
		const compiler = this.noteCompiler(input);
		return {
			kind: "image_text_note",
			candidates: await compiler.compileDrafts({
				intent: input.declaration.normalizedIntent,
				factRefs: [...(input.allowedFactRefs ?? [])],
				rightsRefs: input.context.policyReferences.rightsRefs.map(
					({ assetId }) => assetId,
				),
				styles: settings.styles,
				notePageBound,
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
		const claimExtraction = assertNoteVisibleDelivery(input, winner, now);
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
			...(input.selection.partial
				? { partial: input.selection.partial }
				: {}),
		});
		return this.contentPackages.write(revision);
	}

	private requireNoteSettings() {
		if (!this.noteSettings) {
			throw new Error("Image-text note settings are unavailable.");
		}
		return this.noteSettings;
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
	) {
		const snapshot = requireSnapshot(input.request);
		const runner = this.runners.create({
			actorId: input.request.actorId,
			billingQuoteRevision: snapshot.quote.revision,
			billingTaskId: snapshot.task.id,
			workspaceId: input.request.workspaceId,
		});
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
						}
					: undefined,
			),
			{
				generate: async ({ page, reason, evaluationReason }) => {
					const result = await this.media.execute({
						brief: notePageImageBrief(page, snapshot, evaluationReason),
						context: input.context,
						request: input.request,
						workflowId:
							`${input.workflowId}:note:${page.id}:${reason}:r${page.revision}`,
						orchestrationWorkflowId: input.workflowId,
						...(input.awaitSignal
							? { awaitSignal: input.awaitSignal }
							: {}),
						...(input.runStep ? { runStep: input.runStep } : {}),
					});
					return {
						asset: result.asset,
						childRun: result.childRun,
					};
				},
			},
			enhancementJudge,
		);
	}
}

function notePageImageBrief(
	page: NotePlan["pages"][number],
	snapshot: NonNullable<HarnessWorkflowInput["executionSnapshot"]>,
	evaluationReason?: string,
): Extract<ExecutionBrief, { kind: "image" }> {
	const aspectRatio = snapshot.deliverable.aspectRatio ?? "3:4";
	return {
		kind: "image",
		intent: page.imageIntent,
		prompt:
			`为图文笔记第 ${page.order} 页生成配图：${page.imageIntent.purpose}。` +
			`图文必须围绕“${page.textBlock.title}”一致表达。` +
			(evaluationReason ? `本次回炉需要修正：${evaluationReason}` : ""),
		referenceAssetIds: page.imageIntent.references.map(
			({ assetId }) => assetId,
		),
		parameters: {
			ratio: aspectRatio,
			resolution: "2048",
		},
		constraints: ["不得改写精确文字，不得使用未授权素材"],
	};
}

function noteVersionId(
	workflowId: string,
	packageId: string,
	styleId: string,
) {
	return `${packageId}-note-${createHash("sha256")
		.update(JSON.stringify({ workflowId, styleId }))
		.digest("hex")
		.slice(0, 16)}`;
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

export interface ImageExactTextVerifier {
	observe(input: {
		assetId: string;
		expected: string[];
		request: HarnessWorkflowInput;
		workflowId: string;
	}): Promise<ImageExactTextObservation>;
}

const exactTextObservationSchema = z
	.object({
		observedText: z.array(z.string()),
		conflictingText: z.array(z.string()),
	})
	.strict();

export class ModelSupplyImageExactTextVerifier
	implements ImageExactTextVerifier
{
	constructor(
		private readonly models: Pick<
			{ submit(input: ModelSupplySubmission): Promise<ModelSupplyResult> },
			"submit"
		>,
	) {}

	async observe(input: {
		assetId: string;
		expected: string[];
		request: HarnessWorkflowInput;
		workflowId: string;
	}) {
		if (input.expected.length === 0) {
			return {
				expected: [],
				observed: [],
				conflictingText: [],
			};
		}
		const result = await this.models.submit({
			actorId: input.request.actorId,
			billingTaskId: input.workflowId,
			billingQuoteRevision: requireSnapshot(input.request).quote.revision,
			correlationId: input.workflowId,
			dataClass: [],
			idempotencyKey: `harness-media:${input.workflowId}:image:exact-text:${input.assetId}`,
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
			selection: { mode: "auto", profile: "quality" },
			workspaceId: input.request.workspaceId,
		});
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
			expected: [...input.expected],
			observed: observation.observedText,
			conflictingText: observation.conflictingText,
		};
	}
}

export class FixtureImageExactTextVerifier implements ImageExactTextVerifier {
	async observe(input: {
		expected: string[];
	}) {
		return {
			expected: [...input.expected],
			observed: [...input.expected],
			conflictingText: [],
		};
	}
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
				): Promise<{ result: ModelSupplyResult }>;
			},
			"submit" | "getDurableMediaJob"
		>,
		private readonly exactText?: ImageExactTextVerifier,
		private readonly noteAdmission?: NoteMediaAdmissionPort,
	private readonly imageProfile: ImageModelRecipeProfile =
			IMAGE_MODEL_RECIPE_PROFILE,
	) {}

	async execute(input: {
		brief: MediaBrief;
		context: HarnessContextSnapshot;
		request: HarnessWorkflowInput;
		workflowId: string;
		orchestrationWorkflowId?: string;
		awaitSignal?: HarnessSignalReceiver;
		runStep?: HarnessEffectRunner;
	}): Promise<HarnessMediaSelectionResult> {
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
					[...new Set(
						preflight.failures.flatMap(
							({ alternativePath }) => alternativePath,
						),
					)],
				);
			}
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
						),
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
			),
			noteAdmissionInput,
			input.awaitSignal,
			input.runStep,
		);
		const completed = requireCompletedMediaResult(result, input.brief.kind);
		return mediaSelection(completed, input.brief.kind, [completed], []);
	}

	private async submitAndAwait(
		submission: ModelSupplySubmission,
		noteAdmissionInput?: {
			taskId: string;
			workflowId: string;
			workspaceId: string;
		},
		awaitSignal?: HarnessSignalReceiver,
		runStep?: HarnessEffectRunner,
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
							const { result: durableResult } =
								await this.models.getDurableMediaJob!(
									submission.workspaceId,
									admittedJobId,
								);
							return durableResult;
						},
						runStep,
					)
				: await this.runEffect(
						`submit:${submission.idempotencyKey}`,
						() => this.models.submit(submission),
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
				await awaitSignal(harnessMediaJobTopic(result.jobId), {
					timeoutSeconds: MEDIA_JOB_WAIT_TIMEOUT_SECONDS,
				});
			}
			const jobId = result.jobId;
			result = await this.runEffect(
				`reconcile:${jobId}`,
				async () => {
					const { result: durableResult } =
						await this.models.getDurableMediaJob!(
							submission.workspaceId,
							jobId,
						);
					return durableResult;
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
		return result;
	}

	private runEffect<Output>(
		effectIdempotencyKey: string,
		operation: () => Promise<Output>,
		runStep?: HarnessEffectRunner,
	) {
		return runStep
			? runStep(effectIdempotencyKey, operation)
			: operation();
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
			| "MEDIA_EXACT_TEXT_VERIFICATION_FAILED"
			| "MEDIA_EXACT_TEXT_VERIFIER_UNAVAILABLE"
			| "MEDIA_GENERATION_FAILED"
			| "MEDIA_RECONCILIATION_PENDING"
			| "MEDIA_SELECTION_MISSING"
			| "MEDIA_SNAPSHOT_MISMATCH",
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

function mediaSubmission(
	workflowId: string,
	request: HarnessWorkflowInput,
	brief: MediaBrief,
	attempt: "primary" | "retry" = "primary",
	exactTextFailure?: string,
	imageProfile: ImageModelRecipeProfile = IMAGE_MODEL_RECIPE_PROFILE,
	orchestrationWorkflowId?: string,
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
	return {
		actorId: request.actorId,
		...(snapshot.lens === "image_text_note"
			? {}
			: { billingTaskId: snapshot.task.id }),
		billingQuoteRevision: snapshot.quote.revision,
		correlationId: orchestrationWorkflowId ?? workflowId,
		dataClass: [...frozenRoute.dataClass],
		idempotencyKey:
			attempt === "primary"
				? `harness-media:${workflowId}:${brief.kind}`
				: `harness-media:${workflowId}:${brief.kind}:exact-text-retry`,
		input:
			brief.kind === "image"
				? {
					inputAssets: compiledImage!.inputAssets,
					ratio: brief.parameters.ratio,
					resolution: brief.parameters.resolution,
				}
				: {
					durationSeconds: brief.parameters.durationSeconds,
					ratio: brief.parameters.ratio,
					referenceAssetIds: [...brief.referenceAssetIds],
				},
		operation:
			brief.kind === "image"
				? compiledImage!.operation
				: "video.generate",
		productUsageQuantity: 0,
		frozenRouteSnapshot: structuredClone(frozenRoute),
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
		selection: {
			catalogModelId: snapshot.catalogModel.id,
			mode: "fixed",
		},
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
	if (
		brief.kind === "image" &&
		brief.intent.operation !== snapshot.operation
	) {
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
	const sourceAssetIds = new Set(snapshot.sources.assets.map((asset) => asset.id));
	if (brief.referenceAssetIds.some((assetId) => !sourceAssetIds.has(assetId))) {
		throw new HarnessMediaExecutionError(
			"MEDIA_SNAPSHOT_MISMATCH",
			"The media brief references an asset outside the frozen source set.",
			409,
		);
	}
}

function mediaSelection(
	result: ModelSupplyResult,
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
	const ownedAsset: NonNullable<ContentPackage["generated"]["ownedAssets"]>[number] = {
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
		childRun: {
			actualCatalogModelId: result.snapshot.actualCatalogModelId,
			assetIds: [asset.id],
			productUsage: {
				quantity: result.usage.quantity,
				status: result.usage.status,
			},
			providerAttempts: uniqueExecutionsProviderAttempts(executions).map((attempt) => ({
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
			})),
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
					measuredDurationSeconds:
						asset.technicalValidation.durationSeconds,
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
			[result.attempt, ...result.attempts].map((attempt) => [attempt.id, attempt]),
		).values(),
	];
}

function uniqueProviderCosts(result: ModelSupplyResult) {
	return [
		...new Map(
			[result.providerCost, ...result.providerCosts].map((cost) => [cost.id, cost]),
		).values(),
	];
}

function uniqueExecutionsProviderAttempts(results: ModelSupplyResult[]) {
	return [
		...new Map(
			results.flatMap(uniqueProviderAttempts).map((attempt) => [
				attempt.id,
				attempt,
			]),
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
