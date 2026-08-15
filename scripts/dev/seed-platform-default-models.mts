#!/usr/bin/env node

import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AdminConfigRepository } from '../../apps/core/src/p1/admin-config/foundation-module.js';
import { PostgresAdminConfigRepository } from '../../apps/core/src/p1/admin-config/postgres-repository.js';
import {
  PLATFORM_DEFAULT_MODEL_CONFIG_KEYS,
  platformDefaultModelConfigName,
  type PlatformDefaultModelConfigKey,
} from '../../apps/core/src/p1/foundation/workspace-provision.js';
import { PLATFORM_DEFAULT_MODEL_SEED } from './runtime-profile.mjs';

const GLOBAL_WORKSPACE_ID = '__global__';
const SEED_ACTOR_ID = 'system:platform-default-model-seed';

export const PLATFORM_DEFAULT_MODEL_SEED_VALUES = PLATFORM_DEFAULT_MODEL_SEED;

export function platformDefaultModelSeedEntries() {
  return PLATFORM_DEFAULT_MODEL_CONFIG_KEYS.map(
    (configKey: PlatformDefaultModelConfigKey) =>
      [
        platformDefaultModelConfigName(configKey),
        PLATFORM_DEFAULT_MODEL_SEED[configKey],
      ] as const,
  );
}

export async function seedPlatformDefaultModels(
  repository: Pick<AdminConfigRepository, 'apply' | 'get'>,
) {
  const results: Array<{ key: string; revision: number; unchanged: boolean }> =
    [];

  for (const [key, value] of platformDefaultModelSeedEntries()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await repository.get('global', GLOBAL_WORKSPACE_ID, key);
      if (current && isDeepStrictEqual(current.value, value)) {
        results.push({ key, revision: current.revision, unchanged: true });
        break;
      }
      try {
        const revision = await repository.apply({
          actorId: SEED_ACTOR_ID,
          correlationId: `bootstrap:platform-default-model:${key}`,
          expectedRevision: current?.revision ?? null,
          key,
          reason:
            'Seed platform default catalog models for local/dev bootstrap (V31-79).',
          scope: 'global',
          value,
          workspaceId: GLOBAL_WORKSPACE_ID,
        });
        results.push({
          key,
          revision: revision.revision,
          unchanged: Boolean(
            current && isDeepStrictEqual(current.value, value),
          ),
        });
        break;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  }

  return results;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!databaseUrl?.trim()) {
    throw new Error(
      'Platform default model seed requires DATABASE_URL or TEST_DATABASE_URL.',
    );
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const coreRoot = resolve(here, '../../apps/core');
  const requireFromCore = createRequire(resolve(coreRoot, 'package.json'));
  const { Pool } = requireFromCore('pg') as typeof import('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const repository = new PostgresAdminConfigRepository(pool);
    await repository.migrate();
    const results = await seedPlatformDefaultModels(repository);
    process.stdout.write(
      `Platform default models ready (${results
        .map((row) => `${row.key}@${row.revision}`)
        .join(', ')}).\n`,
    );
  } finally {
    await pool.end();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
