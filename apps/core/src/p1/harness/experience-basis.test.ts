import assert from 'node:assert/strict';
import test from 'node:test';

import { contextBundleSchema } from '@meiye/contracts';
import { projectHarnessExperienceBasis } from './experience-basis.js';

test('projects only resolved confirmed preferences from a frozen bundle', () => {
  const bundle = contextBundleSchema.parse({
    serializerVersion: 'context-bundle-c14n-v1',
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    sourceRevisions: {
      facts: 0,
      assets: 0,
      identity: 1,
      rights: 0,
      preferences: 2,
      recipe: 0,
      platformRules: 0,
      currentSignal: 1,
    },
    dimensions: {
      promotion_task: {
        preference_cta: {
          value: { cta: '先讲问题，再邀请私信' },
          layer: 'confirmed_preference',
          pool: 'store_personal',
          sourceRef: 'preference:cta:r2',
        },
      },
      traffic_opportunity: {},
      expression_identity: {
        selected_identity: {
          value: { displayName: '主理人口吻' },
          layer: 'confirmed_asset',
          pool: 'store_personal',
          sourceRef: 'marketing_identity:owner:3',
        },
        preference_tone: {
          value: '少促销感',
          layer: 'confirmed_preference',
          pool: 'store_personal',
          sourceRef: 'preference:tone:r1',
        },
      },
      platform_mechanism: {},
      store_facts_assets: {},
      conversion_action: {},
    },
    referencedFactRevisions: [],
    bundleId: 'bundle-task-a',
    revision: 3,
    hash: 'a'.repeat(64),
    frozenAt: '2026-08-02T01:00:00.000Z',
    frozenBy: 'owner-a',
    previousRevision: 2,
  });

  assert.deepEqual(projectHarnessExperienceBasis(bundle), {
    taskId: 'task-a',
    contextBundleId: 'bundle-task-a',
    contextBundleRevision: 3,
    confirmedPreferences: [
      {
        sourceRef: 'preference:cta:r2',
        label: '先讲问题，再邀请私信',
        value: { cta: '先讲问题，再邀请私信' },
      },
      {
        sourceRef: 'preference:tone:r1',
        label: '少促销感',
        value: '少促销感',
      },
    ],
  });
});
