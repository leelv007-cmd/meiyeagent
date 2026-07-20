import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  p1ModuleRequestSchema,
  requiredP1Capability,
} from '@meiye/contracts';

describe('video regeneration public access contract', () => {
  it('is a registered P1 module with least-privilege actions', () => {
    assert.equal(
      p1ModuleRequestSchema.parse({
        action: 'quote',
        module: 'video-regeneration',
        payload: {},
      }).module,
      'video-regeneration',
    );
    for (const action of ['quote', 'confirm', 'recover', 'retry', 'free_action']) {
      assert.equal(
        requiredP1Capability('command', 'video-regeneration', action),
        'content.create',
      );
    }
    assert.equal(
      requiredP1Capability('query', 'video-regeneration', 'get_task'),
      'workspace.read',
    );
    assert.equal(
      requiredP1Capability('command', 'video-regeneration', 'unknown'),
      null,
    );
  });
});
