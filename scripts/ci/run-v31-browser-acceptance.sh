#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the PR candidate}"

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/v31-browser-acceptance}"
mkdir -p "${evidence_dir}"

export PLAYWRIGHT_PROVIDER_FREE=true
export MODEL_EXECUTION_MODE=fixture
unset PLAYWRIGHT_PRODUCTION_CANDIDATE || true

web_root=mkfast-template-main

# Gate shrink (2026-08-14): one catalog, two CI jobs. `day0` runs only the
# release-gate journey (required job v31-day0-gate); `remaining` runs the rest
# per file (telemetry job v31-browser-report — red stays visible on the PR but
# does not block merge); `full` keeps the historical single-run shape for local
# use. The catalog integrity check and the production boundary gate run in
# every scope, so no scope can pass with a missing spec file.
scope="${V31_GATE_SCOPE:-full}"
case "${scope}" in
  full | day0 | remaining) ;;
  *)
    printf 'Unknown V31_GATE_SCOPE: %s (expected full, day0, or remaining)\n' \
      "${scope}" >&2
    exit 2
    ;;
esac

# Explicit rather than globbed: adding a V3.1 spec does not silently make it a
# required check without a deliberate catalog and CI contract update, and a
# journey whose spec file has not landed yet keeps this gate red instead of
# silently passing with fewer specs.
#
# One file per V3.1 §37.4 journey letter. The journey definitions are
# authoritative in docs/design/0808规划/meiye-agent-v3.1-authoritative-plan-2026-08-08.md
# §37.4 (from line 1763); the file names below follow that section's wording, so
# read it there instead of re-deriving a journey from a spec file.
#
# The first entry is out of §37.4 order on purpose (retro R1, 2026-08-13): the
# zero-source first visit is the v3.1 release gate, so it runs first and alone
# below. Keep it first here too, so the catalog reads the way the gate runs.
v31_specs=(
  tests/e2e/specs/v31-zero-source-image-text-first-visit.spec.ts # V31-73 零素材图文首访（release gate，先跑）
  tests/e2e/specs/v31-day0-free-creation-journey.spec.ts   # §37.4-A Day-0 自由创作
  tests/e2e/specs/v31-free-explicit-fact-selector.spec.ts # FREE 显式门店资料授权
  tests/e2e/specs/v31-level1-copy-journey.spec.ts          # §37.4-B Level 1 纯 copy
  tests/e2e/specs/v31-memory-injection-b2-journey.spec.ts  # §37.4-B2 记忆注入透明
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
  tests/e2e/specs/v31-partial-resume-assisted-journey.spec.ts # V31-16 部分交付续跑
  # D6=A: v31-82 is instrument-only until a stall fixture exists (not product-red).
  tests/e2e/specs/v31-83-composer-session-cross-account.spec.ts # V31-83 跨账号会话隔离
  tests/e2e/specs/v31-84-store-onboarding-capture-confirm.spec.ts # V31-84 Day-0 录入链
  tests/e2e/specs/v31-86-store-onboarding-archive-card.spec.ts # V31-86 档案卡一击确认
  tests/e2e/specs/v31-85-video-fallback-recipe-dead-end.spec.ts # V31-85 零素材视频诚实引导
  tests/e2e/specs/v31-87-same-content-reupload.spec.ts # V31-87 同内容跨面重传
  tests/e2e/specs/v31-88-asset-library-composer-source-attach.spec.ts # V31-88 素材库挂源
  tests/e2e/specs/v31-89-spoken-sentence-llm-extract.spec.ts # V31-89 口语提取整理
)

missing_specs=()
for spec in "${v31_specs[@]}"; do
  if [[ ! -f "${web_root}/${spec}" ]]; then
    already_missing=false
    if ((${#missing_specs[@]} > 0)); then
      for missing_spec in "${missing_specs[@]}"; do
        if [[ "${missing_spec}" == "${web_root}/${spec}" ]]; then
          already_missing=true
          break
        fi
      done
    fi
    if [[ "${already_missing}" == false ]]; then
      missing_specs+=("${web_root}/${spec}")
    fi
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

# Retro R1: 「零素材新商家首访 → 提交 → 拿到成品」 is the v3.1 release gate, so it
# runs first and alone. Listing it first inside `v31_specs` would not achieve
# that — Playwright walks discovered files in path order, not in the order the
# CLI names them. The 2026-08-13 gate run proved it: the catalog opened with the
# day-0 journey and v31-82 still ran first. Only a separate invocation makes
# 「首位」 real.
#
# When day-0 is red the remaining journeys are recorded as NOT evaluated rather
# than run (V31-64 semantics): with the first visit unusable, a green elsewhere
# carries no release meaning, and reporting it as one is how V31-73's dead end
# survived a fully green suite.
day0_release_gate_spec=tests/e2e/specs/v31-zero-source-image-text-first-visit.spec.ts

if [[ "${scope}" != "remaining" ]]; then
  if ! pnpm --filter @meiye/web exec playwright test \
    "${day0_release_gate_spec}" \
    2>&1 | tee "${evidence_dir}/playwright-v31-day0-release-gate.log"; then
    if [[ "${scope}" == "full" ]]; then
      not_evaluated=()
      for spec in "${v31_specs[@]}"; do
        if [[ "${spec}" != "${day0_release_gate_spec}" ]]; then
          not_evaluated+=("${spec}")
        fi
      done
      {
        printf 'DAY-0 RELEASE GATE RED: %s failed — remaining %s specs NOT evaluated;\n' \
          "${day0_release_gate_spec}" "${#not_evaluated[@]}"
        printf 'day-0 evidence: %s\n' \
          "${evidence_dir}/playwright-v31-day0-release-gate.log"
        printf -- '- %s\n' "${not_evaluated[@]}"
      } | tee "${evidence_dir}/day0-gate-not-evaluated.log" >&2
    else
      # day0 scope: the remaining catalog is v31-browser-report's business and
      # is still evaluated there, so no NOT-evaluated claim is made here.
      printf 'DAY-0 RELEASE GATE RED: %s failed; day-0 evidence: %s\n' \
        "${day0_release_gate_spec}" \
        "${evidence_dir}/playwright-v31-day0-release-gate.log" >&2
    fi
    exit 1
  fi
fi

if [[ "${scope}" == "day0" ]]; then
  exit 0
fi

remaining_specs=()
for spec in "${v31_specs[@]}"; do
  if [[ "${spec}" != "${day0_release_gate_spec}" ]]; then
    remaining_specs+=("${spec}")
  fi
done

# One Playwright process per remaining file. A shared remaining invoke keeps
# one Vite/workerd alive across 40 tests; when that process dies, V31-64
# marks every later file NOT evaluated. Per-file stacks give each journey a
# verdict. retries=0: CI's default 2 retries turn one 3–6 min red into a
# process-lifetime kill.
passed_specs=()
failed_specs=()
instrument_specs=()

for spec in "${remaining_specs[@]}"; do
  slug="$(basename "${spec}" .spec.ts)"
  spec_log="${evidence_dir}/playwright-${slug}.log"
  set +e
  pnpm --filter @meiye/web exec playwright test \
    "${spec}" \
    --retries=0 \
    2>&1 | tee "${spec_log}"
  status="${PIPESTATUS[0]}"
  set -e
  if [[ "${status}" -eq 0 ]]; then
    passed_specs+=("${spec}")
    continue
  fi
  if grep -q 'GATE INSTRUMENT FAILURE' "${spec_log}"; then
    instrument_specs+=("${spec}")
  else
    failed_specs+=("${spec}")
  fi
done

{
  printf 'V3.1 remaining-file verdicts: %s passed, %s failed, %s instrument\n' \
    "${#passed_specs[@]}" "${#failed_specs[@]}" "${#instrument_specs[@]}"
  if ((${#passed_specs[@]} > 0)); then
    printf 'passed:\n'
    printf -- '- %s\n' "${passed_specs[@]}"
  fi
  if ((${#failed_specs[@]} > 0)); then
    printf 'failed:\n'
    printf -- '- %s\n' "${failed_specs[@]}"
  fi
  if ((${#instrument_specs[@]} > 0)); then
    printf 'instrument:\n'
    printf -- '- %s\n' "${instrument_specs[@]}"
  fi
} | tee "${evidence_dir}/v31-file-verdicts.log"

if ((${#failed_specs[@]} > 0 || ${#instrument_specs[@]} > 0)); then
  exit 1
fi
