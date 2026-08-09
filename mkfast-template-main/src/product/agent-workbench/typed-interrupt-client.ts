import {
  interruptPayloadSchema,
  resumeInterruptCommandSchema,
  type InterruptPayload,
  type ResumeInterruptCommand,
} from '@meiye/contracts';
import { z } from 'zod';

const pendingInterruptsResponseSchema = z
  .object({ interrupts: z.array(interruptPayloadSchema) })
  .strict();

export class TypedInterruptClientError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'TypedInterruptClientError';
  }
}

async function responseError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string } | string;
    message?: string;
  } | null;
  const message =
    (typeof body?.error === 'object' ? body.error.message : body?.error) ??
    body?.message ??
    'Interrupt request failed.';
  return new TypedInterruptClientError(message, response.status);
}

export async function listPendingInterrupts(
  input: {
    threadId?: string;
    signal?: AbortSignal;
    fetcher?: typeof fetch;
  } = {}
): Promise<InterruptPayload[]> {
  const query = input.threadId
    ? `?threadId=${encodeURIComponent(input.threadId)}`
    : '';
  const response = await (input.fetcher ?? fetch)(
    `/api/core/p1/pending-interrupts${query}`,
    { credentials: 'same-origin', signal: input.signal }
  );
  if (!response.ok) throw await responseError(response);
  return pendingInterruptsResponseSchema.parse(await response.json())
    .interrupts;
}

export async function resumePendingInterrupt(input: {
  interrupt: Pick<
    InterruptPayload,
    'schemaVersion' | 'interruptId' | 'revision'
  >;
  type: ResumeInterruptCommand['type'];
  args?: ResumeInterruptCommand['args'];
  fetcher?: typeof fetch;
}): Promise<unknown> {
  const command = resumeInterruptCommandSchema.parse({
    schemaVersion: input.interrupt.schemaVersion,
    interruptId: input.interrupt.interruptId,
    revision: input.interrupt.revision,
    type: input.type,
    ...(input.args !== undefined ? { args: input.args } : {}),
    idempotencyKey:
      `interrupt-resume:${input.interrupt.interruptId}:` +
      `r${input.interrupt.revision}:${input.type}`,
  });
  const response = await (input.fetcher ?? fetch)(
    '/api/core/p1/interrupts/resume',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    }
  );
  if (!response.ok) throw await responseError(response);
  return response.json();
}
