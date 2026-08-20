import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

/**
 * #355 — the lens and destination options only exist while their capsule
 * popover is open (`d27a43cc` collapsed the Composer affordances into a bottom
 * capsule bar; `lens-radiogroup.tsx` is mounted by the popover, not by the
 * page). A spec that clicks `composer-lens-option-copy` straight after
 * `goto('/dashboard')` therefore waits for an element that never enters the
 * DOM, and burns its whole timeout before a single assertion runs.
 *
 * That is not a hypothetical: `3cef0ee9` adapted every spec that goes through
 * the `ui-journey` fixtures on the morning after the redesign, and the four
 * that do not were left driving the pre-capsule UI. They read as
 * "pre-existing baseline reds" for four days across three separate waves,
 * because the symptom — a timeout with no assertion attached — looks like a
 * stack or timing problem rather than a stale selector.
 *
 * So the rule is structural rather than per-spec: a file that names a
 * capsule-gated option has to also say how the capsule gets opened. It cannot
 * catch a spec that opens the wrong capsule, but it does catch the failure
 * that actually happened — a whole file that never opens one at all.
 */

const E2E_ROOTS = ['tests/e2e/specs', 'tests/e2e/fixtures'];

/**
 * A file that only *builds* a locator and never drives it is not making the
 * mistake this gate is about, but it still has to say so out loud rather than
 * be listed in a path table here — a silent path list is how an exemption
 * outlives its reason.
 */
const LOCATOR_ONLY_MARKER = 'CAPSULE-GATED-LOCATOR-ONLY';

const RULES = [
  {
    capsule: 'lens',
    option: /composer-lens-option-/u,
    opens:
      /selectComposerLens\(|openComposerCapsule\(\s*page,\s*'lens'\s*\)|composer-capsule-lens/u,
  },
  {
    capsule: 'destination',
    option: /composer-destination-option-/u,
    opens:
      /openComposerCapsule\(\s*page,\s*'destination'\s*\)|composer-capsule-destination|composer-destination-chips/u,
  },
  {
    capsule: 'recipe',
    option: /composer-recipe-card-/u,
    opens:
      /openComposerRecipeCard\(|openComposerCapsule\(\s*page,\s*'recipe'\s*\)|composer-capsule-recipe/u,
  },
] as const;

function e2eSources() {
  const files: Array<{ path: string; source: string }> = [];
  for (const root of E2E_ROOTS) {
    const absolute = resolve(process.cwd(), root);
    const names = readdirSync(absolute).filter((name) => name.endsWith('.ts'));
    // A renamed or moved root would otherwise empty its own scan and pass.
    assert.ok(
      names.length > 0,
      `Scan root ${root} matches no TypeScript file — a moved root empties its own scan.`
    );
    for (const name of names) {
      files.push({
        path: `${root}/${name}`,
        source: readFileSync(resolve(absolute, name), 'utf8'),
      });
    }
  }
  return files;
}

test('every e2e file naming a capsule-gated option also opens that capsule', () => {
  const files = e2eSources();
  const offenders: string[] = [];
  let exercised = 0;

  for (const rule of RULES) {
    for (const file of files) {
      if (!rule.option.test(file.source)) continue;
      if (file.source.includes(LOCATOR_ONLY_MARKER)) continue;
      exercised += 1;
      if (!rule.opens.test(file.source)) {
        offenders.push(`${file.path} (${rule.capsule})`);
      }
    }
  }

  // A rule that matches nothing proves nothing; if the test ids are renamed
  // this gate must fail rather than quietly stop having an opinion.
  assert.ok(
    exercised > 0,
    'No e2e file names a capsule-gated option — the option test ids were probably renamed, and this gate is now blind.'
  );
  assert.deepEqual(
    offenders,
    [],
    `These e2e files drive a capsule-gated option without ever opening its capsule, so the option never mounts and the click waits out the full test timeout:\n  ${offenders.join('\n  ')}`
  );
});

test('idle-face lens and recipe never spend a 更多 click (D-C2 / D-173)', () => {
  const helper = e2eSources().find(
    (file) => file.path === 'tests/e2e/fixtures/ui-journey.ts'
  );
  assert.ok(helper, 'ui-journey helper must stay in the e2e fixture scan');
  const openFn = helper.source.match(
    /export async function openComposerCapsule[\s\S]*?^export async function /mu
  )?.[0];
  assert.ok(openFn, 'openComposerCapsule must remain a named export');
  assert.match(
    openFn,
    /kind === 'attach' \|\| kind === 'mention'/u,
    'only attach/@ fold behind 更多'
  );
  assert.doesNotMatch(
    openFn,
    /kind === 'lens'/u,
    'opening 创作类型 must not click 更多'
  );
  assert.doesNotMatch(
    openFn,
    /kind === 'recipe'/u,
    'opening 配方 must not click 更多'
  );
});

test('Day-0 and FREE still prove composer-quote-line before submit', () => {
  const files = Object.fromEntries(
    e2eSources()
      .filter((file) =>
        /uiux-day0-contract|v31-free-explicit-fact-selector|user-activation/u.test(
          file.path
        )
      )
      .map((file) => [file.path, file.source])
  );
  const day0 = files['tests/e2e/specs/uiux-day0-contract.spec.ts'];
  const free = files['tests/e2e/specs/v31-free-explicit-fact-selector.spec.ts'];
  const activation = files['tests/e2e/fixtures/user-activation.ts'];
  assert.ok(day0 && free && activation);
  assert.match(day0, /getByTestId\('composer-quote-line'\)/u);
  assert.match(day0, /composerSubmitButton\(/u);
  assert.match(day0, /getByTestId\('composer-inline-asset-saved'\)/u);
  assert.match(activation, /getByTestId\('composer-submit'\)/u);
  assert.match(free, /getByTestId\('composer-quote-line'\)/u);
  assert.doesNotMatch(
    free,
    /workbench-credit-quote[\s\S]{0,80}\.or\(/u,
    'FREE quote-before-submit must not weaken to the credit-chip alias'
  );
});

test('the locator-only exemption still describes a real file', () => {
  const exempt = e2eSources().filter((file) =>
    file.source.includes(LOCATOR_ONLY_MARKER)
  );
  // Same reason the roots are checked: an exemption whose last user is gone
  // is an exemption nobody is reading, and it will be inherited by the next
  // file that happens to want it.
  assert.ok(
    exempt.length > 0,
    `No e2e file carries ${LOCATOR_ONLY_MARKER}; drop the exemption rather than leave it available.`
  );
  for (const file of exempt) {
    assert.doesNotMatch(
      file.source,
      /composer-(?:(?:lens|destination)-option|recipe-card)-[^\n]*\)\s*\.\s*click\(\)/u,
      `${file.path} claims ${LOCATOR_ONLY_MARKER} but clicks a capsule-gated affordance.`
    );
  }
});
