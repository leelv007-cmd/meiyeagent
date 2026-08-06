import { resolve } from 'node:path';

import { Pool } from 'pg';

import {
  issueRecipeEvidenceReceiptWithObservability,
} from '../creation-experience/recipe-evidence-issuer.js';
import { PostgresRecipeEvidenceReceiptRegistry } from '../creation-experience/postgres-recipe-evidence-receipt-registry.js';
import { PostgresSkillRepository } from '../skills/postgres-repository.js';
import {
  EVAL_IMPORT_USAGE,
  parseEvalImportCliArgs,
} from './eval-import-cli-args.js';
import {
  langfuseEvalRunImporterFromEnv,
  readEvalRunArtifact,
} from './langfuse-evalrun-importer.js';

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
    const artifactPath = resolve(
      process.env.INIT_CWD ?? process.cwd(),
      args.artifactPath,
    );

    if (!args.issue) {
      // Historical import-only path: require Langfuse env before DB work so
      // misconfig fails with the same message as before #396.
      const importer = langfuseEvalRunImporterFromEnv(
        process.env,
        repository,
      );
      await repository.migrate();
      const result = await importer.importArtifact(artifactPath);
      process.stdout.write(
        `Imported ${result.importedItems} EvalRun items from ${result.runId} into ${result.datasetName}.\n`,
      );
      return;
    }

    // Issue path (#396): local put + receipt first; Langfuse is best-effort
    // observability and must not block issuance.
    await repository.migrate();
    const run = await readEvalRunArtifact(artifactPath);
    await repository.putImmutable(run.runId, run);
    const receiptRegistry = new PostgresRecipeEvidenceReceiptRegistry(pool);
    await receiptRegistry.migrate();

    let importer: ReturnType<typeof langfuseEvalRunImporterFromEnv> | null =
      null;
    try {
      importer = langfuseEvalRunImporterFromEnv(process.env, repository);
    } catch {
      importer = null;
    }

    const issued = await issueRecipeEvidenceReceiptWithObservability(
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
      importer
        ? {
            push: async () => {
              await importer!.pushDatasetItems(run);
            },
            onPushFailure: (error) => {
              const message =
                error instanceof Error ? error.message : String(error);
              process.stderr.write(
                `Langfuse push failed after issuance (receipt still valid): ${message}\n`,
              );
            },
          }
        : undefined,
    );

    process.stdout.write(
      `Imported ${run.results.length} EvalRun items from ${run.runId} into harness-evalrun:${run.suiteId} (registry).\n`,
    );
    process.stdout.write(
      `Issued recipe evidence receipt ${issued.receipt.receiptId} (${issued.receipt.evidenceKind}) for ${issued.receipt.recipeId}@${issued.receipt.recipeRevision}.\n`,
    );
    if (issued.observabilityFailure) {
      process.stderr.write(
        `Observability failure recorded (issuance complete): ${issued.observabilityFailure}\n`,
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
