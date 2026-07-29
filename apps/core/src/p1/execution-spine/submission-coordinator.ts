import {
	pickComposerSubmissionSignedFields,
	structuredDecisionInputSchema,
	type StructuredDecisionInput,
} from "@meiye/contracts";

import { fingerprintValue } from "../job-runtime/job-contracts.js";
import { selectImageIntentOperation } from "../harness/image-intent-compiler.js";
import type { HarnessWorkflowInput } from "../harness/task-admission.js";
import { buildTerminalSemanticDecisionSuccessor } from "../harness/semantic-decision-resumption.js";
import type { ProductBillingApplicationPort } from "../product-billing/durable-service.js";

import {
	type CreationExecutionSnapshot,
	type ComposerSubmissionRequest,
	createCreationExecutionSnapshot,
	creationExecutionSnapshotSchema,
	creationSubmissionCommandSchema,
	composerSubmissionRequestSchema,
} from "./creation-execution-snapshot.js";

export interface CreationSubmissionRecord {
	snapshot: CreationExecutionSnapshot;
	work: { id: string };
	task: { id: string };
	contentPackage: { id: string; expectedRevision: number };
	usageReservation: { id: string; units: CreationSubmissionUsageUnit[] };
}

export interface CreationSubmissionUsageUnit {
	resource: "copy" | "image" | "video";
	quantity: number;
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
	readReceipt(input: {
		workspaceId: string;
		idempotencyKey: string;
		payloadHash: string;
	}): Promise<
		| { kind: "missing" }
		| { kind: "existing"; submission: CreationSubmissionRecord }
		| { kind: "conflict" }
	>;
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
	}): Promise<
		| { kind: "start"; attempts: number; leaseId: string }
		| { kind: "failed" }
		| { kind: "started" }
	>;
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
	failHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}): Promise<boolean>;
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
	classifyStartFailure?(
		input: CreationSubmissionRecord,
		error: unknown,
	): Promise<"retry" | "terminal_rejection">;
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
		identity: { id: string; revision: string };
		identityDecision?: { id: string; revision: number };
		modelPolicy: { id: string; mode: "auto" | "fixed"; revision: string };
		modelSelection: NonNullable<CreationExecutionSnapshot["modelSelection"]>;
		recipeBinding: Pick<
			CreationExecutionSnapshot,
			"contentModules" | "deliverables" | "lens"
		>;
		operation?: CreationExecutionSnapshot["operation"];
		route: { id: string; revision: string };
		rights: { revision: string; summary: string };
		taskId: string;
		usageUnits?: CreationSubmissionUsageUnit[];
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
		private readonly successorQuotes?: Pick<
			ProductBillingApplicationPort,
			"buildQuote" | "confirm" | "getQuote"
		>,
	) {}

	async submit(input: ComposerSubmissionRequest) {
		const request = composerSubmissionRequestSchema.parse(input);
		const payloadHash = fingerprintValue(receiptPayload(request));
		const receipt = await this.store.readReceipt({
			workspaceId: request.workspaceId,
			idempotencyKey: request.idempotencyKey,
			payloadHash,
		});
		if (receipt.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		if (receipt.kind === "existing") {
			await this.startHarness(receipt.submission);
			return submissionResponse(receipt.submission, true);
		}

		const admitted = await this.admission.admit(request);
		const serverBoundRequest = {
			...request,
			contentModules: admitted.recipeBinding.contentModules,
			deliverables: admitted.recipeBinding.deliverables,
			identity: admitted.identity,
			identityDecision: admitted.identityDecision,
			lens: admitted.recipeBinding.lens,
			modelPolicy: admitted.modelPolicy,
			modelSelection: admitted.modelSelection,
			operation:
				admitted.operation ??
				operationForRequest(
					admitted.recipeBinding.lens,
					request.sources.assets.length,
				),
			platform: {
				id:
					request.contentPackagePlatform === "offline_material" ||
					request.contentPackagePlatform === "generic"
						? ("offline" as const)
						: request.contentPackagePlatform,
			},
			route: admitted.route,
			rights: admitted.rights,
		};
		const command = creationSubmissionCommandSchema.parse({
			...serverBoundRequest,
			signedSubmission: pickComposerSubmissionSignedFields(request),
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
			usageReservation: {
				id: `usage-reservation-${snapshot.task.id}`,
				units: admitted.usageUnits ?? productUsageUnits(snapshot),
			},
		};
		const claimed = await this.store.claim({
			workspaceId: command.workspaceId,
			idempotencyKey: command.idempotencyKey,
			payloadHash,
			submission,
		});
		if (claimed.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		await this.startHarness(claimed.submission);
		return submissionResponse(
			claimed.submission,
			claimed.kind === "existing",
		);
	}

	async submitResultAdjustment(input: {
		actorId: string;
		idempotencyKey: string;
		instruction: string;
		outputCount: number;
		quote: { id: string; revision: string };
		sourceContentPackage: { id: string; revision: number };
		sourceSnapshot: CreationExecutionSnapshot;
		taskId: string;
		workId: string;
		workspaceId: string;
	}) {
		const source = creationExecutionSnapshotSchema.parse(input.sourceSnapshot);
		if (source.workspaceId !== input.workspaceId) {
			throw new Error("Result adjustment source does not match its workspace.");
		}
		const intent = `${source.intent.text}\n\n调整要求：${input.instruction}`;
		const deliverable = {
			...source.deliverable,
			quantity: input.outputCount,
		};
		const deliverables = source.deliverables.map((item) => ({
			...item,
			quantity: input.outputCount,
		}));
		const signedSubmission = pickComposerSubmissionSignedFields({
			...(source.signedSubmission ?? {}),
			catalogModel: source.catalogModel,
			contentPackagePlatform: source.contentPackagePlatform,
			creationMode: source.creationMode,
			deliverable,
			distributionTarget: source.distributionTarget,
			intent,
			recipe: source.recipe,
		});
		const command = creationSubmissionCommandSchema.parse({
			actorId: input.actorId,
			briefConfirmation: source.briefConfirmation,
			briefContext: source.briefContext,
			catalogModel: source.catalogModel,
			contentModules: source.contentModules,
			contentPackageId: this.ids.createId("content-package"),
			contentPackagePlatform: source.contentPackagePlatform,
			creationMode: source.creationMode,
			deliverable,
			deliverables,
			distributionTarget: source.distributionTarget,
			expectedContentPackageRevision: 0,
			idempotencyKey: input.idempotencyKey,
			identity: source.identity,
			identityDecision: source.identityDecision,
			intent,
			lens: source.lens,
			modelPolicy: source.modelPolicy,
			modelSelection: source.modelSelection,
			operation: source.operation,
			platform: source.platform,
			quote: input.quote,
			recipe: source.recipe,
			rights: source.rights,
			route: source.route,
			signedSubmission,
			sources: {
				assets: source.sources.assets,
				contentPackage: {
					id: input.sourceContentPackage.id,
					revision: String(input.sourceContentPackage.revision),
				},
			},
			surface: source.surface,
			taskId: input.taskId,
			workId: input.workId,
			workspaceId: input.workspaceId,
		});
		const snapshot = createCreationExecutionSnapshot(command, this.ids.now());
		const submission: CreationSubmissionRecord = {
			contentPackage: { ...snapshot.contentPackage },
			snapshot,
			task: { id: snapshot.task.id },
			usageReservation: {
				id: `usage-reservation-${snapshot.task.id}`,
				units: productUsageUnits(snapshot),
			},
			work: { id: snapshot.work.id },
		};
		const claimed = await this.store.claim({
			idempotencyKey: input.idempotencyKey,
			payloadHash: fingerprintValue({
				instruction: input.instruction,
				outputCount: input.outputCount,
				quote: input.quote,
				sourceContentPackage: input.sourceContentPackage,
				sourceSnapshotId: source.id,
				taskId: input.taskId,
				workId: input.workId,
			}),
			submission,
			workspaceId: input.workspaceId,
		});
		if (claimed.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		await this.startHarness(claimed.submission);
		return submissionResponse(
			claimed.submission,
			claimed.kind === "existing",
		);
	}

	async submitSemanticSuccessor(input: {
		command: StructuredDecisionInput;
		request: HarnessWorkflowInput;
		sourceTaskId: string;
		workflowId: string;
		workspaceId: string;
	}) {
		if (!this.successorQuotes || !input.request.executionSnapshot) {
			throw new Error("Semantic successor submission is unavailable.");
		}
		const source = creationExecutionSnapshotSchema.parse(
			input.request.executionSnapshot,
		);
		const command = structuredDecisionInputSchema.parse(input.command);
		if (
			source.workspaceId !== input.workspaceId ||
			source.task.id !== input.sourceTaskId
		) {
			throw new Error("Semantic successor source does not match its task.");
		}
		const sourceQuote = await this.successorQuotes.getQuote(
			source.quote.id,
			source.workspaceId,
		);
		if (!sourceQuote) {
			throw new Error("Semantic successor source quote was not found.");
		}
		const quoteId = `quote-${input.workflowId}`;
		const quote = await this.successorQuotes.buildQuote({
			authorizedCeiling: sourceQuote.authorizedCeiling,
			billingMode: sourceQuote.billingMode,
			catalogModelId: source.catalogModel.id,
			catalogModelRevision: source.catalogModel.revision,
			...(sourceQuote.formula.currency
				? { currency: sourceQuote.formula.currency }
				: {}),
			...(sourceQuote.frozenCandidateDeploymentIds
				? {
						frozenCandidateDeploymentIds:
							sourceQuote.frozenCandidateDeploymentIds,
					}
				: {}),
			formulaExpression: sourceQuote.formula.expression,
			...(sourceQuote.minChargeSeconds !== undefined
				? { minChargeSeconds: sourceQuote.minChargeSeconds }
				: {}),
			...(sourceQuote.outputCount !== undefined
				? { outputCount: sourceQuote.outputCount }
				: {}),
			...(sourceQuote.outputLabel
				? { outputLabel: sourceQuote.outputLabel }
				: {}),
			quoteId,
			quotePolicyRevision: sourceQuote.quotePolicyRevision,
			...(sourceQuote.roundingStepSeconds !== undefined
				? { roundingStepSeconds: sourceQuote.roundingStepSeconds }
				: {}),
			...(sourceQuote.routeSnapshotRef
				? { routeSnapshotRef: sourceQuote.routeSnapshotRef }
				: {}),
			submissionContractHash: fingerprintValue(
				pickComposerSubmissionSignedFields({
					...source,
					creationMode: source.creationMode,
					intent: source.intent.text,
				}),
			),
			...(sourceQuote.targetSeconds !== undefined
				? { targetSeconds: sourceQuote.targetSeconds }
				: {}),
			unitRate: sourceQuote.formula.unitRate,
			workspaceId: source.workspaceId,
		});
		const confirmedQuote = await this.successorQuotes.confirm({
			quoteId: quote.quoteId,
			taskId: input.workflowId,
			workspaceId: source.workspaceId,
		});
		const snapshot = buildTerminalSemanticDecisionSuccessor({
			command,
			contentPackageId: this.ids.createId("content-package"),
			createdAt: this.ids.now(),
			quote: {
				id: confirmedQuote.quoteId,
				revision: confirmedQuote.revision,
			},
			sourceSnapshot: source,
			workflowId: input.workflowId,
			workId: this.ids.createId("work"),
		});
		const submission: CreationSubmissionRecord = {
			contentPackage: { ...snapshot.contentPackage },
			snapshot,
			task: { id: snapshot.task.id },
			usageReservation: {
				id: `usage-reservation-${snapshot.task.id}`,
				units: productUsageUnits(snapshot),
			},
			work: { id: snapshot.work.id },
		};
		const idempotencyKey = `${command.questionId}:late_answer`;
		const claimed = await this.store.claim({
			idempotencyKey,
			payloadHash: fingerprintValue({
				command,
				sourceSnapshotId: source.id,
			}),
			submission,
			workspaceId: source.workspaceId,
		});
		if (claimed.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		await this.startHarness(claimed.submission);
		return submissionResponse(
			claimed.submission,
			claimed.kind === "existing",
		);
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
		if (harnessClaim.kind === "failed") {
			throw new Error("Harness start permanently failed.");
		}
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
					const disposition =
						(await this.harness.classifyStartFailure?.(
							submission,
							error,
						)) ?? "retry";
					if (disposition === "terminal_rejection") {
						const failed =
							await this.store.failHarnessStart(leasedStart);
						if (!failed) {
							await this.store.releaseHarnessStart(leasedStart);
						}
					} else {
						await this.store.releaseHarnessStart(leasedStart);
					}
				} catch {
					try {
						await this.store.releaseHarnessStart(leasedStart);
					} catch {
						// Keep the Harness failure as the user-visible cause.
					}
				}
			}
			throw error;
		}
	}
}

function productUsageUnits(
	snapshot: CreationExecutionSnapshot,
): CreationSubmissionUsageUnit[] {
	const deliverable = snapshot.deliverables[0];
	if (!deliverable) {
		throw new Error("Creation submission requires one deliverable.");
	}
	if (snapshot.lens === "video") {
		if (!Number.isSafeInteger(deliverable.durationSeconds)) {
			throw new Error("Video submission requires whole duration seconds.");
		}
		// The merchant's video entitlement counts 成片, not seconds: the plan
		// offers grant trial 1 / starter 5 / growth 20 / pro 60
		// (`foundation/entitlement-module.ts`) and the Composer prices the same
		// run at 1. Reserving `durationSeconds` here charged an 8s 抖音成片 eight
		// videos, which no trial workspace can ever cover — every video
		// submission came back 409 INSUFFICIENT_ENTITLEMENT while the quota card
		// showed no shortfall, because the two sides were pricing in different
		// units. Per-second accounting belongs to the supply-side ledger (admin
		// config seconds, D-123 cost surface), not to this allowance.
		// Duration stays validated above: the snapshot is still required to name
		// whole seconds, it just no longer sets the price.
		return [{ resource: "video", quantity: 1 }];
	}
	if (snapshot.lens === "image_text_note") {
		throw new Error(
			"Image-text note submissions require explicit product usage units.",
		);
	}
	return [{ resource: snapshot.lens, quantity: deliverable.quantity }];
}

function operationForRequest(
	lens: CreationExecutionSnapshot["lens"],
	referenceCount: number,
) {
	if (lens === "copy") return "copy.generate" as const;
	if (lens === "image_text_note") return "image.generate" as const;
	if (lens === "image") {
		return selectImageIntentOperation({ referenceCount });
	}
	return "video.generate" as const;
}

function receiptPayload(request: ComposerSubmissionRequest) {
	// Fingerprint only the canonical browser-owned request. Workspace/key are
	// receipt lookup roots; mutable admission owns the omitted server fields.
	const {
		actorId: _actorId,
		contentModules: _contentModules,
		deliverables: _deliverables,
		idempotencyKey: _idempotencyKey,
		lens: _lens,
		modelPolicy: _modelPolicy,
		rights: _rights,
		route: _route,
		workspaceId: _workspaceId,
		...payload
	} = request;
	return payload;
}

function submissionResponse(
	submission: CreationSubmissionRecord,
	replayed: boolean,
) {
	return {
		contentPackage: submission.contentPackage,
		replayed,
		snapshot: {
			id: submission.snapshot.id,
			identity: submission.snapshot.identity,
			identityDecision: submission.snapshot.identityDecision,
			schemaVersion: submission.snapshot.schemaVersion,
		},
		task: submission.task,
		// Browser contract: the client parses this strictly with only `id`.
		// Per-bucket units are coordinator-internal; leaking them here broke
		// every Composer submission after the INC-t26 hotfix.
		usageReservation: { id: submission.usageReservation.id },
		work: submission.work,
	};
}
