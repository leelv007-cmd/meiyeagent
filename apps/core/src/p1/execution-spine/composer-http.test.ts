import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
	isComposerVariantPlatform,
	planConfirmationDecisionSchema,
	pickComposerSubmissionSignedFields,
	type ContentPackage,
	type DiagnosticRun,
	type PlanConfirmationDecision,
} from "@meiye/contracts";

import type { DiagnosticRepository } from "../../diagnostics/repository.js";
import { createCoreServer, streamWorkflowEvents } from "../../server.js";
import { executionConfirmationAuthorityRequestId } from "../agent-session/execution-confirmation-authority.js";
import { computeExecutionPlanSnapshotHash } from "../harness/execution-plan-admission.js";
import { buildContentPackage } from "../operations/content-package.js";
import {
	WorkflowEventApplicationService,
	type WorkflowEventFrame,
	type WorkflowEventSource,
} from "../workflow-events.js";
import { toHarnessWorkflowInput } from "./creation-stage-port.js";
import { ProductQuoteService } from "../product-billing/quote-service.js";
import { triggersPaidMediaExecution } from "../harness/workflow-core.js";
import { ComposerPlanSessionCoordinator } from "../agent-session/composer-plan-session.js";
import { MemoryAgentSessionStore } from "../agent-session/memory-agent-session-store.js";
import {
	createFixturePlanCompilerPorts,
	PlanCompiler,
} from "../agent-session/plan-compiler.js";
import { MemoryMarketingPlanStore } from "../agent-session/memory-plan-store.js";
import {
	CampaignPaidWorkProducer,
	projectCampaignWeeklySlots,
} from "../goal-proactive/campaign-weekly-schedule.js";
import type { ComposerSubmissionBody } from "./creation-execution-snapshot.js";
import {
	asAgentThreadIdentity,
	CreationSubmissionCoordinator,
	type CreationSubmissionAdmissionPort,
	type CreationSubmissionHarnessStarter,
	type CreationSubmissionRecord,
	type CreationSubmissionStore,
	type CreationSubmissionStoreClaim,
} from "./submission-coordinator.js";

const diagnostics: DiagnosticRepository = {
	async create(run: DiagnosticRun) {
		return run;
	},
	async get() {
		return null;
	},
	async save(run: DiagnosticRun) {
		return run;
	},
};

test("Core Composer HTTP freezes explicit selections, resumes SSE, and exposes only the public ContentPackage projection", async (t) => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		fixedAdmission(),
	);
	const contentPackage = packageWithPrivateProviderFields();
	const cursors: Array<string | undefined> = [];
	const server = createCoreServer({
		composerSubmission: { coordinator },
		contentPackageReader: {
			async read(context, packageId) {
				if (
					context.workspaceId !== "workspace-1" ||
					packageId !== "package-1"
				) {
					throw new Error("ContentPackage was not found.");
				}
				return contentPackage;
			},
		},
		diagnosticRepository: diagnostics,
		serviceToken: "composer-test-token",
		workflowEvents: new WorkflowEventApplicationService(fixtureEvents(cursors)),
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => server.close());
	const { port } = server.address() as AddressInfo;
	const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/composer`;
	const headers = {
		"content-type": "application/json",
		"x-service-token": "composer-test-token",
		"x-user-id": "owner-1",
		"x-workspace-id": "workspace-1",
		"x-workspace-role": "owner",
	};
	const wrongMethod = await fetch(`${base}/submissions`, { headers });
	assert.equal(wrongMethod.status, 405);

	const unauthenticated = await fetch(`${base}/submissions`, {
		method: "POST",
		body: JSON.stringify(submissionPayload()),
	});
	assert.equal(unauthenticated.status, 401);

	const forbidden = await fetch(`${base}/submissions`, {
		method: "POST",
		headers: { ...headers, "x-workspace-role": "reviewer" },
		body: JSON.stringify(submissionPayload()),
	});
	assert.equal(forbidden.status, 403);

	const invalidScope = await fetch(`${base}/submissions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			...submissionPayload(),
			identity: { id: "", revision: "identity-r3" },
		}),
	});
	assert.equal(invalidScope.status, 400);
	assert.equal(starter.starts.length, 0);

	const clientAssignedShell = await fetch(`${base}/submissions`, {
		method: "POST",
		headers,
		body: JSON.stringify({ ...submissionPayload(), taskId: "browser-task-id" }),
	});
	assert.equal(clientAssignedShell.status, 400);
	assert.equal(starter.starts.length, 0);

	const submitted = await fetch(`${base}/submissions`, {
		method: "POST",
		headers,
		body: JSON.stringify(submissionPayload()),
	});
	assert.equal(submitted.status, 202);
	const submittedBody = await submitted.json();
	assert.deepEqual(submittedBody.data, {
		contentPackage: { id: "package-1", expectedRevision: 0 },
		replayed: false,
		snapshot: {
			id: "snapshot-task-1",
			identity: { id: "identity-brand", revision: "identity-r3" },
			schemaVersion: "creation-execution-snapshot/v1",
		},
		task: { id: "task-1" },
		// Browser contract: only `id` — the web client parses this strictly,
		// and leaking coordinator-internal `units` broke every submission.
		usageReservation: { id: "usage-reservation-task-1" },
		work: { id: "work-1" },
	});
	assert.equal(starter.starts.length, 1);
	assert.equal(starter.starts[0]?.snapshot.lens, "copy");
	assert.equal(starter.starts[0]?.snapshot.platform.id, "douyin");
	assert.equal(
		starter.starts[0]?.snapshot.contentPackagePlatform,
		submissionPayload().contentPackagePlatform,
	);
	assert.equal(
		starter.starts[0]?.snapshot.distributionTarget,
		submissionPayload().distributionTarget,
	);
	assert.deepEqual(
		starter.starts[0]?.snapshot.deliverable,
		submissionPayload().deliverable,
	);
	assert.deepEqual(
		starter.starts[0]?.snapshot.signedSubmission,
		pickComposerSubmissionSignedFields(submissionPayload()),
	);
	assert.deepEqual(starter.starts[0]?.snapshot.deliverables, [
		{
			aspectRatio: "3:4",
			id: "recipe-deliverable-r7",
			kind: "copy",
			order: 0,
			quantity: 1,
		},
	]);
	assert.deepEqual(starter.starts[0]?.snapshot.recipe, {
		id: "recipe-service-promotion",
		revision: "recipe-r7",
	});
	assert.deepEqual(starter.starts[0]?.snapshot.rights, {
		revision: "server-rights-r1",
		summary: "Server verified source assets.",
	});
	assert.deepEqual(starter.starts[0]?.snapshot.modelPolicy, {
		id: "server-policy-copy",
		mode: "fixed",
		revision: "server-policy-r1",
	});
	assert.equal(
		JSON.stringify(starter.starts[0]?.snapshot).includes("provider-secret"),
		false,
	);

	const {
		contentModules: _contentModules,
		deliverables: _deliverables,
		lens: _lens,
		modelPolicy: _modelPolicy,
		rights: _rights,
		route: _route,
		...browserOwnedPayload
	} = submissionPayload();
	const minimalBrowserReplay = await fetch(`${base}/submissions`, {
		method: "POST",
		headers,
		body: JSON.stringify(browserOwnedPayload),
	});
	assert.equal(
		minimalBrowserReplay.status,
		202,
		JSON.stringify(await minimalBrowserReplay.clone().json()),
	);
	assert.equal((await minimalBrowserReplay.json()).data.replayed, true);
	assert.equal(starter.starts.length, 1);

	const reorderedPayload = Object.fromEntries(
		Object.entries(submissionPayload()).reverse(),
	);
	const replayed = await fetch(`${base}/submissions`, {
		method: "POST",
		headers,
		body: JSON.stringify(reorderedPayload),
	});
	assert.equal(replayed.status, 202);
	assert.equal((await replayed.json()).data.replayed, true);
	assert.equal(starter.starts.length, 1);

	const clientRightsChanged = await fetch(`${base}/submissions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			...submissionPayload(),
			rights: { revision: "browser-random", summary: "untrusted browser summary" },
		}),
	});
	assert.equal(clientRightsChanged.status, 202);
	assert.equal((await clientRightsChanged.json()).data.replayed, true);
	assert.equal(starter.starts.length, 1);

	const signedPlatformChanged = await fetch(`${base}/submissions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			...submissionPayload(),
			contentPackagePlatform: "xiaohongshu",
		}),
	});
	assert.equal(signedPlatformChanged.status, 409);
	assert.equal(starter.starts.length, 1);

	const events = await fetch(`${base}/tasks/task-1/events`, {
		headers: { ...headers, "last-event-id": "task-1:progress:1" },
	});
	assert.equal(events.status, 200);
	const eventBody = await events.text();
	assert.equal(
		(eventBody.match(/event: workflow\.progress/gu) ?? []).length,
		5,
	);
	assert.match(eventBody, /event: workflow\.state/u);
	assert.match(eventBody, /id: task-1:progress:0/u);
	assert.match(eventBody, /"platforms":\["douyin"\]/u);
	assert.match(eventBody, /"deliverables":\["copy_revision:1"\]/u);
	assert.deepEqual(cursors, ["task-1:progress:1"]);

	const projection = await fetch(`${base}/content-packages/package-1`, {
		headers,
	});
	assert.equal(projection.status, 200);
	const projectionBody = await projection.text();
	assert.match(projectionBody, /"runId":"run-1"/u);
	assert.doesNotMatch(projectionBody, /provider-secret/u);
	assert.doesNotMatch(projectionBody, /route-secret/u);
	assert.doesNotMatch(projectionBody, /providerCost/u);
});

test("AI cover admission freezes structured choices and reaches the paid-media confirmation gate", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		modalityAdmission(),
	);
	const payload: ComposerSubmissionBody = {
		...modalitySubmissionPayload("image"),
		aiCover: {
			aspectRatio: "9:16",
			style: "beauty_editorial",
			size: "1152x2048",
		},
		deliverable: {
			kind: "poster",
			quantity: 1,
			aspectRatio: "9:16",
		},
		imageOperation: "image.generate",
		idempotencyKey: "composer-ai-cover-1",
		recipe: {
			id: "recipe.promotion_poster",
			revision: "recipe-promotion-poster-r1",
		},
	};

	await coordinator.submit({
		...payload,
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});

	const started = starter.starts[0];
	assert.ok(started);
	assert.deepEqual(started.snapshot.signedSubmission?.aiCover, payload.aiCover);
	assert.deepEqual(
		submissions.reservedUnits("workspace-1", payload.idempotencyKey),
		[{ resource: "image", quantity: 1 }],
	);
	assert.equal(
		triggersPaidMediaExecution(
			toHarnessWorkflowInput(
				started.snapshot,
				started.usageReservation,
				started.decisionReferences,
			),
		),
		true,
	);
});

test("viral adapt freezes a clean merchant intent and one server-validated structured source", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		modalityAdmission(),
	);
	const payload: ComposerSubmissionBody = {
		...modalitySubmissionPayload("image_text_note"),
		idempotencyKey: "composer-viral-adapt-1",
		intent: "请为本店项目复刻一篇小红书爆款笔记，参考素材已由商家确认。",
		recipe: {
			id: "recipe.viral_adapt",
			revision: "recipe.viral_adapt@2",
		},
		sources: {
			assets: [
				{
					id: "asset-reference-1",
					revision: "asset-reference-r1",
					role: "reference",
				},
			],
		},
		viralAdaptSource: {
			schemaVersion: "viral-adapt-source/v1",
			track: "paste",
			noteText:
				"RAW_NOTE_TOKEN_9f71 https://xhs.invalid/explore/private-note?xsec_token=SECRET",
			authorizedAssetIds: ["asset-reference-1"],
		},
	};

	await coordinator.submit({
		...payload,
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});

	const snapshot = starter.starts[0]?.snapshot;
	assert.ok(snapshot);
	assert.deepEqual(snapshot.viralAdaptSource, payload.viralAdaptSource);
	assert.deepEqual(snapshot.signedSubmission?.viralAdaptSource, payload.viralAdaptSource);
	assert.doesNotMatch(
		snapshot.intent.text,
		/\[viral_adapt_source:|asset-reference-1|RAW_NOTE_TOKEN_9f71|https:\/\/|xsec_token|SECRET/u,
	);

	await assert.rejects(
		coordinator.submit({
			...payload,
			actorId: "owner-1",
			idempotencyKey: "composer-viral-adapt-outside-source",
			viralAdaptSource: {
				...payload.viralAdaptSource!,
				authorizedAssetIds: ["asset-outside-frozen-sources"],
			},
			workspaceId: "workspace-1",
		}),
		/Viral adapt reference images must belong to the submitted source set/u,
	);
});

test("authenticated Composer HTTP carries all four output kinds through one snapshot, SSE, and public package contract", async (t) => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	let sequence = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		{
			createId(prefix) {
				if (prefix === "work") {
					sequence += 1;
					return `work-${sequence}`;
				}
				return `package-${sequence}`;
			},
			now() {
				return "2026-07-22T09:00:00.000Z";
			},
		},
		modalityAdmission(),
	);
	const server = createCoreServer({
		composerSubmission: { coordinator },
		contentPackageReader: {
			async read(_context, packageId) {
				const started = starter.starts.find(
					(start) => start.snapshot.contentPackage.id === packageId,
				);
				if (!started) throw new Error("ContentPackage was not found.");
				const snapshot = started.snapshot;
				return {
					...buildContentPackage({
						id: packageId,
						kind: snapshot.lens === "video" ? "video" : "image_text",
						source: {
							assetIds: snapshot.sources.assets.map((asset) => asset.id),
							creationExecutionSnapshot: {
								id: snapshot.id,
								revision: snapshot.revision,
								schemaVersion: snapshot.schemaVersion,
							},
							...(isComposerVariantPlatform(
								snapshot.contentPackagePlatform,
							)
								? {
										targetPlatform:
											snapshot.contentPackagePlatform,
									}
								: {}),
							workId: snapshot.work.id,
							workflowId: snapshot.task.id,
							workflowRevision: snapshot.revision,
						},
						timestamp: "2026-07-22T09:00:00.000Z",
						workspaceId: "workspace-1",
					}),
					generated: {
						assetIds: [],
						childRuns: [
							{
								providerModel: "provider-secret",
								routeSnapshotId: "route-secret",
								runId: `run-${snapshot.lens}`,
								runType: "model_job",
								status: "succeeded",
							},
						],
					},
					status: "review_ready" as const,
				};
			},
		},
		diagnosticRepository: diagnostics,
		serviceToken: "composer-test-token",
		workflowEvents: new WorkflowEventApplicationService([
			{
				async owns(workspaceId, workflowId) {
					return workspaceId === "workspace-1" && /^task-(copy|image|image_text_note|video)$/u.test(workflowId);
				},
				async *stream(input) {
					yield progressFrame(input.workflowId, 0);
				},
			},
		]),
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => server.close());
	const { port } = server.address() as AddressInfo;
	const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/composer`;
	const headers = {
		"content-type": "application/json",
		"x-service-token": "composer-test-token",
		"x-user-id": "owner-1",
		"x-workspace-id": "workspace-1",
		"x-workspace-role": "owner",
	};

	for (const kind of ["copy", "image", "image_text_note", "video"] as const) {
		const submitted = await fetch(`${base}/submissions`, {
			method: "POST",
			headers,
			body: JSON.stringify(modalitySubmissionPayload(kind)),
		});
		assert.equal(
			submitted.status,
			202,
			JSON.stringify(await submitted.clone().json()),
		);
		const body = await submitted.json();
		assert.equal(body.data.replayed, false);
		assert.equal(body.data.task.id, `task-${kind}`);
		assert.equal(body.data.usageReservation.id, `usage-reservation-task-${kind}`);
		// Browser contract regression (INC-t26 hotfix leak): the client parses
		// usageReservation strictly with only `id` — any extra key (`units`)
		// makes every real submission fail client-side after a 202.
		assert.deepEqual(Object.keys(body.data.usageReservation), ['id']);
		assert.equal(body.data.snapshot.id, `snapshot-task-${kind}`);

		// Merchant entitlement units. `video` reserves one 成片 even though this
		// deliverable names 8 seconds: the plan offers trial 1 / starter 3 /
		// growth 6 / pro 9 videos, so charging by duration made every trial
		// submission 409 INSUFFICIENT_ENTITLEMENT while the Composer's own quota
		// card — which prices the run at 1 — showed nothing wrong. Per-second
		// accounting is the supply-side ledger's, not this allowance's.
		assert.deepEqual(
			submissions.reservedUnits("workspace-1", `composer-${kind}-1`),
			kind === "image_text_note"
				? [
						{ resource: "copy", quantity: 2 },
						{ resource: "image", quantity: 3 },
					]
				: [{ resource: kind, quantity: 1 }],
			`${kind} must reserve merchant allowance in the unit the plan grants`,
		);

		const replayed = await fetch(`${base}/submissions`, {
			method: "POST",
			headers,
			body: JSON.stringify(modalitySubmissionPayload(kind)),
		});
		assert.equal(replayed.status, 202);
		assert.equal((await replayed.json()).data.replayed, true);

		const started = starter.starts.find(
			(start) => start.snapshot.task.id === `task-${kind}`,
		);
		assert.ok(started);
		assert.equal(started?.snapshot.lens, kind);
		if (kind === "image") {
			assert.equal(started?.snapshot.operation, "image.edit");
			assert.equal(
				started?.snapshot.signedSubmission?.imageOperation,
				"image.edit",
			);
		}
		if (kind === "image_text_note") {
			assert.equal(
				started?.snapshot.operation,
				"image.generate",
				"note sources ground the plan instead of changing every page into an edit",
			);
		}
		assert.deepEqual(started?.snapshot.deliverables, [
			{
				id: `recipe-deliverable-${kind}`,
				kind,
				order: 0,
				quantity: 1,
				...(kind === "copy" ? {} : { aspectRatio: "9:16" }),
				...(kind === "video" ? { durationSeconds: 8 } : {}),
				...(kind === "image_text_note" ? { notePageBound: 3 } : {}),
			},
		]);

		const events = await fetch(`${base}/tasks/task-${kind}/events`, { headers });
		assert.equal(events.status, 200);
		assert.match(await events.text(), /event: workflow\.progress/u);

		const projection = await fetch(
			`${base}/content-packages/${body.data.contentPackage.id}`,
			{ headers },
		);
		assert.equal(projection.status, 200);
		const projectionBody = await projection.text();
		assert.match(projectionBody, new RegExp(`snapshot-task-${kind}`, "u"));
		assert.doesNotMatch(projectionBody, /provider-secret|route-secret/u);
	}
	assert.equal(starter.starts.length, 4);
});

test("Core Composer SSE aborts its durable subscription when the client disconnects", async (t) => {
	let resolveAborted: (() => void) | undefined;
	const aborted = new Promise<void>((resolve) => {
		resolveAborted = resolve;
	});
	const server = createCoreServer({
		composerSubmission: {
			coordinator: {
				async submit() {
					throw new Error("Unexpected Composer submission.");
				},
			},
		},
		diagnosticRepository: diagnostics,
		serviceToken: "composer-test-token",
		workflowEvents: new WorkflowEventApplicationService([
			{
				async owns(workspaceId, workflowId) {
					return workspaceId === "workspace-1" && workflowId === "task-1";
				},
				async *stream(input) {
					await new Promise<void>((resolve) => {
						if (input.signal.aborted) {
							resolveAborted?.();
							resolve();
							return;
						}
						input.signal.addEventListener(
							"abort",
							() => {
								resolveAborted?.();
								resolve();
							},
							{ once: true },
						);
					});
				},
			},
		]),
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => server.close());
	const { port } = server.address() as AddressInfo;
	const controller = new AbortController();
	const response = await fetch(
		`http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/composer/tasks/task-1/events`,
		{
			headers: {
				"x-service-token": "composer-test-token",
				"x-user-id": "owner-1",
				"x-workspace-id": "workspace-1",
				"x-workspace-role": "owner",
			},
			signal: controller.signal,
		},
	);
	assert.equal(response.status, 200);
	controller.abort();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await new Promise<void>((resolve, reject) => {
			timeout = setTimeout(
				() => reject(new Error("SSE subscription did not observe disconnect.")),
				1_000,
			);
			aborted.then(resolve, reject);
		});
	} finally {
		if (timeout) clearTimeout(timeout);
	}
});

test("Core Composer SSE registers disconnect handling before delayed ownership resolution", async () => {
	let releaseOwnership: (() => void) | undefined;
	const ownershipReleased = new Promise<void>((resolve) => {
		releaseOwnership = resolve;
	});
	let markOwnershipStarted: (() => void) | undefined;
	const ownershipStarted = new Promise<void>((resolve) => {
		markOwnershipStarted = resolve;
	});
	let streamCalls = 0;
	const request = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
	request.headers = {};
	const response = new BackpressuredSseResponse();
	const streaming = streamWorkflowEvents({
		request: request as never,
		requestCorrelationId: "correlation-1",
		response: response as never,
		workflowEvents: new WorkflowEventApplicationService([
			{
				async owns() {
					markOwnershipStarted?.();
					await ownershipReleased;
					return true;
				},
				async *stream() {
					streamCalls += 1;
				},
			},
		]),
		workflowHeartbeatMs: 60_000,
		workflowId: "task-1",
		workspaceId: "workspace-1",
	});
	await ownershipStarted;
	request.emit("close");
	releaseOwnership?.();
	await streaming;
	assert.equal(streamCalls, 0);
});

test("Core Composer SSE waits for drain before consuming the next durable frame", async () => {
	const response = new BackpressuredSseResponse();
	const request = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
	request.headers = {};
	const blocked = once(response, "blocked");
	let secondFramePulled = false;
	const streaming = streamWorkflowEvents({
		request: request as never,
		requestCorrelationId: "correlation-1",
		response: response as never,
		workflowEvents: new WorkflowEventApplicationService([
			{
				async owns() {
					return true;
				},
				async *stream() {
					yield progressFrame("task-1", 1);
					secondFramePulled = true;
					yield progressFrame("task-1", 2);
				},
			},
		]),
		workflowHeartbeatMs: 60_000,
		workflowId: "task-1",
		workspaceId: "workspace-1",
	});
	await blocked;
	assert.equal(secondFramePulled, false);
	response.emit("drain");
	await streaming;
	assert.equal(secondFramePulled, true);
	assert.equal(response.writableEnded, true);
});

test("Core Composer SSE keeps only one heartbeat queued while a drain is blocked", async () => {
	const response = new HeartbeatBackpressuredSseResponse();
	const request = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
	request.headers = {};
	const blocked = once(response, "blocked");
	const streaming = streamWorkflowEvents({
		request: request as never,
		requestCorrelationId: "correlation-1",
		response: response as never,
		workflowEvents: new WorkflowEventApplicationService([
			{
				async owns() {
					return true;
				},
				async *stream() {
					yield progressFrame("task-1", 1);
				},
			},
		]),
		workflowHeartbeatMs: 1,
		workflowId: "task-1",
		workspaceId: "workspace-1",
	});
	await blocked;
	await new Promise<void>((resolve) => setTimeout(resolve, 25));
	assert.equal(response.writeCount, 2);
	response.emit("drain");
	await streaming;
	assert.equal(response.writeCount, 3);
	assert.equal(response.writableEnded, true);
});

test("Core Composer SSE consumes a post-header stream error without re-emitting it on the socket", async () => {
	const response = new ErrorDestroyingSseResponse();
	const request = new EventEmitter() as EventEmitter & { headers: Record<string, string> };
	request.headers = {};
	await streamWorkflowEvents({
		request: request as never,
		requestCorrelationId: "correlation-1",
		response: response as never,
		workflowEvents: new WorkflowEventApplicationService([
			{
				async owns() {
					return true;
				},
				async *stream() {
					yield progressFrame("task-1", 1);
					const error = new Error("read ECONNRESET") as NodeJS.ErrnoException;
					error.code = "ECONNRESET";
					throw error;
				},
			},
		]),
		workflowHeartbeatMs: 60_000,
		workflowId: "task-1",
		workspaceId: "workspace-1",
	});
	assert.equal(response.destroyed, true);
	assert.equal(response.destroyError, undefined);
});

test("legacy Harness task admission stays retired without a configured Harness service", async (t) => {
	const server = createCoreServer({
		diagnosticRepository: diagnostics,
		serviceToken: "composer-test-token",
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => server.close());
	const { port } = server.address() as AddressInfo;
	const response = await fetch(
		`http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/harness/tasks`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-service-token": "composer-test-token",
				"x-user-id": "owner-1",
				"x-workspace-id": "workspace-1",
				"x-workspace-role": "owner",
			},
			body: JSON.stringify({ taskId: "browser-task" }),
		},
	);
	assert.equal(response.status, 410);
	assert.deepEqual((await response.json()).error, {
		code: "HARNESS_TASK_ADMISSION_RETIRED",
		message:
			"Direct Harness task admission is retired; submit through the Composer execution spine.",
	});
});

class MemorySubmissionStore implements CreationSubmissionStore {
	failNextPlanningPersistence = false;
	private readonly claims = new Map<string, CreationSubmissionStoreClaim>();
	readonly freezePresentAtClaim = new Map<string, boolean>();
	readonly confirmationStateAtClaim = new Map<string, string | undefined>();
	private readonly harnessStarts = new Map<
		string,
		{
			attempts: number;
			state: "failed" | "reserved" | "starting" | "started";
			leaseId?: string;
		}
	>();
	readonly reprices: Array<{ credits: number; quoteId: string }> = [];
	failNextReprice = false;

	/** What the coordinator actually reserved, for allowance-unit assertions. */
	reservedUnits(workspaceId: string, idempotencyKey: string) {
		return this.claims.get(`${workspaceId}:${idempotencyKey}`)?.submission
			.usageReservation.units;
	}

	claimedSubmission(workspaceId: string, idempotencyKey: string) {
		return this.claims.get(`${workspaceId}:${idempotencyKey}`)?.submission;
	}

	async readReceipt(input: {
		workspaceId: string;
		idempotencyKey: string;
		payloadHash: string;
	}) {
		const existing = this.claims.get(
			`${input.workspaceId}:${input.idempotencyKey}`,
		);
		if (!existing) return { kind: "missing" as const };
		if (existing.payloadHash !== input.payloadHash) {
			return { kind: "conflict" as const };
		}
		return {
			kind: "existing" as const,
			submission: structuredClone(existing.submission),
		};
	}

	async readByTask(input: { workspaceId: string; taskId: string }) {
		const claim = [...this.claims.values()].find(
			(item) =>
				item.workspaceId === input.workspaceId &&
				item.submission.task.id === input.taskId,
		);
		return claim ? structuredClone(claim.submission) : null;
	}

	async claim(input: CreationSubmissionStoreClaim) {
		const key = `${input.workspaceId}:${input.idempotencyKey}`;
		this.freezePresentAtClaim.set(
			key,
			input.submission.executionPlanFreeze !== undefined,
		);
		this.confirmationStateAtClaim.set(
			key,
			input.submission.confirmationDispatch?.state,
		);
		const existing = this.claims.get(key);
		if (!existing) {
			this.claims.set(key, structuredClone(input));
			this.harnessStarts.set(input.submission.snapshot.id, {
				attempts: 0,
				state: "reserved",
			});
			return { kind: "created" as const, submission: input.submission };
		}
		if (existing.payloadHash !== input.payloadHash) {
			return { kind: "conflict" as const };
		}
		return {
			kind: "existing" as const,
			submission: structuredClone(existing.submission),
		};
	}

	async persistAgentPlanning(input: {
		workspaceId: string;
		submissionId: string;
		agentBinding: NonNullable<CreationSubmissionRecord["agentBinding"]>;
		executionPlanFreeze: NonNullable<CreationSubmissionRecord["executionPlanFreeze"]>;
		quoteRef?: CreationSubmissionRecord["snapshot"]["quote"];
		credits?: number;
		confirmationDispatch?: CreationSubmissionRecord["confirmationDispatch"];
	}) {
		if (this.failNextPlanningPersistence) {
			this.failNextPlanningPersistence = false;
			throw new Error("planning persistence unavailable");
		}
		const claim = [...this.claims.values()].find(
			(entry) =>
				entry.workspaceId === input.workspaceId &&
				entry.submission.snapshot.id === input.submissionId,
		);
		if (!claim) throw new Error(`Unknown submission ${input.submissionId}`);
		const current = claim.submission;
		const binding = {
			threadId: input.agentBinding.threadId,
			runId: input.agentBinding.runId,
		};
		const revised =
			current.executionPlanFreeze !== undefined &&
			current.executionPlanFreeze.planId === input.executionPlanFreeze.planId &&
			current.executionPlanFreeze.planRevision <
				input.executionPlanFreeze.planRevision;
		if ((current.agentBinding || current.executionPlanFreeze) && !revised) {
			if (current.agentBinding) {
				assert.deepEqual(current.agentBinding, binding);
			}
			if (current.executionPlanFreeze) {
				assert.deepEqual(current.executionPlanFreeze, input.executionPlanFreeze);
			}
		}
		current.agentBinding = structuredClone(binding);
		current.agentPlanPending = false;
		current.executionPlanFreeze = structuredClone(input.executionPlanFreeze);
		if (input.confirmationDispatch !== undefined) {
			current.confirmationDispatch = structuredClone(input.confirmationDispatch);
		}
		if (input.quoteRef) {
			current.snapshot.quote = structuredClone(input.quoteRef);
		}
		if (input.credits !== undefined) {
			current.usageReservation.credits = input.credits;
		}
		return structuredClone(current);
	}

	async saveRepricedExecutionPlanFreeze(input: Parameters<
		NonNullable<CreationSubmissionStore["saveRepricedExecutionPlanFreeze"]>
	>[0]) {
		if (this.failNextReprice) {
			this.failNextReprice = false;
			throw new Error("Atomic reprice commit failed");
		}
		const claim = [...this.claims.values()].find(
			(candidate) =>
				candidate.workspaceId === input.workspaceId &&
				candidate.submission.snapshot.id === input.submissionId,
		);
		if (!claim) throw new Error("Submission reprice target missing.");
		claim.submission.executionPlanFreeze = structuredClone(input.freeze);
		claim.submission.snapshot.quote = {
			id: input.freeze.quoteRef.id,
			revision: String(input.freeze.quoteRef.revision),
		};
		claim.submission.usageReservation.credits = input.credits;
		claim.submission.usageReservation.creditUsageOperationId =
			`credit-usage:${claim.submission.task.id}:plan-r${input.freeze.planRevision}`;
		this.reprices.push({ credits: input.credits, quoteId: input.freeze.quoteRef.id });
		return structuredClone(claim.submission);
	}

	async claimHarnessStart(input: {
		workspaceId: string;
		submissionId: string;
	}) {
		const state = this.harnessStarts.get(input.submissionId);
		if (state?.state === "reserved") {
			const leaseId = `lease-${input.submissionId}`;
			const attempts = state.attempts + 1;
			this.harnessStarts.set(input.submissionId, {
				attempts,
				state: "starting",
				leaseId,
			});
			return { kind: "start" as const, attempts, leaseId };
		}
		if (state?.state === "failed") return { kind: "failed" as const };
		if (state?.state === "starting" || state?.state === "started") {
			return { kind: "started" as const };
		}
		throw new Error(
			`Unknown submission ${input.workspaceId}:${input.submissionId}`,
		);
	}

	async completeHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}) {
		const current = this.harnessStarts.get(input.submissionId);
		if (!current) {
			throw new Error(
				`Unknown submission ${input.workspaceId}:${input.submissionId}`,
			);
		}
		if (current.state !== "starting" || current.leaseId !== input.leaseId) {
			throw new Error(`Stale harness lease ${input.leaseId}`);
		}
		this.harnessStarts.set(input.submissionId, {
			attempts: current.attempts,
			state: "started",
		});
	}

	async markHarnessStartDispatched(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}) {
		const current = this.harnessStarts.get(input.submissionId);
		if (current?.state !== "starting" || current.leaseId !== input.leaseId) {
			throw new Error(`Stale harness lease ${input.leaseId}`);
		}
		const claim = [...this.claims.values()].find(
			(candidate) =>
				candidate.workspaceId === input.workspaceId &&
				candidate.submission.snapshot.id === input.submissionId,
		);
		if (!claim) throw new Error("Submission dispatch target missing.");
		if (claim.submission.confirmationDispatch) {
			claim.submission.confirmationDispatch.state = "dispatched";
		}
		return structuredClone(claim.submission);
	}

	async releaseHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}) {
		const current = this.harnessStarts.get(input.submissionId);
		if (current?.state === "starting" && current.leaseId === input.leaseId) {
			this.harnessStarts.set(input.submissionId, {
				attempts: current.attempts,
				state: "reserved",
			});
		}
	}

	async failHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}) {
		const current = this.harnessStarts.get(input.submissionId);
		if (current?.state !== "starting" || current.leaseId !== input.leaseId) {
			return false;
		}
		this.harnessStarts.set(input.submissionId, {
			attempts: current.attempts,
			state: "failed",
		});
		return true;
	}

	async listRecoverableHarnessStarts(input: { limit: number }) {
		return [...this.claims.values()]
			.filter(
				(claim) =>
					this.harnessStarts.get(claim.submission.snapshot.id)?.state === "reserved",
			)
			.slice(0, input.limit)
			.map((claim) => ({ submission: structuredClone(claim.submission) }));
	}

	count() {
		return this.claims.size;
	}
}

class RecordingHarnessStarter implements CreationSubmissionHarnessStarter {
	readonly starts: Array<
		Parameters<CreationSubmissionHarnessStarter["start"]>[0]
	> = [];
	readonly preparations: CreationSubmissionRecord[] = [];
	/** Makes admission answer with an authority other than the persisted one. */
	startRequestIdOverride?: string;

	async start(input: Parameters<CreationSubmissionHarnessStarter["start"]>[0]) {
		this.starts.push(structuredClone(input));
		return {
			executionConfirmationRequestId:
				this.startRequestIdOverride ??
				`confirmation:authority:${input.task.id}`,
		};
	}

	async preparePendingConfirmation(input: CreationSubmissionRecord) {
		this.preparations.push(structuredClone(input));
		return {
			executionConfirmationRequestId: `confirmation:authority:${input.task.id}`,
		};
	}
}

test("Composer returns authoritative Agent binding and treats the Thread hint outside receipt identity", async () => {
	const submissions = new MemorySubmissionStore();
	const continuationHints: Array<string | undefined> = [];
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		new RecordingHarnessStarter(),
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				continuationHints.push(input.continuationThreadId);
				input.submission.executionPlanFreeze = {} as NonNullable<
					CreationSubmissionRecord["executionPlanFreeze"]
				>;
				return {
					threadId: asAgentThreadIdentity("thread-authoritative"),
					runId: "run-authoritative",
				};
			},
		}
	);
	const command: Parameters<CreationSubmissionCoordinator["submit"]>[0] = {
		...submissionPayload(),
		actorId: "owner-1",
		agentThreadId: "thread-browser-a",
		workspaceId: "workspace-1",
	};

	const created = await coordinator.submit(command);
	const replayed = await coordinator.submit({
		...command,
		agentThreadId: "thread-browser-b",
	});

	assert.equal(created.threadId, "thread-authoritative");
	assert.equal(created.runId, "run-authoritative");
	assert.equal(replayed.replayed, true);
	assert.equal(replayed.threadId, "thread-authoritative");
	assert.deepEqual(continuationHints, ["thread-browser-a"]);
});

test("crash recovery idempotently persists Agent planning before Harness starts", async () => {
	const submissions = new MemorySubmissionStore();
	submissions.failNextPlanningPersistence = true;
	const starts: CreationSubmissionRecord[] = [];
	let plans = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{ async start(input) { starts.push(structuredClone(input)); } },
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				plans += 1;
				input.submission.executionPlanFreeze = {} as NonNullable<
					CreationSubmissionRecord["executionPlanFreeze"]
				>;
				return {
					threadId: asAgentThreadIdentity("thread-durable"),
					runId: "run-durable",
				};
			},
		},
	);
	const command = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	await assert.rejects(coordinator.submit(command), /planning persistence/u);
	assert.equal(starts.length, 0);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 1,
		failed: 0,
		started: 1,
	});
	assert.equal(plans, 2);
	assert.equal(starts[0]?.agentBinding?.threadId, "thread-durable");
	assert.ok(starts[0]?.executionPlanFreeze);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 0,
		failed: 0,
		started: 0,
	});
});

test("recovery completes a claim that crashed before Agent planning", async () => {
	const submissions = new MemorySubmissionStore();
	const starts: CreationSubmissionRecord[] = [];
	let plans = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{ async start(input) { starts.push(structuredClone(input)); } },
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				plans += 1;
				if (plans === 1) throw new Error("process crashed before plan");
				input.submission.executionPlanFreeze = {} as NonNullable<
					CreationSubmissionRecord["executionPlanFreeze"]
				>;
				return {
					threadId: asAgentThreadIdentity("thread-after-crash"),
					runId: "run-after-crash",
				};
			},
		},
	);
	await assert.rejects(
		coordinator.submit({
			...submissionPayload(),
			actorId: "owner-1",
			workspaceId: "workspace-1",
		}),
		/crashed before plan/u,
	);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 1,
		failed: 0,
		started: 1,
	});
	assert.equal(starts[0]?.agentBinding?.threadId, "thread-after-crash");
});

test("recovery reuses durable Agent planning after a crash before Harness acknowledgement", async () => {
	const submissions = new MemorySubmissionStore();
	let plans = 0;
	let starts = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{
			async start(input) {
				starts += 1;
				assert.equal(input.agentBinding?.threadId, "thread-persisted");
				if (starts === 1) throw new Error("crashed before harness acknowledgement");
			},
		},
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				plans += 1;
				input.submission.executionPlanFreeze = {} as NonNullable<
					CreationSubmissionRecord["executionPlanFreeze"]
				>;
				return {
					threadId: asAgentThreadIdentity("thread-persisted"),
					runId: "run-persisted",
				};
			},
		},
	);
	await assert.rejects(
		coordinator.submit({
			...submissionPayload(),
			actorId: "owner-1",
			workspaceId: "workspace-1",
		}),
		/before harness acknowledgement/u,
	);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 1,
		failed: 0,
		started: 1,
	});
	assert.equal(plans, 1);
	assert.equal(starts, 2);
});

test("paid Composer plan waits until exact explicit start before dispatching Make", async () => {
	const submissions = new MemorySubmissionStore();
	const harness = new RecordingHarnessStarter();
	let completed = 0;
	let revised = 0;
	let immutableDecision: PlanConfirmationDecision | null = null;
	let authorityPlanRevision = 1;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		harness,
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				input.submission.executionPlanFreeze = {
					approvalBasis: "merchant_confirmed",
					planId: "plan-paid",
					planRevision: 1,
					quoteRef: { id: "quote-1", revision: "quote-r5" },
				} as never;
				// A stale/buggy planning hint cannot bypass the server-owned
				// merchant-confirmed freeze and immutable decision gate.
				return { threadId: asAgentThreadIdentity("thread-wait"), runId: "run-wait", makeReady: true };
			},
			async completeExplicitStart(input) {
				assert.equal(input.planRevision, 2);
				return { threadId: asAgentThreadIdentity("thread-wait"), runId: "run-wait", makeReady: true };
			},
			async markExplicitStartCompleted() {
				completed += 1;
			},
			async revisePrepared(input) {
				assert.equal(input.planRevision, 1);
				assert.equal(input.merchantInstruction, "减到 4 页");
				revised += 1;
				authorityPlanRevision = 2;
				input.submission.executionPlanFreeze = {
					...input.submission.executionPlanFreeze!,
					planRevision: 2,
				} as never;
				return { threadId: asAgentThreadIdentity("thread-wait"), runId: "run-wait", makeReady: false };
			},
		},
		{
			async getDecision() {
				return immutableDecision;
			},
			async getRequest(requestId) {
				const planRevision = authorityPlanRevision;
				const currentFreeze = {
					approvalBasis: "merchant_confirmed",
					planId: "plan-paid",
					planRevision,
					quoteRef: { id: "quote-1", revision: "quote-r5" },
				} as never;
				return {
					request: {
						requestId,
						planId: "plan-paid",
						planRevision,
						snapshotHash: computeExecutionPlanSnapshotHash(currentFreeze),
						quoteRef: { id: "quote-1", revision: "quote-r5" },
						status: "decided",
					},
				};
			},
			async getCurrentByWorkflowId(workflowId) {
				const currentFreeze = {
					approvalBasis: "merchant_confirmed",
					planId: "plan-paid",
					planRevision: authorityPlanRevision,
					quoteRef: { id: "quote-1", revision: "quote-r5" },
				} as never;
				return {
					workflowId,
					workspaceId: "workspace-1",
					planId: "plan-paid",
					planRevision: authorityPlanRevision,
					snapshotHash: computeExecutionPlanSnapshotHash(currentFreeze),
					quoteRef: { id: "quote-1", revision: "quote-r5" },
					rightsRevisionRefs: [],
					factRevisionRefs: [],
					frozenAt: "2026-08-09T08:00:00.000Z",
				};
			},
		},
	);
	let createdTaskId = "";
	const created = await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	createdTaskId = created.task.id;
	const claimed = submissions.claimedSubmission(
		"workspace-1",
		"composer-submit-1",
	);
	assert.ok(claimed?.executionPlanFreeze);
	assert.equal(claimed?.agentPlanPending, false);
	assert.equal(claimed?.confirmationDispatch?.state, "pending");
	assert.equal(harness.preparations.length, 1);
	assert.equal(harness.preparations[0]?.task.id, created.task.id);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 0,
		failed: 0,
		started: 0,
	});
	await assert.rejects(
		coordinator.startPrepared({
			workspaceId: "workspace-1",
			taskId: created.task.id,
			planRevision: 1,
		}),
		/immutable confirmed decision/u,
	);
	assert.equal(harness.starts.length, 0);
	// The re-request after revising to plan-r2 dispatches through the same
	// fixture harness (RecordingHarnessStarter.preparePendingConfirmation does
	// not vary its returned ID by revision), so this is the exact ID persisted
	// on confirmationDispatch. startPrepared must resolve that persisted ID,
	// not rederive one from {workflowId, planRevision, snapshotHash}.
	immutableDecision = planConfirmationDecisionSchema.parse({
		schemaVersion: "plan-confirmation-decision/v1",
		decisionId: `decision:${createdTaskId}:merchant-confirmed`,
		requestId: `confirmation:authority:${createdTaskId}`,
		actorId: "owner-1",
		decision: "confirmed",
		decidedAt: "2026-08-09T08:00:00.000Z",
	});
	assert.equal(created.makeReady, false);
	assert.equal(harness.starts.length, 0);
	await coordinator.revisePrepared({
		workspaceId: "workspace-1",
		taskId: created.task.id,
		planRevision: 1,
		merchantInstruction: "减到 4 页",
	});
	assert.equal(revised, 1);
	assert.equal(harness.starts.length, 0);
	assert.equal(harness.preparations.length, 2);

	const started = await coordinator.startPrepared({
		workspaceId: "workspace-1",
		taskId: created.task.id,
		planRevision: 2,
	});
	assert.equal(started.makeReady, true);
	assert.equal(harness.starts.length, 1);
	assert.equal(completed, 1);
	await coordinator.startPrepared({
		workspaceId: "workspace-1",
		taskId: created.task.id,
		planRevision: 2,
	});
	assert.equal(harness.starts.length, 1);
});

test("admission answering with a second authority ID fails the start", async () => {
	const submissions = new MemorySubmissionStore();
	const harness = new RecordingHarnessStarter();
	let completed = 0;
	const freeze = {
		approvalBasis: "merchant_confirmed",
		planId: "plan-paid",
		planRevision: 1,
		quoteRef: { id: "quote-1", revision: "quote-r5" },
	} as never;
	const snapshotHash = computeExecutionPlanSnapshotHash(freeze);
	let immutableDecision: PlanConfirmationDecision | null = null;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		harness,
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				input.submission.executionPlanFreeze = freeze;
				return { threadId: asAgentThreadIdentity("thread-wait"), runId: "run-wait", makeReady: false };
			},
			async completeExplicitStart() {
				return { threadId: asAgentThreadIdentity("thread-wait"), runId: "run-wait", makeReady: true };
			},
			async markExplicitStartCompleted() {
				completed += 1;
			},
		},
		{
			async getDecision() {
				return immutableDecision;
			},
			async getRequest(requestId) {
				return {
					request: {
						requestId,
						planId: "plan-paid",
						planRevision: 1,
						snapshotHash,
						quoteRef: { id: "quote-1", revision: "quote-r5" },
						status: "decided",
					},
				};
			},
			async getCurrentByWorkflowId(workflowId) {
				return {
					workflowId,
					workspaceId: "workspace-1",
					planId: "plan-paid",
					planRevision: 1,
					snapshotHash,
					quoteRef: { id: "quote-1", revision: "quote-r5" },
					rightsRevisionRefs: [],
					factRevisionRefs: [],
					frozenAt: "2026-08-09T08:00:00.000Z",
				};
			},
		},
	);

	const created = await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	const persistedRequestId = submissions.claimedSubmission(
		"workspace-1",
		"composer-submit-1",
	)?.confirmationDispatch?.requestId;
	assert.equal(persistedRequestId, `confirmation:authority:${created.task.id}`);
	// startPrepared resolves the persisted authority ID, so the merchant's
	// decision must be recorded against that exact ID, not a rederived one.
	immutableDecision = planConfirmationDecisionSchema.parse({
		schemaVersion: "plan-confirmation-decision/v1",
		decisionId: `decision:${created.task.id}:merchant-confirmed`,
		requestId: `confirmation:authority:${created.task.id}`,
		actorId: "owner-1",
		decision: "confirmed",
		decidedAt: "2026-08-09T08:00:00.000Z",
	});

	// The pending confirmation already told the merchant which authority they
	// were approving. Admission re-affirming a *different* one would mean the
	// money was held against one request and spent against another.
	harness.startRequestIdOverride = "confirmation:authority:someone-elses-run";
	await assert.rejects(
		coordinator.startPrepared({
			workspaceId: "workspace-1",
			taskId: created.task.id,
			planRevision: 1,
		}),
		/returned a different confirmation authority ID/u,
	);
	assert.equal(completed, 0);
	assert.equal(
		submissions.claimedSubmission("workspace-1", "composer-submit-1")
			?.confirmationDispatch?.requestId,
		persistedRequestId,
	);
});

test("startPrepared resolves the persisted successor authority ID after an expired attempt, not a recomputed base (V31-39)", async () => {
	const submissions = new MemorySubmissionStore();
	const freeze = {
		approvalBasis: "merchant_confirmed",
		planId: "plan-paid",
		planRevision: 1,
		quoteRef: { id: "quote-1", revision: "quote-r5" },
	} as never;
	const snapshotHash = computeExecutionPlanSnapshotHash(freeze);
	const workflowId = "task-1:plan-r1";
	const baseRequestId = executionConfirmationAuthorityRequestId({
		workflowId,
		planRevision: 1,
		snapshotHash,
	});
	// Shape mirrors the `:r:` successor execution-confirmation-authority.ts:199
	// derives once a prior terminal decision exists on the base — it is never
	// equal to what recomputing {workflowId, planRevision, snapshotHash} yields.
	const successorRequestId = `${baseRequestId}:r:successor-after-expiry`;
	let completed = 0;
	const starts: Array<Parameters<CreationSubmissionHarnessStarter["start"]>[0]> =
		[];
	const harness: CreationSubmissionHarnessStarter = {
		async start(input) {
			starts.push(structuredClone(input));
			return { executionConfirmationRequestId: successorRequestId };
		},
		// Admission already resolved and dispatched the successor authority;
		// startPrepared must resolve that exact ID, not rederive the base.
		async preparePendingConfirmation() {
			return { executionConfirmationRequestId: successorRequestId };
		},
	};
	const authorityRequests = new Map<
		string,
		{ planRevision: number; snapshotHash: string; status: string }
	>([
		[baseRequestId, { planRevision: 1, snapshotHash, status: "expired" }],
		[successorRequestId, { planRevision: 1, snapshotHash, status: "decided" }],
	]);
	const immutableDecision = planConfirmationDecisionSchema.parse({
		schemaVersion: "plan-confirmation-decision/v1",
		decisionId: "decision:task-1:merchant-confirmed",
		requestId: successorRequestId,
		actorId: "owner-1",
		decision: "confirmed",
		decidedAt: "2026-08-09T08:00:00.000Z",
	});
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		harness,
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				input.submission.executionPlanFreeze = freeze;
				return {
					threadId: asAgentThreadIdentity("thread-successor"),
					runId: "run-successor",
					makeReady: true,
				};
			},
			async completeExplicitStart(input) {
				assert.equal(input.planRevision, 1);
				return {
					threadId: asAgentThreadIdentity("thread-successor"),
					runId: "run-successor",
					makeReady: true,
				};
			},
			async markExplicitStartCompleted() {
				completed += 1;
			},
		},
		{
			async getDecision(_workspaceId, requestId) {
				return requestId === immutableDecision.requestId
					? immutableDecision
					: null;
			},
			async getRequest(requestId) {
				const record = authorityRequests.get(requestId);
				if (!record) return null;
				return {
					request: {
						requestId,
						planId: "plan-paid",
						planRevision: record.planRevision,
						snapshotHash: record.snapshotHash,
						quoteRef: { id: "quote-1", revision: "quote-r5" },
						status: record.status,
					},
				};
			},
			async getCurrentByWorkflowId(workflowIdArg) {
				return {
					workflowId: workflowIdArg,
					workspaceId: "workspace-1",
					planId: "plan-paid",
					planRevision: 1,
					snapshotHash,
					quoteRef: { id: "quote-1", revision: "quote-r5" },
					rightsRevisionRefs: [],
					factRevisionRefs: [],
					frozenAt: "2026-08-09T08:00:00.000Z",
				};
			},
		},
	);

	const created = await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	assert.equal(created.makeReady, false);
	assert.equal(
		submissions.claimedSubmission("workspace-1", "composer-submit-1")
			?.confirmationDispatch?.requestId,
		successorRequestId,
	);

	const started = await coordinator.startPrepared({
		workspaceId: "workspace-1",
		taskId: created.task.id,
		planRevision: 1,
	});

	assert.equal(started.makeReady, true);
	assert.equal(starts.length, 1);
	assert.equal(completed, 1);
});

test("clarification answer continues the prepared task and durably stores its compiled freeze", async () => {
	const submissions = new MemorySubmissionStore();
	const harness = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		harness,
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare() {
				return { threadId: asAgentThreadIdentity("thread-clarify"), runId: "run-clarify", makeReady: false };
			},
			async answerClarification(input) {
				assert.equal(input.merchantAnswer, "主要面向第一次到店的新客");
				input.submission.executionPlanFreeze = {
					approvalBasis: "merchant_confirmed",
					planId: "plan-clarify",
					planRevision: 1,
					quoteRef: { id: "quote-clarify-r2", revision: "quote-r2" },
				} as never;
				return {
					threadId: asAgentThreadIdentity("thread-clarify"),
					runId: "run-clarify",
					makeReady: false,
					repriceCommit: {
						expectedFreeze: null,
						previousQuoteRef: { id: "quote-1", revision: "quote-r5" },
						successorQuote: {
							quoteId: "quote-clarify-r2",
							catalogModelId: "model-1",
							quotePolicyRevision: "quote.policy@1",
							billingMode: "per_request",
							creditCost: 4,
							unitRate: 4,
						},
						credits: 4,
					},
				};
			},
		},
		{
			async getDecision() {
				return null;
			},
			async supersedePending() {},
		},
	);
	const created = await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	assert.equal(harness.preparations.length, 0);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 0,
		failed: 0,
		started: 0,
	});

	await coordinator.answerClarification({
		workspaceId: "workspace-1",
		taskId: created.task.id,
		merchantAnswer: "主要面向第一次到店的新客",
	});

	const restartedRead = await submissions.readByTask({
		workspaceId: "workspace-1",
		taskId: created.task.id,
	});
	assert.equal(restartedRead?.executionPlanFreeze?.planId, "plan-clarify");
	assert.equal(restartedRead?.executionPlanFreeze?.planRevision, 1);
	assert.deepEqual(submissions.reprices, [
		{ credits: 4, quoteId: "quote-clarify-r2" },
	]);
	assert.equal(harness.preparations.length, 1);
	assert.equal(harness.starts.length, 0);
});

test("clarification remains pending when its atomic reprice commit fails", async () => {
	const submissions = new MemorySubmissionStore();
	const harness = new RecordingHarnessStarter();
	let committedResolutions = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		harness,
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare() {
				return {
					threadId: asAgentThreadIdentity("thread-crash"),
					runId: "run-crash",
					makeReady: false,
				};
			},
			async answerClarification(input) {
				input.submission.executionPlanFreeze = {
					approvalBasis: "merchant_confirmed",
					planId: "plan-crash",
					planRevision: 1,
					quoteRef: { id: "quote-crash-r2", revision: "quote-r2" },
				} as never;
				return {
					threadId: asAgentThreadIdentity("thread-crash"),
					runId: "run-crash",
					makeReady: false,
					clarificationResolution: {
						interruptId: "interrupt-crash",
						revision: 1,
						threadId: "thread-crash",
						runId: "run-crash",
					},
					repriceCommit: {
						expectedFreeze: null,
						previousQuoteRef: { id: "quote-1", revision: "quote-r5" },
						successorQuote: {
							quoteId: "quote-crash-r2",
							catalogModelId: "model-1",
							quotePolicyRevision: "quote.policy@1",
							billingMode: "per_request",
							creditCost: 4,
							unitRate: 4,
						},
						credits: 4,
					},
				};
			},
			async commitClarificationResolution() {
				committedResolutions += 1;
			},
		},
	);
	const created = await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	submissions.failNextReprice = true;

	await assert.rejects(
		coordinator.answerClarification({
			workspaceId: "workspace-1",
			taskId: created.task.id,
			merchantAnswer: "减到 4 页",
		}),
		/Atomic reprice commit failed/u,
	);

	assert.equal(committedResolutions, 0);
	assert.equal(
		(
			await submissions.readByTask({
				workspaceId: "workspace-1",
				taskId: created.task.id,
			})
		)?.executionPlanFreeze,
		undefined,
	);
	assert.equal(harness.preparations.length, 0);

	await coordinator.answerClarification({
		workspaceId: "workspace-1",
		taskId: created.task.id,
		merchantAnswer: "减到 4 页",
	});
	assert.equal(committedResolutions, 1);
	assert.equal(harness.preparations.length, 1);
});

test("plan revision commits its quote successor through the atomic billing and freeze seam", async () => {
	const submissions = new MemorySubmissionStore();
	const harness = new RecordingHarnessStarter();
	const previousFreeze = {
		approvalBasis: "merchant_confirmed",
		planId: "plan-reprice",
		planRevision: 1,
		quoteRef: { id: "quote-r1", revision: "r1" },
	} as never;
	const nextFreeze = {
		approvalBasis: "merchant_confirmed",
		planId: "plan-reprice",
		planRevision: 2,
		quoteRef: { id: "quote-r2", revision: "r2" },
	} as never;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		harness,
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				input.submission.executionPlanFreeze = previousFreeze;
				return { threadId: asAgentThreadIdentity("thread-reprice"), runId: "run-reprice", makeReady: false };
			},
			async revisePrepared(input) {
				input.submission.executionPlanFreeze = nextFreeze;
				return {
					threadId: asAgentThreadIdentity("thread-reprice"),
					runId: "run-reprice",
					makeReady: false,
					repriceCommit: {
						expectedFreeze: previousFreeze,
						previousQuoteRef: { id: "quote-r1", revision: "r1" },
						successorQuote: {
							quoteId: "quote-r2",
							catalogModelId: "model-1",
							quotePolicyRevision: "quote.policy@1",
							billingMode: "per_request",
							creditCost: 4,
							unitRate: 4,
						},
						credits: 4,
					},
				};
			},
		},
		{
			async getDecision() {
				return null;
			},
			async supersedePending() {},
		},
	);
	const created = await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});

	const revised = await coordinator.revisePrepared({
		workspaceId: "workspace-1",
		taskId: created.task.id,
		planRevision: 1,
		merchantInstruction: "减到 4 页",
	});

	assert.deepEqual(submissions.reprices, [{ credits: 4, quoteId: "quote-r2" }]);
	assert.equal(
		harness.preparations[1]?.usageReservation.creditUsageOperationId,
		`credit-usage:${created.task.id}:plan-r2`,
	);
	assert.equal("repriceCommit" in revised, false);
});

test("a failed Harness start releases the same submission for an idempotent retry", async () => {
	const submissions = new MemorySubmissionStore();
	let starts = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{
			async start() {
				starts += 1;
				if (starts === 1) throw new Error("Harness temporarily unavailable");
			},
		},
		fixedIds(),
		fixedAdmission(),
	);
	const command: Parameters<CreationSubmissionCoordinator["submit"]>[0] = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	await assert.rejects(coordinator.submit(command), /temporarily unavailable/u);
	assert.equal(submissions.count(), 1);
	const replayed = await coordinator.submit(command);
	assert.equal(replayed.replayed, true);
	assert.equal(starts, 2);
	assert.equal(submissions.count(), 1);
});

test("the compiled freeze is durable in the claim transaction and a paid submit stops at pending confirmation", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare({ submission }) {
				submission.executionPlanFreeze = recoveryExecutionPlanFreeze(submission);
				return { threadId: asAgentThreadIdentity("thread-freeze"), runId: "run-freeze" };
			},
		},
	);
	const command: Parameters<CreationSubmissionCoordinator["submit"]>[0] = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	const response = await coordinator.submit(command);

	// V31-10/V31-28: a merchant_confirmed freeze must never start Make on submit.
	assert.equal(response.makeReady, false);
	assert.deepEqual(starter.starts, []);
	assert.equal(starter.preparations.length, 1);
	assert.ok(
		submissions.claimedSubmission("workspace-1", command.idempotencyKey)
			?.executionPlanFreeze,
		"claim must already carry the freeze; no post-claim patch window",
	);
	assert.equal(
		submissions.freezePresentAtClaim.get(
			`workspace-1:${command.idempotencyKey}`,
		),
		true,
	);
	assert.deepEqual(
		submissions.claimedSubmission("workspace-1", command.idempotencyKey)
			?.confirmationDispatch,
		{
			requestId: `confirmation:authority:${
				submissions.claimedSubmission("workspace-1", command.idempotencyKey)!
					.task.id
			}`,
			state: "pending",
			expiresAt: "2026-07-24T09:00:00.000Z",
		},
	);
	assert.equal(
		submissions.confirmationStateAtClaim.get(
			`workspace-1:${command.idempotencyKey}`,
		),
		"pending",
	);
	// The authority ID is a digest the browser cannot compute, so the response
	// that withholds Make must also hand back the exact request the merchant has
	// to decide. Without it the commit strip can only start an unapproved plan.
	//
	// It must be that ID verbatim, never a second one derived at the HTTP edge:
	// the real rule (executionConfirmationAuthorityRequestId) yields
	// `confirmation:<sha40>`, and the authority may hand back a `:r:` successor
	// of it after a prior terminal decision. This double answers with a shape
	// that rule can never produce, so any recomputation here turns this red.
	const preparedRequestId = submissions.claimedSubmission(
		"workspace-1",
		command.idempotencyKey,
	)!.confirmationDispatch!.requestId;
	assert.equal(preparedRequestId, "confirmation:authority:task-1");
	assert.equal(response.executionConfirmationRequestId, preparedRequestId);
	// Crash recovery is an unauthorized inbound edge for a plan the merchant has
	// not approved: it must leave the submission waiting, not spend the hold.
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 0,
		failed: 0,
		started: 0,
	});
	assert.deepEqual(starter.starts, []);
});

test("the Campaign producer submits the second paid Work with its own U7 context", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	let id = 0;
	const baseAdmission = fixedAdmission();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		{
			createId(prefix) {
				id += 1;
				return `${prefix}-${id}`;
			},
			now: fixedIds().now,
		},
		{
			async admit(input) {
				const admitted = await baseAdmission.admit(input);
				return {
					...admitted,
					taskId: `campaign-task-${input.idempotencyKey}`,
					creditCost: 4,
				};
			},
		},
		undefined,
		{
			async prepare({ submission }) {
				submission.executionPlanFreeze = recoveryExecutionPlanFreeze(submission);
				return {
					threadId: asAgentThreadIdentity(`thread-${submission.task.id}`),
					runId: `run-${submission.task.id}`,
				};
			},
		},
	);
	const producer = new CampaignPaidWorkProducer(coordinator);
	const slots = projectCampaignWeeklySlots({
		campaignPlanRef: { id: "campaign-plan-1", revision: 3 },
		horizonFrom: "2026-08-10T00:00:00.000Z",
		horizonUntil: "2026-08-24T00:00:00.000Z",
	});

	await producer.produce({
		slots,
		buildSubmission(slot) {
			return {
				...submissionPayload(),
				actorId: "owner-1",
				workspaceId: "workspace-1",
				idempotencyKey: `campaign-work-${slot.workOrdinal}`,
			};
		},
	});

	// Each slot raises its own pending confirmation authority; one approval can
	// never cover the next Work, and no Work starts Make before that approval.
	assert.deepEqual(starter.starts, []);
	assert.deepEqual(
		starter.preparations.map((submission) => ({
			requestId: submission.confirmationDispatch?.requestId,
			state: submission.confirmationDispatch?.state,
			...submission.executionConfirmationContext,
		})),
		[
			{
				requestId: undefined,
				state: "pending",
				campaignPlanRef: { id: "campaign-plan-1", revision: 3 },
				workOrdinal: 1,
				approvalScope: "single_work",
			},
			{
				requestId: undefined,
				state: "pending",
				campaignPlanRef: { id: "campaign-plan-1", revision: 3 },
				workOrdinal: 2,
				approvalScope: "single_work",
			},
		],
	);
	assert.deepEqual(
		[1, 2].map((workOrdinal) => {
			const claimed = submissions.claimedSubmission(
				"workspace-1",
				`campaign-work-${workOrdinal}`,
			);
			return {
				requestId: claimed?.confirmationDispatch?.requestId,
				state: claimed?.confirmationDispatch?.state,
				...claimed?.executionConfirmationContext,
			};
		}),
		[
			{
				requestId: "confirmation:authority:campaign-task-campaign-work-1",
				state: "pending",
				campaignPlanRef: { id: "campaign-plan-1", revision: 3 },
				workOrdinal: 1,
				approvalScope: "single_work",
			},
			{
				requestId: "confirmation:authority:campaign-task-campaign-work-2",
				state: "pending",
				campaignPlanRef: { id: "campaign-plan-1", revision: 3 },
				workOrdinal: 2,
				approvalScope: "single_work",
			},
		],
	);
});

test("a definitive pre-admission Harness rejection becomes terminal", async () => {
	const submissions = new MemorySubmissionStore();
	let starts = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{
			async start() {
				starts += 1;
				throw new Error("Harness rejected the immutable request");
			},
			async classifyStartFailure() {
				return "terminal_rejection";
			},
		},
		fixedIds(),
		fixedAdmission(),
	);
	const command: Parameters<CreationSubmissionCoordinator["submit"]>[0] = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	await assert.rejects(coordinator.submit(command), /rejected/u);
	assert.equal(starts, 1);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 0,
		failed: 0,
		started: 0,
	});
	await assert.rejects(coordinator.submit(command), /permanently failed/u);
	assert.equal(starts, 1);
});

test("an ambiguous Harness acknowledgement failure remains recoverable", async () => {
	const submissions = new MemorySubmissionStore();
	let starts = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{
			async start() {
				starts += 1;
				throw new Error("Harness acknowledgement unavailable");
			},
			async classifyStartFailure() {
				return "retry";
			},
		},
		fixedIds(),
		fixedAdmission(),
	);
	const command: Parameters<CreationSubmissionCoordinator["submit"]>[0] = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	await assert.rejects(coordinator.submit(command), /acknowledgement/u);
	for (let attempt = 2; attempt <= 5; attempt += 1) {
		assert.deepEqual(await coordinator.recoverPendingStarts(), {
			attempted: 1,
			failed: 1,
			started: 0,
		});
	}
	assert.equal(starts, 5);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 1,
		failed: 1,
		started: 0,
	});
	assert.equal(starts, 6);
});

test("a terminal late answer starts one fresh quoted successor from the source snapshot", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const quotes = new ProductQuoteService();
	quotes.buildQuote({
		billingMode: "per_request",
		catalogModelId: "catalog-copy-1",
		catalogModelRevision: "catalog-r4",
		quoteId: "quote-1",
		quotePolicyRevision: "quote.policy@1",
		unitRate: 1,
		workspaceId: "workspace-1",
	});
	let contentPackages = 0;
	let works = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		{
			createId(prefix) {
				if (prefix === "content-package") {
					contentPackages += 1;
					return `package-${contentPackages}`;
				}
				works += 1;
				return `work-${works}`;
			},
			now() {
				return "2026-07-26T09:00:00.000Z";
			},
		},
		fixedAdmission(),
		quotes,
	);
	await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;

	const result = await coordinator.submitSemanticSuccessor({
		command: {
			idempotencyKey: "question-1:late_answer",
			questionId: "question-1",
			workflowRevision: 1,
			patch: {
				field: "offer_price",
				reason: "补充当前任务所需的权威事实",
				value: "398 元",
			},
			decision: { state: "accepted", value: "398 元" },
		},
		request: toHarnessWorkflowInput(
			source.snapshot,
			source.usageReservation,
		),
		sourceTaskId: source.task.id,
		workflowId: "task-late-successor",
		workspaceId: source.snapshot.workspaceId,
	});

	assert.equal(result.task.id, "task-late-successor");
	assert.equal(starter.starts.length, 2);
	const successor = starter.starts[1]!;
	assert.notEqual(successor.task.id, source.task.id);
	assert.notEqual(successor.work.id, source.work.id);
	assert.notEqual(successor.contentPackage.id, source.contentPackage.id);
	assert.notEqual(successor.snapshot.quote.id, source.snapshot.quote.id);
	assert.equal(
		successor.snapshot.semanticDecision?.sourceSnapshotId,
		source.snapshot.id,
	);
	assert.equal(
		successor.snapshot.semanticDecision?.reference.value,
		"398 元",
	);
	assert.equal(
		quotes.getQuote(
			successor.snapshot.quote.id,
		)?.taskId,
		successor.task.id,
	);
	assert.equal(
		successor.usageReservation.id,
		`usage-reservation-${successor.task.id}`,
	);
});

test("a terminal late answer preserves the frozen merchant credit quote policy", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const quotes = new ProductQuoteService();
	quotes.buildQuote({
		billingMode: "per_request",
		catalogModelId: "catalog-copy-1",
		catalogModelRevision: "catalog-r4",
		creditCost: 7,
		failureRefundsCredits: false,
		operation: "copy.generate",
		outputCount: 1,
		quoteId: "quote-1",
		quotePolicyRevision: "quote.policy@1",
		unitRate: 7,
		workspaceId: "workspace-1",
	});
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		fixedAdmission(),
		quotes,
	);
	await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;

	await coordinator.submitSemanticSuccessor({
		command: {
			idempotencyKey: "question-credit:late_answer",
			questionId: "question-credit",
			workflowRevision: 1,
			patch: {
				field: "offer_price",
				reason: "补充当前任务所需的权威事实",
				value: "398 元",
			},
			decision: { state: "accepted", value: "398 元" },
		},
		request: toHarnessWorkflowInput(
			source.snapshot,
			source.usageReservation,
		),
		sourceTaskId: source.task.id,
		workflowId: "task-credit-successor",
		workspaceId: source.snapshot.workspaceId,
	});

	const successor = starter.starts[1]!;
	assert.equal(successor.usageReservation.credits, 7);
	assert.deepEqual(successor.usageReservation.units, []);
	const successorQuote = quotes.getQuote(successor.snapshot.quote.id);
	assert.equal(successorQuote?.creditCost, 7);
	assert.equal(successorQuote?.failureRefundsCredits, false);
	// Credit-era merchant execution requires the complete reserved quote
	// contract on every successor, including operation + outputCount.
	assert.equal(successorQuote?.operation, "copy.generate");
	assert.equal(successorQuote?.outputCount, 1);
	assert.ok(successorQuote?.submissionContractHash);
});

test("a Result adjustment without artifact lineage still starts its successor under Agent planning", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const continuationHints: Array<string | undefined> = [];
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			async prepare(input) {
				continuationHints.push(input.continuationThreadId);
				input.submission.executionPlanFreeze = {} as NonNullable<
					CreationSubmissionRecord["executionPlanFreeze"]
				>;
				return {
					threadId: asAgentThreadIdentity("thread-authoritative"),
					runId: "run-authoritative",
				};
			},
		}
	);
	await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;

	// A Result delivered before agentBinding.threadId existed: no source Thread,
	// no artifact lineage. Refusing it here was worse than refusing at prepare —
	// the merchant had already confirmed the quote.
	await coordinator.submitResultAdjustment({
		actorId: "owner-1",
		idempotencyKey: "result-adjust-legacy",
		instruction: "语气更自然",
		outputCount: 1,
		quote: { id: "quote-adjust-legacy", revision: "quote-adjust-legacy-r1" },
		sourceContentPackage: { id: source.contentPackage.id, revision: 3 },
		sourceSnapshot: structuredClone(source.snapshot),
		taskId: "composer-task:result-adjust:legacy",
		textSelectionScope: {
			end: 9,
			field: "body",
			kind: "text_selection",
			packageId: source.contentPackage.id,
			selectedText: "预约到店",
			sourceTextSha256:
				"53bb35f895648a58695272f4be5b28010ddaaf5ff8adc4934f3f2130c3b25477",
			start: 5,
			versionId: "version-1",
		},
		workId: "work-result-adjust-legacy",
		workspaceId: "workspace-1",
	});

	assert.equal(starter.starts.length, 2);
	const adjusted = starter.starts[1]!;
	assert.equal(adjusted.task.id, "composer-task:result-adjust:legacy");
	assert.equal(adjusted.artifactLineage, undefined);
	assert.equal(adjusted.agentContinuationThreadId, undefined);
	// Planning still binds the successor to a Thread of its own; only the
	// continuation hint is absent, so it publishes a fresh artifact.
	assert.equal(adjusted.agentBinding?.threadId, "thread-authoritative");
	assert.deepEqual(continuationHints, [undefined, undefined]);
});

test("a Result adjustment starts one new-chain submission from the frozen source", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		fixedAdmission(),
	);
	await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;
	const sourceSnapshot = structuredClone(source.snapshot);
	sourceSnapshot.deliverable.quantity = 3;
	sourceSnapshot.deliverables[0]!.quantity = 3;
	if (sourceSnapshot.signedSubmission?.deliverable) {
		sourceSnapshot.signedSubmission.deliverable.quantity = 3;
	}

	const result = await coordinator.submitResultAdjustment({
		actorId: "owner-1",
		idempotencyKey: "result-adjust-1",
		instruction: "语气更自然",
		outputCount: 1,
		quote: { id: "quote-adjust-1", revision: "quote-adjust-r1" },
		sourceContentPackage: { id: source.contentPackage.id, revision: 3 },
		sourceSnapshot,
		taskId: "composer-task:result-adjust:1",
		textSelectionScope: {
			end: 9,
			field: "body",
			kind: "text_selection",
			packageId: source.contentPackage.id,
			selectedText: "预约到店",
			sourceTextSha256:
				"53bb35f895648a58695272f4be5b28010ddaaf5ff8adc4934f3f2130c3b25477",
			start: 5,
			versionId: "version-1",
		},
		workId: "work-result-adjust-1",
		workspaceId: "workspace-1",
	});

	assert.equal(result.work.id, "work-result-adjust-1");
	assert.equal(starter.starts.length, 2);
	const adjusted = starter.starts[1]!;
	assert.equal(adjusted.task.id, "composer-task:result-adjust:1");
	assert.equal(
		adjusted.snapshot.sources.contentPackage?.id,
		source.contentPackage.id,
	);
	assert.equal(adjusted.snapshot.sources.contentPackage?.revision, "3");
	assert.deepEqual(adjusted.snapshot.sources.textSelection, {
		end: 9,
		field: "body",
		kind: "text_selection",
		packageId: source.contentPackage.id,
		selectedText: "预约到店",
		sourceTextSha256:
			"53bb35f895648a58695272f4be5b28010ddaaf5ff8adc4934f3f2130c3b25477",
		start: 5,
		versionId: "version-1",
	});
	assert.match(adjusted.snapshot.intent.text, /调整要求：语气更自然/u);
	assert.equal(adjusted.snapshot.deliverable.quantity, 1);
	assert.equal(adjusted.snapshot.deliverables[0]?.quantity, 1);
	assert.deepEqual(
		submissions.reservedUnits("workspace-1", "result-adjust-1"),
		[{ resource: "copy", quantity: 1 }],
	);
});

test("a Result adjustment reserves its fresh confirmed credit quote instead of the source price", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const quotes = new ProductQuoteService();
	quotes.buildQuote({
		billingMode: "per_request",
		catalogModelId: "catalog-copy-1",
		catalogModelRevision: "catalog-r4",
		creditCost: 7,
		quoteId: "quote-1",
		quotePolicyRevision: "quote.policy@1",
		unitRate: 7,
		workspaceId: "workspace-1",
	});
	const adjustmentQuote = quotes.buildQuote({
		billingMode: "per_request",
		catalogModelId: "catalog-copy-1",
		catalogModelRevision: "catalog-r4",
		creditCost: 3,
		quoteId: "quote-adjust-credit-1",
		quotePolicyRevision: "quote.policy@1",
		unitRate: 3,
		workspaceId: "workspace-1",
	});
	const confirmedAdjustmentQuote = quotes.confirm({
		quoteId: adjustmentQuote.quoteId,
		taskId: "composer-task:result-adjust:credit-1",
	});
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		fixedAdmission(),
		quotes,
	);
	await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;

	await coordinator.submitResultAdjustment({
		actorId: "owner-1",
		idempotencyKey: "result-adjust-credit-1",
		instruction: "改得更简洁",
		outputCount: 1,
		quote: {
			id: confirmedAdjustmentQuote.quoteId,
			revision: confirmedAdjustmentQuote.revision,
		},
		sourceContentPackage: { id: source.contentPackage.id, revision: 1 },
		sourceSnapshot: source.snapshot,
		taskId: "composer-task:result-adjust:credit-1",
		workId: "work-result-adjust-credit-1",
		workspaceId: "workspace-1",
	});

	const adjusted = starter.starts[1]!;
	assert.equal(adjusted.usageReservation.credits, 3);
	assert.deepEqual(adjusted.usageReservation.units, []);
});

test("a legacy Result adjustment does not require the successor quote service", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		fixedAdmission(),
	);
	await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;

	await coordinator.submitResultAdjustment({
		actorId: "owner-1",
		idempotencyKey: "legacy-result-adjust-1",
		instruction: "语气更自然",
		outputCount: 1,
		quote: { id: "quote-adjust-1", revision: "quote-adjust-r1" },
		sourceContentPackage: { id: source.contentPackage.id, revision: 3 },
		sourceSnapshot: source.snapshot,
		taskId: "composer-task:legacy-result-adjust:1",
		workId: "work-legacy-result-adjust-1",
		workspaceId: "workspace-1",
	});

	assert.deepEqual(
		submissions.reservedUnits("workspace-1", "legacy-result-adjust-1"),
		[{ resource: "copy", quantity: 1 }],
	);
});

test("an image-text note Result adjustment reserves the quoted image output", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		modalityAdmission(),
	);
	await coordinator.submit({
		...modalitySubmissionPayload("image_text_note"),
		actorId: "owner-1",
		beautyVoiceRole: "customer",
		creationMode: "free",
		thinkingLevel: "deep",
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;
	assert.equal(source.snapshot.beautyVoiceRole, "customer");
	assert.equal(source.snapshot.thinkingLevel, "deep");
	assert.equal(source.snapshot.signedSubmission?.beautyVoiceRole, "customer");
	assert.equal(source.snapshot.signedSubmission?.thinkingLevel, "deep");

	const result = await coordinator.submitResultAdjustment({
		actorId: "owner-1",
		idempotencyKey: "result-adjust-note-1",
		instruction: "重做指定图片",
		outputCount: 1,
		pageRegenerationTargetAssetIds: ["asset-page-2"],
		quote: { id: "quote-adjust-note-1", revision: "quote-adjust-note-r1" },
		sourceContentPackage: { id: source.contentPackage.id, revision: 1 },
		sourceNoteStyleId: "story",
		sourceSnapshot: source.snapshot,
		taskId: "composer-task:result-adjust:note-1",
		workId: "work-result-adjust-note-1",
		workspaceId: "workspace-1",
	});

	assert.equal(result.work.id, "work-result-adjust-note-1");
	assert.equal(starter.starts.length, 2);
	const adjusted = starter.starts[1]!;
	assert.equal(adjusted.snapshot.beautyVoiceRole, "customer");
	assert.equal(adjusted.snapshot.thinkingLevel, "deep");
	assert.equal(adjusted.snapshot.signedSubmission?.beautyVoiceRole, "customer");
	assert.equal(adjusted.snapshot.signedSubmission?.thinkingLevel, "deep");
	assert.deepEqual(adjusted.snapshot.sources.pageRegeneration, {
		targetAssetIds: ["asset-page-2"],
	});
	const noteStyleDecision = starter.starts[1]?.decisionReferences?.[0];
	assert.match(noteStyleDecision?.id ?? "", /^decision-[a-f0-9]{24}$/u);
	assert.deepEqual(
		noteStyleDecision
			? {
					field: noteStyleDecision.field,
					revision: noteStyleDecision.revision,
					value: noteStyleDecision.value,
				}
			: undefined,
		{ field: "note_style", revision: 1, value: "story" },
	);
	assert.deepEqual(
		submissions.reservedUnits("workspace-1", "result-adjust-note-1"),
		[{ resource: "image", quantity: 1 }],
	);
});

test("a note text-selection adjustment starts a terminal copy-only execution", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		modalityAdmission(),
	);
	await coordinator.submit({
		...modalitySubmissionPayload("image_text_note"),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;

	await coordinator.submitResultAdjustment({
		actorId: "owner-1",
		idempotencyKey: "result-adjust-note-selection-1",
		instruction: "改得更自然",
		outputCount: 1,
		quote: {
			id: "quote-adjust-note-selection-1",
			revision: "quote-adjust-note-selection-r1",
		},
		sourceContentPackage: { id: source.contentPackage.id, revision: 1 },
		sourceNoteStyleId: "story",
		sourceSnapshot: source.snapshot,
		taskId: "composer-task:result-adjust:note-selection-1",
		textSelectionScope: {
			end: 9,
			field: "body",
			kind: "text_selection",
			packageId: source.contentPackage.id,
			platform: "xiaohongshu",
			selectedText: "预约到店",
			sourceTextSha256:
				"53bb35f895648a58695272f4be5b28010ddaaf5ff8adc4934f3f2130c3b25477",
			start: 5,
			versionId: "version-1",
		},
		workId: "work-result-adjust-note-selection-1",
		workspaceId: "workspace-1",
	});

	const adjusted = starter.starts[1]!;
	assert.equal(adjusted.snapshot.lens, "copy");
	assert.equal(adjusted.snapshot.operation, "copy.generate");
	assert.deepEqual(adjusted.snapshot.deliverables, [
		{
			id: "recipe-deliverable-image_text_note",
			kind: "copy",
			order: 0,
			quantity: 1,
		},
	]);
	assert.deepEqual(adjusted.snapshot.deliverable, {
		kind: "copy_document",
		quantity: 1,
	});
	assert.deepEqual(adjusted.usageReservation.units, [
		{ resource: "copy", quantity: 1 },
	]);
	assert.equal(
		triggersPaidMediaExecution(
			toHarnessWorkflowInput(
				adjusted.snapshot,
				adjusted.usageReservation,
				adjusted.decisionReferences,
			),
		),
		false,
	);
	assert.deepEqual(adjusted.snapshot.sources.textSelection, {
		end: 9,
		field: "body",
		kind: "text_selection",
		packageId: source.contentPackage.id,
		platform: "xiaohongshu",
		selectedText: "预约到店",
		sourceTextSha256:
			"53bb35f895648a58695272f4be5b28010ddaaf5ff8adc4934f3f2130c3b25477",
		start: 5,
		versionId: "version-1",
	});
});

test("a rejected Composer admission does not claim a shell or start Harness", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		{
			async admit() {
				throw new Error("Quote confirmation is stale");
			},
		},
	);

	await assert.rejects(
		coordinator.submit({
			...submissionPayload(),
			actorId: "owner-1",
			workspaceId: "workspace-1",
		}),
		/Quote confirmation is stale/u,
	);
	assert.equal(submissions.count(), 0);
	assert.equal(starter.starts.length, 0);
});

test("an exact replay returns its receipt before mutable admission runs again", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	let admissionCalls = 0;
	let quoteLifecycle: "confirmed" | "settled" = "confirmed";
	let selectionSource:
		| "platform_default"
		| "workspace_default" = "platform_default";
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		{
			async admit(input) {
				admissionCalls += 1;
				if (quoteLifecycle !== "confirmed") {
					throw new Error(`Quote is ${quoteLifecycle}`);
				}
				const admitted = await fixedAdmission().admit(input);
				return {
					...admitted,
					modelSelection: {
						source: selectionSource,
						catalogModelId: input.catalogModel.id,
						platformConfigRevision:
							selectionSource === "platform_default"
								? "admin-config:41"
								: null,
					},
				};
			},
		},
	);
	const command = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	const created = await coordinator.submit(command);
	assert.equal(created.replayed, false);
	quoteLifecycle = "settled";
	selectionSource = "workspace_default";
	const replays = await Promise.all(
		Array.from({ length: 12 }, () => coordinator.submit(command)),
	);

	assert.ok(replays.every((replayed) => replayed.replayed));
	assert.equal(admissionCalls, 1);
	assert.equal(submissions.count(), 1);
	assert.equal(starter.starts.length, 1);
	assert.deepEqual(starter.starts[0]?.snapshot.modelSelection, {
		source: "platform_default",
		catalogModelId: "catalog-copy-1",
		platformConfigRevision: "admin-config:41",
	});
});

test("durable recovery reclaims a committed submission whose first Harness start failed", async () => {
	const submissions = new MemorySubmissionStore();
	let starts = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{
			async start() {
				starts += 1;
				if (starts === 1) throw new Error("Harness unavailable during first start");
			},
		},
		fixedIds(),
		fixedAdmission(),
	);
	const command = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	await assert.rejects(coordinator.submit(command), /first start/u);
	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 1,
		failed: 0,
		started: 1,
	});
	assert.equal(starts, 2);
});

test("a failed start-completion record never re-runs an already admitted Harness", async () => {
	const submissions = new CompletionFailingSubmissionStore();
	let starts = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{
			async start() {
				starts += 1;
			},
		},
		fixedIds(),
		fixedAdmission(),
	);
	const command: Parameters<CreationSubmissionCoordinator["submit"]>[0] = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	await assert.rejects(coordinator.submit(command), /completion unavailable/u);
	const replayed = await coordinator.submit(command);
	assert.equal(replayed.replayed, true);
	assert.equal(starts, 1);
});

class CompletionFailingSubmissionStore extends MemorySubmissionStore {
	async completeHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}) {
		throw new Error(
			`Harness start completion unavailable for ${input.submissionId}`,
		);
	}
}

function fixtureEvents(
	cursors: Array<string | undefined>,
): WorkflowEventSource[] {
	return [
		{
			async owns(workspaceId, workflowId) {
				return workspaceId === "workspace-1" && workflowId === "task-1";
			},
			async *stream(input) {
				cursors.push(input.lastEventId);
				yield* fixtureFrames(input.workflowId);
			},
		},
	];
}

class BackpressuredSseResponse extends EventEmitter {
	destroyed = false;
	headersSent = false;
	writableEnded = false;
	private writes = 0;

	writeHead() {
		this.headersSent = true;
		return this;
	}

	write() {
		this.writes += 1;
		if (this.writes === 2) {
			this.emit("blocked");
			return false;
		}
		return true;
	}

	end() {
		this.writableEnded = true;
	}
}

class HeartbeatBackpressuredSseResponse extends EventEmitter {
	destroyed = false;
	headersSent = false;
	writableEnded = false;
	writeCount = 0;

	writeHead() {
		this.headersSent = true;
		return this;
	}

	write() {
		this.writeCount += 1;
		if (this.writeCount === 2) {
			this.emit("blocked");
			return false;
		}
		return true;
	}

	end() {
		this.writableEnded = true;
	}
}

class ErrorDestroyingSseResponse extends EventEmitter {
	destroyed = false;
	destroyError: Error | undefined;
	headersSent = false;
	writableEnded = false;

	writeHead() {
		this.headersSent = true;
		return this;
	}

	write() {
		return true;
	}

	destroy(error?: Error) {
		this.destroyed = true;
		this.destroyError = error;
		if (error) this.emit("error", error);
		return this;
	}
}

function progressFrame(taskId: string, sequence: number): WorkflowEventFrame {
	return {
		event: "workflow.progress",
		data: {
			eventId: `${taskId}:progress:${sequence}`,
			message: `stage-${sequence}`,
			occurredAt: "2026-07-22T09:00:01.000Z",
			sequence,
			sourceRevision: 1,
			stage: "intent_naming",
			state: "success",
			workflowId: taskId,
			workflowType: "beauty_marketing_harness",
		},
	};
}

async function* fixtureFrames(
	taskId: string,
): AsyncIterable<WorkflowEventFrame> {
	for (const [sequence, stage] of [
		"intent_naming",
		"context_injection",
		"brief_compilation",
		"execution_selection",
		"assembly_delivery",
	].entries()) {
		yield {
			event: "workflow.progress",
			data: {
				eventId: `${taskId}:progress:${sequence}`,
				workflowId: taskId,
				workflowType: "beauty_marketing_harness",
				sequence,
				sourceRevision: 1,
				stage,
				state: "success",
				occurredAt: "2026-07-22T09:00:01.000Z",
				message: `stage-${sequence}`,
			},
		} as WorkflowEventFrame;
	}
	yield {
		event: "workflow.state",
		data: {
			workflowId: taskId,
			sourceRevision: 1,
			status: "success",
			occurredAt: "2026-07-22T09:00:02.000Z",
			snapshot: {
				delivery: {
					packageId: "package-1",
					revision: 1,
					versionId: "version-1",
				},
				recommendation: {
					decisionTrace: {
						complianceStatus: "seven_gates_passed",
						customerAction: "私信预约",
						deliverables: ["copy_revision:1"],
						expressionIdentity: "identity-brand-r3",
						factReferences: ["fact-service-r2"],
						platforms: ["douyin"],
						whyPost: "daily_service_exposure",
					},
					recommendedCandidateId: "candidate-1",
				},
			},
		},
	} as WorkflowEventFrame;
}

function packageWithPrivateProviderFields(): ContentPackage {
	return {
		...buildContentPackage({
			id: "package-1",
			kind: "image_text",
			source: { assetIds: [], workId: "work-1" },
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
		generated: {
			assetIds: [],
			childRuns: [
				{
					providerCost: { amount: 0.4, currency: "USD", status: "observed" },
					providerModel: "provider-secret",
					routeSnapshotId: "route-secret",
					runId: "run-1",
					runType: "creative_job",
					status: "succeeded",
				},
			],
		},
	};
}

function fixedIds() {
	return {
		createId(prefix: "content-package" | "task" | "work") {
			return prefix === "content-package" ? "package-1" : `${prefix}-1`;
		},
		now() {
			return "2026-07-22T09:00:00.000Z";
		},
	};
}

function fixedAdmission(): CreationSubmissionAdmissionPort {
	return {
		async admit(input) {
			return {
				identity: input.identity ?? { id: "official-neutral", revision: "1" },
				modelPolicy: {
					id: "server-policy-copy",
					mode: "fixed",
					revision: "server-policy-r1",
				},
				modelSelection: {
					source: "platform_default",
					catalogModelId: input.catalogModel.id,
					platformConfigRevision: "admin-config:41",
				},
				recipeBinding: {
					contentModules: ["social_cover"],
					deliverables: [
						{
							aspectRatio: "3:4",
							id: "recipe-deliverable-r7",
							kind: "copy",
							order: 0,
							quantity: 1,
						},
					],
					lens: "copy",
					platform: { id: "douyin" },
				},
				route: { id: "route-1", revision: "catalog-r4" },
				rights: {
					revision: "server-rights-r1",
					summary: "Server verified source assets.",
				},
				taskId: "task-1",
			};
		},
	};
}

function modalityAdmission(): CreationSubmissionAdmissionPort {
	return {
		async prepareResultTextSelection() {
			return {
				catalogModelId: "llm-copy-adjust",
				operation: "copy.generate" as const,
			};
		},
		async admitResultTextSelection() {
			return {
				catalogModel: { id: "llm-copy-adjust", revision: "catalog-copy-r1" },
				modelPolicy: {
					id: "result-adjust-model-policy:copy.generate",
					mode: "fixed" as const,
					revision: "result-adjust:catalog-copy-r1",
				},
				modelSelection: {
					catalogModelId: "llm-copy-adjust",
					platformConfigRevision: "admin-config:copy",
					source: "platform_default" as const,
				},
				operation: "copy.generate" as const,
				route: { id: "route-copy-adjust-1", revision: "catalog-copy-r1" },
			};
		},
		async admit(input) {
			const kind = input.lens ?? "copy";
			return {
				identity: input.identity ?? { id: "official-neutral", revision: "1" },
				modelPolicy: {
					id: `server-policy-${kind}`,
					mode: "fixed",
					revision: `server-policy-${kind}-r1`,
				},
				modelSelection: {
					source: "platform_default",
					catalogModelId: input.catalogModel.id,
					platformConfigRevision: `admin-config:${kind}`,
				},
				recipeBinding: {
					contentModules: ["social_cover"],
					deliverables: [
						{
							id: `recipe-deliverable-${kind}`,
							kind,
							order: 0,
							quantity: 1,
							...(kind === "copy" ? {} : { aspectRatio: "9:16" }),
							...(kind === "video" ? { durationSeconds: 8 } : {}),
							...(kind === "image_text_note" ? { notePageBound: 3 } : {}),
						},
					],
					lens: kind,
					platform: {
						id:
							kind === "copy"
								? "douyin"
								: kind === "image"
									? "xiaohongshu"
									: "video_account",
					},
				},
				route: {
					id: `route-${kind}-1`,
					revision: `catalog-${kind}-r1`,
				},
				rights: {
					revision: `rights-${kind}-r1`,
					summary: "Server verified source assets.",
				},
				taskId: `task-${kind}`,
				...(input.imageOperation
					? { operation: input.imageOperation }
					: {}),
				...(kind === "image_text_note"
					? {
							usageUnits: [
								{ resource: "copy" as const, quantity: 2 },
								{
									resource: "image" as const,
									quantity: 3,
								},
							],
						}
					: {}),
			};
		},
	};
}

function submissionPayload(): ComposerSubmissionBody {
	return {
		briefConfirmation: { id: "brief-confirmation-1", revision: "brief-r2" },
		briefContext: { id: "brief-context-1", revision: 4 },
		catalogModel: { id: "catalog-copy-1", revision: "catalog-r4" },
		contentPackagePlatform: "douyin",
		distributionTarget: "export",
		deliverable: {
			kind: "copy_document",
			quantity: 1,
			aspectRatio: "3:4",
		},
		creationMode: "customized",
		contentModules: ["social_cover"],
		deliverables: [
			{
				aspectRatio: "3:4",
				id: "deliverable-copy-main",
				kind: "copy",
				order: 1,
				quantity: 1,
			},
		],
		identity: { id: "identity-brand", revision: "identity-r3" },
		idempotencyKey: "composer-submit-1",
		intent: "为夏日护理项目写一条预约文案",
		lens: "copy",
		modelPolicy: { id: "policy-copy", mode: "fixed", revision: "policy-r1" },
		quote: { id: "quote-1", revision: "quote-r5" },
		recipe: { id: "recipe-service-promotion", revision: "recipe-r7" },
		rights: { revision: "rights-r4", summary: "source assets are authorized" },
		route: { id: "route-1", revision: "route-r6" },
		sources: {
			assets: [
				{
					id: "asset-before-after-1",
					revision: "asset-r2",
					role: "reference",
				},
			],
			contentPackage: { id: "content-source-1", revision: "content-r3" },
		},
		surface: { id: "surface-composer", revision: "surface-r2" },
	};
}

function modalitySubmissionPayload(
	kind: "copy" | "image" | "image_text_note" | "video",
): ComposerSubmissionBody {
	return {
		...submissionPayload(),
		...(kind === "image"
			? {
					creationMode: "free" as const,
					imageOperation: "image.edit" as const,
				}
			: {}),
		catalogModel: { id: `catalog-${kind}-1`, revision: `catalog-${kind}-r1` },
		contentPackagePlatform:
			kind === "copy"
				? "douyin"
				: kind === "image" || kind === "image_text_note"
					? "xiaohongshu"
					: "video_account",
		deliverable: {
			kind:
				kind === "copy"
					? "copy_document"
					: kind === "image"
						? "image_set"
						: kind === "image_text_note"
							? "note"
						: "video_package",
			quantity: 1,
			...(kind === "copy" ? {} : { aspectRatio: "9:16" as const }),
			...(kind === "video" ? { durationSeconds: 8 } : {}),
			...(kind === "image_text_note" ? { notePageBound: 3 } : {}),
		},
		deliverables: [
			{
				id: `browser-${kind}-main`,
				kind,
				order: 1,
				quantity: 1,
				...(kind === "copy" ? {} : { aspectRatio: "1:1" }),
				...(kind === "video" ? { durationSeconds: 3 } : {}),
				...(kind === "image_text_note" ? { notePageBound: 3 } : {}),
			},
		],
		idempotencyKey: `composer-${kind}-1`,
		lens: kind,
		modelPolicy: { id: `browser-policy-${kind}`, mode: "fixed", revision: "browser-r1" },
		recipe: { id: `recipe-${kind}-1`, revision: `recipe-${kind}-r1` },
		route: { id: `route-${kind}-1`, revision: `route-${kind}-r1` },
	};
}

/** Marker freeze: this test asserts the freeze survives recovery, not its shape. */
function freezeForRecoveryTest() {
	return {
		planId: "plan-recovered",
		planRevision: 1,
		intentDeclaration: { summary: "recovered" },
		contextBundleRef: { bundleId: "context-1", revision: 1, hash: "hash-1" },
		executionPlan: {
			schemaVersion: "compiled-execution-plan/v1",
			units: [],
			dependencyGroups: [],
		},
		deliverables: [],
		quoteRef: { id: "quote-1", revision: 1 },
		rightsRevisionRefs: [],
		harnessReleaseId: "composer-plan-surface-v1",
		approvalBasis: "policy_exempt_copy",
	} as unknown as NonNullable<
		CreationSubmissionRecord["executionPlanFreeze"]
	>;
}

test("V31-18 P0-1: crash recovery starts Make through plan preparation, not around it", async () => {
	const submissions = new MemorySubmissionStore();
	const harness = new RecordingHarnessStarter();
	let failNextStart = true;
	let prepareCalls = 0;
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		{
			async start(submission) {
				if (failNextStart) {
					failNextStart = false;
					throw new Error("Harness acknowledgement unavailable");
				}
				return harness.start(submission);
			},
			async classifyStartFailure() {
				return "retry";
			},
		},
		fixedIds(),
		fixedAdmission(),
		undefined,
		{
			// Stands in for ComposerPlanSessionCoordinator.prepare: it retrieves
			// confirmed memory and leaves the compile freeze on the record.
			async prepare(input) {
				prepareCalls += 1;
				input.submission.executionPlanFreeze = freezeForRecoveryTest();
				return { threadId: asAgentThreadIdentity("thread-recovered"), runId: "run-recovered" };
			},
		},
	);
	const command: Parameters<CreationSubmissionCoordinator["submit"]>[0] = {
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	};

	await assert.rejects(coordinator.submit(command), /acknowledgement/u);
	assert.equal(prepareCalls, 1);
	assert.equal(harness.starts.length, 0);

	assert.deepEqual(await coordinator.recoverPendingStarts(), {
		attempted: 1,
		failed: 0,
		started: 1,
	});
	// `listRecoverableHarnessStarts` rebuilds the record from storage, so the
	// in-memory freeze from the first attempt is gone. Recovery that skips plan
	// preparation therefore starts Make with no ExecutionPlanSnapshot and no
	// memory retrieval — the paid submission silently degrades to legacy.
	assert.equal(prepareCalls, 2);
	assert.equal(harness.starts.length, 1);
	assert.ok(
		harness.starts[0]?.executionPlanFreeze,
		"recovered Make start must carry the compile freeze",
	);
});

test("V31-18 P0-2: a Result adjustment retrieves confirmed memory like a first submission", async () => {
	const submissions = new MemorySubmissionStore();
	const starter = new RecordingHarnessStarter();
	const retrievals: Array<{ workspaceId: string; taskId: string }> = [];
	const plans = new MemoryMarketingPlanStore();
	const planCompiler = new PlanCompiler({
		store: plans,
		ports: createFixturePlanCompilerPorts(),
	});
	const coordinator = new CreationSubmissionCoordinator(
		submissions,
		starter,
		fixedIds(),
		fixedAdmission(),
		undefined,
		new ComposerPlanSessionCoordinator(
			new MemoryAgentSessionStore(),
			plans,
			{
				compilePlan: (input) => planCompiler.compile(input),
				adjustPlan: (input) => planCompiler.adjust(input),
				retrieveConfirmedExperience: async (input) => {
					retrievals.push({
						workspaceId: input.workspaceId,
						taskId: input.taskId,
					});
					return [];
				},
			},
		),
	);
	await coordinator.submit({
		...submissionPayload(),
		actorId: "owner-1",
		workspaceId: "workspace-1",
	});
	assert.deepEqual(retrievals, [
		{ workspaceId: "workspace-1", taskId: "task-1" },
	]);

	const source = starter.starts[0]!;
	await coordinator.submitResultAdjustment({
		actorId: "owner-1",
		idempotencyKey: "result-adjust-memory-1",
		instruction: "语气更自然",
		outputCount: 1,
		quote: { id: "quote-adjust-1", revision: "quote-adjust-r1" },
		sourceContentPackage: { id: source.contentPackage.id, revision: 1 },
		sourceSnapshot: structuredClone(source.snapshot),
		taskId: "composer-task:result-adjust:memory",
		workId: "work-result-adjust-memory",
		workspaceId: "workspace-1",
	});

	// A correction ("下次别这样") is exactly where a merchant checks whether the
	// preference they confirmed took hold. `submitResultAdjustment` claimed and
	// started Make without ever preparing a plan, so confirmed memory was never
	// retrieved, no MemoryInjectionReceipt was written, and the receipt panel
	// stayed empty on the one path that tests recurrence.
	assert.deepEqual(retrievals, [
		{ workspaceId: "workspace-1", taskId: "task-1" },
		{
			workspaceId: "workspace-1",
			taskId: "composer-task:result-adjust:memory",
		},
	]);
	assert.equal(starter.starts.length, 2);
	assert.ok(
		starter.starts[1]?.executionPlanFreeze,
		"the adjustment must carry its own compile freeze",
	);
});
function recoveryExecutionPlanFreeze(
	submission: CreationSubmissionRecord,
): NonNullable<CreationSubmissionRecord["executionPlanFreeze"]> {
	return {
		planId: `plan-${submission.task.id}` as never,
		planRevision: 1,
		intentDeclaration: { summary: submission.snapshot.intent.text },
		contextBundleRef: {
			bundleId: submission.snapshot.briefContext.id,
			revision: submission.snapshot.briefContext.revision,
			hash: "context-freeze-hash",
		},
		executionPlan: {
			schemaVersion: "compiled-execution-plan/v1",
			units: [
				{
					unitId: "unit-1" as never,
					unitType: "copy.generate",
					primitive: "generate",
				},
			],
			dependencyGroups: [
				{ groupId: "group-1", unitIds: ["unit-1" as never] },
			],
			boundedRetry: {
				"unit-1": {
					maxAttempts: 1,
					maxCostCents: 0,
					retry: { enabled: false },
				},
			},
		},
		deliverables: [
			{ deliverableId: "deliverable-1", kind: "copy", quantity: 1 },
		],
		quoteRef: submission.snapshot.quote,
		rightsRevisionRefs: [submission.snapshot.rights.revision],
		harnessReleaseId: "release-recovery-1" as never,
		approvalBasis: "merchant_confirmed",
	};
}
