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
import {
  evaluateLegacyReplayArchiveGate,
  LEGACY_REPLAY_DEFAULT_OPS_BUFFER_DAYS,
  LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS,
  type LegacyReplayArchiveGateResult,
  type LegacyReplayInventoryPort,
  type LegacyReplayInventorySnapshot,
} from './legacy-replay-archive-gate.js';
import {
  listLandedV31Flags,
  V31_FEATURE_FLAG_CATALOG,
  V31_KILL_SWITCHES_MIRROR_TO_ADMIN_CONFIG,
  type KillSwitchAdminConfigMirror,
  type V31FlagCatalogEntry,
} from './v31-feature-flags.js';

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

export async function resolveWorkspaceHarnessRelease(input: {
  workspaceId: string;
  releases: HarnessReleaseService;
  trials: OpsCandidateTrialStore;
}) {
  const trial = await input.trials.getCandidateTrial(input.workspaceId);
  return input.releases.resolveForRun({
    workspaceId: input.workspaceId,
    ...(trial ? { candidateReleaseId: trial.candidateReleaseId } : {}),
  });
}

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
  /**
   * V31-26a / U14: inventory of active/pending legacy durable tasks.
   * Production wires PostgresLegacyReplayInventory; Memory for tests.
   * Absent ⇒ archive gate fails closed (inventory unavailable).
   */
  legacyReplayInventory?: LegacyReplayInventoryPort | null;
  /**
   * V31-26a: dual-write admin-config for kill switches whose runtime
   * hot-read is admin-config (not the ops kill-switch store).
   */
  killSwitchAdminConfigMirror?: KillSwitchAdminConfigMirror | null;
  /** Ops policy buffer days after 30d hold (U14). Default 7. */
  resolveLegacyReplayOpsBufferDays?: () =>
    | number
    | Promise<number>;
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

    // V31-26a: dual-write admin-config so ops panel flips reach runtime hot-reads.
    let adminConfigMirrored = false;
    if (
      V31_KILL_SWITCHES_MIRROR_TO_ADMIN_CONFIG.has(input.switchId) &&
      this.deps.killSwitchAdminConfigMirror
    ) {
      await this.deps.killSwitchAdminConfigMirror.applyBoolean({
        key: input.switchId,
        value: input.enabled,
        actorId: context.userId,
        reason,
        correlationId: context.correlationId,
      });
      adminConfigMirrored = true;
    }

    const entry = await this.audit(
      context,
      'set_kill_switch',
      input.switchId,
      reason,
      meta.evidence?.trim() || null,
      { enabled: input.enabled, adminConfigMirrored },
      meta.now,
    );
    return { switch: state, audit: entry, adminConfigMirrored };
  }

  async listAudit(limit = 100) {
    return this.deps.audit.list(limit);
  }

  /**
   * V31-26a / U14: read-only archive condition gate.
   * Fail closed when inventory or audit is unavailable.
   */
  async legacyReplayArchiveGate(input?: {
    now?: string;
  }): Promise<{
    gate: LegacyReplayArchiveGateResult;
    inventory: LegacyReplayInventorySnapshot | null;
  }> {
    const inventoryPort = this.deps.legacyReplayInventory;
    if (!inventoryPort) {
      const gate = evaluateLegacyReplayArchiveGate({
        inventory: {
          activePendingCount: Number.POSITIVE_INFINITY,
          oldestActiveCreatedAt: null,
          sampleTaskIds: [],
          lastLegacyTerminalAt: null,
        },
        now: nowIso(input?.now),
        rollbackDrillPassed: false,
        auditExportAvailable: false,
        maxHoldWindowDays: LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS,
        opsPolicyBufferDays: LEGACY_REPLAY_DEFAULT_OPS_BUFFER_DAYS,
      });
      // Force fail-closed messaging when inventory is not wired.
      return {
        gate: {
          ...gate,
          archiveAllowed: false,
          blockingReasons: [
            'Legacy replay inventory port is not wired in assembly; fail closed.',
            ...gate.blockingReasons,
          ],
          conditions: {
            ...gate.conditions,
            zeroActivePendingLegacy: {
              ok: false,
              count: -1,
              detail:
                'Inventory port missing — cannot prove zero active/pending legacy.',
            },
            auditExportAvailable: {
              ok: false,
              detail: 'Inventory port missing — audit export not evaluated.',
            },
          },
        },
        inventory: null,
      };
    }

    let inventory: LegacyReplayInventorySnapshot;
    try {
      inventory = await inventoryPort.snapshot();
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : 'inventory snapshot failed';
      return {
        gate: {
          archiveAllowed: false,
          evaluatedAt: nowIso(input?.now),
          conditions: {
            zeroActivePendingLegacy: {
              ok: false,
              count: -1,
              detail: `Inventory snapshot failed; fail closed (${detail}).`,
            },
            holdWindowComplete: {
              ok: false,
              detail: 'Inventory snapshot failed; fail closed.',
            },
            auditExportAvailable: {
              ok: false,
              detail: 'Inventory snapshot failed; fail closed.',
            },
            rollbackProofPresent: {
              ok: false,
              detail: 'Inventory snapshot failed; fail closed.',
            },
            opsPolicyBufferComplete: {
              ok: false,
              detail: 'Inventory snapshot failed; fail closed.',
            },
          },
          blockingReasons: [
            `Legacy replay inventory snapshot failed; fail closed (${detail}).`,
          ],
        },
        inventory: null,
      };
    }

    const drills = await this.deps.drills.listRollbackDrills();
    const rollbackDrillPassed = drills.some((drill) => drill.result === 'passed');
    // Audit store is always present on the service; list is the export primitive.
    let auditExportAvailable = false;
    try {
      await this.deps.audit.list(1);
      auditExportAvailable = true;
    } catch {
      auditExportAvailable = false;
    }

    let opsPolicyBufferDays: number = LEGACY_REPLAY_DEFAULT_OPS_BUFFER_DAYS;
    if (this.deps.resolveLegacyReplayOpsBufferDays) {
      const resolved = await this.deps.resolveLegacyReplayOpsBufferDays();
      if (
        typeof resolved === 'number' &&
        Number.isFinite(resolved) &&
        resolved >= 0
      ) {
        opsPolicyBufferDays = Math.floor(resolved);
      }
    }

    const gate = evaluateLegacyReplayArchiveGate({
      inventory,
      now: nowIso(input?.now),
      rollbackDrillPassed,
      auditExportAvailable,
      maxHoldWindowDays: LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS,
      opsPolicyBufferDays,
    });
    return { gate, inventory };
  }

  /**
   * V31-26a: read-only audit export for archive/rollback evidence.
   * Returns recent ops audit + rollback drills + current gate snapshot.
   */
  async exportLegacyReplayAudit(input?: {
    limit?: number;
    now?: string;
  }): Promise<{
    exportedAt: string;
    audit: OpsConsoleAuditEntry[];
    rollbackDrills: OpsRollbackDrillRecord[];
    gate: LegacyReplayArchiveGateResult;
    inventory: LegacyReplayInventorySnapshot | null;
  }> {
    const limit =
      typeof input?.limit === 'number' && input.limit > 0
        ? Math.min(input.limit, 500)
        : 200;
    const audit = await this.deps.audit.list(limit);
    const rollbackDrills = await this.deps.drills.listRollbackDrills();
    const { gate, inventory } = await this.legacyReplayArchiveGate({
      now: input?.now,
    });
    return {
      exportedAt: nowIso(input?.now),
      audit,
      rollbackDrills,
      gate,
      inventory,
    };
  }

  /** V31-26a: list all known V3.1 flags/switches with flip metadata. */
  listV31FeatureFlags(): {
    items: V31FlagCatalogEntry[];
    landedCount: number;
  } {
    const items = [...V31_FEATURE_FLAG_CATALOG];
    return {
      items,
      landedCount: listLandedV31Flags().length,
    };
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
