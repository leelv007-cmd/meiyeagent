import { createHash } from "node:crypto";

import type {
	ContentPackage,
	ContentPackageRevisionDelivery,
} from "@meiye/contracts";

import type {
	ModelSupplyResult,
	ModelSupplySubmission,
} from "../model-supply/index.js";
import type { ContentPackageRevisionWritePort } from "../execution-spine/content-package-revision-port.js";
import {
	compileExecutionBrief,
	InMemoryStructuredNodeMetrics,
	type ExecutionBrief,
} from "./structured-nodes.js";
import type { HarnessStructuredNodeRunnerFactory } from "./production-stage-ports.js";
import type {
	HarnessContextSnapshot,
	HarnessMediaSelectionResult,
	HarnessMediaStagePorts,
	HarnessStagePorts,
} from "./workflow-core.js";
import type { HarnessWorkflowInput } from "./task-admission.js";

type MediaBrief = Exclude<ExecutionBrief, { kind: "copy" }>;

export interface HarnessMediaExecutionPort {
	execute(input: {
		brief: MediaBrief;
		context: HarnessContextSnapshot;
		request: HarnessWorkflowInput;
		workflowId: string;
	}): Promise<HarnessMediaSelectionResult>;
}

/**
 * Adds image/video dispatch to the existing copy Harness ports. The shared
 * snapshot remains the only source of model, quote, platform and source facts.
 */
export class UnifiedHarnessStagePorts implements HarnessMediaStagePorts {
	constructor(
		private readonly copy: HarnessStagePorts,
		private readonly runners: HarnessStructuredNodeRunnerFactory,
		private readonly media: HarnessMediaExecutionPort,
		private readonly contentPackages: ContentPackageRevisionWritePort,
		private readonly now: () => string,
	) {}

	nameIntent(input: Parameters<HarnessStagePorts["nameIntent"]>[0]) {
		return this.copy.nameIntent(input);
	}

	injectContext(input: Parameters<HarnessStagePorts["injectContext"]>[0]) {
		return this.copy.injectContext(input);
	}

	fenceContext(input: Parameters<HarnessStagePorts["fenceContext"]>[0]) {
		return this.copy.fenceContext(input);
	}

	compileBrief(input: Parameters<HarnessStagePorts["compileBrief"]>[0]) {
		return this.copy.compileBrief(input);
	}

	executeAndSelect(
		input: Parameters<HarnessStagePorts["executeAndSelect"]>[0],
	) {
		return this.copy.executeAndSelect(input);
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
				executionSnapshot: requireSnapshot(input.request),
				prompt: input.request.prompts?.briefCompilation,
			},
			this.runners.create({
				actorId: input.request.actorId,
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
		return this.media.execute(input);
	}

	async assembleMediaAndDeliver(
		input: Parameters<HarnessMediaStagePorts["assembleMediaAndDeliver"]>[0],
	): Promise<ContentPackageRevisionDelivery> {
		const now = this.now();
		const snapshot = requireSnapshot(input.request);
		return this.contentPackages.write({
			expectedRevision: input.request.expectedRevision,
			generated: {
				assetIds: [input.selection.asset.id],
				childRuns: [input.selection.childRun],
				ownedAssets: [input.selection.asset],
			},
			idempotencyKey: `harness-media:${input.workflowId}:${input.brief.kind}`,
			kind: input.brief.kind === "video" ? "video" : "image_text",
			occurredAt: now,
			packageId: input.request.packageId,
			platform: snapshot.platform.id,
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
			version: {
				body: "",
				createdAt: now,
				id: `${input.workflowId}:${input.selection.asset.id}`,
				orderedAssetIds: [input.selection.asset.id],
				source: "ai_generated",
				title: input.brief.kind === "image" ? "图片成品" : "视频成品",
				topics: [],
			},
			workId: snapshot.work.id,
			workflowId: input.workflowId,
			workflowRevision: input.request.workflowRevision,
			workspaceId: input.request.workspaceId,
		});
	}
}

/** Narrow adapter over the existing Model Supply durable media path. */
export class ModelSupplyHarnessMediaExecutionPort
	implements HarnessMediaExecutionPort
{
	constructor(
		private readonly models: Pick<
			{ submit(input: ModelSupplySubmission): Promise<ModelSupplyResult> },
			"submit"
		>,
	) {}

	async execute(input: {
		brief: MediaBrief;
		context: HarnessContextSnapshot;
		request: HarnessWorkflowInput;
		workflowId: string;
	}): Promise<HarnessMediaSelectionResult> {
		const result = await this.models.submit(
			mediaSubmission(input.workflowId, input.request, input.brief),
		);
		if (result.status === "failed") {
			throw new HarnessMediaExecutionError(
				"MEDIA_GENERATION_FAILED",
				result.failureCode ?? "Media generation failed before a usable asset was recorded.",
				502,
				result.jobId,
				result.attempt.acceptance,
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
		assertAssetKind(input.brief.kind, result.asset.contentType);
		return mediaSelection(result, input.brief.kind);
	}
}

export class HarnessMediaExecutionError extends Error {
	constructor(
		readonly code:
			| "MEDIA_BRIEF_KIND_MISMATCH"
			| "MEDIA_GENERATION_FAILED"
			| "MEDIA_RECONCILIATION_PENDING"
			| "MEDIA_SELECTION_MISSING"
			| "MEDIA_SNAPSHOT_MISMATCH",
		message: string,
		readonly status: 202 | 409 | 502,
		readonly jobId?: string,
		readonly acceptance?: string,
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
): ModelSupplySubmission {
	const snapshot = requireSnapshot(request);
	if (snapshot.modelPolicy.mode !== "fixed") {
		throw new HarnessMediaExecutionError(
			"MEDIA_SELECTION_MISSING",
			"Media execution requires a fixed model selected by the published Recipe.",
			409,
		);
	}
	return {
		actorId: request.actorId,
		billingTaskId: workflowId,
		billingQuoteRevision: snapshot.quote.revision,
		correlationId: workflowId,
		dataClass: [],
		idempotencyKey: `harness-media:${workflowId}:${brief.kind}`,
		input:
			brief.kind === "image"
				? {
					ratio: brief.parameters.ratio,
					referenceAssetIds: [...brief.referenceAssetIds],
					resolution: brief.parameters.resolution,
				}
				: {
					durationSeconds: brief.parameters.durationSeconds,
					ratio: brief.parameters.ratio,
					referenceAssetIds: [...brief.referenceAssetIds],
				},
		operation: brief.kind === "image" ? "image.generate" : "video.generate",
		prompt:
			brief.kind === "image"
				? brief.prompt
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
	if (
		!deliverable ||
		deliverable.kind !== brief.kind ||
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
			providerAttempts: uniqueProviderAttempts(result).map((attempt) => ({
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
			providerCosts: uniqueProviderCosts(result).map((cost) => ({
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
		trace: {
			blockedCandidates: [],
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
