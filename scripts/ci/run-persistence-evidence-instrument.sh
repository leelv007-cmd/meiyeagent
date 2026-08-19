#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the checked-out commit}"
: "${PERSISTENCE_POSTGRES_ADMIN_URL:?PERSISTENCE_POSTGRES_ADMIN_URL must identify the PostgreSQL admin database}"

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/persistence-instrument}"
mkdir -p "${evidence_dir}"
private_pair="$(mktemp "${TMPDIR:-/tmp}/meiye-persistence-pair.XXXXXX.json")"
trap 'rm -f "${private_pair}"' EXIT

node scripts/ci/provision-persistence-instrument.mjs \
  --commit-sha "${RELEASE_COMMIT_SHA}" \
  --receipt "${evidence_dir}/provision.json" \
  --env-output "${private_pair}" \
  2>&1 | tee "${evidence_dir}/provision.log"
export TEST_DATABASE_URL="$(PAIR_PATH="${private_pair}" node -e "const p=require(process.env.PAIR_PATH); process.stdout.write(p.TEST_DATABASE_URL)")"
export TEST_DBOS_SYSTEM_DATABASE_URL="$(PAIR_PATH="${private_pair}" node -e "const p=require(process.env.PAIR_PATH); process.stdout.write(p.TEST_DBOS_SYSTEM_DATABASE_URL)")"
pnpm --filter @meiye/web locale:compile

node scripts/ci/run-persistence-evidence-instrument.mjs run \
  --provision "${evidence_dir}/provision.json" \
  --output-dir "${evidence_dir}"
