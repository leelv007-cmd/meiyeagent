import assert from 'node:assert/strict';
import test from 'node:test';

import { artifactContentCarrierOf } from './artifact-carrier';

test('copy|note|media carriers cover copy/note/image/video product paths', () => {
  assert.equal(artifactContentCarrierOf('copy'), 'copy');
  assert.equal(artifactContentCarrierOf('note'), 'note');
  assert.equal(artifactContentCarrierOf('image'), 'media');
  assert.equal(artifactContentCarrierOf('video'), 'media');
  assert.equal(artifactContentCarrierOf('plan'), null);
  assert.equal(artifactContentCarrierOf('publish'), null);
});
