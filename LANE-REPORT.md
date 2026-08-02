# LANE-REPORT — L3 fix/workbench-form

**Lane:** L3  
**Branch:** `fix/workbench-form`  
**Worktree:** current directory only (no push, no main touch)  
**Date:** 2026-08-02

## Summary

Implemented the workbench form contract from `docs/specs/xhs-vertical-integration-spec-2026-08-01.md` §2 and gap-remediation R-1: Idle order, Composer bottom capsule, document timeline + six AgentFrame families, rose-gold generation accent, and phase-aware Result Inspector.

## Per-item delivery

### L3-1 首屏顺序重排（R-1）

**Done**

- Idle order is now **问候 → 分段器 → Composer → 建议行 → Shelf**.
- `ComposerCreationModeSegment` extracted from `ComposerPromptBar` and rendered under the greeting.
- `dashboard-section-proposal` moved below the create section (still mount-stable under Active via `hidden={shelfCollapsed}`).
- Contract test rewritten with comment: *R-1 (gap-remediation-plan 2026-08-02) supersedes D-164① ordering*.

**Commit:** `d73d8d09` `fix(workbench): reorder Idle home per R-1 and host creation segmenter outside Composer`

### L3-2 Composer 底栏胶囊化

**Done**

Composer converges to **textarea + one bottom glass capsule**:

| Capsule | Content |
| --- | --- |
| ＋素材 | attachment / style-reference / generation params popover |
| 输出类型▾ | `LensRadiogroup` (+ switch preview); required highlight when unselected |
| 配方▾ | `RecipeCardsPanel` |
| @ | identity card + `ComposerToolsStrip` |
| 发到哪▾ | six platform chips + reuse chips; selected platform on face |
| 额度 | passive balance face; recovery host in popover; blocking card still outside when short |
| ↑ circular send | `composer-submit` |

- Popovers use existing shadcn/base-ui `Popover`.
- Radiogroup / fieldset a11y retained **inside** popovers (same testids: `composer-lens-radiogroup`, `composer-destination-option-*`, recipe pill groups).
- Selection echo on labels (e.g. 「图文」, 「小红书」, recipe title).

**Commit:** `0827e6bb` `feat(workbench): collapse Composer affordances into a bottom capsule bar`  
(also carries L3-4 accent wiring — see below)

### L3-3 文档时间线视觉 + AgentFrame 六族

**Done**

- Conversation content is a `.meiye-document-timeline` with left **1.5px rail** (`meiye-document-timeline__rail`) and per-turn **9px nodes** (`meiye-agent-frame__node`).
- Uppercase stage labels via locale (`agent_frame_stage_*`).
- CSS selectors on `[data-agent-frame=…]` / `.meiye-agent-frame--*` are non-zero (heroui-glass.css).
- Memory family mapped: `experience_basis` / `experience_sediment` / `experience_correction` → `memory` in `agent-frame-registry.ts`; surfaces wrapped through `AgentFrameHost`.

#### 六族视觉方案（克制 / C10）

| Family | Node | Card / body edge | Typical turns |
| --- | --- | --- | --- |
| **narrative** | muted grey fill | plain / light porcelain | merchant, stages, route_notice, report |
| **decision** | **rose-gold** fill + soft glow | solid rose-gold left border | question, execution_confirm |
| **plan** | indigo-tinted | indigo left border | note_plan |
| **result** | stronger border + light shadow | heavier porcelain feel | candidate, delivery |
| **task** | amber fill | default body | terminal |
| **memory** | soft teal | dashed teal left border | experience_* |

**Commit:** `b4c56009` `feat(workbench): document timeline rail and AgentFrame six-family visuals`

### L3-4 玫瑰金生成态接线

**Done**

- On `running` / `submitting`, `ComposerPromptBar` applies `meiye-rose-glow` and mounts `GenerationAccent` (`data-testid="composer-generation-accent"`).
- Idle: accent absent; reduced-motion still handled by existing `.meiye-rose-glow` CSS.
- Interaction assertion: running → accent in DOM; idle → not present.

**Commit:** included in `0827e6bb` (capsule bar commit)

### L3-5 Inspector 右栏充实

**Done**

- `WorkbenchInspectorPanel` is phase-aware:
  - **delivered:** summary card (thumb placeholder, statement, platform) + primary **进入对象工作区**
  - **running:** stage label + progress phrase
  - **idle:** honest empty copy
- Hosted from `composer-home` with session phase / latest stage / platform.

**Commit:** `3d7836a3` `feat(workbench): phase-aware Result Inspector for running and delivered`

## Test evidence

| Gate | Result |
| --- | --- |
| `pnpm exec vitest run` (web interaction) | **406 passed** / 61 files |
| Unit/static `tsx --test` (web `src/**/*.test.ts`) | **1707 passed**, 1 fixed (P0-2 false positive on popover `max-h`), 3 skipped |
| Focused unit: agent-frame-registry, dashboard-home-contract, workbench-p1 static | pass |
| Biome check on touched sources | clean after format |
| Locale parity `check-locale-keys.ts` | **OK (3995 keys)** en/zh |
| `tsc --noEmit` | no new errors (pre-existing `content-collections` missing types only) |

## Changed files

```
mkfast-template-main/project.inlang/messages/en.json
mkfast-template-main/project.inlang/messages/zh.json
mkfast-template-main/src/components/heroui-pro/heroui-glass.css
mkfast-template-main/src/product/composer/agent-frame-registry.ts
mkfast-template-main/src/product/composer/agent-frame-registry.test.ts
mkfast-template-main/src/product/composer/agent-frame.interaction.test.tsx
mkfast-template-main/src/product/composer/composer-conversation.tsx
mkfast-template-main/src/product/composer/composer-conversation.interaction.test.tsx
mkfast-template-main/src/product/composer/composer-home.tsx
mkfast-template-main/src/product/composer/workbench-p1.static.test.ts
mkfast-template-main/src/product/composer/workbench-shell-layout.tsx
mkfast-template-main/src/product/composer/workbench-shell.interaction.test.tsx
mkfast-template-main/src/product/dashboard-home-contract.test.ts
```

Untracked (not committed, per brief): `LANE-BRIEF.md`, `LANE-REPORT.md`.

## Commits (this lane)

1. `d73d8d09` fix(workbench): reorder Idle home per R-1 and host creation segmenter outside Composer  
2. `0827e6bb` feat(workbench): collapse Composer affordances into a bottom capsule bar  
3. `b4c56009` feat(workbench): document timeline rail and AgentFrame six-family visuals  
4. `3d7836a3` feat(workbench): phase-aware Result Inspector for running and delivered  

## Known follow-ups / gaps

1. **Composer-home intertwine:** L3-1 commit also carries host wiring for capsule slots + inspector props (same file). Semantics are complete; git history is not a pure linear layer cake.
2. **Inspector thumbnail** is a porcelain placeholder — revision contract has no image URL; real thumb needs delivery asset projection later.
3. **Identity no longer leads the empty transcript** — it lives in the @ capsule (per L3-2). Day-0 identity card interaction tests that assumed stream hosting were updated for the new placement pattern (isolated identity tests remain).
4. **Credit double-mount when blocked:** passive/recover lives in capsule; full blocking card also mounts under the sticky host when `quotaBlocked` so `role=alert` stays visible without opening the popover.
5. **No live browser dogfood** in this lane — gates are interaction + static/unit. Visual polish of capsule density on 390px is worth a later e2e pass.
6. **paraglide generated modules** are rewritten by `locale:compile` at test time; source of truth remains `project.inlang/messages/{en,zh}.json`.

## Authority references

- Spec §2 / §2.4: `docs/specs/xhs-vertical-integration-spec-2026-08-01.md`
- R-1: gap-remediation plan 2026-08-02 (brief)
- Visual: glass shell + porcelain + rose-glow (`heroui-glass.css`, `styles.css` `.meiye-rose-glow`)

---

## e2e capsule adaptation (LANE-BRIEF-2)

**Date:** 2026-08-02  
**Goal:** Journey gate green under L3-2 capsule Composer (popover-hosted lens / recipe / destination / attach / @ / credit).

### What changed

| Area | Change |
| --- | --- |
| Product | Lens capsule trigger always exposes `aria-required="true"` (radiogroup still has it inside panel). |
| Product | `running` glow/lock excludes Brief-open `submitting` so intent stays editable for stale-Brief invalidation. |
| Fixture | `ui-journey.ts`: `openComposerCapsule` / `closeComposerCapsule` / `selectComposerLens` / `openComposerRecipeCard`; discovery + submit paths open panels first; capsule label echo asserted after select. |
| Fixture | `seedComposerInlineAuthorize` opens attach capsule (gallery input is portaled). |
| Activation budget | Day-0 counts include lens-capsule open: copy **3**, image_text/video **5** (behavior budget still exact). |
| Specs | mobile secondary, catalog-live, assembly-gate, m04, w12 (@ mention for identity), P2 files (image-text-note-compiler, p2-browser-closure, composer-card-family). |

### Journey evidence (CI-isomorphic env)

```
CREATE DATABASE meiye_l3_journey; CREATE DATABASE meiye_l3_journey_dbos;
RELEASE_COMMIT_SHA=$(git rev-parse HEAD)
TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:5432/meiye_l3_journey
TEST_DBOS_SYSTEM_DATABASE_URL=.../meiye_l3_journey_dbos
HARNESS_DBOS_SYSTEM_DATABASE_URL=.../meiye_l3_journey_dbos
CI=true MODEL_EXECUTION_MODE=fixture PLAYWRIGHT_PRODUCTION_CANDIDATE=true
PLAYWRIGHT_BASE_URL=http://localhost:3010 PLAYWRIGHT_AUTH_BASE_URL=http://localhost:3011
PLAYWRIGHT_CANDIDATE_PORT=3010 PLAYWRIGHT_CORE_PORT=4110 PLAYWRIGHT_CANVAS_PORT=4210 PORT=3011
CI_EVIDENCE_DIR=output/ci/l3-journey
bash scripts/ci/run-pr-production-journey.sh
→ 10 passed (4.4m)
DROP both DBs.
```

Specs in the gate (all green):

1. `assembly-gate-required-journey.spec.ts`
2. `m04-browser-hard-gate.spec.ts` (incl. English stale Brief + workId restore)
3. `marketing-identity-flow.spec.ts`
4. `w12-identity-draft-assistant.spec.ts`
5. `xhs-image-text-main-journey.spec.ts`

Evidence log: `output/ci/l3-journey/playwright-production-journey.log` (last run).

### P2 locator adaptation (not full P2 acceptance re-run)

Updated arrival paths only (same assertion strength) in:

- `image-text-note-compiler.spec.ts`
- `p2-browser-closure.spec.ts`
- `composer-card-family.spec.ts`

`viral-adapt-opencli-gate` / `admin-sensitive-words` had no old Composer flat locators.

**Known #298 credit-stale assertions (out of scope, not weakened):**  
`composer-quota-passive` / progressive-fact / T20 usage / deep quote — left as-is; report if P2 re-run still red on those.

### Commits

- `test(e2e): adapt journey fixtures to capsule Composer` (branch tip of `fix/workbench-form`)
