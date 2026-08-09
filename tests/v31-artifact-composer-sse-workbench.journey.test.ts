import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentSemanticEventProjector } from '../apps/core/src/p1/agent-semantic-events/semantic-event-projector.ts';
import { MemoryAgentSemanticEventStore } from '../apps/core/src/p1/agent-semantic-events/memory-semantic-event-store.ts';
import {
  encodeAgentSemanticSseFrame,
  semanticFrameFromDomain,
} from '../apps/core/src/p1/agent-semantic-events/agent-semantic-frames.ts';
import { createCreationExecutionSnapshot } from '../apps/core/src/p1/execution-spine/creation-execution-snapshot.ts';
import type { CreationSubmissionRecord } from '../apps/core/src/p1/execution-spine/submission-coordinator.ts';
import { emitVideoScenesArtifactProgress } from '../apps/core/src/p1/harness/artifact-progress-emitter.ts';
import { ComposerPlanSessionCoordinator } from '../apps/core/src/p1/agent-session/composer-plan-session.ts';
import { MemoryAgentSessionStore } from '../apps/core/src/p1/agent-session/memory-agent-session-store.ts';
import { MemoryMarketingPlanStore } from '../apps/core/src/p1/agent-session/memory-plan-store.ts';
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from '../apps/core/src/p1/agent-session/plan-compiler.ts';
import {
  createEmptyAgentWorkbenchState,
  projectVisibleArtifacts,
  reduceAgentWorkbench,
} from '../mkfast-template-main/src/product/agent-workbench/agent-event-reducer.ts';

const TS = '2026-08-09T08:00:00.000Z';

test('real Composer identity and Artifact producer survive SSE into one ready Workbench artifact', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const events = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(events);
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
    semanticEvents: projector,
  });
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      compilePlan: (input) => compiler.compile(input),
      adjustPlan: (input) => compiler.adjust(input),
    },
    { now: () => TS },
  );
  const submission = composerRecord();
  const binding = await coordinator.prepare({ submission });
  assert.ok(submission.executionPlanFreeze);
  assert.notEqual(binding.threadId, submission.executionPlanFreeze.planId);

  let revision = 0;
  for (const state of ['running', 'success'] as const) {
    await emitVideoScenesArtifactProgress(projector, {
      workspaceId: submission.snapshot.workspaceId,
      workflowId: submission.task.id,
      threadId: binding.threadId,
      artifactId: `video:${submission.contentPackage.id}`,
      scenes: [
        {
          sceneIndex: 0,
          ...(state === 'running' ? { storyboard: '开场展示门店' } : {}),
        },
        {
          sceneIndex: 1,
          ...(state === 'running' ? { storyboard: '护理效果' } : {}),
        },
      ],
      state,
      nextRevision: () => ++revision,
      occurredAt: TS,
    });
  }

  const durable = await events.listByThread({
    resourceId: submission.snapshot.workspaceId,
    threadId: binding.threadId,
  });
  const sseWires = durable
    .filter(({ eventType }) => eventType === 'artifact.revised')
    .map((event) => {
      const frame = encodeAgentSemanticSseFrame(semanticFrameFromDomain(event));
      const data = frame
        .split('\n')
        .find((line) => line.startsWith('data: '));
      assert.ok(data);
      return JSON.parse(data.slice('data: '.length));
    });
  assert.equal(sseWires[0]?.payload.mode, 'snapshot');
  assert.equal(sseWires.at(-1)?.payload.status, 'ready');

  let workbench = reduceAgentWorkbench(createEmptyAgentWorkbenchState(), {
    type: 'set_session',
    session: {
      resourceId: submission.snapshot.workspaceId,
      threadId: binding.threadId,
      sessionRevision: 1,
    },
  }).state;
  workbench = reduceAgentWorkbench(workbench, {
    type: 'apply_events_batch',
    events: sseWires,
  }).state;

  const artifacts = projectVisibleArtifacts(workbench);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.status, 'ready');
  assert.equal(artifacts[0]?.revision, 4);
  assert.equal(artifacts[0]?.artifactId, `video:${submission.contentPackage.id}`);
});

function composerRecord(): CreationSubmissionRecord {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-artifact-journey',
      idempotencyKey: 'submission-artifact-journey',
      taskId: 'task-artifact-journey',
      workId: 'work-artifact-journey',
      contentPackageId: 'package-artifact-journey',
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '做一条两个分镜的护理视频',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'video',
      platform: { id: 'douyin' },
      contentPackagePlatform: 'douyin',
      distributionTarget: 'export',
      deliverable: {
        kind: 'video_package',
        quantity: 1,
        aspectRatio: '9:16',
        durationSeconds: 16,
      },
      deliverables: [
        {
          id: 'video-main',
          kind: 'video',
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
          durationSeconds: 16,
        },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: 'model-video-1', revision: 'model-r1' },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'context-1', revision: 1 },
      contentModules: ['social_cover'],
    },
    TS,
  );
  return {
    snapshot,
    task: { id: snapshot.task.id },
    work: { id: snapshot.work.id },
    contentPackage: { ...snapshot.contentPackage },
    usageReservation: { id: 'usage-artifact-journey', credits: 8, units: [] },
  };
}
