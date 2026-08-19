import assert from 'node:assert/strict';
import test from 'node:test';

import {
  identifiers,
  jsxOf,
  literals,
  parseProductionSource,
  parseSourceText,
} from '../../test-support/ast-boundary';

const page = parseProductionSource(
  new URL('./result-center-page.tsx', import.meta.url)
);

test('an E3 stub in Result Center fails the video worksurface boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.tsx',
    'export function Page() { return <div data-testid="result-video-workspace-stub">视频工作面将由 E3 接入</div>; }'
  );
  assert.ok(literals(preFix).includes('result-video-workspace-stub'));
});

test('Result Center mounts the video worksurface and has no E3 stub', () => {
  assert.ok(jsxOf(page, 'VideoWorksurface').length >= 1);
  assert.ok(identifiers(page).has('videoWorksurface'));
  assert.equal(literals(page).includes('result-video-workspace-stub'), false);
  assert.equal(literals(page).includes('视频工作面将由 E3 接入'), false);
});

test('Result Center retains receiver actions without regeneration controls', () => {
  assert.equal(identifiers(page).has('onRequestRegenerationQuote'), false);
  assert.equal(identifiers(page).has('onConfirmRegeneration'), false);
  assert.ok(identifiers(page).has('onCanonicalEdit'));
});
