import { resolve } from 'node:path';

import { Pool } from 'pg';

import { issueRecipeEvidenceReceipt } from '../creation-experience/recipe-evidence-issuer.js';
import { PostgresRecipeEvidenceReceiptRegistry } from '../creation-experience/postgres-recipe-evidence-receipt-registry.js';
import { PostgresSkillRepository } from '../skills/postgres-repository.js';
import {
  EVAL_IMPORT_USAGE,
  parseEvalImportCliArgs,
} from './eval-import-cli-args.js';
import { langfuseEvalRunImporterFromEnv } from './langfuse-evalrun-importer.js';

async function main() {
  let args;
  try {
    args = parseEvalImportCliArgs(process.argv.slice(2));
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : EVAL_IMPORT_USAGE,
    );
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
      args.artifactPath,
    );
    const result = await importer.importArtifact(artifactPath);
    process.stdout.write(
      `Imported ${result.importedItems} EvalRun items from ${result.runId} into ${result.datasetName}.\n`,
    );

    if (args.issue) {
      const receiptRegistry = new PostgresRecipeEvidenceReceiptRegistry(pool);
      await receiptRegistry.migrate();
      const run = await repository.get(result.runId);
      if (!run) {
        throw new Error(
          `Imported EvalRun ${result.runId} is missing from the registry after putImmutable.`,
        );
      }
      const issued = await issueRecipeEvidenceReceipt(
        {
          evalRunRegistry: repository,
          receiptRegistry,
        },
        {
          run,
          evidenceKind: args.issue.evidenceKind,
          recipeId: args.issue.recipeId,
          recipeRevision: args.issue.recipeRevision,
        },
      );
      process.stdout.write(
        `Issued recipe evidence receipt ${issued.receipt.receiptId} (${issued.receipt.evidenceKind}) for ${issued.receipt.recipeId}@${issued.receipt.recipeRevision}.\n`,
      );
    }
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
