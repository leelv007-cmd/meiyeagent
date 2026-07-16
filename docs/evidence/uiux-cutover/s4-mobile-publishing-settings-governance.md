# S4 Mobile Publishing, Settings, And Governance Evidence

- Stage: S4
- Candidate commit: `fae9441`
- Feature commit: `97b9f95`
- Previous-stage commit: `1dc0449`
- Verified at: 2026-07-12 (Asia/Shanghai)
- Environment: local E2E PostgreSQL, local workspace storage, explicit
  `APP_ENV=e2e` fixture runtime, local Core, App Shell, and P1 Worker
- Production change: none
- Real target-user testing: none

## Delivered contract

- Mobile product mode is now the single-purpose “掌心行动簿”. It covers
  capture/upload, explicit Content acceptance, Job progress and recovery,
  light editing, L1/L3 confirmation, handoff, and desktop relay. It does not
  shrink the desktop creation workbench, settings tables, or admin controls.
- Upload identity is stable across a lost response. Retrying the same local
  file reuses the upload receipt and Product Asset ID; the UI exposes an Asset
  only after workspace storage and Product Core persistence both succeed.
  Camera denial leaves the gallery/file path executable.
- Publication handoff accepts only selected Content. L1 stays unavailable
  without a ready Douyin connection and video artifact, requires a second
  confirmation, and never silently falls back to L3. L3 remains an explicit
  manual package and never presents an export as a published platform state.
- Open, share, download, and copy are immutable handoff events. Explicit
  manual results are recorded separately; `not_published` and `failed` keep
  the package ready, while only `published` changes Content and handoff state.
- Settings have three owning routes: account, models, and connections. BYOK
  lives under models; Douyin and Feishu live under connections. User model
  surfaces do not expose physical channels, deployments, provider prices,
  routing rules, credentials, or secrets.
- The six admin routes are real and independently deep-linkable: models,
  official templates, integrations, plans, users, and audit. Model/template
  publication, retirement, and rollback use one impact-review Dialog with
  scope, diff, and a required audit reason. No `window.confirm` remains.
- Template lifecycle and catalog revision reasons persist into the audit
  projection. Existing rollback audit records, template events, model catalog
  revisions, and operational health evidence are visible on `/admin/audit`.
- Public pricing and account usage use deliverable outputs only. Available,
  reserved, settled, released, and expiry are separate projections; an
  unavailable expiry stays explicit instead of receiving an invented date.
  Insufficient entitlement blocks only its paid generation action.
- Public paid launch and Polotno production licensing remain gated by their
  existing environment controls. The E2E server enables pricing only for the
  acceptance run; repository defaults and production activation remain off.

## Verification

| Gate | Result |
|---|---|
| `pnpm check` | passed for Contracts, Core, and Web |
| `pnpm typecheck` | passed for Contracts, Core, and Web |
| `pnpm test` | Web 66/66; Core 324 passed + 18 explicitly skipped; UI/UX scripts 4/4 |
| `pnpm e2e` | 51/51 passed in one clean run after the account-profile locator fix |
| Mobile viewport matrix | 320×720, 360×800, 390×844, 430×932, and 844×390 all passed without horizontal overflow |
| Upload interruption | persisted response was dropped; retry created exactly one Core Asset and one workspace file row, then survived reload |
| Publishing boundary | accepted-only handoff, export/manual-result separation, and canonical lead linkage passed in browser and Core tests |
| Settings/admin | BYOK and external connections stayed separate; six admin routes, audit Dialog, and direct reload passed |
| `pnpm build` | production Web, Core, and Contracts build passed |
| `pnpm uiux:bundle-check` | passed: initial JS 309600 B gzip; CSS 33924 B gzip; lazy Polotno 597863 B gzip |
| `pnpm uiux:secret-scan` | 1,145 files scanned; zero findings |
| Accessibility/keyboard | mobile actions remain at least 44 px; skip navigation, keyboard focus, and 200-percent zoom reachability passed |

## Acceptance mapping

- E01: the five-viewport browser matrix proves the mobile task surface only
  exposes capture, confirmation, progress/recovery, light edit, handoff, and
  relay actions.
- E02: the response-loss browser test proves same-file resume, delayed Asset
  visibility, one persisted file, and reload recovery; permission fallback
  remains visible and executable.
- E03: Core rejects pre-acceptance handoff. Mobile L1 eligibility and explicit
  confirmation are separate from L3, whose package state remains manual.
- E04: Core and browser assertions prove copy/share/download/open do not
  publish; manual outcomes and platform-derived state remain separate.
- E05: settings/admin mobile deep links render only the desktop relay and safe
  return path, including landscape mobile.
- F01–F03: route, content, role, and existing template ownership tests preserve
  the account/models/connections split and user/admin ownership boundaries.
- F04: six direct/reload routes pass; high-impact actions require scope, diff,
  and reason, which are persisted into audit evidence.
- F05: pricing/account browser copy scans contain no `credit`, `token`, or
  积分, and ledger projection tests preserve all five usage states.
- F06: existing entitlement module tests keep the restriction action-scoped
  and preserve Work, templates, editing, and user switches.
- B04–B06: the fixed four-role capability matrix passes at Foundation and
  Product seams; non-admin management discovery is blocked; secret scan and
  write-only credential projections report zero disclosure findings.

## Stage boundary

S4 closes mobile publishing, secondary settings/admin surfaces, and
deliverable-output plan language. S5 may build and rehearse a local release
candidate, verify rollback and evidence packaging, and close documentation.
It may not enable public paid launch, confirm a Polotno license, call live
providers, deploy production, or claim target-user acceptance without
separate real evidence.
