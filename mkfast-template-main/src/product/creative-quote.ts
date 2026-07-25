import type {
  CatalogModelView,
  ModelOperation,
} from '@/p1/settings-view-model';
import type { CreativeOperation } from '@meiye/contracts';
import {
  creative_output_copy,
  creative_output_image,
  creative_output_video,
  p1_admin_model_operation_audio_sfx,
  p1_admin_model_operation_audio_speech,
  p1_admin_model_operation_copy,
  p1_admin_model_operation_image_edit,
  p1_admin_model_operation_image_generate,
  p1_admin_model_operation_image_reference_transform,
  p1_admin_model_operation_video,
  workbench_quote_usage_copy,
  workbench_quote_usage_image,
  workbench_quote_usage_video,
} from '@/locale/paraglide/messages';

const CREATIVE_OPERATION_LABELS: Record<CreativeOperation, () => string> = {
  'audio.sfx': p1_admin_model_operation_audio_sfx,
  'audio.speech': p1_admin_model_operation_audio_speech,
  'copy.adapt': p1_admin_model_operation_copy,
  'copy.generate': p1_admin_model_operation_copy,
  'image.edit': p1_admin_model_operation_image_edit,
  'image.generate': p1_admin_model_operation_image_generate,
  'image.reference_transform':
    p1_admin_model_operation_image_reference_transform,
  'video.generate': p1_admin_model_operation_video,
};

export function creativeOperationLabel(operation: CreativeOperation) {
  return CREATIVE_OPERATION_LABELS[operation]();
}

export function creativeOutputLabel(
  operation: CreativeOperation,
  count: number,
  aspectRatio?: string
) {
  if (operation.startsWith('copy.')) {
    return creative_output_copy({ count });
  }
  if (operation === 'video.generate') {
    return creative_output_video({ count });
  }
  return creative_output_image({
    aspectRatio: aspectRatio ?? '',
    count,
  });
}

/** Merchant-facing cost label: product allowance only, never provider USD/currency. */
export function merchantUsageQuoteLabel(operation: ModelOperation) {
  if (operation.startsWith('copy.')) {
    return workbench_quote_usage_copy();
  }
  if (operation === 'video.generate') {
    return workbench_quote_usage_video();
  }
  return workbench_quote_usage_image();
}

export function defaultAspectRatioForOperation(operation: ModelOperation) {
  if (operation === 'video.generate') return '9:16' as const;
  if (operation === 'image.generate' || operation === 'image.edit') {
    return '3:4' as const;
  }
  return undefined;
}

export function quoteFor(
  operation: ModelOperation,
  model: CatalogModelView | undefined,
  aspectRatio: '1:1' | '3:4' | '9:16'
) {
  const unitPrice = model?.unitPrice;
  const pricing = unitPrice
    ? {
        currency: unitPrice.currency,
        estimatedAmount: unitPrice.amountMicros / 1_000_000,
        priceRevision: unitPrice.revision,
        unit: unitPrice.unit,
      }
    : {};
  if (operation.startsWith('copy.')) {
    return {
      outputCount: 3,
      outputLabel: creativeOutputLabel(operation, 3),
      ...pricing,
      ...(unitPrice
        ? { estimatedAmount: (unitPrice.amountMicros * 3) / 1_000_000 }
        : {}),
    };
  }
  if (operation === 'video.generate') {
    return {
      outputCount: 1,
      outputLabel: creativeOutputLabel(operation, 1, aspectRatio),
      ...pricing,
    };
  }
  return {
    outputCount: 1,
    outputLabel: creativeOutputLabel(operation, 1, aspectRatio),
    ...pricing,
  };
}

export function creativeQuoteRevision(input: {
  aspectRatio: '1:1' | '3:4' | '9:16';
  catalogModelId: string;
  catalogRevision: string;
  operation: ModelOperation;
  priceRevision: string;
}) {
  return `${input.catalogRevision}:${input.priceRevision}:${input.catalogModelId}:${input.operation}:${input.operation.startsWith('copy.') ? 'text' : input.aspectRatio}`;
}
