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
        appEnv: 'staging',
        isDev: false,
        mode: 'production',
      }),
      {
        autoVerifyNewUsers: false,
        requireEmailVerification: true,
      }
    );
  });

  it('auto-verifies new users in local development and the e2e quality stack', () => {
    for (const environment of [
      { appEnv: 'development', isDev: true, mode: 'development' },
      { appEnv: 'e2e', isDev: true, mode: 'e2e' },
      // Production-candidate wrangler build: APP_ENV=e2e, isDev=false.
      { appEnv: 'e2e', isDev: false, mode: 'production' },
    ]) {
      assert.deepEqual(resolveEmailVerificationPolicy(environment), {
        autoVerifyNewUsers: true,
        requireEmailVerification: false,
      });
    }
  });

  it('keeps development mode safe outside a development build', () => {
    assert.deepEqual(
      resolveEmailVerificationPolicy({
        appEnv: 'development',
        isDev: false,
        mode: 'development',
      }),
      {
        autoVerifyNewUsers: false,
        requireEmailVerification: true,
      }
    );
  });

  it('does not treat build mode alone as an e2e quality stack', () => {
    assert.deepEqual(
      resolveEmailVerificationPolicy({
        appEnv: 'production',
        isDev: false,
        mode: 'e2e',
      }),
      {
        autoVerifyNewUsers: false,
        requireEmailVerification: true,
      }
    );
  });
});
