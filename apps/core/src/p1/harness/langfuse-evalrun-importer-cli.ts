import { resolve } from 'node:path';

import { langfuseEvalRunImporterFromEnv } from './langfuse-evalrun-importer.js';

async function main() {
  const artifactArgument = process.argv[2];
  if (!artifactArgument) {
    throw new Error('Usage: pnpm eval:import <artifact.json>');
  }

  const importer = langfuseEvalRunImporterFromEnv();
  const artifactPath = resolve(
    process.env.INIT_CWD ?? process.cwd(),
    artifactArgument,
  );
  const result = await importer.importArtifact(artifactPath);
  process.stdout.write(
    `Imported ${result.importedItems} EvalRun items from ${result.runId} into ${result.datasetName}.\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
