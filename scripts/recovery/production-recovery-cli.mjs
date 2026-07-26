import { lstatSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  declaredRecoveryEnvironment,
  recoveryEnvironmentLabel,
  verifyProductionRecoveryManifest,
} from './production-recovery.mjs';

export const productionRecoveryCliUsage = `Usage:
  node scripts/recovery/production-recovery-cli.mjs verify [manifest]
  node scripts/recovery/production-recovery-cli.mjs drill [evidence-directory]

verify reads redacted N2 recovery evidence and never performs a restore. The
default manifest is production evidence and stays fail-closed until a real
production PITR drill exists.

drill executes a real recovery drill against local infrastructure and writes
environment=local evidence under docs/evidence/n2-recovery/local-drill-<date>/.
Local evidence exercises the recovery path; it is never production evidence.`;

const PRODUCTION_MANIFEST_PATH = 'docs/evidence/n2-recovery/manifest.json';
const LOCAL_DRILL_PATH_PATTERN =
  /^docs\/evidence\/n2-recovery\/local-drill-[^/]+\/manifest\.json$/u;

/**
 * Which contract a manifest path must satisfy. The release-gate path is
 * production-only, so local drill evidence can never be substituted for it, and
 * the local drill directory is local-only, so production claims cannot hide
 * there either.
 */
export function expectedEnvironmentForPath(relativePath, manifest) {
  if (relativePath === PRODUCTION_MANIFEST_PATH) return 'production';
  if (LOCAL_DRILL_PATH_PATTERN.test(relativePath)) return 'local';
  return declaredRecoveryEnvironment(manifest);
}

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
    const manifestPath = requestedPath ?? PRODUCTION_MANIFEST_PATH;
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
    const expectedEnvironment = expectedEnvironmentForPath(relativePath, manifest);
    const label = recoveryEnvironmentLabel(expectedEnvironment);
    const result = verifyProductionRecoveryManifest(manifest, {
      expectedEnvironment,
      root,
      now: options.now,
    });
    if (result.status === 'passed') {
      return {
        exitCode: 0,
        stdout: `N2 ${label} passed: ${manifestPath}\n`,
        stderr: '',
      };
    }
    return {
      exitCode: 1,
      stdout: '',
      stderr: [
        `N2 ${label} is ${result.status}: ${manifestPath}`,
        ...result.issues.map((issue) => `- ${issue}`),
        '',
      ].join('\n'),
    };
  }
  if (action === 'drill') {
    return {
      exitCode: 1,
      stdout: '',
      stderr:
        'The drill action performs a real restore and must run through runProductionRecoveryCliAsync.\n',
    };
  }
  return {
    exitCode: 1,
    stdout: '',
    stderr: `Unknown production recovery action: ${action}\n`,
  };
}

/**
 * The drill executes real infrastructure work, so it needs the async entrypoint.
 * Everything else delegates to the synchronous CLI unchanged.
 */
export async function runProductionRecoveryCliAsync(argv, options = {}) {
  const [action, requestedPath] = argv;
  if (action !== 'drill') return runProductionRecoveryCli(argv, options);

  const root = resolve(options.root ?? process.cwd());
  const { runLocalRecoveryDrill } = await import('./local-recovery-drill.mjs');
  let drill;
  try {
    drill = await runLocalRecoveryDrill({
      ...(requestedPath ? { evidenceDir: requestedPath } : {}),
      ...(options.databaseUrl ? { databaseUrl: options.databaseUrl } : {}),
      root,
    });
  } catch (error) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Local recovery drill failed: ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }

  const lines = [
    ...drill.log.map((entry) => `- ${entry}`),
    ...drill.scenarios.map(
      (scenario) =>
        `- injected ${scenario.scenarioId}: ${scenario.observedResult} (instance ${scenario.instanceId})`
    ),
    `Local recovery drill evidence: ${drill.manifestPath}`,
  ];
  const verification = runProductionRecoveryCli(['verify', drill.manifestPath], {
    root,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    exitCode: verification.exitCode,
    stdout: `${lines.join('\n')}\n${verification.stdout}`,
    stderr: verification.stderr,
  };
}

const isEntrypoint =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  const result = await runProductionRecoveryCliAsync(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
