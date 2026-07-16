import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeBundleEntries } from './evidence-tools.mjs';

const assetsDirectory = join('mkfast-template-main', 'dist', 'client', 'assets');
const entries = readdirSync(assetsDirectory)
  .filter((name) => /\.(?:css|js)$/.test(name))
  .map((name) => ({
    name,
    gzipBytes: gzipSync(readFileSync(join(assetsDirectory, name))).byteLength,
  }));
const report = analyzeBundleEntries(entries);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
