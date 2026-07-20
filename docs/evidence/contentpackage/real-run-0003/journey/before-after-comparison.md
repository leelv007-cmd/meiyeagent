# ContentPackage before / after comparison

This bundle preserves the historical baseline and binds each prior limitation
to current, redacted evidence. The historical sources remain unchanged; they
are not rewritten to make the result look cleaner.

| Before: frozen evidence | After: current evidence |
|---|---|
| `docs/evidence/p0-release-evidence.md:17` recorded **31 pass, 1 live-provider smoke skipped**. | `activation/activation-evidence.json` records real Seedream `image.generate` and `image.edit`; `activation/catalog-publication/evidence.json` records five passed same-workspace probes and the published catalog head. |
| `mkfast-template-main/playwright.config.ts:43-45` pins the regression harness to `APP_ENV=e2e` and `MODEL_EXECUTION_MODE=fixture`. | `journey/continuous-journey.webm` is a separate real-provider run: direct OpenAI-compatible LLM, Tuzi Seedream 4.5 media, real Postgres, and owned output bytes. Fixture regression remains a test guard and is not counted as product evidence. |
| `docs/reviews/doc-consistency-audit-2026-07-15.md:6,78` preserves the frozen **real journey count = 0 / ContentPackage not landed** snapshot. | `docs/evidence/contentpackage/README.md:3,34-41` records the accepted count **0 → 1** and the corrected fixed-model run without incrementing the same journey twice. |
| The prior evidence had no merchant-visible actual-model / charged-usage card. | `keyframes/kf9-result-card-model-usage.png` shows the real package detail with actual catalog model `llm-openai` and Product Usage `已结算 · 1`; provider-internal cost remains intentionally hidden. |

## Current completion facts

- One uncut merchant journey reaches a usable ContentPackage with two
  authorized source photos, one real generated owned image, and three distinct
  platform variants.
- The fixed media selection, frozen route, actual catalog model, deployment,
  provider model, and owned receipt agree; there is no cross-brand switch.
- `pnpm check` passed, including a 2,223-file secret scan with zero findings and
  both decision-ticket guards.
- The full Core, Web, Canvas, and repository suites passed 1,387 tests with
  zero failures (1,350 passed, 37 explicitly skipped); the opt-in PostgreSQL
  migration integration test also passed 1/1.

Ticket 22 remains administratively open because its gate ticket and blocked-by
ticket statuses are still open. That governance state does not erase the
completed real-run evidence and does not imply release approval.
