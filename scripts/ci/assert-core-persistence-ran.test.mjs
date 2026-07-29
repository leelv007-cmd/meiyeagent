import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const assertionScript = fileURLToPath(
  new URL('./assert-core-persistence-ran.mjs', import.meta.url),
);
const smokeName =
  'production DBOS registration launches and delivers one five-stage workflow';
const productionAssemblyJoinName =
  'production image media assembly durably joins admission to ContentPackage delivery';

for (const reporter of ['TAP', 'spec']) {
  for (const smokeResult of ['passed', 'skipped']) {
    for (const skipped of [6, 49]) {
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
            skipped === 49
              ? /expected at most 27 skipped tests, got 49/u
              : /DBOS registration smoke did not report a passing result/u,
          );
        }
      });
    }
  }
}

for (const reporter of ['TAP', 'spec']) {
  for (const joinResult of ['failed', 'skipped']) {
    test(`${reporter} | production assembly join ${joinResult} -> fail`, () => {
      const result = spawnSync(process.execPath, [assertionScript, '-'], {
        encoding: 'utf8',
        input: createReport({
          reporter,
          skipped: 6,
          smokeResult: 'passed',
          joinResult,
        }),
      });

      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /production media assembly join did not report a passing result/u,
      );
    });
  }
}

function createReport({
  reporter,
  skipped,
  smokeResult,
  joinResult = 'passed',
}) {
  if (reporter === 'TAP') {
    const smokeResultLine =
      smokeResult === 'passed'
        ? `ok 42 - ${smokeName}`
        : `ok 42 - ${smokeName} # SKIP TEST_DBOS_SYSTEM_DATABASE_URL is required`;
    const joinResultLine =
      joinResult === 'passed'
        ? `ok 43 - ${productionAssemblyJoinName}`
        : joinResult === 'skipped'
          ? `ok 43 - ${productionAssemblyJoinName} # SKIP TEST_DATABASE_URL and TEST_DBOS_SYSTEM_DATABASE_URL are required`
          : `not ok 43 - ${productionAssemblyJoinName}`;

    return [
      'TAP version 13',
      `# Subtest: ${smokeName}`,
      smokeResultLine,
      `# Subtest: ${productionAssemblyJoinName}`,
      joinResultLine,
      '1..49',
      '# tests 49',
      `# pass ${49 - skipped}`,
      '# fail 0',
      `# skipped ${skipped}`,
      '',
    ].join('\n');
  }

  const smokeResultLine =
    smokeResult === 'passed'
      ? `✔ ${smokeName} (12.345ms)`
      : `﹣ ${smokeName} (TEST_DBOS_SYSTEM_DATABASE_URL is required)`;
  const joinResultLine =
    joinResult === 'passed'
      ? `✔ ${productionAssemblyJoinName} (23.456ms)`
      : joinResult === 'skipped'
        ? `﹣ ${productionAssemblyJoinName} (TEST_DATABASE_URL and TEST_DBOS_SYSTEM_DATABASE_URL are required)`
        : `✖ ${productionAssemblyJoinName} (23.456ms)`;

  return [
    smokeResultLine,
    joinResultLine,
    'ℹ tests 49',
    `ℹ pass ${49 - skipped}`,
    'ℹ fail 0',
    `ℹ skipped ${skipped}`,
    '',
  ].join('\n');
}
