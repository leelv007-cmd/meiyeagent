#!/usr/bin/env bash
set -euo pipefail

: "${RELEASE_COMMIT_SHA:?RELEASE_COMMIT_SHA must identify the release candidate}"

boundary_args=(--expected-commit-sha "$RELEASE_COMMIT_SHA")
if [[ -n "${PRODUCTION_NETWORK_BOUNDARY_EVIDENCE_PATH:-}" ]]; then
  boundary_args+=(--evidence "$PRODUCTION_NETWORK_BOUNDARY_EVIDENCE_PATH")
fi
node scripts/production-network-boundary-gate.mjs "${boundary_args[@]}"

pnpm build
pnpm --filter @meiye/web e2e
