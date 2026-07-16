# P1 Job Runtime

`PgBossJobPort` is the production adapter for ticket 05. It owns one durable
queue and one dead-letter queue, maps the logical `(workspaceId, jobId)` to a
deterministic UUID, and keeps the original logical identity in the payload.

Production wiring:

1. Construct `PgBossJobPort.connect({ connection, queuePrefix })` once for the
   HTTP/job-worker process pair.
2. Construct `PostgresTracerJobRepository(pool, runtime)` and run `migrate()` at
   startup.
3. HTTP/Application Service calls `TracerJobApplicationService.submit()`. The
   tracer row and pg-boss job are inserted in the caller's Postgres transaction.
4. The independent process constructs `P1JobWorkerEntrypoint` with the runtime
   and product handlers, then calls `start()`; the composition root must bind
   that process to its worker script.
5. Read the visible outcome through `TracerJobApplicationService.get()` and
   queue health through `runtime.getMetrics()`.

The worker contract is intentionally split into short repository methods around
`TracerExternalEffect`. No repository transaction callback can contain the
external provider call. `acceptance_unknown` is persisted and the next attempt
uses `reconcile`; it never blindly re-submits. Accepted pending work creates a
deterministic deferred continuation without consuming the technical retry/DLQ
budget. Lease-token compare-and-set prevents a stale worker from overwriting a
newer terminal result.

`GraphileWorkerJobPort` is the comparison adapter behind the same basic
`JobPort`. `POSTGRES_JOB_RUNTIME_COMPARISON` records the concrete migration,
pool, cron, lease, retry/DLQ, cancellation, and observability differences for
the pinned versions.

Set `TEST_DATABASE_URL` to run the real Postgres integration suite. Without it,
the integration cases are explicitly skipped while the recorded adapter and
recovery contracts still run.
