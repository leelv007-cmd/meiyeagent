import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  LANGFUSE_INGESTION_EVENT_FIELDS,
  LANGFUSE_DATASET_ITEM_FIELDS,
  LANGFUSE_SCORE_BODY_FIELDS,
  LANGFUSE_SPAN_BODY_FIELDS,
  LANGFUSE_TRACE_BODY_FIELDS,
  LangfuseHttpSender,
  langfuseSenderFromEnv,
} from './langfuse-sender.js';
import {
  HarnessLangfuseOutboxWorker,
  type HarnessLangfuseOutboxItem,
  type HarnessLangfuseOutboxStore,
} from './outbox-worker.js';

test('Langfuse sender maps one task and semantic stage through explicit payload whitelists', async (t) => {
  const requests: Array<{
    authorization?: string;
    body: { batch: Array<{ type: string; body: Record<string, unknown> }> };
  }> = [];
  const server = createServer(async (request, response) => {
    requests.push({
      authorization: request.headers.authorization,
      body: await readJson(request),
    });
    sendJson(response, 200, { successes: requests.at(-1)?.body.batch ?? [] });
  });
  const baseUrl = await listen(t, server);
  const sender = new LangfuseHttpSender({
    baseUrl,
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });

  await sender.send(selectionItem());

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.authorization,
    `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}`,
  );
  const batch = requests[0]!.body.batch;
  const trace = batch.find(({ type }) => type === 'trace-create')!;
  const span = batch.find(({ type }) => type === 'span-create')!;
  const scores = batch.filter(({ type }) => type === 'score-create');
  assert.deepEqual(Object.keys(trace).sort(), [...LANGFUSE_INGESTION_EVENT_FIELDS].sort());
  assert.deepEqual(Object.keys(span).sort(), [...LANGFUSE_INGESTION_EVENT_FIELDS].sort());
  assert.deepEqual(Object.keys(trace.body).sort(), [...LANGFUSE_TRACE_BODY_FIELDS].sort());
  assert.deepEqual(Object.keys(span.body).sort(), [...LANGFUSE_SPAN_BODY_FIELDS].sort());
  assert.ok(scores.length >= 2);
  for (const score of scores) {
    assert.deepEqual(Object.keys(score.body).sort(), [...LANGFUSE_SCORE_BODY_FIELDS].sort());
  }
  assert.equal(trace.body.name, 'beauty-marketing-task');
  assert.equal(span.body.name, '04-execution-selection');
  assert.equal(span.body.traceId, trace.body.id);
  assert.deepEqual(span.body.metadata, {
    auditId: 'audit-task-48-execution-r1',
    taskId: 'task-48',
    workflowId: 'harness.v1:d29ya3NwYWNlLTE:dGFzay00OA',
    spanId: span.body.id,
    stage: 'execution_selection',
    eventType: 'stage_decision_recorded',
    decisionTrace: {
      winnerCandidateId: 'c02',
      candidateScores: [
        {
          candidateId: 'c01',
          score: 78,
          dimensions: { grounding: 0.8 },
          reasonCode: 'model_score_reason_redacted',
        },
        {
          candidateId: 'c02',
          score: 92,
          dimensions: { grounding: 1 },
          reasonCode: 'model_score_reason_redacted',
        },
      ],
      blockedCandidates: [{ candidateId: 'c03', gateIds: ['medical_claim'] }],
      rubricVersion: 'copy-quality-v1',
      rubricHash: 'rubric-hash',
    },
  });
  assert.deepEqual(
    scores.map(({ body }) => ({ name: body.name, value: body.value })),
    [
      { name: 'harness.selection.candidate_score', value: 78 },
      { name: 'harness.selection.candidate_score', value: 92 },
    ],
  );
  const serialized = JSON.stringify(requests[0]?.body);
  for (const forbidden of [
    'raw merchant PII',
    'sk-should-never-leave',
    'https://private.example/customer-face.png',
    'apiKey',
    'rawInput',
    'assetUrl',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('free-form scoring reasons cannot leave Core through Langfuse payloads', async (t) => {
  let body:
    | { batch: Array<{ type: string; body: Record<string, unknown> }> }
    | undefined;
  const server = createServer(async (request, response) => {
    body = await readJson(request);
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });
  const item = selectionItem();
  const decisionTrace = item.decisionTrace as {
    candidateScores: Array<Record<string, unknown>>;
  };
  decisionTrace.candidateScores[0]!.reason =
    '联系顾客 13800138000 或 customer@example.com 后再推荐';

  await sender.send(item);

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('13800138000'), false);
  assert.equal(serialized.includes('customer@example.com'), false);
  const span = body?.batch.find(({ type }) => type === 'span-create');
  const metadata = span?.body.metadata as {
    decisionTrace: { candidateScores: Array<Record<string, unknown>> };
  };
  assert.deepEqual(metadata.decisionTrace.candidateScores[0], {
    candidateId: 'c01',
    score: 78,
    dimensions: { grounding: 0.8 },
    reasonCode: 'model_score_reason_redacted',
  });
  const score = body?.batch.find(({ type }) => type === 'score-create');
  assert.equal(score?.body.comment, 'model_score_reason_redacted');
  assert.deepEqual(score?.body.metadata, {
    candidateId: 'c01',
    reasonCode: 'model_score_reason_redacted',
  });
});

test('Langfuse Skill lineage emits only revision refs and hashes through both body whitelists', async (t) => {
  let body:
    | { batch: Array<{ type: string; body: Record<string, unknown> }> }
    | undefined;
  const server = createServer(async (request, response) => {
    body = await readJson(request);
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });
  const item = selectionItem();
  Object.assign(item.decisionTrace as Record<string, unknown>, {
    skillRevisionRefs: ['skill.intent@2'],
    skillContentHashes: ['hash-intent-two'],
    skillInstructions: ['private instruction body'],
  });

  await sender.send(item);

  const trace = body?.batch.find(({ type }) => type === 'trace-create')?.body;
  const span = body?.batch.find(({ type }) => type === 'span-create')?.body;
  for (const event of [trace, span]) {
    assert.equal('skillRevisionRefs' in (event ?? {}), false);
    assert.equal('skillContentHashes' in (event ?? {}), false);
    const metadata = event?.metadata as Record<string, unknown>;
    assert.deepEqual(metadata.skillRevisionRefs, ['skill.intent@2']);
    assert.deepEqual(metadata.skillContentHashes, ['hash-intent-two']);
  }
  assert.equal(JSON.stringify(body).includes('private instruction body'), false);
});

test('same outbox event replay sends identical idempotency and entity ids', async (t) => {
  const bodies: unknown[] = [];
  const server = createServer(async (request, response) => {
    bodies.push(await readJson(request));
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });
  const item = selectionItem();

  await sender.send(item);
  await sender.send({ ...item, attempts: item.attempts + 1 });

  assert.deepEqual(bodies[1], bodies[0]);
});

test('assembly writes root axes once while canonical events keep axes on child spans', async (t) => {
  const bodies: Array<{
    batch: Array<{ type: string; body: Record<string, unknown> }>;
  }> = [];
  const server = createServer(async (request, response) => {
    bodies.push(await readJson(request));
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });

  await sender.send({
    ...selectionItem(),
    auditId: 'audit-observability-feedback-248',
    stage: 'observability_event_ingest',
    eventType: 'delivery_rating.recorded',
    payload: {
      eventType: 'delivery_rating.recorded',
      taskId: 'task-48',
      skillRevision: 'copywriter@rev-17',
      promptVersion: 'marketing/copy@v4',
      catalogRevision: 'catalog-2026-07-29',
      scene: 'opening-campaign',
      payload: {
        packageId: 'package-248',
        versionId: 'version-3',
        revision: 3,
        verdict: 'up',
      },
    },
    decisionTrace: null,
  });

  const trace = bodies[0]?.batch.find(
    ({ type }) => type === 'trace-create',
  )?.body;
  const span = bodies[0]?.batch.find(
    ({ type }) => type === 'span-create',
  )?.body;
  const traceMetadata = trace?.metadata as Record<string, unknown>;
  for (const axis of [
    'skillRevision',
    'promptVersion',
    'catalogRevision',
    'scene',
  ]) {
    assert.equal(axis in traceMetadata, false);
  }
  const spanMetadata = span?.metadata as Record<string, unknown>;
  assert.equal(spanMetadata.skillRevision, 'copywriter@rev-17');
  assert.equal(spanMetadata.promptVersion, 'marketing/copy@v4');
  assert.equal(spanMetadata.catalogRevision, 'catalog-2026-07-29');
  assert.equal(spanMetadata.scene, 'opening-campaign');
  assert.equal('axes' in spanMetadata, false);
  assert.deepEqual(span?.output, {
    packageId: 'package-248',
    versionId: 'version-3',
    revision: 3,
    verdict: 'up',
  });

  await sender.send({
    ...selectionItem(),
    auditId: 'audit-execution-assembly-262',
    stage: 'observability_event_ingest',
    eventType: 'agent_primitive.lifecycle',
    payload: {
      eventType: 'agent_primitive.lifecycle',
      taskId: 'task-48',
      workspaceId: 'workspace-1',
      actorId: `ref:${'a'.repeat(64)}`,
      actorKind: 'worker',
      idempotencyKey: 'harness-assembly-event-persistence',
      axisScope: 'task_root',
      skillRevision: null,
      promptVersion: null,
      catalogRevision: 'catalog-2026-07-29',
      scene: 'recipe-card-group',
      payload: {
        primitiveId: 'harness-assembly:event_persistence',
        phase: 'succeeded',
        billing: { kind: 'not_billed' },
      },
    },
    decisionTrace: null,
  });

  const assemblyTrace = bodies[1]?.batch.find(
    ({ type }) => type === 'trace-create',
  )?.body;
  const assemblySpan = bodies[1]?.batch.find(
    ({ type }) => type === 'span-create',
  )?.body;
  assert.deepEqual(assemblyTrace?.metadata, {
    taskId: 'task-48',
    workflowId: 'harness.v1:d29ya3NwYWNlLTE:dGFzay00OA',
    catalogRevision: 'catalog-2026-07-29',
    scene: 'recipe-card-group',
  });
  const assemblySpanMetadata =
    assemblySpan?.metadata as Record<string, unknown>;
  assert.equal(assemblySpanMetadata.skillRevision, null);
  assert.equal(assemblySpanMetadata.promptVersion, null);
  assert.equal(
    assemblySpanMetadata.catalogRevision,
    'catalog-2026-07-29',
  );
  assert.equal(assemblySpanMetadata.scene, 'recipe-card-group');
});

test('agent primitive lifecycle exports explicit absent axes and safe server identity', async (t) => {
  const bodies: Array<{
    batch: Array<{ type: string; body: Record<string, unknown> }>;
  }> = [];
  const server = createServer(async (request, response) => {
    bodies.push(await readJson(request));
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });

  await sender.send({
    ...selectionItem(),
    auditId: 'audit-agent-primitive-invoked',
    stage: 'observability_event_ingest',
    eventType: 'agent_primitive.lifecycle',
    payload: {
      eventType: 'agent_primitive.lifecycle',
      taskId: 'task-48',
      workspaceId: 'workspace-1',
      actorId: `ref:${'a'.repeat(64)}`,
      actorKind: 'worker',
      idempotencyKey: 'agent-primitive-id',
      axisScope: 'task_root',
      skillRevision: null,
      promptVersion: null,
      catalogRevision: null,
      scene: null,
      payload: {
        primitiveId: 'generate',
        phase: 'invoked',
        billing: { kind: 'not_billed' },
      },
    },
    decisionTrace: null,
  });

  const rootTrace = bodies[0]?.batch.find(
    ({ type }) => type === 'trace-create',
  )?.body;
  const rootSpan = bodies[0]?.batch.find(
    ({ type }) => type === 'span-create',
  )?.body;
  const rootTraceMetadata = rootTrace?.metadata as Record<string, unknown>;
  for (const axis of [
    'skillRevision',
    'promptVersion',
    'catalogRevision',
    'scene',
  ]) {
    assert.equal(axis in rootTraceMetadata, false);
  }
  const rootSpanMetadata = rootSpan?.metadata as Record<string, unknown>;
  for (const metadata of [rootSpanMetadata]) {
    assert.equal(metadata.skillRevision, null);
    assert.equal(metadata.promptVersion, null);
    assert.equal(metadata.catalogRevision, null);
    assert.equal(metadata.scene, null);
  }
  assert.equal('primitiveId' in rootTraceMetadata, false);
  for (const metadata of [rootSpanMetadata]) {
    assert.equal(metadata.axisScope, 'task_root');
    assert.equal(metadata.primitiveId, 'generate');
    assert.equal(metadata.phase, 'invoked');
    assert.equal(metadata.actorId, `ref:${'a'.repeat(64)}`);
    assert.equal(metadata.actorKind, 'worker');
    assert.equal(metadata.idempotencyKey, 'agent-primitive-id');
    assert.equal('rawError' in metadata, false);
  }
  assert.deepEqual(rootSpan?.output, {
    primitiveId: 'generate',
    phase: 'invoked',
    billing: { kind: 'not_billed' },
  });

  await sender.send({
    ...selectionItem(),
    auditId: 'audit-agent-primitive-child',
    stage: 'observability_event_ingest',
    eventType: 'agent_primitive.lifecycle',
    payload: {
      eventType: 'agent_primitive.lifecycle',
      taskId: 'task-48',
      workspaceId: 'workspace-1',
      actorId: `ref:${'a'.repeat(64)}`,
      actorKind: 'worker',
      idempotencyKey: 'agent-primitive-child-id',
      axisScope: 'execution_child',
      skillRevision: 'copywriter@rev-17',
      promptVersion: 'marketing/copy@v4',
      catalogRevision: 'catalog-2026-07-29',
      scene: 'opening-campaign',
      payload: {
        primitiveId: 'generate',
        phase: 'succeeded',
        billing: { kind: 'not_billed' },
      },
    },
    decisionTrace: null,
  });

  const childTrace = bodies[1]?.batch.find(
    ({ type }) => type === 'trace-create',
  )?.body;
  const childSpan = bodies[1]?.batch.find(
    ({ type }) => type === 'span-create',
  )?.body;
  assert.equal(childTrace, undefined);
  const childSpanMetadata = childSpan?.metadata as Record<string, unknown>;
  assert.equal(childSpanMetadata.skillRevision, 'copywriter@rev-17');
  assert.equal(childSpanMetadata.promptVersion, 'marketing/copy@v4');
  assert.equal(childSpanMetadata.catalogRevision, 'catalog-2026-07-29');
  assert.equal(childSpanMetadata.scene, 'opening-campaign');
  assert.equal(childSpanMetadata.axisScope, 'execution_child');
});

test('same semantic stage keeps retries stable without collapsing distinct attempts', async (t) => {
  const bodies: Array<{
    batch: Array<{ type: string; body: Record<string, unknown> }>;
  }> = [];
  const server = createServer(async (request, response) => {
    bodies.push(await readJson(request));
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });
  const firstAttempt: HarnessLangfuseOutboxItem = {
    ...selectionItem(),
    auditId: 'audit-task-48-brief-r1',
    stage: 'brief_compilation',
    payload: { traceId: 'trace-task-48-brief_compilation-r1' },
    decisionTrace: { kind: 'copy', platform: 'xiaohongshu' },
  };
  const secondAttempt: HarnessLangfuseOutboxItem = {
    ...firstAttempt,
    auditId: 'audit-task-48-brief-r2',
    occurredAt: '2026-07-18T00:00:01.000Z',
    payload: { traceId: 'trace-task-48-brief_compilation-r2' },
    attempts: 1,
  };

  await sender.send(firstAttempt);
  await sender.send(secondAttempt);
  await sender.send({ ...firstAttempt, attempts: 2 });

  const spans = bodies.map(
    (body) => body.batch.find(({ type }) => type === 'span-create')!.body,
  );
  assert.equal(spans[0]?.traceId, spans[1]?.traceId);
  assert.notEqual(spans[0]?.id, spans[1]?.id);
  assert.equal(spans[0]?.id, spans[2]?.id);
});

test('delivery recommendation chips are attached as whitelisted span metadata', async (t) => {
  let body: { batch: Array<{ type: string; body: Record<string, unknown> }> } | undefined;
  const server = createServer(async (request, response) => {
    body = await readJson(request);
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });

  await sender.send(assemblyItem());

  const span = body?.batch.find(({ type }) => type === 'span-create');
  assert.equal(span?.body.name, '05-assembly-delivery');
  assert.deepEqual(
    (span?.body.metadata as Record<string, unknown>).decisionTrace,
    {
      recommendedCandidateId: 'c02',
      chips: {
        whyPost: 'promotion_groupbuy_conversion',
        expressionIdentity: 'marketing_identity:owner-1:3',
        factReferences: ['store_fact:offer:5'],
        platforms: ['xiaohongshu'],
        customerAction: '私信预约',
        complianceStatus: 'seven_gates_passed',
        deliverables: ['copy_revision:4'],
      },
    },
  );
});

test('prompt fallback fact reaches the Langfuse span without prompt content', async (t) => {
  let body: { batch: Array<{ type: string; body: Record<string, unknown> }> } | undefined;
  const server = createServer(async (request, response) => {
    body = await readJson(request);
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });

  await sender.send({
    ...selectionItem(),
    stage: 'intent_naming',
    decisionTrace: {
      declaration: {
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        implicitConstraints: [],
      },
      prompt: {
        name: 'harness/intent-naming',
        version: 'builtin-v1',
        content: 'private prompt content',
        contentHash: 'f'.repeat(64),
        label: 'production',
        source: 'builtin',
        isFallback: true,
        fallbackReason: 'http_503',
      },
    },
  });

  const span = body?.batch.find(({ type }) => type === 'span-create');
  assert.deepEqual(
    (span?.body.metadata as Record<string, unknown>).prompt,
    {
      name: 'harness/intent-naming',
      version: 'builtin-v1',
      contentHash: 'f'.repeat(64),
      label: 'production',
      source: 'builtin',
      isFallback: true,
      fallbackReason: 'http_503',
    },
  );
  assert.equal(JSON.stringify(body).includes('private prompt content'), false);
});

test('detached prompt audits project prompt lineage from the audited payload', async (t) => {
  let body: { batch: Array<{ type: string; body: Record<string, unknown> }> } | undefined;
  const server = createServer(async (request, response) => {
    body = await readJson(request);
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });

  await sender.send({
    auditId: 'audit-direct-prompt-fallback',
    workflowId: 'harness.v1:d29ya3NwYWNlLTE:ZGlyZWN0LTE',
    stage: 'prompt_resolution',
    eventType: 'langfuse_prompt_fallback',
    occurredAt: '2026-07-29T00:00:00.000Z',
    attempts: 1,
    payload: {
      promptKey: 'copyGeneration',
      prompt: {
        name: 'harness/copy-generation',
        version: 'builtin-v1',
        content: 'private prompt content',
        contentHash: 'f'.repeat(64),
        label: 'production',
        source: 'builtin',
        isFallback: true,
        fallbackReason: 'http_503',
      },
    },
  });

  const span = body?.batch.find(({ type }) => type === 'span-create');
  assert.deepEqual(
    (span?.body.metadata as Record<string, unknown>).prompt,
    {
      name: 'harness/copy-generation',
      version: 'builtin-v1',
      contentHash: 'f'.repeat(64),
      label: 'production',
      source: 'builtin',
      isFallback: true,
      fallbackReason: 'http_503',
    },
  );
  assert.equal(JSON.stringify(body).includes('private prompt content'), false);
});

test('local structured-node sample exports identical four metrics and prompt-version dataset item', async (t) => {
  const localSnapshot = {
    initial: { calls: 4, schemaValid: 3, schemaInvalid: 1 },
    repair: { status: 'observed' as const, count: 1, reasons: ['schema_validation'] },
    retry: { triggered: 2 },
    nestedCompleteness: { complete: 18, total: 24 },
  };
  const requests: Array<{ url?: string; body: Record<string, unknown> }> = [];
  const server = createServer(async (request, response) => {
    requests.push({ url: request.url, body: await readJson(request) });
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });
  const item: HarnessLangfuseOutboxItem = {
    ...selectionItem(),
    auditId: 'audit-task-48-intent-metrics',
    stage: 'intent_naming',
    decisionTrace: {
      declaration: {
        taskType: 'daily_service_exposure',
        deliveryLayer: 'copy',
        implicitConstraints: [],
      },
      prompt: {
        name: 'harness/intent-naming',
        version: '7',
        contentHash: '7'.repeat(64),
        label: 'production',
        source: 'langfuse',
        isFallback: false,
      },
      metrics: localSnapshot,
    },
  };

  await sender.send(item);

  assert.deepEqual(
    requests.map(({ url }) => url),
    ['/api/public/ingestion', '/api/public/dataset-items'],
  );
  const ingestion = requests[0]?.body as {
    batch: Array<{ type: string; body: Record<string, unknown> }>;
  };
  assert.deepEqual(
    ingestion.batch
      .filter(({ type }) => type === 'score-create')
      .map(({ body }) => ({
        name: body.name,
        value: body.value,
        metadata: body.metadata,
      })),
    [
      {
        name: 'harness.schema.first_pass_rate',
        value: 0.75,
        metadata: {
          promptName: 'harness/intent-naming',
          promptVersion: '7',
          numerator: 3,
          denominator: 4,
        },
      },
      {
        name: 'harness.repair.call_rate',
        value: 0.25,
        metadata: {
          promptName: 'harness/intent-naming',
          promptVersion: '7',
          numerator: 1,
          denominator: 4,
          reasons: ['schema_validation'],
        },
      },
      {
        name: 'harness.retry.trigger_rate',
        value: 0.5,
        metadata: {
          promptName: 'harness/intent-naming',
          promptVersion: '7',
          numerator: 2,
          denominator: 4,
        },
      },
      {
        name: 'harness.nested_field_completeness_rate',
        value: 0.75,
        metadata: {
          promptName: 'harness/intent-naming',
          promptVersion: '7',
          numerator: 18,
          denominator: 24,
        },
      },
    ],
  );
  const dataset = requests[1]?.body;
  assert.deepEqual(Object.keys(dataset ?? {}).sort(), [
    ...LANGFUSE_DATASET_ITEM_FIELDS,
  ].sort());
  assert.equal(dataset?.datasetName, 'harness-structured-node-metrics');
  assert.deepEqual(dataset?.expectedOutput, { metrics: localSnapshot });
  assert.deepEqual(dataset?.metadata, {
    node: 'intent_naming',
    promptName: 'harness/intent-naming',
    promptVersion: '7',
    promptContentHash: '7'.repeat(64),
    promptFallback: false,
  });

  const firstBodies = structuredClone(requests.map(({ body }) => body));
  await sender.send({ ...item, attempts: 2 });
  assert.deepEqual(
    requests.slice(2).map(({ body }) => body),
    firstBodies,
  );
});

test('first usable draft audit exports product UX scores on the Harness trace', async (t) => {
  const requests: Array<{
    batch: Array<{ type: string; body: Record<string, unknown> }>;
  }> = [];
  const server = createServer(async (request, response) => {
    requests.push(await readJson(request));
    sendJson(response, 200, { successes: [] });
  });
  const sender = new LangfuseHttpSender({
    baseUrl: await listen(t, server),
    publicKey: 'pk-test',
    secretKey: 'sk-test',
  });
  const item: HarnessLangfuseOutboxItem = {
    auditId: 'audit-task-48-first-draft',
    workflowId: 'harness.v1:d29ya3NwYWNlLTE:dGFzay00OA',
    stage: 'product_experience',
    eventType: 'first_usable_draft_observed',
    occurredAt: '2026-07-19T08:00:00.000Z',
    payload: {
      path: 'canonical_mouse',
      timeToFirstUsableDraftMs: 842,
      userActivationCount: 1,
    },
    attempts: 1,
  };

  await sender.send(item);

  assert.equal(requests.length, 1);
  const batch = requests[0]!.batch;
  assert.deepEqual(
    batch
      .filter(({ type }) => type === 'score-create')
      .map(({ body }) => ({
        metadata: body.metadata,
        name: body.name,
        value: body.value,
      })),
    [
      {
        name: 'product.confirmation_precision',
        value: 1,
        metadata: {
          path: 'canonical_mouse',
          threshold: 2,
          userActivationCount: 1,
        },
      },
      {
        name: 'product.time_to_first_usable_draft',
        value: 842,
        metadata: {
          path: 'canonical_mouse',
          unit: 'milliseconds',
          userActivationCount: 1,
        },
      },
    ],
  );
  const span = batch.find(({ type }) => type === 'span-create')!;
  assert.deepEqual(
    (span.body.metadata as Record<string, unknown>).productMetrics,
    item.payload,
  );

  await sender.send({
    ...item,
    auditId: 'audit-task-48-first-draft-conflict',
    payload: {
      path: 'conflict',
      timeToFirstUsableDraftMs: 842,
      userActivationCount: 1,
    },
  });
  assert.deepEqual(
    requests[1]!.batch
      .filter(({ type }) => type === 'score-create')
      .map(({ body }) => body.name),
    ['product.time_to_first_usable_draft'],
  );
});

test('HTTP failure remains retryable through the existing outbox worker', async (t) => {
  let available = false;
  const server = createServer(async (request, response) => {
    await readJson(request);
    sendJson(response, available ? 200 : 503, { error: 'temporarily unavailable' });
  });
  const store = new RetryStore(selectionItem());
  const worker = new HarnessLangfuseOutboxWorker(
    store,
    new LangfuseHttpSender({
      baseUrl: await listen(t, server),
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    }),
    { now: () => new Date('2026-07-18T00:00:00.000Z'), retryDelayMs: 1_000 },
  );

  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 1,
    deadLettered: 0,
  });
  assert.equal(store.status, 'failed');
  available = true;
  store.status = 'queued';
  assert.deepEqual(await worker.runOnce(), {
    sent: 1,
    failed: 0,
    deadLettered: 0,
  });
  assert.equal(store.status, 'sent');
});

test('deterministic Langfuse HTTP failures dead-letter immediately with exact signal counts', async (t) => {
  const server = createServer(async (request, response) => {
    await readJson(request);
    sendJson(response, 401, { error: 'invalid credentials' });
  });
  const store = new RetryStore(selectionItem());
  const worker = new HarnessLangfuseOutboxWorker(
    store,
    new LangfuseHttpSender({
      baseUrl: await listen(t, server),
      publicKey: 'pk-test',
      secretKey: 'sk-test',
    }),
  );

  assert.deepEqual(await worker.runOnce(), {
    sent: 0,
    failed: 1,
    deadLettered: 1,
  });
  assert.equal(store.status, 'dead_letter');
  assert.deepEqual(store.deadLetterDrops, [
    {
      signal: 'trace',
      reason: 'permanent-config',
      count: 2,
      source: 'langfuse_ingestion',
    },
    {
      signal: 'score',
      reason: 'permanent-config',
      count: 2,
      source: 'langfuse_ingestion',
    },
  ]);
});

test('missing Langfuse configuration fails closed instead of acknowledging delivery', async () => {
  const sender = langfuseSenderFromEnv({});
  await assert.rejects(
    sender.send(selectionItem()),
    (error: unknown) => {
      assert.match(String(error), /LANGFUSE_BASE_URL/u);
      assert.deepEqual(
        (error as { drops?: unknown }).drops,
        [
          {
            signal: 'trace',
            reason: 'permanent-config',
            count: 2,
            source: 'langfuse_configuration',
          },
          {
            signal: 'score',
            reason: 'permanent-config',
            count: 2,
            source: 'langfuse_configuration',
          },
        ],
      );
      return true;
    },
  );
});

test('post-contract trace-backed audit without its exact trace fails closed', async () => {
  let requests = 0;
  const sender = new LangfuseHttpSender({
    baseUrl: 'https://langfuse.invalid',
    publicKey: 'pk-test',
    secretKey: 'sk-test',
    async fetch() {
      requests += 1;
      return new Response('{}', { status: 200 });
    },
  });

  await assert.rejects(
    sender.send({
      ...selectionItem(),
      traceContractVersion: 'observability/v1',
      decisionTrace: undefined,
    }),
    (error: unknown) => {
      assert.deepEqual((error as { drops?: unknown }).drops, [
        {
          signal: 'trace',
          reason: 'permanent-config',
          count: 1,
          source: 'langfuse_projection',
        },
      ]);
      return true;
    },
  );
  assert.equal(requests, 0);
});

function selectionItem(): HarnessLangfuseOutboxItem {
  return {
    auditId: 'audit-task-48-execution-r1',
    workflowId: 'harness.v1:d29ya3NwYWNlLTE:dGFzay00OA',
    stage: 'execution_selection',
    eventType: 'stage_decision_recorded',
    occurredAt: '2026-07-18T00:00:00.000Z',
    payload: {
      traceId: 'trace-task-48-execution_selection-r1',
      rawInput: 'raw merchant PII',
      apiKey: 'sk-should-never-leave',
      assetUrl: 'https://private.example/customer-face.png',
    },
    decisionTrace: {
      winnerCandidateId: 'c02',
      candidateScores: [
        {
          candidateId: 'c01',
          score: 78,
          dimensions: { grounding: 0.8 },
          reason: '事实依据较弱',
          apiKey: 'sk-should-never-leave',
        },
        {
          candidateId: 'c02',
          score: 92,
          dimensions: { grounding: 1 },
          reason: '事实完整且行动清楚',
        },
      ],
      blockedCandidates: [{ candidateId: 'c03', gateIds: ['medical_claim'] }],
      rubricVersion: 'copy-quality-v1',
      rubricHash: 'rubric-hash',
    },
    attempts: 1,
  };
}

function assemblyItem(): HarnessLangfuseOutboxItem {
  return {
    ...selectionItem(),
    auditId: 'audit-task-48-assembly-r1',
    stage: 'assembly_delivery',
    decisionTrace: {
      delivery: { packageId: 'package-1', versionId: 'version-4', revision: 4 },
      recommendation: {
        recommendedCandidateId: 'c02',
        decisionTrace: {
          whyPost: 'promotion_groupbuy_conversion',
          expressionIdentity: 'marketing_identity:owner-1:3',
          factReferences: ['store_fact:offer:5'],
          platforms: ['xiaohongshu'],
          customerAction: '私信预约',
          complianceStatus: 'seven_gates_passed',
          deliverables: ['copy_revision:4'],
          rawCustomerPhone: '13800000000',
        },
      },
    },
  };
}

class RetryStore implements HarnessLangfuseOutboxStore {
  status: 'queued' | 'sending' | 'failed' | 'sent' | 'dead_letter' = 'queued';
  deadLetterDrops: unknown;

  constructor(private readonly item: HarnessLangfuseOutboxItem) {}

  async claimLangfuseBatch() {
    if (this.status !== 'queued') return [];
    this.status = 'sending';
    return [this.item];
  }

  async markLangfuseSent() {
    this.status = 'sent';
  }

  async markLangfuseFailed() {
    this.status = 'failed';
  }

  async markLangfuseDeadLetter(
    _auditId: string,
    _error: string,
    drops: unknown,
  ) {
    this.status = 'dead_letter';
    this.deadLetterDrops = drops;
  }
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function listen(t: test.TestContext, server: ReturnType<typeof createServer>) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
