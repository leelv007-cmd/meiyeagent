import type {
  BuildProductQuoteInput,
  ResultAdjustCommand,
  ResultAdjustConfirmCommand,
} from '@meiye/contracts';
import type { Pool } from 'pg';

import type { P1Context } from '../foundation/domain.js';
import type {
  SteeringActionConsumers,
  SteeringConsumerInput,
} from './steering-service.js';

/** The minimum immutable source evidence needed to create a quoted adjustment. */
export type SteeringDerivedSource = {
  currentVersionId: string;
  generated: {
    assetIds: string[];
    ownedAssets?: Array<{ id: string }>;
  };
  id: string;
  revision: number;
  source: {
    creationExecutionSnapshot?: { id: string };
    workflowId?: string;
    workId?: string;
  };
  versions: Array<{
    id: string;
    orderedAssetIds: string[];
    note?: {
      plan?: {
        pages: Array<{ id: string; imageAssetId?: string }>;
      };
    };
  }>;
};

export type SteeringDerivedWorkflowRecord = {
  affectedUnitIds: string[];
  commandId: string;
  derivedPackageId?: string;
  derivedTaskId?: string;
  derivedWorkId?: string;
  instruction: string;
  sourceExpectedRevision: number;
  sourcePackageId: string;
  sourceSnapshotId: string;
  status: 'pending' | 'prepared' | 'launched';
  workspaceId: string;
};

export interface SteeringDerivedWorkflowStore {
  findByCommandId(commandId: string): Promise<SteeringDerivedWorkflowRecord | null>;
  markLaunched(input: {
    commandId: string;
    derivedPackageId: string;
    derivedTaskId: string;
    derivedWorkId: string;
  }): Promise<void>;
  markPrepared(input: {
    commandId: string;
    derivedTaskId: string;
    derivedWorkId: string;
  }): Promise<void>;
  putPending(
    record: SteeringDerivedWorkflowRecord,
  ): Promise<SteeringDerivedWorkflowRecord>;
}

export class PostgresSteeringDerivedWorkflowStore
  implements SteeringDerivedWorkflowStore
{
  constructor(private readonly pool: Pool) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS p1_make_steering_derived_outbox (
        command_id text PRIMARY KEY
          REFERENCES p1_make_steering_commands(command_id),
        workspace_id text NOT NULL,
        instruction text NOT NULL,
        affected_unit_ids jsonb NOT NULL,
        source_package_id text NOT NULL,
        source_expected_revision bigint NOT NULL,
        source_snapshot_id text NOT NULL,
        derived_task_id text NULL,
        derived_work_id text NULL,
        derived_package_id text NULL,
        status text NOT NULL CHECK (status IN ('pending', 'prepared', 'launched')),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS p1_make_steering_derived_package_idx
        ON p1_make_steering_derived_outbox (workspace_id, derived_package_id)
        WHERE derived_package_id IS NOT NULL;
    `);
  }

  async putPending(record: SteeringDerivedWorkflowRecord) {
    await this.pool.query(
      `INSERT INTO p1_make_steering_derived_outbox (
         command_id, workspace_id, instruction, affected_unit_ids,
         source_package_id, source_expected_revision, source_snapshot_id, status
       ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,'pending')
       ON CONFLICT (command_id) DO NOTHING`,
      [
        record.commandId,
        record.workspaceId,
        record.instruction,
        JSON.stringify(record.affectedUnitIds),
        record.sourcePackageId,
        record.sourceExpectedRevision,
        record.sourceSnapshotId,
      ],
    );
    const stored = await this.findByCommandId(record.commandId);
    if (!stored || !samePendingFacts(stored, record)) {
      throw new Error('Derived steering outbox conflicts with immutable command facts.');
    }
    return stored;
  }

  async markPrepared(input: {
    commandId: string;
    derivedTaskId: string;
    derivedWorkId: string;
  }): Promise<void> {
    const existing = await this.require(input.commandId);
    if (
      (existing.derivedTaskId && existing.derivedTaskId !== input.derivedTaskId) ||
      (existing.derivedWorkId && existing.derivedWorkId !== input.derivedWorkId)
    ) {
      throw new Error('Derived steering preparation conflicts with its durable task binding.');
    }
    if (existing.status === 'launched' || existing.status === 'prepared') return;
    await this.pool.query(
      `UPDATE p1_make_steering_derived_outbox
          SET derived_task_id=$2, derived_work_id=$3, status='prepared', updated_at=now()
        WHERE command_id=$1 AND status='pending'`,
      [input.commandId, input.derivedTaskId, input.derivedWorkId],
    );
  }

  async markLaunched(input: {
    commandId: string;
    derivedPackageId: string;
    derivedTaskId: string;
    derivedWorkId: string;
  }): Promise<void> {
    const existing = await this.require(input.commandId);
    if (
      (existing.derivedTaskId && existing.derivedTaskId !== input.derivedTaskId) ||
      (existing.derivedWorkId && existing.derivedWorkId !== input.derivedWorkId) ||
      (existing.derivedPackageId && existing.derivedPackageId !== input.derivedPackageId)
    ) {
      throw new Error('Derived steering launch conflicts with its durable task binding.');
    }
    if (existing.status === 'launched') return;
    await this.pool.query(
      `UPDATE p1_make_steering_derived_outbox
          SET derived_task_id=$2, derived_work_id=$3, derived_package_id=$4,
              status='launched', updated_at=now()
        WHERE command_id=$1 AND status IN ('pending', 'prepared')`,
      [
        input.commandId,
        input.derivedTaskId,
        input.derivedWorkId,
        input.derivedPackageId,
      ],
    );
  }

  async findByCommandId(commandId: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM p1_make_steering_derived_outbox WHERE command_id=$1`,
      [commandId],
    );
    return result.rows[0] ? parseRecord(result.rows[0]) : null;
  }

  private async require(commandId: string): Promise<SteeringDerivedWorkflowRecord> {
    const existing = await this.findByCommandId(commandId);
    if (!existing) throw new Error(`Derived steering command ${commandId} is missing.`);
    return existing;
  }
}

type Dependencies = {
  billing: {
    buildQuote(
      input: BuildProductQuoteInput,
    ): Promise<{ quoteId: string; revision: string }> | { quoteId: string; revision: string };
  };
  commands: {
    adjust(
      context: P1Context,
      command: ResultAdjustConfirmCommand,
      idempotencyKey: string,
    ): Promise<{
      contentPackage: { id: string };
      task: { id: string };
      work: { id: string };
    }>;
    prepareAdjust(
      context: P1Context,
      command: ResultAdjustCommand,
      idempotencyKey: string,
    ): Promise<{
      quoteIntent: {
        aspectRatio?: '1:1' | '3:4' | '9:16';
        catalogModelId: string;
        operation: string;
        quantity: number;
      };
      task: { id: string };
      work: { id: string };
    }>;
  };
  operations: {
    getCreativeWorkbench(context: P1Context): Promise<{
      works: Array<{ id: string; updatedAt: string }>;
    }>;
  };
  quoteAuthority: {
    resolve(input: {
      aspectRatio?: '1:1' | '3:4' | '9:16';
      catalogModelId: string;
      operation: 'copy.generate' | 'image.generate';
      quantity: number;
      quoteId: string;
      workspaceId: string;
    }): Promise<BuildProductQuoteInput>;
  };
  resolveSource(input: {
    taskId: string;
    workId: string;
    workspaceId: string;
  }): Promise<SteeringDerivedSource>;
  store: SteeringDerivedWorkflowStore;
};

/**
 * V31-45's only derived-revision path. It persists an outbox first, creates an
 * adjustment Work, builds a server quote, and hands off to the normal Composer
 * admission. It intentionally never writes the source ContentPackage directly.
 */
export class SteeringDerivedWorkflowCoordinator {
  constructor(private readonly dependencies: Dependencies) {}

  consumer(): NonNullable<SteeringActionConsumers['derivedWorkflow']> {
    return { launchDerivedRevision: (input) => this.launch(input) };
  }

  async launch(input: SteeringConsumerInput): Promise<{ status: 'launched' }> {
    if (!input.workId) throw new Error('Derived steering requires its admitted source Work.');
    const existing = await this.dependencies.store.findByCommandId(
      input.command.commandId,
    );
    if (existing?.status === 'launched') return { status: 'launched' };

    const context = contextOf(input);
    const [source, workbench] = await Promise.all([
      this.dependencies.resolveSource({
        taskId: input.taskId,
        workId: input.workId,
        workspaceId: input.workspaceId,
      }),
      this.dependencies.operations.getCreativeWorkbench(context),
    ]);
    const snapshotId = source.source.creationExecutionSnapshot?.id;
    const work = workbench.works.find((candidate) => candidate.id === input.workId);
    if (
      !snapshotId ||
      !work ||
      source.source.workflowId !== input.taskId ||
      source.source.workId !== input.workId
    ) {
      throw new Error('Derived steering source no longer matches its admitted execution.');
    }
    const assetIds = affectedAssets(source, input.affectedUnitIds);
    if (assetIds.length === 0) {
      throw new Error('Derived steering target units have no canonical source assets.');
    }
    await this.dependencies.store.putPending({
      affectedUnitIds: [...input.affectedUnitIds],
      commandId: input.command.commandId,
      instruction: input.instruction,
      sourceExpectedRevision: source.revision,
      sourcePackageId: source.id,
      sourceSnapshotId: snapshotId,
      status: 'pending',
      workspaceId: input.workspaceId,
    });

    const sourceRef = {
      expectedPackageRevision: source.revision,
      kind: 'content_package_snapshot' as const,
      packageId: source.id,
      snapshotId,
      workflowId: input.taskId,
    };
    const scope =
      assetIds.length === 1
        ? { assetId: assetIds[0]!, kind: 'asset' as const }
        : { assetIds, kind: 'set' as const };
    const prepared = await this.dependencies.commands.prepareAdjust(
      context,
      {
        expectedWorkUpdatedAt: work.updatedAt,
        instruction: input.instruction,
        scope,
        source: sourceRef,
        workId: input.workId,
      },
      `steering-derived:prepare:${input.command.commandId}`,
    );
    const operation = prepared.quoteIntent.operation;
    if (operation !== 'copy.generate' && operation !== 'image.generate') {
      throw new Error('Derived steering adjustment returned an unsupported billable operation.');
    }
    const quote = await this.dependencies.billing.buildQuote(
      await this.dependencies.quoteAuthority.resolve({
        ...(prepared.quoteIntent.aspectRatio
          ? { aspectRatio: prepared.quoteIntent.aspectRatio }
          : {}),
        catalogModelId: prepared.quoteIntent.catalogModelId,
        operation,
        quantity: prepared.quoteIntent.quantity,
        quoteId: `steering-derived:quote:${input.command.commandId}`,
        workspaceId: input.workspaceId,
      }),
    );
    await this.dependencies.store.markPrepared({
      commandId: input.command.commandId,
      derivedTaskId: prepared.task.id,
      derivedWorkId: prepared.work.id,
    });
    const submitted = await this.dependencies.commands.adjust(
      context,
      {
        billingQuoteId: quote.quoteId,
        derivedTaskId: prepared.task.id,
        derivedWorkId: prepared.work.id,
        instruction: input.instruction,
        scope,
        source: sourceRef,
      },
      `steering-derived:submit:${input.command.commandId}`,
    );
    if (
      submitted.task.id !== prepared.task.id ||
      submitted.work.id !== prepared.work.id ||
      !submitted.contentPackage.id.trim()
    ) {
      throw new Error('Derived steering submission did not preserve its prepared task binding.');
    }
    await this.dependencies.store.markLaunched({
      commandId: input.command.commandId,
      derivedPackageId: submitted.contentPackage.id,
      derivedTaskId: submitted.task.id,
      derivedWorkId: submitted.work.id,
    });
    return { status: 'launched' };
  }
}

function parseRecord(row: Record<string, unknown>): SteeringDerivedWorkflowRecord {
  const affectedUnitIds = row.affected_unit_ids;
  if (!Array.isArray(affectedUnitIds) || affectedUnitIds.some((value) => typeof value !== 'string')) {
    throw new Error('Derived steering outbox contains invalid affected units.');
  }
  const status = row.status;
  if (status !== 'pending' && status !== 'prepared' && status !== 'launched') {
    throw new Error('Derived steering outbox contains an invalid status.');
  }
  return {
    affectedUnitIds: [...affectedUnitIds],
    commandId: stringField(row, 'command_id'),
    ...(typeof row.derived_package_id === 'string'
      ? { derivedPackageId: row.derived_package_id }
      : {}),
    ...(typeof row.derived_task_id === 'string'
      ? { derivedTaskId: row.derived_task_id }
      : {}),
    ...(typeof row.derived_work_id === 'string'
      ? { derivedWorkId: row.derived_work_id }
      : {}),
    instruction: stringField(row, 'instruction'),
    sourceExpectedRevision: numberField(row, 'source_expected_revision'),
    sourcePackageId: stringField(row, 'source_package_id'),
    sourceSnapshotId: stringField(row, 'source_snapshot_id'),
    status,
    workspaceId: stringField(row, 'workspace_id'),
  };
}

function stringField(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Derived steering outbox is missing ${name}.`);
  }
  return value;
}

function numberField(row: Record<string, unknown>, name: string): number {
  const value = row[name];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Derived steering outbox has invalid ${name}.`);
  }
  return parsed;
}

function samePendingFacts(
  stored: SteeringDerivedWorkflowRecord,
  expected: SteeringDerivedWorkflowRecord,
): boolean {
  return (
    stored.workspaceId === expected.workspaceId &&
    stored.instruction === expected.instruction &&
    stored.sourcePackageId === expected.sourcePackageId &&
    stored.sourceExpectedRevision === expected.sourceExpectedRevision &&
    stored.sourceSnapshotId === expected.sourceSnapshotId &&
    JSON.stringify(stored.affectedUnitIds) === JSON.stringify(expected.affectedUnitIds)
  );
}

function contextOf(input: SteeringConsumerInput): P1Context {
  return {
    correlationId: input.command.commandId,
    userId: input.command.actorId,
    workspaceId: input.workspaceId,
  };
}

function affectedAssets(
  source: SteeringDerivedSource,
  unitIds: readonly string[],
): string[] {
  const current = source.versions.find(
    (candidate) => candidate.id === source.currentVersionId,
  );
  const pageAssets = current?.note?.plan?.pages
    .filter((page) => unitIds.includes(page.id))
    .flatMap((page) => (page.imageAssetId ? [page.imageAssetId] : [])) ?? [];
  const owned = new Set([
    ...source.generated.assetIds,
    ...(source.generated.ownedAssets ?? []).map((asset) => asset.id),
    ...(current?.orderedAssetIds ?? []),
  ]);
  return [
    ...new Set([
      ...pageAssets,
      ...unitIds.filter((unitId) => owned.has(unitId)),
    ]),
  ];
}
