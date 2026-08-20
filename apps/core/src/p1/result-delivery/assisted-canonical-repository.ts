import { randomUUID } from 'node:crypto';

import {
  approvalReceiptSchema,
  contentPackageDeliveryAttemptId,
  contentPackageSchema,
  type ApprovalReceipt,
  type ContentPackage,
  type ContentPackageExportReceipt,
  type ContentPackageVersion,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';

import type { P1Context } from '../foundation/domain.js';
import { updateContentPackageRow } from '../operations/postgres-content-package-write-adapter.js';
import {
  assistedReceiptBindingSchema,
  assistedReceiptSchema,
  consumeOneShotHandoffLink,
  handOverAssistedReceipt,
  prepareAssistedMaterials,
  recordAssistedPublishResult,
  type AssistedPublishResult,
  type AssistedReceipt,
  type AssistedReceiptBinding,
} from './assisted-receipt.js';
import {
  AssistedReceiptConflictError,
  type AssistedReceiptRepository,
  type StoredAssistedReceipt,
} from './assisted-receipt-repository.js';

export type CanonicalAssistedPrepareInput = {
  contentPackageRevision: number;
  exportReceiptId: string;
  id?: string;
  occurredAt: string;
  packageId: string;
  platform: 'xiaohongshu' | 'douyin' | 'video_account';
  variantVersionId: string;
};

export type CanonicalAssistedHandoff = {
  assistedReceipt: AssistedReceipt;
  body: string;
  checklist: string[];
  contentPackageRevision: number;
  conversionText: string;
  expiresAt: string;
  exportReceiptId: string;
  fullPackageDownloadUrl?: string;
  media: Array<{
    contentType: string;
    downloadUrl: string;
    id: string;
    kind: 'image' | 'video' | 'file';
    label: string;
  }>;
  packageId: string;
  platform: CanonicalAssistedPrepareInput['platform'];
  sharePath: string;
  title: string;
  token: string;
  topics: string[];
  variantVersionId: string;
};

export type CanonicalHandoffConsumeResult =
  | {
      handoff: CanonicalAssistedHandoff;
      kind: 'ok';
      receipt: AssistedReceipt;
      revision: number;
    }
  | { kind: 'consumed' | 'expired' | 'not_found' };

export class CanonicalAssistedDeliveryError extends Error {
  readonly status = 409;

  constructor(
    readonly code:
      | 'CANONICAL_PACKAGE_NOT_FOUND'
      | 'CANONICAL_REVISION_MISMATCH'
      | 'CANONICAL_VARIANT_MISMATCH'
      | 'CANONICAL_EXPORT_MISMATCH'
      | 'CANONICAL_APPROVAL_NOT_FOUND'
      | 'CANONICAL_APPROVAL_NOT_ACTIVE'
      | 'CANONICAL_APPROVAL_BINDING_MISMATCH'
      | 'CANONICAL_HANDOFF_REPREPARE_REQUIRED'
      | 'CANONICAL_RECEIPT_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'CanonicalAssistedDeliveryError';
  }
}

export interface CanonicalAssistedReceiptRepository
  extends AssistedReceiptRepository {
  prepareHandoffCanonical(
    context: P1Context,
    input: {
      binding: AssistedReceiptBinding;
      linkToken?: string;
      prepare: CanonicalAssistedPrepareInput;
    },
  ): Promise<StoredAssistedReceipt>;
  prepareCanonical(
    context: P1Context,
    input: CanonicalAssistedPrepareInput,
  ): Promise<StoredAssistedReceipt>;
  handOverCanonical(
    context: P1Context,
    input: {
      binding: AssistedReceiptBinding;
      expectedRevision: number;
      issueHandoffLink?: boolean;
      linkToken?: string;
      occurredAt: string;
      receiptId: string;
    },
  ): Promise<StoredAssistedReceipt>;
  recordPublishResultCanonical(
    context: P1Context,
    input: {
      expectedRevision: number;
      receiptId: string;
      result: AssistedPublishResult;
    },
  ): Promise<StoredAssistedReceipt>;
  consumeCanonicalHandoff(
    context: P1Context,
    input: { now: string; token: string },
  ): Promise<CanonicalHandoffConsumeResult>;
  issueMaterialsHandoffCanonical(
    context: P1Context,
    input: {
      binding: AssistedReceiptBinding;
      linkToken?: string;
      prepare: Omit<CanonicalAssistedPrepareInput, 'exportReceiptId'> & {
        exportReceiptId?: string;
      };
    },
  ): Promise<StoredAssistedReceipt>;
}

export function isCanonicalAssistedReceiptRepository(
  repository: AssistedReceiptRepository,
): repository is CanonicalAssistedReceiptRepository {
  return 'prepareCanonical' in repository;
}

type AssistedRow = { payload: unknown; revision: string };
type PackageRow = { payload: unknown; revision: string };

function storedFromRow(row: AssistedRow): StoredAssistedReceipt {
  return {
    receipt: assistedReceiptSchema.parse(row.payload),
    revision: Number(row.revision),
  };
}

function packageFromRow(row: PackageRow): ContentPackage {
  const contentPackage = contentPackageSchema.parse(row.payload);
  const revision = Number(row.revision);
  if (contentPackage.revision !== revision) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_REVISION_MISMATCH',
      'ContentPackage payload revision does not match the canonical revision.',
    );
  }
  return contentPackage;
}

function copyHandoffVersion(
  contentPackage: ContentPackage,
  receipt: AssistedReceipt,
): ContentPackageVersion {
  const platform =
    receipt.binding?.platform ?? receipt.canonicalTarget?.platform;
  const variantVersionId =
    receipt.binding?.variantVersionId ??
    receipt.canonicalTarget?.variantVersionId;
  const nested = contentPackage.variants.flatMap((variant) =>
    variant.versions.map((version) => ({
      platform: variant.platform,
      version,
    })),
  );
  const byId = nested.find((row) => row.version.id === variantVersionId);
  if (byId) return byId.version;
  const byPlatform = nested.find((row) => row.platform === platform);
  if (byPlatform) return byPlatform.version;
  const current = contentPackage.versions.find(
    (version) => version.id === contentPackage.currentVersionId,
  );
  if (current) return current;
  if (contentPackage.versions[0]) return contentPackage.versions[0];
  throw new CanonicalAssistedDeliveryError(
    'CANONICAL_VARIANT_MISMATCH',
    'The copy-delivery package has no version to project.',
  );
}

function exactVariantVersion(
  contentPackage: ContentPackage,
  platform: CanonicalAssistedPrepareInput['platform'],
  variantVersionId: string,
): ContentPackageVersion {
  const variant = contentPackage.variants.find(
    (candidate) => candidate.platform === platform,
  );
  if (!variant || variant.currentVersionId !== variantVersionId) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_VARIANT_MISMATCH',
      'The exact current platform variant was not found.',
    );
  }
  const version = variant.versions.find(({ id }) => id === variantVersionId);
  if (!version) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_VARIANT_MISMATCH',
      'The exact current platform variant version was not found.',
    );
  }
  return version;
}

function exactExportReceipt(
  contentPackage: ContentPackage,
  input: Pick<
    CanonicalAssistedPrepareInput,
    'exportReceiptId' | 'platform' | 'variantVersionId'
  >,
): ContentPackageExportReceipt {
  const receipt = contentPackage.exportReceipts.find(
    (candidate) =>
      candidate.id === input.exportReceiptId &&
      candidate.platform === input.platform &&
      candidate.variantVersionId === input.variantVersionId &&
      candidate.status === 'succeeded' &&
      Boolean(candidate.artifactAssetId),
  );
  if (!receipt) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_EXPORT_MISMATCH',
      'The exact successful ExportReceipt was not found for this platform variant.',
    );
  }
  return receipt;
}

function assertPreparedTarget(
  receipt: AssistedReceipt,
  contentPackage: ContentPackage,
): {
  exportReceipt: ContentPackageExportReceipt;
  version: ContentPackageVersion;
} {
  const target = receipt.canonicalTarget;
  if (!target || !receipt.exportReceiptId) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_EXPORT_MISMATCH',
      'Assisted receipt is not bound to a canonical export target.',
    );
  }
  if (contentPackage.revision !== target.currentPackageRevision) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_REVISION_MISMATCH',
      'ContentPackage revision changed after assisted materials were verified.',
    );
  }
  return {
    version: exactVariantVersion(
      contentPackage,
      target.platform,
      target.variantVersionId,
    ),
    exportReceipt: exactExportReceipt(contentPackage, {
      exportReceiptId: target.exportReceiptId,
      platform: target.platform,
      variantVersionId: target.variantVersionId,
    }),
  };
}

export function assertRecoverablePreparedTarget(
  receipt: AssistedReceipt,
  contentPackage: ContentPackage,
) {
  const target = receipt.canonicalTarget;
  if (!target || !receipt.exportReceiptId) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_EXPORT_MISMATCH',
      'Assisted receipt is not bound to a canonical export target.',
    );
  }
  const version = exactVariantVersion(
    contentPackage,
    target.platform,
    target.variantVersionId,
  );
  const exportReceipt = exactExportReceipt(contentPackage, {
    exportReceiptId: target.exportReceiptId,
    platform: target.platform,
    variantVersionId: target.variantVersionId,
  });
  let recoveredNonContentRevision: number | undefined;
  if (contentPackage.revision !== target.currentPackageRevision) {
    const approvalReceiptId = receipt.binding?.approvalReceiptId;
    const deliveryAttemptId = approvalReceiptId
      ? contentPackageDeliveryAttemptId(approvalReceiptId)
      : undefined;
    const published = contentPackage.deliveryEvents?.some(
      (event) =>
        event.type === 'manual_publish_result' &&
        event.platform === target.platform &&
        event.variantVersionId === target.variantVersionId &&
        event.status === 'published' &&
        event.beforeRevision === target.currentPackageRevision &&
        event.afterRevision === contentPackage.revision &&
        event.afterRevision === event.beforeRevision + 1 &&
        event.artifactReceiptId === target.exportReceiptId &&
        event.deliveryIdentity?.approvalReceiptId === approvalReceiptId &&
        event.deliveryIdentity?.deliveryAttemptId === deliveryAttemptId,
    );
    const events = contentPackage.deliveryEvents ?? [];
    const latest = events.at(-1);
    const prior = events.at(-2);
    const nonContentOutcome =
      contentPackage.revision === target.currentPackageRevision + 1 &&
      latest?.type === 'manual_publish_result' &&
      (latest.status === 'failed' || latest.status === 'unknown') &&
      latest.platform === target.platform &&
      latest.variantVersionId === target.variantVersionId &&
      latest.beforeRevision === undefined &&
      latest.afterRevision === undefined &&
      latest.artifactReceiptId === undefined &&
      latest.deliveryIdentity === undefined;
    const publishedAfterNonContentOutcome =
      contentPackage.revision === target.currentPackageRevision + 2 &&
      latest?.type === 'manual_publish_result' &&
      latest.status === 'published' &&
      latest.platform === target.platform &&
      latest.variantVersionId === target.variantVersionId &&
      latest.beforeRevision === target.currentPackageRevision + 1 &&
      latest.afterRevision === contentPackage.revision &&
      latest.afterRevision === latest.beforeRevision + 1 &&
      latest.artifactReceiptId === target.exportReceiptId &&
      latest.deliveryIdentity?.approvalReceiptId === approvalReceiptId &&
      latest.deliveryIdentity?.deliveryAttemptId === deliveryAttemptId &&
      prior?.type === 'manual_publish_result' &&
      (prior.status === 'failed' || prior.status === 'unknown') &&
      prior.platform === target.platform &&
      prior.variantVersionId === target.variantVersionId &&
      prior.beforeRevision === undefined &&
      prior.afterRevision === undefined &&
      prior.artifactReceiptId === undefined &&
      prior.deliveryIdentity === undefined;
    if (nonContentOutcome) {
      recoveredNonContentRevision = contentPackage.revision;
    } else if (
      contentPackage.revision < target.currentPackageRevision ||
      (!published && !publishedAfterNonContentOutcome)
    ) {
      throw new CanonicalAssistedDeliveryError(
        'CANONICAL_REVISION_MISMATCH',
        'ContentPackage revision changed outside the recorded publish journey.',
      );
    }
  }
  return {
    exportReceipt,
    ...(recoveredNonContentRevision !== undefined
      ? { recoveredNonContentRevision }
      : {}),
    version,
  };
}

export function consumedCanonicalHandoffRequiresReprepare(
  receipt: AssistedReceipt,
  recoveredNonContentRevision: number | undefined,
) {
  const nonPublishedTerminalResult =
    receipt.status === 'publish_result_recorded' &&
    receipt.publishResult?.status !== 'published';
  return Boolean(
    receipt.handoffLink?.consumedAt &&
      (recoveredNonContentRevision !== undefined || nonPublishedTerminalResult),
  );
}

function sameRecoveryBinding(
  existing: AssistedReceiptBinding | undefined,
  incoming: AssistedReceiptBinding,
) {
  if (!existing) return false;
  const normalizedExisting = assistedReceiptBindingSchema.parse(existing);
  const normalizedIncoming = assistedReceiptBindingSchema.parse({
    ...incoming,
    contentPackageRevision: normalizedExisting.contentPackageRevision,
  });
  return (
    JSON.stringify(normalizedExisting) === JSON.stringify(normalizedIncoming)
  );
}

function matchingApproval(
  contentPackage: ContentPackage,
  receipt: AssistedReceipt,
  binding: AssistedReceiptBinding,
): ApprovalReceipt {
  const target = receipt.canonicalTarget!;
  if (
    binding.workspaceId !== contentPackage.workspaceId ||
    binding.packageId !== contentPackage.id ||
    binding.contentPackageRevision !== target.contentPackageRevision ||
    binding.platform !== target.platform ||
    binding.variantVersionId !== target.variantVersionId
  ) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_APPROVAL_BINDING_MISMATCH',
      'Assisted binding does not match the exact canonical package revision and platform variant.',
    );
  }
  const approval = contentPackage.approvalReceipts?.find(
    ({ id }) => id === binding.approvalReceiptId,
  );
  if (!approval) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_APPROVAL_NOT_FOUND',
      'The one-shot ApprovalReceipt was not found.',
    );
  }
  const variant = contentPackage.variants.find(
    ({ platform }) => platform === binding.platform,
  )!;
  const contentRevision =
    variant.versions.findIndex(({ id }) => id === binding.variantVersionId) + 1;
  const approved = approval.binding;
  const accountMatches =
    binding.responsibilityRole === 'external_owner'
      ? !binding.accountId || approved.accountId === binding.accountId
      : approved.accountId === binding.accountId;
  const costMatches =
    approved.cost.currency === binding.costRange.currency &&
    approved.cost.amount >= binding.costRange.minAmount &&
    approved.cost.amount <= binding.costRange.maxAmount;
  if (
    approved.workspaceId !== binding.workspaceId ||
    approved.packageId !== binding.packageId ||
    approved.platform !== binding.platform ||
    approved.variantVersionId !== binding.variantVersionId ||
    approved.contentRevision !== contentRevision ||
    approved.purpose !== binding.purpose ||
    approved.actionScheduledAt !== binding.scheduledAt ||
    !accountMatches ||
    !costMatches
  ) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_APPROVAL_BINDING_MISMATCH',
      'The ApprovalReceipt account, responsible target, purpose, time, cost, or content binding does not match.',
    );
  }
  return approval;
}

function exactApproval(
  contentPackage: ContentPackage,
  receipt: AssistedReceipt,
  binding: AssistedReceiptBinding,
): ApprovalReceipt {
  const approval = matchingApproval(contentPackage, receipt, binding);
  if (approval.status !== 'approved') {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_APPROVAL_NOT_ACTIVE',
      'The one-shot ApprovalReceipt is no longer active.',
    );
  }
  return approval;
}

function exactDeliveredApproval(
  contentPackage: ContentPackage,
  receipt: AssistedReceipt,
  binding: AssistedReceiptBinding,
): ApprovalReceipt {
  const approval = matchingApproval(contentPackage, receipt, binding);
  const deliveryAttemptId = contentPackageDeliveryAttemptId(approval.id);
  const terminal = approval.events.at(-1);
  const target = receipt.canonicalTarget!;
  const delivered = contentPackage.deliveryEvents?.find(
    (event) =>
      event.type === 'assisted_handoff_prepared' &&
      event.platform === target.platform &&
      event.variantVersionId === target.variantVersionId &&
      event.artifactReceiptId === target.exportReceiptId &&
      event.deliveryIdentity?.approvalReceiptId === approval.id &&
      event.deliveryIdentity.deliveryAttemptId === deliveryAttemptId,
  );
  if (
    approval.status !== 'consumed' ||
    terminal?.type !== 'consumed' ||
    terminal.externalEffectId !== deliveryAttemptId ||
    !delivered
  ) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_APPROVAL_NOT_ACTIVE',
      'The exact ApprovalReceipt was not consumed by this assisted delivery.',
    );
  }
  return approval;
}

function assertConsumedApproval(
  contentPackage: ContentPackage,
  receipt: AssistedReceipt,
): ApprovalReceipt {
  if (!receipt.binding) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_APPROVAL_BINDING_MISMATCH',
      'Assisted handoff has no canonical binding.',
    );
  }
  const approval = contentPackage.approvalReceipts?.find(
    ({ id }) => id === receipt.binding!.approvalReceiptId,
  );
  const terminal = approval?.events.at(-1);
  if (
    !approval ||
    approval.status !== 'consumed' ||
    terminal?.type !== 'consumed'
  ) {
    throw new CanonicalAssistedDeliveryError(
      'CANONICAL_APPROVAL_NOT_ACTIVE',
      'The exact one-shot ApprovalReceipt was not consumed by this assisted handoff.',
    );
  }
  if (terminal.externalEffectId === `assisted-delivery:${receipt.id}`) {
    return approval;
  }
  return exactDeliveredApproval(contentPackage, receipt, receipt.binding);
}

export class PostgresCanonicalAssistedReceiptRepository
  implements CanonicalAssistedReceiptRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS p1_assisted_receipts (
        workspace_id text NOT NULL,
        id text NOT NULL,
        payload jsonb NOT NULL,
        revision bigint NOT NULL DEFAULT 0,
        handoff_token text,
        handoff_expires_at timestamptz,
        handoff_consumed_at timestamptz,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        UNIQUE (workspace_id, handoff_token)
      );
      CREATE INDEX IF NOT EXISTS p1_assisted_receipts_workspace_updated_idx
        ON p1_assisted_receipts (workspace_id, updated_at DESC, id);
    `);
  }

  async prepareCanonical(
    context: P1Context,
    input: CanonicalAssistedPrepareInput,
  ) {
    return this.transaction((client) =>
      this.prepareCanonicalWithClient(client, context, input),
    );
  }

  async prepareHandoffCanonical(
    context: P1Context,
    input: {
      binding: AssistedReceiptBinding;
      linkToken?: string;
      prepare: CanonicalAssistedPrepareInput;
    },
  ) {
    return this.transaction(async (client) => {
      if (input.prepare.id) {
        const existing = await this.findReceiptForUpdate(
          client,
          context.workspaceId,
          input.prepare.id,
        );
        if (existing) {
          const contentPackage = await this.lockPackage(
            client,
            context.workspaceId,
            input.prepare.packageId,
          );
          const recovery = assertRecoverablePreparedTarget(
            existing.receipt,
            contentPackage,
          );
          if (!sameRecoveryBinding(existing.receipt.binding, input.binding)) {
            throw new CanonicalAssistedDeliveryError(
              'CANONICAL_APPROVAL_BINDING_MISMATCH',
              'The recovered handoff binding does not match the original receipt.',
            );
          }
          exactDeliveredApproval(
            contentPackage,
            existing.receipt,
            existing.receipt.binding!,
          );
          if (!existing.receipt.handoffLink) {
            throw new CanonicalAssistedDeliveryError(
              'CANONICAL_RECEIPT_NOT_FOUND',
              'The canonical assisted receipt has no handoff link.',
            );
          }
          if (
            consumedCanonicalHandoffRequiresReprepare(
              existing.receipt,
              recovery.recoveredNonContentRevision,
            )
          ) {
            throw new CanonicalAssistedDeliveryError(
              'CANONICAL_HANDOFF_REPREPARE_REQUIRED',
              'The consumed handoff link cannot be reused after a non-published result.',
            );
          }
          if (recovery.recoveredNonContentRevision === undefined) {
            return existing;
          }
          return this.updateReceipt(
            client,
            assistedReceiptSchema.parse({
              ...existing.receipt,
              canonicalTarget: {
                ...existing.receipt.canonicalTarget!,
                currentPackageRevision: recovery.recoveredNonContentRevision,
              },
            }),
            existing.revision,
          );
        }
      }
      const prepared = await this.prepareCanonicalWithClient(
        client,
        context,
        input.prepare,
      );
      return this.handOverCanonicalWithClient(client, context, {
        binding: input.binding,
        expectedRevision: prepared.revision,
        issueHandoffLink: true,
        ...(input.linkToken ? { linkToken: input.linkToken } : {}),
        occurredAt: input.prepare.occurredAt,
        receiptId: prepared.receipt.id,
        reuseDeliveredApproval: true,
      });
    });
  }

  async handOverCanonical(
    context: P1Context,
    input: {
      binding: AssistedReceiptBinding;
      expectedRevision: number;
      issueHandoffLink?: boolean;
      linkToken?: string;
      occurredAt: string;
      receiptId: string;
    },
  ) {
    return this.transaction((client) =>
      this.handOverCanonicalWithClient(client, context, input),
    );
  }

  private async prepareCanonicalWithClient(
    client: PoolClient,
    context: P1Context,
    input: CanonicalAssistedPrepareInput,
  ) {
    const contentPackage = await this.lockPackage(
      client,
      context.workspaceId,
      input.packageId,
    );
    if (contentPackage.revision !== input.contentPackageRevision) {
      throw new CanonicalAssistedDeliveryError(
        'CANONICAL_REVISION_MISMATCH',
        'ContentPackage revision does not match the exact assisted preparation revision.',
      );
    }
    exactVariantVersion(contentPackage, input.platform, input.variantVersionId);
    exactExportReceipt(contentPackage, input);
    const receipt = prepareAssistedMaterials({
      actorId: context.userId,
      canonicalTarget: {
        contentPackageRevision: input.contentPackageRevision,
        currentPackageRevision: input.contentPackageRevision,
        exportReceiptId: input.exportReceiptId,
        platform: input.platform,
        variantVersionId: input.variantVersionId,
      },
      exportReceiptId: input.exportReceiptId,
      id: input.id,
      occurredAt: input.occurredAt,
      packageId: input.packageId,
      workspaceId: context.workspaceId,
    });
    return this.insertReceipt(client, receipt);
  }

  private async handOverCanonicalWithClient(
    client: PoolClient,
    context: P1Context,
    input: {
      binding: AssistedReceiptBinding;
      expectedRevision: number;
      issueHandoffLink?: boolean;
      linkToken?: string;
      occurredAt: string;
      receiptId: string;
      reuseDeliveredApproval?: boolean;
    },
  ) {
    const stored = await this.lockReceipt(
      client,
      context.workspaceId,
      input.receiptId,
    );
    this.assertRevision(stored, input.expectedRevision);
    const contentPackage = await this.lockPackage(
      client,
      context.workspaceId,
      stored.receipt.packageId,
    );
    const { exportReceipt } = assertPreparedTarget(
      stored.receipt,
      contentPackage,
    );
    const approval = input.reuseDeliveredApproval
      ? exactDeliveredApproval(contentPackage, stored.receipt, input.binding)
      : exactApproval(contentPackage, stored.receipt, input.binding);
    const handed = handOverAssistedReceipt(stored.receipt, {
      actorId: context.userId,
      binding: input.binding,
      occurredAt: input.occurredAt,
      issueHandoffLink: input.issueHandoffLink,
      linkToken: input.linkToken,
    });
    if (input.reuseDeliveredApproval) {
      const saved = await this.updateReceipt(
        client,
        handed,
        input.expectedRevision,
      );
      await this.insertAudit(client, context, {
        action: 'result_delivery.assisted_handoff_link_issued',
        entityId: handed.id,
        occurredAt: input.occurredAt,
      });
      return saved;
    }
    const packageRevision = contentPackage.revision + 1;
    const consumedApproval = approvalReceiptSchema.parse({
      ...approval,
      events: [
        ...approval.events,
        {
          actorId: context.userId,
          eventId: `${approval.id}:assisted:${handed.id}`,
          externalEffectId: `assisted-delivery:${handed.id}`,
          occurredAt: input.occurredAt,
          type: 'consumed',
        },
      ],
      status: 'consumed',
    });
    const approvalReceipts = [...(contentPackage.approvalReceipts ?? [])];
    approvalReceipts[approvalReceipts.findIndex(({ id }) => id === approval.id)] =
      consumedApproval;
    const updatedPackage = contentPackageSchema.parse({
      ...contentPackage,
      approvalReceipts,
      deliveryEvents: [
        ...(contentPackage.deliveryEvents ?? []),
        {
          actorId: context.userId,
          artifactReceiptId: exportReceipt.id,
          id: `assisted-handoff:${handed.id}`,
          occurredAt: input.occurredAt,
          platform: input.binding.platform,
          source: 'native',
          type: 'assisted_handoff_prepared',
          variantVersionId: input.binding.variantVersionId,
        },
      ],
      revision: packageRevision,
      updatedAt: input.occurredAt,
    });
    const updatedReceipt = assistedReceiptSchema.parse({
      ...handed,
      canonicalTarget: {
        ...handed.canonicalTarget!,
        currentPackageRevision: packageRevision,
      },
    });
    await this.updatePackage(client, contentPackage, updatedPackage);
    const saved = await this.updateReceipt(
      client,
      updatedReceipt,
      input.expectedRevision,
    );
    await this.insertAudit(client, context, {
      action: 'result_delivery.assisted_handed_over',
      entityId: handed.id,
      occurredAt: input.occurredAt,
    });
    return saved;
  }

  async recordPublishResultCanonical(
    context: P1Context,
    input: {
      expectedRevision: number;
      receiptId: string;
      result: AssistedPublishResult;
    },
  ) {
    return this.transaction(async (client) => {
      const stored = await this.lockReceipt(
        client,
        context.workspaceId,
        input.receiptId,
      );
      this.assertRevision(stored, input.expectedRevision);
      const contentPackage = await this.lockPackage(
        client,
        context.workspaceId,
        stored.receipt.packageId,
      );
      assertRecoverablePreparedTarget(stored.receipt, contentPackage);
      const approval = assertConsumedApproval(contentPackage, stored.receipt);
      const reported = recordAssistedPublishResult(stored.receipt, {
        actorId: context.userId,
        result: input.result,
      });
      const advancesPackage = input.result.status !== 'not_published';
      const packageRevision = advancesPackage
        ? contentPackage.revision + 1
        : contentPackage.revision;
      const deliveryEvents = [...(contentPackage.deliveryEvents ?? [])];
      if (input.result.status !== 'not_published') {
        deliveryEvents.push({
          actorId: context.userId,
          ...(input.result.status === 'published'
            ? {
                afterRevision: packageRevision,
                artifactReceiptId: reported.canonicalTarget!.exportReceiptId,
                beforeRevision: contentPackage.revision,
                deliveryIdentity: {
                  approvalReceiptId: approval.id,
                  deliveryAttemptId: contentPackageDeliveryAttemptId(approval.id),
                  schema: 'approval_receipt_v1',
                },
              }
            : {}),
          id: `assisted-report:${reported.id}:${input.result.recordedAt}`,
          occurredAt: input.result.recordedAt,
          platform: reported.binding!.platform,
          ...(input.result.note ? { note: input.result.note } : {}),
          ...(input.result.platformUrl
            ? { platformUrl: input.result.platformUrl }
            : {}),
          source: 'native',
          status: input.result.status,
          type: 'manual_publish_result',
          variantVersionId: reported.binding!.variantVersionId,
        });
      }
      const updatedPackage = contentPackageSchema.parse({
        ...contentPackage,
        deliveryEvents,
        revision: packageRevision,
        updatedAt: input.result.recordedAt,
      });
      const updatedReceipt = assistedReceiptSchema.parse({
        ...reported,
        canonicalTarget: {
          ...reported.canonicalTarget!,
          currentPackageRevision:
            input.result.status === 'published'
              ? packageRevision
              : reported.canonicalTarget!.currentPackageRevision,
        },
      });
      if (advancesPackage) {
        await this.updatePackage(client, contentPackage, updatedPackage);
      }
      const saved = await this.updateReceipt(
        client,
        updatedReceipt,
        input.expectedRevision,
      );
      await this.insertAudit(client, context, {
        action: 'result_delivery.assisted_publish_result_recorded',
        entityId: reported.id,
        occurredAt: input.result.recordedAt,
      });
      return saved;
    });
  }

  async issueMaterialsHandoffCanonical(
    context: P1Context,
    input: {
      binding: AssistedReceiptBinding;
      linkToken?: string;
      prepare: Omit<CanonicalAssistedPrepareInput, 'exportReceiptId'> & {
        exportReceiptId?: string;
      };
    },
  ): Promise<StoredAssistedReceipt> {
    return this.transaction(async (client) => {
      await this.lockPackage(
        client,
        context.workspaceId,
        input.prepare.packageId,
      );
      if (input.prepare.id) {
        const existing = await this.findReceiptForUpdate(
          client,
          context.workspaceId,
          input.prepare.id,
        );
        if (existing?.receipt.handoffLink) {
          return existing;
        }
        if (existing?.receipt.status === 'materials_ready') {
          const handed = handOverAssistedReceipt(existing.receipt, {
            actorId: context.userId,
            binding: input.binding,
            occurredAt: input.prepare.occurredAt,
            issueHandoffLink: true,
            linkToken: input.linkToken,
          });
          const saved = await this.updateReceipt(
            client,
            handed,
            existing.revision,
          );
          await this.insertAudit(client, context, {
            action: 'result_delivery.assisted_handoff_link_issued',
            entityId: handed.id,
            occurredAt: input.prepare.occurredAt,
          });
          return saved;
        }
      }
      const prepared = prepareAssistedMaterials({
        actorId: context.userId,
        ...(input.prepare.id ? { id: input.prepare.id } : {}),
        occurredAt: input.prepare.occurredAt,
        packageId: input.prepare.packageId,
        workspaceId: context.workspaceId,
      });
      const inserted = await this.insertReceipt(client, prepared);
      const handed = handOverAssistedReceipt(inserted.receipt, {
        actorId: context.userId,
        binding: input.binding,
        occurredAt: input.prepare.occurredAt,
        issueHandoffLink: true,
        linkToken: input.linkToken,
      });
      const saved = await this.updateReceipt(
        client,
        handed,
        inserted.revision,
      );
      await this.insertAudit(client, context, {
        action: 'result_delivery.assisted_handoff_link_issued',
        entityId: handed.id,
        occurredAt: input.prepare.occurredAt,
      });
      return saved;
    });
  }

  async consumeCanonicalHandoff(
    context: P1Context,
    input: { now: string; token: string },
  ): Promise<CanonicalHandoffConsumeResult> {
    return this.transaction(async (client) => {
      const selected = await client.query<AssistedRow>(
        `SELECT payload, revision::text AS revision
           FROM p1_assisted_receipts
          WHERE workspace_id = $1 AND handoff_token = $2
          FOR UPDATE`,
        [context.workspaceId, input.token],
      );
      if (!selected.rows[0]) return { kind: 'not_found' };
      const stored = storedFromRow(selected.rows[0]);
      const outcome = consumeOneShotHandoffLink(stored.receipt, input);
      if (outcome.kind !== 'ok') {
        return outcome;
      }
      const contentPackage = await this.lockPackage(
        client,
        context.workspaceId,
        stored.receipt.packageId,
      );
      if (!stored.receipt.exportReceiptId || !stored.receipt.canonicalTarget) {
        const version = copyHandoffVersion(contentPackage, stored.receipt);
        const saved = await this.updateReceipt(
          client,
          outcome.receipt,
          stored.revision,
        );
        await this.insertAudit(client, context, {
          action: 'result_delivery.assisted_handoff_link_consumed',
          entityId: stored.receipt.id,
          occurredAt: input.now,
        });
        return {
          handoff: this.projectCopyHandoff(saved.receipt, contentPackage, version),
          kind: 'ok',
          receipt: saved.receipt,
          revision: saved.revision,
        };
      }
      const { exportReceipt, recoveredNonContentRevision, version } = assertRecoverablePreparedTarget(
        stored.receipt,
        contentPackage,
      );
      assertConsumedApproval(contentPackage, stored.receipt);
      const saved = await this.updateReceipt(
        client,
        recoveredNonContentRevision === undefined
          ? outcome.receipt
          : assistedReceiptSchema.parse({
              ...outcome.receipt,
              canonicalTarget: {
                ...outcome.receipt.canonicalTarget!,
                currentPackageRevision: recoveredNonContentRevision,
              },
            }),
        stored.revision,
      );
      await this.insertAudit(client, context, {
        action: 'result_delivery.assisted_handoff_link_consumed',
        entityId: stored.receipt.id,
        occurredAt: input.now,
      });
      return {
        handoff: this.projectHandoff(
          saved.receipt,
          contentPackage,
          version,
          exportReceipt,
        ),
        kind: 'ok',
        receipt: saved.receipt,
        revision: saved.revision,
      };
    });
  }

  async create(receipt: AssistedReceipt) {
    return this.transaction((client) => this.insertReceipt(client, receipt));
  }

  async get(workspaceId: string, receiptId: string) {
    const result = await this.pool.query<AssistedRow>(
      `SELECT payload, revision::text AS revision
         FROM p1_assisted_receipts
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, receiptId],
    );
    return result.rows[0] ? storedFromRow(result.rows[0]) : null;
  }

  async list(workspaceId: string) {
    const result = await this.pool.query<AssistedRow>(
      `SELECT payload, revision::text AS revision
         FROM p1_assisted_receipts
        WHERE workspace_id = $1
        ORDER BY updated_at DESC, id`,
      [workspaceId],
    );
    return result.rows.map(storedFromRow);
  }

  async save(receipt: AssistedReceipt, expectedRevision: number) {
    return this.transaction((client) =>
      this.updateReceipt(client, receipt, expectedRevision),
    );
  }

  async consumeHandoffLink(input: {
    workspaceId: string;
    token: string;
    now: string;
  }) {
    const result = await this.consumeCanonicalHandoff(
      {
        correlationId: `handoff:${input.token}`,
        userId: 'handoff-recipient',
        workspaceId: input.workspaceId,
      },
      input,
    );
    if (result.kind === 'ok') {
      return { kind: 'ok', receipt: result.receipt } as const;
    }
    return result;
  }

  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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

  private async lockPackage(
    client: PoolClient,
    workspaceId: string,
    packageId: string,
  ) {
    const result = await client.query<PackageRow>(
      `SELECT payload, revision::text AS revision
         FROM p1_content_packages
        WHERE workspace_id = $1 AND id = $2
        FOR UPDATE`,
      [workspaceId, packageId],
    );
    if (!result.rows[0]) {
      throw new CanonicalAssistedDeliveryError(
        'CANONICAL_PACKAGE_NOT_FOUND',
        'The canonical ContentPackage was not found.',
      );
    }
    return packageFromRow(result.rows[0]);
  }

  private async lockReceipt(
    client: PoolClient,
    workspaceId: string,
    receiptId: string,
  ) {
    const result = await client.query<AssistedRow>(
      `SELECT payload, revision::text AS revision
         FROM p1_assisted_receipts
        WHERE workspace_id = $1 AND id = $2
        FOR UPDATE`,
      [workspaceId, receiptId],
    );
    if (!result.rows[0]) {
      throw new CanonicalAssistedDeliveryError(
        'CANONICAL_RECEIPT_NOT_FOUND',
        'The assisted receipt was not found.',
      );
    }
    return storedFromRow(result.rows[0]);
  }

  private async findReceiptForUpdate(
    client: PoolClient,
    workspaceId: string,
    receiptId: string,
  ) {
    const result = await client.query<AssistedRow>(
      `SELECT payload, revision::text AS revision
         FROM p1_assisted_receipts
        WHERE workspace_id = $1 AND id = $2
        FOR UPDATE`,
      [workspaceId, receiptId],
    );
    return result.rows[0] ? storedFromRow(result.rows[0]) : null;
  }

  private assertRevision(
    stored: StoredAssistedReceipt,
    expectedRevision: number,
  ) {
    if (stored.revision !== expectedRevision) {
      throw new AssistedReceiptConflictError(
        stored.receipt.id,
        expectedRevision,
        stored.revision,
      );
    }
  }

  private async insertReceipt(client: PoolClient, receipt: AssistedReceipt) {
    const parsed = assistedReceiptSchema.parse(receipt);
    const result = await client.query<AssistedRow>(
      `INSERT INTO p1_assisted_receipts
         (workspace_id, id, payload, revision, handoff_token,
          handoff_expires_at, handoff_consumed_at, updated_at)
       VALUES ($1, $2, $3::jsonb, 0, $4, $5::timestamptz, $6::timestamptz, now())
       ON CONFLICT (workspace_id, id) DO NOTHING
       RETURNING payload, revision::text AS revision`,
      [
        parsed.workspaceId,
        parsed.id,
        JSON.stringify(parsed),
        parsed.handoffLink?.token ?? null,
        parsed.handoffLink?.expiresAt ?? null,
        parsed.handoffLink?.consumedAt ?? null,
      ],
    );
    if (result.rows[0]) return storedFromRow(result.rows[0]);
    const existing = await this.lockReceipt(
      client,
      parsed.workspaceId,
      parsed.id,
    );
    if (JSON.stringify(existing.receipt) === JSON.stringify(parsed)) {
      return existing;
    }
    throw new AssistedReceiptConflictError(
      parsed.id,
      0,
      existing.revision,
    );
  }

  private async updateReceipt(
    client: PoolClient,
    receipt: AssistedReceipt,
    expectedRevision: number,
  ) {
    const parsed = assistedReceiptSchema.parse(receipt);
    const result = await client.query<AssistedRow>(
      `UPDATE p1_assisted_receipts
          SET payload = $4::jsonb,
              revision = $3,
              handoff_token = $5,
              handoff_expires_at = $6::timestamptz,
              handoff_consumed_at = $7::timestamptz,
              updated_at = now()
        WHERE workspace_id = $1 AND id = $2 AND revision = $8
        RETURNING payload, revision::text AS revision`,
      [
        parsed.workspaceId,
        parsed.id,
        expectedRevision + 1,
        JSON.stringify(parsed),
        parsed.handoffLink?.token ?? null,
        parsed.handoffLink?.expiresAt ?? null,
        parsed.handoffLink?.consumedAt ?? null,
        expectedRevision,
      ],
    );
    if (result.rows[0]) return storedFromRow(result.rows[0]);
    const current = await this.lockReceipt(
      client,
      parsed.workspaceId,
      parsed.id,
    );
    throw new AssistedReceiptConflictError(
      parsed.id,
      expectedRevision,
      current.revision,
    );
  }

  private async updatePackage(
    client: PoolClient,
    before: ContentPackage,
    after: ContentPackage,
  ) {
    const updated = await updateContentPackageRow(client, {
      expectedRevision: before.revision,
      id: before.id,
      payload: after,
      revision: after.revision,
      updatedAt: after.updatedAt,
      workspaceId: before.workspaceId,
    });
    if (!updated) {
      throw new CanonicalAssistedDeliveryError(
        'CANONICAL_REVISION_MISMATCH',
        'ContentPackage revision changed during the assisted transaction.',
      );
    }
  }

  private async insertAudit(
    client: PoolClient,
    context: P1Context,
    event: { action: string; entityId: string; occurredAt: string },
  ) {
    const id = `${event.action}:${event.entityId}:${randomUUID()}`;
    await client.query(
      `INSERT INTO p1_operations_audit_events
         (workspace_id, id, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)`,
      [
        context.workspaceId,
        id,
        JSON.stringify({
          action: event.action,
          actorId: context.userId,
          correlationId: context.correlationId,
          createdAt: event.occurredAt,
          details: {},
          entityId: event.entityId,
          entityType: 'assisted_receipt',
          id,
          workspaceId: context.workspaceId,
        }),
        event.occurredAt,
      ],
    );
  }

  private projectCopyHandoff(
    receipt: AssistedReceipt,
    contentPackage: ContentPackage,
    version: ContentPackageVersion,
  ): CanonicalAssistedHandoff {
    const link = receipt.handoffLink!;
    const platform =
      receipt.binding?.platform ??
      receipt.canonicalTarget?.platform ??
      'xiaohongshu';
    return {
      assistedReceipt: receipt,
      body: version.body,
      checklist: ['核对文案与价格', '确认媒体顺序', '确认 AIGC 与权利说明'],
      contentPackageRevision:
        receipt.binding?.contentPackageRevision ?? contentPackage.revision,
      conversionText: version.conversionHook ?? '',
      expiresAt: link.expiresAt,
      exportReceiptId: receipt.exportReceiptId ?? `copy:${contentPackage.id}`,
      media: [],
      packageId: contentPackage.id,
      platform,
      sharePath: `/dashboard/handoff/${encodeURIComponent(link.token)}`,
      title: version.title,
      token: link.token,
      topics: [...version.topics],
      variantVersionId: version.id,
    };
  }

  private projectHandoff(
    receipt: AssistedReceipt,
    contentPackage: ContentPackage,
    version: ContentPackageVersion,
    exportReceipt: ContentPackageExportReceipt,
  ): CanonicalAssistedHandoff {
    const link = receipt.handoffLink!;
    const ownedById = new Map(
      (contentPackage.generated.ownedAssets ?? []).map((asset) => [asset.id, asset]),
    );
    const media = version.orderedAssetIds.flatMap((assetId, index) => {
      const asset = ownedById.get(assetId);
      if (!asset) return [];
      const kind = asset.contentType.startsWith('image/')
        ? ('image' as const)
        : asset.contentType.startsWith('video/')
          ? ('video' as const)
          : ('file' as const);
      return [
        {
          contentType: asset.contentType,
          downloadUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(asset.objectKey)}&download=1`,
          id: asset.id,
          kind,
          label: index === 0 ? '封面/主文件' : `文件 ${index + 1}`,
        },
      ];
    });
    return {
      assistedReceipt: receipt,
      body: version.body,
      checklist: ['核对文案与价格', '确认媒体顺序', '确认 AIGC 与权利说明'],
      contentPackageRevision: receipt.canonicalTarget!.contentPackageRevision,
      conversionText: version.conversionHook ?? '',
      expiresAt: link.expiresAt,
      exportReceiptId: exportReceipt.id,
      ...(exportReceipt.artifactObjectKey
        ? {
            fullPackageDownloadUrl: `/api/core/p1/assets?objectKey=${encodeURIComponent(exportReceipt.artifactObjectKey)}&download=1`,
          }
        : {}),
      media,
      packageId: contentPackage.id,
      platform: receipt.canonicalTarget!.platform,
      sharePath: `/dashboard/handoff/${encodeURIComponent(link.token)}`,
      title: version.title,
      token: link.token,
      topics: [...version.topics],
      variantVersionId: version.id,
    };
  }
}
