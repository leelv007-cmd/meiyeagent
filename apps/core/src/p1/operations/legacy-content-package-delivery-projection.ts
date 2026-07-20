import type {
  ContentPackage,
  ContentPackageDeliveryEvent,
  HandoffPackage,
} from '@meiye/contracts';

import type { ProductRepository } from '../../product/repository.js';
import type { LegacyDeliveryProjectionPort } from './content-package-delivery.js';

export class ProductLegacyDeliveryProjection
  implements LegacyDeliveryProjectionPort
{
  constructor(private readonly products: Pick<ProductRepository, 'load'>) {}

  async list(
    contentPackage: ContentPackage
  ): Promise<ContentPackageDeliveryEvent[]> {
    const legacySourceId = contentPackage.legacySource?.sourceId;
    if (!legacySourceId) return [];
    const state = await this.products.load(contentPackage.workspaceId);
    if (!state) return [];
    return state.handoffPackages
      .filter((handoff) => handoff.contentId === legacySourceId)
      .flatMap(projectHandoff);
  }
}

function projectHandoff(
  handoff: HandoffPackage
): ContentPackageDeliveryEvent[] {
  const operations: ContentPackageDeliveryEvent[] = handoff.exportEvents.map(
    (event) => ({
      actorId: event.userId,
      id: event.id,
      occurredAt: event.createdAt,
      operation: event.type,
      platform: handoff.platform,
      source: 'legacy_read_only',
      type: 'legacy_handoff_event',
      variantVersionId: handoff.contentVersionId,
    })
  );
  const results: ContentPackageDeliveryEvent[] = handoff.manualReports.map(
    (report) => ({
      actorId: report.userId,
      id: report.id,
      ...(report.note ? { note: report.note } : {}),
      occurredAt: report.createdAt,
      platform: handoff.platform,
      ...(report.platformUrl ? { platformUrl: report.platformUrl } : {}),
      source: 'legacy_read_only',
      status:
        report.outcome === 'published'
          ? 'published'
          : report.outcome === 'failed'
            ? 'failed'
            : 'unknown',
      type: 'manual_publish_result',
      variantVersionId: handoff.contentVersionId,
    })
  );
  if (handoff.status === 'published' && results.length === 0) {
    results.push({
      actorId: handoff.operatorUserId,
      id: `legacy-published-${handoff.id}`,
      occurredAt: handoff.publishedAt ?? handoff.createdAt,
      platform: handoff.platform,
      ...(handoff.platformUrl ? { platformUrl: handoff.platformUrl } : {}),
      source: 'legacy_read_only',
      status: 'published',
      type: 'manual_publish_result',
      variantVersionId: handoff.contentVersionId,
    });
  }
  return [...operations, ...results];
}
