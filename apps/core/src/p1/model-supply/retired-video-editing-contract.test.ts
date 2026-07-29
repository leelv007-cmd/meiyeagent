import assert from 'node:assert/strict';
import test from 'node:test';
import {
  p1ModuleRequestSchema,
  requiredP1Capability,
  type P1Module,
} from '@meiye/contracts';

test('D-133 rejects the retired video regeneration module at the public boundary', () => {
  const parsed = p1ModuleRequestSchema.safeParse({
    action: 'quote',
    module: 'video-regeneration',
    payload: {},
  });

  assert.equal(parsed.success, false);
  assert.equal(
    requiredP1Capability(
      'command',
      'video-regeneration' as P1Module,
      'quote',
    ),
    null,
  );
});
