import assert from 'node:assert/strict';
import test from 'node:test';
import { P1DomainError } from './p1/foundation/index.js';
import { OperationsError } from './p1/operations/application-service.js';
import { DomainError } from './product/product-service.js';
import { toHttpError } from './http-errors.js';

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
