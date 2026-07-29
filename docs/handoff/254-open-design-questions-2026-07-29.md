# #254 Open Design Questions

Status: pre-implementation draft only. None of the options below is an
approved product contract.

Authority cutoff: the `主控裁决` comment created at
`2026-07-29T09:37:30Z`. The earlier comment labeled `主控合同增补` is invalid
and is not used as authority.

Implementation remains blocked until #259 has a valid SHA row in
`docs/ops/merge-ledger.md` and its base semantics are present on `main`.

## 1. Cross-workspace dependency visibility

The issue requires reverse-dependency checks and a cross-workspace
`hiddenCount`, but the storage and legacy-data behavior are not yet decided.

### Option A: scoped edges, filtered at query time

Store the existing consumer's workspace scope on each dependency edge. Return
details for edges visible to the viewer and aggregate other scoped edges into
`hiddenCount`.

Advantages:

- Directly supports visible dependency details plus `hiddenCount`.
- Keeps the catalog global, matching #259's current boundary.
- Preserves enough information for audits and later policy changes.

Costs and risks:

- Every edge writer must supply trustworthy scope.
- Query, audit, and logging paths all need the same redaction boundary.
- Legacy edges without scope require an explicit migration or fail-closed
  behavior.

### Option B: precomputed visibility-safe aggregates

Store visible dependency facts separately from a per-target aggregate that
contains only counts, not cross-workspace identities.

Advantages:

- Reduces the chance that read paths accidentally expose identity fields.
- Can make repeated retirement checks inexpensive.

Costs and risks:

- Adds projection and invalidation complexity.
- Drift between raw edges and aggregates can produce incorrect blocking.
- Audit and repair tooling still needs a privileged source of truth.

### Option C: strict blocking without a cross-workspace count

Block retirement whenever any non-visible dependency exists, but do not return
`hiddenCount`.

Advantages:

- Smallest disclosure surface.
- Simplest safe fallback for unscoped legacy data.

Costs and risks:

- Does not satisfy the current ticket's `hiddenCount` acceptance.
- Gives operators little information to resolve a blocked retirement.

Decision needed:

- Choose the edge/projection authority.
- Define the viewer boundary.
- Choose migration, backfill, or fail-closed treatment for legacy edges without
  scope.

## 2. Published lifecycle versus traffic binding

The ticket rejects dual Published state, but #259's actual lifecycle and
deployment model must land before the exact relationship can be fixed.

### Option A: one lifecycle pointer plus independent traffic bindings

Keep one catalog-level Published revision pointer. Traffic bindings may
explicitly reference immutable revisions, while each request/run snapshots the
resolved exact revision.

Advantages:

- Maintains one Published lifecycle authority.
- Supports controlled rollout and rollback without mutating old revisions.
- In-flight runs remain deterministic.

Costs and risks:

- Publishing and traffic changes become separate operations that need ordering,
  CAS, and audit rules.
- Operator UI must explain why Published and currently routed traffic can
  differ.

### Option B: Published pointer is the only traffic source

All new traffic resolves through the single Published pointer; no independent
revision traffic binding exists.

Advantages:

- Smallest state model and clearest operator mental model.
- Publishing and routing cannot drift.

Costs and risks:

- Cannot express canary or pinned traffic without another mechanism.
- Rollout changes become lifecycle changes even when content is unchanged.
- May not fit #259's deployed binding contract after it lands.

### Option C: multiple Published revisions

Treat each traffic target as independently Published.

Advantages:

- Directly represents multi-revision traffic.

Costs and risks:

- Violates the ticket's explicit prohibition on dual Published state.
- Creates competing lifecycle authorities.

Decision needed:

- Confirm whether #259 exposes independent traffic bindings.
- Define CAS and audit ordering between publish and traffic operations.
- Define the exact snapshot point for a new request/run.

## 3. Unauthorized-field handling

The original ticket requires server-side stripping, while the latest valid
controller decision reopens stripping versus strict rejection until #259's
actual mutation contract is available.

### Option A: strip unauthorized fields and apply the allowed subset

Validate each field, remove unauthorized fields, apply allowed fields, and
return field-level validation results.

Advantages:

- Preserves valid operator changes in a mixed payload.
- Makes editable-slot declarations directly observable.

Costs and risks:

- Partial success can be missed by operators.
- Audit and response redaction must not echo protected values.
- Retries and CAS behavior are harder when only part of a request applies.

### Option B: reject the complete mutation

Any unauthorized field rejects the request before an apply step.

Advantages:

- Simplest atomic and security model.
- No silent partial application.
- Easier retry, CAS, and audit semantics.

Costs and risks:

- Discards valid changes because one field is invalid.
- Conflicts with the original ticket acceptance unless the controller formally
  replaces it.

### Option C: validate, preview, then explicitly confirm

The first phase returns allowed changes and stripped/rejected fields without
applying. A second explicit action confirms the validated subset.

Advantages:

- Avoids silent partial application.
- Preserves the possibility of applying allowed fields.
- Fits a durable approval flow if #259 provides the required command boundary.

Costs and risks:

- Adds a round trip and durable state.
- Requires expiry, idempotency, CAS, cancel, and resume rules.
- Must not be invented before #259 establishes the base mutation contract.

Decision needed:

- Choose atomic reject, partial apply, or explicit two-phase confirmation.
- Define `success`, `applied`, and validation-result semantics for CAS
  conflicts.
- Define audit redaction and the operator-visible warning requirement.

## Next checkpoint

Do not implement any option yet. Re-evaluate this draft after #259 appears in
the committed merge ledger, inspect #259's actual contracts on `main`, and ask
the controller to resolve only the choices that remain material.
