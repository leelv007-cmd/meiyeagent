import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../..');

/**
 * Modules named after a ticket number instead of what they do.
 *
 * `issue-255-live-collector.ts` cannot be understood from its name — you have
 * to look up an issue in a tracker this project no longer uses. That is a pure
 * navigation tax, paid by every reader and every agent, forever.
 *
 * The list below is a backlog, not an allowance. deepEqual runs both ways, so a
 * rename must delete its line and a new tracker-named file fails the build.
 * Which is the point: the count can only go down.
 *
 * A caution for whoever does the renaming, learned by measuring it rather than
 * assuming: the 2026-08-16 architecture review put this at 59 + 17 + 5 files.
 * The real first-party count is the 31 below. The larger number comes from
 * references/repos/, which holds vendored third-party repositories — 381 of the
 * 413 repo-wide matches live there and are not ours to rename.
 *
 * The same review called the rename "purely mechanical". The issue-255 family
 * is not, and it is 18 of the 31. It is tied to an environment variable name
 * (ISSUE_255_SAFE_PROVISIONER_PATH), a gate variable
 * (RUN_ISSUE_255_SAFE_PROVISION_POSTGRES_TEST), two database names the
 * provisioner whitelists by literal (meiye_issue255, meiye_issue255_dbos),
 * three path-keyed entries in docs/ops/opt-in-test-evidence.json, and a
 * handover runbook — while V31-67 has the suite open as producing no true
 * signal in either direction. Renaming the files alone would leave the operator
 * contract spelled the old way, which is worse than leaving it. Evidence refs
 * of the shape `live://issue-255/...` are stored data and must not be touched
 * at all.
 *
 * The seven `t..` and `w..` e2e specs are the cheap half: named after batch
 * tickets, with no operator contract behind them.
 */
const TRACKER_NAMED_MODULES = [
  'apps/core/src/p1/harness/issue-255-calibration-guard.test.ts',
  'apps/core/src/p1/harness/issue-255-calibration-guard.ts',
  'apps/core/src/p1/harness/issue-255-live-collector-cli-entry.ts',
  'apps/core/src/p1/harness/issue-255-live-collector-cli.test.ts',
  'apps/core/src/p1/harness/issue-255-live-collector-cli.ts',
  'apps/core/src/p1/harness/issue-255-live-collector.postgres.test.ts',
  'apps/core/src/p1/harness/issue-255-live-collector.ts',
  'apps/core/src/p1/harness/issue-255-live-manifest-recovery-cli-entry.ts',
  'apps/core/src/p1/harness/issue-255-live-reconciliation-cli-entry.ts',
  'apps/core/src/p1/harness/issue-255-live-reconciliation.ts',
  'apps/core/src/p1/harness/issue-255-postgres-live-receipt.postgres.test.ts',
  'apps/core/src/p1/harness/issue-255-postgres-live-receipt.ts',
  'apps/core/src/p1/harness/issue-255-provider-attempt-fence.test.ts',
  'apps/core/src/p1/harness/issue-255-provider-attempt-fence.ts',
  'apps/core/src/p1/harness/issue-255-recorded-calibration-cli.ts',
  'apps/core/src/p1/harness/issue-255-recorded-calibration.test.ts',
  'apps/core/src/p1/harness/issue-255-recorded-calibration.ts',
  'apps/core/src/p1/harness/issue-255-safe-provision.postgres.test.ts',
  'mkfast-template-main/tests/e2e/specs/t33-asset-surfaces-reshell.spec.ts',
  'mkfast-template-main/tests/e2e/specs/t34-content-operations-reshell.spec.ts',
  'mkfast-template-main/tests/e2e/specs/t39-r-gate-journey-matrix.spec.ts',
  'mkfast-template-main/tests/e2e/specs/t46-ambient-copy-contrast.spec.ts',
  'mkfast-template-main/tests/e2e/specs/w01-storefact-wiring.spec.ts',
  'mkfast-template-main/tests/e2e/specs/w02-five-step-intake.spec.ts',
  'mkfast-template-main/tests/e2e/specs/w12-identity-draft-assistant.spec.ts',
  'scripts/ci/issue-255-safe-provision.mjs',
  'scripts/ci/issue-255-safe-provision.test.mjs',
  'scripts/ops/issue-253-readiness.mjs',
  'scripts/ops/issue-253-readiness.test.mjs',
  'scripts/ops/issue-257-delete-window.mjs',
  'scripts/ops/issue-257-delete-window.test.mjs',
];

/**
 * First-party roots only. references/repos/ is vendored and out of scope, and
 * docs/tickets/v3.1/ is a record of what happened — renaming history would be
 * a different kind of mistake.
 */
const FIRST_PARTY_ROOTS = [
  'apps',
  'packages',
  'scripts',
  'mkfast-template-main/src',
  'mkfast-template-main/tests',
];

const TRACKER_NAME = /^(issue-\d+|t\d+-|w\d+-)/iu;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'paraglide') continue;
      found.push(...(await sourceFiles(path)));
      continue;
    }
    if (!/\.(ts|tsx|mjs)$/u.test(entry.name)) continue;
    found.push(path);
  }
  return found;
}

test('no first-party module is named after a ticket number, beyond the backlog', async () => {
  const named = [];
  for (const root of FIRST_PARTY_ROOTS) {
    const directory = join(repositoryRoot, root);
    for (const path of await sourceFiles(directory)) {
      const relativePath = relative(repositoryRoot, path).split('\\').join('/');
      const basename = relativePath.slice(relativePath.lastIndexOf('/') + 1);
      if (TRACKER_NAME.test(basename)) named.push(relativePath);
    }
  }
  assert.deepEqual(named.sort(), [...TRACKER_NAMED_MODULES].sort());
});
