import {
  contextInvalidationEventSchema,
  type ContextBundle,
  type ContextInvalidationEvent,
} from '@meiye/contracts';
import type { ContextBundleRepository } from './context-bundle-repository.js';

export interface ContextInvalidationSink {
  handle(event: ContextInvalidationEvent): Promise<void>;
}

export interface ExpiredFactInvalidator {
  invalidateExpiredFact(input: {
    expiresAt: string;
    workspaceId: string;
    factId: string;
    revision: number;
  }): Promise<unknown>;
}

export class ContextInvalidationService {
  constructor(
    private readonly bundles: Pick<
      ContextBundleRepository,
      'listReferencingBundles'
    >,
    private readonly sinks: readonly ContextInvalidationSink[],
  ) {}

  async invalidateExpiredFact(input: {
    expiresAt: string;
    workspaceId: string;
    factId: string;
    revision: number;
  }) {
    const bundles = await this.bundles.listReferencingBundles(
      input.workspaceId,
      input.factId,
      input.revision,
    );
    return this.dispatch({
      eventId: [
        'context-invalidation',
        input.workspaceId,
        'facts',
        input.factId,
        input.revision,
        input.expiresAt,
      ].join(':'),
      workspaceId: input.workspaceId,
      sourceKey: 'facts',
      sourceReferenceId: input.factId,
      reason: 'fact_expired',
      observedAt: input.expiresAt,
      bundles,
    });
  }

  async dispatchSourceInvalidation(input: {
    workspaceId: string;
    sourceKey: ContextInvalidationEvent['source']['key'];
    sourceReferenceId: string;
    reason: ContextInvalidationEvent['reason'];
    observedAt: string;
    affectedBundles: readonly ContextBundle[];
  }) {
    return this.dispatch({
      ...input,
      bundles: input.affectedBundles,
    });
  }

  private async dispatch(input: {
    eventId?: string;
    workspaceId: string;
    sourceKey: ContextInvalidationEvent['source']['key'];
    sourceReferenceId: string;
    reason: ContextInvalidationEvent['reason'];
    observedAt: string;
    bundles: readonly ContextBundle[];
  }) {
    const event = contextInvalidationEventSchema.parse({
      eventId:
        input.eventId ??
        [
          'context-invalidation',
          input.workspaceId,
          input.sourceKey,
          input.sourceReferenceId,
          input.observedAt,
        ].join(':'),
      workspaceId: input.workspaceId,
      source: {
        key: input.sourceKey,
        referenceId: input.sourceReferenceId,
      },
      reason: input.reason,
      affectedBundleReferences: input.bundles
        .map((bundle) => ({
          bundleId: bundle.bundleId,
          revision: bundle.revision,
          hash: bundle.hash,
        }))
        .sort(
          (left, right) =>
            left.bundleId.localeCompare(right.bundleId) ||
            left.revision - right.revision,
        ),
      observedAt: input.observedAt,
    });
    await Promise.all(this.sinks.map((sink) => sink.handle(event)));
    return event;
  }
}

export function createContextInvalidationRuntime(input: {
  bundles: Pick<ContextBundleRepository, 'listReferencingBundles'>;
  sinks: readonly ContextInvalidationSink[];
}) {
  const service = new ContextInvalidationService(input.bundles, input.sinks);
  return { service };
}
