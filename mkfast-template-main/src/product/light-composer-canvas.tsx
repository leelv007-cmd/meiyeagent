'use client';

import {
  IconArrowDown,
  IconArrowUp,
  IconCrop,
  IconDeviceFloppy,
  IconDownload,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  light_composer_copy_label,
  light_composer_crop,
  light_composer_description,
  light_composer_move_down,
  light_composer_move_up,
  light_composer_no_modules,
  light_composer_preview,
  light_composer_output_original,
  light_composer_output_purpose_douyin_cover,
  light_composer_output_purpose_offline_poster,
  light_composer_output_purpose_wechat_poster,
  light_composer_output_purpose_xiaohongshu_cover,
  light_composer_output_purpose,
  light_composer_replace_asset,
  light_composer_title,
  p1_canvas_aigc_label,
  p1_canvas_brand_watermark,
  p1_canvas_export,
  p1_canvas_export_aigc_text,
  p1_canvas_export_brand_fallback,
  p1_canvas_save,
  p1_canvas_save_as_template,
} from '@/locale/paraglide/messages';

import type { CanvasLibraryAsset } from '@/p1/canvas-library';
import {
  PROMOTIONAL_MATERIAL_SPECS,
  type PromotionalMaterialReceiptExtension,
  type PromotionalMaterialSpec,
} from '@meiye/contracts';
import {
  applyLightComposerEdit,
  type LightCanvasDocument,
} from './light-composer-document';
import { buildLightComposerComplianceLabels } from './light-composer-compliance';
import {
  finalizePromotionalMaterialReceipt,
  planPromotionalMaterialExport,
} from './promotional-material';

const FULL_SOURCE_CROP = { height: 1, width: 1, x: 0, y: 0 } as const;

export interface LightCanvasSnapshot {
  aigcLabelEnabled: boolean;
  document: LightCanvasDocument;
  sourceRevision: string;
  watermarkEnabled: boolean;
}

export interface LightCanvasExportResult {
  dataUrl: string;
  materialSpec?: PromotionalMaterialSpec;
  promotionalMaterialReceipt?: PromotionalMaterialReceiptExtension;
  snapshot: LightCanvasSnapshot;
}

interface LightComposerCanvasProps {
  aigcLabelEnabled: boolean;
  document: LightCanvasDocument;
  documentRevision: string;
  exporting?: boolean;
  initialPromotionalMaterialPurpose?: PromotionalMaterialSpec['purpose'];
  libraryAssets?: CanvasLibraryAsset[];
  onAigcLabelChange: (enabled: boolean) => void;
  onExport: (result: LightCanvasExportResult) => Promise<void> | void;
  onSave: (snapshot: LightCanvasSnapshot) => Promise<void> | void;
  onSaveAsTemplate?: (snapshot: LightCanvasSnapshot) => Promise<void> | void;
  onWatermarkChange: (enabled: boolean) => void;
  promotionalMaterialCapabilityStatus?: PromotionalMaterialReceiptExtension['capabilityStatus'];
  promotionalMaterialSpecs?: readonly PromotionalMaterialSpec[];
  saving?: boolean;
  watermarkEnabled: boolean;
  watermarkText?: string;
}

function promotionalMaterialPurposeLabel(
  purpose: PromotionalMaterialSpec['purpose']
) {
  switch (purpose) {
    case 'xiaohongshu_cover':
      return light_composer_output_purpose_xiaohongshu_cover();
    case 'douyin_cover':
      return light_composer_output_purpose_douyin_cover();
    case 'wechat_moments_poster':
      return light_composer_output_purpose_wechat_poster();
    case 'offline_a4_poster':
      return light_composer_output_purpose_offline_poster();
  }
}

function snapshot(
  document: LightCanvasDocument,
  documentRevision: string,
  watermarkEnabled: boolean,
  aigcLabelEnabled: boolean
): LightCanvasSnapshot {
  return {
    aigcLabelEnabled,
    document: structuredClone(document),
    sourceRevision: documentRevision,
    watermarkEnabled,
  };
}

function drawText(
  context: CanvasRenderingContext2D,
  element: Extract<
    LightCanvasDocument['pages'][number]['elements'][number],
    { kind: 'text' }
  >
) {
  context.save();
  context.globalAlpha = element.opacity ?? 1;
  context.fillStyle = element.fill ?? '#171717';
  context.font = `${element.fontSize ?? 42}px ${element.fontFamily ?? 'sans-serif'}`;
  context.translate(
    element.x + element.width / 2,
    element.y + element.height / 2
  );
  context.rotate((element.rotation * Math.PI) / 180);
  context.textBaseline = 'top';
  const lines = element.text.split(/\r?\n/u);
  const lineHeight = Math.max(1, element.height / Math.max(1, lines.length));
  lines.forEach((line, index) => {
    context.fillText(
      line,
      -element.width / 2,
      -element.height / 2 + index * lineHeight,
      element.width
    );
  });
  context.restore();
}

export function lightCanvasImageDrawArguments(
  element: Extract<
    LightCanvasDocument['pages'][number]['elements'][number],
    { kind: 'image' }
  >,
  sourceWidth: number,
  sourceHeight: number
): [number, number, number, number, number, number, number, number] {
  const crop = element.crop ?? FULL_SOURCE_CROP;
  return [
    crop.x * sourceWidth,
    crop.y * sourceHeight,
    crop.width * sourceWidth,
    crop.height * sourceHeight,
    -element.width / 2,
    -element.height / 2,
    element.width,
    element.height,
  ];
}

async function loadImage(src: string) {
  const response = await fetch(src, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('light Composer image could not be read.');
  return createImageBitmap(await response.blob());
}

export async function renderLightCanvasDocument(
  document: LightCanvasDocument,
  assets: CanvasLibraryAsset[],
  labels: {
    aigcLabelEnabled: boolean;
    watermarkEnabled: boolean;
    watermarkText?: string;
  }
) {
  const canvas = window.document.createElement('canvas');
  canvas.width = document.width;
  canvas.height = document.height;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('light Composer raster context is unavailable.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const assetSources = new Map(assets.map((asset) => [asset.id, asset.src]));
  for (const element of document.pages[0]?.elements ?? []) {
    if (element.kind === 'text') {
      drawText(context, element);
      continue;
    }
    const src = element.src ?? assetSources.get(element.assetId);
    if (!src) continue;
    const image = await loadImage(src);
    context.save();
    context.globalAlpha = element.opacity ?? 1;
    context.translate(
      element.x + element.width / 2,
      element.y + element.height / 2
    );
    context.rotate((element.rotation * Math.PI) / 180);
    context.drawImage(
      image,
      ...lightCanvasImageDrawArguments(element, image.width, image.height)
    );
    context.restore();
    image.close();
  }
  const labelLines = buildLightComposerComplianceLabels(labels, {
    aigc: p1_canvas_export_aigc_text(),
    watermark: p1_canvas_export_brand_fallback(),
  }).map((label) => label.text);
  if (labelLines.length > 0) {
    const padding = Math.max(16, Math.round(document.width * 0.018));
    const fontSize = Math.max(24, Math.round(document.width * 0.026));
    const lineHeight = Math.round(fontSize * 1.35);
    const height = labelLines.length * lineHeight + padding * 2;
    context.fillStyle = 'rgba(0, 0, 0, 0.72)';
    context.fillRect(0, document.height - height, document.width, height);
    context.fillStyle = '#ffffff';
    context.font = `${fontSize}px sans-serif`;
    labelLines.forEach((line, index) => {
      context.fillText(
        line,
        padding,
        document.height - height + padding + index * lineHeight
      );
    });
  }
  return canvas.toDataURL('image/png');
}

function Preview({
  assets,
  document,
}: {
  assets: CanvasLibraryAsset[];
  document: LightCanvasDocument;
}) {
  const sources = new Map(assets.map((asset) => [asset.id, asset.src]));
  return (
    <svg
      aria-label={light_composer_preview()}
      className="max-h-[680px] w-full rounded-lg bg-white shadow-sm"
      role="img"
      viewBox={`0 0 ${document.width} ${document.height}`}
    >
      <title>{light_composer_preview()}</title>
      <rect fill="#fff" height={document.height} width={document.width} />
      {(document.pages[0]?.elements ?? []).map((element) => {
        const transform = `rotate(${element.rotation} ${element.x + element.width / 2} ${element.y + element.height / 2})`;
        if (element.kind === 'image') {
          const src = element.src ?? sources.get(element.assetId);
          const crop = element.crop ?? FULL_SOURCE_CROP;
          return src ? (
            <svg
              height={element.height}
              key={element.id}
              overflow="hidden"
              preserveAspectRatio="none"
              transform={transform}
              viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
              width={element.width}
              x={element.x}
              y={element.y}
            >
              <image
                height="1"
                href={src}
                opacity={element.opacity ?? 1}
                preserveAspectRatio="none"
                width="1"
                x="0"
                y="0"
              />
            </svg>
          ) : null;
        }
        return (
          <text
            fill={element.fill ?? '#171717'}
            fontFamily={element.fontFamily ?? 'sans-serif'}
            fontSize={element.fontSize ?? 42}
            key={element.id}
            opacity={element.opacity ?? 1}
            transform={transform}
            x={element.x}
            y={element.y + (element.fontSize ?? 42)}
          >
            {element.text.split(/\r?\n/u).map((line, index) => (
              <tspan
                dy={index === 0 ? 0 : (element.fontSize ?? 42) * 1.25}
                key={`${element.id}-${index}`}
                x={element.x}
              >
                {line}
              </tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}

export function LightComposerCanvas({
  aigcLabelEnabled,
  document: initialDocument,
  documentRevision,
  exporting = false,
  initialPromotionalMaterialPurpose,
  libraryAssets = [],
  onAigcLabelChange,
  onExport,
  onSave,
  onSaveAsTemplate,
  onWatermarkChange,
  promotionalMaterialCapabilityStatus = 'verified',
  promotionalMaterialSpecs = PROMOTIONAL_MATERIAL_SPECS,
  saving = false,
  watermarkEnabled,
  watermarkText,
}: LightComposerCanvasProps) {
  const [document, setDocument] = useState(initialDocument);
  const [materialPurpose, setMaterialPurpose] = useState<
    PromotionalMaterialSpec['purpose'] | 'original'
  >(initialPromotionalMaterialPurpose ?? 'original');
  const initialDocumentRef = useRef(initialDocument);
  initialDocumentRef.current = initialDocument;
  useEffect(() => setDocument(initialDocumentRef.current), [documentRevision]);
  const modules = document.pages[0]?.elements ?? [];
  const assets = useMemo(() => libraryAssets, [libraryAssets]);
  const materialSpec = promotionalMaterialSpecs.find(
    (spec) => spec.purpose === materialPurpose
  );
  const materialPlan = materialSpec
    ? planPromotionalMaterialExport({
        availableAssetIds: assets
          .filter((asset) => asset.authorizationStatus === 'authorized')
          .map((asset) => asset.id),
        capabilityStatus: promotionalMaterialCapabilityStatus,
        document,
        spec: materialSpec,
      })
    : undefined;
  const outputDocument = materialPlan?.document ?? document;
  const currentSnapshot = () =>
    snapshot(document, documentRevision, watermarkEnabled, aigcLabelEnabled);
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{light_composer_title()}</h2>
          <p className="text-sm text-muted-foreground">
            {light_composer_description()}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            {light_composer_output_purpose()}
            <select
              className="h-8 rounded-md border bg-background px-2"
              onChange={(event) =>
                setMaterialPurpose(
                  event.currentTarget.value as
                    | PromotionalMaterialSpec['purpose']
                    | 'original'
                )
              }
              value={materialPurpose}
            >
              <option value="original">
                {light_composer_output_original()}
              </option>
              {promotionalMaterialSpecs.map((spec) => (
                <option key={spec.purpose} value={spec.purpose}>
                  {promotionalMaterialPurposeLabel(spec.purpose)} · {spec.width}
                  ×{spec.height}
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex items-center gap-2 text-xs"
            htmlFor="light-composer-watermark"
          >
            <Switch
              checked={watermarkEnabled}
              id="light-composer-watermark"
              onCheckedChange={onWatermarkChange}
            />
            {p1_canvas_brand_watermark()}
          </label>
          <label
            className="flex items-center gap-2 text-xs"
            htmlFor="light-composer-aigc-label"
          >
            <Switch
              checked={aigcLabelEnabled}
              id="light-composer-aigc-label"
              onCheckedChange={onAigcLabelChange}
            />
            {p1_canvas_aigc_label()}
          </label>
          <Button
            disabled={saving}
            onClick={() => void onSave(currentSnapshot())}
            size="sm"
            type="button"
            variant="outline"
          >
            <IconDeviceFloppy />
            {p1_canvas_save()}
          </Button>
          {onSaveAsTemplate ? (
            <Button
              disabled={saving}
              onClick={() => void onSaveAsTemplate(currentSnapshot())}
              size="sm"
              type="button"
              variant="outline"
            >
              <IconDeviceFloppy />
              {p1_canvas_save_as_template()}
            </Button>
          ) : null}
          <Button
            disabled={exporting}
            onClick={() => {
              const exportSnapshot = {
                ...currentSnapshot(),
                document: structuredClone(outputDocument),
              };
              void renderLightCanvasDocument(outputDocument, assets, {
                aigcLabelEnabled,
                watermarkEnabled,
                ...(watermarkText ? { watermarkText } : {}),
              }).then(async (dataUrl) => {
                const promotionalMaterialReceipt = materialPlan
                  ? await finalizePromotionalMaterialReceipt({
                      dataUrl,
                      plan: materialPlan,
                      provenanceRef: exportSnapshot.sourceRevision,
                    })
                  : undefined;
                await onExport({
                  dataUrl,
                  ...(materialSpec ? { materialSpec } : {}),
                  ...(promotionalMaterialReceipt
                    ? { promotionalMaterialReceipt }
                    : {}),
                  snapshot: exportSnapshot,
                });
              });
            }}
            size="sm"
            type="button"
          >
            <IconDownload />
            {p1_canvas_export()}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(18rem,1fr)_minmax(20rem,1.2fr)]">
        <div className="space-y-3">
          {modules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {light_composer_no_modules()}
            </p>
          ) : null}
          {modules.map((element, index) => (
            <section
              className="meiye-porcelain space-y-2 rounded-2xl border border-divider p-4"
              key={element.id}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {element.kind === 'text'
                    ? light_composer_copy_label()
                    : light_composer_preview()}
                  <span className="ml-1 text-muted-foreground">
                    {index + 1}
                  </span>
                </p>
                <div className="flex gap-1">
                  <Button
                    aria-label={light_composer_move_up()}
                    disabled={index === 0}
                    onClick={() =>
                      setDocument((current) =>
                        applyLightComposerEdit(current, {
                          elementId: element.id,
                          targetIndex: index - 1,
                          type: 'reorder_module',
                        })
                      )
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <IconArrowUp />
                  </Button>
                  <Button
                    aria-label={light_composer_move_down()}
                    disabled={index === modules.length - 1}
                    onClick={() =>
                      setDocument((current) =>
                        applyLightComposerEdit(current, {
                          elementId: element.id,
                          targetIndex: index + 1,
                          type: 'reorder_module',
                        })
                      )
                    }
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <IconArrowDown />
                  </Button>
                </div>
              </div>
              {element.kind === 'text' ? (
                <label
                  className="grid gap-1 text-xs"
                  htmlFor={`light-composer-copy-${element.id}`}
                >
                  {light_composer_copy_label()}
                  <Textarea
                    id={`light-composer-copy-${element.id}`}
                    onChange={(event) =>
                      setDocument((current) =>
                        applyLightComposerEdit(current, {
                          elementId: element.id,
                          text: event.target.value,
                          type: 'edit_text',
                        })
                      )
                    }
                    value={element.text}
                  />
                </label>
              ) : (
                <div className="space-y-2">
                  <Button
                    onClick={() =>
                      setDocument((current) =>
                        applyLightComposerEdit(current, {
                          assetId: element.assetId,
                          crop: { height: 0.8, width: 0.8, x: 0.1, y: 0.1 },
                          elementId: element.id,
                          type: 'replace_image',
                        })
                      )
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <IconCrop />
                    {light_composer_crop()}
                  </Button>
                  <div className="flex flex-wrap gap-2">
                    {assets.map((asset) => (
                      <Button
                        key={asset.id}
                        onClick={() =>
                          setDocument((current) =>
                            applyLightComposerEdit(current, {
                              assetId: asset.id,
                              elementId: element.id,
                              src: asset.src,
                              type: 'replace_image',
                            })
                          )
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {light_composer_replace_asset({ name: asset.label })}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
        <div className="rounded-xl bg-muted/30 p-3">
          <p className="mb-2 text-sm font-medium">{light_composer_preview()}</p>
          <Preview assets={assets} document={outputDocument} />
        </div>
      </div>
    </section>
  );
}
