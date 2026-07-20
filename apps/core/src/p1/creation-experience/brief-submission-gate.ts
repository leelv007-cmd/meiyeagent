import { P1DomainError } from '../foundation/domain.js';
import { briefRevisionsMatch } from './brief-trigger-projection.js';
import type { BriefConfirmationRepository } from './brief-confirmation-repository.js';
import type { BriefRevisionResolver } from './brief-revision-resolver.js';
import {
  briefIntentRevisionId,
  briefSourceRevisionId,
  type BriefRevisionContextRepository,
} from './postgres-brief-revision-context.js';

export interface BriefSubmissionGate {
  assertCurrent(input: {
    aspectRatio?: string;
    briefConfirmationId?: string;
    briefContextId: string;
    catalogModelId?: string;
    catalogRevision?: string;
    durationSeconds?: number;
    expectedContextRevision?: number;
    intent: string;
    operation: CreativeOperation;
    outputCount?: number;
    sourceReferenceIds: string[];
    quoteRevision?: string;
    workspaceId: string;
  }): Promise<{ contextRevision: number } | void>;
}

function operationLens(operation: CreativeOperation): CreationLensId {
  if (operation.startsWith('copy.')) return 'copy';
  if (operation.startsWith('image.')) return 'image_text';
  if (operation.startsWith('video.')) return 'video';
  throw new P1DomainError(
    'INVALID_STATE',
    `Operation ${operation} has no registered Brief Lens policy.`,
  );
}

/** Server-side create/submit gate backed by the durable projection + confirmation. */
export class CreationExperienceBriefSubmissionGate
  implements BriefSubmissionGate
{
  constructor(
    private readonly contexts: BriefRevisionContextRepository,
    private readonly confirmations: BriefConfirmationRepository,
    private readonly revisions: BriefRevisionResolver,
  ) {}

  async assertCurrent(input: {
    aspectRatio?: string;
    briefConfirmationId?: string;
    briefContextId: string;
    catalogModelId?: string;
    catalogRevision?: string;
    durationSeconds?: number;
    expectedContextRevision?: number;
    intent: string;
    operation: CreativeOperation;
    outputCount?: number;
    sourceReferenceIds: string[];
    quoteRevision?: string;
    workspaceId: string;
  }) {
    const context = await this.contexts.getBriefRevisionContext(
      input.workspaceId,
      input.briefContextId,
    );
    if (!context?.lastProjection) {
      throw new P1DomainError(
        'INVALID_STATE',
        'A current server Brief projection is required before submission.',
      );
    }
    if (
      input.expectedContextRevision !== undefined &&
      context.revision !== input.expectedContextRevision
    ) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'The Brief context revision changed before the creative write could commit.',
      );
    }
    if (context.intentRevisionId !== briefIntentRevisionId(input.intent)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Creative intent does not match the revision-bound Brief context.',
      );
    }
    if (
      context.sourceRevisionId !==
      briefSourceRevisionId(input.sourceReferenceIds)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Creative sources do not match the revision-bound Brief context.',
      );
    }
    const expectedLens = operationLens(input.operation);
    if (context.lensId !== expectedLens) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Brief context lens ${context.lensId} does not match operation ${input.operation}.`,
      );
    }
    if (
      input.outputCount !== undefined &&
      (context.projectionFacts.outputCount ?? 1) !== input.outputCount
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Creative output count does not match the revision-bound Brief context.',
      );
    }
    if (
      input.outputCount !== undefined &&
      context.projectionFacts.aspectRatio !== (input.aspectRatio ?? null)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Creative aspect ratio does not match the revision-bound Brief context.',
      );
    }
    if (
      input.outputCount !== undefined &&
      context.projectionFacts.durationSeconds !==
        (input.durationSeconds ?? null)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Creative duration does not match the revision-bound Brief context.',
      );
    }
    const current = await this.revisions.resolveCurrentRevisions(
      input.workspaceId,
      { briefContextId: input.briefContextId },
    );
    if (!briefRevisionsMatch(context.lastProjection.bindRevisions, current)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The Brief projection is stale and must be refreshed.',
      );
    }
    if (
      input.catalogRevision !== undefined &&
      (current.modelRevisionId ?? null) !== input.catalogRevision
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Creative model Catalog revision does not match the Brief context.',
      );
    }
    if (input.catalogModelId !== undefined) {
      const quote = await this.revisions.resolveCurrentQuoteSignal(
        input.workspaceId,
        { briefContextId: input.briefContextId },
      );
      if (quote?.catalogModelId !== input.catalogModelId) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Creative model id does not match the Brief context.',
        );
      }
    }
    if (
      input.quoteRevision !== undefined &&
      (current.quoteRevisionId ?? null) !== input.quoteRevision
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Creative quote revision does not match the Brief context.',
      );
    }
    if (!context.lastProjection.requiresBrief) {
      return { contextRevision: context.revision };
    }
    if (!input.briefConfirmationId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'A durable Brief confirmation is required for this submission.',
      );
    }
    const confirmation = await this.confirmations.getBriefConfirmation(
      input.workspaceId,
      input.briefConfirmationId,
    );
    if (
      !confirmation ||
      !briefRevisionsMatch(confirmation.boundRevisions, current)
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The durable Brief confirmation is missing or stale.',
      );
    }
    return { contextRevision: context.revision };
  }
}
import type { CreationLensId, CreativeOperation } from '@meiye/contracts';
