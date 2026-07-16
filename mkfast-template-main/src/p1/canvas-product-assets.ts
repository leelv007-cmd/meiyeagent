import type { Asset } from '@meiye/contracts';

import {
  p1_canvas_category_before_after,
  p1_canvas_category_customer_case,
  p1_canvas_category_other,
  p1_canvas_category_price_list,
  p1_canvas_category_store,
} from '@/locale/paraglide/messages';

import type { CanvasLibraryAsset } from './canvas-library';

type CanvasDocumentLike = Record<string, unknown>;

const CATEGORY_LABELS: Record<NonNullable<Asset['category']>, () => string> = {
  before_after: p1_canvas_category_before_after,
  customer_case: p1_canvas_category_customer_case,
  other: p1_canvas_category_other,
  price_list: p1_canvas_category_price_list,
  store: p1_canvas_category_store,
};

export function productAssetsToCanvasLibrary(
  assets: Asset[]
): CanvasLibraryAsset[] {
  return assets
    .filter((asset) => asset.mediaType === 'image')
    .map((asset) => ({
      authorizationStatus: asset.authorizationStatus,
      id: asset.id,
      label:
        asset.tags[0] ??
        (asset.category ? CATEGORY_LABELS[asset.category]() : undefined) ??
        asset.objectKey.split('/').at(-1) ??
        asset.id,
      objectKey: asset.objectKey,
      sourceType: asset.sourceType,
      src: `/api/storage/file?key=${encodeURIComponent(asset.objectKey)}`,
    }));
}

function productAssetId(value: Record<string, unknown>) {
  if (typeof value.assetId === 'string') return value.assetId;
  if (!value.custom || typeof value.custom !== 'object') return undefined;
  const custom = value.custom as Record<string, unknown>;
  return typeof custom.productAssetId === 'string'
    ? custom.productAssetId
    : undefined;
}

export function canvasImageAssetIds(document?: CanvasDocumentLike) {
  const pages = Array.isArray(document?.pages) ? document.pages : [];
  return pages.flatMap((page) => {
    if (!page || typeof page !== 'object' || Array.isArray(page)) return [];
    const value = page as Record<string, unknown>;
    const elements = Array.isArray(value.elements)
      ? value.elements
      : Array.isArray(value.children)
        ? value.children
        : [];
    return elements.flatMap((element) => {
      if (!element || typeof element !== 'object' || Array.isArray(element)) {
        return [];
      }
      const item = element as Record<string, unknown>;
      const kind = item.kind ?? item.type;
      const assetId = productAssetId(item);
      return kind === 'image' && assetId ? [assetId] : [];
    });
  });
}

export function withCanvasAssetProvenance(
  element: Record<string, unknown>
): Record<string, unknown> {
  const assetId = productAssetId(element);
  if (!assetId) return element;
  const custom =
    element.custom && typeof element.custom === 'object'
      ? (element.custom as Record<string, unknown>)
      : {};
  return {
    ...element,
    assetId,
    custom: { ...custom, productAssetId: assetId },
  };
}
