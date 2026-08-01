import type { ImageIntent } from '@meiye/contracts';

import { Button } from '@/components/ui/button';

export type ComposerImageOperation = ImageIntent['operation'];

export function imageOperationSourceCount(input: {
  sourceAssetIds: readonly string[];
  styleReferenceAssetIds: readonly string[];
}): number {
  const styleReferences = new Set(input.styleReferenceAssetIds);
  return input.sourceAssetIds.filter((id) => !styleReferences.has(id)).length;
}

const IMAGE_OPERATION_ENTRIES: ReadonlyArray<{
  label: string;
  operation: ComposerImageOperation;
}> = [
  { label: '生成新图', operation: 'image.generate' },
  { label: '修改这张图', operation: 'image.edit' },
  {
    label: '用几张图合成一张',
    operation: 'image.reference_transform',
  },
];

export function imageOperationCardinality(
  operation: ComposerImageOperation,
  sourceCount: number
): { message: string | null; valid: boolean } {
  if (operation === 'image.generate') {
    return sourceCount === 0
      ? { message: null, valid: true }
      : { message: '生成新图不需要附件，请先移除已上传图片。', valid: false };
  }
  if (operation === 'image.edit') {
    return sourceCount === 1
      ? { message: null, valid: true }
      : { message: '修改这张图需要正好上传 1 张图片。', valid: false };
  }
  return sourceCount >= 2
    ? { message: null, valid: true }
    : { message: '用几张图合成一张需要至少上传 2 张图片。', valid: false };
}

export function imageOperationAttachmentHint(
  operation: ComposerImageOperation
): string {
  if (operation === 'image.generate') return '生成新图需要 0 张附件';
  if (operation === 'image.edit') return '请上传 1 张要修改的图片';
  return '请上传至少 2 张要合成的参考图片';
}

export function ComposerImageOperationPicker({
  disabled = false,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (operation: ComposerImageOperation) => void;
  value: ComposerImageOperation;
}) {
  return (
    <fieldset
      className="space-y-2"
      data-testid="composer-image-operation-picker"
      tabIndex={-1}
    >
      <legend className="text-sm font-medium">图片任务</legend>
      <div className="flex flex-wrap gap-2">
        {IMAGE_OPERATION_ENTRIES.map((entry) => (
          <Button
            aria-pressed={value === entry.operation}
            data-testid={`composer-image-operation-${entry.operation}`}
            disabled={disabled}
            key={entry.operation}
            onClick={() => onChange(entry.operation)}
            size="sm"
            type="button"
            variant={value === entry.operation ? 'secondary' : 'outline'}
          >
            {entry.label}
          </Button>
        ))}
      </div>
    </fieldset>
  );
}
