import { resolve } from 'node:path';

import { Pool } from 'pg';

import { PostgresSkillRepository } from '../skills/postgres-repository.js';
import { langfuseEvalRunImporterFromEnv } from './langfuse-evalrun-importer.js';

async function main() {
  const artifactArgument = process.argv[2];
  if (!artifactArgument) {
    throw new Error('Usage: pnpm eval:import <artifact.json>');
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required to persist the imported EvalRun.',
    );
  }
  const pool = new Pool({ connectionString });
  try {
    const repository = new PostgresSkillRepository(pool);
    const importer = langfuseEvalRunImporterFromEnv(
      process.env,
      repository,
    );
    await repository.migrate();
    const artifactPath = resolve(
      process.env.INIT_CWD ?? process.cwd(),
      artifactArgument,
    );
    const result = await importer.importArtifact(artifactPath);
    process.stdout.write(
      `Imported ${result.importedItems} EvalRun items from ${result.runId} into ${result.datasetName}.\n`,
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
