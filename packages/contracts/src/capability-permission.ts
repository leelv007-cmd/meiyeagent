/**
 * Capability permission contract (D-057).
 * Behavior-preserving extract from uiux.ts — S2a only moves shape + mapping.
 * WT-K (#120) extends the key registry + default-deny enforcement.
 */
import type { ProductCommand } from './product.js';

export const productRoles = ['admin', 'owner', 'operator', 'reviewer'] as const;
export type ProductRole = (typeof productRoles)[number];

/**
 * Authorization capability keys.
 * First-batch admin governance domains (D-057 / #120):
 * system.capability.view | task.recover | channel.lifecycle.manage |
 * config.publish | account.commerce.govern | credential.govern | audit.view
 * ("event ack/assign" deferred — not registered).
 */
export const productCapabilities = [
  'account.commerce.govern',
  'audit.view',
  'channel.lifecycle.manage',
  'config.publish',
  'content.create',
  'content.review',
  'credential.govern',
  'models.select',
  'personal.preferences.manage',
  'platform.manage',
  'publication.handoff',
  'system.capability.view',
  'task.recover',
  'workspace.billing.manage',
  'workspace.connections.manage',
  'workspace.members.manage',
  'workspace.models.manage',
  'workspace.profile.manage',
  'workspace.read',
] as const;
export type ProductCapability = (typeof productCapabilities)[number];

/** First-batch admin governance domains (seven). Event ack/assign deferred. */
export const firstBatchAdminCapabilities = [
  'system.capability.view',
  'task.recover',
  'channel.lifecycle.manage',
  'config.publish',
  'account.commerce.govern',
  'credential.govern',
  'audit.view',
] as const satisfies readonly ProductCapability[];

const sharedWorkspaceCapabilities: ProductCapability[] = ['workspace.read'];
const operatorCapabilities: ProductCapability[] = [
  ...sharedWorkspaceCapabilities,
  'content.create',
  'content.review',
  'models.select',
  'personal.preferences.manage',
  'publication.handoff',
];
const ownerCapabilities: ProductCapability[] = [
  ...operatorCapabilities,
  'workspace.billing.manage',
  'workspace.connections.manage',
  'workspace.members.manage',
  'workspace.models.manage',
  'workspace.profile.manage',
];

export const PRODUCT_ROLE_CAPABILITIES: Readonly<
  Record<ProductRole, readonly ProductCapability[]>
> = {
  // Trusted platform admin receives full first-batch governance set (D-057).
  admin: [
    ...ownerCapabilities,
    'platform.manage',
    ...firstBatchAdminCapabilities,
  ],
  owner: ownerCapabilities,
  operator: operatorCapabilities,
  reviewer: [...sharedWorkspaceCapabilities, 'content.review'],
};

export function hasProductCapability(
  role: ProductRole,
  capability: ProductCapability
) {
  return PRODUCT_ROLE_CAPABILITIES[role].includes(capability);
}

export function normalizeProductRole(input: {
  platformRole?: string | null;
  workspaceRole?: string | null;
}): ProductRole | undefined {
  if (input.platformRole === 'admin') return 'admin';
  if (
    input.workspaceRole === 'owner' ||
    input.workspaceRole === 'operator' ||
    input.workspaceRole === 'reviewer'
  ) {
    return input.workspaceRole;
  }
  return undefined;
}

export type P1Module =
  | 'advanced-canvas'
  | 'admin-config'
  | 'asset-memory'
  | 'context'
  | 'creation-experience'
  | 'entitlements'
  | 'integrations'
  | 'job-runtime'
  | 'marketing-identity'
  | 'model-supply'
  | 'operations'
  | 'product-billing'
  | 'redemptions'
  | 'result-delivery'
  | 'skills'
  | 'video-regeneration';

const personalModelActions = new Set([
  'record_recent',
  'set_favorite',
  'set_user_default',
]);
const modelExecutionActions = new Set([
  'cancel_generation',
  'canvas_generation_cancel',
  'canvas_generation_quote',
  'canvas_generation_submit',
  'record_quality',
  'submit_generation',
]);
const modelConfigPublishActions = new Set([
  'catalog_create_draft',
  'catalog_create_safe_draft',
  'catalog_enable',
  'catalog_publish',
  'catalog_retire',
  'catalog_rollback',
  'prompt_revision_rollback',
]);
const modelAdminQueryActions = new Set([
  'activation_probe_runs',
  'activation_status',
  'admin_catalog_control',
  'admin_supply_action_preview',
  'admin_supply_control',
  'admin_supply_pending_actions',
  'catalog_revisions',
  'prompt_revisions',
  'quality_dashboard',
  'quality_evaluation',
  'quality_evaluations',
  'route_simulation',
]);
const modelAuditQueryActions = new Set(['revision_rollback_audits']);
const modelWorkspaceReadQueries = new Set([
  'catalog',
  'canvas_generation_catalog',
  'canvas_generation_job',
  'canvas_generation_jobs',
  'job',
  'preferences',
  'video_workflow',
  'video_workflow_public',
  'video_workflows',
]);
const integrationUseActions = new Set([
  'confirm_douyin_publish',
  'confirm_feishu_intent',
  'execute_feishu_intent',
  'reconcile_feishu_intent',
  'refresh_douyin_publish',
  'submit_douyin_publish',
]);
const platformIntegrationActions = new Set([
  'publish_feishu_tool',
  'sync_feishu_tools',
  'sync_publish_feishu_tools',
]);
const credentialGovernActions = new Set([
  'admin_provider_credentials',
  'admin_revoke_provider_credential',
  'admin_rotate_provider_credential',
  'admin_store_provider_credential',
  'admin_test_provider_connection',
]);
const integrationConnectionCommands = new Set([
  'activate_douyin_capability',
  'create_connection',
  'deactivate_douyin_capability',
  'disconnect',
  'refresh_douyin_oauth',
  'rotate_credential',
  'sync_douyin_observe',
  'verify_feishu_connection',
]);
const integrationWorkspaceQueries = new Set([
  'connection',
  'connections',
  'douyin_content_snapshots',
  'douyin_integration_status',
  'douyin_operations_snapshot',
  'douyin_projection',
  'feishu_activity',
  'feishu_intent_recovery',
  'feishu_pending_intents',
  'feishu_shortcuts',
  'feishu_tool_catalog',
  'strict_byok_options',
]);
const jobRuntimeCommands = new Set([
  'cancel',
  'schedule_recurring',
  'submit',
  'unschedule_recurring',
]);
const contentReviewOperations = new Set([
  'adopt_canvas_work_export',
  'adopt_into_content_package',
]);
const operationsContentCreateActions = new Set([
  'adopt_harness_candidate',
  'approve_content_package_action',
  'cancel_creative_job',
  'content_package_migration_activate',
  'content_package_migration_backfill',
  'content_package_migration_dry_run',
  'content_package_migration_freeze',
  'content_package_migration_inspect',
  'content_package_migration_rollback',
  'copy_template_version_to_work',
  'create_work_from_content_package',
  'deliver_content_package',
  'derive_creative_work',
  'edit_content_package_version',
  'export_work',
  'generate_content_package_variants',
  'record_content_package_manual_result',
  'record_content_package_result_review_action',
  'record_content_package_result_signal',
  'resume_creative_job',
  'retry_creative_job',
  'rollback_content_package_version',
  'save_canvas_revision',
  'save_creative_assets_to_library',
  'save_creative_work_selection_draft',
  'save_user_template',
  'set_creation_labels',
  'upgrade_work_template',
]);
const operationsWorkspaceQueryActions = new Set([
  'canonical_history',
  'canvas_export_asset',
  'canvas_image_job',
  'content_package',
  'content_package_delivery_timeline',
  'content_package_migration_report',
  'content_package_migration_status',
  'content_package_results',
  'content_packages',
  'creation_catalog',
  'creative_workbench',
  'export_receipts',
  'search',
  'templates',
  'work',
]);
const assetMemoryCreateActions = new Set([
  'confirm_asset_intake_fact',
  'finalize_store_intake',
  'parse_single_asset',
  'prepare_manual_asset_draft',
  'prepare_store_profile_import',
]);
const assetMemoryQueryActions = new Set(['asset_intake_experience']);
/**
 * Channel/deployment lifecycle actions (isolate/drain/recover).
 * Pre-registered for supply-control tickets; unregistered elsewhere → deny.
 */
const channelLifecycleActions = new Set([
  'drain_channel',
  'drain_deployment',
  'isolate_channel',
  'isolate_deployment',
  'recover_channel',
  'recover_deployment',
]);
/** Admin task recovery actions (pre-registered for ops recovery surface). */
const taskRecoverActions = new Set([
  'force_fail_task',
  'reconcile_cancelled_provider_terminal',
  'recover_task',
]);
/**
 * Cloudflare control-plane write verbs (D-053). Never authorized by new keys.
 * Explicit registration ensures typos cannot fall into a broad default.
 */
const cloudflareWriteActions = new Set([
  'cloudflare_deploy',
  'cloudflare_dns_write',
  'cloudflare_rollback',
  'cloudflare_secret_put',
  'cloudflare_waf_write',
]);

/**
 * Resolve required ProductCapability for a P1 module action.
 * Unregistered module/action pairs return null — server default-denies (WT-K #120).
 */
export function requiredP1Capability(
  kind: 'command' | 'query',
  module: P1Module,
  action: string
): ProductCapability | null {
  // D-053: Cloudflare write ops must not gain authorization from any key.
  if (cloudflareWriteActions.has(action)) return null;

  if (module === 'creation-experience') {
    if (kind === 'query') {
      return new Set([
        'brief_project',
        'lens_list',
        'recipe_patch_preview',
        'recipe_browser',
        'session_get',
        'surface_browser',
        'tool_list',
      ]).has(action)
        ? 'workspace.read'
        : new Set([
              'recipe_get',
              'recipe_history',
              'recipe_validate',
              'surface_get',
              'surface_history',
              'surface_validate',
            ]).has(action)
          ? 'config.publish'
          : null;
    }
    if (action === 'session_freeze') return 'content.create';
    if (
      action === 'brief_confirm' ||
      action === 'brief_context_sync' ||
      action === 'event_append'
    ) {
      return 'content.create';
    }
    return new Set([
      'recipe_draft',
      'recipe_preview',
      'recipe_publish',
      'recipe_rollback',
      'surface_draft',
      'surface_preview',
      'surface_publish',
      'surface_rollback',
    ]).has(action)
      ? 'config.publish'
      : null;
  }

  if (module === 'skills') {
    return kind === 'command' &&
      new Set([
        'skill_define',
        'skill_accept',
        'skill_bind',
        'skill_rollback',
        'skill_deployment',
      ]).has(action)
      ? 'config.publish'
      : null;
  }

  if (module === 'product-billing') {
    if (kind === 'query') {
      return new Set([
        'get_quote',
        'get_quote_by_task',
        'get_usage',
      ]).has(action)
        ? 'workspace.read'
        : null;
    }
    return new Set(['confirm', 'quote']).has(action)
      ? 'content.create'
      : null;
  }

  if (module === 'result-delivery') {
    if (kind === 'query') {
      return new Set([
        'actionable_inbox',
        'assisted_get',
        'assisted_list',
        'assisted_pending_confirm',
        'recent_list',
        'result_target_resolve',
      ]).has(action)
        ? 'workspace.read'
        : null;
    }
    if (
      new Set([
        'assisted_consume_handoff',
        'assisted_hand_over',
        'assisted_mark_pending',
        'assisted_prepare',
        'assisted_record_publish_result',
      ]).has(action)
    ) {
      return 'publication.handoff';
    }
    return new Set([
      'adopt_into_content_package',
      'result_adjust',
      'result_adjust_prepare',
      'result_adopt',
      'result_export',
      'revise_content_package_visuals',
    ]).has(action)
      ? 'content.review'
      : null;
  }

  if (module === 'video-regeneration') {
    if (kind === 'query') {
      return action === 'get_task' ? 'workspace.read' : null;
    }
    return new Set(['quote', 'confirm', 'recover', 'retry', 'free_action']).has(action)
      ? 'content.create'
      : null;
  }

  if (module === 'advanced-canvas') {
    // Small module: all queries share workspace.read; all commands require review.
    return kind === 'query' ? 'workspace.read' : 'content.review';
  }

  if (module === 'admin-config') {
    if (kind === 'query' && action === 'config_defaults') {
      return 'workspace.read';
    }
    if (kind === 'query' && action === 'cloudflare_inventory') {
      return 'system.capability.view';
    }
    if (
      action === 'config_apply' ||
      action === 'config_get' ||
      action === 'config_rollback' ||
      action === 'config_list' ||
      action === 'config_history'
    ) {
      return 'config.publish';
    }
    return null;
  }

  if (module === 'asset-memory') {
    if (kind === 'query') {
      return assetMemoryQueryActions.has(action) ? 'workspace.read' : null;
    }
    // D-151: direct StoreFact confirmation is a kernel/server seam. The
    // worker authorizer bypass below preserves the trusted internal channel;
    // browser roles must use finalize_store_intake instead.
    if (action === 'confirm_asset_intake_fact') return null;
    if (assetMemoryCreateActions.has(action)) return 'content.create';
    return null;
  }

  if (module === 'context') {
    if (
      kind === 'query' &&
      new Set(['store_fact_history', 'store_facts_active']).has(action)
    ) {
      return 'workspace.read';
    }
    // D-151: only the kernel/server may append canonical StoreFacts. Browser
    // callers must use the mapped finalize_store_intake command.
    return null;
  }

  if (module === 'marketing-identity') {
    if (kind === 'query') return 'workspace.read';
    if (
      action === 'set_default_marketing_identity' ||
      action === 'rollback_default_marketing_identity'
    ) {
      return 'personal.preferences.manage';
    }
    return 'content.create';
  }

  if (module === 'operations') {
    // Pattern registration for the large operations surface (not per-action list).
    // admin_* stays platform.manage except publish template → config.publish.
    if (action.startsWith('admin_')) {
      if (
        action === 'admin_publish_template_version' ||
        action === 'admin_create_template' ||
        action === 'admin_create_template_version' ||
        action === 'admin_enable_template_version' ||
        action === 'admin_retire_template'
      ) {
        return 'config.publish';
      }
      return 'platform.manage';
    }
    if (kind === 'query') {
      if (action === 'audit_export' || action === 'audit_view') {
        return 'audit.view';
      }
      return operationsWorkspaceQueryActions.has(action)
        ? 'workspace.read'
        : null;
    }
    // Z1/#105: legacy CreativeContent acceptance is no longer a public write.
    if (action === 'accept_creative_asset') return null;
    if (taskRecoverActions.has(action)) return 'task.recover';
    if (contentReviewOperations.has(action)) return 'content.review';
    return operationsContentCreateActions.has(action) ? 'content.create' : null;
  }

  if (module === 'entitlements') {
    if (kind === 'query') return 'workspace.read';
    if (action === 'register_gift') return 'account.commerce.govern';
    if (
      action === 'checkout_plan' ||
      action === 'checkout_add_on' ||
      action === 'configure_auto_top_up' ||
      action === 'auto_top_up' ||
      action === 'payment_grant' ||
      action === 'provision_model_defaults'
    ) {
      return 'workspace.billing.manage';
    }
    return null;
  }

  if (module === 'redemptions') {
    // Manage (create/void/list) = commerce governance; redeem = billing owner.
    if (action === 'redeem') return 'workspace.billing.manage';
    if (action === 'create' || action === 'void' || action === 'list') {
      return 'account.commerce.govern';
    }
    return null;
  }

  if (module === 'integrations') {
    if (credentialGovernActions.has(action)) return 'credential.govern';
    if (action.startsWith('admin_') || platformIntegrationActions.has(action)) {
      return 'platform.manage';
    }
    if (kind === 'query') {
      if (action === 'audit') return 'audit.view';
      if (integrationWorkspaceQueries.has(action)) return 'workspace.read';
      return null;
    }
    if (action === 'set_feishu_shortcuts') {
      return 'personal.preferences.manage';
    }
    if (integrationUseActions.has(action)) return 'publication.handoff';
    if (action === 'submit_strict_byok') return 'workspace.models.manage';
    if (integrationConnectionCommands.has(action)) {
      return 'workspace.connections.manage';
    }
    return null;
  }

  if (module === 'model-supply') {
    if (channelLifecycleActions.has(action)) {
      return 'channel.lifecycle.manage';
    }
    if (taskRecoverActions.has(action)) return 'task.recover';
    if (kind === 'query') {
      if (action === 'capability_registry' || action === 'capability_inventory') {
        return 'system.capability.view';
      }
      if (modelAuditQueryActions.has(action)) return 'audit.view';
      if (modelAdminQueryActions.has(action)) return 'platform.manage';
      if (modelWorkspaceReadQueries.has(action)) return 'workspace.read';
      return null;
    }
    if (personalModelActions.has(action)) {
      return 'personal.preferences.manage';
    }
    if (action === 'set_workspace_default') return 'workspace.models.manage';
    if (action === 'video_workflow_edit') {
      return 'content.review';
    }
    if (modelExecutionActions.has(action)) return 'content.create';
    if (modelConfigPublishActions.has(action)) return 'config.publish';
    if (
      action === 'admin_supply_action' ||
      action === 'admin_supply_reconcile_pending' ||
      action === 'activation_probe_run' ||
      action === 'quality_evaluation_run'
    ) {
      return 'platform.manage';
    }
    return null;
  }

  if (module === 'job-runtime') {
    if (kind === 'query') {
      if (action === 'metrics' || action === 'observability') {
        return 'system.capability.view';
      }
      if (action === 'job') return 'workspace.read';
      return null;
    }
    if (jobRuntimeCommands.has(action)) {
      return action === 'submit' || action === 'cancel'
        ? 'content.create'
        : 'platform.manage';
    }
    return null;
  }

  // Unknown module/action: default deny (no broad fallthrough).
  return null;
}

const internalProductCommands = new Set<ProductCommand['type']>([
  'apply_plan',
  'claim_video',
  'complete_video',
  'heartbeat_video',
  'record_video_render',
  'transition_video',
]);
const workspaceProfileCommands = new Set<ProductCommand['type']>([
  'authorize_asset',
  'confirm_qualification',
  'confirm_store',
  'save_store_draft',
]);
const contentReviewCommands = new Set<ProductCommand['type']>([
  'display_preflight',
  'select_content',
]);
const publicationCommands = new Set<ProductCommand['type']>([
  'confirm_responsibility',
  'create_handoff',
  'mark_published',
  'record_handoff_export',
  'report_handoff_result',
]);

export function requiredProductCommandCapability(
  type: ProductCommand['type']
): ProductCapability | undefined {
  if (internalProductCommands.has(type)) return undefined;
  if (workspaceProfileCommands.has(type)) return 'workspace.profile.manage';
  if (contentReviewCommands.has(type)) return 'content.review';
  if (publicationCommands.has(type)) return 'publication.handoff';
  return 'content.create';
}
