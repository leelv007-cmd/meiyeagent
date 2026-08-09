#!/usr/bin/env bash
set -uo pipefail

evidence_dir="${CI_EVIDENCE_DIR:-output/ci/root-required-quality}"
mkdir -p "${evidence_dir}"

required_gate_status=0

run_required_gate() {
  local evidence_name="$1"
  local command_status
  shift

  if "$@" 2>&1 | tee "${evidence_dir}/${evidence_name}"; then
    return
  else
    command_status=$?
  fi

  required_gate_status=1
  printf '%s failed with exit code %s\n' "${evidence_name}" "${command_status}" \
    | tee -a "${evidence_dir}/required-gate-summary.log" >&2
}

run_required_gate root-typecheck.log pnpm typecheck
run_required_gate root-build.log pnpm build
run_required_gate root-test.log pnpm test
run_required_gate web-interaction-test.log pnpm --filter @meiye/web test:interaction
run_required_gate web-check.log pnpm --filter @meiye/web check
run_required_gate root-check.log pnpm check
run_required_gate secret-scan.json node scripts/uiux/secret-scan.mjs
run_required_gate bundle-report.json node scripts/uiux/bundle-budget.mjs

exit "${required_gate_status}"
