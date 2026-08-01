import {
  agentPrimitiveLifecycleEventSchema,
  boundedExecutionLimitsSchema,
  boundedExecutionSnapshotSchema,
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
  type HarnessStage,
  type ModelCapabilityRequirementAxis,
  type AgentPrimitiveLifecycleEvent,
  observabilityAxisBindingSchema,
  type ObservabilityAxisBinding,
  type ReuseTaskSeed,
  type StoreFact,
  type TaskIntentInput,
} from '@meiye/contracts';
import { z } from 'zod';

import {
  creationExecutionSnapshotSchema,
  type CreationExecutionSnapshot,
} from '../execution-spine/creation-execution-snapshot.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { RouteSnapshot } from '../model-supply/index.js';
import { serverAuditReference } from '../creation-experience/creation-experience-events.js';
import type { ResolvedSkillInstruction } from '../skills/types.js';
import {
  HARNESS_CORE_PROMPT_KEYS,
  harnessPromptCapabilityRequirement,
  promptRevisionReferences,
  promptTraceReference,
} from './langfuse-prompts.js';
import type {
  HarnessFrozenPrompts,
  HarnessPromptResolver,
  HarnessPromptRevisionReference,
} from './langfuse-prompts.js';

export interface HarnessWorkflowInput {
  actorId: string;
  workspaceId: string;
  packageId: string;
  expectedRevision: number;
  workflowRevision: number;
  creationMode: 'customized' | 'free';
  rawInput: string;
  intent: TaskIntentInput;
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
}

export interface HarnessSkillManifestSnapshot {
  skillRevisionRef: string;
  contentHash: string;
  requiredModelCapabilities: string[];
  /** Full server-resolved execution material frozen at admission for new tasks. */
  resolvedInstruction?: ResolvedSkillInstruction;
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
  .strict();

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
      | 'REQUEST_FINGERPRINT_CONFLICT',
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
  ) {}

  async submit(input: HarnessTaskRequest) {
    const normalized = normalizeRequest(input);
    const fingerprint = fingerprintValue(normalized);
    const existing = await this.registry.lookup?.({
      taskId: input.taskId,
      fingerprint,
      request: normalized,
    });
    if (existing) {
      return this.resumeExisting(existing);
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
    const selectedSkillStages = await this.selectSkillManifests(normalized);
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
            ).concat(skillCapabilityRequirements(selectedSkillStages)),
          },
        ),
      };
    }
    if (this.prompts) {
      const prompts = await this.prompts.resolve();
      request = {
        ...request,
        prompts,
        promptRevisionRefs: promptRevisionReferences(prompts),
      };
    }
    const skillStages = await this.materializeSkillManifests(
      normalized,
      selectedSkillStages,
    );
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
    assertHarnessExecutionAssemblyPinned(request);
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
      return this.resumeExisting(claim);
    }
    await this.recordExecutionAssemblyAudit(request, [
      'manifest_resolution',
      'hot_assembly',
      'prompt_resolution',
      'task_pin',
    ]);
    await this.recordPromptFallbackAudits(input.taskId, request);
    const handle = await this.starter.start({
      workflowId: input.taskId,
      request,
    });
    return { workflowId: handle.workflowId, replayed: false as const };
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
    return { workflowId: handle.workflowId, replayed: true as const };
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
    assembly.workflowId !== request.executionSnapshot.task.id
  ) {
    throw new Error(
      'Execution assembly workflow does not match the durable task.',
    );
  }
}

function primaryTaskCapabilityRequirements(
  snapshot: CreationExecutionSnapshot,
): ModelCapabilityRequirementAxis[] {
  if (snapshot.lens === 'copy') {
    // Pin the historical 14 core harness axes only. XHS vertical sites
    // (#315) stay in the prompt registry for resolve/versioning/fallback but
    // are not part of every copy-lens admission surface until their pipeline
    // tickets wire explicit consumers.
    return HARNESS_CORE_PROMPT_KEYS.map((key) =>
      harnessPromptCapabilityRequirement(key),
    );
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
): ModelCapabilityRequirementAxis {
  const requiredProtocolCapabilities: string[] = [];
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
    ...request
  } = input;
  const parsed = harnessTaskRequestSchema.parse(request);
  const snapshot = executionSnapshot
    ? creationExecutionSnapshotSchema.parse(executionSnapshot)
    : undefined;
  if (snapshot) {
    assertExecutionSnapshotMatchesRequest(snapshot, parsed);
    return snapshotWorkflowInput(
      snapshot,
      usageReservation,
      decisionReferences,
    );
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
    factScope: parsed.factScope ?? { storeId: parsed.workspaceId },
    ...(parsed.reuseSeed ? { reuseSeed: parsed.reuseSeed } : {}),
  };
}

function snapshotWorkflowInput(
  snapshot: CreationExecutionSnapshot,
  usageReservation?: CreationSubmissionRecord['usageReservation'],
  decisionReferences?: HarnessWorkflowInput['decisionReferences'],
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
    snapshot.task.id !== request.taskId ||
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
