import {
	pickComposerSubmissionSignedFields,
	structuredDecisionInputSchema,
	type BuildProductQuoteInput,
	type PlanConfirmationDecision,
	type ResultAdjustTextSelectionScope,
	type StructuredDecisionInput,
} from "@meiye/contracts";

import { fingerprintValue } from "../job-runtime/job-contracts.js";
import type { PendingConfirmationAuthority } from "../agent-session/execution-confirmation-authority-store.js";
import type { ConfirmationCreditTransactionPort } from "../agent-session/execution-confirmation-service.js";
import { selectImageIntentOperation } from "../harness/image-intent-compiler.js";
import { isViralAdaptRecipeId } from "../harness/viral-adapt.js";
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
		/** The pending confirmation owns the one reserve in the shared transaction. */
		confirmationOwnsCreditReservation?: boolean;
		/** Historical per-resource reservation retained for read compatibility. */
		units: CreationSubmissionUsageUnit[];
	};
	/**
	 * V31-12 compile-finalize freeze persisted with the durable submission so a
	 * restarted worker can reconstruct the exact merchant-confirmed plan.
	 * For multi-carrier plans this is the primary (first) freeze; the full set
	 * lives in `executionPlanFreezes` (V31-47).
	 */
	executionPlanFreeze?: ExecutionPlanCompileFreeze;
	/**
	 * V31-47: one freeze per carrier in deliverable order. When present and
	 * longer than one, CreationStagePort fans out one Make per entry.
	 */
	executionPlanFreezes?: ExecutionPlanCompileFreeze[];
	/**
	 * Package-level confirmation decision id after the merchant confirmed the
	 * primary freeze. Secondary carrier Makes admit with this ref and do not
	 * open a second confirmation/reserve (V31-47).
	 */
	packageConfirmationDecisionRef?: string;
	/** Authoritative Session identity bound before the Harness starts. */
	agentBinding?: ComposerAgentBinding;
	/** Durable continuation hint needed if the process crashes before planning. */
	agentContinuationThreadId?: AgentThreadIdentity;
	/** Stable artifact identity continued by a Result successor. */
	artifactLineage?: {
		artifactId: string;
		parentRevision: number;
		targetUnitIds?: string[];
		sourceUnitMappings?: Array<{ sourceUnitId: string; executionUnitId: string }>;
	};
	agentPlanPending?: boolean;
	executionConfirmationContext?: HarnessWorkflowInput["executionConfirmationContext"];
	/** Reliable outbox marker committed with the credit reservation and freeze. */
	confirmationDispatch?: {
		requestId?: string;
		/** Locked terminal authority this immutable submission replaces. */
		predecessorRequestId?: string;
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

/** Durable facts supplied only from the locked predecessor rows. */
export interface ExpiredConfirmationSuccessorPreparation {
	transaction: ConfirmationCreditTransactionPort;
	workflowId: string;
	predecessorRequestId: string;
	requestId: string;
	reservationIdempotencyKey: string;
	holdExpiresAt: string;
	sourceRequest: HarnessWorkflowInput;
	successor: Pick<
		CreationSubmissionRecord,
		"snapshot" | "usageReservation" | "executionPlanFreeze"
	>;
}

/** Durable facts for a successor of a confirmed attempt with price drift. */
export interface RepricedConfirmationSuccessorPreparation
  extends ExpiredConfirmationSuccessorPreparation {
	/**
	 * Current fact/context heads verified inside the successor's admission
	 * transaction (V31-63). The successor's pending snapshot re-freezes on
	 * these so its own admission fence sees a current context bundle instead
	 * of the predecessor's drifted refs.
	 */
	currentFactRevisionRefs?: readonly string[];
}

/**
 * The paid gate may report only immutable predecessor coordinates and the
 * observed stale fence. A caller must never provide a replacement quote,
 * plan, snapshot, or reservation: those facts have to be rebuilt by the
 * durable transaction from authoritative sources.
 */
export interface RepricedPaidExecutionSuccessorRequest {
	workspaceId: string;
	predecessor: {
		workflowId: string;
		/** Immutable creation-submission id, distinct from the DBOS workflow id. */
		submissionId: string;
		taskId: string;
		confirmationRequestId: string;
	};
	staleFence: {
		expectedSnapshotHash: string;
		expectedQuoteRef: { id: string; revision: string };
		observedQuoteRevision: string;
		/** Server-resolved heads at the same fence read; never browser payload. */
		observedRightsRevisionRefs: readonly string[];
		observedFactRevisionRefs: readonly string[];
		diffFields: readonly string[];
	};
}

export type HarnessSubmissionState = 'reserved' | 'starting' | 'started' | 'failed';

/**
 * SUBMIT-01A: a BFF/coreFetch 10s abort after Core already claimed the
 * idempotency key is an accepted or still-planning submit, never an outage.
 */
export type ComposerSubmitTimeoutClass = "accepted" | "pending" | "unavailable";

export function classifyComposerSubmitTimeout(input: {
	committed: boolean;
	planningComplete?: boolean;
}): ComposerSubmitTimeoutClass {
	if (!input.committed) return "unavailable";
	return input.planningComplete === true ? "accepted" : "pending";
}

/** Durable lifecycle for a reservation refund after prepare terminalizes. */
export type PrepareTerminalRefundState =
	| "not_required"
	| "pending"
	| "processing"
	| "completed"
	| "dead_letter";

export interface CreationSubmissionStore {
	readByTask?(input: {
		workspaceId: string;
		taskId: string;
	}): Promise<CreationSubmissionRecord | null>;
	terminateRunningWork?(input: {
		workspaceId: string;
		workId?: string;
		taskId?: string;
		reason: "timeout" | "cancelled";
		window?: "work_running_no_job" | "job_stale_no_progress";
		now?: string;
	}): Promise<"terminated" | "already_terminal" | "missing">;
	readReceipt(input: {
		workspaceId: string;
		idempotencyKey: string;
		payloadHash: string;
	}): Promise<
		| { kind: "missing" }
		| {
				kind: "existing";
				submission: CreationSubmissionRecord;
				harnessState: HarnessSubmissionState;
		  }
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
	 * Creates the one immutable successor for a locked expired confirmation.
	 * PostgreSQL implementations must call `prepare` in the same transaction as
	 * new shells/reservation and the predecessor supersession marker.
	 */
	createExpiredConfirmationSuccessor?(input: {
		workspaceId: string;
		sourceSubmissionId: string;
		predecessorRequestId: string;
		successor: {
			submissionId: string;
			contentPackageId: string;
			workId: string;
			taskId: string;
			createdAt: string;
		};
		prepare(input: ExpiredConfirmationSuccessorPreparation): Promise<void>;
	}): Promise<
		| { kind: "created"; submission: CreationSubmissionRecord }
		| { kind: "existing"; submission: CreationSubmissionRecord }
	>;
	/**
	 * Rebuilds a confirmed attempt whose quote changed before execution. The
	 * writer owns every successor id and must atomically rebuild authoritative
	 * quote/freeze, admission, confirmation and predecessor settlement.
	 */
	createRepricedPaidExecutionSuccessor?(input: RepricedPaidExecutionSuccessorRequest & {
		/** Server-generated identities; never accepted by the browser-facing port. */
		successor?: {
			submissionId: string;
			contentPackageId: string;
			workId: string;
			taskId: string;
			createdAt: string;
		};
		/** Transactional Harness writer injected by the composition root. */
		prepare?: (input: RepricedConfirmationSuccessorPreparation) => Promise<void>;
	}): Promise<
		| { kind: "created"; submission: CreationSubmissionRecord }
		| { kind: "existing"; submission: CreationSubmissionRecord }
	>;
	persistAgentPlanning(input: {
		workspaceId: string;
		submissionId: string;
		agentBinding: ComposerAgentBinding;
		executionPlanFreeze: ExecutionPlanCompileFreeze;
		/** Full multi-carrier freeze set when longer than one (V31-47). */
		executionPlanFreezes?: ExecutionPlanCompileFreeze[];
		packageConfirmationDecisionRef?: string;
		quoteRef?: CreationSubmissionRecord["snapshot"]["quote"];
		credits?: number;
		clarificationResolution?: ComposerClarificationResolution;
		confirmationDispatch?: CreationSubmissionRecord["confirmationDispatch"];
	}): Promise<CreationSubmissionRecord>;
	/**
	 * SUBMIT-01A: a parked turn (makeReady false, no freeze) settled planning
	 * without Make. Persist the accepted binding so recovery does not re-plan.
	 */
	persistParkedAgentBinding?(input: {
		workspaceId: string;
		submissionId: string;
		agentBinding: ComposerAgentBinding;
	}): Promise<CreationSubmissionRecord>;
	saveRepricedExecutionPlanFreeze?(input: {
		workspaceId: string;
		submissionId: string;
		expectedFreeze: ExecutionPlanCompileFreeze | null;
		previousQuoteRef: { id: string; revision: string };
		freeze: ExecutionPlanCompileFreeze;
		executionPlanFreezes?: ExecutionPlanCompileFreeze[];
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
		perWorkspaceLimit?: number;
	}): Promise<Array<{ submission: CreationSubmissionRecord }>>;
	expireUndispatchedConfirmationHolds?(input: { limit: number }): Promise<number>;
	/**
	 * V31-41: increment prepare failure attempts; optionally terminalize.
	 * Optional so memory/test stores can omit until wired.
	 */
	recordPrepareFailure?(input: {
		workspaceId: string;
		submissionId: string;
		terminal: boolean;
		reason?: string;
		skipAttemptIncrement?: boolean;
	}): Promise<{ attempts: number; terminalized: boolean }>;
	/**
	 * Claims terminal prepare refunds independently from Harness recovery. A
	 * lease makes the external refund callback replay-safe after a crash.
	 */
	claimPrepareTerminalRefunds?(input: {
		limit: number;
		leaseMs: number;
	}): Promise<Array<{ leaseId: string; submission: CreationSubmissionRecord }>>;
	completePrepareTerminalRefund?(input: {
		workspaceId: string;
		submissionId: string;
		leaseId: string;
	}): Promise<boolean>;
	recordPrepareTerminalRefundFailure?(input: {
		workspaceId: string;
		submissionId: string;
		leaseId: string;
		reason: string;
		maxAttempts: number;
	}): Promise<{
		attempts: number;
		state: "retry_scheduled" | "dead_letter" | "stale";
	}>;
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
	prepareExpiredConfirmationSuccessor?(input: ExpiredConfirmationSuccessorPreparation): Promise<
		{ executionConfirmationRequestId: string }
	>;
	prepareRepricedConfirmationSuccessor?(input: RepricedConfirmationSuccessorPreparation): Promise<
		{ executionConfirmationRequestId: string }
	>;
	classifyStartFailure?(
		input: CreationSubmissionRecord,
		error: unknown,
	): Promise<"retry" | "terminal_rejection">;
	/** V31-41: prepare-side classifier; falls back to start classifier. */
	classifyPrepareFailure?(
		input: CreationSubmissionRecord,
		error: unknown,
	): Promise<"retry" | "terminal_rejection">;
}

export interface CreationSubmissionIdFactory {
	createId(prefix: "content-package" | "work" | "task" | "submission"): string;
	now(): string;
}

declare const agentThreadIdentityBrand: unique symbol;

export type AgentThreadIdentity = string & {
	readonly [agentThreadIdentityBrand]: "AgentThreadIdentity";
};

export function asAgentThreadIdentity(value: string): AgentThreadIdentity {
	const normalized = value.trim();
	if (!normalized) throw new Error("Agent Thread identity cannot be empty.");
	return normalized as AgentThreadIdentity;
}

/** Deterministic Run id allocated at accept time, before Agent planning. */
export function composerAcceptedRunId(submission: CreationSubmissionRecord): string {
	return `run:composer:${fingerprintValue({
		workspaceId: submission.snapshot.workspaceId,
		taskId: submission.task.id,
	}).slice(0, 32)}`;
}

/** Deterministic Thread id allocated at accept time, before Agent planning. */
export function composerAcceptedThreadId(
	submission: CreationSubmissionRecord,
	continuationThreadId?: string,
): AgentThreadIdentity {
	const hinted = continuationThreadId?.trim();
	if (hinted) return asAgentThreadIdentity(hinted);
	return asAgentThreadIdentity(
		`thread:composer:${fingerprintValue({
			workspaceId: submission.snapshot.workspaceId,
			taskId: submission.task.id,
		}).slice(0, 32)}`,
	);
}

export type ComposerAgentBinding = {
	threadId: AgentThreadIdentity;
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
		runId: string;
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
	/** Workspace-owned read: a foreign workspace never sees the decision. */
	getDecision(
		workspaceId: string,
		requestId: string,
	): Promise<PlanConfirmationDecision | null>;
	decide?(input: {
		decisionId: string;
		requestId: string;
		workspaceId: string;
		actorId: string;
		decision: "confirmed";
		decidedAt: string;
	}): Promise<{ decision: PlanConfirmationDecision }>;
	getRequest?(requestId: string): Promise<{
		request: {
			requestId: string;
			planId: string;
			planRevision: number;
			snapshotHash: string;
			quoteRef: { id: string; revision: string | number };
			status: string;
			predecessorRequestId?: string;
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
		/** Server-authorized intersection; never copied from the HTTP body. */
		allowedFactRefs?: readonly string[];
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
	/** Revalidates a frozen source grant before a derived/result-adjust Work. */
	authorizeFactRefs?(input: {
		workspaceId: string;
		factRefs: readonly string[];
	}): Promise<readonly string[]>;
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

/**
 * A terminal confirmation cannot be retried by replacing the request attached
 * to this submission. The replacement must be a newly admitted task/workflow
 * so its authority, reservation and BillingIdentity share one transaction.
 */
export class CreationSubmissionRequiresSuccessorAdmissionError extends Error {
	readonly code = "REQUIRES_SUCCESSOR_ADMISSION";
	readonly status = 409;

	constructor(
		readonly details: {
			taskId: string;
			confirmationRequestId: string;
			terminalState: "rejected" | "expired" | "successor";
		},
	) {
		super("当前确认已结束，请基于最新方案重新发起确认。");
		this.name = "CreationSubmissionRequiresSuccessorAdmissionError";
	}
}

/**
 * Every reason the `/start` command refuses. Before V31-91 all fifteen were bare
 * `throw new Error(...)`, so the route's blanket handler collapsed them into a
 * single `COMPOSER_PLAN_START_FAILED` 409 and dropped the message
 * (`apps/core/src/composer-plan-route-registrar.ts:88-100`,
 * `apps/core/src/http-errors.ts:107-114`). Two pairs even shared a message
 * verbatim, so surfacing the text alone would still not have separated them.
 *
 * `toHttpError` keeps the code and status of anything carrying both
 * (`apps/core/src/http-errors.ts:96-106`), so attaching them here separates all
 * fifteen without touching HTTP semantics.
 *
 * The first ten are raised by `startPrepared` below; the last five by
 * `completeExplicitStart`
 * (`apps/core/src/p1/agent-session/composer-plan-session.ts:671-730`), which
 * `startPrepared` calls and whose throws reach the identical fallback. Splitting
 * only the first ten would have left the plan-revision race — the very shape
 * V31-91 is hunting — anonymous.
 */
export type ComposerPlanStartRefusal =
	| "COMPOSER_PLAN_START_UNAVAILABLE"
	| "COMPOSER_PLAN_START_TASK_NOT_FOUND"
	| "COMPOSER_PLAN_START_FREEZE_NOT_CONFIRMED"
	| "COMPOSER_PLAN_START_AUTHORITY_UNAVAILABLE"
	| "COMPOSER_PLAN_START_AUTHORITY_INCOMPLETE"
	| "COMPOSER_PLAN_START_PLAN_AUTHORITY_MISMATCH"
	| "COMPOSER_PLAN_START_DISPATCH_ID_MISSING"
	| "COMPOSER_PLAN_START_REQUEST_MISMATCH"
	| "COMPOSER_PLAN_START_NOT_DECIDED"
	| "COMPOSER_PLAN_START_DECISION_NOT_CONFIRMED"
	| "COMPOSER_PLAN_START_RUN_NOT_FOUND"
	| "COMPOSER_PLAN_START_PLAN_REVISION_STALE"
	| "COMPOSER_PLAN_START_FREEZE_DRIFTED"
	| "COMPOSER_PLAN_START_PLAN_NOT_READY"
	| "COMPOSER_PLAN_START_RUN_STATE_UNSTARTABLE";

/**
 * The message is merchant-facing: `merchantMessageFromP1`
 * (`mkfast-template-main/src/p1/merchant-p1-error.ts:18-28`) renders an
 * unmapped code's message as long as it carries no internal identifier and no
 * run of four Latin letters. Retry advice therefore has to be true per reason —
 * "请重试" was wrong for most of these.
 *
 * `details` is where identifiers go instead. Several of the replaced messages
 * interpolated a run id or a revision number, which is exactly the diagnostic
 * V31-91 needs; moving it here keeps it on the error (and in Core's logs)
 * without shipping it to a merchant. `toHttpError` reads `details` off shaped
 * errors (`apps/core/src/http-errors.ts:99,191-197`), so it also surfaces
 * wherever a route opts into details.
 */
export class ComposerPlanStartRefusedError extends Error {
	readonly status = 409;

	constructor(
		readonly code: ComposerPlanStartRefusal,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "ComposerPlanStartRefusedError";
	}
}

/**
 * A price-drift successor may not fall back to a cloned quote or a caller
 * payload. This error makes an absent transaction-aware reprice builder a
 * deliberate, inspectable 409 rather than an in-memory retry.
 */
export class RepricedPaidExecutionSuccessorUnavailableError extends Error {
	readonly code = "REPRICED_PAID_EXECUTION_SUCCESSOR_UNAVAILABLE";
	readonly status = 409;

	constructor() {
		super(
			"当前报价已变化，但新的确认方案尚未准备完成，请不要按旧报价继续执行。",
		);
		this.name = "RepricedPaidExecutionSuccessorUnavailableError";
	}
}

/**
 * Typed contract/authority rejection for prepare recovery. Generic provider
 * errors deliberately remain retryable; callers must not classify by text.
 */
export class PrepareTerminalRejectionError extends Error {
	readonly code = "PREPARE_TERMINAL_REJECTION";

	constructor(message: string) {
		super(message);
		this.name = "PrepareTerminalRejectionError";
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

	private readonly acceptedTurns = new Map<string, Promise<boolean>>();

	async prepareResultTextSelection(input: {
		actorId: string;
		workspaceId: string;
	}) {
		if (!this.admission.prepareResultTextSelection) {
			throw new Error("Result text-selection admission is unavailable.");
		}
		return this.admission.prepareResultTextSelection(input);
	}

	async createRepricedPaidExecutionSuccessor(
		input: RepricedPaidExecutionSuccessorRequest,
	) {
		const create = this.store.createRepricedPaidExecutionSuccessor;
		if (!create || !this.harness.prepareRepricedConfirmationSuccessor) {
			throw new RepricedPaidExecutionSuccessorUnavailableError();
		}
		return create.call(this.store, {
			...input,
			successor: {
				submissionId: this.ids.createId("submission"),
				contentPackageId: this.ids.createId("content-package"),
				workId: this.ids.createId("work"),
				taskId: this.ids.createId("task"),
				createdAt: this.ids.now(),
			},
			prepare: (prepared) =>
				this.harness.prepareRepricedConfirmationSuccessor!(prepared).then(
					() => undefined,
				),
		});
	}

	async cancelRunning(input: { workspaceId: string; taskId: string }) {
		const terminate = this.store.terminateRunningWork;
		if (!terminate) {
			throw new Error("Running Composer work cancellation is unavailable.");
		}
		const outcome = await terminate.call(this.store, {
			workspaceId: input.workspaceId,
			taskId: input.taskId,
			reason: "cancelled",
		});
		if (outcome === "missing") {
			throw new Error("Running Composer work was not found.");
		}
		return { cancelled: true as const, outcome };
	}

	async startPrepared(input: {
		workspaceId: string;
		taskId: string;
		planRevision: number;
	}) {
		if (!this.store.readByTask || !this.agentPlanning?.completeExplicitStart) {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_UNAVAILABLE",
				"制作服务暂时不可用，请稍后再试。",
			);
		}
		let submission = await this.store.readByTask({
			workspaceId: input.workspaceId,
			taskId: input.taskId,
		});
		if (!submission) {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_TASK_NOT_FOUND",
				"没找到这次要开始的任务，请回到列表重新进入。",
			);
		}
		// SUBMIT-01A returns 202 before freeze/preparePendingConfirmation. A paid
		// start that races that turn would otherwise read a still-planning row
		// (or a freeze whose confirmation request id is not persisted yet).
		const inFlight = this.acceptedTurns.get(this.acceptedTurnKey(submission));
		if (inFlight) {
			await inFlight;
			submission =
				(await this.store.readByTask({
					workspaceId: input.workspaceId,
					taskId: input.taskId,
				})) ?? submission;
		}
		if (
			!submission.executionPlanFreeze ||
			submission.executionPlanFreeze.approvalBasis !== "merchant_confirmed"
		) {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_FREEZE_NOT_CONFIRMED",
				"这个方案还没有你确认过的版本，请先确认方案再开始。",
			);
		}
		if (!this.explicitConfirmations) {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_AUTHORITY_UNAVAILABLE",
				"方案确认服务暂时不可用，请稍后再试。",
			);
		}
		const workflowId = composerPreparedAttemptId(submission);
		if (
			!this.explicitConfirmations.getRequest ||
			!this.explicitConfirmations.getCurrentByWorkflowId
		) {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_AUTHORITY_INCOMPLETE",
				"方案确认服务暂时不可用，请稍后再试。",
			);
		}
		const planAuthority = await this.explicitConfirmations.getCurrentByWorkflowId(
			workflowId,
		);
		const freeze = submission.executionPlanFreeze;
		// V31-91 step 2: seven different disagreements refuse under one code, so
		// naming the code alone still leaves the racing side ambiguous. CI has now
		// produced this refusal for real (run 31930284168, campaign-paid-work-
		// confirmation), and the next one has to say WHICH comparison failed.
		// Enumerated rather than short-circuited on purpose: when two disagree at
		// once, that pair is itself the evidence about what is racing what.
		const authorityFacts = {
			planId: freeze.planId,
			requestedRevision: input.planRevision,
			freezeRevision: freeze.planRevision,
		};
		const authorityMismatch: string[] = [];
		if (!planAuthority) authorityMismatch.push("authority_missing");
		if (planAuthority && planAuthority.workspaceId !== input.workspaceId)
			authorityMismatch.push("workspaceId");
		if (planAuthority && planAuthority.planId !== freeze.planId)
			authorityMismatch.push("planId");
		const clientPostedNewerStoreRevision =
			planAuthority != null &&
			planAuthority.planRevision === freeze.planRevision &&
			input.planRevision > freeze.planRevision;
		if (
			planAuthority &&
			planAuthority.planRevision !== input.planRevision &&
			!clientPostedNewerStoreRevision
		)
			authorityMismatch.push("planRevision_vs_request");
		if (planAuthority && planAuthority.planRevision !== freeze.planRevision)
			authorityMismatch.push("planRevision_vs_freeze");
		if (planAuthority && planAuthority.quoteRef.id !== freeze.quoteRef.id)
			authorityMismatch.push("quoteRef.id");
		if (
			planAuthority &&
			String(planAuthority.quoteRef.revision) !==
				String(freeze.quoteRef.revision)
		)
			authorityMismatch.push("quoteRef.revision");
		if (!planAuthority || authorityMismatch.length > 0) {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_PLAN_AUTHORITY_MISMATCH",
				"方案已经更新过，请回到方案页重新确认后再开始。",
				{
					mismatched: authorityMismatch,
					...authorityFacts,
					authorityPlanId: planAuthority?.planId ?? null,
					authorityRevision: planAuthority?.planRevision ?? null,
				},
			);
		}
		// The authority ID is not a pure function of {workflowId, planRevision,
		// snapshotHash} once a prior terminal decision exists on this base:
		// resolveRequestId (execution-confirmation-authority.ts:199) derives a
		// `:r:` successor from the decision history, so recomputing it here would
		// resolve a stale, superseded request whenever the prepared attempt is a
		// successor. The dispatch that requested this confirmation already
		// persisted the exact authority ID it received (:743/:751); resolve that
		// instead of rederiving it.
		const requestId = submission.confirmationDispatch?.requestId;
		if (!requestId) {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_DISPATCH_ID_MISSING",
				"这次确认的记录不完整，请重新确认方案。",
			);
		}
		const authority = await this.explicitConfirmations.getRequest(requestId);
		if (
			!authority ||
			authority.request.requestId !== requestId ||
			authority.request.planId !== freeze.planId ||
			(!clientPostedNewerStoreRevision &&
				authority.request.planRevision !== input.planRevision) ||
			authority.request.planRevision !== freeze.planRevision ||
			authority.request.snapshotHash !== planAuthority.snapshotHash ||
			authority.request.quoteRef.id !== freeze.quoteRef.id ||
			String(authority.request.quoteRef.revision) !== String(freeze.quoteRef.revision)
		) {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_REQUEST_MISMATCH",
				"这次确认对应的方案已经变了，请回到方案页重新确认。",
			);
		}
		if (authority.request.status === "expired") {
			if (
				!this.store.createExpiredConfirmationSuccessor ||
				!this.harness.prepareExpiredConfirmationSuccessor
			) {
				throw new CreationSubmissionRequiresSuccessorAdmissionError({
					taskId: submission.task.id,
					confirmationRequestId: requestId,
					terminalState: "expired",
				});
			}
			const successor = await this.store.createExpiredConfirmationSuccessor({
				workspaceId: input.workspaceId,
				sourceSubmissionId: submission.snapshot.id,
				predecessorRequestId: requestId,
				successor: {
					submissionId: this.ids.createId("submission"),
					contentPackageId: this.ids.createId("content-package"),
					workId: this.ids.createId("work"),
					taskId: this.ids.createId("task"),
					createdAt: this.ids.now(),
				},
				prepare: (prepared) =>
					this.harness.prepareExpiredConfirmationSuccessor!(prepared).then(() => undefined),
			});
			const binding = explicitConfirmationBinding(
				successor.submission,
				requireAgentBinding(successor.submission),
			);
			return submissionResponse(successor.submission, successor.kind === "existing", binding);
		}
		if (
			authority.request.predecessorRequestId &&
			submission.confirmationDispatch?.predecessorRequestId !==
				authority.request.predecessorRequestId
		) {
			throw new CreationSubmissionRequiresSuccessorAdmissionError({
				taskId: submission.task.id,
				confirmationRequestId: requestId,
				terminalState: "successor",
			});
		}
		if (authority.request.status !== "decided") {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_NOT_DECIDED",
				"方案确认还没落实，请稍等一下再开始。",
			);
		}
		const decision = await this.explicitConfirmations.getDecision(
			input.workspaceId,
			requestId,
		);
		if (decision?.decision === "rejected") {
			throw new CreationSubmissionRequiresSuccessorAdmissionError({
				taskId: submission.task.id,
				confirmationRequestId: requestId,
				terminalState: "rejected",
			});
		}
		if (!decision || decision.requestId !== requestId || decision.decision !== "confirmed") {
			throw new ComposerPlanStartRefusedError(
				"COMPOSER_PLAN_START_DECISION_NOT_CONFIRMED",
				"这次方案还没有确认通过，请先确认方案。",
			);
		}
		// V31-47: secondary carrier Makes admit with this package decision and
		// must not open another confirmation / reserve.
		submission.packageConfirmationDecisionRef = decision.decisionId;
		const binding = await this.agentPlanning.completeExplicitStart({
			submission,
			planRevision: freeze.planRevision,
		});
		await this.startHarness(submission);
		await this.agentPlanning.markExplicitStartCompleted?.({
			submission,
			runId: binding.runId,
		});
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
				...(submission.executionPlanFreezes
					? { executionPlanFreezes: submission.executionPlanFreezes }
					: {}),
				...binding.repriceCommit,
			});
		} else {
			submission = await this.store.persistAgentPlanning({
				workspaceId: input.workspaceId,
				submissionId: submission.snapshot.id,
				agentBinding: { threadId: binding.threadId, runId: binding.runId },
				executionPlanFreeze: submission.executionPlanFreeze,
				...(submission.executionPlanFreezes
					? { executionPlanFreezes: submission.executionPlanFreezes }
					: {}),
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
			// V31-28 / D-043: an answer replay on an already-frozen exempt copy
			// plan re-drives the idempotent Make start, so a crash between the
			// first answer's persist and its start cannot strand the task.
			if (
				submission.executionPlanFreeze.approvalBasis === "policy_exempt_copy"
			) {
				await this.startHarness(submission);
				return { makeReady: true };
			}
			return { makeReady: false };
		}
		const binding = await this.agentPlanning.answerClarification({
			submission,
			merchantAnswer: input.merchantAnswer,
		});
		if (!submission.executionPlanFreeze) return binding;
		submission.agentPlanPending = false;
		submission.agentBinding = {
			threadId: binding.threadId,
			runId: binding.runId,
		};
		if (binding.repriceCommit) {
			if (!this.store.saveRepricedExecutionPlanFreeze) {
				throw new Error("Atomic Composer clarification reprice persistence is unavailable.");
			}
			submission = await this.store.saveRepricedExecutionPlanFreeze({
				workspaceId: input.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				...(submission.executionPlanFreezes
					? { executionPlanFreezes: submission.executionPlanFreezes }
					: {}),
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
			// V31-28 / D-043: an exempt copy plan is confirmation-free — the
			// answered clarification starts its Make directly (same idempotent
			// lease the submit path uses). merchant_confirmed plans keep waiting
			// for the explicit start.
			if (binding.makeReady) await this.startHarness(submission);
			return { threadId: binding.threadId, runId: binding.runId, makeReady: binding.makeReady };
		}
		submission = await this.store.persistAgentPlanning({
			workspaceId: input.workspaceId,
			submissionId: submission.snapshot.id,
			agentBinding: { threadId: binding.threadId, runId: binding.runId },
			executionPlanFreeze: submission.executionPlanFreeze,
			...(submission.executionPlanFreezes
				? { executionPlanFreezes: submission.executionPlanFreezes }
				: {}),
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
		// V31-28 / D-043: same exempt-copy auto-start as the reprice branch.
		if (binding.makeReady) await this.startHarness(submission);
		return binding;
	}

	async submit(input: ComposerSubmissionRequest) {
		return this.submitWithConfirmationContext(input, undefined, {
			waitForAcceptedTurn: true,
		});
	}

	/**
	 * HTTP accept: persist idempotency + Task/Run and return before Agent
	 * planning. Planning is the durable accepted turn / recovery outbox.
	 */
	async accept(input: ComposerSubmissionRequest) {
		return this.submitWithConfirmationContext(input, undefined, {
			waitForAcceptedTurn: false,
		});
	}

	/** Test/recovery seam: drain in-flight accepted planning turns. */
	async flushAcceptedTurns() {
		await Promise.all([...this.acceptedTurns.values()]);
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
		return this.submitWithConfirmationContext(
			input.submission,
			{
				campaignPlanRef: input.campaignPlanRef,
				workOrdinal: input.workOrdinal,
				approvalScope: "single_work",
			},
			{ waitForAcceptedTurn: true },
		);
	}

	private async submitWithConfirmationContext(
		input: ComposerSubmissionRequest,
		executionConfirmationContext?: NonNullable<
			CreationSubmissionRecord["executionConfirmationContext"]
		>,
		options?: { waitForAcceptedTurn?: boolean },
	) {
		const waitForAcceptedTurn = options?.waitForAcceptedTurn !== false;
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
			if (receipt.harnessState === "failed") {
				throw new Error("Harness start permanently failed.");
			}
			return this.finishAcceptedSubmission(
				receipt.submission,
				true,
				request.agentThreadId,
				waitForAcceptedTurn,
			);
		}

		const admitted = await this.admission.admit(request);
		const serverBoundRequest = {
			...request,
			allowedFactRefs: admitted.allowedFactRefs ?? [],
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
		const {
			agentThreadId: _agentThreadId,
			requestedFactRefs: _requestedFactRefs,
			...executionRequest
		} = serverBoundRequest;
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
			...(request.agentThreadId
				? {
						agentContinuationThreadId: asAgentThreadIdentity(
							request.agentThreadId,
						),
					}
				: {}),
			...(executionConfirmationContext ? { executionConfirmationContext } : {}),
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
		return this.finishAcceptedSubmission(
			claimed.submission,
			claimed.kind === "existing",
			request.agentThreadId,
			waitForAcceptedTurn,
		);
	}

	private async finishAcceptedSubmission(
		submission: CreationSubmissionRecord,
		replayed: boolean,
		continuationThreadId: string | undefined,
		waitForAcceptedTurn: boolean,
	) {
		if (!this.agentPlanning) {
			await this.startHarness(submission);
			return submissionResponse(submission, replayed);
		}
		const turn = this.enqueueAcceptedTurn(submission, continuationThreadId);
		if (!waitForAcceptedTurn) {
			void turn.catch((error) => {
				console.error("Accepted composer planning turn failed.", error);
			});
			return acceptedSubmissionResponse(submission, replayed, continuationThreadId);
		}
		await turn;
		return submissionResponse(
			submission,
			replayed,
			explicitConfirmationBinding(submission, submission.agentBinding),
		);
	}

	private acceptedTurnKey(submission: CreationSubmissionRecord) {
		return `${submission.snapshot.workspaceId}:${submission.snapshot.id}`;
	}

	private enqueueAcceptedTurn(
		submission: CreationSubmissionRecord,
		continuationThreadId?: string,
	): Promise<boolean> {
		const key = this.acceptedTurnKey(submission);
		const existing = this.acceptedTurns.get(key);
		if (existing) return existing;
		const turn = this.runAcceptedTurn(submission, continuationThreadId).finally(
			() => {
				this.acceptedTurns.delete(key);
			},
		);
		this.acceptedTurns.set(key, turn);
		return turn;
	}

	private async runAcceptedTurn(
		submission: CreationSubmissionRecord,
		continuationThreadId?: string,
	): Promise<boolean> {
		const preparedBinding = await this.prepareAgentPlan(
			submission,
			continuationThreadId,
		);
		const agentBinding = explicitConfirmationBinding(
			submission,
			preparedBinding,
		);
		if (agentBinding?.makeReady === false) {
			await this.preparePendingConfirmation(submission);
			return false;
		}
		return this.startHarness(submission);
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
		const persisted = await this.store.persistAgentPlanning({
			workspaceId: submission.snapshot.workspaceId,
			submissionId: submission.snapshot.id,
			agentBinding: requireAgentBinding(submission),
			executionPlanFreeze: submission.executionPlanFreeze,
			...(submission.executionPlanFreezes
				? { executionPlanFreezes: submission.executionPlanFreezes }
				: {}),
			quoteRef: submission.snapshot.quote,
			credits: submission.usageReservation.credits,
			confirmationDispatch: submission.confirmationDispatch,
		});
		submission.confirmationDispatch = persisted.confirmationDispatch;
		if (persisted.executionPlanFreezes) {
			submission.executionPlanFreezes = persisted.executionPlanFreezes;
		}
	}

	private async prepareAgentPlan(
		submission: CreationSubmissionRecord,
		continuationThreadId?: string,
		persistExisting = true,
	): Promise<ComposerAgentBinding | undefined> {
		if (!this.agentPlanning) {
			if (submission.executionPlanFreeze && !submission.agentBinding) {
				throw new Error("Planned submission is missing its authoritative Agent Thread binding.");
			}
			return submission.agentBinding;
		}
		if (submission.agentBinding && submission.executionPlanFreeze) {
			return submission.agentBinding;
		}
		const durableContinuationThreadId =
			continuationThreadId ?? submission.agentContinuationThreadId;
		const binding = await this.agentPlanning.prepare({
			...(durableContinuationThreadId
				? { continuationThreadId: durableContinuationThreadId }
				: {}),
			submission,
		});
		ensureConfirmationDispatch(submission);
		if (submission.executionPlanFreeze) submission.agentPlanPending = false;
		// A parked turn (makeReady === false) legitimately returns without a
		// freeze — the merchant still owes an answer or an explicit start.
		// Only a ready binding must have frozen a plan.
		if (binding.makeReady !== false && !submission.executionPlanFreeze) {
			throw new Error("Agent planning did not freeze an execution plan.");
		}
		submission.agentBinding = { threadId: binding.threadId, runId: binding.runId };
		if (
			persistExisting &&
			binding.makeReady === false &&
			!submission.executionPlanFreeze
		) {
			submission.agentPlanPending = false;
			if (this.store.persistParkedAgentBinding) {
				const persisted = await this.store.persistParkedAgentBinding({
					workspaceId: submission.snapshot.workspaceId,
					submissionId: submission.snapshot.id,
					agentBinding: submission.agentBinding,
				});
				if (persisted.agentBinding) {
					submission.agentBinding = persisted.agentBinding;
				}
			}
			return binding;
		}
		if (persistExisting && submission.executionPlanFreeze) {
			const persisted = await this.store.persistAgentPlanning({
				workspaceId: submission.snapshot.workspaceId,
				submissionId: submission.snapshot.id,
				agentBinding: submission.agentBinding,
				executionPlanFreeze: submission.executionPlanFreeze,
				...(submission.executionPlanFreezes
					? { executionPlanFreezes: submission.executionPlanFreezes }
					: {}),
				...(submission.packageConfirmationDecisionRef
					? {
							packageConfirmationDecisionRef:
								submission.packageConfirmationDecisionRef,
						}
					: {}),
				quoteRef: submission.snapshot.quote,
				credits: submission.usageReservation.credits,
				confirmationDispatch: submission.confirmationDispatch,
			});
			if (!persisted.agentBinding || !persisted.executionPlanFreeze) {
				throw new Error("Durable Agent planning record is incomplete.");
			}
			submission.agentBinding = persisted.agentBinding;
			submission.executionPlanFreeze = persisted.executionPlanFreeze;
			if (persisted.executionPlanFreezes) {
				submission.executionPlanFreezes = persisted.executionPlanFreezes;
			}
			if (persisted.packageConfirmationDecisionRef) {
				submission.packageConfirmationDecisionRef =
					persisted.packageConfirmationDecisionRef;
			}
		}
		return binding;
	}

	async submitResultAdjustment(input: {
		actorId: string;
		idempotencyKey: string;
		instruction: string;
		outputCount: number;
		/** Frozen note image subset (result_adjust asset/set scope). */
		pageRegenerationTargetAssetIds?: string[];
		quote: { id: string; revision: string };
		sourceContentPackage: { id: string; revision: number };
		sourceNoteStyleId?: string;
		sourceSnapshot: CreationExecutionSnapshot;
		sourceAgentThreadId?: AgentThreadIdentity;
		sourceArtifactLineage?: CreationSubmissionRecord["artifactLineage"];
		taskId: string;
		textSelectionScope?: ResultAdjustTextSelectionScope;
		workId: string;
		workspaceId: string;
	}) {
		const source = creationExecutionSnapshotSchema.parse(input.sourceSnapshot);
		// No lineage requirement here either. `agentBinding.threadId` arrived with
		// V31-15, so no Result delivered before it carries one, and a run that
		// never reached a ready artifact revision has no lineage. Refusing them
		// made every pre-existing Result unadjustable — and refusing here was
		// worse than refusing at prepare, because the merchant had already
		// confirmed a quote. Both fields spread conditionally onto the submission
		// below; without them the successor publishes a fresh artifact instead of
		// continuing the old one. The read port fails closed only on lineage that
		// exists and cannot be read (`artifactLineageUnreadable`).
		if (source.workspaceId !== input.workspaceId) {
			throw new Error("Result adjustment source does not match its workspace.");
		}
		const payloadHash = fingerprintValue({
			instruction: input.instruction,
			outputCount: input.outputCount,
			pageRegenerationTargetAssetIds: [
				...new Set(input.pageRegenerationTargetAssetIds ?? []),
			].sort(),
			quote: input.quote,
			sourceAgentThreadId: input.sourceAgentThreadId ?? null,
			sourceArtifactLineage: input.sourceArtifactLineage
				? {
					...input.sourceArtifactLineage,
					targetUnitIds: [
						...new Set(input.sourceArtifactLineage.targetUnitIds ?? []),
					].sort(),
					sourceUnitMappings: [
						...(input.sourceArtifactLineage.sourceUnitMappings ?? []),
					].sort((left, right) =>
						`${left.sourceUnitId}:${left.executionUnitId}`.localeCompare(
							`${right.sourceUnitId}:${right.executionUnitId}`,
						),
					),
				}
				: null,
			sourceContentPackage: input.sourceContentPackage,
			sourceNoteStyleId: input.sourceNoteStyleId ?? null,
			sourceSnapshotFingerprint: fingerprintValue(source),
			taskId: input.taskId,
			textSelectionScope: input.textSelectionScope,
			workId: input.workId,
		});
		const receipt = await this.store.readReceipt({
			workspaceId: input.workspaceId,
			idempotencyKey: input.idempotencyKey,
			payloadHash,
		});
		if (receipt.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		if (receipt.kind === "existing") {
			if (receipt.harnessState === "failed") {
				throw new Error("Harness start permanently failed.");
			}
			return submissionResponse(
				receipt.submission,
				true,
				receipt.submission.agentBinding,
			);
		}
		const allowedFactRefs =
			source.allowedFactRefs.length === 0
				? []
				: await this.requireResultAdjustmentFactGrants(
						input.workspaceId,
						source.allowedFactRefs,
					);
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
			allowedFactRefs,
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
				...(input.pageRegenerationTargetAssetIds
					? {
							pageRegeneration: {
								targetAssetIds: input.pageRegenerationTargetAssetIds,
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
			...(input.sourceAgentThreadId
				? { agentContinuationThreadId: input.sourceAgentThreadId }
				: {}),
			...(input.sourceArtifactLineage ? { artifactLineage: input.sourceArtifactLineage } : {}),
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
			payloadHash,
			submission,
			workspaceId: input.workspaceId,
		});
		if (claimed.kind === "conflict") {
			throw new CreationSubmissionConflictError();
		}
		// V31-18 P0-2: a correction is the path on which a merchant checks whether
		// the preference they confirmed actually took hold, so it must prepare its
		// plan exactly like a first submission. Claiming and starting Make directly
		// skipped confirmed-experience retrieval and its MemoryInjectionReceipt on
		// the one surface that tests recurrence. Confirmed preferences are
		// workspace-scoped (`agent-memory-platform.ts:801`), so a fresh Thread for
		// the adjustment task still retrieves them.
		const agentBinding = await this.prepareAgentPlan(
			claimed.submission,
			input.sourceAgentThreadId,
		);
		await this.startHarness(claimed.submission);
		return submissionResponse(
			claimed.submission,
			claimed.kind === "existing",
			agentBinding,
		);
	}

	private async requireResultAdjustmentFactGrants(
		workspaceId: string,
		factRefs: readonly string[],
	) {
		if (!this.admission.authorizeFactRefs) {
			throw new Error("Result adjustment fact authorization is unavailable.");
		}
		const allowed = await this.admission.authorizeFactRefs({
			workspaceId,
			factRefs,
		});
		if (
			allowed.length !== factRefs.length ||
			allowed.some((ref, index) => ref !== factRefs[index])
		) {
			throw new Error("Result adjustment fact authorization changed.");
		}
		return [...allowed];
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
			...(input.request.agentThreadId
				? { agentContinuationThreadId: input.request.agentThreadId }
				: {}),
			...(input.request.artifactLineage
				? { artifactLineage: input.request.artifactLineage }
				: {}),
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
		// V31-18 P0-2: a correction is the path on which a merchant checks whether
		// the preference they confirmed actually took hold, so it must prepare its
		// plan exactly like a first submission. Claiming and starting Make directly
		// skipped confirmed-experience retrieval and its MemoryInjectionReceipt on
		// the one surface that tests recurrence. Confirmed preferences are
		// workspace-scoped (`agent-memory-platform.ts:801`), so a fresh Thread for
		// the adjustment task still retrieves them.
		const agentBinding = await this.prepareAgentPlan(
			claimed.submission,
			input.request.agentThreadId,
		);
		await this.startHarness(claimed.submission);
		return submissionResponse(
			claimed.submission,
			claimed.kind === "existing",
			agentBinding,
		);
	}

	/**
	 * Replays only committed, reclaimable starts after a process crash.
	 * V31-33 fairness is enforced inside listRecoverableHarnessStarts.
	 * V31-41 prepare failures are counted, classified, and may terminalize
	 * with an optional reservation refund via onPrepareTerminalRefund.
	 */
	async recoverPendingStarts(
		limit = 100,
		options?: {
			onPrepareTerminalRefund?: (submission: CreationSubmissionRecord) => Promise<void>;
		},
	) {
		await this.store.expireUndispatchedConfirmationHolds?.({ limit });
		const recoverable = (
			await this.store.listRecoverableHarnessStarts({ limit })
		).filter((candidate) => {
			if (candidate.submission.agentPlanPending === true) return true;
			if (!candidate.submission.executionPlanFreeze) {
				// Parked clarification: binding persisted, planning settled.
				// Legacy unplanned claims still have no binding.
				return !candidate.submission.agentBinding;
			}
			if (
				candidate.submission.executionPlanFreeze.approvalBasis !==
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
		const failureDetails: Array<{
			workspaceId: string;
			submissionId: string;
			reason: string;
			terminal: boolean;
		}> = [];
		for (const candidate of recoverable) {
			const submission = candidate.submission;
			const workspaceId = submission.snapshot.workspaceId;
			const submissionId = submission.snapshot.id;
			// Durable arm already has binding + freeze: prepare short-circuits and
			// must not be counted as a prepare failure (V31-39 / W4 dual-arm).
			const isDurableArm = Boolean(
				submission.agentBinding && submission.executionPlanFreeze,
			);
			let prepareCompleted = isDurableArm;
			try {
				// Join an in-flight HTTP accept turn so recovery does not start a
				// second Agent plan. Otherwise keep prepare/start split for V31-41.
				const inFlight = this.acceptedTurns.get(
					this.acceptedTurnKey(submission),
				);
				if (inFlight) {
					const startedThis = await inFlight;
					prepareCompleted = true;
					if (startedThis) started += 1;
				} else {
					await this.prepareAgentPlan(submission);
					prepareCompleted = true;
					const binding = explicitConfirmationBinding(
						submission,
						submission.agentBinding,
					);
					if (binding?.makeReady === false) {
						await this.preparePendingConfirmation(submission);
					} else if (await this.startHarness(submission)) {
						started += 1;
					}
				}
			} catch (error) {
				failed += 1;
				const reason =
					error instanceof Error ? error.message : String(error);
				// Start-side failures (after prepare succeeded, or durable arm)
				// already use claim/classify inside startHarness. Do not count
				// them as prepare failures (V31-41 scope is prepare only).
				// Keep return shape stable for start-only failures (counts only);
				// ops still get counts via api-runtime console.error.
				if (
					prepareCompleted ||
					isDurableArm ||
					Boolean(submission.executionPlanFreeze)
				) {
					continue;
				}
				const disposition =
					(await (this.harness.classifyPrepareFailure ??
						this.harness.classifyStartFailure)?.(
						submission,
						error,
					)) ?? (await this.defaultPrepareDisposition(submission, error));
				let terminal = disposition === "terminal_rejection";
				if (this.store.recordPrepareFailure) {
					// First record as non-terminal to grow the attempt counter; if
					// the budget is exhausted, re-record as terminal (single row).
					let recorded = await this.store.recordPrepareFailure({
						workspaceId,
						submissionId,
						terminal,
						reason,
					});
					if (
						!recorded.terminalized &&
						recorded.attempts >= PREPARE_FAILURE_TERMINAL_ATTEMPTS
					) {
						terminal = true;
						recorded = await this.store.recordPrepareFailure({
							workspaceId,
							submissionId,
							terminal: true,
							skipAttemptIncrement: true,
							reason: `${reason} (prepare attempt budget exhausted at ${recorded.attempts})`,
						});
					}
					terminal = recorded.terminalized || terminal;
				}
				failureDetails.push({
					workspaceId,
					submissionId,
					reason,
					terminal,
				});
			}
		}
		const refundReconciliation = await this.reconcilePrepareTerminalRefunds(
			limit,
			options?.onPrepareTerminalRefund,
		);
		failed += refundReconciliation.failed;
		failureDetails.push(...refundReconciliation.failureDetails);
		return {
			attempted: recoverable.length,
			failed,
			started,
			...(failureDetails.length > 0 ? { failureDetails } : {}),
		};
	}

	/**
	 * The external billing callback is never the source of truth. Terminalizing
	 * prepare first persists `pending`; this worker then claims that durable row
	 * and records either the retry schedule or a dead letter before returning.
	 */
	private async reconcilePrepareTerminalRefunds(
		limit: number,
		onPrepareTerminalRefund?: (
			submission: CreationSubmissionRecord,
		) => Promise<void>,
	): Promise<{
		failed: number;
		failureDetails: Array<{
			workspaceId: string;
			submissionId: string;
			reason: string;
			terminal: boolean;
		}>;
	}> {
		if (!onPrepareTerminalRefund) {
			return { failed: 0, failureDetails: [] };
		}
		const claim = this.store.claimPrepareTerminalRefunds;
		const complete = this.store.completePrepareTerminalRefund;
		const recordFailure = this.store.recordPrepareTerminalRefundFailure;
		if (!claim || !complete || !recordFailure) {
			throw new Error(
				"Prepare terminal refund reconciliation requires a durable CreationSubmissionStore.",
			);
		}

		const candidates = await claim.call(this.store, {
			limit,
			leaseMs: PREPARE_TERMINAL_REFUND_LEASE_MS,
		});
		let failed = 0;
		const failureDetails: Array<{
			workspaceId: string;
			submissionId: string;
			reason: string;
			terminal: boolean;
		}> = [];
		for (const candidate of candidates) {
			const submission = candidate.submission;
			const workspaceId = submission.snapshot.workspaceId;
			const submissionId = submission.snapshot.id;
			try {
				await onPrepareTerminalRefund(submission);
				await complete.call(this.store, {
					workspaceId,
					submissionId,
					leaseId: candidate.leaseId,
				});
			} catch (error) {
				const reason =
					error instanceof Error ? error.message : String(error);
				const recorded = await recordFailure.call(this.store, {
					workspaceId,
					submissionId,
					leaseId: candidate.leaseId,
					reason,
					maxAttempts: PREPARE_TERMINAL_REFUND_MAX_ATTEMPTS,
				});
				if (recorded.state === "stale") continue;
				failed += 1;
				failureDetails.push({
					workspaceId,
					submissionId,
					reason,
					terminal: recorded.state === "dead_letter",
				});
			}
		}
		return { failed, failureDetails };
	}

	/**
	 * V31-41 default prepare classifier when ports omit one.
	 * Permanent after PREPARE_FAILURE_TERMINAL_ATTEMPTS (bounded, not unbounded).
	 */
	private async defaultPrepareDisposition(
		_submission: CreationSubmissionRecord,
		error: unknown,
	): Promise<"retry" | "terminal_rejection"> {
		if (
			error instanceof PrepareTerminalRejectionError ||
			(error !== null &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "PREPARE_TERMINAL_REJECTION")
		) {
			return "terminal_rejection";
		}
		// Transient by default; attempt counter + backoff still apply via
		// recordPrepareFailure. Terminalization by attempt budget is handled by
		// the store consumer when attempts exceed the threshold below.
		return "retry";
	}

	private async startHarness(submission: CreationSubmissionRecord) {
		if (
			requiresPaidConfirmation(submission) &&
			submission.confirmationDispatch?.state === "expired"
		) {
			throw new CreationSubmissionRequiresSuccessorAdmissionError({
				taskId: submission.task.id,
				confirmationRequestId:
					submission.confirmationDispatch.requestId ?? submission.task.id,
				terminalState: "expired",
			});
		}
		if (
			requiresPaidConfirmation(submission) &&
			(submission.executionPlanFreeze?.approvalBasis !== "merchant_confirmed" ||
				!submission.confirmationDispatch)
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

/** V31-41: bounded prepare retries before permanent terminal + refund. */
export const PREPARE_FAILURE_TERMINAL_ATTEMPTS = 8;
export const PREPARE_TERMINAL_REFUND_MAX_ATTEMPTS = 8;
export const PREPARE_TERMINAL_REFUND_LEASE_MS = 60_000;

/**
 * Primary prepared-attempt / confirmation workflow id (no carrier suffix).
 * Multi-carrier Makes use `composerCarrierAttemptId` so effect keys stay
 * isolated while confirmation stays package-level on this base id (V31-47).
 */
export function composerPreparedAttemptId(submission: CreationSubmissionRecord): string {
	const freeze = submission.executionPlanFreeze;
	return freeze?.approvalBasis === "merchant_confirmed"
		? `${submission.task.id}:plan-r${freeze.planRevision}`
		: submission.task.id;
}

/**
 * Per-carrier Make workflow id. Single-carrier keeps the historical base id
 * (no `:carrier-` suffix) so prepared paid attempts continue to resume.
 */
export function composerCarrierAttemptId(
	submission: CreationSubmissionRecord,
	carrier: string,
	options?: { isPrimary?: boolean; multiCarrier?: boolean },
): string {
	const base = composerPreparedAttemptId(submission);
	const multi =
		options?.multiCarrier ??
		(submission.executionPlanFreezes?.length ?? 0) > 1;
	if (!multi) return base;
	// Primary paid attempt keeps the base id so preparePendingConfirmation and
	// startPrepared resume the same confirmation authority / registry claim.
	if (options?.isPrimary && submission.executionPlanFreeze?.approvalBasis === "merchant_confirmed") {
		return base;
	}
	return `${base}:carrier-${carrier}`;
}

function requireAgentBinding(
	submission: CreationSubmissionRecord,
): ComposerAgentBinding {
	if (!submission.agentBinding) {
		throw new Error(
			"Planned submission is missing its authoritative Agent Thread binding.",
		);
	}
	return submission.agentBinding;
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
	// Honor plan-session makeReady for 爆款复刻: the source confirm already
	// happened, so forcing false here parked Make on Living Plan with no
	// merchant-visible 两种图文方向 ask (p2 viral chip). Ordinary notes still
	// wait for 开始制作.
	if (isViralAdaptRecipeId(submission.snapshot.recipe.id)) {
		return binding;
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

function acceptedSubmissionResponse(
	submission: CreationSubmissionRecord,
	replayed: boolean,
	continuationThreadId?: string,
) {
	if (submission.executionPlanFreeze) {
		return submissionResponse(
			submission,
			replayed,
			explicitConfirmationBinding(submission, submission.agentBinding),
		);
	}
	return submissionResponse(submission, replayed, {
		threadId: composerAcceptedThreadId(submission, continuationThreadId),
		runId: composerAcceptedRunId(submission),
		makeReady: false,
	});
}

function submissionResponse(
	submission: CreationSubmissionRecord,
	replayed: boolean,
	agentBinding?: ComposerAgentBinding
) {
	const withheldForConfirmation =
		agentBinding?.makeReady === false &&
		submission.confirmationDispatch?.requestId;
	return {
		contentPackage: submission.contentPackage,
		...(agentBinding
			? {
					threadId: agentBinding.threadId,
					runId: agentBinding.runId,
					makeReady: agentBinding.makeReady !== false,
				}
			: {}),
		// The authority ID is derived from a snapshot digest, so the browser
		// cannot compute it. A response that withholds Make must therefore name
		// the request the merchant has to decide, or the commit strip has no way
		// to record a decision before asking to start.
		...(withheldForConfirmation
			? { executionConfirmationRequestId: withheldForConfirmation }
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
