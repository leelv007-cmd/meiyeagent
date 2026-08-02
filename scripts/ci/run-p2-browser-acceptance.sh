#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the PR candidate}"

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/p2-browser-acceptance}"
mkdir -p "${evidence_dir}"

export PLAYWRIGHT_PRODUCTION_CANDIDATE=true
export PLAYWRIGHT_PROVIDER_FREE=true
export MODEL_EXECUTION_MODE=fixture

# P2 Chromium acceptance surface (#320–#328 related). Kept separate from the
# production-main-journey gate so the ordinary PR journey stays lean while P2
# still has required browser coverage on every push/PR.
p2_specs=(
  tests/e2e/specs/image-text-note-compiler.spec.ts
  tests/e2e/specs/viral-adapt-opencli-gate.spec.ts
  tests/e2e/specs/p2-browser-closure.spec.ts
  tests/e2e/specs/admin-sensitive-words.spec.ts
  tests/e2e/specs/composer-card-family.spec.ts
)

node scripts/production-network-boundary-gate.mjs \
  --expected-commit-sha "${RELEASE_COMMIT_SHA}" \
  2>&1 | tee "${evidence_dir}/production-boundary.log"

pnpm --filter @meiye/web exec playwright test \
  "${p2_specs[@]}" \
  2>&1 | tee "${evidence_dir}/playwright-p2-browser-acceptance.log"
