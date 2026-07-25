# T24 MinerU intake Core evidence

Date: 2026-07-26

## Scope conclusion

浏览器五步旅程挂账 T33，本票交付 Core 命令链与真机 PG 证据。

This ticket delivers the Core-only boundary:

- independently callable commands for synchronous parsing, asynchronous batch
  parsing, manual draft preparation, draft promotion, and the existing fact
  confirmation command;
- queryable durable batch progress that survives a service refresh;
- the immutable owned-source, parsed-document, and draft-revision layers, with
  the existing StoreFact ledger as the sole confirmed layer;
- a credential-free fixture provider and an official MinerU v4 adapter selected
  only when `MINERU_PARSE_MODE=official`;
- the finalized secret key name `MINERU_API_TOKEN`, without storing any secret
  value in the repository.

T33 owns the five-step browser presentation and in-conversation progress UI.
T05 remains the sole owner of paid `live_verified` MinerU evidence.

## Core command and query contract

Commands:

- `parse_single_asset`
- `parse_asset_batch`
- `prepare_manual_asset_draft`
- `promote_asset_draft`
- existing `confirm_asset_intake_fact`

Queries:

- `parse_task_view`
- `asset_draft_view`
- `asset_intake_experience`

The browser can therefore render each draft, confirmation, posting, and batch
progress step without adding another Core mutation path.

## PostgreSQL journey

Command:

```text
pnpm --filter @meiye/core test:postgres
```

Result:

```text
tests 2165
suites 107
pass 2155
fail 0
cancelled 0
skipped 10
todo 0
duration_ms 738769.860625
```

The ten skipped cases are explicit paid or externally provisioned live tests;
they are not part of T24's fixture/default DoD.

T24 journey evidence emitted by the run:

```text
Core PG journey promotes an unconfirmed parse draft and exposes only its
confirmed fact to ContextBundle
fact_visibility={"before":[],"after":[{"factId":"t24-offer-price","revision":1}],
"manualFallback":{"amount":299,"currency":"CNY"}}

Postgres persists immutable source, document and draft layers plus a recoverable
task projection
parse_layers={"sources":"1","documents":"1","drafts":"1","tasks":"1"}
```

This proves that the unconfirmed draft is absent from ContextBundle, the
merchant-confirmed correction is the only visible fact, and the three immutable
parse layers plus the mutable durable task projection persist in the real lane
database. The confirmed fourth layer is the existing StoreFact ledger and is
written only through `confirm_asset_intake_fact`.

## Focused contract and failure evidence

The final focused run covered 28 Core tests with zero failures, including:

- fixture synchronous parsing and the persisted source/document/draft layers;
- failure, timeout, and rate-limit fallbacks to the same manual schema;
- service-unavailable manual intake;
- late parse results retained for audit without overwriting the manual draft;
- asynchronous batch progress and refresh recovery;
- all four visual slots, generated descriptions, and a skippable non-blocking
  rights prompt;
- admin-config-backed five-step guidance;
- MinerU v4 request/polling, HTTP 429 classification, token redaction, and
  fixture-default assembly;
- draft promotion through the existing asset-intake batch and fact confirmation
  path.

The contracts package run passed 68 tests with zero failures. Final package
typechecks passed for both `@meiye/contracts` and `@meiye/core`.

## Repository baseline

Command, run after commits `457e9a87` and `89e15494`:

```text
pnpm test
```

Result: exit code `0`. All four workspace test commands and the root script
suite completed:

```text
@meiye/contracts: 68 passed, 0 failed
@meiye/web: 1258 passed, 0 failed
@meiye/core: 2155 passed, 10 explicit live skips, 0 failed
@meiye/canvas: 278 passed, 0 failed
root scripts: 99 passed, 1 explicit skip, 0 failed
```

Final static validation commands:

```text
pnpm --filter @meiye/contracts --filter @meiye/core typecheck
git diff --check
```

Each command completed with exit code `0`.
