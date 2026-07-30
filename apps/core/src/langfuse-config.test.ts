import assert from 'node:assert/strict';
import test from 'node:test';
import {
  langfuseTracingConfigFromEnv,
  maskLangfuseData,
} from './langfuse-config.js';

test('Langfuse tracing requires all three configured values', () => {
  assert.equal(
    langfuseTracingConfigFromEnv({
      LANGFUSE_BASE_URL: 'https://example.langfuse.test',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
    }),
    undefined,
  );
  assert.deepEqual(
    langfuseTracingConfigFromEnv({
      APP_ENV: ' test ',
      LANGFUSE_BASE_URL: ' https://example.langfuse.test ',
      LANGFUSE_PUBLIC_KEY: ' pk-test ',
      LANGFUSE_SECRET_KEY: ' sk-test ',
    }),
    {
      baseUrl: 'https://example.langfuse.test',
      environment: 'test',
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    },
  );
  assert.equal(
    langfuseTracingConfigFromEnv({
      APP_ENV: 'development',
      LANGFUSE_BASE_URL: 'https://example.langfuse.test',
      LANGFUSE_PUBLIC_KEY: 'pk-test',
      LANGFUSE_SECRET_KEY: 'sk-test',
      LANGFUSE_TRACING_ENVIRONMENT: 'staging',
    })?.environment,
    'staging',
  );
});

test('Langfuse masking redacts credentials in nested inputs and outputs', () => {
  const masked = maskLangfuseData({
    apiKey: 'private-structured-value',
    input: [
      'Authorization: Bearer token.value-123',
      'api-key="private-value"',
    ],
    nested: { 'x-api-key': 'private-nested-value' },
    output: 'sk-live_secret pk-live_public',
  });

  assert.deepEqual(masked, {
    apiKey: '[REDACTED]',
    input: [
      'Authorization: Bearer [REDACTED]',
      'api-key="[REDACTED]"',
    ],
    nested: { 'x-api-key': '[REDACTED]' },
    output: 'sk-[REDACTED] pk-[REDACTED]',
  });
});
