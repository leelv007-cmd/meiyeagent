#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the checked-out commit}"
: "${TEST_DATABASE_URL:?TEST_DATABASE_URL must identify the business database}"
: "${TEST_DBOS_SYSTEM_DATABASE_URL:?TEST_DBOS_SYSTEM_DATABASE_URL must identify the DBOS system database}"

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/persistence-instrument}"
mkdir -p "${evidence_dir}"

bash scripts/ci/provision-test-db.sh 2>&1 | tee "${evidence_dir}/provision.log"
pnpm --filter @meiye/web locale:compile

PERSISTENCE_DATABASES_FRESH=true \
  node scripts/ci/run-persistence-evidence-instrument.mjs run \
    --output-dir "${evidence_dir}"
