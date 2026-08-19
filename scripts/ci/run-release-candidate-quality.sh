#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the release candidate}"
# The four-unit staging manifest is minted by the release-manifest job and
# downloaded as an artifact (scripts/ci/build-release-manifest.mjs). Name the
# missing input here instead of failing several lines deeper in the gate.
: "${RELEASE_MANIFEST_PATH:?RELEASE_MANIFEST_PATH must point at the downloaded staging release manifest}"

# Same-commit provider live + release-manifest gate. Fail closed when the
# current SHA lacks a bound primary_connectivity evidence artifact (#147).
node scripts/ci/assert-release-candidate-evidence.mjs

boundary_args=(--expected-commit-sha "$RELEASE_COMMIT_SHA")
if [[ -n "${PRODUCTION_NETWORK_BOUNDARY_EVIDENCE_PATH:-}" ]]; then
  boundary_args+=(--evidence "$PRODUCTION_NETWORK_BOUNDARY_EVIDENCE_PATH")
fi
node scripts/production-network-boundary-gate.mjs "${boundary_args[@]}"

pnpm build
release_specs=()
while IFS= read -r spec; do
  [[ -n "${spec}" ]] && release_specs+=("${spec}")
done < <(
  node scripts/ci/journey-ownership-catalog.mjs list-playwright \
    --purpose release-verdict \
    --relative-web
)
if ((${#release_specs[@]} == 0)); then
  echo "Release verdict catalog returned no Playwright product files." >&2
  exit 1
fi
pnpm --filter @meiye/web exec playwright test "${release_specs[@]}"
