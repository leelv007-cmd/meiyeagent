import { contentPackageSchema } from '@meiye/contracts';

export class ContentPackageSemanticMutationError extends Error {
  constructor(
    readonly code:
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
