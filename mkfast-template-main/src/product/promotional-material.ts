import {
  promotionalMaterialReceiptExtensionSchema,
  type PromotionalMaterialReceiptExtension,
  type PromotionalMaterialSpec,
} from '@meiye/contracts';

import type {
  LightCanvasDocument,
  LightCanvasElement,
} from './light-composer-document';

const BRAND_SAFE_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"><rect width="1200" height="900" fill="#f3eee8"/><circle cx="600" cy="390" r="120" fill="#d8c6b8"/><path d="M360 690c72-126 158-189 258-189s186 63 258 189" fill="none" stroke="#b99f8c" stroke-width="44" stroke-linecap="round"/></svg>'
)}`;

export interface PromotionalMaterialExportPlan
  extends Pick<
    PromotionalMaterialReceiptExtension,
    'capabilityStatus' | 'missingMaterialFallback'
  > {
  document: LightCanvasDocument;
}

export function resizeLightComposerDocumentForMaterial(
  document: LightCanvasDocument,
  spec: PromotionalMaterialSpec
): LightCanvasDocument {
  const scaleX = spec.width / document.width;
  const scaleY = spec.height / document.height;
  const fontScale = Math.min(scaleX, scaleY);
  return {
    width: spec.width,
    height: spec.height,
    pages: document.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) => ({
        ...element,
        x: round(element.x * scaleX),
        y: round(element.y * scaleY),
        width: round(element.width * scaleX),
        height: round(element.height * scaleY),
        ...(element.kind === 'text' && element.fontSize
          ? { fontSize: round(element.fontSize * fontScale) }
          : {}),
      })),
    })),
  };
}

export function planPromotionalMaterialExport(input: {
  availableAssetIds: string[];
  capabilityStatus: PromotionalMaterialReceiptExtension['capabilityStatus'];
  document: LightCanvasDocument;
  spec: PromotionalMaterialSpec;
}): PromotionalMaterialExportPlan {
  const document = resizeLightComposerDocumentForMaterial(
    input.document,
    input.spec
  );
  assertPromotionalMaterialTextSafeArea(document, input.spec);
  const availableAssetIds = new Set(input.availableAssetIds);
  let missingMaterialFallback: PromotionalMaterialReceiptExtension['missingMaterialFallback'] =
    input.capabilityStatus === 'assisted' ? 'text_only' : 'none';

  document.pages = document.pages.map((page) => ({
    ...page,
    elements: page.elements.flatMap<LightCanvasElement>((element) => {
      if (element.kind !== 'image') return [element];
      if (input.capabilityStatus === 'assisted') {
        missingMaterialFallback = 'text_only';
        return [];
      }
      if (element.src || availableAssetIds.has(element.assetId))
        return [element];
      missingMaterialFallback = 'brand_safe_placeholder';
      return [
        {
          ...element,
          assetId: `brand-safe-placeholder:${element.id}`,
          src: BRAND_SAFE_PLACEHOLDER,
        },
      ];
    }),
  }));

  return {
    capabilityStatus: input.capabilityStatus,
    document,
    missingMaterialFallback,
  };
}

export async function finalizePromotionalMaterialReceipt(input: {
  dataUrl: string;
  plan: PromotionalMaterialExportPlan;
  provenanceRef: string;
}): Promise<PromotionalMaterialReceiptExtension> {
  const bytes = renderedDataUrlBytes(input.dataUrl);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const outputSha256 = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return promotionalMaterialReceiptExtensionSchema.parse({
    capabilityStatus: input.plan.capabilityStatus,
    missingMaterialFallback: input.plan.missingMaterialFallback,
    outputSha256,
    provenanceRef: input.provenanceRef,
  });
}

function renderedDataUrlBytes(dataUrl: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/u.exec(dataUrl);
  if (!match)
    throw new Error('Promotional material export must be a PNG data URL.');
  const binary = atob(match[1]!.replace(/\s/gu, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function promotionalMaterialTextSafeAreaBounds(
  spec: PromotionalMaterialSpec
) {
  return {
    bottom: spec.height - spec.textSafeArea.bottom,
    left: spec.textSafeArea.left,
    right: spec.width - spec.textSafeArea.right,
    top: spec.textSafeArea.top,
  };
}

export function assertPromotionalMaterialTextSafeArea(
  document: LightCanvasDocument,
  spec: PromotionalMaterialSpec
) {
  const safeArea = promotionalMaterialTextSafeAreaBounds(spec);
  for (const page of document.pages) {
    for (const element of page.elements) {
      if (element.kind !== 'text') continue;
      const radians = (element.rotation * Math.PI) / 180;
      const halfWidth = element.width / 2;
      const halfHeight = element.height / 2;
      const rotatedHalfWidth =
        Math.abs(Math.cos(radians)) * halfWidth +
        Math.abs(Math.sin(radians)) * halfHeight;
      const rotatedHalfHeight =
        Math.abs(Math.sin(radians)) * halfWidth +
        Math.abs(Math.cos(radians)) * halfHeight;
      const centerX = element.x + halfWidth;
      const centerY = element.y + halfHeight;
      if (
        centerX - rotatedHalfWidth < safeArea.left ||
        centerX + rotatedHalfWidth > safeArea.right ||
        centerY - rotatedHalfHeight < safeArea.top ||
        centerY + rotatedHalfHeight > safeArea.bottom
      ) {
        throw new Error(
          `Promotional material text ${element.id} exceeds the frozen textSafeArea.`
        );
      }
    }
  }
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
