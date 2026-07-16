import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginStableSubmissionAttempt,
  completeStableSubmissionAttempt,
  runWithStableSubmissionAttempt,
  type SubmissionAttemptStorage,
} from './stable-submission-attempt';

class MemoryStorage implements SubmissionAttemptStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test('a provider submission reuses its key across failure and reload, then clears on success or changed input', async () => {
  const storage = new MemoryStorage();
  let sequence = 0;
  const options = {
    createIdempotencyKey: () => `attempt-${++sequence}`,
    storage,
  };

  const first = await beginStableSubmissionAttempt(
    'copy.generate',
    { prompt: 'cat eye', selection: { mode: 'fixed', model: 'llm-a' } },
    options
  );
  const afterFailureAndReload = await beginStableSubmissionAttempt(
    'copy.generate',
    { selection: { model: 'llm-a', mode: 'fixed' }, prompt: 'cat eye' },
    options
  );
  assert.equal(afterFailureAndReload.idempotencyKey, first.idempotencyKey);

  const changed = await beginStableSubmissionAttempt(
    'copy.generate',
    { prompt: 'cat eye v2', selection: { mode: 'fixed', model: 'llm-a' } },
    options
  );
  assert.notEqual(changed.idempotencyKey, first.idempotencyKey);

  completeStableSubmissionAttempt(first, { storage });
  assert.equal(
    (
      await beginStableSubmissionAttempt(
        'copy.generate',
        {
          prompt: 'cat eye v2',
          selection: { mode: 'fixed', model: 'llm-a' },
        },
        options
      )
    ).idempotencyKey,
    changed.idempotencyKey,
    'a stale success must not clear a newer changed-input attempt'
  );

  completeStableSubmissionAttempt(changed, { storage });
  const afterSuccess = await beginStableSubmissionAttempt(
    'copy.generate',
    { prompt: 'cat eye v2', selection: { mode: 'fixed', model: 'llm-a' } },
    options
  );
  assert.notEqual(afterSuccess.idempotencyKey, changed.idempotencyKey);
});

test('provider execution keeps the same key after an unknown response and clears it only after success', async () => {
  const storage = new MemoryStorage();
  let sequence = 0;
  const options = {
    createIdempotencyKey: () => `provider-${++sequence}`,
    storage,
  };
  const seen: string[] = [];

  await assert.rejects(
    runWithStableSubmissionAttempt(
      'image.generate:work-a',
      { modelId: 'gpt-image-2', prompt: 'cat eye' },
      async (idempotencyKey) => {
        seen.push(idempotencyKey);
        throw new Error('response lost');
      },
      options
    ),
    /response lost/
  );
  await runWithStableSubmissionAttempt(
    'image.generate:work-a',
    { prompt: 'cat eye', modelId: 'gpt-image-2' },
    async (idempotencyKey) => {
      seen.push(idempotencyKey);
      return { status: 'queued' };
    },
    options
  );
  await runWithStableSubmissionAttempt(
    'image.generate:work-a',
    { prompt: 'cat eye', modelId: 'gpt-image-2' },
    async (idempotencyKey) => {
      seen.push(idempotencyKey);
      return { status: 'queued' };
    },
    options
  );

  assert.deepEqual(seen, ['provider-1', 'provider-1', 'provider-2']);
});
