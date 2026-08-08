/**
 * Ops Console application service (V31-22).
 * Consumes HarnessReleaseService — does not reimplement publish/rollout/diff.
 */

import { createHash, randomUUID } from 'node:crypto';

import type { HarnessReleaseLifecycle } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import type { P1Context } from '../foundation/domain.js';
import {
  HarnessReleaseService,
  type HarnessReleaseStore,
  type PublishHarnessReleaseInput,
} from '../harness/harness-release.js';
import {
  type OpsConsoleAuditAction,
  type OpsConsoleAuditEntry,
  type OpsConsoleAuditStore,
} from './audit.js';
import {
  OPS_KILL_SWITCH_CATALOG,
  OPS_KILL_SWITCH_IDS,
  isOpsKillSwitchId,
} from './kill-switches.js';
import {
  defaultKillSwitchState,
  type OpsCandidateTrial,
  type OpsCandidateTrialStore,
  type OpsKillSwitchStore,
  type OpsRollbackDrillRecord,
  type OpsRollbackDrillStore,
} from './state-stores.js';
import {
  AGENT_TOOL_POLICY_SCHEMA_VERSION,
  type AgentToolPolicyRevision,
  type ToolPolicyStore,
} from './tool-policy.js';

export type {
  OpsCandidateTrial,
  OpsRollbackDrillRecord,
} from './state-stores.js';

export type OpsReleaseListItem = {
  releaseId: string;
  version: number;
  status: HarnessReleaseLifecycle['status'] | 'unknown';
  manifestHash: string;
  createdAt: string;
  updatedAt: string | null;
  workspaceAllowlist: string[];
  approvedBy: string | null;
};

export type OpsWriteMeta = {
  reason: string;
  evidence?: string | null;
  now?: string;
};

export type OpsConsoleServiceDeps = {
  releases: HarnessReleaseService;
  /** Catalog reads (list*) — same store as HarnessReleaseService. */
  catalog: Pick<
    HarnessReleaseStore,
    'listArtifacts' | 'listLifecycles' | 'listRollouts'
  >;
  toolPolicies: ToolPolicyStore;
  audit: OpsConsoleAuditStore;
  killSwitches: OpsKillSwitchStore;
  trials: OpsCandidateTrialStore;
  drills: OpsRollbackDrillStore;
  langfuseBaseUrl?: string | null;
};

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function requireReason(reason: unknown, label: string): string {
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${label} requires a non-empty reason for audit.`,
    );
  }
  return reason.trim();
}

function requireEvidence(evidence: unknown, label: string): string {
  if (typeof evidence !== 'string' || evidence.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${label} requires non-empty evidence for audit.`,
    );
  }
  return evidence.trim();
}

export class OpsConsoleService {
  constructor(private readonly deps: OpsConsoleServiceDeps) {}

  private async audit(
    context: P1Context,
    action: OpsConsoleAuditAction,
    target: string,
    reason: string,
    evidence: string | null,
    detail: Record<string, unknown>,
    now?: string,
  ): Promise<OpsConsoleAuditEntry> {
    return this.deps.audit.append({
      id: randomUUID(),
      action,
      operatorId: context.userId,
      reason,
      evidence,
      target,
      detail,
      createdAt: nowIso(now),
      correlationId: context.correlationId,
    });
  }

  buildLangfuseReleaseUrl(releaseId: string): string | null {
    const base = this.deps.langfuseBaseUrl?.trim().replace(/\/+$/, '');
    if (!base) return null;
    // Fixed entry: filter traces by releaseId tag (V3.1 §30.2).
    const filter = encodeURIComponent(
      JSON.stringify([
        {
          type: 'stringObject',
          column: 'tags',
          operator: 'any of',
          value: [`releaseId:${releaseId}`],
        },
      ]),
    );
    return `${base}/traces?filter=${filter}`;
  }

  async listReleases(): Promise<{
    items: OpsReleaseListItem[];
    production: string | null;
    canary: string | null;
    draft: string[];
  }> {
    const [artifacts, lifecycles, rollouts] = await Promise.all([
      this.deps.catalog.listArtifacts(),
      this.deps.catalog.listLifecycles(),
      this.deps.catalog.listRollouts(),
    ]);
    const lifeById = new Map(lifecycles.map((item) => [item.releaseId, item]));
    const rolloutById = new Map(rollouts.map((item) => [item.releaseId, item]));
    const items: OpsReleaseListItem[] = artifacts
      .map((artifact): OpsReleaseListItem => {
        const life = lifeById.get(artifact.releaseId);
        const rollout = rolloutById.get(artifact.releaseId);
        const status: OpsReleaseListItem['status'] = life?.status ?? 'unknown';
        return {
          releaseId: artifact.releaseId,
          version: artifact.version,
          status,
          manifestHash: artifact.manifestHash,
          createdAt: artifact.createdAt,
          updatedAt: life?.updatedAt ?? null,
          workspaceAllowlist: [...(rollout?.workspaceAllowlist ?? [])],
          approvedBy: life?.approvedBy ?? null,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      items,
      production:
        items.find((item) => item.status === 'production')?.releaseId ?? null,
      canary: items.find((item) => item.status === 'canary')?.releaseId ?? null,
      draft: items
        .filter((item) => item.status === 'draft')
        .map((item) => item.releaseId),
    };
  }

  async getRelease(releaseId: string) {
    const artifact = await this.deps.releases.getExactRelease(releaseId);
    const [artifacts, lifecycles, rollouts] = await Promise.all([
      this.deps.catalog.listArtifacts(),
      this.deps.catalog.listLifecycles(),
      this.deps.catalog.listRollouts(),
    ]);
    void artifacts;
    const lifecycle =
      lifecycles.find((item) => item.releaseId === releaseId) ?? null;
    const rollout =
      rollouts.find((item) => item.releaseId === releaseId) ?? null;
    return {
      artifact,
      lifecycle,
      rollout,
      langfuseUrl: this.buildLangfuseReleaseUrl(releaseId),
    };
  }

  async diffReleases(leftReleaseId: string, rightReleaseId: string) {
    return this.deps.releases.diffReleases(leftReleaseId, rightReleaseId);
  }

  async publishRelease(
    context: P1Context,
    input: PublishHarnessReleaseInput,
    meta: OpsWriteMeta,
  ) {
    const reason = requireReason(meta.reason, 'publish_release');
    const published = await this.deps.releases.publishArtifact(input);
    const entry = await this.audit(
      context,
      'publish_release',
      input.releaseId,
      reason,
      meta.evidence?.trim() || null,
      {
        version: published.artifact.version,
        manifestHash: published.artifact.manifestHash,
      },
      meta.now,
    );
    return { ...published, audit: entry };
  }

  async transitionLifecycle(
    context: P1Context,
    input: {
      releaseId: string;
      toStatus: HarnessReleaseLifecycle['status'];
    },
    meta: OpsWriteMeta,
  ) {
    const reason = requireReason(meta.reason, 'transition_lifecycle');
    const lifecycle = await this.deps.releases.transitionLifecycle({
      releaseId: input.releaseId,
      toStatus: input.toStatus,
      approvedBy: context.userId,
      now: meta.now,
    });
    const entry = await this.audit(
      context,
      'transition_lifecycle',
      input.releaseId,
      reason,
      meta.evidence?.trim() || null,
      { toStatus: input.toStatus },
      meta.now,
    );
    return { lifecycle, audit: entry };
  }

  async setCanaryAllowlist(
    context: P1Context,
    input: {
      releaseId: string;
      workspaceAllowlist: readonly string[];
    },
    meta: OpsWriteMeta,
  ) {
    const reason = requireReason(meta.reason, 'set_canary_allowlist');
    const rollout = await this.deps.releases.updateRollout({
      releaseId: input.releaseId,
      workspaceAllowlist: input.workspaceAllowlist,
      now: meta.now,
    });
    const entry = await this.audit(
      context,
      'set_canary_allowlist',
      input.releaseId,
      reason,
      meta.evidence?.trim() || null,
      { workspaceAllowlist: [...input.workspaceAllowlist] },
      meta.now,
    );
    return { rollout, audit: entry };
  }

  async setCandidateTrial(
    context: P1Context,
    input: {
      workspaceId: string;
      candidateReleaseId: string;
    },
    meta: OpsWriteMeta,
  ) {
    const reason = requireReason(meta.reason, 'set_candidate_trial');
    // Candidate must be a complete immutable artifact (U10).
    await this.deps.releases.getExactRelease(input.candidateReleaseId);
    const trial: OpsCandidateTrial = {
      workspaceId: input.workspaceId,
      candidateReleaseId: input.candidateReleaseId,
      operatorId: context.userId,
      reason,
      updatedAt: nowIso(meta.now),
    };
    const stored = await this.deps.trials.putCandidateTrial(trial);
    const entry = await this.audit(
      context,
      'set_candidate_trial',
      input.workspaceId,
      reason,
      meta.evidence?.trim() || null,
      {
        candidateReleaseId: input.candidateReleaseId,
      },
      meta.now,
    );
    return { trial: stored, audit: entry };
  }

  async listCandidateTrials(): Promise<OpsCandidateTrial[]> {
    return this.deps.trials.listCandidateTrials();
  }

  async promoteToProduction(
    context: P1Context,
    input: { releaseId: string },
    meta: OpsWriteMeta,
  ) {
    // U12: human click only — no auto promotion. scored verdicts are not
    // consulted here; gates are assumed already reviewed outside this action.
    const reason = requireReason(meta.reason, 'promote_to_production');
    const lifecycle = await this.deps.releases.transitionLifecycle({
      releaseId: input.releaseId,
      toStatus: 'production',
      approvedBy: context.userId,
      now: meta.now,
    });
    const entry = await this.audit(
      context,
      'promote_to_production',
      input.releaseId,
      reason,
      meta.evidence?.trim() || null,
      { status: lifecycle.status },
      meta.now,
    );
    return { lifecycle, audit: entry };
  }

  async rollbackProduction(
    context: P1Context,
    input: { toReleaseId: string },
    meta: OpsWriteMeta,
  ) {
    const reason = requireReason(meta.reason, 'rollback_production');
    const evidence = requireEvidence(meta.evidence, 'rollback_production');
    const rolled = await this.deps.releases.rollbackProduction({
      toReleaseId: input.toReleaseId,
      approvedBy: context.userId,
      now: meta.now,
    });
    const entry = await this.audit(
      context,
      'rollback_production',
      input.toReleaseId,
      reason,
      evidence,
      {
        previousProduction: rolled.previousProduction?.releaseId ?? null,
        production: rolled.production.releaseId,
      },
      meta.now,
    );
    return { ...rolled, audit: entry };
  }

  async recordRollbackDrill(
    context: P1Context,
    input: {
      releaseId: string;
      result: 'passed' | 'failed';
      notes?: string | null;
    },
    meta: OpsWriteMeta,
  ) {
    const reason = requireReason(meta.reason, 'record_rollback_drill');
    const evidence = requireEvidence(meta.evidence, 'record_rollback_drill');
    await this.deps.releases.getExactRelease(input.releaseId);
    const record: OpsRollbackDrillRecord = {
      id: randomUUID(),
      releaseId: input.releaseId,
      operatorId: context.userId,
      reason,
      evidence,
      result: input.result,
      notes: input.notes?.trim() || null,
      createdAt: nowIso(meta.now),
    };
    const stored = await this.deps.drills.appendRollbackDrill(record);
    const entry = await this.audit(
      context,
      'record_rollback_drill',
      input.releaseId,
      reason,
      evidence,
      { result: input.result, drillId: stored.id },
      meta.now,
    );
    return { drill: stored, audit: entry };
  }

  async listRollbackDrills(): Promise<OpsRollbackDrillRecord[]> {
    return this.deps.drills.listRollbackDrills();
  }

  async createToolPolicyRevision(
    context: P1Context,
    input: Omit<
      AgentToolPolicyRevision,
      'schemaVersion' | 'createdAt' | 'createdBy'
    >,
    meta: OpsWriteMeta,
  ) {
    const reason = requireReason(meta.reason, 'create_tool_policy_revision');
    const policy: AgentToolPolicyRevision = {
      schemaVersion: AGENT_TOOL_POLICY_SCHEMA_VERSION,
      toolName: input.toolName,
      revision: input.revision,
      description: input.description,
      sideEffect: input.sideEffect,
      riskClass: input.riskClass,
      approval: input.approval,
      allowedPhases: input.allowedPhases,
      dataClasses: input.dataClasses,
      maxCallsPerRun: input.maxCallsPerRun,
      timeoutMs: input.timeoutMs,
      recentDenialReasons: input.recentDenialReasons ?? [],
      createdAt: nowIso(meta.now),
      createdBy: context.userId,
    };
    let stored: AgentToolPolicyRevision;
    try {
      stored = await this.deps.toolPolicies.putRevisionImmutable(policy);
    } catch (error) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        error instanceof Error
          ? error.message
          : 'Tool policy revision is immutable.',
      );
    }
    const entry = await this.audit(
      context,
      'create_tool_policy_revision',
      `${policy.toolName}@${policy.revision}`,
      reason,
      meta.evidence?.trim() || null,
      { toolName: policy.toolName, revision: policy.revision },
      meta.now,
    );
    return { policy: stored, audit: entry };
  }

  /**
   * Constructive block: there is no update/patch API for an existing
   * production-pinned (or any) tool policy revision.
   */
  async updateToolPolicyInPlace(): Promise<never> {
    throw new P1DomainError(
      'INVALID_STATE',
      'In-place mutation of tool policy is forbidden. Create a new revision and pin it via a new HarnessRelease.',
    );
  }

  async listToolPolicies() {
    const tools = await this.deps.toolPolicies.listTools();
    const production = await this.listReleases();
    let productionToolPolicyRevision: string | null = null;
    if (production.production) {
      const release = await this.deps.releases.getExactRelease(
        production.production,
      );
      productionToolPolicyRevision = release.toolPolicyRevision;
    }
    const items = [];
    for (const toolName of tools) {
      const revisions = await this.deps.toolPolicies.listByTool(toolName);
      items.push({
        toolName,
        revisions,
        productionPinned:
          productionToolPolicyRevision !== null &&
          revisions.some(
            (revision) => revision.revision === productionToolPolicyRevision,
          ),
      });
    }
    return {
      items,
      productionToolPolicyRevision,
    };
  }

  async getToolPolicy(toolName: string, revision: string) {
    const policy = await this.deps.toolPolicies.getRevision(toolName, revision);
    if (!policy) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Tool policy ${toolName}@${revision} was not found.`,
      );
    }
    return policy;
  }

  async listKillSwitches() {
    const states = await this.deps.killSwitches.listKillSwitches();
    const byId = new Map(states.map((state) => [state.switchId, state]));
    return OPS_KILL_SWITCH_IDS.map((switchId) => {
      const catalog = OPS_KILL_SWITCH_CATALOG[switchId];
      const state = byId.get(switchId) ?? defaultKillSwitchState(switchId);
      return {
        switchId,
        landed: catalog.landed,
        providerTicket: catalog.providerTicket,
        impactScope: catalog.impactScope,
        enabled: state.enabled,
        updatedAt: state.updatedAt,
        updatedBy: state.updatedBy,
        reason: state.reason,
        /** Unlanded switches cannot be enabled from this panel. */
        canEnable: catalog.landed,
        unavailableReason: catalog.landed
          ? null
          : '提供方票未落地',
      };
    });
  }

  async setKillSwitch(
    context: P1Context,
    input: { switchId: string; enabled: boolean },
    meta: OpsWriteMeta,
  ) {
    const reason = requireReason(meta.reason, 'set_kill_switch');
    if (!isOpsKillSwitchId(input.switchId)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Unknown kill switch ${input.switchId}.`,
      );
    }
    const catalog = OPS_KILL_SWITCH_CATALOG[input.switchId];
    if (input.enabled && !catalog.landed) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Kill switch ${input.switchId} 提供方票未落地 (${catalog.providerTicket}); cannot enable.`,
      );
    }
    const state = await this.deps.killSwitches.putKillSwitch({
      switchId: input.switchId,
      enabled: input.enabled,
      updatedAt: nowIso(meta.now),
      updatedBy: context.userId,
      reason,
    });
    const entry = await this.audit(
      context,
      'set_kill_switch',
      input.switchId,
      reason,
      meta.evidence?.trim() || null,
      { enabled: input.enabled },
      meta.now,
    );
    return { switch: state, audit: entry };
  }

  async listAudit(limit = 100) {
    return this.deps.audit.list(limit);
  }
}

/** Stable hash helper for idempotency-friendly tool policy drafts (tests). */
export function hashToolPolicyDraft(
  draft: Omit<
    AgentToolPolicyRevision,
    'schemaVersion' | 'createdAt' | 'createdBy' | 'revision'
  >,
): string {
  return createHash('sha256')
    .update(JSON.stringify(draft))
    .digest('hex')
    .slice(0, 16);
}
