import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryJobPort } from './memory-job-port.js';

describe('MemoryJobPort', () => {
  it('keeps enqueue idempotent by workspace and job id and supports cancellation', async () => {
    const port = new MemoryJobPort();
    const command = { jobId: 'job-1', workspaceId: 'ws-1', kind: 'generate', payload: { assetId: 'a1' } };
    await port.enqueue(command);
    await port.enqueue(command);
    assert.equal((await port.inspect('ws-1', 'job-1'))?.status, 'queued');
    assert.equal((await port.list('ws-1')).length, 1);
    await port.cancel('ws-1', 'job-1');
    assert.equal((await port.inspect('ws-1', 'job-1'))?.status, 'cancelled');
    await assert.rejects(() => port.enqueue({ ...command, payload: { assetId: 'different' } }), /different payload/);
  });
});
