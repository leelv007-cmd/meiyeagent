/**
 * V3.1 feature-flag / kill-switch inventory + flip contract (V31-26a / §41).
 *
 * Every landed control declares:
 *  - canonical writer
 *  - legacy fallback
 *  - flip path (admin-config and/or ops-console)
 *  - delete condition
 *
 * Runtime readers vary by provider ticket; kill switches that runtime hot-reads
 * from admin-config are dual-written when flipped via ops-console set_kill_switch.
 */

import type { OpsKillSwitchId } from './kill-switches.js';

export type V31FlagControlKind = 'feature_flag' | 'kill_switch';

export type V31FlagFlipPath =
  | 'admin_config'
  | 'ops_console_kill_switch'
  | 'ops_console_and_admin_config_mirror';

export type V31FlagCatalogEntry = {
  key: string;
  kind: V31FlagControlKind;
  batch: 1 | 2 | 3 | 4 | 5 | 6 | 'parallel';
  landed: boolean;
  providerTicket: string;
  flipPath: V31FlagFlipPath | null;
  canonicalWriter: string;
  legacyFallback: string;
  deleteCondition: string;
  /** When flipPath includes admin_config mirror, runtime reads this scope. */
  adminConfigScope?: 'global' | 'workspace';
  defaultWhenUnset: 'on' | 'off';
};

/**
 * Landed + planned V3.1 controls (plan §41). Unlanded entries stay listed so
 * ops can see what is still missing a runtime hook.
 */
export const V31_FEATURE_FLAG_CATALOG: readonly V31FlagCatalogEntry[] = [
  {
    key: 'agent_semantic_event_adapter_v1',
    kind: 'feature_flag',
    batch: 1,
    landed: true,
    providerTicket: 'V31-03',
    flipPath: 'admin_config',
    canonicalWriter: 'AgentSemanticEventProjector',
    legacyFallback:
      'When false/unset, zero projector writes; workflow SSE unchanged.',
    deleteCondition:
      'Zero active agent.* SSE readers + zero workspaces with flag true for retention window.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'off',
  },
  {
    key: 'agent_thread_v1',
    kind: 'feature_flag',
    batch: 1,
    landed: false,
    providerTicket: 'V31-02',
    flipPath: null,
    canonicalWriter: 'AgentSession (planned)',
    legacyFallback: 'Thread APIs always-on once V31-02 shipped persistence.',
    deleteCondition: 'N/A until registered as hot-read gate.',
    defaultWhenUnset: 'on',
  },
  {
    key: 'agent_run_v1',
    kind: 'feature_flag',
    batch: 1,
    landed: false,
    providerTicket: 'V31-02',
    flipPath: null,
    canonicalWriter: 'AgentSession (planned)',
    legacyFallback: 'Run APIs always-on once V31-02 shipped persistence.',
    deleteCondition: 'N/A until registered as hot-read gate.',
    defaultWhenUnset: 'on',
  },
  {
    key: 'progressive_plan_v1',
    kind: 'feature_flag',
    batch: 2,
    landed: false,
    providerTicket: 'V31-08',
    flipPath: null,
    canonicalWriter: 'ProgressiveLevels (planned gate)',
    legacyFallback: 'Level path currently always evaluated.',
    deleteCondition: 'N/A until registered.',
    defaultWhenUnset: 'on',
  },
  {
    key: 'agent_kernel_v1',
    kind: 'feature_flag',
    batch: 2,
    landed: false,
    providerTicket: 'V31-06',
    flipPath: null,
    canonicalWriter: 'AgentKernel (planned gate)',
    legacyFallback: 'Kernel path currently always assembled when session lands.',
    deleteCondition: 'N/A until registered.',
    defaultWhenUnset: 'on',
  },
  {
    key: 'compiled_execution_plan_produce_v1',
    kind: 'feature_flag',
    batch: 2,
    landed: false,
    providerTicket: 'V31-09',
    flipPath: null,
    canonicalWriter: 'PlanCompiler (planned gate)',
    legacyFallback: 'Compiler currently always produces when session plans.',
    deleteCondition: 'N/A until registered.',
    defaultWhenUnset: 'on',
  },
  {
    key: 'execution_plan_snapshot_v1',
    kind: 'feature_flag',
    batch: 3,
    landed: false,
    providerTicket: 'V31-12',
    flipPath: null,
    canonicalWriter: 'ExecutionPlanAdmission (planned gate)',
    legacyFallback: 'Admission always writes snapshot when snapshot path admits.',
    deleteCondition: 'N/A until registered.',
    defaultWhenUnset: 'on',
  },
  {
    key: 'compiled_execution_plan_consume_v1',
    kind: 'feature_flag',
    batch: 3,
    landed: false,
    providerTicket: 'V31-14',
    flipPath: null,
    canonicalWriter: 'Make snapshot consume (planned gate)',
    legacyFallback:
      'Consume path uses snapshot when present; force_legacy_five_stage is the kill switch.',
    deleteCondition: 'N/A until registered; use force_legacy_five_stage for rollback.',
    defaultWhenUnset: 'on',
  },
  {
    key: 'make_steering_v1',
    kind: 'feature_flag',
    batch: 4,
    landed: true,
    providerTicket: 'V31-16',
    flipPath: 'admin_config',
    canonicalWriter: 'SteeringService',
    legacyFallback: 'When false, steering submits recorded as disabled.',
    deleteCondition: 'Zero mid-run steering consumers for retention window.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'on',
  },
  {
    key: 'agent_memory_read_v1',
    kind: 'feature_flag',
    batch: 'parallel',
    landed: true,
    providerTicket: 'V31-18',
    flipPath: 'admin_config',
    canonicalWriter: 'AgentMemoryPlatform',
    legacyFallback: 'When false, memory injection/read disabled.',
    deleteCondition: 'Memory platform retired or always-on policy adopted.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'on',
  },
  {
    key: 'agent_memory_candidate_write_v1',
    kind: 'feature_flag',
    batch: 'parallel',
    landed: true,
    providerTicket: 'V31-18',
    flipPath: 'admin_config',
    canonicalWriter: 'AgentMemoryPlatform',
    legacyFallback: 'When false, candidate writes disabled.',
    deleteCondition: 'Memory platform retired or always-on policy adopted.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'on',
  },
  {
    key: 'marketing_goal_v1',
    kind: 'feature_flag',
    batch: 6,
    landed: true,
    providerTicket: 'V31-24',
    flipPath: 'admin_config',
    canonicalWriter: 'ProactiveService / GoalService',
    legacyFallback: 'When false, goal product surface disabled.',
    deleteCondition: 'Goal product retired.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'on',
  },
  {
    key: 'proactive_opportunity_v1',
    kind: 'feature_flag',
    batch: 6,
    landed: true,
    providerTicket: 'V31-24',
    flipPath: 'admin_config',
    canonicalWriter: 'ProactiveService',
    legacyFallback:
      'Workspace allowlist; when unset/false, pilot allowlist closed.',
    deleteCondition: 'Proactive retired or coverage threshold sole gate.',
    adminConfigScope: 'workspace',
    defaultWhenUnset: 'off',
  },
  // Kill switches
  {
    key: 'disable_agent_planning',
    kind: 'kill_switch',
    batch: 2,
    landed: false,
    providerTicket: 'V31-06/V31-09',
    flipPath: 'ops_console_kill_switch',
    canonicalWriter: 'ops-console panel (runtime hook not landed)',
    legacyFallback: 'Cannot enable until provider lands.',
    deleteCondition: 'After planning path sole and stable.',
    defaultWhenUnset: 'off',
  },
  {
    key: 'force_manual_plan_confirmation',
    kind: 'kill_switch',
    batch: 3,
    landed: false,
    providerTicket: 'V31-11',
    flipPath: 'ops_console_kill_switch',
    canonicalWriter: 'ops-console panel (runtime hook not landed)',
    legacyFallback: 'Cannot enable until provider lands.',
    deleteCondition: 'After confirmation coverage sole.',
    defaultWhenUnset: 'off',
  },
  {
    key: 'force_legacy_five_stage',
    kind: 'kill_switch',
    batch: 3,
    landed: true,
    providerTicket: 'V31-14',
    flipPath: 'ops_console_kill_switch',
    canonicalWriter: 'ops-console kill switch store → Make resolveForceLegacyFiveStage',
    legacyFallback:
      'When true, Make keeps legacy five-stage LLM path (V31-26b deletes last).',
    deleteCondition:
      'V31-26b after pilot + U14 archive + hold buffer; last flag to delete.',
    defaultWhenUnset: 'off',
  },
  {
    key: 'disable_make_steering',
    kind: 'kill_switch',
    batch: 4,
    landed: true,
    providerTicket: 'V31-16',
    flipPath: 'ops_console_and_admin_config_mirror',
    canonicalWriter:
      'ops-console set_kill_switch dual-writes admin-config; SteeringService hot-reads admin-config',
    legacyFallback: 'When true, mid-run steering disabled.',
    deleteCondition: 'After steering sole path stable or product retires steering.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'off',
  },
  {
    key: 'disable_memory_write',
    kind: 'kill_switch',
    batch: 'parallel',
    landed: true,
    providerTicket: 'V31-18',
    flipPath: 'ops_console_and_admin_config_mirror',
    canonicalWriter:
      'ops-console set_kill_switch dual-writes admin-config; AgentMemoryPlatform hot-reads admin-config',
    legacyFallback: 'When true, memory candidate writes blocked.',
    deleteCondition: 'Memory platform retired.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'off',
  },
  {
    key: 'disable_memory_read',
    kind: 'kill_switch',
    batch: 'parallel',
    landed: true,
    providerTicket: 'V31-18',
    flipPath: 'ops_console_and_admin_config_mirror',
    canonicalWriter:
      'ops-console set_kill_switch dual-writes admin-config; AgentMemoryPlatform hot-reads admin-config',
    legacyFallback: 'When true, memory reads/injection blocked.',
    deleteCondition: 'Memory platform retired.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'off',
  },
  {
    key: 'disable_proactive_agent',
    kind: 'kill_switch',
    batch: 6,
    landed: true,
    providerTicket: 'V31-24',
    flipPath: 'ops_console_and_admin_config_mirror',
    canonicalWriter:
      'ops-console set_kill_switch dual-writes admin-config; ProactiveService hot-reads admin-config',
    legacyFallback: 'When true, proactive proposals stop.',
    deleteCondition: 'Proactive product retired.',
    adminConfigScope: 'global',
    defaultWhenUnset: 'off',
  },
] as const;

/** Kill switches whose runtime reader is admin-config — must dual-write on flip. */
export const V31_KILL_SWITCHES_MIRROR_TO_ADMIN_CONFIG = new Set<OpsKillSwitchId>(
  V31_FEATURE_FLAG_CATALOG.filter(
    (entry) =>
      entry.kind === 'kill_switch' &&
      entry.flipPath === 'ops_console_and_admin_config_mirror' &&
      entry.landed,
  ).map((entry) => entry.key as OpsKillSwitchId),
);

export function listLandedV31Flags(): V31FlagCatalogEntry[] {
  return V31_FEATURE_FLAG_CATALOG.filter((entry) => entry.landed);
}

export function getV31FlagCatalogEntry(
  key: string,
): V31FlagCatalogEntry | undefined {
  return V31_FEATURE_FLAG_CATALOG.find((entry) => entry.key === key);
}

/**
 * Port used by OpsConsoleService.setKillSwitch to mirror admin-config-backed
 * kill switches so ops panel flips reach runtime hot-reads.
 */
export type KillSwitchAdminConfigMirror = {
  applyBoolean(input: {
    key: string;
    value: boolean;
    actorId: string;
    reason: string;
    correlationId: string;
  }): Promise<void>;
  getBoolean(key: string): Promise<boolean | null>;
};

/** In-memory mirror for flip/rollback drill tests. */
export class MemoryKillSwitchAdminConfigMirror
  implements KillSwitchAdminConfigMirror
{
  private readonly values = new Map<string, boolean>();
  private readonly history: Array<{
    key: string;
    value: boolean;
    reason: string;
  }> = [];

  async applyBoolean(input: {
    key: string;
    value: boolean;
    actorId: string;
    reason: string;
    correlationId: string;
  }): Promise<void> {
    void input.actorId;
    void input.correlationId;
    this.values.set(input.key, input.value);
    this.history.push({
      key: input.key,
      value: input.value,
      reason: input.reason,
    });
  }

  async getBoolean(key: string): Promise<boolean | null> {
    if (!this.values.has(key)) return null;
    return this.values.get(key) ?? null;
  }

  snapshotHistory() {
    return [...this.history];
  }
}
