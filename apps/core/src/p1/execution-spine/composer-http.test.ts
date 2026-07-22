import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { ContentPackage, DiagnosticRun } from "@meiye/contracts";

import type { DiagnosticRepository } from "../../diagnostics/repository.js";
import { createCoreServer } from "../../server.js";
import { buildContentPackage } from "../operations/content-package.js";
import {
	WorkflowEventApplicationService,
	type WorkflowEventFrame,
	type WorkflowEventSource,
} from "../workflow-events.js";
import type { ComposerSubmissionBody } from "./creation-execution-snapshot.js";
import {
	CreationSubmissionCoordinator,
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
			deliverables: [
				{
					id: "deliverable-image",
					kind: "image",
					order: 1,
					quantity: 1,
				},
			],
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
			schemaVersion: "creation-execution-snapshot/v1",
		},
		task: { id: "task-1" },
		usageReservation: { id: "usage-reservation-task-1" },
		work: { id: "work-1" },
	});
	assert.equal(starter.starts.length, 1);
	assert.equal(starter.starts[0]?.snapshot.lens, "copy");
	assert.equal(starter.starts[0]?.snapshot.platform.id, "douyin");
	assert.deepEqual(starter.starts[0]?.snapshot.deliverables, [
		{
			aspectRatio: "3:4",
			id: "deliverable-copy-main",
			kind: "copy",
			order: 1,
			quantity: 1,
		},
	]);
	assert.deepEqual(starter.starts[0]?.snapshot.recipe, {
		id: "recipe-service-promotion",
		revision: "recipe-r7",
	});
	assert.equal(
		JSON.stringify(starter.starts[0]?.snapshot).includes("provider-secret"),
		false,
	);

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

	const conflict = await fetch(`${base}/submissions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			...submissionPayload(),
			platform: { id: "xiaohongshu" },
		}),
	});
	assert.equal(conflict.status, 409);
	assert.equal(
		(await conflict.json()).error.code,
		"CREATION_SUBMISSION_IDEMPOTENCY_CONFLICT",
	);

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

class MemorySubmissionStore implements CreationSubmissionStore {
	private readonly claims = new Map<string, CreationSubmissionStoreClaim>();
	private readonly harnessStarts = new Map<
		string,
		{ state: "reserved" | "starting" | "started"; leaseId?: string }
	>();

	async claim(input: CreationSubmissionStoreClaim) {
		const key = `${input.workspaceId}:${input.idempotencyKey}`;
		const existing = this.claims.get(key);
		if (!existing) {
			this.claims.set(key, structuredClone(input));
			this.harnessStarts.set(input.submission.snapshot.id, {
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
			this.harnessStarts.set(input.submissionId, {
				state: "starting",
				leaseId,
			});
			return { kind: "start" as const, leaseId };
		}
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
		this.harnessStarts.set(input.submissionId, { state: "started" });
	}

	async releaseHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}) {
		const current = this.harnessStarts.get(input.submissionId);
		if (current?.state === "starting" && current.leaseId === input.leaseId) {
			this.harnessStarts.set(input.submissionId, { state: "reserved" });
		}
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

function submissionPayload(): ComposerSubmissionBody {
	return {
		briefConfirmation: { id: "brief-confirmation-1", revision: "brief-r2" },
		catalogModel: { id: "catalog-copy-1", revision: "catalog-r4" },
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
		platform: { id: "douyin" },
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
