#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @meiye/contracts typecheck
pnpm --filter @meiye/core typecheck

# The Content Collections Vite plugin generates the Web module consumed by
# TypeScript. Build it before typechecking so a clean checkout has the same
# generated module contract as a local development workspace.
pnpm --filter @meiye/web build
pnpm --filter @meiye/web typecheck

# Root `tests/` crosses package boundaries (Core + Web + contracts) so it is in
# no workspace tsconfig. tsconfig.journeys.json is its only owner.
pnpm typecheck:journeys
