import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveEmailVerificationPolicy } from './email-verification-policy';

describe('email verification policy', () => {
  it('keeps email verification required in production-like environments', () => {
    assert.deepEqual(
      resolveEmailVerificationPolicy({
        appEnv: 'production',
        isDev: false,
        mode: 'production',
      }),
      {
        autoVerifyNewUsers: false,
        requireEmailVerification: true,
      }
    );
    assert.deepEqual(
      resolveEmailVerificationPolicy({
        appEnv: 'e2e',
        isDev: false,
        mode: 'production',
      }),
      {
        autoVerifyNewUsers: false,
        requireEmailVerification: true,
      }
    );
  });

  it('auto-verifies new users only in local development and e2e modes', () => {
    for (const environment of [
      { appEnv: 'development', isDev: true, mode: 'development' },
      { appEnv: 'e2e', isDev: true, mode: 'e2e' },
    ]) {
      assert.deepEqual(resolveEmailVerificationPolicy(environment), {
        autoVerifyNewUsers: true,
        requireEmailVerification: false,
      });
    }
  });

  it('keeps local-looking modes safe outside a development build', () => {
    for (const environmentName of ['development', 'e2e']) {
      assert.deepEqual(
        resolveEmailVerificationPolicy({
          appEnv: environmentName,
          isDev: false,
          mode: environmentName,
        }),
        {
          autoVerifyNewUsers: false,
          requireEmailVerification: true,
        }
      );
    }
  });
});
