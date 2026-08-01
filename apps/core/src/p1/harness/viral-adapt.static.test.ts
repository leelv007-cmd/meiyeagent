/**
 * Viral adapt red-line static assertions (#324 / xhs-spec §5.3).
 *
 * Never: anonymous scrape, signature reverse-engineering, account pools.
 * Pattern references only — do not import or re-home xhswork fetchNote.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const RED_LINE_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: 'anonymous fetchNote scrape',
    pattern: /fetchNote|viralService\.fetch|__INITIAL_STATE__/u,
  },
  {
    name: 'UA spoof / bare HTML scrape',
    pattern: /User-Agent.*xiaohongshu|xsec_token.*scrape|og:\w+.*parse/iu,
  },
  {
    name: 'signature reverse-engineering',
    pattern: /x-s\s*sign|reverse.?engineer.*xhs|xs-common/iu,
  },
  {
    name: 'account pool / cloud login farm',
    pattern: /account.?pool|账号池|cookie.?farm|集中代登/iu,
  },
];

/** Production module only — tests may name banned patterns in assertions. */
const OWNED_FILES = ['viral-adapt.ts'] as const;

/** Strip block/line comments so ban-documentation prose does not trip the gate. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

test('viral-adapt owned sources do not introduce scrape / reverse / pool red lines', () => {
  for (const file of OWNED_FILES) {
    const code = stripComments(readFileSync(join(here, file), 'utf8'));
    for (const { name, pattern } of RED_LINE_PATTERNS) {
      assert.equal(
        pattern.test(code),
        false,
        `${file} must not contain red-line pattern (${name}): ${pattern}`,
      );
    }
  }
});

test('viral-adapt module documents dual-track and never claims OpenCLI always available', () => {
  const source = readFileSync(join(here, 'viral-adapt.ts'), 'utf8');
  assert.match(source, /paste/u);
  assert.match(source, /opencli/iu);
  assert.match(source, /live_gate_unverified/u);
  assert.match(source, /暂不可用/u);
  assert.doesNotMatch(
    source,
    /statusLabel:\s*['"]已可用['"]/u,
  );
});
