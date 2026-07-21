#!/usr/bin/env bash
set -euo pipefail

pnpm --filter @meiye/web check
pnpm --filter @meiye/web typecheck
pnpm --filter @meiye/web test
pnpm --filter @meiye/web test:interaction
pnpm --filter @meiye/canvas check
pnpm --filter @meiye/canvas test
node scripts/uiux/secret-scan.mjs
node scripts/uiux/decision-ticket-guard.mjs
