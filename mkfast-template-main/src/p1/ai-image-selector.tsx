import {
  IconAlertCircle,
  IconBan,
  IconPhoto,
  IconPhotoPlus,
  IconRefresh,
  IconSparkles,
} from '@tabler/icons-react';

import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { m } from '@/locale/paraglide/messages';

import type {
  ImageGenerationJobView,
  ImageModelId,
  ImageModelOptionView,
} from './types';

const REQUIRED_IMAGE_MODELS: {
  id: ImageModelId;
  label: string;
  manufacturer: string;
}[] = [
  { id: 'gpt-image-2', label: 'GPT Image 2', manufacturer: 'OpenAI' },
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2',
    manufacturer: 'Google',
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    manufacturer: 'Google',
  },
  {
    id: 'seedream-5-pro',
    label: 'Seedream 5.0 Pro',
    manufacturer: m.p1_image_manufacturer_bytedance(),
  },
];

export interface AiImageSelectorProps {
  models: ImageModelOptionView[];
  selectedModelId?: ImageModelId;
  mode: 'generate' | 'edit';
  prompt: string;
  sourceAssetLabel?: string;
  job?: ImageGenerationJobView;
  pending?: boolean;
  onModelChange: (modelId: ImageModelId) => void;
  onModeChange: (mode: 'generate' | 'edit') => void;
  onPromptChange: (prompt: string) => void;
  onSubmit: () => void;
  onCancelJob?: (jobId: string) => void;
  onRetryJob?: (jobId: string) => void;
  onRefreshJob?: (jobId: string) => void;
  onInsertAsset?: (jobId: string) => void;
}

export function AiImageSelector({
  models,
  selectedModelId,
  mode,
  prompt,
  sourceAssetLabel,
  job,
  pending = false,
  onModelChange,
  onModeChange,
  onPromptChange,
  onSubmit,
  onCancelJob,
  onRetryJob,
  onRefreshJob,
  onInsertAsset,
}: AiImageSelectorProps) {
  const completeCatalog = REQUIRED_IMAGE_MODELS.map((requiredModel) => {
    const catalogModel = models.find((model) => model.id === requiredModel.id);
    return (
      catalogModel ?? {
        ...requiredModel,
        capabilityLabel: m.p1_image_catalog_unpublished(),
        estimatedUsageLabel: m.p1_image_pricing_pending(),
        available: false,
        unavailableReason: m.p1_image_catalog_model_missing(),
      }
    );
  });
  const selectedModel = completeCatalog.find(
    (model) => model.id === selectedModelId
  );
  const canSubmit =
    Boolean(selectedModel?.available) &&
    prompt.trim().length > 0 &&
    (mode === 'generate' || Boolean(sourceAssetLabel)) &&
    !pending;
  const jobRunning =
    job?.status === 'queued' ||
    job?.status === 'running' ||
    job?.status === 'cancel_requested' ||
    job?.status === 'waiting';

  return (
    <section aria-labelledby="p1-ai-image-title" className="space-y-4">
      <header>
        <div className="flex items-center gap-2">
          <IconSparkles className="size-5 text-primary" aria-hidden="true" />
          <h2 id="p1-ai-image-title" className="font-semibold">
            {m.p1_image_title()}
          </h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {m.p1_image_description()}
        </p>
      </header>

      <fieldset className="flex gap-2 border-0 p-0">
        <legend className="sr-only">{m.p1_image_mode_legend()}</legend>
        <Button
          type="button"
          size="sm"
          variant={mode === 'generate' ? 'default' : 'outline'}
          onClick={() => onModeChange('generate')}
        >
          <IconPhotoPlus aria-hidden="true" />
          {m.p1_image_mode_generate()}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'edit' ? 'default' : 'outline'}
          onClick={() => onModeChange('edit')}
        >
          <IconPhoto aria-hidden="true" />
          {m.p1_image_mode_edit()}
        </Button>
      </fieldset>

      <RadioGroup
        value={selectedModelId}
        onValueChange={(value) => onModelChange(value as ImageModelId)}
        className="grid gap-2 sm:grid-cols-2"
        aria-label={m.p1_image_model_aria()}
      >
        {completeCatalog.map((model) => (
          <label
            key={model.id}
            htmlFor={`p1-image-model-${model.id}`}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors',
              selectedModelId === model.id && 'border-primary bg-primary/5',
              !model.available && 'cursor-not-allowed opacity-65'
            )}
          >
            <RadioGroupItem
              id={`p1-image-model-${model.id}`}
              value={model.id}
              disabled={!model.available}
              aria-label={model.label}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{model.label}</span>
                {!model.available && (
                  <Badge variant="outline">{m.p1_image_not_active()}</Badge>
                )}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {model.manufacturer} · {model.capabilityLabel}
              </span>
              <span className="mt-1 block text-xs">
                {m.p1_image_estimated_usage({
                  usage: model.estimatedUsageLabel,
                })}
              </span>
              {!model.available && model.unavailableReason && (
                <span className="mt-1 block text-xs text-destructive">
                  {model.unavailableReason}
                </span>
              )}
            </span>
          </label>
        ))}
      </RadioGroup>

      {mode === 'edit' && !sourceAssetLabel && (
        <Alert variant="destructive">
          <IconAlertCircle aria-hidden="true" />
          <AlertTitle>{m.p1_image_source_required_title()}</AlertTitle>
          <AlertDescription>
            {m.p1_image_source_required_description()}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <label htmlFor="p1-ai-image-prompt" className="text-sm font-medium">
          {mode === 'generate'
            ? m.p1_image_prompt_generate()
            : m.p1_image_prompt_edit()}
        </label>
        {sourceAssetLabel && mode === 'edit' && (
          <p className="text-xs text-muted-foreground">
            {m.p1_image_source_label({ source: sourceAssetLabel })}
          </p>
        )}
        <Textarea
          id="p1-ai-image-prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={
            mode === 'generate'
              ? m.p1_image_prompt_generate_placeholder()
              : m.p1_image_prompt_edit_placeholder()
          }
          disabled={jobRunning}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {m.p1_image_fixed_model_note()}
        </p>
        <Button
          type="button"
          disabled={!canSubmit || jobRunning}
          onClick={onSubmit}
        >
          <IconSparkles aria-hidden="true" />
          {mode === 'generate'
            ? m.p1_image_submit_generate()
            : m.p1_image_submit_edit()}
        </Button>
      </div>

      {job && (
        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{job.statusLabel}</p>
              <p className="text-xs text-muted-foreground">
                {m.p1_image_job_id({ id: job.id })}
                {job.actualModelLabel
                  ? m.p1_image_job_actual_model({
                      model: job.actualModelLabel,
                    })
                  : ''}
              </p>
            </div>
            <Badge variant="outline">{job.status}</Badge>
          </div>
          {job.errorMessage && (
            <p className="mt-2 text-sm text-destructive">
              {m.p1_image_job_error_description()}
            </p>
          )}
          {job.assetUrl && (
            <img
              src={job.assetUrl}
              alt={m.p1_image_result_alt()}
              className="mt-3 max-h-72 w-full rounded-lg bg-background object-contain"
            />
          )}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {jobRunning && onRefreshJob && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onRefreshJob(job.id)}
              >
                <IconRefresh aria-hidden="true" />
                {m.p1_image_refresh_status()}
              </Button>
            )}
            {jobRunning && onCancelJob && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onCancelJob(job.id)}
              >
                <IconBan aria-hidden="true" />
                {m.p1_image_cancel_job()}
              </Button>
            )}
            {job.status === 'failed' && onRetryJob && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onRetryJob(job.id)}
              >
                <IconRefresh aria-hidden="true" />
                {m.p1_image_retry_same_model()}
              </Button>
            )}
            {job.status === 'completed' && job.assetUrl && onInsertAsset && (
              <Button
                type="button"
                size="sm"
                onClick={() => onInsertAsset(job.id)}
              >
                <IconPhotoPlus aria-hidden="true" />
                {m.p1_image_insert_canvas()}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
