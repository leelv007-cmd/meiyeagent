/**
 * Shadow dual-write on the harness workflow event reader (V31-03).
 *
 * Wraps the existing HarnessWorkflowEventReader so production SSE still sees the
 * original progress/token envelopes unchanged. When agent_semantic_event_adapter_v1
 * is hot-read true, each frame is also projected:
 * - progress → durable semantic activity.snapshot
 * - token → ephemeral transient (zero store write)
 *
 * Failures in shadow projection are logged and never break the consumer stream.
 */

import {
  workflowProgressEnvelopeSchema,
  workflowTokenEnvelopeSchema,
  type WorkflowProgressEnvelope,
  type WorkflowStateEnvelope,
  type WorkflowTokenEnvelope,
} from '@meiye/contracts';

import type { HarnessWorkflowEventReader } from '../workflow-events.js';
import {
  shadowThreadIdForWorkflow,
  type AgentSemanticEventProjector,
} from './semantic-event-projector.js';

export type SemanticAdapterEnabledSource =
  | boolean
  | (() => boolean | Promise<boolean>);

export class ShadowSemanticWorkflowEventReader
  implements HarnessWorkflowEventReader
{
  constructor(
    private readonly inner: HarnessWorkflowEventReader,
    private readonly projector: AgentSemanticEventProjector,
    private readonly enabled: SemanticAdapterEnabledSource,
  ) {}

  owns(workspaceId: string, workflowId: string) {
    return this.inner.owns(workspaceId, workflowId);
  }

  async *readEvents(
    workspaceId: string,
    workflowId: string,
    signal: AbortSignal,
  ): AsyncIterable<WorkflowProgressEnvelope | WorkflowTokenEnvelope> {
    for await (const raw of this.inner.readEvents(
      workspaceId,
      workflowId,
      signal,
    )) {
      if (signal.aborted) return;
      if (await this.isEnabled()) {
        await this.shadowProject(workspaceId, raw);
      }
      yield raw;
    }
  }

  readState(
    workspaceId: string,
    workflowId: string,
    signal: AbortSignal,
  ): Promise<WorkflowStateEnvelope> {
    return this.inner.readState(workspaceId, workflowId, signal);
  }

  private async isEnabled(): Promise<boolean> {
    if (typeof this.enabled === 'function') {
      return this.enabled();
    }
    return this.enabled;
  }

  private async shadowProject(
    workspaceId: string,
    raw: WorkflowProgressEnvelope | WorkflowTokenEnvelope,
  ): Promise<void> {
    try {
      const threadId = shadowThreadIdForWorkflow(
        'workflowId' in raw ? raw.workflowId : workspaceId,
      );
      const token = workflowTokenEnvelopeSchema.safeParse(raw);
      if (token.success) {
        this.projector.emitWorkflowToken({
          threadId,
          token: token.data,
        });
        return;
      }
      const progress = workflowProgressEnvelopeSchema.safeParse(raw);
      if (!progress.success) return;
      await this.projector.projectWorkflowProgress({
        resourceId: workspaceId,
        threadId: shadowThreadIdForWorkflow(progress.data.workflowId),
        progress: progress.data,
        correlationId: progress.data.workflowId,
      });
    } catch (error) {
      console.error('Agent semantic shadow projection failed.', error);
    }
  }
}
