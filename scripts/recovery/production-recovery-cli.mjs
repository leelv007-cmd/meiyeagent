import { lstatSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyProductionRecoveryManifest } from './production-recovery.mjs';

export const productionRecoveryCliUsage = `Usage:
  node scripts/recovery/production-recovery-cli.mjs verify [manifest]

Verifies redacted N2 production recovery evidence. It never performs a restore.`;

export function runProductionRecoveryCli(argv, options = {}) {
  const [action, requestedPath] = argv;
  if (action === '--help' || action === 'help' || action === undefined) {
    return {
      exitCode: 0,
      stdout: `${productionRecoveryCliUsage}\n`,
      stderr: '',
    };
  }
  if (action === 'verify') {
    const root = resolve(options.root ?? process.cwd());
    const manifestPath =
      requestedPath ?? 'docs/evidence/n2-recovery/manifest.json';
    const absolute = resolve(root, manifestPath);
    const relativePath = relative(root, absolute).replaceAll('\\', '/');
    if (!relativePath.startsWith('docs/evidence/n2-recovery/')) {
      return {
        exitCode: 1,
        stdout: '',
        stderr:
          'Recovery manifest must stay under docs/evidence/n2-recovery.\n',
      };
    }
    let manifest;
    try {
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe');
      manifest = JSON.parse(readFileSync(absolute, 'utf8'));
    } catch {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Recovery manifest could not be read: ${manifestPath}\n`,
      };
    }
    const result = verifyProductionRecoveryManifest(manifest, {
      root,
      now: options.now,
    });
    if (result.status === 'passed') {
      return {
        exitCode: 0,
        stdout: `N2 production recovery evidence passed: ${manifestPath}\n`,
        stderr: '',
      };
    }
    return {
      exitCode: 1,
      stdout: '',
      stderr: [
        `N2 production recovery evidence is ${result.status}: ${manifestPath}`,
        ...result.issues.map((issue) => `- ${issue}`),
        '',
      ].join('\n'),
    };
  }
  return {
    exitCode: 1,
    stdout: '',
    stderr: `Unknown production recovery action: ${action}\n`,
  };
}

const isEntrypoint =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  const result = runProductionRecoveryCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
