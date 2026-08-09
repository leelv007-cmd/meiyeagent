#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the PR candidate}"

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/v31-browser-acceptance}"
mkdir -p "${evidence_dir}"

export PLAYWRIGHT_PROVIDER_FREE=true
export MODEL_EXECUTION_MODE=fixture
unset PLAYWRIGHT_PRODUCTION_CANDIDATE || true

web_root=mkfast-template-main

# Explicit rather than globbed: adding a V3.1 spec does not silently make it a
# required check without a deliberate catalog and CI contract update, and a
# journey whose spec file has not landed yet keeps this gate red instead of
# silently passing with fewer specs.
#
# One file per V3.1 §37.4 journey letter. The journey definitions are
# authoritative in docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md
# §37.4 (from line 1763); the file names below follow that section's wording, so
# read it there instead of re-deriving a journey from a spec file.
v31_specs=(
  tests/e2e/specs/v31-day0-free-creation-journey.spec.ts   # §37.4-A Day-0 自由创作
  tests/e2e/specs/v31-level1-copy-journey.spec.ts          # §37.4-B Level 1 纯 copy
  tests/e2e/specs/v31-memory-injection-journey.spec.ts     # §37.4-B2 记忆注入透明
  tests/e2e/specs/v31-living-plan-journey.spec.ts          # §37.4-C 定制图文
  tests/e2e/specs/v31-video-paid-execution-journey.spec.ts # §37.4-D 视频付费执行
  tests/e2e/specs/v31-context-fence-journey.spec.ts        # §37.4-E Plan stale
  tests/e2e/specs/v31-rights-revocation-journey.spec.ts    # §37.4-F 素材撤权
  tests/e2e/specs/v31-mid-run-steering-journey.spec.ts     # §37.4-G Mid-run Steering
  tests/e2e/specs/v31-interrupt-resume-journey.spec.ts     # §37.4-H Interrupt resume
  tests/e2e/specs/v31-thread-root-workbench.spec.ts        # §37.4-I Thread 连续
  tests/e2e/specs/v31-ops-console-release-journey.spec.ts  # §37.4-J Harness Release
  tests/e2e/specs/v31-publish-handoff-selfreport.spec.ts   # §37.4-K 自报旅程
  tests/e2e/specs/v31-artifact-growth-journey.spec.ts      # Artifact semantic stream
  tests/e2e/specs/v31-goal-proactive-idle.spec.ts          # Goal surface + proactive idle
  tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts  # V31-18 B2 生产合同（receipt/风格/不泄漏/撤销）
  tests/e2e/specs/v31-partial-resume-assisted-journey.spec.ts # V31-16 部分交付续跑
)

missing_specs=()
for spec in "${v31_specs[@]}"; do
  if [[ ! -f "${web_root}/${spec}" ]]; then
    missing_specs+=("${web_root}/${spec}")
  fi
done

if ((${#missing_specs[@]} > 0)); then
  {
    printf 'V3.1 browser acceptance is missing %s required spec file(s):\n' \
      "${#missing_specs[@]}"
    printf -- '- %s\n' "${missing_specs[@]}"
    printf 'Every §37.4 journey must exist as a real spec; the gate fails closed.\n'
  } | tee "${evidence_dir}/missing-specs.log" >&2
  exit 1
fi

node scripts/production-network-boundary-gate.mjs \
  --expected-commit-sha "${RELEASE_COMMIT_SHA}" \
  2>&1 | tee "${evidence_dir}/production-boundary.log"

pnpm --filter @meiye/web exec playwright test \
  "${v31_specs[@]}" \
  2>&1 | tee "${evidence_dir}/playwright-v31-browser-acceptance.log"
