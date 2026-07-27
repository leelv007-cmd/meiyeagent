import type {
  CreativeOperation,
  ImageIntent,
  ImageModelRecipeProfile,
  SupplyOperation,
} from '@meiye/contracts';
import {
  IMAGE_INTENT_SLOT_KINDS,
  imageIntentSchemaForProfile,
  imageModelRecipeProfileSchema,
} from '@meiye/contracts';

export const IMAGE_MODEL_RECIPE_PROFILE = imageModelRecipeProfileSchema.parse({
  id: 'seedream-image-v1',
  revision: 'seedream-image-v1-r1',
  operationMappings: {
    'image.generate': 'image.generate',
    'image.edit': 'image.edit',
    'image.reference_transform': 'image.edit',
  },
  slotRules: IMAGE_INTENT_SLOT_KINDS.map((slot) => ({
    slot,
    minItems: 0,
    maxItems: 4,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    maxBytesPerItem: 20 * 1024 * 1024,
    incompatibleWith: [],
    nativeField: 'image',
  })),
});

export const IMAGE_OPERATION_PROFILE = {
  operationMappings: IMAGE_MODEL_RECIPE_PROFILE.operationMappings,
} as const satisfies Pick<ImageModelRecipeProfile, 'operationMappings'>;

export function compileImageIntentForProfile(
  intentInput: ImageIntent,
  profileInput: ImageModelRecipeProfile = IMAGE_MODEL_RECIPE_PROFILE,
) {
  const profile = imageModelRecipeProfileSchema.parse(profileInput);
  const intent = imageIntentSchemaForProfile(profile).parse(intentInput);
  const rules = new Map(profile.slotRules.map((rule) => [rule.slot, rule]));
  return {
    inputAssets: intent.references.map((reference) => {
      const rule = rules.get(reference.slot);
      if (!rule) {
        throw new Error(`Image slot ${reference.slot} has no recipe rule.`);
      }
      return {
        assetId: reference.assetId,
        imageSlot: reference.slot,
        nativeField: rule.nativeField,
        role: 'reference_image' as const,
      };
    }),
    operation: profile.operationMappings[intent.operation],
    profile: {
      id: profile.id,
      revision: profile.revision,
    },
  };
}

export function selectImageIntentOperation(input: {
  referenceCount: number;
}): ImageIntent['operation'] {
  if (input.referenceCount === 0) return 'image.generate';
  if (input.referenceCount === 1) return 'image.edit';
  return 'image.reference_transform';
}

export function resolveImageIntentOperation(input: {
  creationMode: 'customized' | 'free';
  imageOperation?: ImageIntent['operation'];
  referenceCount: number;
}): ImageIntent['operation'] {
  const inferred = selectImageIntentOperation(input);
  if (input.creationMode === 'customized') {
    if (input.imageOperation !== undefined) {
      throw new Error(
        'A customized image submission cannot override the server-selected operation.',
      );
    }
    return inferred;
  }
  if (
    input.imageOperation !== undefined &&
    input.imageOperation !== inferred
  ) {
    throw new Error(
      `Image operation ${input.imageOperation} does not match ${input.referenceCount} source references.`,
    );
  }
  return input.imageOperation ?? inferred;
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
