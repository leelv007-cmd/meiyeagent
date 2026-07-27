import type { DBOSConfig } from '@dbos-inc/dbos-sdk';

export interface HarnessRuntimeConfig {
  businessDatabaseUrl: string;
  businessPoolMax: number;
  dbos: DBOSConfig;
}

/**
 * One store-intake finalize holds three business connections at its peak: the
 * finalization advisory-lock client, the pinned fact-head client, and the
 * profile merge that runs inside that pin. A smaller pool cannot make the last
 * hop, and the two it already holds are never released while it waits — the
 * finalize hangs forever instead of failing. Hence the floor.
 */
const MINIMUM_BUSINESS_POOL_MAX = 3;

export function assertPendingActionsShareDatabase(input: {
  approvalRequestsDatabaseUrl: string;
  pendingQuestionsDatabaseUrl: string;
}) {
  if (
    postgresDatabaseIdentity(input.approvalRequestsDatabaseUrl) !==
    postgresDatabaseIdentity(input.pendingQuestionsDatabaseUrl)
  ) {
    throw new Error(
      'Pending actions question and approval stores must use the same Postgres database.',
    );
  }
}

export function readHarnessRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): HarnessRuntimeConfig {
  const businessDatabaseUrl = required(env.DATABASE_URL, 'DATABASE_URL');
  const systemDatabaseUrl = required(
    env.HARNESS_DBOS_SYSTEM_DATABASE_URL,
    'HARNESS_DBOS_SYSTEM_DATABASE_URL',
  );
  if (normalizeDatabaseUrl(businessDatabaseUrl) === normalizeDatabaseUrl(systemDatabaseUrl)) {
    throw new Error('Harness DBOS system storage must use a separate database.');
  }
  const applicationVersion =
    env.HARNESS_DBOS_APPLICATION_VERSION ?? env.DBOS__APPVERSION;
  return {
    businessDatabaseUrl,
    businessPoolMax: atLeastFinalizePeak(
      positiveInteger(env.HARNESS_DB_POOL_MAX, 8),
    ),
    dbos: {
      name: 'beauty-marketing-harness',
      systemDatabaseUrl,
      systemDatabasePoolSize: positiveInteger(
        env.HARNESS_DBOS_SYSTEM_POOL_MAX,
        4,
      ),
      ...(applicationVersion ? { applicationVersion } : {}),
    },
  };
}

function required(value: string | undefined, name: string) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('Harness pool sizes must be positive integers.');
  }
  return parsed;
}

function atLeastFinalizePeak(value: number) {
  if (value >= MINIMUM_BUSINESS_POOL_MAX) return value;
  console.warn(
    `HARNESS_DB_POOL_MAX=${value} is below the ${MINIMUM_BUSINESS_POOL_MAX} connections one store-intake finalize holds at once (finalization advisory lock + pinned fact heads + profile merge); raising it to ${MINIMUM_BUSINESS_POOL_MAX}.`,
  );
  return MINIMUM_BUSINESS_POOL_MAX;
}

function normalizeDatabaseUrl(value: string) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function postgresDatabaseIdentity(value: string) {
  const url = new URL(value);
  const protocol = url.protocol === 'postgresql:' ? 'postgres:' : url.protocol;
  const port = url.port || '5432';
  return `${protocol}//${url.hostname.toLowerCase()}:${port}${url.pathname}`;
}
