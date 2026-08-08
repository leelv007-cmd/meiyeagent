/**
 * Tool Policy revision store (V31-22 / V3.1 §20.1 / §30.1).
 *
 * Edits only create new immutable revisions. A revision becomes production-
 * effective only when a new HarnessRelease pins its toolPolicyRevision.
 * In-place mutation of any existing revision (especially production-pinned)
 * is constructively blocked.
 */

export const AGENT_TOOL_POLICY_SCHEMA_VERSION = 'agent-tool-policy/v1' as const;

export type AgentToolSideEffect = 'none' | 'internal_write' | 'paid' | 'external';
export type AgentToolRiskClass =
  | 'read'
  | 'reversible'
  | 'sensitive'
  | 'irreversible';
export type AgentToolApproval = 'never' | 'policy' | 'merchant' | 'admin';
export type AgentToolPhase = 'intent' | 'plan' | 'make' | 'delivery';

export type AgentToolPolicyRevision = {
  schemaVersion: typeof AGENT_TOOL_POLICY_SCHEMA_VERSION;
  /** Stable tool identity. */
  toolName: string;
  /** Immutable revision id (also used as HarnessRelease.toolPolicyRevision pin). */
  revision: string;
  description: string;
  sideEffect: AgentToolSideEffect;
  riskClass: AgentToolRiskClass;
  approval: AgentToolApproval;
  allowedPhases: AgentToolPhase[];
  dataClasses: string[];
  maxCallsPerRun: number;
  timeoutMs: number;
  /** Recent denial reason samples (ops-facing). */
  recentDenialReasons: string[];
  createdAt: string;
  createdBy: string;
};

export interface ToolPolicyStore {
  putRevisionImmutable(
    policy: AgentToolPolicyRevision,
  ): Promise<AgentToolPolicyRevision>;
  getRevision(
    toolName: string,
    revision: string,
  ): Promise<AgentToolPolicyRevision | null>;
  listByTool(toolName: string): Promise<AgentToolPolicyRevision[]>;
  listTools(): Promise<string[]>;
}

export class MemoryToolPolicyStore implements ToolPolicyStore {
  private readonly byKey = new Map<string, AgentToolPolicyRevision>();

  private key(toolName: string, revision: string) {
    return `${toolName}::${revision}`;
  }

  async putRevisionImmutable(
    policy: AgentToolPolicyRevision,
  ): Promise<AgentToolPolicyRevision> {
    const k = this.key(policy.toolName, policy.revision);
    const existing = this.byKey.get(k);
    if (existing) {
      throw new Error(
        `Tool policy revision ${policy.toolName}@${policy.revision} is immutable; create a new revision instead of in-place update.`,
      );
    }
    const copy = structuredClone(policy);
    this.byKey.set(k, copy);
    return structuredClone(copy);
  }

  async getRevision(
    toolName: string,
    revision: string,
  ): Promise<AgentToolPolicyRevision | null> {
    const value = this.byKey.get(this.key(toolName, revision));
    return value ? structuredClone(value) : null;
  }

  async listByTool(toolName: string): Promise<AgentToolPolicyRevision[]> {
    return [...this.byKey.values()]
      .filter((item) => item.toolName === toolName)
      .map((item) => structuredClone(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listTools(): Promise<string[]> {
    return [...new Set([...this.byKey.values()].map((item) => item.toolName))].sort();
  }
}
