/**
 * V31-77 — day-0 spec files may not walk the journey behind the submit-gate seed.
 *
 * `seedComposerInlineAuthorize` (V31-54) authorizes an inline asset so a spec
 * can get past the composer submit gate. For a day-0 / first-visit journey that
 * seed IS the thing under test: V31-73's deterministic dead end stayed
 * invisible under a fully green browser suite because every day-0 walk arrived
 * with the gate already satisfied. Retro R1 (2026-08-13) turns that
 * comment-level convention into a contract that fails closed.
 *
 * The manifest is explicit on purpose — same philosophy as the `v31_specs`
 * catalog in `scripts/ci/run-v31-browser-acceptance.sh`: a new exemption has to
 * edit this list and leave a ticket trail, it can never drift in silently.
 * A mention inside a comment is not a call, so comments are stripped first;
 * the zero-source spec's own header warns about the helper by name.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const E2E_ROOT = join(resolve(process.cwd()), 'tests/e2e');
const SEED_HELPER = 'seedComposerInlineAuthorize';

/** Day-0 / first-visit journeys. Adding an exemption must edit this list. */
const DAY0_SPECS = [
  'v31-zero-source-image-text-first-visit.spec.ts',
  'v31-day0-free-creation-journey.spec.ts',
  'uiux-creation-loop.spec.ts',
  'dashboard-home-mount.spec.ts',
];

/**
 * D7=A: required paid journeys that pass the submit gate must earn sources
 * the merchant way (library pick), not via seedComposerInlineAuthorize.
 */
const PAID_SUBMIT_SPECS = [
  'v31-living-plan-journey.spec.ts',
  'v31-video-paid-execution-journey.spec.ts',
  'v31-context-fence-journey.spec.ts',
  'v31-rights-revocation-journey.spec.ts',
  'v31-mid-run-steering-journey.spec.ts',
  'v31-interrupt-resume-journey.spec.ts',
  'v31-publish-handoff-selfreport.spec.ts',
  'v31-artifact-growth-journey.spec.ts',
  'v31-partial-resume-assisted-journey.spec.ts',
  'v31-ops-console-release-journey.spec.ts',
];

function specSource(name: string): string {
  return readFileSync(join(E2E_ROOT, 'specs', name), 'utf8');
}

/** Drop line + block comments so the scan reads code, not historical notes. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1');
}

test('the day-0 manifest names spec files that exist', () => {
  for (const name of DAY0_SPECS) {
    assert.ok(
      specSource(name).length > 0,
      `${name} is in the day-0 manifest but is empty or missing`
    );
  }
});

test('the seed helper this contract bans still exists', () => {
  // Without this the contract goes vacuously green the day the helper is
  // renamed, which is exactly when day-0 masking could return unnoticed.
  const fixture = readFileSync(join(E2E_ROOT, 'fixtures/product.ts'), 'utf8');
  assert.match(
    fixture,
    new RegExp(`export async function ${SEED_HELPER}\\b`, 'u')
  );
});

test('no day-0 spec imports or calls the submit-gate seed', () => {
  for (const name of DAY0_SPECS) {
    const code = withoutComments(specSource(name));
    assert.ok(
      !code.includes(SEED_HELPER),
      `${name} reaches the composer through ${SEED_HELPER}; a day-0 journey has to earn the submit gate the way a new merchant does`
    );
  }
});

test('the paid-submit manifest names spec files that exist', () => {
  for (const name of PAID_SUBMIT_SPECS) {
    assert.ok(
      specSource(name).length > 0,
      `${name} is in the paid-submit manifest but is empty or missing`
    );
  }
});

test('no required paid submit spec calls the submit-gate seed', () => {
  for (const name of PAID_SUBMIT_SPECS) {
    const code = withoutComments(specSource(name));
    assert.ok(
      !code.includes(SEED_HELPER),
      `${name} still calls ${SEED_HELPER}; D7 requires library pick / real attach`
    );
  }
});
