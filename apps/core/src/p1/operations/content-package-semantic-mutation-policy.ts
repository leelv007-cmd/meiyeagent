import { contentPackageSchema } from '@meiye/contracts';

import { canonicalJson } from '../canonical-json.js';

export class ContentPackageSemanticMutationError extends Error {
  constructor(
    readonly code:
      | 'CONTENT_PACKAGE_AUXILIARY_WRITE_REJECTED'
      | 'CONTENT_PACKAGE_REVISION_CONFLICT'
      | 'CONTENT_PACKAGE_RIGHTS_STATE_CONFLICT'
      | 'DELIVERY_VARIANT_REQUIRED'
      | 'HARNESS_ADOPTION_EVIDENCE_REQUIRED',
    message: string,
    readonly status = 409,
  ) {
    super(message);
    this.name = 'ContentPackageSemanticMutationError';
  }
}

export function validateContentPackageSemanticWrite(input: {
  expectedRevision?: number;
  next: unknown;
  persistedRevision?: number;
}) {
  const next = contentPackageSchema.parse(input.next);
  if (
    input.persistedRevision !== undefined &&
    next.revision !== input.persistedRevision
  ) {
    throw new ContentPackageSemanticMutationError(
      'CONTENT_PACKAGE_REVISION_CONFLICT',
      `ContentPackage payload revision ${next.revision} does not match persisted revision ${input.persistedRevision}.`,
    );
  }
  if (
    input.expectedRevision !== undefined &&
    next.revision !== input.expectedRevision + 1
  ) {
    throw new ContentPackageSemanticMutationError(
      'CONTENT_PACKAGE_REVISION_CONFLICT',
      `ContentPackage expected revision ${input.expectedRevision}, next revision is ${next.revision}.`,
    );
  }
  if (
    next.status === 'accepted' &&
    next.harnessSelection &&
    !next.harnessSelection.adoptedCandidateId
  ) {
    throw new ContentPackageSemanticMutationError(
      'HARNESS_ADOPTION_EVIDENCE_REQUIRED',
      'An accepted Harness package must record its adopted candidate.',
    );
  }
  if (
    next.rights.state === 'revoked' &&
    (next.status === 'accepted' || next.status === 'export_failed')
  ) {
    throw new ContentPackageSemanticMutationError(
      'CONTENT_PACKAGE_RIGHTS_STATE_CONFLICT',
      'Revoked ContentPackage rights cannot remain in a deliverable state.',
    );
  }
  if ((next.deliveryEvents?.length ?? 0) > 0 && next.variants.length === 0) {
    throw new ContentPackageSemanticMutationError(
      'DELIVERY_VARIANT_REQUIRED',
      'ContentPackage delivery requires a persisted platform variant.',
    );
  }
  return next;
}

/**
 * An auxiliary write records something the system did on the merchant's behalf
 * — today, the self_publish ApprovalReceipt the workbench prepares the moment a
 * package reads delivered (V31-106). It is a prefetch, not a decision about the
 * content, so it must not move the revision the merchant's own writes compare
 * against; three journeys were each patched to survive that bump before the
 * writer was changed instead.
 *
 * Everything this permits is spelled out rather than assumed, because the whole
 * aggregate travels as one payload and an unguarded same-revision write would be
 * a hole straight through optimistic concurrency: only appended approval
 * receipts and `updatedAt` may differ, and the receipts already present must
 * come back untouched and in order.
 */
export function validateContentPackageAuxiliaryWrite(input: {
  current: AuxiliaryComparable;
  next: AuxiliaryComparable;
}) {
  const { current, next } = input;
  if (next.revision !== current.revision) {
    throw new ContentPackageSemanticMutationError(
      'CONTENT_PACKAGE_AUXILIARY_WRITE_REJECTED',
      `An auxiliary ContentPackage write must leave the revision at ${current.revision}, not ${next.revision}.`,
    );
  }
  const currentReceipts = current.approvalReceipts ?? [];
  const nextReceipts = next.approvalReceipts ?? [];
  if (nextReceipts.length < currentReceipts.length) {
    throw new ContentPackageSemanticMutationError(
      'CONTENT_PACKAGE_AUXILIARY_WRITE_REJECTED',
      'An auxiliary ContentPackage write may only append approval receipts.',
    );
  }
  if (
    canonicalJson(currentReceipts) !==
    canonicalJson(nextReceipts.slice(0, currentReceipts.length))
  ) {
    throw new ContentPackageSemanticMutationError(
      'CONTENT_PACKAGE_AUXILIARY_WRITE_REJECTED',
      'An auxiliary ContentPackage write may not rewrite approval receipts it did not add.',
    );
  }
  if (
    canonicalJson(auxiliaryComparableShape(current)) !==
    canonicalJson(auxiliaryComparableShape(next))
  ) {
    throw new ContentPackageSemanticMutationError(
      'CONTENT_PACKAGE_AUXILIARY_WRITE_REJECTED',
      'An auxiliary ContentPackage write may not change anything but its own appended approval receipts.',
    );
  }
  return next;
}

export type AuxiliaryComparable = {
  approvalReceipts?: unknown[];
  revision: number;
  updatedAt?: unknown;
};

function auxiliaryComparableShape(value: AuxiliaryComparable) {
  const {
    approvalReceipts: _approvalReceipts,
    updatedAt: _updatedAt,
    ...rest
  } = value;
  return rest;
}
