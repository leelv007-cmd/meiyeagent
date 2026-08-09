import {
	pickComposerSubmissionSignedFields,
	structuredDecisionInputSchema,
	type BuildProductQuoteInput,
	type PlanConfirmationDecision,
	type ResultAdjustTextSelectionScope,
	type StructuredDecisionInput,
} from "@meiye/contracts";

import { fingerprintValue } from "../job-runtime/job-contracts.js";
import { executionConfirmationAuthorityRequestId } from "../agent-session/execution-confirmation-authority.js";
import type { PendingConfirmationAuthority } from "../agent-session/execution-confirmation-authority-store.js";
import { selectImageIntentOperation } from "../harness/image-intent-compiler.js";
import type { ExecutionPlanCompileFreeze } from "../harness/execution-plan-admission.js";
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
	normalizedGenerationParams,
} from "./creation-execution-snapshot.js";

export interface CreationSubmissionRecord {
	snapshot: CreationExecutionSnapshot;
	work: { id: string };
	task: { id: string };
	contentPackage: { id: string; expectedRevision: number };
	decisionReferences?: NonNullable<HarnessWorkflowInput["decisionReferences"]>;
	usageReservation: {
		id: string;
		credits?: number;
		/** Durable credit-ledger lineage; reprices refund this exact operation. */
		creditUsageOperationId?: string;
		/** Historical per-resource reservation retained for read compatibility. */
		units: CreationSubmissionUsageUnit[];
	};
	/**
	 * V31-12 compile-finalize freeze persisted with the durable submission so a
	 * restarted worker can reconstruct the exact merchant-confirmed plan.
	 */
	executionPlanFreeze?: ExecutionPlanCompileFreeze;
	agentPlanPending?: boolean;
	executionConfirmationContext?: HarnessWorkflowInput["executionConfirmationContext"];
	/** Reliable outbox marker committed with the credit reservation and freeze. */
	confirmationDispatch?: {
		requestId?: string;
		state: "pending" | "dispatched" | "expired";
		expiresAt?: string;
	};
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
	readByTask?(input: {
		workspaceId: string;
		taskId: string;
	}): Promise<CreationSubmissionRecord | null>;
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
	saveExecutionPlanFreeze(input: {
		workspaceId: string;
		submissionId: string;
		freeze: ExecutionPlanCompileFreeze;
		quoteRef?: CreationSubmissionRecord["snapshot"]["quote"];
		credits?: number;
		clarificationResolution?: ComposerClarificationResolution;
		confirmationDispatch?: CreationSubmissionRecord["confirmationDispatch"];
	}): Promise<CreationSubmissionRecord>;
	saveRepricedExecutionPlanFreeze?(input: {
		workspaceId: string;
		submissionId: string;
		expectedFreeze: ExecutionPlanCompileFreeze | null;
		previousQuoteRef: { id: string; revision: string };
		freeze: ExecutionPlanCompileFreeze;
		successorQuote: BuildProductQuoteInput;
		credits: number;
		clarificationResolution?: ComposerClarificationResolution;
	}): Promise<CreationSubmissionRecord>;
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
	/**
	 * Durably records that the paid confirmation dispatch has crossed the
	 * external-start boundary. The lease remains starting until the idempotent
	 * Harness admission returns and completeHarnessStart stores its authority ID.
	 */
	markHarnessStartDispatched(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
	}): Promise<CreationSubmissionRecord>;
	completeHarnessStart(input: {
		leaseId: string;
		workspaceId: string;
		submissionId: string;
		confirmationDispatch?: CreationSubmissionRecord["confirmationDispatch"];
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
	expireUndispatchedConfirmationHolds?(input: { limit: number }): Promise<number>;
}

/** StagePort boundary: the coordinator never imports DBOS or a durable carrier. */
export interface CreationSubmissionHarnessStarter {
	start(input: CreationSubmissionRecord): Promise<
		| { executionConfirmationRequestId?: string }
		| void
	>;
	preparePendingConfirmation?(input: CreationSubmissionRecord): Promise<
		| { executionConfirmationRequestId?: string }
		| void
	>;
	classifyStartFailure?(
		input: CreationSubmissionRecord,
		error: unknown,
	): Promise<"retry" | "terminal_rejection">;
}

export interface CreationSubmissionIdFactory {
	createId(prefix: "content-package" | "work"): string;
	now(): string;
}

export type ComposerAgentBinding = {
	threadId: string;
	runId: string;
	/** False while a paid Living Plan waits for an explicit merchant start. */
	makeReady?: boolean;
	/** Server-only handoff consumed by the atomic billing/freeze commit. */
	repriceCommit?: {
		expectedFreeze: ExecutionPlanCompileFreeze | null;
		previousQuoteRef: { id: string; revision: string };
		successorQuote: BuildProductQuoteInput;
		credits: number;
	};
	clarificationResolution?: ComposerClarificationResolution;
};

export type ComposerClarificationResolution = {
	interruptId: string;
	revision: number;
	threadId: string;
	runId: string;
};

/** Composer → Agent Session/Plan seam. Web never projects plan events. */
export interface ComposerSubmissionAgentPlanningPort {
	prepare(input: {
		continuationThreadId?: string;
		submission: CreationSubmissionRecord;
	}): Promise<ComposerAgentBinding>;
	completeExplicitStart?(input: {
		submission: CreationSubmissionRecord;
		planRevision: number;
	}): Promise<ComposerAgentBinding>;
	markExplicitStartCompleted?(input: {
		submission: CreationSubmissionRecord;
	}): Promise<void>;
	revisePrepared?(input: {
		submission: CreationSubmissionRecord;
		planRevision: number;
		merchantInstruction: string;
	}): Promise<ComposerAgentBinding>;
	answerClarification?(input: {
		submission: CreationSubmissionRecord;
		merchantAnswer: string;
	}): Promise<ComposerAgentBinding>;
	commitClarificationResolution?(input: {
		submission: CreationSubmissionRecord;
		resolution?: ComposerClarificationResolution;
	}): Promise<void>;
}

export interface ComposerExplicitConfirmationPort {
	getDecision(requestId: string): Promise<PlanConfirmationDecision | null>;
	getRequest?(requestId: string): Promise<{
		request: {
			requestId: string;
			planId: string;
			planRevision: number;
			snapshotHash: string;
			quoteRef: { id: string; revision: string | number };
			status: string;
		};
	} | null>;
	getCurrentByWorkflowId?(
		workflowId: string,
	): Promise<PendingConfirmationAuthority | null>;
	/** Legacy test adapter only; successor repricing no longer invokes this seam. */
	supersedePending?(input: {
		requestId: string;
		actorId: string;
		now: string;
	}): Promise<void>;
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
		creditCost?: number;
		usageUnits?: CreationSubmissionUsageUnit[];
	}>;
	prepareResultTextSelection?(input: {
		actorId: string;
		workspaceId: string;
	}): Promise<{ catalogModelId: string; operation: "copy.generate" }>;
	admitResultTextSelection?(input: {
		actorId: string;
		outputCount: number;
		quote: { id: string; revision: string };
		sourceSnapshot: CreationExecutionSnapshot;
		taskId: string;
		workspaceId: string;
	}): Promise<{
		catalogModel: { id: string; revision: string };
		modelPolicy: { id: string; mode: "fixed"; revision: string };
		modelSelection: NonNullable<CreationExecutionSnapshot["modelSelection"]>;
		operation: "copy.generate";
		route: { id: string; revision: string };
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
		private readonly agentPlanning?: ComposerSubmissionAgentPlanningPort,
		private readonly explicitConfirmations?: ComposerExplicitConfirmationPort
	) {}

	async prepareResultTextSelection(input: {
		actorId: string;
		workspaceId: string;
	}) {
		if (!this.admission.prepareResultTextSelection) {
			throw new Error("Result text-selection admission is unavailable.");
		}
		return this.admission.prepareResultTextSelection(input);
	}

	async startPrepared(input: {
		workspaceId: string;
		taskId: string;
		planRevision: number;
	}) {
		if (!this.store.readByTask || !this.agentPlanning?.completeExplicitStart) {
			throw new Error("Explicit Composer plan start is unavailable.");
		}
		let submission = await this.store.readByTask({
			workspaceId: input.workspaceId,
			taskId: input.taskId,
		});
		if (!submission) throw new Error("Prepared Composer task was not found.");
		if (
			!submission.executionPlanFreeze ||
			submission.executionPlanFreeze.approvalBasis !== "merchant_confirmed"
		) {
			throw new Error(
				"Paid Composer start requires a durable merchant-confirmed plan freeze.",
			);
		}
		if (!this.explicitConfirmations) {
			throw new Error("Paid Composer start requires confirmation authority.");
		}
		const workflowId = composerPreparedAttemptId(submission);
		if (
			!this.explicitConfirmations.getRequest ||
			!this.explicitConfirmations.getCurrentByWorkflowId
		) {
			throw new Error("Paid Composer start requires confirmation request authority.");
		}
		const planAuthority = await this.explicitConfirmations.getCurrentByWorkflowId(
			workflowId,
		);
		const freeze = submission.executionPlanFreeze;
		if (
			!planAuthority ||
			planAuthority.workspaceId !== input.workspaceId ||
			planAuthority.planId !== freeze.planId ||
			planAuthority.planRevision !== input.planRevision ||
			planAuthority.planRevision !== freeze.planRevision ||
			planAuthority.quoteRef.id !== freeze.quoteRef.id ||
			String(planAuthority.quoteRef.revision) !== String(freeze.quoteRef.revision)
		) {
			throw new Error("Paid Composer start requires the exact prepared plan authority.");
		}
		const requestId = executionConfirmationAuthorityRequestId({
			workflowId,
			planRevision: planAuthority.planRevision,
			snapshotHash: planAuthority.snapshotHash,
		});
		const authority = await this.explicitConfirmations.getRequest(requestId);
		if (
			!authority ||
			authority.request.requestId !== requestId ||
			authority.request.planId !== freeze.planId ||
			authority.request.planRevision !== input.planRevision ||
			authority.request.planRevision !== freeze.planRevision ||
			authority.request.status !== "decided" ||
			authority.request.snapshotHash !== planAuthority.snapshotHash ||
			authority.request.quoteRef.id !== freeze.quoteRef.id ||
			String(authority.request.quoteRef.revision) !== String(freeze.quoteRef.revision)
		) {
			throw new Error("Paid Composer start requires the exact prepared plan authority.");
		}
		const decision = await this.explicitConfirmations.getDecision(requestId);
		if (!decision || decision.requestId !== requestId || decision.decision !== "confirmed") {
			throw new Error("Paid Composer start requires an immutable confirmed decision.");
		}
		const binding = await this.agentPlanning.completeExplicitStart({
			submission,
			planRevision: input.planRevision,
		});
		await this.startHarness(submission);
		await this.agentPlanning.markExplicitStartCompleted?.({ submission });
		return submissionResponse(submission, true, {
			...binding,
			makeReady: true,
		});
	}

	async revisePrepared(input: {
		workspaceId: string;
		taskId: string;
		planRevision: number;
		merchantInstruction: string;
	}) {
		if (
			!this.store.readByTask ||
			(!this.agentPlanning?.revisePrepared &&
				!this.agentPlanning?.answerClarification)
		) {
			throw new Error("Composer plan revision is unavailable.");
		}
		let submission = await this.store.readByTask({
			workspaceId: input.workspaceId,
			taskId: input.taskId,
		});
		if (!submission) throw new Error("Prepared Composer task was not found.");
		if (!submission.executionPlanFreeze) {
			if (!this.agentPlanning.answerClarification) {
				throw new Error("Composer clarification answer is unavailable.");
			}
			return this.agentPlanning.answerClarification({
				submission,
				merchantAnswer: input.merchantInstruction,
			});
		}
		if (!this.agentPlanning.revisePrepared) {
			throw new Error("Composer plan revision is unavailable.");
		}
		const binding = await this.agentPlanning.revisePrepared({
			submission,
			planRevision: input.planRevision,
			merchantInstruction: input.merchantInstruction,
		});
		if (!submission.executionPlanFreeze) {
			throw new Error("Revised Composer plan did not produce a durable freeze.");
		}
		if (binding.repriceCommit) {
			if (!this.store.saveRepricedExecutionPlanFreeze) {
				throw new Error("Atomic Composer plan reprice persistence is unavailable.");
			}
			submission = await this.store.saveRepricedExecutionPlanFreeze({
				workspaceId: input.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				...binding.repriceCommit,
			});
		} else {
			submission = await this.store.saveExecutionPlanFreeze({
				workspaceId: input.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				quoteRef: submission.snapshot.quote,
				credits: submission.usageReservation.credits,
			});
		}
		await this.preparePendingConfirmation(submission);
		return {
			threadId: binding.threadId,
			runId: binding.runId,
			makeReady: binding.makeReady,
		};
	}

	async answerClarification(input: {
		workspaceId: string;
		taskId: string;
		merchantAnswer: string;
	}) {
		if (!this.store.readByTask || !this.agentPlanning?.answerClarification) {
			throw new Error("Composer clarification answer is unavailable.");
		}
		let submission = await this.store.readByTask({
			workspaceId: input.workspaceId,
			taskId: input.taskId,
		});
		if (!submission) throw new Error("Prepared Composer task was not found.");
		if (submission.executionPlanFreeze) {
			await this.agentPlanning.commitClarificationResolution?.({ submission });
			await this.preparePendingConfirmation(submission);
			return { makeReady: false };
		}
		const binding = await this.agentPlanning.answerClarification({
			submission,
			merchantAnswer: input.merchantAnswer,
		});
		if (!submission.executionPlanFreeze) return binding;
		submission.agentPlanPending = false;
		if (binding.repriceCommit) {
			if (!this.store.saveRepricedExecutionPlanFreeze) {
				throw new Error("Atomic Composer clarification reprice persistence is unavailable.");
			}
			submission = await this.store.saveRepricedExecutionPlanFreeze({
				workspaceId: input.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				...(binding.clarificationResolution
					? { clarificationResolution: binding.clarificationResolution }
					: {}),
				...binding.repriceCommit,
			});
			await this.agentPlanning.commitClarificationResolution?.({
				submission,
				resolution: binding.clarificationResolution,
			});
			await this.preparePendingConfirmation(submission);
			return { threadId: binding.threadId, runId: binding.runId, makeReady: binding.makeReady };
		}
		submission = await this.store.saveExecutionPlanFreeze({
			workspaceId: input.workspaceId,
			submissionId: submission.snapshot.id,
			freeze: submission.executionPlanFreeze,
			quoteRef: submission.snapshot.quote,
			credits: submission.usageReservation.credits,
			...(binding.clarificationResolution
				? { clarificationResolution: binding.clarificationResolution }
				: {}),
		});
		await this.agentPlanning.commitClarificationResolution?.({
			submission,
			resolution: binding.clarificationResolution,
		});
		await this.preparePendingConfirmation(submission);
		return binding;
	}

	async submit(input: ComposerSubmissionRequest) {
		return this.submitWithConfirmationContext(input);
	}

	/**
	 * U7: each Campaign schedule slot submits its own paid Work with a distinct
	 * confirmation context, so one approval never covers a second Work.
	 */
	async submitCampaignWork(input: {
		submission: ComposerSubmissionRequest;
		campaignPlanRef: { id: string; revision: number | string };
		workOrdinal: number;
	}) {
		if (!Number.isSafeInteger(input.workOrdinal) || input.workOrdinal < 1) {
			throw new Error("Campaign workOrdinal must be a positive integer.");
		}
		return this.submitWithConfirmationContext(input.submission, {
			campaignPlanRef: input.campaignPlanRef,
			workOrdinal: input.workOrdinal,
			approvalScope: "single_work",
		});
	}

	private async submitWithConfirmationContext(
		input: ComposerSubmissionRequest,
		executionConfirmationContext?: NonNullable<
			CreationSubmissionRecord["executionConfirmationContext"]
		>,
	) {
		const request = composerSubmissionRequestSchema.parse(input);
		const payloadHash = fingerprintValue({
			...receiptPayload(request),
			...(executionConfirmationContext ? { executionConfirmationContext } : {}),
		});
		const receipt = await this.store.readReceipt({
			workspaceId: request.workspaceId,
			idempotencyKey: request.idempotencyKey,
			payloadHash,
		});
		if (receipt.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		if (receipt.kind === "existing") {
			const preparedBinding = await this.prepareAgentPlan(
				receipt.submission,
				request.agentThreadId
			);
			const agentBinding = explicitConfirmationBinding(
				receipt.submission,
				preparedBinding,
			);
			if (agentBinding?.makeReady === false) {
				await this.preparePendingConfirmation(receipt.submission);
			} else {
				await this.startHarness(receipt.submission);
			}
			return submissionResponse(receipt.submission, true, agentBinding);
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
		const { agentThreadId: _agentThreadId, ...executionRequest } =
			serverBoundRequest;
		const command = creationSubmissionCommandSchema.parse({
			...executionRequest,
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
				...(admitted.creditCost !== undefined
					? { credits: admitted.creditCost, units: [] }
					: { units: admitted.usageUnits ?? productUsageUnits(snapshot) }),
			},
			...(this.agentPlanning ? { agentPlanPending: true } : {}),
			...(executionConfirmationContext ? { executionConfirmationContext } : {}),
		};
		const preparedBinding = await this.prepareAgentPlan(
			submission,
			request.agentThreadId,
			false,
		);
		const claimed = await this.store.claim({
			workspaceId: command.workspaceId,
			idempotencyKey: command.idempotencyKey,
			payloadHash,
			submission,
		});
		if (claimed.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		const preparedAgentBinding =
			claimed.kind === "existing"
				? await this.prepareAgentPlan(
						claimed.submission,
						request.agentThreadId,
					)
				: preparedBinding;
		const agentBinding = explicitConfirmationBinding(
			claimed.submission,
			preparedAgentBinding,
		);
		if (agentBinding?.makeReady === false) {
			await this.preparePendingConfirmation(claimed.submission);
		} else {
			await this.startHarness(claimed.submission);
		}
		return submissionResponse(
			claimed.submission,
			claimed.kind === "existing",
			agentBinding
		);
	}

	private async preparePendingConfirmation(submission: CreationSubmissionRecord) {
		if (!submission.executionPlanFreeze) return;
		ensureConfirmationDispatch(submission);
		// An exempt plan (pure copy, U9) carries no confirmation authority, so
		// there is no pending request to prepare — and demanding one here would
		// reject the exempt freeze the clarification path just committed.
		if (!submission.confirmationDispatch) return;
		if (!this.harness.preparePendingConfirmation) {
			throw new Error("Pending Harness confirmation preparation is unavailable.");
		}
		const prepared = await this.harness.preparePendingConfirmation(submission);
		const requestId = prepared?.executionConfirmationRequestId;
		if (!requestId) {
			throw new Error(
				"Pending Harness confirmation did not return its exact authority ID.",
			);
		}
		submission.confirmationDispatch = {
			...submission.confirmationDispatch,
			requestId,
			state: "pending",
		};
		const persisted = await this.store.saveExecutionPlanFreeze({
			workspaceId: submission.snapshot.workspaceId,
			submissionId: submission.snapshot.id,
			freeze: submission.executionPlanFreeze,
			quoteRef: submission.snapshot.quote,
			credits: submission.usageReservation.credits,
			confirmationDispatch: submission.confirmationDispatch,
		});
		submission.confirmationDispatch = persisted.confirmationDispatch;
	}

	private async prepareAgentPlan(
		submission: CreationSubmissionRecord,
		continuationThreadId?: string,
		persistExisting = true,
	): Promise<ComposerAgentBinding | undefined> {
		const binding = this.agentPlanning
			? await this.agentPlanning.prepare({
					...(continuationThreadId ? { continuationThreadId } : {}),
					submission,
				})
			: undefined;
		ensureConfirmationDispatch(submission);
		if (submission.executionPlanFreeze) submission.agentPlanPending = false;
		if (persistExisting && submission.executionPlanFreeze) {
			const persisted = await this.store.saveExecutionPlanFreeze({
				workspaceId: submission.snapshot.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				quoteRef: submission.snapshot.quote,
				credits: submission.usageReservation.credits,
				confirmationDispatch: submission.confirmationDispatch,
			});
			submission.executionPlanFreeze = persisted.executionPlanFreeze;
		}
		return binding;
	}

	async submitResultAdjustment(input: {
		actorId: string;
		idempotencyKey: string;
		instruction: string;
		outputCount: number;
		/** Single-page note image regenerate target (result_adjust asset scope). */
		pageRegenerationTargetAssetId?: string;
		quote: { id: string; revision: string };
		sourceContentPackage: { id: string; revision: number };
		sourceNoteStyleId?: string;
		sourceSnapshot: CreationExecutionSnapshot;
		taskId: string;
		textSelectionScope?: ResultAdjustTextSelectionScope;
		workId: string;
		workspaceId: string;
	}) {
		const source = creationExecutionSnapshotSchema.parse(input.sourceSnapshot);
		if (source.workspaceId !== input.workspaceId) {
			throw new Error("Result adjustment source does not match its workspace.");
		}
		const isNoteTextSelection =
			source.lens === "image_text_note" && input.textSelectionScope !== undefined;
		if (
			source.lens === "image_text_note" &&
			!isNoteTextSelection &&
			!input.sourceNoteStyleId
		) {
			throw new Error(
				"Image-text note Result adjustment requires its frozen style.",
			);
		}
		const textSelectionAdmission = isNoteTextSelection
			? await this.admission.admitResultTextSelection?.({
					actorId: input.actorId,
					outputCount: input.outputCount,
					quote: input.quote,
					sourceSnapshot: source,
					taskId: input.taskId,
					workspaceId: input.workspaceId,
				})
			: undefined;
		if (isNoteTextSelection && !textSelectionAdmission) {
			throw new Error("Result text-selection admission is unavailable.");
		}
		const adjustmentQuote = await this.successorQuotes?.getQuote(
			input.quote.id,
			input.workspaceId,
		);
		const intent = `${source.intent.text}\n\n调整要求：${input.instruction}`;
		const deliverable = textSelectionAdmission
			? ({ kind: "copy_document", quantity: input.outputCount } as const)
			: { ...source.deliverable, quantity: input.outputCount };
		const deliverables = textSelectionAdmission
			? source.deliverables.map(({ id, order }) => ({
					id,
					kind: "copy" as const,
					order,
					quantity: input.outputCount,
				}))
			: source.deliverables.map((item) => ({
					...item,
					quantity: input.outputCount,
				}));
		const generationParams = normalizedGenerationParams(source);
		const signedSubmission = pickComposerSubmissionSignedFields({
			...(source.signedSubmission ?? {}),
			...generationParams,
			catalogModel:
				textSelectionAdmission?.catalogModel ?? source.catalogModel,
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
			catalogModel:
				textSelectionAdmission?.catalogModel ?? source.catalogModel,
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
			...generationParams,
			intent,
			lens: textSelectionAdmission ? "copy" : source.lens,
			modelPolicy:
				textSelectionAdmission?.modelPolicy ?? source.modelPolicy,
			modelSelection:
				textSelectionAdmission?.modelSelection ?? source.modelSelection,
			operation:
				textSelectionAdmission?.operation ?? source.operation,
			platform: source.platform,
			quote: input.quote,
			recipe: source.recipe,
			rights: source.rights,
			route: textSelectionAdmission?.route ?? source.route,
			signedSubmission,
			viralAdaptSource: source.viralAdaptSource,
			sources: {
				assets: source.sources.assets,
				contentPackage: {
					id: input.sourceContentPackage.id,
					revision: String(input.sourceContentPackage.revision),
				},
				...(input.pageRegenerationTargetAssetId
					? {
							pageRegeneration: {
								targetAssetId: input.pageRegenerationTargetAssetId,
							},
						}
					: {}),
				...(input.textSelectionScope
					? { textSelection: input.textSelectionScope }
					: {}),
			},
			surface: source.surface,
			taskId: input.taskId,
			workId: input.workId,
			workspaceId: input.workspaceId,
		});
		const snapshot = createCreationExecutionSnapshot(command, this.ids.now());
		const submission: CreationSubmissionRecord = {
			contentPackage: { ...snapshot.contentPackage },
			...(source.lens === "image_text_note" &&
			input.sourceNoteStyleId &&
			!textSelectionAdmission
				? {
						decisionReferences: [
							{
								field: "note_style",
								id: `decision-${fingerprintValue({
									sourceSnapshotId: source.id,
									styleId: input.sourceNoteStyleId,
								}).slice(0, 24)}`,
								revision: source.revision,
								value: input.sourceNoteStyleId,
							},
						],
					}
				: {}),
			snapshot,
			task: { id: snapshot.task.id },
			usageReservation: {
				id: `usage-reservation-${snapshot.task.id}`,
				...(adjustmentQuote?.creditCost !== undefined
					? { credits: adjustmentQuote.creditCost, units: [] }
					: {
							units:
								snapshot.lens === "image_text_note"
									? [{ resource: "image", quantity: input.outputCount }]
									: productUsageUnits(snapshot),
						}),
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
				textSelectionScope: input.textSelectionScope,
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
			...(sourceQuote.creditCost !== undefined
				? { creditCost: sourceQuote.creditCost }
				: {}),
			...(sourceQuote.formula.currency
				? { currency: sourceQuote.formula.currency }
				: {}),
			...(sourceQuote.frozenCandidateDeploymentIds
				? {
						frozenCandidateDeploymentIds:
							sourceQuote.frozenCandidateDeploymentIds,
					}
				: {}),
			...(sourceQuote.failureRefundsCredits !== undefined
				? { failureRefundsCredits: sourceQuote.failureRefundsCredits }
				: {}),
			formulaExpression: sourceQuote.formula.expression,
			...(sourceQuote.minChargeSeconds !== undefined
				? { minChargeSeconds: sourceQuote.minChargeSeconds }
				: {}),
			// Merchant execution (including free+deep auxiliary text.respond)
			// requires a complete reserved credit quote contract. Copy the
			// frozen operation / output count from the source quote so the
			// successor can claim against the same product contract shape.
			...(sourceQuote.operation
				? { operation: sourceQuote.operation }
				: source.operation
					? { operation: source.operation }
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
				...(confirmedQuote.creditCost !== undefined
					? { credits: confirmedQuote.creditCost, units: [] }
					: { units: productUsageUnits(snapshot) }),
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
		await this.store.expireUndispatchedConfirmationHolds?.({ limit });
		const recoverable = (
			await this.store.listRecoverableHarnessStarts({ limit })
		).filter((candidate) => {
			if (candidate.submission.agentPlanPending === true) return false;
			if (
				candidate.submission.executionPlanFreeze?.approvalBasis !==
				"merchant_confirmed"
			) {
				return true;
			}
			// A merchant-confirmed plan is started only by the explicit start
			// command, so recovery must not replay one that is still awaiting the
			// merchant. The single exception is a submission whose confirmation
			// dispatch already crossed the external start boundary: its Harness run
			// may be live while its exact authority ID never came back, and the
			// undispatched-hold sweeper only scans `pending`, so nothing else would
			// ever release that lease.
			return candidate.submission.confirmationDispatch?.state === "dispatched";
		});
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
		if (
			requiresPaidConfirmation(submission) &&
			(submission.executionPlanFreeze?.approvalBasis !== "merchant_confirmed" ||
				!submission.confirmationDispatch ||
				submission.confirmationDispatch.state === "expired")
		) {
			throw new Error(
				"Paid Harness start requires a durable freeze and confirmation outbox.",
			);
		}
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
		let startSubmission = submission;
		let started = false;
		try {
			const persistedRequestId = submission.confirmationDispatch?.requestId;
			if (submission.confirmationDispatch) {
				startSubmission = await this.store.markHarnessStartDispatched(
					leasedStart,
				);
			}
			const startedResult = await this.harness.start(startSubmission);
			if (startSubmission.confirmationDispatch) {
				const requestId = startedResult?.executionConfirmationRequestId;
				if (!requestId) {
					throw new Error(
						"Paid Harness admission did not return its confirmation authority ID.",
					);
				}
				// A pending confirmation already persisted its exact authority ID; the
				// starter may only re-affirm that ID, never mint a second one.
				if (persistedRequestId && requestId !== persistedRequestId) {
					throw new Error(
						"Paid Harness admission returned a different confirmation authority ID.",
					);
				}
				startSubmission.confirmationDispatch.requestId = requestId;
			}
			started = true;
			await this.store.completeHarnessStart({
				...leasedStart,
				...(startSubmission.confirmationDispatch
					? { confirmationDispatch: startSubmission.confirmationDispatch }
					: {}),
			});
			return true;
		} catch (error) {
			if (!started) {
				try {
					const disposition =
						(await this.harness.classifyStartFailure?.(
							startSubmission,
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

export function composerPreparedAttemptId(submission: CreationSubmissionRecord): string {
	const freeze = submission.executionPlanFreeze;
	return freeze?.approvalBasis === "merchant_confirmed"
		? `${submission.task.id}:plan-r${freeze.planRevision}`
		: submission.task.id;
}

function ensureConfirmationDispatch(submission: CreationSubmissionRecord) {
	if (
		submission.executionPlanFreeze?.approvalBasis !== "merchant_confirmed" &&
		!requiresPaidConfirmation(submission)
	) {
		return;
	}
	const attemptId = composerPreparedAttemptId(submission);
	submission.confirmationDispatch ??= {
		state: "pending",
		expiresAt: new Date(
			Date.parse(submission.snapshot.createdAt) + 48 * 60 * 60 * 1_000,
		).toISOString(),
	};
}

function explicitConfirmationBinding(
	submission: CreationSubmissionRecord,
	binding: ComposerAgentBinding | undefined,
): ComposerAgentBinding | undefined {
	if (submission.executionPlanFreeze?.approvalBasis !== "merchant_confirmed") {
		return binding;
	}
	if (!binding) {
		throw new Error(
			"Merchant-confirmed plan requires its durable Agent binding.",
		);
	}
	return {
		threadId: binding.threadId,
		runId: binding.runId,
		makeReady: false,
	};
}

function requiresPaidConfirmation(submission: CreationSubmissionRecord) {
	const credits = submission.usageReservation.credits;
	if (!Number.isSafeInteger(credits) || (credits ?? 0) <= 0) return false;
	if (submission.snapshot.lens !== "copy") return true;
	return submission.usageReservation.units.some(
		(unit) => unit.resource === "image" || unit.resource === "video",
	);
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
		// offers trial 1 / starter 3 / growth 6 / pro 9
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
		agentThreadId: _agentThreadId,
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
	agentBinding?: ComposerAgentBinding
) {
	return {
		contentPackage: submission.contentPackage,
		...(agentBinding
			? {
					threadId: agentBinding.threadId,
					runId: agentBinding.runId,
					makeReady: agentBinding.makeReady !== false,
				}
			: {}),
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
