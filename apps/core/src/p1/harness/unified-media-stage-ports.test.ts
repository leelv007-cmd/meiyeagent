import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCreationExecutionSnapshot } from "../execution-spine/creation-execution-snapshot.js";
import {
	MemoryContentPackageRevisionWritePort,
	type ContentPackageRevisionWriteInput,
} from "../execution-spine/content-package-revision-port.js";
import type { ModelSupplyResult, ModelSupplySubmission } from "../model-supply/index.js";
import { buildContentPackage } from "../operations/content-package.js";
import type { ExecutionBrief } from "./structured-nodes.js";
import type { HarnessWorkflowInput } from "./task-admission.js";
import {
	HarnessMediaExecutionError,
	type ImageExactTextVerifier,
	ModelSupplyHarnessMediaExecutionPort,
	ModelSupplyImageExactTextVerifier,
	UnifiedHarnessStagePorts,
} from "./unified-media-stage-ports.js";
import { HarnessSelectionError } from "./execution-selection.js";
import { merchantVisibleLanguageIssues } from "./merchant-delivery-language.js";
import type {
	HarnessContextSnapshot,
	HarnessStagePorts,
} from "./workflow-core.js";

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
								ratio: "9:16",
								referenceAssetIds: ["asset-1"],
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
			submissions[0]?.input?.referenceAssetIds?.length,
			referenceCount,
		);
	}
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
		assert.ok(contentPackage?.marketing?.rightsRefs.length);
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

test("exact text blocks the first image, retries once, and keeps both provider costs without job-side debit flags", async () => {
	const submissions: ModelSupplySubmission[] = [];
	let generation = 0;
	let verification = 0;
	const verifier: ImageExactTextVerifier = {
		async verify(input) {
			verification += 1;
			return verification === 1
				? {
						passed: false,
						expected: input.expected,
						observed: ["价格 389"],
						reason: "价格数字不一致",
					}
				: {
						passed: true,
						expected: input.expected,
						observed: ["价格 398"],
						reason: "逐字一致",
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
	const request = harnessInput("image", "package-image");
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
	assert.match(submissions[1]?.prompt ?? "", /价格数字不一致/u);
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
			async verify(input) {
				return {
					passed: false,
					expected: input.expected,
					observed: ["价格 389"],
					reason: "价格数字不一致",
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
				text: JSON.stringify({ observedText: ["价格 398"] }),
			};
		},
	});
	const request = harnessInput("image", "package-image");
	const assessment = await verifier.verify({
		assetId: "image-asset-1",
		expected: ["价格 398"],
		request,
		workflowId: "task-image",
	});

	assert.equal(assessment.passed, true);
	assert.equal(submissions[0]?.operation, "text.respond");
	assert.deepEqual(submissions[0]?.input?.inputAssets, [
		{ assetId: "image-asset-1", role: "reference_image" },
	]);
	assert.equal(
		Object.hasOwn(submissions[0] ?? {}, "productUsageQuantity"),
		false,
	);
});

function harnessInput(
	kind: "image" | "video",
	packageId: string,
	imageOperation:
		| "image.generate"
		| "image.edit"
		| "image.reference_transform" = "image.edit",
	imageReferenceCount = 1,
): HarnessWorkflowInput {
	const sourceAssets = Array.from(
		{ length: kind === "image" ? imageReferenceCount : 1 },
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
			operation: kind === "image" ? imageOperation : "video.generate",
			platform: { id: "douyin" },
			deliverables: [
				{
					id: `${kind}-main`,
					kind,
					order: 0,
					quantity: 1,
					aspectRatio: "9:16",
					...(kind === "video" ? { durationSeconds: 8 } : {}),
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
			rightsRefs: [],
			identityRefs: [],
		},
	};
}
