import { readFile } from 'node:fs/promises';

import {
  FileSystemLegacyCanvasManagedStorage,
  auditLegacyCanvasAccess,
} from './polotno-retirement-access.js';
import type { LegacyCanvasInventoryInput } from './polotno-retirement-inventory.js';

function option(arguments_: string[], name: string) {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  if (!value || value.startsWith('--')) {
    throw new Error(
      'Usage: canvas:retirement-access --input <snapshot.json> --managed-root <directory>'
    );
  }
  return value;
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (
    arguments_.length !== 4 ||
    new Set(arguments_.filter((value) => value.startsWith('--'))).size !== 2
  ) {
    throw new Error(
      'Usage: canvas:retirement-access --input <snapshot.json> --managed-root <directory>'
    );
  }
  const inputPath = option(arguments_, '--input');
  const managedRoot = option(arguments_, '--managed-root');
  const input = JSON.parse(
    await readFile(inputPath, 'utf8')
  ) as LegacyCanvasInventoryInput;
  const report = await auditLegacyCanvasAccess(
    input,
    new FileSystemLegacyCanvasManagedStorage(managedRoot)
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Canvas retirement access audit failed.'}\n`
  );
  process.exitCode = 1;
});
