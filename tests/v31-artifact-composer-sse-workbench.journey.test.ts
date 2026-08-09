import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { AgentSemanticEventProjector } from '../apps/core/src/p1/agent-semantic-events/semantic-event-projector.ts';
import { MemoryAgentSemanticEventStore } from '../apps/core/src/p1/agent-semantic-events/memory-semantic-event-store.ts';
import { createCoreServer } from '../apps/core/src/server.ts';
import type { DiagnosticRepository } from '../apps/core/src/diagnostics/repository.ts';
import type { AgentSemanticEventWire, DiagnosticRun } from '@meiye/contracts';
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

test('Composer artifact survives production HTTP replay and Last-Event-ID SSE into Workbench resync rules', async (t) => {
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

	const session = await sessions.getThread({
	  resourceId: submission.snapshot.workspaceId,
	  threadId: binding.threadId,
	});
	assert.ok(session);
	const cursors: Array<string | undefined> = [];
	const diagnostics: DiagnosticRepository = {
	  async create(run: DiagnosticRun) { return run; },
	  async get() { return null; },
	  async save(run: DiagnosticRun) { return run; },
	};
	const server = createCoreServer({
	  diagnosticRepository: diagnostics,
	  serviceToken: 'journey-token',
	  agentSemanticEvents: {
		async resolveSession({ workspaceId, threadId }) {
		  if (workspaceId !== submission.snapshot.workspaceId || threadId !== binding.threadId) return null;
		  return { resourceId: workspaceId, threadId, sessionRevision: session.revision };
		},
		loadReplay: (input) => projector.loadReplay(input),
		streamReplay(input) {
		  cursors.push(input.lastEventId);
		  return projector.streamReplay(input);
		},
	  },
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(() => server.close());
	const port = (server.address() as AddressInfo).port;
	const base = `http://127.0.0.1:${port}/v1/workspaces/${submission.snapshot.workspaceId}/p1/agent-threads/${binding.threadId}`;
	const headers = {
	  'x-service-token': 'journey-token',
	  'x-user-id': 'owner-1',
	  'x-workspace-id': submission.snapshot.workspaceId,
	  'x-workspace-role': 'owner',
	};
	const replayResponse = await fetch(`${base}/replay`, { headers });
	assert.equal(replayResponse.status, 200);
	const replayBody = await replayResponse.json() as {
	  data: {
		events: AgentSemanticEventWire[];
		session: { resourceId: string; threadId: string; sessionRevision: number };
		snapshot: {
		  revision: string;
		  lastEventId: string | null;
		  lastStreamOffset: string | null;
		};
	  };
	};
	const sseWires = replayBody.data.events.filter((candidate) =>
	  (candidate as { eventType?: string }).eventType === 'artifact.revised'
	) as AgentSemanticEventWire[];
  assert.equal(sseWires[0]?.payload.mode, 'snapshot');
  assert.equal(sseWires.at(-1)?.payload.status, 'ready');

	const firstArtifact = sseWires[0];
	const finalArtifact = sseWires.at(-1);
	assert.ok(firstArtifact);
	assert.ok(finalArtifact);
	const reconnectAfter = firstArtifact.eventId;
	const streamResponse = await fetch(`${base}/events`, {
	  headers: { ...headers, 'last-event-id': reconnectAfter },
	});
	const streamBody = await streamResponse.text();
	assert.equal(streamResponse.status, 200);
	assert.deepEqual(cursors, [reconnectAfter]);
	assert.match(streamBody, /event: agent\.semantic/u);
	assert.doesNotMatch(streamBody, new RegExp(`id: ${reconnectAfter}\\n`, 'u'));

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

	const duplicate = reduceAgentWorkbench(workbench, {
	  type: 'apply_events_batch',
	  events: [finalArtifact, firstArtifact],
	});
	assert.equal(duplicate.ok, true);
	assert.equal(duplicate.state.needsSnapshotResync, false);
	const jumped = structuredClone(finalArtifact);
	jumped.eventId = 'event-revision-jump';
	jumped.streamOffset = '999';
	jumped.payload.revision += 2;
	const resync = reduceAgentWorkbench(workbench, {
	  type: 'apply_events_batch',
	  events: [jumped],
	});
	assert.equal(resync.state.connection, 'resyncing');
	assert.equal(resync.state.needsSnapshotResync, true);

	const snapshotRetry = await fetch(`${base}/replay`, { headers });
	assert.equal(snapshotRetry.status, 200);
	const retryBody = await snapshotRetry.json() as typeof replayBody;
	const recovered = reduceAgentWorkbench(resync.state, {
	  type: 'hydrate_replay',
	  session: retryBody.data.session,
	  snapshot: retryBody.data.snapshot,
	  events: retryBody.data.events,
	});
	assert.equal(recovered.state.connection, 'live');
	assert.equal(recovered.state.needsSnapshotResync, false);
	assert.equal(projectVisibleArtifacts(recovered.state)[0]?.status, 'ready');
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
