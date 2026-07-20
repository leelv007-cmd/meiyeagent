#!/usr/bin/env bash

set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(CDPATH= cd -- "${script_dir}/../.." && pwd)"

business_url="${1:-${TEST_DATABASE_URL:-}}"
dbos_url="${2:-${TEST_DBOS_SYSTEM_DATABASE_URL:-}}"

if [[ -z "${business_url}" || -z "${dbos_url}" ]]; then
  echo "Usage: TEST_DATABASE_URL=<business-url> TEST_DBOS_SYSTEM_DATABASE_URL=<dbos-url> $0" >&2
  echo "       $0 <business-url> <dbos-url>" >&2
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
} else {
  throw new Error(`Unknown URL part: ${part}`);
}
NODE
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

  if psql "${target_url}" -X -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null 2>&1; then
    return
  fi

  database_name="$(database_url_part database "${target_url}")"
  admin_url="${explicit_admin_url:-$(database_url_part admin-url "${target_url}")}"
  echo "Creating PostgreSQL database ${database_name}."
  psql "${admin_url}" -X -v ON_ERROR_STOP=1 --set=db_name="${database_name}" <<'SQL'
SELECT format('CREATE DATABASE %I', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')
\gexec
SQL
  psql "${target_url}" -X -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null
}

ensure_database "${business_url}" "${BUSINESS_POSTGRES_ADMIN_URL:-}"
ensure_database "${dbos_url}" "${DBOS_POSTGRES_ADMIN_URL:-}"

echo "Applying App Shell Drizzle migrations to the business test database."
(
  cd "${repo_root}/mkfast-template-main"
  DATABASE_URL="${business_url}" pnpm db:migrate:local
)

session_table="$(
  psql "${business_url}" -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT COALESCE(to_regclass('public.session')::text, '')"
)"
if [[ "${session_table}" != "session" ]]; then
  echo "App Shell provisioning did not create public.session." >&2
  exit 66
fi

echo "Applying Pro Studio / advanced canvas schema to the business test database."
(
  cd "${repo_root}"
  # tsx comes from @meiye/core; apply-pro-studio-schema.mts resolves pg via apps/core.
  DATABASE_URL="${business_url}" pnpm --filter @meiye/core exec tsx "${repo_root}/scripts/ci/apply-pro-studio-schema.mts"
)

canvas_table="$(
  psql "${business_url}" -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT COALESCE(to_regclass('public.advanced_canvas_projects')::text, '')"
)"
if [[ "${canvas_table}" != "advanced_canvas_projects" ]]; then
  echo "Pro Studio provisioning did not create public.advanced_canvas_projects." >&2
  exit 67
fi

echo "Business schema is ready and DBOS system storage is separate."
