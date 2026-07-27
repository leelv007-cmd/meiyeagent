import { isDeepStrictEqual } from 'node:util';

import {
  assetIntakeBatchSchema,
  finalizeStoreIntakeCommandSchema,
  type AssetIntakeBatch,
  type FinalizeStoreIntakeCommand,
  type RecordAssetIntakeBatchCommand,
  type StoreFact,
  type StoreProfile,
  type StoreProfilePatch,
} from '@meiye/contracts';
import type { Pool } from 'pg';

import type { P1Context } from '../foundation/domain.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  AssetIntakeError,
  type AssetIntakeService,
} from './asset-intake-service.js';
import { StoreFactRevisionConflictError } from './store-fact-ledger.js';

export type StoreIntakeFinalizationIntakePort = Pick<
  AssetIntakeService,
  | 'confirmFact'
  | 'confirmedFactRevision'
  | 'currentFact'
  | 'currentFactRevision'
  | 'persistedBatch'
  | 'recordBatch'
>;

export interface StoreProfileMergePort {
  completedRevision(
    context: P1Context,
    patch: StoreProfilePatch,
    idempotencyKey: string,
  ): Promise<number | null>;
  currentRevision(context: P1Context): Promise<number>;
  merge(
    context: P1Context,
    patch: StoreProfilePatch,
    idempotencyKey: string,
  ): Promise<StoreProfile>;
}

export interface StoreIntakeFinalizationResult {
  facts: StoreFact[];
  profileRevision: number;
}

interface StoreIntakeFinalizationReceipt {
  error: {
    code: StoreIntakeFinalizationError['code'];
    message: string;
  } | null;
  fingerprint: string;
  result: StoreIntakeFinalizationResult | null;
  status: 'pending' | 'completed' | 'rejected' | 'needs_reconciliation';
}

export interface StoreIntakeFinalizationRepository {
  withLock<T>(
    workspaceId: string,
    idempotencyKey: string,
    action: () => Promise<T>,
  ): Promise<T>;
  begin(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
  ): Promise<StoreIntakeFinalizationReceipt>;
  complete(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
    result: StoreIntakeFinalizationResult,
  ): Promise<StoreIntakeFinalizationResult>;
  reject(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
    error: StoreIntakeFinalizationError,
  ): Promise<void>;
  markNeedsReconciliation(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
    error: StoreIntakeFinalizationError,
  ): Promise<void>;
}

export class StoreIntakeFinalizationError extends Error {
  readonly status = 409;

  constructor(
    readonly code:
      | 'STORE_FACT_REVISION_CONFLICT'
      | 'STORE_FACT_MAPPING_INVALID'
      | 'STORE_INTAKE_BATCH_UNTRUSTED'
      | 'STORE_INTAKE_IDEMPOTENCY_CONFLICT'
      | 'STORE_PROJECT_REVOCATION_REQUIRED'
      | 'STORE_PROFILE_REVISION_CONFLICT'
      | 'STORE_INTAKE_FINALIZATION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'StoreIntakeFinalizationError';
  }
}

interface FinalizationRow {
  error: StoreIntakeFinalizationReceipt['error'];
  fingerprint: string;
  result: StoreIntakeFinalizationResult | null;
  status: StoreIntakeFinalizationReceipt['status'];
}

export class PostgresStoreIntakeFinalizationRepository
  implements StoreIntakeFinalizationRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS p1_store_intake_finalization_outbox (
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        fingerprint text NOT NULL,
        status text NOT NULL DEFAULT 'pending'
          CHECK (
            status IN (
              'pending',
              'completed',
              'rejected',
              'needs_reconciliation'
            )
          ),
        result jsonb,
        error jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      ALTER TABLE p1_store_intake_finalization_outbox
        ADD COLUMN IF NOT EXISTS error jsonb;
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conrelid =
                   'p1_store_intake_finalization_outbox'::regclass
             AND conname =
                   'p1_store_intake_finalization_outbox_status_check'
             AND pg_get_constraintdef(oid)
                   NOT LIKE '%needs_reconciliation%'
        ) THEN
          ALTER TABLE p1_store_intake_finalization_outbox
            DROP CONSTRAINT
              p1_store_intake_finalization_outbox_status_check;
          ALTER TABLE p1_store_intake_finalization_outbox
            ADD CONSTRAINT
              p1_store_intake_finalization_outbox_status_check
            CHECK (
              status IN (
                'pending',
                'completed',
                'rejected',
                'needs_reconciliation'
              )
            );
        END IF;
      END
      $$;
    `);
  }

  async withLock<T>(
    workspaceId: string,
    _idempotencyKey: string,
    action: () => Promise<T>,
  ) {
    const client = await this.pool.connect();
    const lockKey = `${workspaceId}:store-intake`;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      return await action();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
      client.release();
    }
  }

  async begin(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
  ) {
    await this.pool.query(
      `INSERT INTO p1_store_intake_finalization_outbox (
         workspace_id,
         idempotency_key,
         fingerprint
       ) VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
      [workspaceId, idempotencyKey, fingerprint],
    );
    const result = await this.pool.query<FinalizationRow>(
      `SELECT fingerprint, status, result, error
         FROM p1_store_intake_finalization_outbox
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    const receipt = result.rows[0];
    if (!receipt || receipt.fingerprint !== fingerprint) {
      throw new StoreIntakeFinalizationError(
        'STORE_INTAKE_IDEMPOTENCY_CONFLICT',
        'The store intake idempotency key belongs to another payload.',
      );
    }
    return receipt;
  }

  async complete(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
    result: StoreIntakeFinalizationResult,
  ) {
    const completed = await this.pool.query<FinalizationRow>(
      `UPDATE p1_store_intake_finalization_outbox
          SET status = 'completed',
              result = $4::jsonb,
              error = NULL,
              updated_at = now()
        WHERE workspace_id = $1
          AND idempotency_key = $2
          AND fingerprint = $3
      RETURNING fingerprint, status, result, error`,
      [workspaceId, idempotencyKey, fingerprint, JSON.stringify(result)],
    );
    const receipt = completed.rows[0];
    if (!receipt?.result) {
      throw new StoreIntakeFinalizationError(
        'STORE_INTAKE_IDEMPOTENCY_CONFLICT',
        'The store intake finalization receipt changed.',
      );
    }
    return receipt.result;
  }

  async reject(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
    error: StoreIntakeFinalizationError,
  ) {
    const result = await this.pool.query(
      `UPDATE p1_store_intake_finalization_outbox
          SET status = 'rejected',
              error = $4::jsonb,
              updated_at = now()
        WHERE workspace_id = $1
          AND idempotency_key = $2
          AND fingerprint = $3
          AND status = 'pending'`,
      [
        workspaceId,
        idempotencyKey,
        fingerprint,
        JSON.stringify({ code: error.code, message: error.message }),
      ],
    );
    if (result.rowCount !== 1) {
      throw new StoreIntakeFinalizationError(
        'STORE_INTAKE_IDEMPOTENCY_CONFLICT',
        'The store intake finalization receipt changed before rejection.',
      );
    }
  }

  async markNeedsReconciliation(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
    error: StoreIntakeFinalizationError,
  ) {
    const result = await this.pool.query(
      `UPDATE p1_store_intake_finalization_outbox
          SET status = 'needs_reconciliation',
              error = $4::jsonb,
              updated_at = now()
        WHERE workspace_id = $1
          AND idempotency_key = $2
          AND fingerprint = $3
          AND status IN ('pending', 'needs_reconciliation')`,
      [
        workspaceId,
        idempotencyKey,
        fingerprint,
        JSON.stringify({ code: error.code, message: error.message }),
      ],
    );
    if (result.rowCount !== 1) {
      throw new StoreIntakeFinalizationError(
        'STORE_INTAKE_IDEMPOTENCY_CONFLICT',
        'The store intake finalization receipt changed during reconciliation.',
      );
    }
  }

  async deleteWorkspaceForTest(workspaceId: string) {
    await this.pool.query(
      `DELETE FROM p1_store_intake_finalization_outbox
        WHERE workspace_id = $1`,
      [workspaceId],
    );
  }
}

export class StoreIntakeFinalizer {
  constructor(
    private readonly intake: StoreIntakeFinalizationIntakePort,
    private readonly finalizations: StoreIntakeFinalizationRepository,
    private readonly profiles: StoreProfileMergePort,
  ) {}

  async finalize(
    context: P1Context,
    value: FinalizeStoreIntakeCommand,
    idempotencyKey: string,
  ) {
    const input = finalizeStoreIntakeCommandSchema.parse(value);
    const fingerprint = fingerprintValue({
      action: 'finalize_store_intake',
      input,
      workspaceId: context.workspaceId,
    });
    return this.finalizations.withLock(
      context.workspaceId,
      idempotencyKey,
      async () => {
        const receipt = await this.finalizations.begin(
          context.workspaceId,
          idempotencyKey,
          fingerprint,
        );
        if (receipt.status === 'completed' && receipt.result) {
          return receipt.result;
        }
        if (receipt.status === 'rejected' && receipt.error) {
          throw new StoreIntakeFinalizationError(
            receipt.error.code,
            receipt.error.message,
          );
        }
        let resolved: { batch: AssetIntakeBatch; inline: boolean };
        try {
          resolved = await this.resolveBatch(context.workspaceId, input);
        } catch (error) {
          const failure = finalizationFailure(error);
          await this.finalizations.reject(
            context.workspaceId,
            idempotencyKey,
            fingerprint,
            failure,
          );
          throw failure;
        }
        try {
          await assertStoreFactMappings(
            context.workspaceId,
            resolved.batch,
            input.confirmations,
            input.profilePatch,
            (factId) => this.intake.currentFact(context.workspaceId, factId),
          );
          await this.preflight(
            context,
            input,
            resolved.batch,
            idempotencyKey,
          );
        } catch (error) {
          const failure = finalizationFailure(error);
          if (
            await this.hasStagedFactReceipt(
              context.workspaceId,
              resolved.batch.batchId,
              input,
              idempotencyKey,
            )
          ) {
            await this.finalizations.markNeedsReconciliation(
              context.workspaceId,
              idempotencyKey,
              fingerprint,
              failure,
            );
          } else {
            await this.finalizations.reject(
              context.workspaceId,
              idempotencyKey,
              fingerprint,
              failure,
            );
          }
          throw failure;
        }

        const batch = resolved.batch;
        try {
          if (resolved.inline) {
            await this.intake.recordBatch(
              batch,
              fingerprintValue({ action: 'finalize_store_intake', batch }),
            );
          }
        } catch (error) {
          const failure = finalizationFailure(error);
          await this.finalizations.reject(
            context.workspaceId,
            idempotencyKey,
            fingerprint,
            failure,
          );
          throw failure;
        }
        try {
          const facts: StoreFact[] = [];
          for (const confirmation of input.confirmations) {
            facts.push(
              await this.intake.confirmFact(context, {
                ...confirmation,
                batchId: batch.batchId,
                idempotencyKey: `${idempotencyKey}:fact:${confirmation.candidateId}`,
              }),
            );
          }
          const profile = await this.profiles.merge(
            context,
            input.profilePatch,
            `${idempotencyKey}:profile`,
          );
          return this.finalizations.complete(
            context.workspaceId,
            idempotencyKey,
            fingerprint,
            {
              facts,
              profileRevision: profile.revision ?? 1,
            },
          );
        } catch (error) {
          const failure = finalizationFailure(error);
          if (
            await this.hasStagedFactReceipt(
              context.workspaceId,
              batch.batchId,
              input,
              idempotencyKey,
            )
          ) {
            await this.finalizations.markNeedsReconciliation(
              context.workspaceId,
              idempotencyKey,
              fingerprint,
              failure,
            );
          } else {
            await this.finalizations.reject(
              context.workspaceId,
              idempotencyKey,
              fingerprint,
              failure,
            );
          }
          throw failure;
        }
      },
    );
  }

  private async preflight(
    context: P1Context,
    input: FinalizeStoreIntakeCommand,
    batch: AssetIntakeBatch,
    idempotencyKey: string,
  ) {
    const profileRevision = await this.profiles.currentRevision(context);
    if (profileRevision !== input.profilePatch.expectedRevision) {
      const recoveredRevision = await this.profiles.completedRevision(
        context,
        input.profilePatch,
        `${idempotencyKey}:profile`,
      );
      if (recoveredRevision !== input.profilePatch.expectedRevision + 1) {
        throw new StoreIntakeFinalizationError(
          'STORE_PROFILE_REVISION_CONFLICT',
          `Store profile expected revision ${input.profilePatch.expectedRevision}, current revision is ${profileRevision}.`,
        );
      }
    }
    await this.requireProjectRevocations(context, input, batch);
    for (const confirmation of input.confirmations) {
      const currentRevision = await this.intake.currentFactRevision(
        context.workspaceId,
        confirmation.factId,
      );
      if (currentRevision === confirmation.expectedFactRevision) {
        continue;
      }
      const recoveredRevision = await this.intake.confirmedFactRevision(
        context.workspaceId,
        `${idempotencyKey}:fact:${confirmation.candidateId}`,
        {
          ...confirmation,
          batchId: batch.batchId,
        },
      );
      if (currentRevision !== recoveredRevision) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_REVISION_CONFLICT',
          `Store fact ${confirmation.factId} expected revision ${confirmation.expectedFactRevision}, current revision is ${currentRevision}.`,
        );
      }
    }
  }

  private async requireProjectRevocations(
    context: P1Context,
    input: FinalizeStoreIntakeCommand,
    batch: AssetIntakeBatch,
  ) {
    for (const projectId of input.profilePatch.projects?.clear ?? []) {
      for (const kind of ['service', 'price'] as const) {
        const factId = `store-project:${projectId}:${kind}`;
        const currentRevision = await this.intake.currentFactRevision(
          context.workspaceId,
          factId,
        );
        if (currentRevision === 0) continue;
        const confirmation = input.confirmations.find(
          (item) => item.factId === factId,
        );
        const candidate = batch.candidates.find(
          (item) =>
            item.objectKind === 'store_fact' &&
            item.candidateId === confirmation?.candidateId,
        );
        if (
          !confirmation ||
          confirmation.expectedFactRevision !== currentRevision ||
          candidate?.objectKind !== 'store_fact' ||
          candidate.fact.revisionKind !== 'revocation' ||
          candidate.fact.value !== null
        ) {
          throw new StoreIntakeFinalizationError(
            'STORE_PROJECT_REVOCATION_REQUIRED',
            `Clearing project ${projectId} requires a revocation for active ${kind} fact ${factId}.`,
          );
        }
      }
    }
  }

  private async resolveBatch(
    workspaceId: string,
    input: FinalizeStoreIntakeCommand,
  ): Promise<{ batch: AssetIntakeBatch; inline: boolean }> {
    if ('candidates' in input.batch) {
      return {
        batch: normalizeInlineBatch(
          workspaceId,
          input.batch,
          input.confirmations,
        ),
        inline: true,
      };
    }
    const receipt = await this.intake.persistedBatch(
      workspaceId,
      input.batch.batchId,
    );
    if (
      receipt.batch.source.kind !== 'manual' &&
      receipt.commandFingerprint === null
    ) {
      throw new StoreIntakeFinalizationError(
        'STORE_INTAKE_BATCH_UNTRUSTED',
        'A parsed or screenshot intake batch requires a server persistence receipt.',
      );
    }
    return { batch: receipt.batch, inline: false };
  }

  private async hasStagedFactReceipt(
    workspaceId: string,
    resolvedBatchId: string,
    input: FinalizeStoreIntakeCommand,
    idempotencyKey: string,
  ) {
    for (const confirmation of input.confirmations) {
      const revision = await this.intake.confirmedFactRevision(
        workspaceId,
        `${idempotencyKey}:fact:${confirmation.candidateId}`,
        {
          ...confirmation,
          batchId: resolvedBatchId,
        },
      );
      if (revision !== null) return true;
    }
    return false;
  }
}

function normalizeInlineBatch(
  workspaceId: string,
  batch: RecordAssetIntakeBatchCommand,
  confirmations: FinalizeStoreIntakeCommand['confirmations'],
) {
  return assetIntakeBatchSchema.parse({
    ...batch,
    workspaceId,
    source: {
      ...batch.source,
      capabilityStatus: 'assisted',
      sourceWorkspaceId: workspaceId,
    },
    candidates: batch.candidates.map((candidate) =>
      candidate.objectKind === 'store_fact'
        ? {
            ...candidate,
            fact: {
              ...candidate.fact,
              scope: inlineFactScope(
                workspaceId,
                confirmations.find(
                  (confirmation) =>
                    confirmation.candidateId === candidate.candidateId,
                )?.factId,
              ),
              source: {
                kind: 'user_confirmation',
                referenceId: batch.source.referenceId,
                capturedAt: batch.source.capturedAt,
              },
            },
          }
        : candidate,
    ),
    createdAt: batch.source.capturedAt,
  });
}

function inlineFactScope(workspaceId: string, factId: string | undefined) {
  const projectId =
    /^store-project:([^:]+):(service|price|group_buy|discount|fulfillment)$/u.exec(
      factId ?? '',
    )?.[1];
  return {
    storeId: workspaceId,
    ...(projectId ? { serviceId: projectId } : {}),
  };
}

const PROFILE_FACT_MAPPINGS = {
  'store-profile:name:other': {
    kind: 'other',
    key: 'store.profile.name',
    patchField: 'name',
    valueField: 'name',
  },
  'store-profile:city:other': {
    kind: 'other',
    key: 'store.profile.city',
    patchField: 'city',
    valueField: 'city',
  },
  'store-profile:district:other': {
    kind: 'other',
    key: 'store.profile.district',
    patchField: 'district',
    valueField: 'district',
  },
  'store-profile:address:fulfillment': {
    kind: 'fulfillment',
    key: 'store.fulfillment.address',
    patchField: 'address',
    valueField: 'address',
  },
  'store-profile:booking:fulfillment': {
    kind: 'fulfillment',
    key: 'store.fulfillment.booking',
    patchField: 'booking',
    valueField: 'booking',
  },
} as const;

const PROJECT_FACT_KINDS = new Set([
  'service',
  'price',
  'group_buy',
  'discount',
  'fulfillment',
]);

async function assertStoreFactMappings(
  workspaceId: string,
  batch: AssetIntakeBatch,
  confirmations: FinalizeStoreIntakeCommand['confirmations'],
  profilePatch: StoreProfilePatch,
  currentFact: (factId: string) => Promise<StoreFact | null>,
) {
  for (const confirmation of confirmations) {
    const candidate = batch.candidates.find(
      (item) =>
        item.objectKind === 'store_fact' &&
        item.candidateId === confirmation.candidateId,
    );
    if (candidate?.objectKind !== 'store_fact') {
      throw new StoreIntakeFinalizationError(
        'STORE_FACT_MAPPING_INVALID',
        `Store fact candidate ${confirmation.candidateId} was not found in the persisted batch.`,
      );
    }
    const fact = candidate.fact;
    if (
      fact.scope.storeId !== workspaceId ||
      fact.scope.personaId !== undefined ||
      fact.scope.platform !== undefined
    ) {
      throw new StoreIntakeFinalizationError(
        'STORE_FACT_MAPPING_INVALID',
        `Store fact ${confirmation.factId} has an invalid store scope.`,
      );
    }
    const profileMapping =
      PROFILE_FACT_MAPPINGS[
        confirmation.factId as keyof typeof PROFILE_FACT_MAPPINGS
      ];
    if (profileMapping) {
      if (
        fact.kind !== profileMapping.kind ||
        fact.key !== profileMapping.key ||
        fact.scope.serviceId !== undefined
      ) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_MAPPING_INVALID',
          `Store profile fact ${confirmation.factId} does not match its allowed kind and key.`,
        );
      }
      const projectedValue = profilePatch[profileMapping.patchField];
      if (projectedValue === undefined) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_MAPPING_INVALID',
          `Store profile fact ${confirmation.factId} requires its profile patch field.`,
        );
      }
      if (
        !isDeepStrictEqual(fact.value, {
          [profileMapping.valueField]: projectedValue,
        })
      ) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_MAPPING_INVALID',
          `Store profile fact ${confirmation.factId} does not match its profile patch.`,
        );
      }
      continue;
    }
    const projectMatch =
      /^store-project:([^:]+):(service|price|group_buy|discount|fulfillment)$/u.exec(
        confirmation.factId,
      );
    const projectId = projectMatch?.[1];
    const kind = projectMatch?.[2];
    const expectedKey =
      projectId && kind
        ? kind === 'service'
          ? `service.${projectId}.name`
          : `service.${projectId}.${kind}`
        : null;
    if (
      !projectId ||
      !kind ||
      !PROJECT_FACT_KINDS.has(kind) ||
      fact.kind !== kind ||
      fact.scope.serviceId !== projectId ||
      fact.key !== expectedKey
    ) {
      throw new StoreIntakeFinalizationError(
        'STORE_FACT_MAPPING_INVALID',
        `Store project fact ${confirmation.factId} does not match its project, kind, and key.`,
      );
    }
    const projectedProject = profilePatch.projects?.upsert?.find(
      (project) => project.id === projectId,
    );
    if (kind === 'price') {
      if (fact.revisionKind === 'revocation') {
        if (
          !profilePatch.projects?.clear?.includes(projectId) ||
          projectedProject
        ) {
          throw new StoreIntakeFinalizationError(
            'STORE_FACT_MAPPING_INVALID',
            `Store project price revocation ${confirmation.factId} requires a clear patch without an overlapping upsert.`,
          );
        }
        continue;
      }
      if (!projectedProject) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_MAPPING_INVALID',
          `Store project price fact ${confirmation.factId} requires its project upsert.`,
        );
      }
      if (
        !isDeepStrictEqual(fact.value, {
          amount: projectedProject.price,
          currency: 'CNY',
        })
      ) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_MAPPING_INVALID',
          `Store project price fact ${confirmation.factId} does not match its profile patch.`,
        );
      }
    }
    if (kind === 'service') {
      if (fact.revisionKind === 'revocation') {
        if (
          !profilePatch.projects?.clear?.includes(projectId) ||
          projectedProject
        ) {
          throw new StoreIntakeFinalizationError(
            'STORE_FACT_MAPPING_INVALID',
            `Store project service revocation ${confirmation.factId} requires a clear patch without an overlapping upsert.`,
          );
        }
        continue;
      }
      if (!projectedProject) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_MAPPING_INVALID',
          `Store project service fact ${confirmation.factId} requires its project upsert.`,
        );
      }
      if (!isDeepStrictEqual(fact.value, { name: projectedProject.name })) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_MAPPING_INVALID',
          `Store project service fact ${confirmation.factId} does not match its profile patch.`,
        );
      }
    }
  }

  for (const [factId, mapping] of Object.entries(PROFILE_FACT_MAPPINGS)) {
    if (profilePatch[mapping.patchField] === undefined) continue;
    if (!confirmations.some((confirmation) => confirmation.factId === factId)) {
      throw new StoreIntakeFinalizationError(
        'STORE_FACT_MAPPING_INVALID',
        `Store profile patch field ${mapping.patchField} requires confirmation ${factId}.`,
      );
    }
  }

  for (const project of profilePatch.projects?.upsert ?? []) {
    for (const kind of ['service', 'price'] as const) {
      const factId = `store-project:${project.id}:${kind}`;
      if (confirmations.some((confirmation) => confirmation.factId === factId)) {
        continue;
      }
      // The rule this enforces is "no project value reaches the profile without
      // a merchant confirmation behind it" — not "two confirmations per
      // command". A stream already standing in the ledger with exactly this
      // value carries its own earlier confirmation, and demanding a second one
      // would make the *other*, still-missing stream unconfirmable forever
      // (D-151③ partial import).
      const current = await currentFact(factId);
      const backed =
        current !== null &&
        current.revisionKind !== 'revocation' &&
        // A fact that expires stops backing the profile the moment it does, so
        // only an open-ended one may stand in for a confirmation.
        current.expiresAt === null &&
        isDeepStrictEqual(
          current.value,
          kind === 'service'
            ? { name: project.name }
            : { amount: project.price, currency: 'CNY' },
        );
      if (!backed) {
        throw new StoreIntakeFinalizationError(
          'STORE_FACT_MAPPING_INVALID',
          `Store project patch ${project.id} requires confirmation ${factId}.`,
        );
      }
    }
  }
}

function finalizationFailure(error: unknown) {
  if (error instanceof StoreIntakeFinalizationError) return error;
  if (error instanceof StoreFactRevisionConflictError) {
    return new StoreIntakeFinalizationError(
      'STORE_FACT_REVISION_CONFLICT',
      error.message,
    );
  }
  if (
    error instanceof AssetIntakeError &&
    error.code === 'DECISION_CONFLICT'
  ) {
    return new StoreIntakeFinalizationError(
      'STORE_FACT_REVISION_CONFLICT',
      error.message,
    );
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'STORE_PROFILE_REVISION_CONFLICT' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return new StoreIntakeFinalizationError(
      'STORE_PROFILE_REVISION_CONFLICT',
      error.message,
    );
  }
  return new StoreIntakeFinalizationError(
    'STORE_INTAKE_FINALIZATION_FAILED',
    error instanceof Error
      ? error.message
      : 'Store intake finalization failed after the batch was accepted.',
  );
}
