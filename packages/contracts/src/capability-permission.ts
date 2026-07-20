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
  'lead.manage',
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
  'lead.manage',
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
  | 'entitlements'
  | 'integrations'
  | 'job-runtime'
  | 'marketing-identity'
  | 'model-supply'
  | 'operations'
  | 'redemptions';

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
  'video_workflow_cancel',
  'video_workflow_confirm',
  'video_workflow_create_draft',
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
  'accept_creative_asset',
  'adopt_canvas_work_export',
  'adopt_into_content_package',
  'revoke_content_package_rights',
  'transition_task',
]);
const assetMemoryCreateActions = new Set([
  'confirm_asset_intake_fact',
  'correct_asset_intake_fact',
  'create_reuse_task',
  'prepare_assisted_price_intake',
  'propose_preference',
  'propose_reusable_asset',
  'record_asset_intake_batch',
  'record_preference_signal',
  'reject_asset_intake_candidate',
]);
const assetMemoryQueryActions = new Set([
  'asset_intake_missing_fact_keys',
  'asset_intake_view',
  'preference_view',
  'reusable_asset_view',
  'reuse_task_seed',
  'series_suggestions',
]);
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
    if (action === 'confirm_preference' || action === 'revoke_preference') {
      return 'personal.preferences.manage';
    }
    if (action === 'confirm_reusable_asset' || action === 'deactivate_series') {
      return 'content.review';
    }
    if (assetMemoryCreateActions.has(action)) return 'content.create';
    return null;
  }

  if (module === 'context') {
    if (kind === 'query') return 'workspace.read';
    return 'content.create';
  }

  if (module === 'marketing-identity') {
    if (kind === 'query') return 'workspace.read';
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
      return 'workspace.read';
    }
    if (taskRecoverActions.has(action)) return 'task.recover';
    if (contentReviewOperations.has(action)) return 'content.review';
    // Remaining operations commands are product content work (registered class).
    return 'content.create';
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
    if (action === 'video_workflow_select_candidate') return 'content.review';
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
const leadCommands = new Set<ProductCommand['type']>([
  'create_lead',
  'record_insight',
  'update_lead',
]);

export function requiredProductCommandCapability(
  type: ProductCommand['type']
): ProductCapability | undefined {
  if (internalProductCommands.has(type)) return undefined;
  if (workspaceProfileCommands.has(type)) return 'workspace.profile.manage';
  if (contentReviewCommands.has(type)) return 'content.review';
  if (publicationCommands.has(type)) return 'publication.handoff';
  if (leadCommands.has(type)) return 'lead.manage';
  return 'content.create';
}
