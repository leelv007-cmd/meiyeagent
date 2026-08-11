#!/usr/bin/env bash
set -euo pipefail

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must identify the business database}"
: "${TEST_DBOS_SYSTEM_DATABASE_URL:?TEST_DBOS_SYSTEM_DATABASE_URL must identify the DBOS system database}"

log_path="${CORE_PERSISTENCE_LOG_PATH:-core-persistence-test.log}"
mkdir -p "$(dirname "${log_path}")"
manifest_path="${CORE_PERSISTENCE_MANIFEST_PATH:-$(dirname "${log_path}")/core-persistence-suite-manifest.json}"

node scripts/ci/assert-core-suite-owners.mjs
bash scripts/ci/provision-test-db.sh
# Product-billing postgres suite shells into web `composer-live` via tsx --eval;
# that import graph needs paraglide message modules (otherwise MODULE_NOT_FOUND).
pnpm --filter @meiye/web locale:compile
node scripts/ci/run-core-suite.mjs --owner core-persistence --reporter spec --manifest-path "${manifest_path}" 2>&1 | tee "${log_path}"
node scripts/ci/assert-core-persistence-ran.mjs "${log_path}"
