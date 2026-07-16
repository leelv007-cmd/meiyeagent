import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  common_more,
  creation_entry_all_scenes,
  creation_entry_change_pending,
  creation_entry_create,
  creation_entry_input_guide,
  creation_entry_intent_aria,
  creation_entry_intent_placeholder,
  creation_entry_method_describe,
  creation_entry_method_describe_hint,
  creation_entry_method_legend,
  creation_entry_mode_agent,
  creation_entry_mode_direct,
  creation_entry_mode_label,
  creation_entry_pending,
  creation_entry_pending_source_description,
  creation_entry_pending_tool_description,
  creation_entry_preset_input_hidden,
  creation_entry_preset_preview_alt,
  creation_entry_scene_legend,
  creation_entry_selected_preset,
  creation_entry_skip,
  creation_entry_source_legend,
  creation_entry_uploads_pending,
} from '@/locale/paraglide/messages';
import { getLocale } from '@/lib/locale';
import type { TemplateCatalogItemView } from '@/p1/types';
import type { ProductState } from '@meiye/contracts';
import {
  IconArrowRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconSparkles,
} from '@tabler/icons-react';
import { useRef, useState, type RefObject } from 'react';

import type { ComposerImageIdentity } from './composer-image-input';
import { ComposerImageInput } from './composer-image-input';
import {
  openingSuggestions,
  sceneChipGroups,
  sceneIntent,
  type ConfirmedAssetFacts,
  type SceneId,
} from './creation-entry-model';
import { ExampleStorePreview } from './example-store-preview';
import { useGlobalCommand } from './global-command-palette';
import { SceneVisualButton } from './scene-visual-button';

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

export function CreationEntry({
  assetSignals,
  createPending,
  example,
  exampleHideError,
  exampleHiding,
  intent,
  intentRef,
  mode,
  onCreate,
  onHideExample,
  onIntentChange,
  onModeChange,
  onPresetChange,
  onSkip,
  onSourceToggle,
  onUpload,
  onUploadAssetAdded,
  onUploadAssetRemoved,
  onUploadQueueChange,
  presets,
  selectedPresetId,
  selectedSourceKeys,
  sourceOptions,
  taskSignals,
  uploadsReady,
}: {
  assetSignals: Array<{ id: string; label: string }>;
  createPending: boolean;
  example?: ProductState['exampleStore'];
  exampleHideError?: string;
  exampleHiding: boolean;
  intent: string;
  intentRef: RefObject<HTMLTextAreaElement | null>;
  mode: 'agent' | 'direct';
  onCreate: () => void;
  onHideExample: () => void;
  onIntentChange: (intent: string) => void;
  onModeChange: (mode: 'agent' | 'direct') => void;
  onPresetChange: (presetId?: string) => void;
  onSkip: () => void;
  onSourceToggle: (key: string) => void;
  onUpload: (
    file: File,
    facts: ConfirmedAssetFacts,
    identity: ComposerImageIdentity
  ) => Promise<void>;
  onUploadAssetAdded: (assetId: string) => void;
  onUploadAssetRemoved: (assetId: string) => void;
  onUploadQueueChange: (
    uploads: Array<{ status: 'uploading' | 'ready' | 'failed' }>
  ) => void;
  presets: TemplateCatalogItemView[];
  selectedPresetId?: string;
  selectedSourceKeys: Set<string>;
  sourceOptions: SourceOption[];
  taskSignals: Array<{ id: string; title: string }>;
  uploadsReady: boolean;
}) {
  const [showMoreStarts, setShowMoreStarts] = useState(false);
  const [selectedGuidanceId, setSelectedGuidanceId] = useState<string>();
  const [selectedScene, setSelectedScene] = useState<SceneId>();
  const materialEntryRef = useRef<HTMLElement>(null);
  const { openPalette, pendingAction } = useGlobalCommand();
  const selectedPreset = presets.find(
    (preset) => preset.id === selectedPresetId
  );
  const sceneChips = sceneChipGroups(getLocale());
  const featuredPresets = FEATURED_PRESET_FAMILIES.flatMap((family) => {
    const preset = presets.find((item) => item.family === family);
    return preset ? [preset] : [];
  });
  const suggestions = openingSuggestions({
    assets: assetSignals,
    tasks: taskSignals,
  });

  const fillEditableIntent = (
    nextIntent: string,
    source: { guidanceId?: string; scene?: SceneId }
  ) => {
    onPresetChange(undefined);
    onIntentChange(nextIntent);
    setSelectedGuidanceId(source.guidanceId);
    setSelectedScene(source.scene);
    window.requestAnimationFrame(() => intentRef.current?.focus());
  };

  const createDisabled =
    createPending ||
    !uploadsReady ||
    (!selectedPreset && intent.trim().length < 2);

  return (
    <Card className="meiye-composer overflow-hidden border-0 p-0 shadow-none">
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

        <ComposerImageInput
          focusRef={materialEntryRef}
          onAssetAdded={onUploadAssetAdded}
          onAssetRemoved={onUploadAssetRemoved}
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
              className="min-h-28 resize-none rounded-2xl border-0 bg-transparent px-1 text-base leading-7 text-[oklch(0_0_0/0.9)] shadow-none placeholder:text-[oklch(0_0_0/0.6)] focus-visible:ring-2 focus-visible:ring-ring/30"
              onChange={(event) => onIntentChange(event.target.value)}
              placeholder={creation_entry_intent_placeholder()}
              ref={intentRef}
              rows={4}
              value={intent}
            />
          )}
        </ComposerImageInput>

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
              {creation_entry_create()}
              <IconArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="space-y-3 border-t border-[oklch(0_0_0/0.04)] pt-4">
          <fieldset className="min-w-0 space-y-2">
            <legend className="sr-only">{creation_entry_scene_legend()}</legend>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sceneChips.primary.map((scene) => (
                <Button
                  aria-pressed={selectedScene === scene.id}
                  className="shrink-0"
                  key={scene.id}
                  onClick={() =>
                    fillEditableIntent(sceneIntent(scene.id), {
                      scene: scene.id,
                    })
                  }
                  size="sm"
                  type="button"
                  variant={selectedScene === scene.id ? 'secondary' : 'outline'}
                >
                  {scene.label}
                </Button>
              ))}
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
                <legend className="text-sm font-semibold">
                  {creation_entry_all_scenes()}
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {sceneChips.expanded.map((scene) => (
                    <SceneVisualButton
                      className="w-full"
                      key={scene.id}
                      onSelect={() =>
                        fillEditableIntent(sceneIntent(scene.id), {
                          scene: scene.id,
                        })
                      }
                      scene={scene}
                      selected={selectedScene === scene.id}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-3">
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

        {example ? (
          <ExampleStorePreview
            example={example}
            hideError={exampleHideError}
            hiding={exampleHiding}
            onHide={onHideExample}
            onRemix={(nextIntent) =>
              fillEditableIntent(nextIntent, {
                guidanceId: `example:${example.id}`,
              })
            }
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
