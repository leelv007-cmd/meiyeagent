import type { CreationLensId } from '@meiye/contracts';

import type { CatalogModelView } from '@/p1/settings-view-model';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  ComposerCreationModeSegment,
  type ComposerCreationMode,
} from './composer-conversation';
import type { ComposerGenerationParamsState } from './composer-generation-params';
import { ComposerGenerationParamsPanel } from './composer-generation-params-panel';

/** First executable catalog model for free mode; keeps a still-valid current pick. */
export function resolveFreeCatalogModelId(
  models: readonly CatalogModelView[],
  currentId: string | null
): string | null {
  const available = models.filter(
    (model) => model.available && Boolean(model.unitPrice)
  );
  if (available.length === 0) return null;
  if (currentId && available.some((model) => model.id === currentId)) {
    return currentId;
  }
  return available[0]?.id ?? null;
}

export function ComposerCreationModeSurface({
  creationMode,
  freePanel,
  onCreationModeChange,
}: {
  creationMode: ComposerCreationMode;
  freePanel: React.ReactNode;
  onCreationModeChange: (mode: ComposerCreationMode) => void;
}) {
  return (
    <div data-creation-mode={creationMode} data-testid="creation-mode-surface">
      <ComposerCreationModeSegment
        creationMode={creationMode}
        onCreationModeChange={onCreationModeChange}
      />
      {creationMode === 'free' ? freePanel : null}
    </div>
  );
}

export function FreeCreationPanel({
  catalogError,
  catalogLoading,
  className,
  disabled,
  generationParams,
  generationParamsEnabled,
  imageOperationSlot,
  lensId,
  models,
  onGenerationParamsChange,
  onModelChange,
  selectedModelId,
}: {
  catalogError: boolean;
  catalogLoading: boolean;
  className?: string;
  disabled: boolean;
  generationParams: ComposerGenerationParamsState;
  /**
   * P2-09 belongs to the XHS image-text note route. Home resolves the same
   * `isComposerGenerationParamsSupported` probe it signs the submission with,
   * so the control cannot be shown on a route that would drop its value.
   */
  generationParamsEnabled: boolean;
  imageOperationSlot?: React.ReactNode;
  lensId: CreationLensId | null;
  models: CatalogModelView[];
  onGenerationParamsChange: (state: ComposerGenerationParamsState) => void;
  onModelChange: (modelId: string | null) => void;
  selectedModelId: string | null;
}) {
  const availableModels = models.filter(
    (model) => model.available && model.unitPrice
  );
  const modelStatus = catalogError
    ? '模型目录暂时不可用'
    : lensId == null
      ? '先选择输出类型'
      : catalogLoading
        ? '正在读取模型…'
        : availableModels.length === 0
          ? '当前输出类型暂无可用模型'
          : null;

  return (
    <section
      aria-labelledby="composer-free-creation-title"
      className={cn(
        'mt-4 grid gap-5 border-y border-foreground/10 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.8fr)]',
        className
      )}
      data-testid="composer-free-creation-panel"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            className="text-base font-semibold"
            id="composer-free-creation-title"
          >
            自由创作
          </h2>
          <span className="rounded-full border border-foreground/15 px-2 py-0.5 text-xs text-muted-foreground">
            模型直出
          </span>
        </div>
        {/*
          Output type stays in the bottom capsule for both modes (spec 2.4).
          A second radiogroup here would duplicate the lens control, its DOM id
          and its radio group name on one screen.
        */}
      </div>

      <div className="space-y-4">
        <label className="block space-y-2" htmlFor="composer-free-model-select">
          <span className="text-sm font-medium">本次使用的模型</span>
          <Select
            disabled={
              disabled ||
              lensId == null ||
              catalogLoading ||
              catalogError ||
              availableModels.length === 0
            }
            onValueChange={(value) => onModelChange(value || null)}
            value={selectedModelId ?? null}
          >
            <SelectTrigger
              className="min-h-11 w-full"
              data-selected-model={selectedModelId ?? ''}
              data-testid="composer-free-model-select"
              id="composer-free-model-select"
            >
              <SelectValue placeholder="选择模型" />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((model) => (
                <SelectItem
                  data-model-id={model.id}
                  key={model.id}
                  value={model.id}
                >
                  {model.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {modelStatus ? (
          <output className="block text-xs text-muted-foreground">
            {modelStatus}
          </output>
        ) : null}
        {imageOperationSlot}
        {generationParamsEnabled ? (
          <ComposerGenerationParamsPanel
            creationMode="free"
            disabled={disabled}
            onChange={onGenerationParamsChange}
            state={generationParams}
          />
        ) : null}
      </div>
    </section>
  );
}
