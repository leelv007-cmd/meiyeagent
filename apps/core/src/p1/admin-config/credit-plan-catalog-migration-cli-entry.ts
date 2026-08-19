import { runCreditPlanCatalogMigrationCli } from './credit-plan-catalog-migration-cli.js';

try {
  const result = await runCreditPlanCatalogMigrationCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
