import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentPackageSchema } from '@meiye/contracts';
import {
  ContentPackageLifecycleError,
  editContentPackageLifecycleVersion,
  rollbackContentPackageLifecycleVersion,
} from './content-package-lifecycle.js';
import { FixtureAiStructuredObjectExecutor } from '../model-supply/ai-sdk-runner.js';
import { executionBriefSchema } from '../harness/structured-nodes.js';
import {
  buildContentPackage,
  contentPackageReferencesAsset,
  contentPackageRightsAssetIds,
  transitionContentPackage,
} from './content-package.js';

const CREATED_AT = '2026-07-17T02:00:00.000Z';
const EDITED_AT = '2026-07-17T02:05:00.000Z';
const ROLLED_BACK_AT = '2026-07-17T02:10:00.000Z';

function acceptedPackage() {
  const draft = buildContentPackage({
    id: 'content-package-lifecycle',
    kind: 'image_text',
    source: { assetIds: ['source-asset'], workId: 'canvas-work-1' },
    timestamp: CREATED_AT,
    workspaceId: 'workspace-lifecycle',
  });
  const accepted = transitionContentPackage(
    { ...draft, status: 'review_ready' },
    {
      type: 'adopted',
      version: {
        body: 'Package body',
        createdAt: CREATED_AT,
        id: 'package-v1',
        orderedAssetIds: ['package-asset'],
        title: 'Package title',
        topics: ['beauty'],
      },
    },
    CREATED_AT
  );
  return contentPackageSchema.parse({
    ...accepted,
    generated: {
      assetIds: ['generated-asset'],
      childRuns: [],
      ownedAssets: [
        {
          contentType: 'image/png',
          id: 'archived-asset',
          objectKey: 'workspace-lifecycle/owned/archived.png',
          sha256: 'a'.repeat(64),
        },
      ],
    },
    variants: (['xiaohongshu', 'douyin', 'video_account'] as const).map(
      (platform) => ({
        currentVersionId: `${platform}-v1`,
        id: `${accepted.id}-${platform}`,
        platform,
        versions: [
          {
            body: `${platform} body`,
            createdAt: CREATED_AT,
            id: `${platform}-v1`,
            orderedAssetIds: [`${platform}-asset`],
            title: `${platform} title`,
            topics: ['beauty'],
          },
        ],
      })
    ),
  });
}

describe('ContentPackage lifecycle module', () => {
  it('edits package and variant versions through one atomic invariant path', () => {
    const original = acceptedPackage();
    const packageEdit = editContentPackageLifecycleVersion({
      baseVersionId: 'package-v1',
      changes: {
        body: 'Edited package body',
        orderedAssetIds: ['package-asset', 'generated-asset'],
        title: 'Edited package title',
        topics: ['beauty', 'edited'],
      },
      contentPackage: original,
      target: { kind: 'package' },
      timestamp: EDITED_AT,
      userId: 'merchant-user',
    });
    const variantEdit = editContentPackageLifecycleVersion({
      baseVersionId: 'douyin-v1',
      changes: {
        body: 'Edited douyin body',
        orderedAssetIds: ['douyin-asset'],
        title: 'Edited douyin title',
        topics: ['local'],
      },
      contentPackage: packageEdit.contentPackage,
      target: { kind: 'variant', platform: 'douyin' },
      timestamp: EDITED_AT,
      userId: 'merchant-user',
    });

    assert.equal(original.versions.length, 1);
    assert.equal(packageEdit.contentPackage.versions.length, 2);
    assert.equal(
      variantEdit.contentPackage.variants.find(
        (variant) => variant.platform === 'douyin'
      )?.versions.length,
      2
    );
    assert.equal(
      variantEdit.contentPackage.variants.find(
        (variant) => variant.platform === 'xiaohongshu'
      )?.versions.length,
      1
    );
    assert.equal(
      variantEdit.contentPackage.versions.at(-1)?.source,
      'merchant_edited'
    );
  });

  it('appends scoped quick-edit intent without reusing or changing frozen refs', () => {
    const original = contentPackageSchema.parse({
      ...acceptedPackage(),
      marketing: {
        scene: 'promotion_groupbuy_conversion',
        contextBundle: {
          bundleId: 'bundle-1',
          revision: 1,
          hash: 'a'.repeat(64),
        },
        factRefs: ['store_fact:price-1:2'],
        rightsRefs: ['package-asset'],
        identityRefs: [],
        promotionOffer: {
          status: 'verified',
          sourceRefs: ['store_fact:price-1:2'],
          priceText: '398 元',
          callToAction: {
            kind: 'contact',
            mode: 'manual',
            label: '私信预约',
          },
        },
      },
    });
    const intent = {
      action: 'promotion_weaker' as const,
      instruction: '促销感弱一点',
      target: 'package_version' as const,
      scope: 'current_task' as const,
      baseVersionId: 'package-v1',
      preservedFactRefs: ['store_fact:price-1:2'],
      preservedRightsRefs: ['package-asset'],
    };
    const edited = editContentPackageLifecycleVersion({
      baseVersionId: 'package-v1',
      changes: {
        body: 'Edited package body',
        orderedAssetIds: ['package-asset'],
        title: 'Edited package title',
        topics: ['beauty'],
      },
      contentPackage: original,
      intent,
      target: { kind: 'package' },
      timestamp: EDITED_AT,
      userId: 'merchant-user',
    }).contentPackage;

    assert.equal(edited.lineage.reusedFromPackageId, undefined);
    assert.equal(edited.versions.at(-1)?.derivedFromVersionId, 'package-v1');
    assert.deepEqual(edited.versions.at(-1)?.editIntent, intent);
    assert.throws(
      () =>
        editContentPackageLifecycleVersion({
          baseVersionId: 'package-v1',
          changes: {
            body: 'Forged edit',
            orderedAssetIds: ['package-asset'],
            title: 'Forged edit',
            topics: [],
          },
          contentPackage: original,
          intent: { ...intent, preservedFactRefs: [] },
          target: { kind: 'package' },
          timestamp: EDITED_AT,
          userId: 'merchant-user',
        }),
      (error: unknown) =>
        error instanceof ContentPackageLifecycleError &&
        error.code === 'CONTENT_PACKAGE_CONTEXT_REFS_CHANGED'
    );
  });

  it('rejects a quick edit that drops fact refs reported by the fixture brief', async () => {
    const brief = await new FixtureAiStructuredObjectExecutor().generate({
      instructions: 'Compile one grounded copy brief.',
      prompt: JSON.stringify({
        bundle: {
          dimensions: {
            store_facts_assets: {
              'offer.price': {
                sourceRef: 'store_fact:price-1:2',
                value: { amount: 299, currency: 'CNY' },
              },
            },
          },
        },
      }),
      schema: executionBriefSchema,
      schemaName: 'harness_copy_brief_v1',
    });
    if (brief.output.kind !== 'copy') {
      throw new Error('Expected a copy brief.');
    }
    const original = contentPackageSchema.parse({
      ...acceptedPackage(),
      marketing: {
        scene: 'daily_service_exposure',
        contextBundle: {
          bundleId: 'bundle-fixture-brief',
          revision: 1,
          hash: 'b'.repeat(64),
        },
        factRefs: brief.output.factRefs,
        rightsRefs: [],
        identityRefs: [],
      },
    });

    assert.throws(
      () =>
        editContentPackageLifecycleVersion({
          baseVersionId: 'package-v1',
          changes: {
            body: 'Forged fixture edit',
            orderedAssetIds: ['package-asset'],
            title: 'Forged fixture edit',
            topics: [],
          },
          contentPackage: original,
          intent: {
            action: 'promotion_weaker',
            instruction: '促销感弱一点',
            target: 'package_version',
            scope: 'current_task',
            baseVersionId: 'package-v1',
            preservedFactRefs: [],
            preservedRightsRefs: [],
          },
          target: { kind: 'package' },
          timestamp: EDITED_AT,
          userId: 'merchant-user',
        }),
      (error: unknown) =>
        error instanceof ContentPackageLifecycleError &&
        error.code === 'CONTENT_PACKAGE_CONTEXT_REFS_CHANGED',
    );
  });

  it('routes every export-use quick edit to a distinct server export carrier', () => {
    const exportCases = [
      {
        action: 'wechat_moments_export',
        exportUse: 'wechat_moments',
        expected: {
          contentType: 'text/plain;charset=utf-8',
          fileName: 'wechat-moments.txt',
          kind: 'formatted_text',
        },
      },
      {
        action: 'offline_material_export',
        exportUse: 'offline_material',
        expected: {
          kind: 'light_composer',
          purposes: ['offline_a4_poster'],
          receiptCommand: 'export_work',
          sourcePackageId: 'content-package-lifecycle',
          sourceWorkId: 'canvas-work-1',
          templateRole: 'offline_material',
        },
      },
      {
        action: 'poster',
        exportUse: 'poster',
        expected: {
          kind: 'light_composer',
          purposes: ['wechat_moments_poster'],
          receiptCommand: 'export_work',
          sourcePackageId: 'content-package-lifecycle',
          sourceWorkId: 'canvas-work-1',
          templateRole: 'poster',
        },
      },
      {
        action: 'image_set',
        exportUse: 'image_set',
        expected: {
          kind: 'light_composer',
          purposes: ['xiaohongshu_cover', 'douyin_cover'],
          receiptCommand: 'export_work',
          sourcePackageId: 'content-package-lifecycle',
          sourceWorkId: 'canvas-work-1',
          templateRole: 'image_set',
        },
      },
      {
        action: 'spoken_script',
        exportUse: 'spoken_script',
        expected: {
          contentType: 'text/plain;charset=utf-8',
          fileName: 'spoken-script.txt',
          kind: 'formatted_text',
        },
      },
      {
        action: 'appointment_card',
        exportUse: 'appointment_card',
        expected: {
          kind: 'light_composer',
          purposes: ['wechat_moments_poster'],
          receiptCommand: 'export_work',
          sourcePackageId: 'content-package-lifecycle',
          sourceWorkId: 'canvas-work-1',
          templateRole: 'appointment_card',
        },
      },
    ] as const;
    const carriers = exportCases.map(({ action, exportUse, expected }) => {
      const original = acceptedPackage();
      const result = editContentPackageLifecycleVersion({
        baseVersionId: 'package-v1',
        changes: {
          body: `${exportUse} body`,
          conversionHook: `${exportUse} hook`,
          orderedAssetIds: ['package-asset'],
          title: `${exportUse} title`,
          topics: ['beauty'],
        },
        contentPackage: original,
        intent: {
          action,
          exportUse,
          instruction: `${exportUse} instruction`,
          target: 'export_use',
          scope: 'current_task',
          baseVersionId: 'package-v1',
          preservedFactRefs: [],
          preservedRightsRefs: [],
        },
        target: { kind: 'package' },
        timestamp: EDITED_AT,
        userId: 'merchant-user',
      });
      const carrier = result.contentPackage.versions.at(-1)?.exportUseDelivery;
      assert.ok(carrier);
      assert.equal(carrier.exportUse, exportUse);
      const actual =
        carrier.kind === 'formatted_text'
          ? {
              contentType: carrier.contentType,
              fileName: carrier.fileName,
              kind: carrier.kind,
              purposes: undefined,
              receiptCommand: undefined,
              sourcePackageId: undefined,
              sourceWorkId: undefined,
              sourceVersionId: undefined,
              templateRole: undefined,
            }
          : {
              contentType: undefined,
              fileName: undefined,
              kind: carrier.kind,
              purposes: carrier.materialSpecs.map((spec) => spec.purpose),
              receiptCommand: carrier.receiptCommand,
              sourcePackageId: carrier.sourcePackageId,
              sourceWorkId: carrier.sourceWorkId,
              sourceVersionId: carrier.sourceVersionId,
              templateRole: carrier.templateRole,
            };
      assert.deepEqual(
        actual,
        {
          contentType: 'contentType' in expected ? expected.contentType : undefined,
          fileName: 'fileName' in expected ? expected.fileName : undefined,
          kind: expected.kind,
          purposes: 'purposes' in expected ? [...expected.purposes] : undefined,
          receiptCommand:
            'receiptCommand' in expected ? expected.receiptCommand : undefined,
          sourcePackageId:
            'sourcePackageId' in expected ? expected.sourcePackageId : undefined,
          sourceWorkId:
            'sourceWorkId' in expected ? expected.sourceWorkId : undefined,
          sourceVersionId:
            expected.kind === 'light_composer' ? result.versionId : undefined,
          templateRole:
            'templateRole' in expected ? expected.templateRole : undefined,
        }
      );
      if (carrier.kind === 'formatted_text') {
        assert.equal(
          carrier.text,
          `${exportUse} title\n\n${exportUse} body\n\n${exportUse} hook`
        );
      }
      return carrier;
    });

    assert.equal(new Set(carriers.map((carrier) => JSON.stringify(carrier))).size, 6);
  });

  it('keeps ordinary package edits free of export-use delivery routing', () => {
    const edited = editContentPackageLifecycleVersion({
      baseVersionId: 'package-v1',
      changes: {
        body: 'Ordinary edited body',
        orderedAssetIds: ['package-asset'],
        title: 'Ordinary edited title',
        topics: ['beauty'],
      },
      contentPackage: acceptedPackage(),
      target: { kind: 'package' },
      timestamp: EDITED_AT,
      userId: 'merchant-user',
    }).contentPackage;

    assert.equal(
      edited.versions.at(-1)?.exportUseDelivery,
      undefined
    );
  });

  it('restores one variant without changing package or sibling histories', () => {
    const edited = editContentPackageLifecycleVersion({
      baseVersionId: 'douyin-v1',
      changes: {
        body: 'Edited douyin body',
        orderedAssetIds: ['douyin-asset'],
        title: 'Edited douyin title',
        topics: ['local'],
      },
      contentPackage: acceptedPackage(),
      target: { kind: 'variant', platform: 'douyin' },
      timestamp: EDITED_AT,
      userId: 'merchant-user',
    }).contentPackage;
    const restored = rollbackContentPackageLifecycleVersion({
      contentPackage: edited,
      targetVersionId: 'douyin-v1',
      timestamp: ROLLED_BACK_AT,
      userId: 'merchant-user',
    }).contentPackage;

    assert.equal(restored.versions.length, 1);
    assert.equal(
      restored.variants.find((variant) => variant.platform === 'douyin')
        ?.versions.length,
      3
    );
    assert.equal(
      restored.variants.find((variant) => variant.platform === 'douyin')
        ?.versions.at(-1)?.revertedFromVersionId,
      'douyin-v1'
    );
    assert.equal(
      restored.variants.find(
        (variant) => variant.platform === 'video_account'
      )?.versions.length,
      1
    );
  });

  it('rejects foreign assets consistently and centralizes rights references', () => {
    const contentPackage = acceptedPackage();

    assert.throws(
      () =>
        editContentPackageLifecycleVersion({
          baseVersionId: 'package-v1',
          changes: {
            body: 'Invalid body',
            orderedAssetIds: ['foreign-asset'],
            title: 'Invalid title',
            topics: [],
          },
          contentPackage,
          target: { kind: 'package' },
          timestamp: EDITED_AT,
          userId: 'merchant-user',
        }),
      (error: unknown) =>
        error instanceof ContentPackageLifecycleError &&
        error.code === 'INVALID_CONTENT_PACKAGE_ASSET'
    );
    assert.deepEqual(
      contentPackageRightsAssetIds(contentPackage, contentPackage.versions[0]!),
      ['source-asset', 'package-asset']
    );
    assert.equal(
      contentPackageReferencesAsset(contentPackage, 'archived-asset'),
      true
    );
    assert.equal(
      contentPackageReferencesAsset(contentPackage, 'video_account-asset'),
      true
    );
    assert.equal(
      contentPackageReferencesAsset(contentPackage, 'foreign-asset'),
      false
    );
  });
});
