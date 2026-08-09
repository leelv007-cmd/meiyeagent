/**
 * ExecutionPlanSnapshot freeze + admission + DBOS re-verification (V31-12).
 *
 * Authority: V3.1 §14.2 / §22.3 / U9 / spec-C.
 *
 * Lifecycle:
 * 1. Compile finalizes → freezeExecutionPlanContent + snapshotHash
 *    (hash coverage excludes confirmationDecisionRef).
 * 2. Confirmation request holds snapshotHash as the consistency anchor (V31-11).
 * 3. task-admission one-shot writes the snapshot row
 *    (merchant_confirmed + decisionRef / policy_exempt_copy without).
 * 4. DBOS pre-run: recompute hash → context/rights fence; mismatch fail closed.
 * 5. Post-confirm material fact/rights/cost drift → stale + diff; stale confirm rejected.
 * 6. at-least-once replay does not double-write snapshot / create Task / charge.
 * 7. Legacy durable tasks without snapshot use an independent replay branch;
 *    incompatible layout fail closed (no dual-write).
 */

import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS,
  EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION,
  executionPlanSnapshotSchema,
  type AgentRevisionRef,
  type BoundedExecutionSnapshot,
  type CompiledExecutionPlan,
  type ExecutionPlanApprovalBasis,
  type ExecutionPlanSnapshot,
  type HarnessReleaseId,
  type IntentDeclaration,
  type MarketingPlanId,
  type PlanConfirmationDecisionId,
  type PlanDeliverable,
} from '@meiye/contracts';

import type { HarnessWorkflowInput } from './task-admission.js';

// ─── Errors ──────────────────────────────────────────────────────────────────

export type ExecutionPlanAdmissionErrorCode =
  | 'SNAPSHOT_HASH_MISMATCH'
  | 'SNAPSHOT_FIDELITY_MISMATCH'
  | 'SNAPSHOT_STALE'
  | 'STALE_CONFIRMATION_REJECTED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'DECISION_REF_REQUIRED'
  | 'DECISION_REF_FORBIDDEN'
  | 'LAYOUT_INCOMPATIBLE'
  | 'CONTEXT_FENCE_MISMATCH'
  | 'RIGHTS_FENCE_MISMATCH'
  | 'NOT_FOUND'
  | 'INVALID_STATE';

export class ExecutionPlanAdmissionError extends Error {
  readonly status: number;

  constructor(
    readonly code: ExecutionPlanAdmissionErrorCode,
    message: string,
    status = 409,
  ) {
    super(message);
    this.name = 'ExecutionPlanAdmissionError';
    this.status = status;
  }
}

// ─── Hash / freeze ───────────────────────────────────────────────────────────

/**
 * Frozen execution content covered by snapshotHash.
 * confirmationDecisionRef / snapshotHash / schemaVersion are intentionally out.
 */
export type ExecutionPlanFrozenContent = Pick<
  ExecutionPlanSnapshot,
  (typeof EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS)[number]
>;

export type FreezeExecutionPlanInput = ExecutionPlanFrozenContent;

export type FreezeExecutionPlanResult = {
  content: ExecutionPlanFrozenContent;
  snapshotHash: string;
};

/** Durable pre-decision carrier. The immutable decision is intentionally absent. */
export type PendingExecutionPlanSnapshot = FreezeExecutionPlanResult;

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

/**
 * Canonical JSON sha256 over EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS only.
 * Precedent: harness-release computeHarnessReleaseManifestHash /
 * putArtifactImmutable immutability.
 */
export function computeExecutionPlanSnapshotHash(
  content: ExecutionPlanFrozenContent,
): string {
  const payload: Record<string, unknown> = {};
  for (const field of EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS) {
    payload[field] = content[field];
  }
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * Compile-finalize freeze: compute stable snapshotHash before confirmation.
 * Does not persist; confirmation request holds the returned hash as anchor.
 */
export function freezeExecutionPlanContent(
  input: FreezeExecutionPlanInput,
): FreezeExecutionPlanResult {
  const content = pickFrozenContent(input);
  const snapshotHash = computeExecutionPlanSnapshotHash(content);
  return { content, snapshotHash };
}

function pickFrozenContent(
  input: ExecutionPlanFrozenContent | ExecutionPlanSnapshot,
): ExecutionPlanFrozenContent {
  const content = {} as Record<string, unknown>;
  for (const field of EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS) {
    content[field] = input[field];
  }
  return content as ExecutionPlanFrozenContent;
}

/**
 * Build a validated ExecutionPlanSnapshot from frozen content + decision binding.
 * Hash is recomputed and must match any caller-supplied snapshotHash.
 */
export function buildExecutionPlanSnapshot(input: {
  content: ExecutionPlanFrozenContent;
  confirmationDecisionRef?: PlanConfirmationDecisionId | string;
  snapshotHash?: string;
}): ExecutionPlanSnapshot {
  const snapshotHash =
    input.snapshotHash ?? computeExecutionPlanSnapshotHash(input.content);
  const expected = computeExecutionPlanSnapshotHash(input.content);
  if (snapshotHash !== expected) {
    throw new ExecutionPlanAdmissionError(
      'SNAPSHOT_HASH_MISMATCH',
      `snapshotHash mismatch: provided ${snapshotHash} !== computed ${expected}.`,
    );
  }
  const draft = {
    schemaVersion: EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION,
    ...input.content,
    snapshotHash,
    ...(input.confirmationDecisionRef
      ? { confirmationDecisionRef: input.confirmationDecisionRef }
      : {}),
  };
  return executionPlanSnapshotSchema.parse(draft);
}

// ─── Compile-finalize producer seam ─────────────────────────────────────────

/**
 * Frozen execution content owned by the compile-finalize boundary (V31-12
 * producer). Only PlanCompiler-produced fields live here; harness-admission
 * fields (prompts/skills/routes/facts/bounds) are assembled by
 * HarnessTaskAdmissionService after they resolve. confirmationDecisionRef is
 * never part of the freeze — it enters the snapshot only at admission.
 */
export type ExecutionPlanCompileFreeze = {
  planId: MarketingPlanId;
  planRevision: number;
  intentDeclaration: IntentDeclaration;
  contextBundleRef: {
    bundleId: string;
    revision: number;
    hash: string;
  };
  executionPlan: CompiledExecutionPlan;
  deliverables: PlanDeliverable[];
  quoteRef: AgentRevisionRef;
  rightsRevisionRefs: readonly string[];
  harnessReleaseId: HarnessReleaseId;
  /**
   * U9 decision made at compile-finalize: pure copy exempts the decision
   * (policy_exempt_copy), paid media requires confirmation. Never carries
   * confirmationDecisionRef — it enters only at admission.
   */
  approvalBasis: ExecutionPlanApprovalBasis;
};

export type ExecutionPlanSnapshotAssemblyInput = {
  freeze: ExecutionPlanCompileFreeze;
  promptRevisionRefs: Record<string, { key: string; version: string }>;
  skillManifestRefs: Record<string, Array<{ skillId: string; revision: string }>>;
  routeRequirements: Array<{ capability: string; requirement?: string }>;
  factRevisionRefs: readonly string[];
  boundedExecution: BoundedExecutionSnapshot;
  /**
   * merchant_confirmed requires it; policy_exempt_copy forbids it.
   * Passed through to buildExecutionPlanSnapshot (schema enforces both).
   */
  confirmationDecisionRef?: PlanConfirmationDecisionId | string;
};

/**
 * Compile-finalize producer: assemble the full frozen content from the
 * compiler freeze plus harness-admission fields, compute snapshotHash, and
 * build the validated snapshot. Pure and idempotent — the same input always
 * yields the same snapshotHash (confirmationDecisionRef never participates).
 */
export function assembleExecutionPlanSnapshot(
  input: ExecutionPlanSnapshotAssemblyInput,
): ExecutionPlanSnapshot {
  const { freeze } = input;
  const content: ExecutionPlanFrozenContent = {
    planId: freeze.planId,
    planRevision: freeze.planRevision,
    intentDeclaration: freeze.intentDeclaration,
    contextBundleRef: freeze.contextBundleRef,
    executionPlan: freeze.executionPlan,
    deliverables: freeze.deliverables,
    promptRevisionRefs: input.promptRevisionRefs,
    skillManifestRefs: input.skillManifestRefs,
    routeRequirements: input.routeRequirements,
    quoteRef: freeze.quoteRef,
    rightsRevisionRefs: [...freeze.rightsRevisionRefs],
    factRevisionRefs: [...input.factRevisionRefs],
    boundedExecution: input.boundedExecution,
    harnessReleaseId: freeze.harnessReleaseId,
    approvalBasis: freeze.approvalBasis,
  };
  const { snapshotHash } = freezeExecutionPlanContent(content);
  return buildExecutionPlanSnapshot({
    content,
    snapshotHash,
    confirmationDecisionRef: input.confirmationDecisionRef,
  });
}

export function assemblePendingExecutionPlanSnapshot(
  input: Omit<ExecutionPlanSnapshotAssemblyInput, 'confirmationDecisionRef'>,
): PendingExecutionPlanSnapshot {
  const snapshot = assembleExecutionPlanSnapshot({
    ...input,
    ...(input.freeze.approvalBasis === 'merchant_confirmed'
      ? { confirmationDecisionRef: 'pending-decision-not-admitted' }
      : {}),
  });
  return freezeExecutionPlanContent(pickFrozenContent(snapshot));
}

// ─── Store contract ──────────────────────────────────────────────────────────

export type AdmittedExecutionPlanSnapshot = {
  snapshot: ExecutionPlanSnapshot;
  workflowId: string;
  workspaceId: string;
  admittedAt: string;
};

export type ExecutionPlanSnapshotStore = {
  /**
   * One-shot immutable write (ON CONFLICT DO NOTHING + deep-equal replay).
   * Different payload for the same snapshotHash → IDEMPOTENCY_CONFLICT.
   */
  putImmutable(
    row: AdmittedExecutionPlanSnapshot,
  ): Promise<AdmittedExecutionPlanSnapshot>;
  getByHash(snapshotHash: string): Promise<AdmittedExecutionPlanSnapshot | null>;
  getByWorkflowId(
    workflowId: string,
  ): Promise<AdmittedExecutionPlanSnapshot | null>;
};

// ─── Staleness ───────────────────────────────────────────────────────────────

export type SnapshotLiveFacts = {
  /** Live quote revision head (number or opaque string, matches AgentRevisionRef). */
  quoteRevision?: number | string;
  rightsRevisionRefs?: readonly string[];
  factRevisionRefs?: readonly string[];
  /** When true, rights fence fails closed (revoked / missing). */
  rightsRevoked?: boolean;
  /** When true, a material context source head drifted. */
  contextDrifted?: boolean;
};

export type SnapshotStaleDiff = {
  quote?: { frozen: number | string; live: number | string };
  rightsRevisionRefs?: {
    frozen: readonly string[];
    live: readonly string[];
  };
  factRevisionRefs?: {
    frozen: readonly string[];
    live: readonly string[];
  };
  rightsRevoked?: true;
  contextDrifted?: true;
};

export type SnapshotStaleness =
  | { status: 'current' }
  | { status: 'stale'; diff: SnapshotStaleDiff };

function sameIdSet(
  left: readonly string[],
  right: readonly string[] | undefined,
): boolean {
  if (right === undefined) return true;
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

/**
 * Post-confirm / pre-execute staleness projection (V3.1 §14.4).
 * Pure — never mutates the snapshot.
 */
export function evaluateExecutionPlanStaleness(input: {
  snapshot: ExecutionPlanSnapshot;
  live: SnapshotLiveFacts;
}): SnapshotStaleness {
  const { snapshot, live } = input;
  const diff: SnapshotStaleDiff = {};

  if (
    live.quoteRevision !== undefined &&
    live.quoteRevision !== snapshot.quoteRef.revision
  ) {
    diff.quote = {
      frozen: snapshot.quoteRef.revision,
      live: live.quoteRevision,
    };
  }
  if (
    live.rightsRevisionRefs !== undefined &&
    !sameIdSet(snapshot.rightsRevisionRefs, live.rightsRevisionRefs)
  ) {
    diff.rightsRevisionRefs = {
      frozen: snapshot.rightsRevisionRefs,
      live: live.rightsRevisionRefs,
    };
  }
  if (
    live.factRevisionRefs !== undefined &&
    !sameIdSet(snapshot.factRevisionRefs, live.factRevisionRefs)
  ) {
    diff.factRevisionRefs = {
      frozen: snapshot.factRevisionRefs,
      live: live.factRevisionRefs,
    };
  }
  if (live.rightsRevoked === true) {
    diff.rightsRevoked = true;
  }
  if (live.contextDrifted === true) {
    diff.contextDrifted = true;
  }

  if (Object.keys(diff).length === 0) {
    return { status: 'current' };
  }
  return { status: 'stale', diff };
}

// ─── DBOS verification ───────────────────────────────────────────────────────

export type ExecutionPlanVerificationResult = {
  ok: true;
  snapshotHash: string;
  approvalBasis: ExecutionPlanApprovalBasis;
};

/**
 * DBOS pre-run verification seam: recompute hash, then optional context/rights fence.
 * Mismatch always fail closed.
 */
export function verifyExecutionPlanSnapshotForDbos(input: {
  snapshot: ExecutionPlanSnapshot;
  live?: SnapshotLiveFacts;
}): ExecutionPlanVerificationResult {
  const parsed = executionPlanSnapshotSchema.parse(input.snapshot);
  const expected = computeExecutionPlanSnapshotHash(pickFrozenContent(parsed));
  if (parsed.snapshotHash !== expected) {
    throw new ExecutionPlanAdmissionError(
      'SNAPSHOT_HASH_MISMATCH',
      `DBOS verification failed: snapshotHash ${parsed.snapshotHash} !== recomputed ${expected}.`,
    );
  }

  if (input.live) {
    const staleness = evaluateExecutionPlanStaleness({
      snapshot: parsed,
      live: input.live,
    });
    if (staleness.status === 'stale') {
      if (input.live.rightsRevoked === true) {
        throw new ExecutionPlanAdmissionError(
          'RIGHTS_FENCE_MISMATCH',
          'DBOS rights fence failed: frozen rights are revoked or missing.',
        );
      }
      if (input.live.contextDrifted === true) {
        throw new ExecutionPlanAdmissionError(
          'CONTEXT_FENCE_MISMATCH',
          'DBOS context fence failed: material context head drifted after freeze.',
        );
      }
      throw new ExecutionPlanAdmissionError(
        'SNAPSHOT_STALE',
        `DBOS verification failed: snapshot is stale (${Object.keys(staleness.diff).join(',')}).`,
      );
    }
  }

  return {
    ok: true,
    snapshotHash: parsed.snapshotHash,
    approvalBasis: parsed.approvalBasis,
  };
}

// ─── Legacy replay branch ────────────────────────────────────────────────────

export type DurableReplayBranch =
  | {
      branch: 'execution_plan_snapshot';
      snapshot: ExecutionPlanSnapshot;
    }
  | {
      branch: 'pending_confirmation';
      snapshotHash: string;
    }
  | {
      branch: 'legacy';
      reason: 'no_snapshot';
    };

/**
 * Resolve whether a durable task request uses the new snapshot chain or legacy
 * five-stage replay. Incompatible partial layouts fail closed — no dual-write.
 */
export function resolveDurableReplayBranch(
  request: Pick<
    HarnessWorkflowInput,
    'executionPlanSnapshot' | 'pendingExecutionPlanSnapshot'
  > & {
    /** Corrupt / half-migrated marker: present but not a valid snapshot. */
    executionPlanSnapshotRaw?: unknown;
  },
): DurableReplayBranch {
  if (request.executionPlanSnapshotRaw !== undefined) {
    const parsed = executionPlanSnapshotSchema.safeParse(
      request.executionPlanSnapshotRaw,
    );
    if (!parsed.success) {
      throw new ExecutionPlanAdmissionError(
        'LAYOUT_INCOMPATIBLE',
        'Durable task layout carries an incompatible ExecutionPlanSnapshot; fail closed (no dual-write).',
      );
    }
    return {
      branch: 'execution_plan_snapshot',
      snapshot: parsed.data,
    };
  }
  if (request.executionPlanSnapshot) {
    const parsed = executionPlanSnapshotSchema.safeParse(
      request.executionPlanSnapshot,
    );
    if (!parsed.success) {
      throw new ExecutionPlanAdmissionError(
        'LAYOUT_INCOMPATIBLE',
        'Durable task layout carries an incompatible ExecutionPlanSnapshot; fail closed (no dual-write).',
      );
    }
    return {
      branch: 'execution_plan_snapshot',
      snapshot: parsed.data,
    };
  }
  if (request.pendingExecutionPlanSnapshot) {
    return {
      branch: 'pending_confirmation',
      snapshotHash: request.pendingExecutionPlanSnapshot.snapshotHash,
    };
  }
  return { branch: 'legacy', reason: 'no_snapshot' };
}

// ─── Fidelity ────────────────────────────────────────────────────────────────

/**
 * Exit gate: confirmed plan vs admitted snapshot — field-by-field on hash coverage.
 * Returns true only when every coverage field is deep-equal (fidelity=100%).
 */
export function assertExecutionPlanFidelity(input: {
  confirmed: ExecutionPlanFrozenContent;
  executing: ExecutionPlanSnapshot;
}): true {
  const confirmed = pickFrozenContent(input.confirmed);
  const executing = pickFrozenContent(input.executing);
  for (const field of EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS) {
    if (!isDeepStrictEqual(confirmed[field], executing[field])) {
      throw new ExecutionPlanAdmissionError(
        'SNAPSHOT_FIDELITY_MISMATCH',
        `Fidelity gate failed on field "${field}": confirmed plan does not match executing snapshot.`,
      );
    }
  }
  const confirmedHash = computeExecutionPlanSnapshotHash(confirmed);
  if (confirmedHash !== input.executing.snapshotHash) {
    throw new ExecutionPlanAdmissionError(
      'SNAPSHOT_HASH_MISMATCH',
      `Fidelity gate failed: confirmed hash ${confirmedHash} !== executing ${input.executing.snapshotHash}.`,
    );
  }
  return true;
}

// ─── Admission service (sole writer of execution_plan_snapshot) ──────────────

export type AdmitExecutionPlanInput = {
  workflowId: string;
  workspaceId: string;
  content: ExecutionPlanFrozenContent;
  /**
   * Must match freeze hash. When omitted, recomputed from content.
   * confirmationDecisionRef never participates.
   */
  snapshotHash?: string;
  approvalBasis?: ExecutionPlanApprovalBasis;
  confirmationDecisionRef?: string;
  admittedAt?: string;
  /**
   * Live facts at admission time — stale confirmations are rejected.
   */
  live?: SnapshotLiveFacts;
};

export type AdmitExecutionPlanResult = {
  admitted: AdmittedExecutionPlanSnapshot;
  replayed: boolean;
};

export class ExecutionPlanAdmissionService {
  constructor(private readonly store: ExecutionPlanSnapshotStore) {}

  /**
   * One-shot task-admission write of ExecutionPlanSnapshot.
   * merchant_confirmed requires decisionRef; policy_exempt_copy forbids it (U9).
   * Replay of identical (hash, workflowId, payload) is a no-op (at-least-once).
   */
  async admit(input: AdmitExecutionPlanInput): Promise<AdmitExecutionPlanResult> {
    const content = pickFrozenContent({
      ...input.content,
      ...(input.approvalBasis
        ? { approvalBasis: input.approvalBasis }
        : {}),
    });

    if (
      content.approvalBasis === 'merchant_confirmed' &&
      !input.confirmationDecisionRef
    ) {
      throw new ExecutionPlanAdmissionError(
        'DECISION_REF_REQUIRED',
        'merchant_confirmed admission requires confirmationDecisionRef.',
      );
    }
    if (
      content.approvalBasis === 'policy_exempt_copy' &&
      input.confirmationDecisionRef
    ) {
      throw new ExecutionPlanAdmissionError(
        'DECISION_REF_FORBIDDEN',
        'policy_exempt_copy admission must not carry confirmationDecisionRef.',
      );
    }

    const snapshot = buildExecutionPlanSnapshot({
      content,
      confirmationDecisionRef: input.confirmationDecisionRef,
      snapshotHash: input.snapshotHash,
    });

    if (input.live) {
      const staleness = evaluateExecutionPlanStaleness({
        snapshot,
        live: input.live,
      });
      if (staleness.status === 'stale') {
        throw new ExecutionPlanAdmissionError(
          'STALE_CONFIRMATION_REJECTED',
          `Stale confirmation rejected at admission (${Object.keys(staleness.diff).join(',')}); re-confirm required.`,
        );
      }
    }

    const admittedAt = input.admittedAt ?? new Date().toISOString();
    const row: AdmittedExecutionPlanSnapshot = {
      snapshot,
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      admittedAt,
    };

    // Workflow-level uniqueness: one admitted snapshot per task.
    const byWorkflow = await this.store.getByWorkflowId(input.workflowId);
    if (byWorkflow) {
      if (
        byWorkflow.snapshot.snapshotHash === snapshot.snapshotHash &&
        isDeepStrictEqual(byWorkflow.snapshot, snapshot) &&
        byWorkflow.workspaceId === input.workspaceId
      ) {
        return { admitted: byWorkflow, replayed: true };
      }
      throw new ExecutionPlanAdmissionError(
        'IDEMPOTENCY_CONFLICT',
        `Workflow ${input.workflowId} already admitted a different ExecutionPlanSnapshot.`,
      );
    }

    const priorByHash = await this.store.getByHash(snapshot.snapshotHash);
    const written = await this.store.putImmutable(row);
    const replayed =
      priorByHash !== null &&
      priorByHash.workflowId === input.workflowId &&
      isDeepStrictEqual(priorByHash.snapshot, snapshot);

    return { admitted: written, replayed };
  }

  async getByHash(
    snapshotHash: string,
  ): Promise<AdmittedExecutionPlanSnapshot | null> {
    return this.store.getByHash(snapshotHash);
  }

  async getByWorkflowId(
    workflowId: string,
  ): Promise<AdmittedExecutionPlanSnapshot | null> {
    return this.store.getByWorkflowId(workflowId);
  }

  /**
   * task-admission convenience: accept a fully built snapshot (post-confirm or
   * policy_exempt_copy) and one-shot write it.
   */
  async admitSnapshot(input: {
    workflowId: string;
    workspaceId: string;
    snapshot: ExecutionPlanSnapshot;
    admittedAt?: string;
    live?: SnapshotLiveFacts;
  }): Promise<AdmitExecutionPlanResult> {
    const snapshot = executionPlanSnapshotSchema.parse(input.snapshot);
    return this.admit({
      workflowId: input.workflowId,
      workspaceId: input.workspaceId,
      content: pickFrozenContent(snapshot),
      snapshotHash: snapshot.snapshotHash,
      confirmationDecisionRef: snapshot.confirmationDecisionRef,
      admittedAt: input.admittedAt,
      live: input.live,
    });
  }

  /**
   * DBOS seam: load admitted row (if any) and re-verify hash + optional fences.
   */
  async verifyAdmittedForDbos(input: {
    workflowId: string;
    snapshotHash?: string;
    live?: SnapshotLiveFacts;
  }): Promise<ExecutionPlanVerificationResult> {
    const row = input.snapshotHash
      ? await this.store.getByHash(input.snapshotHash)
      : await this.store.getByWorkflowId(input.workflowId);
    if (!row) {
      throw new ExecutionPlanAdmissionError(
        'NOT_FOUND',
        `No admitted ExecutionPlanSnapshot for workflow ${input.workflowId}.`,
        404,
      );
    }
    if (row.workflowId !== input.workflowId) {
      throw new ExecutionPlanAdmissionError(
        'INVALID_STATE',
        `Snapshot ${row.snapshot.snapshotHash} is bound to workflow ${row.workflowId}, not ${input.workflowId}.`,
      );
    }
    return verifyExecutionPlanSnapshotForDbos({
      snapshot: row.snapshot,
      live: input.live,
    });
  }
}

/**
 * Port used by HarnessTaskAdmissionService / DBOS to bind snapshots on the real
 * task-admission path without coupling to Postgres.
 */
export type ExecutionPlanAdmissionPort = {
  admit(input: AdmitExecutionPlanInput): Promise<AdmitExecutionPlanResult>;
  admitSnapshot(input: {
    workflowId: string;
    workspaceId: string;
    snapshot: ExecutionPlanSnapshot;
    admittedAt?: string;
    live?: SnapshotLiveFacts;
  }): Promise<AdmitExecutionPlanResult>;
  verifyAdmittedForDbos(input: {
    workflowId: string;
    snapshotHash?: string;
    live?: SnapshotLiveFacts;
  }): Promise<ExecutionPlanVerificationResult>;
};
