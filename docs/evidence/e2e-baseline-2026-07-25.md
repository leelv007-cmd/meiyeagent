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
   *Correction (2026-08-05, #340):* the stall was the run parked on the D-164③
   execution-confirm card the journey never answered, not a budget the product
   cannot meet — with the confirm step added the same case passes in 15s
   inside the original 180s.
4. **T5 inline authorize** (`:539`) — no `[data-has-token="true"]` after the
   inline-authorized submit.

(1) and (4) are product-side. (1) this ticket did not chase — it is recorded
here so the next reader does not rediscover it. (4) it did: chasing the same
symptom on the new gate turned it into defect 1 below (`composer-home.tsx`,
`ae40876d`), so that red is a fixed bug, not an open question. (2) and (3) are
assertion-side and are exactly what the migration fixes: the new gate asserts
neither the legacy projection nor a video budget the product cannot meet.

## The new required gate, measured (2026-07-26, locked)

The required gate and both T23 waiver specs, run at commit `1467b5b5` — rebased
onto `main` after T23 and T46 merged — through
`.scratch/orca-run-2026-07-25/e2e-lock.sh`:

| Case | Result |
|---|---|
| `copy → wechat_moments` | **passed, 11.0s** |
| `image_text → xiaohongshu` | **passed, 59.3s** |
| `video → douyin` | **passed, 14.5s** |
| `video-native-compiler` (T23 waiver) | **passed, 16.4s** |
| `video-result-live-commands` (T23 waiver) | **passed, 20.7s** |

**5 passed**, one locked round at `1467b5b5`. Each case walks submit → 白话进度 → 首 token (copy) / 两种图文方向
(image_text) → 刷新恢复① → T08 双字段 body → Result Center → 采用 → 交付
(完整发布包) → 刷新恢复②, with the D-098 C6 activation budget asserted (copy 2,
image_text 3, video 3) and the D-111 neutral-identity check.

Getting there took eight product defects out of the way — the eighth has its own
section below, since it was found by the waiver spec rather than by the gate.
They are recorded here because each one was on the merchant's own Day-0 path and
none of them had a test that ran:

1. **An inline-authorized image could not be submitted** (`composer-home.tsx`,
   fixed in `ae40876d`). The submission gate reads `product.state`, which
   `useProductState` fetches once on mount; every inline asset write goes
   through the module-level `executeProductCommand`, which never updates it. So
   the card said 「素材信息已确认」 and the submit button said 「当前素材还未确认
   可用于宣传」 at the same time, and 图文/视频 — whose recipes require a source —
   could not start at all. This is also the unexplained day-0 red at
   `uiux-day0-contract.spec.ts:539`.
2. **图文 delivered to a dead Result Center** (`be6eb382`). `imageFacts` reads
   the legacy `creative_workbench` CreativeAssets, which the ContentPackage
   seam does not write, so the worksurface stayed on 「等待图片候选…」 while the
   status read 可发布.
3. **…with no 采用 action** (same commit). `hasUsableCandidate` counts those
   same rows, so the shell fell through to 「继续调整」.
4. **…and adoption that could not succeed** (same commit).
   `adopt_visual_selection` validates ids against those rows: 409
   `INVALID_VISUAL_ASSET` for every new-seam run. 文案 already had the
   package-native `adopt_harness_candidate` path; 图文 now shares it.
5. **视频 could not be submitted on a trial workspace at all** (`50ada0e0`,
   fixed under the coordinator's ruling of 2026-07-26).
   `apps/core/src/p1/execution-spine/submission-coordinator.ts`
   `productUsageUnits` reserved `durationSeconds` units of the `video`
   resource. Every other reader counts 成片 — `entitlement-module.ts` grants
   trial 1 / starter 5 / growth 20 / pro 60, and the Composer's own `usageCost`
   is 1 — so an 8-second 抖音成片 was billed eight videos and refused `409
   INSUFFICIENT_ENTITLEMENT`, while the quota card showed no shortfall because
   the two sides priced the same run in different units. Historical green came
   from admin second-level supply top-ups covering the gap; the coordinator
   ruled 成片 authoritative for merchant entitlement, with per-second accounting
   staying on the supply-side ledger. Pinned in the four-kind Composer HTTP
   journey, whose video case carries an 8-second deliverable.
6. **视频 adoption could not record its evidence** (`51b4f6ce`). Both video
   controls posted `adopt_visual_selection`, and a Harness package cannot
   become `accepted` without recording its adopted candidate
   (`content-package-semantic-mutation-policy.ts`) — `409
   HARNESS_ADOPTION_EVIDENCE_REQUIRED`, defect (4) one modality over.
7. **The video ZIP contract was the pre-T23 one** (`51b4f6ce`, test-side). The
   journey demanded `cover.jpg` and subtitles; T23 retired the composition
   chain, and a native single-call 成片 carries neither unless the export is
   handed one (`content-package-export-adapter.ts`, `nativeSingleCall`). The
   gate now requires the video and holds the archive to its own manifest.

**Resolved by the rebase, not by this ticket**: at the original baseline
(`7ea3de75`, before T23 merged as `fe6869b2`) the video run — with (5) patched
locally as a probe — died in media execution on 「Reference asset resolver is
unavailable」, because `ModelSupplyApplicationService` was built without
`referenceAssets` in both `main.ts` and `job-worker.ts`. T23 r2 wired it into
both. Recorded so the measurement history reads honestly: that wall was real on
the baseline commit and is gone on the current one.

### The canonical video run came unbound on its first edit

Found by realigning `video-result-live-commands.spec.ts` to the current seam,
which is the whole reason that seed is worth keeping.

**Symptom.** Seed a canonical video run on a Work, open Result Center, pick a
different shot candidate — the `video_workflow_edit` command succeeds — then
reload. The storyboard is gone. Not an error, not an empty state with a reason:
the page simply no longer knows the run exists. The same trap sits under any
retained historical work whose canonical run is edited once.

**Root cause.** Two owners write two different fields, and the read side knew
only one of them. `storedJob`
(`apps/core/src/p1/model-supply/video-workflow-canonical-postgres.ts`) persists
`videoWorkflowId` on every canonical write and never persists `providerJobId`;
`results_/$workId.tsx` bound the run through `providerJobId` alone. Because a
canonical write replaces the whole job payload, the first edit erased the only
field the page was looking at. Measured directly: after the edit the projection
returns that job with `providerJobId: null`, `hasContract: true`.

It held before the ContentPackage seam because the link lived on the
*originating* Job — written by the old creation path, never touched by the
canonical store. That seam writes no `p1_creative_jobs` row at all, so the only
job on a new-seam Work is the canonical one, and its owner does not write the
field the page wanted.

**The two candidate fixes, and why the read side.** Either the canonical store
starts persisting `providerJobId` (changing a write shape whose owner
deliberately excludes it), or the route reads the field that owner does write.
The coordinator ruled the read side, with a fallback chain: `videoWorkflowId`
when present, else the old `providerJobId` prefix test. That keeps historical
originating rows binding exactly as before, invents no field, and moves no
ownership — only the read learns which owner to ask.

**Pinned by** `video-result-live-commands.spec.ts`, whose seed now carries no
`providerJobId` at all: it plants only what the canonical store itself writes,
so the unbind cannot hide behind the seed again. Green at `1467b5b5` — 20.7s,
edit → reload → aria-pressed → server quote → confirm → derived task.

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
- Both T23 waiver specs are green (table above). `video-result-live-commands`
  needed its seed realigned to the seam first — it had anchored on "the
  originating Job", a row the ContentPackage seam does not write, and planted a
  Job with no `contract`, which took the Result page to its error boundary — and
  then surfaced the unbind recorded in its own section above.
