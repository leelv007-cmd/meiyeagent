import {
  NOTE_PLAN_CONSISTENCY_DIMENSIONS,
  contentPackageVariantSchema,
  type ContentPackage,
  type ContentPackageVersion,
} from '@meiye/contracts';
import type { NotePlanEnhancementJudgeState } from './note-plan-compiler.js';

export function compileCopyGenerationRequest(input: {
  brief: {
    assetRefs: string[];
    constraints: string[];
    cta: string;
    factRefs: string[];
    identityRefs: string[];
    instructions: string;
    platform: string;
  };
  context: Record<string, unknown>;
  policyFailures?: Array<{ gateId: string; reason: string }>;
}) {
  const identity =
    input.brief.identityRefs.length > 0
      ? input.brief.identityRefs
      : ['brand_official'];
  const retrying = Boolean(input.policyFailures?.length);
  return {
    candidateId: retrying ? 'c01-retry' : 'c01',
    instructions:
      'Generate the single primary, grounded beauty-business copy result. ' +
      `Follow the ${input.brief.platform} publishing template, express the ` +
      `frozen identity references (${identity.join(', ')}), and use only ` +
      'supplied fact, asset, and rights references.' +
      (retrying
        ? ' Correct every supplied policy failure; do not repeat the blocked expression.'
        : ''),
    prompt: JSON.stringify({
      candidateId: retrying ? 'c01-retry' : 'c01',
      brief: input.brief,
      context: input.context,
      expressionIdentityRefs: identity,
      ...(input.policyFailures
        ? { policyFailures: input.policyFailures }
        : {}),
      platformTemplate: input.brief.platform,
    }),
  };
}

export function buildCopyPlatformVariants(input: {
  currentVersionId: string;
  packageId: string;
  versions: ContentPackageVersion[];
}): ContentPackage['variants'] {
  const current = input.versions.find(
    (version) => version.id === input.currentVersionId,
  );
  if (!current) {
    throw new Error('Copy platform variants require the current version.');
  }
  return ['xiaohongshu', 'douyin', 'video_account'].map((platform) => {
    const versions = input.versions.map((version) => ({
      ...structuredClone(version),
      id: `${version.id}-${platform}`,
    }));
    return contentPackageVariantSchema.parse({
      currentVersionId: `${current.id}-${platform}`,
      id: `${input.packageId}-${platform}`,
      platform,
      versions,
    });
  });
}

export function buildImagePlatformVariants(input: {
  currentVersionId: string;
  packageId: string;
  versions: ContentPackageVersion[];
}): ContentPackage['variants'] {
  const current = input.versions.find(
    (version) => version.id === input.currentVersionId,
  );
  if (!current) {
    throw new Error('Image platform variants require the current version.');
  }
  return ['xiaohongshu', 'douyin', 'video_account'].map((platform) => {
    const versions = input.versions.map((version) => ({
      ...structuredClone(version),
      id: `${version.id}-${platform}`,
    }));
    return contentPackageVariantSchema.parse({
      currentVersionId: `${current.id}-${platform}`,
      id: `${input.packageId}-${platform}`,
      platform,
      versions,
    });
  });
}

export function buildImageTextNotePlatformVariants(input: {
  currentVersionId: string;
  packageId: string;
  versions: ContentPackageVersion[];
}): ContentPackage['variants'] {
  const current = input.versions.find(
    (version) => version.id === input.currentVersionId,
  );
  if (!current) {
    throw new Error(
      'Image-text note platform variants require the current version.',
    );
  }
  return ['xiaohongshu', 'douyin', 'video_account'].map((platform) => {
    const versions = input.versions.map((version) => ({
      ...structuredClone(version),
      id: `${version.id}-${platform}`,
    }));
    return contentPackageVariantSchema.parse({
      currentVersionId: `${current.id}-${platform}`,
      id: `${input.packageId}-${platform}`,
      platform,
      versions,
    });
  });
}

export function buildVideoPlatformVariants(input: {
  currentVersionId: string;
  packageId: string;
  versions: ContentPackageVersion[];
}): ContentPackage['variants'] {
  const current = input.versions.find(
    (version) => version.id === input.currentVersionId,
  );
  if (!current) {
    throw new Error('Video platform variants require the current version.');
  }
  return ['xiaohongshu', 'douyin', 'video_account'].map((platform) => {
    const versions = input.versions.map((version) => ({
      ...structuredClone(version),
      id: `${version.id}-${platform}`,
    }));
    return contentPackageVariantSchema.parse({
      currentVersionId: `${current.id}-${platform}`,
      id: `${input.packageId}-${platform}`,
      platform,
      versions,
    });
  });
}

export function assertCopyRevisionAssemblyComplete(input: {
  marketing?: {
    contextBundle?: {
      bundleId?: string;
      hash?: string;
      revision?: number;
    };
    factRefs?: string[];
    rightsRefs?: string[];
  };
  variants?: ContentPackage['variants'];
  version: Pick<ContentPackageVersion, 'body' | 'conversionHook' | 'title'>;
}) {
  if (
    !input.marketing?.contextBundle?.bundleId ||
    !input.marketing.contextBundle.hash ||
    !input.marketing.contextBundle.revision ||
    !Array.isArray(input.marketing.factRefs)
  ) {
    throw new Error('Copy revision assembly requires frozen evidence.');
  }
  if (!input.version.conversionHook?.trim()) {
    throw new Error('Copy revision assembly requires a conversion CTA.');
  }
  if (!Array.isArray(input.marketing.rightsRefs)) {
    throw new Error('Copy revision assembly requires rights references.');
  }
  const expectedPlatforms = ['xiaohongshu', 'douyin', 'video_account'] as const;
  const actualPlatforms = input.variants?.map(({ platform }) => platform) ?? [];
  if (
    !input.variants ||
    input.variants.length !== expectedPlatforms.length ||
    new Set(actualPlatforms).size !== expectedPlatforms.length ||
    expectedPlatforms.some((platform) => !actualPlatforms.includes(platform)) ||
    input.variants.some(
      (variant) =>
        !variant.versions.some(
          (version) =>
            version.id === variant.currentVersionId &&
            Boolean(version.title.trim()) &&
            Boolean(version.body.trim()) &&
            Boolean(version.conversionHook?.trim()),
        ),
    )
  ) {
    throw new Error(
      'Copy revision assembly requires one complete current variant per platform.',
    );
  }
}

export function assertImageRevisionAssemblyComplete(input: {
  marketing?: {
    contextBundle?: {
      bundleId?: string;
      hash?: string;
      revision?: number;
    };
    factRefs?: string[];
    rightsRefs?: string[];
  };
  variants?: ContentPackage['variants'];
  version: Pick<
    ContentPackageVersion,
    'body' | 'conversionHook' | 'orderedAssetIds' | 'title'
  >;
}) {
  if (
    !input.marketing?.contextBundle?.bundleId ||
    !input.marketing.contextBundle.hash ||
    !input.marketing.contextBundle.revision ||
    !Array.isArray(input.marketing.factRefs)
  ) {
    throw new Error('Image revision assembly requires frozen evidence.');
  }
  if (!input.version.conversionHook?.trim()) {
    throw new Error('Image revision assembly requires a conversion CTA.');
  }
  if (
    !Array.isArray(input.marketing.rightsRefs) ||
    input.marketing.rightsRefs.length === 0
  ) {
    throw new Error('Image revision assembly requires rights references.');
  }
  if (input.version.orderedAssetIds.length === 0) {
    throw new Error('Image revision assembly requires a generated image asset.');
  }
  const expectedPlatforms = ['xiaohongshu', 'douyin', 'video_account'] as const;
  const actualPlatforms = input.variants?.map(({ platform }) => platform) ?? [];
  if (
    !input.variants ||
    input.variants.length !== expectedPlatforms.length ||
    new Set(actualPlatforms).size !== expectedPlatforms.length ||
    expectedPlatforms.some((platform) => !actualPlatforms.includes(platform)) ||
    input.variants.some(
      (variant) =>
        !variant.versions.some(
          (version) =>
            version.id === variant.currentVersionId &&
            Boolean(version.title.trim()) &&
            Boolean(version.body.trim()) &&
            Boolean(version.conversionHook?.trim()) &&
            version.orderedAssetIds.length > 0,
        ),
    )
  ) {
    throw new Error(
      'Image revision assembly requires one complete current variant per platform.',
    );
  }
}

export function assertImageTextNoteRevisionAssemblyComplete(input: {
  enhancementJudge?: NotePlanEnhancementJudgeState;
  marketing?: {
    contextBundle?: {
      bundleId?: string;
      hash?: string;
      revision?: number;
    };
    factRefs?: string[];
    rightsRefs?: string[];
  };
  variants?: ContentPackage['variants'];
  partial?: {
    unresolvedPageIds: string[];
    reason: 'consistency_remained_incomplete' | 'second_evaluation_failed';
  };
  version: Pick<
    ContentPackageVersion,
    'body' | 'conversionHook' | 'id' | 'note' | 'orderedAssetIds' | 'title'
  >;
}) {
  if (
    !input.marketing?.contextBundle?.bundleId ||
    !input.marketing.contextBundle.hash ||
    !input.marketing.contextBundle.revision ||
    !Array.isArray(input.marketing.factRefs)
  ) {
    throw new Error(
      'Image-text note revision assembly requires frozen evidence.',
    );
  }
  if (!input.version.conversionHook?.trim()) {
    throw new Error(
      'Image-text note revision assembly requires a conversion CTA.',
    );
  }
  if (
    !Array.isArray(input.marketing.rightsRefs) ||
    input.marketing.rightsRefs.length === 0
  ) {
    throw new Error(
      'Image-text note revision assembly requires rights references.',
    );
  }
  const note = input.version.note;
  if (!note || note.plan.pages.some((page) => !page.imageAssetId)) {
    throw new Error(
      'Image-text note revision assembly requires one image for every page.',
    );
  }
  const evaluation = note.evaluation;
  const partialPageIds = new Set(input.partial?.unresolvedPageIds ?? []);
  const partialCurrentVersion =
    input.partial !== undefined &&
    partialPageIds.size > 0 &&
    input.version.id.length > 0 &&
    [...partialPageIds].every((pageId) =>
      note.plan.pages.some(({ id }) => id === pageId),
    );
  const enhancementEvaluationUnavailable =
    input.enhancementJudge?.status === 'unconfigured' &&
    input.partial === undefined &&
    evaluation === undefined;
  if (
    (!evaluation && !enhancementEvaluationUnavailable) ||
    (evaluation !== undefined &&
      (evaluation.dimensions.length !==
        NOTE_PLAN_CONSISTENCY_DIMENSIONS.length ||
        (!partialCurrentVersion &&
          (evaluation.dimensions.some(({ passed }) => !passed) ||
            evaluation.regenerationPageIds.length > 0)) ||
        (partialCurrentVersion &&
          ![...partialPageIds].every((pageId) =>
            evaluation.regenerationPageIds.includes(pageId),
          ))))
  ) {
    throw new Error(
      partialCurrentVersion
        ? 'Image-text note partial assembly requires unresolved pages to remain explicitly reported.'
        : 'Image-text note revision assembly requires a passing five-dimension evaluation.',
    );
  }
  const pageAssetIds = note.plan.pages.map(({ imageAssetId }) => imageAssetId!);
  if (
    pageAssetIds.length !== input.version.orderedAssetIds.length ||
    pageAssetIds.some(
      (assetId, index) => input.version.orderedAssetIds[index] !== assetId,
    )
  ) {
    throw new Error(
      'Image-text note revision assembly requires page-ordered image assets.',
    );
  }
  if (
    note.plan.pages.some(
      ({ textBlock }) =>
        !textBlock.title.trim() || !textBlock.body.trim(),
    )
  ) {
    throw new Error(
      'Image-text note revision assembly requires complete page text.',
    );
  }
  const expectedPlatforms = ['xiaohongshu', 'douyin', 'video_account'] as const;
  const actualPlatforms = input.variants?.map(({ platform }) => platform) ?? [];
  if (
    !input.variants ||
    input.variants.length !== expectedPlatforms.length ||
    new Set(actualPlatforms).size !== expectedPlatforms.length ||
    expectedPlatforms.some((platform) => !actualPlatforms.includes(platform)) ||
    input.variants.some((variant) => {
      const current = variant.versions.find(
        ({ id }) => id === variant.currentVersionId,
      );
      const isPartialCurrent =
        current?.id === input.version.id ||
        current?.id.startsWith(`${input.version.id}-`) === true;
      const currentEvaluation = current?.note?.evaluation;
      const currentEvaluationUnavailable =
        input.enhancementJudge?.status === 'unconfigured' &&
        input.partial === undefined &&
        currentEvaluation === undefined;
      const invalidCurrentEvaluation =
        currentEvaluation === undefined
          ? !currentEvaluationUnavailable
          : (!isPartialCurrent &&
              (currentEvaluation.dimensions.some(({ passed }) => !passed) ||
                currentEvaluation.regenerationPageIds.length > 0)) ||
            (isPartialCurrent &&
              input.partial === undefined &&
              (currentEvaluation.dimensions.some(({ passed }) => !passed) ||
                currentEvaluation.regenerationPageIds.length > 0));
      return (
        !current?.title.trim() ||
        !current.body.trim() ||
        !current.conversionHook?.trim() ||
        !current.note ||
        invalidCurrentEvaluation ||
        current.note.plan.pages.some(({ imageAssetId }) => !imageAssetId)
      );
    })
  ) {
    throw new Error(
      'Image-text note revision assembly requires one complete current variant per platform.',
    );
  }
}

export function assertVideoRevisionAssemblyComplete(input: {
  marketing?: {
    contextBundle?: {
      bundleId?: string;
      hash?: string;
      revision?: number;
    };
    factRefs?: string[];
    rightsRefs?: string[];
  };
  variants?: ContentPackage['variants'];
  version: Pick<
    ContentPackageVersion,
    'body' | 'conversionHook' | 'orderedAssetIds' | 'title'
  >;
}) {
  if (
    !input.marketing?.contextBundle?.bundleId ||
    !input.marketing.contextBundle.hash ||
    !input.marketing.contextBundle.revision ||
    !Array.isArray(input.marketing.factRefs)
  ) {
    throw new Error('Video revision assembly requires frozen evidence.');
  }
  if (!input.version.conversionHook?.trim()) {
    throw new Error('Video revision assembly requires a conversion CTA.');
  }
  if (
    !Array.isArray(input.marketing.rightsRefs) ||
    input.marketing.rightsRefs.length === 0
  ) {
    throw new Error('Video revision assembly requires rights references.');
  }
  if (input.version.orderedAssetIds.length === 0) {
    throw new Error('Video revision assembly requires a generated video asset.');
  }
  const expectedPlatforms = ['xiaohongshu', 'douyin', 'video_account'] as const;
  const actualPlatforms = input.variants?.map(({ platform }) => platform) ?? [];
  if (
    !input.variants ||
    input.variants.length !== expectedPlatforms.length ||
    new Set(actualPlatforms).size !== expectedPlatforms.length ||
    expectedPlatforms.some((platform) => !actualPlatforms.includes(platform)) ||
    input.variants.some(
      (variant) =>
        !variant.versions.some(
          (version) =>
            version.id === variant.currentVersionId &&
            Boolean(version.title.trim()) &&
            Boolean(version.body.trim()) &&
            Boolean(version.conversionHook?.trim()) &&
            version.orderedAssetIds.length > 0,
        ),
    )
  ) {
    throw new Error(
      'Video revision assembly requires one complete current variant per platform.',
    );
  }
}
