import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { DeterministicFakeVideoProvider } from './provider.js';

test('deterministic fake provider writes stable clip bytes and evidence', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-provider-fake-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const clipBytes = Buffer.from('deterministic-video-clip');
  const provider = new DeterministicFakeVideoProvider({
    provider: 'fake-seedance',
    model: 'fake-video-v1',
    clipBytes,
    cost: { amount: 1.25, currency: 'CNY', estimated: false },
  });
  const request = {
    prompt: 'A clean beauty studio reveal',
    durationSeconds: 5,
    aspectRatio: '9:16' as const,
    correlationId: 'corr-fake-1',
  };

  const first = await provider.generateClip({
    ...request,
    outputPath: join(directory, 'first.mp4'),
  });
  const second = await provider.generateClip({
    ...request,
    outputPath: join(directory, 'second.mp4'),
  });

  assert.deepEqual(await readFile(first.path), clipBytes);
  assert.deepEqual(await readFile(second.path), clipBytes);
  assert.equal(first.taskId, second.taskId);
  assert.deepEqual(first.cost, { amount: 1.25, currency: 'CNY', estimated: false });
  assert.equal(first.provider, 'fake-seedance');
  assert.equal(first.model, 'fake-video-v1');
});
