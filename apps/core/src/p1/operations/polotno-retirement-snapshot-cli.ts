import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

import {
  exportLegacyCanvasProductionSnapshot,
  PostgresLegacyCanvasSnapshotSource,
  type LegacyCanvasObjectInventory,
} from './polotno-retirement-snapshot.js';

export const legacyCanvasSnapshotCliUsage = `Usage:
  pnpm canvas:retirement-snapshot --workspace-id <id> --deployment <name> --capture-id <id> --object-inventory <objects.json>

Required environment:
  DATABASE_URL`;

export async function runLegacyCanvasSnapshotCli(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
) {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  if (normalizedArgv[0] === '--help' || normalizedArgv[0] === '-h') {
    return { help: legacyCanvasSnapshotCliUsage };
  }
  const arguments_ = parseArguments(normalizedArgv);
  const databaseUrl = requiredEnvironment(env, 'DATABASE_URL');
  const objectInventory = JSON.parse(
    await readFile(arguments_.objectInventoryPath, 'utf8')
  ) as LegacyCanvasObjectInventory;
  const pool = new Pool({
    application_name: 'meiye-canvas-retirement-snapshot',
    connectionString: databaseUrl,
    max: 1,
  });
  try {
    return await exportLegacyCanvasProductionSnapshot({
      captureId: arguments_.captureId,
      deployment: arguments_.deployment,
      objectInventory,
      source: new PostgresLegacyCanvasSnapshotSource(pool),
      workspaceId: arguments_.workspaceId,
    });
  } finally {
    await pool.end();
  }
}

function parseArguments(argv: string[]) {
  if (
    argv.length !== 8 ||
    new Set(argv.filter((value) => value.startsWith('--'))).size !== 4
  ) {
    throw new Error(legacyCanvasSnapshotCliUsage);
  }
  return {
    captureId: requiredOption(argv, '--capture-id'),
    deployment: requiredOption(argv, '--deployment'),
    objectInventoryPath: requiredOption(argv, '--object-inventory'),
    workspaceId: requiredOption(argv, '--workspace-id'),
  };
}

function requiredOption(argv: string[], name: string) {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1]?.trim() : undefined;
  if (!value || value.startsWith('--'))
    throw new Error(legacyCanvasSnapshotCliUsage);
  return value;
}

function requiredEnvironment(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
