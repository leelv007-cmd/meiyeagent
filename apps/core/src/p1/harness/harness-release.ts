/**
 * HarnessRelease three-object service (V31-21 / V3.1 §29.4 / U10 / U11).
 *
 * - Artifact: one-shot immutable create (all exact bindings + controlLimits +
 *   manifestHash). Publish fails on unset control limits or missing prompt pins.
 * - Lifecycle / Rollout: independent mutable state.
 * - Per-run selection: full immutable candidate releaseId only (no field override).
 * - Canary: workspace allowlist on the canary rollout.
 * - Rollback: new runs resolve previous production; in-flight frozen pins win.
 *
 * Session pin consumption / execution-chain releaseId / Playwright §37.4-J
 * integrate via V31-06 / V31-14 (out of this ticket).
 */

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  HARNESS_RELEASE_ARTIFACT_SCHEMA_VERSION,
  HARNESS_RELEASE_LIFECYCLE_SCHEMA_VERSION,
  HARNESS_RELEASE_ROLLOUT_SCHEMA_VERSION,
  agentControlLimitsSchema,
  harnessReleaseArtifactSchema,
  harnessReleaseLifecycleSchema,
  harnessReleaseRolloutSchema,
  type AgentControlLimits,
  type AgentRevisionRef,
  type HarnessMiddlewareBinding,
  type HarnessReleaseArtifact,
  type HarnessReleaseLifecycle,
  type HarnessReleaseRollout,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import {
  validateReleasePromptPublish,
  type ReleasePromptPublishFailure,
} from './prompt-packs.js';

export const AGENT_CONTROL_LIMIT_KEYS = [
  'maxLlmSteps',
  'maxToolCalls',
  'maxRetrievalCalls',
  'maxMerchantQuestions',
  'maxReplans',
  'maxSchemaRepairs',
  'maxContextTokens',
  'maxDelegations',
] as const satisfies readonly (keyof AgentControlLimits)[];

export type AgentControlLimitKey = (typeof AGENT_CONTROL_LIMIT_KEYS)[number];

/** Fields hashed into manifestHash (identity of the frozen composition). */
export const HARNESS_RELEASE_MANIFEST_HASH_FIELDS = [
  'agentSessionHarnessVersion',
  'makeHarnessVersion',
  'middlewareBindings',
  'controlLimits',
  'supervisorPolicyRef',
  'memoryPolicyRef',
  'contextCompilerRef',
  'planSchemaRevision',
  'promptBindings',
  'promptPackBindings',
  'schemaBindings',
  'skillBindings',
  'toolPolicyRevision',
  'modelPolicyRevision',
  'factPolicyRevision',
  'rightsPolicyRevision',
  'budgetPolicyRevision',
  'evalSuiteRevision',
] as const satisfies readonly (keyof HarnessReleaseArtifact)[];

export type HarnessReleaseLifecycleStatus =
  HarnessReleaseLifecycle['status'];

export type PublishHarnessReleaseInput = {
  releaseId: string;
  version: number;
  agentSessionHarnessVersion: string;
  makeHarnessVersion: string;
  middlewareBindings: HarnessMiddlewareBinding[];
  /**
   * Must carry every AgentControlLimits key as a number (U11). Missing / null
   * keys fail closed before Zod so "unset" is explicit at the action boundary.
   */
  controlLimits: Partial<Record<AgentControlLimitKey, number | null | undefined>> &
    Record<string, unknown>;
  supervisorPolicyRef: AgentRevisionRef;
  memoryPolicyRef: AgentRevisionRef;
  contextCompilerRef: AgentRevisionRef;
  planSchemaRevision: string;
  promptBindings: HarnessReleaseArtifact['promptBindings'];
  promptPackBindings: HarnessReleaseArtifact['promptPackBindings'];
  schemaBindings: HarnessReleaseArtifact['schemaBindings'];
  skillBindings: HarnessReleaseArtifact['skillBindings'];
  toolPolicyRevision: string;
  modelPolicyRevision: string;
  factPolicyRevision: string;
  rightsPolicyRevision: string;
  budgetPolicyRevision: string;
  evalSuiteRevision: string;
  createdAt?: string;
  /** Optional precomputed hash; when set must match recomputed value. */
  manifestHash?: string;
};

/**
 * V31-21 P1-a bootstrap: release pinned for fresh environments where no
 * production release exists yet (first turn must not fail closed).
 *
 * The id keeps legacy composer-plan pins resolvable (`composer-plan-surface-v1`
 * was the historical hardcoded session id). promptPackBindings stays empty so
 * publish is green without Langfuse pins — the artifact's promptBindings are
 * eval/trace bookkeeping; runtime prompt fetch resolves via env versions.
 */
export const DEFAULT_BOOTSTRAP_RELEASE_ID = 'composer-plan-surface-v1';

/** Fully calibrated limits frozen into the bootstrap release (U11). */
export const DEFAULT_BOOTSTRAP_CONTROL_LIMITS: AgentControlLimits = {
  maxLlmSteps: 8,
  maxToolCalls: 8,
  maxRetrievalCalls: 4,
  maxMerchantQuestions: 3,
  maxReplans: 2,
  maxSchemaRepairs: 2,
  maxContextTokens: 8_000,
  maxDelegations: 1,
};

/**
 * Publish + promote the bootstrap release when no production lifecycle exists.
 * Idempotent across API/worker processes: artifact write is immutable and
 * promotion retires any conflicting holder. Never touches an ops-managed
 * production release — it only fires when none is pinned.
 */
export async function ensureBootstrapProductionRelease(
  store: HarnessReleaseStore,
  options: {
    middlewareBindings?: readonly HarnessMiddlewareBinding[];
    now?: string;
  } = {},
): Promise<{ bootstrapped: boolean; releaseId: string }> {
  const existing = await store.getLifecycleByStatus('production');
  if (existing) return { bootstrapped: false, releaseId: existing.releaseId };
  const service = new HarnessReleaseService(store);
  const releaseId = DEFAULT_BOOTSTRAP_RELEASE_ID;
  const createdAt = nowIso(options.now);
  await service.publishArtifact({
    releaseId,
    version: 1,
    agentSessionHarnessVersion: 'bootstrap/session-v1',
    makeHarnessVersion: 'bootstrap/make-v1',
    middlewareBindings: [...(options.middlewareBindings ?? [])],
    controlLimits: { ...DEFAULT_BOOTSTRAP_CONTROL_LIMITS },
    supervisorPolicyRef: { id: 'bootstrap', revision: '1' },
    memoryPolicyRef: { id: 'bootstrap', revision: '1' },
    contextCompilerRef: { id: 'bootstrap', revision: '1' },
    planSchemaRevision: 'plan-schema/v1',
    promptBindings: {},
    promptPackBindings: {},
    schemaBindings: {},
    skillBindings: {},
    toolPolicyRevision: 'bootstrap/tool-v1',
    modelPolicyRevision: 'bootstrap/model-v1',
    factPolicyRevision: 'bootstrap/fact-v1',
    rightsPolicyRevision: 'bootstrap/rights-v1',
    budgetPolicyRevision: 'bootstrap/budget-v1',
    evalSuiteRevision: 'bootstrap/eval-v1',
    createdAt,
  });
  try {
    // Walk the legal lifecycle chain (draft→evaluating→canary→production);
    // the final promotion retires any conflicting holder.
    for (const toStatus of ['evaluating', 'canary', 'production'] as const) {
      await service.transitionLifecycle({
        releaseId,
        toStatus,
        approvedBy: 'system-bootstrap',
        now: createdAt,
      });
    }
  } catch (error) {
    // Race: another process promoted a production release while we published.
    const current = await store.getLifecycleByStatus('production');
    if (current) return { bootstrapped: false, releaseId: current.releaseId };
    throw error;
  }
  return { bootstrapped: true, releaseId };
}

export type HarnessReleaseSelectionReason =
  | 'frozen'
  | 'candidate'
  | 'canary_allowlist'
  | 'production';

export type HarnessReleaseResolution = {
  releaseId: string;
  artifact: HarnessReleaseArtifact;
  controlLimits: AgentControlLimits;
  selection: HarnessReleaseSelectionReason;
  lifecycle: HarnessReleaseLifecycle | null;
};

export type HarnessReleaseDiffEntry = {
  path: string;
  left: unknown;
  right: unknown;
};

export type HarnessReleaseDiff = {
  leftReleaseId: string;
  rightReleaseId: string;
  leftManifestHash: string;
  rightManifestHash: string;
  changes: HarnessReleaseDiffEntry[];
};

export interface HarnessReleaseStore {
  putArtifactImmutable(
    artifact: HarnessReleaseArtifact,
  ): Promise<HarnessReleaseArtifact>;
  getArtifact(releaseId: string): Promise<HarnessReleaseArtifact | null>;
  /** Ops-console catalog (V31-22); additive read, does not mutate artifacts. */
  listArtifacts(): Promise<HarnessReleaseArtifact[]>;
  putLifecycle(
    lifecycle: HarnessReleaseLifecycle,
  ): Promise<HarnessReleaseLifecycle>;
  getLifecycle(releaseId: string): Promise<HarnessReleaseLifecycle | null>;
  listLifecycles(): Promise<HarnessReleaseLifecycle[]>;
  /**
   * At most one production / one canary (unique partial indexes in PG).
   */
  getLifecycleByStatus(
    status: 'production' | 'canary',
  ): Promise<HarnessReleaseLifecycle | null>;
  putRollout(rollout: HarnessReleaseRollout): Promise<HarnessReleaseRollout>;
  getRollout(releaseId: string): Promise<HarnessReleaseRollout | null>;
  listRollouts(): Promise<HarnessReleaseRollout[]>;
}

export class MemoryHarnessReleaseStore implements HarnessReleaseStore {
  private readonly artifacts = new Map<string, HarnessReleaseArtifact>();
  private readonly lifecycles = new Map<string, HarnessReleaseLifecycle>();
  private readonly rollouts = new Map<string, HarnessReleaseRollout>();

  async putArtifactImmutable(
    artifact: HarnessReleaseArtifact,
  ): Promise<HarnessReleaseArtifact> {
    const parsed = harnessReleaseArtifactSchema.parse(artifact);
    const existing = this.artifacts.get(parsed.releaseId);
    if (existing) {
      if (isDeepStrictEqual(existing, parsed)) {
        return structuredClone(existing);
      }
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `HarnessReleaseArtifact ${parsed.releaseId} is immutable and already bound to a different manifest.`,
      );
    }
    this.artifacts.set(parsed.releaseId, structuredClone(parsed));
    return structuredClone(parsed);
  }

  async getArtifact(releaseId: string): Promise<HarnessReleaseArtifact | null> {
    const value = this.artifacts.get(releaseId);
    return value ? structuredClone(value) : null;
  }

  async listArtifacts(): Promise<HarnessReleaseArtifact[]> {
    return [...this.artifacts.values()].map((value) => structuredClone(value));
  }

  async putLifecycle(
    lifecycle: HarnessReleaseLifecycle,
  ): Promise<HarnessReleaseLifecycle> {
    const parsed = harnessReleaseLifecycleSchema.parse(lifecycle);
    if (
      parsed.status === 'production' ||
      parsed.status === 'canary'
    ) {
      for (const [id, current] of this.lifecycles) {
        if (id !== parsed.releaseId && current.status === parsed.status) {
          throw new P1DomainError(
            'INVALID_STATE',
            `Only one HarnessRelease may be ${parsed.status} at a time (held by ${id}).`,
          );
        }
      }
    }
    this.lifecycles.set(parsed.releaseId, structuredClone(parsed));
    return structuredClone(parsed);
  }

  async getLifecycle(
    releaseId: string,
  ): Promise<HarnessReleaseLifecycle | null> {
    const value = this.lifecycles.get(releaseId);
    return value ? structuredClone(value) : null;
  }

  async listLifecycles(): Promise<HarnessReleaseLifecycle[]> {
    return [...this.lifecycles.values()].map((value) => structuredClone(value));
  }

  async getLifecycleByStatus(
    status: 'production' | 'canary',
  ): Promise<HarnessReleaseLifecycle | null> {
    for (const value of this.lifecycles.values()) {
      if (value.status === status) return structuredClone(value);
    }
    return null;
  }

  async putRollout(
    rollout: HarnessReleaseRollout,
  ): Promise<HarnessReleaseRollout> {
    const parsed = harnessReleaseRolloutSchema.parse(rollout);
    this.rollouts.set(parsed.releaseId, structuredClone(parsed));
    return structuredClone(parsed);
  }

  async getRollout(releaseId: string): Promise<HarnessReleaseRollout | null> {
    const value = this.rollouts.get(releaseId);
    return value ? structuredClone(value) : null;
  }

  async listRollouts(): Promise<HarnessReleaseRollout[]> {
    return [...this.rollouts.values()].map((value) => structuredClone(value));
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

export function computeHarnessReleaseManifestHash(
  content: Pick<
    HarnessReleaseArtifact,
    (typeof HARNESS_RELEASE_MANIFEST_HASH_FIELDS)[number]
  >,
): string {
  const payload: Record<string, unknown> = {};
  for (const field of HARNESS_RELEASE_MANIFEST_HASH_FIELDS) {
    payload[field] = content[field];
  }
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * U11: every control limit must be an explicit number. Unset (missing / null /
 * undefined) fails closed — no silent defaults.
 */
export function assertControlLimitsFullySet(
  controlLimits: unknown,
): AgentControlLimits {
  if (
    controlLimits === null ||
    controlLimits === undefined ||
    typeof controlLimits !== 'object' ||
    Array.isArray(controlLimits)
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'controlLimits must be a fully calibrated object; unset controlLimits reject publish (U11).',
    );
  }
  const record = controlLimits as Record<string, unknown>;
  const unset: string[] = [];
  for (const key of AGENT_CONTROL_LIMIT_KEYS) {
    if (record[key] === undefined || record[key] === null) {
      unset.push(key);
    }
  }
  if (unset.length > 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `controlLimits has unset keys (U11): ${unset.join(', ')}. Calibrate and pin every limit before publish.`,
    );
  }
  return agentControlLimitsSchema.parse(controlLimits);
}

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function collectDiff(
  left: unknown,
  right: unknown,
  path: string,
  out: HarnessReleaseDiffEntry[],
): void {
  if (isDeepStrictEqual(left, right)) return;
  const leftIsObj =
    left !== null && typeof left === 'object' && !Array.isArray(left);
  const rightIsObj =
    right !== null && typeof right === 'object' && !Array.isArray(right);
  if (leftIsObj && rightIsObj) {
    const keys = new Set([
      ...Object.keys(left as object),
      ...Object.keys(right as object),
    ]);
    for (const key of [...keys].sort()) {
      collectDiff(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
        out,
      );
    }
    return;
  }
  out.push({ path: path || '$', left, right });
}

export function diffHarnessReleaseArtifacts(
  left: HarnessReleaseArtifact,
  right: HarnessReleaseArtifact,
): HarnessReleaseDiff {
  const changes: HarnessReleaseDiffEntry[] = [];
  for (const field of HARNESS_RELEASE_MANIFEST_HASH_FIELDS) {
    collectDiff(left[field], right[field], field, changes);
  }
  return {
    leftReleaseId: left.releaseId,
    rightReleaseId: right.releaseId,
    leftManifestHash: left.manifestHash,
    rightManifestHash: right.manifestHash,
    changes,
  };
}

const LIFECYCLE_TRANSITIONS: Record<
  HarnessReleaseLifecycleStatus,
  readonly HarnessReleaseLifecycleStatus[]
> = {
  draft: ['evaluating', 'retired'],
  evaluating: ['canary', 'draft', 'retired'],
  canary: ['production', 'evaluating', 'retired'],
  production: ['retired'],
  // Rollback re-activates a prior production from retired.
  retired: ['production'],
};

export class HarnessReleaseService {
  constructor(private readonly store: HarnessReleaseStore) {}

  /**
   * Publish an immutable artifact (HarnessReleasePublish writer).
   * Always creates draft lifecycle + empty rollout shell.
   */
  async publishArtifact(input: PublishHarnessReleaseInput): Promise<{
    artifact: HarnessReleaseArtifact;
    lifecycle: HarnessReleaseLifecycle;
    rollout: HarnessReleaseRollout;
  }> {
    const controlLimits = assertControlLimitsFullySet(input.controlLimits);

    const promptGate = validateReleasePromptPublish({
      promptPackBindings: input.promptPackBindings,
      promptBindings: input.promptBindings,
    });
    if (!promptGate.ok) {
      throw new P1DomainError(
        'INVALID_STATE',
        formatPromptPublishFailures(promptGate.failures),
      );
    }

    const content = {
      agentSessionHarnessVersion: input.agentSessionHarnessVersion,
      makeHarnessVersion: input.makeHarnessVersion,
      middlewareBindings: input.middlewareBindings,
      controlLimits,
      supervisorPolicyRef: input.supervisorPolicyRef,
      memoryPolicyRef: input.memoryPolicyRef,
      contextCompilerRef: input.contextCompilerRef,
      planSchemaRevision: input.planSchemaRevision,
      promptBindings: input.promptBindings,
      promptPackBindings: input.promptPackBindings,
      schemaBindings: input.schemaBindings,
      skillBindings: input.skillBindings,
      toolPolicyRevision: input.toolPolicyRevision,
      modelPolicyRevision: input.modelPolicyRevision,
      factPolicyRevision: input.factPolicyRevision,
      rightsPolicyRevision: input.rightsPolicyRevision,
      budgetPolicyRevision: input.budgetPolicyRevision,
      evalSuiteRevision: input.evalSuiteRevision,
    };
    const manifestHash = computeHarnessReleaseManifestHash(content);
    if (input.manifestHash && input.manifestHash !== manifestHash) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Provided manifestHash does not match frozen composition (${input.manifestHash} !== ${manifestHash}).`,
      );
    }

    const createdAt = input.createdAt ?? nowIso();
    const artifact = harnessReleaseArtifactSchema.parse({
      schemaVersion: HARNESS_RELEASE_ARTIFACT_SCHEMA_VERSION,
      releaseId: input.releaseId,
      version: input.version,
      manifestHash,
      ...content,
      createdAt,
    });

    const stored = await this.store.putArtifactImmutable(artifact);

    const existingLifecycle = await this.store.getLifecycle(stored.releaseId);
    const lifecycle =
      existingLifecycle ??
      (await this.store.putLifecycle(
        harnessReleaseLifecycleSchema.parse({
          schemaVersion: HARNESS_RELEASE_LIFECYCLE_SCHEMA_VERSION,
          releaseId: stored.releaseId,
          status: 'draft',
          updatedAt: createdAt,
        }),
      ));

    const existingRollout = await this.store.getRollout(stored.releaseId);
    const rollout =
      existingRollout ??
      (await this.store.putRollout(
        harnessReleaseRolloutSchema.parse({
          schemaVersion: HARNESS_RELEASE_ROLLOUT_SCHEMA_VERSION,
          releaseId: stored.releaseId,
          workspaceAllowlist: [],
          updatedAt: createdAt,
        }),
      ));

    return { artifact: stored, lifecycle, rollout };
  }

  async getExactRelease(releaseId: string): Promise<HarnessReleaseArtifact> {
    const artifact = await this.store.getArtifact(releaseId);
    if (!artifact) {
      throw new P1DomainError(
        'NOT_FOUND',
        `HarnessReleaseArtifact not found: ${releaseId}`,
      );
    }
    // Resolver guarantee: controlLimits always present and non-empty.
    assertControlLimitsFullySet(artifact.controlLimits);
    return artifact;
  }

  async transitionLifecycle(input: {
    releaseId: string;
    toStatus: HarnessReleaseLifecycleStatus;
    approvedBy?: string;
    now?: string;
  }): Promise<HarnessReleaseLifecycle> {
    await this.getExactRelease(input.releaseId);
    const current = await this.store.getLifecycle(input.releaseId);
    if (!current) {
      throw new P1DomainError(
        'NOT_FOUND',
        `HarnessReleaseLifecycle not found: ${input.releaseId}`,
      );
    }
    if (current.status === input.toStatus) {
      return current;
    }
    const allowed = LIFECYCLE_TRANSITIONS[current.status];
    if (!allowed.includes(input.toStatus)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Illegal lifecycle transition ${current.status} → ${input.toStatus} for ${input.releaseId}.`,
      );
    }

    const updatedAt = nowIso(input.now);

    // Enforce single production / single canary by retiring the previous holder.
    if (input.toStatus === 'production' || input.toStatus === 'canary') {
      const holder = await this.store.getLifecycleByStatus(input.toStatus);
      if (holder && holder.releaseId !== input.releaseId) {
        await this.store.putLifecycle(
          harnessReleaseLifecycleSchema.parse({
            ...holder,
            status: 'retired',
            updatedAt,
          }),
        );
      }
    }

    const next = harnessReleaseLifecycleSchema.parse({
      schemaVersion: HARNESS_RELEASE_LIFECYCLE_SCHEMA_VERSION,
      releaseId: input.releaseId,
      status: input.toStatus,
      approvedBy: input.approvedBy ?? current.approvedBy,
      approvedAt:
        input.toStatus === 'production' || input.toStatus === 'canary'
          ? (input.approvedBy ? updatedAt : current.approvedAt)
          : current.approvedAt,
      updatedAt,
    });
    return this.store.putLifecycle(next);
  }

  async updateRollout(input: {
    releaseId: string;
    workspaceAllowlist: readonly string[];
    percentage?: number;
    industryAllowlist?: readonly string[];
    now?: string;
  }): Promise<HarnessReleaseRollout> {
    await this.getExactRelease(input.releaseId);
    const rollout = harnessReleaseRolloutSchema.parse({
      schemaVersion: HARNESS_RELEASE_ROLLOUT_SCHEMA_VERSION,
      releaseId: input.releaseId,
      workspaceAllowlist: [...input.workspaceAllowlist],
      ...(input.percentage !== undefined
        ? { percentage: input.percentage }
        : {}),
      ...(input.industryAllowlist !== undefined
        ? { industryAllowlist: [...input.industryAllowlist] }
        : {}),
      updatedAt: nowIso(input.now),
    });
    return this.store.putRollout(rollout);
  }

  /**
   * U10: per-run may only pin a full immutable releaseId (no field override API).
   * frozenReleaseId (in-flight) always wins so rollback never mutates task pins.
   *
   * workspaceId is only consulted for canary allowlist matching; frozen and
   * candidate paths resolve without it (session pins carry no workspace).
   */
  async resolveForRun(input: {
    workspaceId?: string | null;
    frozenReleaseId?: string | null;
    /**
     * Full candidate releaseId only. Passing field-level overrides is not
     * supported by this method signature (U10).
     */
    candidateReleaseId?: string | null;
  }): Promise<HarnessReleaseResolution> {
    if (input.frozenReleaseId) {
      const artifact = await this.getExactRelease(input.frozenReleaseId);
      const lifecycle = await this.store.getLifecycle(artifact.releaseId);
      return {
        releaseId: artifact.releaseId,
        artifact,
        controlLimits: artifact.controlLimits,
        selection: 'frozen',
        lifecycle,
      };
    }

    if (input.candidateReleaseId) {
      // Candidate must already exist as a complete immutable artifact.
      const artifact = await this.getExactRelease(input.candidateReleaseId);
      const lifecycle = await this.store.getLifecycle(artifact.releaseId);
      return {
        releaseId: artifact.releaseId,
        artifact,
        controlLimits: artifact.controlLimits,
        selection: 'candidate',
        lifecycle,
      };
    }

    const canary = await this.store.getLifecycleByStatus('canary');
    if (canary) {
      const rollout = await this.store.getRollout(canary.releaseId);
      if (
        input.workspaceId &&
        rollout?.workspaceAllowlist.includes(input.workspaceId)
      ) {
        const artifact = await this.getExactRelease(canary.releaseId);
        return {
          releaseId: artifact.releaseId,
          artifact,
          controlLimits: artifact.controlLimits,
          selection: 'canary_allowlist',
          lifecycle: canary,
        };
      }
    }

    const production = await this.store.getLifecycleByStatus('production');
    if (!production) {
      throw new P1DomainError(
        'NOT_FOUND',
        'No production HarnessRelease is pinned; publish and promote one before resolving runs.',
      );
    }
    const artifact = await this.getExactRelease(production.releaseId);
    return {
      releaseId: artifact.releaseId,
      artifact,
      controlLimits: artifact.controlLimits,
      selection: 'production',
      lifecycle: production,
    };
  }

  /**
   * Rollback production pin to a prior release. Does not rewrite any task's
   * frozen harnessReleaseId — only changes what *new* runs resolve to.
   */
  async rollbackProduction(input: {
    toReleaseId: string;
    approvedBy?: string;
    now?: string;
  }): Promise<{
    production: HarnessReleaseLifecycle;
    previousProduction: HarnessReleaseLifecycle | null;
  }> {
    await this.getExactRelease(input.toReleaseId);
    const target = await this.store.getLifecycle(input.toReleaseId);
    if (!target) {
      throw new P1DomainError(
        'NOT_FOUND',
        `HarnessReleaseLifecycle not found: ${input.toReleaseId}`,
      );
    }
    if (target.status === 'production') {
      return { production: target, previousProduction: null };
    }
    // Allow rollback from retired (or any non-production) by forcing
    // transition path: retire current production, then set target production.
    const updatedAt = nowIso(input.now);
    const current = await this.store.getLifecycleByStatus('production');
    let previousProduction: HarnessReleaseLifecycle | null = null;
    if (current && current.releaseId !== input.toReleaseId) {
      previousProduction = await this.store.putLifecycle(
        harnessReleaseLifecycleSchema.parse({
          ...current,
          status: 'retired',
          updatedAt,
        }),
      );
    }
    // Direct put after uniqueness slot is free (bypass retired→production only
    // when intermediate states would block; rollback is an ops force-path).
    const production = await this.store.putLifecycle(
      harnessReleaseLifecycleSchema.parse({
        schemaVersion: HARNESS_RELEASE_LIFECYCLE_SCHEMA_VERSION,
        releaseId: input.toReleaseId,
        status: 'production',
        approvedBy: input.approvedBy ?? target.approvedBy,
        approvedAt: updatedAt,
        updatedAt,
      }),
    );
    return { production, previousProduction };
  }

  async diffReleases(
    leftReleaseId: string,
    rightReleaseId: string,
  ): Promise<HarnessReleaseDiff> {
    const left = await this.getExactRelease(leftReleaseId);
    const right = await this.getExactRelease(rightReleaseId);
    return diffHarnessReleaseArtifacts(left, right);
  }
}

function formatPromptPublishFailures(
  failures: readonly ReleasePromptPublishFailure[],
): string {
  const detail = failures.map((failure) => failure.message).join('; ');
  return `HarnessRelease prompt publish rejected: ${detail}`;
}
