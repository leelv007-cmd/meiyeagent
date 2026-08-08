/**
 * V31-10 plan surface registry contract — only this ticket's keys.
 * Negative gates remain V31-04 ownership (unregistered / className / html).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __resetControlledSurfaceRegistryForTests,
  listRegisteredSurfaces,
  resolveControlledSurface,
} from '../controlled-surface-registry';
import {
  AGENT_PLAN_SURFACE_KEYS,
  __resetPlanSurfaceRegistrationForTests,
  registerPlanSurfaces,
} from './register-plan-surfaces';

test('registerPlanSurfaces installs living_plan + plan_section + plan_diff + compact_plan + commit_strip', () => {
  __resetControlledSurfaceRegistryForTests();
  __resetPlanSurfaceRegistrationForTests();
  registerPlanSurfaces();

  const keys = listRegisteredSurfaces();
  for (const key of AGENT_PLAN_SURFACE_KEYS) {
    assert.ok(keys.includes(key), `expected registered surface ${key}`);
    const ok = resolveControlledSurface({
      surface: key,
      props: {},
    });
    assert.equal(ok.ok, true, `${key} should resolve`);
  }
});

test('plan surfaces still reject className / html / action (negative gates unchanged)', () => {
  __resetControlledSurfaceRegistryForTests();
  __resetPlanSurfaceRegistrationForTests();
  registerPlanSurfaces();

  const badClass = resolveControlledSurface({
    surface: 'living_plan',
    props: { planId: 'p1', className: 'evil' },
  });
  assert.equal(badClass.ok, false);
  if (!badClass.ok) assert.equal(badClass.reason, 'forbidden_className');

  const badHtml = resolveControlledSurface({
    surface: 'plan_section',
    props: { sectionKey: 'goal', title: '目标', html: '<b>x</b>' },
  });
  assert.equal(badHtml.ok, false);
  if (!badHtml.ok) assert.equal(badHtml.reason, 'forbidden_html');

  const badAction = resolveControlledSurface({
    surface: 'commit_strip',
    props: { statusLine: 'x', action: 'shell' },
  });
  assert.equal(badAction.ok, false);
  if (!badAction.ok) assert.equal(badAction.reason, 'forbidden_action');
});

test('living_plan_section stays unregistered (V31-04 negative example untouched)', () => {
  __resetControlledSurfaceRegistryForTests();
  __resetPlanSurfaceRegistrationForTests();
  registerPlanSurfaces();
  const result = resolveControlledSurface({
    surface: 'living_plan_section',
    props: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'unregistered_surface');
});
