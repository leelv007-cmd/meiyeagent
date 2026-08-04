import type { ProductState } from '@meiye/contracts';
import type { OperationsRepository } from './repository.js';
import type { SearchDocument } from './types.js';

function assetDocument(
  state: ProductState,
  asset: ProductState['assets'][number]
): SearchDocument {
  return {
    id: asset.id,
    kind: 'asset',
    metadata: {
      authorization: asset.authorizationStatus,
      category: asset.category ?? 'uncategorized',
      consentScope: asset.consentScope,
      mediaType: asset.mediaType,
      projectionOwner: 'product',
      store: state.store?.name ?? 'unknown',
    },
    tags: [
      ...asset.tags,
      asset.category ?? 'uncategorized',
      asset.authorizationStatus,
    ],
    text: [
      asset.rightsOwner,
      asset.category,
      asset.containsPerson ? '人物 人脸' : undefined,
      asset.containsSensitiveData ? '敏感信息' : undefined,
    ]
      .filter(Boolean)
      .join(' '),
    title: asset.tags[0] ?? asset.category ?? '\u7d20\u6750',
    updatedAt: state.updatedAt,
    workspaceId: state.workspaceId,
  };
}

function contentDocument(
  state: ProductState,
  content: ProductState['contents'][number]
): SearchDocument {
  const versions = content.variants.flatMap((variant) => variant.versions);
  const currentVersions = content.variants.flatMap((variant) => {
    const version = variant.versions.find(
      (candidate) => candidate.id === variant.currentVersionId
    );
    return version ? [version] : [];
  });
  const searchable = currentVersions.length > 0 ? currentVersions : versions;
  const platforms = [...new Set(content.variants.map((variant) => variant.platform))];
  const updatedAt = [
    content.createdAt,
    content.abandonedAt,
    ...versions.map((version) => version.createdAt),
    ...(state.auditEvents ?? [])
      .filter(
        (event) =>
          event.entityType === 'content' && event.entityId === content.id
      )
      .map((event) => event.createdAt),
    ...(state.handoffPackages ?? [])
      .filter((handoff) => handoff.contentId === content.id)
      .flatMap((handoff) => (handoff.publishedAt ? [handoff.publishedAt] : [])),
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? content.createdAt;
  return {
    id: content.id,
    kind: 'content',
    metadata: {
      projectionOwner: 'product',
      projectId: content.projectId,
      status: content.status,
      updatedDate: updatedAt.slice(0, 10),
    },
    tags: [content.scenario, ...platforms],
    text: searchable
      .flatMap((version) => [
        version.title,
        version.body,
        version.conversionHook,
        ...version.topics,
      ])
      .join(' '),
    title: searchable[0]?.title ?? '\u5185\u5bb9',
    updatedAt,
    workspaceId: state.workspaceId,
  };
}

/**
 * Projects Product Core facts into the shared PostgreSQL search index. Product
 * remains authoritative; this adapter owns only a rebuildable read model.
 */
export class OperationsProductSearchProjection {
  constructor(private readonly repository: OperationsRepository) {}

  async sync(state: ProductState) {
    const documents = [
      ...state.assets.map((asset) => assetDocument(state, asset)),
      ...state.contents.map((content) => contentDocument(state, content)),
    ];
    await this.repository.withWorkspaceLock(
      state.workspaceId,
      (repository) =>
        repository.replaceSearchDocuments(
          state.workspaceId,
          ['asset', 'content'],
          documents,
          state.updatedAt,
          'product'
        )
    );
  }
}
