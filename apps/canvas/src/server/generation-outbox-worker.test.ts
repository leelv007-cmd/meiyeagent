import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
	CoreGenerationProviderError,
	type CoreGenerationSubmitInput,
} from "./core-generation-provider";
import {
	type CanvasGenerationOutboxClaim,
	type CanvasGenerationOutboxRepository,
	CanvasGenerationOutboxWorker,
	PostgresCanvasGenerationOutboxRepository,
} from "./generation-outbox-worker";

const request: CoreGenerationSubmitInput = {
	correlationId: "corr-worker-1",
	dataClass: [],
	idempotencyKey: "generation-key-1",
	inputAssets: [],
	inputNodeBindings: [],
	modelId: "image-model-1",
	operation: "image.generate",
	parameters: {},
	projectId: "project-1",
	prompt: "Create a campaign image",
	quoteId: "quote-1",
	revisionId: "revision-1",
	userId: "user-a",
	workspaceId: "workspace-a",
};

test("two workers submit exactly once because Core access happens after atomic claim", async () => {
	const events: string[] = [];
	const repository = new MemoryOutboxRepository(events, request);
	let submissions = 0;
	const provider = {
		async submit(input: CoreGenerationSubmitInput) {
			events.push(`core:${input.projectId}`);
			submissions += 1;
			await Promise.resolve();
			return { jobId: "core-job-1", status: "unknown" as const };
		},
	};
	const clock = () => new Date("2026-07-16T06:30:00.000Z");
	const first = new CanvasGenerationOutboxWorker(repository, provider, {
		claimToken: () => "claim-a",
		clock,
	});
	const second = new CanvasGenerationOutboxWorker(repository, provider, {
		claimToken: () => "claim-b",
		clock,
	});

	const results = await Promise.all([
		first.runOnce("worker-a"),
		second.runOnce("worker-b"),
	]);

	assert.equal(submissions, 1);
	assert.deepEqual(results.map((result) => result.status).sort(), [
		"idle",
		"submitted",
	]);
	assert.deepEqual(events.slice(0, 2), [
		"claim:worker-a:canvas-outbox-1",
		"claim:worker-b:none",
	]);
	assert.ok(
		events.indexOf("core:project-1") >
			events.indexOf("claim:worker-a:canvas-outbox-1"),
	);
	assert.equal(repository.status, "submitted");
	assert.equal(repository.coreJobId, "core-job-1");
});

test("an inactive Core result is terminal and keeps the authoritative error code", async () => {
	const repository = new MemoryOutboxRepository([], request);
	const worker = new CanvasGenerationOutboxWorker(
		repository,
		{
			async submit() {
				throw new CoreGenerationProviderError(
					"INVALID_STATE",
					"No active model deployment is available.",
					{ retryable: false, status: 409 },
				);
			},
		},
		{
			claimToken: () => "claim-a",
			clock: () => new Date("2026-07-16T06:30:00.000Z"),
		},
	);

	const result = await worker.runOnce("worker-a");

	assert.equal(result.status, "failed");
	assert.equal(repository.status, "failed");
	assert.equal(repository.errorCode, "INVALID_STATE");
	assert.equal(repository.retryAt, undefined);
});

test("PostgreSQL claim is one atomic SKIP LOCKED update", async () => {
	const calls: Array<{ sql: string; values?: unknown[] }> = [];
	const pool = {
		async query(sql: string, values?: unknown[]) {
			calls.push({ sql, values });
			return { rows: [] };
		},
	} as unknown as Pool;
	const repository = new PostgresCanvasGenerationOutboxRepository(pool);

	const claim = await repository.claimNext({
		claimToken: "claim-a",
		leaseMs: 60_000,
		now: new Date("2026-07-16T06:30:00.000Z"),
		workerId: "worker-a",
	});

	assert.equal(claim, null);
	assert.equal(calls.length, 1);
	assert.match(calls[0]?.sql ?? "", /FOR UPDATE SKIP LOCKED/u);
	assert.match(
		calls[0]?.sql ?? "",
		/WITH candidate[\s\S]+UPDATE canvas_core_generation_outbox[\s\S]+RETURNING outbox\.\*/u,
	);
});

class MemoryOutboxRepository implements CanvasGenerationOutboxRepository {
	status: "pending" | "claimed" | "submitted" | "failed" | "retry" = "pending";
	coreJobId?: string;
	errorCode?: string;
	retryAt?: Date;

	constructor(
		private readonly events: string[],
		private readonly request: CoreGenerationSubmitInput,
	) {}

	async claimNext(input: {
		claimToken: string;
		leaseMs: number;
		now: Date;
		workerId: string;
	}): Promise<CanvasGenerationOutboxClaim | null> {
		if (this.status !== "pending") {
			this.events.push(`claim:${input.workerId}:none`);
			return null;
		}
		this.status = "claimed";
		this.events.push(`claim:${input.workerId}:canvas-outbox-1`);
		return {
			attemptCount: 1,
			claimToken: input.claimToken,
			id: "canvas-outbox-1",
			localJobId: "canvas-job-1",
			request: this.request,
			source: "canvas_generation",
			workspaceId: this.request.workspaceId,
		};
	}

	async markSubmitted(input: {
		claimToken: string;
		coreJobId: string;
		coreStatus: "completed" | "unknown" | "failed";
		id: string;
		now: Date;
	}) {
		if (this.status !== "claimed" || input.claimToken !== "claim-a") {
			return false;
		}
		this.status = "submitted";
		this.coreJobId = input.coreJobId;
		return true;
	}

	async markFailed(input: {
		claimToken: string;
		code: string;
		id: string;
		message: string;
		now: Date;
		retryAt?: Date;
	}) {
		if (this.status !== "claimed" || input.claimToken !== "claim-a") {
			return false;
		}
		this.status = input.retryAt ? "retry" : "failed";
		this.errorCode = input.code;
		this.retryAt = input.retryAt;
		return true;
	}
}
