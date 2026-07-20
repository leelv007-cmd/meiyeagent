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
  'candidate_config_validate',
  'route_simulate',
  'publish',
  'rollback',
  'channel_isolate',
  'channel_recover',
  'stop_new_tasks',
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
export const GOVERNED_QUICK_ACTIONS: readonly GovernedQuickActionDefinition[] = [
  {
    id: 'connectivity_probe',
    label: '连通探针',
    description: '对 Deployment/凭据发起连通探针（非激活）',
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
    label: 'Conformance 探针',
    description: '运行模态 conformance 探针并记录证据',
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
    id: 'candidate_config_validate',
    label: '候选配置验证',
    description: '验证候选 RoutePolicy / Deployment 配置（不发布）',
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
    label: '路由模拟',
    description: '硬过滤/排序/实时排除/成本/接受态共用解释投影',
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
    label: '发布',
    description: '发布 catalog / route policy revision（经发布门）',
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
    label: '回滚',
    description: '回滚到已知 revision（新 revision，不原地覆盖）',
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
    label: '渠道隔离',
    description: '隔离 ExecutionChannel / Deployment，停止新流量',
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
    label: '渠道恢复',
    description: '从隔离/排空恢复渠道接收任务',
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
    id: 'stop_new_tasks',
    label: '停止接收新任务',
    description: '渠道停止接单（在途任务继续；可恢复）',
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
    id: 'drain',
    label: '排空',
    description: '可逆排空：停新任务，等待异步媒体完成后退役/轮换',
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
    label: '凭据轮换',
    description: '写入新 secret reference 并追加版本（不回显密钥）',
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
    label: '撤销前影响检查',
    description: '撤销/退役前预览受影响 Deployment、池与在途任务',
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
    label: '健康/余额刷新',
    description: '刷新健康 overlay 与余额/限额证据（只读副作用）',
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
  GOVERNED_QUICK_ACTIONS.map((action) => [action.id, action]),
);

export function getGovernedQuickAction(
  id: GovernedQuickActionId,
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
  def: GovernedQuickActionDefinition,
): ProductCapability | null {
  const fromRegistry = requiredP1Capability(def.kind, def.module, def.action);
  return fromRegistry ?? def.requiredPermission;
}

export function buildImpactPreview(
  def: GovernedQuickActionDefinition,
  target: GovernedActionTarget,
): GovernedImpactPreview {
  const scope = `${def.label} → ${target.resourceType}:${target.resourceId}`;
  const changes: string[] = [];
  const warnings: string[] = [
    '不暴露密钥原值',
    '不直写数据库',
    '不绕过发布门',
    '不对 accepted / acceptance_unknown 媒体任务盲目重试',
  ];

  switch (def.id) {
    case 'connectivity_probe':
    case 'conformance_probe':
      changes.push(
        `对 ${target.resourceId} 发起探针并写入证据`,
        '探针通过 ≠ 模型激活',
        '结果规范化，不记录上游 Authorization / 完整 endpoint',
      );
      break;
    case 'candidate_config_validate':
      changes.push(
        '验证候选配置与硬过滤/数据政策',
        '不改变生效 RoutePolicy / Catalog head',
      );
      break;
    case 'route_simulate':
      changes.push(
        '运行路由模拟（硬过滤/排序/实时排除/成本/接受态）',
        '与任务审计共用解释投影',
      );
      break;
    case 'publish':
      changes.push(
        `CAS 发布 revision ${target.expectedRevisionId ?? target.resourceId}`,
        '仅新执行生效；历史 revision 保留',
        '审计写入 actor / reason / before-after',
      );
      warnings.push('必须通过发布门；不足双渠道不得标 multi-channel ready');
      break;
    case 'rollback':
      changes.push(
        `回滚到已知 revision ${target.resourceId}`,
        '通过发布新 revision 完成，不原地覆盖',
      );
      break;
    case 'channel_isolate':
    case 'stop_new_tasks':
      changes.push(
        `隔离/停新任务：${target.resourceId}`,
        '在途任务继续；可经恢复动作撤销',
      );
      break;
    case 'channel_recover':
      changes.push(
        `恢复渠道 ${target.resourceId} 接收新任务`,
        '恢复不绕过健康/激活证据门',
      );
      break;
    case 'drain':
      changes.push(
        `开始可逆排空：${target.resourceId}`,
        '停止新任务；等待异步媒体完成',
        '排空可取消/恢复，不静默换凭据',
      );
      break;
    case 'credential_rotate':
      changes.push(
        `轮换凭据 ${target.resourceId}：追加版本快照`,
        'secret 只写 KMS/SecretStore，永不回显',
        '运行中任务冻结旧版本',
      );
      break;
    case 'pre_revoke_impact_check':
      changes.push(
        `预览撤销 ${target.resourceId} 的影响面`,
        '列出受影响 Deployment / Pool / 在途任务',
        '本动作不执行撤销',
      );
      break;
    case 'health_balance_refresh':
      changes.push(
        `刷新 ${target.resourceId} 健康/余额证据`,
        '只读刷新；失败显式 unknown/stale',
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
  reason?: string,
): GovernedTypedCommand {
  if (def.requiresReason && !isValidImpactReason(reason ?? '')) {
    throw new Error(
      'Governed action requires a concrete audit reason (≥8 chars).',
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
    case 'route_simulate':
    case 'candidate_config_validate':
      payload.operation = target.resourceId;
      payload.mode = def.id === 'candidate_config_validate' ? 'validate' : 'simulate';
      break;
    case 'publish':
    case 'rollback':
      payload.revisionId = target.resourceId;
      break;
    case 'channel_isolate':
    case 'channel_recover':
    case 'stop_new_tasks':
    case 'drain':
      payload.channelId = target.resourceId;
      payload.intent =
        def.id === 'stop_new_tasks'
          ? 'stop_new_tasks'
          : def.id === 'drain'
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
    throw new Error('Governed action requires a concrete audit reason (≥8 chars).');
  }

  const registryPermission = requiredP1Capability(
    def.kind,
    def.module,
    def.action,
  );
  const permission = registryPermission ?? def.requiredPermission;
  const preview = buildImpactPreview(def, input.target);
  const command = buildGovernedCommand(
    def,
    input.target,
    def.requiresReason ? input.reason : input.reason || undefined,
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
