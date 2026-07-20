# S5 Local Release Candidate And Cutover Rehearsal Evidence

- Stage: S5 development and local release-candidate rehearsal
- Candidate code commit: `fc5d649b84c0da40b2ec1476ac3f507d3618d45f`
- Pre-cutover commit: `0cba2604f448e1c74549a3c0205cf037e2b88560`
- Schema revision: `052add2efa6c1b45cc3f479e3a733eb20158fbe98251df7c7545c59143b04b01`
- Verified at: 2026-07-12 22:22 +08:00 (Asia/Shanghai)
- Evidence level: local PostgreSQL, local fixture/recorded providers, and a
  production-shaped local Web build
- Production change: none
- Real target-user testing: none

## Exit decision

The S0-S5 development scope and the S5 local release candidate are complete.
The candidate passes the required local engineering gates, additive-schema and
old-build compatibility checks, migration/restore/rollback rehearsal, and the
fixed browser journeys.

Production cutover is **STOP / FROZEN**. No production target, credentials,
approved low-traffic window, named drain/deployment/rollback/observation
owners, or deployment authorization was supplied. Consequently no production
submission drain, deployment, smoke, first-hour monitoring, 24-hour enhanced
observation, or seven-day safety observation was performed. This record must
not be used as evidence that those production operations are complete.

## Candidate and activation matrix

| Component | Version | Local activation used | Production activation |
|---|---|---|---|
| Web | candidate commit above | `APP_ENV=e2e`; local Vite and production-shaped Wrangler candidate | inactive |
| Core | candidate commit above | fixture runtime for browser gates; recorded runtime for old-build compatibility | inactive |
| P1 worker | candidate commit above | local worker with fixture execution | inactive |
| PostgreSQL schema | schema revision above | isolated PostgreSQL matching the repository Compose role model | not applied |
| Public paid launch | candidate commit above | enabled only inside the E2E acceptance process | repository/production default remains off |
| Polotno | lazy candidate chunk only | exercised locally after entering its owning Canvas route | public production license/activation not confirmed |
| External model providers | no live version claim | fixture/recorded only | no credentials and no activation |

The live Ark test remained explicitly skipped because it requires separate
credentials and spends provider quota. No local fixture, recorded adapter, or
static prototype is presented as live-provider evidence.

## Same-candidate verification

| Gate | Result |
|---|---|
| `pnpm check` | passed for Contracts, Core, and Web |
| `pnpm typecheck` | passed for Contracts, Core, and Web |
| `TEST_DATABASE_URL=... pnpm test` | Core 368 passed, 1 live Ark test explicitly skipped; Web 74/74; UI/UX scripts 6/6 |
| `pnpm e2e` | 53/53 passed from an empty database, one worker, no retries, in 3.9 minutes |
| `pnpm build` | production Web plus Core and Contracts builds passed |
| `pnpm uiux:bundle-check` | passed: initial CSS 33,924 B gzip; initial JS 311,961 B gzip; lazy Polotno 597,865 B gzip |
| `pnpm uiux:secret-scan` | 1,166 files scanned, including this evidence record; zero findings |
| `pnpm uiux:baseline` | candidate, pre-cutover commit, route set, runtime modes, and schema hash recorded |
| `pnpm uiux:quality` | passed in the production-candidate profile |

The production-candidate quality report recorded:

- LCP 1,040 ms, INP 64 ms, CLS 0.022629776, and critical feedback 34.7 ms.
- Initial transfer 74,977 B, DOM size 300, and longest task 93 ms.
- No high-impact axe findings, no 200-percent horizontal overflow, and a
  focused control with an accessible name.
- Six critical product query families in the locked budget.

These are local lab measurements under the fixed `4x CPU + Fast 4G` profile,
not production p75 RUM. Production p75 can only be established after an
authorized deployment and observation window.

## Empty-database and migration readiness

- A fresh database exposed that Playwright started Core before the Web-owned
  base tables existed. The candidate now executes the existing Web migration
  before Core startup; the public-page matrix passed 6/6 and the subsequent
  full run passed 53/53 from an empty database.
- A separate fresh-Core smoke proved schema startup completes with
  `p1_search_documents` and its search indexes present. Operations DDL now
  stays on the supplied transaction client, so an index cannot race the
  uncommitted table creation.
- Concurrent schema initializers and the cutover CLI use the shared schema
  migration lock. The PostgreSQL regression suite covers concurrent startup
  and passed on the candidate.

## Local cutover, restore, and rollback rehearsal

- Local-only cutover run ID:
  `8a6261d9-5a30-43c9-a586-9b2f7d4b4863`.
- Scope: one isolated fixture workspace in a disposable PostgreSQL database.
  The database was destroyed after the rehearsal.
- First dry-run difference count: 7. Repeated dry-run: the same 7 differences.
- Backup: completed; the backup hash matched the source evidence.
- Restore rehearsal: passed without overwriting the source; local RPO 0 and
  local RTO 67 ms.
- Freeze: completed. The fixture had zero in-flight decisions; in-flight owner,
  immutable RouteSnapshot, no-regeneration, and no-duplicate-Asset behavior is
  additionally covered by the PostgreSQL cutover and recovery tests.
- Backfill: completed with difference count 0. A post-backfill dry-run also
  reported 0 differences.
- Activation: future write owner changed to P1 with 0 differences. Inspection
  showed the active run, backup evidence, and one restore rehearsal.
- Application rollback: passed; future write owner returned to legacy while
  the materialized P1 projection remained. It did not restore a legacy
  database snapshot over legal new facts. Local RPO was 0, local RTO was 43 ms,
  pending commands were 0, and in-flight P1 jobs were 0.
- Final inspection showed `rolled_back`, one restore record, and one rollback
  record. CLI actions now await database completion before closing their pool,
  and migrations are serialized under the global schema lock.

The RPO/RTO numbers above describe only a local disposable fixture. They are
not production recovery objectives or production performance evidence.

## Pre-cutover application compatibility

The frozen pre-cutover commit was checked out in an isolated worktree and run
against the candidate's additive schema:

- The pre-cutover Web migration and full production build passed.
- The pre-cutover Core started in recorded mode and returned healthy on the
  isolated port.
- A legacy workspace read succeeded. The `hide_example` command changed the
  persisted flag, reload preserved it, and replaying the same idempotency key
  returned the same result.
- The pre-cutover production Web preview returned HTTP 200 with a complete
  118,415-byte HTML response.
- The isolated worktree and compatibility database were removed after the
  smoke.

This proves local old-application/new-additive-schema compatibility. It does
not authorize or prove a production rollback.

## Acceptance matrix disposition

| Matrix group | Local candidate result | Production boundary |
|---|---|---|
| A01-A06 build, migration, compatibility, rollback | passed locally | no production migration or rollback was run |
| B01-B06 shell, routes, roles, security | passed by unit/API/browser tests and zero-finding secret scan | no production traffic evidence |
| C01-C08 creation lifecycle | passed by Core and browser object-graph/recovery journeys | fixture/recorded providers only |
| D01-D07 operations, reuse, assets, history | passed by Core and browser journeys | no production data migration |
| E01-E05 mobile and publishing handoff | passed across 320/360/390/430 and landscape viewports | no real platform publication |
| F01-F06 settings, admin, plans | passed by role, route, audit, and ledger tests | public paid launch remains off |
| G01-G05 accessibility and performance | passed in automated local gates | no target-user study or production p75 RUM |
| G06 waivable visual issues | no waiver used | no P1 Owner acceptance required for a known open issue |
| H01-H02 telemetry and correlation | passed by privacy-minimal schema, API envelope, and journey tests | no production trace drill |
| H03 drain and cutover | local freeze/activate/rollback rehearsal passed | real low-traffic drain, deploy, smoke, and resume not performed |
| H04 observation and rollback readiness | executable runbook and local rollback passed | named owners, first hour, 24 hours, and seven days remain unperformed |
| H05 evidence language | passed | every stage record states that no real target-user test occurred |

## Review, defects, and waivers

- Two internal engineering review passes were completed during S5 hardening.
  Their actionable findings were addressed, followed by a final focused review
  of the empty-database bootstrap change and all same-candidate gates.
- No known Sev0 or Sev1 remains in the local candidate.
- No P2/P3 P1 Owner waiver was used.
- The build emits the framework's generic large-chunk warning because Polotno
  is large; the owning budget proves it remains a lazy route-owned chunk and
  excludes it from the initial shell.
- No real target-user testing, live-provider acceptance, real platform
  publication, production deployment, or production observation occurred.

## Production prerequisites still required

Production must remain frozen until all of the following are supplied and
approved separately:

1. Confirmed production target and compatible Web/Core/worker deployment
   versions.
2. Secret-managed database and provider credentials.
3. Approved low-traffic cutover window and explicit deployment authorization.
4. Named and reachable drain, migration, deployment, smoke, rollback,
   first-hour, 24-hour, and seven-day owners.
5. Production-shaped dry-run and reconciliation with zero unexplained
   differences.
6. Authorized production smoke, p75 RUM/alert review, and observation records.

Until those prerequisites exist, the correct decision is **STOP / FROZEN**,
even though the S0-S5 development and local release candidate are complete.
