#!/usr/bin/env bash

set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "${script_dir}/../.." && pwd)"

if (($# > 0)); then
  echo "Database URLs must be provided through TEST_DATABASE_URL and TEST_DBOS_SYSTEM_DATABASE_URL, never argv." >&2
  exit 64
fi

business_url="${TEST_DATABASE_URL:-}"
dbos_url="${TEST_DBOS_SYSTEM_DATABASE_URL:-}"

if [[ -z "${business_url}" || -z "${dbos_url}" ]]; then
  echo "Usage: TEST_DATABASE_URL=<business-url> TEST_DBOS_SYSTEM_DATABASE_URL=<dbos-url> $0" >&2
  exit 64
fi

for command_name in node pnpm psql; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is unavailable: ${command_name}" >&2
    exit 69
  fi
done

database_url_part() {
  local part="$1"
  local url="$2"

  DATABASE_URL_TO_PARSE="${url}" node - "${part}" <<'NODE'
const part = process.argv[2];
const url = new URL(process.env.DATABASE_URL_TO_PARSE);
if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  throw new Error('Database URL must use postgres:// or postgresql://.');
}
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (!databaseName || databaseName.includes('/')) {
  throw new Error('Database URL must name exactly one database.');
}
if (part === 'database') {
  process.stdout.write(databaseName);
} else if (part === 'admin-url') {
  url.pathname = '/postgres';
  process.stdout.write(url.toString());
} else if (part === 'normalized-url') {
  url.search = '';
  url.hash = '';
  process.stdout.write(url.toString());
} else if (part === 'host') {
  process.stdout.write(url.hostname);
} else if (part === 'port') {
  process.stdout.write(url.port || '5432');
} else if (part === 'user') {
  process.stdout.write(decodeURIComponent(url.username));
} else if (part === 'password') {
  process.stdout.write(decodeURIComponent(url.password));
} else if (part === 'sslmode') {
  process.stdout.write(url.searchParams.get('sslmode') || '');
} else {
  throw new Error(`Unknown URL part: ${part}`);
}

NODE
}

psql_with_url() {
  local url="$1"
  shift
  local pg_database
  local pg_host
  local pg_password
  local pg_port
  local pg_sslmode
  local pg_user

  pg_database="$(database_url_part database "${url}")"
  pg_host="$(database_url_part host "${url}")"
  pg_password="$(database_url_part password "${url}")"
  pg_port="$(database_url_part port "${url}")"
  pg_sslmode="$(database_url_part sslmode "${url}")"
  pg_user="$(database_url_part user "${url}")"

  (
    export PGDATABASE="${pg_database}"
    export PGHOST="${pg_host}"
    export PGPASSWORD="${pg_password}"
    export PGPORT="${pg_port}"
    export PGUSER="${pg_user}"
    if [[ -n "${pg_sslmode}" ]]; then
      export PGSSLMODE="${pg_sslmode}"
    else
      unset PGSSLMODE
    fi
    exec psql "$@"
  )
}

business_normalized="$(database_url_part normalized-url "${business_url}")"
dbos_normalized="$(database_url_part normalized-url "${dbos_url}")"
if [[ "${business_normalized}" == "${dbos_normalized}" ]]; then
  echo "Business and DBOS system storage must use separate databases." >&2
  exit 65
fi

ensure_database() {
  local target_url="$1"
  local explicit_admin_url="$2"
  local database_name
  local admin_url

  if psql_with_url "${target_url}" -X -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null 2>&1; then
    return
  fi

  database_name="$(database_url_part database "${target_url}")"
  admin_url="${explicit_admin_url:-$(database_url_part admin-url "${target_url}")}"
  echo "Creating PostgreSQL database ${database_name}."
  psql_with_url "${admin_url}" -X -v ON_ERROR_STOP=1 --set=db_name="${database_name}" <<'SQL'
SELECT format('CREATE DATABASE %I', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec
SQL
  psql_with_url "${target_url}" -X -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null
}

ensure_database "${business_url}" "${BUSINESS_POSTGRES_ADMIN_URL:-}"
ensure_database "${dbos_url}" "${DBOS_POSTGRES_ADMIN_URL:-}"

echo "Applying App Shell Drizzle migrations to the business test database."
(
  cd "${repo_root}/mkfast-template-main"
  DATABASE_URL="${business_url}" pnpm db:migrate:local
)

session_table="$(
  psql_with_url "${business_url}" -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT COALESCE(to_regclass('public.session')::text, '')"
)"
if [[ "${session_table}" != "session" ]]; then
  echo "App Shell provisioning did not create public.session." >&2
  exit 66
fi

if [[ "${RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED:-}" == "true" ]]; then
  echo "Seeding Issue 247 provisional E2E bounded-execution limits through admin-config CAS."
  (
    cd "${repo_root}"
    DATABASE_URL="${business_url}" \
      pnpm --filter @meiye/core exec tsx \
      "${repo_root}/scripts/ci/seed-issue-247-e2e-provisional-bounds.mts"
  )
fi

if [[ "${RUN_ISSUE_298_E2E_CREDIT_PLAN_SEED:-}" == "true" ]]; then
  echo "Seeding Issue 298 published credit plan catalog through admin-config."
  (
    cd "${repo_root}"
    DATABASE_URL="${business_url}" \
      pnpm --filter @meiye/core exec tsx \
      "${repo_root}/scripts/ci/seed-issue-298-e2e-credit-plan-catalog.mts"
  )
fi

echo "Seeding platform default models through admin-config CAS."
(
  cd "${repo_root}"
  DATABASE_URL="${business_url}" \
    pnpm --filter @meiye/core exec tsx \
    "${repo_root}/scripts/dev/seed-platform-default-models.mts"
)

echo "Business schema is ready and DBOS system storage is separate."
