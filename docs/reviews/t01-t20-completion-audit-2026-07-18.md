# T01-T20 actual completion audit (2026-07-18)

## Scope and authority

- Scope: the 2026-07-18 ticket pack from T01 through T20.
- T04 does not exist in the ticket pack, so the audited scope contains 19 tickets.
- Ticket bodies: `.scratch/tickets-full-feature-2026-07-18/.final-Txx.md`; the final `复审修订` section overrides conflicting earlier wording.
- Product authority: `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`, then `docs/specs/beauty-marketing-agent-full-feature-dev-spec.md`, then the ticket bodies.
- Issue mapping: `.scratch/tickets-full-feature-2026-07-18/issue-numbers.json`.

## Verdict

All 19 in-scope tickets are implemented in the repository and covered by contract, service, or UI tests. The five marketing entry categories are released together only after the shared `MarketingPackage` contract is present. T15-T19 were the remaining implementation gaps found during this audit and are now closed.

GitHub issue state is not used as completion evidence: issues #25-#42 and #45 were still marked open during the audit, while repository code, tests, build output, and the local end-to-end run provide the actual completion evidence.

## Requirement-by-requirement result

| Ticket | Issue | Result | Primary implementation and verification evidence |
| --- | ---: | --- | --- |
| T01 | #25 | Complete | `packages/contracts/src/harness.ts` and `harness.test.ts`: progress envelopes, questions, decisions, delivery references, intent, chips, and five workflow stages. |
| T02 | #26 | Complete | Production structured generation uses the current AI SDK output contract; repository scan finds no deprecated `generateObject` production call. Full typecheck and test suite pass. |
| T03 | #30 | Complete | ContentPackage aggregate revision/OCC fencing in contracts, operations, and Harness persistence; stale writers and full-revision conflicts have regression tests. |
| T05 | #31 | Complete | `structured-nodes.ts` and production stage ports implement intent declaration and immutable execution brief compilation through the structured model runner. |
| T06 | #32 | Complete | ContextBundle compiler, source revisions, active fact metadata, six dimensions, immutable hash, and Postgres persistence are covered by context and production-port tests. |
| T07 | #34 | Complete | Execution/ranking stage and hard policy gates are wired before provider execution; provider-zero-touch rejection tests pass. |
| T08 | #35 | Complete | DBOS workflow registration, event persistence, terminal failure handling, revision fencing, recovery, and HTTP/SSE public seams are implemented and tested. |
| T09 | #27 | Complete | Composed video workflow, provider proof, ffmpeg product rendering, custody, and ContentPackage adapter are implemented with unit and integration coverage. |
| T10 | #33 | Complete | Persisted workflow events, SSE endpoint, reconnect cursor, frontend stream hook, and polling fallback are present and tested. |
| T11 | #36 | Complete | Harness question card, task recovery, recommendation entry, chips, and automatic Harness launch are wired in the unified creation workbench and E2E specs. |
| T12 | #28 | Complete | Composer upload carries consent scope, rights evidence, and actionable local remediation; incomplete grounding is rejected before execution. |
| T13 | #37 | Complete | Assisted asset intake extracts candidates, previews understanding, supports correction, writes the fact ledger, and keeps example data isolated. |
| T14 | #29 | Complete | The UI shows one main recommendation and at most two optional alternatives; existing retry/adopt semantics remain intact. |
| T15 | #45 | Complete | Promotion policy consumes frozen current facts only, emits verified/unpriced offer contracts, blocks all numeric offers without authority, records offer and actionable CTA source refs, and approval freshness invalidates stale price facts. |
| T16 | #38 | Complete | Hot-topic opportunity cards require a user link/screenshot plus store-fact match, expire in 24 hours, never copy protected expression, and fall back to evergreen content. |
| T17 | #39 | Complete | Append-only brand/personal-IP identity assets, active/revoked/departed/operator-changed lifecycle, same-transaction identity source revision, execution preflight, neutral fallback, and merchant UI are implemented. |
| T18 | #40 | Complete | Light Composer reuses its existing renderer for four frozen material specs, deterministic fingerprints, numeric overflow evidence, persisted export receipts, and durable owned storage. |
| T19 | #41 | Complete | Thirteen quick-edit actions plus natural-language instruction create immutable derived revisions on the same package, preserve frozen fact/right refs, and expose exact history, comparison, undo, and rollback. |
| T20 | #42 | Complete | Approval/delivery contracts, capability-aware delivery, export/result ledger, evidence levels, and weekly review were already implemented; this audit adds live fact/identity freshness checks so changed prices or identities invalidate pending approval applicability. |

## Local runtime evidence

The complete stack was run against PostgreSQL with Core, Worker, Web, and Canvas active.

- Health: Core `GET /health` returned 200; Web returned 200; Canvas returned 307 to its canonical entry.
- Five categories: 项目 / 服务曝光、热点借势、品牌与个人 IP、促销团购转化、宣传物料 were simultaneously visible.
- Identity lifecycle: a brand identity was registered as V1 and `换运营` produced `operator_changed · V2`, removing it from the active set.
- Quick edit: all 13 actions were visible; `改品牌口吻` plus a natural-language instruction persisted V2 with the action, instruction, current-task scope, exact diff, and rollback controls in history.
- Promotional material: selecting `xiaohongshu_cover` exported an actual 1242×1660 PNG. The receipt recorded `light-composer-v1`, `cover_center`, safe-area values, 46,702 bytes, and SHA-256 `23b2b41a479d0979d4cb37c709f73b47e1cbc11c9ea5a4971ab200742f8dbacc`; the owned-storage file matched both byte count and hash.

Screenshots for this audit are stored in `/Users/bin/.codex/visualizations/2026/07/18/019f7361-d62b-7d11-81ab-d84456836fea/`.

## Verification commands

- `pnpm test` — pass.
- `pnpm build` — pass for contracts, Core, Web client/SSR, and Canvas.
- `pnpm typecheck` — pass.
- `pnpm --dir mkfast-template-main locale:check` — pass (3,534 keys).
- Biome check for every touched Web file — pass.
- `git diff --check` — pass.

The repository-wide `pnpm check` still reports pre-existing Biome failures in unrelated evidence scripts and `src/routes/prototype-marketing-home.tsx`. No unrelated file was changed as part of this ticket closure.

## Runtime caveat outside T01-T20

The checked-in `pnpm dev:live` command does not by itself survive the current local admin configuration: Core first needs an explicit recorded integration-secret mode, and the database-selected live BYOK adapter needs a model binding. The successful acceptance run used:

```sh
INTEGRATION_SECRET_STORE_MODE=recorded \
BYOK_MODEL_BINDINGS=e2e-placeholder=e2e-placeholder \
pnpm dev:live
```

This is a local startup/configuration defect, not an incomplete T01-T20 product contract.
