# Day-0 Impeccable critique comparison

## Score history

| Assessment | Snapshot | Score | P0 | P1 | P2 | Method |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Historical product baseline | `.impeccable/critique/2026-07-18T15-57-52Z__mkfast-template-main-src-product.md` | 30/40 | 0 | 3 | Not normalized in that snapshot | Dual isolated A/B review |
| Fold implementation before critique fixes | `.impeccable/critique/2026-07-19T10-35-45Z__te-main-src-product-unified-creation-workbench-tsx.md` | 23/40 | 0 | 7 | 2 | Isolated Nielsen review plus deterministic and live browser inspection |
| Final post-fix implementation | `.impeccable/critique/2026-07-19T11-17-58Z__te-main-src-product-unified-creation-workbench-tsx.md` | 34/40 | 0 | 0 | 2 | Isolated Nielsen review plus deterministic evidence review |

The final score is **+11** over the immediate pre-fix assessment and **+4**
over the broader historical product baseline. The score comparison is not a
claim that the three assessments covered identical page sets; the immediate
23→34 comparison is the release-fix signal.

## Before and after station mapping

| Station | Before | After | Verified change |
| --- | --- | --- | --- |
| 01 Register | `before/01-register.png` | `after/01-register.png` | Same route and framing preserve the entry baseline. |
| 02 Empty dashboard | `before/02-dashboard-empty.png` | `after/02-dashboard-empty.png` | Fresh workspace opens the usable Day-0 shell without a provisioning hard error. |
| 03 Store facts | `before/03-seed-store.png` | `after/03-seed-store.png` | Confirmed store facts remain on the same composer axis. |
| 04 Inline authorization | `before/04-inline-authorize.png` | `after/04-inline-authorize.png` | Legacy multi-field authorization is replaced by the one-question path; the after capture records the authorized result. |
| 05 Create and stream | `before/05-create-stream.png` | `after/05-create-stream.png` | Creation starts from the folded composer and reaches the Harness stream. |
| 06 First usable draft | `before/06-first-token.png` | `after/06-first-token.png` | The after path requires the real `data-has-token=true` marker. |
| 07 Assets | `before/07-assets.png` | `after/07-assets.png` | Asset capture copy now sits on a readable porcelain surface. |
| 08 Mobile dashboard | `before/08-mobile-dashboard.png` | `after/08-mobile-dashboard.png` | Mobile heading contrast and all three persisted candidates are visible. |

Station 04 intentionally represents different interaction depth: the baseline
script pauses on the old multi-field authorization form, while the final script
captures immediately after the one-click authorization completes. Stations 05
and 06 can look nearly identical with the fast fixture because the first token
arrives close to the two-second stream capture; the hard token assertion, not
visual frame difference, is authoritative.

## Resolved findings

- Bounded automatic workspace preparation replaces the first-login hard error.
- The missing-question callback is stable; a healthy browser login, four-second
  settle, adoption, and switch emitted zero console and update-depth errors.
- Desktop and mobile project all three persisted candidates.
- Single-image authorization uses one column, wrapped actions, and ≥44px touch
  targets.
- Asset and mobile headings have stable readable surfaces.
- Merchant UI removes Harness, revision, direct-mode, and troubleshooting terms.
- Adoption can be changed through current-revision OCC against the frozen
  candidate set. The Core appends an immutable version, remains idempotent, and
  never publishes.
- Persisted result candidates no longer create a Card inside the result Card.

`mobile-candidate-switch.png` records the final 390×844 state after candidate
one was adopted and candidate two replaced it (`first=false`, `second=true`).

## Remaining limitations

- The first composer still presents content type, scenes, five marketing goals,
  and suggestions together. This remains a P2 distillation opportunity.
- The stock beauty hero and repeated porcelain surfaces still carry some
  contemporary AI-product template character. Real store imagery could take
  over more of the shell after the first upload.
- Visual readability does not prove every device, font scale, or translated
  string length. The deterministic browser assertions cover the release path.

## A/B synthesis

Assessment A scored the final experience 34/40 and kept the two product-level
P2 opportunities above. Assessment B's exact detector returned `[]` with exit
0 and found no deterministic P0/P1/P2 regression in the final supplied runtime
evidence. The apparent difference is scope, not a factual dispute: A judges
cognitive load and product character, while B only promotes deterministic
violations. Both agree that all seven release-blocking P1 findings are fixed.

## Acceptance and privacy boundary

- Final real Web → Core → Harness/DBOS gate: 5/5.
- Screenshot evidence: 8 before + 8 after non-empty PNGs, plus the mobile
  reselection state.
- Metric payload remains limited to `path`, `userActivationCount`, and
  `timeToFirstUsableDraftMs`. Raw intent, identity, assets, and credentials are
  excluded from the strict schema and Langfuse payload.
