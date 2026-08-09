import {
	pickComposerSubmissionSignedFields,
	structuredDecisionInputSchema,
	type BuildProductQuoteInput,
	type PlanConfirmationDecision,
	type ResultAdjustTextSelectionScope,
	type StructuredDecisionInput,
} from "@meiye/contracts";

import { fingerprintValue } from "../job-runtime/job-contracts.js";
import { executionConfirmationRequestId } from "../harness/execution-confirmation-id.js";
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
	executionConfirmationContext?: HarnessWorkflowInput["executionConfirmationContext"];
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
	}): Promise<CreationSubmissionRecord>;
	saveRepricedExecutionPlanFreeze?(input: {
		workspaceId: string;
		submissionId: string;
		expectedFreeze: ExecutionPlanCompileFreeze | null;
		previousQuoteRef: { id: string; revision: string };
		freeze: ExecutionPlanCompileFreeze;
		successorQuote: BuildProductQuoteInput;
		credits: number;
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
	preparePendingConfirmation?(input: CreationSubmissionRecord): Promise<void>;
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
}

export interface ComposerExplicitConfirmationPort {
	getDecision(requestId: string): Promise<PlanConfirmationDecision | null>;
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
		const submission = await this.store.readByTask({
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
		const requestId = executionConfirmationRequestId(submission.task.id);
		const decision = await this.explicitConfirmations.getDecision(requestId);
		if (!decision || decision.decision !== "confirmed") {
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
		const submission = await this.store.readByTask({
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
			await this.store.saveRepricedExecutionPlanFreeze({
				workspaceId: input.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				...binding.repriceCommit,
			});
		} else {
			await this.store.saveExecutionPlanFreeze({
				workspaceId: input.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				quoteRef: submission.snapshot.quote,
				credits: submission.usageReservation.credits,
			});
		}
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
		const submission = await this.store.readByTask({
			workspaceId: input.workspaceId,
			taskId: input.taskId,
		});
		if (!submission) throw new Error("Prepared Composer task was not found.");
		if (submission.executionPlanFreeze) {
			throw new Error("Composer clarification is already resolved.");
		}
		const binding = await this.agentPlanning.answerClarification({
			submission,
			merchantAnswer: input.merchantAnswer,
		});
		if (!submission.executionPlanFreeze) return binding;
		if (binding.repriceCommit) {
			if (!this.store.saveRepricedExecutionPlanFreeze) {
				throw new Error("Atomic Composer clarification reprice persistence is unavailable.");
			}
			await this.store.saveRepricedExecutionPlanFreeze({
				workspaceId: input.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				...binding.repriceCommit,
			});
			await this.preparePendingConfirmation(submission);
			return { threadId: binding.threadId, runId: binding.runId, makeReady: binding.makeReady };
		}
		await this.store.saveExecutionPlanFreeze({
			workspaceId: input.workspaceId,
			submissionId: submission.snapshot.id,
			freeze: submission.executionPlanFreeze,
			quoteRef: submission.snapshot.quote,
			credits: submission.usageReservation.credits,
		});
		await this.preparePendingConfirmation(submission);
		return binding;
	}

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
			const agentBinding = await this.prepareAgentPlan(
				receipt.submission,
				request.agentThreadId
			);
			if (agentBinding?.makeReady !== false) {
				await this.startHarness(receipt.submission);
			} else {
				await this.preparePendingConfirmation(receipt.submission);
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
		const agentBinding = await this.prepareAgentPlan(
			claimed.submission,
			request.agentThreadId
		);
		if (agentBinding?.makeReady !== false) {
			await this.startHarness(claimed.submission);
		} else {
			await this.preparePendingConfirmation(claimed.submission);
		}
		return submissionResponse(
			claimed.submission,
			claimed.kind === "existing",
			agentBinding
		);
	}

	private async preparePendingConfirmation(submission: CreationSubmissionRecord) {
		if (!submission.executionPlanFreeze) return;
		if (!this.harness.preparePendingConfirmation) {
			throw new Error("Pending Harness confirmation preparation is unavailable.");
		}
		await this.harness.preparePendingConfirmation(submission);
	}

	private async prepareAgentPlan(
		submission: CreationSubmissionRecord,
		continuationThreadId?: string
	): Promise<ComposerAgentBinding | undefined> {
		if (!this.agentPlanning) return Promise.resolve(undefined);
		const binding = await this.agentPlanning.prepare({
			...(continuationThreadId ? { continuationThreadId } : {}),
			submission,
		});
		if (submission.executionPlanFreeze) {
			const persisted = await this.store.saveExecutionPlanFreeze({
				workspaceId: submission.snapshot.workspaceId,
				submissionId: submission.snapshot.id,
				freeze: submission.executionPlanFreeze,
				quoteRef: submission.snapshot.quote,
				credits: submission.usageReservation.credits,
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
		const recoverable = (
			await this.store.listRecoverableHarnessStarts({ limit })
		).filter(
			(candidate) =>
				candidate.submission.executionPlanFreeze?.approvalBasis !==
				"merchant_confirmed",
		);
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
