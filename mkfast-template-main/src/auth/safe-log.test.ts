import assert from 'node:assert/strict';
import test from 'node:test';
import { safeErrorFields } from './safe-log';

test('safe auth error fields omit messages, email, tokens, headers, and causes', () => {
  const error = Object.assign(
    new Error('alice@example.test Bearer test-secret-token'),
    {
      body: { code: 'PROVIDER_FAILED', token: 'test-secret-token' },
      cause: { email: 'alice@example.test' },
      headers: { authorization: 'Bearer test-secret-token' },
      status: 'INTERNAL_SERVER_ERROR',
    }
  );

  const fields = safeErrorFields(error);
  assert.deepEqual(fields, {
    errorCode: 'PROVIDER_FAILED',
    errorName: 'Error',
    errorStatus: 'INTERNAL_SERVER_ERROR',
  });
  assert.doesNotMatch(JSON.stringify(fields), /alice|secret|authorization/iu);
});
