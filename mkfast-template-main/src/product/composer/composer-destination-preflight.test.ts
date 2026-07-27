import assert from 'node:assert/strict';
import test from 'node:test';

import {
  composerIntentMentionsDestination,
  decideComposerDestinationPreflight,
} from './composer-destination-preflight';

const mapped = {
  contentPackagePlatform: 'xiaohongshu' as const,
  distributionTarget: 'manual_copy' as const,
  status: 'mapped' as const,
};

test('a user-confirmed destination skips natural-language mapping', () => {
  assert.deepEqual(
    decideComposerDestinationPreflight({
      hasExplicitDestination: true,
      intent: '发到抖音',
      state: null,
    }),
    { kind: 'continue' }
  );
});

test('only merchant sentences that mention a destination enter mapping', () => {
  assert.equal(
    composerIntentMentionsDestination('写一条周末到店的团购活动文案'),
    false
  );
  assert.equal(
    composerIntentMentionsDestination('写一条朋友圈护理服务文案'),
    true
  );
  assert.deepEqual(
    decideComposerDestinationPreflight({
      hasExplicitDestination: false,
      intent: '写一条周末到店的团购活动文案',
      state: null,
    }),
    { kind: 'continue' }
  );
});

test('an unmapped or changed destination sentence must be mapped before submission', () => {
  assert.deepEqual(
    decideComposerDestinationPreflight({
      hasExplicitDestination: false,
      intent: '发到小红书',
      state: null,
    }),
    { destination: '发到小红书', kind: 'map' }
  );
  assert.deepEqual(
    decideComposerDestinationPreflight({
      hasExplicitDestination: false,
      intent: '改成发到视频号',
      state: { intent: '发到小红书', result: mapped },
    }),
    { destination: '改成发到视频号', kind: 'map' }
  );
});

test('a mapped pair continues but a clarification blocks submission', () => {
  assert.deepEqual(
    decideComposerDestinationPreflight({
      hasExplicitDestination: false,
      intent: '发到小红书',
      state: { intent: '发到小红书', result: mapped },
    }),
    { kind: 'continue' }
  );

  const clarification = {
    options: [
      {
        contentPackagePlatform: 'douyin' as const,
        distributionTarget: 'manual_copy' as const,
        label: '抖音，生成后手动复制',
      },
    ],
    question: '准备发到哪里，生成后希望怎么交付？',
    status: 'needs_clarification' as const,
  };
  assert.deepEqual(
    decideComposerDestinationPreflight({
      hasExplicitDestination: false,
      intent: '做一条活动文案',
      state: { intent: '做一条活动文案', result: clarification },
    }),
    { kind: 'block', result: clarification }
  );
});
