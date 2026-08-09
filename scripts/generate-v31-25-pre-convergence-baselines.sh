#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
fixed_commit="${V31_PRE_CONVERGENCE_COMMIT:-c8e679fef11ecdefcb542e5d12296bb7bcd5e91b}"
output_path="${1:-${repo_root}/apps/core/src/p1/harness/fixtures/pre-convergence-equivalence-baselines.generated.json}"
scratch="$(mktemp -d)"
fixed_worktree="${scratch}/fixed"

cleanup() {
  git -C "${repo_root}" worktree remove --force "${fixed_worktree}" >/dev/null 2>&1 || true
  rm -rf "${scratch}"
}
trap cleanup EXIT

git -C "${repo_root}" cat-file -e "${fixed_commit}^{commit}"
git -C "${repo_root}" worktree add --detach "${fixed_worktree}" "${fixed_commit}" >/dev/null

# The exporter and convergence-only helpers are copied into the fixed tree;
# workflow-core.ts is deliberately left at fixed_commit, which is the code
# whose observable fixture results are being captured.
for relative_path in \
  apps/core/src/p1/harness/carrier-unit-recipes.ts \
  apps/core/src/p1/harness/compiled-carrier-executor.ts \
  apps/core/src/p1/harness/five-stage-trace-taxonomy.ts \
  apps/core/src/p1/harness/make-snapshot-consume.ts \
  apps/core/src/p1/harness/runner-convergence.test.ts \
  apps/core/src/p1/harness/runner-equivalence.ts \
  apps/core/src/p1/harness/fixtures/pre-convergence-equivalence-baselines.ts
do
  mkdir -p "${fixed_worktree}/$(dirname "${relative_path}")"
  cp "${repo_root}/${relative_path}" "${fixed_worktree}/${relative_path}"
done

ln -s "${repo_root}/apps/core/node_modules" "${fixed_worktree}/apps/core/node_modules"
ln -s "${repo_root}/packages/contracts/node_modules" "${fixed_worktree}/packages/contracts/node_modules"

mkdir -p "$(dirname "${output_path}")"
V31_PRE_CONVERGENCE_BASELINE_OUTPUT="${output_path}" \
  pnpm --dir "${fixed_worktree}/apps/core" exec tsx --test --test-concurrency=1 \
  --test-name-pattern='every fixture task matches its frozen pre-convergence baseline' \
  src/p1/harness/runner-convergence.test.ts

printf 'Generated %s from %s\n' "${output_path}" "${fixed_commit}"
