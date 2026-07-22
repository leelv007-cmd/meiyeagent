#!/usr/bin/env bash
set -euo pipefail

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must identify the business database}"
: "${TEST_DBOS_SYSTEM_DATABASE_URL:?TEST_DBOS_SYSTEM_DATABASE_URL must identify the DBOS system database}"

log_path="${CORE_PERSISTENCE_LOG_PATH:-core-persistence-test.log}"

pnpm --filter @meiye/core exec node --import tsx --test --test-concurrency=1 --test-reporter=spec 'src/**/*.test.ts' 2>&1 | tee "${log_path}"
node scripts/ci/assert-core-persistence-ran.mjs "${log_path}"
