import assert from 'node:assert/strict';
import test from 'node:test';

import { m } from '@/locale/paraglide/messages';

import { getAuthErrorMessage } from './locale';

test('unknown authentication errors use a localized stable fallback', () => {
  const privateProviderMessage =
    'upstream database failed at postgres://private-host/auth';

  assert.equal(
    getAuthErrorMessage({ message: privateProviderMessage }),
    m.auth_error_try_again()
  );
  assert.notEqual(
    getAuthErrorMessage({ message: privateProviderMessage }),
    privateProviderMessage
  );
});

test('allowlisted authentication aliases stay readable', () => {
  assert.equal(
    getAuthErrorMessage({ message: 'Invalid email or password' }),
    Object.fromEntries(JSON.parse(m.auth_error_codes()))
      .invalid_email_or_password
  );
});
