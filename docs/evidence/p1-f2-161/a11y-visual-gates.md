# P1-F2 #161 — Accessibility / Visual / Merchant-Language Gates

Evidence inventory for Issue #161 (P1 productization a11y + visual + merchant-language
acceptance). Scope is the main merchant product (Composer → Result → Delivery).
**Pro Studio is out of scope.**

Spec authority:
[`docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md`](../../specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md)
§11 / Testing Decisions (Responsive, visual and accessibility).

Companion AC1–AC10 journey map:
[`coverage-gap-matrix.md`](./coverage-gap-matrix.md) (full continuous-journey gaps).
This file owns **AC3–AC8** a11y/visual/merchant-language detail only.

---

## 1. Gate matrix

| Gate | Spec requirement | Existing automation | Residual (manual / missing) | Status |
|---|---|---|---|---|
| **WCAG 2.1 AA (axe)** | Zero serious/critical on Composer, Result, Content, Assets, Delivery, Weekly Review | `uiux-precutover-baseline.spec.ts` — axe tags `wcag2a/aa`, `wcag21a/aa`, `wcag22aa` on authenticated **dashboard only**; freezes high-impact violation envelope | axe not yet wired to Result / Content / Assets / Delivery / Weekly Review continuous journeys | **Partial** — dashboard envelope automated; other surfaces residual |
| **Keyboard trap** | Dialog / Bottom Sheet / Select: focus trap, Esc, focus return | `uiux-keyboard-governance.spec.ts` — Impact Dialog Tab trap + Escape + focus return; creation journey fully keyboard-operable with `aria-live` status | Composer Bottom Sheet / Result overflow / Delivery modal trap not covered by dedicated keyboard governance | **Partial** — admin Impact Dialog + core creation path automated |
| **Skip link + Tab order** | Skip link first; product content focus | `uiux-shell-routes.spec.ts` — skip link at 640px effective viewport; focus ring on real Tab-focused control | Full Tab-order audit of Result sticky actions residual | **Partial** |
| **200% zoom** | 1280@200% (=640 CSS px) no horizontal overflow | `uiux-precutover-baseline.spec.ts` (`horizontalOverflowAt200Percent ≤ 0`); shell routes 640px overflow check | Full Result/Delivery at 200% residual | **Partial** — shell/dashboard automated |
| **Light / dark** | 320/375/768/1440 × light/dark release matrix | `public-pages.spec.ts`, `protected-pages.spec.ts` (en/zh × dark/light render health); `ui-journey-three-modal.spec.ts` desktop light + 375 mobile dark real journey | Systematic screenshot regression matrix residual | **Partial** — render health + one continuous journey automated |
| **Reduced motion** | Non-essential loops off; status remains readable without motion | E2E: `uiux-upgrade-b-i18n-motion.spec.ts` (generation accent static; publish celebration particles hidden); `landing-page.spec.ts` reduced-motion landing; CSS: `styles.css` rose-glow + product-shell global reduce; unit: `accent-motion.test.ts`, **`merchant-language.contract.test.ts` (CSS static gate, #161)** | Low-power / battery-saver heuristics residual | **Mostly automated** for product shell + landing |
| **Save-Data** | Stop non-essential WebGL/rAF/GSAP under Save-Data | **None** — no `navigator.connection.saveData` or equivalent product hook found | Full Save-Data policy implementation + test residual | **Manual residual / product gap** |
| **Merchant language — UUID** | Never show Work/Job/Asset UUID to merchants | Unit: `merchant-support-reference.test.ts`, `result-live-projection.test.ts`, `result-run-detail-model.test.ts`, `result-revision-timeline-model.test.ts`, video shot labels; interaction: `result-merchant-truth.interaction.test.tsx`; E2E: `fixtures/ui-journey.ts` `waitForResultJourney` rejects `workId`; **locale static: `merchant-language.contract.test.ts` UUID scan (#161)** | Spot-check Content list + Weekly Review in browser residual | **Mostly automated** |
| **Merchant language — raw enum** | No raw status codes (`running`, `candidate_ready`, …) as labels | `status.test.ts` (normalized Chinese ProductStatus); `ai-image-selector.test.tsx`; `canonical-history-model.test.ts` (raw enum fallbacks); E2E result surface rejects `running\|ready\|delivered\|…`; **locale static RAW_ENUM_LEAK (#161)** | Admin-only raw codes may still appear outside merchant surfaces (allowed) | **Mostly automated** for merchant surfaces |
| **Merchant language — provider slug** | No `openai/…`, `seedance-2`, `catalogModelId`, etc. | `result-live-projection.test.ts` strips provider identity; E2E rejects `provider\|seedance-2\|catalogModelId`; model cards sanitize internal IDs in i18n-motion; **locale PROVIDER_SLUG_LEAK (#161)** | Live-provider error surfaces need spot check | **Mostly automated** |
| **Merchant language — dead CTA** | Exactly one usable primary; no visible dead primary | `result-shell-model.test.ts` phase matrix (single primary + **`enabled === true` #161**); `result-merchant-truth.interaction.test.tsx` one `result-primary-action`; mobile sticky primary in three-modal journey | Visible disabled secondary / overflow dead buttons residual | **Partial → improved** |
| **Touch targets** | ≥44×44 (product signature 48×48) | `uiux-upgrade-b-i18n-motion.spec.ts` 379×820 / 390×844 bilingual three-stage 48×48 audit; mobile secondary stage heights | 320px edge residual | **Mostly automated** for mobile product |
| **Streaming a11y** | No token-by-token SR spam; throttled stage announcement | Result shell single `aria-live` region (`result-shell-a11y` + `result-token-stream-a11y`); delivery outcome distinct announcements unit tests | VoiceOver paragraph throttle residual | **Code + unit partial; VO manual** |
| **Share degrade** | file → one-shot link → download; cancel ≠ published | `delivery-share-degrade.test.ts` pure matrix; delivery outcomes a11y distinct phrases | Real iOS share sheet residual | **Unit automated; device manual** |
| **VoiceOver** | Lens, stream, media roles, state, share degrade, result chips | — | Full manual checklist | **Manual only** → see [`voiceover-manual-checklist.md`](./voiceover-manual-checklist.md) |

---

## 2. Inventory of existing utilities & tests

### 2.1 Axe / quality envelope

| Path | Role |
|---|---|
| `mkfast-template-main/tests/e2e/specs/uiux-precutover-baseline.spec.ts` | WCAG 2.2 AA axe (`@axe-core/playwright`), DOM/query envelope, focus evidence, 200% overflow, lab Web Vitals |
| Root `package.json` → `uiux:quality` | Production-candidate Playwright runner for the baseline |
| `mkfast-template-main/package.json` → `@axe-core/playwright` | Dependency |

### 2.2 Keyboard governance

| Path | Role |
|---|---|
| `tests/e2e/specs/uiux-keyboard-governance.spec.ts` | Full keyboard creation journey + Impact Dialog focus trap |
| `tests/e2e/specs/uiux-shell-routes.spec.ts` | Skip link, visible focus ring, 200% shell |
| `src/product/composer/lens-radiogroup.tsx` | `role="radiogroup"`, roving tabindex |
| `src/product/results/delivery-outcomes-a11y.ts` | Distinct live-region + focus targets for delivery outcomes |

### 2.3 Reduced motion

| Path | Role |
|---|---|
| `src/styles.css` | `.meiye-rose-glow` + global `.meiye-product-shell` reduce rules |
| `src/components/uiux/generation-accent*.tsx` | Accessible `output` fallback + motion variant |
| `src/components/uiux/publish-celebration*.tsx` | Same pattern for publish celebration |
| `src/components/uiux/accent-motion.test.ts` | SSR fallback text without motion |
| `tests/e2e/specs/uiux-upgrade-b-i18n-motion.spec.ts` | Real pending accent + publish celebration under `emulateMedia({ reducedMotion: 'reduce' })` |
| `tests/e2e/specs/landing-page.spec.ts` | Landing reduced-motion section render |
| `src/hooks/use-in-view.ts` | Skips animation when reduced-motion matches |
| `src/lib/uiux/merchant-language.contract.test.ts` | **#161 static CSS reduce contract** |

### 2.4 Merchant-language leak tests

| Path | Leak class covered |
|---|---|
| `src/lib/uiux/merchant-language.contract.test.ts` | Canonical object names in i18n; **UUID / raw enum / provider slug locale scan (#161)** |
| `src/lib/uiux/status.ts` + `status.test.ts` | Normalized ProductStatus labels (no raw provider status) |
| `src/product/results/merchant-support-reference.ts` | Short `MY-xxxxxx` code instead of UUID |
| `src/product/results/result-live-projection.test.ts` | Operator UUID + provider identity stripped |
| `src/product/results/result-run-detail-model.test.ts` | Model slug / UUID stripped from run detail |
| `src/product/results/result-merchant-truth.interaction.test.tsx` | Result Center visible text free of ids / unfinished raw states |
| `src/product/results/result-shell-model.test.ts` | Single primary per phase; **primary always enabled (#161 dead CTA)** |
| `src/p1/ai-image-selector.test.tsx` | No raw job id / `running` status in markup |
| `src/product/canonical-history-model.test.ts` | Localized asset facts vs raw enums |
| `tests/e2e/fixtures/ui-journey.ts` → `waitForResultJourney` | E2E rejects workId, raw states, provider/model slugs on Result shell |
| `tests/e2e/specs/ui-journey-three-modal.spec.ts` | Desktop light + mobile dark continuous merchant journey |
| `tests/e2e/specs/uiux-upgrade-b-i18n-motion.spec.ts` | Model cards hide internal identifiers |

### 2.5 Light / dark & viewports

| Path | Role |
|---|---|
| `tests/e2e/fixtures/page-health.ts` | `ThemeMode` helper |
| `tests/e2e/specs/public-pages.spec.ts` | Public routes × locale × theme |
| `tests/e2e/specs/protected-pages.spec.ts` | Authenticated routes × locale × theme |
| `tests/e2e/specs/ui-journey-three-modal.spec.ts` | 1440 light + 375 dark real journey |

---

## 3. Commands

Run from repo root unless noted. Prefer Node 22 + pnpm 10.30.3.

### 3.1 Cheap static / unit gates (no browser, no Core)

```sh
# Merchant-language locale leaks + reduced-motion CSS contract (#161)
pnpm --filter @meiye/web exec tsx --test \
  src/lib/uiux/merchant-language.contract.test.ts

# ProductStatus normalization
pnpm --filter @meiye/web exec tsx --test \
  src/lib/uiux/status.test.ts

# Result shell primary-action / dead-CTA matrix
pnpm --filter @meiye/web exec tsx --test \
  src/product/results/result-shell-model.test.ts

# Support reference UUID scrub
pnpm --filter @meiye/web exec tsx --test \
  src/product/results/merchant-support-reference.test.ts

# Live projection + run detail merchant language
pnpm --filter @meiye/web exec tsx --test \
  src/product/results/result-live-projection.test.ts \
  src/product/results/result-run-detail-model.test.ts

# Delivery outcomes a11y + share degrade matrix
pnpm --filter @meiye/web exec tsx --test \
  src/product/results/delivery-outcomes-a11y.test.ts \
  src/product/results/delivery-share-degrade.test.ts

# Accent reduced-motion SSR fallbacks
pnpm --filter @meiye/web exec tsx --test \
  src/components/uiux/accent-motion.test.ts
```

Or the full Web unit suite (includes the above):

```sh
pnpm --filter @meiye/web test
```

Interaction (vitest) merchant Result truth:

```sh
pnpm --filter @meiye/web test:interaction -- \
  src/product/results/result-merchant-truth.interaction.test.tsx
```

### 3.2 Playwright gates (requires local harness)

Baseline (axe + 200% + focus + quality envelope):

```sh
# Dev harness up on :3000, then:
pnpm uiux:quality
# equivalent:
PLAYWRIGHT_PRODUCTION_CANDIDATE=true \
PLAYWRIGHT_AUTH_BASE_URL=http://localhost:3000 \
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-precutover-baseline.spec.ts
```

Keyboard governance:

```sh
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-keyboard-governance.spec.ts
```

Reduced motion + touch targets + model sanitization:

```sh
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-upgrade-b-i18n-motion.spec.ts
```

Merchant Result language across modalities (desktop light + mobile dark):

```sh
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/ui-journey-three-modal.spec.ts
```

Shell keyboard + 200% zoom:

```sh
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/uiux-shell-routes.spec.ts
```

Landing reduced-motion:

```sh
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/landing-page.spec.ts
```

Light/dark render health:

```sh
pnpm --filter @meiye/web exec playwright test \
  tests/e2e/specs/public-pages.spec.ts \
  tests/e2e/specs/protected-pages.spec.ts
```

### 3.3 Manual residual

| Item | Checklist |
|---|---|
| VoiceOver (macOS Safari / iOS Safari) | [`voiceover-manual-checklist.md`](./voiceover-manual-checklist.md) |
| Save-Data / low-power decorative loop stop | Product hook not implemented; verify no runaway rAF/WebGL under Network Conditions + `prefers-reduced-motion` as proxy until Save-Data lands |
| axe on Result / Content / Assets / Delivery / Weekly Review | Extend baseline tags or attach AxeBuilder to three-modal / creation-loop when Agent B lands continuous coverage |
| 320 / 768 / 1440 dark screenshot matrix | Capture into `docs/evidence/p1-f2-161/screenshots/` during final #161 RC |

---

## 4. #161 Agent C deltas (this worktree)

| Change | Purpose |
|---|---|
| `mkfast-template-main/src/lib/uiux/merchant-language.contract.test.ts` | Locale UUID / raw-enum / provider-slug leak scans + reduced-motion CSS static contract |
| `mkfast-template-main/src/product/results/result-shell-model.test.ts` | Assert every merchant phase primary is `enabled: true` (dead CTA gate) |
| `docs/evidence/p1-f2-161/a11y-visual-gates.md` | This matrix |
| `docs/evidence/p1-f2-161/voiceover-manual-checklist.md` | VoiceOver manual residual |

Verified:

```text
tsx --test merchant-language.contract.test.ts result-shell-model.test.ts
→ 31 pass / 0 fail
```

---

## 5. Automated vs manual residual (summary)

### Automated (cheap or existing)

- Locale merchant-language static scans (UUID, raw enum, provider slug)
- ProductStatus normalization
- Result shell single primary + always-enabled primary
- Support reference / run detail / projection UUID+provider scrub
- Delivery outcome a11y distinct announcements + share degrade matrix
- Generation accent / publish celebration reduced-motion (unit + E2E)
- Product shell CSS reduced-motion contract
- Dashboard axe WCAG 2.1/2.2 AA high-impact envelope
- Keyboard creation path + Impact Dialog focus trap
- Shell skip link + 200% overflow
- Light/dark render health pages
- Continuous Result merchant-language E2E (three-modal)
- Mobile touch-target audits (379 / 390)

### Manual residual

- Full VoiceOver pass (Lens → stream → candidates → media roles → state → share degrade → chips)
- Save-Data policy (not implemented as product hook)
- axe continuous coverage beyond dashboard
- Full release screenshot matrix (320/375/768/1440 × light/dark × 200%)
- Real-device system share sheet + one-shot link expiry
- Streaming SR paragraph throttle under live VoiceOver

### Explicit non-goals for this gate

- Pro Studio / Canvas G-index a11y (owned by #163–#169)
- Live-provider cost / model identity (admin surfaces may show technical ids)
- Replacing continuous browser journeys with fixture screenshots
