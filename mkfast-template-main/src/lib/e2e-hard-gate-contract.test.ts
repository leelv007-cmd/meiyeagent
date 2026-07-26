/**
 * M-04 / T37 (#231) — what makes the browser gate a gate.
 *
 * Three things are not observable from any single spec run, so they are
 * asserted statically (spec 测试决策 9, the CI assert-matrix precedent):
 *
 *  1. The mainline journey is in the required spec set. A strict spec that
 *     exists but no required job runs is the exact M-04 finding.
 *  2. No test or fixture still listens for the retired
 *     `operations.create_creative_work` / `operations.submit_creative_work`
 *     pair. The Composer has not emitted either since T08 moved submission to
 *     `/api/core/p1/composer/submissions`, so a route interception or a
 *     `waitForResponse` keyed on them can only ever time out — a listening
 *     ghost that reads like coverage.
 *  3. Every old UI spec that was demoted says so in its own header, and none of
 *     them is in the required set. 「删除、归档或显式标注降级」 is only honest
 *     if the marking is machine-checkable.
 *
 * The server still registers both operations and other callers still use them
 * (apps/core `p1/foundation/application-service.ts`,
 * `p1/operations/foundation-module.ts`); retiring those is not this gate's
 * business. This file is about the browser tests only.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const WEB_ROOT = resolve(process.cwd());
const E2E_ROOT = join(WEB_ROOT, 'tests/e2e');
const REQUIRED_JOURNEY_SCRIPT = resolve(
  WEB_ROOT,
  '../scripts/ci/run-pr-production-journey.sh'
);

const HARD_GATE_SPEC = 'tests/e2e/specs/m04-browser-hard-gate.spec.ts';

/** Split so this gate never matches itself. */
const RETIRED_ACTIONS = [
  `create${'_creative_work'}`,
  `submit${'_creative_work'}`,
] as const;

/**
 * A file may still name the retired pair when the mention is not a listener.
 * Both survivors must say so on site with the token below, so a later edit that
 * turns the mention back into a wait has to delete the justification first.
 */
const RETIRED_ACTION_JUSTIFICATION = 'M-04-RETIRED-ACTION-ALLOWED';
const RETIRED_ACTION_ALLOWLIST = new Map([
  [
    'specs/uiux-upgrade-b-video.spec.ts',
    'negative assertion — the native video chain must never emit the retired pair',
  ],
  [
    'fixtures/ui-journey.ts',
    'retirement comment — records why the old two-command wait was deleted',
  ],
]);

/**
 * Specs carrying at least one demoted case — the subject surface was physically
 * removed, so the case cannot pass and must not read as coverage. They are kept
 * for the record rather than deleted (no approved disposition batch covers
 * them), and none of them may re-enter the required set.
 */
const DEMOTION_MARKER = 'M-04 DEMOTED';
const SPECS_WITH_DEMOTED_CASES = [
  'specs/uiux-creation-loop.spec.ts',
  'specs/uiux-upgrade-b-async.spec.ts',
  'specs/uiux-upgrade-b-composer.spec.ts',
  'specs/uiux-upgrade-b-i18n-motion.spec.ts',
  'specs/uiux-upgrade-b-results.spec.ts',
  'specs/uiux-upgrade-b-video.spec.ts',
] as const;

function e2eFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(E2E_ROOT);
  return out;
}

test('the M-04 mainline journey is in the required PR spec set', () => {
  const script = readFileSync(REQUIRED_JOURNEY_SCRIPT, 'utf8');
  assert.ok(
    script.includes(HARD_GATE_SPEC),
    'run-pr-production-journey.sh must run the M-04 hard gate spec'
  );
  assert.match(
    script,
    /required_hard_gate_spec/u,
    'the hard gate spec must be an overridable named variable, like the assembly gate'
  );
});

test('no browser test or fixture listens for the retired creative-work commands', () => {
  const violations: string[] = [];
  for (const file of e2eFiles()) {
    const relativePath = relative(E2E_ROOT, file);
    const source = readFileSync(file, 'utf8');
    const mentioned = RETIRED_ACTIONS.filter((action) =>
      source.includes(action)
    );
    if (mentioned.length === 0) continue;

    const allowed = RETIRED_ACTION_ALLOWLIST.get(relativePath);
    if (!allowed) {
      violations.push(
        `${relativePath}: still names ${mentioned.join(' / ')} — the Composer stopped emitting them at T08, so any wait on them is a listening ghost`
      );
      continue;
    }
    if (!source.includes(RETIRED_ACTION_JUSTIFICATION)) {
      violations.push(
        `${relativePath}: allowed for "${allowed}" but does not carry the ${RETIRED_ACTION_JUSTIFICATION} justification on site`
      );
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('every demoted old UI spec is marked in place and stays out of the required set', () => {
  const requiredScript = readFileSync(REQUIRED_JOURNEY_SCRIPT, 'utf8');
  for (const spec of SPECS_WITH_DEMOTED_CASES) {
    const source = readFileSync(join(E2E_ROOT, spec), 'utf8');
    assert.ok(
      source.includes(DEMOTION_MARKER),
      `${spec} must carry the "${DEMOTION_MARKER}" header so the demotion is visible where the spec is read`
    );
    assert.ok(
      !requiredScript.includes(spec),
      `${spec} is demoted and must not be in the required PR spec set`
    );
  }
});

test('the demotion register is the only place a spec claims to be demoted', () => {
  const registered = new Set<string>(SPECS_WITH_DEMOTED_CASES);
  const unregistered = e2eFiles()
    .filter((file) => readFileSync(file, 'utf8').includes(DEMOTION_MARKER))
    .map((file) => relative(E2E_ROOT, file))
    .filter((relativePath) => !registered.has(relativePath));

  assert.deepEqual(
    unregistered,
    [],
    `these specs mark themselves demoted without joining SPECS_WITH_DEMOTED_CASES: ${unregistered.join(', ')}`
  );
});
