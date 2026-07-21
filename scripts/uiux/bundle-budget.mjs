import { gzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeBundleEntries } from './evidence-tools.mjs';

const assetsDirectory = join(
  'mkfast-template-main',
  'dist',
  'client',
  'assets'
);
const report = existsSync(assetsDirectory)
  ? analyzeBundleEntries(
      readdirSync(assetsDirectory)
        .filter((name) => /\.(?:css|js)$/.test(name))
        .map((name) => ({
          name,
          gzipBytes: gzipSync(readFileSync(join(assetsDirectory, name)))
            .byteLength,
        }))
    )
  : {
      assetsDirectory,
      passed: false,
      reason: 'production-build-artifacts-missing',
      status: 'not-run',
    };

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
