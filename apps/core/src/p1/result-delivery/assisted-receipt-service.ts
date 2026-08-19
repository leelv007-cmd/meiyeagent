import { P1DomainError, type P1Context } from '../foundation/domain.js';
import {
  handOverAssistedReceipt,
  markPendingManualPublish,
  prepareAssistedMaterials,
  projectPendingConfirmInbox,
  recordAssistedPublishResult,
  type AssistedReceiptBinding,
  type AssistedPublishResult,
} from './assisted-receipt.js';
import type {
  AssistedReceiptRepository,
  StoredAssistedReceipt,
} from './assisted-receipt-repository.js';
import { AssistedReceiptConflictError } from './assisted-receipt-repository.js';
import {
  isCanonicalAssistedReceiptRepository,
  type CanonicalAssistedPrepareInput,
} from './assisted-canonical-repository.js';

export class AssistedReceiptService {
  constructor(private readonly repository: AssistedReceiptRepository) {}

  async prepareHandoff(
    context: P1Context,
    input: {
      binding: AssistedReceiptBinding;
      linkToken?: string;
      prepare: CanonicalAssistedPrepareInput;
    },
  ) {
    if (isCanonicalAssistedReceiptRepository(this.repository)) {
      return this.repository.prepareHandoffCanonical(context, input);
    }
    if (input.prepare.id) {
      const existing = await this.repository.get(
        context.workspaceId,
        input.prepare.id,
      );
      if (existing) {
        const target = existing.receipt.canonicalTarget;
        if (
          existing.receipt.status !== 'handed_over' ||
          !existing.receipt.handoffLink ||
          target?.contentPackageRevision !==
            input.prepare.contentPackageRevision ||
          target.exportReceiptId !== input.prepare.exportReceiptId ||
          target.platform !== input.prepare.platform ||
          target.variantVersionId !== input.prepare.variantVersionId ||
          JSON.stringify(existing.receipt.binding) !==
            JSON.stringify(input.binding)
        ) {
          throw new AssistedReceiptConflictError(
            input.prepare.id,
            0,
            existing.revision,
          );
        }
        return existing;
      }
    }
    const prepared = await this.prepare(context, input.prepare);
    return this.handOver(context, {
      binding: input.binding,
      expectedRevision: prepared.revision,
      issueHandoffLink: true,
      ...(input.linkToken ? { linkToken: input.linkToken } : {}),
      occurredAt: input.prepare.occurredAt,
      receiptId: prepared.receipt.id,
    });
  }

  async prepare(
    context: P1Context,
    input: CanonicalAssistedPrepareInput,
  ) {
    if (isCanonicalAssistedReceiptRepository(this.repository)) {
      return this.repository.prepareCanonical(context, input);
    }
    return this.repository.create(
      prepareAssistedMaterials({
        actorId: context.userId,
        canonicalTarget: {
          contentPackageRevision: input.contentPackageRevision,
          currentPackageRevision: input.contentPackageRevision,
          exportReceiptId: input.exportReceiptId,
          platform: input.platform,
          variantVersionId: input.variantVersionId,
        },
        exportReceiptId: input.exportReceiptId,
        ...(input.id ? { id: input.id } : {}),
        occurredAt: input.occurredAt,
        packageId: input.packageId,
        workspaceId: context.workspaceId,
      }),
    );
  }

  async handOver(
    context: P1Context,
    input: {
      receiptId: string;
      expectedRevision: number;
      binding: AssistedReceiptBinding;
      occurredAt: string;
      issueHandoffLink?: boolean;
      linkToken?: string;
    },
  ) {
    if (isCanonicalAssistedReceiptRepository(this.repository)) {
      return this.repository.handOverCanonical(context, input);
    }
    const stored = await this.require(context.workspaceId, input.receiptId);
    this.assertRevision(stored, input.expectedRevision);
    return this.repository.save(
      handOverAssistedReceipt(stored.receipt, {
        actorId: context.userId,
        binding: input.binding,
        occurredAt: input.occurredAt,
        issueHandoffLink: input.issueHandoffLink,
        linkToken: input.linkToken,
      }),
      input.expectedRevision,
    );
  }

  async markPending(
    context: P1Context,
    input: {
      receiptId: string;
      expectedRevision: number;
      occurredAt: string;
    },
  ) {
    const stored = await this.require(context.workspaceId, input.receiptId);
    this.assertRevision(stored, input.expectedRevision);
    return this.repository.save(
      markPendingManualPublish(stored.receipt, {
        actorId: context.userId,
        occurredAt: input.occurredAt,
      }),
      input.expectedRevision,
    );
  }

  async recordPublishResult(
    context: P1Context,
    input: {
      receiptId: string;
      expectedRevision: number;
      result: AssistedPublishResult;
    },
  ) {
    if (isCanonicalAssistedReceiptRepository(this.repository)) {
      return this.repository.recordPublishResultCanonical(context, input);
    }
    const stored = await this.require(context.workspaceId, input.receiptId);
    this.assertRevision(stored, input.expectedRevision);
    return this.repository.save(
      recordAssistedPublishResult(stored.receipt, {
        actorId: context.userId,
        result: input.result,
      }),
      input.expectedRevision,
    );
  }

  async consume(
    context: P1Context,
    input: { token: string; now: string },
  ) {
    if (isCanonicalAssistedReceiptRepository(this.repository)) {
      return this.repository.consumeCanonicalHandoff(context, input);
    }
    return this.repository.consumeHandoffLink({
      workspaceId: context.workspaceId,
      token: input.token,
      now: input.now,
    });
  }

  get(context: P1Context, receiptId: string) {
    return this.require(context.workspaceId, receiptId);
  }

  list(context: P1Context) {
    return this.repository.list(context.workspaceId);
  }

  async listPendingConfirm(context: P1Context, now: string) {
    const stored = await this.repository.list(context.workspaceId);
    return projectPendingConfirmInbox(
      stored.map((record) => record.receipt),
      now,
    );
  }

  private async require(workspaceId: string, receiptId: string) {
    const stored = await this.repository.get(workspaceId, receiptId);
    if (!stored) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Assisted receipt ${receiptId} was not found.`,
      );
    }
    return stored;
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
}
