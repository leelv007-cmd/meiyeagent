import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTE_STYLE_CONFIG_KEY } from '@meiye/contracts';
import {
  ADMIN_CONFIG_KEY_CLASSIFICATION,
  assertAdminConfigKeyConsistency,
  validatePlatformDefaultModel,
} from './domain-rules.js';

const operation = 'copy.generate' as const;
const modelId = 'copy-model';

function validationInput(
  overrides: Partial<Parameters<typeof validatePlatformDefaultModel>[0]> = {}
): Parameters<typeof validatePlatformDefaultModel>[0] {
  return {
    operation,
    modelId,
    models: [{ id: modelId, operations: [operation] }],
    deployments: [
      {
        id: 'deployment-platform',
        catalogModelId: modelId,
        status: 'active',
        credentialMode: 'platform',
        credentialOwner: 'platform',
      },
    ],
    mode: 'live',
    fixtureDefaultModelIds: [],
    configurationRevisions: {
      'deployment-platform': 'configuration-v1',
    },
    async readActivationEvidence() {
      return {
        status: 'live_verified',
        configurationRevision: 'configuration-v1',
        evidenceRef: 'evidence://deployment-platform',
        verifiedAt: '2026-08-05T00:00:00.000Z',
      };
    },
    ...overrides,
  };
}

test('platform default admission requires model operation support', async () => {
  await assert.rejects(
    validatePlatformDefaultModel(
      validationInput({ models: [{ id: modelId, operations: ['image.generate'] }] })
    ),
    /does not support copy\.generate/
  );
});

test('platform default admission ignores inactive and workspace BYOK deployments', async () => {
  await assert.rejects(
    validatePlatformDefaultModel(
      validationInput({
        deployments: [
          {
            id: 'inactive',
            catalogModelId: modelId,
            status: 'inactive',
          },
          {
            id: 'workspace-byok',
            catalogModelId: modelId,
            status: 'active',
            credentialOwner: 'workspace_byok',
          },
        ],
      })
    ),
    /is not live verified/
  );
});

test('platform default admission requires evidence for the active configuration revision', async () => {
  await assert.doesNotReject(
    validatePlatformDefaultModel(validationInput())
  );
  await assert.rejects(
    validatePlatformDefaultModel(
      validationInput({
        async readActivationEvidence() {
          return {
            status: 'live_verified',
            configurationRevision: 'configuration-v0',
            evidenceRef: 'evidence://deployment-platform',
            verifiedAt: '2026-08-05T00:00:00.000Z',
          };
        },
      })
    ),
    /is not live verified/
  );
});

test('fixture admission is limited to configured fixture defaults with an active platform candidate', async () => {
  await assert.doesNotReject(
    validatePlatformDefaultModel(
      validationInput({
        mode: 'fixture',
        fixtureDefaultModelIds: [modelId],
        async readActivationEvidence() {
          return undefined;
        },
      })
    )
  );
  await assert.rejects(
    validatePlatformDefaultModel(
      validationInput({
        mode: 'fixture',
        fixtureDefaultModelIds: [],
        async readActivationEvidence() {
          return undefined;
        },
      })
    ),
    /is not live verified/
  );
});

test('D-116 hot-read keys stay wired and disjoint from read-only keys', () => {
  // Structural completeness only — does not prove any key is consumed at runtime.
  assert.doesNotThrow(() => assertAdminConfigKeyConsistency());
  assert.ok(
    ADMIN_CONFIG_KEY_CLASSIFICATION.hotReadKeys.includes(NOTE_STYLE_CONFIG_KEY)
  );
  assert.ok(
    ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes(NOTE_STYLE_CONFIG_KEY)
  );
  assert.throws(
    () =>
      assertAdminConfigKeyConsistency({
        hotReadKeys: ['drifted.key'],
        wiredKeys: [],
        readOnlyKeys: [],
      }),
    /missing wiring \[drifted\.key\]/
  );
});

// #371 / Spec C: classification wiring is independent of settlement consumption
// proof (that lives on the entitlements payment_grant seam).
test('plan.payment-mapping is classified as wired', () => {
  assert.equal(
    ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes('plan.payment-mapping'),
    true
  );
});
