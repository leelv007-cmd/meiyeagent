import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTENT_PACKAGE_COMMAND_SCHEMAS,
  CONTENT_PACKAGE_QUERY_SCHEMAS,
  requiredP1Capability,
} from '@meiye/contracts';
import type { P1Context } from '../foundation/domain.js';
import type { OperationsApplicationService } from './application-service.js';
import { AssetMemoryFoundationModule } from './asset-memory-foundation-module.js';
import type { AssetIntakeService } from './asset-intake-service.js';
import type { ContextBundleRepository } from './context-bundle-repository.js';
import { ContextFoundationModule } from './context-foundation-module.js';
import type { ContextSourceRevisionRepository } from './context-source-revisions.js';
import { OperationsFoundationModule } from './foundation-module.js';
import type { StoreFactLedger } from './store-fact-ledger.js';

const context: P1Context = {
  actor: 'admin',
  correlationId: 'issue-257-retirement',
  userId: 'issue-257-admin',
  workspaceId: 'issue-257-workspace',
};

const retiredOperationsCommands = [
  'repair_media_custody',
  'attach_content_package_generation',
  'cancel_content_package',
  'create_content_package',
  'edit_content_package_variant',
  'export_content_package',
  'revoke_content_package_rights',
  'reuse_content_package',
  'record_onboarding_skip',
  'create_creative_work',
  'update_creative_work_draft',
  'update_creative_work_brief',
  'confirm_creative_work_brief',
  'submit_creative_work',
  'approve_creative_generation',
  'reroll_creative_job',
  'quality_retry_creative_job',
  'create_task',
  'transition_task',
  'configure_trigger',
  'run_trigger',
  'retry_task_notification',
  'execute_weekly_batch',
  'record_weekly_fact',
  'create_weekly_review',
  'confirm_weekly_candidates',
  'dismiss_weekly_candidate',
  'create_work',
  'preview_template_version',
  'create_blank_work',
  'create_work_from_user_template',
  'rename_user_template',
  'copy_user_template',
  'delete_user_template',
  'set_template_shortcuts',
  'start_canvas_image',
  'complete_canvas_image',
  'cancel_canvas_image',
  'index_search_document',
  'retrieval_evaluation',
] as const;

const retiredOperationsQueries = [
  'content_package_delivery_capabilities',
  'content_package_weekly_result_review',
  'content_package_lineage',
  'content_package_versions',
  'task',
  'inbox',
  'task_events',
  'weekly_batch',
  'weekly_review',
  'weekly_batch_executions',
  'trigger_metrics',
  'user_templates',
  'template_shortcuts',
  'latest_canvas_image_job',
  'retrieval_metrics',
] as const;

const retiredAssetMemoryCommands = [
  'parse_asset_batch',
  'promote_asset_draft',
  'record_asset_intake_batch',
  'correct_asset_intake_fact',
  'reject_asset_intake_candidate',
  'propose_reusable_asset',
  'confirm_reusable_asset',
  'deactivate_series',
  'create_reuse_task',
  'record_preference_signal',
  'propose_preference',
  'confirm_preference',
  'revoke_preference',
] as const;

const retiredAssetMemoryQueries = [
  'parse_task_view',
  'asset_draft_view',
  'asset_intake_view',
  'asset_intake_missing_fact_keys',
  'reusable_asset_view',
  'reuse_task_seed',
  'series_suggestions',
  'preference_view',
] as const;

const retiredContextCommands = ['context_bundle_compile'] as const;

const retiredContextQueries = [
  'context_bundle_get',
  'context_bundle_history',
  'context_bundle_recompile_events',
  'context_bundle_fence',
] as const;

test('Issue 257 removes retired E actions from public contracts', () => {
  for (const action of [
    'attach_content_package_generation',
    'cancel_content_package',
    'create_content_package',
    'edit_content_package_variant',
    'export_content_package',
    'reuse_content_package',
    'revoke_content_package_rights',
  ]) {
    assert.equal(Object.hasOwn(CONTENT_PACKAGE_COMMAND_SCHEMAS, action), false);
  }
  for (const action of [
    'content_package_delivery_capabilities',
    'content_package_weekly_result_review',
    'content_package_lineage',
    'content_package_versions',
  ]) {
    assert.equal(Object.hasOwn(CONTENT_PACKAGE_QUERY_SCHEMAS, action), false);
  }
});

test('Issue 257 defaults retired E actions to denied capabilities', () => {
  for (const [kind, module, actions] of [
    ['command', 'operations', retiredOperationsCommands],
    ['query', 'operations', retiredOperationsQueries],
    ['command', 'asset-memory', retiredAssetMemoryCommands],
    ['query', 'asset-memory', retiredAssetMemoryQueries],
    ['command', 'context', retiredContextCommands],
    ['query', 'context', retiredContextQueries],
  ] as const) {
    for (const action of actions) {
      assert.equal(requiredP1Capability(kind, module, action), null);
    }
  }
});

test('Issue 257 retires 81 reviewed E actions from the public module surface', async () => {
  const operations = new OperationsFoundationModule(
    {} as OperationsApplicationService,
    { adminActorIds: [context.userId] },
  );
  const assetMemory = new AssetMemoryFoundationModule(
    {} as AssetIntakeService,
  );
  const contextModule = new ContextFoundationModule(
    {} as StoreFactLedger,
    {} as ContextBundleRepository,
    {} as ContextSourceRevisionRepository,
  );

  assert.equal(
    retiredOperationsCommands.length +
      retiredOperationsQueries.length +
      retiredAssetMemoryCommands.length +
      retiredAssetMemoryQueries.length +
      retiredContextCommands.length +
      retiredContextQueries.length,
    81,
  );

  for (const action of retiredOperationsCommands) {
    await assert.rejects(
      operations.execute({ context, input: { action, payload: {} } }),
      new RegExp(`Unknown operations command ${action}`, 'u'),
    );
  }
  for (const action of retiredOperationsQueries) {
    await assert.rejects(
      operations.query({ context, input: { action, payload: {} } }),
      new RegExp(`Unknown operations query ${action}`, 'u'),
    );
  }
  for (const action of retiredAssetMemoryCommands) {
    await assert.rejects(
      assetMemory.execute({
        context,
        idempotencyKey: `retired-${action}`,
        input: { action, payload: {} },
      }),
      new RegExp(`Unknown asset-memory command ${action}`, 'u'),
    );
  }
  for (const action of retiredAssetMemoryQueries) {
    await assert.rejects(
      assetMemory.query({ context, input: { action, payload: {} } }),
      new RegExp(`Unknown asset-memory query ${action}`, 'u'),
    );
  }
  for (const action of retiredContextCommands) {
    await assert.rejects(
      contextModule.execute({
        context,
        idempotencyKey: `retired-${action}`,
        input: { action, payload: {} },
      }),
      new RegExp(`Unknown context command ${action}`, 'u'),
    );
  }
  for (const action of retiredContextQueries) {
    await assert.rejects(
      contextModule.query({ context, input: { action, payload: {} } }),
      new RegExp(`Unknown context query ${action}`, 'u'),
    );
  }
});
