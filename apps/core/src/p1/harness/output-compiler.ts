import {
  HARNESS_STAGES,
  contentPackageVariantSchema,
  type ContentPackage,
  type ContentPackageVersion,
} from '@meiye/contracts';

export const OUTPUT_COMPILER_KINDS = [
  'copy',
  'image',
  'image_text_note',
  'video',
] as const;

export type OutputCompilerKind = (typeof OUTPUT_COMPILER_KINDS)[number];

const ASSEMBLY_REQUIREMENTS = [
  'evidence',
  'cta',
  'platform_variants',
  'rights_references',
] as const;

export interface OutputCompilerContract {
  assemblyRequires: typeof ASSEMBLY_REQUIREMENTS;
  candidateStrategy: 'single_primary' | 'dual_style';
  implementation: 'available' | 'reserved';
  deliveryPackage: {
    kind: 'image_text' | 'video';
    manifestBuilderOwner: 'result-delivery/export';
    manifestSchema: 'beauty-delivery-manifest/v1';
  };
  orchestration:
    | 'degraded_five_stage'
    | 'multi_stage'
    | 'native_single_call';
  owner: 'T18' | 'T19' | 'T20' | 'T21';
  stages: typeof HARNESS_STAGES;
}

export const OUTPUT_COMPILER_CONTRACTS = {
  copy: contract({
    candidateStrategy: 'single_primary',
    deliveryPackageKind: 'image_text',
    implementation: 'available',
    orchestration: 'degraded_five_stage',
    owner: 'T18',
  }),
  image: contract({
    candidateStrategy: 'single_primary',
    deliveryPackageKind: 'image_text',
    implementation: 'reserved',
    orchestration: 'degraded_five_stage',
    owner: 'T19',
  }),
  image_text_note: contract({
    candidateStrategy: 'dual_style',
    deliveryPackageKind: 'image_text',
    implementation: 'reserved',
    orchestration: 'multi_stage',
    owner: 'T20',
  }),
  video: contract({
    candidateStrategy: 'single_primary',
    deliveryPackageKind: 'video',
    implementation: 'reserved',
    orchestration: 'native_single_call',
    owner: 'T21',
  }),
} as const satisfies Record<OutputCompilerKind, OutputCompilerContract>;

export function outputCompilerContract(kind: OutputCompilerKind) {
  return OUTPUT_COMPILER_CONTRACTS[kind];
}

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

function contract(
  input: Omit<
    OutputCompilerContract,
    'assemblyRequires' | 'deliveryPackage' | 'stages'
  > & {
    deliveryPackageKind: OutputCompilerContract['deliveryPackage']['kind'];
  },
): OutputCompilerContract {
  const { deliveryPackageKind, ...compiler } = input;
  return {
    assemblyRequires: ASSEMBLY_REQUIREMENTS,
    deliveryPackage: {
      kind: deliveryPackageKind,
      manifestBuilderOwner: 'result-delivery/export',
      manifestSchema: 'beauty-delivery-manifest/v1',
    },
    stages: HARNESS_STAGES,
    ...compiler,
  };
}
