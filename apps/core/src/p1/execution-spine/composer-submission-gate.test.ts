import assert from "node:assert/strict";
import test from "node:test";
import { pickComposerSubmissionSignedFields } from "@meiye/contracts";

import { briefSourceRevisionId } from "../creation-experience/postgres-brief-revision-context.js";
import { fingerprintValue } from "../job-runtime/job-contracts.js";
import {
	CapabilityHotAssemblyComposerReadiness,
	ComposerSubmissionAdmissionGate,
} from "./composer-submission-gate.js";
import type { ComposerSubmissionRequest } from "./creation-execution-snapshot.js";

test("Composer admission gate binds server facts before a submission can reserve shells", async () => {
	let capabilityChecks = 0;
	const briefChecks: unknown[] = [];
	let sourcePackageRights: "authorized" | "revoked" = "authorized";
	let defaultProjectionEnabled = true;
	const gate = new ComposerSubmissionAdmissionGate({
		assets: {
			async resolve() {
				return [
					{
						assetId: "asset-1",
						bytes: new Uint8Array([1]),
						contentType: "image/jpeg",
						kind: "resolved",
						providerReadableUrl: "data:image/jpeg;base64,AQ==",
						sha256: "asset-r2",
					},
				];
			},
		},
		briefs: {
			async assertCurrent(input) {
				briefChecks.push(structuredClone(input));
			},
		},
		briefConfirmations: {
			async getBriefConfirmation() {
				return {
					confirmedAt: "2026-07-22T09:00:00.000Z",
					boundRevisions: {
						draftRevisionId: "brief-r2",
						lensId: "copy",
						modelRevisionId: "catalog-r4",
						quoteRevisionId: "quote-r5",
						recipeRevisionId: "recipe-service-promotion@7",
						sourceRevisionId: briefSourceRevisionId([
							"asset-1",
							"content-source-1",
						]),
						surfaceRevisionId: "surface-composer@2",
					},
					triggerCodes: [],
				} as never;
			},
		},
		capabilities: {
			async assertReady() {
				capabilityChecks += 1;
			},
		},
		catalog: {
			async getRecipeByRevisionId() {
				return {
					contextPatches: { contentModules: ["social_cover"] },
					delivery: {
						contentPackagePlatform: "douyin",
						distributionTarget: "export",
						deliverableKind: "copy_document",
						quantity: 1,
					},
					lensId: "copy",
					modelPolicy: { catalogModelId: "catalog-copy-1", mode: "fixed" },
					presentation: { title: "促销文案", summary: "生成促销文案" },
					promptRevisionRef: "prompt-copy@1",
					recipeId: "recipe-service-promotion",
					revisionId: "recipe-service-promotion@7",
					sourceRequirements: [
						{ kinds: ["image"], required: true, slot: "hero" },
					],
					status: "published",
					targetWorkspaceKind: "copy",
				} as never;
			},
			async getSurfaceByRevisionId() {
				return {
					recipeRefs: [
						{
							featured: true,
							lensId: "copy",
							order: 0,
							recipeRevisionId: "recipe-service-promotion@7",
							visible: true,
						},
					],
					surfaceId: "surface-composer",
					revisionId: "surface-composer@2",
					status: "published",
				} as never;
			},
		},
		identities: {
			async listActive() {
				return [{ identityId: "identity-brand", version: 3 }] as never;
			},
			async project() {
				return {
					identities: [],
					defaultDecision: defaultProjectionEnabled
						? {
								decisionId: "default-decision-1",
								decisionRevision: 7,
								identity: { identityId: "identity-brand", version: 3 },
							}
						: null,
					defaultIdentity: defaultProjectionEnabled
						? { identityId: "identity-brand", version: 3 }
						: null,
					decisionRevision: 7,
				} as never;
			},
		},
		quotes: {
			async getQuote() {
				return {
					catalogModelId: "catalog-copy-1",
					catalogModelRevision: "catalog-r4",
					lifecycleStatus: "quoted",
					quoteId: "quote-1",
					revision: "quote-r5",
					routeSnapshotRef: "route-1",
					submissionContractHash: fingerprintValue(
						pickComposerSubmissionSignedFields(submission()),
					),
				} as never;
			},
			async confirm(input) {
				return { lifecycleStatus: "confirmed", taskId: input.taskId } as never;
			},
		},
		rights: {
			async resolve() {
				return { knownAssetIds: ["asset-1"], unauthorizedAssetIds: [] };
			},
		},
		routeResolver: {
			async resolve() {
				return {
					allowedCandidates: [
						{ catalogModelId: "catalog-copy-1", deploymentId: "deployment-1" },
					],
					catalogRevision: "catalog-r4",
					id: "route-1",
					requestedCatalogModelId: "catalog-copy-1",
					selectionMode: "fixed",
					workspaceId: "workspace-1",
				} as never;
			},
		},
		sourcePackages: {
			async get() {
				return {
					id: "content-source-1",
					revision: "content-r3",
					rightsState: sourcePackageRights,
					status: "accepted",
					workspaceId: "workspace-1",
				};
			},
		},
	});

	const admitted = await gate.admit(defaultSubmission());
	assert.match(admitted.taskId, /^composer-task:[a-f0-9]{64}$/u);
	assert.deepEqual(admitted.modelPolicy, {
		id: "recipe-model-policy:recipe-service-promotion",
		mode: "fixed",
		revision: "recipe-service-promotion@7",
	});
	assert.deepEqual(admitted.route, {
		id: "route-1",
		revision: "catalog-r4",
	});
	assert.deepEqual(admitted.identityDecision, {
		id: "default-decision-1",
		revision: 7,
	});
	assert.match(admitted.rights.revision, /^rights:[a-f0-9]{64}$/u);
	assert.equal(
		admitted.rights.summary,
		"Server verified 1 source asset in workspace workspace-1.",
	);
	assert.equal(capabilityChecks, 1);
	assert.deepEqual(admitted.recipeBinding, {
		contentModules: ["social_cover"],
		deliverables: [
			{
				id: "recipe-deliverable:recipe-service-promotion@7",
				kind: "copy",
				order: 0,
				quantity: 1,
			},
		],
		lens: "copy",
	});
	assert.deepEqual(briefChecks, [
		{
			briefConfirmationId: "brief-confirmation-1",
			briefContextId: "brief-context-1",
			catalogModelId: "catalog-copy-1",
			catalogRevision: "catalog-r4",
			expectedContextRevision: 4,
			intent: "为夏日护理项目写一条预约文案",
			operation: "copy.generate",
			outputCount: 1,
			quoteRevision: "quote-r5",
			sourceReferenceIds: ["asset-1", "content-source-1"],
			workspaceId: "workspace-1",
		},
	]);

	defaultProjectionEnabled = false;
	await assert.rejects(
		gate.admit(defaultSubmission()),
		/default decision is missing, stale, or does not match/u,
	);
	defaultProjectionEnabled = true;

	await assert.rejects(
		gate.admit({
			...submission(),
			contentPackagePlatform: "xiaohongshu",
		}),
		/exact submitted fields/u,
	);
	assert.equal(capabilityChecks, 1);

	sourcePackageRights = "revoked";
	await assert.rejects(
		gate.admit(submission()),
		/Source ContentPackage is missing, cross-workspace, or at a different revision/u,
	);
	assert.equal(capabilityChecks, 1);
	assert.equal(briefChecks.length, 1);
});

test("Composer admission gate fails closed for stale quote, rights, and source facts", async () => {
	let capabilityChecks = 0;
	const gate = new ComposerSubmissionAdmissionGate({
		assets: {
			async resolve() {
				return [
					{
						assetId: "asset-1",
						kind: "failure",
						reason: "authorization_withdrawn",
					},
				];
			},
		},
		briefs: { async assertCurrent() {} },
		briefConfirmations: {
			async getBriefConfirmation() {
				return null;
			},
		},
		capabilities: {
			async assertReady() {
				capabilityChecks += 1;
			},
		},
		catalog: {
			async getRecipeByRevisionId() {
				return null;
			},
			async getSurfaceByRevisionId() {
				return null;
			},
		},
		identities: {
			async listActive() {
				return [];
			},
		},
		quotes: {
			async getQuote() {
				return null;
			},
		},
		rights: {
			async resolve() {
				return { knownAssetIds: [], unauthorizedAssetIds: ["asset-1"] };
			},
		},
		routeResolver: {
			async resolve() {
				return null;
			},
		},
		sourcePackages: {
			async get() {
				return null;
			},
		},
	});

	await assert.rejects(gate.admit(submission()), /Recipe revision/u);
	assert.equal(capabilityChecks, 0);
});

test("Composer admission derives image and video delivery facts from the published Recipe before the brief gate", async () => {
	for (const kind of ["image", "video"] as const) {
		const briefChecks: unknown[] = [];
		const input = mediaSubmission(kind);
		const recipeLens = kind === "image" ? "image_text" : "video";
		const gate = new ComposerSubmissionAdmissionGate({
			assets: {
				async resolve() {
					return [
						{
							assetId: "asset-1",
							bytes: new Uint8Array([1]),
							contentType: kind === "image" ? "image/jpeg" : "video/mp4",
							kind: "resolved",
							providerReadableUrl: "data:application/octet-stream;base64,AQ==",
							sha256: "asset-r2",
						},
					];
				},
			},
			briefs: {
				async assertCurrent(value) {
					briefChecks.push(structuredClone(value));
				},
			},
			briefConfirmations: {
				async getBriefConfirmation() {
					return {
						confirmedAt: "2026-07-22T09:00:00.000Z",
						boundRevisions: {
							draftRevisionId: "brief-r2",
							lensId: recipeLens,
							modelRevisionId: `catalog-${kind}-r1`,
							quoteRevisionId: "quote-r5",
							recipeRevisionId: `recipe-${kind}@1`,
							sourceRevisionId: briefSourceRevisionId(["asset-1"]),
							surfaceRevisionId: `surface-${kind}@1`,
						},
						triggerCodes: [],
					} as never;
				},
			},
			capabilities: { async assertReady() {} },
			catalog: {
				async getRecipeByRevisionId() {
					return {
						contextPatches:
							kind === "image"
								? {}
								: { contentModules: ["social_cover", "price_card"] },
						delivery: {
							aspectRatio: "9:16",
							contentPackagePlatform:
								kind === "image" ? "xiaohongshu" : "video_account",
							distributionTarget: "export",
							deliverableKind: kind === "image" ? "image_set" : "video_package",
							...(kind === "video" ? { durationSeconds: 8 } : {}),
							quantity: 2,
						},
						lensId: recipeLens,
						modelPolicy:
							kind === "image"
								? { mode: "auto" }
								: { catalogModelId: `catalog-${kind}-1`, mode: "fixed" },
						presentation: { title: `${kind} title`, summary: `${kind} summary` },
						promptRevisionRef: `prompt-${kind}@1`,
						recipeId: `recipe-${kind}`,
						revisionId: `recipe-${kind}@1`,
						sourceRequirements: [
							{ kinds: [kind], required: true, slot: "primary_reference" },
						],
						status: "published",
						targetWorkspaceKind: recipeLens,
					} as never;
				},
				async getSurfaceByRevisionId() {
					return {
						recipeRefs: [
							{
								featured: true,
								lensId: recipeLens,
								order: 0,
								recipeRevisionId: `recipe-${kind}@1`,
								visible: true,
							},
						],
						surfaceId: `surface-${kind}`,
						revisionId: `surface-${kind}@1`,
						status: "published",
					} as never;
				},
			},
			identities: {
				async listActive() {
					return [{ identityId: "identity-brand", version: 3 }] as never;
				},
			},
			quotes: {
				async getQuote() {
					return {
						catalogModelId: `catalog-${kind}-1`,
						catalogModelRevision: `catalog-${kind}-r1`,
						lifecycleStatus: "quoted",
						quoteId: "quote-1",
						revision: "quote-r5",
						routeSnapshotRef: `route-${kind}-1`,
						submissionContractHash: fingerprintValue(
							pickComposerSubmissionSignedFields(input),
						),
					} as never;
				},
				async confirm(confirmInput) {
					return {
						lifecycleStatus: "confirmed",
						taskId: confirmInput.taskId,
					} as never;
				},
			},
			rights: {
				async resolve() {
					return { knownAssetIds: ["asset-1"], unauthorizedAssetIds: [] };
				},
			},
			routeResolver: {
				async resolve() {
					return {
						allowedCandidates: [
							{
								catalogModelId: `catalog-${kind}-1`,
								deploymentId: `deployment-${kind}-1`,
							},
						],
						catalogRevision: `catalog-${kind}-r1`,
						id: `route-${kind}-1`,
						requestedCatalogModelId: `catalog-${kind}-1`,
						selectionMode: "fixed",
						workspaceId: "workspace-1",
					} as never;
				},
			},
			sourcePackages: {
				async get() {
					return null;
				},
			},
		});

		const admitted = await gate.admit(input);
		assert.match(admitted.taskId, /^composer-task:[a-f0-9]{64}$/u);
		assert.equal(admitted.modelPolicy.mode, "fixed");
		assert.deepEqual(admitted.recipeBinding, {
			contentModules:
				kind === "image" ? ["social_cover"] : ["social_cover", "price_card"],
			deliverables: [
				{
					id: `recipe-deliverable:recipe-${kind}@1`,
					kind,
					order: 0,
					quantity: 2,
					aspectRatio: "9:16",
					...(kind === "video" ? { durationSeconds: 8 } : {}),
				},
			],
			lens: kind,
		});
		assert.deepEqual(briefChecks, [
			{
				briefConfirmationId: "brief-confirmation-1",
				briefContextId: "brief-context-1",
				catalogModelId: `catalog-${kind}-1`,
				catalogRevision: `catalog-${kind}-r1`,
				expectedContextRevision: 4,
				intent: "为夏日护理项目写一条预约文案",
				operation: kind === "image" ? "image.edit" : "video.generate",
				outputCount: 2,
				quoteRevision: "quote-r5",
				sourceReferenceIds: ["asset-1"],
				workspaceId: "workspace-1",
				aspectRatio: "9:16",
				...(kind === "video" ? { durationSeconds: 8 } : {}),
			},
		]);
	}
});

test("Composer capability readiness only reads an accepting route channel", async () => {
	const requests: unknown[] = [];
	const readiness = new CapabilityHotAssemblyComposerReadiness({
		async assembleForRequest(input) {
			requests.push(input);
			return {
				channelLifecycle: {
					channelId: "channel-1",
					drainMode: "none",
					inFlightCount: 0,
					lifecycleRevision: "lifecycle-r1",
					mode: "accepting",
					reason: "ready",
					startedAt: "2026-07-22T09:00:00.000Z",
				},
			} as never;
		},
	});

	await readiness.assertReady({
		catalogModel: { id: "catalog-copy-1", revision: "catalog-r4" },
		route: {
			allowedCandidates: [
				{
					catalogModelId: "catalog-copy-1",
					credentialMode: "platform",
					deploymentId: "deployment-1",
				},
			],
		} as never,
	});
	assert.deepEqual(requests, [
		{ deploymentId: "deployment-1", requiredScope: "platform" },
	]);
	const blocked = new CapabilityHotAssemblyComposerReadiness({
		async assembleForRequest() {
			return {
				channelLifecycle: {
					channelId: "channel-1",
					drainMode: "drain_new_submissions",
					inFlightCount: 0,
					lifecycleRevision: "lifecycle-r2",
					mode: "draining",
					reason: "maintenance",
					startedAt: "2026-07-22T09:00:00.000Z",
				},
			} as never;
		},
	});
	await assert.rejects(
		blocked.assertReady({
			catalogModel: { id: "catalog-copy-1", revision: "catalog-r4" },
			route: {
				allowedCandidates: [
					{
						catalogModelId: "catalog-copy-1",
						credentialMode: "platform",
						deploymentId: "deployment-1",
					},
				],
			} as never,
		}),
		/accepting capability channel/u,
	);
});

function submission(): ComposerSubmissionRequest {
	return {
		actorId: "owner-1",
		briefConfirmation: { id: "brief-confirmation-1", revision: "brief-r2" },
		briefContext: { id: "brief-context-1", revision: 4 },
		catalogModel: { id: "catalog-copy-1", revision: "catalog-r4" },
		contentPackagePlatform: "douyin",
		distributionTarget: "export",
		deliverable: { kind: "copy_document", quantity: 1 },
		creationMode: "customized",
		contentModules: ["social_cover"],
		deliverables: [{ id: "copy-main", kind: "copy", order: 1, quantity: 1 }],
		identity: { id: "identity-brand", revision: "3" },
		idempotencyKey: "submit-1",
		intent: "为夏日护理项目写一条预约文案",
		lens: "copy",
		modelPolicy: { id: "policy-copy", mode: "fixed", revision: "policy-r1" },
		quote: { id: "quote-1", revision: "quote-r5" },
		recipe: {
			id: "recipe-service-promotion",
			revision: "recipe-service-promotion@7",
		},
		rights: { revision: "rights-r4", summary: "source assets are authorized" },
		route: { id: "route-1", revision: "catalog-r4" },
		sources: {
			assets: [{ id: "asset-1", revision: "asset-r2", role: "reference" }],
			contentPackage: { id: "content-source-1", revision: "content-r3" },
		},
		surface: { id: "surface-composer", revision: "surface-composer@2" },
		workspaceId: "workspace-1",
	};
}

function defaultSubmission(): ComposerSubmissionRequest {
	return {
		...submission(),
		identityDecision: { id: "default-decision-1", revision: 7 },
	};
}

function mediaSubmission(kind: "image" | "video"): ComposerSubmissionRequest {
	return {
		...submission(),
		catalogModel: { id: `catalog-${kind}-1`, revision: `catalog-${kind}-r1` },
		contentPackagePlatform:
			kind === "image" ? "xiaohongshu" : "video_account",
		distributionTarget: "export",
		deliverable: {
			kind: kind === "image" ? "image_set" : "video_package",
			quantity: 2,
			aspectRatio: "9:16",
			...(kind === "video" ? { durationSeconds: 8 } : {}),
		},
		deliverables: [
			{
				id: `browser-${kind}-main`,
				kind,
				order: 1,
				quantity: 1,
				aspectRatio: "1:1",
				...(kind === "video" ? { durationSeconds: 3 } : {}),
			},
		],
		lens: kind,
		modelPolicy: { id: `policy-${kind}`, mode: "fixed", revision: "policy-r1" },
		recipe: { id: `recipe-${kind}`, revision: `recipe-${kind}@1` },
		route: { id: `route-${kind}-1`, revision: `catalog-${kind}-r1` },
		sources: {
			assets: [{ id: "asset-1", revision: "asset-r2", role: "reference" }],
		},
		surface: { id: `surface-${kind}`, revision: `surface-${kind}@1` },
	};
}
