/**
 * Characterization tests freezing planModelSupplyCandidates behavior (G4).
 * Do not change expectations here without an intentional planning contract change.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planModelSupplyCandidates,
  deploymentAllowsDataClass,
} from '../model-supply/route-planning.js';
import type { CatalogModel, ModelDeployment } from '../model-supply/supply-contracts.js';

const models: CatalogModel[] = [
  {
    id: 'copy-quality',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: '文案质量优先',
    qualityRank: 90,
  },
  {
    id: 'copy-anthropic',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Anthropic Direct',
    qualityRank: 85,
  },
  {
    id: 'copy-gemini',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Gemini Direct',
    qualityRank: 80,
  },
  {
    id: 'copy-domestic',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: '国内文案',
    qualityRank: 70,
  },
  {
    id: 'llm-custom',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: '自定义供应商',
    qualityRank: 0,
  },
  {
    id: 'gpt-image-2',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    displayName: 'GPT Image 2',
    qualityRank: 90,
  },
];

const deployments: ModelDeployment[] = [
  {
    id: 'openai-direct',
    catalogModelId: 'copy-quality',
    apiFamily: 'openai',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'anthropic-direct',
    catalogModelId: 'copy-anthropic',
    apiFamily: 'anthropic',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'gemini-direct',
    catalogModelId: 'copy-gemini',
    apiFamily: 'gemini',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'qwen-direct',
    catalogModelId: 'copy-domestic',
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
  },
  {
    id: 'custom-direct',
    catalogModelId: 'llm-custom',
    apiFamily: 'custom',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'gpt-image-2-recorded',
    catalogModelId: 'gpt-image-2',
    apiFamily: 'openai',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'inactive-direct',
    catalogModelId: 'copy-gemini',
    apiFamily: 'gemini',
    channel: 'direct',
    region: 'overseas',
    status: 'inactive',
  },
];

function catalog() {
  return {
    modelById: new Map(models.map((model) => [model.id, model])),
    deployments,
  };
}

test('characterization: auto ranks eligible candidates by qualityRank descending', () => {
  const plan = planModelSupplyCandidates({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
  });
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.deployment.id),
    ['openai-direct', 'anthropic-direct', 'gemini-direct', 'qwen-direct'],
  );
  assert.equal(
    plan.candidateEvaluations.find((e) => e.deploymentId === 'custom-direct')
      ?.exclusionReasons.includes('custom_requires_fixed_selection'),
    true,
  );
  assert.equal(
    plan.candidateEvaluations.find((e) => e.deploymentId === 'inactive-direct')
      ?.exclusionReasons.includes('deployment_inactive'),
    true,
  );
});

test('characterization: fixed selection excludes other catalog models', () => {
  const plan = planModelSupplyCandidates({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-anthropic' },
    dataClass: [],
  });
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.deployment.id),
    ['anthropic-direct'],
  );
  assert.equal(
    plan.candidateEvaluations.find((e) => e.deploymentId === 'openai-direct')
      ?.exclusionReasons.includes('fixed_model_mismatch'),
    true,
  );
});

test('characterization: data_class_disallowed excludes overseas face content', () => {
  const plan = planModelSupplyCandidates({
    catalog: catalog(),
    operation: 'image.generate',
    selection: { mode: 'fixed', catalogModelId: 'gpt-image-2' },
    dataClass: ['contains_face'],
  });
  assert.equal(plan.candidates.length, 0);
  assert.equal(
    plan.candidateEvaluations
      .find((e) => e.deploymentId === 'gpt-image-2-recorded')
      ?.exclusionReasons.includes('data_class_disallowed'),
    true,
  );
  assert.equal(
    deploymentAllowsDataClass(
      deployments.find((d) => d.id === 'gpt-image-2-recorded')!,
      ['contains_face'],
    ),
    false,
  );
  assert.equal(
    deploymentAllowsDataClass(
      deployments.find((d) => d.id === 'qwen-direct')!,
      ['contains_face'],
    ),
    true,
  );
});

test('characterization: simulated_unavailable is an evaluation-only exclusion', () => {
  const plan = planModelSupplyCandidates({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    unavailableDeploymentIds: ['openai-direct'],
  });
  assert.equal(plan.candidates[0]?.deployment.id, 'anthropic-direct');
  assert.deepEqual(
    plan.candidateEvaluations.find((e) => e.deploymentId === 'openai-direct')
      ?.exclusionReasons,
    ['simulated_unavailable'],
  );
});

test('characterization: missing model and unsupported operation are hard exclusions', () => {
  const orphan: ModelDeployment = {
    id: 'orphan-direct',
    catalogModelId: 'missing-model',
    apiFamily: 'openai',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  };
  const plan = planModelSupplyCandidates({
    catalog: {
      modelById: new Map(models.map((model) => [model.id, model])),
      deployments: [...deployments, orphan],
    },
    operation: 'video.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
    dataClass: [],
  });
  assert.equal(
    plan.candidateEvaluations
      .find((e) => e.deploymentId === 'orphan-direct')
      ?.exclusionReasons.includes('catalog_model_missing'),
    true,
  );
  assert.equal(
    plan.candidateEvaluations
      .find((e) => e.deploymentId === 'openai-direct')
      ?.exclusionReasons.includes('operation_unsupported'),
    true,
  );
});

test('characterization: recorded cost estimates stay modality-stable', () => {
  const copy = planModelSupplyCandidates({
    catalog: catalog(),
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
    dataClass: [],
  });
  assert.deepEqual(copy.candidateEvaluations[0]?.costEstimate, {
    amountMicros: 20_000,
    currency: 'USD',
    source: 'recorded_estimate',
    unit: 'request',
  });

  const image = planModelSupplyCandidates({
    catalog: catalog(),
    operation: 'image.generate',
    selection: { mode: 'fixed', catalogModelId: 'gpt-image-2' },
    dataClass: [],
  });
  assert.deepEqual(image.candidateEvaluations[0]?.costEstimate, {
    amountMicros: 100_000,
    currency: 'USD',
    source: 'recorded_estimate',
    unit: 'request',
  });
});
