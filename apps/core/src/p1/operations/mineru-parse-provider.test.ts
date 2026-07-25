import assert from 'node:assert/strict';
import test from 'node:test';

import {
  documentParseProviderFromEnv,
  MinerUOfficialParseProvider,
} from './mineru-parse-provider.js';
import {
  FixtureDocumentParseProvider,
  ParseProviderError,
} from './parse-service.js';

const source = {
  assetId: 'price-sheet',
  workspaceId: 'workspace-mineru',
  objectKey: 'workspace-mineru/price-sheet.png',
  sha256: 'a'.repeat(64),
  sizeBytes: 128,
  contentType: 'image/png',
  sourceUrl: 'https://assets.example.test/price-sheet.png',
  inputKind: 'document_image' as const,
  target: 'price_list' as const,
  rightsStatus: 'confirmed' as const,
  createdAt: '2026-07-26T00:00:00.000Z',
};

test('official adapter submits the MinerU v4 precision contract and polls real progress', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    json({ code: 0, data: { task_id: 'mineru-task-1' } }),
    json({
      code: 0,
      data: {
        state: 'running',
        extract_progress: { extracted_pages: 1, total_pages: 2 },
      },
    }),
    json({
      code: 0,
      data: {
        state: 'done',
        markdown: '头皮护理 239 元',
        structured: { tables: [{ rows: 1 }] },
        extract_progress: { extracted_pages: 2, total_pages: 2 },
      },
    }),
  ];
  const provider = new MinerUOfficialParseProvider('secret-token', {
    fetchImpl: (async (url, init) => {
      requests.push({ url: String(url), init });
      const response = responses.shift();
      if (!response) throw new Error('Unexpected request.');
      return response;
    }) as typeof fetch,
    pollIntervalMs: 0,
    sleep: async () => undefined,
  });

  const output = await provider.parse({
    workspaceId: source.workspaceId,
    taskId: 'parse-task-1',
    source,
    effectIdempotencyKey: 'parse-task-1:price-sheet:parse',
  });

  assert.equal(output.parserKind, 'mineru_official');
  assert.equal(output.providerTaskRef, 'mineru-task-1');
  assert.equal(output.extractedPages, 2);
  assert.equal(output.totalPages, 2);
  assert.equal(output.markdown, '头皮护理 239 元');
  assert.equal(requests[0]?.url, 'https://mineru.net/api/v4/extract/task');
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    url: source.sourceUrl,
    model_version: 'vlm',
    is_ocr: true,
    enable_table: true,
    enable_formula: false,
  });
  assert.equal(
    (requests[0]?.init?.headers as Record<string, string>).authorization,
    'Bearer secret-token',
  );
});

test('official adapter classifies HTTP 429 without exposing its token', async () => {
  const provider = new MinerUOfficialParseProvider('do-not-print', {
    fetchImpl: (async () => new Response('', { status: 429 })) as typeof fetch,
  });

  await assert.rejects(
    () =>
      provider.parse({
        workspaceId: source.workspaceId,
        taskId: 'parse-task-rate-limit',
        source,
        effectIdempotencyKey: 'rate-limit',
      }),
    (error: unknown) =>
      error instanceof ParseProviderError &&
      error.reason === 'rate_limited' &&
      !error.message.includes('do-not-print'),
  );
});

test('fixture mode is the credential-free default and official mode requires A-5', () => {
  assert.ok(
    documentParseProviderFromEnv({}) instanceof FixtureDocumentParseProvider,
  );
  assert.throws(
    () => documentParseProviderFromEnv({ MINERU_PARSE_MODE: 'official' }),
    /MINERU_API_TOKEN/u,
  );
});

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
