import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ObservabilityEvent } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import {
  HarnessObservabilityEventAudit,
  MemoryObservabilityEventAudit,
  type ObservabilityEventAuditPort,
} from './observability-events.js';

const context = {
  workspaceId: 'workspace-a',
  userId: 'owner-a',
  correlationId: 'corr-248',
  actor: 'owner' as const,
};

const canonicalFeedbackEvent = {
  eventType: 'delivery_rating.recorded',
  taskId: 'task-248',
  skillRevision: 'copywriter@rev-17',
  promptVersion: 'marketing/copy@v4',
  catalogRevision: 'catalog-2026-07-29',
  scene: 'opening-campaign',
  payload: {
    packageId: 'package-248',
    versionId: 'version-3',
    revision: 3,
    verdict: 'up',
  },
} as const;

describe('canonical observability event ingest', () => {
  it('parses and appends the strict event through the existing command module', async () => {
    const audit = new MemoryObservabilityEventAudit();
    const module = new CreationExperienceFoundationModule(undefined, undefined, {
      observabilityEvents: audit,
    });

    const result = await module.execute({
      context,
      idempotencyKey: 'feedback-248',
      input: {
        action: 'event_append',
        payload: canonicalFeedbackEvent,
      },
    });

    assert.deepEqual(result, canonicalFeedbackEvent);
    assert.deepEqual(audit.list('workspace-a'), [canonicalFeedbackEvent]);
    assert.deepEqual(audit.list('workspace-b'), []);
  });

  it('maps canonical events to the existing Harness audit and outbox seam', async () => {
    const appended: unknown[] = [];
    const audit = new HarnessObservabilityEventAudit({
      async appendAudit(event) {
        appended.push(event);
      },
    });

    const result = await audit.append(
      'workspace-a',
      canonicalFeedbackEvent,
      'feedback-248',
    );

    assert.deepEqual(result, canonicalFeedbackEvent);
    assert.deepEqual(appended, [
      {
        workspaceId: 'workspace-a',
        id: 'observability-feedback-248',
        workflowId: 'task-248',
        stage: 'observability_event_ingest',
        eventType: 'delivery_rating.recorded',
        payload: canonicalFeedbackEvent,
      },
    ]);
  });

  it('rejects missing axes and arbitrary strings before calling the audit port', async () => {
    const received: ObservabilityEvent[] = [];
    const audit: ObservabilityEventAuditPort = {
      append(_workspaceId, event) {
        received.push(event);
        return event;
      },
    };
    const module = new CreationExperienceFoundationModule(undefined, undefined, {
      observabilityEvents: audit,
    });

    for (const payload of [
      {
        ...canonicalFeedbackEvent,
        scene: undefined,
      },
      {
        ...canonicalFeedbackEvent,
        payload: {
          ...canonicalFeedbackEvent.payload,
          message: 'must not persist',
        },
      },
    ]) {
      await assert.rejects(
        () =>
          module.execute({
            context,
            idempotencyKey: 'invalid-feedback-248',
            input: { action: 'event_append', payload },
          }),
        (error: unknown) =>
          error instanceof P1DomainError && error.code === 'INVALID_STATE',
      );
    }

    assert.deepEqual(received, []);
  });
});
