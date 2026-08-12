import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  type BoundedExecutionLimits,
} from '@meiye/contracts';
import type { RouteSnapshot } from '../model-supply/index.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { billingPlanId } from '../execution-spine/billing-identity.js';
import { CreationStagePort } from '../execution-spine/creation-stage-port.js';

import {
  HarnessAdmissionError,
  HarnessExecutionBoundsAdmissionError,
  HarnessTaskAdmissionService,
  harnessTaskRequestSchema,
  type HarnessExecutionBoundsResolver,
  type HarnessFrozenRouteSnapshotResolver,
  type HarnessSkillManifestResolver,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowStarter,
} from './task-admission.js';
import {
  createCreationExecutionSnapshot,
  creationExecutionSnapshotSchema,
  OFFICIAL_NEUTRAL_IDENTITY,
} from '../execution-spine/creation-execution-snapshot.js';
import {
  asAgentThreadIdentity,
  type CreationSubmissionRecord,
} from '../execution-spine/submission-coordinator.js';
import type {
  HarnessFrozenPrompts,
  HarnessPromptResolver,
} from './langfuse-prompts.js';
import {
  HARNESS_LANGFUSE_PROMPT_NAMES,
  type HarnessPromptKey,
} from './langfuse-prompts.js';
import {
  COPY_TASK_PROMPT_PACK_IDS,
  promptKeysForPacks,
} from './prompt-packs.js';
import {
  buildExecutionPlanSnapshot,
  ExecutionPlanAdmissionService,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import { MemoryExecutionPlanSnapshotStore } from './memory-execution-plan-admission-store.js';

test('same task and payload returns the original workflow handle', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const service = new HarnessTaskAdmissionService(registry, starter);

  const first = await service.submit(taskRequest());
  const replay = await service.submit(taskRequest());

  assert.deepEqual(first, { workflowId: 'task-35', replayed: false });
  assert.deepEqual(replay, { workflowId: 'task-35', replayed: true });
  assert.equal(starter.starts, 2);
  assert.deepEqual(starter.workflowIds, ['task-35', 'task-35']);
  assert.deepEqual(starter.runtimeIds, [undefined, 'legacy-task-35']);
});

test('prepare freezes without starting and dispatch starts the persisted request once', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const service = new HarnessTaskAdmissionService(registry, starter);

  const prepared = await service.preparePendingConfirmation(taskRequest());
  assert.deepEqual(prepared, { workflowId: 'task-35', replayed: false });
  assert.equal(starter.starts, 0);

  const dispatched = await service.dispatchPrepared(taskRequest());
  assert.deepEqual(dispatched, { workflowId: 'task-35', replayed: true });
  assert.equal(starter.starts, 1);
});

test('a pre-deploy prepared request replays when Stage starts sending agentRunId', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const service = new HarnessTaskAdmissionService(registry, starter);
  const legacyRequest = {
    ...taskRequest({ taskId: 'task-prepared-before-agent-run-id' }),
    agentThreadId: asAgentThreadIdentity('thread:prepared-authority'),
  };

  const prepared = await service.preparePendingConfirmation(legacyRequest);
  const dispatched = await service.dispatchPrepared({
    ...legacyRequest,
    agentRunId: 'run:prepared-authority',
  });

  assert.deepEqual(prepared, {
    workflowId: 'task-prepared-before-agent-run-id',
    replayed: false,
  });
  assert.deepEqual(dispatched, {
    workflowId: 'task-prepared-before-agent-run-id',
    replayed: true,
  });
  assert.equal(starter.requests[0]?.agentRunId, undefined);
  assert.equal(
    registry.claims[0]?.fingerprint,
    registry.lookups[1]?.fingerprint,
  );
});

test('same task and different payload is an explicit 409 conflict', async () => {
  const service = new HarnessTaskAdmissionService(
    new MemoryRequestRegistry(),
    new RecordingStarter(),
  );
  await service.submit(taskRequest());

  await assert.rejects(
    service.submit(taskRequest({ rawInput: '换成另一个任务' })),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'REQUEST_FINGERPRINT_CONFLICT' &&
      error.status === 409,
  );
});

test('admission rejects a task submission without creationMode', () => {
  const { creationMode: _creationMode, ...request } = taskRequest();

  assert.throws(() => harnessTaskRequestSchema.parse(request));
});

test('agentRunId requires its paired agentThreadId while legacy thread-only requests remain valid', () => {
  assert.throws(
    () =>
      harnessTaskRequestSchema.parse({
        ...taskRequest(),
        agentRunId: 'run:unpaired',
      }),
    /agentRunId requires agentThreadId/u,
  );
  assert.doesNotThrow(() =>
    harnessTaskRequestSchema.parse({
      ...taskRequest(),
      agentThreadId: 'thread:legacy',
    }),
  );
});

test('workflow id is the task id and request fingerprint is canonical', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const service = new HarnessTaskAdmissionService(registry, starter);

  await service.submit(taskRequest());
  await service.submit({
    ...taskRequest(),
    intent: {
      assetReferences: [],
      context: {
        sourceSummaries: [],
        intent: '把新团购做一套能发的',
        workId: 'work-1',
      },
    },
  });

  assert.equal(starter.workflowIds[0], 'task-35');
  assert.equal(
    registry.claims[0]?.fingerprint,
    registry.lookups[1]?.fingerprint,
  );
});

test('Composer execution snapshots cannot be submitted under another task envelope', async () => {
  const service = new HarnessTaskAdmissionService(
    new MemoryRequestRegistry(),
    new RecordingStarter(),
  );
  const snapshot = composerSnapshot();

  await assert.rejects(
    service.submit({
      ...snapshotTaskRequest(snapshot),
      packageId: 'package-other',
    }),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'EXECUTION_SNAPSHOT_MISMATCH' &&
      error.status === 409,
  );
});

test('Composer execution snapshots reject forged ContextBundle inputs', async () => {
  const service = new HarnessTaskAdmissionService(
    new MemoryRequestRegistry(),
    new RecordingStarter(),
  );
  const snapshot = composerSnapshot();
  const request = snapshotTaskRequest(snapshot);
  const forged = [
    {
      ...request,
      intent: {
        ...request.intent,
        context: {
          ...request.intent.context,
          sourceSummaries: ['untrusted source summary'],
        },
      },
    },
    {
      ...request,
      intent: {
        ...request.intent,
        context: {
          ...request.intent.context,
          scene: 'unreviewed scene',
          tone: 'unreviewed tone',
          audience: 'unreviewed audience',
        },
      },
    },
    {
      ...request,
      factScope: { storeId: snapshot.workspaceId, serviceId: 'service-other' },
    },
    {
      ...request,
      reuseSeed: {
        assetId: 'asset-series-1',
        assetRevision: 1,
        sourcePackageId: 'package-source-1',
        sourceVersionId: 'version-source-1',
        sourcePackageRevision: 1,
        assetRevisionId: 'asset-series-1:1',
        fixedItemKeys: [],
        variableSlotKeys: [],
      },
    },
  ];

  for (const input of forged) {
    await assert.rejects(
      service.submit(input),
      (error: unknown) =>
        error instanceof HarnessAdmissionError &&
        error.code === 'EXECUTION_SNAPSHOT_MISMATCH' &&
        error.status === 409,
    );
  }
});

test('accepted task keeps its frozen prompt while only a new task observes a published version', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const resolver = new MutablePromptResolver();
  const service = new HarnessTaskAdmissionService(registry, starter, resolver);

  await service.submit(taskRequest());
  resolver.version = 8;
  await service.submit(taskRequest());
  await service.submit(taskRequest({ taskId: 'task-36' }));
  resolver.version = 6;
  await service.submit(taskRequest({ taskId: 'task-36' }));
  await service.submit(taskRequest({ taskId: 'task-37' }));

  assert.deepEqual(
    starter.requests.map((request) => request.prompts?.intentNaming.version),
    ['7', '7', '8', '8', '6'],
  );
  assert.deepEqual(
    starter.requests.map((request) => request.prompts?.intentNaming.content),
    ['intent-v7', 'intent-v7', 'intent-v8', 'intent-v8', 'intent-v6'],
  );
  assert.deepEqual(
    starter.requests.map(
      (request) => request.promptRevisionRefs?.intentNaming?.version,
    ),
    ['7', '7', '8', '8', '6'],
  );
  assert.equal(
    registry.claims[0]?.fingerprint,
    registry.lookups[1]?.fingerprint,
  );
});

test('copy admission resolves only its declared prompt packs', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const resolver = new SelectivePromptResolver();
  const snapshot = composerSnapshot();
  const expected = promptKeysForPacks(['agentControl', 'copy']);
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    resolver,
    undefined,
    undefined,
    { async resolve() { return copyRoute(snapshot); } },
    undefined,
    undefined,
    undefined,
    undefined,
    {
      async resolvePromptBindings() {
        return Object.fromEntries(
          expected.map((key) => [key, { key, version: 'release-42' }]),
        );
      },
    },
  );

  await service.submit(snapshotTaskRequest(snapshot));

  assert.deepEqual(resolver.requestedKeys, [expected]);
  assert.deepEqual(
    resolver.requestedVersions,
    [Object.fromEntries(expected.map((key) => [key, 'release-42']))],
  );
  assert.equal(resolver.fullResolveCalls, 0);
  assert.deepEqual(
    Object.keys(starter.requests[0]?.promptRevisionRefs ?? {}).sort(),
    [...expected].sort(),
  );
});

for (const assetIds of [[], ['asset-viral-1']] as const) {
  test(`viral admission selects rewrite ${assetIds.length ? 'with' : 'without'} image vision`, async () => {
    const registry = new MemoryRequestRegistry();
    const resolver = new SelectivePromptResolver();
    const snapshot = composerSnapshot(assetIds);
    const base = promptKeysForPacks(['agentControl', 'copy', 'viral']);
    const expected = assetIds.length
      ? base
      : base.filter((key) => key !== 'xhsViralImageVision');
    const service = new HarnessTaskAdmissionService(
      registry,
      new RecordingStarter(),
      resolver,
      undefined,
      undefined,
      { async resolve() { return copyRoute(snapshot); } },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        async resolvePromptBindings() {
          return Object.fromEntries(expected.map((key) => [key, { key, version: 'release-viral' }]));
        },
      },
    );
    await service.submit(snapshotTaskRequest(snapshot));
    assert.deepEqual(resolver.requestedKeys, [expected]);
  });
}

test('accepted task replay reads the frozen request before prompt resolution', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const resolver = new MutablePromptResolver();
  const service = new HarnessTaskAdmissionService(registry, starter, resolver);

  await service.submit(taskRequest());
  resolver.failure = new Error('Langfuse unavailable');

  const replay = await service.submit(taskRequest());

  assert.deepEqual(replay, { workflowId: 'task-35', replayed: true });
  assert.equal(resolver.calls, 1);
  assert.equal(starter.requests[1]?.prompts?.intentNaming.version, '7');
});

test('media admission freezes one server route and replay reads the durable copy', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const snapshot = mediaComposerSnapshot();
  const frozenRoute = mediaRoute(snapshot);
  const resolver: HarnessFrozenRouteSnapshotResolver & { calls: number } = {
    calls: 0,
    async resolve(input) {
      this.calls += 1;
      assert.deepEqual(input, snapshot);
      return structuredClone(frozenRoute);
    },
  };
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    new MutablePromptResolver(),
    undefined,
    undefined,
    resolver,
  );

  await service.submit(snapshotTaskRequest(snapshot));
  await service.submit(snapshotTaskRequest(snapshot));

  assert.equal(resolver.calls, 1);
  assert.deepEqual(starter.requests[0]?.frozenRouteSnapshot, frozenRoute);
  assert.deepEqual(starter.requests[1]?.frozenRouteSnapshot, frozenRoute);
});

test('copy admission freezes one server route and replay never reads current heads', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const snapshot = composerSnapshot();
  const frozenRoute = copyRoute(snapshot);
  const resolver: HarnessFrozenRouteSnapshotResolver & { calls: number } = {
    calls: 0,
    async resolve(input) {
      this.calls += 1;
      assert.deepEqual(input, snapshot);
      return structuredClone(frozenRoute);
    },
  };
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    new MutablePromptResolver(),
    undefined,
    undefined,
    resolver,
  );

  await service.submit(snapshotTaskRequest(snapshot));
  await service.submit(snapshotTaskRequest(snapshot));

  assert.equal(resolver.calls, 1);
  assert.deepEqual(starter.requests[0]?.frozenRouteSnapshot, frozenRoute);
  assert.deepEqual(starter.requests[1]?.frozenRouteSnapshot, frozenRoute);
});

test('Composer admission assembles manifest, binding, prompts, pin, then starts', async () => {
  const order: string[] = [];
  const snapshot = composerSnapshot();
  const route = copyRoute(snapshot);
  const registry = new MemoryRequestRegistry();
  const originalClaim = registry.claim.bind(registry);
  registry.claim = async (input) => {
    order.push('claim');
    return originalClaim(input);
  };
  const starter = new RecordingStarter();
  const originalStart = starter.start.bind(starter);
  starter.start = async (input) => {
    order.push('start');
    return originalStart(input);
  };
  const manifests: HarnessSkillManifestResolver = {
    async select({ stage }) {
      order.push(`manifest:${stage}`);
      return stage === 'intent_naming'
        ? [
            {
              skillRevisionRef: 'skill.intent@3',
              contentHash: 'hash-skill-intent-r3',
              requiredModelCapabilities: ['structured_output'],
            },
          ]
        : [];
    },
    async materialize({ stage, manifests: selected }) {
      order.push(`skill-prompt-materialization:${stage}`);
      return selected.map((manifest) => ({
        ...structuredClone(manifest),
        resolvedInstruction: {
          skillRevisionRef: manifest.skillRevisionRef,
          instruction: 'Use the accepted intent Skill.',
          contentHash: manifest.contentHash,
          requiredModelCapabilities: [
            ...manifest.requiredModelCapabilities,
          ],
          executionMode: 'prompt_materialized',
        },
      }));
    },
  };
  const resolver: HarnessFrozenRouteSnapshotResolver = {
    async resolve(_input, assembly) {
      order.push('hot-assembly');
      const axisIds =
        assembly?.requirements.map((requirement) => requirement.axisId) ?? [];
      const promptAxisIds = axisIds.filter(
        (axisId) => !axisId.startsWith('skill:'),
      );
      // V31-20: a copy-lens task declares capability for exactly the prompt
      // sites its declared packs freeze — no whole-registry surface, and no
      // axis for a site the request never pinned.
      const copyPromptKeys = promptKeysForPacks(COPY_TASK_PROMPT_PACK_IDS);
      assert.deepEqual(promptAxisIds, [...copyPromptKeys]);
      assert.equal(
        promptAxisIds.some((axisId) => axisId.startsWith('xhs')),
        false,
      );
      assert.deepEqual(axisIds, [
        ...copyPromptKeys,
        'skill:skill.intent@3',
      ]);
      return {
        ...structuredClone(route),
        capabilityRequirements: structuredClone(assembly?.requirements ?? []),
        capabilityMatches: (assembly?.requirements ?? []).map(
          (requirement) => ({
            axisId: requirement.axisId,
            deploymentId: route.deploymentId,
            outcome: 'eligible' as const,
            reasons: [],
            evidenceRefs: [`catalog://${requirement.axisId}`],
          }),
        ),
      };
    },
  };
  const prompts = new MutablePromptResolver();
  const promptResolver: HarnessPromptResolver = {
    async resolve() {
      order.push('prompt-resolution');
      return prompts.resolve();
    },
  };
  const assemblyAudits: unknown[] = [];
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    promptResolver,
    undefined,
    undefined,
    resolver,
    manifests,
    {
      async appendAuditIdempotently(event) {
        order.push(event.payload.payload.primitiveId);
        assemblyAudits.push(structuredClone(event));
      },
    },
  );

  await service.submit(snapshotTaskRequest(snapshot));

  assert.deepEqual(order, [
    'manifest:intent_naming',
    'manifest:context_injection',
    'manifest:brief_compilation',
    'manifest:execution_selection',
    'manifest:assembly_delivery',
    'hot-assembly',
    'prompt-resolution',
    'skill-prompt-materialization:intent_naming',
    'claim',
    'harness-assembly:manifest_resolution',
    'harness-assembly:hot_assembly',
    'harness-assembly:prompt_resolution',
    'harness-assembly:task_pin',
    'start',
  ]);
  assert.deepEqual(starter.requests[0]?.executionAssembly?.rootAxes, {
    axisScope: 'task_root',
    skillRevision: {
      kind: 'bound',
      value: 'skill.intent@3',
    },
    promptVersion: { kind: 'absent' },
    catalogRevision: {
      kind: 'bound',
      value: snapshot.catalogModel.revision,
    },
    scene: { kind: 'bound', value: snapshot.intent.text },
  });
  assert.equal(
    starter.requests[0]?.executionAssembly?.frozenRouteSnapshotDigest,
    fingerprintValue(starter.requests[0]?.frozenRouteSnapshot),
  );
  assert.equal(assemblyAudits.length, 4);
  assert.deepEqual(
    assemblyAudits.map(
      (audit) =>
        (
          audit as {
            payload: {
              axisScope: string;
              payload: { primitiveId: string };
            };
          }
        ).payload.payload.primitiveId,
    ),
    [
      'harness-assembly:manifest_resolution',
      'harness-assembly:hot_assembly',
      'harness-assembly:prompt_resolution',
      'harness-assembly:task_pin',
    ],
  );
  const taskPinEvent = (
    assemblyAudits.at(-1) as {
      payload: {
        eventType: string;
        taskId: string;
        workspaceId: string;
        actorId: string;
        actorKind: string;
        idempotencyKey: string;
        axisScope: string;
        skillRevision: string | null;
        promptVersion: string | null;
        catalogRevision: string | null;
        scene: string | null;
        payload: unknown;
      };
    }
  ).payload;
  assert.deepEqual(taskPinEvent, {
    eventType: 'agent_primitive.lifecycle',
    taskId: snapshot.task.id,
    workspaceId: snapshot.workspaceId,
    actorId: taskPinEvent.actorId,
    actorKind: 'worker',
    idempotencyKey: taskPinEvent.idempotencyKey,
    axisScope: 'task_root',
    skillRevision: 'skill.intent@3',
    promptVersion: null,
    catalogRevision: snapshot.catalogModel.revision,
    scene: snapshot.intent.text,
    payload: {
      primitiveId: 'harness-assembly:task_pin',
      phase: 'succeeded',
      billing: { kind: 'not_billed' },
    },
  });
});

test('workflow start failure cannot prewrite execution or persistence success', async () => {
  const snapshot = composerSnapshot();
  const auditSteps: string[] = [];
  const taskPinAxes: Array<{
    axisScope: string;
    catalogRevision: string | null;
    scene: string | null;
  }> = [];
  const service = new HarnessTaskAdmissionService(
    new MemoryRequestRegistry(),
    {
      async start() {
        throw new Error('DBOS start failed');
      },
    },
    new MutablePromptResolver(),
    undefined,
    undefined,
    {
      async resolve() {
        return copyRoute(snapshot);
      },
    },
    {
      async select() {
        return [];
      },
      async materialize() {
        return [];
      },
    },
    {
      async appendAuditIdempotently(event) {
        auditSteps.push(event.payload.payload.primitiveId);
        if (
          event.payload.payload.primitiveId ===
          'harness-assembly:task_pin'
        ) {
          taskPinAxes.push({
            axisScope: event.payload.axisScope,
            catalogRevision: event.payload.catalogRevision,
            scene: event.payload.scene,
          });
        }
      },
    },
  );

  await assert.rejects(
    service.submit(snapshotTaskRequest(snapshot)),
    /DBOS start failed/,
  );
  assert.deepEqual(auditSteps, [
    'harness-assembly:manifest_resolution',
    'harness-assembly:hot_assembly',
    'harness-assembly:prompt_resolution',
    'harness-assembly:task_pin',
  ]);
  assert.deepEqual(taskPinAxes, [
    {
      axisScope: 'task_root',
      catalogRevision: snapshot.catalogModel.revision,
      scene: snapshot.intent.text,
    },
  ]);
});

test('Skill capability declarations must translate through the v1 vocabulary', async () => {
  const registry = new MemoryRequestRegistry();
  const snapshot = composerSnapshot();
  const route = copyRoute(snapshot);
  const service = new HarnessTaskAdmissionService(
    registry,
    new RecordingStarter(),
    new MutablePromptResolver(),
    undefined,
    undefined,
    {
      async resolve(_snapshot, assembly) {
        assert.deepEqual(assembly?.requirements.at(-1), {
          axisId: 'skill:skill.capability-vocabulary@1',
          vocabularyVersion: 'model-capability-v1',
          requiredProtocolCapabilities: [
            'structured-output',
            'tool-calling',
          ],
          requiredModalities: ['image/*'],
          requiredBusinessTags: ['beauty-brand-voice'],
          requiredModalityCapabilities: [
            {
              modality: 'image/*',
              capability: 'cjk-text-render',
            },
          ],
          unknownPolicy: 'conservative_always_available',
        });
        return {
          ...structuredClone(route),
          capabilityRequirements: structuredClone(
            assembly?.requirements ?? [],
          ),
          capabilityMatches: (assembly?.requirements ?? []).map(
            (requirement) => ({
              axisId: requirement.axisId,
              deploymentId: route.deploymentId,
              outcome: 'eligible' as const,
              reasons: [],
              evidenceRefs: [`catalog://${requirement.axisId}`],
            }),
          ),
        };
      },
    },
    {
      async select({ stage }) {
        if (stage !== 'intent_naming') return [];
        return [
          {
            skillRevisionRef: 'skill.capability-vocabulary@1',
            contentHash: 'hash-capability-vocabulary',
            requiredModelCapabilities: [
              'structured_output',
              'tool_calling',
              'image/*',
              'beauty-brand-voice',
              'cjk-text-render',
            ],
          },
        ];
      },
      async materialize({ manifests }) {
        return manifests.map((manifest) => ({
          ...structuredClone(manifest),
          resolvedInstruction: {
            skillRevisionRef: manifest.skillRevisionRef,
            instruction: 'Capability vocabulary fixture.',
            contentHash: manifest.contentHash,
            requiredModelCapabilities: [
              ...manifest.requiredModelCapabilities,
            ],
            executionMode: 'prompt_materialized',
          },
        }));
      },
    },
  );

  await service.submit(snapshotTaskRequest(snapshot));
  assert.equal(registry.claims.length, 1);
});

test('Skill capability declarations fail closed on blank values', async () => {
  const registry = new MemoryRequestRegistry();
  const snapshot = composerSnapshot();
  const service = new HarnessTaskAdmissionService(
    registry,
    new RecordingStarter(),
    new MutablePromptResolver(),
    undefined,
    undefined,
    {
      async resolve() {
        throw new Error('route resolver must not run');
      },
    },
    {
      async select({ stage }) {
        return stage === 'intent_naming'
          ? [
              {
                skillRevisionRef: 'skill.blank-capability@1',
                contentHash: 'hash-blank-capability',
                requiredModelCapabilities: ['  '],
              },
            ]
          : [];
      },
      async materialize() {
        throw new Error('materialization must not run');
      },
    },
  );

  await assert.rejects(
    service.submit(snapshotTaskRequest(snapshot)),
    /declares an empty model capability/u,
  );
  assert.equal(registry.claims.length, 0);
});

test('media admission rejects a caller-provided frozen route', async () => {
  const registry = new MemoryRequestRegistry();
  const snapshot = mediaComposerSnapshot();
  const service = new HarnessTaskAdmissionService(
    registry,
    new RecordingStarter(),
  );

  await assert.rejects(
    service.submit({
      ...snapshotTaskRequest(snapshot),
      frozenRouteSnapshot: mediaRoute(snapshot),
    } as Parameters<HarnessTaskAdmissionService['submit']>[0]),
  );
  assert.equal(registry.claims.length, 0);
});

test('media admission rejects a missing production route resolver before claim', async () => {
  const registry = new MemoryRequestRegistry();
  const snapshot = mediaComposerSnapshot();
  const service = new HarnessTaskAdmissionService(
    registry,
    new RecordingStarter(),
  );

  await assert.rejects(
    service.submit(snapshotTaskRequest(snapshot)),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'FROZEN_ROUTE_MISMATCH' &&
      error.status === 409,
  );
  assert.equal(registry.claims.length, 0);
});

test('accepted task replay fails closed when the registry omits its frozen request', async () => {
  const registry = {
    async lookup() {
      return {
        kind: 'existing' as const,
        workflowId: 'task-35',
      };
    },
    async claim() {
      throw new Error('claim must not run for an accepted task');
    },
  } as unknown as HarnessTaskRequestRegistry;
  const resolver = new MutablePromptResolver();
  const service = new HarnessTaskAdmissionService(
    registry,
    new RecordingStarter(),
    resolver,
  );

  await assert.rejects(
    service.submit(taskRequest()),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'FROZEN_REQUEST_MISSING',
  );
  assert.equal(resolver.calls, 0);
});

test('prompt fallback is persisted through the first-party audit port', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const audits: Array<{
    id: string;
    eventType: string;
    payload: unknown;
  }> = [];
  const fallback = {
    ...prompt('harness/intent-naming', 'builtin intent fallback', 1),
    version: 'builtin-v1',
    source: 'builtin' as const,
    isFallback: true,
    fallbackReason: 'request_failed',
  };
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    {
      async resolve() {
        const prompts = await new MutablePromptResolver().resolve();
        return {
          ...prompts,
          intentNaming: fallback,
          briefCompilation: prompt('harness/brief-copy', 'brief-v7', 7),
        };
      },
    },
    {
      async appendAudit(event) {
        audits.push(event);
      },
    },
  );

  await service.submit(taskRequest());

  assert.deepEqual(audits, [
    {
      id: `audit-task-35-prompt-fallback-intentNaming-${fallback.contentHash}`,
      eventType: 'langfuse_prompt_fallback',
      payload: {
        promptKey: 'intentNaming',
        name: 'harness/intent-naming',
        version: 'builtin-v1',
        contentHash: fallback.contentHash,
        fallbackReason: 'request_failed',
        prompt: {
          name: 'harness/intent-naming',
          version: 'builtin-v1',
          contentHash: fallback.contentHash,
          label: 'production',
          source: 'builtin',
          isFallback: true,
          fallbackReason: 'request_failed',
        },
      },
      stage: 'prompt_resolution',
      workflowId: 'task-35',
      workspaceId: 'workspace-1',
    },
  ]);
  assert.equal(
    JSON.stringify(audits).includes('builtin intent fallback'),
    false,
  );
});

test('a required unset execution limit rejects admission before prompt resolution or workflow effects', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const prompts = new MutablePromptResolver();
  const bounds = new RequiredUnsetBoundsResolver();
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    prompts,
    undefined,
    bounds,
  );

  await assert.rejects(
    service.submit(snapshotTaskRequest(composerSnapshot())),
    (error: unknown) =>
      error instanceof HarnessExecutionBoundsAdmissionError &&
      error.code === 'REQUIRED_EXECUTION_LIMIT_UNSET' &&
      error.status === 503 &&
      error.limit === 'maxCostCents',
  );
  assert.equal(bounds.calls, 1);
  assert.equal(prompts.calls, 0);
  assert.equal(registry.claims.length, 0);
  assert.equal(starter.starts, 0);
});

test('snapshot admission preserves server-frozen decision references', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const snapshot = composerSnapshot();
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    new MutablePromptResolver(),
    undefined,
    undefined,
    {
      async resolve() {
        return structuredClone(copyRoute(snapshot));
      },
    },
  );
  const decision = {
    id: 'decision-note-style',
    field: 'note_style',
    value: 'practical_guide',
    revision: 1,
  };

  await service.submit({
    ...snapshotTaskRequest(snapshot),
    decisionReferences: [decision],
  });

  assert.deepEqual(starter.requests[0]?.decisionReferences, [decision]);
});

test('snapshot admission normalizes its semantic decision context', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const source = composerSnapshot();
  const reference = {
    id: 'decision-late-answer',
    field: 'offer_price',
    value: '398 元',
    revision: 1,
  };
  const snapshot = creationExecutionSnapshotSchema.parse({
    ...source,
    id: 'snapshot-decision-late-answer',
    semanticDecision: {
      sourceSnapshotId: source.id,
      reference,
    },
  });
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    new MutablePromptResolver(),
    undefined,
    undefined,
    {
      async resolve() {
        return structuredClone(copyRoute(snapshot));
      },
    },
  );

  await service.submit({
    ...snapshotTaskRequest(snapshot),
    decisionReferences: [reference],
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: ['Merchant decision (offer_price): 398 元'],
      },
      assetReferences: [],
    },
  });

  assert.deepEqual(starter.requests[0]?.decisionReferences, [reference]);
  assert.equal(
    (
      starter.requests[0]?.intent.context as Record<string, unknown> | undefined
    )?.offer_price,
    '398 元',
  );
});

test('admission freezes explicit default execution bounds without changing the request fingerprint', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const service = new HarnessTaskAdmissionService(registry, starter);

  await service.submit(taskRequest());
  await service.submit(taskRequest());

  assert.deepEqual(starter.requests[0]?.boundedExecution, {
    schemaVersion: 'bounded-execution-snapshot/v1',
    maxIterations: 'unset',
    maxCostCents: 'unset',
    maxWallClockMs: 'unset',
    maxDelegations: 'unset',
    requiredLimits: [],
    consumption: {
      iterations: 0,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
  });
  assert.equal(
    registry.claims[0]?.fingerprint,
    registry.lookups[1]?.fingerprint,
  );
});

test('changed server execution bounds do not change the client request fingerprint or a replayed pin', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const bounds = new MutableBoundsResolver();
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    undefined,
    undefined,
    bounds,
  );

  await service.submit(taskRequest());
  bounds.maxIterations = 25;
  await service.submit(taskRequest());

  assert.equal(bounds.calls, 1);
  assert.equal(
    registry.claims[0]?.fingerprint,
    registry.lookups[1]?.fingerprint,
  );
  assert.deepEqual(
    starter.requests.map((request) => request.boundedExecution?.maxIterations),
    [50, 50],
  );
});

test('V31-12 task-admission one-shot writes ExecutionPlanSnapshot and replays without double-write', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const snapshotStore = new MemoryExecutionPlanSnapshotStore();
  const admission = new ExecutionPlanAdmissionService(snapshotStore);
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    admission,
  );

  const content = planFrozenContent();
  const { snapshotHash } = freezeExecutionPlanContent(content);
  const planSnapshot = buildExecutionPlanSnapshot({ content, snapshotHash });

  const first = await service.submit({
    ...taskRequest({ taskId: 'task-v31-12' }),
    executionPlanSnapshot: planSnapshot,
  });
  assert.equal(first.replayed, false);
  assert.equal(
    starter.requests[0]?.executionPlanSnapshot?.snapshotHash,
    snapshotHash,
  );
  const admissionWorkflowId = `task-v31-12:plan:${content.planRevision}:${snapshotHash}`;
  const stored = await snapshotStore.getByWorkflowId(admissionWorkflowId);
  assert.equal(stored?.snapshot.snapshotHash, snapshotHash);

  const second = await service.submit({
    ...taskRequest({ taskId: 'task-v31-12' }),
    executionPlanSnapshot: planSnapshot,
  });
  assert.equal(second.replayed, true);
  // Registry replay path does not re-claim; snapshot row stays one-shot.
  const storedAgain = await snapshotStore.getByWorkflowId(admissionWorkflowId);
  assert.equal(storedAgain?.admittedAt, stored?.admittedAt);

  // Stale confirmation rejected on a fresh task (unique hash + drifted quote).
  const staleSnapshot = buildExecutionPlanSnapshot({
    content: {
      ...planFrozenContent(),
      planId: 'plan-admit-stale',
    } as unknown as ExecutionPlanFrozenContent,
  });
  await assert.rejects(
    () =>
      service.submit({
        ...taskRequest({ taskId: 'task-v31-12-stale' }),
        executionPlanSnapshot: staleSnapshot,
        executionPlanLiveFacts: { quoteRevision: 99 },
      }),
    (error: unknown) =>
      error instanceof Error &&
      /stale|STALE/i.test(String((error as { code?: string }).code ?? error)),
  );
});

/**
 * V31-11/12/14 paid main chain. The cycle this pins closed: a paid submission
 * arrives with no ExecutionPlanSnapshot, so admission may only assemble the
 * *pending* freeze and open a reserve-backed request. The immutable decision —
 * and therefore the admitted snapshot — cannot exist yet.
 */
function paidMediaSubmission(
  snapshot: ReturnType<typeof mediaComposerSnapshot>,
  credits: number,
) {
  return {
    ...snapshotTaskRequest(snapshot),
    usageReservation: {
      id: `usage-${snapshot.task.id}`,
      credits,
      units: [],
    },
    executionPlanFreeze: {
      ...planFrozenContent(),
      planId: 'plan-paid-media-1',
      approvalBasis: 'merchant_confirmed',
      quoteRef: snapshot.quote,
    },
    executionConfirmationContext: {
      campaignPlanRef: { id: 'campaign-plan-1', revision: 3 },
      workOrdinal: 2,
      approvalScope: 'single_work' as const,
    },
  } as unknown as Parameters<HarnessTaskAdmissionService['submit']>[0];
}

function paidMediaService(
  snapshot: ReturnType<typeof mediaComposerSnapshot>,
  order: string[],
  options: {
    createRequest?: () => Promise<never>;
    invokeAfterPendingPersisted?: boolean;
    replayConfirmationStatus?: 'pending' | 'decided' | 'expired';
    replayDecision?: 'confirmed' | 'rejected' | null;
  } = {},
) {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const originalStart = starter.start.bind(starter);
  starter.start = async (input) => {
    order.push('start');
    return originalStart(input);
  };
  const snapshotStore = new MemoryExecutionPlanSnapshotStore();
  const authorities: unknown[] = [];
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    new MutablePromptResolver(),
    undefined,
    undefined,
    {
      async resolve() {
        return structuredClone(mediaRoute(snapshot));
      },
    },
    undefined,
    undefined,
    new ExecutionPlanAdmissionService(snapshotStore),
    {
      async createRequest(input) {
        order.push('create-confirmation-request');
        authorities.push(structuredClone(input.pendingAuthority));
        if (options.createRequest) return options.createRequest();
        const stored = {
          request: {
            requestId: 'confirmation:task-media-1',
            reservationIdempotencyKey: 'consume:confirmation:task-media-1',
          },
          projection: {},
        } as never;
        if (options.invokeAfterPendingPersisted !== false) {
          await input.afterPendingPersisted?.({
            transactionClient: null,
            stored,
            reservedCredits: 7,
          });
        }
        return {
          stored,
          card: {},
          reservedCredits: 7,
        } as never;
      },
      async putCurrent() {
        throw new Error('Task admission must not separately persist confirmation authority.');
      },
      async getRequest(requestId) {
        return {
          request: {
            requestId,
            workspaceId: snapshot.workspaceId,
            status: options.replayConfirmationStatus ?? 'pending',
          },
          projection: {},
        } as never;
      },
      async getDecisionForWorkspace(_workspaceId, requestId) {
        const decision = options.replayDecision;
        return decision
          ? ({ requestId, decision } as never)
          : null;
      },
    },
  );
  return { service, starter, snapshotStore, authorities, registry };
}

test('a paid submission without a snapshot reserves a pending confirmation before Make starts', async () => {
  const snapshot = mediaComposerSnapshot();
  const order: string[] = [];
  const { service, starter, snapshotStore, authorities, registry } = paidMediaService(
    snapshot,
    order,
  );

  const result = await service.submit(paidMediaSubmission(snapshot, 7));

  // The reserve-backed request is opened before the workflow can spend.
  assert.deepEqual(order, [
    'create-confirmation-request',
    'start',
  ]);
  assert.equal(
    result.executionConfirmationRequestId,
    'confirmation:task-media-1',
  );
  const started = starter.requests[0]!;
  assert.equal(started.executionPlanSnapshot, undefined);
  assert.equal(
    started.pendingExecutionPlanSnapshot?.content.planId,
    'plan-paid-media-1',
  );
  assert.equal(
    started.executionConfirmationRequestId,
    'confirmation:task-media-1',
  );
  assert.equal(
    started.executionConfirmationReservationIdempotencyKey,
    'consume:confirmation:task-media-1',
  );
  assert.equal(started.executionConfirmationReservedCredits, 7);
  assert.equal(registry.claims.length, 1);
  assert.deepEqual(started.billingIdentity, {
    workspaceId: snapshot.workspaceId,
    taskId: snapshot.task.id,
    workId: snapshot.work.id,
    workflowId: snapshot.task.id,
    planId: 'plan-paid-media-1',
    planRevision: 1,
    snapshotHash: started.pendingExecutionPlanSnapshot!.snapshotHash,
    quoteRef: snapshot.quote,
    creditHoldOperationId: 'consume:confirmation:task-media-1',
    productUsageReservationId: 'usage-task-media-1',
    reservationId: 'typed|consume:confirmation:task-media-1|-|usage-task-media-1',
    carrierUnitId: 'copy',
    carrierUnitIds: ['copy'],
    carrierBillableUnits: 1,
  });
  // U7: the Campaign triple reaches the confirmation authority intact.
  assert.deepEqual(
    (authorities[0] as { executionConfirmationContext?: unknown })
      .executionConfirmationContext,
    {
      campaignPlanRef: { id: 'campaign-plan-1', revision: 3 },
      workOrdinal: 2,
      approvalScope: 'single_work',
    },
  );
  // No admitted snapshot may exist without an immutable decision.
  assert.equal(
    await snapshotStore.getByWorkflowId(
      `${snapshot.task.id}:plan:1:${started.pendingExecutionPlanSnapshot!.snapshotHash}`,
    ),
    null,
  );
});

test('an initial paid prepared attempt keeps the canonical initial credit reservation', async () => {
  const snapshot = mediaComposerSnapshot();
  const { service, authorities } = paidMediaService(snapshot, []);
  const submission: CreationSubmissionRecord = {
    snapshot,
    task: snapshot.task,
    work: snapshot.work,
    contentPackage: snapshot.contentPackage,
    usageReservation: {
      id: `usage-${snapshot.task.id}`,
      credits: 7,
      units: [],
    },
    executionPlanFreeze: {
      ...planFrozenContent(),
      planId: billingPlanId('plan-paid-media-1'),
      approvalBasis: 'merchant_confirmed',
      quoteRef: snapshot.quote,
    },
    agentBinding: {
      threadId: asAgentThreadIdentity('thread:paid-media-1'),
      runId: 'run:paid-media-1',
    },
  };

  await new CreationStagePort(service).preparePendingConfirmation(submission);

  assert.equal(
    (authorities[0] as { reservationAttempt?: string }).reservationAttempt,
    'initial',
  );
});

test('a neutral paid submission does not freeze a marketing identity fact reference', async () => {
  const snapshot = creationExecutionSnapshotSchema.parse({
    ...mediaComposerSnapshot(),
    identity: OFFICIAL_NEUTRAL_IDENTITY,
  });
  const { service, starter } = paidMediaService(snapshot, []);

  await service.submit(paidMediaSubmission(snapshot, 7));

  assert.deepEqual(
    starter.requests[0]?.pendingExecutionPlanSnapshot?.content.factRevisionRefs,
    ['brief:brief-context-1@1'],
  );
});

test('a secondary carrier freezes the primary confirmation reservation before it can start', async () => {
  const snapshot = mediaComposerSnapshot();
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const snapshotStore = new MemoryExecutionPlanSnapshotStore();
  let getRequestCalls = 0;
  let getDecisionCalls = 0;
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    new MutablePromptResolver(),
    undefined,
    undefined,
    { async resolve() { return structuredClone(mediaRoute(snapshot)); } },
    undefined,
    undefined,
    new ExecutionPlanAdmissionService(snapshotStore),
    {
      async createRequest() {
        throw new Error('A secondary carrier must not open another confirmation.');
      },
      async putCurrent() {
        throw new Error('A secondary carrier must not replace the primary authority.');
      },
      async getRequest(requestId) {
        getRequestCalls += 1;
        assert.equal(requestId, 'confirmation:package-primary');
        return {
          request: {
            requestId,
            workspaceId: snapshot.workspaceId,
            planId: 'plan-package-primary',
            planRevision: 1,
            quoteRef: snapshot.quote,
            reservationIdempotencyKey: 'consume:confirmation:package-primary',
            status: 'decided',
          },
          projection: {
            reservedCredits: 7,
            failureRefundsCredits: true,
            rightsSummary: null,
            factSummary: null,
          },
        } as never;
      },
      async getDecisionForWorkspace(workspaceId, requestId) {
        getDecisionCalls += 1;
        assert.equal(workspaceId, snapshot.workspaceId);
        assert.equal(requestId, 'confirmation:package-primary');
        return {
          decisionId: 'decision:package-primary',
          requestId,
          decision: 'confirmed',
        } as never;
      },
    },
  );
  const secondary = {
    ...snapshotTaskRequest(snapshot),
    taskId: `${snapshot.task.id}:carrier:copy`,
    sourceTaskId: snapshot.task.id,
    usageReservation: {
      id: 'usage-package-primary',
      units: [],
    },
    executionPlanFreeze: {
      ...planFrozenContent(),
      planId: billingPlanId('plan-package-primary'),
      approvalBasis: 'merchant_confirmed' as const,
      carrier: 'copy',
      quoteRef: snapshot.quote,
    },
    carrierUnitIds: ['copy', 'note'],
    packageConfirmationDecisionRef: 'decision:package-primary',
    packageConfirmationRequestId: 'confirmation:package-primary',
  } as Parameters<HarnessTaskAdmissionService['submit']>[0];

  await service.dispatchPrepared(secondary);

  const admitted = starter.requests[0]!;
  assert.equal(getRequestCalls, 1);
  assert.equal(getDecisionCalls, 1);
  assert.equal(admitted.executionConfirmationRequestId, 'confirmation:package-primary');
  assert.equal(
    admitted.executionConfirmationReservationIdempotencyKey,
    'consume:confirmation:package-primary',
  );
  assert.equal(
    admitted.billingIdentity?.reservationId,
    'typed|consume:confirmation:package-primary|-|usage-package-primary',
  );
  assert.deepEqual(admitted.billingIdentity?.carrierUnitIds, ['copy', 'note']);

  await assert.rejects(
    service.dispatchPrepared({
      ...secondary,
      packageConfirmationDecisionRef: 'decision:forged',
    }),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'FROZEN_REQUEST_MISSING',
  );
  assert.equal(starter.starts, 1);
});

test('a paid submission with no server-owned credit quote never starts Make', async () => {
  const snapshot = mediaComposerSnapshot();
  const order: string[] = [];
  const { service, starter } = paidMediaService(snapshot, order);

  await assert.rejects(
    () => service.submit(paidMediaSubmission(snapshot, 0)),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'FROZEN_REQUEST_MISSING',
  );
  assert.equal(starter.requests.length, 0);
  assert.equal(order.includes('start'), false);
});

test('a paid confirmation without its atomic admission callback never starts Make', async () => {
  const snapshot = mediaComposerSnapshot();
  const order: string[] = [];
  const { service, starter, registry } = paidMediaService(snapshot, order, {
    invokeAfterPendingPersisted: false,
  });

  await assert.rejects(
    () => service.submit(paidMediaSubmission(snapshot, 7)),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'FROZEN_REQUEST_MISSING',
  );
  assert.equal(starter.requests.length, 0);
  assert.equal(registry.claims.length, 0);
});

test('a terminal paid confirmation replay requires a new immutable admission attempt', async () => {
  const snapshot = mediaComposerSnapshot();
  const order: string[] = [];
  const { service, starter, registry } = paidMediaService(snapshot, order, {
    replayConfirmationStatus: 'expired',
  });
  const submission = paidMediaSubmission(snapshot, 7);

  await service.submit(submission);
  await assert.rejects(
    () => service.submit(submission),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'REQUIRES_SUCCESSOR_ADMISSION' &&
      error.status === 409,
  );

  assert.equal(starter.starts, 1);
  assert.equal(registry.claims.length, 1);
  assert.deepEqual(order, ['create-confirmation-request', 'start']);
});

test('a paid submission whose reserve fails leaves no started workflow', async () => {
  const snapshot = mediaComposerSnapshot();
  const order: string[] = [];
  const { service, starter } = paidMediaService(snapshot, order, {
    async createRequest() {
      throw new Error('INSUFFICIENT_CREDITS');
    },
  });

  await assert.rejects(
    () => service.submit(paidMediaSubmission(snapshot, 7)),
    /INSUFFICIENT_CREDITS/,
  );
  assert.equal(starter.requests.length, 0);
  assert.equal(order.includes('start'), false);
});

/**
 * The one remaining legacy fall-through, pinned so it stays deliberate: a task
 * that was admitted before the compile freeze existed carries neither snapshot
 * nor freeze on replay. It must stay on the legacy replay branch and must not
 * open a confirmation request — there is no frozen plan to confirm. Every other
 * paid precondition fails closed instead (see the two tests above).
 */
test('a durable task with no freeze replays on legacy and opens no confirmation', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const snapshotStore = new MemoryExecutionPlanSnapshotStore();
  const confirmations: string[] = [];
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    new ExecutionPlanAdmissionService(snapshotStore),
    {
      async createRequest() {
        confirmations.push('create');
        throw new Error('Legacy replay must not create a confirmation.');
      },
      async putCurrent() {
        confirmations.push('putCurrent');
        throw new Error('Legacy replay must not pin a pending authority.');
      },
    },
  );

  const first = await service.submit(taskRequest({ taskId: 'task-legacy-1' }));
  const replay = await service.submit(taskRequest({ taskId: 'task-legacy-1' }));

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(confirmations, []);
  for (const request of starter.requests) {
    assert.equal(request.executionPlanSnapshot, undefined);
    assert.equal(request.pendingExecutionPlanSnapshot, undefined);
    assert.equal(request.executionConfirmationRequestId, undefined);
  }
});

test('V31-12 submit with ExecutionPlanSnapshot without admission writer fails closed', async () => {
  const service = new HarnessTaskAdmissionService(
    new MemoryRequestRegistry(),
    new RecordingStarter(),
  );
  const content = planFrozenContent();
  const planSnapshot = buildExecutionPlanSnapshot({ content });
  await assert.rejects(
    () =>
      service.submit({
        ...taskRequest({ taskId: 'task-v31-12-no-writer' }),
        executionPlanSnapshot: planSnapshot,
      }),
    (error: unknown) =>
      error instanceof HarnessAdmissionError &&
      error.code === 'FROZEN_REQUEST_MISSING',
  );
});

test('V31-63 repriced successor re-freezes current context and dispatches its prepared request', async () => {
  const registry = new MemoryRequestRegistry();
  const starter = new RecordingStarter();
  const predecessorRequestId = 'confirmation:pred-repriced-1';
  const successorRequestId = 'confirmation:pred-repriced-1:repriced';
  const capturedAuthorities: Array<{
    snapshotHash: string;
    factRevisionRefs: readonly string[];
    reservationAttempt?: 'initial' | 'successor';
    predecessorRequestId?: string;
  }> = [];
  const service = new HarnessTaskAdmissionService(
    registry,
    starter,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      async createRequest() {
        throw new Error('successor prepare must use the transactional create');
      },
      async createRequestInTransaction(input) {
        assert.ok(input.pendingAuthority);
        capturedAuthorities.push({
          snapshotHash: input.pendingAuthority.snapshotHash,
          factRevisionRefs: [...input.pendingAuthority.factRevisionRefs],
          reservationAttempt: input.pendingAuthority.reservationAttempt,
          predecessorRequestId: input.pendingAuthority.predecessorRequestId,
        });
        const stored = {
          request: {
            requestId: successorRequestId,
            reservationIdempotencyKey: 'reservation:successor-1',
          },
        } as never;
        // Mirror the real service: the durable admission hook runs inside
        // the same workspace-credit transaction, so the successor claim path
        // (registry.claimInConfirmationTransaction) really executes here.
        await input.afterPendingPersisted?.({
          transactionClient: {} as never,
          stored,
          reservedCredits: 4,
        });
        return { stored, card: {}, reservedCredits: 4 } as never;
      },
      async getRequest(requestId) {
        assert.equal(requestId, successorRequestId);
        return {
          request: {
            requestId,
            workspaceId: snapshot.workspaceId,
            status: 'decided',
          },
          projection: {},
        } as never;
      },
      async getDecisionForWorkspace(workspaceId, requestId) {
        assert.equal(workspaceId, snapshot.workspaceId);
        assert.equal(requestId, successorRequestId);
        return { requestId, decision: 'confirmed' } as never;
      },
      putCurrent: (async () => {}) as never,
    },
  );

  const sourceContent = {
    ...planFrozenContent(),
    factRevisionRefs: ['identity:identity-1@identity-r1', 'brief:brief-context-1@1'],
    approvalBasis: 'merchant_confirmed',
  } as unknown as ExecutionPlanFrozenContent;
  const sourcePending = freezeExecutionPlanContent(sourceContent);
  const snapshot = creationExecutionSnapshotSchema.parse({
    ...composerSnapshot(),
    task: { id: 'task-successor-1' },
  });
  const successorAgentBinding = {
    threadId: asAgentThreadIdentity('thread-successor-1'),
    runId: 'run-successor-1',
  };
  const sourceRequest = {
    ...taskRequest(),
    agentThreadId: successorAgentBinding.threadId,
    agentRunId: successorAgentBinding.runId,
    executionSnapshot: snapshot,
    pendingExecutionPlanSnapshot: sourcePending,
    executionConfirmationRequestId: predecessorRequestId,
    // Frozen carrier facts the predecessor's durable request always carries;
    // billing identity fails closed without them.
    carrierUnitId: 'single',
    carrierUnitIds: ['single'],
    carrierBillableUnits: 1,
  };
  const freeze = {
    planId: sourceContent.planId,
    planRevision: 2,
    intentDeclaration: sourceContent.intentDeclaration,
    contextBundleRef: sourceContent.contextBundleRef,
    executionPlan: sourceContent.executionPlan,
    deliverables: sourceContent.deliverables,
    quoteRef: { id: 'quote-successor-1', revision: 'r2' },
    rightsRevisionRefs: ['rights-r1'],
    harnessReleaseId: sourceContent.harnessReleaseId,
    approvalBasis: 'merchant_confirmed',
  } as never;
  // The heads the successor's store transaction verified as current: the
  // brief material head drifted, so its live ref is baselined.
  const currentFactRevisionRefs = [
    'identity:identity-1@identity-r1',
    'brief:brief-context-1@1:material-head:0123456789abcdef',
  ];

  const created = await service.prepareRepricedConfirmationSuccessorInTransaction({
    transaction: {} as never,
    workflowId: 'task-successor-1:plan-r2',
    predecessorRequestId,
    requestId: successorRequestId,
    reservationIdempotencyKey: 'reservation:successor-1',
    holdExpiresAt: '2026-08-14T09:00:00.000Z',
    sourceRequest,
    successor: {
      snapshot,
      usageReservation: { id: 'usage-successor-1', credits: 4, units: [] },
      executionPlanFreeze: freeze,
    },
    currentFactRevisionRefs,
  });

  assert.equal(created.executionConfirmationRequestId, successorRequestId);
  assert.equal(capturedAuthorities.length, 1);
  const authority = capturedAuthorities[0]!;
  assert.equal(authority.reservationAttempt, 'successor');
  assert.equal(authority.predecessorRequestId, predecessorRequestId);
  // The successor's pending snapshot carries the verified current heads …
  assert.deepEqual(authority.factRevisionRefs, currentFactRevisionRefs);
  // … and its snapshotHash is recomputed over the rebased frozen content.
  const expectedPending = freezeExecutionPlanContent({
    ...sourceContent,
    planRevision: 2,
    quoteRef: { id: 'quote-successor-1', revision: 'r2' },
    rightsRevisionRefs: ['rights-r1'],
    factRevisionRefs: currentFactRevisionRefs,
  } as unknown as ExecutionPlanFrozenContent);
  assert.equal(authority.snapshotHash, expectedPending.snapshotHash);
  assert.notEqual(authority.snapshotHash, sourcePending.snapshotHash);

  const successorSubmission: CreationSubmissionRecord = {
    snapshot,
    task: snapshot.task,
    work: snapshot.work,
    contentPackage: snapshot.contentPackage,
    usageReservation: {
      id: 'usage-successor-1',
      credits: 4,
      units: [],
    },
    executionPlanFreeze: freeze,
    agentBinding: successorAgentBinding,
  };
  await new CreationStagePort(service).start(successorSubmission);
  assert.equal(starter.workflowIds.at(-1), 'task-successor-1:plan-r2');
  assert.equal(starter.starts, 1);
  assert.equal(
    registry.claims[0]?.fingerprint,
    registry.lookups.at(-1)?.fingerprint,
  );
});

class MemoryRequestRegistry implements HarnessTaskRequestRegistry {
  readonly claims: Array<{ taskId: string; fingerprint: string }> = [];
  readonly lookups: Array<{ taskId: string; fingerprint: string }> = [];
  private readonly fingerprints = new Map<string, string>();
  private readonly requests = new Map<
    string,
    Parameters<HarnessTaskRequestRegistry['claim']>[0]['request']
  >();

  async lookup(
    input: Parameters<NonNullable<HarnessTaskRequestRegistry['lookup']>>[0],
  ) {
    this.lookups.push(input);
    const existing = this.fingerprints.get(input.taskId);
    if (existing === undefined) return null;
    if (existing !== input.fingerprint) return { kind: 'conflict' as const };
    return {
      kind: 'existing' as const,
      workflowId: input.taskId,
      runtimeId: `legacy-${input.taskId}`,
      request: structuredClone(this.requests.get(input.taskId)!),
    };
  }

  async claim(input: Parameters<HarnessTaskRequestRegistry['claim']>[0]) {
    this.claims.push(input);
    const existing = this.fingerprints.get(input.taskId);
    if (existing === undefined) {
      this.fingerprints.set(input.taskId, input.fingerprint);
      this.requests.set(input.taskId, structuredClone(input.request));
      return { kind: 'created' as const };
    }
    if (existing === input.fingerprint) {
      return {
        kind: 'existing' as const,
        workflowId: input.taskId,
        runtimeId: `legacy-${input.taskId}`,
        request: structuredClone(this.requests.get(input.taskId)!),
      };
    }
    return { kind: 'conflict' as const };
  }

  async claimInConfirmationTransaction(
    input: Parameters<
      NonNullable<HarnessTaskRequestRegistry['claimInConfirmationTransaction']>
    >[0],
  ) {
    return this.claim(input);
  }
}

class RecordingStarter implements HarnessWorkflowStarter {
  starts = 0;
  readonly workflowIds: string[] = [];
  readonly runtimeIds: Array<string | undefined> = [];
  readonly requests: Array<
    Parameters<HarnessWorkflowStarter['start']>[0]['request']
  > = [];

  async start(input: Parameters<HarnessWorkflowStarter['start']>[0]) {
    this.starts += 1;
    this.workflowIds.push(input.workflowId);
    this.runtimeIds.push(input.runtimeId);
    this.requests.push(structuredClone(input.request));
    return { workflowId: input.workflowId };
  }
}

class MutablePromptResolver implements HarnessPromptResolver {
  version = 7;
  calls = 0;
  failure?: Error;

  async resolve(): Promise<HarnessFrozenPrompts> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    return Object.fromEntries(
      Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES).map(([key, name]) => [
        key,
        prompt(
          name,
          `${
            key === 'intentNaming'
              ? 'intent'
              : key === 'briefCompilation'
                ? 'brief'
                : key
          }-v${this.version}`,
          this.version,
        ),
      ]),
    ) as HarnessFrozenPrompts;
  }
}

class SelectivePromptResolver implements HarnessPromptResolver {
  fullResolveCalls = 0;
  readonly requestedKeys: HarnessPromptKey[][] = [];
  readonly requestedVersions: Array<Record<string, string | number>> = [];

  async resolve(): Promise<HarnessFrozenPrompts> {
    this.fullResolveCalls += 1;
    throw new Error('full prompt resolution must not run for a copy task');
  }

  async resolveKeys(
    keys: readonly HarnessPromptKey[],
    exactVersions?: Readonly<Partial<Record<HarnessPromptKey, string | number>>>,
  ) {
    this.requestedKeys.push([...keys]);
    this.requestedVersions.push({ ...exactVersions });
    return Object.fromEntries(
      keys.map((key) => [
        key,
        prompt(HARNESS_LANGFUSE_PROMPT_NAMES[key], `${key}-v7`, 7),
      ]),
    );
  }
}

class RequiredUnsetBoundsResolver implements HarnessExecutionBoundsResolver {
  calls = 0;

  async resolve(): Promise<BoundedExecutionLimits> {
    this.calls += 1;
    return {
      maxIterations: 50,
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: ['maxCostCents'],
    };
  }
}

class MutableBoundsResolver implements HarnessExecutionBoundsResolver {
  calls = 0;
  maxIterations = 50;

  async resolve(): Promise<BoundedExecutionLimits> {
    this.calls += 1;
    return {
      maxIterations: this.maxIterations,
      maxCostCents: 'unset',
      maxWallClockMs: 'unset',
      maxDelegations: 'unset',
      requiredLimits: [],
    };
  }
}

function prompt(name: string, content: string, version: number) {
  return {
    name,
    version: String(version),
    content,
    contentHash: String(version).repeat(64).slice(0, 64),
    label: 'production',
    source: 'langfuse' as const,
    isFallback: false,
  };
}

function planFrozenContent(): ExecutionPlanFrozenContent {
  return {
    planId: 'plan-admit-1',
    planRevision: 1,
    intentDeclaration: { summary: 'task admission freeze' },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'ctx-hash',
    },
    executionPlan: {
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      units: [
        {
          unitId: 'unit-1',
          unitType: 'copy.generate',
          primitive: 'generate',
        },
      ],
      dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
      boundedRetry: {
        'unit-1': {
          maxAttempts: 1,
          maxCostCents: 0,
          retry: { enabled: false },
        },
      },
    },
    deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: [],
    factRevisionRefs: [],
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: ['maxIterations', 'maxCostCents'],
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
    harnessReleaseId: 'release-1',
    approvalBasis: 'policy_exempt_copy',
  } as unknown as ExecutionPlanFrozenContent;
}

function taskRequest(overrides: { rawInput?: string; taskId?: string } = {}) {
  return {
    taskId: overrides.taskId ?? 'task-35',
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 2,
    workflowRevision: 4,
    creationMode: 'customized' as const,
    rawInput: overrides.rawInput ?? '把新团购做一套能发的',
    intent: {
      context: {
        workId: 'work-1',
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function composerSnapshot(viralAssetIds: readonly string[] | null = null) {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'composer-key-1',
      taskId: 'task-35',
      workId: 'work-1',
      contentPackageId: 'package-1',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '为夏日护理项目写一条预约文案',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: viralAssetIds
        ? { id: 'recipe.viral_adapt', revision: 'recipe.viral_adapt@1' }
        : { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'copy' as const,
      platform: { id: 'douyin' as const },
      deliverables: [
        { id: 'copy-primary', kind: 'copy' as const, quantity: 1, order: 1 },
      ],
      sources: {
        assets: (viralAssetIds ?? []).map((id) => ({
          id,
          revision: '1',
          role: 'source' as const,
        })),
      },
      ...(viralAssetIds
        ? {
            viralAdaptSource: {
              schemaVersion: 'viral-adapt-source/v1' as const,
              track: 'paste' as const,
              noteText: '夏日护理笔记',
              authorizedAssetIds: [...viralAssetIds],
            },
          }
        : {}),
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: {
        id: 'policy-1',
        revision: 'policy-r1',
        mode: 'fixed' as const,
      },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      contentModules: ['social_cover' as const],
    },
    '2026-07-22T09:00:00.000Z',
  );
}

function mediaComposerSnapshot() {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'composer-media-key-1',
      taskId: 'task-media-1',
      workId: 'work-media-1',
      contentPackageId: 'package-media-1',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '制作夏日护理项目图片',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'image' as const,
      operation: 'image.generate' as const,
      platform: { id: 'xiaohongshu' as const },
      contentPackagePlatform: 'xiaohongshu' as const,
      distributionTarget: 'export' as const,
      deliverable: {
        kind: 'image_set' as const,
        quantity: 1,
        aspectRatio: '9:16' as const,
      },
      deliverables: [
        {
          id: 'image-primary',
          kind: 'image' as const,
          quantity: 1,
          order: 0,
          aspectRatio: '9:16' as const,
        },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: {
        id: 'policy-1',
        revision: 'policy-r1',
        mode: 'fixed' as const,
      },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-media-1', revision: 'model-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      contentModules: ['social_cover' as const],
    },
    '2026-07-29T09:00:00.000Z',
  );
}

function mediaRoute(snapshot: ReturnType<typeof mediaComposerSnapshot>) {
  return {
    id: snapshot.route.id,
    catalogRevisionId: snapshot.route.revision,
    capabilityRevisionId: 'capability-media-r1',
    requestedSelection: {
      mode: 'fixed',
      catalogModelId: snapshot.catalogModel.id,
    },
    candidateCatalogModelIds: [snapshot.catalogModel.id],
    actualCatalogModelId: snapshot.catalogModel.id,
    deploymentId: 'deployment-media-1',
    policyRevision: snapshot.modelPolicy.revision,
    priceRevision: 'price-r1',
    credentialMode: 'platform',
    credentialVersion: 'credential-r1',
    fallbackConsent: false,
    reason: 'fixed_selection',
    dataClass: [],
    createdAt: '2026-07-29T09:00:00.000Z',
  } satisfies RouteSnapshot;
}

function copyRoute(snapshot: ReturnType<typeof composerSnapshot>) {
  return {
    id: snapshot.route.id,
    catalogRevisionId: snapshot.route.revision,
    capabilityRevisionId: 'capability-copy-r1',
    requestedSelection: {
      mode: 'fixed',
      catalogModelId: snapshot.catalogModel.id,
    },
    candidateCatalogModelIds: [snapshot.catalogModel.id],
    actualCatalogModelId: snapshot.catalogModel.id,
    deploymentId: 'deployment-copy-1',
    policyRevision: snapshot.modelPolicy.revision,
    priceRevision: 'price-r1',
    credentialMode: 'platform',
    credentialVersion: 'credential-r1',
    fallbackConsent: false,
    reason: 'fixed_selection',
    dataClass: [],
    createdAt: '2026-07-29T09:00:00.000Z',
  } satisfies RouteSnapshot;
}

function snapshotTaskRequest(snapshot: ReturnType<typeof composerSnapshot>) {
  return {
    taskId: snapshot.task.id,
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
        sourceSummaries: [],
      },
      assetReferences: snapshot.sources.assets.map((asset) => asset.id),
    },
    executionSnapshot: snapshot,
    usageReservation: {
      id: `usage-reservation-${snapshot.task.id}`,
      units: [],
    },
  };
}
