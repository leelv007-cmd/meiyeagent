# Production dependency audit — 2026-07-25

## Scope and policy

R-04 blocks every unwaived `high` or `critical` advisory reported by
`pnpm audit --prod --json`. A waiver is valid only when
`docs/ops/production-dependency-audit-waivers.json` contains the exact GHSA ID,
a non-empty reason, and a non-expired `expiresOn` date. The current waiver list
is empty.

The 2026-07-24 review recorded 11 high findings. The unchanged R-04 worktree
reported 12 high findings on 2026-07-25 because the advisory database had added
a second PostCSS advisory. Refreshing the lockfile then exposed newer
advisories in transitive build/runtime packages; those were also remediated
before acceptance.

## Reachability and disposition

`production_reachable` is used conservatively when the package executes in a
deployed service or processes production inputs. `dev_only` means the package
is present in the production dependency tree because of its manifest
classification, but its vulnerable entry point is limited to local/build
tooling. No finding was dismissed as a false positive.

| Advisory | Package and path | Classification | Disposition |
|---|---|---|---|
| GHSA-f88m-g3jw-g9cj | `sharp`; Core image processing and Canvas/Next image path | `production_reachable` | Upgraded and forced to 0.35.3 |
| GHSA-6gpp-xcg3-4w24 | `next`; Canvas server and Web Better Auth peer | `production_reachable` | Upgraded to 16.2.11 |
| GHSA-89xv-2m56-2m9x | `next`; Canvas server and Web Better Auth peer | `production_reachable` | Upgraded to 16.2.11 |
| GHSA-m99w-x7hq-7vfj | `next`; Canvas server and Web Better Auth peer | `production_reachable` | Upgraded to 16.2.11 |
| GHSA-p9j2-gv94-2wf4 | `next`; Canvas server and Web Better Auth peer | `production_reachable` | Upgraded to 16.2.11 |
| GHSA-6g55-p6wh-862q | `postcss`; Canvas/Next CSS processing | `production_reachable` | Forced to 8.5.18 |
| GHSA-r28c-9q8g-f849 | `postcss`; Canvas/Next CSS processing | `production_reachable` | Forced to 8.5.18 |
| GHSA-v2hh-gcrm-f6hx | `fast-uri`; Creem → MCP SDK → Ajv URL validation | `production_reachable` | Forced to 3.1.4 |
| GHSA-22cc-p3c6-wpvm | `h3`; TanStack Start server SSE handling | `production_reachable` | Forced aliased `h3-v2` to 2.0.1-rc.18 |
| GHSA-3vj8-jmxq-cgj5 | `h3`; TanStack Start server middleware | `production_reachable` | Forced aliased `h3-v2` to 2.0.1-rc.18 |
| GHSA-f269-vfmq-vjvj | `undici`; Cloudflare Vite/Miniflare WebSocket client | `dev_only` | Forced to 7.28.0 |
| GHSA-v9p9-hfj2-hcw8 | `undici`; Cloudflare Vite/Miniflare WebSocket client | `dev_only` | Forced to 7.28.0 |
| GHSA-vrm6-8vpv-qv8q | `undici`; Cloudflare Vite/Miniflare WebSocket client | `dev_only` | Forced to 7.28.0 |
| GHSA-hm92-r4w5-c3mj | `undici`; Wrangler/Miniflare proxy client | `dev_only` | Forced to 7.28.0 |
| GHSA-vmh5-mc38-953g | `undici`; Wrangler/Miniflare proxy client | `dev_only` | Forced to 7.28.0 |
| GHSA-vxpw-j846-p89q | `undici`; Cloudflare Vite/Wrangler WebSocket client | `dev_only` | Forced to 7.28.0 |
| GHSA-96hv-2xvq-fx4p | `ws`; Cloudflare Vite plugin WebSocket server | `dev_only` | Forced to 8.21.0 |

The exact transitive overrides remain in `pnpm-workspace.yaml` until their direct
parents adopt patched ranges. Removing an override requires rerunning this audit
and the affected package tests.

## Acceptance evidence

After remediation:

```text
$ pnpm audit --prod --json
critical=0 high=0 moderate=3 low=2
```

The required CI job captures the raw JSON even when pnpm returns non-zero for a
lower-severity finding, then
`scripts/ci/assert-production-audit.mjs` fails closed on malformed input,
expired/malformed waivers, or any unwaived high/critical advisory.

The no-push lane cannot create a remote GitHub test branch. An equivalent local
negative control created an isolated temporary project with `sharp@0.34.5` and
ran the same validator with the repository waiver manifest:

```text
negative pnpm audit raw exit code: 1
Production dependency audit blocked release: critical=0 high=1 moderate=0 low=0 waived=0 unwaived=1
high sharp@0.34.5 GHSA-f88m-g3jw-g9cj: Upgrade to version 0.35.0 or later; path=.>sharp
negative required gate exit code: 1
```

## Verification summary

| Command | Result |
|---|---|
| `pnpm install --ignore-scripts --frozen-lockfile` | exit 0 |
| `pnpm audit --prod --json` plus the required validator | raw exit 1 for 3 moderate and 2 low; validator exit 0 with 0 critical/high |
| production-audit, required-job, workflow, and secret-scan contract tests | 38 passed, 0 failed |
| `pnpm typecheck` | exit 0 |
| `pnpm --filter @meiye/core test` | 2081 tests; 2071 passed, 10 existing opt-in live-provider tests skipped, 0 failed |
| `pnpm test` | exit 0 across Contracts, Core, Web, Canvas, and root test suites |
| `pnpm check` | package checks passed; repository command exited 1 on the two expected local `.env` findings |
| `node scripts/uiux/decision-ticket-guard.mjs` | exit 0 for both decision-ticket maps |

The coordinator-recorded `pnpm check` baseline contained four secret-scan
findings: `.env:77`, `.env:82`, and the mirrored DeepSeek documentation at
lines 31 and 35. The approved exact-literal placeholder exemption and repair of
the mirror's joined commands removed only the two documentation findings; the
final scan still exits 1 and reports `.env:77` and `.env:82`. The `.env` file
and scanner file-selection logic were not changed.
