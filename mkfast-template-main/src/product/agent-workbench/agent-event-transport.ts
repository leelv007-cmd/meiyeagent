/** Authenticated browser transport for Agent semantic replay + live SSE. */

import { agentSemanticEventWireSchema } from '@meiye/contracts';
import { z } from 'zod';

import { telemetryFetch } from '@/lib/product-telemetry';
import { P1RequestError, readP1Envelope } from '@/p1/client';

import type { AgentReplayLoader } from './agent-event-client';

const identifierSchema = z.string().trim().min(1).max(200);
const threadTaskRefSchema = z.object({
  taskId: identifierSchema,
  workId: identifierSchema.optional(),
});
const workbenchSessionSchema = z.object({
  resourceId: identifierSchema,
  threadId: identifierSchema,
  sessionRevision: z.number().int().nonnegative(),
  activeRunId: identifierSchema.optional(),
  title: z.string().optional(),
  current: threadTaskRefSchema.optional(),
  recent: threadTaskRefSchema.optional(),
});
const replayPackageSchema = z.object({
  session: workbenchSessionSchema,
  snapshot: z.object({
    revision: z.string().regex(/^(0|[1-9]\d*)$/u),
    lastEventId: identifierSchema.nullable(),
    lastStreamOffset: z
      .string()
      .regex(/^(0|[1-9]\d*)$/u)
      .nullable(),
  }),
  events: z.array(agentSemanticEventWireSchema),
  recentTaskId: identifierSchema.nullable().optional(),
});

export const loadAgentWorkbenchReplay: AgentReplayLoader = async (input) => {
  if (!input.threadId) {
    throw new P1RequestError(
      'Agent replay requires an authoritative Thread id.',
      'AGENT_THREAD_REQUIRED'
    );
  }
  const params = new URLSearchParams();
  if (input.clientLastEventId) {
    params.set('lastEventId', input.clientLastEventId);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = await telemetryFetch(
    `/api/core/p1/agent-threads/${encodeURIComponent(input.threadId)}/replay${suffix}`,
    { credentials: 'same-origin', method: 'GET' }
  );
  return readP1Envelope(response, replayPackageSchema, 'Agent replay failed.');
};

export type AgentLiveSubscriber = (input: {
  threadId: string;
  lastEventId: string | null;
  lastStreamOffset: string | null;
  signal: AbortSignal;
  onEvent: (
    event: z.infer<typeof agentSemanticEventWireSchema>
  ) => void | Promise<void>;
}) => Promise<void>;

export const subscribeAgentSemanticEvents: AgentLiveSubscriber = async (
  input
) => {
  const params = new URLSearchParams();
  if (input.lastEventId) params.set('lastEventId', input.lastEventId);
  if (input.lastStreamOffset) {
    params.set('lastStreamOffset', input.lastStreamOffset);
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  const response = await telemetryFetch(
    `/api/core/p1/agent-threads/${encodeURIComponent(input.threadId)}/events${suffix}`,
    {
      credentials: 'same-origin',
      headers: input.lastEventId
        ? { 'last-event-id': input.lastEventId }
        : undefined,
      method: 'GET',
      signal: input.signal,
    }
  );
  if (!response.ok || !response.body) {
    throw new P1RequestError(
      'Agent semantic stream failed.',
      'AGENT_SEMANTIC_STREAM_FAILED',
      undefined,
      response.status
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    while (!input.signal.aborted) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      buffered = await drainSseFrames(buffered, input.onEvent);
    }
    buffered += decoder.decode();
    await drainSseFrames(`${buffered}\n\n`, input.onEvent);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
};

async function drainSseFrames(
  source: string,
  onEvent: Parameters<AgentLiveSubscriber>[0]['onEvent']
): Promise<string> {
  const normalized = source.replaceAll('\r\n', '\n');
  const frames = normalized.split('\n\n');
  const tail = frames.pop() ?? '';
  for (const frame of frames) {
    if (!frame.trim() || frame.startsWith(':')) continue;
    let eventName = '';
    const data: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (eventName !== 'agent.semantic') continue;
    const parsed = agentSemanticEventWireSchema.parse(
      JSON.parse(data.join('\n'))
    );
    await onEvent(parsed);
  }
  return tail;
}
