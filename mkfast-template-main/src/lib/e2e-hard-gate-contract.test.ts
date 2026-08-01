/**
 * M-04 / T37 (#231) — what makes the browser gate a gate.
 *
 * Four things are not observable from any single spec run, so they are
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
 *  4. The required image-text direction choice uses a real click, proves the
 *     option state advanced, and never hides a click failure behind the full
 *     journey polling timeout unless a frozen route actually resumes.
 *
 * Issue #257 retired both public Operations actions. Internal application
 * service methods may remain for governed server callers; this file checks only
 * that browser tests do not resurrect the removed public command names.
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
  // uiux-creation-loop.spec.ts left this list on 2026-07-29: its demoted
  // cases were deleted under the approved #242 IA disposition (TEST-CATALOG
  // records each contract owner) and the two surviving journeys are active.
  'specs/uiux-day0-contract.spec.ts',
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

test('the image-text direction helper fails fast on real click errors', () => {
  const fixture = readFileSync(
    join(E2E_ROOT, 'fixtures/ui-journey.ts'),
    'utf8'
  );
  const helper = fixture.slice(
    fixture.indexOf('export async function chooseImageTextDirection'),
    fixture.indexOf('export async function submitComposerJourney')
  );

  assert.doesNotMatch(helper, /force:\s*true/u);
  assert.match(helper, /\.click\(\{ timeout: 3_000 \}\)/u);
  assert.match(helper, /directionSettlementProof\(productionRenderer\)/u);
  assert.match(
    helper,
    /\.toPass\(\s*\{\s*timeout: 300_000,?\s*\}\s*\);[\s\S]*?direction\.click/u,
    'the long poll must finish before the real click is attempted'
  );
  const longPoll = helper.slice(
    helper.indexOf('await expect(async () =>'),
    helper.indexOf('if (\n    await resumedLine')
  );
  assert.doesNotMatch(
    longPoll,
    /\.catch\(\(\) => false\)/u,
    'fatal page or browser errors must escape the long poll immediately'
  );
  assert.match(
    helper,
    /catch \(error\) \{[\s\S]*?resumedLine[\s\S]*?waitFor\(\{ state: 'visible', timeout: 2_000 \}\)[\s\S]*?return;[\s\S]*?throw error;/u,
    'a click error may be ignored only when frozen-route resume becomes visible promptly'
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

test('no browser test writes into the tracked evidence tree', () => {
  // A full local sweep rewrote five committed Pro Studio PNGs before this gate
  // existed. Evidence that changes as a side effect of running tests is not
  // evidence — screenshots go through `fixtures/evidence.ts` into untracked
  // `output/`, and reach `docs/evidence/` only by a deliberate copy.
  const violations = e2eFiles()
    .filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /path:[^\n]*docs\/evidence/u.test(source);
    })
    .map((file) => relative(E2E_ROOT, file));

  assert.deepEqual(
    violations,
    [],
    `these specs write screenshots straight into the tracked evidence tree: ${violations.join(', ')}`
  );
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
