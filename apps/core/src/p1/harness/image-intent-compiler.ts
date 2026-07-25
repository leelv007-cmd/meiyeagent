import type {
  CreativeOperation,
  ImageIntent,
  ImageModelRecipeProfile,
  SupplyOperation,
} from '@meiye/contracts';

export const IMAGE_OPERATION_PROFILE = {
  operationMappings: {
    'image.generate': 'image.generate',
    'image.edit': 'image.edit',
    'image.reference_transform': 'image.edit',
  },
} as const satisfies Pick<ImageModelRecipeProfile, 'operationMappings'>;

export function selectImageIntentOperation(input: {
  referenceCount: number;
}): ImageIntent['operation'] {
  if (input.referenceCount === 0) return 'image.generate';
  if (input.referenceCount === 1) return 'image.edit';
  return 'image.reference_transform';
}

export function nativeSupplyOperation(
  operation: CreativeOperation,
): SupplyOperation {
  if (
    operation === 'image.generate' ||
    operation === 'image.edit' ||
    operation === 'image.reference_transform'
  ) {
    return IMAGE_OPERATION_PROFILE.operationMappings[operation];
  }
  return operation;
}
