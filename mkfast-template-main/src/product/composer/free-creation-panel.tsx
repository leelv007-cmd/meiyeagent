import type { CreationLensId } from '@meiye/contracts';

import type { CatalogModelView } from '@/p1/settings-view-model';
import { cn } from '@/lib/utils';

import {
  ComposerCreationModeSegment,
  type ComposerCreationMode,
} from './composer-conversation';
import type { ComposerGenerationParamsState } from './composer-generation-params';
import { ComposerGenerationParamsPanel } from './composer-generation-params-panel';
import { LensRadiogroup } from './lens-radiogroup';

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
  imageOperationSlot,
  lensId,
  models,
  onGenerationParamsChange,
  onLensChange,
  onModelChange,
  selectedModelId,
}: {
  catalogError: boolean;
  catalogLoading: boolean;
  className?: string;
  disabled: boolean;
  generationParams: ComposerGenerationParamsState;
  imageOperationSlot?: React.ReactNode;
  lensId: CreationLensId | null;
  models: CatalogModelView[];
  onGenerationParamsChange: (state: ComposerGenerationParamsState) => void;
  onLensChange: (lensId: CreationLensId) => void;
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
        <LensRadiogroup
          disabled={disabled}
          onChange={onLensChange}
          value={lensId}
        />
      </div>

      <div className="space-y-4">
        <label className="block space-y-2" htmlFor="composer-free-model-select">
          <span className="text-sm font-medium">本次使用的模型</span>
          <select
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="composer-free-model-select"
            disabled={
              disabled ||
              lensId == null ||
              catalogLoading ||
              catalogError ||
              availableModels.length === 0
            }
            id="composer-free-model-select"
            onChange={(event) => onModelChange(event.target.value || null)}
            value={selectedModelId ?? ''}
          >
            <option value="">选择模型</option>
            {availableModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
        {modelStatus ? (
          <output className="block text-xs text-muted-foreground">
            {modelStatus}
          </output>
        ) : null}
        {imageOperationSlot}
        <ComposerGenerationParamsPanel
          creationMode="free"
          disabled={disabled}
          onChange={onGenerationParamsChange}
          state={generationParams}
        />
      </div>
    </section>
  );
}
