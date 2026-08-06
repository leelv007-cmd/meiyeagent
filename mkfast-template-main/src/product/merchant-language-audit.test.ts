/**
 * Merchant-language retirement audit (#336 C6).
 *
 * The three resource buckets (copy / image / video) stopped being the merchant
 * billing unit at D-172 — credits are. The sweep that retired them (#311) left
 * the *language* behind in places nobody was watching: the quota wall still
 * said 额度, the landing still sold 按条数试用额度, and the entitlement
 * projection still hands the browser a `usage.*` shape. This file is the nail
 * that keeps them from coming back.
 *
 * It is deliberately built like the payment-provider retirement audit under
 * `src/payment/` and `allowance-retirement-audit.test.ts`: explicit scan roots,
 * an explicit forbidden-token list, an explicit exemption rule, and `git grep`
 * statuses checked so a broken pathspec fails instead of reading as a pass.
 *
 * ── Fail-closed contract ────────────────────────────────────────────────
 * 1. Every declared root must resolve to at least one tracked file. A root
 *    that was renamed or moved empties its own scan silently otherwise, which
 *    is the exact failure mode this audit exists to prevent.
 * 2. `git grep` exit status must be 0 (hits) or 1 (no hits). Any other status
 *    is a grep failure and fails the test — empty stdout is never a pass.
 * 3. The forbidden-token list and the root list must be non-empty.
 *
 * ── Exemption rule (one mechanism, narrow on purpose) ───────────────────
 * A line may name a retired token only if it carries the marker
 * `RETIRED-METERING`. That marker is for lines whose *subject* is the
 * retirement: contract comments that declare a shape internal/cutover-only,
 * negative assertions that pin a retired string as absent, and this file's own
 * token lists. It is not a mute button — a line that shows 额度 to a merchant
 * and carries the marker is a lie the reviewer can read in the diff.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).trim();

/**
 * Everything a logged-in merchant or a visitor can reach. Admin and ops
 * consoles are deliberately absent — see ADMIN_KEY_PREFIXES for why the same
 * split applies to messages.
 */
const MERCHANT_SOURCE_ROOTS = [
  'mkfast-template-main/src/product',
  'mkfast-template-main/src/components/auth',
  'mkfast-template-main/src/components/chatbox',
  'mkfast-template-main/src/components/contact',
  'mkfast-template-main/src/components/landing',
  'mkfast-template-main/src/components/layout',
  'mkfast-template-main/src/components/markdown',
  'mkfast-template-main/src/components/page',
  'mkfast-template-main/src/components/pricing',
  'mkfast-template-main/src/components/product',
  'mkfast-template-main/src/components/settings',
  'mkfast-template-main/src/components/shared',
  'mkfast-template-main/src/components/theme',
  'mkfast-template-main/src/components/uiux',
  'mkfast-template-main/src/routes/(legals)',
  'mkfast-template-main/src/routes/(pages)',
  'mkfast-template-main/src/routes/dashboard',
  'mkfast-template-main/src/routes/settings',
  'mkfast-template-main/src/routes/index.tsx',
  // Core writes merchant copy too, and the browser renders it verbatim: the
  // report card states plainly that it never re-words Core, so
  // `merchantMessage` on a terminal frame is merchant-visible text. Every
  // `merchantMessage` producer in the repo is under this one directory
  // (checked by the test below), which is why the root can be this narrow
  // without leaving a hole.
  'apps/core/src/p1/harness',
];

/**
 * Declared exclusions, each with the reason it is not a merchant surface:
 *
 * - `src/p1` — mixed namespace. The operations console lives there and is the
 *   one legitimate consumer of the legacy projection
 *   (`merchant-support-diagnostic.ts` reads `entitlement.usage` to explain a
 *   shop's ledger to support staff). Merchant copy in `src/p1` reaches the
 *   screen through messages, which the message rule below covers in full.
 * - `src/components/{ui,reui,heroui-pro,data-table}` — vendored component
 *   libraries, excluded from linting by `biome.json` for the same reason.
 * - `src/components/admin`, `src/routes/admin` — operations console.
 */
const DECLARED_NON_MERCHANT_ROOTS = [
  'mkfast-template-main/src/p1',
  'mkfast-template-main/src/components/ui',
  'mkfast-template-main/src/components/admin',
  'mkfast-template-main/src/routes/admin',
];

/**
 * The merchant billing unit is 积分. These two words are the retired unit, and
 * they are the whole list on purpose: 「张图片」 and 「条视频」 also describe
 * how many pictures a run produces, which is still true and still merchant
 * language. Banning the deliverable count would force the copy to stop saying
 * what the merchant gets; banning the *unit* is what D-172 actually changed.
 */
const FORBIDDEN_UNIT_TOKENS = ['额度', '条数', '三桶'];

/** The one way a line is allowed to name a retired unit. */
const EXEMPTION_MARKER = 'RETIRED-METERING';

/**
 * The legacy three-bucket entitlement projection. `entitlement-module.ts` still
 * answers `usage.copy/image/video/audio` (physical field retirement is a known
 * deferral, xcheck Rev 2 §Out of Scope), so the boundary is enforced here
 * instead: no merchant surface may read it.
 */
const LEGACY_PROJECTION_READS = [
  // `projection.usage.copy.available`
  'usage\\.\\(copy\\|image\\|video\\|audio\\)',
  // `projection.usage[resource]` — the same read, spelled so a dotted-path
  // grep cannot see it. This is how the retired account panel read all four.
  '\\.usage\\[',
];

/** Message namespaces owned by the operations console, not by merchants. */
const ADMIN_KEY_PREFIXES = ['admin_', 'merchant_support_', 'p1_admin_'];

/** Per-bucket redemption inputs the admin console retired for `#redeem-credits`. */
const RETIRED_REDEMPTION_CONTROL_IDS = [
  'redeem-copy',
  'redeem-image',
  'redeem-video',
  'redeem-audio',
];

const AUDIT_SELF =
  'mkfast-template-main/src/product/merchant-language-audit.test.ts';

function trackedFiles(pathspec: string): string[] {
  return execFileSync('git', ['ls-files', '--', pathspec], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

/**
 * `git grep -n` over the declared roots, with the audit itself excluded.
 * Returns the hit lines; throws when grep itself failed.
 */
function grepMerchantSurface(pattern: string, extraFlags: string[] = []) {
  const result = spawnSync(
    'git',
    [
      'grep',
      '--line-number',
      ...extraFlags,
      '--',
      pattern,
      ...MERCHANT_SOURCE_ROOTS,
      `:(exclude)${AUDIT_SELF}`,
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  // Fail closed: 0 = hits, 1 = no hits, anything else = grep error (bad
  // pathspec, git failure). Empty stdout on any other status is not a pass.
  assert.ok(
    result.status === 0 || result.status === 1,
    result.stderr ||
      `git grep ${pattern} failed with status ${String(result.status)}`
  );
  return (result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * A `git grep -n` hit is exempt when the marker is on that line or on the line
 * directly above it. The second case is the common one: the marker belongs in
 * the comment that explains why a retired string is being named, and an
 * 80-column assertion has no room for a trailing one. One line of reach only —
 * far enough to caption the next statement, too short to blanket a block.
 */
function exempt(hit: string): boolean {
  if (hit.includes(EXEMPTION_MARKER)) return true;
  const match = /^(.+?):(\d+):/u.exec(hit);
  if (!match) return false;
  const [, file, lineNumber] = match;
  const index = Number(lineNumber) - 1;
  if (index < 1) return false;
  const lines = readFileSync(resolve(repoRoot, file), 'utf8').split('\n');
  return (lines[index - 1] ?? '').includes(EXEMPTION_MARKER);
}

test('the audit scans a live surface: every declared root is tracked', () => {
  assert.ok(MERCHANT_SOURCE_ROOTS.length > 0, 'no merchant roots declared');
  assert.ok(FORBIDDEN_UNIT_TOKENS.length > 0, 'no forbidden tokens declared');
  for (const root of [
    ...MERCHANT_SOURCE_ROOTS,
    // The declared exclusions are checked too: an exclusion that stopped
    // matching anything is a namespace that moved, and the reason it was
    // excluded no longer describes the tree.
    ...DECLARED_NON_MERCHANT_ROOTS,
  ]) {
    assert.ok(
      trackedFiles(root).length > 0,
      `declared root ${root} matches no tracked file — a renamed root empties its own scan`
    );
  }
  // The audit must be able to see itself, or the exclusion pathspec above is
  // silently excluding nothing and the roots are not what this file thinks.
  assert.equal(
    trackedFiles(AUDIT_SELF).length,
    1,
    `${AUDIT_SELF} is not tracked`
  );
});

test('no merchant surface prices work in the retired 额度 / 条数 unit', () => {
  const offenders: string[] = [];
  for (const token of FORBIDDEN_UNIT_TOKENS) {
    for (const line of grepMerchantSurface(token, ['--fixed-strings'])) {
      if (!exempt(line)) offenders.push(line);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Merchant surfaces still meter in the retired unit (D-172 says 积分). ` +
      `Lines that state the retirement itself may carry ${EXEMPTION_MARKER}:\n` +
      offenders.join('\n')
  );
});

test('no merchant surface reads the legacy three-bucket usage projection', () => {
  const offenders = LEGACY_PROJECTION_READS.flatMap((pattern) =>
    grepMerchantSurface(pattern, ['--basic-regexp'])
  ).filter((line) => !exempt(line));
  assert.deepEqual(
    offenders,
    [],
    `entitlements.projection still answers usage.* for cutover consumers, but no ` +
      `merchant surface may read it (#336 AC3):\n${offenders.join('\n')}`
  );
});

test('the legacy usage shape is declared internal/cutover-only where merchants type it', () => {
  const contract = readFileSync(
    resolve(repoRoot, 'mkfast-template-main/src/product/account-usage.ts'),
    'utf8'
  );
  assert.match(
    contract,
    /internal\/cutover-only/u,
    'AccountUsageProjection.usage must declare itself internal/cutover-only'
  );
  assert.match(
    contract,
    new RegExp(EXEMPTION_MARKER, 'u'),
    'the declaration must carry the audit marker so the boundary is greppable'
  );
});

test('merchant-facing messages speak credits, not the retired unit', () => {
  const messages = ['zh', 'en'].map((locale) => ({
    locale,
    entries: JSON.parse(
      readFileSync(
        resolve(
          repoRoot,
          `mkfast-template-main/project.inlang/messages/${locale}.json`
        ),
        'utf8'
      )
    ) as Record<string, string>,
  }));

  const offenders: string[] = [];
  for (const { locale, entries } of messages) {
    const keys = Object.keys(entries);
    assert.ok(keys.length > 0, `${locale}.json has no messages`);
    for (const [key, value] of Object.entries(entries)) {
      if (ADMIN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      for (const token of FORBIDDEN_UNIT_TOKENS) {
        if (String(value).includes(token)) {
          offenders.push(`${locale}.${key} = ${JSON.stringify(value)}`);
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Merchant-facing messages still meter in the retired unit:\n${offenders.join('\n')}`
  );
});

test('the admin message exemption names live namespaces, not dead ones', () => {
  const zh = JSON.parse(
    readFileSync(
      resolve(repoRoot, 'mkfast-template-main/project.inlang/messages/zh.json'),
      'utf8'
    )
  ) as Record<string, string>;
  // An exemption prefix that matches nothing is either a typo or a namespace
  // that moved — either way the exemption is silently widening the scan.
  for (const prefix of ADMIN_KEY_PREFIXES) {
    assert.ok(
      Object.keys(zh).some((key) => key.startsWith(prefix)),
      `exempt prefix ${prefix} matches no message key`
    );
  }
});

test('every Core merchant message producer is inside the scanned root', () => {
  // The Core root above is narrow, so it is only sound while `merchantMessage`
  // is written nowhere else. A new producer outside it would be merchant text
  // this audit never reads — the silent hole, in a new place.
  const producers = spawnSync(
    'git',
    [
      'grep',
      '--files-with-matches',
      '--fixed-strings',
      // The produced field, not the identifier: `const merchantMessage = …`
      // reading a provider prompt in model-supply is not merchant copy.
      'merchantMessage:',
      '--',
      'apps/core/src',
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.ok(
    producers.status === 0,
    producers.stderr || 'no merchantMessage producer found in apps/core/src'
  );
  const outside = (producers.stdout || '')
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.startsWith('apps/core/src/p1/harness/'));
  assert.deepEqual(
    outside,
    [],
    `Core merchant copy outside the scanned root:\n${outside.join('\n')}`
  );
});

test('the retired per-bucket redemption controls stay retired', () => {
  const active = spawnSync(
    'git',
    [
      'grep',
      '--line-number',
      '--fixed-strings',
      ...RETIRED_REDEMPTION_CONTROL_IDS.flatMap((id) => ['-e', id]),
      '--',
      'mkfast-template-main/src',
      'mkfast-template-main/tests',
      `:(exclude)${AUDIT_SELF}`,
    ],
    { cwd: repoRoot, encoding: 'utf8' }
  );
  assert.ok(
    active.status === 0 || active.status === 1,
    active.stderr ||
      `git grep redemption controls failed (${String(active.status)})`
  );
  const remaining = (active.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !exempt(line));
  assert.deepEqual(
    remaining,
    [],
    `Per-bucket redemption controls were replaced by #redeem-credits:\n${remaining.join('\n')}`
  );
});
