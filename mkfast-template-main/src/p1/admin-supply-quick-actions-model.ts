/**
 * Governed quick actions full set (J5 / D-070 ③).
 *
 * Every action: Core typed command/query + capability permission + impact
 * preview + reason + CAS/idempotency + reversible drain semantics + immutable
 * audit. Forbidden: secret echo, direct DB write, bypass publish gate, blind
 * retry of accepted / acceptance_unknown media tasks.
 *
 * Presentation contract only — Z2 wires live HTTP. Permission keys resolve via
 * `@meiye/contracts` `requiredP1Capability` when the action is registered.
 */
import {
  requiredP1Capability,
  type P1Module,
  type ProductCapability,
} from '@meiye/contracts';
import {
  admin_supply_audit_writes_actor_reason_before_after_fccdb126,
  admin_supply_cas_publish_revision,
  admin_supply_channel_isolate_0d229df6,
  admin_supply_channel_restore_9b4e663a,
  admin_supply_conformance_probe_83a23637,
  admin_supply_connectivity_probe_ffcc4cbe,
  admin_supply_credential_rotate_06d9527c,
  admin_supply_do_not_blindly_retry_accepted_acceptance_5192a124,
  admin_supply_do_not_bypass_the_publish_gate_2ba2386a,
  admin_supply_do_not_expose_raw_secrets_97c0ee7a,
  admin_supply_do_not_write_the_database_directly_0e05fd0a,
  admin_supply_does_not_change_current_effective_head_s_ad58e7ae,
  admin_supply_does_not_change_effective_routepolicy_ca_96f990d4,
  admin_supply_done_by_publishing_a_new_revision_no_in_56748fba,
  admin_supply_drain_7a446bd7,
  admin_supply_drain_can_be_cancelled_restored_does_not_d7d6360b,
  admin_supply_health_balance_refresh_dd972bcc,
  admin_supply_in_flight_tasks_continue_can_be_undone_v_0afe73f2,
  admin_supply_in_flight_tasks_freeze_the_old_version_b8b05399,
  admin_supply_isolate_executionchannel_deployment_and_80437a88,
  admin_supply_isolate_stop_new_tasks,
  admin_supply_list_affected_deployment_pool_in_flight_95c204ae,
  admin_supply_must_pass_publish_gate_insufficient_dual_62941671,
  admin_supply_normalize_results_do_not_record_upstream_70ca65de,
  admin_supply_only_new_executions_use_it_historical_re_a5cf4d1b,
  admin_supply_pre_revoke_impact_check_c526c457,
  admin_supply_preview_affected_deployments_pools_and_i_afb39e64,
  admin_supply_preview_revoke_impact,
  admin_supply_probe_pass_model_activation_e628fd53,
  admin_supply_probe_target_write_evidence,
  admin_supply_publish_94f172d0,
  admin_supply_publish_catalog_route_policy_revision_vi_2d2ebeda,
  admin_supply_read_only_refresh_failures_are_explicit_c057cca6,
  admin_supply_refresh_health_balance,
  admin_supply_refresh_health_overlay_and_balance_limit_ff85ecf6,
  admin_supply_restore_channel_accept,
  admin_supply_restore_channel_to_accept_tasks_from_iso_cca157eb,
  admin_supply_restore_does_not_bypass_health_activatio_cb3cd436,
  admin_supply_reversible_drain_stop_new_tasks_wait_for_07f79ae8,
  admin_supply_rollback_8a2c437b,
  admin_supply_rollback_to_a_known_revision_new_revisio_a57c0191,
  admin_supply_rollback_to_revision,
  admin_supply_rotate_credential_append,
  admin_supply_route_simulate_e2ac7bf7,
  admin_supply_run_connectivity_probe_on_deployment_cre_ef35765f,
  admin_supply_run_modality_conformance_probe_and_recor_a09a2c32,
  admin_supply_run_route_simulation_hard_filter_sort_li_3993150c,
  admin_supply_save_a_new_immutable_candidate_revision_0e70dd0e,
  admin_supply_save_a_new_immutable_routepolicy_candida_eaa0e8db,
  admin_supply_save_candidate_config_253ec100,
  admin_supply_secrets_only_write_to_kms_secretstore_an_a0fc3b64,
  admin_supply_shared_explanation_projection_for_hard_f_19088b2a,
  admin_supply_shares_explanation_projection_with_task_e6af953f,
  admin_supply_start_reversible_drain,
  admin_supply_stop_new_tasks_wait_for_async_media_to_f_5b231b85,
  admin_supply_this_action_does_not_perform_revoke_8d5dd5b0,
  admin_supply_validate_candidate_config_against_hard_f_f3dbb1a9,
  admin_supply_validate_candidate_config_db106b74,
  admin_supply_validate_candidate_routepolicy_deploymen_aaaee07d,
  admin_supply_write_new_secret_reference_and_append_ve_40e02cc7,
} from '@/locale/paraglide/messages';

/**
 * Same rule as impact-review-dialog `impactReasonSchema` (min 8 after trim).
 * Kept local so pure model tests do not pull locale/UI dialog modules.
 */
export function isValidImpactReason(reason: string): boolean {
  return reason.trim().length >= 8;
}

/** Full D-070 决定③ quick-action catalog. */
export const GOVERNED_QUICK_ACTION_IDS = [
  'connectivity_probe',
  'conformance_probe',
  'candidate_config_save',
  'candidate_config_validate',
  'route_simulate',
  'publish',
  'rollback',
  'channel_isolate',
  'channel_recover',
  'drain',
  'credential_rotate',
  'pre_revoke_impact_check',
  'health_balance_refresh',
] as const;

export type GovernedQuickActionId = (typeof GOVERNED_QUICK_ACTION_IDS)[number];

export type GovernedActionKind = 'command' | 'query';

export type GovernedActionTarget = {
  resourceType:
    | 'deployment'
    | 'channel'
    | 'credential_account'
    | 'catalog_revision'
    | 'route_policy'
    | 'pool'
    | 'operation';
  resourceId: string;
  label?: string;
  /** CAS expected head / version when applicable. */
  expectedRevisionId?: string;
  /** Opaque idempotency key for Core command. */
  idempotencyKey?: string;
};

export type GovernedImpactPreview = {
  scope: string;
  changes: string[];
  reversible: boolean;
  /** Explicit operator warnings (publish gate, media acceptance, etc.). */
  warnings: string[];
};

export type GovernedTypedCommand = {
  kind: GovernedActionKind;
  module: P1Module;
  action: string;
  payload: Record<string, unknown>;
  /** Present when CAS is required. */
  expectedRevisionId?: string;
  idempotencyKey?: string;
};

export type GovernedAuditProjection = {
  actor: { userId: string; role?: string | null };
  permission: ProductCapability;
  target: {
    kind: GovernedActionKind;
    module: string;
    action: string;
    resourceId: string | null;
    resourceType: string | null;
  };
  reason: string;
  before: unknown | null;
  after: unknown | null;
  correlationId: string;
  occurredAt: string;
};

export type GovernedQuickActionDefinition = {
  id: GovernedQuickActionId;
  label: string;
  description: string;
  module: P1Module;
  action: string;
  kind: GovernedActionKind;
  requiredPermission: ProductCapability;
  requiresImpactPreview: boolean;
  requiresReason: boolean;
  casIdempotency: boolean;
  /** Drain / isolate actions are reversible via recover / complete_drain. */
  reversibleDrain: boolean;
  immutableAudit: true;
  /** Hard forbids for every action (D-070). */
  forbids: {
    secretEcho: true;
    directDbWrite: true;
    bypassPublishGate: true;
    blindRetryAcceptedUnknownMedia: true;
  };
};

const FORBIDS = {
  secretEcho: true,
  directDbWrite: true,
  bypassPublishGate: true,
  blindRetryAcceptedUnknownMedia: true,
} as const;

/**
 * Canonical action table. Permission is the product contract; when Core has
 * registered the (module, action) pair, `requiredP1Capability` must match.
 */
export const GOVERNED_QUICK_ACTIONS: readonly GovernedQuickActionDefinition[] =
  [
    {
      id: 'connectivity_probe',
      label: admin_supply_connectivity_probe_ffcc4cbe(),
      description:
        admin_supply_run_connectivity_probe_on_deployment_cre_ef35765f(),
      module: 'model-supply',
      action: 'activation_probe_run',
      kind: 'command',
      requiredPermission: 'platform.manage',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'conformance_probe',
      label: admin_supply_conformance_probe_83a23637(),
      description:
        admin_supply_run_modality_conformance_probe_and_recor_a09a2c32(),
      module: 'model-supply',
      action: 'activation_probe_run',
      kind: 'command',
      requiredPermission: 'platform.manage',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'candidate_config_save',
      label: admin_supply_save_candidate_config_253ec100(),
      description:
        admin_supply_save_a_new_immutable_candidate_revision_0e70dd0e(),
      module: 'model-supply',
      action: 'admin_supply_action',
      kind: 'command',
      requiredPermission: 'platform.manage',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'candidate_config_validate',
      label: admin_supply_validate_candidate_config_db106b74(),
      description:
        admin_supply_validate_candidate_routepolicy_deploymen_aaaee07d(),
      module: 'model-supply',
      action: 'route_simulation',
      kind: 'query',
      requiredPermission: 'platform.manage',
      requiresImpactPreview: true,
      requiresReason: false,
      casIdempotency: false,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'route_simulate',
      label: admin_supply_route_simulate_e2ac7bf7(),
      description:
        admin_supply_shared_explanation_projection_for_hard_f_19088b2a(),
      module: 'model-supply',
      action: 'route_simulation',
      kind: 'query',
      requiredPermission: 'platform.manage',
      requiresImpactPreview: false,
      requiresReason: false,
      casIdempotency: false,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'publish',
      label: admin_supply_publish_94f172d0(),
      description:
        admin_supply_publish_catalog_route_policy_revision_vi_2d2ebeda(),
      module: 'model-supply',
      action: 'catalog_publish',
      kind: 'command',
      requiredPermission: 'config.publish',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'rollback',
      label: admin_supply_rollback_8a2c437b(),
      description:
        admin_supply_rollback_to_a_known_revision_new_revisio_a57c0191(),
      module: 'model-supply',
      action: 'catalog_rollback',
      kind: 'command',
      requiredPermission: 'config.publish',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'channel_isolate',
      label: admin_supply_channel_isolate_0d229df6(),
      description:
        admin_supply_isolate_executionchannel_deployment_and_80437a88(),
      module: 'model-supply',
      action: 'isolate_channel',
      kind: 'command',
      requiredPermission: 'channel.lifecycle.manage',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: true,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'channel_recover',
      label: admin_supply_channel_restore_9b4e663a(),
      description:
        admin_supply_restore_channel_to_accept_tasks_from_iso_cca157eb(),
      module: 'model-supply',
      action: 'recover_channel',
      kind: 'command',
      requiredPermission: 'channel.lifecycle.manage',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: true,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'drain',
      label: admin_supply_drain_7a446bd7(),
      description:
        admin_supply_reversible_drain_stop_new_tasks_wait_for_07f79ae8(),
      module: 'model-supply',
      action: 'drain_channel',
      kind: 'command',
      requiredPermission: 'channel.lifecycle.manage',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: true,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'credential_rotate',
      label: admin_supply_credential_rotate_06d9527c(),
      description:
        admin_supply_write_new_secret_reference_and_append_ve_40e02cc7(),
      module: 'integrations',
      action: 'admin_rotate_provider_credential',
      kind: 'command',
      requiredPermission: 'credential.govern',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: true,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'pre_revoke_impact_check',
      label: admin_supply_pre_revoke_impact_check_c526c457(),
      description:
        admin_supply_preview_affected_deployments_pools_and_i_afb39e64(),
      module: 'integrations',
      action: 'admin_provider_credentials',
      kind: 'query',
      requiredPermission: 'credential.govern',
      requiresImpactPreview: true,
      requiresReason: true,
      casIdempotency: false,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
    {
      id: 'health_balance_refresh',
      label: admin_supply_health_balance_refresh_dd972bcc(),
      description:
        admin_supply_refresh_health_overlay_and_balance_limit_ff85ecf6(),
      module: 'model-supply',
      action: 'activation_status',
      kind: 'query',
      requiredPermission: 'platform.manage',
      requiresImpactPreview: false,
      requiresReason: false,
      casIdempotency: true,
      reversibleDrain: false,
      immutableAudit: true,
      forbids: FORBIDS,
    },
  ] as const;

const BY_ID = new Map(
  GOVERNED_QUICK_ACTIONS.map((action) => [action.id, action])
);

export function getGovernedQuickAction(
  id: GovernedQuickActionId
): GovernedQuickActionDefinition {
  const action = BY_ID.get(id);
  if (!action) {
    throw new Error(`Unknown governed quick action: ${id}`);
  }
  return action;
}

/**
 * Resolve required permission via contracts registry when registered.
 * Falls back to the definition's declared permission (pre-registered contract).
 */
export function resolveActionPermission(
  def: GovernedQuickActionDefinition
): ProductCapability | null {
  const fromRegistry = requiredP1Capability(def.kind, def.module, def.action);
  return fromRegistry ?? def.requiredPermission;
}

export function buildImpactPreview(
  def: GovernedQuickActionDefinition,
  target: GovernedActionTarget
): GovernedImpactPreview {
  const scope = `${def.label} → ${target.resourceType}:${target.resourceId}`;
  const changes: string[] = [];
  const warnings: string[] = [
    admin_supply_do_not_expose_raw_secrets_97c0ee7a(),
    admin_supply_do_not_write_the_database_directly_0e05fd0a(),
    admin_supply_do_not_bypass_the_publish_gate_2ba2386a(),
    admin_supply_do_not_blindly_retry_accepted_acceptance_5192a124(),
  ];

  switch (def.id) {
    case 'connectivity_probe':
    case 'conformance_probe':
      changes.push(
        admin_supply_probe_target_write_evidence({
          resourceId: target.resourceId,
        }),
        admin_supply_probe_pass_model_activation_e628fd53(),
        admin_supply_normalize_results_do_not_record_upstream_70ca65de()
      );
      break;
    case 'candidate_config_save':
      changes.push(
        admin_supply_save_a_new_immutable_routepolicy_candida_eaa0e8db(),
        admin_supply_does_not_change_current_effective_head_s_ad58e7ae()
      );
      break;
    case 'candidate_config_validate':
      changes.push(
        admin_supply_validate_candidate_config_against_hard_f_f3dbb1a9(),
        admin_supply_does_not_change_effective_routepolicy_ca_96f990d4()
      );
      break;
    case 'route_simulate':
      changes.push(
        admin_supply_run_route_simulation_hard_filter_sort_li_3993150c(),
        admin_supply_shares_explanation_projection_with_task_e6af953f()
      );
      break;
    case 'publish':
      changes.push(
        admin_supply_cas_publish_revision({
          revision: target.expectedRevisionId ?? target.resourceId,
        }),
        admin_supply_only_new_executions_use_it_historical_re_a5cf4d1b(),
        admin_supply_audit_writes_actor_reason_before_after_fccdb126()
      );
      warnings.push(
        admin_supply_must_pass_publish_gate_insufficient_dual_62941671()
      );
      break;
    case 'rollback':
      changes.push(
        admin_supply_rollback_to_revision({ revision: target.resourceId }),
        admin_supply_done_by_publishing_a_new_revision_no_in_56748fba()
      );
      break;
    case 'channel_isolate':
      changes.push(
        admin_supply_isolate_stop_new_tasks({ resourceId: target.resourceId }),
        admin_supply_in_flight_tasks_continue_can_be_undone_v_0afe73f2()
      );
      break;
    case 'channel_recover':
      changes.push(
        admin_supply_restore_channel_accept({ resourceId: target.resourceId }),
        admin_supply_restore_does_not_bypass_health_activatio_cb3cd436()
      );
      break;
    case 'drain':
      changes.push(
        admin_supply_start_reversible_drain({ resourceId: target.resourceId }),
        admin_supply_stop_new_tasks_wait_for_async_media_to_f_5b231b85(),
        admin_supply_drain_can_be_cancelled_restored_does_not_d7d6360b()
      );
      break;
    case 'credential_rotate':
      changes.push(
        admin_supply_rotate_credential_append({
          resourceId: target.resourceId,
        }),
        admin_supply_secrets_only_write_to_kms_secretstore_an_a0fc3b64(),
        admin_supply_in_flight_tasks_freeze_the_old_version_b8b05399()
      );
      break;
    case 'pre_revoke_impact_check':
      changes.push(
        admin_supply_preview_revoke_impact({ resourceId: target.resourceId }),
        admin_supply_list_affected_deployment_pool_in_flight_95c204ae(),
        admin_supply_this_action_does_not_perform_revoke_8d5dd5b0()
      );
      break;
    case 'health_balance_refresh':
      changes.push(
        admin_supply_refresh_health_balance({ resourceId: target.resourceId }),
        admin_supply_read_only_refresh_failures_are_explicit_c057cca6()
      );
      break;
  }

  return {
    scope,
    changes,
    reversible: def.reversibleDrain,
    warnings,
  };
}

export function buildGovernedCommand(
  def: GovernedQuickActionDefinition,
  target: GovernedActionTarget,
  reason?: string
): GovernedTypedCommand {
  if (def.requiresReason && !isValidImpactReason(reason ?? '')) {
    throw new Error(
      'Governed action requires a concrete audit reason (≥8 chars).'
    );
  }

  const payload: Record<string, unknown> = {
    targetType: target.resourceType,
    targetId: target.resourceId,
  };
  if (reason) payload.reason = reason.trim();
  if (target.expectedRevisionId) {
    payload.expectedRevisionId = target.expectedRevisionId;
  }
  if (target.idempotencyKey) {
    payload.idempotencyKey = target.idempotencyKey;
  }

  // Action-specific payload shapes (typed Core contract, no secrets).
  switch (def.id) {
    case 'connectivity_probe':
    case 'conformance_probe':
      payload.deploymentId = target.resourceId;
      payload.probeKind =
        def.id === 'conformance_probe' ? 'conformance' : 'connectivity';
      break;
    case 'candidate_config_save':
      payload.routePolicyRevisionId = target.resourceId;
      payload.mode = 'save_candidate';
      break;
    case 'route_simulate':
    case 'candidate_config_validate':
      payload.operation = target.resourceId;
      payload.mode =
        def.id === 'candidate_config_validate' ? 'validate' : 'simulate';
      break;
    case 'publish':
    case 'rollback':
      payload.revisionId = target.resourceId;
      break;
    case 'channel_isolate':
    case 'channel_recover':
    case 'drain':
      payload.channelId = target.resourceId;
      payload.intent =
        def.id === 'drain'
          ? 'drain'
          : def.id === 'channel_recover'
            ? 'recover'
            : 'isolate';
      break;
    case 'credential_rotate':
      // Secret value is NEVER placed on this payload by UI helpers.
      payload.credentialAccountId = target.resourceId;
      payload.rotate = true;
      break;
    case 'pre_revoke_impact_check':
      payload.credentialAccountId = target.resourceId;
      payload.impactCheck = 'pre_revoke';
      break;
    case 'health_balance_refresh':
      payload.subjectId = target.resourceId;
      payload.refresh = ['health', 'balance'];
      break;
  }

  assertNoSecretInPayload(payload);

  return {
    kind: def.kind,
    module: def.module,
    action: def.action,
    payload,
    ...(def.casIdempotency && target.expectedRevisionId
      ? { expectedRevisionId: target.expectedRevisionId }
      : {}),
    ...(def.casIdempotency
      ? {
          idempotencyKey:
            target.idempotencyKey ??
            `${def.id}:${target.resourceId}:${target.expectedRevisionId ?? 'na'}`,
        }
      : {}),
  };
}

export function buildGovernedAuditProjection(input: {
  def: GovernedQuickActionDefinition;
  target: GovernedActionTarget;
  reason: string;
  actorUserId: string;
  actorRole?: string | null;
  correlationId: string;
  before?: unknown | null;
  after?: unknown | null;
  occurredAt?: string;
}): GovernedAuditProjection {
  const permission =
    resolveActionPermission(input.def) ?? input.def.requiredPermission;
  const projection: GovernedAuditProjection = {
    actor: {
      userId: input.actorUserId,
      role: input.actorRole ?? null,
    },
    permission,
    target: {
      kind: input.def.kind,
      module: input.def.module,
      action: input.def.action,
      resourceId: input.target.resourceId,
      resourceType: input.target.resourceType,
    },
    reason: input.reason,
    before: input.before ?? null,
    after: input.after ?? null,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
  assertNoSecretInPayload(projection);
  return projection;
}

/**
 * Full contract pack for one action — used by impact-review-dialog callers
 * and contract tests (command + permission + preview + audit).
 */
export type GovernedActionContractPack = {
  definition: GovernedQuickActionDefinition;
  permission: ProductCapability;
  permissionMatchesRegistry: boolean;
  preview: GovernedImpactPreview;
  command: GovernedTypedCommand;
  audit: GovernedAuditProjection;
  reasonValid: boolean;
};

export function buildGovernedActionContractPack(input: {
  id: GovernedQuickActionId;
  target: GovernedActionTarget;
  reason: string;
  actorUserId?: string;
  correlationId?: string;
  before?: unknown | null;
  after?: unknown | null;
}): GovernedActionContractPack {
  const def = getGovernedQuickAction(input.id);
  const reasonValid = isValidImpactReason(input.reason);
  if (def.requiresReason && !reasonValid) {
    throw new Error(
      'Governed action requires a concrete audit reason (≥8 chars).'
    );
  }

  const registryPermission = requiredP1Capability(
    def.kind,
    def.module,
    def.action
  );
  const permission = registryPermission ?? def.requiredPermission;
  const preview = buildImpactPreview(def, input.target);
  const command = buildGovernedCommand(
    def,
    input.target,
    def.requiresReason ? input.reason : input.reason || undefined
  );
  const audit = buildGovernedAuditProjection({
    def,
    target: input.target,
    reason: input.reason || def.description,
    actorUserId: input.actorUserId ?? 'admin-operator',
    actorRole: 'admin',
    correlationId:
      input.correlationId ?? `qa-${def.id}-${input.target.resourceId}`,
    before: input.before,
    after: input.after,
  });

  return {
    definition: def,
    permission,
    permissionMatchesRegistry:
      registryPermission === null
        ? true
        : registryPermission === def.requiredPermission,
    preview,
    command,
    audit,
    reasonValid,
  };
}

export type GovernedActionsPanelView = {
  actions: Array<{
    id: GovernedQuickActionId;
    label: string;
    description: string;
    permission: ProductCapability;
    requiresImpactPreview: boolean;
    requiresReason: boolean;
    casIdempotency: boolean;
    reversibleDrain: boolean;
  }>;
  forbids: typeof FORBIDS;
  count: number;
};

export function buildGovernedActionsPanelView(): GovernedActionsPanelView {
  return {
    actions: GOVERNED_QUICK_ACTIONS.map((def) => ({
      id: def.id,
      label: def.label,
      description: def.description,
      permission: def.requiredPermission,
      requiresImpactPreview: def.requiresImpactPreview,
      requiresReason: def.requiresReason,
      casIdempotency: def.casIdempotency,
      reversibleDrain: def.reversibleDrain,
    })),
    forbids: FORBIDS,
    count: GOVERNED_QUICK_ACTIONS.length,
  };
}

const FORBIDDEN_SECRET_KEY =
  /"(apiKey|api_key|secret|password|authorization|token|credentialValue|privateKey|value)"\s*:\s*"[^"]{4,}"/i;
const FORBIDDEN_SECRET_VALUE =
  /\bsk-[A-Za-z0-9]{8,}\b|\bBearer\s+[A-Za-z0-9._\-+/=]{8,}\b/i;

function assertNoSecretInPayload(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (json === undefined) return;
  // Opaque secretReference URIs (secret://…) are metadata — allowed.
  // Raw secret key fields / bearer tokens are not.
  if (FORBIDDEN_SECRET_KEY.test(json) || FORBIDDEN_SECRET_VALUE.test(json)) {
    throw new Error('Governed action payload must not echo secrets.');
  }
}
