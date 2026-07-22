import assert from "node:assert/strict";
import test from "node:test";

import { briefSourceRevisionId } from "../creation-experience/postgres-brief-revision-context.js";
import {
	CapabilityHotAssemblyComposerReadiness,
	ComposerSubmissionAdmissionGate,
} from "./composer-submission-gate.js";
import type { ComposerSubmissionRequest } from "./creation-execution-snapshot.js";

test("Composer admission gate binds server facts before a submission can reserve shells", async () => {
	let capabilityChecks = 0;
	const briefChecks: unknown[] = [];
	let sourcePackageRights: "authorized" | "revoked" = "authorized";
	let publishedRecipe: {
		contextPatches: { contentModules: string[] };
		delivery: { deliverableKind: string; platform: string; quantity: number };
		lensId: string;
		modelPolicy: { catalogModelId: string; mode: string };
		recipeId: string;
		revisionId: string;
		sourceRequirements: Array<{ kinds: string[]; required: boolean; slot: string }>;
		status: string;
		targetWorkspaceKind: string;
	} = {
		contextPatches: { contentModules: ["social_cover"] },
		delivery: {
			deliverableKind: "copy_document",
			platform: "douyin",
			quantity: 1,
		},
		lensId: "copy",
		modelPolicy: { catalogModelId: "catalog-copy-1", mode: "fixed" },
		recipeId: "recipe-service-promotion",
		revisionId: "recipe-service-promotion@7",
		sourceRequirements: [{ kinds: ["image"], required: true, slot: "hero" }],
		status: "published",
		targetWorkspaceKind: "copy",
	};
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
						sourceRevisionId: briefSourceRevisionId(["asset-1", "content-source-1"]),
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
				return publishedRecipe as never;
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
		},
		quotes: {
			async getQuote() {
				return {
					catalogModelId: "catalog-copy-1",
					catalogModelRevision: "catalog-r4",
					lifecycleStatus: "confirmed",
					quoteId: "quote-1",
					revision: "quote-r5",
					routeSnapshotRef: "route-1",
					taskId: "task-confirmed-1",
				} as never;
			},
		},
		rights: {
			async resolve() {
				return { unauthorizedAssetIds: [] };
			},
		},
		routes: {
			async getRouteSnapshot() {
				return {
					allowedCandidates: [{ catalogModelId: "catalog-copy-1", deploymentId: "deployment-1" }],
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

	const admitted = await gate.admit(submission());
	assert.equal(admitted.taskId, "task-confirmed-1");
	assert.deepEqual(admitted.modelPolicy, {
		id: "recipe-model-policy:recipe-service-promotion",
		mode: "fixed",
		revision: "recipe-service-promotion@7",
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
		platform: { id: "douyin" },
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

	sourcePackageRights = "revoked";
	await assert.rejects(
		gate.admit(submission()),
		/Source ContentPackage is missing, cross-workspace, or at a different revision/u,
	);
	assert.equal(capabilityChecks, 1);
	assert.equal(briefChecks.length, 1);

	sourcePackageRights = "authorized";
	publishedRecipe = {
		...publishedRecipe,
		delivery: { ...publishedRecipe.delivery, platform: "wechat_moments" },
	};
	await assert.rejects(
		gate.admit(submission()),
		/Published Recipe must declare a supported delivery platform/u,
	);
	assert.equal(capabilityChecks, 1);
	assert.equal(briefChecks.length, 1);

	publishedRecipe = {
		...publishedRecipe,
		delivery: {
			...publishedRecipe.delivery,
			deliverableKind: "note",
			platform: "douyin",
		},
	};
	await assert.rejects(
		gate.admit(submission()),
		/Published Copy Recipe must declare a copy_document delivery kind/u,
	);
	assert.equal(capabilityChecks, 1);
	assert.equal(briefChecks.length, 1);

	publishedRecipe = {
		...publishedRecipe,
		delivery: {
			...publishedRecipe.delivery,
			deliverableKind: "copy_document",
			quantity: 2,
		},
	};
	await assert.rejects(
		gate.admit(submission()),
		/Published Copy Recipe must declare exactly one copy document/u,
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
		briefConfirmations: { async getBriefConfirmation() { return null; } },
		capabilities: { async assertReady() { capabilityChecks += 1; } },
		catalog: {
			async getRecipeByRevisionId() { return null; },
			async getSurfaceByRevisionId() { return null; },
		},
		identities: { async listActive() { return []; } },
		quotes: { async getQuote() { return null; } },
		rights: {
			async resolve() {
				return { knownAssetIds: [], unauthorizedAssetIds: ["asset-1"] };
			},
		},
		routes: { async getRouteSnapshot() { return null; } },
		sourcePackages: { async get() { return null; } },
	});

	await assert.rejects(gate.admit(submission()), /Recipe revision/u);
	assert.equal(capabilityChecks, 0);
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
		contentModules: ["social_cover"],
		deliverables: [{ id: "copy-main", kind: "copy", order: 1, quantity: 1 }],
		identity: { id: "identity-brand", revision: "3" },
		idempotencyKey: "submit-1",
		intent: "为夏日护理项目写一条预约文案",
		lens: "copy",
		modelPolicy: { id: "policy-copy", mode: "fixed", revision: "policy-r1" },
		platform: { id: "douyin" },
		quote: { id: "quote-1", revision: "quote-r5" },
		recipe: { id: "recipe-service-promotion", revision: "recipe-service-promotion@7" },
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
