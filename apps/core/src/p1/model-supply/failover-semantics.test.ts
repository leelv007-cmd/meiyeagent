import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelCapabilityProfile } from '@meiye/contracts';
import {
  evaluateModelFailover,
  type ModelFailoverCandidate,
} from './failover-semantics.js';

const capabilityProfile = (
  status: 'supported' | 'unsupported' | 'unknown',
  channelBound = false,
): ModelCapabilityProfile => ({
  vocabularyVersion: 'model-capability-v1',
  protocolCapabilities: {},
  modalities: [],
  businessTags: [],
  modalityCapabilities: [
    {
      modality: 'image/*',
      capability: 'cjk-text-render',
      supported: status === 'supported',
      channelBound,
      basis: status === 'unknown' ? 'inferred' : 'explicit_override',
      evidenceRef: `test:${status}`,
    },
  ],
});

function candidate(
  overrides: Partial<ModelFailoverCandidate>,
): ModelFailoverCandidate {
  return {
    catalogModelId: 'model-a',
    deploymentId: 'deployment-a',
    executionChannelId: 'channel-a',
    providerProfileId: 'provider-a',
    priceRevision: 'price-a',
    capabilityProfile: capabilityProfile('supported'),
    ...overrides,
  };
}

test('same-model channel failover emits a billing event with the new channel price revision', () => {
  const result = evaluateModelFailover({
    from: candidate({}),
    to: candidate({
      deploymentId: 'deployment-b',
      executionChannelId: 'channel-b',
      priceRevision: 'price-b',
    }),
  });

  assert.equal(result.allowed, true);
  if (!result.allowed) return;
  assert.deepEqual(result.event, {
    kind: 'same_model_channel',
    fromCatalogModelId: 'model-a',
    toCatalogModelId: 'model-a',
    fromDeploymentId: 'deployment-a',
    toDeploymentId: 'deployment-b',
    fromExecutionChannelId: 'channel-a',
    toExecutionChannelId: 'channel-b',
    fromPriceRevision: 'price-a',
    toPriceRevision: 'price-b',
    degradationSurfaces: [],
  });
});

test('failover requires two explicit execution channels', () => {
  for (const [fromChannel, toChannel] of [
    [undefined, 'channel-b'],
    ['channel-a', undefined],
    ['', 'channel-b'],
  ] as const) {
    assert.deepEqual(
      evaluateModelFailover({
        from: candidate({ executionChannelId: fromChannel }),
        to: candidate({
          deploymentId: 'deployment-b',
          executionChannelId: toChannel,
          priceRevision: 'price-b',
        }),
      }),
      {
        allowed: false,
        reason: 'execution_channel_unknown',
      },
    );
  }
});

test('model substitution requires declared degradation surfaces', () => {
  const rejected = evaluateModelFailover({
    from: candidate({}),
    to: candidate({
      catalogModelId: 'model-b',
      deploymentId: 'deployment-b',
      executionChannelId: 'channel-b',
      priceRevision: 'price-b',
    }),
  });
  assert.deepEqual(rejected, {
    allowed: false,
    reason: 'model_substitution_degradation_undeclared',
  });

  const allowed = evaluateModelFailover({
    from: candidate({}),
    to: candidate({
      catalogModelId: 'model-b',
      deploymentId: 'deployment-b',
      executionChannelId: 'channel-a',
      priceRevision: 'price-b',
    }),
    degradationSurfaces: ['tone_consistency'],
  });
  assert.equal(allowed.allowed, true);
  if (!allowed.allowed) return;
  assert.equal(allowed.event.kind, 'model_substitution');
  assert.deepEqual(allowed.event.degradationSurfaces, ['tone_consistency']);
});

test('cross-provider failover rejects a missing channel-bound equivalent and accepts an equivalent substitute', () => {
  const from = candidate({
    capabilityProfile: capabilityProfile('supported', true),
  });
  const unused = evaluateModelFailover({
    from,
    to: candidate({
      providerProfileId: 'provider-b',
      executionChannelId: 'channel-b',
      capabilityProfile: capabilityProfile('unknown'),
    }),
  });
  assert.equal(unused.allowed, true);

  const rejected = evaluateModelFailover({
    from,
    to: candidate({
      providerProfileId: 'provider-b',
      executionChannelId: 'channel-b',
      capabilityProfile: capabilityProfile('unknown'),
    }),
    usedCapabilityIds: ['image/*:cjk-text-render'],
  });
  assert.deepEqual(rejected, {
    allowed: false,
    reason: 'channel_bound_capability_not_equivalent',
    capabilityAxisIds: ['image/*:cjk-text-render'],
  });

  const allowed = evaluateModelFailover({
    from,
    to: candidate({
      providerProfileId: 'provider-b',
      executionChannelId: 'channel-b',
      capabilityProfile: capabilityProfile('supported', true),
    }),
    usedCapabilityIds: ['image/*:cjk-text-render'],
  });
  assert.equal(allowed.allowed, true);

  const unknownProvider = evaluateModelFailover({
    from: {
      ...from,
      providerProfileId: null,
    },
    to: candidate({
      executionChannelId: 'channel-b',
      providerProfileId: null,
      capabilityProfile: capabilityProfile('unknown'),
    }),
    usedCapabilityIds: ['image/*:cjk-text-render'],
  });
  assert.deepEqual(unknownProvider, {
    allowed: false,
    reason: 'channel_bound_capability_not_equivalent',
    capabilityAxisIds: ['image/*:cjk-text-render'],
  });
});
