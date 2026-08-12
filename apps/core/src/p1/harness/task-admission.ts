import {
  agentPrimitiveLifecycleEventSchema,
  boundedExecutionLimitsSchema,
  boundedExecutionSnapshotSchema,
  executionPlanSnapshotSchema,
  HARNESS_STAGES,
  harnessTaskSubmissionSchema,
  MODEL_CAPABILITY_VOCABULARY_VERSION,
  modelCapabilityMimeSchema,
  modelCapabilityRequirementAxisSchema,
  reuseTaskSeedSchema,
  storeFactScopeSchema,
  taskIntentInputSchema,
  type BoundedExecutionLimitName,
  type BoundedExecutionLimits,
  type BoundedExecutionSnapshot,
  type ExecutionPlanSnapshot,
  type HarnessStage,
  type ModelCapabilityRequirementAxis,
  type AgentPrimitiveLifecycleEvent,
  type PlanConfirmationDecision,
  observabilityAxisBindingSchema,
  type ObservabilityAxisBinding,
  type ReuseTaskSeed,
  type StoreFact,
  type TaskIntentInput,
} from '@meiye/contracts';
import { z } from 'zod';

import {
  buildBillingIdentity,
  type BillingIdentity,
} from '../execution-spine/billing-identity.js';
import {
  creationExecutionSnapshotSchema,
  type CreationExecutionSnapshot,
} from '../execution-spine/creation-execution-snapshot.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import type {
  CreateExecutionConfirmationAuthorityInput,
} from '../agent-session/execution-confirmation-authority.js';
import type {
  ConfirmationTransactionClient,
  StoredConfirmationRequest,
} from '../agent-session/execution-confirmation-store.js';
import type {
  ConfirmationAuthorityStore,
  PendingConfirmationAuthority,
} from '../agent-session/execution-confirmation-authority-store.js';
import type {
  ConfirmationCreditTransactionPort,
  CreateExecutionConfirmationResult,
} from '../agent-session/execution-confirmation-service.js';
import type { AgentThreadIdentity } from '../execution-spine/submission-coordinator.js';
import { asAgentThreadIdentity } from '../execution-spine/submission-coordinator.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { RouteSnapshot } from '../model-supply/index.js';
import { serverAuditReference } from '../creation-experience/creation-experience-events.js';
import type { ResolvedSkillInstruction } from '../skills/types.js';
import type {
  ExecutionPlanAdmissionPort,
  ExecutionPlanCompileFreeze,
  PendingExecutionPlanSnapshot,
  SnapshotLiveFacts,
} from './execution-plan-admission.js';
import {
  assembleExecutionPlanSnapshot,
  assemblePendingExecutionPlanSnapshot,
  freezeExecutionPlanContent,
} from './execution-plan-admission.js';
import {
  harnessPromptCapabilityRequirement,
  promptRevisionReferences,
  promptTraceReference,
  resolveHarnessPromptKeys,
} from './langfuse-prompts.js';
import type {
  HarnessFrozenPrompts,
  HarnessPromptKey,
  HarnessPromptResolver,
  HarnessPromptRevisionReference,
} from './langfuse-prompts.js';
import {
  COPY_TASK_PROMPT_PACK_IDS,
  promptKeysForAllPacks,
  promptKeysForPacks,
  type HarnessPromptPackId,
} from './prompt-packs.js';

export interface HarnessWorkflowInput {
	/** Session-owned identity; never substitute planId or workflowId. */
	agentThreadId?: AgentThreadIdentity;
	/** Persisted Session Run authority; absent only on legacy durable requests. */
	agentRunId?: string;
	artifactLineage?: {
	  artifactId: string;
	  parentRevision: number;
	  targetUnitIds?: string[];
	  sourceUnitMappings?: Array<{ sourceUnitId: string; executionUnitId: string }>;
	};
  actorId: string;
  workspaceId: string;
  packageId: string;
  expectedRevision: number;
  workflowRevision: number;
  creationMode: 'customized' | 'free';
  rawInput: string;
  /** Versioned workflow authority for a mutable Living Plan revision. */
  preparedAttemptId?: string;
  sourceTaskId?: string;
  /** Server-selected ProductBilling task key, frozen before paid admission. */
  billingTaskId?: string;
  /** Carrier selected by the server-owned compile freeze; `single` otherwise. */
  carrierUnitId?: string;
  /** Complete server-owned carrier set for the Work aggregate. */
  carrierUnitIds?: readonly string[];
  /** Frozen quantity owned by the current carrier. */
  carrierBillableUnits?: number;
  intent: TaskIntentInput;
  /**
   * Merchant-confirmed Skill revision refs for this task. Optional on legacy
   * callers; Composer snapshot path always materializes an array (default []).
   * Production select forwards this into stage resolution (#379).
   */
  userSelectedSkillRefs?: readonly string[];
  factScope?: StoreFact['scope'];
  decisionReferences?: Array<{
    id: string;
    field: string;
    value: string;
    revision: number;
  }>;
  reuseSeed?: ReuseTaskSeed;
  /** Present only for new Composer submissions on the execution spine. */
  executionSnapshot?: CreationExecutionSnapshot;
  /** Canonical product units frozen by the Coordinator for that submission. */
  usageReservation?: CreationSubmissionRecord['usageReservation'];
  /** Missing only from durable requests admitted before bounded execution was introduced. */
  boundedExecution?: BoundedExecutionSnapshot;
  /** Server-owned execution route frozen at admission; callers cannot provide it. */
  frozenRouteSnapshot?: RouteSnapshot;
  prompts?: HarnessFrozenPrompts;
  /** Explicit prompt lineage copied into the durable task request snapshot. */
  promptRevisionRefs?: Record<string, HarnessPromptRevisionReference>;
  /** Server-owned D-165 assembly snapshot bound to the DBOS workflow ID. */
  executionAssembly?: HarnessExecutionAssemblySnapshot;
  /**
   * V31-12 frozen Session→Make handoff. When present, task-admission one-shot
   * writes the ExecutionPlanSnapshot row (sole writer). Absent ⇒ legacy replay.
   */
  executionPlanSnapshot?: ExecutionPlanSnapshot;
  /** Durable frozen content while a paid Work waits for its immutable decision. */
  pendingExecutionPlanSnapshot?: PendingExecutionPlanSnapshot;
  /** Deterministic request identity for the currently frozen confirmation attempt. */
  executionConfirmationRequestId?: string;
  /** Exact credit operation owned by the current confirmation attempt. */
  executionConfirmationReservationIdempotencyKey?: string;
  /** Credits durably held for the exact pending confirmation attempt. */
  executionConfirmationReservedCredits?: number;
  /** Merchant-visible stale fields that caused the current re-confirmation. */
  executionConfirmationDiffFields?: string[];
  /** Campaign Works carry the full U7 triple and never inherit plan approval. */
  executionConfirmationContext?: {
    campaignPlanRef: { id: string; revision: number | string };
    workOrdinal: number;
    approvalScope: 'single_work';
  };
  /**
   * V31-12 compile-finalize freeze produced by the Composer plan session.
   * Submit-input only: normalizeRequest strips it before the durable request,
   * fingerprint, and registry claim. The full snapshot is assembled inside
   * submit once prompts/skills/routes/bounds have resolved.
   */
  executionPlanFreeze?: ExecutionPlanCompileFreeze;
  /**
   * V31-47: package-level confirmation decision for secondary carrier Makes.
   * Submit-input only (stripped by normalizeRequest). When present with a
   * merchant_confirmed freeze, admission assembles + admits the snapshot
   * immediately and does not open a second confirmation/reserve.
   */
  packageConfirmationDecisionRef?: string;
  /**
   * Durable primary confirmation request for a secondary carrier Make. It is
   * resolved server-side so every carrier freezes the exact same reservation.
   */
  packageConfirmationRequestId?: string;
  /**
   * R-P0-05: canonical billing identity frozen at admission from the frozen
   * request. Settle/refund/hold-expiry/replay accept only this identity;
   * missing or inconsistent fails closed — no workflowId ?? sourceTaskId
   * guesses downstream.
   */
  billingIdentity?: BillingIdentity;
}

export interface HarnessSkillManifestSnapshot {
  skillRevisionRef: string;
  contentHash: string;
  requiredModelCapabilities: string[];
  /** Full server-resolved execution material frozen at admission for new tasks. */
  resolvedInstruction?: ResolvedSkillInstruction;
}

export interface HarnessReleasePromptBindingsResolver {
  resolvePromptBindings(
    request: HarnessTaskRequest,
  ): Promise<Record<string, { key: string; version: string }>>;
}

export type HarnessSkillManifestSelection = Omit<
  HarnessSkillManifestSnapshot,
  'resolvedInstruction'
>;

export interface HarnessExecutionAssemblySnapshot {
  schemaVersion: 'harness-execution-assembly/v1';
  workflowId: string;
  skillStages: Record<HarnessStage, HarnessSkillManifestSnapshot[]>;
  /** Integrity reference to the #240-owned frozen RouteSnapshot carrier. */
  frozenRouteSnapshotDigest: string;
  promptRevisionRefs: Record<string, HarnessPromptRevisionReference>;
  rootAxes: ObservabilityAxisBinding;
}

export type HarnessExecutionAssemblyStep =
  | 'manifest_resolution'
  | 'hot_assembly'
  | 'prompt_resolution'
  | 'task_pin'
  | 'execution_check'
  | 'event_persistence';

export interface HarnessTaskRequest extends Omit<
  HarnessWorkflowInput,
  | 'boundedExecution'
  | 'executionAssembly'
  | 'frozenRouteSnapshot'
  | 'prompts'
  | 'promptRevisionRefs'
> {
  taskId: string;
  /** Versioned plan attempts retain the immutable source Composer task. */
  sourceTaskId?: string;
  /**
   * Admission-time live facts for stale-confirm rejection (V31-12).
   * Not part of the durable workflow input / fingerprint.
   */
  executionPlanLiveFacts?: SnapshotLiveFacts;
}

export type HarnessWorkflowInputBeforeBounds = Omit<
  HarnessWorkflowInput,
  | 'boundedExecution'
  | 'executionAssembly'
  | 'frozenRouteSnapshot'
  | 'prompts'
  | 'promptRevisionRefs'
>;

export interface HarnessFrozenRouteSnapshotResolver {
  resolve(
    snapshot: CreationExecutionSnapshot,
    input?: { requirements: ModelCapabilityRequirementAxis[] },
  ): Promise<RouteSnapshot>;
}

export interface HarnessSkillManifestResolver {
  select(input: {
    request: HarnessWorkflowInputBeforeBounds;
    stage: HarnessStage;
  }): Promise<HarnessSkillManifestSelection[]>;
  materialize(input: {
    request: HarnessWorkflowInputBeforeBounds;
    stage: HarnessStage;
    manifests: readonly HarnessSkillManifestSelection[];
  }): Promise<HarnessSkillManifestSnapshot[]>;
}

export const harnessTaskRequestSchema = harnessTaskSubmissionSchema
  .extend({
		agentThreadId: z.string().trim().min(1).optional(),
		agentRunId: z.string().trim().min(1).optional(),
		artifactLineage: z.object({
		  artifactId: z.string().trim().min(1),
		  parentRevision: z.number().int().positive(),
		  targetUnitIds: z.array(z.string().trim().min(1)).min(1).optional(),
		  sourceUnitMappings: z.array(z.object({
			sourceUnitId: z.string().trim().min(1),
			executionUnitId: z.string().trim().min(1),
		  }).strict()).min(1).optional(),
		}).strict().optional(),
    actorId: z.string().trim().min(1),
    workspaceId: z.string().trim().min(1),
    packageId: z.string().trim().min(1),
    expectedRevision: z.number().int().nonnegative(),
    workflowRevision: z.number().int().nonnegative(),
    creationMode: z.enum(['customized', 'free']),
    rawInput: z.string().trim().min(1),
    intent: taskIntentInputSchema,
    factScope: storeFactScopeSchema.optional(),
    reuseSeed: reuseTaskSeedSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.agentRunId && !request.agentThreadId) {
      context.addIssue({
        code: 'custom',
        path: ['agentThreadId'],
        message: 'agentRunId requires agentThreadId.',
      });
    }
  });

export interface HarnessTaskRequestRegistry {
  lookup?(input: {
    taskId: string;
    fingerprint: string;
    request: HarnessWorkflowInput;
  }): Promise<
    | {
        kind: 'existing';
        workflowId: string;
        runtimeId?: string;
        request: HarnessWorkflowInput;
      }
    | { kind: 'conflict' }
    | null
  >;
  claim(input: {
    taskId: string;
    fingerprint: string;
    request: HarnessWorkflowInput;
  }): Promise<
    | { kind: 'created' }
    | {
        kind: 'existing';
        workflowId: string;
        runtimeId?: string;
        request: HarnessWorkflowInput;
      }
    | { kind: 'conflict' }
  >;
  /**
   * Production-only seam for paid admission. The confirmation service invokes
   * it inside its workspace-credit transaction after the exact reservation is
   * known. Memory registries intentionally use the ordinary claim path.
   */
  claimInConfirmationTransaction?(input: {
    transactionClient: ConfirmationTransactionClient;
    taskId: string;
    fingerprint: string;
    request: HarnessWorkflowInput;
  }): Promise<
    | { kind: 'created' }
    | {
        kind: 'existing';
        workflowId: string;
        runtimeId?: string;
        request: HarnessWorkflowInput;
      }
    | { kind: 'conflict' }
  >;
}

export interface HarnessWorkflowStarter {
  start(input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    runtimeId?: string;
  }): Promise<{ workflowId: string }>;
}

export interface HarnessPromptFallbackAuditPort {
  appendAudit(event: {
    workspaceId: string;
    id: string;
    workflowId: string;
    stage: 'prompt_resolution';
    eventType: 'langfuse_prompt_fallback';
    payload: {
      promptKey: string;
      name: string;
      version: string;
      contentHash: string;
      fallbackReason: string;
      prompt: HarnessPromptRevisionReference;
    };
  }): Promise<void>;
}

export interface HarnessExecutionAssemblyAuditPort {
  appendAuditIdempotently(event: {
    workspaceId: string;
    id: string;
    workflowId: string;
    stage: 'observability_event_ingest';
    eventType: 'agent_primitive.lifecycle';
    payload: AgentPrimitiveLifecycleEvent;
  }): Promise<void>;
}

export interface HarnessExecutionBoundsResolver {
  resolve(
    input: HarnessWorkflowInputBeforeBounds,
  ): Promise<BoundedExecutionLimits>;
}

export class HarnessAdmissionError extends Error {
  readonly status = 409;

  constructor(
    readonly code:
      | 'EXECUTION_SNAPSHOT_MISMATCH'
      | 'FROZEN_ROUTE_MISMATCH'
      | 'FROZEN_REQUEST_MISSING'
      | 'REQUEST_FINGERPRINT_CONFLICT'
      | 'REQUIRES_SUCCESSOR_ADMISSION',
    message: string,
  ) {
    super(message);
    this.name = 'HarnessAdmissionError';
  }
}

export class HarnessExecutionBoundsAdmissionError extends Error {
  readonly status = 503;
  readonly code = 'REQUIRED_EXECUTION_LIMIT_UNSET';

  constructor(readonly limit: BoundedExecutionLimitName) {
    super(`Required execution limit ${limit} is unset.`);
    this.name = 'HarnessExecutionBoundsAdmissionError';
  }
}

const DEFAULT_EXECUTION_BOUNDS_RESOLVER: HarnessExecutionBoundsResolver = {
  async resolve() {
    return {
      maxIterations: 'unset',
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: [],
    };
  },
};

export function executionPlanAdmissionWorkflowId(
  taskId: string,
  request: Pick<
    HarnessWorkflowInput,
    'executionPlanSnapshot' | 'pendingExecutionPlanSnapshot'
  >,
): string {
  const snapshot =
    request.executionPlanSnapshot ?? request.pendingExecutionPlanSnapshot;
  if (!snapshot) return taskId;
  const planRevision =
    'content' in snapshot
      ? snapshot.content.planRevision
      : snapshot.planRevision;
  return `${taskId}:plan:${planRevision}:${snapshot.snapshotHash}`;
}

export class HarnessTaskAdmissionService {
  constructor(
    private readonly registry: HarnessTaskRequestRegistry,
    private readonly starter: HarnessWorkflowStarter,
    private readonly prompts?: HarnessPromptResolver,
    private readonly promptFallbackAudits?: HarnessPromptFallbackAuditPort,
    private readonly executionBounds: HarnessExecutionBoundsResolver = DEFAULT_EXECUTION_BOUNDS_RESOLVER,
    private readonly frozenRoutes?: HarnessFrozenRouteSnapshotResolver,
    private readonly skillManifests?: HarnessSkillManifestResolver,
    private readonly assemblyAudits?: HarnessExecutionAssemblyAuditPort,
    /**
     * V31-12: sole writer of execution_plan_snapshot on the real admission path.
     * Required when submit carries executionPlanSnapshot; absent skips write.
     */
    private readonly executionPlanAdmission?: ExecutionPlanAdmissionPort,
    private readonly executionConfirmation?: {
      createRequest(
        input: CreateExecutionConfirmationAuthorityInput,
      ): Promise<CreateExecutionConfirmationResult>;
      createRequestInTransaction?(
        input: CreateExecutionConfirmationAuthorityInput,
        ledger: ConfirmationCreditTransactionPort,
      ): Promise<CreateExecutionConfirmationResult>;
      getRequest?(requestId: string): Promise<StoredConfirmationRequest | null>;
      getDecisionForWorkspace?(
        workspaceId: string,
        requestId: string,
      ): Promise<PlanConfirmationDecision | null>;
    } & Pick<ConfirmationAuthorityStore, 'putCurrent'>,
    /** Production authority for exact prompt pins frozen in HarnessRelease. */
    private readonly releasePromptBindings?: HarnessReleasePromptBindingsResolver,
  ) {}

  async submit(input: HarnessTaskRequest) {
    return this.admit(input, true);
  }

  /** Freeze and persist a paid request plus its pending confirmation, without DBOS start. */
  async preparePendingConfirmation(input: HarnessTaskRequest) {
    return this.admit(input, false);
  }

  /** Dispatches an already frozen request after its immutable decision exists. */
  async dispatchPrepared(input: HarnessTaskRequest) {
    return this.admit(input, true);
  }

  /**
   * Creates the pending task request for an expired confirmation successor.
   * The source is the locked durable request, never a caller-provided plan;
   * all writes share the creation-submission PostgreSQL transaction.
   */
  async prepareExpiredConfirmationSuccessorInTransaction(input: {
    transaction: ConfirmationCreditTransactionPort;
    workflowId: string;
    predecessorRequestId: string;
    requestId: string;
    reservationIdempotencyKey: string;
    holdExpiresAt: string;
    sourceRequest: HarnessWorkflowInput;
    successor: Pick<CreationSubmissionRecord, 'snapshot' | 'usageReservation' | 'executionPlanFreeze'>;
  }): Promise<{ executionConfirmationRequestId: string }> {
    return this.prepareConfirmationSuccessorInTransaction({
      ...input,
      kind: 'expired',
    });
  }

  /**
   * Transactional admission for a confirmed hold invalidated by an
   * authoritative price change. The refresh/freeze is supplied only by the
   * locked store transaction; this method never accepts browser plan or quote
   * facts.
   */
  async prepareRepricedConfirmationSuccessorInTransaction(input: {
    transaction: ConfirmationCreditTransactionPort;
    workflowId: string;
    predecessorRequestId: string;
    requestId: string;
    reservationIdempotencyKey: string;
    holdExpiresAt: string;
    sourceRequest: HarnessWorkflowInput;
    successor: Pick<CreationSubmissionRecord, 'snapshot' | 'usageReservation' | 'executionPlanFreeze'>;
    /**
     * V31-63: current fact/context heads verified inside the successor's
     * store transaction. The successor's pending snapshot re-freezes on them
     * (and recomputes snapshotHash) so its own admission fence is current.
     */
    currentFactRevisionRefs?: readonly string[];
  }): Promise<{ executionConfirmationRequestId: string }> {
    return this.prepareConfirmationSuccessorInTransaction({
      ...input,
      kind: 'repriced_confirmed',
    });
  }

  private async prepareConfirmationSuccessorInTransaction(input: {
    transaction: ConfirmationCreditTransactionPort;
    workflowId: string;
    predecessorRequestId: string;
    requestId: string;
    reservationIdempotencyKey: string;
    holdExpiresAt: string;
    sourceRequest: HarnessWorkflowInput;
    successor: Pick<CreationSubmissionRecord, 'snapshot' | 'usageReservation' | 'executionPlanFreeze'>;
    /** Repriced successors only; expired successors keep their frozen refs. */
    currentFactRevisionRefs?: readonly string[];
    kind: 'expired' | 'repriced_confirmed';
  }): Promise<{ executionConfirmationRequestId: string }> {
    // Keep receiver bindings: both authorities are class instances in
    // production (V31-63 — a bare method reference loses `this` and dies on
    // the first live successor prepare with "Cannot read … claimWithClient").
    const create = this.executionConfirmation?.createRequestInTransaction?.bind(
      this.executionConfirmation,
    );
    const claim = this.registry.claimInConfirmationTransaction?.bind(
      this.registry,
    );
    const source = structuredClone(input.sourceRequest);
    const freeze = input.successor.executionPlanFreeze;
    const sourcePending = source.pendingExecutionPlanSnapshot;
    if (!create || !claim || !freeze || !sourcePending || !source.executionSnapshot) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Expired confirmation successor requires durable authority, registry, and pending plan facts.',
      );
    }
    if (
      freeze.approvalBasis !== 'merchant_confirmed' ||
      source.executionConfirmationRequestId !== input.predecessorRequestId ||
      sourcePending.content.planId !== freeze.planId ||
      (input.kind === 'expired' &&
        sourcePending.content.planRevision !== freeze.planRevision)
    ) {
      throw new HarnessAdmissionError(
        'REQUIRES_SUCCESSOR_ADMISSION',
        'Expired confirmation successor does not match the locked predecessor plan.',
      );
    }
    const pending = freezeExecutionPlanContent({
      ...sourcePending.content,
      planId: freeze.planId,
      planRevision: freeze.planRevision,
      intentDeclaration: structuredClone(freeze.intentDeclaration),
      contextBundleRef: structuredClone(freeze.contextBundleRef),
      executionPlan: structuredClone(freeze.executionPlan),
      deliverables: structuredClone(freeze.deliverables),
      quoteRef: structuredClone(freeze.quoteRef),
      ...(freeze.packageBilling
        ? { packageBilling: structuredClone(freeze.packageBilling) }
        : {}),
      rightsRevisionRefs: [...freeze.rightsRevisionRefs],
      // V31-63: the repriced successor re-freezes on the current context
      // heads the store transaction verified; freezeExecutionPlanContent
      // recomputes snapshotHash over the rebased content.
      ...(input.currentFactRevisionRefs
        ? { factRevisionRefs: [...input.currentFactRevisionRefs] }
        : {}),
    });
    const request: HarnessWorkflowInput = {
      ...source,
      packageId: input.successor.snapshot.contentPackage.id,
      expectedRevision: input.successor.snapshot.contentPackage.expectedRevision,
      workflowRevision: input.successor.snapshot.revision,
      rawInput: input.successor.snapshot.intent.text,
      intent: {
        ...source.intent,
        context: {
          ...source.intent.context,
          intent: input.successor.snapshot.intent.text,
          workId: input.successor.snapshot.work.id,
        },
      },
      preparedAttemptId: input.workflowId,
      sourceTaskId: input.successor.snapshot.task.id,
      billingTaskId: input.successor.snapshot.task.id,
      executionSnapshot: structuredClone(input.successor.snapshot),
      usageReservation: structuredClone(input.successor.usageReservation),
      pendingExecutionPlanSnapshot: pending,
      executionConfirmationRequestId: input.requestId,
      executionConfirmationReservationIdempotencyKey:
        input.reservationIdempotencyKey,
      executionConfirmationReservedCredits:
        input.successor.usageReservation.credits,
      ...(source.executionAssembly
        ? {
            executionAssembly: {
              ...structuredClone(source.executionAssembly),
              workflowId: input.workflowId,
            },
          }
        : {}),
    };
    delete request.billingIdentity;
    const {
      executionPlanSnapshot: _fingerprintSnapshot,
      agentRunId: _fingerprintAgentRunId,
      ...fingerprintRequest
    } = request;
    void _fingerprintSnapshot;
    void _fingerprintAgentRunId;
    const fingerprint = fingerprintValue(fingerprintRequest);
    const authority = pendingConfirmationAuthority({
      workflowId: input.workflowId,
      request,
      pending,
      frozenAt: input.successor.snapshot.createdAt,
    });
    authority.reservationAttempt = 'successor';
    authority.predecessorRequestId = input.predecessorRequestId;
    const created = await create(
      {
        workflowId: input.workflowId,
        workspaceId: request.workspaceId,
        actorId: request.actorId,
        pendingAuthority: authority,
        ...(input.kind === 'expired'
          ? {
              expiredSuccessor: {
                requestId: input.requestId,
                predecessorRequestId: input.predecessorRequestId,
                reservationIdempotencyKey: input.reservationIdempotencyKey,
                holdExpiresAt: input.holdExpiresAt,
              },
            }
          : {
              repricedConfirmedSuccessor: {
                requestId: input.requestId,
                predecessorRequestId: input.predecessorRequestId,
                reservationIdempotencyKey: input.reservationIdempotencyKey,
                holdExpiresAt: input.holdExpiresAt,
              },
            }),
        afterPendingPersisted: async ({ transactionClient, stored, reservedCredits }) => {
          request.executionConfirmationRequestId = stored.request.requestId;
          request.executionConfirmationReservationIdempotencyKey =
            stored.request.reservationIdempotencyKey;
          request.executionConfirmationReservedCredits = reservedCredits;
          request.billingIdentity = buildBillingIdentity(request, input.workflowId) ?? undefined;
          if (!request.billingIdentity) {
            throw new HarnessAdmissionError(
              'FROZEN_REQUEST_MISSING',
              'Expired confirmation successor requires a frozen billing identity.',
            );
          }
          const claimed = await claim({
            transactionClient,
            taskId: input.workflowId,
            fingerprint,
            request,
          });
          if (claimed.kind === 'conflict') {
            throw new HarnessAdmissionError(
              'REQUEST_FINGERPRINT_CONFLICT',
              'Expired confirmation successor task id conflicts with another request.',
            );
          }
          if (claimed.kind === 'existing') {
            if (
              claimed.request.executionConfirmationRequestId !==
                input.requestId ||
              claimed.request.executionConfirmationReservationIdempotencyKey !==
                input.reservationIdempotencyKey
            ) {
              throw new HarnessAdmissionError(
                'REQUEST_FINGERPRINT_CONFLICT',
                'Expired confirmation successor replay does not match the durable authority.',
              );
            }
          }
        },
      },
      input.transaction,
    );
    if (created.stored.request.requestId !== input.requestId) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Expired confirmation successor did not persist its exact authority id.',
      );
    }
    return { executionConfirmationRequestId: created.stored.request.requestId };
  }

  private async admit(input: HarnessTaskRequest, dispatch: boolean) {
    let normalized = normalizeRequest(input);
    const packageConfirmation = await this.resolvePackageConfirmation(
      input,
      normalized,
    );
    if (packageConfirmation) {
      normalized = {
        ...normalized,
        executionConfirmationRequestId:
          packageConfirmation.request.requestId,
        executionConfirmationReservationIdempotencyKey:
          packageConfirmation.request.reservationIdempotencyKey,
        executionConfirmationReservedCredits:
          packageConfirmation.projection.reservedCredits,
      };
    }
    // The assembled snapshot is derived from frozen request fields. agentRunId
    // was added after durable paid requests could already be prepared, so both
    // fields stay outside the fingerprint to preserve recovery replay.
    const {
      executionPlanSnapshot: _fingerprintSnapshot,
      agentRunId: _fingerprintAgentRunId,
      ...fingerprintRequest
    } = normalized;
    void _fingerprintSnapshot;
    void _fingerprintAgentRunId;
    const fingerprint = fingerprintValue(fingerprintRequest);
    const existing = await this.registry.lookup?.({
      taskId: input.taskId,
      fingerprint,
      request: normalized,
    });
    if (existing) {
      if (existing.kind === 'existing') {
        if (!existing.request) return this.resumeExisting(existing);
        if (
          existing.request.executionSnapshot &&
          existing.request.usageReservation &&
          !existing.request.billingIdentity
        ) {
          throw new HarnessAdmissionError(
            'FROZEN_REQUEST_MISSING',
            'Paid task replay is missing its persisted billing identity.',
          );
        }
        if (
          existing.request.pendingExecutionPlanSnapshot &&
          !existing.request.executionConfirmationRequestId
        ) {
          throw new HarnessAdmissionError(
            'FROZEN_REQUEST_MISSING',
            'Paid task replay is missing its persisted confirmation request id.',
          );
        }
        await this.assertReplayConfirmationIsCurrent(existing.request);
      }
      return dispatch
        ? this.resumeExisting(existing)
        : this.preparedExisting(existing);
    }
    const limits = boundedExecutionLimitsSchema.parse(
      await this.executionBounds.resolve(normalized),
    );
    for (const requiredLimit of limits.requiredLimits) {
      if (limits[requiredLimit] === 'unset') {
        throw new HarnessExecutionBoundsAdmissionError(requiredLimit);
      }
    }
    const boundedExecution = boundedExecutionSnapshotSchema.parse({
      schemaVersion: 'bounded-execution-snapshot/v1',
      ...limits,
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    });
    let request: HarnessWorkflowInput = {
      ...normalized,
      boundedExecution,
    };
    // V31-12: one-shot snapshot row write on the real task-admission path.
    // Must run before registry.claim so replays share the same frozen hash.
    if (request.executionPlanSnapshot) {
      if (!this.executionPlanAdmission) {
        throw new HarnessAdmissionError(
          'FROZEN_REQUEST_MISSING',
          'ExecutionPlanSnapshot admission requires the production admission writer (V31-12).',
        );
      }
      const admitted = await this.executionPlanAdmission.admitSnapshot({
        workflowId: executionPlanAdmissionWorkflowId(input.taskId, request),
        workspaceId: request.workspaceId,
        snapshot: request.executionPlanSnapshot,
        live: input.executionPlanLiveFacts,
      });
      request = {
        ...request,
        executionPlanSnapshot: admitted.admitted.snapshot,
      };
    }
    const selectedSkillStages = await this.selectSkillManifests(normalized);
    // One authority for "which prompt sites this task uses": the route
    // capability requirements and the frozen prompt pins must be the same set.
    const promptKeys = promptKeysForAdmission(normalized);
    if (normalized.executionSnapshot) {
      if (!this.frozenRoutes) {
        throw new HarnessAdmissionError(
          'FROZEN_ROUTE_MISMATCH',
          'Composer admission requires the production frozen-route resolver.',
        );
      }
      request = {
        ...request,
        frozenRouteSnapshot: await this.frozenRoutes.resolve(
          normalized.executionSnapshot,
          {
            requirements: primaryTaskCapabilityRequirements(
              normalized.executionSnapshot,
              promptKeys,
            ).concat(skillCapabilityRequirements(selectedSkillStages)),
          },
        ),
      };
    }
    if (this.prompts) {
      const releaseBindings = this.releasePromptBindings
        ? await this.releasePromptBindings.resolvePromptBindings(input)
        : undefined;
      const exactVersions = releaseBindings
        ? Object.fromEntries(
            promptKeys.map((key) => {
              const binding = releaseBindings[key];
              if (!binding || binding.key !== key || !binding.version.trim()) {
                throw new HarnessAdmissionError(
                  'FROZEN_REQUEST_MISSING',
                  `HarnessRelease is missing exact prompt pin ${key}.`,
                );
              }
              return [key, binding.version];
            }),
          )
        : undefined;
      const prompts = await resolveHarnessPromptKeys(
        this.prompts,
        promptKeys,
        exactVersions,
      );
      request = {
        ...request,
        prompts: prompts as HarnessFrozenPrompts,
        promptRevisionRefs: promptRevisionReferences(
          prompts as HarnessFrozenPrompts,
        ),
      };
    }
    const skillStages = await this.materializeSkillManifests(
      normalized,
      selectedSkillStages,
    );
    // V31-12 producer seam: assemble the full snapshot from the compile-finalize
    // freeze plus the harness fields resolved above, then one-shot admit it.
    // Pure copy is admitted immediately. Paid media carries the same frozen
    // content/hash into a reserve-backed pending request; the immutable decision
    // is attached by the confirmation gate before Make begins.
    // V31-47: secondary multi-carrier Makes may already carry the package
    // confirmation decision — admit immediately without a second reserve.
    if (!request.executionPlanSnapshot && input.executionPlanFreeze) {
      const freeze = input.executionPlanFreeze;
      const packageDecisionRef = input.packageConfirmationDecisionRef?.trim();
      if (
        freeze.approvalBasis === 'policy_exempt_copy' ||
        (freeze.approvalBasis === 'merchant_confirmed' && packageDecisionRef)
      ) {
        if (!this.executionPlanAdmission) {
          throw new HarnessAdmissionError(
            'FROZEN_REQUEST_MISSING',
            'ExecutionPlanSnapshot admission requires the production admission writer (V31-12).',
          );
        }
        const snapshot = assembleExecutionPlanSnapshot({
          freeze,
          promptRevisionRefs: promptRevisionRefsForSnapshot(
            request.promptRevisionRefs,
          ),
          skillManifestRefs: skillManifestRefsFromStages(skillStages),
          routeRequirements: capabilityRequirementsFromAxes([
            ...primaryTaskCapabilityRequirements(
              normalized.executionSnapshot!,
              promptKeys,
            ),
            ...skillCapabilityRequirements(selectedSkillStages),
          ]),
          factRevisionRefs: factRevisionRefsFromSnapshot(
            normalized.executionSnapshot!,
          ),
          boundedExecution,
          ...(packageDecisionRef
            ? { confirmationDecisionRef: packageDecisionRef }
            : {}),
        });
        const admitted = await this.executionPlanAdmission.admitSnapshot({
          workflowId: executionPlanAdmissionWorkflowId(input.taskId, {
            executionPlanSnapshot: snapshot,
          }),
          workspaceId: request.workspaceId,
          snapshot,
          live: input.executionPlanLiveFacts,
        });
        request = {
          ...request,
          executionPlanSnapshot: admitted.admitted.snapshot,
        };
      } else {
        const pendingExecutionPlanSnapshot =
          assemblePendingExecutionPlanSnapshot({
            freeze,
            promptRevisionRefs: promptRevisionRefsForSnapshot(
              request.promptRevisionRefs,
            ),
            skillManifestRefs: skillManifestRefsFromStages(skillStages),
            routeRequirements: capabilityRequirementsFromAxes([
              ...primaryTaskCapabilityRequirements(
                normalized.executionSnapshot!,
                promptKeys,
              ),
              ...skillCapabilityRequirements(selectedSkillStages),
            ]),
            factRevisionRefs: factRevisionRefsFromSnapshot(
              normalized.executionSnapshot!,
            ),
            boundedExecution,
          });
        request = { ...request, pendingExecutionPlanSnapshot };
      }
    }
    if (
      normalized.executionSnapshot &&
      request.frozenRouteSnapshot &&
      request.promptRevisionRefs
    ) {
      request = {
        ...request,
        executionAssembly: executionAssemblySnapshot({
          workflowId: input.taskId,
          request,
          route: request.frozenRouteSnapshot,
          promptRevisionRefs: request.promptRevisionRefs,
          skillStages,
        }),
      };
    }
    request = {
      ...request,
      billingTaskId: billingTaskIdForAdmission(input, request),
      carrierUnitId: carrierUnitIdFromFreeze(input.executionPlanFreeze),
      carrierUnitIds: normalizeCarrierUnitIds(
        input.carrierUnitIds,
        carrierUnitIdFromFreeze(input.executionPlanFreeze),
      ),
      carrierBillableUnits: carrierBillableUnitsFromFreeze(input.executionPlanFreeze),
    };
    if (
      !request.pendingExecutionPlanSnapshot &&
      request.executionSnapshot &&
      request.usageReservation
    ) {
      request.billingIdentity = buildBillingIdentity(request, input.taskId) ?? undefined;
      if (!request.billingIdentity) {
        throw new HarnessAdmissionError(
          'FROZEN_REQUEST_MISSING',
          'Billable execution requires a frozen billing identity before claim.',
        );
      }
    }
    assertHarnessExecutionAssemblyPinned(request);
    const claimWithinConfirmation =
      request.pendingExecutionPlanSnapshot &&
      this.registry.claimInConfirmationTransaction
        ? this.registry.claimInConfirmationTransaction.bind(this.registry)
        : undefined;
    if (request.pendingExecutionPlanSnapshot && !claimWithinConfirmation) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Paid execution requires an atomic confirmation-and-admission registry.',
      );
    }
    if (claimWithinConfirmation) {
      let claimedWithConfirmation = false;
      await this.ensurePendingExecutionConfirmation(input.taskId, request, {
        afterPendingPersisted: async ({ transactionClient, stored, reservedCredits }) => {
          request.executionConfirmationRequestId = stored.request.requestId;
          request.executionConfirmationReservationIdempotencyKey =
            stored.request.reservationIdempotencyKey;
          request.executionConfirmationReservedCredits = reservedCredits;
          request.billingIdentity =
            buildBillingIdentity(request, input.taskId) ?? undefined;
          if (!request.billingIdentity) {
            throw new HarnessAdmissionError(
              'FROZEN_REQUEST_MISSING',
              'Paid execution requires a frozen billing identity.',
            );
          }
          const transactionalClaim = await claimWithinConfirmation({
            transactionClient,
            taskId: input.taskId,
            fingerprint,
            request,
          });
          if (transactionalClaim.kind === 'conflict') {
            throw new HarnessAdmissionError(
              'REQUEST_FINGERPRINT_CONFLICT',
              'Task ID was reused with a different harness request payload.',
            );
          }
          if (transactionalClaim.kind === 'existing') {
            request = transactionalClaim.request;
          }
          claimedWithConfirmation = true;
        },
      });
      if (
        !claimedWithConfirmation ||
        !request.billingIdentity ||
        !request.executionConfirmationRequestId
      ) {
        throw new HarnessAdmissionError(
          'FROZEN_REQUEST_MISSING',
          'Paid execution confirmation did not atomically persist its frozen billing admission.',
        );
      }
      await this.recordExecutionAssemblyAudit(request, [
        'manifest_resolution',
        'hot_assembly',
        'prompt_resolution',
        'task_pin',
      ]);
      await this.recordPromptFallbackAudits(input.taskId, request);
      if (!dispatch) {
        return {
          workflowId: input.taskId,
          replayed: false as const,
          executionConfirmationRequestId: request.executionConfirmationRequestId!,
        };
      }
      const handle = await this.starter.start({ workflowId: input.taskId, request });
      return {
        workflowId: handle.workflowId,
        replayed: false as const,
        executionConfirmationRequestId: request.executionConfirmationRequestId!,
      };
    }
    const claim = await this.registry.claim({
      taskId: input.taskId,
      fingerprint,
      request,
    });
    if (claim.kind === 'conflict') {
      throw new HarnessAdmissionError(
        'REQUEST_FINGERPRINT_CONFLICT',
        'Task ID was reused with a different harness request payload.',
      );
    }
    if (claim.kind === 'existing') {
      if (!claim.request) return this.resumeExisting(claim);
      if (
        claim.request.executionSnapshot &&
        claim.request.usageReservation &&
        !claim.request.billingIdentity
      ) {
        throw new HarnessAdmissionError(
          'FROZEN_REQUEST_MISSING',
          'Paid task replay is missing its persisted billing identity.',
        );
      }
      if (
        claim.request.pendingExecutionPlanSnapshot &&
        !claim.request.executionConfirmationRequestId
      ) {
        throw new HarnessAdmissionError(
          'FROZEN_REQUEST_MISSING',
          'Paid task replay is missing its persisted confirmation request id.',
        );
      }
      await this.assertReplayConfirmationIsCurrent(claim.request);
      return dispatch
        ? this.resumeExisting(claim)
        : this.preparedExisting(claim);
    }
    await this.recordExecutionAssemblyAudit(request, [
      'manifest_resolution',
      'hot_assembly',
      'prompt_resolution',
      'task_pin',
    ]);
    await this.recordPromptFallbackAudits(input.taskId, request);
    if (!dispatch) {
      return {
        workflowId: input.taskId,
        replayed: false as const,
        ...(request.executionConfirmationRequestId
          ? {
              executionConfirmationRequestId:
                request.executionConfirmationRequestId,
            }
          : {}),
      };
    }
    const handle = await this.starter.start({
      workflowId: input.taskId,
      request,
    });
    return {
      workflowId: handle.workflowId,
      replayed: false as const,
      ...(request.executionConfirmationRequestId
        ? {
            executionConfirmationRequestId:
              request.executionConfirmationRequestId,
          }
        : {}),
    };
  }

  private preparedExisting(
    claim:
      | {
          kind: 'existing';
          workflowId: string;
          runtimeId?: string;
          request: HarnessWorkflowInput;
        }
      | { kind: 'conflict' },
  ) {
    if (claim.kind === 'conflict') {
      throw new HarnessAdmissionError(
        'REQUEST_FINGERPRINT_CONFLICT',
        'Task ID was reused with a different Harness request payload.',
      );
    }
    return {
      workflowId: claim.workflowId,
      replayed: true as const,
      ...(claim.request.executionConfirmationRequestId
        ? {
            executionConfirmationRequestId:
              claim.request.executionConfirmationRequestId,
          }
        : {}),
    };
  }

  /**
   * An old task_request can only replay its exact pending or confirmed
   * confirmation. A terminal request needs a new task/workflow admission so
   * its replacement authority, reservation and BillingIdentity are committed
   * together; never resurrect it by mutating this in-memory request.
   */
  private async assertReplayConfirmationIsCurrent(
    request: HarnessWorkflowInput,
  ): Promise<void> {
    if (!request.pendingExecutionPlanSnapshot) return;
    const requestId = request.executionConfirmationRequestId?.trim();
    if (!requestId) return;
    const getRequest = this.executionConfirmation?.getRequest;
    const getDecision = this.executionConfirmation?.getDecisionForWorkspace;
    if (!getRequest || !getDecision) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Paid task replay requires confirmation authority readers.',
      );
    }
    const stored = await getRequest(requestId);
    if (!stored || stored.request.workspaceId !== request.workspaceId) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Paid task replay is missing its persisted confirmation authority.',
      );
    }
    if (stored.request.status === 'pending') return;
    if (stored.request.status === 'expired') {
      throw new HarnessAdmissionError(
        'REQUIRES_SUCCESSOR_ADMISSION',
        'Expired confirmation requires a new immutable task admission attempt.',
      );
    }
    const decision = await getDecision(request.workspaceId, requestId);
    if (decision?.decision === 'confirmed') return;
    if (decision?.decision === 'rejected') {
      throw new HarnessAdmissionError(
        'REQUIRES_SUCCESSOR_ADMISSION',
        'Rejected confirmation requires a new immutable task admission attempt.',
      );
    }
    throw new HarnessAdmissionError(
      'FROZEN_REQUEST_MISSING',
      'Paid task replay has a terminal confirmation without an immutable decision.',
    );
  }

  /**
   * A secondary carrier must borrow the exact primary hold, not reconstruct a
   * reservation from its own workflow or the old usage-reservation record.
   * The decision and request are both durable authorities and are checked
   * again here because this boundary is the final writer of BillingIdentity.
   */
  private async resolvePackageConfirmation(
    input: HarnessTaskRequest,
    normalized: HarnessWorkflowInputBeforeBounds,
  ): Promise<StoredConfirmationRequest | null> {
    const decisionId = input.packageConfirmationDecisionRef?.trim();
    const requestId = input.packageConfirmationRequestId?.trim();
    const freeze = input.executionPlanFreeze;
    if (!decisionId && !requestId) return null;
    if (
      !decisionId ||
      !requestId ||
      !freeze ||
      freeze.approvalBasis !== 'merchant_confirmed'
    ) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'A secondary carrier requires one exact confirmed package authority.',
      );
    }
    const getRequest = this.executionConfirmation?.getRequest;
    const getDecision = this.executionConfirmation?.getDecisionForWorkspace;
    if (!getRequest || !getDecision) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Secondary carrier admission requires the confirmation authority reader.',
      );
    }
    const [stored, decision] = await Promise.all([
      getRequest(requestId),
      getDecision(normalized.workspaceId, requestId),
    ]);
    if (
      !stored ||
      stored.request.workspaceId !== normalized.workspaceId ||
      stored.request.requestId !== requestId ||
      stored.request.status !== 'decided' ||
      stored.request.planId !== freeze.planId ||
      stored.request.planRevision !== freeze.planRevision ||
      stored.request.quoteRef.id !== freeze.quoteRef.id ||
      String(stored.request.quoteRef.revision) !== String(freeze.quoteRef.revision) ||
      !stored.request.reservationIdempotencyKey.trim() ||
      !Number.isSafeInteger(stored.projection.reservedCredits) ||
      stored.projection.reservedCredits <= 0 ||
      !decision ||
      decision.requestId !== requestId ||
      decision.decisionId !== decisionId ||
      decision.decision !== 'confirmed'
    ) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Secondary carrier confirmation does not match its frozen package authority.',
      );
    }
    if (
      (normalized.executionConfirmationRequestId &&
        normalized.executionConfirmationRequestId !== requestId) ||
      (normalized.executionConfirmationReservationIdempotencyKey &&
        normalized.executionConfirmationReservationIdempotencyKey !==
          stored.request.reservationIdempotencyKey)
    ) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Caller confirmation fields do not match the package authority.',
      );
    }
    return stored;
  }

  private async ensurePendingExecutionConfirmation(
    workflowId: string,
    request: HarnessWorkflowInput,
    options?: Pick<
      CreateExecutionConfirmationAuthorityInput,
      'afterPendingPersisted'
    >,
  ): Promise<void> {
    if (!request.pendingExecutionPlanSnapshot) return;
    const create = this.executionConfirmation?.createRequest;
    const pending = request.pendingExecutionPlanSnapshot;
    const snapshot = request.executionSnapshot;
    const credits = request.usageReservation?.credits;
    if (!create || !pending || !snapshot) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Paid execution requires the confirmation writer and durable plan freeze.',
      );
    }
    if (!Number.isSafeInteger(credits) || (credits ?? 0) <= 0) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Paid execution requires a positive server-owned credit quote.',
      );
    }
    const authority = pendingConfirmationAuthority({
      workflowId,
      request,
      pending,
      frozenAt: snapshot.createdAt,
    });
    const created = await create({
      workflowId,
      workspaceId: request.workspaceId,
      actorId: request.actorId,
      pendingAuthority: authority,
      ...(options?.afterPendingPersisted
        ? { afterPendingPersisted: options.afterPendingPersisted }
        : {}),
    });
    request.executionConfirmationRequestId = created.stored.request.requestId;
    request.executionConfirmationReservationIdempotencyKey =
      created.stored.request.reservationIdempotencyKey;
    request.executionConfirmationReservedCredits = created.reservedCredits;
  }

  private async selectSkillManifests(
    request: HarnessWorkflowInputBeforeBounds,
  ): Promise<Record<HarnessStage, HarnessSkillManifestSelection[]>> {
    const stages: Record<HarnessStage, HarnessSkillManifestSelection[]> = {
      intent_naming: [],
      context_injection: [],
      brief_compilation: [],
      execution_selection: [],
      assembly_delivery: [],
    };
    if (!this.skillManifests) return stages;
    for (const stage of HARNESS_STAGES) {
      stages[stage] = structuredClone(
        await this.skillManifests.select({
          request,
          stage,
        }),
      );
    }
    return stages;
  }

  private async materializeSkillManifests(
    request: HarnessWorkflowInputBeforeBounds,
    selectedStages: Record<HarnessStage, HarnessSkillManifestSelection[]>,
  ): Promise<Record<HarnessStage, HarnessSkillManifestSnapshot[]>> {
    const stages: Record<HarnessStage, HarnessSkillManifestSnapshot[]> = {
      intent_naming: [],
      context_injection: [],
      brief_compilation: [],
      execution_selection: [],
      assembly_delivery: [],
    };
    if (!this.skillManifests) return stages;
    for (const stage of HARNESS_STAGES) {
      const selected = selectedStages[stage];
      if (selected.length === 0) continue;
      const manifests = await this.skillManifests.materialize({
        request,
        stage,
        manifests: selected,
      });
      if (manifests.length !== selected.length) {
        throw new HarnessAdmissionError(
          'FROZEN_ROUTE_MISMATCH',
          `Skill materialization for ${stage} changed the selected manifest set.`,
        );
      }
      for (const [index, manifest] of manifests.entries()) {
        const selection = selected[index]!;
        const resolved = manifest.resolvedInstruction;
        if (
          manifest.skillRevisionRef !== selection.skillRevisionRef ||
          manifest.contentHash !== selection.contentHash ||
          JSON.stringify(manifest.requiredModelCapabilities) !==
            JSON.stringify(selection.requiredModelCapabilities) ||
          !resolved ||
          resolved.skillRevisionRef !== manifest.skillRevisionRef ||
          resolved.contentHash !== manifest.contentHash ||
          JSON.stringify(resolved.requiredModelCapabilities) !==
            JSON.stringify(manifest.requiredModelCapabilities)
        ) {
          throw new HarnessAdmissionError(
            'FROZEN_ROUTE_MISMATCH',
            `Skill ${manifest.skillRevisionRef} is missing its frozen execution material.`,
          );
        }
      }
      stages[stage] = structuredClone(manifests);
    }
    return stages;
  }

  private async resumeExisting(
    claim:
      | {
          kind: 'existing';
          workflowId: string;
          runtimeId?: string;
          request: HarnessWorkflowInput;
        }
      | { kind: 'conflict' },
  ) {
    if (claim.kind === 'conflict') {
      throw new HarnessAdmissionError(
        'REQUEST_FINGERPRINT_CONFLICT',
        'Task ID was reused with a different harness request payload.',
      );
    }
    if (!claim.request) {
      throw new HarnessAdmissionError(
        'FROZEN_REQUEST_MISSING',
        'Accepted task replay is missing its frozen harness request.',
      );
    }
    const frozenRequest = claim.request;
    assertHarnessExecutionAssemblyPinned(frozenRequest);
    await this.recordExecutionAssemblyAudit(frozenRequest, [
      'manifest_resolution',
      'hot_assembly',
      'prompt_resolution',
      'task_pin',
    ]);
    await this.recordPromptFallbackAudits(claim.workflowId, frozenRequest);
    const handle = await this.starter.start({
      workflowId: claim.workflowId,
      request: frozenRequest,
      ...(claim.runtimeId ? { runtimeId: claim.runtimeId } : {}),
    });
    return {
      workflowId: handle.workflowId,
      replayed: true as const,
      ...(frozenRequest.executionConfirmationRequestId
        ? {
            executionConfirmationRequestId:
              frozenRequest.executionConfirmationRequestId,
          }
        : {}),
    };
  }

  private async recordExecutionAssemblyAudit(
    request: HarnessWorkflowInput,
    steps: readonly HarnessExecutionAssemblyStep[],
  ) {
    if (!this.assemblyAudits || !request.executionAssembly) return;
    const workflowId = request.executionAssembly.workflowId;
    for (const step of steps) {
      const root = step === 'task_pin';
      const axes = root
        ? request.executionAssembly.rootAxes
        : {
            axisScope: 'execution_child' as const,
            skillRevision: { kind: 'absent' as const },
            promptVersion: { kind: 'absent' as const },
            catalogRevision: { kind: 'absent' as const },
            scene: { kind: 'absent' as const },
          };
      const axisValue = (
        value: ObservabilityAxisBinding['skillRevision'],
      ) => (value.kind === 'bound' ? value.value : null);
      const idempotencyKey = `harness-assembly-${fingerprintValue([
        workflowId,
        step,
      ])}`;
      const payload = agentPrimitiveLifecycleEventSchema.parse({
        eventType: 'agent_primitive.lifecycle',
        taskId: workflowId,
        workspaceId: request.workspaceId,
        actorId: serverAuditReference(request.actorId),
        actorKind: 'worker',
        idempotencyKey,
        axisScope: axes.axisScope,
        skillRevision: axisValue(axes.skillRevision),
        promptVersion: axisValue(axes.promptVersion),
        catalogRevision: axisValue(axes.catalogRevision),
        scene: axisValue(axes.scene),
        payload: {
          primitiveId: `harness-assembly:${step}`,
          phase: 'succeeded',
          billing: { kind: 'not_billed' },
        },
      });
      await this.assemblyAudits.appendAuditIdempotently({
        workspaceId: request.workspaceId,
        id: `observability-${idempotencyKey}`,
        workflowId,
        stage: 'observability_event_ingest',
        eventType: 'agent_primitive.lifecycle',
        payload,
      });
    }
  }

  private async recordPromptFallbackAudits(
    workflowId: string,
    request: HarnessWorkflowInput,
  ) {
    if (!this.promptFallbackAudits) return;
    for (const [promptKey, prompt] of Object.entries(request.prompts ?? {})) {
      if (!prompt.isFallback) continue;
      await this.promptFallbackAudits.appendAudit({
        workspaceId: request.workspaceId,
        id: `audit-${workflowId}-prompt-fallback-${promptKey}-${prompt.contentHash}`,
        workflowId,
        stage: 'prompt_resolution',
        eventType: 'langfuse_prompt_fallback',
        payload: {
          promptKey,
          name: prompt.name,
          version: prompt.version,
          contentHash: prompt.contentHash,
          fallbackReason: prompt.fallbackReason ?? 'unknown',
          prompt: promptTraceReference(prompt)!,
        },
      });
    }
  }
}

function promptKeysForAdmission(
  request: HarnessWorkflowInputBeforeBounds,
) {
  const snapshot = request.executionSnapshot;
  const lens = snapshot?.lens;
  // Legacy replay carries no lens, so no pack can be excluded. Derive the full
  // set instead of restating pack ids, or a newly added pack silently drops out.
  if (!lens) return promptKeysForAllPacks();
  const packIds: readonly HarnessPromptPackId[] =
    lens === 'copy'
      ? COPY_TASK_PROMPT_PACK_IDS
      : lens === 'image_text_note'
        ? ['agentControl', 'note', 'media', 'cover']
        : lens === 'video'
          ? ['agentControl', 'video']
          : ['agentControl', 'media', 'cover'];
  const selected = snapshot.recipe.id === 'recipe.viral_adapt'
    ? [...packIds, 'viral' as const]
    : packIds;
  const keys = promptKeysForPacks(selected);
  if (
    snapshot.recipe.id === 'recipe.viral_adapt' &&
    (snapshot.viralAdaptSource?.authorizedAssetIds.length ?? 0) === 0
  ) {
    return keys.filter((key) => key !== 'xhsViralImageVision');
  }
  return keys;
}

export function assertHarnessExecutionAssemblyPinned(
  request: HarnessWorkflowInput,
) {
  const assembly = request.executionAssembly;
  if (!assembly) {
    if (!request.executionSnapshot || !request.frozenRouteSnapshot) return;
    throw new Error(
      'Execution assembly is required before provider execution.',
    );
  }
  const route = request.frozenRouteSnapshot;
  if (
    !route ||
    assembly.frozenRouteSnapshotDigest !== fingerprintValue(route)
  ) {
    throw new Error(
      'Execution assembly binding does not match the frozen route.',
    );
  }
  if (
    JSON.stringify(assembly.promptRevisionRefs) !==
    JSON.stringify(request.promptRevisionRefs)
  ) {
    throw new Error(
      'Execution assembly prompt references do not match the durable request.',
    );
  }
  if (
    request.executionSnapshot &&
    assembly.workflowId !==
      (request.preparedAttemptId ?? request.executionSnapshot.task.id)
  ) {
    throw new Error(
      'Execution assembly workflow does not match the durable task.',
    );
  }
}

function primaryTaskCapabilityRequirements(
  snapshot: CreationExecutionSnapshot,
  promptKeys: readonly HarnessPromptKey[],
): ModelCapabilityRequirementAxis[] {
  if (snapshot.lens === 'copy') {
    // Exactly the prompt sites this task freezes. Declaring capability for a
    // site the request never pinned is the same double truth in miniature.
    return promptKeys.map((key) => harnessPromptCapabilityRequirement(key));
  }
  // D-165 deliberately defers per-site multi-model pins. A media task's sole
  // durable RouteSnapshot therefore remains the generation route; controller
  // prompt sites still use the same registry/matcher contract when a
  // controller route is introduced, without masquerading as this media pin.
  const operation = snapshot.operation;
  const modality =
    operation === 'image.generate' || operation === 'image.edit'
      ? 'image/*'
      : operation === 'video.generate'
        ? 'video/*'
        : operation === 'audio.speech' || operation === 'audio.sfx'
          ? 'audio/*'
          : 'text/plain';
  return [
    {
      axisId: `provider:${operation}`,
      vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
      requiredProtocolCapabilities: [],
      requiredModalities: [modality],
      requiredBusinessTags: [],
      requiredModalityCapabilities: [],
      unknownPolicy: 'conservative_always_available',
    },
  ];
}

function skillCapabilityRequirements(
  stages: Record<
    HarnessStage,
    Array<HarnessSkillManifestSnapshot | HarnessSkillManifestSelection>
  >,
): ModelCapabilityRequirementAxis[] {
  return Object.values(stages)
    .flat()
    .filter(
      (skill, index, all) =>
        all.findIndex(
          (candidate) => candidate.skillRevisionRef === skill.skillRevisionRef,
        ) === index,
    )
    .map((skill) =>
      skillCapabilityRequirement(
        skill.skillRevisionRef,
        skill.requiredModelCapabilities,
      ),
    );
}

function skillCapabilityRequirement(
  skillRevisionRef: string,
  capabilities: string[],
): ModelCapabilityRequirementAxis {  const requiredProtocolCapabilities: string[] = [];
  const requiredModalities: string[] = [];
  const requiredBusinessTags: string[] = [];
  const requiredModalityCapabilities: Array<{
    modality: string;
    capability: string;
  }> = [];
  for (const rawCapability of capabilities) {
    const capability = rawCapability.trim();
    if (!capability) {
      throw new HarnessAdmissionError(
        'FROZEN_ROUTE_MISMATCH',
        `Skill ${skillRevisionRef} declares an empty model capability.`,
      );
    }
    if (
      capability === 'structured_output' ||
      capability === 'structured-output'
    ) {
      pushUnique(requiredProtocolCapabilities, 'structured-output');
      continue;
    }
    if (capability === 'tool_calling' || capability === 'tool-calling') {
      pushUnique(requiredProtocolCapabilities, 'tool-calling');
      continue;
    }
    if (capability === 'cjk-text-render') {
      if (
        !requiredModalityCapabilities.some(
          (entry) =>
            entry.modality === 'image/*' &&
            entry.capability === capability,
        )
      ) {
        requiredModalityCapabilities.push({
          modality: 'image/*',
          capability,
        });
      }
      continue;
    }
    if (modelCapabilityMimeSchema.safeParse(capability).success) {
      pushUnique(requiredModalities, capability);
      continue;
    }
    pushUnique(requiredBusinessTags, capability);
  }
  return modelCapabilityRequirementAxisSchema.parse({
    axisId: `skill:${skillRevisionRef}`,
    vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
    requiredProtocolCapabilities,
    requiredModalities,
    requiredBusinessTags,
    requiredModalityCapabilities,
    unknownPolicy: 'conservative_always_available',
  });
}

function pushUnique(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

// ─── V31-12 snapshot assembly helpers ───────────────────────────────────────

function skillManifestRefsFromStages(
  stages: Record<HarnessStage, HarnessSkillManifestSnapshot[]>,
): Record<string, Array<{ skillId: string; revision: string }>> {
  const refs: Record<string, Array<{ skillId: string; revision: string }>> = {};
  for (const stage of HARNESS_STAGES) {
    const manifests = stages[stage];
    if (manifests.length === 0) continue;
    refs[stage] = manifests.map((manifest) =>
      splitSkillRevisionRef(manifest.skillRevisionRef),
    );
  }
  return refs;
}

function promptRevisionRefsForSnapshot(
  refs: Record<string, HarnessPromptRevisionReference> | undefined,
): Record<string, { key: string; version: string }> {
  const snapshotRefs: Record<string, { key: string; version: string }> = {};
  for (const [key, ref] of Object.entries(refs ?? {})) {
    if (!ref) continue;
    snapshotRefs[key] = { key: ref.name, version: ref.version };
  }
  return snapshotRefs;
}

function splitSkillRevisionRef(skillRevisionRef: string): {
  skillId: string;
  revision: string;
} {
  const at = skillRevisionRef.lastIndexOf('@');
  if (at <= 0 || at === skillRevisionRef.length - 1) {
    throw new HarnessAdmissionError(
      'FROZEN_ROUTE_MISMATCH',
      `Skill revision ref ${skillRevisionRef} is not in skillId@revision form.`,
    );
  }
  return {
    skillId: skillRevisionRef.slice(0, at),
    revision: skillRevisionRef.slice(at + 1),
  };
}

function capabilityRequirementsFromAxes(
  axes: readonly ModelCapabilityRequirementAxis[],
): Array<{ capability: string; requirement?: string }> {
  return axes.map((axis) => ({ capability: axis.axisId }));
}

/**
 * Deterministic fact revision refs for the freeze, mirroring the composer
 * proposal's factIntentions (identity + brief) so the snapshot names the same
 * fact heads the plan was compiled against.
 */
function factRevisionRefsFromSnapshot(
  snapshot: CreationExecutionSnapshot,
): string[] {
  return [
    `identity:${snapshot.identity.id}@${snapshot.identity.revision}`,
    `brief:${snapshot.briefContext.id}@${snapshot.briefContext.revision}`,
  ];
}

function pendingConfirmationAuthority(input: {
  workflowId: string;
  request: HarnessWorkflowInput;
  pending: PendingExecutionPlanSnapshot;
  frozenAt: string;
}): PendingConfirmationAuthority {
  return {
    workflowId: input.workflowId,
    workspaceId: input.request.workspaceId,
    planId: input.pending.content.planId,
    planRevision: input.pending.content.planRevision,
    snapshotHash: input.pending.snapshotHash,
    quoteRef: input.pending.content.quoteRef,
    rightsRevisionRefs: [...input.pending.content.rightsRevisionRefs],
    factRevisionRefs: [...input.pending.content.factRevisionRefs],
    frozenAt: input.frozenAt,
    reservationAttempt:
      input.request.sourceTaskId || input.pending.content.planRevision > 1
        ? 'successor'
        : 'initial',
    ...(input.request.executionConfirmationContext
      ? {
          executionConfirmationContext:
            input.request.executionConfirmationContext,
        }
      : {}),
  };
}

function executionAssemblySnapshot(input: {
  workflowId: string;
  request: HarnessWorkflowInput;
  route: RouteSnapshot;
  promptRevisionRefs: Record<string, HarnessPromptRevisionReference>;
  skillStages: Record<HarnessStage, HarnessSkillManifestSnapshot[]>;
}): HarnessExecutionAssemblySnapshot {
  const route = input.route;
  if (!route.capabilityRevisionId) {
    throw new HarnessAdmissionError(
      'FROZEN_ROUTE_MISMATCH',
      'Execution assembly requires a frozen capability revision.',
    );
  }
  const skillRefs = [
    ...new Set(
      Object.values(input.skillStages)
        .flat()
        .map((skill) => skill.skillRevisionRef),
    ),
  ];
  const promptRefs = [
    ...new Set(
      Object.values(input.promptRevisionRefs).flatMap((prompt) =>
        prompt ? [`${prompt.name}@${prompt.version}`] : [],
      ),
    ),
  ];
  const binding = (
    values: string[],
  ): ObservabilityAxisBinding['skillRevision'] =>
    values.length === 1
      ? { kind: 'bound', value: values[0]! }
      : { kind: 'absent' };
  const scene =
    input.request.intent.context.scene?.trim() ||
    input.request.intent.context.intent.trim();
  const rootAxes = observabilityAxisBindingSchema.parse({
    axisScope: 'task_root',
    skillRevision: binding(skillRefs),
    promptVersion: binding(promptRefs),
    catalogRevision: {
      kind: 'bound',
      value: input.request.executionSnapshot!.catalogModel.revision,
    },
    scene: scene ? { kind: 'bound', value: scene } : { kind: 'absent' },
  });
  return {
    schemaVersion: 'harness-execution-assembly/v1',
    workflowId: input.workflowId,
    skillStages: structuredClone(input.skillStages),
    frozenRouteSnapshotDigest: fingerprintValue(route),
    promptRevisionRefs: structuredClone(input.promptRevisionRefs),
    rootAxes,
  };
}

function normalizeRequest(
  input: HarnessTaskRequest,
): HarnessWorkflowInputBeforeBounds {
  const {
    decisionReferences,
    executionSnapshot,
    usageReservation,
    executionPlanSnapshot,
    executionConfirmationContext,
    sourceTaskId,
    executionConfirmationRequestId,
    executionConfirmationReservationIdempotencyKey,
    executionConfirmationReservedCredits,
    executionConfirmationDiffFields,
    carrierUnitIds,
    carrierBillableUnits,
    pendingExecutionPlanSnapshot,
    executionPlanLiveFacts: _executionPlanLiveFacts,
    executionPlanFreeze: _executionPlanFreeze,
    packageConfirmationDecisionRef: _packageConfirmationDecisionRef,
    packageConfirmationRequestId: _packageConfirmationRequestId,
    ...request
  } = input;
  void _executionPlanLiveFacts;
  void _executionPlanFreeze;
  void _packageConfirmationDecisionRef;
  void _packageConfirmationRequestId;
  const parsed = harnessTaskRequestSchema.parse(request);
  const planSnapshot = executionPlanSnapshot
    ? executionPlanSnapshotSchema.parse(executionPlanSnapshot)
    : undefined;
  const snapshot = executionSnapshot
    ? creationExecutionSnapshotSchema.parse(executionSnapshot)
    : undefined;
  if (snapshot) {
    assertExecutionSnapshotMatchesRequest(snapshot, parsed, sourceTaskId);
    return {
      ...snapshotWorkflowInput(
        snapshot,
        usageReservation,
        decisionReferences,
		parsed.agentThreadId
			? asAgentThreadIdentity(parsed.agentThreadId)
			: undefined,
		parsed.agentRunId,
		parsed.artifactLineage,
      ),
      ...(sourceTaskId ? { sourceTaskId } : {}),
      ...(sourceTaskId ? { preparedAttemptId: parsed.taskId } : {}),
      ...(planSnapshot ? { executionPlanSnapshot: planSnapshot } : {}),
      ...(pendingExecutionPlanSnapshot ? { pendingExecutionPlanSnapshot } : {}),
      ...(executionConfirmationContext ? { executionConfirmationContext } : {}),
      ...(executionConfirmationRequestId ? { executionConfirmationRequestId } : {}),
      ...(executionConfirmationReservationIdempotencyKey
        ? { executionConfirmationReservationIdempotencyKey }
        : {}),
      ...(executionConfirmationReservedCredits
        ? { executionConfirmationReservedCredits }
        : {}),
      ...(executionConfirmationDiffFields
        ? { executionConfirmationDiffFields }
        : {}),
      ...(carrierUnitIds ? { carrierUnitIds } : {}),
      ...(carrierBillableUnits !== undefined ? { carrierBillableUnits } : {}),
    };
  }
  return {
    actorId: parsed.actorId,
    workspaceId: parsed.workspaceId,
    packageId: parsed.packageId,
    expectedRevision: parsed.expectedRevision,
    workflowRevision: parsed.workflowRevision,
    creationMode: parsed.creationMode,
    rawInput: parsed.rawInput,
    intent: parsed.intent,
    userSelectedSkillRefs: parsed.userSelectedSkillRefs,
    factScope: parsed.factScope ?? { storeId: parsed.workspaceId },
    ...(parsed.reuseSeed ? { reuseSeed: parsed.reuseSeed } : {}),
    ...(planSnapshot ? { executionPlanSnapshot: planSnapshot } : {}),
    ...(pendingExecutionPlanSnapshot ? { pendingExecutionPlanSnapshot } : {}),
    ...(executionConfirmationContext ? { executionConfirmationContext } : {}),
    ...(executionConfirmationRequestId ? { executionConfirmationRequestId } : {}),
    ...(executionConfirmationReservationIdempotencyKey
      ? { executionConfirmationReservationIdempotencyKey }
      : {}),
    ...(executionConfirmationReservedCredits
      ? { executionConfirmationReservedCredits }
      : {}),
    ...(executionConfirmationDiffFields
      ? { executionConfirmationDiffFields }
      : {}),
    ...(carrierUnitIds ? { carrierUnitIds } : {}),
    ...(carrierBillableUnits !== undefined ? { carrierBillableUnits } : {}),
		...(parsed.agentThreadId
			? { agentThreadId: asAgentThreadIdentity(parsed.agentThreadId) }
			: {}),
		...(parsed.agentRunId ? { agentRunId: parsed.agentRunId } : {}),
		...(parsed.artifactLineage ? { artifactLineage: parsed.artifactLineage } : {}),
  };
}

function billingTaskIdForAdmission(
  input: HarnessTaskRequest,
  request: HarnessWorkflowInput,
): string {
  const snapshotTaskId = request.executionSnapshot?.task.id?.trim();
  if (!request.executionSnapshot) return input.taskId;
  if (!snapshotTaskId) {
    throw new HarnessAdmissionError(
      'FROZEN_REQUEST_MISSING',
      'Billable execution requires the exact task id frozen in its execution snapshot.',
    );
  }
  const sourceTaskId = input.sourceTaskId?.trim();
  if (sourceTaskId && sourceTaskId !== snapshotTaskId) {
    throw new HarnessAdmissionError(
      'FROZEN_REQUEST_MISSING',
      'Caller sourceTaskId does not match the task id frozen in the execution snapshot.',
    );
  }
  return snapshotTaskId;
}

function carrierUnitIdFromFreeze(
  freeze: ExecutionPlanCompileFreeze | undefined,
): string {
  if (!freeze) return 'single';
  if (freeze.carrierUnitId?.trim()) return freeze.carrierUnitId.trim();
  if (freeze.carrier?.trim()) return freeze.carrier;
  const carriers = [...new Set(freeze.deliverables.map((deliverable) => deliverable.kind))];
  if (carriers.length !== 1 || !carriers[0]) {
    throw new HarnessAdmissionError(
      'FROZEN_REQUEST_MISSING',
      'Execution freeze must name exactly one carrier before billing admission.',
    );
  }
  return carriers[0];
}

function normalizeCarrierUnitIds(
  units: readonly string[] | undefined,
  current: string,
): string[] {
  const frozen = units?.map((unit) => unit.trim()) ?? [current];
  if (
    frozen.length === 0 ||
    frozen.some((unit) => !unit) ||
    new Set(frozen).size !== frozen.length ||
    !frozen.includes(current)
  ) {
    throw new HarnessAdmissionError(
      'FROZEN_REQUEST_MISSING',
      'Carrier aggregate membership must be frozen and include the executing carrier.',
    );
  }
  return [...frozen].sort();
}

function carrierBillableUnitsFromFreeze(
  freeze: ExecutionPlanCompileFreeze | undefined,
): number {
  if (!freeze) return 1;
  const units = freeze.deliverables.reduce(
    (sum, deliverable) => sum + deliverable.quantity,
    0,
  );
  if (!Number.isSafeInteger(units) || units < 1) {
    throw new HarnessAdmissionError(
      'FROZEN_REQUEST_MISSING',
      'Execution freeze must carry a positive carrier billable allocation.',
    );
  }
  return units;
}

function snapshotWorkflowInput(
  snapshot: CreationExecutionSnapshot,
  usageReservation?: CreationSubmissionRecord['usageReservation'],
  decisionReferences?: HarnessWorkflowInput['decisionReferences'],
	agentThreadId?: AgentThreadIdentity,
	agentRunId?: string,
	artifactLineage?: HarnessWorkflowInput["artifactLineage"],
): HarnessWorkflowInputBeforeBounds {
  const semanticDecision = snapshot.semanticDecision;
  const frozenDecisionReferences = [
    ...(decisionReferences ?? []),
  ];
  if (
    semanticDecision &&
    !frozenDecisionReferences.some(
      ({ id }) => id === semanticDecision.reference.id,
    )
  ) {
    frozenDecisionReferences.unshift(semanticDecision.reference);
  }
  return {
		...(agentThreadId ? { agentThreadId } : {}),
		...(agentRunId ? { agentRunId } : {}),
		...(artifactLineage ? { artifactLineage } : {}),
    actorId: snapshot.actorId,
    workspaceId: snapshot.workspaceId,
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: snapshot.revision,
    creationMode: snapshot.creationMode,
    rawInput: snapshot.intent.text,
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: semanticDecision
          ? [
              `Merchant decision (${semanticDecision.reference.field}): ${semanticDecision.reference.value}`,
            ]
          : [],
        ...(semanticDecision
          ? {
              [semanticDecision.reference.field]:
                semanticDecision.reference.value,
            }
          : {}),
      },
      assetReferences: snapshot.sources.assets.map((asset) => asset.id),
    },
    userSelectedSkillRefs: snapshot.userSelectedSkillRefs,
    factScope: { storeId: snapshot.workspaceId },
    executionSnapshot: snapshot,
    ...(frozenDecisionReferences.length > 0
      ? { decisionReferences: frozenDecisionReferences }
      : {}),
    ...(usageReservation ? { usageReservation } : {}),
  };
}

function assertExecutionSnapshotMatchesRequest(
  snapshot: CreationExecutionSnapshot,
  request: z.infer<typeof harnessTaskRequestSchema>,
  sourceTaskId?: string,
) {
  const snapshotAssetIds = snapshot.sources.assets.map((asset) => asset.id);
  const matchingAssets =
    snapshotAssetIds.length === request.intent.assetReferences.length &&
    snapshotAssetIds.every(
      (assetId, index) => assetId === request.intent.assetReferences[index],
    );
  const context = request.intent.context;
  const semanticDecision = snapshot.semanticDecision;
  const expectedContext = {
    workId: snapshot.work.id,
    intent: snapshot.intent.text,
    sourceSummaries: semanticDecision
      ? [
          `Merchant decision (${semanticDecision.reference.field}): ${semanticDecision.reference.value}`,
        ]
      : [],
  };
  if (
    snapshot.actorId !== request.actorId ||
    snapshot.workspaceId !== request.workspaceId ||
    snapshot.task.id !== (sourceTaskId ?? request.taskId) ||
    snapshot.work.id !== context.workId ||
    snapshot.contentPackage.id !== request.packageId ||
    snapshot.contentPackage.expectedRevision !== request.expectedRevision ||
    snapshot.revision !== request.workflowRevision ||
    snapshot.creationMode !== request.creationMode ||
    snapshot.intent.text !== request.rawInput ||
    fingerprintValue(context) !== fingerprintValue(expectedContext) ||
    !isDefaultFactScope(request.factScope, snapshot.workspaceId) ||
    request.reuseSeed !== undefined ||
    !matchingAssets
  ) {
    throw new HarnessAdmissionError(
      'EXECUTION_SNAPSHOT_MISMATCH',
      'The execution snapshot does not match the Harness task request.',
    );
  }
}

function isDefaultFactScope(
  scope: StoreFact['scope'] | undefined,
  workspaceId: string,
) {
  return (
    scope === undefined ||
    (scope.storeId === workspaceId &&
      scope.serviceId === undefined &&
      scope.personaId === undefined &&
      scope.platform === undefined)
  );
}
