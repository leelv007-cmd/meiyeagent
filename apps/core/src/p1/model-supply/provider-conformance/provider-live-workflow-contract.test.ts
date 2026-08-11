import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflowUrl = new URL(
  '../../../../../../.github/workflows/provider-live.yml',
  import.meta.url,
);

test('provider-live workflow runs production supply faults and preserves release gates', async () => {
  const workflow = await readFile(workflowUrl, 'utf8');

  assert.match(
    workflow,
    /fault-injection\/production-supply-faults\.test\.ts[\s\S]*fault-injection\/publish-gate\.test\.ts/,
  );
  assert.match(
    workflow,
    /provider-conformance\/live-fault-injection\.integration\.test\.ts/,
  );
  assert.match(
    workflow,
    /Require live evidence artifact[\s\S]*provider-live-gate\.json/,
  );
  assert.doesNotMatch(workflow, /fault-injection\.matrix\.test\.ts/);
});
