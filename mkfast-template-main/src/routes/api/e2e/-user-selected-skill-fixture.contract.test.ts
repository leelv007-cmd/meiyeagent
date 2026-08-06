import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('user_selected skill fixture is local E2E only and payload-free', async () => {
  const source = await readFile(
    new URL('./user-selected-skill-fixture.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /import\.meta\.env\.DEV === true/u);
  assert.match(source, /import\.meta\.env\.MODE === 'e2e'/u);
  assert.match(source, /x-e2e-secret/u);
  assert.match(source, /status: 404/u);
  assert.match(source, /forwardAuthenticatedCoreRequest/u);
  assert.match(source, /\/v1\/e2e\/user-selected-skill-fixture/u);
  assert.match(source, /foreignWorkspaceId/u);
  assert.match(source, /new Request\(request\.url/u);
  assert.doesNotMatch(source, /request\.json\(/u);
});

test('user_selected skill evidence is local E2E only and payload-free', async () => {
  const source = await readFile(
    new URL('./user-selected-skill-evidence.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /import\.meta\.env\.DEV === true/u);
  assert.match(source, /import\.meta\.env\.MODE === 'e2e'/u);
  assert.match(source, /x-e2e-secret/u);
  assert.match(source, /status: 404/u);
  assert.match(source, /forwardAuthenticatedCoreRequest/u);
  assert.match(source, /\/v1\/e2e\/user-selected-skill-evidence/u);
  assert.match(source, /taskId/u);
  assert.match(source, /new Request\(request\.url/u);
  assert.doesNotMatch(source, /request\.json\(/u);
});
