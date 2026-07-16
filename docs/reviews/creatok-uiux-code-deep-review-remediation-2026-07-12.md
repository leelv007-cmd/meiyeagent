# CreatOK UI/UX Deep Review Remediation

> 历史基线：本记录中的构建/检查结论只适用于 2026-07-12 固定提交；当前 `pnpm check` 仍有 Biome 格式问题，Pro Studio 两线边界以 2026-07-16 最新规格为准。

- Source review: `docs/reviews/creatok-uiux-code-deep-review-2026-07-12.md`
- Fixed point: `fd622eabc8936ab84bd32eb574dec5604180c4a2`
- Reviewed at: 2026-07-12 (Asia/Shanghai)
- Scope: current tracked UI/UX code, tests, and cutover evidence
- Real target-user testing: none
- Production change: none

## Method

Each finding was checked against the fixed commit, git history, the public
route/view-model/HTTP seams, and the S0-S5 evidence. A file's size or a short
route adapter was not treated as a defect without a missing behavior,
incorrect boundary, measurable regression, or unsafe maintenance consequence.
Historical planning statements were evaluated at their original commit rather
than as claims about the final candidate.

## P0 findings

| ID | Decision | Current evidence or repair |
|---|---|---|
| P0-1 | refuted | `operations-workbench.tsx` existed at pre-cutover commit `0cba260` and was exactly 2,009 lines. S3 commit `7080f27` intentionally retired it after moving operations to `operations-task-page.tsx`, `operations-rail.tsx`, and canonical routes. The handoff is a historical implementation input, not a final inventory. |
| P0-2 | confirmed documentation drift, repaired | `b074cb0` added the Web test runner and root discovery. The two tracked reviews that still said it was absent now carry an explicit historical update and point to S5 evidence. |
| P0-3 | stale | Candidate E2E ran from an empty PostgreSQL database: 53/53, one worker, no retries. The Playwright config also migrates the base Web schema before Core startup. |
| P0-4 | stale | `uiux-precutover-baseline.spec.ts` collects axe, LCP/INP/CLS, feedback, transfer, DOM, query, focus, and 200-percent overflow evidence. `uiux-keyboard-governance.spec.ts` covers the keyboard creation journey and Dialog focus. The bundle and secret gates are executable root scripts. |
| P0-5 | refuted | The workbench renders a continuous Intent, source/reference, Composer contract, Job, Asset, and Content record through `RecordSection`; Agent and Direct reuse one draft and one submission contract. E0/E1, recovery, unknown verification, retry, derivation, and object graph behavior pass browser/Core tests. File length alone does not show a second workbench or missing Agent record. |
| P0-6 | severity rejected | Models/BYOK and external connections already have separate owning routes and capability checks. `IntegrationSettings` shares connection lifecycle code while filtering providers, actions, audit, and authorization by scope. Splitting 1,958 lines without a behavioral defect would be a large implementation-only refactor with no acceptance gain, so it is not a P0 repair. |

## P1 findings

| ID | Decision | Current evidence or repair |
|---|---|---|
| P1-1 | confirmed residual drift, repaired | Product-scoped density, radius, typography, and reduced-motion rules already existed, but the exact locked mineral-celadon/apricot contract and all PWA metadata were not aligned. The shell now separates the locked bright `oklch(0.78 0.14 166)` brand from a 7.27:1 light-canvas action/text token, uses mode-aware page focus plus a fixed bright focus token on the always-dark sidebar, and consumes the warm-apricot guide in the visible `NEXT` marker. Dark mode keeps the bright brand for primary actions. The root, manifest, and `/pwa-proof` metadata share its `#46d3a3` sRGB fallback, and browser tests cover rendered guide/action text, real Tab-focused sidebar visibility, both page modes, and route metadata. |
| P1-2 | stale | `weeklyReviewView(null)` returns an honest empty projection and is covered by unit and browser tests; the five-point week context uses stable dates. |
| P1-3 | stale | `polotnoAccess` permits development or a confirmed production license only. Browser evidence proves the Polotno chunk loads only after entering its owning Canvas route. |
| P1-4 | stale | `normalizeCatalog` requires `active + live_verified` evidence before a model becomes submit-capable. Recorded/configured models stay visible with an unavailable reason and cannot submit. |
| P1-5 | stale | There is no `window.confirm` in the admin controls. High-impact model/template actions use `ImpactReviewDialog` with diff, scope, reason, audit persistence, focus trap, and focus return. |
| P1-6 | stale | All legacy settings routes and `/admin/p1` use a fixed internal redirect table. Open return URLs are rejected and canonical deep-link/reload tests pass. |

## P2 findings

| ID | Decision | Current evidence or boundary |
|---|---|---|
| P2-1 | not a current repair | The source review classifies this cleanup as a non-blocking post-cutover evaluation. Removing public marketing, legal, payment, or compatibility surfaces would be a product-scope decision that this review does not authorize. Legacy redirects separately remain governed by the locked two-stable-release and 30-day-zero-hit rule. |
| P2-2 | refuted as a user-facing defect | Public pricing and signed-in account surfaces use deliverable copy/image/video output language and keep available/reserved/settled/released/expiry separate. Provider implementation terms in payment adapters are not merchant copy. |
| P2-3 | stale | Mobile actions use the 44 px coarse-pointer baseline; desktop evidence links and controls preserve the locked smaller exceptions. Mobile viewport and 200-percent tests pass without horizontal overflow. |
| P2-4 | report premise stale; integration and robustness repaired | `pnpm uiux:secret-scan` already existed and reports locations without echoing secret values. It now scans tracked candidate blobs directly from the Git index, scans untracked and ignored environment files from the worktree, tolerates only a concurrently removed untracked path, and remains part of the root `pnpm check` gate. |
| P2-5 | stale | The bundle gate separates initial JS/CSS from the route-owned lazy Polotno chunk. S5 passed at 311,961 B initial JS gzip, 33,924 B initial CSS gzip, and 597,865 B lazy Polotno gzip. |

## Other recommendations

- The large component sizes are maintainability signals, not proof of a
  missing product outcome. A future behavior change can extract a cohesive
  module at its owning seam; this repair does not perform speculative directory
  moves, Storybook scaffolding, or mass shadcn deletion.
- Injecting axe into every test's `afterEach` was not adopted. The fixed quality
  journey scans a stable, representative product state and reports exact
  violations; global after-hooks would scan transient states, add duplicate
  runtime, and produce less actionable failures.
- Visual-regression SaaS and live-provider calls are not required substitutes
  for the locked local UI/UX gates. Live activation remains separately gated by
  credentials, cost authorization, and production evidence.
- The allegedly missing E2E journeys now exist across
  `uiux-creation-loop.spec.ts`, `uiux-operations-reuse.spec.ts`,
  `uiux-mobile-secondary.spec.ts`, `p0-golden-journey.spec.ts`,
  `uiux-keyboard-governance.spec.ts`, and the PostgreSQL cutover tests.

## Implemented changes

- Added the exact locked product brand and guide tokens, separated the readable
  light-mode action/text semantic, and added mode-aware focus tokens; applied
  them to rendered shell UI and one shared browser/manifest theme color.
- Narrowed the legacy global ring suppression to non-focus decoration and
  restored a visible bright outline for keyboard-focused sidebar controls.
- Added public PWA regression assertions for manifest colors and the active
  `/pwa-proof` route metadata, plus a product-shell token-contract assertion.
- Made the secret scanner read tracked candidate content from the Git index and
  untracked/ignored environment content from the worktree without hiding read
  failures; added the scan to the root check gate and covered its read boundary.
- Corrected two tracked historical reviews that could still make agents remove
  or duplicate the Web test runner.
- Updated `CONTEXT.md` so current code/tests and S0-S5 evidence outrank
  pre-implementation inventory estimates when determining implementation
  status.
- Included the immutable source review beside this remediation so a clean
  checkout can reproduce the finding-by-finding audit trail.

## Verification

| Gate | Result |
|---|---|
| Theme-color TDD | source inspection and red PWA tests exposed the `#09090b` root and `#18181b` route drift, then passed on the locked shared product color |
| Light-mode contrast TDD | rendered `text-primary`, page focus, and real Tab-focused sidebar regressions failed first, then passed after separating brand/action semantics and restoring the high-contrast sidebar outline |
| Secret-scan TDD | the candidate-index regression failed first, then scanner tests passed 9/9 and the repository scan completed |
| `pnpm check` | Contracts, Core, Web, and the integrated secret scan passed |
| `pnpm typecheck` | Contracts, Core, and Web passed |
| PostgreSQL `pnpm test` | Core 375 passed and 2 paid live tests skipped; Web 74/74; UI/UX scanner/evidence tests passed 9/9 |
| `pnpm e2e` | 53/53 from an empty database, one worker, no retries, in 3.8 minutes |
| PWA E2E | 5/5, including manifest, active-route, and default-root theme metadata |
| Affected PWA and shell E2E | 10/10 after the review fixes |
| Keyboard governance E2E | 2/2, including the creation journey and dialog focus trap/return |
| `pnpm build` | Contracts, Core, and production Web passed |
| `pnpm uiux:bundle-check` | passed: 311,975 B initial JS gzip, 33,969 B initial CSS gzip, 597,865 B lazy Polotno gzip |
| `pnpm uiux:secret-scan` | 1,174 candidate/worktree text inputs scanned; zero findings |
| `pnpm uiux:quality` | passed: LCP 1,016 ms, INP 56 ms, CLS 0.02464, feedback 25.7 ms, longest task 81 ms, 75,074 B initial transfer, zero high-impact axe findings, and zero 200-percent overflow |

The root checks included unrelated, pre-existing Core Model Supply changes in
the shared worktree; they passed but are not part of this remediation and were
not staged by it.

## Remaining boundaries

- No real target-user study was performed or required by this repair.
- No live model, Douyin, Feishu, payment, or production environment was called.
- Production cutover and observation remain governed by the S5 STOP/FROZEN
  decision and require separate target, credentials, window, owners, and
  authorization.
