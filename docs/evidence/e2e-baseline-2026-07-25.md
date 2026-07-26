# Browser suite baseline — lane fe3, 2026-07-26

`coord-gate.sh` has referenced this file for a while; it did not exist. This is
the authoritative red list T37 (#231 / M-04) was told to produce before deciding
what becomes a required gate, what gets demoted, and what gets repaired.

Read it as a snapshot, not a verdict: it records what the suite did on this
machine on this date, at the commit named below, with the reasons where the
reason is known.

## How it was run

- Lane fe3 worktree, branch `leelv007-cmd/t37-m04-browser-hard-gate`, baseline
  commit `7ea3de75` (local `main` after T34 merged).
- `TEST_DATABASE_URL` → `meiye_fe3` on the real Postgres at `127.0.0.1:54329`;
  `PORT=3108`, `PLAYWRIGHT_CORE_PORT=4108`, `PLAYWRIGHT_CANVAS_PORT=4208`.
- `MODEL_EXECUTION_MODE=fixture` throughout. No credential is involved anywhere
  in this file, and nothing here is a `live_verified` claim.
- Specs were run in chunks of eight so one wedged four-service stack costs a
  chunk rather than the sweep (the T07 execution report records that this local
  harness hangs after hours of heavy runs and does not self-heal).

### Disclosure: the first two runs did not take the cross-lane lock

The Day-0 single-spec run and the chunked sweep below were started **without**
`.scratch/orca-run-2026-07-25/e2e-lock.sh`. That was my mistake, and it had a
cost: chunks 1–3 died to `SIGTERM` within a minute each, and the coordinator
identified the collision — my unlocked stack and lane T23's locked run were
competing for the same Postgres and CPU, and killed each other's `webServer`
boot. Those three chunk results are therefore not evidence of anything about the
specs; they are evidence of the collision.

Both runs are recorded here as they happened rather than dropped. Everything
after the warning went through the lock, and `/tmp/meiye-e2e.log` carries the
acquire/release lines for this worktree.

**Confidence, per the coordinator's ruling**: every number produced by those two
unlocked runs — including the Day-0 3 passed / 4 failed below — is **low
confidence and awaits a locked re-measurement**. It is recorded because a
missing baseline is worse than a caveated one, not because it is settled.

## What ran

| Chunk | Specs | Result |
|---|---|---|
| — | `uiux-day0-contract` (single-spec run, 10.2m) | 3 passed / 4 failed |
| 1 | admin-\*, assembly-gate, auth, catalog-live-navigation, composer-card-family | **lost** — killed at boot by the lock collision |
| 2 | composer-reshell, dashboard-home-mount, image-\*, intent-routing, landing, m01, marketing-composer-harness | **lost** — same |
| 3 | marketing-identity, mobile-product-shell, p0-golden-journey, p1-\*, pending-actions, pro-studio-cross-service | **partial** — 2 passed, 1 skipped, then killed |
| 4 | pro-studio-\* (8 specs), 8.8m | 14 passed / 5 failed / 1 skipped |
| 5 | pro-studio-security, product-asset-upload, protected/public-pages, registration-redemption, runtime-tracer, settings-profile, t33, 6.1m | 17 passed / 5 failed |
| 6 | t34, task-source, ui-journey-three-modal, uiux-creation-loop, uiux-day0-contract, … | **partial** — stopped at the lock warning |
| 7–8 | uiux-shell-routes, uiux-upgrade-b-\*, video-\*, works-reshell | **not run** |

## Reds, with the reason where it is known

### The Day-0 contract spec — 4 of 7 red *before* this ticket touched it

This is the file M-04 says holds the right strict assertions off the required
path. Its own reds are why "migrate them" and not "make the file required":

1. **template path** (`:210`) — the recipe-card path never produces
   `[data-has-token="true"]`; the page snapshot at failure is back on the
   Composer entry surface with 「开始下一次任务」 showing. Not reproduced by the
   lens+intent path, which is the one the new gate walks.
2. **pure text path** (`:266`) — reaches the first token, then fails on
   `expect(events).toContain('first_work_created')`: the legacy
   `operations.creative_workbench` projection returns `[]`. The assertion is
   bound to a projection the new seam does not feed.
3. **video path** (`:332`) — `composer-delivery-card` never arrives inside the
   test's own 180s budget. The three-modal journey gives video 600s.
4. **T5 inline authorize** (`:539`) — no `[data-has-token="true"]` after the
   inline-authorized submit.

(1) and (4) are product-side questions this ticket did not chase; they are
recorded here so the next reader does not rediscover them. (2) and (3) are
assertion-side and are exactly what the migration fixes: the new gate asserts
neither the legacy projection nor a video budget the product cannot meet.

## The new required gate, measured (2026-07-26, locked)

`m04-browser-hard-gate.spec.ts`, last run at commit `b7de50dd`, through
`.scratch/orca-run-2026-07-25/e2e-lock.sh`:

| Case | Result |
|---|---|
| `copy → wechat_moments` | **passed, 13.1s** |
| `image_text → xiaohongshu` | **passed, 59.2s** |
| `video → douyin` | **skipped (declared `fixme`)** — blocked on two core walls, below |

Each passing case walks submit → 白话进度 → 首 token (copy) / 两种图文方向
(image_text) → 刷新恢复① → T08 双字段 body → Result Center → 采用 → 交付
(完整发布包) → 刷新恢复②, with the D-098 C6 activation budget asserted (copy 2,
image_text 3) and the D-111 neutral-identity check.

Getting there took six product defects out of the way. They are recorded here
because each one was on the merchant's own Day-0 path and none of them had a
test that ran:

1. **An inline-authorized image could not be submitted** (`composer-home.tsx`,
   fixed in `d6912b68`). The submission gate reads `product.state`, which
   `useProductState` fetches once on mount; every inline asset write goes
   through the module-level `executeProductCommand`, which never updates it. So
   the card said 「素材信息已确认」 and the submit button said 「当前素材还未确认
   可用于宣传」 at the same time, and 图文/视频 — whose recipes require a source —
   could not start at all. This is also the unexplained day-0 red at
   `uiux-day0-contract.spec.ts:539`.
2. **图文 delivered to a dead Result Center** (`39484352`). `imageFacts` reads
   the legacy `creative_workbench` CreativeAssets, which the ContentPackage
   seam does not write, so the worksurface stayed on 「等待图片候选…」 while the
   status read 可发布.
3. **…with no 采用 action** (same commit). `hasUsableCandidate` counts those
   same rows, so the shell fell through to 「继续调整」.
4. **…and adoption that could not succeed** (same commit).
   `adopt_visual_selection` validates ids against those rows: 409
   `INVALID_VISUAL_ASSET` for every new-seam run. 文案 already had the
   package-native `adopt_harness_candidate` path; 图文 now shares it.
5. **视频 cannot be submitted on a trial workspace at all.**
   `apps/core/src/p1/execution-spine/submission-coordinator.ts`
   `productUsageUnits` reserves `durationSeconds` units of the `video`
   resource. Every other reader counts 成片 — `entitlement-module.ts` grants
   trial 1 / starter 5 / growth 20 / pro 60, and the Composer's own `usageCost`
   is 1 — so a 抖音成片 is refused `409 INSUFFICIENT_ENTITLEMENT` while the
   quota card shows no shortfall, because client and server priced the same run
   differently. **Not fixed here**: which unit is authoritative is a billing
   decision, not a gate decision.
6. **Reference-asset media execution is unwired.** With (5) patched locally as
   a probe (reverted), the video run submitted, streamed and restored, then
   died in media execution on 「Reference asset resolver is unavailable」
   (`reference-asset-dispatch-guard.ts:16`). `ModelSupplyApplicationService` is
   constructed without `referenceAssets` in both `apps/core/src/main.ts:614`
   and `apps/core/src/job-worker.ts:415`, though both files build the composite
   resolver for other callers. Any submission carrying a reference asset throws
   — and 抖音成片 always carries one, it leads with a 案例图. **Not fixed here**:
   core service wiring, outside this ticket.

(5) and (6) are why `video` is `test.fixme` rather than asserted-and-red: both
are named inline in the spec, and deleting that one call is the whole change
once they land.

### OI-76 — the composer submission segment, pinned

T46 reported complementary environment-level flakes in this same segment: on
main the click produced no POST and the wait burned 120s twice; on fe2 the same
spec never saw `composer-quote-line`. The gate now asserts
`composer-submit` is **enabled** before clicking, which is the single condition
under which the click can create anything (`submitDisabled` in `composer-home`
folds in the bound quote, upload readiness, quota and the frozen phase) — a
disabled HeroUI `PromptInput.Send` swallows the click silently, which is the
main-side symptom exactly. The quote-line wait went 30s → 60s. Restore② also
no longer races a run that finished before the reload landed.

### The shared three-modal journey — red on the first case

`ui-journey-three-modal.spec.ts` `copy:wechat_moments · desktop` failed at 1.6m
and the remaining seven cases were skipped (the describe is serial). This is the
closest sibling of the new required gate and shares its fixtures, so it was the
single most important number in this file.

**Root-caused, from the new gate's first locked run.** The M-04 gate walked
submit → 白话进度 → first token → mid-run refresh restore → the T08 双字段 body
assertions → Result Center in 20 seconds, then failed on the same step: the
shared fixture waited for `copy-adopt-action`, a control the copy worksurface
renders only while its local lifecycle is still `candidate`. A delivered run has
already left that state, so the wait could not resolve — while the shell was
showing 「采用此版本」 the whole time. The fixture now adopts through
`result-primary-action`, the canonical shell action the required assembly gate
already clicks, and `assertJourneyRestored` asserts 「交付」 after reload instead
of the absence of a control that is absent on an unadopted run too.

The three-modal spec has not been re-measured since that fix; it should be the
first thing the next locked sweep runs. Its `expectedActivations` for
`image_text` was 2 and is now 3 — the 图文 direction choice is a real merchant
click that no one had counted, because those cases had never run.

### Retired-workbench family — red before anything was touched

`uiux-upgrade-b-composer` (8) and `uiux-upgrade-b-results` (8) were already
recorded 0-passing in the T07 pre-change baseline
(`.scratch/t07-retire-1a-web/e2e-baseline-before.txt`), and the cause is
mechanical: `建立创作记录`, `快速起步预设`, `execute-tool-action`,
`workbench-result-hero` have **zero occurrences in `src`** — the Z1 cutover
removed the surface, and `z1-cutover-retirement.static.test.ts` asserts the
workbench files are physically absent. `uiux-upgrade-b-async` and the
reduced-motion case in `uiux-upgrade-b-i18n-motion` reach the product the same
way.

These were not re-measured in this sweep. They were demoted by this ticket
before chunk 7 ran, so a fresh run would report them skipped rather than red;
the T07 numbers plus the static fact above are the evidence, and re-running a
demoted spec would not add any.

### Other reds observed (not this ticket's subject, recorded for the owner)

| Spec | Case | Note |
|---|---|---|
| `pro-studio-engineering-tickets` | ticket 16 / 17-20 / 20-gate-4 | `提示词库` dialog and `建立创作记录` — the second is the retired workbench again |
| `pro-studio-entitlement` | fixture-signed webhook unlock | |
| `pro-studio-kernel-ui` | fixture generation | `生成任务已提交。` never appears |
| `pro-studio-security-boundaries` | foreign-workspace reject, identity switch | 2 of 3 |
| `product-asset-upload` | R2 + Core authorize | |
| `registration-redemption-chain` | redeem once / void / enter workbench | |
| `t33-asset-surfaces-reshell` | identity page D-117 three actions | `默认身份` badge missing |
| `t34-content-operations-reshell` | dual-theme / mobile viewport | |
| `uiux-creation-loop` | 6 of 8 cases | includes the two T34 leftovers this ticket annotated |
| entitlement allowance | `"copy": 5` diff in chunk 5 | one assertion expected a different allowance |

## Triage this ticket applied

- **Required**: `m04-browser-hard-gate.spec.ts` (new) joins
  `assembly-gate-required-journey` and `marketing-identity-flow` in
  `scripts/ci/run-pr-production-journey.sh`, the spec set of the
  `production-main-journey` job that the `required` aggregation depends on.
- **Demoted** (marked `M-04 DEMOTED` in place, held out of the required set by
  `src/lib/e2e-hard-gate-contract.test.ts`): `uiux-upgrade-b-composer`,
  `uiux-upgrade-b-results`, `uiux-upgrade-b-async`, the reduced-motion case in
  `uiux-upgrade-b-i18n-motion`, and the retired-ContentPackageDetail assertions
  in `uiux-creation-loop` / `uiux-upgrade-b-video`.
- **Repaired**: `catalog-live-navigation` (native radios do not carry
  `aria-checked`), `p0-golden-journey` (the in-product doorway to the handoff
  page, which T34 dropped), and the four retired-command listeners.

## Gaps this file does not close

- Chunks 1–3 and 7–8 have no measurement at this commit. The specs in them are
  not claimed green or red here.
- The `ui-journey-three-modal` failure has no captured error body.
- The demoted family was not re-measured; see the reasoning above.
- **视频 has never completed a browser journey in this lane.** Walls (5) and (6)
  above are the first two; whether more sit behind them is unmeasured, because
  the probe that lifted (5) stopped at (6).
- `video-native-compiler.spec.ts` and `video-result-live-commands.spec.ts` sit
  in the never-run chunks 7–8 and submit video the same way, so wall (5) very
  likely reds them too. Not measured — stated as an inference, not a result.
