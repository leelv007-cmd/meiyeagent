import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  WorkbenchComposerAxis,
  WorkbenchPrimarySurface,
  WorkbenchStageShell,
  WorkbenchStatusStrip,
} from './workbench-stage-shell';

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

test('stage regions expose primary gravity, status strip, and composer axis hooks', () => {
  const html = renderToStaticMarkup(
    <WorkbenchStageShell
      articleLabel="Agent creation record"
      jobCount={1}
      rail={<aside>Operations</aside>}
      stage="running"
    >
      <WorkbenchPrimarySurface sticky>
        <section data-testid="generation-primary">Generating</section>
      </WorkbenchPrimarySurface>
      <WorkbenchStatusStrip>
        <span data-testid="status-line">Running</span>
      </WorkbenchStatusStrip>
      <WorkbenchComposerAxis sticky>
        <section data-testid="composer-axis">Composer</section>
      </WorkbenchComposerAxis>
    </WorkbenchStageShell>
  );

  assert.match(html, /data-workbench-primary=""/);
  assert.match(html, /data-workbench-status-strip=""/);
  assert.match(html, /data-workbench-composer-axis=""/);
  assert.match(html, /data-testid="generation-primary"/);
  assert.match(html, /xl:sticky xl:top-4/);
  assert.match(html, /data-testid="status-line"/);
  assert.match(html, /data-testid="composer-axis"/);
  assert.doesNotMatch(html, />Operations</);
});
