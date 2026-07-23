# Issue #161 [P1-F2] Coverage Gap Matrix

**Date:** 2026-07-23  
**Branch:** `lane/p1-f2-161-20260723`  
**HEAD:** `d6787b29` (P1 A–E features present; F2 acceptance not closed)  
**Spec authority:** `docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md` § Testing Decisions + DoD  
**Catalog authority:** `mkfast-template-main/tests/e2e/TEST-CATALOG.md`  
**Harness config:** `mkfast-template-main/playwright.config.ts`

> **Scope of this document:** map #161 acceptance criteria (AC1–AC10) against *existing* Playwright/e2e/unit coverage. No new harness is implemented here. Coverage claims are from reading specs/fixtures, not from a fresh green run on this HEAD.

---

## Acceptance criteria index

| ID | Criterion (compressed) |
|---|---|
| **AC1** | Seven continuous browser journeys all pass: Day-0, 文案, 图文, 视频, legacy, 撤权替换, 结果复盘 |
| **AC2** | Public HTTP/SSE + recorded Provider; frontend fixture short-circuit is not completion evidence |
| **AC3** | 320 / 375 / 768 / 1440 + 200% zoom: no horizontal block/crop/CTA occlusion |
| **AC4** | Light + dark on Result / Content / Assets / Delivery / Weekly Review: hierarchy + WCAG 2.1 AA |
| **AC5** | axe main path zero serious/critical; keyboard Tab, modal focus trap, Esc, focus return |
| **AC6** | VoiceOver manual checklist (document if no automation) |
| **AC7** | prefers-reduced-motion / low-power / Save-Data: nonessential WebGL/rAF/GSAP stop |
| **AC8** | Merchant UI: zero UUID, raw enum, internal prompt, English candidate names, provider/model slug, dead CTAs |
| **AC9** | Full chain → publication record, graded observation, weekly review, next-round snapshot |
| **AC10** | Evidence binds commit, production build, browser, viewport, theme, seed revision, workflow run, screenshots/video |

---

## Harness mode truth (read before scoring)

| Mode | How it is started | What it proves | #161 status |
|---|---|---|---|
| Default Playwright | `MODEL_EXECUTION_MODE=fixture`, Vite `--mode e2e`, real Core/Worker/Canvas/Postgres | Real App Shell → BFF → Core HTTP/SSE; **provider boundary is deterministic fixture/recorded**, not live | Allowed by P1 Testing Decisions as *recorded Provider* for functional contract |
| Production candidate | `PLAYWRIGHT_PRODUCTION_CANDIDATE=true` → `pnpm build` + Wrangler quality config | Production-shaped Web artifact + same Core fixture | Required by AC2/AC10 for *completion* evidence; only sparsely used today |
| Frontend route mock | e.g. `page.route('**/api/core/p1/harness/**')` fulfill | Component/state UI only | **Forbidden as #161 completion evidence** |
| Live provider | Protected #119 / #147 gate | Live connectivity | Out of #161 recorded scope; process-blocks formal release chain |

Default `playwright.config.ts` always pins `MODEL_EXECUTION_MODE=fixture` for Core and Worker. That is **not** “frontend fixture short-circuit”; it is the Core provider adapter mode. AC2 fails only when the *browser journey* is completed without public HTTP/SSE (mocks, synthetic completed state, or unmounted UI).

---

## Existing coverage table

Legend: **Full** = AC intent largely locked by executable assertions · **Partial** = related coverage, not continuous / not full matrix · **None** = no executable browser journey · **Catalog drift** = TEST-CATALOG claims more than the file implements.

| Spec / artifact | Absolute path | AC1 journeys | AC2 HTTP+recorded | AC3 viewports/zoom | AC4 L/D surfaces | AC5 axe/kbd | AC6 VO | AC7 motion | AC8 merchant clean | AC9 full chain | AC10 evidence bind |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `ui-journey-three-modal.spec.ts` + `fixtures/ui-journey.ts` | `/Users/bin/orca/workspaces/美业内容2/wt-p1-f2-161/mkfast-template-main/tests/e2e/specs/ui-journey-three-modal.spec.ts` | **Partial** — 文案 / 图文 / 视频 (× desktop light 1440 + mobile dark 375); **not** Day-0 landing chain, legacy, 撤权, 结果复盘 | **Full** for three-modal path — real `/api/core/p1/commands` + Result wait; Core fixture provider | **Partial** — 1440 + 375 only; no 320/768, no 200% zoom on this journey | **Partial** — desktop light + mobile dark on Result/delivery only | **None** for axe; merchant-status language only | **None** | **None** | **Partial** — Result rejects workId/raw enums/provider/model slug text | **Partial** — adopt + delivery download + restore; **no** publication record / graded observation / weekly review / next snapshot | **None** — no commit/build/theme/seed/workflow evidence package |
| `uiux-day0-contract.spec.ts` | `.../specs/uiux-day0-contract.spec.ts` | **Partial** — Day-0 *activation budget* (C6) + first token on real Harness HTTP/SSE; not Landing→register→recover full story | **Full** for measured path (catalog explicitly: product HTTP/SSE never mocked) | Default desktop only | Default theme | Keyboard submit equivalence only | **None** | **None** | Merchant status “可发布” style asserts | First token only — stops before adopt/delivery/review | Screenshots via separate tour script; not AC10 package |
| `uiux-creation-loop.spec.ts` | `.../specs/uiux-creation-loop.spec.ts` | **Partial** — object-graph creation loop; strongest **结果复盘-adjacent** path (publish chip, ladder, `weekly_review` source task, 续做); Day-0 example/recommendation; **not** seven continuous journeys | **Partial** — real commands; some isolated rights/catalog overrides | Occasional 390 mobile; not matrix | Default | **None** axe | **None** | **None** | Export JSON rejects `providerCost` | **Partial** — manual publish + merchant signal + continue-from-review task; ladder ≠ formal graded observation ledger + weekly review UI | Screenshots under `docs/evidence/uiux-upgrade-b/`; not bound AC10 fields |
| `p1-recorded-journey.spec.ts` | `.../specs/p1-recorded-journey.spec.ts` | **Partial / Catalog drift** — file implements model select → generate → adopt → canvas blank → search; **does not** implement TEST-CATALOG §7 weekly review / video cancel / watermark full story | Real UI commands under fixture Core | Default 1440 | Default | **None** | **None** | **None** | Minimal | **None** for AC9 chain | **None** |
| `uiux-upgrade-b-results.spec.ts` | `.../specs/uiux-upgrade-b-results.spec.ts` | **Partial** — 文案 stream/stop/reroll/mobile single-choice; 图文 lightbox/export/OCC; **MISSING SPEC** trace-backed primary recommendation | Real BFF for stream; production-candidate opt-in for paced transport only | Mobile 390 for some cases | EN locale leakage case | **None** axe | **None** | **None** | EN chrome scan partial | Export/retry; not full AC9 | Screenshots only |
| `uiux-upgrade-b-video.spec.ts` | `.../specs/uiux-upgrade-b-video.spec.ts` | **Partial** — durable video workflow / cancel; supports 视频 journey depth | Real Core + worker fixture | 390 + 1440 switch | Default | **None** | **None** | **None** | Limited | Not AC9 | Screenshots |
| `uiux-upgrade-b-async.spec.ts` | `.../specs/uiux-upgrade-b-async.spec.ts` | Image job cross-route observation | Real job path | 390/1440 | Default | **None** | **None** | **None** | — | — | — |
| `uiux-upgrade-b-composer.spec.ts` | `.../specs/uiux-upgrade-b-composer.spec.ts` | Composer pre-submit contracts (Day-0 adjacent) | Real + intentional 503 projection stub for failure surface | 390 some | Default | Focus moves on named preset | **None** | **None** | Sanitized 503 surface | No post-result chain | Screenshots |
| `uiux-upgrade-b-i18n-motion.spec.ts` | `.../specs/uiux-upgrade-b-i18n-motion.spec.ts` | — | Real publication transition on mobile | 379 + 390 touch targets; overflow audit | EN/ZH product surfaces; reduced-motion celebration | Touch targets, not axe main path | **None** | **Partial** — `prefers-reduced-motion` on generation accent + publication celebration; **no** Save-Data / low-power / WebGL/GSAP stop proof | Model cards hide internal IDs (settings) | Publication celebration only | Screenshots |
| `uiux-precutover-baseline.spec.ts` | `.../specs/uiux-precutover-baseline.spec.ts` | — | Dashboard only | **Partial** — 1280@200% effective width overflow envelope (via 640 viewport) | Light-ish dashboard | **Partial** — axe WCAG 2.2 AA on `/dashboard` only; high-impact regression envelope (not “main path zero” across Result/Content/Assets/Delivery/Review) | **None** | CPU throttle in baseline, not Save-Data | — | — | Redacted aggregate attach; not AC10 full bind |
| `uiux-keyboard-governance.spec.ts` | `.../specs/uiux-keyboard-governance.spec.ts` | Keyboard create→select→adopt | Real fixture job | Default | Default | **Partial** — core creation keyboard + admin Impact Dialog trap/Esc/return; **not** Result/Delivery/Weekly Review modals | **None** | **None** | — | Stops at adopt | — |
| `uiux-shell-routes.spec.ts` | `.../specs/uiux-shell-routes.spec.ts` | Shell nav | — | 640 overflow + skip link + 200% effective | Light tokens | Skip link focus | **None** | **None** | — | — | — |
| `uiux-mobile-secondary.spec.ts` | `.../specs/uiux-mobile-secondary.spec.ts` | Mobile shell stages | Upload recovery real | **Partial** — 320/360/379/390/430/844×390 action book overflow + 48px targets; **not** Result/Content/Assets full matrix; **no** 768 | Default | Stage targets | **None** | **None** | — | — | — |
| `mobile-product-shell.spec.ts` | `.../specs/mobile-product-shell.spec.ts` | Mobile destinations + Progress honesty | Real query path | 390 shell overflow; dialog Esc/aria-modal | — | Modal Esc + focus-ish | **None** | rAF used in test wait only | Merchant destinations | — | — |
| `marketing-composer-harness.spec.ts` | `.../specs/marketing-composer-harness.spec.ts` | Day-0 / Harness question UX | **Fails AC2 as completion evidence** — heavy `page.route` fulfill of harness recommendation/tasks/decision | Default | Default | — | **None** | **None** | — | Mocked SSE path | **None** |
| `p0-golden-journey.spec.ts` | `.../specs/p0-golden-journey.spec.ts` | **Partial** handoff/publication/lead (seeded content, not Composer→Result continuous) | Real product commands | Default | Default | — | **None** | **None** | Causal language honesty on leads | **Partial** — manual publish + not_published; no weekly review UI / next-round snapshot | **None** |
| `product-asset-upload.spec.ts` | `.../specs/product-asset-upload.spec.ts` | Rights authorize path fragment | Real upload | Default | — | — | — | — | — | No withdraw/replace journey | — |
| `protected-pages.spec.ts` / `public-pages.spec.ts` | `.../specs/` | Smoke | — | Default | **Partial** — light/dark page health, not product hierarchy | Console health | — | — | — | — | — |
| `landing-page.spec.ts` | `.../specs/landing-page.spec.ts` | Landing only (Day-0 entry fragment) | Public routes | Default | Theme toggle | — | — | reduced-motion sections render | CTA destination allowlist | — | — |
| `pending-actions-inbox.spec.ts` | `.../specs/pending-actions-inbox.spec.ts` | Multi-task approval/question resume | Real harness | Default | Default | — | — | — | — | Not review chain | — |
| `marketing-identity-flow.spec.ts` | `.../specs/marketing-identity-flow.spec.ts` | Identity Q&A | Real | Default | — | Focus to new question | — | — | Merchant-language identity; no raw status code | — | — |
| Unit: `apps/core/src/product/product-service.test.ts` | Core unit | 撤权 **domain** only | N/A | N/A | N/A | N/A | N/A | N/A | N/A | withdraw → package revoke propagation | N/A |
| Unit: ContentPackage rights / contracts | `packages/contracts`, Core modules | Schema for `needs_replacement` / revoke | N/A | N/A | N/A | N/A | N/A | N/A | N/A | Command schema only | N/A |
| Evidence scripts (contentpackage tickets, day0 tour) | `docs/evidence/**`, `scripts/uiux/day0-tour-screenshots.mjs` | Historical manual/scripted runs | Mixed real-provider vs fixture | Mixed | Mixed | — | — | — | — | Ticket-scoped | Partial historical manifests; not #161 AC10 package |

### AC1 journey-by-journey scorecard

| Journey | Existing browser coverage | Verdict |
|---|---|---|
| **Day-0** | `uiux-day0-contract` (activation ≤2 + first token); `uiux-creation-loop` E0 example; `landing-page` public only | **Partial** — missing continuous Landing → register/login → recover → Lens/platform → min fact → first usable Result |
| **文案** | `ui-journey-three-modal` copy; `uiux-upgrade-b-results` stream/stop/reroll; keyboard governance adopt | **Strong partial** — stops at delivery download; no publication→observation→weekly→next |
| **图文** | `ui-journey-three-modal` image_text; creation-loop package/export; results image path | **Strong partial** — same tail gap as 文案 |
| **视频** | `ui-journey-three-modal` video×2 targets; `uiux-upgrade-b-video` durability | **Strong partial** — delivery ZIP deep checks exist; still no AC9 tail |
| **legacy** | No e2e for “Content search → read-only legacy → explicit adjust → on-demand anchor → Result → new revision, no fake fee” | **None (blocking)** |
| **撤权替换** | Core unit `withdraw_asset` propagation; **no** browser Assets → withdraw → needs_replacement → safe replace → new delivery | **None (blocking)** |
| **结果复盘** | `uiux-creation-loop` publish + ladder + `weekly_review` continuation task; `p0-golden` handoff publish; ops weekly review UI largely un-journeyed | **Partial (blocking for “continuous journey all pass”)** |

---

## Gap list (severity-ordered)

### Blocking (cannot close #161 DoD)

| # | Gap | Related ACs | Why blocking | Closest reuse |
|---|---|---|---|---|
| G1 | **No single harness runs all seven continuous journeys to green** | AC1 | Three-modal covers 3/7; Day-0/legacy/撤权/复盘 not in one release gate | Extend `fixtures/ui-journey.ts` + new `p1-f2-continuous-journeys.spec.ts` |
| G2 | **legacy journey missing entirely in e2e** | AC1, AC2 | Spec Testing Decision “历史内容” path has no Playwright owner | Content library routes + creation-loop package detail patterns |
| G3 | **撤权→待替换→安全替换→新交付 missing in e2e** | AC1, AC8, AC9 | Only Core unit propagation; merchant UI path unproven | `product-service` withdraw + Assets UI + ContentPackage `needs_replacement` |
| G4 | **AC9 full chain not continuous** | AC1, AC9 | Strongest fragment is creation-loop mid-chain; three-modal stops at download_done; no graded observation ledger + weekly review surface + next-round snapshot in one recorded path | creation-loop publish/ladder/续做 + ops weekly review modules |
| G5 | **Production-build not default for journey completion** | AC2, AC10 | Default Vite e2e mode; `PLAYWRIGHT_PRODUCTION_CANDIDATE` only for baseline/stream transport subset | `playwright.config.ts` productionCandidate webServer + three-modal |
| G6 | **Viewport × zoom matrix incomplete for main journeys** | AC3 | Have 320 (action book), 375 (three-modal mobile), 1440 (desktop), 200% (dashboard/shell only). **Missing 768 and 200% on Result/Content/Assets/Delivery/Review**; CTA occlusion not systematically asserted | `ui-journey` overflow check; mobile-secondary; precutover 200% |
| G7 | **axe main path not zero-serious across required surfaces** | AC4, AC5 | Only `/dashboard` pre-cutover envelope; not Composer/Result/Content/Assets/Delivery/Weekly Review | `uiux-precutover-baseline` AxeBuilder pattern |
| G8 | **Light+dark hierarchy not locked on Result/Content/Assets/Delivery/Weekly Review** | AC4 | public/protected page smoke ≠ product hierarchy AA | `setTheme` + three-modal dual profile |
| G9 | **AC10 evidence package does not exist for #161** | AC10 | No automated bind of commit + production build + browser + viewport + theme + seed revision + workflow run + media | P0 RC manifest shape (`docs/ci/p0-release-candidate-gate.md`) as template; not P1-F2-specific |
| G10 | **#147 process dependency** | Close order | Execution plan: `#147 → #169 → #161`. #147 live half can remain open without recorded secrets; **formal #161 close is process-blocked** until RC evidence exists, even if recorded harness is green | `docs/ci/p0-release-candidate-gate.md`, `docs/handoff/execution-plan-2026-07-22.md` |

### Polish / partial (needed for full AC, not the only missing journey)

| # | Gap | Related ACs | Notes |
|---|---|---|---|
| G11 | Keyboard coverage not on Result adjust/adopt, Delivery, Weekly Review modals | AC5 | Only creation journey + admin Impact Dialog + some mobile dialogs |
| G12 | VoiceOver checklist not authored under product evidence | AC6 | Spec requires manual checklist (Lens, stream, candidates, media roles, state, share fallback, result chips). Analysis notes mention VO gaps; **no `docs/evidence/**` checklist** |
| G13 | Save-Data / low-power / WebGL-GSAP stop untested | AC7 | reduced-motion only on landing + generation accent + celebration; product uses GSAP + globe WebGL + rAF loops |
| G14 | Merchant clean scan not global | AC8 | Result three-modal + model settings + identity + Pro Studio merchant-safe; Content/Assets lists and Weekly Review not systematically scanned for UUID/raw enum/English candidates/dead CTAs |
| G15 | Day-0 continuous path incomplete | AC1 Day-0 | Activation gate ≠ Landing→first Result |
| G16 | TEST-CATALOG drift on `p1-recorded-journey` and MISSING SPEC rows | Honesty | Catalog §7 over-describes file; §17.14 recommendation + §18.2 video SSE cursor still MISSING SPEC |
| G17 | `marketing-composer-harness` mocks harness HTTP | AC2 | Keep for UI regression; **exclude from #161 completion evidence** |
| G18 | Trace-backed primary recommendation still MISSING SPEC | AC1 文案 / D-023 | Not strictly one of the seven names, but Result policy incomplete |

---

## Recommended minimal new harness file(s) and reuse

### Primary (minimal set)

| New file | Purpose | Reuse |
|---|---|---|
| `mkfast-template-main/tests/e2e/specs/p1-f2-continuous-journeys.spec.ts` | **One serial gate** for AC1×7 under recorded/fixture Core + **prefer production-candidate Web** | `fixtures/ui-journey.ts` (`submitComposerJourney`, `waitForResultJourney`, adopt/delivery/download); `fixtures/user-activation.ts`; `fixtures/product.ts` (store/asset seed, withdraw command helpers); `fixtures/page-health.ts` `setTheme` |
| `mkfast-template-main/tests/e2e/specs/p1-f2-a11y-matrix.spec.ts` | AC3–AC5 matrix: 320/375/768/1440 × light/dark × 200% zoom; axe on Composer, Result, Content, Assets, Delivery, Weekly Review; keyboard trap sample on product modals | AxeBuilder from `uiux-precutover-baseline`; overflow helpers from `uiux-upgrade-b-i18n-motion` / mobile-secondary |
| `mkfast-template-main/tests/e2e/fixtures/p1-f2-evidence.ts` | AC10: write `docs/evidence/p1-f2-161/run-<sha>/manifest.json` with commit, build mode, browser version, viewport, theme, seed revision, workflow ids, screenshot/video paths | Shape from P0 RC manifest fields; Playwright `testInfo.attach` |
| `docs/evidence/p1-f2-161/voiceover-manual-checklist.md` | AC6 documented manual path | Spec § VoiceOver list |

### Secondary (only if primary cannot absorb)

| File | When |
|---|---|
| `p1-f2-rights-replace.spec.ts` | If 撤权 journey is too long for serial seven-pack |
| `p1-f2-legacy-anchor.spec.ts` | If legacy seed needs dedicated fixtures |
| Extend `ui-journey-three-modal` | Only if you refuse a new file; still need four missing journeys + AC9 tail |

### Explicit non-reuse as completion evidence

- `marketing-composer-harness.spec.ts` (route mocks)
- Pure unit withdraw tests (domain only)
- Historical `docs/evidence/contentpackage/**` real-runs (not this commit / not production-build bind)
- Pro Studio canvas journeys (out of P1-F2 merchant mainline)

### Suggested journey implementation order inside the serial gate

1. **文案 / 图文 / 视频** — clone three-modal contracts; extend past `download_done` into publication record + one graded observation chip + weekly review create/read + next-round snapshot confirm (AC9).
2. **结果复盘** — may collapse with (1) tail if one modality proves the ledger; otherwise dedicated seeded package path from creation-loop.
3. **Day-0** — thin continuous path: register → dashboard Composer → first token (reuse day0 counter optional).
4. **legacy** — seed legacy content projection → read-only → explicit adjust → anchor → revision (assert zero model charge if command exposes it).
5. **撤权替换** — authorize asset → attach/adopt → withdraw → UI `needs_replacement` → replace → re-export.

---

## Honest blockers

| Blocker | Type | Impact on #161 |
|---|---|---|
| **#147 P0 RC gate** | Process / release chain | Execution plan requires `#147` before `#161` formal close. Live provider evidence is fail-closed without secrets (`docs/ci/p0-release-candidate-gate.md`). **Does not prevent writing/running recorded harness**, but **does block claiming productization release closed**. |
| **#169 Canvas K7** | Process (between #147 and #161) | Same chain; Canvas QA separate from merchant seven journeys |
| **Missing product features for journeys** | Product (if A–E incomplete on a path) | HEAD claims P1 A–E present; still **no e2e owner** for legacy + 撤权 UI. If UI is missing, harness will red for product gaps, not only test gaps. |
| **Catalog drift** | Honesty | Do not cite TEST-CATALOG §7 as green coverage for weekly review without rewriting `p1-recorded-journey.spec.ts` |
| **Production-candidate cost** | Engineering | Full production-build four-service matrix is slow; still required by AC2/AC10 for completion, not for day-to-day fixture iteration |
| **VoiceOver** | Manual | No automation substitute; checklist must be filled by a human on real macOS VO |

---

## Commands to run existing related specs

From repo root (requires Docker Postgres as configured for Playwright; see `playwright.config.ts` `TEST_DATABASE_URL` default `postgres://meiye:meiye@127.0.0.1:54329/meiye`):

```bash
# Default recorded/fixture Core harness (Vite e2e mode)
cd mkfast-template-main

# AC1 partial — three-modal continuous (文案/图文/视频 × desktop light + mobile dark)
pnpm exec playwright test tests/e2e/specs/ui-journey-three-modal.spec.ts --workers=1

# Day-0 activation / first-token hard gate
pnpm exec playwright test tests/e2e/specs/uiux-day0-contract.spec.ts --workers=1

# Strongest publication / ladder / weekly_review continuation fragment
pnpm exec playwright test tests/e2e/specs/uiux-creation-loop.spec.ts --workers=1

# Copy stream / image result / export contracts
pnpm exec playwright test tests/e2e/specs/uiux-upgrade-b-results.spec.ts --workers=1

# Video durability
pnpm exec playwright test tests/e2e/specs/uiux-upgrade-b-video.spec.ts --workers=1

# Keyboard + modal trap sample
pnpm exec playwright test tests/e2e/specs/uiux-keyboard-governance.spec.ts --workers=1

# axe + 200% dashboard envelope
pnpm exec playwright test tests/e2e/specs/uiux-precutover-baseline.spec.ts --workers=1

# Mobile 320+ viewports (action book, not full Result matrix)
pnpm exec playwright test tests/e2e/specs/uiux-mobile-secondary.spec.ts --workers=1

# reduced-motion + touch targets
pnpm exec playwright test tests/e2e/specs/uiux-upgrade-b-i18n-motion.spec.ts --workers=1

# Mobile shell / dialog Esc
pnpm exec playwright test tests/e2e/specs/mobile-product-shell.spec.ts --workers=1

# Handoff / manual publication fragment (seeded, not Composer continuous)
pnpm exec playwright test tests/e2e/specs/p0-golden-journey.spec.ts --workers=1

# Catalog-named recorded journey (note: file is narrower than catalog §7)
pnpm exec playwright test tests/e2e/specs/p1-recorded-journey.spec.ts --workers=1

# From monorepo root shortcuts
cd /Users/bin/orca/workspaces/美业内容2/wt-p1-f2-161
pnpm e2e -- tests/e2e/specs/ui-journey-three-modal.spec.ts

# Production-build Web (partial AC2/AC10 transport/quality)
PLAYWRIGHT_PRODUCTION_CANDIDATE=true PLAYWRIGHT_AUTH_BASE_URL=http://localhost:3000 \
  pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-precutover-baseline.spec.ts

# Root alias for quality baseline
pnpm uiux:quality
```

Core unit (撤权 domain only — not #161 completion):

```bash
pnpm --filter @meiye/core test -- product-service.test.ts
```

---

## Summary matrix (AC → coverage)

| AC | Coverage now | Residual to close |
|---|---|---|
| AC1 | ~3/7 journeys strong; 1 partial Day-0; 1 partial 复盘; 2 missing | Unified serial seven-journey gate |
| AC2 | Three-modal + day0 real HTTP good; production-build rare; harness mock exists | Production-candidate journey run; ban mocks from evidence |
| AC3 | Fragments at 320/375/390/1440/200%(dashboard) | 768 + 200% on main product surfaces + CTA occlusion |
| AC4 | Theme smoke + dual three-modal profiles | L/D hierarchy on five named surfaces |
| AC5 | Dashboard axe; partial keyboard | Main-path axe zero serious/critical; product modal kbd |
| AC6 | None documented | Manual checklist file + sign-off |
| AC7 | reduced-motion partial | Save-Data / low-power / WebGL-GSAP stop |
| AC8 | Result + settings fragments | Full merchant UI scan incl. Content/Assets/Review |
| AC9 | Fragments only | One continuous recorded chain to all four artifacts |
| AC10 | Ad-hoc screenshots | Structured evidence manifest per run |

---

## Bottom line

Existing Playwright inventory is **strong on three-modal Result→Delivery download** and **decent on Day-0 activation, creation-loop mid-chain, keyboard samples, and dashboard axe**, but **#161 is not closeable** until (1) legacy + 撤权 browser journeys exist, (2) AC9 tail is continuous, (3) a11y/viewport matrix covers named surfaces, (4) production-build + AC10 evidence bind land, and (5) process order with **#147** is respected for formal close.
