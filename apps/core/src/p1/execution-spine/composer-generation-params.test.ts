import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapThinkingLevelToModelOptions,
  resolveBeautyVoiceInjection,
} from '@meiye/contracts';

import {
  createCreationExecutionSnapshot,
  normalizedGenerationParams,
  type CreationSubmissionCommand,
} from './creation-execution-snapshot.js';

const baseCommand = {
  actorId: 'actor-1',
  workspaceId: 'ws-1',
  idempotencyKey: 'idem-1',
  taskId: 'task-1',
  workId: 'work-1',
  contentPackageId: 'package-1',
  expectedContentPackageRevision: 0,
  creationMode: 'free' as const,
  intent: '写一条夏日控油护理笔记',
  surface: { id: 'surface-1', revision: 'surface-r1' },
  recipe: { id: 'recipe-1', revision: 'recipe-r1' },
  lens: 'image_text_note' as const,
  platform: { id: 'xiaohongshu' as const },
  contentPackagePlatform: 'xiaohongshu' as const,
  distributionTarget: 'export' as const,
  deliverable: {
    kind: 'note' as const,
    quantity: 1,
    aspectRatio: '3:4' as const,
    notePageBound: 3,
  },
  deliverables: [
    {
      id: 'd1',
      kind: 'image_text_note' as const,
      quantity: 1,
      order: 0,
      aspectRatio: '3:4' as const,
      notePageBound: 3,
    },
  ],
  sources: { assets: [] },
  rights: { revision: 'rights-1', summary: 'verified' },
  identity: { id: 'official-neutral', revision: '1' },
  modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' as const },
  catalogModel: { id: 'model-copy', revision: 'catalog-r1' },
  quote: { id: 'quote-1', revision: 'quote-r1' },
  route: { id: 'route-1', revision: 'route-r1' },
  briefContext: { id: 'brief-1', revision: 0 },
  contentModules: ['social_cover'] as const,
} satisfies CreationSubmissionCommand;

test('normalizedGenerationParams: customized injects owner + standard', () => {
  assert.deepEqual(
    normalizedGenerationParams({ creationMode: 'customized' }),
    { beautyVoiceRole: 'owner', thinkingLevel: 'standard' },
  );
  assert.deepEqual(
    normalizedGenerationParams({
      creationMode: 'customized',
      beautyVoiceRole: 'customer',
      thinkingLevel: 'deep',
    }),
    { beautyVoiceRole: 'customer', thinkingLevel: 'standard' },
  );
});

test('normalizedGenerationParams: free keeps explicit selection and optional voice', () => {
  assert.deepEqual(
    normalizedGenerationParams({
      creationMode: 'free',
      beautyVoiceRole: 'beautician',
      thinkingLevel: 'deep',
    }),
    { beautyVoiceRole: 'beautician', thinkingLevel: 'deep' },
  );
  assert.deepEqual(
    normalizedGenerationParams({ creationMode: 'free' }),
    { thinkingLevel: 'standard' },
  );
});

test('thinking level maps to existing model tier / provider thinking params', () => {
  assert.deepEqual(mapThinkingLevelToModelOptions('standard'), {
    routeProfile: 'balanced',
    thinking: { type: 'disabled' },
  });
  assert.deepEqual(mapThinkingLevelToModelOptions('deep'), {
    routeProfile: 'quality',
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
  });
});

test('beauty voice injection is beauty-context and distinct from note_style ids', () => {
  const injection = resolveBeautyVoiceInjection('beautician');
  assert.equal(injection.tone, '专业干货');
  assert.match(injection.roleBlock, /美容师/);
  // note_style structural ids must not be reused as voice roles
  assert.notEqual(injection.tone, 'practical_guide');
});

test('createCreationExecutionSnapshot freezes generation params from the request', () => {
  const snapshot = createCreationExecutionSnapshot(
    {
      ...baseCommand,
      beautyVoiceRole: 'customer',
      thinkingLevel: 'deep',
    },
    '2026-08-01T00:00:00.000Z',
  );
  assert.equal(snapshot.beautyVoiceRole, 'customer');
  assert.equal(snapshot.thinkingLevel, 'deep');
});

test('createCreationExecutionSnapshot customized forces standard thinking', () => {
  const snapshot = createCreationExecutionSnapshot(
    {
      ...baseCommand,
      creationMode: 'customized',
      beautyVoiceRole: 'beautician',
      thinkingLevel: 'deep',
    },
    '2026-08-01T00:00:00.000Z',
  );
  assert.equal(snapshot.beautyVoiceRole, 'beautician');
  assert.equal(snapshot.thinkingLevel, 'standard');
});
