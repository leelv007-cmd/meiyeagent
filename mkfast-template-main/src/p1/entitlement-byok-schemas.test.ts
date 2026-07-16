import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autoTopUpFormSchema,
  entitlementAddOnFormSchema,
  entitlementPlanFormSchema,
  monthlyCapMicros,
  strictByokExecutionFormSchema,
} from './entitlement-byok-schemas';

test('entitlement forms only accept catalog-shaped selections and safe caps', () => {
  assert.equal(
    entitlementPlanFormSchema.safeParse({ tier: 'enterprise' }).success,
    false
  );
  assert.equal(
    entitlementAddOnFormSchema.safeParse({ offerId: '  ' }).success,
    false
  );
  assert.equal(
    autoTopUpFormSchema.safeParse({
      enabled: true,
      monthlyCapYuan: -1,
    }).success,
    false
  );
  assert.equal(monthlyCapMicros(100.25), 100_250_000);
});

test('strict BYOK form requires every controlled selection and a prompt', () => {
  assert.equal(
    strictByokExecutionFormSchema.safeParse({
      connectionId: 'connection-1',
      modelId: '',
      profileId: 'profile-1',
      prompt: '生成一条门店文案',
    }).success,
    false
  );
  const parsed = strictByokExecutionFormSchema.parse({
    connectionId: ' connection-1 ',
    modelId: 'model-1',
    profileId: 'profile-1',
    prompt: ' 生成一条门店文案 ',
    secret: 'must-not-survive-form-validation',
  });
  assert.deepEqual(parsed, {
    connectionId: 'connection-1',
    modelId: 'model-1',
    profileId: 'profile-1',
    prompt: '生成一条门店文案',
  });
  assert.equal('secret' in parsed, false);
});
