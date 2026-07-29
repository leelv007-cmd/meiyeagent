import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const page = readFileSync(
  fileURLToPath(new URL('./result-center-page.tsx', import.meta.url)),
  'utf8'
);
const route = readFileSync(
  fileURLToPath(
    new URL('../../routes/dashboard/results_/$workId.tsx', import.meta.url)
  ),
  'utf8'
);

test('Result Center mounts the video worksurface and has no E3 stub', () => {
  assert.match(page, /<VideoWorksurface/);
  assert.match(page, /videoWorksurface/);
  assert.doesNotMatch(page, /result-video-workspace-stub/);
  assert.doesNotMatch(page, /视频工作面将由 E3 接入/);
});

test('production Result route wires retained receiver actions without regeneration', () => {
  assert.doesNotMatch(page, /onRequestRegenerationQuote/);
  assert.doesNotMatch(page, /onConfirmRegeneration/);
  assert.match(page, /onCanonicalEdit/);
  assert.doesNotMatch(route, /onVideoRequestRegenerationQuote/);
  assert.doesNotMatch(route, /'video-regeneration'/);
  assert.match(route, /action: 'video_workflow_edit'/);
  assert.doesNotMatch(
    route,
    /acceptanceUnknown =\s*workspaceKind !== 'video'/s
  );
  assert.match(route, /action: 'resume_creative_job'/);
  assert.match(route, /acceptanceUnknown,/);
});
