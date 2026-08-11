import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';


import { createCoreServer } from '../../server.js';
import { createPermissionAuthorizer } from '../capability-permission/index.js';
import {
  MemoryFoundationRepository,
  P1ApplicationService,
} from '../foundation/index.js';
import { MemoryBriefConfirmationRepository } from './brief-confirmation-repository.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import { MemoryCreationExperienceEventAudit } from './creation-experience-events.js';
import { MemoryObservabilityEventAudit } from './observability-events.js';
import { MemoryBriefRevisionContextRepository } from './postgres-brief-revision-context.js';

const currentRevisions = {
  draftRevisionId: 'draft@1',
  recipeRevisionId: 'recipe.video@3',
  modelRevisionId: 'model.video@7',
  quoteRevisionId: 'quote.video@4',
  sourceRevisionId: 'sources@2',
  surfaceRevisionId: 'surface.home.launch@3',
  lensId: 'video' as const,
};

test('creation-experience HTTP seam persists Brief confirmation, revalidates revisions, and appends private audit events', async (t) => {
  const foundation = new MemoryFoundationRepository();
  foundation.grantOwner('workspace-a', 'owner-a');
  foundation.grantMembership('workspace-a', 'reviewer-a', 'reviewer');

  const eventAudit = new MemoryCreationExperienceEventAudit();
  const observabilityEvents = new MemoryObservabilityEventAudit();
  const confirmations = new MemoryBriefConfirmationRepository();
  const revisionContexts = new MemoryBriefRevisionContextRepository();
  const module = new CreationExperienceFoundationModule(
    new MemoryCreationExperienceCatalogRepository(),
    undefined,
    {
      briefConfirmations: confirmations,
      briefRevisionContexts: revisionContexts,
      briefRevisionResolver: {
        async resolveCurrentRevisions(workspaceId, payload) {
          const context = await revisionContexts.getBriefRevisionContext(
            workspaceId,
            String(payload.briefContextId),
          );
          assert.ok(context);
          return {
            ...currentRevisions,
            draftRevisionId: context.draftRevisionId,
            lensId: context.lensId,
            sourceRevisionId: context.sourceRevisionId,
          };
        },
        resolveCurrentQuoteSignal() {
          return null;
        },
      },
      eventAudit,
      observabilityEvents,
      taskObservability: {
        async readTaskRootAxes(workspaceId, taskId) {
          assert.equal(workspaceId, 'workspace-a');
          assert.equal(taskId, 'task-248');
          return {
            axisScope: 'task_root',
            skillRevision: { kind: 'bound', value: 'copywriter@rev-17' },
            promptVersion: { kind: 'bound', value: 'marketing/copy@v4' },
            catalogRevision: {
              kind: 'bound',
              value: 'catalog-2026-07-29',
            },
            scene: { kind: 'bound', value: 'opening-campaign' },
          };
        },
        async deliveryBelongsToTask() {
          return true;
        },
      },
    },
  );
  const application = new P1ApplicationService(foundation, {
    authorizer: createPermissionAuthorizer(),
    operations: [module],
  });
  const server = createCoreServer({
    p1ApplicationService: application,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());

  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'corr-creation-http',
    'x-service-token': 'test-service-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };
  const briefSignals = {
    briefContextId: 'brief-context-a',
    lensId: 'copy',
    deliverableKind: 'copy',
    deliverableCount: 1,
    highRiskFacts: [],
    platforms: [],
    quote: null,
    sources: [],
    currentRevisions: {
      ...currentRevisions,
      quoteRevisionId: 'client-spoofed@999',
    },
  };

  const synced = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'brief_context_sync',
      module: 'creation-experience',
      payload: {
        briefContextId: 'brief-context-a',
        draft: { settings: { durationSeconds: 15 }, userText: '夏日项目' },
        expectedRevision: null,
        lensId: 'video',
        quoteId: 'quote-video',
        recipeRevisionId: 'recipe.video@3',
        sourceIds: ['asset-a'],
        surfaceRevisionId: 'surface.home.launch@3',
      },
    }),
    headers: { ...headers, 'idempotency-key': 'brief-context-a-1' },
    method: 'POST',
  });
  assert.equal(synced.status, 200);
  const syncedBody = (await synced.json()).data;
  const syncedRevisions = syncedBody.currentRevisions;
  assert.equal(syncedBody.revision, 1);
  assert.match(syncedRevisions.draftRevisionId, /^draft:[a-f0-9]{64}$/);
  assert.match(syncedRevisions.sourceRevisionId, /^sources:[a-f0-9]{64}$/);

  const projected = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'brief_project',
      module: 'creation-experience',
      payload: briefSignals,
    }),
    headers,
    method: 'POST',
  });
  assert.equal(projected.status, 200);
  assert.equal((await projected.json()).data.requiresBrief, true);

  const confirmed = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'brief_confirm',
      module: 'creation-experience',
      payload: {
        ...briefSignals,
        confirmationId: 'brief-confirm-a',
      },
    }),
    headers: { ...headers, 'idempotency-key': 'brief-confirm-a' },
    method: 'POST',
  });
  assert.equal(confirmed.status, 200);
  const confirmedBody = (await confirmed.json()).data;
  assert.equal(confirmedBody.confirmationId, 'brief-confirm-a');
  assert.deepEqual(confirmedBody.boundRevisions, syncedRevisions);

  const stillValid = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'brief_project',
      module: 'creation-experience',
      payload: {
        ...briefSignals,
        confirmationId: 'brief-confirm-a',
      },
    }),
    headers,
    method: 'POST',
  });
  assert.equal(stillValid.status, 200);
  assert.deepEqual((await stillValid.json()).data, {
    bindRevisions: syncedRevisions,
    confirmationInvalid: false,
    confirmationValid: true,
    evidenceDrawer: [],
    requiresBrief: false,
    summary: {
      estimatedCost: null,
      estimatedDuration: null,
      impactScope: null,
      modelAndSettings: null,
      sourceRightsSummary: null,
      targetDeliverable: 'video',
    },
    triggers: [],
  });

  const resynced = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'brief_context_sync',
      module: 'creation-experience',
      payload: {
        briefContextId: 'brief-context-a',
        draft: {
          settings: { durationSeconds: 20 },
          userText: '夏日项目',
        },
        expectedRevision: 1,
        lensId: 'video',
        quoteId: 'quote-video',
        recipeRevisionId: 'recipe.video@3',
        sourceIds: ['asset-a'],
        surfaceRevisionId: 'surface.home.launch@3',
      },
    }),
    headers: { ...headers, 'idempotency-key': 'brief-context-a-2' },
    method: 'POST',
  });
  assert.equal(resynced.status, 200);
  assert.equal((await resynced.json()).data.revision, 2);
  const invalidated = await fetch(`${base}/query`, {
    body: JSON.stringify({
      action: 'brief_project',
      module: 'creation-experience',
      payload: {
        ...briefSignals,
        confirmationId: 'brief-confirm-a',
        currentRevisions: syncedRevisions,
      },
    }),
    headers,
    method: 'POST',
  });
  assert.equal(invalidated.status, 200);
  const invalidatedBody = (await invalidated.json()).data;
  assert.equal(invalidatedBody.requiresBrief, true);
  assert.equal(invalidatedBody.confirmationInvalid, true);
  assert.ok(
    invalidatedBody.triggers.some(
      (trigger: { code: string }) => trigger.code === 'confirmation_invalid',
    ),
  );

  const rejectedSensitiveAction = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'event_append',
      module: 'creation-experience',
      payload: {
        actionId: 'customer_secret_phone_13800138000',
        kind: 'start',
        lensId: 'video',
      },
    }),
    headers: { ...headers, 'idempotency-key': 'rejected-sensitive-action' },
    method: 'POST',
  });
  assert.equal(rejectedSensitiveAction.status, 409);

  const appended = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'event_append',
      module: 'creation-experience',
      payload: {
        kind: 'start',
        lensId: 'video',
        actionId: 'action.start',
        meta: {
          cardIndex: 4,
          hiddenPromptBody: 'must-not-persist',
          note: 'short sensitive body must not persist either',
          userText: 'must-not-persist',
        },
      },
    }),
    headers: { ...headers, 'idempotency-key': 'creation-event-a' },
    method: 'POST',
  });
  assert.equal(appended.status, 200);
  const appendedBody = (await appended.json()).data;
  assert.match(appendedBody.actorId, /^ref:[a-f0-9]{64}$/);
  assert.match(appendedBody.correlationId, /^ref:[a-f0-9]{64}$/);
  assert.deepEqual(appendedBody.meta, { cardIndex: 4 });
  assert.doesNotMatch(JSON.stringify(appendedBody), /must-not-persist/);
  assert.equal((await eventAudit.list('workspace-a')).length, 1);
  assert.equal((await eventAudit.list('workspace-b')).length, 0);

  const canonical = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'event_append',
      module: 'creation-experience',
      payload: {
        eventType: 'delivery_rating.recorded',
        taskId: 'task-248',
        payload: {
          packageId: 'package-248',
          versionId: 'version-3',
          revision: 3,
          verdict: 'up',
        },
      },
    }),
    headers: { ...headers, 'idempotency-key': 'canonical-event-248' },
    method: 'POST',
  });
  assert.equal(canonical.status, 200);
  const canonicalBody = (await canonical.json()).data;
  assert.equal(canonicalBody.axisScope, 'execution_child');
  assert.equal(canonicalBody.skillRevision, 'copywriter@rev-17');
  assert.equal(canonicalBody.promptVersion, 'marketing/copy@v4');
  assert.equal(canonicalBody.catalogRevision, 'catalog-2026-07-29');
  assert.equal(canonicalBody.scene, 'opening-campaign');
  assert.deepEqual(observabilityEvents.list('workspace-a'), [canonicalBody]);

  const unsafeCanonical = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'event_append',
      module: 'creation-experience',
      payload: {
        eventType: canonicalBody.eventType,
        taskId: canonicalBody.taskId,
        payload: {
          ...canonicalBody.payload,
          message: 'must-not-persist',
        },
      },
    }),
    headers: { ...headers, 'idempotency-key': 'unsafe-canonical-event-248' },
    method: 'POST',
  });
  assert.equal(unsafeCanonical.status, 409);
  assert.equal(observabilityEvents.list('workspace-a').length, 1);

  const reviewerAppend = await fetch(`${base}/commands`, {
    body: JSON.stringify({
      action: 'event_append',
      module: 'creation-experience',
      payload: { eventId: 'reviewer-event', kind: 'complete' },
    }),
    headers: {
      ...headers,
      'idempotency-key': 'reviewer-event',
      'x-user-id': 'reviewer-a',
      'x-workspace-role': 'reviewer',
    },
    method: 'POST',
  });
  assert.equal(reviewerAppend.status, 403);
});
