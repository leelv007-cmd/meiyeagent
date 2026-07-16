# Pro Studio security matrix evidence (Ticket 15 / 25)

Date: 2026-07-16

This matrix maps the Ticket 25 security checklist to automated unit/integration
coverage that already ships in-tree. Items marked **unit** are fail-closed in
code with tests. Items marked **open** still need a live dual-service drill or
external credentials before the release gate can pass.

| Check | Status | Evidence |
| --- | --- | --- |
| Cross-workspace project/asset/job IDOR | unit | `advanced-canvas-project.test.ts`, `canvas-asset-facade.test.ts`, `generation-runtime` projectAccess/assetAccess |
| Forged `serverUrl` / provider routing fields | unit | `generation-runtime.test.ts` `GENERATION_PARAMETER_FORBIDDEN`; `backend-port` forbidden field schema |
| Idempotency replay (same key + payload) | unit | generation submit replay, agent plan/confirm/apply receipts |
| Idempotency conflict (same key + different payload) | unit | `IDEMPOTENCY_CONFLICT` paths in generation + adoption |
| Async failure releases product usage | unit | `generation-runtime.test.ts` failure → `released` |
| 2xx / SSE connect does not settle | unit | submit persists before dispatch; commit only after OwnedAsset / text deliverable |
| Grant expiry / recycle | n/a (direct upload) | Ticket 09 production probe passed HTTP 200; no grant endpoint or grant URL is produced |
| DNS / redirect SSRF on provider fetch | unit | `provider-safe-fetch.test.ts` |
| Agent allowlist only (no free-form tools) | unit | `canvas-agent-production.test.ts`, `canvas-agent.test.ts` |
| Agent dual-session zero-write CAS | unit | `canvas-agent.test.ts` stale confirmation / revision conflict |
| Agent confirmation rate limit | unit | `CONFIRMATION_RATE_LIMITED` in `canvas-agent.ts` (session window) |
| Browser cache namespace isolation | unit + wired | `cache-scope.test.ts`; Canvas shell clears on identity change / return |
| Soft-delete retention | unit | `advanced-canvas-project.test.ts` purge after retention window |
| Concurrent generation slots | unit | `CONCURRENCY_LIMIT_EXCEEDED` in `generation-runtime.test.ts` |

## Local cross-service evidence (2026-07-16)

`specs/pro-studio-security-boundaries.spec.ts` adds a fixture-local Playwright
drill across the real Main, Canvas, Core, Worker, and Postgres services:

- cross-workspace project, revision, asset, generation-job, Agent credential,
  and ContentPackage boundaries fail closed without foreign IDs or writes;
- two Canvas sessions exercise the same-revision Agent plan/confirmation, a
  fixed `REVISION_CONFLICT` stale apply with zero write, and successful
  re-read/re-plan recovery;
- identity switching clears local/session storage and Cache API entries and
  fences a delayed project-list response before the new workspace renders.

Run it with:

```sh
pnpm --dir mkfast-template-main exec playwright test \
  tests/e2e/specs/pro-studio-security-boundaries.spec.ts --project=chromium
```

The drill is real-service and database evidence, but its model/media adapter is
`MODEL_EXECUTION_MODE=fixture`; keep that qualifier when reporting the result.
It does not establish Ticket 11/12 live audio activation, N2 recovery, pricing
approval, or upsell sign-off. Ticket 09 has separate live provider evidence.

## Remaining before status = passed

1. Preserve the local fixture drill above as partial evidence; repeat the same
   boundary flow in the production deployment/configuration before release.
2. Ticket 11/12 live audio activation evidence (operations stay closed until then).
3. N2 recovery, pricing approval, and upsell product sign-off (commercial gates).

Until those land, `release-evidence.json` must keep `securityMatrix` out of
`passed` for the public release gate, even though the unit matrix above is green.
