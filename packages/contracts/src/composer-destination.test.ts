import assert from 'node:assert/strict';
import test from 'node:test';

import { composerDestinationMappingSchema } from './composer-destination.js';

const mappedWire =
  '{"contentPackagePlatform":"xiaohongshu","distributionTarget":"manual_copy","status":"mapped"}';
const clarificationWire =
  '{"options":[{"contentPackagePlatform":"wechat_moments","distributionTarget":"assisted_handoff","label":"朋友圈，交给同事协助发布"}],"question":"要发到朋友圈并交给同事协助吗？","status":"needs_clarification"}';

test('composer destination mapped response preserves its golden wire shape', () => {
  const parsed = composerDestinationMappingSchema.parse(JSON.parse(mappedWire));

  assert.equal(JSON.stringify(parsed), mappedWire);
});

test('composer destination clarification preserves its golden wire shape', () => {
  const parsed = composerDestinationMappingSchema.parse(
    JSON.parse(clarificationWire),
  );

  assert.equal(JSON.stringify(parsed), clarificationWire);
});

test('composer destination wire contract rejects unknown response fields', () => {
  assert.equal(
    composerDestinationMappingSchema.safeParse({
      ...JSON.parse(mappedWire),
      automaticPublish: true,
    }).success,
    false,
  );
});
