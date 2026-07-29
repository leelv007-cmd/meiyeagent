#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const lanePath = '/Users/bin/Desktop/开发/内容无人区/lane-255';
const allowedModes = [
  'provision',
  '--inspect',
  '--cleanup-if-safe',
];

export function runIssue255SafeProvision({
  argv = process.argv.slice(2),
  environment = process.env,
} = {}) {
  const businessUrl = requiredUrl(environment, 'TEST_DATABASE_URL');
  const dbosUrl = requiredUrl(
    environment,
    'TEST_DBOS_SYSTEM_DATABASE_URL',
  );
  const mode = argv[0] ?? 'provision';

  validateDatabaseTargets(businessUrl, dbosUrl);
  if (!allowedModes.includes(mode) || argv.length > 1) {
    fail(
      'Usage: issue-255-safe-provision.mjs [--inspect|--cleanup-if-safe]',
    );
  }

  const inheritedEnvironment = pickEnvironment(environment, [
    'HOME',
    'PATH',
    'USER',
    'LOGNAME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'TERM',
    'SHELL',
    'PNPM_HOME',
    'COREPACK_HOME',
  ]);

  const context = {
    businessUrl,
    dbosUrl,
    inheritedEnvironment,
  };

  if (mode === '--inspect' || mode === '--cleanup-if-safe') {
    const inspection = inspectResetSafety(context);
    process.stdout.write(`${JSON.stringify(inspection)}\n`);
    if (mode === '--inspect') {
      return;
    }
    if (!inspection.resetSafe) {
      fail('Issue 255 conditional cleanup refused an unsafe or unknown state.');
    }
  }

  if (mode === '--cleanup-if-safe') {
    cleanupDatabase(context, businessUrl, 'meiye_issue255');
    cleanupDatabase(context, dbosUrl, 'meiye_issue255_dbos');
    process.stdout.write(
      'Issue 255 database cleanup residual count: 0.\n',
    );
    return;
  }

  ensureDatabase(context, businessUrl);
  ensureDatabase(context, dbosUrl);

  process.stdout.write(
    'Applying App Shell migrations to the isolated issue 255 business database.\n',
  );
  run(
    inheritedEnvironment,
    'App Shell migration',
    'pnpm',
    ['db:migrate:local'],
    {
      cwd: `${lanePath}/mkfast-template-main`,
      env: {
        ...inheritedEnvironment,
        DATABASE_URL: businessUrl.toString(),
      },
    },
  );

  if (
    queryScalar(
      context,
      businessUrl,
      "SELECT COALESCE(to_regclass('public.session')::text, '')",
    ) !== 'session'
  ) {
    fail(
      'Issue 255 App Shell migration did not create the expected schema.',
    );
  }

  process.stdout.write(
    'Applying Pro Studio schema to the isolated issue 255 business database.\n',
  );
  run(
    inheritedEnvironment,
    'Pro Studio schema migration',
    'pnpm',
    [
      '--filter',
      '@meiye/core',
      'exec',
      'tsx',
      `${lanePath}/scripts/ci/apply-pro-studio-schema.mts`,
    ],
    {
      cwd: lanePath,
      env: {
        ...inheritedEnvironment,
        DATABASE_URL: businessUrl.toString(),
      },
    },
  );

  if (
    queryScalar(
      context,
      businessUrl,
      "SELECT COALESCE(to_regclass('public.advanced_canvas_projects')::text, '')",
    ) !== 'advanced_canvas_projects'
  ) {
    fail(
      'Issue 255 Pro Studio migration did not create the expected schema.',
    );
  }

  queryScalar(context, dbosUrl, 'SELECT 1');
  process.stdout.write(
    'Issue 255 isolated PostgreSQL databases are ready.\n',
  );
}

function inspectResetSafety(context) {
  const collectorProcessCount = countCollectorProcesses(
    context.inheritedEnvironment,
  );
  const businessDatabaseReachable = canConnect(
    context,
    context.businessUrl,
  );
  const dbosDatabaseReachable = canConnect(context, context.dbosUrl);
  let counts = null;

  if (
    businessDatabaseReachable &&
    hasInspectionSchema(context, context.businessUrl)
  ) {
    counts = inspectDurableCounts(context, context.businessUrl);
  }

  const collectorStopped = collectorProcessCount === 0;
  const ownerOnlyDurableFact =
    counts !== null &&
    counts.ownerCount === 1 &&
    counts.authorizationCount === 0 &&
    counts.receiptCount === 0 &&
    counts.liveOperationalFactCount === 0 &&
    counts.issue255ProviderCostCount === 0;
  const inspectionComplete =
    collectorProcessCount !== null &&
    businessDatabaseReachable &&
    dbosDatabaseReachable &&
    counts !== null;
  const resetSafe =
    inspectionComplete &&
    collectorStopped &&
    ownerOnlyDurableFact &&
    counts.submittedOrNonClaimedReceiptCount === 0;

  return {
    authorizationCount: counts?.authorizationCount ?? null,
    businessDatabaseReachable,
    collectorProcessCount,
    collectorStopped,
    dbosDatabaseReachable,
    inspectionComplete,
    issue255ProviderCostCount:
      counts?.issue255ProviderCostCount ?? null,
    liveOperationalFactCount:
      counts?.liveOperationalFactCount ?? null,
    ownerCount: counts?.ownerCount ?? null,
    ownerOnlyDurableFact,
    receiptCount: counts?.receiptCount ?? null,
    resetSafe,
    submittedOrNonClaimedReceiptCount:
      counts?.submittedOrNonClaimedReceiptCount ?? null,
  };
}

function countCollectorProcesses(inheritedEnvironment) {
  const result = spawnSync('ps', ['-axo', 'command='], {
    env: inheritedEnvironment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return result.stdout
    .split('\n')
    .filter(
      (command) =>
        command.includes('issue-255-live-collector-cli-entry.ts') ||
        command.includes('harness:collect-issue-255-live'),
    ).length;
}

function hasInspectionSchema(context, url) {
  const present = queryScalar(
    context,
    url,
    `SELECT COUNT(*)::text
       FROM unnest(ARRAY[
         'public.issue255_live_generation_authorizations',
         'public.issue255_live_generation_receipts',
         'public.issue255_live_run_owners',
         'public.workspaces',
         'public.p1_generation_jobs',
         'public.p1_provider_attempts',
         'public.p1_provider_cost_events'
       ]) AS required_table(name)
      WHERE to_regclass(required_table.name) IS NOT NULL`,
  );
  return present === '7';
}

function inspectDurableCounts(context, url) {
  const serialized = queryScalar(
    context,
    url,
    `WITH issue_workspaces AS (
       SELECT workspace_id
         FROM issue255_live_generation_authorizations
       UNION
       SELECT workspace_id
         FROM issue255_live_generation_receipts
       UNION
       SELECT id
         FROM workspaces
        WHERE id LIKE 'issue-255-live-%'
     ),
     counts AS (
       SELECT
         (SELECT COUNT(*)::int
            FROM issue255_live_generation_authorizations)
           AS authorization_count,
         (SELECT COUNT(*)::int
            FROM issue255_live_run_owners)
           AS owner_count,
         (SELECT COUNT(*)::int
            FROM issue255_live_generation_receipts)
           AS receipt_count,
         (SELECT COUNT(*)::int
            FROM issue255_live_generation_receipts
           WHERE generation_submit_count = 1
              OR status <> 'claimed')
           AS submitted_or_non_claimed_receipt_count,
         (SELECT COUNT(*)::int
            FROM p1_provider_cost_events
           WHERE workspace_id IN (SELECT workspace_id FROM issue_workspaces))
           AS issue255_provider_cost_count,
         (
           (SELECT COUNT(*) FROM workspaces
             WHERE id IN (SELECT workspace_id FROM issue_workspaces)) +
           (SELECT COUNT(*) FROM p1_generation_jobs
             WHERE workspace_id IN (
               SELECT workspace_id FROM issue_workspaces
             )) +
           (SELECT COUNT(*) FROM p1_provider_attempts
             WHERE workspace_id IN (
               SELECT workspace_id FROM issue_workspaces
             ))
         )::int AS live_operational_fact_count
     )
     SELECT json_build_object(
       'authorizationCount', authorization_count,
       'ownerCount', owner_count,
       'receiptCount', receipt_count,
       'submittedOrNonClaimedReceiptCount',
         submitted_or_non_claimed_receipt_count,
       'issue255ProviderCostCount', issue255_provider_cost_count,
       'liveOperationalFactCount', live_operational_fact_count
     )::text
       FROM counts`,
  );
  const parsed = JSON.parse(serialized);
  return {
    authorizationCount: requiredCount(
      parsed.authorizationCount,
      'authorization count',
    ),
    ownerCount: requiredCount(parsed.ownerCount, 'owner count'),
    receiptCount: requiredCount(parsed.receiptCount, 'receipt count'),
    submittedOrNonClaimedReceiptCount: requiredCount(
      parsed.submittedOrNonClaimedReceiptCount,
      'submitted receipt count',
    ),
    issue255ProviderCostCount: requiredCount(
      parsed.issue255ProviderCostCount,
      'provider cost count',
    ),
    liveOperationalFactCount: requiredCount(
      parsed.liveOperationalFactCount,
      'operational fact count',
    ),
  };
}

function requiredCount(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`Issue 255 ${label} inspection was invalid.`);
  }
  return value;
}

function requiredUrl(environment, name) {
  const value = environment[name];
  if (!value) {
    fail(`${name} is required.`);
  }
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
      fail(`${name} must use a PostgreSQL protocol.`);
    }
    if (!databaseName(url)) {
      fail(`${name} must identify one database.`);
    }
    return url;
  } catch {
    fail(`${name} is invalid.`);
  }
}

function normalizedUrl(url) {
  const normalized = new URL(url);
  normalized.search = '';
  normalized.hash = '';
  return normalized.toString();
}

function validateDatabaseTargets(businessUrl, dbosUrl) {
  const targets = [
    [businessUrl, 'meiye_issue255'],
    [dbosUrl, 'meiye_issue255_dbos'],
  ];

  for (const [url, expectedName] of targets) {
    if (databaseName(url) !== expectedName) {
      fail('Issue 255 cleanup refused an unexpected database name.');
    }
  }
  if (normalizedUrl(businessUrl) === normalizedUrl(dbosUrl)) {
    fail('Issue 255 business and DBOS databases must be separate.');
  }
}

function databaseName(url) {
  const name = decodeURIComponent(url.pathname.slice(1));
  return name && !name.includes('/') ? name : '';
}

function ensureDatabase(context, targetUrl) {
  if (canConnect(context, targetUrl)) {
    return;
  }
  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = '/postgres';
  const name = databaseName(targetUrl);
  run(
    context.inheritedEnvironment,
    'PostgreSQL database creation',
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', `--set=db_name=${name}`],
    {
      env: postgresEnvironment(context.inheritedEnvironment, adminUrl),
      input: [
        "SELECT format('CREATE DATABASE %I', :'db_name')",
        "WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')",
        '\\gexec',
        '',
      ].join('\n'),
    },
  );
  if (!canConnect(context, targetUrl)) {
    fail(
      'Issue 255 PostgreSQL database creation could not be verified.',
    );
  }
}

function cleanupDatabase(context, targetUrl, expectedName) {
  const name = databaseName(targetUrl);
  if (name !== expectedName) {
    fail('Issue 255 cleanup refused an unexpected database name.');
  }
  const adminUrl = new URL(targetUrl);
  adminUrl.pathname = '/postgres';
  run(
    context.inheritedEnvironment,
    'PostgreSQL database cleanup',
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', `--set=db_name=${name}`],
    {
      env: postgresEnvironment(context.inheritedEnvironment, adminUrl),
      input: [
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db_name' AND pid <> pg_backend_pid();",
        "SELECT format('DROP DATABASE %I', :'db_name')",
        "WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')",
        '\\gexec',
        '',
      ].join('\n'),
    },
  );
  const residual = run(
    context.inheritedEnvironment,
    'PostgreSQL cleanup verification',
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      `--set=db_name=${name}`,
      '-At',
    ],
    {
      env: postgresEnvironment(context.inheritedEnvironment, adminUrl),
      input:
        "SELECT count(*) FROM pg_database WHERE datname = :'db_name';\n",
    },
  ).stdout.trim();
  if (residual !== '0') {
    fail('Issue 255 PostgreSQL cleanup left a residual database.');
  }
}

function canConnect(context, url) {
  return (
    spawnSync(
      'psql',
      ['-X', '-v', 'ON_ERROR_STOP=1', '-Atqc', 'SELECT 1'],
      {
        env: postgresEnvironment(context.inheritedEnvironment, url),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).status === 0
  );
}

function queryScalar(context, url, sql) {
  return run(
    context.inheritedEnvironment,
    'PostgreSQL verification',
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-Atqc', sql],
    {
      env: postgresEnvironment(context.inheritedEnvironment, url),
    },
  ).stdout.trim();
}

function postgresEnvironment(inheritedEnvironment, url) {
  return {
    ...inheritedEnvironment,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: databaseName(url),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'prefer',
  };
}

function pickEnvironment(environment, names) {
  return Object.fromEntries(
    names.flatMap((name) =>
      environment[name] === undefined
        ? []
        : [[name, environment[name]]],
    ),
  );
}

function run(inheritedEnvironment, label, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? inheritedEnvironment,
    input: options.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(
      `${label} failed with exit code ${result.status ?? 'spawn-error'}.`,
    );
  }
  return result;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runIssue255SafeProvision();
}
