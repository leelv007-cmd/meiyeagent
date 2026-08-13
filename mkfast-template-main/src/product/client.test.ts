import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { P1RequestError } from '@/p1/client';
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
    assert.ok(error instanceof P1RequestError);
    assert.equal(error.code, 'PROVIDER_SECRET');
    assert.equal(error.status, 500);
    assert.match(error.message, /服务暂时不可用/);
    assert.match(error.message, /corr-safe-product-123/);
    assert.doesNotMatch(error.message, /provider|private|stack|upstream/i);
    return true;
  });
});

test('product client keeps IDEMPOTENCY_CONFLICT readable without leaking the server message', async () => {
  const response = Response.json(
    {
      error: {
        code: 'IDEMPOTENCY_CONFLICT',
        message: 'Idempotency key was reused with a different command payload.',
      },
      meta: { correlationId: 'corr-idem-1' },
    },
    { status: 409 }
  );

  await assert.rejects(readProductEnvelope(response), (error: unknown) => {
    assert.ok(error instanceof P1RequestError);
    assert.equal(error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(error.status, 409);
    assert.match(error.message, /发生变化|changed/i);
    assert.doesNotMatch(error.message, /Idempotency key was reused/);
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
