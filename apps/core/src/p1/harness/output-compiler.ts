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
}) {
  const identity =
    input.brief.identityRefs.length > 0
      ? input.brief.identityRefs
      : ['brand_official'];
  return {
    candidateId: 'c01',
    instructions:
      'Generate the single primary, grounded beauty-business copy result. ' +
      `Follow the ${input.brief.platform} publishing template, express the ` +
      `frozen identity references (${identity.join(', ')}), and use only ` +
      'supplied fact, asset, and rights references.',
    prompt: JSON.stringify({
      candidateId: 'c01',
      brief: input.brief,
      context: input.context,
      expressionIdentityRefs: identity,
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
