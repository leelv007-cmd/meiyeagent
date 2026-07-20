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

test('Z1: official templates no longer inject named-preset contracts', () => {
  const [storeIntro, beforeAfter, unknown] = templateViews(
    [template('store_intro'), template('before_after'), template('unknown')],
    [],
    []
  );

  assert.equal(storeIntro?.inputGuide, undefined);
  assert.equal(
    storeIntro?.[('internal' + 'Intent') as keyof typeof storeIntro],
    undefined
  );
  assert.equal(storeIntro?.defaultContentModules, undefined);
  assert.equal(
    beforeAfter?.[('internal' + 'Intent') as keyof typeof beforeAfter],
    undefined
  );
  assert.equal(unknown?.inputGuide, undefined);
  assert.equal(
    unknown?.[('internal' + 'Intent') as keyof typeof unknown],
    undefined
  );
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
  assert.equal(view?.[('internal' + 'Intent') as keyof typeof view], undefined);
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
