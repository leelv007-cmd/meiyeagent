import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCopyPlatformVariants,
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
      implementation: 'reserved',
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
