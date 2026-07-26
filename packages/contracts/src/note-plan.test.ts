import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_NOTE_STYLE_COUNT,
  MAX_NOTE_PLAN_PAGE_COUNT,
  MIN_NOTE_PLAN_PAGE_COUNT,
  NOTE_PLAN_CONSISTENCY_DIMENSIONS,
  NOTE_PLAN_PAGE_PURPOSES,
  NOTE_PLAN_PAGE_ROLES,
  notePlanConsistencyEvaluationSchema,
  notePlanSchema,
  noteStyleCandidatesSchemaFor,
} from './note-plan.js';

test('NotePlan v1 freezes the full page-level contract', () => {
  const plan = notePlanSchema.parse(notePlanFixture(['cover', 'cta_guide']));

  assert.equal(plan.schema, 'note-plan/v1');
  assert.equal(plan.themeAnchor, '夏日护理先看真实需求');
  assert.deepEqual(NOTE_PLAN_PAGE_ROLES, [
    'cover',
    'pain_scene',
    'solution_show',
    'work_case',
    'price_offer',
    'cta_guide',
  ]);
  assert.deepEqual(NOTE_PLAN_PAGE_PURPOSES, [
    'capture_attention',
    'name_customer_pain',
    'explain_solution',
    'prove_with_case',
    'present_offer',
    'drive_action',
  ]);
  assert.equal(plan.pages[0]?.imageIntent.outputPlan.kind, 'single');
  assert.deepEqual(plan.pages[1]?.dependencies, [
    { pageId: 'page-1', kind: 'text_sequence' },
  ]);
});

test('NotePlan permits semantic page composition instead of a fixed page count', () => {
  assert.equal(MIN_NOTE_PLAN_PAGE_COUNT, 2);
  assert.equal(MAX_NOTE_PLAN_PAGE_COUNT, 12);
  const exposure = notePlanSchema.parse(
    notePlanFixture(['cover', 'solution_show', 'cta_guide']),
  );
  const conversion = notePlanSchema.parse(
    notePlanFixture([
      'cover',
      'pain_scene',
      'solution_show',
      'price_offer',
      'cta_guide',
    ]),
  );

  assert.notDeepEqual(
    exposure.pages.map(({ pageRole }) => pageRole),
    conversion.pages.map(({ pageRole }) => pageRole),
  );
});

test('style candidate schemas require the exact configured count', () => {
  const schema = noteStyleCandidatesSchemaFor(DEFAULT_NOTE_STYLE_COUNT);
  const candidate = (styleId: string) => ({
    styleId,
    styleName: styleId,
    positioning: `${styleId}定位`,
    plan: notePlanFixture(['cover', 'cta_guide'], styleId),
  });

  assert.equal(
    schema.safeParse({ candidates: [candidate('facts'), candidate('story')] })
      .success,
    true,
  );
  assert.equal(
    schema.safeParse({ candidates: [candidate('facts')] }).success,
    false,
  );
  assert.equal(
    schema.safeParse({
      candidates: [
        candidate('facts'),
        candidate('story'),
        candidate('extra'),
      ],
    }).success,
    false,
  );
});

test('consistency evaluation freezes all five dimensions exactly once', () => {
  const evaluation = {
    evaluatedAt: '2026-07-26T00:00:00.000Z',
    dimensions: NOTE_PLAN_CONSISTENCY_DIMENSIONS.map((dimension) => ({
      dimension,
      passed: true,
      reason: `${dimension}通过`,
      pageIds: [],
    })),
    regenerationPageIds: [],
  };

  assert.equal(
    notePlanConsistencyEvaluationSchema.safeParse(evaluation).success,
    true,
  );
  assert.equal(
    notePlanConsistencyEvaluationSchema.safeParse({
      ...evaluation,
      dimensions: evaluation.dimensions.map((item) => ({
        ...item,
        dimension: 'theme_continuity',
      })),
    }).success,
    false,
  );
});

function notePlanFixture(
  roles: Array<(typeof NOTE_PLAN_PAGE_ROLES)[number]>,
  styleId = 'facts',
) {
  const purposeByRole = {
    cover: 'capture_attention',
    pain_scene: 'name_customer_pain',
    solution_show: 'explain_solution',
    work_case: 'prove_with_case',
    price_offer: 'present_offer',
    cta_guide: 'drive_action',
  } as const;
  return {
    schema: 'note-plan/v1',
    themeAnchor: '夏日护理先看真实需求',
    style: {
      id: styleId,
      name: styleId,
      positioning: `${styleId}定位`,
    },
    pages: roles.map((pageRole, index) => {
      const exactText = pageRole === 'price_offer' ? ['活动价 398 元'] : [];
      return {
        id: `page-${index + 1}`,
        order: index + 1,
        revision: 1,
        pageRole,
        pagePurpose: purposeByRole[pageRole],
        imageIntent: {
          operation: 'image.generate',
          purpose: `${pageRole}配图`,
          subject: '门店护理项目',
          scene: '真实门店场景',
          composition: '主体清晰',
          references: [],
          exactText: exactText.map((text) => ({
            text,
            treatment: 'exact',
          })),
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' },
        },
        textBlock: {
          title: `${pageRole}标题`,
          body: `${pageRole}正文`,
          exactText,
        },
        dependencies:
          index === 0
            ? []
            : [{ pageId: `page-${index}`, kind: 'text_sequence' }],
      };
    }),
  };
}
