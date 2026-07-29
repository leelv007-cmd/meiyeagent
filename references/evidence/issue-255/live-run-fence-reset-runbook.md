# Issue 255 Live-Run Fence Reset

This procedure is the only approved recovery path for an Issue 255 live-run
owner that was claimed during a concurrent or interrupted startup. It does not
authorize live execution.

## Stop conditions

Keep live disabled and stop immediately if any of the following durable facts
exist:

- any row in `issue255_live_generation_authorizations`;
- any receipt with `generation_submit_count = 1`, a non-claimed status, or a
  positive provider HTTP count;
- any Issue 255 workspace `ProviderCost` event;
- an accepted or acceptance-unknown provider effect that still requires
  reconciliation.

Those facts mean a billable boundary may have been crossed. Preserve the
database and pending manifest, run the existing Issue 255 reconciliation path,
and request a new controller decision. Never reset them to obtain another
three-generation allowance.

## Safe reset predicate

The controller must perform a read-only inspection through an environment-only
database launcher. The connection must not appear in argv or logs. Reset is
safe only when all of these are true:

1. every Issue 255 collector process is stopped;
2. the singleton run-owner row is the only Issue 255 live-run durable fact;
3. authorization count is zero;
4. submitted or non-claimed receipt count is zero;
5. Issue 255 workspace provider-cost count is zero.

If any predicate is unknown, treat the reset as unsafe.

The only approved entrypoint is the digest-pinned launcher at
`/Users/bin/.codex/monitors/issue-255-safe-provision.mjs`. Its SHA-256 is
`3d3fcedc4b435106189b0d1b2809c6e98311f9aead1fb93fb63e89299badf5c3`;
it refuses to load the versioned implementation unless that file has SHA-256
`44faea68c9bfdfb6d367b048880c4411ee1d4d4337bd82812d9b0eb1fcacb4df`.
The launcher executes the already-verified bytes directly; it does not reopen
the owner-writable implementation path after digest verification.
The collector and every database-mutating launcher mode also verify that the
current process descends from the repository-wide `e2e-lock.sh` owner. Direct
mutation without that shared lock is rejected, preventing a collector from
starting between the reset inspection and database deletion.
Before inspection or cleanup, the implementation validates both fixed database
names and their separation in one preflight; any invalid target refuses the
operation before either database can be dropped.
Inspect the five predicates without changing either database:

```sh
node /Users/bin/.codex/monitors/issue-255-safe-provision.mjs --inspect
```

The command emits only booleans and counts. Continue only when
`inspectionComplete`, `collectorStopped`, `ownerOnlyDurableFact`, and
`resetSafe` are all `true`; a missing table, unreachable database, or failed
process inspection keeps `resetSafe` false.

## Reset and reprovision

Do not delete receipt, authorization, or owner rows directly. Drop both
isolated databases only when the same launcher repeats the inspection and
accepts the state:

```sh
/Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/orca-run-2026-07-25/e2e-lock.sh \
  node /Users/bin/.codex/monitors/issue-255-safe-provision.mjs --cleanup-if-safe
```

Any false or unknown predicate refuses cleanup before either database is
dropped. The launcher has no unconditional cleanup mode. An accepted cleanup
must report residual count `0`, which verifies both isolated database names are
absent. Recreate both fresh, separate databases only through the same
provisioner:

```sh
/Users/bin/Desktop/开发/内容无人区/美业内容2/.scratch/orca-run-2026-07-25/e2e-lock.sh \
  node /Users/bin/.codex/monitors/issue-255-safe-provision.mjs
```

Before reprovision, remove only the zero-byte `.pending` manifest reserved by
the stopped collector and verify that its final manifest path does not exist.
A non-empty or unidentified pending file is evidence, not safe residue; preserve
it and stop for reconciliation.

After reprovision, keep every `RUN_LIVE_*` flag disabled. Re-run the Issue 255
PostgreSQL receipt and collector tests, record residual count `0` after the
test cleanup, and wait for an explicit controller live GO before any provider
probe.
