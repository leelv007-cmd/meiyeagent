# S2 Cold Start And Unified Creation Loop Evidence

- Stage: S2
- Candidate commits: `b7fea11`, `74126b0`
- Previous-stage commit: `5d8fb70`
- Verified at: 2026-07-12 (Asia/Shanghai)
- Environment: local E2E PostgreSQL, explicit `APP_ENV=e2e` fixture runtime,
  local Core, App Shell, and P1 Worker
- Production change: none
- Real target-user testing: none

## Delivered contract

- `/dashboard` is the single creation workbench. The E0 path does not seed
  example facts; typing, local files, and local links do not create canonical
  objects. Skip records one sparse event and leaves a quiet re-entry.
- E1 reuses existing Task and Product Asset IDs. An explicit action creates one
  Work and does not copy the source object.
- The persisted graph is `Work -> immutable execution contract -> Job ->
  Assets -> accepted Content`. Text candidates are result Assets; Content is
  created only after the user accepts a specific Asset.
- The contract freezes the catalog revision, model, operation, specification,
  output count, duration, price revision and amount, watermark, AIGC choice,
  and stable submission key. Missing price evidence is not displayed as zero.
- Only an active Deployment with `live_verified` activation evidence can
  submit. Recorded deployments remain visible but disabled. A deterministic
  fixture may be live-verified only when `APP_ENV=e2e` is explicit.
- Recoverable execution resumes with the same submission key and Job. Running
  and unknown states only inspect the original provider Job. A terminal retry
  creates `retryOf`; changed execution input creates `derivedFrom`.
- Copy, image, and video execution use the existing Model Supply and durable
  worker seams. Provider results become owned Assets before the Operations
  projection exposes them.
- Session, Work, and Job canonical routes read the same persisted projection,
  reject absent/cross-workspace IDs without sample substitution, and survive
  direct navigation and reload.
- First Work, first Job, first Asset, first Content, and onboarding skip are
  distinct sparse events containing only object IDs and timestamps, never
  intent text or media.

## Migration and compatibility

- Added JSON-backed, workspace-scoped tables for creative Works, Jobs, Assets,
  Contents, and activation events. No destructive schema or backfill was used.
- Existing Product, Operations, publication, usage, and ledger tables were not
  rewritten. The S2 tables are additive and empty for pre-S2 workspaces.
- The real PostgreSQL repository test reloads the exact Work, Job, Asset,
  accepted Content, workspace, and relationship IDs after a new service
  instance is created: 6/6 Operations PostgreSQL tests passed.
- The worker browser journey submitted one image Job, observed the running
  state, inspected the same Job until completion, persisted one owned image
  Asset, accepted it, and reloaded the same IDs. No second submission or Asset
  was created.

## Verification

| Gate | Result |
|---|---|
| `pnpm check` | passed for Contracts, Core, and Web |
| `pnpm typecheck` | passed for Contracts, Core, and Web |
| `pnpm test` | Web 54/54; Core 322 passed + 18 explicitly skipped; UI/UX scripts 4/4 |
| S2 fixed browser journeys | 5/5 passed, including E0, E1, explicit quote, async image recovery, canonical reload, derivation, and recorded-only denial |
| Mobile workbench smoke | passed at 390 x 844 with central intent focus and no horizontal overflow |
| PostgreSQL Operations integration | 6/6 passed with `TEST_DATABASE_URL` configured |
| Accessibility and effective 200% width | zero critical/serious axe findings; baseline envelope and overflow gate passed |
| `pnpm build` | production Web/Core/Contracts build passed |
| `pnpm uiux:bundle-check` | passed: initial JS 306071 B gzip; CSS 33867 B gzip |
| `pnpm uiux:secret-scan` | 1108 text files scanned; zero findings |

The complete historical browser suite was not used as the S2 exit gate. Its
legacy P0/P1 selectors still target the removed pre-cutover dashboard and are
rehomed with their owning Operations and publishing surfaces in S3 and S4.
The last pre-S2 full-suite baseline remains S1 at 34/34. A new full-suite green
run is required before S5 can close.

## Acceptance mapping

- C01/C02: the E0 and E1 browser journeys assert the Operations object graph
  and unchanged source Task count through authenticated APIs.
- C03: copy and durable image journeys assert Assets exist while Content is
  empty, then assert one accepted Content references the selected Asset.
- C04/C05: watermark and AIGC remain user switches; model, specification,
  amount, price revision, output count, and duration are visible before the
  explicit contract acceptance.
- C06: unit state-machine tests cover recoverable, running, unknown, terminal
  retry, and derivation; the browser worker journey proves same-Job recovery.
- C07: Core rejects non-live deployments before Job creation; catalog unit and
  browser tests keep recorded-only models disabled.
- C08: event contract tests prove skip is separate and Content activation is
  recorded only after explicit Asset acceptance.
- A04/A05: PostgreSQL reload and browser recovery preserve tenant and canonical
  relationships without resubmission or duplicate Assets.

## Stage boundary

S2 closes the core creation loop only. Task operations, templates/tools,
combined asset/history projections, mobile publishing, secondary surfaces,
and complete cutover rehearsal remain owned by S3-S5. This is local candidate
evidence, not production activation or target-user usability evidence.
