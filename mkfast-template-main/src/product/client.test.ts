import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { readProductEnvelope } from './client';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

test('product client replaces server messages and details with stable copy', async () => {
  const response = Response.json(
    {
      error: {
        code: 'PROVIDER_SECRET',
        details: { reason: 'raw provider key and stack trace' },
        message: 'upstream 500 with private payload',
      },
      meta: { correlationId: 'corr-safe-product-123' },
    },
    { status: 500 }
  );

  await assert.rejects(readProductEnvelope(response), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /服务暂时不可用/);
    assert.match(error.message, /corr-safe-product-123/);
    assert.doesNotMatch(error.message, /provider|private|stack|upstream/i);
    return true;
  });
});

test('product client also hides malformed response bodies', async () => {
  const response = new Response('<private upstream html>', { status: 502 });

  await assert.rejects(readProductEnvelope(response), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /服务暂时不可用/);
    assert.doesNotMatch(error.message, /private|html|upstream/i);
    return true;
  });
});
