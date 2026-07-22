import assert from 'node:assert/strict';
import test from 'node:test';

import {
  answerProgressiveFact,
  buildConfirmStoreCommand,
  createProgressiveFactDraft,
  nextGroundingFactFocus,
  projectProgressiveFactView,
  skipProgressiveFact,
} from './progressive-fact';

test('asks one blocking store fact at a time before skippable fields', () => {
  let draft = createProgressiveFactDraft();
  let view = projectProgressiveFactView(draft);
  assert.equal(view.current?.id, 'name');
  assert.equal(view.current?.criticality, 'blocking');
  assert.equal(view.readyToConfirm, false);

  draft = answerProgressiveFact(draft, 'name', '青禾美甲');
  draft = answerProgressiveFact(draft, 'city', '杭州');
  draft = answerProgressiveFact(draft, 'projectName', '透亮猫眼');
  view = projectProgressiveFactView(draft);
  assert.equal(view.current?.id, 'projectPrice');

  draft = answerProgressiveFact(draft, 'projectPrice', '299');
  view = projectProgressiveFactView(draft);
  assert.equal(view.readyToConfirm, true);
  assert.equal(view.current?.id, 'district');
  assert.equal(view.current?.criticality, 'skippable');
});

test('non-critical facts can skip with safe fallback and impact note', () => {
  let draft = createProgressiveFactDraft({
    name: '青禾美甲',
    city: '杭州',
    projectName: '透亮猫眼',
    projectPrice: '299',
  });
  const blocked = skipProgressiveFact(draft, 'name');
  assert.equal(blocked, null);

  const skipped = skipProgressiveFact(draft, 'district');
  assert.ok(skipped);
  draft = skipped!;
  assert.equal(draft.district, '本区');
  assert.deepEqual(draft.skipped, ['district']);
  const view = projectProgressiveFactView(draft);
  assert.ok(
    view.skipImpacts.some(
      (item) => item.includes('本区') || item.includes('同城')
    )
  );
});

test('buildConfirmStoreCommand uses the same confirm_store contract', () => {
  let draft = createProgressiveFactDraft({
    name: '青禾美甲',
    city: '杭州',
    projectName: '透亮猫眼',
    projectPrice: '299',
  });
  draft = skipProgressiveFact(draft, 'district')!;
  draft = skipProgressiveFact(draft, 'address')!;
  draft = skipProgressiveFact(draft, 'booking')!;
  draft = skipProgressiveFact(draft, 'brandVoice')!;

  const command = buildConfirmStoreCommand(draft);
  assert.ok(command);
  assert.equal(command?.type, 'confirm_store');
  if (command?.type !== 'confirm_store') return;
  assert.equal(command.store.name, '青禾美甲');
  assert.equal(command.store.city, '杭州');
  assert.equal(command.store.district, '本区');
  assert.equal(command.store.address, '门店地址待补充');
  assert.equal(command.store.projects[0]?.confirmed, true);
  assert.equal(command.store.projects[0]?.price, 299);
  assert.equal(command.store.regulated, false);
});

test('next grounding focus prefers store then project', () => {
  assert.equal(
    nextGroundingFactFocus({ storeConfirmed: false, projectConfirmed: false }),
    'name'
  );
  assert.equal(
    nextGroundingFactFocus({ storeConfirmed: true, projectConfirmed: false }),
    'projectName'
  );
  assert.equal(
    nextGroundingFactFocus({ storeConfirmed: true, projectConfirmed: true }),
    null
  );
});
