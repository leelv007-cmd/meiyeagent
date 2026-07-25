# T22 deferred policy findings

Status: evidence registered for follow-up OI ownership; not implemented or closed by T22.

## T22 verification receipt

- Red commit `d2097a5b`: the focused suite reported 165 tests, 153 passed, and 12 expected failures covering vocabulary, numeric grounding, legitimate-copy false positives, closeout evidence, burned-in text, approval authorization, and edit/variant/export bypasses.
- Green focused policy/production/approval suite: 96/96 passed.
- Green PostgreSQL closeout suite: 7/7 passed against the lane database.
- `pnpm eval:redlines`: 9/9 passed.
- `pnpm eval:redlines:promptfoo /tmp/t22-redlines-rework-promptfoo.json`: 21/21 passed.
- `pnpm --filter @meiye/core typecheck`: passed.
- `pnpm test`: passed with exit code 0.
- Reviewer probes: extraction 17 blocked/3 passed; grounding 9 blocked/1 confirmed-price pass; legitimate confirmed promotion passed.

## P2-2 — media delivery omits asset policy references

- Evidence: `apps/core/src/p1/harness/unified-media-stage-ports.ts` calls the shared visible-delivery validator with `assetRefs: []` and no expression identity reference.
- Consequence: the media closeout call cannot exercise `subject_asset_rights` or `expression_identity` against the generated asset through this input.
- Boundary: T22 adds image `exactText` to visible-copy extraction only. Supplying canonical media asset and identity references requires the media-delivery owner.

## P2-4 — closeout freshness references are structurally current

- Evidence: `apps/core/src/p1/operations/content-package-delivery.ts` and `apps/core/src/p1/harness/production-context-port.ts` project frozen fact source references with `status: 'current'`.
- Consequence: `price_benefit_freshness` cannot observe an expired or withdrawn source from those projections alone.
- Boundary: T22 keeps model-reported claims disconnected and does not redesign fact-revision freshness. A follow-up owner must supply authoritative source status without restoring model self-report as policy truth.
