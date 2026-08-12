import {
  workflowProgressEnvelopeSchema,
  workflowProgressFrameSchema,
  workflowStateEnvelopeSchema,
  workflowStateFrameSchema,
  workflowTokenEnvelopeSchema,
  workflowTokenFrameSchema,
  type WorkflowProgressEnvelope,
  type WorkflowProgressFrame,
  type WorkflowState,
  type WorkflowStateEnvelope,
  type WorkflowStateFrame,
  type WorkflowTokenEnvelope,
  type WorkflowTokenFrame,
} from '@meiye/contracts';

import { isPreparedAttemptRunIdForTask } from './harness/prepared-attempt-run-id.js';

export type WorkflowEventFrame =
  | WorkflowProgressFrame
  | WorkflowTokenFrame
  | WorkflowStateFrame;

export interface WorkflowEventSourceInput {
  lastEventId?: string;
  signal: AbortSignal;
  workflowId: string;
  workspaceId: string;
}

export interface WorkflowEventSource {
  owns(workspaceId: string, workflowId: string): Promise<boolean>;
  stream(input: WorkflowEventSourceInput): AsyncIterable<WorkflowEventFrame>;
}

export interface HarnessWorkflowEventReader {
  owns(workspaceId: string, workflowId: string): Promise<boolean>;
  readEvents(
    workspaceId: string,
    workflowId: string,
    signal: AbortSignal
  ): AsyncIterable<WorkflowProgressEnvelope | WorkflowTokenEnvelope>;
  readState(
    workspaceId: string,
    workflowId: string,
    signal: AbortSignal
  ): Promise<WorkflowStateEnvelope>;
}

export class HarnessWorkflowEventSource implements WorkflowEventSource {
  constructor(private readonly reader: HarnessWorkflowEventReader) {}

  owns(workspaceId: string, workflowId: string) {
    return this.reader.owns(workspaceId, workflowId);
  }

  async *stream(input: WorkflowEventSourceInput) {
    let cursorReached = !input.lastEventId;
    for await (const raw of this.reader.readEvents(
      input.workspaceId,
      input.workflowId,
      input.signal
    )) {
      if (input.signal.aborted) return;
      const token = workflowTokenEnvelopeSchema.safeParse(raw);
      const frame = token.success
        ? workflowTokenFrameSchema.parse({
            data: token.data,
            event: 'workflow.token',
          })
        : workflowProgressFrameSchema.parse({
            data: workflowProgressEnvelopeSchema.parse(raw),
            event: 'workflow.progress',
          });
      // V31-56 merchant_confirmed runs execute as `<taskId>:plan-r<n>` while
      // the browser subscribes with the base task id; those frames are this
      // subscription's own run, not a foreign workflow.
      if (
        frame.data.workflowId !== input.workflowId &&
        !isPreparedAttemptRunIdForTask(frame.data.workflowId, input.workflowId)
      ) {
        continue;
      }
      const eventId = frame.data.eventId;
      if (!cursorReached) {
        cursorReached = eventId === input.lastEventId;
        continue;
      }
      yield frame;
    }
    if (input.signal.aborted) return;
    const data = workflowStateEnvelopeSchema.parse(
      await this.reader.readState(
        input.workspaceId,
        input.workflowId,
        input.signal,
      )
    );
    if (data.workflowId !== input.workflowId) return;
    yield workflowStateFrameSchema.parse({ data, event: 'workflow.state' });
  }
}

export interface VideoWorkflowEventSnapshot {
  job?: unknown;
  workflow: {
    id: string;
    revision: number;
    status: string;
    updatedAt: string;
  };
}

export interface VideoWorkflowEventReader {
  owns(workspaceId: string, workflowId: string): Promise<boolean>;
  readSnapshot(
    workspaceId: string,
    workflowId: string
  ): Promise<VideoWorkflowEventSnapshot>;
}

export class VideoWorkflowEventSource implements WorkflowEventSource {
  private readonly pollIntervalMs: number;

  constructor(
    private readonly reader: VideoWorkflowEventReader,
    options: { pollIntervalMs?: number } = {}
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  owns(workspaceId: string, workflowId: string) {
    return this.reader.owns(workspaceId, workflowId);
  }

  async *stream(input: WorkflowEventSourceInput) {
    let previousEventId: string | undefined;
    while (!input.signal.aborted) {
      const snapshot = await this.reader.readSnapshot(
        input.workspaceId,
        input.workflowId
      );
      const status = videoWorkflowState(snapshot.workflow.status);
      const data = workflowStateEnvelopeSchema.parse({
        occurredAt: snapshot.workflow.updatedAt,
        snapshot: structuredClone(snapshot) as unknown as Record<
          string,
          unknown
        >,
        sourceRevision: snapshot.workflow.revision,
        status,
        workflowId: snapshot.workflow.id,
      });
      const frame = workflowStateFrameSchema.parse({
        data,
        event: 'workflow.state',
      });
      const eventId = workflowEventFrameId(frame);
      if (eventId !== previousEventId) {
        yield frame;
        previousEventId = eventId;
      }
      if (isTerminalVideoWorkflow(snapshot.workflow.status)) return;
      await abortableDelay(this.pollIntervalMs, input.signal);
    }
  }
}

export class WorkflowEventApplicationService {
  constructor(private readonly sources: WorkflowEventSource[]) {}

  async subscribe(input: WorkflowEventSourceInput) {
    for (const source of this.sources) {
      if (await source.owns(input.workspaceId, input.workflowId)) {
        return { frames: source.stream(input) };
      }
    }
    return null;
  }
}

export function workflowEventFrameId(frame: WorkflowEventFrame) {
  if (frame.event === 'workflow.progress' || frame.event === 'workflow.token') {
    return frame.data.eventId;
  }
  return [
    frame.data.workflowId,
    frame.data.sourceRevision,
    frame.data.status,
  ].join(':');
}

export function encodeWorkflowSseFrame(frame: WorkflowEventFrame) {
  return [
    `id: ${workflowEventFrameId(frame)}`,
    `event: ${frame.event}`,
    `data: ${JSON.stringify(frame.data)}`,
    '',
    '',
  ].join('\n');
}

function videoWorkflowState(status: string): WorkflowState {
  if (status === 'draft') return 'waiting';
  if (status === 'awaiting_quality_review') return 'suspended';
  if (status === 'failed') return 'failed';
  if (status === 'completed' || status === 'cancelled') return 'success';
  return 'running';
}

function isTerminalVideoWorkflow(status: string) {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}
