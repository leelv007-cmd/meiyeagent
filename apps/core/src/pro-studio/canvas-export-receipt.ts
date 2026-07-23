import { randomUUID } from 'node:crypto';

/**
 * Canvas exports use the existing Pro Studio audit stream as their durable
 * receipt ledger. The records deliberately contain digests and identifiers
 * only: object keys, delivery URLs, provider details, and request keys never
 * enter this contract.
 */
export const CANVAS_EXPORT_AUDIT_ACTIONS = {
  completed: 'canvas_export_receipt_completed',
  failed: 'canvas_export_receipt_failed',
  resumed: 'canvas_export_receipt_resumed',
  started: 'canvas_export_receipt_started',
} as const;

export type CanvasExportReceiptAuditAction =
  (typeof CANVAS_EXPORT_AUDIT_ACTIONS)[keyof typeof CANVAS_EXPORT_AUDIT_ACTIONS];

export type CanvasExportReceiptFailureReason =
  | 'asset_access_denied'
  | 'asset_expired'
  | 'asset_private_retrieval_denied'
  | 'asset_receipt_invalid'
  | 'asset_revoked'
  | 'asset_storage_unavailable'
  | 'export_size_limit_exceeded'
  | 'idempotency_conflict'
  | 'receipt_persistence_failed'
  | 'revision_invalid';

export type CanvasExportReceiptRequest = {
  idempotencyKeyHash: string;
  projectId: string;
  requestHash: string;
  revisionId: string;
  userId: string;
  workspaceId: string;
};

export type CanvasExportReceipt = CanvasExportReceiptRequest & {
  createdAt: string;
  id: string;
};

export type CanvasExportRetrievalReceipt = {
  assetId: string;
  id: string;
  sha256: string;
  sizeBytes: number;
  sourceReceiptId: string;
  storageRevision?: string;
};

export type CanvasExportReceiptWarning = {
  assetId: string;
  code: string;
};

export type CanvasExportCompletedReceipt = CanvasExportReceipt & {
  completedAt: string;
  manifestSha256: string;
  retrievals: CanvasExportRetrievalReceipt[];
  totalBytes: number;
  warnings: CanvasExportReceiptWarning[];
  zipSha256: string;
};

export type CanvasExportReceiptClaim =
  | { kind: 'claimed'; receipt: CanvasExportReceipt }
  | { kind: 'completed'; receipt: CanvasExportCompletedReceipt }
  | { kind: 'conflict' }
  | { kind: 'recovered'; receipt: CanvasExportReceipt };

export type CanvasExportAuditEvent = {
  action: CanvasExportReceiptAuditAction;
  createdAt: string;
  detail:
    | CanvasExportReceipt
    | CanvasExportCompletedReceipt
    | {
        assetId?: string;
        reason: CanvasExportReceiptFailureReason;
        receiptId: string;
      };
  projectId: string;
  userId: string;
  workspaceId: string;
};

export class CanvasExportReceiptError extends Error {
  constructor(
    readonly code: 'CONFLICT' | 'INVALID_AUDIT',
    message: string,
  ) {
    super(message);
    this.name = 'CanvasExportReceiptError';
  }
}

export interface CanvasExportReceiptRepository {
  claim(input: CanvasExportReceiptRequest): Promise<CanvasExportReceiptClaim>;
  complete(input: {
    manifestSha256: string;
    receipt: CanvasExportReceipt;
    retrievals: CanvasExportRetrievalReceipt[];
    totalBytes: number;
    warnings: CanvasExportReceiptWarning[];
    zipSha256: string;
  }): Promise<CanvasExportCompletedReceipt>;
  recordFailure(input: {
    assetId?: string;
    reason: CanvasExportReceiptFailureReason;
    receipt: CanvasExportReceipt;
  }): Promise<void>;
}

type StoredReceipt = {
  completed?: CanvasExportCompletedReceipt;
  receipt: CanvasExportReceipt;
};

export class MemoryCanvasExportReceiptRepository
  implements CanvasExportReceiptRepository
{
  private readonly events: CanvasExportAuditEvent[] = [];
  private readonly receipts = new Map<string, StoredReceipt>();
  private readonly clock: () => Date;
  private readonly nextId: () => string;

  constructor(options: { clock?: () => Date; nextId?: () => string } = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.nextId = options.nextId ?? (() => `canvas-export-${randomUUID()}`);
  }

  async claim(input: CanvasExportReceiptRequest): Promise<CanvasExportReceiptClaim> {
    const key = receiptKey(input);
    const existing = this.receipts.get(key);
    if (existing) {
      if (!sameRequest(existing.receipt, input)) return { kind: 'conflict' };
      if (existing.completed) {
        return { kind: 'completed', receipt: clone(existing.completed) };
      }
      this.append(CANVAS_EXPORT_AUDIT_ACTIONS.resumed, existing.receipt);
      return { kind: 'recovered', receipt: clone(existing.receipt) };
    }
    const receipt: CanvasExportReceipt = {
      ...input,
      createdAt: this.clock().toISOString(),
      id: this.nextId(),
    };
    this.receipts.set(key, { receipt: clone(receipt) });
    this.append(CANVAS_EXPORT_AUDIT_ACTIONS.started, receipt);
    return { kind: 'claimed', receipt: clone(receipt) };
  }

  async complete(input: {
    manifestSha256: string;
    receipt: CanvasExportReceipt;
    retrievals: CanvasExportRetrievalReceipt[];
    totalBytes: number;
    warnings: CanvasExportReceiptWarning[];
    zipSha256: string;
  }): Promise<CanvasExportCompletedReceipt> {
    const existing = this.receipts.get(receiptKey(input.receipt));
    if (!existing || !sameReceipt(existing.receipt, input.receipt)) {
      throw new CanvasExportReceiptError(
        'INVALID_AUDIT',
        'Canvas export receipt was not claimed.',
      );
    }
    const completed: CanvasExportCompletedReceipt = {
      ...input.receipt,
      completedAt: this.clock().toISOString(),
      manifestSha256: input.manifestSha256,
      retrievals: clone(input.retrievals),
      totalBytes: input.totalBytes,
      warnings: clone(input.warnings),
      zipSha256: input.zipSha256,
    };
    if (existing.completed) {
      if (!sameCompletedReceipt(existing.completed, completed)) {
        throw new CanvasExportReceiptError(
          'CONFLICT',
          'Canvas export receipt completed with different output facts.',
        );
      }
      return clone(existing.completed);
    }
    existing.completed = clone(completed);
    this.append(CANVAS_EXPORT_AUDIT_ACTIONS.completed, completed);
    return clone(completed);
  }

  async recordFailure(input: {
    assetId?: string;
    reason: CanvasExportReceiptFailureReason;
    receipt: CanvasExportReceipt;
  }) {
    this.events.push({
      action: CANVAS_EXPORT_AUDIT_ACTIONS.failed,
      createdAt: this.clock().toISOString(),
      detail: {
        ...(input.assetId ? { assetId: input.assetId } : {}),
        reason: input.reason,
        receiptId: input.receipt.id,
      },
      projectId: input.receipt.projectId,
      userId: input.receipt.userId,
      workspaceId: input.receipt.workspaceId,
    });
  }

  inspectAudit() {
    return clone(this.events);
  }

  private append(
    action: Exclude<CanvasExportReceiptAuditAction, typeof CANVAS_EXPORT_AUDIT_ACTIONS.failed>,
    receipt: CanvasExportReceipt | CanvasExportCompletedReceipt,
  ) {
    this.events.push({
      action,
      createdAt: this.clock().toISOString(),
      detail: clone(receipt),
      projectId: receipt.projectId,
      userId: receipt.userId,
      workspaceId: receipt.workspaceId,
    });
  }
}

export function sameCanvasExportCompletedReceipt(
  left: CanvasExportCompletedReceipt,
  right: CanvasExportCompletedReceipt,
) {
  return sameCompletedReceipt(left, right);
}

export function sameCanvasExportReceipt(
  left: CanvasExportReceipt,
  right: CanvasExportReceipt,
) {
  return sameReceipt(left, right);
}

function receiptKey(input: CanvasExportReceiptRequest) {
  return `${input.workspaceId}\0${input.userId}\0${input.idempotencyKeyHash}`;
}

function sameRequest(
  receipt: CanvasExportReceipt,
  input: CanvasExportReceiptRequest,
) {
  return (
    receipt.idempotencyKeyHash === input.idempotencyKeyHash &&
    receipt.projectId === input.projectId &&
    receipt.requestHash === input.requestHash &&
    receipt.revisionId === input.revisionId &&
    receipt.userId === input.userId &&
    receipt.workspaceId === input.workspaceId
  );
}

function sameReceipt(left: CanvasExportReceipt, right: CanvasExportReceipt) {
  return left.id === right.id && sameRequest(left, right);
}

function sameCompletedReceipt(
  left: CanvasExportCompletedReceipt,
  right: CanvasExportCompletedReceipt,
) {
  return (
    sameReceipt(left, right) &&
    left.manifestSha256 === right.manifestSha256 &&
    left.totalBytes === right.totalBytes &&
    left.zipSha256 === right.zipSha256 &&
    JSON.stringify(left.retrievals) === JSON.stringify(right.retrievals) &&
    JSON.stringify(left.warnings) === JSON.stringify(right.warnings)
  );
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
