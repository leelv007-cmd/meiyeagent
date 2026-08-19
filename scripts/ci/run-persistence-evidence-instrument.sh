#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the checked-out commit}"
: "${PERSISTENCE_POSTGRES_ADMIN_URL:?PERSISTENCE_POSTGRES_ADMIN_URL must identify the PostgreSQL admin database}"

if [[ -n "${PERSISTENCE_EVIDENCE_PATHS_FILE:-}" ]]; then
  PERSISTENCE_SELECTION_PATH="${PERSISTENCE_EVIDENCE_PATHS_FILE}" \
    PERSISTENCE_SELECTION_SHA="${RELEASE_COMMIT_SHA}" \
    node --input-type=module -e "import { readPersistenceSelection } from './scripts/ci/persistence-evidence-instrument.mjs'; const selection = await readPersistenceSelection(process.env.PERSISTENCE_SELECTION_PATH); if (selection.commitSha !== process.env.PERSISTENCE_SELECTION_SHA) throw new Error('Persistence selection commit SHA mismatch: expected ' + process.env.PERSISTENCE_SELECTION_SHA + ', got ' + selection.commitSha + '.');"
fi

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/persistence-instrument}"
mkdir -p "${evidence_dir}"
private_dir="$(mktemp -d "${TMPDIR:-/tmp}/meiye-persistence-pair.XXXXXX")"
private_pair="${private_dir}/pair.json"
cleanup_instrument_pair() {
  local original_status=$?
  local cleanup_status=0
  trap - EXIT
  if [[ -f "${evidence_dir}/provision.json" ]]; then
    if node scripts/ci/cleanup-persistence-instrument.mjs \
      --provision "${evidence_dir}/provision.json"; then
      :
    else
      cleanup_status=$?
      printf 'owner-verified persistence cleanup failed with exit code %s\n' "${cleanup_status}" >&2
    fi
  fi
  rm -f -- "${private_pair}"
  rmdir -- "${private_dir}" 2>/dev/null || true
  if [[ "${original_status}" -ne 0 ]]; then
    exit "${original_status}"
  fi
  exit "${cleanup_status}"
}
trap cleanup_instrument_pair EXIT

node scripts/ci/provision-persistence-instrument.mjs \
  --commit-sha "${RELEASE_COMMIT_SHA}" \
  --receipt "${evidence_dir}/provision.json" \
  --env-output "${private_pair}" \
  2>&1 | tee "${evidence_dir}/provision.log"
export TEST_DATABASE_URL="$(PAIR_PATH="${private_pair}" node -e "const p=require(process.env.PAIR_PATH); process.stdout.write(p.TEST_DATABASE_URL)")"
export TEST_DBOS_SYSTEM_DATABASE_URL="$(PAIR_PATH="${private_pair}" node -e "const p=require(process.env.PAIR_PATH); process.stdout.write(p.TEST_DBOS_SYSTEM_DATABASE_URL)")"
pnpm --filter @meiye/web locale:compile

runner_arguments=(
  run
  --provision "${evidence_dir}/provision.json"
  --output-dir "${evidence_dir}"
)
if [[ -n "${PERSISTENCE_EVIDENCE_PATHS_FILE:-}" ]]; then
  runner_arguments+=(--paths "${PERSISTENCE_EVIDENCE_PATHS_FILE}")
fi
node scripts/ci/run-persistence-evidence-instrument.mjs "${runner_arguments[@]}"
