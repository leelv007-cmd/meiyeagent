# S1 Shell, Routes, And Shared Contracts Evidence

- Stage: S1
- Candidate commit: `2a79b0d01d694b7c01a16e008fce89f810c67547`
- Verified at: 2026-07-12 (Asia/Shanghai)
- Environment: local E2E PostgreSQL, recorded providers, local Core and P1 Worker
- Production change: none
- Real target-user testing: none

## Delivered contract

- The desktop product shell exposes exactly six ordered business destinations:
  Generate, Tasks, Assets, Content, Leads, and Store. Settings is a utility,
  not a seventh business destination.
- Product, Settings, and Admin use separate shell compositions. Settings keeps
  the six business destinations plus Account, Models, and Connections. Admin
  has six independently protected routes and a safe return to the workbench.
- Canonical Task, Asset, Session, Work, Job, settings, and admin routes support
  direct navigation and reload. Legacy settings and `/admin/p1` routes are
  read-only redirects through a fixed internal allowlist.
- Platform Admin, Workspace Owner, Operator, and Reviewer share one capability
  matrix. The Web derives roles from server-side membership; Core verifies the
  claimed role against membership and rejects forbidden Product/P1 actions.
- Shared Chinese status projections, object evidence, loading/empty/error/
  unknown/permission states, a Tabler wrapper, a skip link, reduced-motion
  behavior, and product-scoped mineral-teal/apricot tokens are available to
  later stages.
- The video processing bridge now forwards the verified workspace role for its
  user state read. Worker-only commands remain service-actor-only.

## Verification

| Gate | Result |
|---|---|
| `pnpm check` | passed for Contracts, Core, and Web |
| `pnpm typecheck` | passed for Contracts, Core, and Web |
| `pnpm test` | Web 54/54; Core 318 passed + 18 explicitly skipped; UI/UX scripts 4/4 |
| `pnpm e2e` | 34/34 passed in one run, including the golden video journey and P1 recorded journey |
| `pnpm build` | production Web/Core/Contracts build passed |
| `pnpm uiux:bundle-check` | passed: initial JS 308154 B gzip, CSS 33809 B gzip; Polotno remains lazy at 598351 B gzip |
| `pnpm uiux:secret-scan` | 1102 text files scanned; zero findings |
| WCAG high-impact axe rules | zero critical/serious findings on the dashboard candidate |
| 200% equivalent viewport | no horizontal overflow; skip-link focus moves to the single product main region |

## Acceptance mapping

- B01: six-item order and Settings utility are asserted by unit and browser
  tests.
- B02: the shell has one main region; Agent remains within `/dashboard` and no
  second workbench route was introduced.
- B03: redirect-table and browser tests reject external/open return locations.
- B04/B05: Core HTTP role tests and admin route E2E cover both action and route
  denial.
- B06: credentials remain write-only; the repository evidence scan has no
  secret findings.
- G01-G03: keyboard skip, focus target, reduced motion, axe, and effective 200%
  width checks pass.

## Stage boundary

S1 establishes route and state contracts only. The creation loop, operations
projections, mobile publishing, and complete settings/admin surfaces remain
owned by S2-S4. This record is local candidate evidence and does not claim a
production cutover or validation by real target users.
