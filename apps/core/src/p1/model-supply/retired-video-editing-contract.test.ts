import assert from 'node:assert/strict';
import test from 'node:test';
import {
  p1ModuleRequestSchema,
  requiredP1Capability,
  type P1Module,
} from '@meiye/contracts';
import { ModelSupplyFoundationModule } from './foundation-module.js';

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

test('D-133 rejects subtitle editing before the canonical video workflow port', async () => {
  let editInvoked = false;
  const module = new ModelSupplyFoundationModule(null as never, {
    videoWorkflow: {
      async edit() {
        editInvoked = true;
        throw new Error('retired edit reached the canonical workflow port');
      },
      async list() {
        throw new Error('unexpected list');
      },
      async query() {
        throw new Error('unexpected query');
      },
    },
  });

  await assert.rejects(
    module.execute({
      context: {
        correlationId: 'corr-retired-subtitle',
        userId: 'owner-1',
        workspaceId: 'workspace-1',
      },
      idempotencyKey: 'retired-subtitle-edit',
      input: {
        action: 'video_workflow_edit',
        payload: {
          edit: { kind: 'set_subtitle', text: '旧字幕写入' },
          expectedRevision: 1,
          workflowId: 'video-1',
        },
      },
    }),
    /Unknown video edit set_subtitle/,
  );
  assert.equal(editInvoked, false);
});
