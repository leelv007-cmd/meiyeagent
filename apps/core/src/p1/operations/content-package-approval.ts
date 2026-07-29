import { createHash } from 'node:crypto';
import {
  approvalBindingSchema,
  approvalReceiptSchema,
  contentPackageSchema,
  pendingApprovalRequestSchema,
  type ApprovalBinding,
  type ApprovalReceipt,
  type ContentPackage,
  type ContextInvalidationEvent,
  type PendingApprovalRequest,
} from '@meiye/contracts';

import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  validateHarnessPolicy,
  type HarnessGateId,
  type HarnessPolicyInput,
  type VisibleClaimExtraction,
} from '../harness/policy-gates.js';
import { authorizeHarnessAction } from '../harness/action-registry.js';
import type { ContextInvalidationSink } from './context-invalidation.js';
import { TaskBlockingNodeConflictError } from './repository.js';
import {
  approvalReceiptExpiresAt,
  isApprovalReceiptActiveAt,
} from './approval-receipt-validity.js';

export interface ApprovalReceiptRepository {
  create(input: {
    fingerprint: string;
    receipt: ApprovalReceipt;
    requestId: string;
  }): Promise<
    | { kind: 'created'; receipt: ApprovalReceipt }
    | { kind: 'replayed'; receipt: ApprovalReceipt }
    | { kind: 'conflict' }
    | { kind: 'request_not_pending' }
  >;
  get(receiptId: string): Promise<ApprovalReceipt | null>;
  listApproved(workspaceId: string): Promise<ApprovalReceipt[]>;
  saveTerminal(
    receipt: ApprovalReceipt,
    expectedStatus: 'approved',
    activeAt?: string,
  ): Promise<ApprovalReceipt>;
}

export class ApprovalReceiptError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | 'APPROVAL_BINDING_MISMATCH'
      | 'APPROVAL_IDEMPOTENCY_CONFLICT'
      | 'APPROVAL_NOT_ACTIVE'
      | 'APPROVAL_NOT_FOUND'
      | 'APPROVAL_POLICY_REJECTED'
      | 'APPROVAL_REQUEST_NOT_PENDING',
    message: string,
    readonly gateId?: HarnessGateId,
    readonly triggeredClaims: VisibleClaimExtraction['claims'] = [],
  ) {
    super(message);
    this.name = 'ApprovalReceiptError';
    this.status = this.code === 'APPROVAL_NOT_FOUND' ? 404 : 409;
  }
}

interface ApprovalAuthorizationInput extends ApprovalBinding {
  currentContentRevision: number;
  policy: Pick<
    HarnessPolicyInput,
    | 'brief'
    | 'bundle'
    | 'candidate'
    | 'identityRefs'
    | 'rightsRefs'
    | 'sourceRefs'
    | 'trustedFactClaims'
  >;
  receiptId?: string;
}

export class ContentPackageApprovalService implements ContextInvalidationSink {
  constructor(
    private readonly repository: ApprovalReceiptRepository,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async approve(input: ApprovalBinding & {
    actorId: string;
    idempotencyKey: string;
    requestId: string;
  }) {
    const {
      actorId: actorInput,
      idempotencyKey: keyInput,
      requestId: requestInput,
      ...bindingInput
    } = input;
    const binding = approvalBindingSchema.parse(bindingInput);
    authorizeHarnessAction({
      actionId: 'workflow.approval_callback',
      caller: 'server',
    });
    const actorId = requiredText(actorInput, 'actorId');
    const idempotencyKey = requiredText(keyInput, 'idempotencyKey');
    const requestId = requiredText(requestInput, 'requestId');
    const fingerprint = fingerprintValue({ actorId, binding, requestId });
    const receiptId = stableId(
      'approval',
      binding.workspaceId,
      idempotencyKey
    );
    const issuedAt = this.now();
    const receipt = approvalReceiptSchema.parse({
      binding,
      events: [
        {
          actorId,
          eventId: `${receiptId}:approved`,
          occurredAt: issuedAt,
          type: 'approved',
        },
      ],
      expiresAt: approvalReceiptExpiresAt(
        issuedAt,
        binding.actionScheduledAt,
      ),
      id: receiptId,
      idempotencyKey,
      payloadFingerprint: fingerprint,
      status: 'approved',
    });
    const result = await this.repository.create({
      fingerprint,
      receipt,
      requestId,
    });
    if (result.kind === 'conflict') {
      throw new ApprovalReceiptError(
        'APPROVAL_IDEMPOTENCY_CONFLICT',
        'The approval idempotency key was reused with another binding.'
      );
    }
    if (result.kind === 'request_not_pending') {
      throw new ApprovalReceiptError(
        'APPROVAL_REQUEST_NOT_PENDING',
        'The pending approval request is missing, consumed, or does not match this action.'
      );
    }
    return result.receipt;
  }

  async authorize(input: ApprovalAuthorizationInput) {
    authorizeHarnessAction({
      actionId: 'workflow.approval_callback',
      caller: 'server',
    });
    const receipt = input.receiptId
      ? await this.repository.get(input.receiptId)
      : null;
    if (input.receiptId && !receipt) {
      throw new ApprovalReceiptError(
        'APPROVAL_NOT_FOUND',
        'The ApprovalReceipt was not found.'
      );
    }
    if (receipt && !isApprovalReceiptActiveAt(receipt, this.now())) {
      throw new ApprovalReceiptError(
        'APPROVAL_NOT_ACTIVE',
        'The ApprovalReceipt is no longer active.'
      );
    }
    const policyResult = validateHarnessPolicy({
      ...input.policy,
      actionContext: {
        kind: input.actionKind,
        revision: receipt?.binding.contentRevision ?? input.contentRevision,
        target: input.accountId,
      },
      ...(receipt
        ? {
            approvalReceipt: {
              actionKind: receipt.binding.actionKind,
              revision: receipt.binding.contentRevision,
              status: 'approved' as const,
              target: receipt.binding.accountId,
            },
          }
        : {}),
      currentRevision: input.currentContentRevision,
      phase: input.actionKind,
    });
    const policyFailure = policyResult.failures[0];
    if (policyFailure) {
      throw new ApprovalReceiptError(
        'APPROVAL_POLICY_REJECTED',
        policyFailure.reason,
        policyFailure.gateId,
        policyFailure.triggeredClaims,
      );
    }
    if (!receipt || !sameBinding(receipt.binding, input)) {
      throw new ApprovalReceiptError(
        'APPROVAL_BINDING_MISMATCH',
        'The ApprovalReceipt does not bind this exact external action.'
      );
    }
    return receipt;
  }

  async consume(input: {
    actorId: string;
    externalEffectId: string;
    receiptId: string;
  }) {
    const receipt = await this.requireApproved(input.receiptId);
    const consumedAt = this.now();
    return this.repository.saveTerminal(
      approvalReceiptSchema.parse({
        ...receipt,
        events: [
          ...receipt.events,
          {
            actorId: requiredText(input.actorId, 'actorId'),
            eventId: `${receipt.id}:consumed`,
            externalEffectId: requiredText(
              input.externalEffectId,
              'externalEffectId'
            ),
            occurredAt: consumedAt,
            type: 'consumed',
          },
        ],
        status: 'consumed',
      }),
      'approved',
      consumedAt,
    );
  }

  async handle(event: ContextInvalidationEvent) {
    const affected = new Set(
      event.affectedBundleReferences.map(bundleReferenceIdentity)
    );
    const receipts = await this.repository.listApproved(event.workspaceId);
    await Promise.all(
      receipts
        .filter((receipt) =>
          affected.has(bundleReferenceIdentity(receipt.binding.contextBundle))
        )
        .map((receipt) =>
          this.invalidate(receipt, {
            actorId: 'system:context-invalidation',
            occurredAt: event.observedAt,
            reason: 'context_invalidated',
            sourceEventId: event.eventId,
          })
        )
    );
  }

  private async invalidate(
    receipt: ApprovalReceipt,
    input: {
      actorId: string;
      occurredAt: string;
      reason:
        | 'context_invalidated'
        | 'content_revision_changed'
        | 'revoked_by_actor';
      sourceEventId?: string;
    }
  ) {
    return this.repository.saveTerminal(
      approvalReceiptSchema.parse({
        ...receipt,
        events: [
          ...receipt.events,
          {
            ...input,
            eventId: `${receipt.id}:invalidated:${input.sourceEventId ?? input.occurredAt}`,
            type: 'invalidated',
          },
        ],
        status: 'invalidated',
      }),
      'approved'
    );
  }

  private async requireApproved(receiptId: string) {
    const receipt = await this.repository.get(receiptId);
    if (!receipt) {
      throw new ApprovalReceiptError(
        'APPROVAL_NOT_FOUND',
        'The ApprovalReceipt was not found.'
      );
    }
    if (!isApprovalReceiptActiveAt(receipt, this.now())) {
      throw new ApprovalReceiptError(
        'APPROVAL_NOT_ACTIVE',
        'The ApprovalReceipt is no longer active.'
      );
    }
    return receipt;
  }
}

export class MemoryApprovalReceiptRepository
  implements ApprovalReceiptRepository
{
  private readonly byId = new Map<string, ApprovalReceipt>();
  private readonly claims = new Map<
    string,
    { fingerprint: string; receiptId: string }
  >();
  private readonly requests = new Map<string, PendingApprovalRequest>();

  seedPendingRequest(request: PendingApprovalRequest) {
    const parsed = pendingApprovalRequestSchema.parse(structuredClone(request));
    this.requests.set(parsed.id, parsed);
  }

  async getPendingRequest(requestId: string) {
    const request = this.requests.get(requestId);
    return request ? structuredClone(request) : null;
  }

  async create(input: {
    fingerprint: string;
    receipt: ApprovalReceipt;
    requestId: string;
  }) {
    const identity = `${input.receipt.binding.workspaceId}:${input.receipt.idempotencyKey}`;
    const existing = this.claims.get(identity);
    if (existing) {
      const receipt = this.byId.get(existing.receiptId)!;
      return existing.fingerprint === input.fingerprint
        ? { kind: 'replayed' as const, receipt: structuredClone(receipt) }
        : { kind: 'conflict' as const };
    }
    const request = this.requests.get(input.requestId);
    if (
      !request ||
      request.status !== 'pending' ||
      !approvalRequestMatchesBinding(request, input.receipt.binding)
    ) {
      return { kind: 'request_not_pending' as const };
    }
    const receipt = approvalReceiptSchema.parse(structuredClone(input.receipt));
    this.requests.set(
      request.id,
      pendingApprovalRequestSchema.parse({
        ...request,
        consumedAt: receipt.events[0]!.occurredAt,
        receiptId: receipt.id,
        status: 'consumed',
      })
    );
    this.claims.set(identity, {
      fingerprint: input.fingerprint,
      receiptId: receipt.id,
    });
    this.byId.set(receipt.id, receipt);
    return { kind: 'created' as const, receipt: structuredClone(receipt) };
  }

  async get(receiptId: string) {
    const receipt = this.byId.get(receiptId);
    return receipt ? structuredClone(receipt) : null;
  }

  async listApproved(workspaceId: string) {
    return [...this.byId.values()]
      .filter(
        (receipt) =>
          receipt.binding.workspaceId === workspaceId &&
          receipt.status === 'approved'
      )
      .map((receipt) => structuredClone(receipt));
  }

  async saveTerminal(
    receipt: ApprovalReceipt,
    expectedStatus: 'approved',
    activeAt?: string,
  ) {
    const current = this.byId.get(receipt.id);
    if (!current) {
      throw new ApprovalReceiptError(
        'APPROVAL_NOT_FOUND',
        'The ApprovalReceipt was not found.'
      );
    }
    if (current.status !== expectedStatus) {
      throw new ApprovalReceiptError(
        'APPROVAL_NOT_ACTIVE',
        'The ApprovalReceipt is no longer active.'
      );
    }
    if (activeAt && !isApprovalReceiptActiveAt(current, activeAt)) {
      throw new ApprovalReceiptError(
        'APPROVAL_NOT_ACTIVE',
        'The ApprovalReceipt is no longer active.'
      );
    }
    const parsed = approvalReceiptSchema.parse(structuredClone(receipt));
    this.byId.set(parsed.id, parsed);
    return structuredClone(parsed);
  }
}

export function createPendingApprovalRequest(input: {
  actionKind: ApprovalBinding['actionKind'];
  contentPackageRevision: number;
  createdAt: string;
  packageId: string;
  platform: ApprovalBinding['platform'];
  purpose: string;
  taskId: string;
  variantVersionId: string;
  workflowId: string;
  workflowRevision: number;
  workspaceId: string;
}) {
  return pendingApprovalRequestSchema.parse({
    ...input,
    id: stableId(
      'approval-request',
      input.workspaceId,
      input.taskId,
      input.packageId,
      String(input.contentPackageRevision),
      input.platform,
      input.variantVersionId
    ),
    nodeId: `approval:${input.packageId}`,
    status: 'pending',
  });
}

export function appendPendingApprovalRequest(
  contentPackage: ContentPackage,
  input: Parameters<typeof createPendingApprovalRequest>[0]
) {
  const request = createPendingApprovalRequest(input);
  const pending = (contentPackage.approvalRequests ?? []).find(
    (candidate) => candidate.status === 'pending'
  );
  if (pending) {
    if (pending.id === request.id) return contentPackage;
    throw new TaskBlockingNodeConflictError(input.taskId);
  }
  return contentPackageSchema.parse({
    ...contentPackage,
    approvalRequests: [
      ...(contentPackage.approvalRequests ?? []),
      request,
    ],
  });
}

export function approvalRequestMatchesBinding(
  request: PendingApprovalRequest,
  binding: ApprovalBinding
) {
  return (
    request.workspaceId === binding.workspaceId &&
    request.packageId === binding.packageId &&
    request.variantVersionId === binding.variantVersionId &&
    request.platform === binding.platform &&
    request.actionKind === binding.actionKind &&
    request.purpose === binding.purpose
  );
}

function sameBinding(
  binding: ApprovalBinding,
  input: ApprovalAuthorizationInput
) {
  return (
    binding.workspaceId === input.workspaceId &&
    binding.packageId === input.packageId &&
    binding.contentRevision === input.currentContentRevision &&
    binding.variantVersionId === input.variantVersionId &&
    binding.accountId === input.accountId &&
    binding.platform === input.platform &&
    binding.actionKind === input.actionKind &&
    binding.actionScheduledAt === input.actionScheduledAt &&
    binding.cost.amount === input.cost.amount &&
    binding.cost.currency === input.cost.currency &&
    binding.purpose === input.purpose &&
    bundleReferenceIdentity(binding.contextBundle) ===
      bundleReferenceIdentity(input.contextBundle)
  );
}

function bundleReferenceIdentity(reference: {
  bundleId: string;
  hash: string;
  revision: number;
}) {
  return `${reference.bundleId}:${reference.revision}:${reference.hash}`;
}

function requiredText(value: string, field: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function stableId(prefix: string, ...parts: string[]) {
  return `${prefix}-${createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24)}`;
}
