import { spawnSync } from 'node:child_process';

const QUERY_ENV_KEYS = Object.freeze({
  application_name: 'PGAPPNAME',
  connect_timeout: 'PGCONNECT_TIMEOUT',
  options: 'PGOPTIONS',
  sslcert: 'PGSSLCERT',
  sslkey: 'PGSSLKEY',
  sslmode: 'PGSSLMODE',
  sslrootcert: 'PGSSLROOTCERT',
});

export function postgresDatabaseName(connectionUrl) {
  const url = new URL(connectionUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database || database.includes('/')) {
    throw new Error('PostgreSQL connection URL must name exactly one database.');
  }
  return database;
}

export function postgresProcessEnv(connectionUrl, baseEnv = {}) {
  const url = new URL(connectionUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('PostgreSQL process URL must use postgres:// or postgresql://.');
  }
  const connectionEnv = {
    PGDATABASE: postgresDatabaseName(connectionUrl),
    PGHOST: url.hostname,
    PGPASSWORD: decodeURIComponent(url.password),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
  };
  for (const [parameter, envKey] of Object.entries(QUERY_ENV_KEYS)) {
    const value = url.searchParams.get(parameter);
    if (value !== null) connectionEnv[envKey] = value;
  }
  return { ...process.env, ...connectionEnv, ...baseEnv };
}

export function runPostgresStatementSync(
  connectionUrl,
  statement,
  { args = [], command = 'psql', cwd, env = {} } = {},
) {
  const result = spawnSync(
    command,
    ['-X', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-', ...args],
    {
      ...(cwd ? { cwd } : {}),
      encoding: 'utf8',
      env: postgresProcessEnv(connectionUrl, env),
      input: statement,
    },
  );
  return {
    status: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}
