import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveVideoSceneResults,
  sceneRegenerationEffectSuffix,
  videoFailedSceneLabels,
  videoPartialFailureFixtureKind,
  videoSceneBillableUnits,
  videoSceneDeliveredUsable,
  videoUnresolvedSceneIndexes,
  VIDEO_PARTIAL_FAILURE_CALLED_UNUSABLE_ANCHOR,
  VIDEO_PARTIAL_FAILURE_NOT_CALLED_ANCHOR,
} from './video-scene-execution.js';

test('fixture anchors map to not_called vs called_unusable', () => {
  assert.equal(
    videoPartialFailureFixtureKind(
      `做成抖音成片，加${VIDEO_PARTIAL_FAILURE_NOT_CALLED_ANCHOR}`,
    ),
    'not_called',
  );
  assert.equal(
    videoPartialFailureFixtureKind(
      `重试 ${VIDEO_PARTIAL_FAILURE_CALLED_UNUSABLE_ANCHOR}`,
    ),
    'called_unusable',
  );
  assert.equal(videoPartialFailureFixtureKind('正常成片'), null);
});

test('two_of_three_scenes_delivered: not_called failure bills two units', () => {
  const results = resolveVideoSceneResults({
    sceneCount: 3,
    generationCalled: true,
    generationSucceeded: true,
    fixtureKind: 'not_called',
  });
  assert.equal(videoSceneDeliveredUsable(results), 2);
  assert.equal(videoSceneBillableUnits(results), 2);
  assert.deepEqual(videoUnresolvedSceneIndexes(results), [2]);
  assert.deepEqual(videoFailedSceneLabels(results), ['3']);
  assert.equal(results[2]?.outcome, 'failed_not_called');
});

test('called_unusable failure stays billable while naming the failed scene', () => {
  const results = resolveVideoSceneResults({
    sceneCount: 3,
    generationCalled: true,
    generationSucceeded: true,
    fixtureKind: 'called_unusable',
  });
  assert.equal(videoSceneDeliveredUsable(results), 2);
  assert.equal(videoSceneBillableUnits(results), 3);
  assert.deepEqual(videoFailedSceneLabels(results), ['3']);
  assert.equal(results[2]?.outcome, 'failed_called_unusable');
});

test('scene_retry effect keys are scene-specific (no full double debit key)', () => {
  assert.equal(sceneRegenerationEffectSuffix(undefined), '');
  assert.equal(sceneRegenerationEffectSuffix([]), '');
  assert.equal(sceneRegenerationEffectSuffix([2]), '-scene-retry:2');
  assert.equal(sceneRegenerationEffectSuffix([2, 0, 2]), '-scene-retry:0,2');
  assert.notEqual(
    sceneRegenerationEffectSuffix([2]),
    sceneRegenerationEffectSuffix(undefined),
  );
});

test('full success marks every scene delivered', () => {
  const results = resolveVideoSceneResults({
    sceneCount: 3,
    generationCalled: true,
    generationSucceeded: true,
  });
  assert.equal(videoSceneDeliveredUsable(results), 3);
  assert.equal(videoSceneBillableUnits(results), 3);
  assert.deepEqual(videoUnresolvedSceneIndexes(results), []);
});
