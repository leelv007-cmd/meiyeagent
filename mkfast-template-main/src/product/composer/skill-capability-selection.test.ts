/**
 * Spec E / #380 — pure draft selection + presentation projection.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { SkillCapabilityItemInput } from './skill-capability-selection';
import {
  eligibleSkillRevisionRefs,
  normalizeSelectedSkillRevisionRefs,
  projectSkillCapabilityViews,
  pruneSelectedSkillRevisionRefs,
  toggleSelectedSkillRevisionRef,
  userSelectedSkillRefsForSubmission,
} from './skill-capability-selection';

const SELECTABLE: SkillCapabilityItemInput = {
  skillId: 'skill.story',
  skillRevisionRef: 'skill.story@3',
  title: 'Story structure',
  summary: 'Structured story line for the note.',
  presentationPolicy: 'user_selectable',
  selectionEligible: true,
};

const EXPLAINABLE: SkillCapabilityItemInput = {
  skillId: 'skill.tone',
  skillRevisionRef: 'skill.tone@1',
  title: 'Tone polish',
  summary: 'Closer to storefront voice.',
  presentationPolicy: 'explainable',
  selectionEligible: false,
};

const BACKEND_ONLY: SkillCapabilityItemInput = {
  skillId: 'skill.hidden',
  skillRevisionRef: 'skill.hidden@9',
  title: 'Hidden backend pack',
  summary: 'Must never render.',
  presentationPolicy: 'backend_only',
  selectionEligible: false,
};

test('normalizeSelectedSkillRevisionRefs dedupes and sorts stably', () => {
  assert.deepEqual(
    normalizeSelectedSkillRevisionRefs([
      'skill.b@1',
      'skill.a@2',
      'skill.b@1',
      '  ',
      'skill.a@2',
    ]),
    ['skill.a@2', 'skill.b@1']
  );
  assert.deepEqual(normalizeSelectedSkillRevisionRefs([]), []);
});

test('eligibleSkillRevisionRefs only admits user_selectable selectionEligible', () => {
  const eligible = eligibleSkillRevisionRefs([
    SELECTABLE,
    EXPLAINABLE,
    BACKEND_ONLY,
    { ...SELECTABLE, skillId: 'skill.off', selectionEligible: false },
  ]);
  assert.equal(eligible.has('skill.story@3'), true);
  assert.equal(eligible.has('skill.tone@1'), false);
  assert.equal(eligible.has('skill.hidden@9'), false);
  assert.equal(eligible.has('skill.off@3'), false);
});

test('toggleSelectedSkillRevisionRef selects then cancels; rejects ineligible', () => {
  const eligible = eligibleSkillRevisionRefs([SELECTABLE, EXPLAINABLE]);
  let selected = toggleSelectedSkillRevisionRef([], 'skill.story@3', eligible);
  assert.deepEqual(selected, ['skill.story@3']);

  selected = toggleSelectedSkillRevisionRef(
    selected,
    'skill.story@3',
    eligible
  );
  assert.deepEqual(selected, []);

  // explainable / foreign refs never enter the set
  assert.deepEqual(
    toggleSelectedSkillRevisionRef([], 'skill.tone@1', eligible),
    []
  );
  assert.deepEqual(
    toggleSelectedSkillRevisionRef([], 'skill.foreign@1', eligible),
    []
  );
});

test('projectSkillCapabilityViews: three policies positive + negative', () => {
  const views = projectSkillCapabilityViews(
    [BACKEND_ONLY, EXPLAINABLE, SELECTABLE],
    []
  );

  // backend_only: negative — not rendered
  assert.equal(
    views.some((view) => view.skillId === 'skill.hidden'),
    false
  );

  // explainable: positive — readonly chip; negative — not toggleable / not selected
  const explainable = views.find((view) => view.skillId === 'skill.tone');
  assert.ok(explainable);
  assert.equal(explainable.kind, 'explainable');
  assert.equal(explainable.toggleable, false);
  assert.equal(explainable.selected, false);

  // user_selectable: positive — toggleable pill; negative unselected
  const selectable = views.find((view) => view.skillId === 'skill.story');
  assert.ok(selectable);
  assert.equal(selectable.kind, 'user_selectable');
  assert.equal(selectable.toggleable, true);
  assert.equal(selectable.selected, false);

  // positive selected
  const selectedViews = projectSkillCapabilityViews(
    [SELECTABLE],
    ['skill.story@3']
  );
  assert.equal(selectedViews[0]?.selected, true);
});

test('unselected negative: refs never enter submission payload', () => {
  assert.deepEqual(
    userSelectedSkillRefsForSubmission([], [SELECTABLE, EXPLAINABLE]),
    []
  );
  // explainable selected in draft by accident still drops
  assert.deepEqual(
    userSelectedSkillRefsForSubmission(
      ['skill.tone@1', 'skill.hidden@9'],
      [SELECTABLE, EXPLAINABLE, BACKEND_ONLY]
    ),
    []
  );
});

test('selected positive then cancel removes from submission payload', () => {
  const eligible = eligibleSkillRevisionRefs([SELECTABLE]);
  let selected = toggleSelectedSkillRevisionRef([], 'skill.story@3', eligible);
  assert.deepEqual(
    userSelectedSkillRefsForSubmission(selected, [SELECTABLE]),
    ['skill.story@3']
  );
  selected = toggleSelectedSkillRevisionRef(selected, 'skill.story@3', eligible);
  assert.deepEqual(
    userSelectedSkillRefsForSubmission(selected, [SELECTABLE]),
    []
  );
});

test('prune drops ineligible refs after projection refresh', () => {
  assert.deepEqual(
    pruneSelectedSkillRevisionRefs(
      ['skill.story@3', 'skill.gone@1'],
      eligibleSkillRevisionRefs([SELECTABLE])
    ),
    ['skill.story@3']
  );
});
