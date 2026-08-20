import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CREDIT_PLAN_CONFIG_KEYS,
  NOTE_STYLE_CONFIG_KEY,
} from '@meiye/contracts';
import type { Pool } from 'pg';
import {
  ADMIN_CONFIG_KEY_CLASSIFICATION,
  assertAdminConfigKeyConsistency,
  createContentPackageWriteOwnershipReader,
  createWriteOwnershipReader,
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

test('D-128 trial switch stays hot-read and writable after plan.addons retirement', () => {
  const readOnlyKeys = ADMIN_CONFIG_KEY_CLASSIFICATION.readOnlyKeys as readonly string[];
  assert.ok(
    ADMIN_CONFIG_KEY_CLASSIFICATION.hotReadKeys.includes('plan.trial.enabled')
  );
  assert.ok(
    ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes('plan.trial.enabled')
  );
  assert.equal(readOnlyKeys.includes('plan.trial.enabled'), false);
  assert.equal(readOnlyKeys.includes('plan.addons'), false);
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

test('agent_semantic_event_adapter_v1 is hot-read and wired (V31-03 shadow gate)', () => {
  assert.ok(
    ADMIN_CONFIG_KEY_CLASSIFICATION.hotReadKeys.includes(
      'agent_semantic_event_adapter_v1',
    ),
  );
  assert.ok(
    ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes(
      'agent_semantic_event_adapter_v1',
    ),
  );
});

test('make.shadow_reconciliation.* keys are hot-read and wired (V31-13)', () => {
  for (const key of [
    'make.shadow_reconciliation.sample_rate',
    'make.shadow_reconciliation.window_days',
  ]) {
    assert.ok(
      ADMIN_CONFIG_KEY_CLASSIFICATION.hotReadKeys.includes(key),
      `missing hot-read classification for ${key}`,
    );
    assert.ok(
      ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes(key),
      `missing wired classification for ${key}`,
    );
  }
});

test('V31-24 goal/proactive flags and kill switch are hot-read and wired', () => {
  for (const key of [
    'marketing_goal_v1',
    'proactive_opportunity_v1',
    'proactive_evidence_coverage_threshold',
    'disable_proactive_agent',
  ] as const) {
    assert.ok(
      ADMIN_CONFIG_KEY_CLASSIFICATION.hotReadKeys.includes(key),
      `${key} should be hot-read`,
    );
    assert.ok(
      ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes(key),
      `${key} should be wired`,
    );
  }
});

test('make_steering_v1 and disable_make_steering are hot-read and wired (V31-16)', () => {
  for (const key of ['make_steering_v1', 'disable_make_steering'] as const) {
    assert.ok(
      ADMIN_CONFIG_KEY_CLASSIFICATION.hotReadKeys.includes(key),
      `${key} missing from hotReadKeys`,
    );
    assert.ok(
      ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes(key),
      `${key} missing from wiredKeys`,
    );
  }
});

// Spec G / #390: plan.credits.* keys come only from @meiye/contracts.
test('credit plan keys include reference_numbers from the contracts authority', () => {
  assert.ok(
    CREDIT_PLAN_CONFIG_KEYS.includes('plan.credits.reference_numbers')
  );
  for (const key of CREDIT_PLAN_CONFIG_KEYS) {
    assert.ok(
      ADMIN_CONFIG_KEY_CLASSIFICATION.hotReadKeys.includes(key),
      `missing hot-read classification for ${key}`
    );
    assert.ok(
      ADMIN_CONFIG_KEY_CLASSIFICATION.wiredKeys.includes(key),
      `missing wired classification for ${key}`
    );
  }
});

test('P1 and ContentPackage ownership readers return null for the same missing row', async () => {
  const pool = {
    async query(_sql: string, params: unknown[]) {
      assert.deepEqual(params, ['workspace-missing']);
      return { rows: [] };
    },
  } as Pick<Pool, 'query'>;
  const p1Reader = createWriteOwnershipReader(pool);
  const contentPackageReader = createContentPackageWriteOwnershipReader(pool);
  assert.equal(await p1Reader('workspace-missing'), null);
  assert.equal(await contentPackageReader('workspace-missing'), null);
});

test('P1 and ContentPackage ownership readers keep explicit rows on separate tables', async () => {
  const pool = {
    async query(sql: string) {
      if (sql.includes('p1_write_ownership')) {
        return { rows: [{ owner: 'p1' }] };
      }
      if (sql.includes('content_package_write_ownership')) {
        return { rows: [{ owner: 'contentpackage' }] };
      }
      return { rows: [] };
    },
  } as Pick<Pool, 'query'>;
  assert.equal(await createWriteOwnershipReader(pool)('workspace-new'), 'p1');
  assert.equal(
    await createContentPackageWriteOwnershipReader(pool)('workspace-new'),
    'contentpackage'
  );
});
