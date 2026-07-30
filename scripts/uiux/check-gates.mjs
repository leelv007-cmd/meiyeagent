import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SKIP_EXIT_CODE = 78;

export const CHECK_GATES = [
  {
    name: 'workspace checks',
    command: 'pnpm',
    args: ['-r', '--if-present', 'check'],
  },
  {
    name: 'locale keys',
    command: 'pnpm',
    args: ['--filter', '@meiye/web', 'locale:check'],
  },
  {
    name: 'secret scan',
    command: 'node',
    args: ['scripts/uiux/secret-scan.mjs'],
  },
  {
    name: 'D-123 cost boundary',
    command: 'node',
    args: ['scripts/uiux/d123-cost-boundary.mjs'],
  },
  {
    name: 'decision ticket guard',
    command: 'node',
    args: ['scripts/uiux/decision-ticket-guard.mjs'],
  },
  {
    name: 'HeroUI mirror guard',
    command: 'node',
    args: ['scripts/uiux/heroui-mirror-guard.mjs'],
  },
  {
    name: 'works canonical projection guard',
    command: 'node',
    args: ['scripts/uiux/works-canonical-projection-guard.mjs'],
  },
  {
    name: 'retired old-IA route mount guard',
    command: 'node',
    args: ['scripts/uiux/retired-ia-route-mount-guard.mjs'],
  },
  {
    name: 'brand exposure',
    command: 'node',
    args: ['scripts/ops/brand-exposure-scan.mjs', '--check'],
  },
  {
    name: 'opt-in test evidence',
    command: 'node',
    args: ['scripts/uiux/opt-in-test-evidence-guard.mjs'],
  },
];

export function runGates(
  gates,
  {
    cwd = process.cwd(),
    failOnSkip = process.env.CHECK_GATES_FAIL_ON_SKIP === 'true',
    run = spawnSync,
    writeLine = (line) => process.stdout.write(`${line}\n`),
  } = {}
) {
  const results = [];

  for (const gate of gates) {
    writeLine(`[check] RUN  ${gate.name}`);
    const result = run(gate.command, gate.args, {
      cwd,
      stdio: 'inherit',
    });
    const status = result.status ?? 1;
    const outcome =
      status === 0 ? 'PASS' : status === SKIP_EXIT_CODE ? 'SKIP' : 'FAIL';
    results.push({ name: gate.name, outcome, status });
    writeLine(
      outcome === 'FAIL'
        ? `[check] FAIL ${gate.name} (exit ${status})`
        : `[check] ${outcome} ${gate.name}`
    );
  }

  writeLine('[check] Summary');
  for (const result of results) {
    writeLine(`[check] ${result.outcome} ${result.name}`);
  }

  const skipped = results.filter(({ outcome }) => outcome === 'SKIP').length;
  const failed =
    results.some(({ outcome }) => outcome === 'FAIL') ||
    (failOnSkip && skipped > 0);
  const skipSuffix = skipped > 0 ? ` (${skipped} skipped)` : '';
  writeLine(`[check] Overall: ${failed ? 'FAIL' : 'PASS'}${skipSuffix}`);
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runGates(CHECK_GATES);
}
