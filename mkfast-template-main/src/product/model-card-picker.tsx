import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  model_card_capability_missing,
  model_card_channel_multi,
  model_card_channel_single,
  model_card_group_aria,
  model_card_output_copy,
  model_card_output_image,
  model_card_output_video,
  model_card_preview_alt,
  model_card_preview_label,
  model_card_preview_unavailable,
  model_card_price_version_missing,
  model_card_quote,
  model_card_quote_missing,
  model_card_status_quote_missing,
  model_card_status_ready,
  model_card_status_unavailable,
  model_card_usage,
  model_card_usage_unknown,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import { modelPreviewUrl } from '@/p1/model-preview';
import type { CatalogModelView } from '@/p1/settings-view-model';
import { IconMovie, IconPhoto, IconSparkles } from '@tabler/icons-react';
import { useState } from 'react';

export interface ModelCardUsage {
  available: number;
  label: string;
}

export function modelCardView(model: CatalogModelView, usage?: ModelCardUsage) {
  const outputLabel =
    model.modality === 'llm'
      ? model_card_output_copy()
      : model.modality === 'image'
        ? model_card_output_image()
        : model_card_output_video();
  const selectable = model.available && Boolean(model.unitPrice);
  const channelReadinessLabel =
    model.channelReadiness === 'multi_channel_ready'
      ? model_card_channel_multi()
      : model.channelReadiness === 'single_channel'
        ? model_card_channel_single()
        : undefined;
  return {
    capabilityLabel:
      model.capabilityLabels.length > 0
        ? model.capabilityLabels.join(' · ')
        : model_card_capability_missing(),
    channelReadinessLabel,
    metaLabel: [model.manufacturer, model.version].filter(Boolean).join(' · '),
    previewAlt: model_card_preview_alt({ name: model.displayName }),
    previewLabel: model_card_preview_label(),
    previewUrl: modelPreviewUrl(model.modality),
    quoteLabel: model.unitPrice
      ? model_card_quote({
          output: outputLabel,
        })
      : model_card_quote_missing(),
    selectable,
    statusLabel: selectable
      ? model_card_status_ready()
      : model.available
        ? model_card_status_quote_missing()
        : model_card_status_unavailable(),
    unavailableReason:
      model.unavailableReason ??
      (model.available && !model.unitPrice
        ? model_card_price_version_missing()
        : undefined),
    usageLabel: usage
      ? model_card_usage({ available: usage.available, label: usage.label })
      : model_card_usage_unknown(),
  };
}

function ModelIllustration({
  model,
  preview,
}: {
  model: CatalogModelView;
  preview: Pick<
    ReturnType<typeof modelCardView>,
    'previewAlt' | 'previewLabel' | 'previewUrl'
  >;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const Icon =
    model.modality === 'image'
      ? IconPhoto
      : model.modality === 'video'
        ? IconMovie
        : IconSparkles;
  return (
    <div
      className={cn(
        'relative grid aspect-square size-20 shrink-0 place-items-center overflow-hidden rounded-lg border sm:size-24',
        !previewFailed
          ? 'bg-muted'
          : model.available
            ? 'bg-[radial-gradient(circle_at_25%_20%,color-mix(in_oklab,var(--primary)_30%,transparent),transparent_45%),linear-gradient(135deg,var(--muted),var(--background))]'
            : 'bg-muted'
      )}
    >
      {previewFailed ? (
        <Icon className="size-6 text-primary" aria-hidden="true" />
      ) : (
        <img
          alt={preview.previewAlt}
          className="size-full object-cover object-top"
          loading="lazy"
          onError={() => setPreviewFailed(true)}
          src={preview.previewUrl}
        />
      )}
      <span className="absolute inset-x-1 bottom-1 truncate rounded-sm bg-background/90 px-1.5 py-0.5 text-center text-xs leading-4 text-muted-foreground shadow-sm">
        {previewFailed
          ? model_card_preview_unavailable()
          : preview.previewLabel}
      </span>
    </div>
  );
}

export function ModelCardPicker({
  busy = false,
  disabled = false,
  models,
  onChange,
  selectedModelId,
  usage,
}: {
  busy?: boolean;
  disabled?: boolean;
  models: CatalogModelView[];
  onChange: (modelId: string) => void;
  selectedModelId: string;
  usage?: ModelCardUsage;
}) {
  const locked = disabled || busy;
  return (
    <RadioGroup
      aria-busy={busy}
      aria-label={model_card_group_aria()}
      className="grid gap-3 md:grid-cols-2"
      data-busy={busy ? 'true' : undefined}
      disabled={locked}
      onValueChange={(value) => {
        if (!locked) onChange(value);
      }}
      value={selectedModelId}
    >
      {models.map((model) => {
        const view = modelCardView(model, usage);
        return (
          <label
            aria-disabled={locked || !view.selectable}
            className={cn(
              'flex items-center gap-3 rounded-xl border bg-background p-3 transition-[border-color,box-shadow,background-color] focus-within:ring-2 focus-within:ring-ring/40',
              model.id === selectedModelId &&
                'border-primary bg-primary/[0.03] shadow-sm ring-2 ring-primary/15',
              !(locked || !view.selectable) &&
                'cursor-pointer hover:bg-muted/40',
              (locked || !view.selectable) && 'cursor-not-allowed opacity-70'
            )}
            htmlFor={`creative-model-${model.id}`}
            key={model.id}
          >
            <ModelIllustration model={model} preview={view} />
            <span className="flex min-w-0 flex-1 items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 truncate font-semibold">
                    {model.displayName}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        view.selectable
                          ? 'bg-emerald-500'
                          : model.available
                            ? 'bg-amber-400'
                            : 'bg-muted-foreground/35'
                      )}
                    />
                    {view.statusLabel}
                  </span>
                </span>
                {view.metaLabel ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {view.metaLabel}
                  </span>
                ) : null}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {view.capabilityLabel}
                </span>
                {view.channelReadinessLabel ? (
                  <span
                    className="mt-1 block text-xs font-medium text-foreground"
                    data-channel-readiness={model.channelReadiness}
                  >
                    {view.channelReadinessLabel}
                  </span>
                ) : null}
                <span className="mt-2 block text-xs">{view.usageLabel}</span>
                <span className="mt-1 block text-xs">{view.quoteLabel}</span>
                {view.unavailableReason ? (
                  <span className="mt-1 block text-xs text-destructive">
                    {view.unavailableReason}
                  </span>
                ) : null}
              </span>
              <RadioGroupItem
                aria-label={model.displayName}
                className="mt-1"
                disabled={locked || !view.selectable}
                id={`creative-model-${model.id}`}
                value={model.id}
              />
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
