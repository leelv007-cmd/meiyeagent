import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';

import {
  assertLangfuseObservabilityLiveConfig,
  LANGFUSE_OBSERVABILITY_FILTER_AXES,
  runLangfuseObservabilityLiveAcceptance,
} from './langfuse-observability-live-acceptance.js';

test('live observability acceptance sends production metadata and proves every remote filter', async (t) => {
  const queries: Array<Array<Record<string, unknown>>> = [];
  let traceId: string | undefined;
  let metadata: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/public/ingestion') {
      const body = (await readJson(request)) as {
        batch: Array<{ type: string; body: Record<string, unknown> }>;
      };
      const trace = body.batch.find(({ type }) => type === 'trace-create');
      const span = body.batch.find(({ type }) => type === 'span-create');
      traceId = String(trace?.body.id);
      metadata = span?.body.metadata as Record<string, unknown>;
      sendJson(response, 200, { successes: body.batch });
      return;
    }
    const url = new URL(request.url ?? '/', 'http://fixture.local');
    if (request.method === 'GET' && url.pathname === '/api/public/v2/observations') {
      const filter = JSON.parse(url.searchParams.get('filter') ?? '[]') as Array<
        Record<string, unknown>
      >;
      queries.push(filter);
      const axisFilter = filter.find(({ column }) => column === 'metadata');
      const axis = String(axisFilter?.key);
      const expected = metadata?.[axis];
      const matches = axisFilter?.value === expected;
      sendJson(response, 200, {
        data: matches
          ? [{ id: 'observation-live-248', traceId, metadata }]
          : [],
        meta: { cursor: null },
      });
      return;
    }
    sendJson(response, 404, {});
  });

  const result = await runLangfuseObservabilityLiveAcceptance({
    baseUrl: await listen(t, server),
    publicKey: 'pk-live-test',
    secretKey: 'sk-live-test',
    runId: 'run-248',
    pollIntervalMs: 1,
    consistencyTimeoutMs: 50,
  });

  assert.equal(result.observationId, 'observation-live-248');
  assert.equal(result.matched, true);
  assert.deepEqual(result.positiveMatches, {
    axisScope: 1,
    catalogRevision: 1,
    promptVersion: 1,
    scene: 1,
  });
  assert.deepEqual(result.negativeMatches, {
    axisScope: 0,
    catalogRevision: 0,
    promptVersion: 0,
    scene: 0,
  });
  assert.deepEqual(
    LANGFUSE_OBSERVABILITY_FILTER_AXES.map((axis, index) => ({
      axis,
      positiveKey: queries[index * 2]?.[1]?.key,
      negativeKey: queries[index * 2 + 1]?.[1]?.key,
      traceColumn: queries[index * 2]?.[0]?.column,
    })),
    LANGFUSE_OBSERVABILITY_FILTER_AXES.map((axis) => ({
      axis,
      positiveKey: axis,
      negativeKey: axis,
      traceColumn: 'traceId',
    })),
  );
});

test('live observability acceptance fails closed when a negative filter matches', async (t) => {
  let traceId = '';
  let metadata: Record<string, unknown> = {};
  const server = createServer(async (request, response) => {
    if (request.method === 'POST') {
      const body = (await readJson(request)) as {
        batch: Array<{ type: string; body: Record<string, unknown> }>;
      };
      traceId = String(
        body.batch.find(({ type }) => type === 'trace-create')?.body.id,
      );
      metadata = body.batch.find(({ type }) => type === 'span-create')?.body
        .metadata as Record<string, unknown>;
      sendJson(response, 200, { successes: body.batch });
      return;
    }
    sendJson(response, 200, {
      data: [{ id: 'false-positive', traceId, metadata }],
      meta: { cursor: null },
    });
  });

  await assert.rejects(
    runLangfuseObservabilityLiveAcceptance({
      baseUrl: await listen(t, server),
      publicKey: 'pk-live-test',
      secretKey: 'sk-live-test',
      runId: 'negative-248',
      pollIntervalMs: 1,
      consistencyTimeoutMs: 50,
    }),
    /filter matched its negative control/u,
  );
});

test('live observability configuration requires opt-in and credentials', () => {
  assert.throws(
    () => assertLangfuseObservabilityLiveConfig({}),
    /RUN_LIVE_LANGFUSE_OBSERVABILITY_ACCEPTANCE=1/u,
  );
  assert.throws(
    () =>
      assertLangfuseObservabilityLiveConfig({
        RUN_LIVE_LANGFUSE_OBSERVABILITY_ACCEPTANCE: '1',
      }),
    /LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY/u,
  );
});

async function listen(t: test.TestContext, server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected fixture server to expose a TCP address.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function readJson(request: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
