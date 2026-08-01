import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_FRAME_KINDS,
  agentFrameRegistryEntries,
  COMPOSER_SESSION_TURN_KINDS,
  COMPOSER_TIMELINE_TURN_KINDS,
  everySessionTurnKindRegistered,
  everyTimelineTurnKindRegistered,
  resolveAgentFrameKind,
  type AgentFrameKind,
} from './agent-frame-registry';

test('AgentFrame registry is the closed six-family set', () => {
  assert.deepEqual(
    [...AGENT_FRAME_KINDS],
    ['narrative', 'decision', 'plan', 'task', 'result', 'memory']
  );
});

test('every existing session turn kind maps through the registry', () => {
  assert.equal(everySessionTurnKindRegistered(), true);
  for (const kind of COMPOSER_SESSION_TURN_KINDS) {
    const frame = resolveAgentFrameKind(kind);
    assert.ok(
      (AGENT_FRAME_KINDS as readonly string[]).includes(frame),
      `${kind} → ${frame}`
    );
  }
});

test('every timeline turn kind (incl. stages fold) maps through the registry', () => {
  assert.equal(everyTimelineTurnKindRegistered(), true);
  const entries = agentFrameRegistryEntries();
  assert.equal(entries.length, COMPOSER_TIMELINE_TURN_KINDS.length);
  for (const { turnKind, frameKind } of entries) {
    assert.equal(resolveAgentFrameKind(turnKind), frameKind);
  }
});

test('progressive mapping matches the P1-01/P1-07 document-timeline grammar', () => {
  const expected: Record<string, AgentFrameKind> = {
    merchant: 'narrative',
    route_notice: 'narrative',
    stage: 'narrative',
    stages: 'narrative',
    report: 'narrative',
    question: 'decision',
    execution_confirm: 'decision',
    note_plan: 'plan',
    candidate: 'result',
    delivery: 'result',
    terminal: 'task',
  };
  for (const [turnKind, frameKind] of Object.entries(expected)) {
    assert.equal(
      resolveAgentFrameKind(
        turnKind as (typeof COMPOSER_TIMELINE_TURN_KINDS)[number]
      ),
      frameKind
    );
  }
});

test('plan family is claimed by note_plan; memory stays unclaimed', () => {
  assert.ok(AGENT_FRAME_KINDS.includes('plan'));
  assert.ok(AGENT_FRAME_KINDS.includes('memory'));
  const claimed = new Set(
    agentFrameRegistryEntries().map((entry) => entry.frameKind)
  );
  // P1-07: multi-page note outline maps onto plan.
  assert.equal(claimed.has('plan'), true);
  assert.equal(resolveAgentFrameKind('note_plan'), 'plan');
  // memory proposals remain progressive (no turn producer yet).
  assert.equal(claimed.has('memory'), false);
});

test('session turn kind list is exhaustive over ComposerTurn kind (compile + runtime)', () => {
  // Runtime mirror of the Exclude<…> extends never assert in the registry:
  // every registry session kind is a known timeline kind that resolves.
  for (const kind of COMPOSER_SESSION_TURN_KINDS) {
    assert.equal(typeof resolveAgentFrameKind(kind), 'string');
  }
  // P1-05 execution_confirm + P1-07 note_plan.
  assert.equal(COMPOSER_SESSION_TURN_KINDS.length, 10);
});
