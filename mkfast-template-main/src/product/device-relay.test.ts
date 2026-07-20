import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRelayLocation,
  desktopRelayLanding,
  parseRelayTarget,
  tryBuildRelayLocation,
} from './device-relay';

test('buildRelayLocation round-trips work and package targets', () => {
  const work = buildRelayLocation({
    kind: 'work',
    workId: 'work-1',
    stage: 'progress',
  });
  assert.equal(work.pathname, '/dashboard/');
  assert.deepEqual(work.search, { workId: 'work-1', stage: 'progress' });
  assert.equal(work.pathWithSearch, '/dashboard?workId=work-1&stage=progress');
  assert.deepEqual(parseRelayTarget(work.search), {
    kind: 'work',
    workId: 'work-1',
    stage: 'progress',
  });

  const pack = buildRelayLocation({
    kind: 'package',
    packageId: 'pkg-9',
    stage: 'action',
  });
  assert.equal(pack.pathWithSearch, '/dashboard?packageId=pkg-9&stage=action');
  assert.deepEqual(parseRelayTarget(pack.search), {
    kind: 'package',
    packageId: 'pkg-9',
    stage: 'action',
  });
});

test('buildRelayLocation omits stage when not provided', () => {
  const work = buildRelayLocation({ kind: 'work', workId: 'w2' });
  assert.equal(work.pathWithSearch, '/dashboard?workId=w2');
  assert.deepEqual(parseRelayTarget(work.search), {
    kind: 'work',
    workId: 'w2',
  });
});

test('parseRelayTarget accepts query strings and URLSearchParams', () => {
  assert.deepEqual(parseRelayTarget('packageId=p1&stage=handoff'), {
    kind: 'package',
    packageId: 'p1',
    stage: 'handoff',
  });
  assert.deepEqual(
    parseRelayTarget(new URLSearchParams('workId=w9&stage=action')),
    { kind: 'work', workId: 'w9', stage: 'action' }
  );
});

test('buildRelayLocation rejects empty ids and unknown kinds', () => {
  assert.throws(() => buildRelayLocation({ kind: 'work', workId: '' }));
  assert.throws(() =>
    buildRelayLocation({ kind: 'package', packageId: '   ' })
  );
  assert.equal(
    tryBuildRelayLocation({ kind: 'handoff', token: 'x' }),
    undefined
  );
  assert.equal(tryBuildRelayLocation({ kind: 'work' }), undefined);
  assert.equal(tryBuildRelayLocation(null), undefined);
});

test('parseRelayTarget rejects empty and unknown shapes', () => {
  assert.equal(parseRelayTarget({}), undefined);
  assert.equal(parseRelayTarget({ stage: 'action' }), undefined);
  assert.equal(parseRelayTarget({ workId: '' }), undefined);
  assert.equal(
    parseRelayTarget({ packageId: '', stage: 'progress' }),
    undefined
  );
  assert.deepEqual(parseRelayTarget({ workId: 'w', stage: 'nope' }), {
    kind: 'work',
    workId: 'w',
  });
});

test('desktopRelayLanding sends package relays to content detail', () => {
  assert.deepEqual(desktopRelayLanding({ packageId: 'pkg-1' }), {
    contentId: 'pkg-1',
  });
  assert.equal(
    desktopRelayLanding({ workId: 'w1', packageId: 'pkg-1' }),
    undefined
  );
  assert.equal(desktopRelayLanding({}), undefined);
  assert.equal(desktopRelayLanding({ packageId: '  ' }), undefined);
});
