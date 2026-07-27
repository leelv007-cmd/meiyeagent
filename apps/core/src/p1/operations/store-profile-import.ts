/**
 * D-151③ historical migration — existing merchants' stable profile fields are
 * turned into *pending* StoreFact candidates carrying `source.kind: 'import'`,
 * never silently promoted to confirmed facts.
 *
 * A store that was filled in through the retired manual form (or an earlier
 * `confirm_store`) only lives in `ProductState.store`. The ledger — the single
 * content authority since D-151① — knows nothing about it, so nothing the
 * merchant already typed can be quoted in a delivery. Importing those values
 * straight into the ledger would forge merchant confirmations for numbers no
 * one re-read, so this preparer stages them as candidates instead: the batch is
 * persisted server-side with an audit-anchored reference, and the merchant
 * turns them into facts with one `finalize_store_intake` confirmation.
 */

import type { AssetIntakeBatch, StoreProfile } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { AssetIntakeService } from './asset-intake-service.js';

export interface StoreProfileImportSource {
  read(context: P1Context): Promise<StoreProfile | undefined>;
}

export type StoreProfileImportIntakePort = Pick<
  AssetIntakeService,
  'currentFactRevision' | 'recordBatch'
>;

/** Stable profile scalars projected into the D-151② allowlist. */
const PROFILE_IMPORTS = [
  {
    factId: 'store-profile:name:other',
    field: 'name',
    kind: 'other',
    key: 'store.profile.name',
  },
  {
    factId: 'store-profile:city:other',
    field: 'city',
    kind: 'other',
    key: 'store.profile.city',
  },
  {
    factId: 'store-profile:district:other',
    field: 'district',
    kind: 'other',
    key: 'store.profile.district',
  },
  {
    factId: 'store-profile:address:fulfillment',
    field: 'address',
    kind: 'fulfillment',
    key: 'store.fulfillment.address',
  },
  {
    factId: 'store-profile:booking:fulfillment',
    field: 'booking',
    kind: 'fulfillment',
    key: 'store.fulfillment.booking',
  },
] as const satisfies ReadonlyArray<{
  factId: string;
  field: 'name' | 'city' | 'district' | 'address' | 'booking';
  kind: 'other' | 'fulfillment';
  key: string;
}>;

export interface StoreProfileImportResult {
  batch: AssetIntakeBatch | null;
  /** Profile revision the candidates were derived from. */
  profileRevision: number;
}

export class StoreProfileImportPreparer {
  constructor(
    private readonly profiles: StoreProfileImportSource,
    private readonly intake: StoreProfileImportIntakePort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async prepare(context: P1Context): Promise<StoreProfileImportResult> {
    const store = await this.profiles.read(context);
    if (!store) return { batch: null, profileRevision: 0 };
    const profileRevision = store.revision ?? 0;
    // The reference is the merchant's own historical confirmation, not this
    // request: `capturedAt` has to say when the value was actually stated.
    const capturedAt = store.confirmedAt ?? this.now();
    const referenceId = `store-profile-confirmation:${context.workspaceId}:${profileRevision}`;
    const batchId = `store-profile-import:${profileRevision}`;
    const candidates: AssetIntakeBatch['candidates'] = [];

    for (const mapping of PROFILE_IMPORTS) {
      const value = store[mapping.field].trim();
      if (!value) continue;
      if (await this.hasFact(context.workspaceId, mapping.factId)) continue;
      candidates.push({
        candidateId: `${mapping.factId}:import`,
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: mapping.kind,
          key: mapping.key,
          value: { [mapping.field]: value },
          scope: { storeId: context.workspaceId },
          source: { kind: 'import', referenceId, capturedAt },
          effectiveFrom: capturedAt,
          expiresAt: null,
        },
      });
    }

    for (const project of store.projects) {
      // An unconfirmed project is a draft the merchant never stood behind;
      // importing it would launder a draft into a quotable candidate.
      if (!project.confirmed) continue;
      const serviceFactId = `store-project:${project.id}:service`;
      const priceFactId = `store-project:${project.id}:price`;
      if (
        (await this.hasFact(context.workspaceId, serviceFactId)) ||
        (await this.hasFact(context.workspaceId, priceFactId))
      ) {
        continue;
      }
      const scope = { storeId: context.workspaceId, serviceId: project.id };
      candidates.push(
        {
          candidateId: `${serviceFactId}:import`,
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'service',
            key: `service.${project.id}.name`,
            value: { name: project.name },
            scope,
            source: { kind: 'import', referenceId, capturedAt },
            effectiveFrom: capturedAt,
            expiresAt: null,
          },
        },
        {
          candidateId: `${priceFactId}:import`,
          status: 'pending',
          objectKind: 'store_fact',
          fact: {
            kind: 'price',
            key: `service.${project.id}.price`,
            value: { amount: project.price, currency: 'CNY' },
            scope,
            source: { kind: 'import', referenceId, capturedAt },
            effectiveFrom: capturedAt,
            expiresAt: null,
          },
        },
      );
    }

    if (candidates.length === 0) return { batch: null, profileRevision };

    const batch = await this.intake.recordBatch(
      {
        batchId,
        workspaceId: context.workspaceId,
        taskId: `store-profile-import-task:${profileRevision}`,
        source: {
          sourceId: `store-profile-import-source:${profileRevision}`,
          kind: 'import',
          referenceId,
          capabilityStatus: 'assisted',
          sourceWorkspaceId: context.workspaceId,
          capturedAt,
          example: false,
        },
        summary: `已从门店档案整理出 ${candidates.length} 项待确认资料。`,
        candidates,
        createdAt: capturedAt,
      },
      fingerprintValue({
        action: 'prepare_store_profile_import',
        workspaceId: context.workspaceId,
        profileRevision,
        candidates,
      }),
    );
    return { batch, profileRevision };
  }

  private async hasFact(workspaceId: string, factId: string) {
    return (await this.intake.currentFactRevision(workspaceId, factId)) > 0;
  }
}
