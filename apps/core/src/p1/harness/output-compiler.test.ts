import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCopyRevisionAssemblyComplete,
  assertImageRevisionAssemblyComplete,
  buildCopyPlatformVariants,
  buildImagePlatformVariants,
  OUTPUT_COMPILER_CONTRACTS,
  OUTPUT_COMPILER_KINDS,
  outputCompilerContract,
} from './output-compiler.js';

test('four output compiler slots share the five-stage assembly contract', () => {
  assert.deepEqual(OUTPUT_COMPILER_KINDS, [
    'copy',
    'image',
    'image_text_note',
    'video',
  ]);
  for (const kind of OUTPUT_COMPILER_KINDS) {
    const contract = outputCompilerContract(kind);
    assert.deepEqual(contract.stages, [
      'intent_naming',
      'context_injection',
      'brief_compilation',
      'execution_selection',
      'assembly_delivery',
    ]);
    assert.deepEqual(contract.assemblyRequires, [
      'evidence',
      'cta',
      'platform_variants',
      'rights_references',
    ]);
  }
});

test('compiler tiers reserve downstream owners without inventing their implementations', () => {
  assert.deepEqual(OUTPUT_COMPILER_CONTRACTS, {
    copy: {
      assemblyRequires: [
        'evidence',
        'cta',
        'platform_variants',
        'rights_references',
      ],
      candidateStrategy: 'single_primary',
      deliveryPackage: {
        kind: 'image_text',
        manifestBuilderOwner: 'result-delivery/export',
        manifestSchema: 'beauty-delivery-manifest/v1',
      },
      implementation: 'available',
      orchestration: 'degraded_five_stage',
      owner: 'T18',
      stages: [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ],
    },
    image: {
      assemblyRequires: [
        'evidence',
        'cta',
        'platform_variants',
        'rights_references',
      ],
      candidateStrategy: 'single_primary',
      deliveryPackage: {
        kind: 'image_text',
        manifestBuilderOwner: 'result-delivery/export',
        manifestSchema: 'beauty-delivery-manifest/v1',
      },
      implementation: 'available',
      orchestration: 'degraded_five_stage',
      owner: 'T19',
      stages: [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ],
    },
    image_text_note: {
      assemblyRequires: [
        'evidence',
        'cta',
        'platform_variants',
        'rights_references',
      ],
      candidateStrategy: 'dual_style',
      deliveryPackage: {
        kind: 'image_text',
        manifestBuilderOwner: 'result-delivery/export',
        manifestSchema: 'beauty-delivery-manifest/v1',
      },
      implementation: 'reserved',
      orchestration: 'multi_stage',
      owner: 'T20',
      stages: [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ],
    },
    video: {
      assemblyRequires: [
        'evidence',
        'cta',
        'platform_variants',
        'rights_references',
      ],
      candidateStrategy: 'single_primary',
      deliveryPackage: {
        kind: 'video',
        manifestBuilderOwner: 'result-delivery/export',
        manifestSchema: 'beauty-delivery-manifest/v1',
      },
      implementation: 'reserved',
      orchestration: 'native_single_call',
      owner: 'T21',
      stages: [
        'intent_naming',
        'context_injection',
        'brief_compilation',
        'execution_selection',
        'assembly_delivery',
      ],
    },
  });
});

test('image revision assembly accepts one complete current variant per platform', () => {
  const version = {
    body: '夏日护理活动主视觉',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T00:00:00.000Z',
    id: 'image-version-1',
    orderedAssetIds: ['asset-image-1'],
    source: 'ai_generated' as const,
    title: '夏日护理活动',
    topics: [],
  };
  const variants = buildImagePlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-image-1',
    versions: [version],
  });
  const revision = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['fact:service:1'],
      rightsRefs: ['asset-image-1'],
    },
    variants,
    version,
  };

  assert.doesNotThrow(() => assertImageRevisionAssemblyComplete(revision));
});

test('image revision assembly rejects each missing required part', () => {
  const version = {
    body: '夏日护理活动主视觉',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T00:00:00.000Z',
    id: 'image-version-1',
    orderedAssetIds: ['asset-image-1'],
    source: 'ai_generated' as const,
    title: '夏日护理活动',
    topics: [],
  };
  const variants = buildImagePlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-image-1',
    versions: [version],
  });
  const complete = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['fact:service:1'],
      rightsRefs: ['asset-image-1'],
    },
    variants,
    version,
  };

  const missingEvidence = {
    ...complete,
    marketing: { ...complete.marketing, contextBundle: undefined },
  };
  const missingCta = {
    ...complete,
    version: { ...version, conversionHook: '' },
  };
  const missingRights = {
    ...complete,
    marketing: { ...complete.marketing, rightsRefs: [] },
  };
  const missingAsset = {
    ...complete,
    version: { ...version, orderedAssetIds: [] },
  };
  const missingVariant = {
    ...complete,
    variants: variants.slice(0, 2),
  };

  for (const incomplete of [
    missingEvidence,
    missingCta,
    missingRights,
    missingAsset,
    missingVariant,
  ]) {
    assert.throws(() => assertImageRevisionAssemblyComplete(incomplete));
  }
});

test('copy assembly prepares one non-empty version for every v1 platform', () => {
  const variants = buildCopyPlatformVariants({
    packageId: 'package-1',
    currentVersionId: 'version-1',
    versions: [
      {
        body: '介绍本店护理重点，并说明预约前需要沟通的事项。',
        conversionHook: '私信预约',
        createdAt: '2026-07-25T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: [],
        source: 'ai_generated',
        title: '换季护理到店前先看',
        topics: [],
      },
    ],
  });

  assert.deepEqual(
    variants.map(({ platform }) => platform),
    ['xiaohongshu', 'douyin', 'video_account'],
  );
  for (const variant of variants) {
    assert.equal(variant.versions.length, 1);
    assert.ok(variant.currentVersionId);
    assert.ok(variant.versions[0]?.body);
    assert.ok(variant.versions[0]?.conversionHook);
  }
});

test('copy assembly rejects revisions missing evidence, CTA, variants, or rights references', () => {
  const version = {
    body: '介绍本店护理重点，并说明预约前需要沟通的事项。',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T08:00:00.000Z',
    id: 'version-1',
    orderedAssetIds: [],
    source: 'ai_generated' as const,
    title: '换季护理到店前先看',
    topics: [],
  };
  const complete = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['store_fact:service-1:1'],
      rightsRefs: ['asset-1'],
    },
    variants: buildCopyPlatformVariants({
      currentVersionId: version.id,
      packageId: 'package-1',
      versions: [version],
    }),
    version,
  };
  assert.doesNotThrow(() => assertCopyRevisionAssemblyComplete(complete));

  const { marketing: _marketing, ...withoutEvidence } = complete;
  assert.throws(
    () => assertCopyRevisionAssemblyComplete(withoutEvidence),
    /requires frozen evidence/u,
  );

  const { conversionHook: _conversionHook, ...withoutConversionHook } =
    complete.version;
  assert.throws(
    () =>
      assertCopyRevisionAssemblyComplete({
        ...complete,
        version: withoutConversionHook,
      }),
    /requires a conversion CTA/u,
  );

  const { variants: _variants, ...withoutVariants } = complete;
  assert.throws(
    () => assertCopyRevisionAssemblyComplete(withoutVariants),
    /requires one complete current variant per platform/u,
  );

  const { rightsRefs: _rightsRefs, ...withoutRightsReferences } =
    complete.marketing;
  assert.throws(
    () =>
      assertCopyRevisionAssemblyComplete({
        ...complete,
        marketing: withoutRightsReferences,
      }),
    /requires rights references/u,
  );
});
