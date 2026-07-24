import { fingerprintValue } from "../job-runtime/job-contracts.js";

import {
	type CreationExecutionSnapshot,
	type ComposerSubmissionRequest,
	createCreationExecutionSnapshot,
	creationSubmissionCommandSchema,
	composerSubmissionRequestSchema,
} from "./creation-execution-snapshot.js";

export interface CreationSubmissionRecord {
	snapshot: CreationExecutionSnapshot;
	work: { id: string };
	task: { id: string };
	contentPackage: { id: string; expectedRevision: number };
	usageReservation: { id: string };
}

/**
 * The persistence boundary is one transaction: claim the idempotency key,
 * freeze the snapshot, associate the three product shells, and reserve usage.
 * The concrete PostgreSQL adapter belongs at the composition root.
 */
export interface CreationSubmissionStoreClaim {
	workspaceId: string;
	idempotencyKey: string;
	payloadHash: string;
	submission: CreationSubmissionRecord;
}

export interface CreationSubmissionStore {
	claim(
		input: CreationSubmissionStoreClaim,
	): Promise<
		| { kind: "created"; submission: CreationSubmissionRecord }
		| { kind: "existing"; submission: CreationSubmissionRecord }
		| { kind: "conflict" }
	>;
	/**
	 * Separately leases the one external Harness start after the submission
	 * transaction has committed. A retry can reclaim a released lease without
	 * making another reservation.
	 */
	claimHarnessStart(input: {
		workspaceId: string;
		submissionId: string;
	}): Promise<{ kind: "start"; leaseId: string } | { kind: "started" }>;
	completeHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}): Promise<void>;
	releaseHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}): Promise<void>;
	/**
	 * Returns committed submissions that have never been dispatched or whose
	 * dispatch lease expired. The caller must still claim a fresh lease before
	 * invoking Harness.
	 */
	listRecoverableHarnessStarts(input: {
		limit: number;
	}): Promise<Array<{ submission: CreationSubmissionRecord }>>;
}

/** StagePort boundary: the coordinator never imports DBOS or a durable carrier. */
export interface CreationSubmissionHarnessStarter {
	start(input: CreationSubmissionRecord): Promise<void>;
}

export interface CreationSubmissionIdFactory {
	createId(prefix: "content-package" | "work"): string;
	now(): string;
}

export interface CreationSubmissionAdmissionPort {
	/**
	 * Validates server-owned facts before the Coordinator claims its idempotency
	 * root or writes any Work, Task, ContentPackage, or usage reservation.
	 */
	admit(input: ComposerSubmissionRequest): Promise<{
		modelPolicy: { id: string; mode: "auto" | "fixed"; revision: string };
		recipeBinding: Pick<
			CreationExecutionSnapshot,
			"contentModules" | "deliverables" | "lens" | "platform"
		>;
		route: { id: string; revision: string };
		rights: { revision: string; summary: string };
		taskId: string;
	}>;
}

export class CreationSubmissionConflictError extends Error {
	readonly code = "CREATION_SUBMISSION_IDEMPOTENCY_CONFLICT";
	readonly status = 409;

	constructor() {
		super(
			"This idempotency key was already used for a different Composer submission.",
		);
		this.name = "CreationSubmissionConflictError";
	}
}

export class CreationSubmissionCoordinator {
	constructor(
		private readonly store: CreationSubmissionStore,
		private readonly harness: CreationSubmissionHarnessStarter,
		private readonly ids: CreationSubmissionIdFactory,
		private readonly admission: CreationSubmissionAdmissionPort,
	) {}

	async submit(input: ComposerSubmissionRequest) {
		const request = composerSubmissionRequestSchema.parse(input);
		const admitted = await this.admission.admit(request);
		const serverBoundRequest = {
			...request,
			contentModules: admitted.recipeBinding.contentModules,
			deliverables: admitted.recipeBinding.deliverables,
			lens: admitted.recipeBinding.lens,
			modelPolicy: admitted.modelPolicy,
			platform: admitted.recipeBinding.platform,
			route: admitted.route,
			rights: admitted.rights,
		};
		const command = creationSubmissionCommandSchema.parse({
			...serverBoundRequest,
			taskId: admitted.taskId,
			workId: this.ids.createId("work"),
			contentPackageId: this.ids.createId("content-package"),
			expectedContentPackageRevision: 0,
		});
		const snapshot = createCreationExecutionSnapshot(command, this.ids.now());
		const submission: CreationSubmissionRecord = {
			snapshot,
			work: { id: snapshot.work.id },
			task: { id: snapshot.task.id },
			contentPackage: { ...snapshot.contentPackage },
			usageReservation: { id: `usage-reservation-${snapshot.task.id}` },
		};
		const { idempotencyKey: _idempotencyKey, ...canonicalPayload } =
			serverBoundRequest;
		const claimed = await this.store.claim({
			workspaceId: command.workspaceId,
			idempotencyKey: command.idempotencyKey,
			payloadHash: fingerprintValue(canonicalPayload),
			submission,
		});
		if (claimed.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		await this.startHarness(claimed.submission);
		return {
			contentPackage: claimed.submission.contentPackage,
			replayed: claimed.kind === "existing",
			snapshot: {
				id: claimed.submission.snapshot.id,
				schemaVersion: claimed.submission.snapshot.schemaVersion,
			},
			task: claimed.submission.task,
			usageReservation: claimed.submission.usageReservation,
			work: claimed.submission.work,
		};
	}

	/** Replays only committed, reclaimable starts after a process crash. */
	async recoverPendingStarts(limit = 100) {
		const recoverable = await this.store.listRecoverableHarnessStarts({ limit });
		let failed = 0;
		let started = 0;
		for (const candidate of recoverable) {
			try {
				if (await this.startHarness(candidate.submission)) started += 1;
			} catch {
				failed += 1;
			}
		}
		return { attempted: recoverable.length, failed, started };
	}

	private async startHarness(submission: CreationSubmissionRecord) {
		const startLease = {
			workspaceId: submission.snapshot.workspaceId,
			submissionId: submission.snapshot.id,
		};
		const harnessClaim = await this.store.claimHarnessStart(startLease);
		if (harnessClaim.kind === "started") return false;
		const leasedStart = { ...startLease, leaseId: harnessClaim.leaseId };
		let started = false;
		try {
			await this.harness.start(submission);
			started = true;
			await this.store.completeHarnessStart(leasedStart);
			return true;
		} catch (error) {
			if (!started) {
				try {
					await this.store.releaseHarnessStart(leasedStart);
				} catch {
					// Keep the Harness failure as the user-visible cause.
				}
			}
			throw error;
		}
	}
}
