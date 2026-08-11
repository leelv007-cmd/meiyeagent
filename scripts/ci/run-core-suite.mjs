import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  assertCoreSuiteManifest,
  currentCoreSuiteManifest,
  filesForOwner,
} from './core-suite-manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const coreRoot = resolve(repositoryRoot, 'apps/core');

async function main() {
  const arguments_ = process.argv.slice(2);
  const owner = argumentValue(arguments_, '--owner');
  const reporter = argumentValue(arguments_, '--reporter');
  const manifestPath = argumentValue(arguments_, '--manifest-path');
  if (!owner) throw new Error('--owner is required.');

  const { contract, manifest } = await currentCoreSuiteManifest();
  assertCoreSuiteManifest(manifest, contract);
  const files = filesForOwner(manifest, owner).map((file) =>
    file.replace(/^apps\/core\//u, ''),
  );

  if (manifestPath) {
    await mkdir(dirname(resolve(manifestPath)), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const nodeArguments = [
    '--import',
    'tsx',
    '--test',
    '--test-concurrency=1',
    ...(reporter ? [`--test-reporter=${reporter}`] : []),
    ...files,
  ];
  const child = spawn(process.execPath, nodeArguments, {
    cwd: coreRoot,
    env: process.env,
    stdio: 'inherit',
  });
  const status = await new Promise((resolveStatus, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Core suite ${owner} exited from signal ${signal}.`));
        return;
      }
      resolveStatus(code ?? 1);
    });
  });
  process.exitCode = status;
}

function argumentValue(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index === -1) return undefined;
  const value = arguments_[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

await main();
