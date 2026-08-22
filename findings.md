# Full Remediation Findings

## Baseline

- Active goal: complete all tasks in the 2026-08-19 remediation report.
- Branch: local `main`, 25 commits ahead of `meiyeagent/main` at task start.
- User-owned untracked authority report: `docs/reviews/agent-workflow-full-project-review-remediation-2026-08-19.md`.
- Repository requires isolated worktrees for concurrent Agent lanes.
- Current browser/runtime evidence from the report: Web 500 with dead workerd, Core healthy, installed Cloudflare closure stale versus lockfile.

## Implementation Principles

- Follow D-170 through D-178 and V3.1/A-I authority.
- Preserve `copy|note|media` product carrier semantics and explicit free-mode allowlists.
- Preserve historical/U14 compatibility until its data and in-flight gates are proven.
- Separate HarnessRelease from software deployment release.
- Keep fixture, recorded, live-provider, PG/DBOS, and browser evidence distinct.

## Current Wave 0/1 Lane Candidates

1. WF-00 — docs only.
2. DEV-01/02 — `scripts/dev`, runtime profile/state/supervision.
3. CI-01A/CI-02 — CI manifests/catalog/instrumentation.
4. FE-01 — AgentEventStore/reducer/workbench identity lifecycle.
5. DEL-01 — Workbench/Operations/ResultDelivery canonical handoff.
6. FREE-01 — Snapshot intent/brief/fact/delivery semantics.
7. PLAN-01A — compiled plan capability/version rejection.
8. BILL-01 — CommerceReadiness and Waffo price authority.
9. ADM-01 — Admin three-bucket/synthetic quota removal.

## Discoveries

- Repo concurrency rule: every mutating lane needs an isolated git worktree; lane agents never move `main`, push, or close tickets.
- At most three lanes may use PG/dev/Playwright infrastructure concurrently. Pure Node tests and typechecks do not consume an infrastructure slot.
- Local E2E requires lane-specific Web/Core ports and lane-specific business/E2E databases; default-port or shared-template greens are invalid evidence.
- New backend paths need production reachability and an observable exit, including a negative unauthorized inbound test for money/approval/resume paths.
- Source-regex tests are explicitly not acceptance evidence; deletion requires tracked-file/symbol plus consumer/data proof.
- D-178/ADR-0020 keeps AgentKernel free of durable checkpoints; async planning must persist Task/Run and rerun idempotently through the existing execution/runtime chain.
- Web instructions preserve `copy|note|media`, pure-copy exemption, Waffo/Credits single truth, and Pro Studio retirement.
- ADM-01 current shape: Admin Home's first panel still queries `entitlements.catalog`, filters for retired `allowance`, and renders copy/image/video bars; current credit plans therefore produce an empty panel while old three-bucket copy remains.
- `entitlements.projection` still synthesizes `usage` from the retired allowance seed and current credit balance. Merchant UI only reads `credits`, but Admin merchant-support is the sole active `usage` consumer and derives a false `ledgerConsistent` boolean from it.
- `entitlements.credit_detail` already provides the canonical merchant-safe batches/transactions projection. Support should display that evidence rather than infer health from synthetic quota math.
- WF-00 lane completed at `ff5c9691b`: non-destructive D-178/D-155 corrections, current contract summary, V3.1 U1–U14/review fixes, A–I historical metadata, and a 4-case authority consistency behavior test.
- ADM-01 implementation now returns only `{ credits }` from `entitlements.projection`; Admin merchant support reads `credit_detail` and projects active batch/transaction evidence; Admin Home shows an honest unwired credits overview instead of three-bucket allowances.
- ADM-01 consumer audit found the active plan tier is still required by a blocking browser journey. Final projection is `{ credits, plan }` with no retired `usage`; paid-tier behavior is pinned by a new Core test.
- FREE-01 lane `e1e810267`: default free Snapshot consumes zero implicit facts/identity; explicit merchant allowlist is intersected with frozen facts and inherited by `result_adjust`; rights/qualification remain intact.
- DEL-01 lane commits `09294e7fa` and `c87f1008a`: Workbench mobile handoff now creates the canonical assisted receipt token, and running→delivered preparation uses a revision/variant/phase key.
- FE-01 lane `8ca5b70a5`: single active identity tuple, full state reset, foreign late replay rejection, production auth/workspace/thread trigger; 56 Node + 14 interaction tests green.
- PLAN-01A lane `f341b4374`: current plans publish serial/retry-none/cache-none capabilities; compiler/admission/store/executor reject unsupported claims while legacy admitted v1 replay remains compatible.
- Wave0 review found WF-00 and CI-01A/CI-02 are not ready to merge: WF misses a stale D-088 body reference; CI fresh evidence is self-asserted, one opt-in file is omitted, and tier/owner defaults contradict existing required/RC ownership.
- CI reviewer fixes corrected inventory to 96 (90 Core required + 6 Web advisory), browser tiers to 10/26/62, actual fresh receipt issuance, and isolated v31-82 from RC. Main-agent pre-calibration review then found PostgreSQL URLs still crossed process argv; the CI lane is fixing this before any real run.
- The final 96-file calibration hang was a two-layer test/instrument defect: the production-media test asserted a retired localized label instead of stable option id `continue`; that assertion entered cleanup where graceful `DBOS.shutdown` waited forever on the pending workflow. The instrument also had no per-file timeout, so the original assertion was hidden behind an infinite run.
- DEV review blocked integration on PostgreSQL URLs in argv/state, incomplete descendant cleanup, source-text Miniflare proof, fresh-claim default mismatch, state owner races, and the wrong Web readiness endpoint.
- Journey review blocked DEL because the real delivered path already consumes Approval before Workbench prepare, and blocked FREE because the public request could self-authorize fact refs without a server-owned ledger grant.
- BILL review blocked checkout on asymmetric TOCTOU rereads, missing provider metadata/billing-period validation, unfrozen revision/price facts in bindings/webhook, and over-broad readiness external reads.
- CI canonical inventory is 96, not the report's earlier 95: 90 Core required persistence files and 6 Web advisory files. The report was corrected.
- DEL follow-up now preserves canonical revision after publish, but final review still requires exact revision-transition evidence so an old published event cannot authorize unrelated later edits.
