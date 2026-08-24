/**
 * V31-29 — shared fixture honesty contracts for `ui-journey.ts`.
 *
 * Three assertions used to report "the product did not happen" as a green
 * journey. Two required CI jobs call through this fixture, so a hermetic
 * source contract keeps the honesty rules from rotting without a full browser
 * lane. Browser evidence for AC6 still requires the required jobs on a
 * healthy host — this file does not claim that.
 *
 * Contracts (fail closed):
 *  1. `chooseImageTextDirection` never treats terminal failure as success.
 *  2. `waitForResultJourney` image_text generating path requires
 *     `image-worksurface` alone (no `.or(merchantStatus)` no-op).
 *  3. The one-question step is deterministic: card must appear, must be open
 *     on arrival, click must settle it — no resumed early-return skip path.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';

const E2E_ROOT = join(resolve(process.cwd()), 'tests/e2e');
const FIXTURE = join(E2E_ROOT, 'fixtures/ui-journey.ts');

function fixtureSource(): string {
  return readFileSync(FIXTURE, 'utf8');
}

/** Drop line + block comments so anti-pattern scans ignore historical notes. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/[^\n]*/gu, '$1');
}

function sliceHelper(
  source: string,
  startMarker: string,
  endMarker: string
): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing helper start: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing helper end: ${endMarker}`);
  return source.slice(start, end);
}

function chooseImageTextDirectionBody(source: string): string {
  return sliceHelper(
    source,
    'export async function chooseImageTextDirection',
    'export async function submitComposerJourney'
  );
}

function waitForResultJourneyBody(source: string): string {
  return sliceHelper(
    source,
    'export async function waitForResultJourney',
    'function mutationResponse'
  );
}

function imageTextGeneratingBranch(waitBody: string): string {
  const start = waitBody.indexOf("contract.modality === 'image_text'");
  assert.notEqual(start, -1, 'waitForResultJourney must branch on image_text');
  const end = waitBody.indexOf(
    'await expect(merchantStatus).toContainText',
    start
  );
  assert.notEqual(
    end,
    -1,
    'image_text generating branch must end before final merchant ready assert'
  );
  return waitBody.slice(start, end);
}

test('① chooseImageTextDirection fails closed on terminal failure after answer', () => {
  const helper = chooseImageTextDirectionBody(fixtureSource());
  const code = withoutComments(helper);

  // Failure may be observed for racing / incremental count — never as success.
  assert.match(
    helper,
    /const terminalFailure\s*=/u,
    'terminal failure locator is still needed to race and name the failure'
  );
  assert.doesNotMatch(
    code,
    /\.or\(\s*terminalFailure\s*\)/u,
    'terminalFailure must not join the success visibility set via .or()'
  );
  assert.doesNotMatch(
    code,
    /monotonic downstream state/u,
    'D-150③: wording that covers failure as a valid ending is banned'
  );
  assert.match(
    helper,
    /failuresBeforeAnswer\s*=\s*await terminalFailure\.count\(\)/u,
    'pre-answer failure count isolates new failures from leftover report cards'
  );
  assert.match(
    helper,
    /Promise\.race\s*\(/u,
    'race continued vs new-failure so a failed run is reported when it fails'
  );
  assert.match(
    helper,
    /if \(outcome === 'failed'\) \{[\s\S]*?throw new Error\([\s\S]*?terminal failure/u,
    'a new terminal failure after the merchant answer must throw with report text'
  );
  assert.match(
    helper,
    /if \(outcome === null\) \{[\s\S]*?throw new Error/u,
    'neither continued nor failed within budget must also throw (not soft-pass)'
  );
  assert.match(
    code,
    /resumedLine[\s\S]*?\.or\(\s*executionConfirmation\s*\)/u,
    'success set is only resumed stage line or execution confirmation'
  );
});

test('② waitForResultJourney image_text generating path requires worksurface alone', () => {
  const branch = imageTextGeneratingBranch(
    waitForResultJourneyBody(fixtureSource())
  );
  const code = withoutComments(branch);

  assert.doesNotMatch(
    code,
    /\.or\(\s*merchantStatus\s*\)/u,
    'V31-29: merchantStatus is already visible above; .or(merchantStatus) is a no-op'
  );
  assert.match(
    code,
    /getByTestId\(\s*['"]image-worksurface['"]\s*\)/u,
    'generating path must require image-worksurface on its own'
  );
  assert.match(
    branch,
    /image_text generating path must keep Result visible until ready/u,
    'assertion message must name the worksurface visibility contract'
  );
  // observedRunning arm is the one that used to no-op; keep it strict.
  const runningArm = branch.slice(
    branch.indexOf('if (observedRunning)'),
    branch.indexOf('} else {')
  );
  const runningCode = withoutComments(runningArm);
  assert.match(
    runningCode,
    /toBeVisible\(\s*\{\s*timeout:\s*120_000/u,
    'generating path must wait on worksurface with the long budget'
  );
  assert.doesNotMatch(
    runningCode,
    /\.or\(/u,
    'generating arm must not disjoin any already-true locator'
  );
});

test('③ one-question path is deterministic: card required, open, then settled by click', () => {
  const helper = chooseImageTextDirectionBody(fixtureSource());
  const code = withoutComments(helper);

  assert.doesNotMatch(
    code,
    /resumed\s*\|\|/u,
    'no resumed||cardVisible soft gate that skips the merchant question'
  );
  assert.doesNotMatch(
    code,
    /if\s*\(\s*resumed\s*\)\s*return/u,
    'no early return when a resume line is already visible'
  );
  // Zero bare early returns in the helper body (async function itself ends only).
  assert.doesNotMatch(
    code,
    /^\s*return\s*;/mu,
    'V31-29: chooseImageTextDirection must not early-return past the answer'
  );
  assert.match(
    helper,
    /the run must ask its one 图文方向 question and wait for the merchant/u,
    'direction card visibility is required, not optional'
  );
  assert.match(
    helper,
    /toBeVisible\(\{\s*timeout:\s*300_000\s*\}\)/u,
    'direction card has a real long-poll before any click'
  );
  assert.match(
    helper,
    /the 图文方向 question must still be open when the merchant answers it/u,
    'arrival must prove the card is still unsettled'
  );
  assert.match(
    helper,
    /\.not\.toHaveAttribute\(\s*settlementProof\.attribute,\s*settlementProof\.value\s*\)/u,
    'pre-click settlement attribute must be absent'
  );
  assert.match(
    helper,
    /direction\.click\(\{\s*timeout:\s*15_000\s*\}\)/u,
    'real click after enablement — no force skip'
  );
  // Post-click the settlement is witnessed as 「answered or consumed」: the
  // pressed state lives in a card the product unmounts the moment Core reports
  // the request resolved, so on a slow renderer the attribute frame may never
  // paint (V31-105 §19). The witness must still read the SAME subject's
  // settlement attribute, must treat a still-open card as failure, and may
  // accept consumption only by counting the card itself.
  assert.match(
    helper,
    /settlementSubject\s*\.getAttribute\(settlementProof\.attribute/u,
    'post-click settlement must be read from the same subject'
  );
  assert.match(
    code,
    /=== settlementProof\.value \? 'answered' : 'open'/u,
    'settlement value must map to answered, anything else stays open'
  );
  assert.match(
    code,
    /activeDirectionCard\.count\(\)\)\s*===\s*0\)\s*return 'consumed'/u,
    'consumption may only be proven by the card itself being gone'
  );
  assert.match(
    code,
    /\.not\.toBe\('open'\)/u,
    'an open, unanswered question must fail the journey'
  );
  assert.doesNotMatch(
    code,
    /catch\s*\(\s*error\s*\)/u,
    'failed click must fail the journey; no frozen-route swallow'
  );
});

test('V31-29 honesty messages stay fail-closed (no success-via-failure wording)', () => {
  const helper = chooseImageTextDirectionBody(fixtureSource());
  assert.doesNotMatch(helper, /monotonic downstream state/iu);
  assert.match(
    helper,
    /reported a terminal failure instead of[\s\S]*?continuing the run/u
  );
  assert.match(
    helper,
    /reached neither a resumed run nor the execution[\s\S]*?confirmation/u
  );
});
