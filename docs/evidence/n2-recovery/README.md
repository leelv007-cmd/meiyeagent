# N2 Production Recovery evidence and runbook

Status: **partial — contract and local verifier only; production recovery has not passed**

This directory is the public, redacted evidence seam for N2. The checked-in
`manifest.json` intentionally fails closed because this workspace has no real
production PostgreSQL PITR source, object-version inventory, KMS/SecretRef
receipts, isolated restore, credential rotation, or failed-instance destruction
evidence. It must not be used to claim that Pro Studio is ready for public sale.

## Release rule

`release-evidence.json.n2Recovery.status` may become `passed` only after this
command exits `0` against a real, redacted production drill manifest:

```bash
pnpm n2:recovery:verify
```

The verifier never performs a restore. It reads only a manifest and typed,
hashed JSON artifacts under `docs/evidence/n2-recovery/`; it rejects paths
outside that tree, symbolic links, missing files, hash mismatches, untyped
content, and claims that do not reconcile with artifact contents. Root `.env` files and
`docs/_private/` remain gitignored and are not valid evidence paths. Store only
SecretRef/KMS references and redacted receipts here—never secret values.

## Production drill procedure

1. Name the Platform Ops owner, on-call owner, retention/deletion policy, source
   production environment, and a new isolated recovery environment. The recovery
   environment must have no production traffic and no write access to the source.
2. Declare positive RPO/RTO targets before the drill. Record canonical UTC
   `targetsDeclaredAt`, `incidentReferenceTime`, `recoveryPoint`, `startedAt`,
   and `verifiedAt` values in a typed, hashed drill receipt. Future timestamps
   and targets declared after `startedAt` fail closed.
   Observed RPO is `incidentReferenceTime - recoveryPoint`; observed RTO is
   `verifiedAt - startedAt`.
3. Identify the previous immutable production snapshot, schema revision, and
   object-version inventory. Bind their redacted receipt to the drill and retain
   it under the declared evidence policy.
4. Restore PostgreSQL with provider-supported PITR to exactly `recoveryPoint`.
   A logical dump, migration cutover, or existing ContentPackage cutover run is
   not PITR evidence. Save a typed redacted provider receipt with the production
   recovery provenance, provider/receipt identifiers, restore ID, WAL range,
   drill ID, environments, recovery point, and its SHA-256.
5. Produce the source object inventory at the same recovery point. Each inventory
   row must identify the immutable object key, version ID, byte length, and
   content SHA-256. Restore exactly those versions into the isolated environment,
   produce the restored inventory, and require equal counts and aggregate digests.
6. Restore the versioned database schema artifact and the exact configuration
   revision. Restore secrets only through KMS-backed SecretRefs; evidence records
   references and revisions, never values.
7. Through the recovered product/domain seams, export deterministic count and
   digest reports for all required invariants:

   - ContentPackage and immutable versions
   - GenerationJob and attempts/outcomes
   - Asset identity, custody, object version, rights, and provenance
   - product usage ledger
   - provider cost ledger
   - configuration revision

   Every source/restored pair must match. Missing/orphan objects, database/object
   time-point skew, schema incompatibility, unavailable keys, or ledger mismatch
   fails the drill.
8. Rotate restored credentials and prove the prior credential versions are
   rejected. The typed receipt must cover every restored SecretRef with distinct
   `secretversion://` old/new references, an in-drill rejection time, and
   `AUTHENTICATION_REJECTED`; do not capture credential material in logs or evidence.
9. Run a separate injected-failure path. Before any cutover, prove the failed
   isolated instance is destroyed and retain only a redacted destruction receipt.
   Typed scenario evidence must cover database/object time-point skew,
   missing/orphan objects, unavailable KMS keys, schema incompatibility, and a
   regional failure. Every scenario records the injected condition, expected and
   observed block, isolated instance ID, injection time, and destruction time;
   destruction must meet the declared deletion-hours policy.
10. Record the owner, `oncall://` reference, retention/deletion limits, quarterly
    cadence, regional-failure coverage, last drill, and next due time. Expired or
    over-quarter evidence fails closed; the typed, hashed policy receipt must
    match every manifest field.
11. Hash every redacted artifact with `shasum -a 256`, fill `manifest.json`, and
   run `pnpm n2:recovery:verify`. Only exit `0` permits an N2 release-gate review.

The existing ContentPackage cutover sequence may inform the order
“plan → isolate → verify → decide,” but its migration backup or rehearsal cannot
populate this manifest or satisfy N2.

## Failure action

Any verifier issue blocks cutover and public paid release. Preserve the current
production facts/read-only window, destroy the failed isolated instance, keep the
previous immutable snapshot/schema/object versions, correct the drill inputs, and
start a new isolated restore. Never repair the only legal production facts in
place to make a recovery report pass.

## Current blockers

- No real production PostgreSQL PITR backup/WAL and restore receipt.
- No production object-store version inventory and isolated restored inventory.
- No production schema/config revision or KMS/SecretRef restore receipt.
- No measured production RPO/RTO or recovered invariant reports.
- No previous immutable production baseline receipt tied to schema and object versions.
- No old-credential rejection evidence.
- No injected failure followed by isolated-instance destruction evidence.
- No typed negative-scenario report for the five required recovery failures.
- No named production owner/on-call and quarterly drill/retention policy evidence.
