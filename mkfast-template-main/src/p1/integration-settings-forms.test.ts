import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIntegrationConnectionSchema,
  douyinPublishFormSchema,
  douyinScheduledAt,
  feishuArguments,
  feishuArgumentsFormSchema,
  integrationScopes,
  runConnectionCreationAttempt,
  runCredentialRotationAttempt,
  rotateIntegrationCredentialSchema,
} from './integration-settings-forms';

test('connection and credential schemas keep secrets required in form memory', () => {
  assert.equal(
    createIntegrationConnectionSchema.safeParse({
      capabilities: ['publish'],
      provider: 'douyin',
      scopes: 'publish, observe',
      secret: '',
      subject: 'account-a',
    }).success,
    false
  );
  assert.equal(
    rotateIntegrationCredentialSchema.safeParse({ secret: 'new-token' })
      .success,
    true
  );
  assert.deepEqual(integrationScopes('publish, observe, publish'), [
    'publish',
    'observe',
    'publish',
  ]);
});

test('douyin publish schema rejects missing snapshots and invalid timestamps', () => {
  assert.equal(
    douyinPublishFormSchema.safeParse({
      contentSnapshotId: '',
      scheduledAt: 'not-a-date',
    }).success,
    false
  );
  assert.equal(
    douyinScheduledAt('2026-07-11T12:30').startsWith('2026-07-11T'),
    true
  );
  assert.equal(
    douyinPublishFormSchema.safeParse({
      anchorId: '',
      anchorKind: 'poi',
      contentSnapshotId: 'snapshot-a',
      scheduledAt: '2026-07-11T12:30',
    }).success,
    false
  );
  assert.equal(
    douyinPublishFormSchema.safeParse({
      anchorId: 'poi-100',
      anchorKind: 'poi',
      contentSnapshotId: 'snapshot-a',
      scheduledAt: '2026-07-11T12:30',
    }).success,
    true
  );
});

test('feishu argument schema accepts objects and rejects arrays or invalid JSON', () => {
  assert.deepEqual(feishuArguments('{"query":"weekly"}'), {
    query: 'weekly',
  });
  assert.equal(
    feishuArgumentsFormSchema.safeParse({ rawArguments: '[]' }).success,
    false
  );
  assert.equal(
    feishuArgumentsFormSchema.safeParse({ rawArguments: '{broken' }).success,
    false
  );
});

test('credential rotation keeps the same key and secret until one attempt succeeds', async () => {
  const submittedKeys: string[] = [];
  let succeeds = false;
  let createdKeys = 0;
  const submit = (idempotencyKey: string) => {
    submittedKeys.push(idempotencyKey);
    return Promise.resolve(succeeds);
  };

  const first = await runCredentialRotationAttempt({
    createIdempotencyKey: () => `rotation-${++createdKeys}`,
    secret: 'new-secret',
    submit,
  });
  assert.equal(first.succeeded, false);
  assert.equal(first.attempt?.secret, 'new-secret');

  const retry = await runCredentialRotationAttempt({
    attempt: first.attempt,
    createIdempotencyKey: () => `rotation-${++createdKeys}`,
    secret: 'new-secret',
    submit,
  });
  assert.deepEqual(submittedKeys, ['rotation-1', 'rotation-1']);
  assert.equal(retry.attempt?.secret, 'new-secret');

  succeeds = true;
  const completed = await runCredentialRotationAttempt({
    attempt: retry.attempt,
    createIdempotencyKey: () => `rotation-${++createdKeys}`,
    secret: 'new-secret',
    submit,
  });
  assert.equal(completed.succeeded, true);
  assert.equal(completed.attempt, undefined);

  succeeds = false;
  await runCredentialRotationAttempt({
    createIdempotencyKey: () => `rotation-${++createdKeys}`,
    secret: 'changed-secret',
    submit,
  });
  assert.equal(submittedKeys.at(-1), 'rotation-2');
});

test('connection creation keeps one connection id and key until the same form succeeds', async () => {
  const submissions: Array<{ connectionId: string; idempotencyKey: string }> =
    [];
  let succeeds = false;
  let connectionIds = 0;
  let idempotencyKeys = 0;
  const submit = (attempt: {
    connectionId: string;
    idempotencyKey: string;
  }) => {
    submissions.push({
      connectionId: attempt.connectionId,
      idempotencyKey: attempt.idempotencyKey,
    });
    return Promise.resolve(succeeds);
  };

  const first = await runConnectionCreationAttempt({
    createConnectionId: () => `connection-${++connectionIds}`,
    createIdempotencyKey: () => `create-${++idempotencyKeys}`,
    submissionFingerprint: 'same-form-with-secret',
    submit,
  });
  assert.equal(first.succeeded, false);

  const retry = await runConnectionCreationAttempt({
    attempt: first.attempt,
    createConnectionId: () => `connection-${++connectionIds}`,
    createIdempotencyKey: () => `create-${++idempotencyKeys}`,
    submissionFingerprint: 'same-form-with-secret',
    submit,
  });
  assert.deepEqual(submissions, [
    { connectionId: 'connection-1', idempotencyKey: 'create-1' },
    { connectionId: 'connection-1', idempotencyKey: 'create-1' },
  ]);

  succeeds = true;
  const completed = await runConnectionCreationAttempt({
    attempt: retry.attempt,
    createConnectionId: () => `connection-${++connectionIds}`,
    createIdempotencyKey: () => `create-${++idempotencyKeys}`,
    submissionFingerprint: 'same-form-with-secret',
    submit,
  });
  assert.equal(completed.succeeded, true);
  assert.equal(completed.attempt, undefined);

  succeeds = false;
  await runConnectionCreationAttempt({
    createConnectionId: () => `connection-${++connectionIds}`,
    createIdempotencyKey: () => `create-${++idempotencyKeys}`,
    submissionFingerprint: 'changed-form',
    submit,
  });
  assert.deepEqual(submissions.at(-1), {
    connectionId: 'connection-2',
    idempotencyKey: 'create-2',
  });
});
