import {
  MAX_NOTE_PLAN_PAGE_COUNT,
  MIN_NOTE_PLAN_PAGE_COUNT,
  type ComposerSubmissionSignedFields,
  composerSubmissionSignedFieldsSchema,
  creativeContentModuleIds,
  isComposerVariantPlatform,
} from '@meiye/contracts';

import type { ServerRecipeRecord } from './types.js';

export type ComposerRecipeBinding = {
  contentModules: (typeof creativeContentModuleIds)[number][];
  contentPackagePlatform: ComposerSubmissionSignedFields['contentPackagePlatform'];
  deliverable: ComposerSubmissionSignedFields['deliverable'];
  distributionTarget: ComposerSubmissionSignedFields['distributionTarget'];
  lens: 'copy' | 'image' | 'image_text_note' | 'video';
  notePageBound?: number;
};

export function validateRecipeForComposer(
  recipe: Pick<
    ServerRecipeRecord,
    | 'contextPatches'
    | 'delivery'
    | 'lensId'
    | 'modelPolicy'
    | 'presentation'
    | 'promptRevisionRef'
    | 'targetWorkspaceKind'
  >,
  signedFields?: ComposerSubmissionSignedFields,
): { errors: string[]; binding?: ComposerRecipeBinding } {
  const errors: string[] = [];
  if (!recipe.presentation.title.trim()) {
    errors.push('presentation.title is required');
  }
  if (!recipe.presentation.summary.trim()) {
    errors.push('presentation.summary is required');
  }
  if (!recipe.promptRevisionRef.trim()) {
    errors.push('promptRevisionRef is required');
  }
  const deliveryKind =
    signedFields?.deliverable.kind ?? recipe.delivery.deliverableKind;
  const lens =
    recipe.lensId === 'copy'
      ? ('copy' as const)
      : recipe.lensId === 'image_text'
        ? deliveryKind === 'note' || deliveryKind === 'image_text_package'
          ? ('image_text_note' as const)
          : ('image' as const)
        : recipe.lensId === 'video'
          ? ('video' as const)
          : null;
  if (!lens || recipe.targetWorkspaceKind !== recipe.lensId) {
    errors.push('recipe lens and target workspace must match a Composer modality');
  }
  if (
    recipe.modelPolicy.mode === 'fixed' &&
    !recipe.modelPolicy.catalogModelId?.trim()
  ) {
    errors.push('fixed modelPolicy requires catalogModelId');
  }

  const candidate = signedFields ?? {
    catalogModel: { id: 'catalog-validation', revision: 'catalog-validation' },
    recipe: { id: 'recipe-validation', revision: 'recipe-validation' },
    contentPackagePlatform: recipe.delivery.contentPackagePlatform,
    distributionTarget: recipe.delivery.distributionTarget,
    deliverable: {
      kind: recipe.delivery.deliverableKind,
      quantity: recipe.delivery.quantity,
      ...(recipe.delivery.aspectRatio
        ? { aspectRatio: recipe.delivery.aspectRatio }
        : {}),
      ...(recipe.delivery.durationSeconds
        ? { durationSeconds: recipe.delivery.durationSeconds }
        : {}),
      ...(recipe.delivery.notePageBound
        ? { notePageBound: recipe.delivery.notePageBound }
        : {}),
    },
  };
  const parsed = composerSubmissionSignedFieldsSchema.safeParse(candidate);
  if (!parsed.success) {
    errors.push(
      ...parsed.error.issues.map(
        (issue) => `${issue.path.join('.')} ${issue.message}`,
      ),
    );
    return { errors };
  }
  if (signedFields) {
    if (
      signedFields.recipe.id === '' ||
      signedFields.catalogModel.id === ''
    ) {
      errors.push('signed recipe and catalog model references are required');
    }
    if (
      recipe.delivery.deliverableKind &&
      signedFields.deliverable.kind !== recipe.delivery.deliverableKind
    ) {
      errors.push('deliverable.kind must match the published Recipe');
    }
  }

  const { contentPackagePlatform, distributionTarget, deliverable } =
    parsed.data;
  if (distributionTarget.startsWith('publish:')) {
    const publishPlatform = distributionTarget.slice('publish:'.length);
    if (
      !isComposerVariantPlatform(contentPackagePlatform) ||
      publishPlatform !== contentPackagePlatform
    ) {
      errors.push(
        'publish distribution requires the matching supported variant platform',
      );
    }
  }
  if (
    contentPackagePlatform === 'wechat_moments' &&
    distributionTarget !== 'export' &&
    distributionTarget !== 'manual_copy' &&
    distributionTarget !== 'assisted_handoff'
  ) {
    errors.push('wechat_moments supports export or assisted delivery only');
  }
  if (
    (contentPackagePlatform === 'offline_material' ||
      contentPackagePlatform === 'generic') &&
    distributionTarget.startsWith('publish:')
  ) {
    errors.push('offline_material and generic cannot use publish delivery');
  }
  if (lens && deliverableLens(deliverable.kind) !== lens) {
    errors.push('deliverable.kind must match the Recipe modality');
  }
  if (
    (lens === 'image' || lens === 'image_text_note' || lens === 'video') &&
    !deliverable.aspectRatio
  ) {
    errors.push('media deliverables require aspectRatio');
  }
  if (lens === 'video' && !deliverable.durationSeconds) {
    errors.push('video deliverables require durationSeconds');
  }
  if (lens !== 'video' && deliverable.durationSeconds !== undefined) {
    errors.push('durationSeconds is valid only for video deliverables');
  }
  const notePageBound = recipe.delivery.notePageBound;
  if (
    lens === 'image_text_note' &&
    (!Number.isInteger(notePageBound) ||
      (notePageBound as number) < MIN_NOTE_PLAN_PAGE_COUNT ||
      (notePageBound as number) > MAX_NOTE_PLAN_PAGE_COUNT)
  ) {
    errors.push(
      `image-text note delivery requires notePageBound between ${MIN_NOTE_PLAN_PAGE_COUNT} and ${MAX_NOTE_PLAN_PAGE_COUNT}`,
    );
  }
  if (lens !== 'image_text_note' && notePageBound !== undefined) {
    errors.push('notePageBound is valid only for image-text note delivery');
  }
  if (
    lens === 'image_text_note' &&
    deliverable.notePageBound !== notePageBound
  ) {
    errors.push(
      'deliverable.notePageBound must match the published Recipe declaration',
    );
  }
  if (lens !== 'image_text_note' && deliverable.notePageBound !== undefined) {
    errors.push('deliverable.notePageBound is valid only for image-text notes');
  }

  const configuredModules = recipe.contextPatches.contentModules;
  const contentModules =
    configuredModules ??
    (lens === 'copy'
      ? ['store_intro']
      : lens === 'image' || lens === 'image_text_note'
        ? ['social_cover']
        : ['shooting_checklist']);
  if (
    !Array.isArray(contentModules) ||
    contentModules.length === 0 ||
    contentModules.length > creativeContentModuleIds.length ||
    contentModules.some(
      (module) =>
        typeof module !== 'string' ||
        !creativeContentModuleIds.includes(
          module as (typeof creativeContentModuleIds)[number],
        ),
    ) ||
    new Set(contentModules).size !== contentModules.length
  ) {
    errors.push('contentModules must contain unique supported modules');
  }

  if (errors.length > 0 || !lens || !Array.isArray(contentModules)) {
    return { errors };
  }
  return {
    errors,
    binding: {
      contentModules:
        contentModules as (typeof creativeContentModuleIds)[number][],
      contentPackagePlatform,
      deliverable,
      distributionTarget,
      lens,
      ...(lens === 'image_text_note'
        ? { notePageBound: deliverable.notePageBound as number }
        : {}),
    },
  };
}

function deliverableLens(
  kind: ComposerSubmissionSignedFields['deliverable']['kind'],
): 'copy' | 'image' | 'image_text_note' | 'video' {
  if (kind === 'copy_document') return 'copy';
  if (kind === 'video_package') return 'video';
  if (kind === 'note' || kind === 'image_text_package') {
    return 'image_text_note';
  }
  return 'image';
}
