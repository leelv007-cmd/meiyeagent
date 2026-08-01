#!/usr/bin/env bash
set -euo pipefail

# Content Collections writes the module consumed by Web checks. Generate it in
# the ordinary PR gate so frozen clean checkouts do not depend on local state.
pnpm --filter @meiye/web build
pnpm --filter @meiye/web check
pnpm --filter @meiye/web typecheck
pnpm --filter @meiye/web test
pnpm --filter @meiye/web test:interaction
node scripts/uiux/secret-scan.mjs
node scripts/uiux/decision-ticket-guard.mjs
