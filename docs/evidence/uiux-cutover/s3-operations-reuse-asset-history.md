# S3 Operations, Reuse, Asset, And History Evidence

- Stage: S3
- Candidate commit: `7080f27`
- Previous-stage commit: `302a00a`
- Verified at: 2026-07-12 (Asia/Shanghai)
- Environment: local E2E PostgreSQL, explicit `APP_ENV=e2e` fixture runtime,
  local Core, App Shell, and P1 Worker
- Production change: none
- Real target-user testing: none

## Delivered contract

- `/dashboard` remains the only creation workbench. Its right rail contains
  exactly one next action, the Monday-to-Friday five-point status strip, and an
  anomaly summary. Complete task filtering, exact Task detail, weekly batch,
  and fact-only review live under `/dashboard/tasks`.
- The week projection now uses the ISO Monday in UTC and returns five points.
  Missing weekly review is `null`, `all` filter values never reach Core, and
  batch/review queries run only while their owning week view is active.
- The contextual creation shelf, `Cmd/Ctrl+K` palette, and reference
  decomposition dialog project the same official templates, workspace
  templates, user shortcuts, tools, Assets, and historical Works. Honest empty
  results do not inject unrelated tools.
- Reference decomposition separates official and workspace scopes and begins
  with zero inherited fields. Store, price, contact, marketing, account, and
  publication facts are explicitly excluded from silent inheritance. Bringing
  in a source creates a derived Work with the canonical source reference and
  leaves the prior Work unchanged.
- Selecting a tool changes only the pending operation. It creates no Job.
  The existing explicit contract acceptance remains the only action that
  creates a Generation Job; asynchronous Assets return to the same record.
- Existing official template versions and workspace template snapshots remain
  immutable. The primary upgrade action appends a new revision to the current
  Canvas Work while preserving every older revision; an independent upgraded
  copy remains secondary. User shortcuts remain projections, not copied
  templates.
- Recent, Search, Task, Asset, Content, Session, Work, and Job pages now read a
  rebuildable canonical-history projection. Search query state is URL-backed,
  direct object links survive reload, and Creative Work and Canvas Work retain
  their separate domain meanings.
- Product uploads become Assets only after the workspace storage receipt and
  Product command both succeed. The combined Asset projection de-duplicates a
  Creative Asset and its owned media receipt instead of showing the result
  twice.
- The retired 2,009-line second Operations workbench was removed. Its task,
  reuse, Canvas, Asset, and history capabilities now live on owning routes.

## Polotno boundary

- Only `/dashboard/works/:workId` for a Canvas Work can render the Polotno
  wrapper; dashboard, tasks, templates, Assets, Recent, and mobile routes do
  not import its runtime.
- The production build emits a separate Polotno runtime chunk of 597866 bytes
  gzip. The initial JS is 309141 bytes gzip and initial CSS is 33910 bytes gzip.
- Internal development is allowed. A public production build remains blocked
  unless `VITE_POLOTNO_LICENSE_CONFIRMED=true`; a unit test covers development,
  confirmed-production, and unconfirmed-production decisions.
- This gate records application configuration only. It does not claim that a
  commercial license has been purchased or that legal review has completed.

## Verification

| Gate | Result |
|---|---|
| `pnpm check` | passed for Contracts, Core, and Web |
| `pnpm typecheck` | passed for Contracts, Core, and Web |
| `pnpm test` | Web 61/61; Core 323 passed + 18 explicitly skipped; UI/UX scripts 4/4 |
| S3 browser journeys | 3/3 passed: Operations rail/tasks/week, shared catalog/tool/reference flow, and owning-route Polotno load |
| Upload and Asset receipt journey | 1/1 passed through authenticated workspace storage, Product Core authorization, download, and tenant isolation |
| S2 deep-link regression | the affected reload/derivation journey passed after the non-nested detail-route correction |
| `pnpm build` | production Web build passed; Polotno remained a separate lazy chunk |
| `pnpm uiux:bundle-check` | passed: initial JS 309141 B gzip; CSS 33910 B gzip; lazy Polotno 597866 B gzip |

## Acceptance mapping

- D01: authenticated browser assertions prove one next action, five week
  points, anomaly summary, and the separate canonical task inbox.
- D02: Core tests preserve per-task batch execution, do not rerun successful
  items, and exclude `publish_ready`; the browser query asserts publication is
  excluded from the executable set.
- D03: the shelf and command palette share one in-memory catalog projection;
  the decomposition dialog reads the same objects, starts at zero fields, and
  returns to the same record. The browser zero-result check remains honest.
- D04: existing template integration tests prove immutable versions and the
  current-Work new-revision upgrade. The Canvas route exposes that primary
  action and the secondary independent-copy action.
- D05: the browser asserts Job count stays zero after tool selection and
  becomes one only after explicit execution; the result remains in the same
  canonical record.
- D06: the upload browser journey proves storage receipt, authorization, and
  tenant scope; the canonical Asset unit test proves owned-media de-duplication.
- D07: canonical-history unit tests and browser Recent/Search/deep-link reload
  checks prove the views project canonical IDs rather than independent history
  facts.

## Stage boundary

S3 closes desktop Operations, reuse, Canvas ownership, Asset, and history
surfaces. Mobile capture/resume, L1/L3 publishing, settings/admin secondary
surfaces, and plan/usage presentation remain owned by S4. This is local
candidate evidence, not production activation, legal approval, or target-user
usability evidence.
