import {
  IconArrowRight,
  IconCheck,
  IconFileText,
  IconSparkles,
  IconVideo,
} from '@tabler/icons-react';
import { useRef, useState, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  common_more,
  creation_entry_change_pending,
  creation_entry_guidance_title,
  creation_entry_input_guide,
  creation_entry_intent_aria,
  creation_entry_intent_placeholder,
  creation_entry_method_describe,
  creation_entry_method_describe_hint,
  creation_entry_method_legend,
  creation_entry_marketing_brand_ip,
  creation_entry_marketing_hot_topic,
  creation_entry_marketing_legend,
  creation_entry_marketing_project_exposure,
  creation_entry_marketing_promotion_conversion,
  creation_entry_marketing_promotional_material,
  creation_entry_mode_agent,
  creation_entry_mode_direct,
  creation_entry_mode_label,
  creation_entry_pending,
  creation_entry_pending_source_description,
  creation_entry_pending_tool_description,
  creation_entry_preset_input_hidden,
  creation_entry_preset_preview_alt,
  creation_entry_selected_preset,
  creation_entry_skip,
  creation_entry_source_legend,
  creation_entry_submit,
  creation_entry_uploads_pending,
  workbench_create_image_text,
  workbench_create_video,
  workbench_quick_start_legend,
} from '@/locale/paraglide/messages';
import type { TemplateCatalogItemView } from '@/p1/types';
import type {
  AssetIntakeBatch,
  PrepareAssistedPriceIntakeCommand,
  StoreFact,
} from '@meiye/contracts';
import {
  marketingEntryContext,
  releasedMarketingEntries,
  type MarketingEntryCapabilities,
  type MarketingEntryId,
} from '@/product/marketing-entry-model';
import type {
  ComposerImageIdentity,
  ComposerImageUploadResult,
} from '@/product/composer-image-input';
import { ComposerImageInput } from '@/product/composer-image-input';
import { AssistedAssetIntake } from '@/product/assisted-asset-intake';
import {
  isComposerSubmitShortcut,
  openingSuggestions,
  type ConfirmedAssetFacts,
} from '@/product/creation-entry-model';
import { useGlobalCommand } from '@/product/global-command-palette';

interface SourceOption {
  id: string;
  kind: 'task' | 'asset';
  label: string;
}

const PRESET_SEED_PREVIEW_BY_FAMILY: Record<string, string | undefined> = {
  before_after: '/seed/preset/preset-before-after.webp',
  package_explainer: '/seed/preset/preset-package-flatlay.webp',
  price_card: '/seed/preset/preset-price-card.webp',
};

const FEATURED_PRESET_FAMILIES = [
  'before_after',
  'package_explainer',
  'price_card',
] as const;

const MARKETING_ENTRY_LABELS: Record<MarketingEntryId, () => string> = {
  brand_ip: creation_entry_marketing_brand_ip,
  hot_topic: creation_entry_marketing_hot_topic,
  project_exposure: creation_entry_marketing_project_exposure,
  promotion_conversion: creation_entry_marketing_promotion_conversion,
  promotional_material: creation_entry_marketing_promotional_material,
};

export function MarketingEntryContextPicker({
  onSelectEntry,
  releasedEntries,
  selectedMarketingEntry,
}: {
  onSelectEntry: (context: ReturnType<typeof marketingEntryContext>) => void;
  /** @deprecated Z1: scene secondary chips retired with scene-visual-button. */
  onSelectScene?: (sceneId: string) => void;
  releasedEntries: MarketingEntryId[];
  selectedMarketingEntry?: MarketingEntryId;
  /** @deprecated Z1: scene secondary chips retired. */
  selectedScene?: string;
}) {
  // Z1/#105: T6 scene-chip-groups / scene-visual-button retired — marketing entry
  // chips remain; secondary scene strip removed.
  return (
    <>
      {releasedEntries.length > 0 ? (
        <fieldset className="min-w-0 space-y-2">
          <legend className="sr-only">
            {creation_entry_marketing_legend()}
          </legend>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {releasedEntries.map((entryId) => (
              <Button
                aria-pressed={selectedMarketingEntry === entryId}
                className="shrink-0"
                key={entryId}
                onClick={() => onSelectEntry(marketingEntryContext(entryId))}
                size="sm"
                type="button"
                variant={
                  selectedMarketingEntry === entryId ? 'secondary' : 'outline'
                }
              >
                {MARKETING_ENTRY_LABELS[entryId]()}
              </Button>
            ))}
          </div>
        </fieldset>
      ) : null}
    </>
  );
}

export type CreationModeOperation = 'copy.generate' | 'video.generate';

export function CreationModePicker({
  disabled,
  onChange,
  operation,
}: {
  disabled: boolean;
  onChange: (operation: CreationModeOperation) => void;
  operation: CreationModeOperation;
}) {
  const options = [
    {
      icon: IconFileText,
      label: workbench_create_image_text,
      operation: 'copy.generate' as const,
    },
    {
      icon: IconVideo,
      label: workbench_create_video,
      operation: 'video.generate' as const,
    },
  ];
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{workbench_quick_start_legend()}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <Button
              aria-pressed={operation === option.operation}
              className="rounded-full"
              disabled={disabled}
              key={option.operation}
              onClick={() => onChange(option.operation)}
              size="sm"
              type="button"
              variant={operation === option.operation ? 'secondary' : 'outline'}
            >
              <Icon aria-hidden="true" />
              {option.label()}
            </Button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CreationEntry({
  assetSignals,
  createPending,
  intent,
  intentRef,
  marketingEntryCapabilities = {},
  mode,
  operation,
  onCreate,
  onIntentChange,
  onModeChange,
  onOperationChange,
  onPresetChange,
  onSkip,
  onSourceToggle,
  onUpload,
  onUploadAuthorize,
  onUploadAssetAdded,
  onUploadAssetRemoved,
  onUploadQueueChange,
  onPrepareAssistedPriceIntake,
  onConfirmAssistedFact,
  presets,
  quotaBlocked = false,
  quotaLine,
  assistedScreenshotAssetIds,
  assistedStoreId,
  selectedPresetId,
  selectedSourceKeys,
  sourceOptions,
  taskSignals,
  uploadsReady,
}: {
  assetSignals: Array<{ id: string; label: string }>;
  createPending: boolean;
  intent: string;
  intentRef: RefObject<HTMLTextAreaElement | null>;
  marketingEntryCapabilities?: MarketingEntryCapabilities;
  mode: 'agent' | 'direct';
  operation: CreationModeOperation;
  onCreate: () => void;
  onIntentChange: (intent: string) => void;
  onModeChange: (mode: 'agent' | 'direct') => void;
  onOperationChange: (operation: CreationModeOperation) => void;
  onPresetChange: (presetId?: string) => void;
  onSkip: () => void;
  onSourceToggle: (key: string) => void;
  onUpload: (
    file: File,
    facts: ConfirmedAssetFacts,
    identity: ComposerImageIdentity
  ) => Promise<ComposerImageUploadResult>;
  onUploadAuthorize: (
    assetId: string,
    facts: ConfirmedAssetFacts
  ) => Promise<void>;
  onUploadAssetAdded: (assetId: string) => void;
  onUploadAssetRemoved: (assetId: string) => void;
  onUploadQueueChange: (
    uploads: Array<{ status: 'uploading' | 'ready' | 'failed' }>
  ) => void;
  onPrepareAssistedPriceIntake: (
    input: PrepareAssistedPriceIntakeCommand
  ) => Promise<AssetIntakeBatch>;
  onConfirmAssistedFact: (input: {
    batchId: string;
    candidateId: string;
    factId: string;
    expectedFactRevision: number;
  }) => Promise<StoreFact>;
  assistedScreenshotAssetIds: string[];
  assistedStoreId: string;
  presets: TemplateCatalogItemView[];
  quotaBlocked?: boolean;
  quotaLine?: string;
  selectedPresetId?: string;
  selectedSourceKeys: Set<string>;
  sourceOptions: SourceOption[];
  taskSignals: Array<{ id: string; title: string }>;
  uploadsReady: boolean;
}) {
  const [showMoreStarts, setShowMoreStarts] = useState(false);
  const [selectedGuidanceId, setSelectedGuidanceId] = useState<string>();
  const [selectedMarketingEntry, setSelectedMarketingEntry] =
    useState<MarketingEntryId>();
  const materialEntryRef = useRef<HTMLElement>(null);
  const { openPalette, pendingAction } = useGlobalCommand();
  const selectedPreset = presets.find(
    (preset) => preset.id === selectedPresetId
  );
  const releasedEntries = releasedMarketingEntries(marketingEntryCapabilities);
  const selectedMarketingContext = selectedMarketingEntry
    ? marketingEntryContext(selectedMarketingEntry)
    : undefined;
  const activePresetFamilies = selectedMarketingContext?.presetFamilies ?? [
    ...FEATURED_PRESET_FAMILIES,
  ];
  const featuredPresets = activePresetFamilies.flatMap((family) => {
    const preset = presets.find((item) => item.family === family);
    return preset ? [preset] : [];
  });
  const suggestions = openingSuggestions({
    assets: assetSignals,
    tasks: taskSignals,
  });

  const fillEditableIntent = (
    nextIntent: string,
    source: {
      guidanceId?: string;
      marketingEntry?: MarketingEntryId;
    }
  ) => {
    onPresetChange(undefined);
    onIntentChange(nextIntent);
    setSelectedGuidanceId(source.guidanceId);
    setSelectedMarketingEntry(source.marketingEntry);
    window.requestAnimationFrame(() => intentRef.current?.focus());
  };

  const createDisabled =
    createPending ||
    quotaBlocked ||
    !uploadsReady ||
    (!selectedPreset && intent.trim().length < 2);

  return (
    <Card className="meiye-composer meiye-entry-card overflow-hidden border-0 p-0 shadow-none">
      <CardContent className="space-y-4 px-5 pt-5 pb-5 sm:px-6 sm:pt-6 sm:pb-6">
        {pendingAction ? (
          <div
            aria-live="polite"
            className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-muted/80 p-3 text-sm"
          >
            <div>
              <p className="font-medium">
                {creation_entry_pending({ label: pendingAction.label })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pendingAction.kind === 'tool'
                  ? creation_entry_pending_tool_description()
                  : creation_entry_pending_source_description()}
              </p>
            </div>
            <Button
              onClick={openPalette}
              size="sm"
              type="button"
              variant="outline"
            >
              {creation_entry_change_pending()}
            </Button>
          </div>
        ) : null}

        <CreationModePicker
          disabled={createPending}
          onChange={onOperationChange}
          operation={operation}
        />

        <ComposerImageInput
          focusRef={materialEntryRef}
          onAssetAdded={onUploadAssetAdded}
          onAssetRemoved={onUploadAssetRemoved}
          onAuthorize={onUploadAuthorize}
          onQueueChange={onUploadQueueChange}
          onUpload={onUpload}
        >
          {selectedPreset ? (
            <div aria-live="polite" className="rounded-2xl bg-muted p-4">
              <p className="font-semibold">
                {creation_entry_selected_preset({
                  name: selectedPreset.name,
                })}
              </p>
              <p className="mt-2 text-sm">
                {creation_entry_input_guide({
                  guide: selectedPreset.inputGuide ?? '',
                })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {creation_entry_preset_input_hidden()}
              </p>
            </div>
          ) : (
            <Textarea
              aria-label={creation_entry_intent_aria()}
              className="min-h-28 resize-none rounded-2xl border-0 bg-transparent px-1 text-base leading-7 text-[var(--ink-90)] shadow-none placeholder:text-[var(--ink-60)] focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onChange={(event) => onIntentChange(event.target.value)}
              onKeyDown={(event) => {
                if (isComposerSubmitShortcut(event) && !createDisabled) {
                  event.preventDefault();
                  onCreate();
                }
              }}
              placeholder={creation_entry_intent_placeholder()}
              ref={intentRef}
              rows={4}
              value={intent}
            />
          )}
        </ComposerImageInput>

        <AssistedAssetIntake
          autoOpen={/https?:\/\//iu.test(intent)}
          onConfirm={onConfirmAssistedFact}
          onPrepare={onPrepareAssistedPriceIntake}
          screenshotAssetIds={assistedScreenshotAssetIds}
          storeId={assistedStoreId}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            className="px-0 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={onSkip}
            type="button"
            variant="ghost"
          >
            {creation_entry_skip()}
          </Button>
          <div className="text-right">
            {quotaLine ? (
              <p
                className={
                  quotaBlocked
                    ? 'mb-2 text-xs text-destructive'
                    : 'mb-2 text-xs text-muted-foreground'
                }
                data-testid="creation-entry-quota-line"
              >
                {quotaLine}
              </p>
            ) : null}
            {!uploadsReady ? (
              <p className="mb-2 text-xs text-destructive">
                {creation_entry_uploads_pending()}
              </p>
            ) : null}
            <Button
              className="h-11 min-w-11 rounded-full px-5"
              disabled={createDisabled}
              onClick={onCreate}
              type="button"
            >
              {creation_entry_submit()}
              <IconArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="space-y-3 border-t border-[oklch(0_0_0/0.04)] pt-4">
          <MarketingEntryContextPicker
            onSelectEntry={(context) =>
              fillEditableIntent(context.intent, {
                marketingEntry: context.entryId,
              })
            }
            releasedEntries={releasedEntries}
            selectedMarketingEntry={selectedMarketingEntry}
          />

          <fieldset className="min-w-0 space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">
              {creation_entry_guidance_title()}
            </legend>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {suggestions.map((suggestion) => (
                <Button
                  aria-pressed={selectedGuidanceId === suggestion.id}
                  className="shrink-0"
                  key={suggestion.id}
                  onClick={() =>
                    fillEditableIntent(suggestion.intent, {
                      guidanceId: suggestion.id,
                    })
                  }
                  size="sm"
                  type="button"
                  variant={
                    selectedGuidanceId === suggestion.id
                      ? 'secondary'
                      : 'outline'
                  }
                >
                  {suggestion.label}
                </Button>
              ))}
              <Button
                aria-expanded={showMoreStarts}
                className="shrink-0"
                onClick={() => setShowMoreStarts((current) => !current)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {common_more()}
                {showMoreStarts ? (
                  <IconChevronUp aria-hidden="true" />
                ) : (
                  <IconChevronDown aria-hidden="true" />
                )}
              </Button>
            </div>
          </fieldset>

          {showMoreStarts ? (
            <div className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="meiye-type-body font-semibold">
                  {creation_entry_method_legend()}
                </legend>
                <Button
                  aria-pressed={!selectedPresetId}
                  className="h-auto w-full items-center justify-start gap-3 rounded-2xl px-3 py-2.5 text-left whitespace-normal"
                  onClick={() => onPresetChange(undefined)}
                  type="button"
                  variant={!selectedPresetId ? 'secondary' : 'outline'}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                    <IconSparkles aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {creation_entry_method_describe()}
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {creation_entry_method_describe_hint()}
                    </span>
                  </span>
                  {!selectedPresetId ? (
                    <IconCheck
                      aria-hidden="true"
                      className="ml-auto shrink-0"
                    />
                  ) : null}
                </Button>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {featuredPresets.map((preset) => {
                    const previewUrl =
                      PRESET_SEED_PREVIEW_BY_FAMILY[preset.family];
                    const presetSelected = selectedPresetId === preset.id;
                    return (
                      <Button
                        aria-pressed={presetSelected}
                        className="h-auto flex-col items-stretch justify-start gap-0 overflow-hidden rounded-2xl p-0 text-left whitespace-normal"
                        key={preset.id}
                        onClick={() => {
                          setSelectedGuidanceId(undefined);
                          setSelectedScene(undefined);
                          onPresetChange(preset.id);
                          window.requestAnimationFrame(() =>
                            materialEntryRef.current?.focus()
                          );
                        }}
                        type="button"
                        variant={presetSelected ? 'secondary' : 'outline'}
                      >
                        {previewUrl ? (
                          <img
                            alt={creation_entry_preset_preview_alt({
                              name: preset.name,
                            })}
                            className="aspect-[16/10] w-full object-cover"
                            loading="lazy"
                            src={previewUrl}
                          />
                        ) : (
                          <span className="grid aspect-[16/10] w-full place-items-center bg-muted">
                            <IconSparkles
                              aria-hidden="true"
                              className="size-7"
                            />
                          </span>
                        )}
                        <span className="flex flex-col gap-0.5 px-3 py-2.5">
                          <span className="flex items-center gap-1.5 font-semibold">
                            {presetSelected ? (
                              <IconCheck
                                aria-hidden="true"
                                className="size-4 shrink-0"
                              />
                            ) : null}
                            <span className="min-w-0">{preset.name}</span>
                          </span>
                          <span className="text-xs font-normal text-muted-foreground">
                            {creation_entry_input_guide({
                              guide: preset.inputGuide ?? '',
                            })}
                          </span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </fieldset>

              {sourceOptions.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="meiye-type-body font-semibold">
                    {creation_entry_source_legend()}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {sourceOptions.map((source) => {
                      const key = `${source.kind}:${source.id}`;
                      const selected = selectedSourceKeys.has(key);
                      return (
                        <Button
                          aria-pressed={selected}
                          key={key}
                          onClick={() => onSourceToggle(key)}
                          size="sm"
                          type="button"
                          variant={selected ? 'secondary' : 'outline'}
                        >
                          {selected ? <IconCheck aria-hidden="true" /> : null}
                          {source.label}
                        </Button>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {creation_entry_mode_label()}
                </span>
                <div className="flex rounded-full bg-muted p-1">
                  {(['agent', 'direct'] as const).map((item) => (
                    <Button
                      aria-pressed={mode === item}
                      key={item}
                      onClick={() => onModeChange(item)}
                      size="sm"
                      type="button"
                      variant={mode === item ? 'secondary' : 'ghost'}
                    >
                      {item === 'agent'
                        ? creation_entry_mode_agent()
                        : creation_entry_mode_direct()}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
