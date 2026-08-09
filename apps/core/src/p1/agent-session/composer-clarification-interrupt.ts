import type { AgentSemanticEvent } from '@meiye/contracts';

import type { AgentSemanticEventProjector } from '../agent-semantic-events/semantic-event-projector.js';
import type { AgentSemanticEventStore } from '../agent-semantic-events/semantic-event-store.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';

export type ComposerClarificationInterruptPort = {
  request(input: {
    resourceId: string;
    threadId: string;
    runId: string;
    question: {
      itemId: string;
      question: string;
      options?: Array<{ label: string; description?: string }>;
    };
    revision: number;
    occurredAt: string;
  }): Promise<{ interruptId: string }>;
  pending(input: {
    resourceId: string;
    threadId: string;
    runId: string;
  }): Promise<{ interruptId: string; revision: number } | null>;
  resolve(input: {
    resourceId: string;
    threadId: string;
    runId: string;
    interruptId?: string;
    occurredAt: string;
  }): Promise<{ interruptId: string }>;
};

export class ComposerSemanticClarificationInterrupts
  implements ComposerClarificationInterruptPort
{
  constructor(
    private readonly store: AgentSemanticEventStore,
    private readonly projector: Pick<AgentSemanticEventProjector, 'project'>,
  ) {}

  async request(input: Parameters<ComposerClarificationInterruptPort['request']>[0]) {
    const question = input.question.question.trim();
    if (!question) throw new Error('Composer clarification question is required.');
    const interruptId = `composer-question:${fingerprintValue({
      runId: input.runId,
      question,
    }).slice(0, 24)}`;
    await this.projector.project({
      eventId: `${interruptId}:requested`,
      threadId: input.threadId,
      resourceId: input.resourceId,
      contextRole: 'included',
      sourceDomain: 'composer.session',
      sourceEntityId: input.runId,
      sourceRevision: String(input.revision),
      correlationId: input.runId,
      eventType: 'interrupt.requested',
      payload: {
        interruptId,
        interruptType: 'answer_question',
        description: question,
        question: input.question,
        revision: input.revision,
      },
      occurredAt: input.occurredAt,
    });
    return { interruptId };
  }

  async resolve(input: Parameters<ComposerClarificationInterruptPort['resolve']>[0]) {
    const events = await this.store.listByThread({
      resourceId: input.resourceId,
      threadId: input.threadId,
    });
    const pending = latestPendingQuestion(events, input.runId);
    if (!pending) return { interruptId: input.interruptId ?? '' };
    const payload = pending.payload as { interruptId: string; revision?: number };
    if (input.interruptId && payload.interruptId !== input.interruptId) {
      throw new Error('Composer clarification interrupt authority changed before commit.');
    }
    await this.projector.project({
      eventId: `${payload.interruptId}:resolved`,
      threadId: input.threadId,
      resourceId: input.resourceId,
      contextRole: 'included',
      sourceDomain: 'composer.session',
      sourceEntityId: input.runId,
      sourceRevision: String(payload.revision ?? pending.sourceRevision),
      correlationId: input.runId,
      causationId: pending.eventId,
      eventType: 'interrupt.resolved',
      payload: {
        interruptId: payload.interruptId,
        revision: payload.revision ?? Number(pending.sourceRevision),
      },
      occurredAt: input.occurredAt,
    });
    return { interruptId: payload.interruptId };
  }

  async pending(input: Parameters<ComposerClarificationInterruptPort['pending']>[0]) {
    const events = await this.store.listByThread({
      resourceId: input.resourceId,
      threadId: input.threadId,
    });
    const pending = latestPendingQuestion(events, input.runId);
    if (!pending) return null;
    const payload = pending.payload as {
      interruptId: string;
      revision?: number;
    };
    return {
      interruptId: payload.interruptId,
      revision: payload.revision ?? Number(pending.sourceRevision),
    };
  }
}

function latestPendingQuestion(events: readonly AgentSemanticEvent[], runId: string) {
  const resolved = new Set(
    events
      .filter((event) => event.eventType === 'interrupt.resolved')
      .map((event) => (event.payload as { interruptId?: string }).interruptId),
  );
  return [...events].reverse().find((event) => {
    const payload = event.payload as {
      interruptId?: string;
      interruptType?: string;
    };
    return (
      event.eventType === 'interrupt.requested' &&
      event.sourceEntityId === runId &&
      payload.interruptType === 'answer_question' &&
      Boolean(payload.interruptId) &&
      !resolved.has(payload.interruptId)
    );
  });
}
