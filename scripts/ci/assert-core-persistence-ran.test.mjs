import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const assertionScript = fileURLToPath(
  new URL('./assert-core-persistence-ran.mjs', import.meta.url),
);
const smokeName =
  'production DBOS registration launches and delivers one five-stage workflow';

for (const reporter of ['TAP', 'spec']) {
  for (const smokeResult of ['passed', 'skipped']) {
    for (const skipped of [6, 48]) {
      const shouldPass = smokeResult === 'passed' && skipped === 6;

      test(`${reporter} | smoke ${smokeResult} | skipped ${skipped} -> ${shouldPass ? 'pass' : 'fail'}`, () => {
        const result = spawnSync(process.execPath, [assertionScript, '-'], {
          encoding: 'utf8',
          input: createReport({ reporter, skipped, smokeResult }),
        });

        assert.equal(result.status, shouldPass ? 0 : 1, result.stderr);
        if (!shouldPass) {
          assert.match(
            result.stderr,
            skipped === 48
              ? /expected at most 26 skipped tests, got 48/u
              : /DBOS registration smoke did not report a passing result/u,
          );
        }
      });
    }
  }
}

function createReport({ reporter, skipped, smokeResult }) {
  if (reporter === 'TAP') {
    const resultLine =
      smokeResult === 'passed'
        ? `ok 42 - ${smokeName}`
        : `ok 42 - ${smokeName} # SKIP TEST_DBOS_SYSTEM_DATABASE_URL is required`;

    return [
      'TAP version 13',
      `# Subtest: ${smokeName}`,
      resultLine,
      '1..48',
      '# tests 48',
      `# pass ${48 - skipped}`,
      '# fail 0',
      `# skipped ${skipped}`,
      '',
    ].join('\n');
  }

  const resultLine =
    smokeResult === 'passed'
      ? `✔ ${smokeName} (12.345ms)`
      : `﹣ ${smokeName} (TEST_DBOS_SYSTEM_DATABASE_URL is required)`;

  return [
    resultLine,
    'ℹ tests 48',
    `ℹ pass ${48 - skipped}`,
    'ℹ fail 0',
    `ℹ skipped ${skipped}`,
    '',
  ].join('\n');
}
