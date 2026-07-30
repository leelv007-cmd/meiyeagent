import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLangfuseObservabilityLiveConfig,
  LANGFUSE_OBSERVABILITY_FILTER_AXES,
  runLangfuseObservabilityLiveAcceptance,
} from './langfuse-observability-live-acceptance.js';

test('live observability acceptance proves trace filters and the v1 Task-root observation', async () => {
  const fixture = createLangfuseFixture();

  const result = await runLangfuseObservabilityLiveAcceptance({
    baseUrl: 'https://langfuse.fixture',
    publicKey: 'pk-live-test',
    secretKey: 'sk-live-test',
    runId: 'run-248',
    fetch: fixture.fetch,
    sleep: async () => {},
    consistencyTimeoutMs: 500,
  });

  assert.equal(result.observationId, 'observation-live-248');
  assert.equal(result.matched, true);
  assert.deepEqual(result.positiveMatches, {
    skillRevision: 1,
    catalogRevision: 1,
    promptVersion: 1,
    scene: 1,
  });
  assert.deepEqual(result.negativeMatches, {
    skillRevision: 0,
    catalogRevision: 0,
    promptVersion: 0,
    scene: 0,
  });
  assert.deepEqual(fixture.observationTraceIds, [result.traceId]);
  assert.deepEqual(
    LANGFUSE_OBSERVABILITY_FILTER_AXES.map((axis, index) => ({
      axis,
      positive: fixture.filters[index * 2],
      negative: fixture.filters[index * 2 + 1],
    })),
    LANGFUSE_OBSERVABILITY_FILTER_AXES.map((axis) => ({
      axis,
      positive: {
        type: 'stringObject',
        column: 'metadata',
        key: axis,
        operator: '=',
        value: fixture.traceMetadata[axis],
      },
      negative: {
        type: 'stringObject',
        column: 'metadata',
        key: axis,
        operator: '=',
        value: `${fixture.traceMetadata[axis]}-negative-control`,
      },
    })),
  );
  assert.equal(fixture.spanMetadata.axisScope, 'task_root');
  for (const axis of LANGFUSE_OBSERVABILITY_FILTER_AXES) {
    assert.equal(fixture.spanMetadata[axis], fixture.traceMetadata[axis]);
  }
});

test('live observability acceptance fails closed when a trace negative filter matches', async () => {
  const fixture = createLangfuseFixture({ negativeControlMatches: true });

  await assert.rejects(
    runLangfuseObservabilityLiveAcceptance({
      baseUrl: 'https://langfuse.fixture',
      publicKey: 'pk-live-test',
      secretKey: 'sk-live-test',
      runId: 'negative-248',
      fetch: fixture.fetch,
      sleep: async () => {},
      consistencyTimeoutMs: 500,
    }),
    /filter matched its negative control/u,
  );
});

test('live observability acceptance retries HTTP 429 with a five-second minimum backoff', async () => {
  const fixture = createLangfuseFixture({ rateLimitOnce: true });
  const sleeps: number[] = [];

  const result = await runLangfuseObservabilityLiveAcceptance({
    baseUrl: 'https://langfuse.fixture',
    publicKey: 'pk-live-test',
    secretKey: 'sk-live-test',
    runId: 'rate-limit-248',
    fetch: fixture.fetch,
    pollIntervalMs: 1,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    consistencyTimeoutMs: 500,
  });

  assert.equal(result.matched, true);
  assert.deepEqual(sleeps, [5_000, 5_000, 5_000]);
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

function createLangfuseFixture(
  options: {
    negativeControlMatches?: boolean;
    rateLimitOnce?: boolean;
  } = {},
) {
  let traceId = '';
  const traceMetadata: Record<string, unknown> = {};
  const spanMetadata: Record<string, unknown> = {};
  const filters: Array<Record<string, unknown>> = [];
  const observationTraceIds: string[] = [];
  const rateLimitedRequests = new Set<string>();

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (init?.method === 'POST' && url.pathname === '/api/public/ingestion') {
      const body = JSON.parse(String(init.body)) as {
        batch: Array<{ type: string; body: Record<string, unknown> }>;
      };
      const trace = body.batch.find(({ type }) => type === 'trace-create');
      const span = body.batch.find(({ type }) => type === 'span-create');
      traceId = String(trace?.body.id);
      Object.assign(traceMetadata, trace?.body.metadata);
      Object.assign(spanMetadata, span?.body.metadata);
      return jsonResponse(200, { successes: body.batch });
    }
    if (url.pathname === '/api/public/observations') {
      observationTraceIds.push(url.searchParams.get('traceId') ?? '');
      if (shouldRateLimit('observation')) return jsonResponse(429, {});
      return jsonResponse(200, {
        data: [
          {
            id: 'observation-live-248',
            traceId,
            metadata: spanMetadata,
          },
        ],
      });
    }
    if (url.pathname === '/api/public/traces') {
      const filter = JSON.parse(
        url.searchParams.get('filter') ?? '[]',
      ) as Array<Record<string, unknown>>;
      assert.equal(filter.length, 1);
      const [axisFilter] = filter;
      filters.push(axisFilter!);
      const axis = String(axisFilter?.key);
      const value = String(axisFilter?.value);
      const negativeControl = value.endsWith('-negative-control');
      if (
        shouldRateLimit(
          negativeControl ? 'trace-negative' : 'trace-positive',
        )
      ) {
        return jsonResponse(429, {});
      }
      const matches =
        options.negativeControlMatches || value === traceMetadata[axis];
      return jsonResponse(200, {
        data: matches ? [{ id: traceId, metadata: traceMetadata }] : [],
      });
    }
    return jsonResponse(404, {});
  };

  function shouldRateLimit(request: string) {
    if (!options.rateLimitOnce || rateLimitedRequests.has(request)) return false;
    rateLimitedRequests.add(request);
    return true;
  }

  return {
    fetch,
    filters,
    observationTraceIds,
    traceMetadata,
    spanMetadata,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
