import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CHECK_GATES = [
  {
    name: 'workspace checks',
    command: 'pnpm',
    args: ['-r', '--if-present', 'check'],
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
];

export function runGates(
  gates,
  {
    cwd = process.cwd(),
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
    results.push({ name: gate.name, status });
    writeLine(
      status === 0
        ? `[check] PASS ${gate.name}`
        : `[check] FAIL ${gate.name} (exit ${status})`
    );
  }

  writeLine('[check] Summary');
  for (const result of results) {
    writeLine(
      `[check] ${result.status === 0 ? 'PASS' : 'FAIL'} ${result.name}`
    );
  }

  const failed = results.some(({ status }) => status !== 0);
  writeLine(`[check] Overall: ${failed ? 'FAIL' : 'PASS'}`);
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = runGates(CHECK_GATES);
}
