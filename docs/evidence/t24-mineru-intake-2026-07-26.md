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
tests 2173
suites 107
pass 2163
fail 0
cancelled 0
skipped 10
todo 0
duration_ms 491073.23575
```

The ten skipped cases are explicit paid or externally provisioned live tests;
they are not part of T24's fixture/default DoD.

Retry audit: the first post-review full run reached `2162` passes but one
unrelated migration CLI test failed with PostgreSQL
`sorry, too many clients already`. That exact test then passed `1/1` in
isolation, and the complete command above passed on its second run. No
application assertion was weakened or skipped.

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

This verifies that the tested journey exposes no unconfirmed draft through
`referencedFactRevisions`, the merchant-confirmed correction is the only visible
fact, and the three immutable parse layers plus the mutable durable task
projection persist in the real lane database. The confirmed fourth layer is the
existing StoreFact ledger and is written only through
`confirm_asset_intake_fact`; the narrower assertion boundary is recorded below
as F2.

## Focused contract and failure evidence

The final focused run covered 33 Core tests with zero failures, including:

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

The contracts package run passed 70 tests with zero failures. Final package
typechecks passed for both `@meiye/contracts` and `@meiye/core`.

## Repository baseline

Command, run from the final remediation worktree:

```text
pnpm test
```

Result: exit code `0`. All four workspace test commands and the root script
suite completed:

```text
@meiye/contracts: 70 passed, 0 failed
@meiye/web: 1258 passed, 0 failed
@meiye/core: 2163 passed, 10 explicit live skips, 0 failed
@meiye/canvas: 278 passed, 0 failed
root scripts: 99 passed, 1 explicit skip, 0 failed
```

Final static validation commands:

```text
pnpm --filter @meiye/contracts --filter @meiye/core typecheck
git diff --check
```

Each command completed with exit code `0`.

## Adversarial review remediation

Focused validation command:

```text
pnpm --filter @meiye/contracts --filter @meiye/core typecheck
pnpm --filter @meiye/contracts exec tsx --test src/parse-service.test.ts
pnpm --filter @meiye/core exec tsx --test --test-concurrency=1 \
  src/p1/harness/merchant-delivery-language.test.ts \
  src/p1/operations/parse-service.test.ts \
  src/p1/operations/mineru-parse-provider.test.ts \
  src/p1/operations/postgres-parse-repository.test.ts \
  src/p1/operations/asset-memory-foundation-module.test.ts \
  src/p1/operations/parse-asset-memory.postgres.test.ts
```

Result: both typechecks passed; Contracts passed `4/4`; Core passed `33/33`
with zero skips and zero failures.

- **F3:** `asset_draft_view` now exposes `parser.kind`; the real-PG journey
  asserts `fixture`.
- **F4:** sensitive documents make zero provider calls and use merchant-safe
  policy copy stating that the document is not sent to an external service.
  The copy passes the merchant-language forbidden-term gate.
- **F6:** both memory and PostgreSQL carrier-failure tests make the effect throw
  `SOURCE_NOT_FOUND` while the merchant projection becomes `failed` with a
  manual-entry next step. PostgreSQL emitted
  `dead_carrier_projection={"status":"failed","completed":0}`.
- **F7:** fallback drafts use `origin:'fallback'`; a rate-limited fallback
  recovers as parsed revision 2, while an actual merchant-authored manual draft
  skips the provider on retry.
- **F13:** the exact production authorizer is now a tested class used by
  `main.ts`. Its positive test accepts matching workspace prefix, byte length,
  and SHA-256; its negative test rejects foreign prefixes, missing objects,
  length drift, and hash drift.
- **F11:** the ticket addition was reduced to the quoted coordinator ruling
  only; it no longer declares that T33 needs no backend work.

## Known boundaries from the adversarial review

The following P2 findings are registered against the reviewed
`e0ed3b3b...40bbc8e9` baseline. They do not block T24; file and line references
are the review's original references.

- **F1 — promotion source metadata is hard-coded.** Draft promotion writes
  `example:false` and `sourceWorkspaceId` rather than deriving them
  (`asset-memory-foundation-module.ts:153-155`). The production workspace
  prefix/size/hash authorization at `main.ts:769-777` remains the isolation
  backstop.
- **F2 — the negative ContextBundle assertion is narrower than the old evidence
  wording.** `production-context-port.ts:45-54` does not read parse tables, and
  the journey asserts only `referencedFactRevisions`; it does not independently
  assert that `dimensions.store_facts_assets` is empty.
- **F5 — the seven-redline eval dataset was not expanded.**
  `apps/core/src/evals/merchant-language/cases.ts` still has three cases; parse
  disclosure, progress, fallback, and rights copy are covered by unit tests but
  not that eval dataset.
- **F8 — task projection updates are last-writer-wins.**
  `postgres-parse-repository.ts:299-329` has no fencing token or monotonic
  progress guard, so overlapping expired leases could regress visible progress.
- **F9 — batch enqueue is not atomic with task creation.**
  `parse-service.ts:543-556` records the queued task before durable submission;
  a submit failure can leave it queued, and the existing-task path at
  `parse-service.ts:745-749` does not resubmit.
- **F10 — resumed fallback classification previously counted merchant manual
  drafts as system fallback** (`parse-service.ts:579-590`). The required F7
  origin split closes this specific misclassification by checking only
  `origin:'fallback'`; no separate P2 mechanism was added.
- **F12 — one PG assertion is structurally weak.**
  `parse-asset-memory.postgres.test.ts:116` checks
  `fields.every(status==='unconfirmed')`, which follows from the schema literal
  and is vacuously true for an empty array.
- **F14 — worker authorization assembly is asymmetric.**
  `job-worker.ts:460` constructs ParseService with
  `isAuthorized:()=>false`; this relies on the API process having already
  persisted authorized sources and has no dedicated assembly test.
- **F15 — PG layer counts are single-row only.** All four counts are `1`; the
  current test does not detect duplicate rows in a multi-item batch.
- **F16 — scanned PDF OCR cannot be expressed.**
  `mineru-parse-provider.ts:71` enables `is_ocr` only for `document_image`;
  `PARSE_INPUT_KINDS` has no scanned-PDF member, despite
  `api-notes:45`.
- **F17 — the provider has no documented remote idempotency guarantee.**
  `mineru-parse-provider.ts:65` sends `x-idempotency-key`, which is not a
  documented MinerU header. Local `getDocument` deduplication begins only after
  successful persistence. The required F7 fix prevents recovered results from
  being discarded, but does not claim provider-side exactly-once execution.
