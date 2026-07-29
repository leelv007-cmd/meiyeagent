import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { IMAGE_INTENT_SLOT_KINDS } from "@meiye/contracts";

import {
	createCreationExecutionSnapshot,
	creationExecutionSnapshotSchema,
} from "../execution-spine/creation-execution-snapshot.js";
import {
	MemoryContentPackageRevisionWritePort,
	type ContentPackageRevisionWriteInput,
} from "../execution-spine/content-package-revision-port.js";
import type { ModelSupplyResult, ModelSupplySubmission } from "../model-supply/index.js";
import { buildContentPackage } from "../operations/content-package.js";
import type { HarnessStructuredNodeRunnerFactory } from "./production-stage-ports.js";
import type {
	ExecutionBrief,
	StructuredNodeRunnerRequest,
} from "./structured-nodes.js";
import type { HarnessWorkflowInput } from "./task-admission.js";
import {
	HarnessMediaExecutionError,
	type ImageExactTextVerifier,
	ModelSupplyHarnessMediaExecutionPort,
	ModelSupplyImageExactTextVerifier,
	UnifiedHarnessStagePorts,
} from "./unified-media-stage-ports.js";
import {
	assessImageExactText,
	HarnessSelectionError,
} from "./execution-selection.js";
import { merchantVisibleLanguageIssues } from "./merchant-delivery-language.js";
import type {
	HarnessContextSnapshot,
	HarnessStagePorts,
} from "./workflow-core.js";
import type {
	NoteMediaAdmissionPort,
	NoteMediaAdmissionToken,
} from "./note-media-admission.js";
import {
	HARNESS_LANGFUSE_PROMPT_NAMES,
	type HarnessFrozenPrompts,
} from "./langfuse-prompts.js";

test("image and video use the existing Model Supply path with stable submission facts", async () => {
	for (const kind of ["image", "video"] as const) {
		const submissions: ModelSupplySubmission[] = [];
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult(kind);
			},
		});
		const request = harnessInput(kind, `package-${kind}`);
		const selection = await adapter.execute({
			brief: mediaBrief(kind),
			context: contextSnapshot(),
			request,
			workflowId: `workflow-${kind}`,
		});

		assert.deepEqual(submissions, [
			{
				actorId: "owner-1",
				billingQuoteRevision: "quote-r1",
				billingTaskId: `task-${kind}`,
				correlationId: `workflow-${kind}`,
				dataClass: [],
				idempotencyKey: `harness-media:workflow-${kind}:${kind}`,
				input:
					kind === "image"
						? {
								inputAssets: [
									{
										assetId: "asset-1",
										imageSlot: "work_case",
										nativeField: "image",
										role: "reference_image",
									},
								],
								ratio: "9:16",
								resolution: "1080p",
							}
						: {
								durationSeconds: 8,
								ratio: "9:16",
								referenceAssetIds: ["asset-1"],
							},
				operation: kind === "image" ? "image.edit" : "video.generate",
				productUsageQuantity: 0,
				prompt:
					kind === "image"
						? `${mediaBrief(kind).prompt}\n${JSON.stringify({
								imageIntent: mediaBrief(kind).intent,
								imageModelRecipeProfile: {
									id: "seedream-image-v1",
									revision: "seedream-image-v1-r1",
								},
							})}`
						: `${mediaBrief(kind).firstFramePrompt}\n1. ${mediaBrief(kind).storyboard[0]?.description}`,
				selection: { catalogModelId: `model-${kind}-1`, mode: "fixed" },
				workspaceId: "workspace-1",
			},
		]);
		assert.equal(selection.kind, kind);
		assert.equal(selection.asset.id, `${kind}-asset-1`);
		assert.equal(selection.childRun.productUsage?.status, "committed");
		assert.equal(selection.childRun.providerAttempts?.length, 1);
		assert.equal(selection.childRun.providerCosts?.length, 1);
		assert.equal(
			selection.measuredDurationSeconds,
			kind === "video" ? 8 : undefined,
		);
	}
});

test("three canonical image operations map to the two existing provider operations", async () => {
	for (const [operation, referenceCount, nativeOperation] of [
		["image.generate", 0, "image.generate"],
		["image.edit", 1, "image.edit"],
		["image.reference_transform", 2, "image.edit"],
	] as const) {
		const submissions: ModelSupplySubmission[] = [];
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult("image");
			},
		});
		await adapter.execute({
			brief: imageBriefFor(operation, referenceCount),
			context: contextSnapshot(),
			request: harnessInput(
				"image",
				`package-${operation}`,
				operation,
				referenceCount,
			),
			workflowId: `task-${operation}`,
		});

		assert.equal(submissions[0]?.operation, nativeOperation);
		assert.equal(
			submissions[0]?.input?.inputAssets?.length,
			referenceCount,
		);
	}
});

test("image execution validates the selected recipe profile and preserves slot-native bindings", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const profile = {
		id: "seedream-profile",
		revision: "seedream-profile-r1",
		operationMappings: {
			"image.generate": "image.generate",
			"image.edit": "image.edit",
			"image.reference_transform": "image.edit",
		},
		slotRules: IMAGE_INTENT_SLOT_KINDS.map((slot) => ({
			slot,
			minItems: 0,
			maxItems: slot === "style_ref" ? 1 : 2,
			allowedMimeTypes: ["image/png"],
			maxBytesPerItem: 2_048,
			incompatibleWith: [],
			nativeField: "image",
		})),
	} as const;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult("image");
			},
		},
		undefined,
		undefined,
		profile,
	);

	await adapter.execute({
		brief: imageBriefFor("image.reference_transform", 2),
		context: contextSnapshot(),
		request: harnessInput(
			"image",
			"package-reference-transform",
			"image.reference_transform",
			2,
		),
		workflowId: "task-reference-transform",
	});

	assert.deepEqual(submissions[0]?.input?.inputAssets, [
		{
			assetId: "asset-1",
			imageSlot: "style_ref",
			nativeField: "image",
			role: "reference_image",
		},
		{
			assetId: "asset-2",
			imageSlot: "composition_ref",
			nativeField: "image",
			role: "reference_image",
		},
	]);
	assert.equal(
		Object.hasOwn(submissions[0]?.input ?? {}, "referenceAssetIds"),
		false,
	);

	const invalidBrief = imageBriefFor("image.reference_transform", 2);
	invalidBrief.intent.references[1] = {
		...invalidBrief.intent.references[1]!,
		slot: "style_ref",
	};
	await assert.rejects(
		adapter.execute({
			brief: invalidBrief,
			context: contextSnapshot(),
			request: harnessInput(
				"image",
				"package-profile-invalid",
				"image.reference_transform",
				2,
			),
			workflowId: "task-profile-invalid",
		}),
		/style_ref requires 0-1 references/u,
	);
	assert.equal(submissions.length, 1);

	const unfrozenReference = imageBriefFor("image.edit", 1);
	unfrozenReference.intent.references[0] = {
		...unfrozenReference.intent.references[0]!,
		assetId: "asset-outside-snapshot",
	};
	await assert.rejects(
		adapter.execute({
			brief: unfrozenReference,
			context: contextSnapshot(),
			request: harnessInput(
				"image",
				"package-unfrozen-reference",
				"image.edit",
				1,
			),
			workflowId: "task-unfrozen-reference",
		}),
		/image intent references do not match the frozen media brief/iu,
	);
	assert.equal(submissions.length, 1);
});

test("image-text note page generation uses the existing image executor without changing pure image semantics", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult("image");
			},
		},
		undefined,
		memoryNoteAdmission(),
	);

	const noteSelection = await adapter.execute({
		brief: imageBriefFor("image.generate", 0),
		context: contextSnapshot(),
		request: harnessInput("image_text_note", "package-note"),
		workflowId: "workflow-note:page-1",
	});
	const imageSelection = await adapter.execute({
		brief: imageBriefFor("image.edit", 1),
		context: contextSnapshot(),
		request: harnessInput("image", "package-image"),
		workflowId: "workflow-image",
	});

	assert.equal(noteSelection.kind, "image");
	assert.equal(submissions[0]?.operation, "image.generate");
	assert.equal(Object.hasOwn(submissions[0] ?? {}, "billingTaskId"), false);
	assert.equal(submissions[0]?.productUsageQuantity, 0);
	assert.equal(
		submissions[0]?.selection.catalogModelId,
		"model-image_text_note-1",
	);
	assert.equal(imageSelection.kind, "image");
	assert.equal(submissions[1]?.operation, "image.edit");
	assert.equal(submissions[1]?.billingTaskId, "task-image");
	assert.equal(submissions[1]?.selection.catalogModelId, "model-image-1");
});

test("media delivery writes the shared ContentPackage once with asset, usage, cost, and snapshot lineage", async () => {
	for (const kind of ["image", "video"] as const) {
		const packageId = `package-${kind}`;
		const request = harnessInput(kind, packageId);
		const snapshot = request.executionSnapshot!;
		const writer = new MemoryContentPackageRevisionWritePort();
		let writtenRevision: ContentPackageRevisionWriteInput | undefined;
		writer.seed(
			buildContentPackage({
				id: packageId,
				kind: kind === "image" ? "image_text" : "video",
				source: {
					assetIds: ["asset-1"],
					creationExecutionSnapshot: {
						id: snapshot.id,
						revision: snapshot.revision,
						schemaVersion: snapshot.schemaVersion,
					},
					targetPlatform: "douyin",
					workId: snapshot.work.id,
					workflowId: snapshot.task.id,
					workflowRevision: snapshot.revision,
				},
				timestamp: "2026-07-22T09:00:00.000Z",
				workspaceId: "workspace-1",
			}),
		);
		const media = new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				return completedResult(kind);
			},
		});
		const ports = new UnifiedHarnessStagePorts(
			unsupportedCopyPorts(),
			{ create() { throw new Error("Media delivery does not compile a copy brief."); } },
			media,
			{
				async write(input) {
					writtenRevision = structuredClone(input);
					return writer.write(input);
				},
			},
			() => "2026-07-22T09:00:01.000Z",
		);
		const brief = mediaBrief(kind);
		const selection = await media.execute({
			brief,
			context: contextSnapshot(),
			request,
			workflowId: snapshot.task.id,
		});
		const input = {
			workflowId: snapshot.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购成片",
				taskType: "promotion_groupbuy_conversion" as const,
				deliveryLayer: "finished_media" as const,
				relevantAssetCategories: ["promotion_activity" as const],
				usedAssetCategories: ["promotion_activity" as const],
				route: "customized" as const,
				routingSource: "model" as const,
				implicitConstraints: [],
			},
			context: contextSnapshot(),
			brief,
			selection,
		};
		const delivery = await ports.assembleMediaAndDeliver(input);
		const replayed = await ports.assembleMediaAndDeliver(input);

		assert.deepEqual(replayed, delivery);
		assert.deepEqual(delivery, {
			packageId,
			revision: 1,
			versionId: `${snapshot.task.id}:${kind}-asset-1`,
		});
		assert.equal(writtenRevision?.taskId, snapshot.task.id);
		assert.equal(writtenRevision?.snapshotId, snapshot.id);
		assert.equal(writtenRevision?.snapshot.revision, snapshot.revision);
		assert.equal(
			writtenRevision?.generated.childRuns[0]?.providerAttempts?.length,
			1,
		);
		assert.equal(
			writtenRevision?.generated.childRuns[0]?.providerCosts?.length,
			1,
		);
		const contentPackage = writer.get("workspace-1", packageId);
		assert.ok(contentPackage);
		assert.equal(contentPackage?.revision, 1);
		assert.deepEqual(contentPackage?.source.creationExecutionSnapshot, {
			id: snapshot.id,
			revision: 1,
			schemaVersion: "creation-execution-snapshot/v1",
		});
		assert.deepEqual(contentPackage?.generated.assetIds, [`${kind}-asset-1`]);
		assert.equal(contentPackage?.generated.ownedAssets?.[0]?.id, `${kind}-asset-1`);
		assert.equal(
			contentPackage?.generated.ownedAssets?.[0]?.sourceTaskRef,
			`provider-task-${kind}-1`,
		);
		assert.deepEqual(contentPackage?.generated.childRuns[0]?.productUsage, {
			quantity: 0,
			status: "committed",
		});
		assert.equal(contentPackage?.generated.childRuns[0]?.providerCost?.amount, 1.2);
		assert.equal(contentPackage?.generated.childRuns[0]?.providerAttempts?.length, 1);
		assert.equal(contentPackage?.generated.childRuns[0]?.providerCosts?.length, 1);
		assert.equal(contentPackage?.marketing?.contextBundle.bundleId, "bundle-1");
		assert.deepEqual(contentPackage?.marketing?.rightsRefs, ["asset-1"]);
		assert.equal(contentPackage?.variants?.length, 3);
		assert.ok(contentPackage?.versions[0]?.body.trim());
		assert.ok(contentPackage?.versions[0]?.conversionHook?.trim());
		assert.deepEqual(contentPackage?.harnessSelection, {
			recommendedCandidateId: `${kind}-asset-1`,
		});
		assert.equal(
			contentPackage?.versions[0]?.harnessCandidateId,
			`${kind}-asset-1`,
		);
		if (kind === "image") {
			assert.equal(contentPackage?.versions[0]?.title, "夏日护理活动海报");
		} else {
			assert.equal(contentPackage?.versions[0]?.title, "视频成品");
		}
	}
});

test("image-text note compiles dual styles, generates selected pages, and writes one complete revision", async () => {
	const packageId = "package-image-text-note";
	const originalRequest = harnessInput("image_text_note", packageId);
	const sourceSnapshot = originalRequest.executionSnapshot!;
	const snapshot = creationExecutionSnapshotSchema.parse({
		...sourceSnapshot,
		id: "snapshot-note-confirmed",
		semanticDecision: {
			sourceSnapshotId: sourceSnapshot.id,
			reference: {
				field: "note_plan_confirmation",
				id: "decision-note-confirmation",
				revision: sourceSnapshot.revision,
				value: "use-default",
			},
		},
	});
	const request = { ...originalRequest, executionSnapshot: snapshot };
	const writer = new MemoryContentPackageRevisionWritePort();
	writer.seed(
		buildContentPackage({
			id: packageId,
			kind: "image_text",
			source: {
				assetIds: [],
				creationExecutionSnapshot: {
					id: sourceSnapshot.id,
					revision: sourceSnapshot.revision,
					schemaVersion: sourceSnapshot.schemaVersion,
				},
				targetPlatform: "douyin",
				workId: snapshot.work.id,
				workflowId: snapshot.task.id,
				workflowRevision: snapshot.revision,
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
	);
	let generated = 0;
	const ports = new UnifiedHarnessStagePorts(
		noteCopyPorts(),
		noteRunnerFactory(true),
		{
			async execute() {
				generated += 1;
				const selection = completedResult("image", String(generated));
				return {
					asset: {
						contentType: selection.asset!.contentType,
						id: selection.asset!.id,
						objectKey: selection.asset!.objectKey,
						sha256: selection.asset!.sha256,
						sizeBytes: selection.asset!.sizeBytes,
					},
					childRun: {
						assetIds: [selection.asset!.id],
						runId: `run-note-${generated}`,
						runType: "model_job",
						status: "succeeded",
						productUsage: { quantity: 1, status: "committed" },
					},
					kind: "image",
					trace: {
						stage: "execution_selection",
						winnerCandidateId: selection.asset!.id,
						candidateScores: [],
						blockedCandidates: [],
						rubricVersion: "image-v1",
						rubricHash: "a".repeat(64),
					},
				};
			},
		},
		writer,
		() => "2026-07-22T09:00:01.000Z",
		{
			async read() {
				return {
					styles: {
						styles: [
							{
								id: "facts",
								name: "干货版",
								writingGuide: "清楚说明",
								structureTemplate: "结论、依据、行动",
								platforms: ["xiaohongshu"],
							},
							{
								id: "story",
								name: "故事版",
								writingGuide: "场景叙事",
								structureTemplate: "场景、方案、行动",
								platforms: ["xiaohongshu"],
							},
						],
					},
				};
			},
		},
	);
	const context = contextSnapshot();
	const declaration = {
		normalizedIntent: "介绍夏日护理项目",
		taskType: "daily_service_exposure" as const,
		deliveryLayer: "finished_media" as const,
		relevantAssetCategories: ["product_service" as const],
		usedAssetCategories: ["product_service" as const],
		route: "customized" as const,
		routingSource: "model" as const,
		implicitConstraints: [],
	};
	const confirmation = await ports.nameIntent({
		workflowId: snapshot.task.id,
		request,
	});
	assert.equal(
		confirmation.blockingQuestion?.response.field,
		"note_plan_confirmation",
	);
	assert.equal(confirmation.blockingQuestion?.unattended, "continue");

	const brief = await ports.compileNoteBrief({
		workflowId: snapshot.task.id,
		request,
		declaration,
		context,
	});
	assert.deepEqual(
		brief.candidates.candidates.map(({ styleId }) => styleId),
		["facts", "story"],
	);
	const selection = await ports.executeNoteAndSelect({
		workflowId: snapshot.task.id,
		request,
		brief,
		context,
		selectedStyleId: "story",
	});
	const delivery = await ports.assembleNoteAndDeliver({
		workflowId: snapshot.task.id,
		request,
		declaration,
		context,
		brief,
		selection,
	});

	assert.equal(delivery.revision, 1);
	assert.equal(generated, 3);
	assert.deepEqual(
		selection.auditSignals.map(({ eventType, payload }) => ({
			eventType,
			status: payload.status,
			strategy: payload.strategy,
		})),
		[
			{
				eventType: "note_style_selected",
				status: undefined,
				strategy: undefined,
			},
			{
				eventType: "note_consistency_evaluated",
				status: "warned",
				strategy: "warn",
			},
			{
				eventType: "note_page_regenerated",
				status: undefined,
				strategy: undefined,
			},
			{
				eventType: "note_page_regenerated",
				status: undefined,
				strategy: undefined,
			},
			{
				eventType: "note_consistency_evaluated",
				status: "passed",
				strategy: "warn",
			},
		],
	);
	const contentPackage = writer.get("workspace-1", packageId);
	assert.equal(contentPackage?.revision, 1);
	assert.equal(contentPackage?.versions.length, 2);
	assert.equal(contentPackage?.variants.length, 3);
	const selectedVersion = contentPackage?.versions.find(
		({ harnessCandidateId }) => harnessCandidateId === "story",
	);
	assert.equal(selectedVersion?.note?.plan.pages.length, 2);
	assert.deepEqual(
		selectedVersion?.note?.plan.pages.map(
			({ imageAssetId }) => imageAssetId,
		),
		["image-asset-1", "image-asset-3"],
	);
	assert.ok(contentPackage?.marketing?.contextBundle.bundleId);
	assert.ok(contentPackage?.marketing?.rightsRefs.length);
	assert.ok(
		selectedVersion?.body && !selectedVersion.body.includes("还没对上"),
		"a fully consistent note carries no partial marker",
	);

	// D-122 诚实交付: the same delivery, one page short. Naming the count on the
	// 申报卡 is not enough — the merchant has to be able to tell which page to
	// hold back in the copy they will actually paste.
	const partialPackageId = "package-image-text-note-partial";
	const partialSnapshot = creationExecutionSnapshotSchema.parse({
		...snapshot,
		id: "snapshot-note-partial",
		contentPackage: { ...snapshot.contentPackage, id: partialPackageId },
	});
	const partialRequest = {
		...harnessInput("image_text_note", partialPackageId),
		executionSnapshot: partialSnapshot,
	};
	writer.seed(
		buildContentPackage({
			id: partialPackageId,
			kind: "image_text",
			source: {
				assetIds: [],
				creationExecutionSnapshot: {
					id: sourceSnapshot.id,
					revision: sourceSnapshot.revision,
					schemaVersion: sourceSnapshot.schemaVersion,
				},
				targetPlatform: "douyin",
				workId: partialSnapshot.work.id,
				workflowId: partialSnapshot.task.id,
				workflowRevision: partialSnapshot.revision,
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
	);
	const partialBrief = await ports.compileNoteBrief({
		workflowId: partialSnapshot.task.id,
		request: partialRequest,
		declaration,
		context,
	});
	const baseSelection = await ports.executeNoteAndSelect({
		workflowId: partialSnapshot.task.id,
		request: partialRequest,
		brief: partialBrief,
		context,
		selectedStyleId: "story",
	});
	const unresolvedPageId = baseSelection.version.plan.pages[1]!.id;
	await ports.assembleNoteAndDeliver({
		workflowId: partialSnapshot.task.id,
		request: partialRequest,
		declaration,
		context,
		brief: partialBrief,
		selection: {
			...baseSelection,
			version: {
				...baseSelection.version,
				evaluation: {
					...baseSelection.version.evaluation!,
					regenerationPageIds: [unresolvedPageId],
				},
			},
			partial: {
				unresolvedPageIds: [unresolvedPageId],
				reason: "consistency_remained_incomplete",
			},
		},
	});
	const partialVersion = writer
		.get("workspace-1", partialPackageId)
		?.versions.find(({ harnessCandidateId }) => harnessCandidateId === "story");
	const partialPages = partialVersion?.body.split("\n\n") ?? [];
	assert.ok(partialPages.length >= baseSelection.version.plan.pages.length);
	assert.ok(
		!partialPages[0]?.includes("还没对上"),
		"the page that came out right is left alone",
	);
	assert.match(partialPages.at(-1) ?? "", /还没对上/u);
});

test("media delivery blocks malicious visible copy before the canonical writer", async () => {
	const request = harnessInput("image", "package-image-redline");
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return completedResult("image");
		},
	});
	let writes = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write() {
				writes += 1;
				throw new Error("The redline gate must run before this writer.");
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);
	const brief = imageBriefFor("image.edit", 1);
	brief.intent.purpose = "国家认证五星机构，团购价398元";
	brief.intent.subject = "到店即送全年护理";
	const selection = await media.execute({
		brief,
		context: contextSnapshot(),
		request,
		workflowId: request.executionSnapshot!.task.id,
	});

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购海报",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context: contextSnapshot(),
			brief,
			selection,
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("critical_fact_source") &&
			error.merchantMessage ===
				"成品文案含有未被门店已确认资料支持的资质、价格或优惠、权益承诺，暂不能交付。",
	);
	assert.equal(writes, 0);
});

test("media closeout enforces authoritative source rights and expression identity", async () => {
	const request = harnessInput("image", "package-image-authority");
	const brief = imageBriefFor("image.edit", 1);
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return completedResult("image");
		},
	});
	const context = contextSnapshot();
	context.policyReferences.rightsRefs = [
		{
			assetId: "asset-1",
			workspaceId: "workspace-1",
			status: "withdrawn",
			allowedUses: [],
		},
	];
	context.policyReferences.identityRefs = [
		{
			id: "marketing_identity:identity-1:identity-r1",
			workspaceId: "workspace-1",
			status: "withdrawn",
		},
	];
	let writes = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write() {
				writes += 1;
				throw new Error("The authority gate must run before this writer.");
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);
	const selection = await media.execute({
		brief,
		context,
		request,
		workflowId: request.executionSnapshot!.task.id,
	});

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作护理海报",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context,
			brief,
			selection,
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("subject_asset_rights") &&
			error.gateIds.includes("expression_identity"),
	);
	assert.equal(writes, 0);
});

test("media closeout evaluates frozen price sources against delivery-time freshness", async () => {
	const request = harnessInput("image", "package-image-freshness");
	const brief = imageBriefFor("image.edit", 1);
	brief.intent.purpose = "头皮护理团购价398元";
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return completedResult("image");
		},
	});
	const context = contextSnapshot();
	context.activeFacts = [
		{
			key: "group_buy_price",
			value: { amount: 398, currency: "CNY" },
			sourceRef: "store_fact:price-1:1",
			effectiveFrom: "2026-07-21T00:00:00.000Z",
			expiresAt: "2026-07-22T09:00:00.500Z",
		},
	];
	context.policyReferences.sourceRefs = [
		{
			id: "store_fact:price-1:1",
			workspaceId: "workspace-1",
			revision: 1,
			status: "current",
		},
	];
	Object.assign(context.policyReferences.sourceRefs[0]!, {
		expiresAt: "2026-07-22T09:00:00.500Z",
	});
	context.bundle.dimensions.store_facts_assets.group_buy_price = {
		value: { amount: 398, currency: "CNY" },
		layer: "current_fact",
		pool: "store_personal",
		sourceRef: "store_fact:price-1:1",
		factSnapshot: {
			factId: "price-1",
			kind: "price",
			revision: 1,
			source: {
				kind: "user_confirmation",
				referenceId: "confirmation-price-1",
				capturedAt: "2026-07-21T00:00:00.000Z",
			},
			effectiveFrom: "2026-07-21T00:00:00.000Z",
			expiresAt: "2026-07-22T09:00:00.500Z",
		},
	};
	let writes = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write() {
				writes += 1;
				throw new Error("The freshness gate must run before this writer.");
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);
	const selection = await media.execute({
		brief,
		context,
		request,
		workflowId: request.executionSnapshot!.task.id,
	});

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购海报",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context,
			brief,
			selection,
			allowedFactRefs: ["store_fact:price-1:1"],
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("price_benefit_freshness"),
	);
	assert.equal(writes, 0);
});

test("video delivery rejects a price from the context when this run did not authorize its fact reference", async () => {
	const request = harnessInput("video", "package-video-unauthorized-price");
	const brief = mediaBrief("video");
	brief.storyboard[0]!.description = "头皮护理团购价398元，门店护理场景与主视觉展示。";
	const context = contextSnapshot();
	context.activeFacts = [
		{
			key: "group_buy_price",
			value: { amount: 398, currency: "CNY" },
			sourceRef: "store_fact:price-1:1",
			effectiveFrom: "2026-07-21T00:00:00.000Z",
			expiresAt: null,
		},
	];
	context.policyReferences.sourceRefs = [
		{
			id: "store_fact:price-1:1",
			workspaceId: "workspace-1",
			revision: 1,
			status: "current",
		},
	];
	context.bundle.dimensions.store_facts_assets.group_buy_price = {
		value: { amount: 398, currency: "CNY" },
		layer: "current_fact",
		pool: "store_personal",
		sourceRef: "store_fact:price-1:1",
		factSnapshot: {
			factId: "price-1",
			kind: "price",
			revision: 1,
			source: {
				kind: "user_confirmation",
				referenceId: "confirmation-price-1",
				capturedAt: "2026-07-21T00:00:00.000Z",
			},
			effectiveFrom: "2026-07-21T00:00:00.000Z",
			expiresAt: null,
		},
	};
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return completedResult("video");
		},
	});
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write() {
				throw new Error("The unauthorized price must not reach the writer.");
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);
	const selection = await media.execute({
		brief,
		context,
		request,
		workflowId: request.executionSnapshot!.task.id,
	});

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购视频",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context,
			brief,
			selection,
			allowedFactRefs: [],
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("critical_fact_source"),
	);
});

test("image exact text is included in the visible-copy delivery gate", async () => {
	const request = harnessInput("image", "package-image-exact-text-redline");
	const brief = imageBriefWithExactText("卫健委批准");
	const media = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				return completedResult("image");
			},
		},
		{
			async observe(input) {
				return {
					expected: input.expected,
					observed: input.expected,
					conflictingText: [],
				};
			},
		},
	);
	const selection = await media.execute({
		brief,
		context: contextSnapshot(),
		request,
		workflowId: request.executionSnapshot!.task.id,
	});
	let writes = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write(input) {
				writes += 1;
				return {
					packageId: input.packageId,
					revision: input.expectedRevision + 1,
					versionId: input.version.id,
				};
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作医美活动海报",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context: contextSnapshot(),
			brief,
			selection,
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("critical_fact_source"),
	);
	assert.equal(writes, 0);
});

test("the video-native compiler has no ffmpeg or composition dependency", async () => {
	const source = await readFile(
		new URL("./unified-media-stage-ports.ts", import.meta.url),
		"utf8",
	);
	const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
		(match) => match[1] ?? "",
	);

	assert.deepEqual(
		imports.filter((specifier) => /ffmpeg|composition/iu.test(specifier)),
		[],
	);
});

test("an unknown durable media outcome stays on its stable reconciliation key", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit(input) {
			submissions.push(structuredClone(input));
			return { ...completedResult("video"), status: "unknown", asset: undefined };
		},
	});
	const request = harnessInput("video", "package-video");

	await assert.rejects(
		adapter.execute({
			brief: mediaBrief("video"),
			context: {} as HarnessContextSnapshot,
			request,
			workflowId: "task-video",
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "MEDIA_RECONCILIATION_PENDING" &&
			error.status === 202,
	);
	assert.equal(submissions.length, 1);
	assert.equal(submissions[0]?.idempotencyKey, "harness-media:task-video:video");
});

test("terminal video failure and timeout expose merchant-safe recovery choices", async () => {
	for (const [failureCode, expectedChoice] of [
		["PROVIDER_REJECTED", "更换参考素材"],
		["LOGICAL_TIMEOUT", "图片发布方案"],
	] as const) {
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				return {
					...completedResult("video"),
					asset: undefined,
					failureCode,
					status: "failed" as const,
				};
			},
		});

		await assert.rejects(
			adapter.execute({
				brief: mediaBrief("video"),
				context: contextSnapshot(),
				request: harnessInput("video", "package-video"),
				workflowId: "task-video",
			}),
			(error: unknown) => {
				assert.ok(error instanceof HarnessMediaExecutionError);
				assert.equal(error.code, "MEDIA_GENERATION_FAILED");
				assert.match(error.merchantMessage ?? "", /重新生成/u);
				assert.match(error.merchantMessage ?? "", new RegExp(expectedChoice, "u"));
				assert.doesNotMatch(error.merchantMessage ?? "", new RegExp(failureCode, "u"));
				assert.deepEqual(
					merchantVisibleLanguageIssues(error.merchantMessage ?? ""),
					[],
				);
				return true;
			},
		);
	}
});

test("an unknown media result reconciles the same durable job without resubmission", async () => {
	const submitted = completedResult("image");
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return { ...submitted, status: "unknown", asset: undefined };
		},
		async getDurableMediaJob(workspaceId, jobId) {
			assert.equal(workspaceId, "workspace-1");
			assert.equal(jobId, submitted.jobId);
			return { result: submitted };
		},
	});

	const selection = await adapter.execute({
		brief: mediaBrief("image"),
		context: contextSnapshot(),
		request: harnessInput("image", "package-image"),
		workflowId: "task-image",
	});

	assert.equal(selection.asset.id, "image-asset-1");
});

test("note pages keep durable admission single-flight while compiler branches remain parallel", async () => {
	const events: string[] = [];
	const first = completedResult("image", "1");
	const second = completedResult("image", "2");
	let submissions = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				events.push(`submit:${submissions}`);
				if (submissions === 1) {
					return { ...first, status: "unknown", asset: undefined };
				}
				return second;
			},
			async getDurableMediaJob(_workspaceId, jobId) {
				assert.equal(jobId, first.jobId);
				events.push("get:1:completed");
				return { result: first };
			},
		},
		undefined,
		memoryNoteAdmission(events),
	);
	const request = harnessInput("image_text_note", "package-note");

	const [firstSelection, secondSelection] = await Promise.all([
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "workflow-note:page-1",
			awaitSignal: async () => {},
		}),
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "workflow-note:page-2",
			awaitSignal: async () => {
				while (!events.includes("completed:g1")) {
					await new Promise<void>((resolve) => setImmediate(resolve));
				}
			},
			runStep: async (_effectKey, operation) => operation(),
		}),
	]);

	assert.equal(firstSelection.asset.id, "image-asset-1");
	assert.equal(secondSelection.asset.id, "image-asset-2");
	assert.deepEqual(events, [
		"claim:workflow-note:page-1:g1",
		"blocked:workflow-note:page-2",
		"submit:1",
		"running:g1",
		"get:1:completed",
		"completed:g1",
		"claim:workflow-note:page-2:g2",
		"submit:2",
		"running:g2",
		"completed:g2",
	]);
});

test("a competing note workflow polls inside one durable admission effect", async () => {
	const events: string[] = [];
	const first = completedResult("image", "1");
	const second = completedResult("image", "2");
	let submissions = 0;
	const effectKeys: string[] = [];
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				if (submissions === 1) {
					return { ...first, status: "unknown", asset: undefined };
				}
				return second;
			},
			async getDurableMediaJob(_workspaceId, jobId) {
				assert.equal(jobId, first.jobId);
				return { result: first };
			},
		},
		undefined,
		memoryNoteAdmission(events),
	);
	const request = harnessInput("image_text_note", "package-note-durable");

	const [firstSelection, secondSelection] = await Promise.all([
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "workflow-note:page-1",
		}),
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "workflow-note:page-2",
			runStep: async (effectKey, operation) => {
				effectKeys.push(effectKey);
				return operation();
			},
		}),
	]);

	assert.equal(firstSelection.asset.id, "image-asset-1");
	assert.equal(secondSelection.asset.id, "image-asset-2");
	assert.deepEqual(
		effectKeys.map((key) => key.split(":", 1)[0]),
		["admission-claim", "submit", "admission-running", "admission-terminal"],
	);
	assert.deepEqual(events.slice(0, 2), [
		"claim:workflow-note:page-1:g1",
		"blocked:workflow-note:page-2",
	]);
});

test("a busy note admission without a durable step returns 202 immediately", async () => {
	let claimCalls = 0;
	let submissions = 0;
	const blockedAdmission: NoteMediaAdmissionPort = {
		async claim() {
			claimCalls += 1;
			return null;
		},
		async markRunning() {
			throw new Error("markRunning must not run without a claim");
		},
		async markTerminal() {
			throw new Error("markTerminal must not run without a claim");
		},
	};
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				return completedResult("image");
			},
		},
		undefined,
		blockedAdmission,
	);

	await assert.rejects(
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request: harnessInput("image_text_note", "package-note-fast-202"),
			workflowId: "workflow-note:busy-fast-202",
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
				error.code === "MEDIA_RECONCILIATION_PENDING" &&
				error.status === 202,
	);
	assert.equal(claimCalls, 1);
	assert.equal(submissions, 0);
});

test("exact text blocks the first image, retries once, and keeps both provider costs without job-side debit flags", async () => {
	const submissions: ModelSupplySubmission[] = [];
	let generation = 0;
	let verification = 0;
	const verifier: ImageExactTextVerifier = {
		async observe(input) {
			verification += 1;
			return verification === 1
				? {
						expected: input.expected,
						observed: ["价格 389"],
						conflictingText: [],
					}
				: {
						expected: input.expected,
						observed: ["价格 398"],
						conflictingText: [],
					};
		},
	};
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit(input) {
				submissions.push(structuredClone(input));
				generation += 1;
				return completedResult("image", String(generation));
			},
		},
		verifier,
	);
	const request = {
		...harnessInput("image", "package-image"),
		prompts: frozenPromptBundle(),
	};
	const brief = imageBriefWithExactText("价格 398");
	const selection = await adapter.execute({
		brief,
		context: contextSnapshot(),
		request,
		workflowId: "task-image",
	});

	assert.equal(selection.asset.id, "image-asset-2");
	assert.deepEqual(selection.trace.blockedCandidates, [
		{ candidateId: "image-asset-1", gateIds: ["image_exact_text"] },
	]);
	assert.equal(selection.childRun.providerAttempts?.length, 2);
	assert.equal(selection.childRun.providerCosts?.length, 2);
	assert.equal(submissions.length, 2);
	assert.equal(
		submissions[1]?.idempotencyKey,
		"harness-media:task-image:image:exact-text-retry",
	);
	assert.match(
		submissions[1]?.prompt ?? "",
		/did not preserve every exact text value/u,
	);
	// T19 originally asserted the key was ABSENT. T14 (merged after it) makes every
	// media sub-job explicitly cost-only, so absence is no longer the right shape —
	// and absence was never the safe one: before T14 an absent value fell through to
	// a `?? 1` default, i.e. a real user-side debit. Pinning the value to 0 says what
	// this test's own name claims, and it fails if anyone reintroduces a debit here.
	assert.deepEqual(
		submissions.map((submission) => submission.productUsageQuantity),
		[0, 0],
	);
});

test("a second exact-text mismatch hard-blocks delivery with merchant-safe wording", async () => {
	let generation = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				generation += 1;
				return completedResult("image", String(generation));
			},
		},
		{
			async observe(input) {
				return {
					expected: input.expected,
					observed: ["价格 389"],
					conflictingText: [],
				};
			},
		},
	);

	await assert.rejects(
		adapter.execute({
			brief: imageBriefWithExactText("价格 398"),
			context: contextSnapshot(),
			request: harnessInput("image", "package-image"),
			workflowId: "task-image",
		}),
		(error: unknown) => {
			assert.ok(error instanceof HarnessSelectionError);
			assert.deepEqual(error.gateIds, ["image_exact_text"]);
			assert.match(error.merchantMessage ?? "", /价格 398/u);
			assert.match(error.merchantMessage ?? "", /价格 389/u);
			assert.deepEqual(
				merchantVisibleLanguageIssues(error.merchantMessage ?? ""),
				[],
			);
			return true;
		},
	);
	assert.equal(generation, 2);
});

test("the production exact-text verifier reuses multimodal text.respond without extending supply operations", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const verifier = new ModelSupplyImageExactTextVerifier({
		async submit(input) {
			submissions.push(structuredClone(input));
			return {
				...completedResult("image"),
				asset: undefined,
				operation: "text.respond",
				text: JSON.stringify({
					observedText: ["价格 398"],
					conflictingText: [],
				}),
			};
		},
	});
	const request = {
		...harnessInput("image", "package-image"),
		prompts: frozenPromptBundle(),
	};
	const observation = await verifier.observe({
		assetId: "image-asset-1",
		expected: ["价格 398"],
		request,
		workflowId: "task-image",
	});
	const assessment = assessImageExactText(observation);

	assert.equal(assessment.passed, true);
	assert.equal(submissions[0]?.operation, "text.respond");
	assert.deepEqual(submissions[0]?.input?.inputAssets, [
		{ assetId: "image-asset-1", role: "reference_image" },
	]);
	assert.equal(
		submissions[0]?.promptBinding?.content,
		"frozen:textResponse",
	);
	assert.equal(
		Object.hasOwn(submissions[0] ?? {}, "productUsageQuantity"),
		false,
	);
});

test("the production exact-text verifier rejects a conflicting value even when the expected value is also visible", async () => {
	const verifier = new ModelSupplyImageExactTextVerifier({
		async submit() {
			return {
				...completedResult("image"),
				asset: undefined,
				operation: "text.respond",
				text: JSON.stringify({
					observedText: ["价格 398", "价格 389"],
					conflictingText: ["价格 389"],
				}),
			};
		},
	});
	const observation = await verifier.observe({
		assetId: "image-asset-1",
		expected: ["价格 398"],
		request: harnessInput("image", "package-image"),
		workflowId: "task-image-conflict",
	});
	const assessment = assessImageExactText(observation);

	assert.equal(assessment.passed, false);
	assert.deepEqual(assessment.observed, ["价格 398", "价格 389"]);
	assert.match(assessment.reason, /conflicting/u);
});

function harnessInput(
	kind: "image" | "image_text_note" | "video",
	packageId: string,
	imageOperation:
		| "image.generate"
		| "image.edit"
		| "image.reference_transform" = "image.edit",
	imageReferenceCount = 1,
): HarnessWorkflowInput {
	const sourceAssets = Array.from(
		{
			length:
				kind === "image"
					? imageReferenceCount
					: kind === "image_text_note"
						? 0
						: 1,
		},
		(_, index) => ({
			id: `asset-${index + 1}`,
			revision: `asset-r${index + 1}`,
			role: "reference" as const,
		}),
	);
	const snapshot = createCreationExecutionSnapshot(
		{
			actorId: "owner-1",
			workspaceId: "workspace-1",
			idempotencyKey: `submission-${kind}-1`,
			taskId: `task-${kind}`,
			workId: "work-1",
			contentPackageId: packageId,
			expectedContentPackageRevision: 0,
			creationMode: "customized",
			intent: "把夏日护理项目做成可发布的素材",
			surface: { id: "surface-1", revision: "surface-r1" },
			recipe: { id: `recipe-${kind}-1`, revision: `recipe-${kind}-r1` },
			lens: kind,
			operation:
				kind === "video"
					? "video.generate"
					: kind === "image"
						? imageOperation
						: "image.generate",
			platform: { id: "douyin" },
			contentPackagePlatform: "douyin",
			distributionTarget: "export",
			deliverable: {
				kind:
					kind === "video"
						? "video_package"
						: kind === "image_text_note"
							? "note"
							: "image_set",
				quantity: 1,
				aspectRatio: "9:16",
				...(kind === "video" ? { durationSeconds: 8 } : {}),
				...(kind === "image_text_note" ? { notePageBound: 3 } : {}),
			},
			deliverables: [
				{
					id: `${kind}-main`,
					kind,
					order: 0,
					quantity: 1,
					aspectRatio: "9:16",
					...(kind === "video" ? { durationSeconds: 8 } : {}),
					...(kind === "image_text_note" ? { notePageBound: 3 } : {}),
				},
			],
			sources: {
				assets: sourceAssets,
			},
			rights: { revision: "rights-r1", summary: "authorized" },
			identity: { id: "identity-1", revision: "identity-r1" },
			modelPolicy: { id: "policy-1", revision: "policy-r1", mode: "fixed" },
			catalogModel: { id: `model-${kind}-1`, revision: `model-${kind}-r1` },
			quote: { id: "quote-1", revision: "quote-r1" },
			route: { id: "route-1", revision: "route-r1" },
			briefContext: { id: "brief-context-1", revision: 1 },
			briefConfirmation: { id: "brief-1", revision: "brief-r1" },
			contentModules: ["social_cover"],
		},
		"2026-07-22T09:00:00.000Z",
	);
	return {
		actorId: snapshot.actorId,
		workspaceId: snapshot.workspaceId,
		packageId,
		expectedRevision: snapshot.contentPackage.expectedRevision,
		workflowRevision: snapshot.revision,
		creationMode: snapshot.creationMode,
		rawInput: snapshot.intent.text,
		intent: {
			context: {
				workId: snapshot.work.id,
				intent: snapshot.intent.text,
				sourceSummaries: [],
			},
			assetReferences: sourceAssets.map(({ id }) => id),
		},
		executionSnapshot: snapshot,
	};
}

function mediaBrief(kind: "image"): Extract<ExecutionBrief, { kind: "image" }>;
function mediaBrief(kind: "video"): Extract<ExecutionBrief, { kind: "video" }>;
function mediaBrief(
	kind: "image" | "video",
): Exclude<ExecutionBrief, { kind: "copy" }>;
function mediaBrief(kind: "image" | "video"): Exclude<ExecutionBrief, { kind: "copy" }> {
	if (kind === "image") {
		return imageBriefFor("image.edit", 1);
	}
	return {
		kind,
		firstFramePrompt: "夏日护理项目门店开场，展示明确的品牌主视觉和预约行动号召。",
		storyboard: [
			{
				index: 1,
				description: "门店护理场景与主视觉展示。",
				durationSeconds: 8,
			},
		],
		referenceAssetIds: ["asset-1"],
		parameters: { durationSeconds: 8, ratio: "9:16" },
		constraints: ["不得编造价格"],
	};
}

function imageBriefFor(
	operation:
		| "image.generate"
		| "image.edit"
		| "image.reference_transform",
	referenceCount: number,
): Extract<ExecutionBrief, { kind: "image" }> {
	const referenceAssetIds = Array.from(
		{ length: referenceCount },
		(_, index) => `asset-${index + 1}`,
	);
	return {
		kind: "image",
		intent: {
			operation,
			purpose: "夏日护理活动海报",
			subject: "夏日护理项目",
			scene: "门店护理区",
			composition: "竖版主视觉",
			references: referenceAssetIds.map((assetId, index) => ({
				assetId,
				assetRevision: `asset-r${index + 1}`,
				slot:
					operation === "image.edit"
						? ("work_case" as const)
						: index === 0
							? ("style_ref" as const)
							: ("composition_ref" as const),
				mimeType: "image/png",
				sizeBytes: 1_024,
				factRefs:
					operation === "image.edit" ? ["fact:work-case:1"] : [],
				rightsRefs: [],
			})),
			exactText: [],
			changes:
				operation === "image.edit"
					? [{ target: "layout", instruction: "调整活动信息布局" }]
					: [],
			invariants:
				operation === "image.edit"
					? [
							{
								target: "work_case_surface",
								requirement: "保持真实甲面不变",
							},
						]
					: [],
			factRefs:
				operation === "image.edit" ? ["fact:work-case:1"] : [],
			rightsRefs: [],
			outputPlan: { kind: "single" },
		},
		prompt:
			"为夏日护理项目生成竖版门店活动海报，保留品牌主视觉和预约行动号召。",
		referenceAssetIds,
		parameters: { ratio: "9:16", resolution: "1080p" },
		constraints: ["不得编造价格"],
	};
}

function imageBriefWithExactText(
	text: string,
): Extract<ExecutionBrief, { kind: "image" }> {
	const brief = mediaBrief("image");
	return {
		...brief,
		intent: {
			...brief.intent,
			exactText: [{ text, treatment: "exact" }],
		},
	};
}

function completedResult(
	kind: "image" | "video",
	suffix = "1",
): ModelSupplyResult {
	const attempt = {
		acceptance: "accepted" as const,
		catalogModelId: `model-${kind}-1`,
		createdAt: "2026-07-22T09:00:00.000Z",
		deploymentId: `deployment-${kind}-1`,
		id: `attempt-${kind}-${suffix}`,
		jobId: `job-${kind}-${suffix}`,
		status: "completed" as const,
	};
	const providerCost = {
		amount: 1.2,
		currency: "CNY" as const,
		id: `cost-${kind}-${suffix}`,
		status: "observed" as const,
		usage: { mediaUnits: 1 },
	};
	return {
		jobId: `job-${kind}-${suffix}`,
		status: "completed",
		snapshot: {
			actualCatalogModelId: `model-${kind}-1`,
			catalogRevisionId: `model-${kind}-r1`,
			deploymentId: `deployment-${kind}-1`,
			id: `route-${kind}-1`,
		} as ModelSupplyResult["snapshot"],
		attempt,
		attempts: [attempt],
		asset: {
			contentType: kind === "image" ? "image/png" : "video/mp4",
			id: `${kind}-asset-${suffix}`,
			objectKey: `owned/${kind}-asset-${suffix}`,
			sha256: `${kind}-sha-${suffix}`,
			sizeBytes: 1024,
			sourceTaskRef: `provider-task-${kind}-${suffix}`,
			...(kind === "video"
				? {
						technicalValidation: {
							playable: true,
							codec: "h264" as const,
							durationSeconds: 8,
							hashVerified: true,
							evidenceKind: "measured" as const,
						},
					}
				: {}),
		},
		usage: {
			id: `usage-${kind}-${suffix}`,
			quantity: 0,
			status: "committed",
		},
		providerCost,
		providerCosts: [providerCost],
	};
}

function noteCopyPorts(): HarnessStagePorts {
	const unsupported = async (): Promise<never> => {
		throw new Error("Only intent naming is used by the note test.");
	};
	return {
		async nameIntent() {
			return {
				declaration: {
					normalizedIntent: "介绍夏日护理项目",
					taskType: "daily_service_exposure",
					deliveryLayer: "finished_media",
					relevantAssetCategories: ["product_service"],
					usedAssetCategories: ["product_service"],
					route: "customized",
					routingSource: "model",
					implicitConstraints: [],
				},
				blockingQuestion: null,
			};
		},
		injectContext: unsupported,
		fenceContext: unsupported,
		compileBrief: unsupported,
		executeAndSelect: unsupported,
		assembleAndDeliver: unsupported,
	};
}

function noteRunnerFactory(
	conflictBeforeRegeneration = false,
): HarnessStructuredNodeRunnerFactory {
	return {
		create() {
			let consistencyAttempts = 0;
			return {
				async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
					const payload = JSON.parse(request.prompt) as Record<string, unknown>;
					let output: unknown;
					if (request.schemaName === "harness_note_plan_v1") {
						output = notePlanOutput();
					} else if (request.schemaName === "harness_note_text_block_v1") {
						const page = payload.page as {
							pageRole: string;
							textBlock: { exactText: string[] };
						};
						const style = payload.style as { name: string };
						output = {
							title: `${style.name}-${page.pageRole}`,
							body: `${style.name}说明${page.pageRole}`,
							exactText: page.textBlock.exactText,
						};
					} else if (
						request.schemaName === "harness_note_consistency_v1"
					) {
						const conflict =
							conflictBeforeRegeneration && consistencyAttempts++ === 0;
						output = {
							evaluatedAt: "2026-07-22T09:00:01.000Z",
							dimensions: [
								"theme_continuity",
								"visual_consistency",
								"non_repetition",
								"role_coverage",
								"image_text_cross_reference",
								].map((dimension) => ({
									dimension,
									passed: !conflict,
									reason: `${dimension} passed`,
									pageIds: conflict ? ["page-2"] : [],
								})),
								regenerationPageIds: conflict ? ["page-2"] : [],
							};
					} else {
						throw new Error(`Unexpected schema ${request.schemaName}.`);
					}
					return {
						output: request.schema.parse(output),
						attempts: 1,
						providerTaskRef: `fixture-${request.schemaName}`,
						replayed: false,
						usage: { inputTokens: 1, outputTokens: 1 },
					};
				},
			};
		},
	};
}

function notePlanOutput() {
	const page = (
		id: string,
		order: number,
		pageRole: "cover" | "cta_guide",
		pagePurpose: "capture_attention" | "drive_action",
	) => ({
		id,
		order,
		revision: 1,
		pageRole,
		pagePurpose,
		imageIntent: {
			operation: "image.generate",
			purpose: `${pageRole}配图`,
			subject: "夏日护理项目",
			scene: "真实门店场景",
			composition: "主体清晰",
			references: [],
			exactText: [],
			changes: [],
			invariants: [],
			factRefs: [],
			rightsRefs: [],
			outputPlan: { kind: "single" },
		},
		textBlock: {
			title: `${pageRole}标题`,
			body: `${pageRole}正文`,
			exactText: [],
		},
		dependencies:
			order === 1
				? []
				: [{ pageId: "page-1", kind: "text_sequence" }],
	});
	return {
		schema: "note-plan/v1",
		themeAnchor: "夏日护理项目",
		style: {
			id: "planning",
			name: "规划中",
			positioning: "等待风格选择",
		},
		pages: [
			page("page-1", 1, "cover", "capture_attention"),
			page("page-2", 2, "cta_guide", "drive_action"),
		],
	};
}

function unsupportedCopyPorts(): HarnessStagePorts {
	const unsupported = async (): Promise<never> => {
		throw new Error("Copy stage must not run for a frozen media snapshot.");
	};
	return {
		nameIntent: unsupported,
		injectContext: unsupported,
		fenceContext: unsupported,
		compileBrief: unsupported,
		executeAndSelect: unsupported,
		assembleAndDeliver: unsupported,
	};
}

function contextSnapshot(): HarnessContextSnapshot {
	return {
		bundle: {
			bundleId: "bundle-1",
			revision: 1,
			hash: "a".repeat(64),
			serializerVersion: "context-bundle-c14n-v1",
			workspaceId: "workspace-1",
			taskId: "task-image",
			frozenAt: "2026-07-22T09:00:00.000Z",
			frozenBy: "owner-1",
			previousRevision: null,
			referencedFactRevisions: [],
			sourceRevisions: {
				facts: 0,
				assets: 1,
				identity: 1,
				rights: 1,
				preferences: 0,
				recipe: 1,
				platformRules: 1,
				currentSignal: 1,
			},
			dimensions: {
				promotion_task: {},
				traffic_opportunity: {},
				expression_identity: {},
				platform_mechanism: {},
				store_facts_assets: {},
				conversion_action: {},
			},
		},
		activeFacts: [],
		policyReferences: {
			sourceRefs: [],
			rightsRefs: [
				{
					assetId: "asset-1",
					workspaceId: "workspace-1",
					status: "authorized",
					allowedUses: ["public_content"],
				},
			],
			identityRefs: [
				{
					id: "marketing_identity:identity-1:identity-r1",
					workspaceId: "workspace-1",
					status: "registered",
				},
			],
		},
	};
}

function memoryNoteAdmission(events: string[] = []): NoteMediaAdmissionPort {
	let active: NoteMediaAdmissionToken | undefined;
	let generation = 0;
	return {
		async claim(input) {
			if (active) {
				if (active.workflowId === input.workflowId) return active;
				events.push(`blocked:${input.workflowId}`);
				return null;
			}
			generation += 1;
			active = { ...input, generation };
			events.push(`claim:${input.workflowId}:g${generation}`);
			return active;
		},
		async markRunning(token, jobId) {
			if (active?.generation !== token.generation) return false;
			active = { ...active, jobId };
			events.push(`running:g${token.generation}`);
			return true;
		},
		async markTerminal(token, status) {
			if (active?.generation !== token.generation) return false;
			events.push(`${status}:g${token.generation}`);
			active = undefined;
			return true;
		},
	};
}

function frozenPromptBundle(): HarnessFrozenPrompts {
	return Object.fromEntries(
		Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES).map(([key, name]) => {
			const content = `frozen:${key}`;
			return [
				key,
				{
					name,
					version: "31",
					content,
					contentHash: createHash("sha256").update(content).digest("hex"),
					label: "production",
					source: "langfuse",
					isFallback: false,
				},
			];
		}),
	) as HarnessFrozenPrompts;
}
