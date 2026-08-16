/**
 * FIND-B-004 — the merchant copy for a refused start lives in two places on
 * purpose, and this test is the reason that is safe.
 *
 * The contract this module enforces is "白名单外永不渲染上游 message": a string
 * from Core never reaches a merchant unless it has been mapped here. That rules
 * out simply forwarding Core's message, so the fifteen COMPOSER_PLAN_START_*
 * lines are copied into CODE_COPY — and a copy can drift.
 *
 * So this reads Core's own sources and fails if the two ever disagree. If Core
 * adds a sixteenth refusal, or reworded an existing one, this goes red with the
 * offending code named, instead of a merchant quietly getting the generic
 * COMPOSER_PLAN_START_FAILED line for a reason we already know how to explain.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { CODE_COPY } from './merchant-p1-error';

const CORE_SOURCES = [
  '../apps/core/src/p1/execution-spine/submission-coordinator.ts',
  '../apps/core/src/p1/agent-session/composer-plan-session.ts',
];

/**
 * The two Core files disagree on quote style, so this accepts either. It reads
 * the throw site rather than the union type, because the union only proves a
 * code is spelled somewhere — the merchant copy is on the throw.
 */
const REFUSAL =
  /ComposerPlanStartRefusedError\(\s*['"](COMPOSER_PLAN_START_[A-Z_]+)['"]\s*,\s*['"]([^'"]+)['"]/gsu;

function coreRefusals(): Map<string, string> {
  const found = new Map<string, string>();
  for (const relative of CORE_SOURCES) {
    const source = readFileSync(resolve(process.cwd(), relative), 'utf8');
    for (const [, code, message] of source.matchAll(REFUSAL)) {
      const previous = found.get(code!);
      assert.ok(
        previous === undefined || previous === message,
        `Core throws ${code} with two different messages; pick one`
      );
      found.set(code!, message!);
    }
  }
  return found;
}

test('every Core start refusal has merchant copy here, word for word', () => {
  const refusals = coreRefusals();
  assert.ok(
    refusals.size >= 15,
    `expected at least the fifteen coded refusals, found ${refusals.size} — ` +
      'if the throw sites were reformatted, fix this regex rather than the count'
  );
  const missing: string[] = [];
  const drifted: string[] = [];
  for (const [code, coreMessage] of refusals) {
    const mapped = CODE_COPY[code];
    if (mapped === undefined) {
      missing.push(code);
    } else if (mapped !== coreMessage) {
      drifted.push(`${code}\n    core: ${coreMessage}\n    ui:   ${mapped}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Core refuses with codes this UI cannot explain:\n  ${missing.join('\n  ')}`
  );
  assert.deepEqual(
    drifted,
    [],
    `merchant copy drifted from Core:\n  ${drifted.join('\n  ')}`
  );
});

test('the mapped start copy stays merchant-facing: no internals, no English', () => {
  for (const [code, copy] of Object.entries(CODE_COPY)) {
    if (!code.startsWith('COMPOSER_PLAN_START_')) continue;
    // The same two rules merchantMessageFromP1 applies to unmapped upstream
    // text. Mapping a string bypasses those checks, so assert them here — a
    // whitelist that can itself carry `planId=...` is not a whitelist.
    assert.doesNotMatch(
      copy,
      /admitted|composer-task:|ExecutionPlanSnapshot|snapshotHash/iu,
      `${code} leaks an internal term`
    );
    assert.doesNotMatch(copy, /[A-Za-z]{4,}/u, `${code} contains English`);
  }
});
