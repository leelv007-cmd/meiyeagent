import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runIssue255RecordedCalibration,
} from './issue-255-recorded-calibration.js';
import { assertIssue255RecordedMatrix } from './issue-255-calibration-guard.js';

test('issue 255 recorded runner executes the strict 27-sample matrix with network disabled', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('recorded calibration must not use network');
  };

  try {
    const samples = await runIssue255RecordedCalibration();
    assert.equal(assertIssue255RecordedMatrix(samples).length, 27);
    assert.equal(networkCalls, 0);
    assert.deepEqual(
      samples.reduce(
        (counts, sample) => {
          counts[sample.modality] += 1;
          return counts;
        },
        { copy: 0, image_text: 0, video: 0 },
      ),
      { copy: 9, image_text: 9, video: 9 },
    );
    assert.equal(
      samples
        .filter((sample) => sample.modality === 'copy')
        .every((sample) => sample.observed.iterations === 1),
      true,
      'copy samples must cross the production bounded selection loop once',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
