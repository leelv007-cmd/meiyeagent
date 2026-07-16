import { randomUUID } from 'node:crypto';
import type { ProductState } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import { rebuildProductStateFromRelationFacts } from '../../product/relational-product-state.js';
import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { projectUsage } from '../foundation/application-service.js';
import type { UsageEvent, UsageResource } from '../foundation/domain.js';
import {
  legacyStateRevision,
  mapLegacyUsageLedgerSeeds,
  mapLegacyProductState,
  type LegacyMigrationFact,
  type LegacyMigrationManifest,
  type LegacyUsageLedgerSeed,
} from './legacy-mapper.js';

export interface CutoverExecutionContext {
  workspaceId: string;
  actorId: string;
  correlationId: string;
}

export interface CutoverDifferenceReport {
  expectedFactCount: number;
  actualFactCount: number;
  missingFactIds: string[];
  mismatchedFactIds: string[];
  unexpectedFactIds: string[];
  differenceCount: number;
  objectDifferences: {
    countsByKind: Array<{
      kind: LegacyMigrationFact['kind'];
      expected: number;
      actual: number;
    }>;
    missingFactIds: string[];
    mismatchedFactIds: string[];
    unexpectedFactIds: string[];
  };
  statusDifferences: Array<{
    factId: string;
    expected: string;
    actual: string;
  }>;
  versionOrderDifferences: Array<{
    parentId: string;
    expected: Array<{ factId: string; sequence: number | null }>;
    actual: Array<{ factId: string; sequence: number | null }>;
  }>;
  platformDifferences: Array<{
    auditFactId: string;
    contentFactId: string;
    variantFactId: string;
    requestedPlatform: 'xiaohongshu' | 'douyin';
    historicalPlatform: 'xiaohongshu' | 'douyin';
  }>;
  usageDifferences: {
    expectedEventCount: number;
    actualEventCount: number;
    expectedAmountTotal: number;
    actualAmountTotal: number;
    missingEventIds: string[];
    mismatchedEventIds: string[];
    unexpectedEventIds: string[];
    terminalReservationConflicts: string[];
    missingLedgerEventIds: string[];
    mismatchedLedgerEventIds: string[];
    unexpectedLedgerEventIds: string[];
    quotaReconciliation: Array<{
      resource: UsageResource;
      expected: {
        allowance: number;
        reserved: number;
        committed: number;
        available: number;
      };
      actual: {
        allowance: number;
        reserved: number;
        committed: number;
        available: number;
      };
      legacyRemaining: number | null;
      matches: boolean;
    }>;
  };
  assetDifferences: {
    expectedReceiptCount: number;
    actualReceiptCount: number;
    missingReceiptIds: string[];
    mismatchedReceiptIds: string[];
    unexpectedReceiptIds: string[];
  };
}

export interface InFlightDecision {
  jobId: string;
  status: string;
  decision: 'legacy_drain' | 'new_owner_recovery' | 'manual';
  owner: string;
  reason: string;
  preserveOriginalTaskRef: true;
  allowRegeneration: false;
}

export interface StoredMigrationFact extends LegacyMigrationFact {
  workspaceId: string;
}

interface StoredUsageLedgerSeed extends LegacyUsageLedgerSeed {
  workspaceId: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)])
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function sameFact(expected: LegacyMigrationFact, actual: StoredMigrationFact) {
  return (
    expected.kind === actual.kind &&
    (expected.parentId ?? null) === (actual.parentId ?? null) &&
    (expected.sequence ?? null) === (actual.sequence ?? null) &&
    expected.legacySource === actual.legacySource &&
    expected.mappingConfidence === actual.mappingConfidence &&
    new Date(expected.createdAt).toISOString() ===
      new Date(actual.createdAt).toISOString() &&
    sameJson(expected.data, actual.data)
  );
}

function migrationFactForRun(
  runId: string,
  fact: LegacyMigrationFact
): LegacyMigrationFact {
  const prefix = `cutover:${runId}:`;
  return {
    ...structuredClone(fact),
    id: `${prefix}${fact.id}`,
    ...(fact.parentId ? { parentId: `${prefix}${fact.parentId}` } : {}),
  };
}

function factCounts(facts: Array<Pick<LegacyMigrationFact, 'kind'>>) {
  const counts = new Map<LegacyMigrationFact['kind'], number>();
  for (const fact of facts)
    counts.set(fact.kind, (counts.get(fact.kind) ?? 0) + 1);
  return counts;
}

function numericData(fact: Pick<LegacyMigrationFact, 'data'>, key: string) {
  const value = fact.data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function terminalReservationConflicts(
  facts: Array<Pick<LegacyMigrationFact, 'kind' | 'data'>>
) {
  const terminalStatuses = new Set(['committed', 'refunded', 'expired']);
  const counts = new Map<string, number>();
  for (const fact of facts) {
    if (fact.kind !== 'usage_event') continue;
    const status = fact.data.status;
    const reservationId = fact.data.reservationId;
    if (
      typeof reservationId === 'string' &&
      terminalStatuses.has(String(status))
    ) {
      counts.set(reservationId, (counts.get(reservationId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([reservationId]) => reservationId)
    .sort();
}

function versionSequences(
  facts: Array<
    Pick<LegacyMigrationFact, 'id' | 'kind' | 'parentId' | 'sequence'>
  >
) {
  const sequences = new Map<
    string,
    Array<{ factId: string; sequence: number | null }>
  >();
  for (const fact of facts) {
    if (fact.kind !== 'content_version' || !fact.parentId) continue;
    const entries = sequences.get(fact.parentId) ?? [];
    entries.push({
      factId: fact.id,
      sequence: fact.sequence ?? null,
    });
    sequences.set(fact.parentId, entries);
  }
  for (const entries of sequences.values()) {
    entries.sort(
      (left, right) =>
        (left.sequence ?? Number.MAX_SAFE_INTEGER) -
          (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
        left.factId.localeCompare(right.factId)
    );
  }
  return sequences;
}

function requestedPlatformDifferences(facts: LegacyMigrationFact[]) {
  const contentFacts = new Map(
    facts.flatMap((fact) =>
      fact.kind === 'content' && typeof fact.data.id === 'string'
        ? [[fact.data.id, fact] as const]
        : []
    )
  );
  const variantsByParent = new Map<string, LegacyMigrationFact[]>();
  for (const fact of facts) {
    if (fact.kind !== 'platform_variant' || !fact.parentId) continue;
    const variants = variantsByParent.get(fact.parentId) ?? [];
    variants.push(fact);
    variantsByParent.set(fact.parentId, variants);
  }
  const differences: CutoverDifferenceReport['platformDifferences'] = [];
  const seen = new Set<string>();
  for (const audit of facts) {
    if (audit.kind !== 'audit' || audit.data.action !== 'content.generated') {
      continue;
    }
    const details = audit.data.details;
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      continue;
    }
    const evidence = details as Record<string, unknown>;
    const requestedPlatform =
      evidence.requestedPlatform ?? evidence.platform;
    if (
      requestedPlatform !== 'xiaohongshu' &&
      requestedPlatform !== 'douyin'
    ) {
      continue;
    }
    const candidateIds = Array.isArray(evidence.candidateIds)
      ? evidence.candidateIds.filter(
          (candidateId): candidateId is string =>
            typeof candidateId === 'string'
        )
      : [];
    for (const contentId of candidateIds) {
      const content = contentFacts.get(contentId);
      if (!content) continue;
      for (const variant of variantsByParent.get(content.id) ?? []) {
        const historicalPlatform = variant.data.platform;
        if (
          (historicalPlatform !== 'xiaohongshu' &&
            historicalPlatform !== 'douyin') ||
          historicalPlatform === requestedPlatform
        ) {
          continue;
        }
        const key = `${audit.id}:${variant.id}:${requestedPlatform}`;
        if (seen.has(key)) continue;
        seen.add(key);
        differences.push({
          auditFactId: audit.id,
          contentFactId: content.id,
          historicalPlatform,
          requestedPlatform,
          variantFactId: variant.id,
        });
      }
    }
  }
  return differences.sort(
    (left, right) =>
      left.contentFactId.localeCompare(right.contentFactId) ||
      left.variantFactId.localeCompare(right.variantFactId) ||
      left.auditFactId.localeCompare(right.auditFactId)
  );
}

export function buildCutoverDifferenceReport(
  expectedFacts: LegacyMigrationFact[],
  actualFacts: StoredMigrationFact[]
): CutoverDifferenceReport {
  const expectedById = new Map(expectedFacts.map((fact) => [fact.id, fact]));
  const actualById = new Map(actualFacts.map((fact) => [fact.id, fact]));
  const missingFactIds = expectedFacts
    .filter((fact) => !actualById.has(fact.id))
    .map((fact) => fact.id)
    .sort();
  const mismatchedFactIds = expectedFacts
    .filter((fact) => {
      const stored = actualById.get(fact.id);
      return stored ? !sameFact(fact, stored) : false;
    })
    .map((fact) => fact.id)
    .sort();
  const unexpectedFactIds = actualFacts
    .filter((fact) => !expectedById.has(fact.id))
    .map((fact) => fact.id)
    .sort();
  const expectedCounts = factCounts(expectedFacts);
  const actualCounts = factCounts(actualFacts);
  const kinds = new Set([...expectedCounts.keys(), ...actualCounts.keys()]);
  const countsByKind = [...kinds]
    .map((kind) => ({
      actual: actualCounts.get(kind) ?? 0,
      expected: expectedCounts.get(kind) ?? 0,
      kind,
    }))
    .filter((item) => item.expected !== item.actual)
    .sort((left, right) => left.kind.localeCompare(right.kind));
  const statusDifferences = expectedFacts
    .flatMap((fact) => {
      const stored = actualById.get(fact.id);
      const expected = fact.data.status;
      const actual = stored?.data.status;
      return stored &&
        typeof expected === 'string' &&
        typeof actual === 'string' &&
        expected !== actual
        ? [{ actual, expected, factId: fact.id }]
        : [];
    })
    .sort((left, right) => left.factId.localeCompare(right.factId));
  const expectedVersions = versionSequences(expectedFacts);
  const actualVersions = versionSequences(actualFacts);
  const versionParents = new Set([
    ...expectedVersions.keys(),
    ...actualVersions.keys(),
  ]);
  const versionOrderDifferences = [...versionParents]
    .flatMap((parentId) => {
      const expected = expectedVersions.get(parentId) ?? [];
      const actual = actualVersions.get(parentId) ?? [];
      return sameJson(expected, actual) ? [] : [{ actual, expected, parentId }];
    })
    .sort((left, right) => left.parentId.localeCompare(right.parentId));
  const expectedUsage = expectedFacts.filter(
    (fact) => fact.kind === 'usage_event'
  );
  const actualUsage = actualFacts.filter((fact) => fact.kind === 'usage_event');
  const expectedAssets = expectedFacts.filter(
    (fact) => fact.kind === 'asset_rights' || fact.kind === 'owned_asset'
  );
  const actualAssets = actualFacts.filter(
    (fact) => fact.kind === 'asset_rights' || fact.kind === 'owned_asset'
  );
  const conflicts = [
    ...new Set([
      ...terminalReservationConflicts(expectedFacts),
      ...terminalReservationConflicts(actualFacts),
    ]),
  ].sort();
  const platformDifferences = requestedPlatformDifferences(expectedFacts);
  const byKind = (
    ids: string[],
    kindsToKeep: Set<LegacyMigrationFact['kind']>
  ) =>
    ids.filter((id) => {
      const fact = expectedById.get(id) ?? actualById.get(id);
      return fact ? kindsToKeep.has(fact.kind) : false;
    });
  const usageKinds = new Set<LegacyMigrationFact['kind']>(['usage_event']);
  const assetKinds = new Set<LegacyMigrationFact['kind']>([
    'asset_rights',
    'owned_asset',
  ]);
  return {
    actualFactCount: actualFacts.length,
    assetDifferences: {
      actualReceiptCount: actualAssets.length,
      expectedReceiptCount: expectedAssets.length,
      mismatchedReceiptIds: byKind(mismatchedFactIds, assetKinds),
      missingReceiptIds: byKind(missingFactIds, assetKinds),
      unexpectedReceiptIds: byKind(unexpectedFactIds, assetKinds),
    },
    differenceCount:
      missingFactIds.length +
      mismatchedFactIds.length +
      unexpectedFactIds.length +
      conflicts.length +
      platformDifferences.length,
    expectedFactCount: expectedFacts.length,
    mismatchedFactIds,
    missingFactIds,
    objectDifferences: {
      countsByKind,
      mismatchedFactIds,
      missingFactIds,
      unexpectedFactIds,
    },
    platformDifferences,
    statusDifferences,
    unexpectedFactIds,
    usageDifferences: {
      actualAmountTotal: actualUsage.reduce(
        (total, fact) => total + numericData(fact, 'amount'),
        0
      ),
      actualEventCount: actualUsage.length,
      expectedAmountTotal: expectedUsage.reduce(
        (total, fact) => total + numericData(fact, 'amount'),
        0
      ),
      expectedEventCount: expectedUsage.length,
      mismatchedLedgerEventIds: [],
      mismatchedEventIds: byKind(mismatchedFactIds, usageKinds),
      missingLedgerEventIds: [],
      missingEventIds: byKind(missingFactIds, usageKinds),
      quotaReconciliation: [],
      terminalReservationConflicts: conflicts,
      unexpectedLedgerEventIds: [],
      unexpectedEventIds: byKind(unexpectedFactIds, usageKinds),
    },
    versionOrderDifferences,
  };
}

function sameUsageLedgerSeed(
  expected: LegacyUsageLedgerSeed,
  actual: StoredUsageLedgerSeed
) {
  return (
    expected.resource === actual.resource &&
    expected.action === actual.action &&
    expected.amount === actual.amount &&
    (expected.reservationId ?? null) === (actual.reservationId ?? null) &&
    expected.reason === actual.reason &&
    new Date(expected.createdAt).toISOString() ===
      new Date(actual.createdAt).toISOString()
  );
}

function usageProjection(
  events: Array<
    Pick<
      LegacyUsageLedgerSeed,
      'action' | 'amount' | 'reservationId' | 'resource'
    >
  >,
  resource: UsageResource
) {
  const resourceEvents = events.filter((event) => event.resource === resource);
  const allowance = resourceEvents
    .filter(
      (event) => event.action === 'adjust' || event.action === 'compensate'
    )
    .reduce((sum, event) => sum + event.amount, 0);
  const terminals = new Map(
    resourceEvents
      .filter(
        (event) =>
          event.action === 'commit' ||
          event.action === 'refund' ||
          event.action === 'expire'
      )
      .map((event) => [event.reservationId, event.action])
  );
  let reserved = 0;
  let committed = 0;
  for (const event of resourceEvents) {
    if (event.action !== 'reserve' || !event.reservationId) continue;
    const terminal = terminals.get(event.reservationId);
    if (terminal === 'commit') committed += event.amount;
    else if (!terminal) reserved += event.amount;
  }
  return {
    allowance,
    available: allowance - reserved - committed,
    committed,
    reserved,
  };
}

function reconcileUsageLedger(
  expected: LegacyUsageLedgerSeed[],
  actualExpectedEvents: StoredUsageLedgerSeed[],
  actualFullLedger: StoredUsageLedgerSeed[],
  quotaSnapshot: LegacyMigrationManifest['quotaSnapshot']
) {
  const expectedById = new Map(expected.map((event) => [event.id, event]));
  const actualById = new Map(
    actualExpectedEvents.map((event) => [event.id, event])
  );
  const missingLedgerEventIds = expected
    .filter((event) => !actualById.has(event.id))
    .map((event) => event.id)
    .sort();
  const mismatchedLedgerEventIds = expected
    .filter((event) => {
      const stored = actualById.get(event.id);
      return stored ? !sameUsageLedgerSeed(event, stored) : false;
    })
    .map((event) => event.id)
    .sort();
  const unexpectedLedgerEventIds = actualExpectedEvents
    .filter((event) => !expectedById.has(event.id))
    .map((event) => event.id)
    .sort();
  const quotaReconciliation = (['copy', 'image', 'video'] as const).map(
    (resource) => {
      const expectedProjection = usageProjection(expected, resource);
      const actualProjection = usageProjection(actualFullLedger, resource);
      const legacyRemaining = quotaSnapshot[resource]?.remaining ?? null;
      return {
        actual: actualProjection,
        expected: expectedProjection,
        legacyRemaining,
        matches:
          sameJson(expectedProjection, actualProjection) &&
          (legacyRemaining === null ||
            (expectedProjection.available === legacyRemaining &&
              actualProjection.available === legacyRemaining)),
        resource,
      };
    }
  );
  return {
    differenceCount:
      missingLedgerEventIds.length +
      mismatchedLedgerEventIds.length +
      unexpectedLedgerEventIds.length +
      quotaReconciliation.filter((item) => !item.matches).length,
    mismatchedLedgerEventIds,
    missingLedgerEventIds,
    quotaReconciliation,
    unexpectedLedgerEventIds,
  };
}

export function createInFlightDecisions(
  state: ProductState,
  actorId: string
): InFlightDecision[] {
  const videoDecisions = state.videoJobs
    .filter(
      (job) =>
        job.status !== 'completed' &&
        job.status !== 'cancelled' &&
        job.status !== 'failed'
    )
    .map((job): InFlightDecision => {
      const common = {
        allowRegeneration: false as const,
        jobId: job.id,
        preserveOriginalTaskRef: true as const,
        status: job.status,
      };
      if (job.status === 'needs_action') {
        return {
          ...common,
          decision: 'manual',
          owner: actorId,
          reason: 'Legacy job already requires explicit owner input.',
        };
      }
      const acceptedEvidence = state.videoRenderEvidence.some(
        (evidence) => evidence.jobId === job.id
      );
      return acceptedEvidence
        ? {
            ...common,
            decision: 'new_owner_recovery',
            owner: 'p1-job-worker',
            reason:
              'Existing render evidence must be recovered without regeneration.',
          }
        : {
            ...common,
            decision: 'legacy_drain',
            owner: job.leaseOwner ?? 'legacy-video-worker',
            reason:
              'No provider acceptance evidence exists; drain the original legacy job.',
          };
    });
  const coveredAgentRunIds = new Set(
    state.videoJobs.map((job) => job.agentRunId).filter(Boolean)
  );
  const videoJobIdsWithShells = new Set(state.videoJobs.map((job) => job.id));
  const orphanShellDecisions: InFlightDecision[] = (
    state.videoArtifactShells ?? []
  )
    .filter(
      (shell) =>
        (shell.status === 'queued' ||
          shell.status === 'running' ||
          shell.status === 'needs_action') &&
        !videoJobIdsWithShells.has(shell.jobId)
    )
    .map((shell) => ({
      allowRegeneration: false,
      decision: 'manual',
      jobId: `artifact-shell:${shell.id}`,
      owner: actorId,
      preserveOriginalTaskRef: true,
      reason:
        'Orphaned legacy artifact shell requires explicit operator recovery.',
      status: shell.status,
    }));
  const agentRunDecisions: InFlightDecision[] = state.agentRuns
    .filter(
      (run) =>
        (run.status === 'queued' || run.status === 'running') &&
        !coveredAgentRunIds.has(run.id)
    )
    .map((run) => ({
      allowRegeneration: false,
      decision: 'legacy_drain',
      jobId: `agent-run:${run.id}`,
      owner: 'legacy-application-runtime',
      preserveOriginalTaskRef: true,
      reason:
        'Drain the accepted legacy application run without creating a replacement request.',
      status: run.status,
    }));
  return [
    ...videoDecisions,
    ...orphanShellDecisions,
    ...agentRunDecisions,
  ].sort((left, right) => left.jobId.localeCompare(right.jobId));
}

export class P1CutoverExecutionService {
  constructor(private readonly pool: Pool) {}

  private async inWorkspaceTransaction<T>(
    workspaceId: string,
    action: (client: PoolClient) => Promise<T>
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        workspaceId,
      ]);
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async migrate(client?: PoolClient) {
    const database = client ?? this.pool;
    await new PostgresFoundationRepository(this.pool, client).migrate(client);
    await database.query(`
      CREATE TABLE IF NOT EXISTS p1_write_ownership (
        workspace_id text PRIMARY KEY,
        owner text NOT NULL CHECK (owner IN ('legacy', 'frozen', 'p1')),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS p1_migration_manifests (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        source_revision text NOT NULL,
        manifest jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, run_id),
        UNIQUE (workspace_id, source_revision)
      );
      CREATE TABLE IF NOT EXISTS p1_legacy_backups (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        source_revision text NOT NULL,
        backup_hash text NOT NULL,
        state jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, run_id)
      );
      CREATE TABLE IF NOT EXISTS p1_cutover_inflight_decisions (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        job_id text NOT NULL,
        decision jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, run_id, job_id)
      );
      CREATE TABLE IF NOT EXISTS p1_cutover_execution_runs (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        source_revision text NOT NULL,
        target_revision text NOT NULL,
        status text NOT NULL CHECK (status IN ('planned', 'frozen', 'active', 'rolled_back')),
        backup_ref text,
        dry_run_difference_count integer,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, run_id)
      );
      CREATE TABLE IF NOT EXISTS p1_restore_rehearsals (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        rehearsal_id text NOT NULL,
        evidence jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, run_id, rehearsal_id)
      );
      CREATE TABLE IF NOT EXISTS p1_restore_rehearsal_snapshots (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        rehearsal_id text NOT NULL,
        backup_hash text NOT NULL,
        state jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, run_id, rehearsal_id)
      );
      CREATE TABLE IF NOT EXISTS p1_rollback_rehearsals (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        rehearsal_id text NOT NULL,
        evidence jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, run_id, rehearsal_id)
      );
      ALTER TABLE p1_relation_facts
        ADD COLUMN IF NOT EXISTS legacy_sequence integer;
      ALTER TABLE p1_legacy_backups
        ADD COLUMN IF NOT EXISTS backup_hash text;
      UPDATE p1_legacy_backups
         SET backup_hash = source_revision
       WHERE backup_hash IS NULL;
      ALTER TABLE p1_legacy_backups
        ALTER COLUMN backup_hash SET NOT NULL;
    `);
  }

  async plan(context: CutoverExecutionContext) {
    return this.inWorkspaceTransaction(context.workspaceId, async (client) => {
      const state = await this.loadLegacyState(context.workspaceId, client);
      const mapped = mapLegacyProductState(state);
      const proposedRunId = randomUUID();
      await client.query(
        `INSERT INTO p1_migration_manifests
           (workspace_id, run_id, source_revision, manifest)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (workspace_id, source_revision) DO NOTHING`,
        [
          context.workspaceId,
          proposedRunId,
          mapped.manifest.sourceRevision,
          JSON.stringify(mapped.manifest),
        ]
      );
      const stored = await client.query<{
        run_id: string;
        manifest: LegacyMigrationManifest;
      }>(
        `SELECT run_id, manifest FROM p1_migration_manifests
          WHERE workspace_id = $1 AND source_revision = $2`,
        [context.workspaceId, mapped.manifest.sourceRevision]
      );
      const manifestRow = stored.rows[0];
      if (!manifestRow)
        throw new Error('Migration manifest could not be persisted.');
      await client.query(
        `INSERT INTO p1_cutover_execution_runs
           (workspace_id, run_id, source_revision, target_revision, status, actor_id, correlation_id)
         VALUES ($1, $2, $3, $4, 'planned', $5, $6)
         ON CONFLICT (workspace_id, run_id) DO NOTHING`,
        [
          context.workspaceId,
          manifestRow.run_id,
          manifestRow.manifest.sourceRevision,
          manifestRow.manifest.targetRevision,
          context.actorId,
          context.correlationId,
        ]
      );
      return { manifest: manifestRow.manifest, runId: manifestRow.run_id };
    });
  }

  async backup(context: CutoverExecutionContext, runId: string) {
    return this.inWorkspaceTransaction(context.workspaceId, async (client) => {
      const state = await this.loadLegacyState(context.workspaceId, client);
      const sourceRevision = legacyStateRevision(state);
      await this.assertRunRevision(
        context.workspaceId,
        runId,
        sourceRevision,
        client
      );
      const backupHash = sourceRevision;
      await client.query(
        `INSERT INTO p1_legacy_backups
           (workspace_id, run_id, source_revision, backup_hash, state)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (workspace_id, run_id) DO NOTHING`,
        [
          context.workspaceId,
          runId,
          sourceRevision,
          backupHash,
          JSON.stringify(state),
        ]
      );
      const persisted = await client.query<{
        source_revision: string;
        backup_hash: string;
        state: ProductState;
      }>(
        `SELECT source_revision, backup_hash, state
           FROM p1_legacy_backups
          WHERE workspace_id = $1 AND run_id = $2`,
        [context.workspaceId, runId]
      );
      const row = persisted.rows[0];
      if (
        !row ||
        row.source_revision !== sourceRevision ||
        row.backup_hash !== backupHash ||
        legacyStateRevision(row.state) !== backupHash
      ) {
        throw new Error(
          'Persisted backup does not match the cutover source revision.'
        );
      }
      const backupRef = `postgres:p1_legacy_backups/${context.workspaceId}/${runId}`;
      const updated = await client.query(
        `UPDATE p1_cutover_execution_runs
            SET backup_ref = $3,
                evidence = evidence || $4::jsonb,
                updated_at = now()
          WHERE workspace_id = $1 AND run_id = $2`,
        [
          context.workspaceId,
          runId,
          backupRef,
          JSON.stringify({
            backup: {
              backupHash,
              backupRef,
              operator: context.actorId,
              sourceRevision,
            },
          }),
        ]
      );
      if (updated.rowCount !== 1) throw new Error('Cutover run was not found.');
      return { backupHash, backupRef, sourceRevision };
    });
  }

  async rehearseRestore(context: CutoverExecutionContext, runId: string) {
    const startedAt = Date.now();
    const rehearsalId = randomUUID();
    const evidenceRef = `postgres:p1_restore_rehearsals/${context.workspaceId}/${runId}/${rehearsalId}`;
    try {
      return await this.inWorkspaceTransaction(
        context.workspaceId,
        async (client) => {
          const backup = await client.query<{
            source_revision: string;
            backup_hash: string;
            state: ProductState;
          }>(
            `SELECT source_revision, backup_hash, state FROM p1_legacy_backups
              WHERE workspace_id = $1 AND run_id = $2`,
            [context.workspaceId, runId]
          );
          const row = backup.rows[0];
          if (!row) throw new Error('Cutover backup is missing.');
          const legacyBefore = await this.loadLegacyState(
            context.workspaceId,
            client
          );
          const legacyRevisionBefore = legacyStateRevision(legacyBefore);
          if (legacyRevisionBefore !== row.source_revision) {
            throw new Error(
              'Legacy state changed after the cutover backup was created.'
            );
          }
          const backupHash = legacyStateRevision(row.state);
          if (
            backupHash !== row.backup_hash ||
            backupHash !== row.source_revision
          ) {
            throw new Error(
              'Restored backup hash does not match its source revision.'
            );
          }
          await client.query(
            `INSERT INTO p1_restore_rehearsal_snapshots
               (workspace_id, run_id, rehearsal_id, backup_hash, state)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [
              context.workspaceId,
              runId,
              rehearsalId,
              backupHash,
              JSON.stringify(row.state),
            ]
          );
          const restored = await client.query<{
            backup_hash: string;
            state: ProductState;
          }>(
            `SELECT backup_hash, state FROM p1_restore_rehearsal_snapshots
              WHERE workspace_id = $1 AND run_id = $2 AND rehearsal_id = $3`,
            [context.workspaceId, runId, rehearsalId]
          );
          const restoredRow = restored.rows[0];
          const restoredRevision = restoredRow
            ? legacyStateRevision(restoredRow.state)
            : '';
          if (
            !restoredRow ||
            restoredRow.backup_hash !== backupHash ||
            restoredRevision !== backupHash
          ) {
            throw new Error(
              'Restore rehearsal snapshot failed hash verification.'
            );
          }
          const legacyAfter = await this.loadLegacyState(
            context.workspaceId,
            client
          );
          const legacyRevisionAfter = legacyStateRevision(legacyAfter);
          if (legacyRevisionAfter !== legacyRevisionBefore) {
            throw new Error(
              'Restore rehearsal overwrote the live legacy state.'
            );
          }
          const evidence = {
            backupHash,
            correlationId: context.correlationId,
            evidenceRef,
            failureDisposition:
              'Abort cutover and retain the legacy write owner.',
            legacyRevisionAfter,
            legacyRevisionBefore,
            operator: context.actorId,
            restoredRevision,
            rpoSeconds: 0,
            rtoMilliseconds: Math.max(0, Date.now() - startedAt),
            status: 'passed' as const,
            verifiedWithoutOverwrite: true,
          };
          await client.query(
            `INSERT INTO p1_restore_rehearsals
               (workspace_id, run_id, rehearsal_id, evidence)
             VALUES ($1, $2, $3, $4::jsonb)`,
            [context.workspaceId, runId, rehearsalId, JSON.stringify(evidence)]
          );
          return { ...evidence, rehearsalId };
        }
      );
    } catch (error) {
      const evidence = {
        correlationId: context.correlationId,
        evidenceRef,
        failureDisposition: 'Abort cutover and retain the legacy write owner.',
        operator: context.actorId,
        rpoSeconds: null,
        rtoMilliseconds: Math.max(0, Date.now() - startedAt),
        status: 'failed' as const,
        verifiedWithoutOverwrite: false,
        error: error instanceof Error ? error.message : String(error),
      };
      try {
        await this.pool.query(
          `INSERT INTO p1_restore_rehearsals
             (workspace_id, run_id, rehearsal_id, evidence)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (workspace_id, run_id, rehearsal_id) DO NOTHING`,
          [context.workspaceId, runId, rehearsalId, JSON.stringify(evidence)]
        );
      } catch {
        // Preserve the original restore failure for the operator.
      }
      throw error;
    }
  }

  async freeze(context: CutoverExecutionContext, runId: string) {
    return this.inWorkspaceTransaction(context.workspaceId, async (client) => {
      await this.requireBackup(context.workspaceId, runId, client);
      await this.requireSuccessfulRestoreRehearsal(
        context.workspaceId,
        runId,
        client
      );
      const { manifest } = await this.expected(
        context.workspaceId,
        runId,
        client
      );
      const run = await client.query<{ status: string }>(
        `SELECT status FROM p1_cutover_execution_runs
          WHERE workspace_id = $1 AND run_id = $2`,
        [context.workspaceId, runId]
      );
      const status = run.rows[0]?.status;
      if (!status) throw new Error('Cutover run was not found.');
      if (!['planned', 'rolled_back', 'frozen'].includes(status)) {
        throw new Error(`Cutover run cannot freeze from ${status}.`);
      }
      await client.query(
        `INSERT INTO p1_write_ownership (workspace_id, owner, updated_at)
         VALUES ($1, 'frozen', now())
         ON CONFLICT (workspace_id)
         DO UPDATE SET owner = 'frozen', updated_at = now()`,
        [context.workspaceId]
      );
      const decisions = await this.recordInFlightDecisions(
        context,
        runId,
        await this.loadLegacyState(context.workspaceId, client),
        client
      );
      const decisionIds = decisions.map((decision) => decision.jobId).sort();
      if (!sameJson(decisionIds, [...manifest.inFlightJobIds].sort())) {
        throw new Error(
          'In-flight inventory changed after the migration manifest was created.'
        );
      }
      const updated = await client.query(
        `UPDATE p1_cutover_execution_runs
            SET status = 'frozen',
                evidence = evidence || $3::jsonb,
                updated_at = now()
          WHERE workspace_id = $1 AND run_id = $2`,
        [
          context.workspaceId,
          runId,
          JSON.stringify({
            freeze: {
              inFlightJobIds: decisionIds,
              operator: context.actorId,
            },
          }),
        ]
      );
      if (updated.rowCount !== 1) throw new Error('Cutover run was not found.');
      return decisions;
    });
  }

  async dryRun(
    context: CutoverExecutionContext,
    runId: string
  ): Promise<CutoverDifferenceReport> {
    return this.inWorkspaceTransaction(context.workspaceId, async (client) => {
      const report = await this.differenceReport(
        context.workspaceId,
        runId,
        client
      );
      await this.saveDifferenceReport(
        context.workspaceId,
        runId,
        report,
        client
      );
      return report;
    });
  }

  async backfill(context: CutoverExecutionContext, runId: string) {
    return this.inWorkspaceTransaction(context.workspaceId, async (client) => {
      const owner = await this.writeOwner(context.workspaceId, client);
      if (owner !== 'frozen') {
        throw new Error('Legacy commands must be frozen before backfill.');
      }
      const { facts, manifest, state } = await this.expected(
        context.workspaceId,
        runId,
        client
      );
      const sourceTerminalConflicts = terminalReservationConflicts(facts);
      if (sourceTerminalConflicts.length > 0) {
        throw new Error(
          `Legacy usage has duplicate terminal reservations: ${sourceTerminalConflicts.join(', ')}`
        );
      }
      for (const fact of facts) {
        await this.insertFact(
          client,
          context,
          migrationFactForRun(runId, fact)
        );
      }
      for (const seed of mapLegacyUsageLedgerSeeds(
        state,
        manifest.generatedAt
      )) {
        await this.insertUsageLedgerSeed(client, context, seed);
      }
      await this.reconcileUsageAllowances(client, context, runId, manifest);
      const report = await this.differenceReport(
        context.workspaceId,
        runId,
        client
      );
      await this.saveDifferenceReport(
        context.workspaceId,
        runId,
        report,
        client
      );
      return report;
    });
  }

  async activate(context: CutoverExecutionContext, runId: string) {
    return this.inWorkspaceTransaction(context.workspaceId, async (client) => {
      const report = await this.differenceReport(
        context.workspaceId,
        runId,
        client
      );
      await this.saveDifferenceReport(
        context.workspaceId,
        runId,
        report,
        client
      );
      if (report.differenceCount !== 0) {
        throw new Error(
          'Cutover cannot activate while dry-run differences remain.'
        );
      }
      await this.requireBackup(context.workspaceId, runId, client);
      await this.requireSuccessfulRestoreRehearsal(
        context.workspaceId,
        runId,
        client
      );
      const decisions = await this.listInFlightDecisions(
        context.workspaceId,
        runId,
        client
      );
      const { manifest } = await this.expected(
        context.workspaceId,
        runId,
        client
      );
      const decisionIds = decisions.map((decision) => decision.jobId).sort();
      if (
        !sameJson(decisionIds, [...manifest.inFlightJobIds].sort()) ||
        decisions.some(
          (decision) =>
            !decision.owner.trim() ||
            !decision.reason.trim() ||
            !decision.preserveOriginalTaskRef ||
            decision.allowRegeneration
        )
      ) {
        throw new Error(
          'Every in-flight legacy job needs an explicit non-regenerating owner decision.'
        );
      }
      const run = await client.query<{ status: string }>(
        `SELECT status FROM p1_cutover_execution_runs
          WHERE workspace_id = $1 AND run_id = $2`,
        [context.workspaceId, runId]
      );
      if (run.rows[0]?.status !== 'frozen') {
        throw new Error('Cutover run must be frozen before activation.');
      }
      const ownerUpdated = await client.query(
        `UPDATE p1_write_ownership SET owner = 'p1', updated_at = now()
          WHERE workspace_id = $1 AND owner = 'frozen'`,
        [context.workspaceId]
      );
      if (ownerUpdated.rowCount !== 1) {
        throw new Error('Workspace write ownership is not frozen.');
      }
      const runUpdated = await client.query(
        `UPDATE p1_cutover_execution_runs
            SET status = 'active',
                evidence = evidence || $3::jsonb,
                updated_at = now()
          WHERE workspace_id = $1 AND run_id = $2 AND status = 'frozen'`,
        [
          context.workspaceId,
          runId,
          JSON.stringify({
            activation: {
              futureWriteOwner: 'p1',
              inFlightJobIds: decisionIds,
              operator: context.actorId,
            },
          }),
        ]
      );
      if (runUpdated.rowCount !== 1) {
        throw new Error('Cutover run activation did not persist.');
      }
      return { futureWriteOwner: 'p1' as const, report, decisions };
    });
  }

  async rollbackFutureWrites(
    context: CutoverExecutionContext,
    runId: string,
    reason: string
  ) {
    if (!reason.trim()) throw new Error('Rollback reason is required.');
    const startedAt = Date.now();
    const rehearsalId = randomUUID();
    const evidenceRef = `postgres:p1_rollback_rehearsals/${context.workspaceId}/${runId}/${rehearsalId}`;
    try {
      return await this.inWorkspaceTransaction(
        context.workspaceId,
        async (client) => {
          const run = await client.query<{ status: string }>(
            `SELECT status FROM p1_cutover_execution_runs
          WHERE workspace_id = $1 AND run_id = $2`,
            [context.workspaceId, runId]
          );
          if (run.rows[0]?.status !== 'active') {
            throw new Error(
              'Only an active cutover run can roll back future writes.'
            );
          }
          const pendingProductCommands = await client.query<{
            idempotency_key: string;
          }>(
            `SELECT idempotency_key
           FROM p1_product_command_results
          WHERE workspace_id = $1
            AND result->>'kind' = 'pending'
          ORDER BY idempotency_key`,
            [context.workspaceId]
          );
          const unsettledP1Jobs = await client.query<{
            id: string;
            route_snapshot_id: string;
          }>(
            `SELECT id, route_snapshot_id
           FROM p1_generation_jobs
          WHERE workspace_id = $1
            AND status NOT IN ('completed', 'failed', 'cancelled')
          ORDER BY id`,
            [context.workspaceId]
          );
          const pendingP1ProductCommandKeys = pendingProductCommands.rows.map(
            (command) => command.idempotency_key
          );
          const inFlightP1Jobs = unsettledP1Jobs.rows.map((job) => ({
            allowRegeneration: false as const,
            jobId: job.id,
            owner: 'p1' as const,
            routeSnapshotId: job.route_snapshot_id,
          }));
          const legacyStateBefore = await this.loadLegacyState(
            context.workspaceId,
            client
          );
          const legacyBefore = legacyStateRevision(legacyStateBefore);
          const protectedFactCountsBefore = await this.protectedFactCounts(
            context.workspaceId,
            client
          );
          const currentP1Projection = await this.loadCurrentP1ProductProjection(
            context.workspaceId,
            legacyStateBefore,
            client
          );
          const materializedRevision = legacyStateRevision(currentP1Projection);
          const materialized = await client.query(
            `UPDATE product_states
            SET state = $2::jsonb, updated_at = now()
          WHERE workspace_id = $1`,
            [context.workspaceId, JSON.stringify(currentP1Projection)]
          );
          if (materialized.rowCount !== 1) {
            throw new Error(
              'Current P1 Product projection could not be materialized.'
            );
          }
          await client.query(
            `INSERT INTO p1_write_ownership (workspace_id, owner, updated_at)
         VALUES ($1, 'legacy', now())
         ON CONFLICT (workspace_id)
         DO UPDATE SET owner = 'legacy', updated_at = now()`,
            [context.workspaceId]
          );
          const legacyAfter = legacyStateRevision(
            await this.loadLegacyState(context.workspaceId, client)
          );
          const protectedFactCountsAfter = await this.protectedFactCounts(
            context.workspaceId,
            client
          );
          if (
            legacyAfter !== materializedRevision ||
            !sameJson(protectedFactCountsBefore, protectedFactCountsAfter)
          ) {
            throw new Error(
              'Future-entry rollback failed to preserve the current P1 projection or protected facts.'
            );
          }
          const evidence = {
            correlationId: context.correlationId,
            evidenceRef,
            failureDisposition:
              'Keep P1 fact recovery owners active and investigate routing.',
            futureWriteOwner: 'legacy',
            inFlightP1Jobs,
            pendingP1ProductCommandKeys,
            operator: context.actorId,
            legacyRevisionBefore: legacyBefore,
            materializedP1Revision: materializedRevision,
            materializedP1Projection: true,
            protectedFactCountsAfter,
            protectedFactCountsBefore,
            protectedFactKinds: [
              'GenerationJob',
              'ProviderAttempt',
              'Asset',
              'Connection',
              'UsageLedger',
              'ProviderCostLedger',
            ],
            reason,
            restoredLegacySnapshot: false,
            rpoSeconds: 0,
            rtoMilliseconds: Math.max(0, Date.now() - startedAt),
            status: 'passed' as const,
          };
          await client.query(
            `INSERT INTO p1_rollback_rehearsals
           (workspace_id, run_id, rehearsal_id, evidence)
         VALUES ($1, $2, $3, $4::jsonb)`,
            [context.workspaceId, runId, rehearsalId, JSON.stringify(evidence)]
          );
          const updated = await client.query(
            `UPDATE p1_cutover_execution_runs
            SET status = 'rolled_back',
                evidence = evidence || $3::jsonb,
                updated_at = now()
          WHERE workspace_id = $1 AND run_id = $2`,
            [
              context.workspaceId,
              runId,
              JSON.stringify({
                rollback: evidence,
              }),
            ]
          );
          if (updated.rowCount !== 1)
            throw new Error('Cutover run was not found.');
          return {
            ...evidence,
            futureWriteOwner: 'legacy' as const,
            rehearsalId,
            restoredLegacySnapshot: false as const,
          };
        }
      );
    } catch (error) {
      const evidence = {
        correlationId: context.correlationId,
        error: error instanceof Error ? error.message : String(error),
        evidenceRef,
        failureDisposition:
          'Keep the current write owner and all P1 fact recovery owners unchanged.',
        operator: context.actorId,
        reason,
        restoredLegacySnapshot: false,
        rpoSeconds: null,
        rtoMilliseconds: Math.max(0, Date.now() - startedAt),
        status: 'failed' as const,
      };
      try {
        await this.pool.query(
          `INSERT INTO p1_rollback_rehearsals
             (workspace_id, run_id, rehearsal_id, evidence)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (workspace_id, run_id, rehearsal_id) DO NOTHING`,
          [context.workspaceId, runId, rehearsalId, JSON.stringify(evidence)]
        );
      } catch {
        // Preserve the original rollback failure for the operator.
      }
      throw error;
    }
  }

  async inspect(context: CutoverExecutionContext, runId: string) {
    return this.inWorkspaceTransaction(context.workspaceId, async (client) => {
      const run = await client.query<{
        source_revision: string;
        target_revision: string;
        status: string;
        backup_ref: string | null;
        dry_run_difference_count: number | null;
        actor_id: string;
        correlation_id: string;
        evidence: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT source_revision, target_revision, status, backup_ref,
                dry_run_difference_count, actor_id, correlation_id, evidence,
                created_at::text, updated_at::text
           FROM p1_cutover_execution_runs
          WHERE workspace_id = $1 AND run_id = $2`,
        [context.workspaceId, runId]
      );
      const runRow = run.rows[0];
      if (!runRow) throw new Error('Cutover run was not found.');
      const manifest = await client.query<{
        manifest: LegacyMigrationManifest;
      }>(
        `SELECT manifest FROM p1_migration_manifests
          WHERE workspace_id = $1 AND run_id = $2`,
        [context.workspaceId, runId]
      );
      const restores = await client.query<{
        evidence: Record<string, unknown>;
      }>(
        `SELECT evidence FROM p1_restore_rehearsals
          WHERE workspace_id = $1 AND run_id = $2
          ORDER BY created_at, rehearsal_id`,
        [context.workspaceId, runId]
      );
      const rollbacks = await client.query<{
        evidence: Record<string, unknown>;
      }>(
        `SELECT evidence FROM p1_rollback_rehearsals
          WHERE workspace_id = $1 AND run_id = $2
          ORDER BY created_at, rehearsal_id`,
        [context.workspaceId, runId]
      );
      return {
        decisions: await this.listInFlightDecisions(
          context.workspaceId,
          runId,
          client
        ),
        futureWriteOwner: await this.writeOwner(context.workspaceId, client),
        manifest: manifest.rows[0]?.manifest ?? null,
        restoreRehearsals: restores.rows.map((row) => row.evidence),
        rollbackRehearsals: rollbacks.rows.map((row) => row.evidence),
        run: {
          actorId: runRow.actor_id,
          backupRef: runRow.backup_ref,
          correlationId: runRow.correlation_id,
          createdAt: runRow.created_at,
          dryRunDifferenceCount: runRow.dry_run_difference_count,
          evidence: runRow.evidence,
          sourceRevision: runRow.source_revision,
          status: runRow.status,
          targetRevision: runRow.target_revision,
          updatedAt: runRow.updated_at,
        },
      };
    });
  }

  private async loadLegacyState(
    workspaceId: string,
    database: Pool | PoolClient = this.pool
  ) {
    const result = await database.query<{ state: ProductState }>(
      'SELECT state FROM product_states WHERE workspace_id = $1',
      [workspaceId]
    );
    const state = result.rows[0]?.state;
    if (!state)
      throw new Error(`Legacy workspace ${workspaceId} was not found.`);
    return state;
  }

  private async protectedFactCounts(
    workspaceId: string,
    database: Pool | PoolClient = this.pool
  ) {
    const protectedTables = [
      ['RelationFact', 'p1_relation_facts'],
      ['GenerationJob', 'p1_generation_jobs'],
      ['ProviderAttempt', 'p1_provider_attempts'],
      ['Asset', 'p1_owned_assets'],
      ['UsageLedger', 'p1_usage_events'],
      ['ProviderCostLedger', 'p1_provider_cost_events'],
      ['ModelGenerationJob', 'model_generation_jobs'],
      ['ModelProviderAttempt', 'model_provider_attempts'],
      ['ModelAsset', 'model_assets'],
      ['ModelUsageLedger', 'model_usage_events'],
      ['ModelProviderCostLedger', 'model_provider_cost_events'],
      ['Connection', 'integration_connections'],
    ] as const;
    const counts: Record<string, number> = {};
    for (const [label, table] of protectedTables) {
      const exists = await database.query<{ relation: string | null }>(
        'SELECT to_regclass($1)::text AS relation',
        [table]
      );
      if (!exists.rows[0]?.relation) continue;
      const result = await database.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${table} WHERE workspace_id = $1`,
        [workspaceId]
      );
      counts[label] = Number(result.rows[0]?.count ?? 0);
    }
    return counts;
  }

  private async expected(
    workspaceId: string,
    runId: string,
    database: Pool | PoolClient = this.pool
  ) {
    const manifestResult = await database.query<{
      manifest: LegacyMigrationManifest;
      source_revision: string;
    }>(
      `SELECT manifest, source_revision FROM p1_migration_manifests
        WHERE workspace_id = $1 AND run_id = $2`,
      [workspaceId, runId]
    );
    const stored = manifestResult.rows[0];
    if (!stored) throw new Error('Migration manifest was not found.');
    const state = await this.loadLegacyState(workspaceId, database);
    if (legacyStateRevision(state) !== stored.source_revision) {
      throw new Error(
        'Legacy state changed after the migration manifest was created.'
      );
    }
    const mapped = mapLegacyProductState(state, stored.manifest.generatedAt);
    if (mapped.manifest.factsHash !== stored.manifest.factsHash) {
      throw new Error(
        'Mapped facts no longer match the migration manifest hash.'
      );
    }
    return { facts: mapped.facts, manifest: stored.manifest, state };
  }

  private async loadCurrentP1ProductProjection(
    workspaceId: string,
    legacyBaseline: ProductState,
    database: Pool | PoolClient = this.pool
  ) {
    const facts = await database.query<{ data: Record<string, unknown> }>(
      `SELECT data
         FROM p1_relation_facts
        WHERE workspace_id = $1
          AND data->>'recordType' IN (
            'product_entity_revision',
            'product_projection_meta_revision'
          )`,
      [workspaceId]
    );
    const projection =
      rebuildProductStateFromRelationFacts(legacyBaseline, facts.rows) ??
      structuredClone(legacyBaseline);
    const usage = await database.query<{
      resource: UsageResource;
      id: string;
      workspaceId: string;
      action: UsageEvent['action'];
      amount: number;
      reservationId: string | null;
      reason: string;
      actorId: string;
      correlationId: string;
      createdAt: string;
    }>(
      `SELECT resource,
              id,
              workspace_id AS "workspaceId",
              action,
              amount,
              reservation_id AS "reservationId",
              reason,
              actor_id AS "actorId",
              correlation_id AS "correlationId",
              created_at::text AS "createdAt"
         FROM p1_usage_events
        WHERE workspace_id = $1`,
      [workspaceId]
    );
    const existingUsageIds = new Set(
      projection.usageEvents.map((event) => event.id)
    );
    const productResource = {
      copy: 'content',
      image: 'image',
      video: 'video',
    } as const;
    const productStatus: Partial<
      Record<
        UsageEvent['action'],
        ProductState['usageEvents'][number]['status']
      >
    > = {
      commit: 'committed',
      expire: 'expired',
      refund: 'refunded',
      reserve: 'reserved',
    };
    for (const event of usage.rows) {
      if (event.resource === 'audio') continue;
      if (event.id.startsWith('legacy:usage:')) continue;
      const status = productStatus[event.action];
      if (!status) continue;
      const id = `foundation:${event.id}`;
      if (existingUsageIds.has(id)) continue;
      projection.usageEvents.push({
        amount: event.amount,
        correlationId: event.correlationId,
        createdAt: event.createdAt,
        id,
        reason: event.reason,
        ...(event.reservationId ? { reservationId: event.reservationId } : {}),
        resource: productResource[event.resource],
        status,
      });
      existingUsageIds.add(id);
    }
    for (const [resource, bucket] of [
      ['copy', 'content'],
      ['image', 'image'],
      ['video', 'video'],
    ] as const) {
      const events = usage.rows
        .filter((event) => event.resource === resource)
        .map((event) => ({
          ...event,
          ...(event.reservationId
            ? { reservationId: event.reservationId }
            : {}),
        })) as UsageEvent[];
      if (events.length === 0) continue;
      const current = projectUsage(events);
      projection.entitlement[bucket] = {
        allowance: current.allowance,
        remaining: current.available,
      };
    }
    const foundationRepository = new PostgresFoundationRepository(
      this.pool,
      database === this.pool ? undefined : (database as PoolClient)
    );
    const entitlementEvents =
      await foundationRepository.listProductEntitlementEvents(workspaceId);
    const latestPlan = [...entitlementEvents]
      .reverse()
      .find((event) => event.kind === 'plan_activated');
    if (latestPlan?.kind === 'plan_activated') {
      projection.entitlement.plan = latestPlan.policy.tier;
      projection.entitlement.concurrencyLimit =
        latestPlan.policy.concurrencyLimit;
      projection.entitlement.queuePriority = latestPlan.policy.queuePriority;
      projection.entitlement.supportLabel = latestPlan.policy.supportLabel;
      projection.entitlement.sourceEventId = latestPlan.id;
      projection.entitlement.sourceUpdatedAt = latestPlan.createdAt;
    }
    return projection;
  }

  private async assertRunRevision(
    workspaceId: string,
    runId: string,
    sourceRevision: string,
    database: Pool | PoolClient = this.pool
  ) {
    const result = await database.query(
      `SELECT 1 FROM p1_cutover_execution_runs
        WHERE workspace_id = $1 AND run_id = $2 AND source_revision = $3`,
      [workspaceId, runId, sourceRevision]
    );
    if (result.rowCount !== 1) {
      throw new Error(
        'Cutover run does not match the current legacy revision.'
      );
    }
  }

  private async requireBackup(
    workspaceId: string,
    runId: string,
    database: Pool | PoolClient = this.pool
  ) {
    const result = await database.query(
      `SELECT 1 FROM p1_legacy_backups
        WHERE workspace_id = $1 AND run_id = $2
          AND backup_hash = source_revision`,
      [workspaceId, runId]
    );
    if (result.rowCount !== 1) throw new Error('Cutover backup is required.');
  }

  private async requireSuccessfulRestoreRehearsal(
    workspaceId: string,
    runId: string,
    database: Pool | PoolClient = this.pool
  ) {
    const result = await database.query(
      `SELECT 1 FROM p1_restore_rehearsals
        WHERE workspace_id = $1 AND run_id = $2
          AND evidence->>'status' = 'passed'
          AND evidence->>'verifiedWithoutOverwrite' = 'true'
        LIMIT 1`,
      [workspaceId, runId]
    );
    if (result.rowCount !== 1) {
      throw new Error(
        'A successful no-overwrite restore rehearsal is required.'
      );
    }
  }

  private async writeOwner(
    workspaceId: string,
    database: Pool | PoolClient = this.pool
  ) {
    const result = await database.query<{ owner: string }>(
      'SELECT owner FROM p1_write_ownership WHERE workspace_id = $1',
      [workspaceId]
    );
    return result.rows[0]?.owner ?? 'legacy';
  }

  private async recordInFlightDecisions(
    context: CutoverExecutionContext,
    runId: string,
    state: ProductState,
    database: Pool | PoolClient = this.pool
  ) {
    const decisions = createInFlightDecisions(state, context.actorId);
    for (const decision of decisions) {
      await database.query(
        `INSERT INTO p1_cutover_inflight_decisions
           (workspace_id, run_id, job_id, decision)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (workspace_id, run_id, job_id)
         DO UPDATE SET decision = EXCLUDED.decision`,
        [context.workspaceId, runId, decision.jobId, JSON.stringify(decision)]
      );
    }
    return decisions;
  }

  private async listInFlightDecisions(
    workspaceId: string,
    runId: string,
    database: Pool | PoolClient = this.pool
  ) {
    const result = await database.query<{ decision: InFlightDecision }>(
      `SELECT decision FROM p1_cutover_inflight_decisions
        WHERE workspace_id = $1 AND run_id = $2 ORDER BY job_id`,
      [workspaceId, runId]
    );
    return result.rows.map((row) => row.decision);
  }

  private async differenceReport(
    workspaceId: string,
    runId: string,
    database: Pool | PoolClient = this.pool
  ) {
    const { facts, manifest, state } = await this.expected(
      workspaceId,
      runId,
      database
    );
    const expectedFacts = facts.map((fact) => migrationFactForRun(runId, fact));
    const factPrefix = `cutover:${runId}:%`;
    const actual = await database.query<StoredMigrationFact>(
      `SELECT workspace_id AS "workspaceId",
              id,
              kind,
              parent_id AS "parentId",
              legacy_sequence AS sequence,
              data,
              legacy_source AS "legacySource",
              mapping_confidence AS "mappingConfidence",
              created_at::text AS "createdAt"
         FROM p1_relation_facts
        WHERE workspace_id = $1 AND legacy_source = $2 AND id LIKE $3
        ORDER BY id`,
      [workspaceId, `product_states:${workspaceId}`, factPrefix]
    );
    const report = buildCutoverDifferenceReport(expectedFacts, actual.rows);
    const expectedLedger = mapLegacyUsageLedgerSeeds(
      state,
      manifest.generatedAt
    );
    const actualLedger = await database.query<StoredUsageLedgerSeed>(
      `SELECT workspace_id AS "workspaceId",
              id,
              resource,
              action,
              amount,
              reservation_id AS "reservationId",
              reason,
              created_at::text AS "createdAt"
         FROM p1_usage_events
        WHERE workspace_id = $1 AND id = ANY($2::text[])
        ORDER BY created_at, id`,
      [workspaceId, expectedLedger.map((event) => event.id)]
    );
    const fullLedger = await database.query<StoredUsageLedgerSeed>(
      `SELECT workspace_id AS "workspaceId",
              id,
              resource,
              action,
              amount,
              reservation_id AS "reservationId",
              reason,
              created_at::text AS "createdAt"
         FROM p1_usage_events
        WHERE workspace_id = $1
        ORDER BY created_at, id`,
      [workspaceId]
    );
    const ledger = reconcileUsageLedger(
      expectedLedger,
      actualLedger.rows,
      fullLedger.rows,
      manifest.quotaSnapshot
    );
    report.differenceCount += ledger.differenceCount;
    report.usageDifferences = {
      ...report.usageDifferences,
      mismatchedLedgerEventIds: ledger.mismatchedLedgerEventIds,
      missingLedgerEventIds: ledger.missingLedgerEventIds,
      quotaReconciliation: ledger.quotaReconciliation,
      unexpectedLedgerEventIds: ledger.unexpectedLedgerEventIds,
    };
    return report;
  }

  private async reconcileUsageAllowances(
    client: PoolClient,
    context: CutoverExecutionContext,
    runId: string,
    manifest: LegacyMigrationManifest
  ) {
    const priorRollback = await client.query(
      `SELECT 1
         FROM p1_cutover_execution_runs
        WHERE workspace_id = $1
          AND run_id <> $2
          AND status = 'rolled_back'
        LIMIT 1`,
      [context.workspaceId, runId]
    );
    for (const resource of ['copy', 'image', 'video'] as const) {
      const target = manifest.quotaSnapshot[resource];
      if (!target) continue;
      const rows = await client.query<StoredUsageLedgerSeed>(
        `SELECT workspace_id AS "workspaceId",
                id,
                resource,
                action,
                amount,
                reservation_id AS "reservationId",
                reason,
                created_at::text AS "createdAt"
           FROM p1_usage_events
          WHERE workspace_id = $1 AND resource = $2
          ORDER BY created_at, id`,
        [context.workspaceId, resource]
      );
      const current = usageProjection(rows.rows, resource);
      const amount = target.remaining - current.available;
      if (amount === 0) continue;
      if (priorRollback.rowCount !== 1) {
        throw new Error(
          `Existing ${resource} ledger events do not match the initial legacy cutover snapshot.`
        );
      }
      await this.insertUsageLedgerSeed(client, context, {
        action: 'adjust',
        amount,
        createdAt: manifest.generatedAt,
        id: `cutover:usage:reconcile:${runId}:${resource}`,
        reason: [
          `cutover_reconcile:${runId}`,
          `target_allowance=${target.allowance}`,
          `target_remaining=${target.remaining}`,
        ].join(';'),
        resource,
      });
    }
  }

  private async saveDifferenceReport(
    workspaceId: string,
    runId: string,
    report: CutoverDifferenceReport,
    database: Pool | PoolClient = this.pool
  ) {
    const updated = await database.query(
      `UPDATE p1_cutover_execution_runs
          SET dry_run_difference_count = $3,
              evidence = evidence || $4::jsonb,
              updated_at = now()
        WHERE workspace_id = $1 AND run_id = $2`,
      [
        workspaceId,
        runId,
        report.differenceCount,
        JSON.stringify({ dryRun: report }),
      ]
    );
    if (updated.rowCount !== 1) throw new Error('Cutover run was not found.');
  }

  private async insertUsageLedgerSeed(
    client: PoolClient,
    context: CutoverExecutionContext,
    seed: LegacyUsageLedgerSeed
  ) {
    await client.query(
      `INSERT INTO p1_usage_events
         (workspace_id, id, resource, action, amount, reservation_id, reason,
          actor_id, correlation_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        context.workspaceId,
        seed.id,
        seed.resource,
        seed.action,
        seed.amount,
        seed.reservationId ?? null,
        seed.reason,
        context.actorId,
        context.correlationId,
        seed.createdAt,
      ]
    );
  }

  private async insertFact(
    client: PoolClient,
    context: CutoverExecutionContext,
    fact: LegacyMigrationFact
  ) {
    await client.query(
      `INSERT INTO p1_relation_facts
         (workspace_id, id, kind, parent_id, legacy_sequence, data, legacy_source,
          mapping_confidence, actor_id, correlation_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::timestamptz)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        context.workspaceId,
        fact.id,
        fact.kind,
        fact.parentId ?? null,
        fact.sequence ?? null,
        JSON.stringify(fact.data),
        fact.legacySource,
        fact.mappingConfidence,
        context.actorId,
        context.correlationId,
        fact.createdAt,
      ]
    );
  }
}
