/**
 * A3 / #90 — Conditional Brief trigger projection (D-094).
 * Seven triggers: fire / not-fire boundaries + revision re-confirm path.
 * Ops config cannot disable any safety trigger.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  BriefBoundRevisions,
  BriefTriggerConditionCode,
  BriefTriggerInput,
} from '@meiye/contracts';
import {
  BRIEF_IMAGE_COUNT_THRESHOLD,
  briefTriggerConditionCodes,
} from '@meiye/contracts';
import {
  briefRevisionsMatch,
  confirmBrief,
  isBriefConfirmationInvalid,
  isRestrictedSource,
  listBriefTriggerConditionCodes,
  projectBriefTrigger,
  projectEvidenceDrawer,
} from './brief-trigger-projection.js';

function baseRevisions(
  overrides: Partial<BriefBoundRevisions> = {},
): BriefBoundRevisions {
  return {
    draftRevisionId: 'draft@1',
    recipeRevisionId: 'recipe.project_intro@1',
    modelRevisionId: 'model.auto@1',
    quoteRevisionId: 'quote.snap@1',
    sourceRevisionId: 'sources@1',
    surfaceRevisionId: 'surface.home.launch@1',
    lensId: 'copy',
    ...overrides,
  };
}

/** Simple copy / single-image task that should NOT require Brief. */
function simpleInput(
  overrides: Partial<BriefTriggerInput> = {},
): BriefTriggerInput {
  return {
    lensId: 'copy',
    deliverableKind: 'copy_document',
    deliverableCount: 1,
    platforms: ['wechat_moments'],
    imageCount: 0,
    sources: [],
    highRiskFacts: [
      { kind: 'price', status: 'present', provenance: 'user_entered' },
    ],
    quote: {
      quoteRevisionId: 'quote.snap@1',
      amount: 10,
      extraConfirmThreshold: 100,
      quotePolicyRevision: 'qp@1',
    },
    currentRevisions: baseRevisions(),
    ...overrides,
  };
}

function hasCode(
  projection: ReturnType<typeof projectBriefTrigger>,
  code: BriefTriggerConditionCode,
): boolean {
  return projection.triggers.some((t) => t.code === code);
}

describe('brief trigger codes (contract)', () => {
  it('exposes exactly the seven D-094 safety codes', () => {
    assert.deepEqual(listBriefTriggerConditionCodes(), [
      'any_video',
      'multi_deliverable_or_cross_platform',
      'images_over_four',
      'restricted_assets',
      'high_risk_fact_missing_or_conflict',
      'quote_policy_threshold',
      'confirmation_invalid',
    ]);
    assert.equal(briefTriggerConditionCodes.length, 7);
  });
});

describe('simple path — no Brief', () => {
  it('does not require Brief for simple copy with complete facts under quote threshold', () => {
    const projection = projectBriefTrigger(simpleInput());
    assert.equal(projection.requiresBrief, false);
    assert.equal(projection.triggers.length, 0);
    assert.equal(projection.confirmationInvalid, false);
    assert.equal(projection.confirmationValid, false);
  });

  it('does not require Brief for single image (count = 1) under threshold', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        lensId: 'image_text',
        deliverableKind: 'poster',
        imageCount: 1,
        currentRevisions: baseRevisions({ lensId: 'image_text' }),
      }),
    );
    assert.equal(projection.requiresBrief, false);
    assert.equal(hasCode(projection, 'images_over_four'), false);
  });
});

describe('trigger 1: any_video', () => {
  it('fires when lens is video', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        lensId: 'video',
        deliverableKind: 'short_video',
        currentRevisions: baseRevisions({ lensId: 'video' }),
      }),
    );
    assert.equal(projection.requiresBrief, true);
    assert.equal(hasCode(projection, 'any_video'), true);
  });

  it('fires when deliverableKind is video-like even if lens is image_text', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        lensId: 'image_text',
        deliverableKind: 'video_clip',
        currentRevisions: baseRevisions({ lensId: 'image_text' }),
      }),
    );
    assert.equal(hasCode(projection, 'any_video'), true);
    assert.equal(projection.requiresBrief, true);
  });

  it('does not fire for copy lens + non-video deliverable', () => {
    const projection = projectBriefTrigger(simpleInput());
    assert.equal(hasCode(projection, 'any_video'), false);
  });
});

describe('trigger 2: multi_deliverable_or_cross_platform', () => {
  it('fires when deliverableCount > 1', () => {
    const projection = projectBriefTrigger(
      simpleInput({ deliverableCount: 2 }),
    );
    assert.equal(hasCode(projection, 'multi_deliverable_or_cross_platform'), true);
    assert.equal(projection.requiresBrief, true);
  });

  it('fires when platforms length > 1 (cross-platform)', () => {
    const projection = projectBriefTrigger(
      simpleInput({ platforms: ['xiaohongshu', 'douyin'] }),
    );
    assert.equal(hasCode(projection, 'multi_deliverable_or_cross_platform'), true);
  });

  it('does not fire for single deliverable + single platform', () => {
    const projection = projectBriefTrigger(
      simpleInput({ deliverableCount: 1, platforms: ['xiaohongshu'] }),
    );
    assert.equal(
      hasCode(projection, 'multi_deliverable_or_cross_platform'),
      false,
    );
  });

  it('boundary: deliverableCount = 1 does not fire', () => {
    const projection = projectBriefTrigger(
      simpleInput({ deliverableCount: 1 }),
    );
    assert.equal(
      hasCode(projection, 'multi_deliverable_or_cross_platform'),
      false,
    );
  });
});

describe('trigger 3: images_over_four', () => {
  it(`fires when imageCount > ${BRIEF_IMAGE_COUNT_THRESHOLD}`, () => {
    const projection = projectBriefTrigger(
      simpleInput({ imageCount: BRIEF_IMAGE_COUNT_THRESHOLD + 1 }),
    );
    assert.equal(hasCode(projection, 'images_over_four'), true);
    assert.equal(projection.requiresBrief, true);
  });

  it(`boundary: imageCount = ${BRIEF_IMAGE_COUNT_THRESHOLD} does NOT fire`, () => {
    const projection = projectBriefTrigger(
      simpleInput({ imageCount: BRIEF_IMAGE_COUNT_THRESHOLD }),
    );
    assert.equal(hasCode(projection, 'images_over_four'), false);
    assert.equal(projection.requiresBrief, false);
  });

  it('boundary: imageCount = 0 does not fire', () => {
    const projection = projectBriefTrigger(simpleInput({ imageCount: 0 }));
    assert.equal(hasCode(projection, 'images_over_four'), false);
  });
});

describe('trigger 4: restricted_assets', () => {
  it('fires for customer_case category', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        sources: [
          { id: 'a1', category: 'customer_case', rightsStatus: 'authorized' },
        ],
      }),
    );
    assert.equal(hasCode(projection, 'restricted_assets'), true);
  });

  it('fires for before_after category', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        sources: [{ id: 'a2', category: 'before_after' }],
      }),
    );
    assert.equal(hasCode(projection, 'restricted_assets'), true);
  });

  it('fires for review / testimonial categories', () => {
    for (const category of ['review', 'testimonial', 'customer_review']) {
      const projection = projectBriefTrigger(
        simpleInput({ sources: [{ id: 'r1', category }] }),
      );
      assert.equal(
        hasCode(projection, 'restricted_assets'),
        true,
        `expected restricted for ${category}`,
      );
    }
  });

  it('fires when containsPerson is true', () => {
    assert.equal(
      isRestrictedSource({ id: 'p1', containsPerson: true }),
      true,
    );
    const projection = projectBriefTrigger(
      simpleInput({
        sources: [{ id: 'p1', category: 'store', containsPerson: true }],
      }),
    );
    assert.equal(hasCode(projection, 'restricted_assets'), true);
  });

  it('fires when restricted flag is explicit', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        sources: [{ id: 'x1', restricted: true }],
      }),
    );
    assert.equal(hasCode(projection, 'restricted_assets'), true);
  });

  it('does not fire for ordinary store assets without person', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        sources: [
          {
            id: 's1',
            category: 'store',
            containsPerson: false,
            restricted: false,
          },
        ],
      }),
    );
    assert.equal(hasCode(projection, 'restricted_assets'), false);
  });
});

describe('trigger 5: high_risk_fact_missing_or_conflict', () => {
  it('fires when price is missing', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        highRiskFacts: [{ kind: 'price', status: 'missing' }],
      }),
    );
    assert.equal(
      hasCode(projection, 'high_risk_fact_missing_or_conflict'),
      true,
    );
    assert.equal(projection.requiresBrief, true);
  });

  it('fires when term is conflict', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        highRiskFacts: [{ kind: 'term', status: 'conflict' }],
      }),
    );
    assert.equal(
      hasCode(projection, 'high_risk_fact_missing_or_conflict'),
      true,
    );
  });

  it('fires for effect missing and qualification conflict', () => {
    const missingEffect = projectBriefTrigger(
      simpleInput({
        highRiskFacts: [{ kind: 'effect', status: 'missing' }],
      }),
    );
    const conflictQual = projectBriefTrigger(
      simpleInput({
        highRiskFacts: [{ kind: 'qualification', status: 'conflict' }],
      }),
    );
    assert.equal(
      hasCode(missingEffect, 'high_risk_fact_missing_or_conflict'),
      true,
    );
    assert.equal(
      hasCode(conflictQual, 'high_risk_fact_missing_or_conflict'),
      true,
    );
  });

  it('does not fire when all high-risk facts are present', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        highRiskFacts: [
          { kind: 'price', status: 'present' },
          { kind: 'term', status: 'present' },
          { kind: 'effect', status: 'present' },
          { kind: 'qualification', status: 'present' },
        ],
      }),
    );
    assert.equal(
      hasCode(projection, 'high_risk_fact_missing_or_conflict'),
      false,
    );
  });
});

describe('trigger 6: quote_policy_threshold', () => {
  it('fires when amount >= extraConfirmThreshold', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        quote: {
          quoteRevisionId: 'q@2',
          amount: 100,
          extraConfirmThreshold: 100,
          quotePolicyRevision: 'qp@1',
        },
      }),
    );
    assert.equal(hasCode(projection, 'quote_policy_threshold'), true);
    assert.equal(projection.requiresBrief, true);
  });

  it('fires when amount exceeds threshold', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        quote: {
          quoteRevisionId: 'q@3',
          amount: 250,
          extraConfirmThreshold: 100,
          quotePolicyRevision: 'qp@1',
        },
      }),
    );
    assert.equal(hasCode(projection, 'quote_policy_threshold'), true);
  });

  it('boundary: amount just below threshold does NOT fire', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        quote: {
          quoteRevisionId: 'q@4',
          amount: 99.99,
          extraConfirmThreshold: 100,
          quotePolicyRevision: 'qp@1',
        },
      }),
    );
    assert.equal(hasCode(projection, 'quote_policy_threshold'), false);
  });

  it('does not fire when quote is absent', () => {
    const projection = projectBriefTrigger(simpleInput({ quote: null }));
    assert.equal(hasCode(projection, 'quote_policy_threshold'), false);
  });
});

describe('trigger 7: confirmation_invalid + revision bind re-confirm', () => {
  it('confirm binds exact draft/recipe/model/quote/source revisions', () => {
    const input = simpleInput({
      lensId: 'video',
      deliverableKind: 'short_video',
      currentRevisions: baseRevisions({
        lensId: 'video',
        draftRevisionId: 'draft@9',
        recipeRevisionId: 'recipe.douyin@3',
        modelRevisionId: 'model.vid@2',
        quoteRevisionId: 'quote@7',
        sourceRevisionId: 'src@4',
      }),
    });
    const projection = projectBriefTrigger(input);
    assert.equal(projection.requiresBrief, true);

    const confirmation = confirmBrief({
      projection,
      confirmedAt: '2026-07-20T12:00:00.000Z',
    });
    assert.equal(confirmation.confirmedAt, '2026-07-20T12:00:00.000Z');
    assert.equal(confirmation.boundRevisions.draftRevisionId, 'draft@9');
    assert.equal(
      confirmation.boundRevisions.recipeRevisionId,
      'recipe.douyin@3',
    );
    assert.equal(confirmation.boundRevisions.modelRevisionId, 'model.vid@2');
    assert.equal(confirmation.boundRevisions.quoteRevisionId, 'quote@7');
    assert.equal(confirmation.boundRevisions.sourceRevisionId, 'src@4');
    assert.ok(confirmation.triggerCodes.includes('any_video'));
  });

  it('after confirm with matching revisions → no re-Brief (direct start)', () => {
    const revisions = baseRevisions({ lensId: 'video' });
    const first = projectBriefTrigger(
      simpleInput({
        lensId: 'video',
        deliverableKind: 'short_video',
        currentRevisions: revisions,
      }),
    );
    const confirmation = confirmBrief({ projection: first });

    const again = projectBriefTrigger(
      simpleInput({
        lensId: 'video',
        deliverableKind: 'short_video',
        currentRevisions: revisions,
        confirmedRevisions: confirmation.boundRevisions,
      }),
    );
    assert.equal(again.confirmationValid, true);
    assert.equal(again.confirmationInvalid, false);
    assert.equal(again.requiresBrief, false);
    assert.equal(again.triggers.length, 0);
  });

  it('recipe revision drift → confirmation_invalid re-triggers Brief', () => {
    const confirmed = baseRevisions({
      lensId: 'video',
      recipeRevisionId: 'recipe.douyin@1',
    });
    const current = baseRevisions({
      lensId: 'video',
      recipeRevisionId: 'recipe.douyin@2',
    });
    assert.equal(briefRevisionsMatch(confirmed, current), false);
    assert.equal(isBriefConfirmationInvalid(confirmed, current), true);

    const projection = projectBriefTrigger(
      simpleInput({
        lensId: 'video',
        deliverableKind: 'short_video',
        confirmedRevisions: confirmed,
        currentRevisions: current,
      }),
    );
    assert.equal(projection.confirmationInvalid, true);
    assert.equal(projection.confirmationValid, false);
    assert.equal(projection.requiresBrief, true);
    assert.equal(hasCode(projection, 'confirmation_invalid'), true);
    // Safety trigger still listed for explainability.
    assert.equal(hasCode(projection, 'any_video'), true);
  });

  it('model / quote / source / draft drift each re-trigger', () => {
    const confirmed = baseRevisions();
    const cases: Array<{ field: keyof BriefBoundRevisions; value: string }> = [
      { field: 'draftRevisionId', value: 'draft@drift' },
      { field: 'modelRevisionId', value: 'model@drift' },
      { field: 'quoteRevisionId', value: 'quote@drift' },
      { field: 'sourceRevisionId', value: 'source@drift' },
    ];
    for (const { field, value } of cases) {
      const current = baseRevisions({ [field]: value });
      const projection = projectBriefTrigger(
        simpleInput({
          // Keep simple so only confirmation_invalid fires among safety set.
          confirmedRevisions: confirmed,
          currentRevisions: current,
        }),
      );
      assert.equal(
        projection.requiresBrief,
        true,
        `expected re-brief on ${field} drift`,
      );
      assert.equal(
        hasCode(projection, 'confirmation_invalid'),
        true,
        `expected confirmation_invalid on ${field}`,
      );
    }
  });

  it('surface revision drift also invalidates confirmation', () => {
    const confirmed = baseRevisions({
      surfaceRevisionId: 'surface.home.launch@1',
    });
    const current = baseRevisions({
      surfaceRevisionId: 'surface.home.launch@2',
    });
    const projection = projectBriefTrigger(
      simpleInput({
        confirmedRevisions: confirmed,
        currentRevisions: current,
      }),
    );
    assert.equal(hasCode(projection, 'confirmation_invalid'), true);
    assert.equal(projection.requiresBrief, true);
  });
});

describe('ops config cannot disable safety triggers', () => {
  it('ignores opsDisabledTriggers for any_video', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        lensId: 'video',
        deliverableKind: 'short_video',
        currentRevisions: baseRevisions({ lensId: 'video' }),
        opsDisabledTriggers: [
          'any_video',
          'multi_deliverable_or_cross_platform',
          'images_over_four',
          'restricted_assets',
          'high_risk_fact_missing_or_conflict',
          'quote_policy_threshold',
          'confirmation_invalid',
        ],
      }),
    );
    assert.equal(projection.requiresBrief, true);
    assert.equal(hasCode(projection, 'any_video'), true);
  });

  it('ignores opsDisabledTriggers for restricted_assets and quote threshold', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        sources: [{ id: 'c1', category: 'customer_case' }],
        quote: {
          quoteRevisionId: 'q@9',
          amount: 500,
          extraConfirmThreshold: 100,
          quotePolicyRevision: 'qp@1',
        },
        opsDisabledTriggers: [
          'restricted_assets',
          'quote_policy_threshold',
        ],
      }),
    );
    assert.equal(hasCode(projection, 'restricted_assets'), true);
    assert.equal(hasCode(projection, 'quote_policy_threshold'), true);
    assert.equal(projection.requiresBrief, true);
  });
});

describe('evidence drawer (participating system/source facts only)', () => {
  it('is empty when no facts participate', () => {
    assert.deepEqual(projectEvidenceDrawer(undefined), []);
    assert.deepEqual(projectEvidenceDrawer([]), []);
    const projection = projectBriefTrigger(simpleInput());
    assert.deepEqual(projection.evidenceDrawer, []);
  });

  it('includes system_suggested fact that participates in draft', () => {
    const projection = projectBriefTrigger(
      simpleInput({
        highRiskFacts: [
          {
            kind: 'price',
            status: 'present',
            provenance: 'system_suggested',
            participatesInDraft: true,
            sourceName: '门店价目表',
            sourceType: 'price_list',
            appliedLocation: '正文优惠',
            updatedAt: '2026-07-01T00:00:00.000Z',
            freshness: '19d',
            rightsStatus: 'authorized',
            factSummary: '洗剪吹 88 元',
          },
        ],
      }),
    );
    assert.equal(projection.evidenceDrawer.length, 1);
    assert.equal(projection.evidenceDrawer[0]?.sourceName, '门店价目表');
    assert.equal(projection.evidenceDrawer[0]?.factKind, 'price');
    assert.equal(projection.evidenceDrawer[0]?.appliedLocation, '正文优惠');
  });

  it('includes source_extracted participating fact', () => {
    const entries = projectEvidenceDrawer([
      {
        kind: 'term',
        status: 'present',
        provenance: 'source_extracted',
        participatesInDraft: true,
        sourceName: '活动海报 OCR',
        sourceType: 'image_ocr',
      },
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.sourceType, 'image_ocr');
  });

  it('excludes user_entered facts even when participating', () => {
    const entries = projectEvidenceDrawer([
      {
        kind: 'price',
        status: 'present',
        provenance: 'user_entered',
        participatesInDraft: true,
        sourceName: '用户手填',
        sourceType: 'manual',
      },
    ]);
    assert.equal(entries.length, 0);
  });

  it('excludes system_suggested facts that do NOT participate in draft', () => {
    const entries = projectEvidenceDrawer([
      {
        kind: 'effect',
        status: 'present',
        provenance: 'system_suggested',
        participatesInDraft: false,
        sourceName: '历史案例',
        sourceType: 'memory',
      },
    ]);
    assert.equal(entries.length, 0);
  });

  it('marks conflict/missing as pending confirmation in drawer', () => {
    const entries = projectEvidenceDrawer([
      {
        kind: 'qualification',
        status: 'conflict',
        provenance: 'source_extracted',
        participatesInDraft: true,
        sourceName: '资质库',
        sourceType: 'registry',
      },
    ]);
    assert.equal(entries[0]?.uncertaintyOrConflict, '事实冲突');
    assert.equal(entries[0]?.pendingConfirmation, true);
  });
});

describe('bindRevisions on projection', () => {
  it('projects current revisions for confirm binding', () => {
    const current = baseRevisions({
      draftRevisionId: 'draft@42',
      quoteRevisionId: 'quote@99',
    });
    const projection = projectBriefTrigger(
      simpleInput({ currentRevisions: current, lensId: 'video' }),
    );
    assert.equal(projection.bindRevisions.draftRevisionId, 'draft@42');
    assert.equal(projection.bindRevisions.quoteRevisionId, 'quote@99');
  });
});
