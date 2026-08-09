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
import { ExecutionConfirmationError } from './execution-confirmation-store.js';

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

function makeService(credits = 20, now = '2026-08-09T13:00:00.000Z') {
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
    undefined,
    // Route and domain read one server clock (production wires wall time to
    // both). Leaving the domain on wall time made every hold deadline here a
    // time bomb against the hardcoded HOLD instant.
    { clock: () => new Date(now) },
  );
  return { ledger, service };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: 'workflow-1',
    ...overrides,
  };
}

async function startServer(
  t: test.TestContext,
  now = '2026-08-09T13:00:00.000Z',
  credits = 20,
) {
  const { ledger, service } = makeService(credits, now);
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    clock: () => new Date(now),
    serviceToken: 'confirm-test-token',
    executionConfirmation: {
      create: (input) => {
        if (input.workspaceId !== 'ws-1') {
          throw new ExecutionConfirmationError('NOT_FOUND', 'Plan was not found.');
        }
        return service.createRequest({
          requestId: `confirmation:${input.workflowId}`,
          planId: 'plan-1',
          planRevision: 1,
          snapshotHash: `snapshot:${input.workflowId}`,
          quoteRef: { id: `quote:${input.workflowId}`, revision: 1 },
          reservationIdempotencyKey: `reserve:${input.workflowId}`,
          createdAt: CREATED,
          holdExpiresAt: HOLD,
          creditCost: 5,
          failureRefundsCredits: true,
          rightsSummary: '素材授权有效至本月末',
          factSummary: '门店地址已确认',
          actorId: input.actorId,
          workspaceId: input.workspaceId,
        });
      },
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
  return { base, headers, ledger, service };
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
  // Server clock inside the hold window: decide is only lawful before the
  // deadline (a past-deadline decide is the expiry path, covered separately).
  const { base, headers } = await startServer(t, '2026-08-08T13:00:00.000Z');

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
    'confirmation:workflow-1',
  );

  const decided = await jsonFetch(`${base}/confirmation%3Aworkflow-1/decide`, {
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

  const conflictingDecision = await jsonFetch(`${base}/confirmation%3Aworkflow-1/decide`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      decisionId: 'decision-http-conflict',
      decision: 'rejected',
    }),
  });
  assert.equal(conflictingDecision.response.status, 409);

  // Decided holds cannot expire (INVALID_STATE → 409 via p1Statuses).
  const expired = await jsonFetch(`${base}/confirmation%3Aworkflow-1/expire`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ now: '2026-08-09T13:00:00.000Z' }),
  });
  assert.equal(expired.response.status, 409);
});

test('ordinary confirmation HTTP create rejects caller-supplied authority facts', async (t) => {
  const { base, headers } = await startServer(t);
  const forged = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...createBody(),
      creditCost: 1,
      approvalScope: 'plan_only',
      quoteRef: { id: 'forged', revision: 99 },
      snapshotHash: 'forged-hash',
      createdAt: '2099-01-01T00:00:00.000Z',
    }),
  });
  assert.equal(forged.response.status, 400);
});

test('confirmation expire path cancels + refunds an expired hold', async (t) => {
  const { base, headers } = await startServer(t);
  await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });
  const expired = await jsonFetch(`${base}/confirmation%3Aworkflow-1/expire`, {
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
  const { base, headers } = await startServer(t, undefined, 4);

  const bad = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });
  assert.equal(bad.response.status, 409);

  const malformed = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ planId: 'short' }),
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

test('foreign workspace cannot decide or expire another workspace confirmation', async (t) => {
  const { base, headers, ledger } = await startServer(t);
  await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });
  await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      createBody({
        workflowId: 'workflow-2',
      }),
    ),
  });

  const foreignHeaders = {
    ...headers,
    'x-user-id': 'owner-2',
    'x-workspace-id': 'ws-2',
  };
  const foreignBase = base.replace('/workspaces/ws-1/', '/workspaces/ws-2/');
  const decided = await jsonFetch(`${foreignBase}/confirmation%3Aworkflow-1/decide`, {
    method: 'POST',
    headers: foreignHeaders,
    body: JSON.stringify({
      decisionId: 'decision-foreign',
      decision: 'rejected',
      decidedAt: '2026-08-08T13:00:00.000Z',
    }),
  });
  assert.equal(decided.response.status, 404);

  const expired = await jsonFetch(`${foreignBase}/confirmation%3Aworkflow-2/expire`, {
    method: 'POST',
    headers: foreignHeaders,
    body: JSON.stringify({ now: '2026-08-09T13:00:00.000Z' }),
  });
  assert.equal(expired.response.status, 404);

  const listed = await jsonFetch(base, { method: 'GET', headers });
  const requests = (
    listed.body.data as {
      requests: Array<{ request: { status: string } }>;
    }
  ).requests;
  assert.deepEqual(
    requests.map((row) => row.request.status),
    ['pending', 'pending'],
  );
  assert.equal(
    (await ledger.project('ws-1', '2026-08-09T13:00:00.000Z'))
      .availableCredits,
    10,
  );
});

test('foreign workspace cannot replay-create another workspace request id', async (t) => {
  const { base, headers, ledger } = await startServer(t);
  const created = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });
  assert.equal(created.response.status, 201);

  const foreignHeaders = {
    ...headers,
    'x-user-id': 'owner-2',
    'x-workspace-id': 'ws-2',
  };
  const foreignBase = base.replace('/workspaces/ws-1/', '/workspaces/ws-2/');
  const replay = await jsonFetch(foreignBase, {
    method: 'POST',
    headers: foreignHeaders,
    body: JSON.stringify(createBody()),
  });

  assert.equal(replay.response.status, 404);
  assert.equal(
    (await ledger.project('ws-1', '2026-08-08T13:00:00.000Z'))
      .availableCredits,
    15,
  );
});

test('stable workflow replay reuses server-authoritative facts without another debit', async (t) => {
  const { base, headers, ledger } = await startServer(t);
  const created = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });
  assert.equal(created.response.status, 201);

  const replay = await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });

  assert.equal(replay.response.status, 201);
  assert.equal(
    (await ledger.project('ws-1', '2026-08-08T13:00:00.000Z'))
      .availableCredits,
    15,
  );
});

test('confirmation HTTP timestamps are server-owned and cannot advance expiry', async (t) => {
  const serverNow = '2026-08-08T18:00:00.000Z';
  const { base, headers } = await startServer(t, serverNow);
  await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(createBody()),
  });

  const decided = await jsonFetch(`${base}/confirmation%3Aworkflow-1/decide`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      decisionId: 'decision-server-clock',
      decision: 'confirmed',
      decidedAt: '2099-01-01T00:00:00.000Z',
    }),
  });
  assert.equal(decided.response.status, 200);
  const decidedAt = Date.parse(
    (decided.body.data as { decision: { decidedAt: string } }).decision
      .decidedAt,
  );
  assert.equal(decidedAt, Date.parse(serverNow));

  await jsonFetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      createBody({
        workflowId: 'workflow-clock-2',
      }),
    ),
  });
  const expired = await jsonFetch(`${base}/confirmation%3Aworkflow-clock-2/expire`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ now: '2099-01-01T00:00:00.000Z' }),
  });
  assert.equal(expired.response.status, 409);
});
