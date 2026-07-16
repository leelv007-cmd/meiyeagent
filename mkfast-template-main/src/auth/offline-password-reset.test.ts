import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseOfflinePasswordResetArguments,
  resetPasswordOffline,
} from './offline-password-reset';

describe('offline password reset', () => {
  it('hashes a validated password, resets the credential account, and reports revoked sessions', async () => {
    const writes: Array<{ email: string; passwordHash: string }> = [];
    const result = await resetPasswordOffline(
      { email: ' Admin@Example.com ', password: 'new-safe-password' },
      {
        hashPassword: async (password) => `hash:${password.length}`,
        repository: {
          async resetCredential(input) {
            writes.push(input);
            return { revokedSessions: 3, userId: 'user-admin' };
          },
        },
      }
    );

    assert.deepEqual(writes, [
      { email: 'admin@example.com', passwordHash: 'hash:17' },
    ]);
    assert.deepEqual(result, {
      email: 'admin@example.com',
      revokedSessions: 3,
      userId: 'user-admin',
    });
    assert.equal(JSON.stringify(result).includes('password'), false);
  });

  it('requires password stdin and rejects weak passwords before touching storage', async () => {
    assert.deepEqual(
      parseOfflinePasswordResetArguments([
        '--',
        '--email',
        'admin@example.com',
        '--password-stdin',
      ]),
      { email: 'admin@example.com', passwordStdin: true }
    );
    assert.throws(
      () =>
        parseOfflinePasswordResetArguments(['--email', 'admin@example.com']),
      /--password-stdin/u
    );

    let touched = false;
    await assert.rejects(
      resetPasswordOffline(
        { email: 'admin@example.com', password: 'short' },
        {
          hashPassword: async () => 'unused',
          repository: {
            async resetCredential() {
              touched = true;
              return { revokedSessions: 0, userId: 'unused' };
            },
          },
        }
      ),
      /at least 12 characters/u
    );
    assert.equal(touched, false);
  });
});
