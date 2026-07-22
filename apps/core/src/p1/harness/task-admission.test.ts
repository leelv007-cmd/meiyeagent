import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessAdmissionError,
  HarnessTaskAdmissionService,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowStarter,
} from './task-admission.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import type {
  HarnessFrozenPrompts,
  HarnessPromptResolver,
} from './langfuse-prompts.js';

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
  assert.equal(registry.claims[0]?.fingerprint, registry.claims[1]?.fingerprint);
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
  assert.equal(registry.claims[0]?.fingerprint, registry.claims[1]?.fingerprint);
});

class MemoryRequestRegistry implements HarnessTaskRequestRegistry {
  readonly claims: Array<{ taskId: string; fingerprint: string }> = [];
  private readonly fingerprints = new Map<string, string>();
  private readonly requests = new Map<string, Parameters<HarnessTaskRequestRegistry['claim']>[0]['request']>();

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
}

class RecordingStarter implements HarnessWorkflowStarter {
  starts = 0;
  readonly workflowIds: string[] = [];
  readonly runtimeIds: Array<string | undefined> = [];
  readonly requests: Array<Parameters<HarnessWorkflowStarter['start']>[0]['request']> = [];

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

  async resolve(): Promise<HarnessFrozenPrompts> {
    return {
      intentNaming: prompt('harness/intent-naming', `intent-v${this.version}`, this.version),
      briefCompilation: prompt('harness/brief-copy', `brief-v${this.version}`, this.version),
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

function taskRequest(overrides: { rawInput?: string; taskId?: string } = {}) {
  return {
    taskId: overrides.taskId ?? 'task-35',
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 2,
    workflowRevision: 4,
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

function composerSnapshot() {
  return createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: 'composer-key-1',
      taskId: 'task-35',
      workId: 'work-1',
      contentPackageId: 'package-1',
      expectedContentPackageRevision: 0,
      intent: '为夏日护理项目写一条预约文案',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'copy' as const,
      platform: { id: 'douyin' as const },
      deliverables: [
        { id: 'copy-primary', kind: 'copy' as const, quantity: 1, order: 1 },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' as const },
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

function snapshotTaskRequest(snapshot: ReturnType<typeof composerSnapshot>) {
  return {
    taskId: snapshot.task.id,
    actorId: snapshot.actorId,
    workspaceId: snapshot.workspaceId,
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: snapshot.revision,
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
  };
}
