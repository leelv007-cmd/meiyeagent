/**
 * Ops-console write audit (V31-22 / V3.1 §30.1).
 * Every publish / promote / canary / trial / rollback / kill-switch / tool-policy
 * write leaves operator + time + reason (and evidence when required).
 */

export type OpsConsoleAuditAction =
  | 'publish_release'
  | 'transition_lifecycle'
  | 'set_canary_allowlist'
  | 'set_candidate_trial'
  | 'promote_to_production'
  | 'rollback_production'
  | 'record_rollback_drill'
  | 'create_tool_policy_revision'
  | 'set_kill_switch'
  /** V31-13: shadow deterministic-field mismatch (evidence only). */
  | 'shadow_reconciliation_mismatch'
  /** V31-13: shadow program close (timebox or early mismatch=0). */
  | 'close_shadow_reconciliation'
  | 'record_legacy_no_history_proof';

export type OpsConsoleAuditEntry = {
  id: string;
  action: OpsConsoleAuditAction;
  operatorId: string;
  reason: string;
  evidence: string | null;
  target: string;
  detail: Record<string, unknown>;
  createdAt: string;
  correlationId: string;
};

export interface OpsConsoleAuditStore {
  append(entry: OpsConsoleAuditEntry): Promise<OpsConsoleAuditEntry>;
  list(limit?: number): Promise<OpsConsoleAuditEntry[]>;
}

export class MemoryOpsConsoleAuditStore implements OpsConsoleAuditStore {
  private readonly entries: OpsConsoleAuditEntry[] = [];

  async append(entry: OpsConsoleAuditEntry): Promise<OpsConsoleAuditEntry> {
    const copy = structuredClone(entry);
    this.entries.unshift(copy);
    return structuredClone(copy);
  }

  async list(limit = 100): Promise<OpsConsoleAuditEntry[]> {
    return this.entries.slice(0, limit).map((entry) => structuredClone(entry));
  }
}
