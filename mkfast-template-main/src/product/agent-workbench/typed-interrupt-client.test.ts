import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listPendingInterrupts,
  resumePendingInterrupt,
} from './typed-interrupt-client.js';

test('typed interrupt client preserves interruptId and revision across list/resume', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (init?.method === 'POST') {
      return Response.json({ outcome: 'applied' });
    }
    return Response.json({
      interrupts: [
        {
          schemaVersion: 'interrupt-payload/v1',
          interruptId: 'interrupt-1',
          threadId: 'thread-1',
          runId: 'run-1',
          workflowId: 'workflow-1',
          step: 'context_injection',
          revision: 4,
          action: 'answer_question',
          args: {},
          config: {
            allowAccept: true,
            allowEdit: false,
            allowReject: true,
            allowRespond: false,
          },
          description: '价格已变化',
          resourceId: 'workspace-1',
        },
      ],
    });
  };

  const [pending] = await listPendingInterrupts({ fetcher });
  assert.equal(pending?.interruptId, 'interrupt-1');
  assert.equal(pending?.revision, 4);
  await resumePendingInterrupt({
    fetcher,
    interrupt: pending!,
    type: 'accept',
  });
  assert.equal(requests[1]?.url, '/api/core/p1/interrupts/resume');
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    schemaVersion: 'interrupt-payload/v1',
    interruptId: 'interrupt-1',
    revision: 4,
    type: 'accept',
    idempotencyKey: 'interrupt-resume:interrupt-1:r4:accept',
  });
});
