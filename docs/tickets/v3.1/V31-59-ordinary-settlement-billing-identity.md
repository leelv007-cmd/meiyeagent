# V31-59 — Ordinary settlement billing identity when sourceTaskId absent

**Parent**: V31-57 / Wave-4 hold-expiry billing identity
**批次**: 收尾
**Blocked by**: 无
**Related**: V31-57 (hold-expiry path fixed with explicit `billingTaskId`)
**Status**: open（2026-08-11）— residual risk documented; not claimed fixed without product evidence

**Implementation state**: open
**Verification state**: evidence-debt
**Evidence SHA**: 
**Workflow Run**: 
**Artifact Digest**: 

## 症状与边界

`harnessBillingSettlementInput(request, workflowId)` only sets
`billingTaskId` when `request.sourceTaskId` is present:

```ts
taskId: workflowId,
...(request.sourceTaskId ? { billingTaskId: request.sourceTaskId } : {}),
```

Hold-expiry / reservation sweeper now persist and settle against an explicit
billing identity. **Ordinary DBOS settlement** (commit / fail-and-refund on the
happy and hard-fail paths) still falls back to `workflowId` as the ProductUsage
key when `sourceTaskId` is omitted.

Paths that omit `sourceTaskId` while ledger rows are keyed on another identity
remain a residual dual-axis risk (wrong refund / NOT_FOUND / silent miss).

## Evidence (2026-08-11)

- Hold-expiry identity split: `a1c76afc4` / merge `243002708`.
- Expiry handoff: `docs/handoff/v31-w4-expiry-billing-id-evidence-2026-08-11.md`
  open item still valid for **ordinary** settlement.
- Prepared Make (`composerPreparedAttemptId` + `sourceTaskId`) sets billing
  correctly on hold-expiry and cancellation paths covered by unit/PG suites.
- First-attempt runs where `attemptId === submission.task.id` intentionally omit
  `sourceTaskId` and bill under `workflowId === task.id` — **not** a bug when
  those ids are equal.

## Acceptance criteria

- [ ] Produce a product/repro case where ordinary settlement lacks
      `sourceTaskId` while ProductUsage is keyed elsewhere (or prove no such
      production path remains after V31 prepare/start).
- [ ] If repro exists: settle/refund/commit always bind billing identity the
      same way as hold-expiry (`billingTaskId` or fail-closed).
- [ ] Focused RED→GREEN unit/PG; no silent fallback that invents a second
      ledger row under the prepared workflow id.

## 本票不做什么

- Does not re-open V31-57 hold-expiry sweeper work already split.
- Does not merge rejected `1d62a2c70`.
