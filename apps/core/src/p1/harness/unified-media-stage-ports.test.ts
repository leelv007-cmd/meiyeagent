import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	contentPackageCarrierOf,
	IMAGE_INTENT_SLOT_KINDS,
	type ModelCapabilityProfile,
} from "@meiye/contracts";
import {
	AgentPrimitiveObservabilityAdapter,
	MemoryObservabilityEventAudit,
} from "../creation-experience/index.js";
import {
	type ContentPackageRevisionWriteInput,
	MemoryContentPackageRevisionWritePort,
} from "../execution-spine/content-package-revision-port.js";
import {
	createCreationExecutionSnapshot,
	creationExecutionSnapshotSchema,
} from "../execution-spine/creation-execution-snapshot.js";
import {
	fingerprintValue,
	JobRuntimeError,
} from "../job-runtime/job-contracts.js";
import {
	createDefaultCatalogModels,
	createDefaultDeployments,
	MemoryModelAssetStorage,
	ModelSupplyApplicationService,
	type ModelSupplyResult,
	type ModelSupplySubmission,
	RecordedAdapterRouter,
	type RouteSnapshot,
} from "../model-supply/index.js";
import { buildContentPackage } from "../operations/content-package.js";
import { ContentPackageRightsBasisResolver } from "../operations/content-package-rights-basis.js";
import { MemoryContextBundleRepository } from "../operations/context-bundle-repository.js";
import { MemoryMarketingIdentityRepository } from "../operations/marketing-identity.js";
import { MemoryStoreFactLedger } from "../operations/store-fact-ledger.js";
import {
	CapabilityHotAssemblyRegistry,
	projectCapabilityRevision,
	toRuntimeCapabilityEntry,
} from "../supply-registry/hot-assembly.js";
import { resumeWithRaisedServerLimit } from "./bounded-execution-controller.js";
import {
	assessImageExactText,
	HarnessSelectionError,
} from "./execution-selection.js";
import {
	HARNESS_BUILTIN_PROMPTS,
	HARNESS_LANGFUSE_PROMPT_NAMES,
	type HarnessFrozenPrompts,
	promptRevisionReferences,
} from "./langfuse-prompts.js";
import {
	mediaBoundedCurrentBestSchema,
	mediaBoundedRequestFingerprint,
} from "./media-bounded-execution.js";
import { merchantVisibleLanguageIssues } from "./merchant-delivery-language.js";
import type {
	NoteMediaAdmissionPort,
	NoteMediaAdmissionToken,
} from "./note-media-admission.js";
import { unconfiguredNotePlanEnhancementJudgeResolver } from "./note-plan-structured-port.js";
import { LedgerBackedHarnessContextPort } from "./production-context-port.js";
import type { HarnessStructuredNodeRunnerFactory } from "./production-stage-ports.js";
import type {
	ExecutionBrief,
	IntentDeclaration,
	StructuredNodeRunnerRequest,
} from "./structured-nodes.js";
import type { HarnessWorkflowInput } from "./task-admission.js";
import {
	HarnessMediaExecutionError,
	type ImageExactTextVerifier,
	ModelSupplyHarnessMediaExecutionPort,
	ModelSupplyImageExactTextVerifier,
	UnifiedHarnessStagePorts,
} from "./unified-media-stage-ports.js";
import { composeViralAdaptRawInput } from "./viral-adapt.js";
import type {
	HarnessContextSnapshot,
	HarnessStagePorts,
} from "./workflow-core.js";

test("unified stages forward bounded copy selection to the production copy port", async () => {
	const copy = unsupportedCopyPorts();
	const input = {
		workflowId: "workflow-copy-bounded",
	} as Parameters<NonNullable<HarnessStagePorts["executeAndSelectBounded"]>>[0];
	let forwarded:
		| Parameters<NonNullable<HarnessStagePorts["executeAndSelectBounded"]>>[0]
		| undefined;
	const skillInput = {
		workflowId: "workflow-copy-bounded",
		stage: "execution_selection",
	} as Parameters<NonNullable<HarnessStagePorts["resolveStageSkills"]>>[0];
	let forwardedSkillInput:
		| Parameters<NonNullable<HarnessStagePorts["resolveStageSkills"]>>[0]
		| undefined;
	copy.executeAndSelectBounded = async (received) => {
		forwarded = received;
		return {
			state: "suspended",
			snapshot: {
				schemaVersion: "bounded-execution-snapshot/v1",
				maxIterations: 1,
				maxCostCents: "unset",
				maxWallClockMs: "unset",
				maxDelegations: "unset",
				requiredLimits: ["maxIterations"],
				consumption: {
					iterations: 1,
					costCents: 0,
					wallClockMs: 0,
					delegations: 0,
				},
				stopReason: "limit_reached",
				triggeredLimit: "maxIterations",
			},
			currentBest: null,
			unmetExplanation: "needs another iteration",
			resumable: true,
		};
	};
	copy.resolveStageSkills = async (received) => {
		forwardedSkillInput = received;
		return { instructions: [], receipts: [] };
	};
	const ports = new UnifiedHarnessStagePorts(
		copy,
		undefined as never,
		undefined as never,
		undefined as never,
		() => "2026-07-29T00:00:00.000Z",
	);

	await ports.executeAndSelectBounded(input);
	await ports.resolveStageSkills(skillInput);

	assert.equal(forwarded, input);
	assert.equal(forwardedSkillInput, skillInput);
});

test("bounded media submits once with the same authorization and resumes through the durable job", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const result = completedResult("image");
	const { latencyMs: _latencyMs, ...resultWithoutLatency } = result;
	let durableReads = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit(input) {
			submissions.push(structuredClone(input));
			return {
				...resultWithoutLatency,
				status: "unknown",
				asset: undefined,
			};
		},
		async getDurableMediaJob(workspaceId, jobId) {
			assert.equal(workspaceId, "workspace-1");
			assert.equal(jobId, result.jobId);
			durableReads += 1;
			return {
				result: resultWithoutLatency,
				providerLifecycleLatencyMs: 25,
			};
		},
	});
	const request = {
		...harnessInput("image", "package-image-bounded"),
		boundedExecution: boundedExecutionSnapshot(0, 1),
	};
	const first = await adapter.executeBounded({
		brief: mediaBrief("image"),
		context: contextSnapshot(),
		request,
		workflowId: "workflow-image-bounded",
	});
	if (!("state" in first)) {
		assert.fail("The first bounded media attempt should suspend.");
	}
	assert.equal(first.state, "suspended");
	assert.equal(submissions.length, 1);
	assert.deepEqual(submissions[0]?.mediaBoundedExecution, {
		schemaVersion: "media-bounded-execution/v1",
		snapshot: request.boundedExecution,
		countedAttemptIds: [],
		countedProviderCostIds: [],
	});
	const raised = resumeWithRaisedServerLimit(first.snapshot, {
		limit: "maxIterations",
		value: 2,
	});
	const resumed = await adapter.executeBounded({
		brief: mediaBrief("image"),
		context: contextSnapshot(),
		request: { ...request, boundedExecution: raised },
		workflowId: "workflow-image-bounded",
		boundedResume: first,
	});
	assert.equal("state" in resumed, false);
	assert.equal(submissions.length, 1);
	assert.equal(durableReads, 2);
	if ("state" in resumed) {
		assert.fail("Raised media bound should deliver the durable result.");
	}
	assert.equal(resumed.boundedExecution?.consumption.iterations, 1);
	assert.equal(resumed.boundedExecution?.consumption.costCents, 120);
	assert.ok((resumed.boundedExecution?.consumption.wallClockMs ?? -1) >= 25);
	assert.equal(resumed.boundedExecution?.consumption.delegations, 0);
	assert.equal(resumed.asset.id, "image-asset-1");
});

test("bounded media rejects a forged checkpoint before durable provider I/O", async () => {
	let submissions = 0;
	let durableReads = 0;
	const completed = completedResult("image");
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			submissions += 1;
			return completed;
		},
		async getDurableMediaJob() {
			durableReads += 1;
			return { result: completed };
		},
	});
	const request = {
		...harnessInput("image", "package-image-forged-checkpoint"),
		boundedExecution: boundedExecutionSnapshot(0, 1),
	};
	const first = await adapter.executeBounded({
		brief: mediaBrief("image"),
		context: contextSnapshot(),
		request,
		workflowId: "workflow-image-forged-checkpoint",
	});
	if (!("state" in first)) assert.fail("Primary attempt should suspend.");
	const raised = resumeWithRaisedServerLimit(first.snapshot, {
		limit: "maxIterations",
		value: 2,
	});
	await assert.rejects(
		adapter.executeBounded({
			brief: mediaBrief("image"),
			context: contextSnapshot(),
			request: { ...request, boundedExecution: raised },
			workflowId: "workflow-image-forged-checkpoint",
			boundedResume: {
				...first,
				currentBest: {
					...first.currentBest,
					requestFingerprint: "f".repeat(64),
				},
			},
		}),
		/does not match the frozen request/u,
	);
	await assert.rejects(
		adapter.executeBounded({
			brief: mediaBrief("image"),
			context: contextSnapshot(),
			request: { ...request, boundedExecution: raised },
			workflowId: "workflow-image-forged-checkpoint",
			boundedResume: {
				...first,
				currentBest: {
					...first.currentBest,
					kind: "video",
				},
			},
		}),
		/kind does not match the frozen request/u,
	);
	assert.equal(submissions, 1);
	assert.equal(durableReads, 0);
});

test("a bounded context-fence effect keeps receipt digests and uses a revision-stable key", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const completed = completedResult("image");
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit(input) {
			submissions.push(structuredClone(input));
			if (submissions.length === 3) {
				const changedCost = { ...completed.providerCost, amount: 2.4 };
				return {
					...completed,
					providerCost: changedCost,
					providerCosts: [changedCost],
				};
			}
			return completed;
		},
	});
	const request = {
		...harnessInput("image", "package-image-bounded-fence"),
		boundedExecution: boundedExecutionSnapshot(0, 5),
	};
	const first = await adapter.executeBounded({
		brief: mediaBrief("image"),
		context: contextSnapshot(),
		request,
		workflowId: "workflow-image-bounded-fence",
	});
	if ("state" in first) assert.fail("The first effect should continue.");
	const fencedContext = contextSnapshot();
	fencedContext.bundle = {
		...fencedContext.bundle,
		revision: 2,
		hash: "b".repeat(64),
		previousRevision: 1,
	};
	const second = await adapter.executeBounded({
		brief: mediaBrief("image"),
		context: fencedContext,
		request: {
			...request,
			boundedExecution: first.boundedExecution,
		},
		workflowId: "workflow-image-bounded-fence",
		boundedCheckpoint: first.boundedCurrentBest,
	});
	if ("state" in second) assert.fail("The fenced effect should continue.");
	assert.deepEqual(
		submissions.map(({ idempotencyKey }) => idempotencyKey),
		[
			"harness-media:workflow-image-bounded-fence:image",
			"harness-media:workflow-image-bounded-fence:image:r2",
		],
	);
	assert.equal(second.boundedExecution?.consumption.iterations, 1);
	assert.equal(second.boundedExecution?.consumption.costCents, 120);
	assert.deepEqual(
		submissions[1]?.mediaBoundedExecution?.countedProviderCostIds,
		["cost-image-1"],
	);
	const changedContext = {
		...fencedContext,
		bundle: {
			...fencedContext.bundle,
			revision: 3,
			hash: "c".repeat(64),
			previousRevision: 2,
		},
	};
	await assert.rejects(
		adapter.executeBounded({
			brief: mediaBrief("image"),
			context: changedContext,
			request: {
				...request,
				boundedExecution: second.boundedExecution,
			},
			workflowId: "workflow-image-bounded-fence",
			boundedCheckpoint: second.boundedCurrentBest,
		}),
		/receipt facts cannot change/u,
	);
});

test("an exhausted media bound suspends before the first provider submit", async () => {
	let submissions = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			submissions += 1;
			return completedResult("video");
		},
	});
	const request = {
		...harnessInput("video", "package-video-exhausted"),
		boundedExecution: boundedExecutionSnapshot(0, 0),
	};
	const result = await adapter.executeBounded({
		brief: mediaBrief("video"),
		context: contextSnapshot(),
		request,
		workflowId: "workflow-video-exhausted",
	});
	if (!("state" in result)) {
		assert.fail("An exhausted media bound should suspend.");
	}
	assert.equal(result.state, "suspended");
	assert.equal(result.currentBest.phase, "before_submit");
	assert.equal(submissions, 0);
});

test("top-level bounded media execution turns Model Supply fallback exhaustion into a resumable checkpoint", async () => {
	let submissions = 0;
	let durableReads = 0;
	let resumes = 0;
	const completed = completedResult("image");
	const rejectedAttempt = {
		...completed.attempt,
		acceptance: "rejected_before_accept" as const,
		status: "failed" as const,
	};
	const estimatedCost = {
		...completed.providerCost,
		id: `${completed.providerCost.id}-estimated`,
		status: "estimated" as const,
		amount: 0,
		usage: {},
	};
	const suspendedResult: ModelSupplyResult & {
		boundedExecution: unknown;
	} = {
		...completed,
		asset: undefined,
		attempt: rejectedAttempt,
		attempts: [rejectedAttempt],
		boundedExecution: {
			schemaVersion: "media-bounded-execution-result/v1",
			snapshot: {
				...boundedExecutionSnapshot(1, 1),
				consumption: {
					iterations: 1,
					costCents: 0,
					wallClockMs: 0,
					delegations: 0,
				},
				stopReason: "limit_reached",
				triggeredLimit: "maxIterations",
			},
			triggeredLimit: "maxIterations",
			consumption: {
				iterations: 1,
				costCents: 0,
				wallClockMs: 0,
				delegations: 0,
			},
			consumedAttemptIds: [rejectedAttempt.id],
			consumedProviderCostIds: [],
		},
		failureCode: "MEDIA_BOUNDED_ITERATION_EXCEEDED",
		providerCost: estimatedCost,
		providerCosts: [estimatedCost],
		status: "failed",
	};
	const fallback = completedResult("image", "fallback");
	const completedAfterRaise = {
		...fallback,
		jobId: suspendedResult.jobId,
		latencyMs: 40,
		attempts: [rejectedAttempt, fallback.attempt],
		providerCosts: [estimatedCost, fallback.providerCost],
	};
	const { latencyMs: _providerLifecycleLatency, ...durableSuspendedResult } =
		suspendedResult;
	let durableResult = durableSuspendedResult;
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			submissions += 1;
			return {
				...suspendedResult,
				asset: undefined,
				status: "unknown" as const,
			};
		},
		async getDurableMediaJob(workspaceId, jobId) {
			assert.equal(workspaceId, "workspace-1");
			assert.equal(jobId, suspendedResult.jobId);
			durableReads += 1;
			return {
				result: durableResult,
				providerLifecycleLatencyMs: 25,
			};
		},
		async resumeBoundedMediaJob(input) {
			assert.equal(input.jobId, suspendedResult.jobId);
			assert.equal(input.authorization.snapshot.maxIterations, 3);
			assert.deepEqual(input.authorization.countedAttemptIds, [
				rejectedAttempt.id,
			]);
			resumes += 1;
			return { result: completedAfterRaise };
		},
	});
	const request = {
		...harnessInput("image", "package-image-fallback-bound"),
		boundedExecution: boundedExecutionSnapshot(0, 1),
	};
	const first = await adapter.executeBounded({
		brief: mediaBrief("image"),
		context: contextSnapshot(),
		request,
		workflowId: "workflow-image-fallback-bound",
	});
	if (!("state" in first)) {
		assert.fail("Model Supply fallback exhaustion must suspend.");
	}
	assert.equal(first.state, "suspended");
	assert.equal(first.currentBest.phase, "provider_route_suspended");
	assert.equal(first.currentBest.providerRoute?.jobId, suspendedResult.jobId);
	assert.equal(first.currentBest.providerRoute?.lifecycleBaselineMs, 25);
	assert.equal(first.snapshot.triggeredLimit, "maxIterations");
	assert.equal(first.snapshot.consumption.iterations, 1);
	assert.equal(first.snapshot.consumption.wallClockMs, 25);
	assert.equal(submissions, 1);
	assert.equal(durableReads, 1);

	const raised = resumeWithRaisedServerLimit(first.snapshot, {
		limit: "maxIterations",
		value: 3,
	});
	const tamperedCheckpoint = {
		...first,
		currentBest: {
			...first.currentBest,
			providerRoute: {
				...first.currentBest.providerRoute!,
				resultDigest: "0".repeat(64),
			},
		},
	};
	await assert.rejects(
		adapter.executeBounded({
			brief: mediaBrief("image"),
			context: contextSnapshot(),
			request: { ...request, boundedExecution: raised },
			workflowId: "workflow-image-fallback-bound",
			boundedResume: tamperedCheckpoint,
		}),
		/digest|checkpoint/iu,
	);
	assert.equal(resumes, 0);

	const { endedAt: _forgedTerminalTime, ...forgedCanonicalResult } =
		durableSuspendedResult;
	const forgedBaselineCheckpoint = {
		...first,
		currentBest: {
			...first.currentBest,
			providerRoute: {
				...first.currentBest.providerRoute!,
				lifecycleBaselineMs: 24,
				resultDigest: mediaBoundedRequestFingerprint({
					result: forgedCanonicalResult,
					lifecycleBaselineMs: 24,
				}),
			},
		},
	};
	await assert.rejects(
		adapter.executeBounded({
			brief: mediaBrief("image"),
			context: contextSnapshot(),
			request: { ...request, boundedExecution: raised },
			workflowId: "workflow-image-fallback-bound",
			boundedResume: forgedBaselineCheckpoint,
		}),
		/lifecycle|checkpoint/iu,
	);
	assert.equal(resumes, 0);

	durableResult = {
		...durableSuspendedResult,
		retryable: true,
	};
	await assert.rejects(
		adapter.executeBounded({
			brief: mediaBrief("image"),
			context: contextSnapshot(),
			request: { ...request, boundedExecution: raised },
			workflowId: "workflow-image-fallback-bound",
			boundedResume: first,
		}),
		/digest|checkpoint/iu,
	);
	assert.equal(resumes, 0);
	durableResult = durableSuspendedResult;

	const resumed = await adapter.executeBounded({
		brief: mediaBrief("image"),
		context: contextSnapshot(),
		request: { ...request, boundedExecution: raised },
		workflowId: "workflow-image-fallback-bound",
		boundedResume: first,
	});
	if ("state" in resumed) assert.fail("The raised route should complete.");
	assert.equal(resumed.asset.id, fallback.asset?.id);
	assert.equal(resumed.boundedExecution?.consumption.iterations, 2);
	assert.equal(resumed.boundedExecution?.consumption.wallClockMs, 40);
	assert.equal(submissions, 1);
	assert.equal(resumes, 1);
	assert.equal(durableReads, 5);
});

test("bounded media rejects unobserved, non-CNY, and missing-usage cost before another submit", async () => {
	for (const invalidCost of [
		{ status: "estimated" as const },
		{ currency: "USD" as const },
		{ usage: {} },
	]) {
		let submissions = 0;
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				submissions += 1;
				const completed = completedResult("image");
				const providerCost = {
					...completed.providerCost,
					...invalidCost,
				};
				return {
					...completed,
					providerCost,
					providerCosts: [providerCost],
				} as ModelSupplyResult;
			},
		});
		const request = {
			...harnessInput("image", "package-image-invalid-cost"),
			boundedExecution: boundedExecutionSnapshot(0, 2),
		};
		await assert.rejects(
			adapter.executeBounded({
				brief: mediaBrief("image"),
				context: contextSnapshot(),
				request,
				workflowId: "workflow-image-invalid-cost",
			}),
			/observed provider cost(?: receipt for every new attempt| in CNY with usage)/u,
		);
		assert.equal(submissions, 1);
	}
});

test("bounded media ignores provisional estimates and converts observed CNY decimals exactly", async () => {
	for (const [amount, expectedCents] of [
		[0.07, 7],
		[1.1, 110],
	] as const) {
		const completed = completedResult("video");
		const estimated = {
			...completed.providerCost,
			id: `${completed.providerCost.id}-estimated`,
			status: "estimated" as const,
			amount: 0,
			usage: {},
		};
		const observed = {
			...completed.providerCost,
			id: `${completed.providerCost.id}-observed`,
			amount,
		};
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				return {
					...completed,
					providerCost: observed,
					providerCosts: [estimated, observed],
				};
			},
		});
		const selected = await adapter.executeBounded({
			brief: mediaBrief("video"),
			context: contextSnapshot(),
			request: {
				...harnessInput("video", `package-video-cost-${expectedCents}`),
				boundedExecution: {
					...boundedExecutionSnapshot(0, 2),
					maxCostCents: expectedCents + 1,
				},
			},
			workflowId: `workflow-video-cost-${expectedCents}`,
		});

		assert.equal("state" in selected, false);
		if ("state" in selected)
			assert.fail("Observed cost remains below the bound.");
		assert.equal(
			selected.boundedExecution?.consumption.costCents,
			expectedCents,
		);
		assert.equal(
			mediaBoundedCurrentBestSchema.parse(selected.boundedCurrentBest)
				.countedProviderCostIds.length,
			1,
		);
	}
});

test("bounded media counts a model-backed exact-text verification and replays it without another call", async () => {
	const primary = completedResult("image", "primary");
	const verifierResult = {
		...completedResult("image", "verifier"),
		asset: undefined,
		operation: "text.respond" as const,
		text: JSON.stringify({
			observedText: ["价格 398"],
			conflictingText: [],
		}),
	};
	let submissions = 0;
	let routeFreezes = 0;
	let verifications = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				return primary;
			},
			async getDurableMediaJob() {
				return { result: primary };
			},
			async freezeAutoTextRouteForExecution() {
				routeFreezes += 1;
				return approvedExactTextRoute();
			},
		},
		{
			preauthorize() {
				return { iterations: 1, costCents: 120 };
			},
			async observe(input) {
				verifications += 1;
				return {
					expected: input.expected,
					observed: ["价格 398"],
					conflictingText: [],
					modelResult: verifierResult,
				};
			},
		},
	);
	const request = {
		...harnessInput("image", "package-image-bounded-verifier"),
		boundedExecution: boundedExecutionSnapshot(0, 2),
	};
	const first = await adapter.executeBounded({
		brief: imageBriefWithExactText("价格 398"),
		context: contextSnapshot(),
		request,
		workflowId: "workflow-image-bounded-verifier",
	});
	if (!("state" in first)) {
		assert.fail("The verifier should consume the second bounded iteration.");
	}
	assert.equal(first.currentBest.phase, "ready");
	assert.equal(first.snapshot.consumption.iterations, 2);
	assert.deepEqual(
		first.currentBest.exactTextRoute?.snapshot,
		approvedExactTextRoute(),
	);
	assert.deepEqual(first.currentBest.countedAttemptIds, [
		"attempt-image-primary",
		"attempt-image-verifier",
	]);

	const raised = resumeWithRaisedServerLimit(first.snapshot, {
		limit: "maxIterations",
		value: 3,
	});
	await assert.rejects(
		adapter.executeBounded({
			brief: imageBriefWithExactText("价格 398"),
			context: contextSnapshot(),
			request: { ...request, boundedExecution: raised },
			workflowId: "workflow-image-bounded-verifier",
			boundedResume: {
				...first,
				currentBest: {
					...first.currentBest,
					exactTextRoute: {
						...first.currentBest.exactTextRoute!,
						snapshot: {
							...first.currentBest.exactTextRoute!.snapshot,
							createdAt: "2026-07-29T00:00:01.000Z",
						},
					},
				},
			},
		}),
		/route digest does not match/u,
	);
	const resumed = await adapter.executeBounded({
		brief: imageBriefWithExactText("价格 398"),
		context: contextSnapshot(),
		request: { ...request, boundedExecution: raised },
		workflowId: "workflow-image-bounded-verifier",
		boundedResume: first,
	});
	if ("state" in resumed) assert.fail("The ready checkpoint should replay.");
	assert.equal(submissions, 1);
	assert.equal(routeFreezes, 1);
	assert.equal(verifications, 1);
	assert.equal(resumed.boundedExecution?.consumption.iterations, 2);
});

test("bounded media rejects an unaffordable exact-text verification before text.respond", async () => {
	const primary = completedResult("image", "primary-cost-gate");
	let routeFreezes = 0;
	let verifications = 0;
	const exactText = {
		preauthorize() {
			return {
				iterations: 1,
				costCents: 120,
			};
		},
		async observe(input: { expected: string[] }) {
			verifications += 1;
			return {
				expected: input.expected,
				observed: [...input.expected],
				conflictingText: [],
			};
		},
	};
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				return primary;
			},
			async freezeAutoTextRouteForExecution() {
				routeFreezes += 1;
				return approvedExactTextRoute();
			},
		},
		exactText,
	);

	await assert.rejects(
		adapter.executeBounded({
			brief: imageBriefWithExactText("价格 398"),
			context: contextSnapshot(),
			request: {
				...harnessInput("image", "package-image-exact-text-cost-gate"),
				boundedExecution: {
					...boundedExecutionSnapshot(0, 3),
					maxCostCents: 200,
				},
			},
			workflowId: "workflow-image-exact-text-cost-gate",
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "MEDIA_EXACT_TEXT_BUDGET_UNAVAILABLE" &&
			/remaining bounded cost/u.test(error.message),
	);
	assert.equal(routeFreezes, 1);
	assert.equal(verifications, 0);
});

test("bounded exact-text retry keeps its stable key and never resubmits the primary job", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const results = [
		completedResult("image", "1"),
		completedResult("image", "2"),
	];
	const durable = new Map(results.map((result) => [result.jobId, result]));
	let verification = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit(input) {
				submissions.push(structuredClone(input));
				return results[submissions.length - 1]!;
			},
			async getDurableMediaJob(_workspaceId, jobId) {
				return { result: durable.get(jobId)! };
			},
			async freezeAutoTextRouteForExecution() {
				return approvedExactTextRoute();
			},
		},
		{
			preauthorize() {
				return { iterations: 0, costCents: 0 };
			},
			async observe(input) {
				verification += 1;
				return verification === 1
					? {
							expected: input.expected,
							observed: ["价格 389"],
							conflictingText: [],
						}
					: {
							expected: input.expected,
							observed: ["价格 398"],
							conflictingText: [],
						};
			},
		},
	);
	const request = {
		...harnessInput("image", "package-image-bounded-exact"),
		boundedExecution: boundedExecutionSnapshot(0, 1),
	};
	const first = await adapter.executeBounded({
		brief: imageBriefWithExactText("价格 398"),
		context: contextSnapshot(),
		request,
		workflowId: "workflow-image-bounded-exact",
	});
	if (!("state" in first)) assert.fail("Primary attempt should suspend.");
	assert.equal(first.currentBest.phase, "verify_primary");

	const secondSnapshot = resumeWithRaisedServerLimit(first.snapshot, {
		limit: "maxIterations",
		value: 2,
	});
	const second = await adapter.executeBounded({
		brief: imageBriefWithExactText("价格 398"),
		context: contextSnapshot(),
		request: { ...request, boundedExecution: secondSnapshot },
		workflowId: "workflow-image-bounded-exact",
		boundedResume: first,
	});
	if (!("state" in second)) assert.fail("Exact-text retry should suspend.");
	assert.deepEqual(
		submissions.map(({ idempotencyKey }) => idempotencyKey),
		[
			"harness-media:workflow-image-bounded-exact:image",
			"harness-media:workflow-image-bounded-exact:image:exact-text-retry",
		],
	);
	assert.deepEqual(submissions[1]?.mediaBoundedExecution?.countedAttemptIds, [
		"attempt-image-1",
	]);
	assert.deepEqual(
		submissions[1]?.mediaBoundedExecution?.countedProviderCostIds,
		["cost-image-1"],
	);

	const finalSnapshot = resumeWithRaisedServerLimit(second.snapshot, {
		limit: "maxIterations",
		value: 3,
	});
	const final = await adapter.executeBounded({
		brief: imageBriefWithExactText("价格 398"),
		context: contextSnapshot(),
		request: { ...request, boundedExecution: finalSnapshot },
		workflowId: "workflow-image-bounded-exact",
		boundedResume: second,
	});
	if ("state" in final) assert.fail("Raised retry bound should deliver.");
	assert.equal(submissions.length, 2);
	assert.equal(final.asset.id, "image-asset-2");
	assert.equal(final.childRun.providerAttempts?.length, 2);
	assert.equal(final.childRun.providerCosts?.length, 2);
});

test("bounded exact-text retry must pass verification before a limit suspension can become ready", async () => {
	const results = [
		completedResult("image", "1"),
		completedResult("image", "2"),
	];
	let submissions = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				const result = results[submissions]!;
				submissions += 1;
				return result;
			},
			async getDurableMediaJob(_workspaceId, jobId) {
				return { result: results.find((result) => result.jobId === jobId)! };
			},
			async freezeAutoTextRouteForExecution() {
				return approvedExactTextRoute();
			},
		},
		{
			preauthorize() {
				return { iterations: 0, costCents: 0 };
			},
			async observe(input) {
				return {
					expected: input.expected,
					observed: ["价格 389"],
					conflictingText: [],
				};
			},
		},
	);
	const request = {
		...harnessInput("image", "package-image-bounded-exact-fail"),
		boundedExecution: boundedExecutionSnapshot(0, 1),
	};
	const first = await adapter.executeBounded({
		brief: imageBriefWithExactText("价格 398"),
		context: contextSnapshot(),
		request,
		workflowId: "workflow-image-bounded-exact-fail",
	});
	if (!("state" in first)) assert.fail("Primary attempt should suspend.");
	const raised = resumeWithRaisedServerLimit(first.snapshot, {
		limit: "maxIterations",
		value: 2,
	});
	const second = await adapter.executeBounded({
		brief: imageBriefWithExactText("价格 398"),
		context: contextSnapshot(),
		request: { ...request, boundedExecution: raised },
		workflowId: "workflow-image-bounded-exact-fail",
		boundedResume: first,
	});
	if (!("state" in second)) {
		assert.fail("A limit reached by the retry must suspend before its gate.");
	}
	assert.equal(second.currentBest.phase, "verify_retry");
	const finalSnapshot = resumeWithRaisedServerLimit(second.snapshot, {
		limit: "maxIterations",
		value: 3,
	});
	await assert.rejects(
		adapter.executeBounded({
			brief: imageBriefWithExactText("价格 398"),
			context: contextSnapshot(),
			request: { ...request, boundedExecution: finalSnapshot },
			workflowId: "workflow-image-bounded-exact-fail",
			boundedResume: second,
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("image_exact_text"),
	);
	assert.equal(submissions, 2);
});

test("image and video use the existing Model Supply path with stable submission facts", async () => {
	for (const kind of ["image", "video"] as const) {
		const submissions: ModelSupplySubmission[] = [];
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult(kind);
			},
		});
		const request = harnessInput(kind, `package-${kind}`);
		const selection = await adapter.execute({
			brief: mediaBrief(kind),
			context: contextSnapshot(),
			request,
			workflowId: `workflow-${kind}`,
		});

		assert.deepEqual(submissions, [
			{
				actorId: "owner-1",
				billingQuoteRevision: "quote-r1",
				billingTaskId: `task-${kind}`,
				correlationId: `workflow-${kind}`,
				dataClass: [],
				frozenRouteSnapshot: request.frozenRouteSnapshot,
				idempotencyKey: `harness-media:workflow-${kind}:${kind}`,
				input:
					kind === "image"
						? {
								inputAssets: [
									{
										assetId: "asset-1",
										imageSlot: "work_case",
										nativeField: "image",
										role: "reference_image",
									},
								],
								ratio: "9:16",
								resolution: "1080p",
							}
						: {
								durationSeconds: 8,
								ratio: "9:16",
								referenceAssetIds: ["asset-1"],
							},
				operation: kind === "image" ? "image.edit" : "video.generate",
				productUsageQuantity: 0,
				prompt:
					kind === "image"
						? `${mediaBrief(kind).prompt}\n${JSON.stringify({
								imageIntent: mediaBrief(kind).intent,
								imageModelRecipeProfile: {
									id: "seedream-image-v1",
									revision: "seedream-image-v1-r1",
								},
							})}`
						: `${mediaBrief(kind).firstFramePrompt}\n1. ${mediaBrief(kind).storyboard[0]?.description}`,
				selection: { catalogModelId: `model-${kind}-1`, mode: "fixed" },
				workspaceId: "workspace-1",
			},
		]);
		assert.equal(selection.kind, kind);
		assert.equal(selection.asset.id, `${kind}-asset-1`);
		assert.equal(selection.childRun.productUsage?.status, "committed");
		assert.equal(selection.childRun.providerAttempts?.length, 1);
		assert.equal(selection.childRun.providerCosts?.length, 1);
		assert.equal(
			selection.measuredDurationSeconds,
			kind === "video" ? 8 : undefined,
		);
	}
});

test("a legacy media request without execution assembly cannot submit generation", async () => {
	let submissions = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		undefined as never,
		new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				submissions += 1;
				return completedResult("image");
			},
		}),
		new MemoryContentPackageRevisionWritePort(),
		() => "2026-07-29T00:00:00.000Z",
	);

	await assert.rejects(
		() =>
			ports.executeMediaAndSelect({
				brief: mediaBrief("image"),
				context: contextSnapshot(),
				request: harnessInput("image", "package-legacy-media"),
				workflowId: "task-legacy-media",
			}),
		/execution assembly is required before provider execution/i,
	);
	assert.equal(submissions, 0);
});

test("a succeeded audit failure does not rewrite successful media generation as rejected", async () => {
	const phases: string[] = [];
	const observer = new AgentPrimitiveObservabilityAdapter(
		{
			append(_workspaceId, event) {
				assert.equal(event.eventType, "agent_primitive.lifecycle");
				if (event.eventType !== "agent_primitive.lifecycle") {
					throw new Error("Expected agent primitive lifecycle event.");
				}
				phases.push(event.payload.phase);
				if (event.payload.phase === "succeeded") {
					throw new Error("terminal media audit unavailable");
				}
				return event;
			},
		},
		{ resolve: () => ({ kind: "not_billed" }) },
	);
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		undefined as never,
		new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				return completedResult("image");
			},
		}),
		new MemoryContentPackageRevisionWritePort(),
		() => "2026-07-29T00:00:00.000Z",
		undefined,
		undefined,
		{
			create() {
				return observer;
			},
		},
	);

	await assert.rejects(
		() =>
			ports.executeMediaAndSelect({
				brief: imageBriefFor("image.generate", 0),
				context: contextSnapshot(),
				request: harnessInputWithExecutionAssembly(
					"image",
					"package-media-audit-failure",
					"image.generate",
					0,
				),
				workflowId: "task-image",
			}),
		/terminal media audit unavailable/u,
	);
	assert.deepEqual(phases, ["invoked", "succeeded"]);
});

test("a legacy media request without execution assembly cannot compile a structured brief", async () => {
	let providerRuns = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				return {
					async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
						providerRuns += 1;
						return {
							output: request.schema.parse(mediaBrief("image")),
							attempts: 1,
							providerTaskRef: "legacy-brief-provider",
							replayed: false,
							usage: { inputTokens: 1, outputTokens: 1 },
						};
					},
				};
			},
		},
		undefined as never,
		new MemoryContentPackageRevisionWritePort(),
		() => "2026-07-29T00:00:00.000Z",
	);

	await assert.rejects(
		() =>
			ports.compileMediaBrief({
				workflowId: "task-legacy-brief",
				request: harnessInput("image", "package-legacy-brief"),
				declaration: {
					normalizedIntent: "制作护理项目配图",
					taskType: "daily_service_exposure",
					deliveryLayer: "finished_media",
					relevantAssetCategories: ["product_service"],
					usedAssetCategories: ["product_service"],
					route: "customized",
					routingSource: "model",
					implicitConstraints: [],
				},
				context: contextSnapshot(),
			}),
		/execution assembly is required before provider execution/i,
	);
	assert.equal(providerRuns, 0);
});

test("unified structured generation revalidates execution assembly before every provider attempt", async () => {
	const request = harnessInputWithExecutionAssembly(
		"image",
		"package-assembly-attempt-fence",
		"image.generate",
		0,
	);
	let providerAttempts = 0;
	const observer = new AgentPrimitiveObservabilityAdapter(
		new MemoryObservabilityEventAudit(),
		{ resolve: () => ({ kind: "not_billed" }) },
	);
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				return {
					async run<Output>(structured: StructuredNodeRunnerRequest<Output>) {
						await structured.beforeProviderAttempt?.();
						providerAttempts += 1;
						request.frozenRouteSnapshot!.deploymentId =
							"deployment-drifted-after-first-attempt";
						await structured.beforeProviderAttempt?.();
						providerAttempts += 1;
						return {
							output: structured.schema.parse(
								imageBriefFor("image.generate", 0),
							),
							attempts: 2,
							providerTaskRef: "structured-two-attempts",
							replayed: false,
							usage: { inputTokens: 2, outputTokens: 2 },
						};
					},
				};
			},
		},
		undefined as never,
		new MemoryContentPackageRevisionWritePort(),
		() => "2026-07-29T00:00:00.000Z",
		undefined,
		undefined,
		{
			create() {
				return observer;
			},
		},
	);

	await assert.rejects(
		() =>
			ports.compileMediaBrief({
				workflowId: "task-assembly-attempt-fence",
				request,
				declaration: {
					normalizedIntent: "制作护理项目配图",
					taskType: "daily_service_exposure",
					deliveryLayer: "finished_media",
					relevantAssetCategories: ["product_service"],
					usedAssetCategories: ["product_service"],
					route: "customized",
					routingSource: "model",
					implicitConstraints: [],
				},
				context: contextSnapshot(),
			}),
		/assembly binding does not match the frozen route/i,
	);
	assert.equal(providerAttempts, 1);
});

test("media queue submission stops before the provider when durable rights are withdrawn", async () => {
	let submissions = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			submissions += 1;
			return completedResult("image");
		},
	});
	const context = contextSnapshot();
	context.policyReferences.rightsRefs = [
		{
			assetId: "asset-1",
			allowedUses: ["public_content"],
			status: "withdrawn",
			workspaceId: "workspace-1",
		},
	];

	await assert.rejects(
		adapter.execute({
			brief: mediaBrief("image"),
			context,
			request: harnessInput("image", "package-image-policy-bypass"),
			workflowId: "workflow-image-policy-bypass",
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("subject_asset_rights"),
	);
	assert.equal(submissions, 0);
});

test("media execution copies the frozen route data classes into the submission", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit(input) {
			submissions.push(structuredClone(input));
			return completedResult("image");
		},
	});
	const request = harnessInput(
		"image",
		"package-frozen-data-class",
		"image.generate",
		0,
	);
	const snapshot = request.executionSnapshot;
	assert.ok(snapshot);
	request.frozenRouteSnapshot = {
		...frozenMediaRoute(snapshot),
		dataClass: ["contains_face"],
	};

	await adapter.execute({
		brief: imageBriefFor("image.generate", 0),
		context: contextSnapshot(),
		request,
		workflowId: "task-image",
	});

	assert.deepEqual(submissions[0]?.dataClass, ["contains_face"]);
	assert.deepEqual(
		submissions[0]?.frozenRouteSnapshot,
		request.frozenRouteSnapshot,
	);
});

test("media execution rejects a request without its frozen route", async () => {
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			throw new Error(
				"A request without its route must not reach Model Supply.",
			);
		},
	});
	const request = harnessInput(
		"image",
		"package-missing-frozen-route",
		"image.generate",
		0,
	);
	delete request.frozenRouteSnapshot;

	await assert.rejects(
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "task-image",
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "MEDIA_SELECTION_MISSING" &&
			error.status === 409,
	);
});

test("three canonical image operations map to the two existing provider operations", async () => {
	for (const [operation, referenceCount, nativeOperation] of [
		["image.generate", 0, "image.generate"],
		["image.edit", 1, "image.edit"],
		["image.reference_transform", 2, "image.edit"],
	] as const) {
		const submissions: ModelSupplySubmission[] = [];
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult("image");
			},
		});
		await adapter.execute({
			brief: imageBriefFor(operation, referenceCount),
			context: contextSnapshot(
				Array.from(
					{ length: referenceCount },
					(_, index) => `asset-${index + 1}`,
				),
			),
			request: harnessInput(
				"image",
				`package-${operation}`,
				operation,
				referenceCount,
			),
			workflowId: `task-${operation}`,
		});

		assert.equal(submissions[0]?.operation, nativeOperation);
		assert.equal(submissions[0]?.input?.inputAssets?.length, referenceCount);
	}
});

test("image execution validates the selected recipe profile and preserves slot-native bindings", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const profile = {
		id: "seedream-profile",
		revision: "seedream-profile-r1",
		operationMappings: {
			"image.generate": "image.generate",
			"image.edit": "image.edit",
			"image.reference_transform": "image.edit",
		},
		slotRules: IMAGE_INTENT_SLOT_KINDS.map((slot) => ({
			slot,
			minItems: 0,
			maxItems: slot === "style_ref" ? 1 : 2,
			allowedMimeTypes: ["image/png"],
			maxBytesPerItem: 2_048,
			incompatibleWith: [],
			nativeField: "image",
		})),
	} as const;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult("image");
			},
		},
		undefined,
		undefined,
		profile,
	);

	await adapter.execute({
		brief: imageBriefFor("image.reference_transform", 2),
		context: contextSnapshot(["asset-1", "asset-2"]),
		request: harnessInput(
			"image",
			"package-reference-transform",
			"image.reference_transform",
			2,
		),
		workflowId: "task-reference-transform",
	});

	assert.deepEqual(submissions[0]?.input?.inputAssets, [
		{
			assetId: "asset-1",
			imageSlot: "style_ref",
			nativeField: "image",
			role: "reference_image",
		},
		{
			assetId: "asset-2",
			imageSlot: "composition_ref",
			nativeField: "image",
			role: "reference_image",
		},
	]);
	assert.equal(
		Object.hasOwn(submissions[0]?.input ?? {}, "referenceAssetIds"),
		false,
	);

	const invalidBrief = imageBriefFor("image.reference_transform", 2);
	invalidBrief.intent.references[1] = {
		...invalidBrief.intent.references[1]!,
		slot: "style_ref",
	};
	await assert.rejects(
		adapter.execute({
			brief: invalidBrief,
			context: contextSnapshot(["asset-1", "asset-2"]),
			request: harnessInput(
				"image",
				"package-profile-invalid",
				"image.reference_transform",
				2,
			),
			workflowId: "task-profile-invalid",
		}),
		/style_ref requires 0-1 references/u,
	);
	assert.equal(submissions.length, 1);

	const unfrozenReference = imageBriefFor("image.edit", 1);
	unfrozenReference.intent.references[0] = {
		...unfrozenReference.intent.references[0]!,
		assetId: "asset-outside-snapshot",
	};
	await assert.rejects(
		adapter.execute({
			brief: unfrozenReference,
			context: contextSnapshot(),
			request: harnessInput(
				"image",
				"package-unfrozen-reference",
				"image.edit",
				1,
			),
			workflowId: "task-unfrozen-reference",
		}),
		/image intent references do not match the frozen media brief/iu,
	);
	assert.equal(submissions.length, 1);
});

test("image-text note page generation uses the existing image executor without changing pure image semantics", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const noteRequest = {
		...harnessInput("image_text_note", "package-note"),
		boundedExecution: boundedExecutionSnapshot(0, 1),
	};
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit(input) {
				submissions.push(structuredClone(input));
				return completedResult("image");
			},
		},
		undefined,
		memoryNoteAdmission(),
	);

	const noteSelection = await adapter.execute({
		brief: imageBriefFor("image.generate", 0),
		context: contextSnapshot(),
		request: noteRequest,
		workflowId: "workflow-note:page-1",
	});
	const imageSelection = await adapter.execute({
		brief: imageBriefFor("image.edit", 1),
		context: contextSnapshot(),
		request: harnessInput("image", "package-image"),
		workflowId: "workflow-image",
	});

	assert.equal(noteSelection.kind, "image");
	assert.equal(submissions[0]?.operation, "image.generate");
	assert.deepEqual(submissions[0]?.mediaBoundedExecution, {
		schemaVersion: "media-bounded-execution/v1",
		snapshot: noteRequest.boundedExecution,
		countedAttemptIds: [],
		countedProviderCostIds: [],
	});
	assert.equal(Object.hasOwn(submissions[0] ?? {}, "billingTaskId"), false);
	assert.equal(submissions[0]?.productUsageQuantity, 0);
	assert.equal(
		submissions[0]?.selection.catalogModelId,
		"model-image_text_note-1",
	);
	assert.equal(imageSelection.kind, "image");
	assert.equal(submissions[1]?.operation, "image.edit");
	assert.equal(submissions[1]?.billingTaskId, "task-image");
	assert.equal(submissions[1]?.selection.catalogModelId, "model-image-1");
});

test("frozen XHS generation params drive the existing note prompt and model route", async () => {
	const baseRequest = harnessInputWithExecutionAssembly(
		"image_text_note",
		"package-note-generation-params",
	);
	const snapshot = creationExecutionSnapshotSchema.parse({
		...baseRequest.executionSnapshot,
		beautyVoiceRole: "customer",
		contentPackagePlatform: "xiaohongshu",
		creationMode: "free",
		platform: { id: "xiaohongshu" },
		thinkingLevel: "deep",
	});
	const request: HarnessWorkflowInput = {
		...baseRequest,
		creationMode: "free",
		executionSnapshot: snapshot,
	};
	const factoryInputs: Array<
		Parameters<HarnessStructuredNodeRunnerFactory["create"]>[0]
	> = [];
	const structuredRequests: StructuredNodeRunnerRequest<unknown>[] = [];
	const fixtureFactory = noteRunnerFactory();
	const createPorts = () =>
		new UnifiedHarnessStagePorts(
			noteCopyPorts(),
			{
				create(input) {
					factoryInputs.push(structuredClone(input));
					const runner = fixtureFactory.create(input);
					return {
						async run<Output>(structured: StructuredNodeRunnerRequest<Output>) {
							structuredRequests.push(
								structured as StructuredNodeRunnerRequest<unknown>,
							);
							return runner.run(structured);
						},
					};
				},
			},
			undefined as never,
			new MemoryContentPackageRevisionWritePort(),
			() => "2026-08-02T00:00:00.000Z",
			{
				async read() {
					return {
						styles: {
							styles: [
								{
									id: "facts",
									name: "干货版",
									writingGuide: "清楚说明",
									structureTemplate: "结论、依据、行动",
									platforms: ["xiaohongshu"],
								},
							],
						},
					};
				},
			},
			undefined,
			notBilledExecutionChildObservability(),
		);
	const ports = createPorts();

	await ports.compileNoteBrief({
		workflowId: snapshot.task.id,
		request,
		declaration: {
			normalizedIntent: "介绍夏日护理项目",
			taskType: "daily_service_exposure",
			deliveryLayer: "finished_media",
			relevantAssetCategories: [],
			usedAssetCategories: [],
			route: "free",
			routingSource: "entry",
			implicitConstraints: [],
		},
		context: contextSnapshot(),
	});

	assert.deepEqual(factoryInputs[0]?.selection, {
		mode: "auto",
		profile: "quality",
	});
	assert.deepEqual(factoryInputs[0]?.providerOptions, {
		reasoningEffort: "high",
		thinking: { type: "enabled" },
	});
	const noteTextRequest = structuredRequests.find(
		({ schemaName }) => schemaName === "harness_note_text_block_v1",
	);
	assert.match(noteTextRequest?.instructions ?? "", /frozen:xhsNoteGen/u);
	assert.match(noteTextRequest?.instructions ?? "", /闺蜜聊天/u);
	assert.match(noteTextRequest?.instructions ?? "", /到店体验顾客/u);

	const defaultIdentitySnapshot = creationExecutionSnapshotSchema.parse({
		...snapshot,
		beautyVoiceRole: undefined,
		id: "snapshot-note-generation-params-default-identity",
		identity: { id: "identity-1", revision: "1" },
		thinkingLevel: "standard",
	});
	const defaultIdentityRequest: HarnessWorkflowInput = {
		...request,
		executionSnapshot: defaultIdentitySnapshot,
	};
	const defaultIdentityDeclaration: IntentDeclaration = {
		normalizedIntent: "介绍夏日护理项目",
		taskType: "daily_service_exposure",
		deliveryLayer: "finished_media",
		relevantAssetCategories: [],
		usedAssetCategories: [],
		route: "free",
		routingSource: "entry",
		implicitConstraints: [],
	};
	const identities = new MemoryMarketingIdentityRepository();
	await identities.register({
		workspaceId: "workspace-1",
		actorId: "owner-1",
		occurredAt: "2026-08-02T00:00:00.000Z",
		command: {
			identityId: "identity-1",
			kind: "brand",
			expectedVersion: 0,
			displayName: "夏日美研社",
			owner: "门店",
			professionalBoundaries: ["只表达已核验的护理项目"],
			allowedPlatforms: ["xiaohongshu"],
			allowedScenes: ["brand_personal_ip"],
			expressionSamples: ["专业、克制、不夸大"],
			effectiveFrom: "2026-08-02T00:00:00.000Z",
			expiresAt: null,
			departureHandling: "品牌停用后停止生成新内容。",
			sourceRef: "identity-1-policy",
			brandClaims: ["专业护理服务"],
			forbiddenClaims: ["疗效保证"],
			visualPrinciples: ["真实服务细节"],
			seriesAnchors: ["门店护理指南"],
		},
	});
	const defaultIdentityContext = await new LedgerBackedHarnessContextPort(
		new MemoryStoreFactLedger(),
		new MemoryContextBundleRepository(),
		() => "2026-08-02T00:01:00.000Z",
		undefined,
		undefined,
		undefined,
		undefined,
		identities,
	).compileAndFreeze({
		workflowId: defaultIdentitySnapshot.task.id,
		request: defaultIdentityRequest,
		declaration: defaultIdentityDeclaration,
	});
	await createPorts().compileNoteBrief({
		workflowId: defaultIdentitySnapshot.task.id,
		request: defaultIdentityRequest,
		declaration: defaultIdentityDeclaration,
		context: defaultIdentityContext,
	});

	assert.deepEqual(factoryInputs.at(-1)?.selection, {
		mode: "auto",
		profile: "balanced",
	});
	assert.deepEqual(factoryInputs.at(-1)?.providerOptions, {
		thinking: { type: "disabled" },
	});
	const defaultIdentityTextRequest = structuredRequests
		.filter(({ schemaName }) => schemaName === "harness_note_text_block_v1")
		.at(-1);
	assert.equal(defaultIdentityTextRequest?.promptKey, "xhsNoteGen");
	assert.match(defaultIdentityTextRequest?.instructions ?? "", /夏日美研社/u);
	assert.match(
		defaultIdentityTextRequest?.instructions ?? "",
		/专业、克制、不夸大/u,
	);

	const nonXhsSnapshot = creationExecutionSnapshotSchema.parse({
		...snapshot,
		beautyVoiceRole: undefined,
		contentPackagePlatform: "douyin",
		id: "snapshot-note-generation-params-negative",
		platform: { id: "douyin" },
		thinkingLevel: "standard",
	});
	await createPorts().compileNoteBrief({
		workflowId: nonXhsSnapshot.task.id,
		request: {
			...request,
			executionSnapshot: nonXhsSnapshot,
		},
		declaration: {
			normalizedIntent: "介绍夏日护理项目",
			taskType: "daily_service_exposure",
			deliveryLayer: "finished_media",
			relevantAssetCategories: ["product_service"],
			usedAssetCategories: ["product_service"],
			route: "customized",
			routingSource: "model",
			implicitConstraints: [],
		},
		context: contextSnapshot(),
	});

	assert.equal(factoryInputs.at(-1)?.selection, undefined);
	assert.equal(factoryInputs.at(-1)?.providerOptions, undefined);
	const nonXhsTextRequest = structuredRequests
		.filter(({ schemaName }) => schemaName === "harness_note_text_block_v1")
		.at(-1);
	assert.equal(nonXhsTextRequest?.promptKey, "noteTextBlock");
	assert.doesNotMatch(nonXhsTextRequest?.instructions ?? "", /xhsNoteGen/u);
});

test("media delivery writes the shared ContentPackage once with asset, usage, cost, and snapshot lineage", async () => {
	for (const kind of ["image", "video"] as const) {
		const packageId = `package-${kind}`;
		const request = harnessInput(kind, packageId);
		const snapshot = request.executionSnapshot!;
		const writer = new MemoryContentPackageRevisionWritePort();
		let writtenRevision: ContentPackageRevisionWriteInput | undefined;
		writer.seed(
			buildContentPackage({
				id: packageId,
				kind: kind === "image" ? "image_text" : "video",
				source: {
					assetIds: ["asset-1"],
					creationExecutionSnapshot: {
						id: snapshot.id,
						revision: snapshot.revision,
						schemaVersion: snapshot.schemaVersion,
					},
					targetPlatform: "douyin",
					workId: snapshot.work.id,
					workflowId: snapshot.task.id,
					workflowRevision: snapshot.revision,
				},
				timestamp: "2026-07-22T09:00:00.000Z",
				workspaceId: "workspace-1",
			}),
		);
		const media = new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				return completedResult(kind);
			},
		});
		const ports = new UnifiedHarnessStagePorts(
			unsupportedCopyPorts(),
			{
				create() {
					throw new Error("Media delivery does not compile a copy brief.");
				},
			},
			media,
			{
				async write(input) {
					writtenRevision = structuredClone(input);
					return writer.write(input);
				},
			},
			() => "2026-07-22T09:00:01.000Z",
		);
		const brief = mediaBrief(kind);
		const selection = await media.execute({
			brief,
			context: contextSnapshot(),
			request,
			workflowId: snapshot.task.id,
		});
		const input = {
			workflowId: snapshot.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购成片",
				taskType: "promotion_groupbuy_conversion" as const,
				deliveryLayer: "finished_media" as const,
				relevantAssetCategories: ["promotion_activity" as const],
				usedAssetCategories: ["promotion_activity" as const],
				route: "customized" as const,
				routingSource: "model" as const,
				implicitConstraints: [],
			},
			context: contextSnapshot(),
			brief,
			selection,
		};
		const delivery = await ports.assembleMediaAndDeliver(input);
		const replayed = await ports.assembleMediaAndDeliver(input);

		assert.deepEqual(replayed, delivery);
		assert.deepEqual(delivery, {
			packageId,
			revision: 1,
			versionId: `${snapshot.task.id}:${kind}-asset-1`,
		});
		assert.equal(writtenRevision?.taskId, snapshot.task.id);
		assert.equal(writtenRevision?.snapshotId, snapshot.id);
		assert.equal(writtenRevision?.snapshot.revision, snapshot.revision);
		assert.deepEqual(
			writtenRevision?.billingTrustedUsage,
			kind === "video"
				? {
						kind: "media_duration",
						actualSeconds: 8,
						evidenceRef: "owned-asset:video-asset-1",
					}
				: undefined,
		);
		assert.equal(
			writtenRevision?.generated.childRuns[0]?.providerAttempts?.length,
			1,
		);
		assert.equal(
			writtenRevision?.generated.childRuns[0]?.providerCosts?.length,
			1,
		);
		const contentPackage = writer.get("workspace-1", packageId);
		assert.ok(contentPackage);
		assert.equal(contentPackage?.revision, 1);
		assert.deepEqual(contentPackage?.source.creationExecutionSnapshot, {
			id: snapshot.id,
			revision: 1,
			schemaVersion: "creation-execution-snapshot/v1",
		});
		assert.deepEqual(contentPackage?.generated.assetIds, [`${kind}-asset-1`]);
		assert.equal(
			contentPackage?.generated.ownedAssets?.[0]?.id,
			`${kind}-asset-1`,
		);
		assert.equal(
			contentPackage?.generated.ownedAssets?.[0]?.sourceTaskRef,
			`provider-task-${kind}-1`,
		);
		assert.deepEqual(contentPackage?.generated.childRuns[0]?.productUsage, {
			quantity: 0,
			status: "committed",
		});
		assert.equal(
			contentPackage?.generated.childRuns[0]?.providerCost?.amount,
			1.2,
		);
		assert.equal(
			contentPackage?.generated.childRuns[0]?.providerAttempts?.length,
			1,
		);
		assert.equal(
			contentPackage?.generated.childRuns[0]?.providerCosts?.length,
			1,
		);
		assert.equal(contentPackage?.marketing?.contextBundle.bundleId, "bundle-1");
		assert.deepEqual(contentPackage?.marketing?.rightsRefs, ["asset-1"]);
		assert.equal(contentPackage?.variants?.length, 3);
		assert.ok(contentPackage?.versions[0]?.body.trim());
		assert.ok(contentPackage?.versions[0]?.conversionHook?.trim());
		assert.deepEqual(contentPackage?.harnessSelection, {
			recommendedCandidateId: `${kind}-asset-1`,
		});
		assert.equal(
			contentPackage?.versions[0]?.harnessCandidateId,
			`${kind}-asset-1`,
		);
		if (kind === "image") {
			assert.equal(contentPackage?.versions[0]?.title, "夏日护理活动海报");
		} else {
			assert.equal(contentPackage?.versions[0]?.title, "视频成品");
		}
	}
});

test("source-free video production reaches AI generation terms through the real platform variant", async () => {
	const packageId = "package-video-source-free";
	const request = harnessInputWithExecutionAssembly(
		"video",
		packageId,
		"image.edit",
		0,
	);
	const snapshot = request.executionSnapshot!;
	const writer = new MemoryContentPackageRevisionWritePort();
	writer.seed(
		buildContentPackage({
			id: packageId,
			kind: "video",
			source: {
				assetIds: [],
				creationExecutionSnapshot: {
					id: snapshot.id,
					revision: snapshot.revision,
					schemaVersion: snapshot.schemaVersion,
				},
				targetPlatform: "douyin",
				workId: snapshot.work.id,
				workflowId: snapshot.task.id,
				workflowRevision: snapshot.revision,
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
	);
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return completedResult("video");
		},
	});
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		writer,
		() => "2026-07-22T09:00:01.000Z",
	);
	const brief = {
		...mediaBrief("video"),
		referenceAssetIds: [],
	};
	const context = contextSnapshot([]);
	const selection = await media.execute({
		brief,
		context,
		request,
		workflowId: snapshot.task.id,
	});

	await ports.assembleMediaAndDeliver({
		workflowId: snapshot.task.id,
		request,
		declaration: {
			normalizedIntent: "制作全 AI 视频",
			taskType: "promotion_groupbuy_conversion",
			deliveryLayer: "finished_media",
			relevantAssetCategories: [],
			usedAssetCategories: [],
			route: "customized",
			routingSource: "model",
			implicitConstraints: [],
		},
		context,
		brief,
		selection,
	});

	const contentPackage = writer.get("workspace-1", packageId);
	assert.ok(contentPackage);
	assert.deepEqual(contentPackage.source.assetIds, []);
	assert.deepEqual(contentPackage.marketing?.rightsRefs, []);
	const douyinVariant = contentPackage.variants.find(
		(variant) => variant.platform === "douyin",
	);
	assert.ok(douyinVariant);
	const version = douyinVariant.versions.find(
		(candidate) => candidate.id === douyinVariant.currentVersionId,
	);
	assert.ok(version);
	assert.notEqual(version.id, contentPackage.versions[0]?.id);

	const basis = await new ContentPackageRightsBasisResolver(
		{
			async resolve() {
				throw new Error(
					"Source-free generation must not consult merchant source rights.",
				);
			},
		},
		{
			async getRegistryRevision(workspaceId, revisionId) {
				assert.equal(workspaceId, "workspace-1");
				assert.equal(revisionId, "model-video-r1");
				return {
					catalogRevisionId: revisionId,
					contracts: [
						{
							id: "contract-video-source-free",
							providerProfileId: "provider-video-source-free",
							termsRevisionId: "terms-video-source-free-r1",
							commercialUse: "allowed",
							effectiveFrom: "2026-07-01T00:00:00.000Z",
						},
					],
					deployments: [
						{
							catalogModelId: "model-video-1",
							executionChannelId: "channel-video-source-free",
							id: "deployment-video-1",
							lifecycleStatus: "active",
							providerProfileId: "provider-video-source-free",
							revisionId: "deployment-video-source-free-r1",
						},
					],
				};
			},
		},
	).resolve({
		contentPackage,
		platform: "douyin",
		version,
		workspaceId: "workspace-1",
	});

	assert.deepEqual(basis, {
		commercialUse: "allowed",
		generatedAssetId: "video-asset-1",
		kind: "ai_generation_terms",
		providerTaskRef: "provider-task-video-1",
		runId: "job-video-1",
		termsRevisionId: "terms-video-source-free-r1",
	});
});

test("image-text note compiles dual styles, generates selected pages, and writes one complete revision", async () => {
	const packageId = "package-image-text-note";
	const originalRequest = harnessInputWithExecutionAssembly(
		"image_text_note",
		packageId,
	);
	const sourceSnapshot = originalRequest.executionSnapshot!;
	const snapshot = creationExecutionSnapshotSchema.parse({
		...sourceSnapshot,
		id: "snapshot-note-confirmed",
		semanticDecision: {
			sourceSnapshotId: sourceSnapshot.id,
			reference: {
				field: "note_plan_confirmation",
				id: "decision-note-confirmation",
				revision: sourceSnapshot.revision,
				value: "use-default",
			},
		},
	});
	const request = { ...originalRequest, executionSnapshot: snapshot };
	const writer = new MemoryContentPackageRevisionWritePort();
	writer.seed(
		buildContentPackage({
			id: packageId,
			kind: "image_text",
			source: {
				assetIds: [],
				creationExecutionSnapshot: {
					id: sourceSnapshot.id,
					revision: sourceSnapshot.revision,
					schemaVersion: sourceSnapshot.schemaVersion,
				},
				targetPlatform: "douyin",
				workId: snapshot.work.id,
				workflowId: snapshot.task.id,
				workflowRevision: snapshot.revision,
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
	);
	let generated = 0;
	let billingTrustedUsage:
		| ContentPackageRevisionWriteInput["billingTrustedUsage"]
		| undefined;
	const ports = new UnifiedHarnessStagePorts(
		noteCopyPorts(),
		noteRunnerFactory(true),
		{
			async execute() {
				generated += 1;
				const selection = completedResult("image", String(generated));
				return {
					asset: {
						contentType: selection.asset!.contentType,
						id: selection.asset!.id,
						objectKey: selection.asset!.objectKey,
						sha256: selection.asset!.sha256,
						sizeBytes: selection.asset!.sizeBytes,
					},
					childRun: {
						assetIds: [selection.asset!.id],
						runId: `run-note-${generated}`,
						runType: "model_job",
						status: "succeeded",
						productUsage: { quantity: 1, status: "committed" },
					},
					kind: "image",
					trace: {
						stage: "execution_selection",
						winnerCandidateId: selection.asset!.id,
						candidateScores: [],
						blockedCandidates: [],
						rubricVersion: "image-v1",
						rubricHash: "a".repeat(64),
					},
				};
			},
		},
		{
			async write(input) {
				billingTrustedUsage = structuredClone(input.billingTrustedUsage);
				return writer.write(input);
			},
		},
		() => "2026-07-22T09:00:01.000Z",
		{
			async read() {
				return {
					styles: {
						styles: [
							{
								id: "facts",
								name: "干货版",
								writingGuide: "清楚说明",
								structureTemplate: "结论、依据、行动",
								platforms: ["xiaohongshu"],
							},
							{
								id: "story",
								name: "故事版",
								writingGuide: "场景叙事",
								structureTemplate: "场景、方案、行动",
								platforms: ["xiaohongshu"],
							},
						],
					},
				};
			},
		},
		undefined,
		notBilledExecutionChildObservability(),
	);
	const context = contextSnapshot();
	const declaration = {
		normalizedIntent: "介绍夏日护理项目",
		taskType: "daily_service_exposure" as const,
		deliveryLayer: "finished_media" as const,
		relevantAssetCategories: ["product_service" as const],
		usedAssetCategories: ["product_service" as const],
		route: "customized" as const,
		routingSource: "model" as const,
		implicitConstraints: [],
	};
	const confirmation = await ports.nameIntent({
		workflowId: snapshot.task.id,
		request,
	});
	assert.equal(
		confirmation.blockingQuestion,
		null,
		"image-text planning must proceed to the one real direction choice without a page-plan confirmation",
	);
	const resumed = await ports.nameIntent({
		workflowId: snapshot.task.id,
		request: {
			...request,
			decisionReferences: [
				{
					field: "note_style",
					id: "decision-note-style",
					revision: snapshot.revision,
					value: "故事版",
				},
			],
		},
	});
	assert.equal(resumed.blockingQuestion, null);

	const brief = await ports.compileNoteBrief({
		workflowId: snapshot.task.id,
		request,
		declaration,
		context,
	});
	assert.deepEqual(
		brief.candidates.candidates.map(({ styleId }) => styleId),
		["facts", "story"],
	);
	const selection = await ports.executeNoteAndSelect({
		workflowId: snapshot.task.id,
		request,
		brief,
		context,
		selectedStyleId: "story",
	});
	const delivery = await ports.assembleNoteAndDeliver({
		workflowId: snapshot.task.id,
		request,
		declaration,
		context,
		brief,
		selection,
	});

	assert.equal(delivery.revision, 1);
	assert.equal(generated, 3);
	assert.deepEqual(billingTrustedUsage, {
		kind: "product_units",
		units: [
			{ resource: "copy", quantity: 2 },
			{ resource: "image", quantity: 2 },
		],
		evidenceRef: "note-plan-pages:page-1@1,page-2@3",
	});
	assert.deepEqual(
		selection.auditSignals.map(({ eventType, payload }) => ({
			eventType,
			status: payload.status,
			strategy: payload.strategy,
			trigger: payload.trigger,
		})),
		[
			{
				eventType: "note_style_selected",
				status: undefined,
				strategy: undefined,
				trigger: undefined,
			},
			{
				eventType: "note_consistency_evaluated",
				status: "warned",
				strategy: "warn",
				trigger: undefined,
			},
			{
				eventType: "note_page_regenerated",
				status: undefined,
				strategy: undefined,
				trigger: "check_violation",
			},
			{
				eventType: "note_page_regenerated",
				status: undefined,
				strategy: undefined,
				trigger: "check_violation",
			},
			{
				eventType: "note_consistency_evaluated",
				status: "passed",
				strategy: "warn",
				trigger: undefined,
			},
		],
	);
	const contentPackage = writer.get("workspace-1", packageId);
	assert.equal(contentPackage?.revision, 1);
	assert.equal(contentPackage?.versions.length, 2);
	assert.equal(contentPackage?.variants.length, 3);
	const selectedVersion = contentPackage?.versions.find(
		({ harnessCandidateId }) => harnessCandidateId === "story",
	);
	assert.equal(selectedVersion?.note?.plan.pages.length, 2);
	// #319 / P1-07 write path: ordered assets land ⇒ product carrier is note
	// (wire kind stays image_text; layered mapping from #288).
	assert.equal(contentPackage?.kind, "image_text");
	assert.ok(
		(selectedVersion?.orderedAssetIds.length ?? 0) > 0,
		"selected note version must persist ordered media assets",
	);
	assert.equal(
		contentPackageCarrierOf({
			kind: contentPackage!.kind,
			orderedAssetCount: selectedVersion!.orderedAssetIds.length,
		}),
		"note",
	);
	assert.deepEqual(
		selectedVersion?.note?.plan.pages.map(({ imageAssetId }) => imageAssetId),
		["image-asset-1", "image-asset-3"],
	);
	assert.ok(contentPackage?.marketing?.contextBundle.bundleId);
	assert.ok(contentPackage?.marketing?.rightsRefs.length);
	assert.ok(
		selectedVersion?.body && !selectedVersion.body.includes("还没对上"),
		"a fully consistent note carries no partial marker",
	);

	// D-122 诚实交付: the same delivery, one page short. Naming the count on the
	// 申报卡 is not enough — the merchant has to be able to tell which page to
	// hold back in the copy they will actually paste.
	const partialPackageId = "package-image-text-note-partial";
	const partialSnapshot = creationExecutionSnapshotSchema.parse({
		...snapshot,
		id: "snapshot-note-partial",
		contentPackage: { ...snapshot.contentPackage, id: partialPackageId },
	});
	const partialRequest = {
		...harnessInputWithExecutionAssembly("image_text_note", partialPackageId),
		executionSnapshot: partialSnapshot,
	};
	writer.seed(
		buildContentPackage({
			id: partialPackageId,
			kind: "image_text",
			source: {
				assetIds: [],
				creationExecutionSnapshot: {
					id: sourceSnapshot.id,
					revision: sourceSnapshot.revision,
					schemaVersion: sourceSnapshot.schemaVersion,
				},
				targetPlatform: "douyin",
				workId: partialSnapshot.work.id,
				workflowId: partialSnapshot.task.id,
				workflowRevision: partialSnapshot.revision,
			},
			timestamp: "2026-07-22T09:00:00.000Z",
			workspaceId: "workspace-1",
		}),
	);
	const partialBrief = await ports.compileNoteBrief({
		workflowId: partialSnapshot.task.id,
		request: partialRequest,
		declaration,
		context,
	});
	const baseSelection = await ports.executeNoteAndSelect({
		workflowId: partialSnapshot.task.id,
		request: partialRequest,
		brief: partialBrief,
		context,
		selectedStyleId: "story",
	});
	const unresolvedPageId = baseSelection.version.plan.pages[1]!.id;
	await ports.assembleNoteAndDeliver({
		workflowId: partialSnapshot.task.id,
		request: partialRequest,
		declaration,
		context,
		brief: partialBrief,
		selection: {
			...baseSelection,
			version: {
				...baseSelection.version,
				evaluation: {
					...baseSelection.version.evaluation!,
					regenerationPageIds: [unresolvedPageId],
				},
			},
			partial: {
				unresolvedPageIds: [unresolvedPageId],
				reason: "consistency_remained_incomplete",
			},
		},
	});
	const partialVersion = writer
		.get("workspace-1", partialPackageId)
		?.versions.find(({ harnessCandidateId }) => harnessCandidateId === "story");
	const partialPages = partialVersion?.body.split("\n\n") ?? [];
	assert.ok(partialPages.length >= baseSelection.version.plan.pages.length);
	assert.ok(
		!partialPages[0]?.includes("还没对上"),
		"the page that came out right is left alone",
	);
	assert.match(partialPages.at(-1) ?? "", /还没对上/u);
});

test("production note assembly can disable an unavailable enhancement judge without bypassing canonical gates", async () => {
	const packageId = "package-note-without-enhancement-judge";
	const request = harnessInputWithExecutionAssembly(
		"image_text_note",
		packageId,
	);
	let generated = 0;
	let writes = 0;
	const ports = new UnifiedHarnessStagePorts(
		noteCopyPorts(),
		noteRunnerFactory(true),
		{
			async execute() {
				generated += 1;
				const selection = completedResult("image", String(generated));
				return {
					asset: selection.asset!,
					childRun: {
						assetIds: [selection.asset!.id],
						runId: `run-note-no-judge-${generated}`,
						runType: "model_job",
						status: "succeeded",
					},
					kind: "image",
					trace: {
						stage: "execution_selection",
						winnerCandidateId: selection.asset!.id,
						candidateScores: [],
						blockedCandidates: [],
						rubricVersion: "image-v1",
						rubricHash: "a".repeat(64),
					},
				};
			},
		},
		{
			async write(input) {
				writes += 1;
				return {
					packageId: input.packageId,
					revision: input.expectedRevision + 1,
					versionId: input.version.id,
				};
			},
		},
		() => "2026-07-29T00:00:00.000Z",
		{
			async read() {
				return {
					styles: {
						styles: [
							{
								id: "facts",
								name: "干货版",
								writingGuide: "清楚说明",
								structureTemplate: "结论、依据、行动",
								platforms: ["xiaohongshu"],
							},
						],
					},
				};
			},
		},
		unconfiguredNotePlanEnhancementJudgeResolver,
		notBilledExecutionChildObservability(),
	);
	const context = contextSnapshot();
	const declaration = {
		normalizedIntent: "介绍夏日护理项目",
		taskType: "daily_service_exposure" as const,
		deliveryLayer: "finished_media" as const,
		relevantAssetCategories: ["product_service" as const],
		usedAssetCategories: ["product_service" as const],
		route: "customized" as const,
		routingSource: "model" as const,
		implicitConstraints: [],
	};
	const workflowId = request.executionSnapshot!.task.id;
	const brief = await ports.compileNoteBrief({
		workflowId,
		request,
		declaration,
		context,
	});
	const selection = await ports.executeNoteAndSelect({
		workflowId,
		request,
		brief,
		context,
		selectedStyleId: "facts",
	});

	assert.equal(generated, 2);
	assert.deepEqual(selection.enhancementJudge, {
		status: "unconfigured",
		reason: "self_correction_judge_unconfigured",
	});
	assert.equal(selection.version.evaluation, undefined);
	assert.deepEqual(
		selection.auditSignals.filter(
			({ eventType }) => eventType === "note_consistency_evaluated",
		),
		[
			{
				eventType: "note_consistency_evaluated",
				payload: {
					attempt: "initial",
					evaluationUnavailable: true,
					reason: "self_correction_judge_unconfigured",
					selfCorrectionDisabled: true,
				},
			},
		],
	);

	const unsafeSelection = structuredClone(selection);
	unsafeSelection.version.plan.pages[0]!.textBlock.body =
		"国家认证五星机构，团购价398元";
	await assert.rejects(
		ports.assembleNoteAndDeliver({
			workflowId,
			request,
			declaration,
			context,
			brief,
			selection: unsafeSelection,
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("critical_fact_source"),
	);
	assert.equal(writes, 0);

	const delivery = await ports.assembleNoteAndDeliver({
		workflowId,
		request,
		declaration,
		context,
		brief,
		selection,
	});
	assert.equal(delivery.packageId, packageId);
	assert.equal(writes, 1);
});

test("media delivery blocks malicious visible copy before the canonical writer", async () => {
	const request = harnessInput("image", "package-image-redline");
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return completedResult("image");
		},
	});
	let writes = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write() {
				writes += 1;
				throw new Error("The redline gate must run before this writer.");
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);
	const brief = imageBriefFor("image.edit", 1);
	brief.intent.purpose = "国家认证五星机构，团购价398元";
	brief.intent.subject = "到店即送全年护理";
	const selection = await media.execute({
		brief,
		context: contextSnapshot(),
		request,
		workflowId: request.executionSnapshot!.task.id,
	});

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购海报",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context: contextSnapshot(),
			brief,
			selection,
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("critical_fact_source") &&
			error.merchantMessage ===
				"成品文案含有未被门店已确认资料支持的资质、价格或优惠、权益承诺，暂不能交付。",
	);
	assert.equal(writes, 0);
});

test("media closeout enforces authoritative source rights and expression identity", async () => {
	const request = harnessInput("image", "package-image-authority");
	const brief = imageBriefFor("image.edit", 1);
	let submissions = 0;
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			submissions += 1;
			return completedResult("image");
		},
	});
	const context = contextSnapshot();
	context.policyReferences.rightsRefs = [
		{
			assetId: "asset-1",
			workspaceId: "workspace-1",
			status: "withdrawn",
			allowedUses: [],
		},
	];
	context.policyReferences.identityRefs = [
		{
			id: "marketing_identity:identity-1:identity-r1",
			workspaceId: "workspace-1",
			status: "withdrawn",
		},
	];
	await assert.rejects(
		media.execute({
			brief,
			context,
			request,
			workflowId: request.executionSnapshot!.task.id,
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("subject_asset_rights") &&
			error.gateIds.includes("expression_identity"),
	);
	assert.equal(submissions, 0);
});

test("media closeout evaluates frozen price sources against delivery-time freshness", async () => {
	const request = harnessInput("image", "package-image-freshness");
	const brief = imageBriefFor("image.edit", 1);
	brief.intent.purpose = "头皮护理团购价398元";
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return completedResult("image");
		},
	});
	const context = contextSnapshot();
	context.activeFacts = [
		{
			key: "group_buy_price",
			value: { amount: 398, currency: "CNY" },
			sourceRef: "store_fact:price-1:1",
			effectiveFrom: "2026-07-21T00:00:00.000Z",
			expiresAt: "2026-07-22T09:00:00.500Z",
		},
	];
	context.policyReferences.sourceRefs = [
		{
			id: "store_fact:price-1:1",
			workspaceId: "workspace-1",
			revision: 1,
			status: "current",
		},
	];
	Object.assign(context.policyReferences.sourceRefs[0]!, {
		expiresAt: "2026-07-22T09:00:00.500Z",
	});
	context.bundle.dimensions.store_facts_assets.group_buy_price = {
		value: { amount: 398, currency: "CNY" },
		layer: "current_fact",
		pool: "store_personal",
		sourceRef: "store_fact:price-1:1",
		factSnapshot: {
			factId: "price-1",
			kind: "price",
			revision: 1,
			source: {
				kind: "user_confirmation",
				referenceId: "confirmation-price-1",
				capturedAt: "2026-07-21T00:00:00.000Z",
			},
			effectiveFrom: "2026-07-21T00:00:00.000Z",
			expiresAt: "2026-07-22T09:00:00.500Z",
		},
	};
	let writes = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write() {
				writes += 1;
				throw new Error("The freshness gate must run before this writer.");
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);
	const selection = await media.execute({
		brief,
		context,
		request,
		workflowId: request.executionSnapshot!.task.id,
	});

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购海报",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context,
			brief,
			selection,
			allowedFactRefs: ["store_fact:price-1:1"],
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("price_benefit_freshness"),
	);
	assert.equal(writes, 0);
});

test("video delivery rejects a price from the context when this run did not authorize its fact reference", async () => {
	const request = harnessInput("video", "package-video-unauthorized-price");
	const brief = mediaBrief("video");
	brief.storyboard[0]!.description =
		"头皮护理团购价398元，门店护理场景与主视觉展示。";
	const context = contextSnapshot();
	context.activeFacts = [
		{
			key: "group_buy_price",
			value: { amount: 398, currency: "CNY" },
			sourceRef: "store_fact:price-1:1",
			effectiveFrom: "2026-07-21T00:00:00.000Z",
			expiresAt: null,
		},
	];
	context.policyReferences.sourceRefs = [
		{
			id: "store_fact:price-1:1",
			workspaceId: "workspace-1",
			revision: 1,
			status: "current",
		},
	];
	context.bundle.dimensions.store_facts_assets.group_buy_price = {
		value: { amount: 398, currency: "CNY" },
		layer: "current_fact",
		pool: "store_personal",
		sourceRef: "store_fact:price-1:1",
		factSnapshot: {
			factId: "price-1",
			kind: "price",
			revision: 1,
			source: {
				kind: "user_confirmation",
				referenceId: "confirmation-price-1",
				capturedAt: "2026-07-21T00:00:00.000Z",
			},
			effectiveFrom: "2026-07-21T00:00:00.000Z",
			expiresAt: null,
		},
	};
	const media = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return completedResult("video");
		},
	});
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write() {
				throw new Error("The unauthorized price must not reach the writer.");
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);
	const selection = await media.execute({
		brief,
		context,
		request,
		workflowId: request.executionSnapshot!.task.id,
	});

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作团购视频",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context,
			brief,
			selection,
			allowedFactRefs: [],
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("critical_fact_source"),
	);
});

test("image exact text is included in the visible-copy delivery gate", async () => {
	const request = harnessInput("image", "package-image-exact-text-redline");
	const brief = imageBriefWithExactText("卫健委批准");
	const media = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				return completedResult("image");
			},
		},
		{
			async observe(input) {
				return {
					expected: input.expected,
					observed: input.expected,
					conflictingText: [],
				};
			},
		},
	);
	const selection = await media.execute({
		brief,
		context: contextSnapshot(),
		request,
		workflowId: request.executionSnapshot!.task.id,
	});
	let writes = 0;
	const ports = new UnifiedHarnessStagePorts(
		unsupportedCopyPorts(),
		{
			create() {
				throw new Error("Media delivery does not compile a copy brief.");
			},
		},
		media,
		{
			async write(input) {
				writes += 1;
				return {
					packageId: input.packageId,
					revision: input.expectedRevision + 1,
					versionId: input.version.id,
				};
			},
		},
		() => "2026-07-22T09:00:01.000Z",
	);

	await assert.rejects(
		ports.assembleMediaAndDeliver({
			workflowId: request.executionSnapshot!.task.id,
			request,
			declaration: {
				normalizedIntent: "制作医美活动海报",
				taskType: "promotion_groupbuy_conversion",
				deliveryLayer: "finished_media",
				relevantAssetCategories: ["promotion_activity"],
				usedAssetCategories: ["promotion_activity"],
				route: "customized",
				routingSource: "model",
				implicitConstraints: [],
			},
			context: contextSnapshot(),
			brief,
			selection,
		}),
		(error: unknown) =>
			error instanceof HarnessSelectionError &&
			error.gateIds.includes("critical_fact_source"),
	);
	assert.equal(writes, 0);
});

test("the video-native compiler has no ffmpeg or composition dependency", async () => {
	const source = await readFile(
		new URL("./unified-media-stage-ports.ts", import.meta.url),
		"utf8",
	);
	const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map(
		(match) => match[1] ?? "",
	);

	assert.deepEqual(
		imports.filter((specifier) => /ffmpeg|composition/iu.test(specifier)),
		[],
	);
});

test("an unknown durable media outcome stays on its stable reconciliation key", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit(input) {
			submissions.push(structuredClone(input));
			return {
				...completedResult("video"),
				status: "unknown",
				asset: undefined,
			};
		},
	});
	const request = harnessInput("video", "package-video");

	await assert.rejects(
		adapter.execute({
			brief: mediaBrief("video"),
			context: contextSnapshot(),
			request,
			workflowId: "task-video",
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "MEDIA_RECONCILIATION_PENDING" &&
			error.status === 202,
	);
	assert.equal(submissions.length, 1);
	assert.equal(
		submissions[0]?.idempotencyKey,
		"harness-media:task-video:video",
	);
});

test("terminal video failure and timeout expose merchant-safe recovery choices", async () => {
	for (const [failureCode, expectedChoice] of [
		["PROVIDER_REJECTED", "更换参考素材"],
		["LOGICAL_TIMEOUT", "图片发布方案"],
	] as const) {
		const adapter = new ModelSupplyHarnessMediaExecutionPort({
			async submit() {
				return {
					...completedResult("video"),
					asset: undefined,
					failureCode,
					status: "failed" as const,
				};
			},
		});

		await assert.rejects(
			adapter.execute({
				brief: mediaBrief("video"),
				context: contextSnapshot(),
				request: harnessInput("video", "package-video"),
				workflowId: "task-video",
			}),
			(error: unknown) => {
				assert.ok(error instanceof HarnessMediaExecutionError);
				assert.equal(error.code, "MEDIA_GENERATION_FAILED");
				assert.match(error.merchantMessage ?? "", /重新生成/u);
				assert.match(
					error.merchantMessage ?? "",
					new RegExp(expectedChoice, "u"),
				);
				assert.doesNotMatch(
					error.merchantMessage ?? "",
					new RegExp(failureCode, "u"),
				);
				assert.deepEqual(
					merchantVisibleLanguageIssues(error.merchantMessage ?? ""),
					[],
				);
				return true;
			},
		);
	}
});

test("an unknown media result reconciles the same durable job without resubmission", async () => {
	const submitted = completedResult("image");
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return { ...submitted, status: "unknown", asset: undefined };
		},
		async getDurableMediaJob(workspaceId, jobId) {
			assert.equal(workspaceId, "workspace-1");
			assert.equal(jobId, submitted.jobId);
			return { result: submitted };
		},
	});

	const selection = await adapter.execute({
		brief: mediaBrief("image"),
		context: contextSnapshot(),
		request: harnessInput("image", "package-image"),
		workflowId: "task-image",
	});

	assert.equal(selection.asset.id, "image-asset-1");
});

test("a replayed note admission repairs its missing durable media job through the same submission", async () => {
	const completed = completedResult("image");
	let submissions = 0;
	let durableReads = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				return completed;
			},
			async getDurableMediaJob(_workspaceId, jobId) {
				durableReads += 1;
				assert.equal(jobId, completed.jobId);
				throw new JobRuntimeError("NOT_FOUND", "Tracer job was not found.");
			},
		},
		undefined,
		{
			async claim(input) {
				return {
					...input,
					generation: 1,
					jobId: completed.jobId,
				};
			},
			async markRunning(_token, jobId) {
				assert.equal(jobId, completed.jobId);
				return true;
			},
			async markTerminal(_token, status) {
				assert.equal(status, "completed");
				return true;
			},
		},
	);

	const selection = await adapter.execute({
		brief: imageBriefFor("image.generate", 0),
		context: contextSnapshot(),
		request: harnessInput("image_text_note", "package-note-repair"),
		workflowId: "workflow-note:replayed-admission",
	});

	assert.equal(selection.asset.id, completed.asset?.id);
	assert.equal(durableReads, 1);
	assert.equal(submissions, 1);
});

test("note pages keep durable admission single-flight while compiler branches remain parallel", async () => {
	const events: string[] = [];
	const first = completedResult("image", "1");
	const second = completedResult("image", "2");
	let submissions = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				events.push(`submit:${submissions}`);
				if (submissions === 1) {
					return { ...first, status: "unknown", asset: undefined };
				}
				return second;
			},
			async getDurableMediaJob(_workspaceId, jobId) {
				assert.equal(jobId, first.jobId);
				events.push("get:1:completed");
				return { result: first };
			},
		},
		undefined,
		memoryNoteAdmission(events),
	);
	const request = harnessInput("image_text_note", "package-note");

	const [firstSelection, secondSelection] = await Promise.all([
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "workflow-note:page-1",
			awaitSignal: async () => {},
		}),
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "workflow-note:page-2",
			awaitSignal: async () => {
				while (!events.includes("completed:g1")) {
					await new Promise<void>((resolve) => setImmediate(resolve));
				}
			},
			runStep: async (_effectKey, operation) => operation(),
		}),
	]);

	assert.equal(firstSelection.asset.id, "image-asset-1");
	assert.equal(secondSelection.asset.id, "image-asset-2");
	assert.deepEqual(events, [
		"claim:workflow-note:page-1:g1",
		"blocked:workflow-note:page-2",
		"submit:1",
		"running:g1",
		"get:1:completed",
		"completed:g1",
		"claim:workflow-note:page-2:g2",
		"submit:2",
		"running:g2",
		"completed:g2",
	]);
});

test("a competing note workflow polls inside one durable admission effect", async () => {
	const events: string[] = [];
	const first = completedResult("image", "1");
	const second = completedResult("image", "2");
	let submissions = 0;
	const effectKeys: string[] = [];
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				if (submissions === 1) {
					return { ...first, status: "unknown", asset: undefined };
				}
				return second;
			},
			async getDurableMediaJob(_workspaceId, jobId) {
				assert.equal(jobId, first.jobId);
				return { result: first };
			},
		},
		undefined,
		memoryNoteAdmission(events),
	);
	const request = harnessInput("image_text_note", "package-note-durable");

	const [firstSelection, secondSelection] = await Promise.all([
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "workflow-note:page-1",
		}),
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request,
			workflowId: "workflow-note:page-2",
			runStep: async (effectKey, operation) => {
				effectKeys.push(effectKey);
				return operation();
			},
		}),
	]);

	assert.equal(firstSelection.asset.id, "image-asset-1");
	assert.equal(secondSelection.asset.id, "image-asset-2");
	assert.deepEqual(
		effectKeys.map((key) => key.split(":", 1)[0]),
		["admission-claim", "submit", "admission-running", "admission-terminal"],
	);
	assert.deepEqual(events.slice(0, 2), [
		"claim:workflow-note:page-1:g1",
		"blocked:workflow-note:page-2",
	]);
});

test("a busy note admission without a durable step returns 202 immediately", async () => {
	let claimCalls = 0;
	let submissions = 0;
	const blockedAdmission: NoteMediaAdmissionPort = {
		async claim() {
			claimCalls += 1;
			return null;
		},
		async markRunning() {
			throw new Error("markRunning must not run without a claim");
		},
		async markTerminal() {
			throw new Error("markTerminal must not run without a claim");
		},
	};
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				return completedResult("image");
			},
		},
		undefined,
		blockedAdmission,
	);

	await assert.rejects(
		adapter.execute({
			brief: imageBriefFor("image.generate", 0),
			context: contextSnapshot(),
			request: harnessInput("image_text_note", "package-note-fast-202"),
			workflowId: "workflow-note:busy-fast-202",
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "MEDIA_RECONCILIATION_PENDING" &&
			error.status === 202,
	);
	assert.equal(claimCalls, 1);
	assert.equal(submissions, 0);
});

test("exact text blocks the first image, retries once, and keeps both provider costs without job-side debit flags", async () => {
	const submissions: ModelSupplySubmission[] = [];
	let generation = 0;
	let verification = 0;
	const verifier: ImageExactTextVerifier = {
		async observe(input) {
			verification += 1;
			return verification === 1
				? {
						expected: input.expected,
						observed: ["价格 389"],
						conflictingText: [],
					}
				: {
						expected: input.expected,
						observed: ["价格 398"],
						conflictingText: [],
					};
		},
	};
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit(input) {
				submissions.push(structuredClone(input));
				generation += 1;
				return completedResult("image", String(generation));
			},
		},
		verifier,
	);
	const request = {
		...harnessInput("image", "package-image"),
		prompts: frozenPromptBundle(),
	};
	const brief = imageBriefWithExactText("价格 398");
	const selection = await adapter.execute({
		brief,
		context: contextSnapshot(),
		request,
		workflowId: "task-image",
	});

	assert.equal(selection.asset.id, "image-asset-2");
	assert.deepEqual(selection.trace.blockedCandidates, [
		{ candidateId: "image-asset-1", gateIds: ["image_exact_text"] },
	]);
	assert.equal(selection.childRun.providerAttempts?.length, 2);
	assert.equal(selection.childRun.providerCosts?.length, 2);
	assert.equal(submissions.length, 2);
	assert.equal(
		submissions[1]?.idempotencyKey,
		"harness-media:task-image:image:exact-text-retry",
	);
	assert.match(
		submissions[1]?.prompt ?? "",
		/did not preserve every exact text value/u,
	);
	// T19 originally asserted the key was ABSENT. T14 (merged after it) makes every
	// media sub-job explicitly cost-only, so absence is no longer the right shape —
	// and absence was never the safe one: before T14 an absent value fell through to
	// a `?? 1` default, i.e. a real user-side debit. Pinning the value to 0 says what
	// this test's own name claims, and it fails if anyone reintroduces a debit here.
	assert.deepEqual(
		submissions.map((submission) => submission.productUsageQuantity),
		[0, 0],
	);
});

test("exact-text image retries revalidate execution assembly before every provider submit", async () => {
	const request = harnessInputWithExecutionAssembly(
		"image",
		"package-image-attempt-fence",
	);
	let submissions = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				submissions += 1;
				return completedResult("image", String(submissions));
			},
		},
		{
			async observe(input) {
				request.frozenRouteSnapshot!.deploymentId =
					"deployment-drifted-before-retry";
				return {
					expected: input.expected,
					observed: ["价格 389"],
					conflictingText: [],
				};
			},
		},
	);

	await assert.rejects(
		() =>
			adapter.execute({
				brief: imageBriefWithExactText("价格 398"),
				context: contextSnapshot(),
				request,
				workflowId: request.executionSnapshot!.task.id,
			}),
		/execution assembly binding does not match the frozen route/i,
	);
	assert.equal(submissions, 1);
});

test("a second exact-text mismatch hard-blocks delivery with merchant-safe wording", async () => {
	let generation = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort(
		{
			async submit() {
				generation += 1;
				return completedResult("image", String(generation));
			},
		},
		{
			async observe(input) {
				return {
					expected: input.expected,
					observed: ["价格 389"],
					conflictingText: [],
				};
			},
		},
	);

	await assert.rejects(
		adapter.execute({
			brief: imageBriefWithExactText("价格 398"),
			context: contextSnapshot(),
			request: harnessInput("image", "package-image"),
			workflowId: "task-image",
		}),
		(error: unknown) => {
			assert.ok(error instanceof HarnessSelectionError);
			assert.deepEqual(error.gateIds, ["image_exact_text"]);
			assert.match(error.merchantMessage ?? "", /价格 398/u);
			assert.match(error.merchantMessage ?? "", /价格 389/u);
			assert.deepEqual(
				merchantVisibleLanguageIssues(error.merchantMessage ?? ""),
				[],
			);
			return true;
		},
	);
	assert.equal(generation, 2);
});

test("the production exact-text verifier reuses multimodal text.respond without extending supply operations", async () => {
	const submissions: ModelSupplySubmission[] = [];
	const verifier = new ModelSupplyImageExactTextVerifier(
		{
			async submit(input) {
				submissions.push(structuredClone(input));
				return {
					...completedResult("image"),
					asset: undefined,
					operation: "text.respond",
					text: JSON.stringify({
						observedText: ["价格 398"],
						conflictingText: [],
					}),
				};
			},
		},
		notBilledExecutionChildObservability(),
	);
	const request = {
		...harnessInputWithExecutionAssembly("image", "package-image"),
		prompts: frozenPromptBundle(),
	};
	const frozenTextRoute = approvedExactTextRoute();
	const preauthorization = await verifier.preauthorize({
		assetId: "image-asset-1",
		expected: ["价格 398"],
		request,
		route: frozenTextRoute,
		workflowId: "task-image",
	});
	const observation = await verifier.observe({
		assetId: "image-asset-1",
		expected: ["价格 398"],
		request,
		route: frozenTextRoute,
		workflowId: "task-image",
	});
	const assessment = assessImageExactText(observation);

	assert.equal(assessment.passed, true);
	assert.deepEqual(preauthorization, { iterations: 1, costCents: 2 });
	assert.equal(submissions.length, 1);
	assert.equal(submissions[0]?.operation, "text.respond");
	assert.deepEqual(submissions[0]?.frozenRouteSnapshot, frozenTextRoute);
	assert.deepEqual(submissions[0]?.selection, {
		mode: "fixed",
		catalogModelId: "model-text-1",
		fallbackConsent: false,
	});
	assert.deepEqual(submissions[0]?.input?.inputAssets, [
		{ assetId: "image-asset-1", role: "reference_image" },
	]);
	assert.equal(submissions[0]?.promptBinding?.content, "frozen:textResponse");
	assert.equal(submissions[0]?.productUsageQuantity, 0);
});

test("the production exact-text verifier fails closed without a frozen text.respond price", async () => {
	let submissions = 0;
	const verifier = new ModelSupplyImageExactTextVerifier({
		async submit() {
			submissions += 1;
			return {
				...completedResult("image"),
				asset: undefined,
				operation: "text.respond",
				text: "{}",
			};
		},
	});
	const request = harnessInputWithExecutionAssembly(
		"image",
		"package-image-missing-text-price",
	);

	assert.throws(
		() =>
			verifier.preauthorize({
				assetId: "image-asset-1",
				expected: ["价格 398"],
				request,
				route: approvedExactTextRoute("recorded_request"),
				workflowId: "task-image-missing-text-price",
			}),
		/non-request price unit/u,
	);
	assert.equal(submissions, 0);
});

test("the default recorded text price cannot authorize exact-text provider I/O", async () => {
	const exactTextCapabilityProfile: ModelCapabilityProfile = {
		vocabularyVersion: "model-capability-v1",
		protocolCapabilities: {},
		modalities: [
			{
				mime: "text/plain",
				supported: true,
				basis: "explicit_override",
				evidenceRef: "test:default-recorded-text:text",
			},
			{
				mime: "image/*",
				supported: true,
				basis: "explicit_override",
				evidenceRef: "test:default-recorded-text:reference-image",
			},
		],
		businessTags: [],
		modalityCapabilities: [],
	};
	const deployments = createDefaultDeployments({
		activatedDeploymentIds: ["deepseek-v4-pro-direct"],
		activationEvidenceStatus: "recorded",
	}).map((deployment) =>
		deployment.id === "deepseek-v4-pro-direct"
			? {
					...deployment,
					capabilityProfile: exactTextCapabilityProfile,
				}
			: deployment,
	);
	const capabilityHotAssembly = new CapabilityHotAssemblyRegistry();
	capabilityHotAssembly.applyCapabilityRevision(
		projectCapabilityRevision({
			revisionId: "test-default-recorded-text-capability-r1",
			number: 1,
			entries: deployments.map(toRuntimeCapabilityEntry),
			publishedAt: "2026-07-30T00:05:00.000Z",
		}),
	);
	const defaultModels = new ModelSupplyApplicationService({
		assetStorage: new MemoryModelAssetStorage(),
		deployments,
		execution: new RecordedAdapterRouter(),
		models: createDefaultCatalogModels(),
		capabilityHotAssembly,
	});
	const route = await defaultModels.freezeAutoTextRouteForExecution({
		workspaceId: "workspace-default-recorded-text",
		dataClass: [],
	});
	assert.equal(route.allowedCandidates?.[0]?.unit, "recorded_request");
	let providerCalls = 0;
	const verifier = new ModelSupplyImageExactTextVerifier({
		async submit(input) {
			providerCalls += 1;
			return defaultModels.submit(input);
		},
	});

	assert.throws(
		() =>
			verifier.preauthorize({
				assetId: "image-asset-default-recorded-text",
				expected: ["价格 398"],
				request: harnessInputWithExecutionAssembly(
					"image",
					"package-default-recorded-text",
				),
				route,
				workflowId: "task-default-recorded-text",
			}),
		/non-request price unit/u,
	);
	assert.equal(providerCalls, 0);
});

test("a legacy request without execution assembly cannot submit exact-text verification", async () => {
	let submissions = 0;
	const verifier = new ModelSupplyImageExactTextVerifier({
		async submit() {
			submissions += 1;
			return {
				...completedResult("image"),
				asset: undefined,
				operation: "text.respond",
				text: JSON.stringify({
					observedText: ["价格 398"],
					conflictingText: [],
				}),
			};
		},
	});

	await assert.rejects(
		() =>
			verifier.observe({
				assetId: "image-asset-legacy",
				expected: ["价格 398"],
				request: harnessInput("image", "package-legacy-exact-text"),
				route: approvedExactTextRoute(),
				workflowId: "task-legacy-exact-text",
			}),
		/execution assembly is required before provider execution/i,
	);
	assert.equal(submissions, 0);
});

test("a succeeded audit failure does not rewrite successful exact-text verification as rejected", async () => {
	const phases: string[] = [];
	const observer = new AgentPrimitiveObservabilityAdapter(
		{
			append(_workspaceId, event) {
				assert.equal(event.eventType, "agent_primitive.lifecycle");
				if (event.eventType !== "agent_primitive.lifecycle") {
					throw new Error("Expected agent primitive lifecycle event.");
				}
				phases.push(event.payload.phase);
				if (event.payload.phase === "succeeded") {
					throw new Error("terminal exact-text audit unavailable");
				}
				return event;
			},
		},
		{ resolve: () => ({ kind: "not_billed" }) },
	);
	const verifier = new ModelSupplyImageExactTextVerifier(
		{
			async submit() {
				return {
					...completedResult("image"),
					asset: undefined,
					operation: "text.respond",
					text: JSON.stringify({
						observedText: ["价格 398"],
						conflictingText: [],
					}),
				};
			},
		},
		{
			create() {
				return observer;
			},
		},
	);

	await assert.rejects(
		() =>
			verifier.observe({
				assetId: "image-asset-audit-failure",
				expected: ["价格 398"],
				request: harnessInputWithExecutionAssembly(
					"image",
					"package-exact-text-audit-failure",
				),
				route: approvedExactTextRoute(),
				workflowId: "task-image",
			}),
		/terminal exact-text audit unavailable/u,
	);
	assert.deepEqual(phases, ["invoked", "succeeded"]);
});

test("a failed exact-text provider result does not write a successful or rejected lifecycle", async () => {
	const phases: string[] = [];
	const verifier = new ModelSupplyImageExactTextVerifier(
		{
			async submit() {
				return {
					...completedResult("image"),
					asset: undefined,
					operation: "text.respond",
					status: "failed",
				};
			},
		},
		recordingExecutionChildObservability(phases),
	);

	await assert.rejects(
		() =>
			verifier.observe({
				assetId: "image-asset-failed-observation",
				expected: ["价格 398"],
				request: harnessInputWithExecutionAssembly(
					"image",
					"package-exact-text-failed-observation",
				),
				route: approvedExactTextRoute(),
				workflowId: "task-image",
			}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "MEDIA_EXACT_TEXT_VERIFICATION_FAILED",
	);
	assert.deepEqual(phases, ["invoked"]);
});

test("an invalid exact-text observation does not write a successful or rejected lifecycle", async () => {
	const phases: string[] = [];
	const verifier = new ModelSupplyImageExactTextVerifier(
		{
			async submit() {
				return {
					...completedResult("image"),
					asset: undefined,
					operation: "text.respond",
					text: JSON.stringify({
						observedText: "价格 398",
						conflictingText: [],
					}),
				};
			},
		},
		recordingExecutionChildObservability(phases),
	);

	await assert.rejects(() =>
		verifier.observe({
			assetId: "image-asset-invalid-observation",
			expected: ["价格 398"],
			request: harnessInputWithExecutionAssembly(
				"image",
				"package-exact-text-invalid-observation",
			),
			route: approvedExactTextRoute(),
			workflowId: "task-image",
		}),
	);
	assert.deepEqual(phases, ["invoked"]);
});

test("the production exact-text verifier rejects a conflicting value even when the expected value is also visible", async () => {
	const verifier = new ModelSupplyImageExactTextVerifier(
		{
			async submit() {
				return {
					...completedResult("image"),
					asset: undefined,
					operation: "text.respond",
					text: JSON.stringify({
						observedText: ["价格 398", "价格 389"],
						conflictingText: ["价格 389"],
					}),
				};
			},
		},
		notBilledExecutionChildObservability(),
	);
	const observation = await verifier.observe({
		assetId: "image-asset-1",
		expected: ["价格 398"],
		request: harnessInputWithExecutionAssembly("image", "package-image"),
		route: approvedExactTextRoute(),
		workflowId: "task-image-conflict",
	});
	const assessment = assessImageExactText(observation);

	assert.equal(assessment.passed, false);
	assert.deepEqual(assessment.observed, ["价格 398", "价格 389"]);
	assert.match(assessment.reason, /conflicting/u);
});

test("viral image vision sends real reference assets through the frozen text.respond route", async () => {
	const submissions: ModelSupplySubmission[] = [];
	let routeFreezes = 0;
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit(input) {
			submissions.push(structuredClone(input));
			return {
				...completedResult("image", "viral-vision"),
				asset: undefined,
				operation: "text.respond",
				text: JSON.stringify({
					styleSummary: "裸粉柔光杂志风",
					englishImagePrompt: "soft editorial beauty salon scene",
					onImageChineseText: ["夏日清爽护理"],
					negativePrompt: "watermark, medical wound",
					sourceTrack: "paste",
				}),
			};
		},
		async freezeAutoTextRouteForExecution() {
			routeFreezes += 1;
			return approvedExactTextRoute();
		},
	});
	const request = harnessInputWithExecutionAssembly(
		"image",
		"package-viral-vision",
		"image.generate",
		1,
	);
	request.prompts = {
		...request.prompts!,
		xhsViralImageVision: {
			...request.prompts!.xhsViralImageVision,
			content: HARNESS_BUILTIN_PROMPTS.xhsViralImageVision,
		},
	};

	const analysis = await adapter.analyzeViralReferenceImages!({
		assetIds: ["asset-1"],
		request,
		shopContext: "项目名：夏日清爽护理",
		workflowId: "workflow-viral-vision",
	});

	assert.equal(routeFreezes, 1);
	assert.equal(analysis.styleSummary, "裸粉柔光杂志风");
	assert.deepEqual(submissions[0]?.input?.inputAssets, [
		{ assetId: "asset-1", role: "reference_image" },
	]);
	assert.equal(
		submissions[0]?.promptBinding?.name,
		HARNESS_LANGFUSE_PROMPT_NAMES.xhsViralImageVision,
	);
	assert.equal(
		submissions[0]?.billingTaskId,
		request.executionSnapshot?.task.id,
	);
	assert.equal(
		submissions[0]?.billingQuoteRevision,
		request.executionSnapshot?.quote.revision,
	);
	assert.equal(submissions[0]?.selection.mode, "fixed");
	assert.equal(submissions[0]?.productUsageQuantity, 0);
	assert.deepEqual(
		submissions[0]?.frozenRouteSnapshot,
		approvedExactTextRoute(),
	);
	assert.match(submissions[0]?.prompt ?? "", /夏日清爽护理/u);
	assert.doesNotMatch(
		submissions[0]?.prompt ?? "",
		/\{imageNotes\}|\{shopContext\}/u,
	);
});

test("viral image vision fails closed on an invalid provider observation", async () => {
	const adapter = new ModelSupplyHarnessMediaExecutionPort({
		async submit() {
			return {
				...completedResult("image", "viral-vision-invalid"),
				asset: undefined,
				operation: "text.respond" as const,
				text: JSON.stringify({ styleSummary: "missing required fields" }),
			};
		},
		async freezeAutoTextRouteForExecution() {
			return approvedExactTextRoute();
		},
	});
	const request = harnessInputWithExecutionAssembly(
		"image",
		"package-viral-vision-invalid",
		"image.generate",
		1,
	);

	await assert.rejects(
		adapter.analyzeViralReferenceImages({
			assetIds: ["asset-1"],
			request,
			shopContext: "项目名：夏日清爽护理",
			workflowId: "workflow-viral-vision-invalid",
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "VIRAL_IMAGE_VISION_FAILED" &&
			error.status === 502,
	);
});

test("formal viral note planning consumes image vision and skips it when no image was attached", async () => {
	const media = {
		visionCalls: 0,
		async analyzeViralReferenceImages() {
			this.visionCalls += 1;
			return {
				styleSummary: "裸粉柔光杂志风",
				englishImagePrompt: "soft editorial beauty salon scene",
				onImageChineseText: ["夏日清爽护理"],
				negativePrompt: "watermark, medical wound",
				sourceTrack: "paste" as const,
			};
		},
		async execute(): Promise<never> {
			throw new Error("Note planning must not generate page media yet.");
		},
	};
	const ports = new UnifiedHarnessStagePorts(
		noteCopyPorts(),
		noteRunnerFactory(),
		media,
		undefined as never,
		() => "2026-08-02T00:00:00.000Z",
		{
			async read() {
				return {
					styles: {
						styles: [
							{
								id: "facts",
								name: "干货版",
								writingGuide: "清楚说明",
								structureTemplate: "结论、依据、行动",
								platforms: ["xiaohongshu" as const],
							},
						],
					},
				};
			},
		},
		undefined,
		notBilledExecutionChildObservability(),
	);
	const declaration = {
		normalizedIntent: "介绍夏日护理项目",
		taskType: "daily_service_exposure" as const,
		deliveryLayer: "finished_media" as const,
		relevantAssetCategories: ["product_service" as const],
		usedAssetCategories: ["product_service" as const],
		route: "customized" as const,
		routingSource: "model" as const,
		implicitConstraints: [],
	};

	const withImage = viralNoteRequest(["asset-reference-1"]);
	const imageBrief = await ports.compileNoteBrief({
		workflowId: "workflow-viral-with-image",
		request: withImage,
		declaration,
		context: contextSnapshot(["asset-reference-1"]),
		allowedFactRefs: ["fact-service-1"],
	});
	assert.equal(media.visionCalls, 1);
	assert.match(
		imageBrief.candidates.candidates[0]!.plan.pages[0]!.imageIntent.scene,
		/裸粉柔光杂志风/u,
	);
	assert.match(
		imageBrief.candidates.candidates[0]!.plan.pages[0]!.imageIntent.composition,
		/soft editorial beauty salon scene/u,
	);
	assert.match(
		imageBrief.candidates.candidates[0]!.plan.pages[0]!.imageIntent.composition,
		/夏日清爽护理/u,
	);

	const withoutImage = viralNoteRequest([]);
	await ports.compileNoteBrief({
		workflowId: "workflow-viral-without-image",
		request: withoutImage,
		declaration,
		context: contextSnapshot([]),
		allowedFactRefs: ["fact-service-1"],
	});
	assert.equal(
		media.visionCalls,
		1,
		"no image must make zero additional VLM calls",
	);

	const mismatchedRecipe = {
		...withoutImage,
		executionSnapshot: creationExecutionSnapshotSchema.parse({
			...withoutImage.executionSnapshot!,
			recipe: {
				id: "recipe-image_text_note-1",
				revision: "recipe-image_text_note-r1",
			},
		}),
		executionAssembly: {
			...withoutImage.executionAssembly!,
			rootAxes: {
				...withoutImage.executionAssembly!.rootAxes,
				scene: { kind: "bound" as const, value: "recipe-image_text_note-1" },
			},
		},
	};
	await assert.rejects(
		ports.compileNoteBrief({
			workflowId: "workflow-viral-wrong-recipe",
			request: mismatchedRecipe,
			declaration,
			context: contextSnapshot([]),
			allowedFactRefs: ["fact-service-1"],
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "VIRAL_ADAPT_RECIPE_MISMATCH",
	);

	const unauthorizedImage = viralNoteRequest(["asset-reference-unauthorized"]);
	await assert.rejects(
		ports.compileNoteBrief({
			workflowId: "workflow-viral-unauthorized-image",
			request: unauthorizedImage,
			declaration,
			context: contextSnapshot([]),
			allowedFactRefs: ["fact-service-1"],
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "VIRAL_ADAPT_SOURCE_MISMATCH",
	);
	assert.equal(
		media.visionCalls,
		1,
		"unauthorized images must not reach the VLM",
	);

	const withdrawnContext = contextSnapshot(["asset-reference-1"]);
	withdrawnContext.policyReferences.rightsRefs[0]!.status = "withdrawn";
	await assert.rejects(
		ports.compileNoteBrief({
			workflowId: "workflow-viral-withdrawn-image",
			request: withImage,
			declaration,
			context: withdrawnContext,
			allowedFactRefs: ["fact-service-1"],
		}),
		(error: unknown) =>
			error instanceof HarnessMediaExecutionError &&
			error.code === "VIRAL_ADAPT_SOURCE_MISMATCH",
	);
	assert.equal(media.visionCalls, 1, "withdrawn rights must not reach the VLM");
});

function harnessInput(
	kind: "image" | "image_text_note" | "video",
	packageId: string,
	imageOperation:
		| "image.generate"
		| "image.edit"
		| "image.reference_transform" = "image.edit",
	imageReferenceCount = 1,
): HarnessWorkflowInput {
	const sourceAssets = Array.from(
		{
			length:
				kind === "image"
					? imageReferenceCount
					: kind === "image_text_note"
						? 0
						: 1,
		},
		(_, index) => ({
			id: `asset-${index + 1}`,
			revision: `asset-r${index + 1}`,
			role: "reference" as const,
		}),
	);
	const snapshot = createCreationExecutionSnapshot(
		{
			actorId: "owner-1",
			workspaceId: "workspace-1",
			idempotencyKey: `submission-${kind}-1`,
			taskId: `task-${kind}`,
			workId: "work-1",
			contentPackageId: packageId,
			expectedContentPackageRevision: 0,
			creationMode: "customized",
			intent: "把夏日护理项目做成可发布的素材",
			surface: { id: "surface-1", revision: "surface-r1" },
			recipe: { id: `recipe-${kind}-1`, revision: `recipe-${kind}-r1` },
			lens: kind,
			operation:
				kind === "video"
					? "video.generate"
					: kind === "image"
						? imageOperation
						: "image.generate",
			platform: { id: "douyin" },
			contentPackagePlatform: "douyin",
			distributionTarget: "export",
			deliverable: {
				kind:
					kind === "video"
						? "video_package"
						: kind === "image_text_note"
							? "note"
							: "image_set",
				quantity: 1,
				aspectRatio: "9:16",
				...(kind === "video" ? { durationSeconds: 8 } : {}),
				...(kind === "image_text_note" ? { notePageBound: 3 } : {}),
			},
			deliverables: [
				{
					id: `${kind}-main`,
					kind,
					order: 0,
					quantity: 1,
					aspectRatio: "9:16",
					...(kind === "video" ? { durationSeconds: 8 } : {}),
					...(kind === "image_text_note" ? { notePageBound: 3 } : {}),
				},
			],
			sources: {
				assets: sourceAssets,
			},
			rights: { revision: "rights-r1", summary: "authorized" },
			identity: { id: "identity-1", revision: "identity-r1" },
			modelPolicy: { id: "policy-1", revision: "policy-r1", mode: "fixed" },
			catalogModel: { id: `model-${kind}-1`, revision: `model-${kind}-r1` },
			quote: { id: "quote-1", revision: "quote-r1" },
			route: { id: "route-1", revision: "route-r1" },
			briefContext: { id: "brief-context-1", revision: 1 },
			briefConfirmation: { id: "brief-1", revision: "brief-r1" },
			contentModules: ["social_cover"],
		},
		"2026-07-22T09:00:00.000Z",
	);
	return {
		actorId: snapshot.actorId,
		workspaceId: snapshot.workspaceId,
		packageId,
		expectedRevision: snapshot.contentPackage.expectedRevision,
		workflowRevision: snapshot.revision,
		creationMode: snapshot.creationMode,
		rawInput: snapshot.intent.text,
		intent: {
			context: {
				workId: snapshot.work.id,
				intent: snapshot.intent.text,
				sourceSummaries: [],
			},
			assetReferences: sourceAssets.map(({ id }) => id),
		},
		executionSnapshot: snapshot,
		frozenRouteSnapshot: frozenMediaRoute(snapshot),
	};
}

function viralNoteRequest(
	imageAssetIds: readonly string[],
): HarnessWorkflowInput {
	const request = harnessInputWithExecutionAssembly(
		"image_text_note",
		`package-viral-note-${imageAssetIds.length}`,
	);
	const rawInput = composeViralAdaptRawInput({
		track: "paste",
		noteText: "姐妹们，清爽护理三步走",
		imageAssetIds,
	});
	const sourceAssets = imageAssetIds.map((id, index) => ({
		id,
		revision: `asset-r${index + 1}`,
		role: "reference" as const,
	}));
	const executionSnapshot = creationExecutionSnapshotSchema.parse({
		...request.executionSnapshot!,
		intent: {
			...request.executionSnapshot!.intent,
			text: rawInput,
		},
		recipe: { id: "recipe.viral_adapt", revision: "recipe.viral_adapt@2" },
		sources: { assets: sourceAssets },
	});
	return {
		...request,
		rawInput,
		intent: {
			...request.intent,
			assetReferences: [...imageAssetIds],
			context: {
				...request.intent.context,
				intent: rawInput,
			},
		},
		executionSnapshot,
		executionAssembly: {
			...request.executionAssembly!,
			rootAxes: {
				...request.executionAssembly!.rootAxes,
				scene: { kind: "bound", value: "recipe.viral_adapt" },
			},
		},
	};
}

function boundedExecutionSnapshot(iterations: number, maxIterations: number) {
	return {
		schemaVersion: "bounded-execution-snapshot/v1" as const,
		maxIterations,
		maxCostCents: 500,
		maxWallClockMs: 60_000,
		maxDelegations: "unset" as const,
		requiredLimits: [
			"maxIterations" as const,
			"maxCostCents" as const,
			"maxWallClockMs" as const,
		],
		consumption: {
			iterations,
			costCents: 0,
			wallClockMs: 0,
			delegations: 0,
		},
		stopReason: null,
		triggeredLimit: null,
	};
}

function harnessInputWithExecutionAssembly(
	kind: "image" | "image_text_note" | "video",
	packageId: string,
	imageOperation:
		| "image.generate"
		| "image.edit"
		| "image.reference_transform" = "image.edit",
	imageReferenceCount = 1,
): HarnessWorkflowInput {
	const request = harnessInput(
		kind,
		packageId,
		imageOperation,
		imageReferenceCount,
	);
	const route = request.frozenRouteSnapshot!;
	const prompts = frozenPromptBundle();
	const promptRevisionRefs = promptRevisionReferences(prompts);
	return {
		...request,
		prompts,
		promptRevisionRefs,
		executionAssembly: {
			schemaVersion: "harness-execution-assembly/v1",
			workflowId: request.executionSnapshot!.task.id,
			skillStages: {
				intent_naming: [],
				context_injection: [],
				brief_compilation: [],
				execution_selection: [],
				assembly_delivery: [],
			},
			frozenRouteSnapshotDigest: fingerprintValue(route),
			promptRevisionRefs,
			rootAxes: {
				axisScope: "task_root",
				skillRevision: { kind: "absent" },
				promptVersion: { kind: "absent" },
				catalogRevision: {
					kind: "bound",
					value: request.executionSnapshot!.catalogModel.revision,
				},
				scene: {
					kind: "bound",
					value: request.executionSnapshot!.recipe.id,
				},
			},
		},
	};
}

function notBilledExecutionChildObservability() {
	const observer = new AgentPrimitiveObservabilityAdapter(
		new MemoryObservabilityEventAudit(),
		{ resolve: () => ({ kind: "not_billed" }) },
	);
	return {
		create() {
			return observer;
		},
	};
}

function recordingExecutionChildObservability(phases: string[]) {
	const observer = new AgentPrimitiveObservabilityAdapter(
		{
			append(_workspaceId, event) {
				assert.equal(event.eventType, "agent_primitive.lifecycle");
				if (event.eventType === "agent_primitive.lifecycle") {
					phases.push(event.payload.phase);
				}
				return event;
			},
		},
		{ resolve: () => ({ kind: "not_billed" }) },
	);
	return {
		create() {
			return observer;
		},
	};
}

function frozenMediaRoute(
	snapshot: NonNullable<HarnessWorkflowInput["executionSnapshot"]>,
): NonNullable<HarnessWorkflowInput["frozenRouteSnapshot"]> {
	return {
		id: snapshot.route.id,
		catalogRevisionId: snapshot.route.revision,
		requestedSelection: {
			mode: "fixed",
			catalogModelId: snapshot.catalogModel.id,
		},
		candidateCatalogModelIds: [snapshot.catalogModel.id],
		actualCatalogModelId: snapshot.catalogModel.id,
		deploymentId: `deployment-${snapshot.lens}-1`,
		reason: "fixed_selection",
		dataClass: [],
		createdAt: "2026-07-22T09:00:00.000Z",
	};
}

function approvedExactTextRoute(
	unit = "request",
	unitPriceMicros = 20_000,
): RouteSnapshot {
	return {
		id: "route-exact-text-1",
		catalogRevisionId: "catalog-text-r1",
		requestedSelection: {
			mode: "fixed",
			catalogModelId: "model-text-1",
			fallbackConsent: false,
		},
		candidateCatalogModelIds: ["model-text-1"],
		actualCatalogModelId: "model-text-1",
		deploymentId: "deployment-text-1",
		fallbackConsent: false,
		maxAttempts: 1,
		fallbackAuthorized: false,
		allowedCandidates: [
			{
				catalogModelId: "model-text-1",
				deploymentId: "deployment-text-1",
				modelModality: "llm",
				modelOperations: ["text.respond"],
				modelDisplayName: "Text verifier",
				modelQualityRank: 100,
				modelManufacturer: "Recorded",
				modelCapabilities: ["text.respond"],
				apiFamily: "openai",
				channel: "direct",
				region: "domestic",
				deploymentStatus: "active",
				allowedDataClasses: null,
				stableModelName: "model-text-1",
				modelVersion: "v1",
				credentialMode: "platform",
				credentialVersion: "credential-v1",
				policyRevision: "policy-v1",
				priceRevision: "approved-text-price-r1",
				unitPriceMicros,
				currency: "CNY",
				unit,
				fallbackRank: 1,
			},
		],
		reason: "fixed_selection",
		dataClass: [],
		createdAt: "2026-07-29T00:00:00.000Z",
	};
}

function mediaBrief(kind: "image"): Extract<ExecutionBrief, { kind: "image" }>;
function mediaBrief(kind: "video"): Extract<ExecutionBrief, { kind: "video" }>;
function mediaBrief(
	kind: "image" | "video",
): Exclude<ExecutionBrief, { kind: "copy" }>;
function mediaBrief(
	kind: "image" | "video",
): Exclude<ExecutionBrief, { kind: "copy" }> {
	if (kind === "image") {
		return imageBriefFor("image.edit", 1);
	}
	return {
		kind,
		firstFramePrompt:
			"夏日护理项目门店开场，展示明确的品牌主视觉和预约行动号召。",
		storyboard: [
			{
				index: 1,
				description: "门店护理场景与主视觉展示。",
				durationSeconds: 8,
			},
		],
		referenceAssetIds: ["asset-1"],
		parameters: { durationSeconds: 8, ratio: "9:16" },
		constraints: ["不得编造价格"],
	};
}

function imageBriefFor(
	operation: "image.generate" | "image.edit" | "image.reference_transform",
	referenceCount: number,
): Extract<ExecutionBrief, { kind: "image" }> {
	const referenceAssetIds = Array.from(
		{ length: referenceCount },
		(_, index) => `asset-${index + 1}`,
	);
	return {
		kind: "image",
		intent: {
			operation,
			purpose: "夏日护理活动海报",
			subject: "夏日护理项目",
			scene: "门店护理区",
			composition: "竖版主视觉",
			references: referenceAssetIds.map((assetId, index) => ({
				assetId,
				assetRevision: `asset-r${index + 1}`,
				slot:
					operation === "image.edit"
						? ("work_case" as const)
						: index === 0
							? ("style_ref" as const)
							: ("composition_ref" as const),
				mimeType: "image/png",
				sizeBytes: 1_024,
				factRefs: operation === "image.edit" ? ["fact:work-case:1"] : [],
				rightsRefs: [],
			})),
			exactText: [],
			changes:
				operation === "image.edit"
					? [{ target: "layout", instruction: "调整活动信息布局" }]
					: [],
			invariants:
				operation === "image.edit"
					? [
							{
								target: "work_case_surface",
								requirement: "保持真实甲面不变",
							},
						]
					: [],
			factRefs: operation === "image.edit" ? ["fact:work-case:1"] : [],
			rightsRefs: [],
			outputPlan: { kind: "single" },
		},
		prompt:
			"为夏日护理项目生成竖版门店活动海报，保留品牌主视觉和预约行动号召。",
		referenceAssetIds,
		parameters: { ratio: "9:16", resolution: "1080p" },
		constraints: ["不得编造价格"],
	};
}

function imageBriefWithExactText(
	text: string,
): Extract<ExecutionBrief, { kind: "image" }> {
	const brief = mediaBrief("image");
	return {
		...brief,
		intent: {
			...brief.intent,
			exactText: [{ text, treatment: "exact" }],
		},
	};
}

function completedResult(
	kind: "image" | "video",
	suffix = "1",
): ModelSupplyResult {
	const attempt = {
		acceptance: "accepted" as const,
		catalogModelId: `model-${kind}-1`,
		createdAt: "2026-07-22T09:00:00.000Z",
		deploymentId: `deployment-${kind}-1`,
		id: `attempt-${kind}-${suffix}`,
		jobId: `job-${kind}-${suffix}`,
		providerTaskRef: `provider-task-${kind}-${suffix}`,
		status: "completed" as const,
	};
	const providerCost = {
		amount: 1.2,
		currency: "CNY" as const,
		id: `cost-${kind}-${suffix}`,
		status: "observed" as const,
		usage: { mediaUnits: 1 },
	};
	return {
		jobId: `job-${kind}-${suffix}`,
		latencyMs: 25,
		status: "completed",
		snapshot: {
			actualCatalogModelId: `model-${kind}-1`,
			catalogRevisionId: `model-${kind}-r1`,
			deploymentId: `deployment-${kind}-1`,
			id: `route-${kind}-1`,
		} as ModelSupplyResult["snapshot"],
		attempt,
		attempts: [attempt],
		asset: {
			contentType: kind === "image" ? "image/png" : "video/mp4",
			id: `${kind}-asset-${suffix}`,
			objectKey: `owned/${kind}-asset-${suffix}`,
			sha256: `${kind}-sha-${suffix}`,
			sizeBytes: 1024,
			sourceTaskRef: `provider-task-${kind}-${suffix}`,
			...(kind === "video"
				? {
						technicalValidation: {
							playable: true,
							codec: "h264" as const,
							durationSeconds: 8,
							hashVerified: true,
							evidenceKind: "measured" as const,
						},
					}
				: {}),
		},
		usage: {
			id: `usage-${kind}-${suffix}`,
			quantity: 0,
			status: "committed",
		},
		providerCost,
		providerCosts: [providerCost],
	};
}

function noteCopyPorts(): HarnessStagePorts {
	const unsupported = async (): Promise<never> => {
		throw new Error("Only intent naming is used by the note test.");
	};
	return {
		async nameIntent() {
			return {
				declaration: {
					normalizedIntent: "介绍夏日护理项目",
					taskType: "daily_service_exposure",
					deliveryLayer: "finished_media",
					relevantAssetCategories: ["product_service"],
					usedAssetCategories: ["product_service"],
					route: "customized",
					routingSource: "model",
					implicitConstraints: [],
				},
				blockingQuestion: null,
			};
		},
		injectContext: unsupported,
		fenceContext: unsupported,
		compileBrief: unsupported,
		executeAndSelect: unsupported,
		assembleAndDeliver: unsupported,
	};
}

function noteRunnerFactory(
	conflictBeforeRegeneration = false,
): HarnessStructuredNodeRunnerFactory {
	return {
		create() {
			let consistencyAttempts = 0;
			return {
				async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
					const payload = JSON.parse(request.prompt) as Record<string, unknown>;
					let output: unknown;
					if (request.schemaName === "harness_note_plan_v1") {
						output = notePlanOutput();
					} else if (request.schemaName === "harness_note_text_block_v1") {
						const page = payload.page as {
							pageRole: string;
							textBlock: { exactText: string[] };
						};
						const style = payload.style as { name: string };
						output = {
							title: `${style.name}-${page.pageRole}`,
							body: `${style.name}说明${page.pageRole}`,
							exactText: page.textBlock.exactText,
						};
					} else if (request.schemaName === "harness_note_consistency_v1") {
						const conflict =
							conflictBeforeRegeneration && consistencyAttempts++ === 0;
						output = {
							evaluatedAt: "2026-07-22T09:00:01.000Z",
							dimensions: [
								"theme_continuity",
								"visual_consistency",
								"non_repetition",
								"role_coverage",
								"image_text_cross_reference",
							].map((dimension) => ({
								dimension,
								passed: !conflict,
								reason: `${dimension} passed`,
								pageIds: conflict ? ["page-2"] : [],
							})),
							regenerationPageIds: conflict ? ["page-2"] : [],
						};
					} else {
						throw new Error(`Unexpected schema ${request.schemaName}.`);
					}
					return {
						output: request.schema.parse(output),
						attempts: 1,
						providerTaskRef: `fixture-${request.schemaName}`,
						replayed: false,
						usage: { inputTokens: 1, outputTokens: 1 },
					};
				},
			};
		},
	};
}

function notePlanOutput() {
	const page = (
		id: string,
		order: number,
		pageRole: "cover" | "cta_guide",
		pagePurpose: "capture_attention" | "drive_action",
	) => ({
		id,
		order,
		revision: 1,
		pageRole,
		pagePurpose,
		imageIntent: {
			operation: "image.generate",
			purpose: `${pageRole}配图`,
			subject: "夏日护理项目",
			scene: "真实门店场景",
			composition: "主体清晰",
			references: [],
			exactText: [],
			changes: [],
			invariants: [],
			factRefs: [],
			rightsRefs: [],
			outputPlan: { kind: "single" },
		},
		textBlock: {
			title: `${pageRole}标题`,
			body: `${pageRole}正文`,
			exactText: [],
		},
		dependencies:
			order === 1 ? [] : [{ pageId: "page-1", kind: "text_sequence" }],
	});
	return {
		schema: "note-plan/v1",
		themeAnchor: "夏日护理项目",
		style: {
			id: "planning",
			name: "规划中",
			positioning: "等待风格选择",
		},
		pages: [
			page("page-1", 1, "cover", "capture_attention"),
			page("page-2", 2, "cta_guide", "drive_action"),
		],
	};
}

function unsupportedCopyPorts(): HarnessStagePorts {
	const unsupported = async (): Promise<never> => {
		throw new Error("Copy stage must not run for a frozen media snapshot.");
	};
	return {
		nameIntent: unsupported,
		injectContext: unsupported,
		fenceContext: unsupported,
		compileBrief: unsupported,
		executeAndSelect: unsupported,
		assembleAndDeliver: unsupported,
	};
}

function contextSnapshot(
	authorizedAssetIds: readonly string[] = ["asset-1"],
): HarnessContextSnapshot {
	return {
		bundle: {
			bundleId: "bundle-1",
			revision: 1,
			hash: "a".repeat(64),
			serializerVersion: "context-bundle-c14n-v1",
			workspaceId: "workspace-1",
			taskId: "task-image",
			frozenAt: "2026-07-22T09:00:00.000Z",
			frozenBy: "owner-1",
			previousRevision: null,
			referencedFactRevisions: [],
			sourceRevisions: {
				facts: 0,
				assets: 1,
				identity: 1,
				rights: 1,
				preferences: 0,
				recipe: 1,
				platformRules: 1,
				currentSignal: 1,
			},
			dimensions: {
				promotion_task: {},
				traffic_opportunity: {},
				expression_identity: {},
				platform_mechanism: {},
				store_facts_assets: {},
				conversion_action: {},
			},
		},
		activeFacts: [],
		policyReferences: {
			sourceRefs: [],
			rightsRefs: authorizedAssetIds.map((assetId) => ({
				assetId,
				workspaceId: "workspace-1",
				status: "authorized" as const,
				allowedUses: ["public_content"] as const,
			})),
			identityRefs: [
				{
					id: "marketing_identity:identity-1:identity-r1",
					workspaceId: "workspace-1",
					status: "registered",
				},
			],
		},
	};
}

function memoryNoteAdmission(events: string[] = []): NoteMediaAdmissionPort {
	let active: NoteMediaAdmissionToken | undefined;
	let generation = 0;
	return {
		async claim(input) {
			if (active) {
				if (active.workflowId === input.workflowId) return active;
				events.push(`blocked:${input.workflowId}`);
				return null;
			}
			generation += 1;
			active = { ...input, generation };
			events.push(`claim:${input.workflowId}:g${generation}`);
			return active;
		},
		async markRunning(token, jobId) {
			if (active?.generation !== token.generation) return false;
			active = { ...active, jobId };
			events.push(`running:g${token.generation}`);
			return true;
		},
		async markTerminal(token, status) {
			if (active?.generation !== token.generation) return false;
			events.push(`${status}:g${token.generation}`);
			active = undefined;
			return true;
		},
	};
}

function frozenPromptBundle(): HarnessFrozenPrompts {
	return Object.fromEntries(
		Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES).map(([key, name]) => {
			const content = `frozen:${key}`;
			return [
				key,
				{
					name,
					version: "31",
					content,
					contentHash: createHash("sha256").update(content).digest("hex"),
					label: "production",
					source: "langfuse",
					isFallback: false,
				},
			];
		}),
	) as HarnessFrozenPrompts;
}
