import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('credit detail fixture accepts no merchant locator and is local E2E only', async () => {
  const source = await readFile(
    new URL('./credit-detail-fixture.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /import\.meta\.env\.DEV === true/u);
  assert.match(source, /import\.meta\.env\.MODE === 'e2e'/u);
  assert.match(source, /x-e2e-secret/u);
  assert.match(source, /status: 404/u);
  assert.match(source, /forwardAuthenticatedCoreRequest/u);
  assert.match(source, /'\/v1\/e2e\/credit-detail-fixture'/u);
  assert.match(source, /new Request\(request\.url/u);
  assert.doesNotMatch(source, /request\.json\(/u);
  assert.doesNotMatch(source, /workspaceId|userId|actorId|correlationId/u);
});
