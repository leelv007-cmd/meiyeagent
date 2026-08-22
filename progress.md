# Full Remediation Progress

## 2026-08-19

- Active persistent goal confirmed.
- Loaded planning-with-files, TDD, and codebase-design instructions.
- Confirmed initial worktree only has the untracked review report.
- Read repository-level Agent instructions; isolated worktrees are mandatory for concurrent lanes.
- Created persistent implementation planning files.
- Read dispatch runbook, repository/Web instructions, PRODUCT/CONTEXT, ADR-0020, and report Wave 0/1 contracts.
- Locked concurrency/test discipline: isolated worktrees, maximum three infrastructure lanes, no default-port/shared-DB evidence.
- Created isolated worktrees for WF/DEV/CI/FE/DEL/FREE/PLAN/BILL/ADM lanes and installed frozen dependencies in the first eight code lanes.
- Install correction: the first admin install accidentally ran in main due to command working-directory scope; it refreshed ignored dependencies only. Admin worktree install and tracked-status verification remain.
- Corrected the admin install and verified main tracked files stayed unchanged; main dependency closure now matches the frozen Cloudflare lock.
- Began ADM-01 in the isolated admin worktree; public seams are Admin overview rendering and merchant-support credit evidence.
- ADM-01 red phase: canonical credit-detail support test fails against the current synthetic `entitlement.usage` implementation as expected. Panel test needs locale compilation before its behavioral red can be observed.
- ADM-01 green phase so far: 31 Web panel/model/support/language tests and 9 Core entitlement tests pass. Core/Web typecheck and diff review remain.
- ADM-01 Core typecheck passed. First Web typecheck exposed two local cleanup errors plus the expected clean-worktree content-collections generation prerequisite; fixes applied, build+typecheck rerun pending.
- ADM-01 Web build and Web typecheck now pass (pre-existing route/CSS/chunk warnings only). Targeted Biome has one import-format issue; locale check passes.
- DEV-01/02 lane completed with commits `4eee831d1` and `594fa7625`; 40/40 dev tests and root typecheck passed. DEV-03/30-minute soak remain.
- CI-01A/CI-02 lane completed at `c23b9c1c4`; 133/133 CI tests and 98/95 inventory validation passed. CI-01B remains after advisory calibration.
- WF-00 Agent lane completed with local commit `ff5c9691b`; pending main-agent cross-review and integration.
- ADM-01 committed in isolated worktree at `52bf5024d`; 31 Web behavior tests, 9 Core tests, Core/Web typecheck, Web build, locale check, Biome, and diff check pass.
- FE-01 completed at `8ca5b70a5`; pending cross-review and integration.
- PLAN-01A completed at `f341b4374`; focused/compatibility tests pass, while the full Core suite reproduced two unrelated existing DBOS wording expectations. Pending cross-review.
- Wave0 cross-review requested changes for WF-00 and CI-01A/CI-02; no main integration until their P1 findings are fixed.
- FREE-01 completed at `e1e810267`; 14 Core + 7 Web behavior tests and root typecheck pass. Browser/PG verification remains for integration.
- DEL-01 completed at `09294e7fa` + `c87f1008a`; focused Core/Web behavior tests pass, PG test is present but skipped without a lane DB, and DEL-SEC-01 remains deliberately unresolved.
- ADM-01 consumer correction committed at `cd6d334e1` after preserving active plan tier; final branch has two clean commits and all focused/type/build checks green.
- WF-00 approved commits integrated on main as `c4a2cba99` + `9a2a4fbdc`; authority consistency passes 5/5 on main.
- FE-01 and PLAN-01A reviewer follow-ups are APPROVE; ADM-01 full candidate is APPROVE. They remain held behind the Wave 0 runtime/evidence gate.
- Trust review required ADM support to show transaction evidence, not only a count. Added a red render test; first implementation had an import-placement error, now corrected for rerun.
- ADM transaction evidence render is now green (32 related Web tests); final third commit is `52fbc7d3d` and reviewer APPROVE covers all three ADM commits.
- CI-01A/CI-02 approved commits integrated on main as `67933a71b` + `cc8a4f48d` + `8cc9beff2`; 140/140 CI tests and 98/96 catalog validation pass on main.
- Real persistence calibration was paused before execution because the provision path still exposed PostgreSQL URLs in argv; a follow-up security fix is in progress.
- DEV, DEL, FREE, and BILL lanes are in reviewer-driven follow-up; no blocked candidate has been merged.
- Updated the remediation report's persistence inventory from 95 to the machine-derived 96 and documented the 90 Core / 6 Web split.
- FREE-01 final commits are reviewer APPROVE after server-owned fact authorization and complete result-adjust idempotency hashing.
- DEL-01 final five-commit candidate is reviewer APPROVE after exact manual-publish revision transition proof.
- BILL-01 three-commit candidate is reviewer APPROVE; real PG/Waffo/browser evidence remains explicitly outside its code approval.
- Created and installed an isolated `agent/wave0-integration` worktree from current main. It will combine the overlapping DEV and CI security changes before any main fast-forward.
- DEV follow-up reports all three remaining implementations are in place; final script/typecheck verification is running.
- DEV's final cleanup-race follow-up is assembled in `agent/wave0-integration` at `ffabdd3b3`; its standalone lane reports 205/205 scripts, 3/3 Playwright contracts, typecheck and Web check green, pending independent final review.
- The first real 96-suite persistence calibration reached 49/96, but the integration HEAD was then advanced from `98b269db3` to `ffabdd3b3`. The run was immediately interrupted and is invalid by construction; it will be rerun with a new database pair after the final HEAD is frozen.
- Deleted only the invalid run's exact uniquely named business/DBOS databases through env-only PostgreSQL process settings; a follow-up catalog query confirmed both names are absent.
- DEV final review reproduced a multi-contender stale-lock takeover race plus pre-signal Wrangler cleanup and recovery-path evidence gaps. The candidate remains blocked and was returned for another TDD follow-up; Wave 0 calibration stays paused.
- Wave 1 approved candidates were pre-assembled from current main in `agent/wave1-integration` at `bcda6733a` with zero conflicts and identical patch IDs. Focused evidence is 384 Core/contracts, 111 Web node, 54 Web interaction tests, plus contracts/Core/Web/journeys typechecks; PG/browser remain intentionally gated by Wave 0.
- DEV submitted fenced stale-lock follow-up `70bd4290f`: directory-lock takeover fencing, 30-process max concurrency=1, bounded empty/corrupt recovery, pre-handler signal cleanup, and production recovery stdin evidence. Lane reports 209/209 scripts and 3/3 Playwright contracts; independent final re-review is pending.
- DEV re-review kept the candidate blocked: crashed `.takeover` metadata could bypass deadline/backoff and spin, and legacy file-shaped locks could not migrate to the directory protocol. A new minimal TDD follow-up is in progress.
- Wave 1 combination review BLOCKED the preassembly despite 20/20 patch-id fidelity. Six P0s were split into independent TDD lanes: explicit Thread/handoff identity, free Session + snapshot authority fence, frozen billing settlement authority, and one-shot token consumption; Admin retired allowance/unknown evidence is a separate P1 lane. DEL recipient auth remains a deliberate product/security decision blocker.
- Wave 0 final integration advanced to `4de849ab3` after DEV APPROVE. Combined scripts 231/231, Playwright harness 3/3, and root typecheck/build passed.
- Real 96-file same-SHA persistence calibration provisioned a fresh business/DBOS pair and reached 49 passes, then hung >8 minutes in production media bounded continuation. Evidence shows DBOS PENDING, bounded question present, no bounded decision, and an idle polling event loop; the runner also lacks a per-file timeout. The exact process tree was interrupted with exit 130 and a dedicated diagnosis/TDD lane was opened. This run is failed evidence, not green.
- Persistence hang root cause confirmed on a fresh pair: the workflow reached bounded continuation, but the test asserted retired localized label `提高上限后继续` instead of stable option id `continue` (`继续完善`). The assertion then entered an unbounded graceful DBOS shutdown, masking the error. Fixes in progress: stable-id behavior, bounded failure cleanup, and instrument per-file timeout evidence.
- Persistence fix candidate `44a1fd382` + `671bcf77a` now provides a 5-minute default bounded per-file process-group timeout with fail TAP/evidence, stable option-id resume, and cancel-before-shutdown cleanup. Instrument controls are 13/13 and a new full PG target pair is 2/2; independent review is pending. The original preserved diagnostic DB pair was then dropped by exact name and absence verified.
- FREE explicit allowlist follow-up `2b7aa2080` adds an opt-in store-fact selector, carries only selected current refs through server authorization into Session retrieval, keeps default free at zero, intersects adapter output again, and clears selection after submission; focused Core/Web/type evidence is green.
- Persistence timeout review found three evidence-safety gaps (stubborn descendants, duplicate TAP header, decoded credential fragments). Follow-up `ef5e9bd66` adds PGID liveness-enforced SIGKILL, rewrites a single valid timeout TAP, and redacts encoded/decoded username/password/database canaries; re-review pending.
- Wave 1 second combination review still blocked: proof tables were incorrectly added to an already-applied 0027 migration; token-only infinite handoff cache could cross SPA identities; selected free facts did not clear on identity/mode changes. Each was returned to its owner for forward-only migration and identity-bound behavior fixes.
- Wave 0 bounded rerun at `fa922648d` executed all 96 files and correctly failed evidence on exactly two files: Issue-255 safe provision silently skipped 3 destructive cases because it needs an isolated fixed-name pair/lock, and Admin set-role failed while deleting audit-referenced users. Two independent PG TDD lanes are fixing these; 94 files were green, but the run remains failed.
- Wave 1 integration candidate reached `25be70fe5` and received final dual-axis APPROVE with zero findings. Quality gates 22/22, ownership 6/6, focused/type checks are green, and cataloged Playwright specs include FREE explicit facts and real UI A-logout→B handoff cache isolation. Real browser/PG remain gated; DEL-SEC still requires the user's auth-model choice.
- Admin PG cleanup fix `9cac46481` received independent APPROVE and is integrated into Wave 0 as `0ba6c6b9b`; it preserves last-admin/audit triggers, cleans random users/sessions, and uses a deterministic anchor only on admin-empty fresh databases.
- Issue-255 first isolated-gate candidate ran real 3/3 but review rejected its machine evidence because the per-file result falsely carried the main pair receipt while execution used the fixed destructive pair. The lane is adding a special provision receipt/pair binding and synchronizing V31-67 local authority; no green claim yet.
- Wave 0 is now fast-forwarded to main at `5e5f0aca6`: 241/241 control tests, root build/typechecks, Playwright harness 3/3, and a fresh same-SHA persistence run of 96 files / 414 tests / 0 fail / 0 skip. The Issue-255 special pair carries its own same-SHA self-drop receipt and has no fingerprint intersection with the main pair; both temporary pairs were removed after verification.
- Wave 1 is reviewer-approved at `25be70fe5` but needs a clean rebase onto the new Wave 0 main before it can be merged. Rebase/testing runs in a separate worktree.
- Wave 1 clean rebase reached `1fb63115d`, with root production build/typecheck green after a real client/server Commerce boundary repair. Final review then found a multi-membership handoff workspace-authority P0 and manual-publish OCC P1; Delivery lane owns both. ADM-02 startup catalog mutation is also active in a separate lane. Wave 1 remains unmerged pending these fixes and browser/PG acceptance.
- Wave 1 FE (`efc854771`), FREE/PLAN (`af8b28be3`), BILL (`ad2e13531`), DEL (`823939f26`), and ADM (`47632b787`) combination fixes are independently committed with focused green evidence; they remain unintegrated pending review and Wave 0.

## Evidence Log

| Check | Result |
|---|---|
| Goal status | active |
| Initial main status | ahead 25; review report untracked |
| Product-code changes this continuation | none yet |

## Next

Obtain DEV final approval, rerun combined Wave 0 checks, calibrate all 96 persistence suites on the immutable reviewed HEAD, then release approved Wave 1 candidates.
