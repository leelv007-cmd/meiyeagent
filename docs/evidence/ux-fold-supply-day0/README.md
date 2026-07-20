# Day-0 / V1 acceptance evidence

Hard gate assertions live in Playwright — screenshots never replace them:

- Spec: `mkfast-template-main/tests/e2e/specs/uiux-day0-contract.spec.ts`
- Catalog: `mkfast-template-main/tests/e2e/TEST-CATALOG.md` § V1 Day-0

## Directory layout

```text
docs/evidence/ux-fold-supply-day0/
  before/          # pre-fold baseline screenshots (same stations)
  after/           # post-fold comparison screenshots
  tours/           # scripted tour runs (timestamped)
  mobile-candidate-switch.png # post-adoption mobile re-selection evidence
  README.md        # this file
  metrics.md       # Langfuse product-metric wiring and score contract
  validation.md    # exact real-chain commands, failures, and final green run
```

## Tour regression script

```sh
# Requires local Main + Core + Worker (same stack as Playwright e2e).
PLAYWRIGHT_BASE_URL=http://localhost:3000 \
DAY0_TOUR_LABEL=after \
node scripts/uiux/day0-tour-screenshots.mjs
```

Stations: register/login → seed store → composer inline authorize → create →
stream/first token → assets → mobile 390×844.

To capture a baseline before a fold change:

```sh
DAY0_TOUR_LABEL=before node scripts/uiux/day0-tour-screenshots.mjs
# copy or symlink into docs/evidence/ux-fold-supply-day0/before/
```

## Reproducible comparison

The checked-in `before/` station set was produced from a detached worktree at
`main@05e99eed7c0628537d405d16bcc1535a09ed3590`, using the same tour script and
1280×900 / 390×844 framing as the post-fold run. The baseline stack used
ports 3511/4511/4611; that revision predates the Harness DBOS runtime. Its
manifest records all eight station URLs and the exact generation timestamp.

The checked-in `after/` station set was produced from the implementation
worktree on the same machine at `2026-07-19T11:51:32.134Z`. Its persistent
capture stack used Web/Core ports `3371/4371`, the separate DBOS database
`meiye_after_4371_acceptance_v1`, and queue prefix
`meiye-p1-e2e-after-4371-acceptance-v1`; the tour does not enter Canvas. Both
manifests contain the same eight station names; all 16 PNG files are present
and non-empty.

`DAY0_TOUR_LABEL=before` preserves two baseline-only interaction differences
instead of hiding them: the old multi-field asset authorization is completed
through its real controls, and the old Brief confirmation plus separate
Generate action are exercised before the draft station. The post-fold path
does not use either compatibility branch and still hard-fails without a real
`[data-has-token="true"]` marker.

The final real-chain Playwright run passed all five V1 scenarios after the
Standards/Spec fixes. A separate healthy mobile browser run also verified three
persisted candidates, first adoption, second-candidate switching, no React
update-depth loop, and no internal workflow terminology. See `validation.md`
for the exact ports, command, and the earlier failures that were fixed before
the clean run.

## Metrics

See `metrics.md`. The authenticated first-token observation is written to the
Harness PostgreSQL audit/outbox and exported as Langfuse scores
`product.confirmation_precision` and
`product.time_to_first_usable_draft` on the same task trace.
