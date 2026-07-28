#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the PR candidate}"

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/production-main-journey}"
required_e2e_spec="${REQUIRED_E2E_SPEC:-tests/e2e/specs/assembly-gate-required-journey.spec.ts}"
# M-04 / T37: the three-modality mainline journey is a required check, not a
# strict spec that merely exists. It rides the assembly gate's own mechanism
# (T04) so the ordinary pull request runs exactly one browser gate job.
required_hard_gate_spec="${REQUIRED_BROWSER_HARD_GATE_SPEC:-tests/e2e/specs/m04-browser-hard-gate.spec.ts}"
mkdir -p "${evidence_dir}"

export PLAYWRIGHT_PRODUCTION_CANDIDATE=true
export PLAYWRIGHT_PROVIDER_FREE=true
export MODEL_EXECUTION_MODE=fixture

node scripts/production-network-boundary-gate.mjs \
  --expected-commit-sha "${RELEASE_COMMIT_SHA}" \
  2>&1 | tee "${evidence_dir}/production-boundary.log"

pnpm --filter @meiye/web exec playwright test \
  "${required_e2e_spec}" \
  "${required_hard_gate_spec}" \
  tests/e2e/specs/marketing-identity-flow.spec.ts \
  tests/e2e/specs/w12-identity-draft-assistant.spec.ts \
  2>&1 | tee "${evidence_dir}/playwright-production-journey.log"
