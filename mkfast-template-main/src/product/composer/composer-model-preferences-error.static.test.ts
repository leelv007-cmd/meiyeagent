import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Composer exposes model preference query failures with an explicit retry', async () => {
  const source = await readFile(
    new URL('./composer-home.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /preferencesQuery\.isError\s*\?/u);
  assert.match(source, /data-testid="composer-model-preferences-error"/u);
  assert.match(source, /preferencesQuery\.refetch\(\)/u);
  assert.match(source, /当前不会提交创作任务/u);
});
