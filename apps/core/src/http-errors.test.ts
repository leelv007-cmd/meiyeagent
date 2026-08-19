import assert from 'node:assert/strict';
import test from 'node:test';
import { P1DomainError } from './p1/foundation/index.js';
import { ExecutionPlanAdmissionError } from './p1/harness/execution-plan-admission.js';
import { OperationsError } from './p1/operations/application-service.js';
import { DomainError } from './product/product-service.js';
import {
  ADMISSION_HTTP_STATUSES,
  ADMISSION_MERCHANT_MESSAGES,
  toHttpError,
} from './http-errors.js';

const fallback = {
  code: 'FALLBACK',
  message: 'Fallback message.',
  status: 502,
} as const;

test('toHttpError translates the complete error mapping table', () => {
  const cases: Array<{
    error: unknown;
    expected: ReturnType<typeof toHttpError>;
    name: string;
  }> = [
    {
      error: new DomainError('DOMAIN', 'Domain message.', 418, {
        retry: false,
      }),
      expected: {
        code: 'DOMAIN',
        details: { retry: false },
        message: 'Domain message.',
        status: 418,
      },
      name: 'DomainError',
    },
    {
      error: new OperationsError('OPERATIONS', 'Operations message.', 422, {
        revision: 3,
      }),
      expected: {
        code: 'OPERATIONS',
        details: { revision: 3 },
        message: 'Operations message.',
        status: 422,
      },
      name: 'OperationsError',
    },
    ...(
      [
        ['NOT_FOUND', 404],
        ['FORBIDDEN', 403],
        ['INSUFFICIENT_ENTITLEMENT', 409],
        ['IDEMPOTENCY_CONFLICT', 409],
        ['INVALID_STATE', 400],
        ['COMMANDS_FROZEN', 400],
        ['P1_WRITE_DISABLED', 400],
        ['WRITE_OWNERSHIP_MISSING', 409],
      ] as const
    ).map(([code, status]) => ({
      error: new P1DomainError(code, `${code} message.`),
      expected: { code, message: `${code} message.`, status },
      name: `P1DomainError:${code}`,
    })),
    {
      error: Object.assign(new Error('Shaped message.'), {
        code: 'SHAPED',
        details: { field: 'value' },
        status: 429,
      }),
      expected: {
        code: 'SHAPED',
        details: { field: 'value' },
        message: 'Shaped message.',
        status: 429,
      },
      name: 'code/status-shaped Error',
    },
    {
      error: { code: 'SHAPED_OBJECT', status: 409 },
      expected: {
        code: 'SHAPED_OBJECT',
        details: undefined,
        message: fallback.message,
        status: 409,
      },
      name: 'code/status-shaped object',
    },
    {
      error: new Error('Private failure.'),
      expected: {
        code: fallback.code,
        message: fallback.message,
        status: fallback.status,
      },
      name: 'unknown Error',
    },
    {
      error: 'failure',
      expected: {
        code: fallback.code,
        message: fallback.message,
        status: fallback.status,
      },
      name: 'unknown value',
    },
  ];

  for (const candidate of cases) {
    assert.deepEqual(
      toHttpError(candidate.error, fallback),
      candidate.expected,
      candidate.name
    );
  }
});

test('toHttpError applies route-specific P1 status and message policies', () => {
  assert.equal(
    toHttpError(new P1DomainError('INVALID_STATE', 'Invalid.'), {
      ...fallback,
      p1DefaultStatus: 409,
    }).status,
    409
  );
  assert.equal(
    toHttpError(new P1DomainError('INSUFFICIENT_ENTITLEMENT', 'Denied.'), {
      ...fallback,
      p1DefaultStatus: 403,
      p1Statuses: { INSUFFICIENT_ENTITLEMENT: 409 },
    }).status,
    409
  );
  assert.equal(
    toHttpError(
      Object.assign(new Error('Private.'), { code: 'X', status: 400 }),
      {
        ...fallback,
        shapedMessage: 'fallback',
      }
    ).message,
    fallback.message
  );
  assert.equal(
    toHttpError(new Error('Public.'), {
      ...fallback,
      unknownMessage: 'error',
    }).message,
    'Public.'
  );
});

test('toHttpError keeps admission fence codes as 409 merchant-visible errors (V31-55)', () => {
  const cases = [
    {
      code: 'CONTEXT_FENCE_MISMATCH' as const,
      technical:
        'DBOS context fence failed: material context head drifted after freeze.',
    },
    {
      code: 'SNAPSHOT_STALE' as const,
      technical:
        'DBOS verification failed: snapshot is stale (rightsRevisionRefs).',
    },
    {
      code: 'RIGHTS_FENCE_MISMATCH' as const,
      technical:
        'DBOS rights fence failed: frozen rights are revoked or missing.',
    },
  ];

  for (const candidate of cases) {
    const error = new ExecutionPlanAdmissionError(
      candidate.code,
      candidate.technical,
    );
    const translated = toHttpError(error, fallback);
    assert.equal(translated.code, candidate.code, candidate.code);
    assert.equal(
      translated.status,
      ADMISSION_HTTP_STATUSES[candidate.code],
      `${candidate.code} status`,
    );
    assert.equal(
      translated.message,
      ADMISSION_MERCHANT_MESSAGES[candidate.code],
      `${candidate.code} merchant message`,
    );
    // Negative: must never be remapped to the immutable-snapshot conflict code.
    assert.notEqual(translated.code, 'IDEMPOTENCY_CONFLICT', candidate.code);
    assert.equal(
      /immutable and already bound/iu.test(translated.message),
      false,
      candidate.code,
    );
    assert.equal(/\bdbos\b/iu.test(translated.message), false, candidate.code);
  }
});

test('toHttpError maps admission fence codes without status and never falls back to 500', () => {
  const codeOnly = {
    code: 'CONTEXT_FENCE_MISMATCH',
  };
  const translated = toHttpError(codeOnly, {
    code: 'START_FAILED',
    message: 'Start failed.',
    status: 500,
  });
  assert.deepEqual(translated, {
    code: 'CONTEXT_FENCE_MISMATCH',
    details: undefined,
    message: ADMISSION_MERCHANT_MESSAGES.CONTEXT_FENCE_MISMATCH,
    status: 409,
  });
});

test('toHttpError preserves true IDEMPOTENCY_CONFLICT without rewriting it as a fence code', () => {
  const error = new ExecutionPlanAdmissionError(
    'IDEMPOTENCY_CONFLICT',
    'ExecutionPlanSnapshot abc is immutable and already bound to a different admission row.',
  );
  const translated = toHttpError(error, fallback);
  assert.equal(translated.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(translated.status, 409);
  assert.equal(translated.message, error.message);
  assert.notEqual(translated.code, 'CONTEXT_FENCE_MISMATCH');
  assert.notEqual(translated.code, 'SNAPSHOT_STALE');
  assert.notEqual(translated.code, 'RIGHTS_FENCE_MISMATCH');
});
