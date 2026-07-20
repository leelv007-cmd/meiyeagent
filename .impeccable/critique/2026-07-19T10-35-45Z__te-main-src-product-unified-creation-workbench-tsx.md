---
score: 23
score_max: 40
p0: 0
p1: 7
p2: 2
target: day0_workbench
timestamp: 2026-07-19T10-35-45Z
slug: te-main-src-product-unified-creation-workbench-tsx
---
# Impeccable critique: Day-0 workbench

Target: `mkfast-template-main/src/product/unified-creation-workbench.tsx`

Independent assessment A scored the post-fold experience 23/40 across the ten Nielsen heuristics. Independent assessment B ran the required static detector (`[]`, zero findings) and a fresh live browser session through upload, inline authorization, three-candidate generation, adoption, and iPhone 14 rendering.

## Actionable findings

- P1: workspace provisioning latency is rendered as a blocking hard error on the first dashboard instead of an automatically recovering preparation state.
- P1: `HarnessQuestionCard` can enter a stable React maximum-update-depth loop because the missing-question effect depends on an unstable parent callback.
- P1: desktop Harness candidates do not project into the mobile action/progress surfaces, so phone continuation cannot complete candidate adoption.
- P1: the single-image inline authorization card keeps a two-column grid and no-wrap horizontal actions, leaving a large blank region and overflowing the long authorization CTA.
- P1: mobile/action and asset headings use dark copy directly over dark ambient photography, producing unreliable contrast.
- P1: merchant UI exposes internal terms including Harness, revision, direct mode, and troubleshooting language.
- P1: after one candidate is adopted, every other candidate action is disabled and there is no switch or undo path.
- P2: the result surface nests candidate cards inside the outer result card, weakening hierarchy.
- P2: the first composer exposes too many simultaneous classification systems; preserve for later distillation after the release blockers.

## Strengths

- The one-sentence composer, real asset intake, and public-marketing attestation form a coherent Day-0 path.
- The result surface makes one recommendation primary and keeps alternatives discoverable.
- Streaming state, safe quota language, success feedback, and mobile relay establish useful product feedback loops.

## Persona risks

- First-time merchant: preparation errors and overlapping scene/goal choices undermine confidence before the first task.
- Experienced operator: irreversible adoption makes comparison and correction unnecessarily expensive.
- Mobile continuation user: low-contrast headings and missing Harness candidates break the most important continuation decision.
