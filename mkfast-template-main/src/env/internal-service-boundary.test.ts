import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasOriginSchema,
  internalServiceTransportSchema,
} from './internal-service-boundary.ts';

test('staging and production require an explicit supported internal transport', () => {
  for (const env of [
    { APP_ENV: 'staging' },
    { APP_ENV: 'production' },
    { NODE_ENV: 'production' },
  ]) {
    assert.equal(
      internalServiceTransportSchema(env).safeParse(undefined).success,
      false
    );
    assert.equal(
      internalServiceTransportSchema(env).safeParse('service-binding').success,
      true
    );
    assert.equal(
      internalServiceTransportSchema(env).safeParse('private-network').success,
      true
    );
  }
});

test('non-release environments may omit transport but reject unsupported values', () => {
  const schema = internalServiceTransportSchema({ APP_ENV: 'e2e' });

  assert.equal(schema.safeParse(undefined).success, true);
  assert.equal(schema.safeParse('public-url').success, false);
});

test('production Canvas public origin requires HTTPS', () => {
  for (const env of [{ APP_ENV: 'production' }, { NODE_ENV: 'production' }]) {
    assert.equal(
      canvasOriginSchema(env).safeParse('http://canvas.example.test').success,
      false
    );
    assert.equal(
      canvasOriginSchema(env).safeParse('https://canvas.example.test').success,
      true
    );
  }
});

test('Canvas origin validation does not infer private reachability from hostname', () => {
  const productionSchema = canvasOriginSchema({ APP_ENV: 'production' });

  assert.equal(
    productionSchema.safeParse('https://198.51.100.10').success,
    true
  );
  assert.equal(
    canvasOriginSchema({ APP_ENV: 'staging' }).safeParse(
      'http://canvas.staging.test'
    ).success,
    true
  );
});
