#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the PR candidate}"

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/production-main-journey}"
if [[ "${evidence_dir}" = /* ]]; then
  evidence_root="${evidence_dir}"
else
  evidence_root="$(pwd -P)/${evidence_dir}"
fi
required_e2e_spec="${REQUIRED_E2E_SPEC:-tests/e2e/specs/assembly-gate-required-journey.spec.ts}"
# M-04 / T37: the three-modality mainline journey is a required check, not a
# strict spec that merely exists. It rides the assembly gate's own mechanism
# (T04) so the ordinary pull request runs exactly one browser gate job.
required_hard_gate_spec="${REQUIRED_BROWSER_HARD_GATE_SPEC:-tests/e2e/specs/m04-browser-hard-gate.spec.ts}"
# L4 / XHS main chain: fixture-grade 小红书图文 → execution confirm → delivered
# note object workspace. Kept as a dedicated lean file so the journey budget
# stays near three minutes for this path without pulling the full T20 suite.
xhs_image_text_main_spec="${XHS_IMAGE_TEXT_MAIN_JOURNEY_SPEC:-tests/e2e/specs/xhs-image-text-main-journey.spec.ts}"
# V31-18 B2 is a required production browser contract: receipt persistence,
# structured style application, non-leakage, revoke, and next-task exclusion.
memory_injection_b2_spec="${REQUIRED_V31_MEMORY_INJECTION_SPEC:-tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts}"
# V31-18 AC4: deleted-conversation provenance must stay honest in the memory
# vault (来源对话已删除). The assertion has lived in memory-vault-governance
# since it was written; no required gate ran it until this entry.
memory_vault_governance_spec="${MEMORY_VAULT_GOVERNANCE_SPEC:-tests/e2e/specs/memory-vault-governance.spec.ts}"
agent_thread_workbench_spec="${AGENT_THREAD_WORKBENCH_SPEC:-tests/e2e/specs/v31-thread-root-workbench.spec.ts}"
# V31 U7: visible Campaign plan_only + two sequential single_work confirms.
campaign_paid_work_spec="${CAMPAIGN_PAID_WORK_JOURNEY_SPEC:-tests/e2e/specs/campaign-paid-work-confirmation.spec.ts}"
mkdir -p "${evidence_root}"
batch_manifest="${evidence_root}/production-browser-batches.tsv"
for batch_name in mainline composer governance; do
  if [[ -e "${evidence_root}/${batch_name}" ]]; then
    printf 'Refusing to mix production browser evidence in existing directory: %s\n' \
      "${evidence_root}/${batch_name}" >&2
    exit 2
  fi
done

export PLAYWRIGHT_PRODUCTION_CANDIDATE=true
export PLAYWRIGHT_PROVIDER_FREE=true
export MODEL_EXECUTION_MODE=fixture
export E2E_SERVICE_MAX_RESTARTS=0

node scripts/production-network-boundary-gate.mjs \
  --expected-commit-sha "${RELEASE_COMMIT_SHA}" \
  2>&1 | tee "${evidence_root}/production-boundary.log"

printf 'commitSha\tbatch\tstatus\tspecs\n' > "${batch_manifest}"

# Playwright webServer in CI does not reuse servers, but SIGTERM of one batch
# can leave wrangler/vite/core bound. The next batch then dies with
# "http://localhost:3010 is already used" instead of starting a fresh candidate.
stop_production_journey_servers() {
  local port pid
  for port in \
    "${PLAYWRIGHT_CANDIDATE_PORT:-}" \
    "${PLAYWRIGHT_WEB_PORT:-}" \
    "${PORT:-}" \
    "${PLAYWRIGHT_CORE_PORT:-}"; do
    [[ -n "${port}" ]] || continue
    while read -r pid; do
      [[ -n "${pid}" ]] || continue
      kill -9 "${pid}" 2>/dev/null || true
    done < <(lsof -ti ":${port}" 2>/dev/null || true)
  done
}

run_browser_batch() {
  local batch_name="$1"
  shift
  local batch_evidence_dir="${evidence_root}/${batch_name}"
  local batch_status=0

  if [[ -e "${batch_evidence_dir}" ]]; then
    printf 'Refusing to mix production browser evidence in existing directory: %s\n' \
      "${batch_evidence_dir}" >&2
    return 2
  fi
  mkdir "${batch_evidence_dir}"
  stop_production_journey_servers
  if CI_EVIDENCE_DIR="${batch_evidence_dir}" \
    pnpm --filter @meiye/web exec playwright test \
      "$@" \
      --retries=0 \
      --trace=retain-on-failure \
      --output="${batch_evidence_dir}/test-results" \
      2>&1 | tee "${batch_evidence_dir}/playwright.log"; then
    batch_status=0
  else
    batch_status=$?
  fi
  stop_production_journey_servers

  printf '%s\t%s\t%s\t%s\n' \
    "${RELEASE_COMMIT_SHA}" \
    "${batch_name}" \
    "${batch_status}" \
    "$*" >> "${batch_manifest}"
  return "${batch_status}"
}

# Keep each local Wrangler candidate short-lived while preserving one release
# SHA and one business database across the complete production journey. Each
# Playwright invocation receives a fresh DBOS database derived by the config.
# Wrangler storage stays shared, matching the former single-run state semantics;
# the isolation boundary is the runtime process, not persisted product state.
run_browser_batch mainline \
  "${required_e2e_spec}" \
  "${required_hard_gate_spec}" \
  tests/e2e/specs/marketing-identity-flow.spec.ts

run_browser_batch composer \
  tests/e2e/specs/w12-identity-draft-assistant.spec.ts \
  "${xhs_image_text_main_spec}" \
  "${memory_injection_b2_spec}"

run_browser_batch governance \
  "${memory_vault_governance_spec}" \
  "${agent_thread_workbench_spec}" \
  "${campaign_paid_work_spec}"
