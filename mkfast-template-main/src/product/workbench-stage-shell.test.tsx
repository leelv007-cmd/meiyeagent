import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { WorkbenchStageShell } from './workbench-stage-shell';

test('completed result stage removes the competing operations rail', () => {
  const html = renderToStaticMarkup(
    <WorkbenchStageShell
      articleLabel="Agent creation record"
      jobCount={1}
      rail={<aside data-testid="operations-rail">Operations</aside>}
      stage="result"
    >
      <section data-testid="result-hero">Result</section>
    </WorkbenchStageShell>
  );

  assert.match(html, /data-workbench-stage="result"/);
  assert.match(html, /data-testid="result-hero"/);
  assert.doesNotMatch(html, /data-testid="operations-rail"/);
});

test('empty stage keeps the operations rail beside the creation record', () => {
  const html = renderToStaticMarkup(
    <WorkbenchStageShell
      articleLabel="Agent creation record"
      jobCount={0}
      rail={<aside data-testid="operations-rail">Operations</aside>}
      stage="empty"
    >
      <section>Composer</section>
    </WorkbenchStageShell>
  );

  assert.match(html, /data-workbench-stage="empty"/);
  assert.match(html, /data-testid="operations-rail"/);
});
