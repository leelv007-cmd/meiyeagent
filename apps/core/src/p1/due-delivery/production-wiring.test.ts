import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('composition roots bind the due scanner and shared migration seam', async () => {
  // This is a call-site guard only. Scanner behavior is covered by
  // scanner-job.test.ts and the PostgreSQL due-delivery acceptance suite.
  const [coreSource, workerSource, apiSource, pollerSource] = await Promise.all([
    readFile(new URL('../../assembly/core-assembly.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../assembly/worker-runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../assembly/api-runtime.ts', import.meta.url), 'utf8'),
    readFile(new URL('./poller.ts', import.meta.url), 'utf8'),
  ]);
  const source = `${coreSource}\n${workerSource}\n${apiSource}\n${pollerSource}`;
  const mainSource = await readFile(
    new URL('../../assembly/core-assembly.ts', import.meta.url),
    'utf8',
  );
  const adminConfigDeclaration = mainSource.indexOf(
    'const adminConfigRepository = new PostgresAdminConfigRepository(pool);',
  );
  const dueRepositoryDeclaration = mainSource.indexOf(
    'const dueDeliveryRepository = new PostgresDueDeliveryRepository(',
  );
  const migrationAfterDueRepository = mainSource.indexOf(
    'await migratePostgresSchema(pool, [',
    dueRepositoryDeclaration,
  );
  const migrationEnd = mainSource.indexOf(
    ']);',
    migrationAfterDueRepository,
  );

  assert.match(
    source,
    /const dueDeliveryRepository = new PostgresDueDeliveryRepository\(\s*pool,\s*adminConfigRepository\s*\)/u,
  );
  assert.ok(adminConfigDeclaration >= 0);
  assert.ok(dueRepositoryDeclaration > adminConfigDeclaration);
  assert.ok(migrationAfterDueRepository > dueRepositoryDeclaration);
  assert.match(
    mainSource.slice(migrationAfterDueRepository, migrationEnd),
    /dueDeliveryRepository/u,
  );
  assert.doesNotMatch(
    mainSource,
    /await dueDeliveryRepository\.migrate\(\)/u,
  );
  assert.match(
    source,
    /migratePostgresSchema\(pool, \[[\s\S]*?dueDeliveryRepository,/u,
  );
  assert.match(
    pollerSource,
    /new DailyRecommendationDeliveryPort\(\s*input\.candidates,\s*undefined,\s*input\.notifier,/u,
  );
  assert.match(
    pollerSource,
    /new ProductionDueDeliveryEligibility\(\s*new PostgresWorkspaceOwnerMembershipReader\(input\.pool\),/u,
  );
  assert.match(source, /new DueDeliveryWorker\(/u);
  assert.match(source, /createProductionDueDeliveryScanner\(/u);
  assert.match(source, /startDueDeliveryPoller\(/u);
  assert.match(
    workerSource,
    /processRole:\s*'worker'/u,
  );
  assert.match(
    apiSource,
    /processRole:\s*'api'/u,
  );
  assert.match(
    source,
    /await registerDueDeliveryScannerSchedule\(jobRuntime\)/u,
  );
  assert.match(
    source,
    /\[DUE_DELIVERY_SCANNER_JOB_KIND\]:\s*createDueDeliveryScannerJobHandler\(/u,
  );
});
