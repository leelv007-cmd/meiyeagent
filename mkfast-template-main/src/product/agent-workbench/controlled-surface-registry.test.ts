/**
 * V31-04 Controlled Surface Registry negative gates (V3.1 §0.5 / §28.4 / §37.1).
 * Unregistered surface / arbitrary HTML / className / component / action → reject.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_FOUNDATION_SURFACE_KEYS,
  isSurfaceRequestRejected,
  registerAgentSurface,
  resolveControlledSurface,
  type AgentSurfaceKey,
} from './controlled-surface-registry';

test('foundation registry only ships narrative + activity in V31-04', () => {
  assert.deepEqual([...AGENT_FOUNDATION_SURFACE_KEYS], ['narrative', 'activity']);
});

test('registered foundation surfaces resolve', () => {
  for (const key of AGENT_FOUNDATION_SURFACE_KEYS) {
    const result = resolveControlledSurface({ surface: key, props: {} });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.surface, key);
    }
  }
});

test('§37.1: unregistered component surface is rejected', () => {
  const result = resolveControlledSurface({
    surface: 'living_plan_section',
    props: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'unregistered_surface');
  }
  assert.equal(
    isSurfaceRequestRejected({ surface: 'inline_choice', props: {} }),
    true
  );
});

test('§0.5 / §28.4: arbitrary className is rejected', () => {
  const result = resolveControlledSurface({
    surface: 'narrative',
    props: { text: 'ok', className: 'evil-style' },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'forbidden_className');
  }
});

test('§0.5: arbitrary HTML is rejected', () => {
  const result = resolveControlledSurface({
    surface: 'narrative',
    props: { html: '<img src=x onerror=alert(1)>' },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'forbidden_html');
  }
});

test('§0.5: arbitrary component name is rejected', () => {
  const result = resolveControlledSurface({
    surface: 'activity',
    props: { component: 'DangerousWidget' },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'forbidden_component');
  }
});

test('§0.5: unregistered / arbitrary action is rejected', () => {
  const result = resolveControlledSurface({
    surface: 'narrative',
    props: { action: 'shell_exec' },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'forbidden_action');
  }
});

test('§0.5: javascript: / data: URL style props are rejected', () => {
  const js = resolveControlledSurface({
    surface: 'narrative',
    props: { href: 'javascript:alert(1)' },
  });
  assert.equal(js.ok, false);
  if (!js.ok) {
    assert.equal(js.reason, 'forbidden_url');
  }

  const data = resolveControlledSurface({
    surface: 'activity',
    props: { src: 'data:text/html,<script>1</script>' },
  });
  assert.equal(data.ok, false);
  if (!data.ok) {
    assert.equal(data.reason, 'forbidden_url');
  }
});

test('later tickets may register their own surfaces via registerAgentSurface', () => {
  registerAgentSurface('assumption' as AgentSurfaceKey, {
    allowedPropKeys: ['text'],
  });
  const ok = resolveControlledSurface({
    surface: 'assumption',
    props: { text: '假设门店在周末客流更高' },
  });
  assert.equal(ok.ok, true);

  // still reject forbidden keys on newly registered surface
  const bad = resolveControlledSurface({
    surface: 'assumption',
    props: { text: 'x', className: 'nope' },
  });
  assert.equal(bad.ok, false);
});
