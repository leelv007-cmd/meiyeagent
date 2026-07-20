import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HarnessAdmissionError,
  HarnessTaskAdmissionService,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowStarter,
} from './task-admission.js';
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
