/**
 * V31-11 wiring: confirmation-card HTTP surface (create/decide/expire/list
 * pending) on the Core server. Exercises the route layer only — the domain
 * service runs on memory stores (create-tx atomicity is covered by
 * execution-confirmation-service.test.ts).
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { MemoryCreditLedger } from '../credit-billing/credit-ledger.js';
import { createCoreServer } from '../../server.js';
import { DiagnosticRepository } from '../../diagnostics/repository.js';
import {
  confirmationCreditPortFromMemoryLedger,
  ExecutionConfirmationService,
} from './execution-confirmation-service.js';
import {
  MemoryExecutionConfirmationRequestStore,
  MemoryPlanConfirmationDecisionStore,
} from './memory-execution-confirmation-store.js';

const CREATED = '2026-08-08T12:00:00.000Z';
const HOLD = '2026-08-09T12:00:00.000Z'; // 24h

const diagnostics: DiagnosticRepository = {
  async create(run) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run) {
    return run;
  },
};

function makeService(credits = 20) {
  const ledger = new MemoryCreditLedger();
  ledger.grant({
    id: 'lot-1',
    workspaceId: 'ws-1',
    credits,
    expirationDate: '2026-09-01T00:00:00.000Z',
    transactionType: 'PURCHASE_PACKAGE',
    sourceRef: 'test',
    createdAt: '2026-08-01T00:00:00.000Z',
  });
  const service = new ExecutionConfirmationService(
    new MemoryExecutionConfirmationRequestStore(),
    new MemoryPlanConfirmationDecisionStore(),
    confirmationCreditPortFromMemoryLedger(ledger),
  );
  return service;
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-http-1',
    planId: 'plan-1',
    planRevision: 1,
    snapshotHash: 'snap-hash-1',
    quoteRef: { id: 'quote-1', revision: 1 },
    reservationIdempotencyKey: 'reserve-http-1',
    createdAt: CREATED,
    holdExpiresAt: HOLD,
    creditCost: 5,
    failureRefundsCredits: true,
    rightsSummary: '素材授权有效至本月末',
    factSummary: '门店地址已确认',
    ...overrides,
  };
}

async function startServer(t: test.TestContext) {
  const service = makeService();
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    serviceToken: 'confirm-test-token',
    executionConfirmation: {
      create: (input) => service.createRequest(input),
      decide: (input) => service.decide(input),
      expire: (input) => service.expireHold(input),
      listPending: (workspaceId) => service.listPendingByWorkspace(workspaceId),
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/ws-1/p1/confirmation-requests`;
  const headers = {
    'content-type': 'application/json',
    'x-service-token': 'confirm-test-token',
    'x-user-id': 'owner-1',
    'x-workspace-id': 'ws-1',
    'x-workspace-role': 'owner',
  };
  return { base, headers };
}

async function jsonFetch(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = (await response.json()) as {
    data?: unknown;
    error?: { code?: string; message?: string };
  };
  return { response, body };
}

test('confirmation HTTP surface creates, lists, decides and enforces the immutable decision', async (t) => {
  const { base, headers } = await startServer(t);

  const created = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });
  assert.equal(created.response.status, 201);
  assert.equal(
    (created.body.data as { reservedCredits: number }).reservedCredits,
    5,
  );

  const listed = await jsonFetch(base, {
    method: 'GET',
    headers,
  });
  assert.equal(listed.response.status, 200);
  const requests = (listed.body.data as { requests: unknown[] }).requests;
  assert.equal(requests.length, 1);
  assert.equal(
    (requests[0] as { request: { requestId: string } }).request.requestId,
    'req-http-1',
  );

  const decided = await jsonFetch(`${base}/req-http-1/decide`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      decisionId: 'decision-http-1',
      decision: 'confirmed',
      decidedAt: '2026-08-08T13:00:00.000Z',
    }),
  });
  assert.equal(decided.response.status, 200);
  assert.equal(
    (decided.body.data as { decision: { decision: string } }).decision.decision,
    'confirmed',
  );

  // Decided holds cannot expire (INVALID_STATE → 409 via p1Statuses).
  const expired = await jsonFetch(`${base}/req-http-1/expire`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ now: '2026-08-09T13:00:00.000Z' }),
  });
  assert.equal(expired.response.status, 409);
});

test('confirmation expire path cancels + refunds an expired hold', async (t) => {
  const { base, headers } = await startServer(t);
  await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });
  const expired = await jsonFetch(`${base}/req-http-1/expire`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ now: '2026-08-09T13:00:00.000Z' }),
  });
  assert.equal(expired.response.status, 200);
  assert.equal(
    (expired.body.data as { refundedCredits: number }).refundedCredits,
    5,
  );
});

test('confirmation create rejects insufficient credits (409) and bad body (400)', async (t) => {
  const { base, headers } = await startServer(t);

  const bad = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody({ creditCost: 999 })),
  });
  assert.equal(bad.response.status, 409);

  const malformed = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requestId: 'short' }),
  });
  assert.equal(malformed.response.status, 400);
});

test('confirmation routes require the service token', async (t) => {
  const { base } = await startServer(t);
  const response = await fetch(base, {
    method: 'GET',
    headers: {
      'x-user-id': 'owner-1',
      'x-workspace-id': 'ws-1',
      'x-workspace-role': 'owner',
    },
  });
  assert.equal(response.status, 401);
});
