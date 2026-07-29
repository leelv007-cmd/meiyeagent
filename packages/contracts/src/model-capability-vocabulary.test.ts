import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MODEL_CAPABILITY_VOCABULARY_VERSION,
  modelCapabilityProfileSchema,
  modelCapabilityRequirementAxisSchema,
  type SupplyDeployment,
} from './supply-registry.js';

const evidence = {
  basis: 'inferred' as const,
  evidenceRef: 'catalog://capabilities/model-capability-v1',
};

describe('model capability vocabulary v1', () => {
  it('represents protocol, MIME, open business-tag, and channel-bound modality claims', () => {
    const profile = modelCapabilityProfileSchema.parse({
      vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
      protocolCapabilities: {
        'structured-output': { value: true, ...evidence },
        'tool-calling': {
          value: false,
          basis: 'explicit_override',
          evidenceRef: 'operator://overrides/tool-calling',
        },
      },
      modalities: [
        { mime: 'text/plain', supported: true, ...evidence },
        {
          mime: 'image/*',
          supported: true,
          basis: 'explicit_override',
          evidenceRef: 'operator://overrides/image-input',
        },
      ],
      businessTags: [
        {
          tag: 'merchant-defined-beauty-workflow',
          supported: true,
          ...evidence,
        },
      ],
      modalityCapabilities: [
        {
          modality: 'image/*',
          capability: 'cjk-text-render',
          supported: true,
          channelBound: true,
          basis: 'explicit_override',
          evidenceRef: 'conformance://image/cjk-text-render',
        },
      ],
    });

    assert.equal(
      profile.protocolCapabilities['structured-output']?.value,
      true,
    );
    assert.equal(profile.protocolCapabilities['tool-calling']?.value, false);
    assert.equal(
      profile.protocolCapabilities['vision-input'],
      undefined,
      'a missing claim remains unknown instead of becoming false',
    );
    assert.equal(profile.businessTags[0]?.tag, 'merchant-defined-beauty-workflow');
    assert.deepEqual(profile.modalityCapabilities[0], {
      modality: 'image/*',
      capability: 'cjk-text-render',
      supported: true,
      channelBound: true,
      basis: 'explicit_override',
      evidenceRef: 'conformance://image/cjk-text-render',
    });
  });

  it('requires basis and evidence on every atomic claim', () => {
    const base = {
      vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
      protocolCapabilities: {},
      modalities: [],
      businessTags: [],
      modalityCapabilities: [],
    };

    assert.equal(
      modelCapabilityProfileSchema.safeParse({
        ...base,
        protocolCapabilities: {
          'structured-output': { value: true },
        },
      }).success,
      false,
    );
    assert.equal(
      modelCapabilityProfileSchema.safeParse({
        ...base,
        modalities: [
          {
            mime: 'image/*',
            supported: true,
            basis: 'inferred',
          },
        ],
      }).success,
      false,
    );
    assert.equal(
      modelCapabilityProfileSchema.safeParse({
        ...base,
        businessTags: [
          {
            tag: 'open-business-tag',
            supported: true,
            evidenceRef: 'catalog://business-tags/open-business-tag',
          },
        ],
      }).success,
      false,
    );
    assert.equal(
      modelCapabilityProfileSchema.safeParse({
        ...base,
        modalityCapabilities: [
          {
            modality: 'image/*',
            capability: 'cjk-text-render',
            supported: true,
            channelBound: true,
            basis: 'inferred',
          },
        ],
      }).success,
      false,
    );
  });

  it('accepts only a flat requirement axis with the conservative unknown policy', () => {
    const axis = {
      axisId: 'briefImage',
      vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
      requiredProtocolCapabilities: ['structured-output'],
      requiredModalities: ['image/*'],
      requiredBusinessTags: ['merchant-defined-beauty-workflow'],
      requiredModalityCapabilities: [
        {
          modality: 'image/*',
          capability: 'cjk-text-render',
        },
      ],
      unknownPolicy: 'conservative_always_available',
    } as const;

    assert.deepEqual(modelCapabilityRequirementAxisSchema.parse(axis), axis);
    for (const forbidden of ['allOf', 'anyOf', 'not'] as const) {
      assert.equal(
        modelCapabilityRequirementAxisSchema.safeParse({
          ...axis,
          [forbidden]: [],
        }).success,
        false,
        `${forbidden} must not introduce a general capability algebra`,
      );
    }
    assert.equal(
      modelCapabilityRequirementAxisSchema.safeParse({
        ...axis,
        unknownPolicy: 'assume_supported',
      }).success,
      false,
    );
  });

  it('lets a SupplyDeployment optionally bind the versioned profile', () => {
    const capabilityProfile = modelCapabilityProfileSchema.parse({
      vocabularyVersion: MODEL_CAPABILITY_VOCABULARY_VERSION,
      protocolCapabilities: {},
      modalities: [],
      businessTags: [],
      modalityCapabilities: [
        {
          modality: 'image/*',
          capability: 'cjk-text-render',
          supported: true,
          channelBound: true,
          ...evidence,
        },
      ],
    });
    const deployment = {
      id: 'deployment-image-cjk',
      catalogModelId: 'model-image-cjk',
      providerProfileId: 'provider-image',
      executionChannelId: 'channel-image',
      lifecycleStatus: 'active',
      revisionId: 'deployment-image-cjk-r1',
      capabilityProfile,
    } satisfies SupplyDeployment;

    assert.equal(
      deployment.capabilityProfile.vocabularyVersion,
      MODEL_CAPABILITY_VOCABULARY_VERSION,
    );
  });
});
