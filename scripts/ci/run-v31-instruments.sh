#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the instrumented commit}"

evidence_root="${CI_EVIDENCE_DIR:-output/ci/v31-browser-report}"
instrument_dir="${evidence_root}/instruments"
instrument_spec="tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts"
mkdir -p "${instrument_dir}"

pnpm --filter @meiye/web exec playwright test \
  "${instrument_spec}" \
  --retries=0 \
  2>&1 | tee "${instrument_dir}/playwright-v31-82-stalled-image-work-timeout.log"
