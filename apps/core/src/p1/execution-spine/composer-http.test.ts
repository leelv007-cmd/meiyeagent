import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
	isComposerVariantPlatform,
	pickComposerSubmissionSignedFields,
	type ContentPackage,
	type DiagnosticRun,
} from "@meiye/contracts";

import type { DiagnosticRepository } from "../../diagnostics/repository.js";
import { createCoreServer, streamWorkflowEvents } from "../../server.js";
import { buildContentPackage } from "../operations/content-package.js";
import {
	WorkflowEventApplicationService,
	type WorkflowEventFrame,
	type WorkflowEventSource,
} from "../workflow-events.js";
import { toHarnessWorkflowInput } from "./creation-stage-port.js";
import { ProductQuoteService } from "../product-billing/quote-service.js";
import type { ComposerSubmissionBody } from "./creation-execution-snapshot.js";
import {
	CreationSubmissionCoordinator,
	type CreationSubmissionAdmissionPort,
	type CreationSubmissionHarnessStarter,
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
	private readonly claims = new Map<string, CreationSubmissionStoreClaim>();
	private readonly harnessStarts = new Map<
		string,
		{
			attempts: number;
			state: "failed" | "reserved" | "starting" | "started";
			leaseId?: string;
		}
	>();

	/** What the coordinator actually reserved, for allowance-unit assertions. */
	reservedUnits(workspaceId: string, idempotencyKey: string) {
		return this.claims.get(`${workspaceId}:${idempotencyKey}`)?.submission
			.usageReservation.units;
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

	async claim(input: CreationSubmissionStoreClaim) {
		const key = `${input.workspaceId}:${input.idempotencyKey}`;
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

	async start(input: Parameters<CreationSubmissionHarnessStarter["start"]>[0]) {
		this.starts.push(structuredClone(input));
	}
}

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
	assert.match(adjusted.snapshot.intent.text, /调整要求：语气更自然/u);
	assert.equal(adjusted.snapshot.deliverable.quantity, 1);
	assert.equal(adjusted.snapshot.deliverables[0]?.quantity, 1);
	assert.deepEqual(
		submissions.reservedUnits("workspace-1", "result-adjust-1"),
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
		workspaceId: "workspace-1",
	});
	const source = starter.starts[0]!;

	const result = await coordinator.submitResultAdjustment({
		actorId: "owner-1",
		idempotencyKey: "result-adjust-note-1",
		instruction: "重做指定图片",
		outputCount: 1,
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
