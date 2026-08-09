#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the PR candidate}"

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/v31-browser-acceptance}"
mkdir -p "${evidence_dir}"

export PLAYWRIGHT_PROVIDER_FREE=true
export MODEL_EXECUTION_MODE=fixture
unset PLAYWRIGHT_PRODUCTION_CANDIDATE || true

# Explicit rather than globbed: adding a V3.1 spec does not silently make it a
# required check without a deliberate catalog and CI contract update.
v31_specs=(
  tests/e2e/specs/v31-day0-free-creation-journey.spec.ts
  tests/e2e/specs/v31-living-plan-journey.spec.ts
  tests/e2e/specs/v31-context-fence-journey.spec.ts
  tests/e2e/specs/v31-mid-run-steering-journey.spec.ts
  tests/e2e/specs/v31-interrupt-resume-journey.spec.ts
  tests/e2e/specs/v31-thread-root-workbench.spec.ts
  tests/e2e/specs/v31-ops-console-release-journey.spec.ts
  tests/e2e/specs/v31-publish-handoff-selfreport.spec.ts
  tests/e2e/specs/v31-goal-proactive-idle.spec.ts
)

node scripts/production-network-boundary-gate.mjs \
  --expected-commit-sha "${RELEASE_COMMIT_SHA}" \
  2>&1 | tee "${evidence_dir}/production-boundary.log"

pnpm --filter @meiye/web exec playwright test \
  "${v31_specs[@]}" \
  2>&1 | tee "${evidence_dir}/playwright-v31-browser-acceptance.log"
