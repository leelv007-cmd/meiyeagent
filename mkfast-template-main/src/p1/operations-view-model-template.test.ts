import assert from 'node:assert/strict';
import test from 'node:test';

import { templateViews, type RawTemplate } from './operations-view-model';

function template(family: string): RawTemplate {
  return {
    enabledVersionId: `version-${family}`,
    family,
    id: `template-${family}`,
    name: family,
    publicationStatus: 'enabled',
    tags: ['官方', '门店'],
  };
}

test('official named presets have one deterministic input contract', () => {
  const [storeIntro, beforeAfter, unknown] = templateViews(
    [template('store_intro'), template('before_after'), template('unknown')],
    [],
    []
  );

  assert.match(storeIntro?.inputGuide ?? '', /1 张.*店/);
  assert.match(beforeAfter?.inputGuide ?? '', /前.*后.*各 1 张/);
  assert.ok(storeIntro?.internalIntent);
  assert.deepEqual(storeIntro?.defaultContentModules, [
    'store_intro',
    'social_cover',
  ]);
  assert.equal(unknown?.inputGuide, undefined);
  assert.equal(unknown?.internalIntent, undefined);
  assert.deepEqual(storeIntro?.tags, ['官方', '门店']);
});

test('user templates never silently become prompt-free named presets', () => {
  const [view] = templateViews(
    [],
    [
      {
        canvasRevisionId: 'revision-a',
        id: 'user-template',
        name: '我的模板',
        sourceWorkId: 'work-a',
      },
    ],
    []
  );
  assert.equal(view?.inputGuide, undefined);
  assert.equal(view?.internalIntent, undefined);
  assert.equal(view?.defaultContentModules, undefined);
});

test('template thumbnail projection keeps only same-origin or https media', () => {
  const unsafe = template('store_intro');
  unsafe.thumbnailUrl = 'javascript:alert(1)';
  const safe = template('before_after');
  safe.thumbnailUrl = '/api/storage/file?key=preview-a';
  const [unsafeView, safeView] = templateViews([unsafe, safe], [], []);
  assert.equal(unsafeView?.thumbnailUrl, undefined);
  assert.equal(safeView?.thumbnailUrl, '/api/storage/file?key=preview-a');
});
