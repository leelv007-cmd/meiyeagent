/**
 * Dataset freeze contract tests (V31-23 / U3).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFrozenEvalDataset,
  listFrozenEvalDatasets,
  projectDatasetFreezeAudit,
} from './datasets.js';

test('L1 datasets freeze revision/source/license and are listable', () => {
  const all = listFrozenEvalDatasets();
  assert.ok(all.length >= 3);
  for (const dataset of all) {
    const audit = projectDatasetFreezeAudit(dataset);
    assert.ok(audit.revision.length > 0);
    assert.ok(audit.license.length > 0);
    assert.ok(
      audit.source === 'fixture' || audit.source === 'desensitized_history',
    );
    assert.equal(dataset.cases.length, dataset.manifest.caseIds.length);
  }
});

test('getFrozenEvalDataset resolves by id+revision', () => {
  const hit = getFrozenEvalDataset('l1-intent-baseline', 'l1-intent@1');
  assert.ok(hit);
  assert.equal(hit.manifest.node, 'intent');
  assert.equal(getFrozenEvalDataset('l1-intent-baseline', 'nope'), null);
});

test('desensitized history samples never carry unredacted phone shapes', () => {
  const sample = getFrozenEvalDataset('l1-make-desensitized-sample');
  assert.ok(sample);
  assert.equal(sample.manifest.source, 'desensitized_history');
  const serialized = JSON.stringify(sample.cases);
  assert.equal(/\b1[3-9]\d{9}\b/u.test(serialized), false);
});
