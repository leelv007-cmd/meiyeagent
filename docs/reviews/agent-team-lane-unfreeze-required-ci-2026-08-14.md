# Unfreeze condition 3 — `Core quality / required` on the same SHA

- Date: 2026-08-14 (local host clock 2026-08-13T16:08:54Z at first probe)
- Investigator: unfreeze-condition investigator (read-mostly)
- Authority: `docs/ops/current-project-status.md` §1 / §3 item 1 (working-tree EXEC-00a text); `.github/workflows/core-quality.yml` job `required`; `scripts/ci/run-root-required-quality.sh`; `scripts/ci/assert-required-jobs.mjs`
- Verdict: **NOT green. Cannot become `Core quality / required` green from this working tree without a GitHub PR on a pushed SHA.** Local unit / typecheck logs are not that check.

Honesty: **verification ≠ release**. This note does not stitch `39ca4b39` or `2f2960e6` greens onto `0a693408`. Those SHAs are ancestors of HEAD; their CI / Chromium / PG evidence is not a same-SHA verdict.

No push. No PR created.

---

## 1. HEAD / dirty tree vs Integration SHA `0a693408`

Commands (repo root `/Users/bin/Desktop/开发/内容无人区/美业内容2`):

```text
git rev-parse HEAD
# 0a6934089a160a0f0cc3ffc084d42466d47140e2

git status -sb
# ## main...meiyeagent/main [ahead 90]
#  + 64 modified tracked files
#  + 11 untracked files
```

| Fact | Value |
|---|---|
| Local `HEAD` | `0a6934089a160a0f0cc3ffc084d42466d47140e2` |
| Tip subject | `docs: archive the V3.1 gate verdicts into docs/reviews so they survive the next run` (2026-08-13T21:45:43+08:00) |
| Equals task Integration SHA | **yes** (`git rev-parse HEAD` == `0a6934089a160a0f0cc3ffc084d42466d47140e2`) |
| Working tree | **dirty** — 64 modified, 11 untracked (`git status --porcelain` count 75) |
| Commits since Integration SHA | none (`0a693408..HEAD` empty) |
| Branch | `main` tracking `meiyeagent/main`, **ahead 90 / behind 0** |
| Remote `meiyeagent/main` | `093b1421acce3f07728568d981522988bd33ab48` (`docs(ops): re-verify the 7 env-gated suites…`) |
| `0a693408` on any remote-tracking branch | **no** (`git branch -r --contains HEAD` empty; `git ls-remote meiyeagent 0a693408…` empty) |
| GitHub commit / check-runs for `0a693408` | **422** `No commit found for SHA: 0a6934089a160a0f0cc3ffc084d42466d47140e2` |
| Ancestors (do not reuse as this SHA) | `093b1421` (remote main), `39ca4b39` (42 commits behind HEAD), `2f2960e6` (ancestor) |

**Committed** `docs/ops/current-project-status.md` at `HEAD` still names Integration SHA **`39ca4b39`**, candidate branch `codex/v31-final-integration-39ca4b39`, and a clean tree. The **dirty** copy (EXEC-00a) rewrites that table to `0a693408` and “尚未创建 PR”. Both cannot be treated as one document. This investigation uses `git rev-parse` + GitHub as machine truth; the dirty CURRENT is a local edit, not a pushed fact.

Dirty `scripts/ci/run-v31-browser-acceptance.sh` comments **out** `tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts` (D6). Committed catalog at `0a693408` still lists that spec. Spec file remains on disk. `scripts/ci/quality-gates.test.mjs` (unmodified) still requires it in the gate command list.

---

## 2. Open PR?

`gh auth status`: logged in as `leelv009` (active), scopes include `repo` + `workflow`.

`gh pr status` / `gh pr list --state open`:

| PR | Head | Head SHA | Base | Required? |
|---|---|---|---|---|
| **#3** [Codex/v31 final integration 39ca4b39](https://github.com/leelv009/meiyeagent/pull/3) | `codex/v31-final-integration-39ca4b39` | `39ca4b399361a9226848c71009d3d6500612ce2c` | `main` @ `093b1421` | **`required` FAILURE** (run [31636238475](https://github.com/leelv009/meiyeagent/actions/runs/31636238475), 2026-08-12) |
| current local `main` / `0a693408` | — | — | — | **no PR** |

PR #3 is the only open PR. It is **not** this Integration SHA. Its `required` rollup (do **not** copy onto `0a693408`):

- green: `redline-evals`, `core`, `session-quick-checks`, `production-dependency-audit`, `core-persistence`
- red: `root-quality`, `production-main-journey`, `p2-browser-acceptance`, `v31-browser-acceptance`, **`required`**
- skipped (not in `required` `needs`): `live-redteam`, `release-manifest`, `e2e`

Remote `main` last `Core quality` push ([31589105737](https://github.com/leelv009/meiyeagent/actions/runs/31589105737) on `093b1421`) also **`required` FAILURE** (`p2-browser-acceptance`, `v31-browser-acceptance`, `production-main-journey` red). That is remote main, not `0a693408`.

`gh run list --commit 0a6934089a160a0f0cc3ffc084d42466d47140e2`: **empty**.

---

## 3. What `required` actually requires

Branch protection (`gh api repos/leelv009/meiyeagent/branches/main/protection`):

- required context: **`Core quality / required`**
- `strict: true` (branch must be up to date with base)
- `enforce_admins: true`
- force push disabled

Workflow `.github/workflows/core-quality.yml` job `required`:

- `if: always()`
- `needs`: `redline-evals`, `core`, `session-quick-checks`, `root-quality`, `core-persistence`, `production-main-journey`, `p2-browser-acceptance`, `v31-browser-acceptance`, `production-dependency-audit`
- step: `node scripts/ci/assert-required-jobs.mjs` with `REQUIRED_*_RESULT` from `needs.*.result`
- any missing / non-`success` result → exit 1 (`skipped` and `cancelled` also fail)

Triggers that can produce that check: `pull_request` (opened/synchronize/reopened/labeled), `push` to `main`, `workflow_dispatch`. Pushing a non-`main` branch **does not** start this workflow unless a PR exists or someone dispatches it. `main` cannot be pushed through protection.

Not in `required`: `live-redteam`, `release-manifest`, `e2e` (opt-in / `workflow_dispatch` / `release-candidate` label).

### Job table and local honesty

| Job | What CI runs | Local-honest? |
|---|---|---|
| `redline-evals` | recorded `pnpm eval:redlines` / fact-satisfaction / copywriting / preference-memory + pinned promptfoo + expected-fail controls + artifacts | Runnable in principle (no live Volcengine). **Not run this session** — multi-eval + `pnpm dlx promptfoo@0.121.19`; a local pass would still not be the GitHub job. |
| `core` | `pnpm --filter @meiye/contracts typecheck`, `pnpm --filter @meiye/core typecheck`, `pnpm --filter @meiye/core test` (Node 22, ffmpeg) | Typecheck slice **run** (dirty tree). Full `core` test suite **not run** (unbounded vs this note). Local Node is **v24.9.0**, CI is **22**. |
| `session-quick-checks` | `quick-checks.test.ts` + `progressive-levels.test.ts`, concurrency 1 | **Run** (dirty tree). |
| `root-quality` | full history checkout; harness version; ticket index; `node --test scripts/ci/*.test.mjs`; **`bash scripts/ci/run-root-required-quality.sh`** (60 min) | Script is **not bounded**: root typecheck (includes **web build**), `pnpm build`, `pnpm test` (all workspaces + root script tests), `test:journeys`, web interaction, web check, root check, secret-scan, bundle-budget. **Not run.** Pre-steps partially run. |
| `core-persistence` | service `postgres:16`; `provision-test-db.sh`; `run-core-persistence.sh` (needs `TEST_DATABASE_URL` + `TEST_DBOS_SYSTEM_DATABASE_URL`) | **Skipped.** No `.env` test URLs. Host Postgres is up but is a leftover multi-DB cluster (`ci_baseline_*`, `issue247_*`, …), not the CI ephemeral pair. Running it would mutate that cluster and still not be the GitHub job. |
| `production-main-journey` | Postgres + Playwright Chromium + `run-pr-production-journey.sh` (assembly / M-04 / memory B2; 90 min; production-candidate env) | **Skipped.** Needs provisioned DBs, Vite/workerd stack, `RELEASE_COMMIT_SHA`. CI-shaped, not a local unit log. |
| `p2-browser-acceptance` | Postgres + Chromium + 6 fixture Playwright specs (120 min) | **Skipped.** Same stack. Playwright CLI is installed (1.61.0); that is not a gate run. |
| `v31-browser-acceptance` | Postgres + Chromium + day-0 fail-fast then remaining catalog (120 min) | **Skipped.** Committed catalog includes **V31-82**, whose spec is marked **KNOWN RED** in fixture mode (see §5). Dirty tree removes 82 from the shell only — and then **fails** `quality-gates.test.mjs` (see §4). |
| `production-dependency-audit` | `pnpm audit --prod --json` + `assert-production-audit.mjs` | **Run** (dirty tree). |
| `required` | reads `needs.*.result` only | **Cannot run as CI.** Local `assert-required-jobs.test.mjs` only proves the aggregator math. |

`run-root-required-quality.sh` gates: suite-owner-manifest, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:journeys`, web `test:interaction`, web `check`, root `check`, secret-scan, bundle-budget. A leftover `output/ci/root-required-quality/` dated **2026-08-12 03:09–03:30** (`required-gate-summary.log` lists failures) is **not** this SHA and is not reused.

---

## 4. Local subset actually run (dirty working tree — **not** SHA `0a693408`)

Evidence dir: `output/ci/unfreeze-required-2026-08-14/`  
Host: `Lee2deMacBook-Pro.local`, Node `v24.9.0`, pnpm `10.30.3`, HEAD `0a693408`, dirty=75.

| Slice | Exit | Capture |
|---|---|---|
| `node scripts/ci/assert-suite-owner-manifest.mjs` | 0 | `Suite owner manifest passed: {"suites":8,"commands":9,...}` |
| `node scripts/ci/assert-harness-release-version.mjs` | 0 | `HARNESS_DBOS_APPLICATION_VERSION is set and verified…` |
| `node scripts/ci/assert-v31-ticket-index.mjs` | 0 | warning `list-style Status` on V31-43, V31-44; `89 tickets, 89 README rows` |
| `node --test scripts/ci/assert-required-jobs.test.mjs` | 0 | 14/14 pass |
| `pnpm --filter @meiye/contracts typecheck` | 0 | `tsc --noEmit` |
| `pnpm --filter @meiye/core typecheck` | 0 | `tsc --noEmit` |
| session-quick-checks (CI command, dirty tree) | 0 | **24/24 pass**, 1.31s |
| `node --test scripts/ci/quality-gates.test.mjs` | **1** | **13 pass / 2 fail** (see below) |
| `pnpm audit --prod --json` + `assert-production-audit.mjs` | assert **0** (audit raw 1) | `critical=0 high=0 moderate=7 low=2 waived=0 unwaived=0` |

`quality-gates.test.mjs` failures (dirty tree only):

1. `the V3.1 browser gate runs every named §37.4 journey spec` — actual Playwright second invocation **omits** `v31-82-stalled-image-work-timeout.spec.ts`; the test catalog still expects it.
2. `the V3.1 browser gate fails closed when a journey spec is absent` — expected `missing 1 required spec`; got empty (catalog/script mismatch after commenting 82 out of the shell).

`every V3.1 spec in the repository is registered in the required gate` still **passed**, because the JS catalog in `quality-gates.test.mjs` still lists 82 and the spec file still exists.

Therefore: if this dirty tree were committed as-is, **`root-quality` would fail** on `node --test scripts/ci/*.test.mjs` before any browser ran. That is a local contract red, not a CI green.

Not claimed: web typecheck/build, `pnpm test`, journeys, persistence, any Playwright job, redline/promptfoo, or `required`.

---

## 5. Structural red on the **committed** Integration SHA (even if pushed clean)

At `0a693408` (no dirty overlay):

- `scripts/ci/run-v31-browser-acceptance.sh` **includes** `tests/e2e/specs/v31-82-stalled-image-work-timeout.spec.ts`.
- That spec documents **KNOWN RED** in fixture mode (lines 88–98): fixture cannot create a stall; after direction pick the image_text run completes; retrying greens off `alreadyTerminal` (a successful run). CI `MODEL_EXECUTION_MODE=fixture`.
- `required` needs `v31-browser-acceptance` == `success`. A known-red catalog entry means **`required` cannot go green on clean `0a693408`** until D6 is landed **with** matching `quality-gates.test.mjs` (and any TEST-CATALOG contract), or a real stall fixture exists.

Dirty D6 (comment-out only) is incomplete and currently **breaks** the catalog test. It is not a local substitute for a CI verdict.

Do not treat ancestor live-verify of V31-82 (`97f534d0` / ledger notes) as `v31-browser-acceptance` success on this SHA.

---

## 6. Can this working tree become `required`-green without a GitHub PR?

**No.**

1. `Core quality / required` is a GitHub Actions aggregation job. It only exists after the workflow runs on a **pushed** commit and all nine `needs` jobs report `success`.
2. `0a693408` **is not on GitHub**. There is no check-run, no status, no workflow run to turn green.
3. Unfreeze §3a item 1 is **候选分支 PR + same-SHA `Core quality / required` 绿**. Branch protection will not accept a local log, a `workflow_dispatch` on some other SHA, or a green on `#3` / `39ca4b39` / `2f2960e6`.
4. Pushing `main` directly is blocked (`enforce_admins` + required check). The only honest path is: commit a **single** candidate SHA → push a **non-main** branch → open PR → wait for `Core quality / required` on **that** head.
5. This working tree is not a SHA. Until it is committed, there is nothing for `required` to evaluate. After commit it will be a **new** SHA, not `0a693408`, unless the tree is reset to clean `0a693408` (which still has V31-82 in-catalog KNOWN RED).

A PR is the only way to satisfy unfreeze condition 3. This investigator **stops short of creating or pushing one**.

---

## 7. What would have to be true next (not done here)

To even *start* a same-SHA evaluation:

1. Decide the candidate tree: clean `0a693408` **or** a new commit that includes a **complete** D6 (shell + `quality-gates.test.mjs` + catalog docs), not a one-line comment-out.
2. Push that exact SHA on a branch that is not `main`.
3. Open a PR against `main` (not reuse #3’s `39ca4b39` head as if it were this SHA).
4. Wait for workflow `Core quality` job `required` on **that** head SHA.
5. Until that check is `success`, keep CURRENT release state: **pending required CI / PR, not release-ready**.

Local evidence from this session may be used only as “dirty-tree contract / typecheck / session-quick-checks / prod-audit assert”. It is not `Core quality / required`.
