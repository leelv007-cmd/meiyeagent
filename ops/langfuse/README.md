# Self-hosted Langfuse

This compose project runs the pinned Langfuse web and worker images with the
four required stateful services: PostgreSQL 17, ClickHouse, Redis, and
S3-compatible MinIO. It is intentionally separate from the application's
business PostgreSQL database.

## Configure

```sh
cd ops/langfuse
cp .env.example .env
```

Fill every empty secret before rendering or starting the stack. At minimum,
generate independent values for `POSTGRES_PASSWORD`, `CLICKHOUSE_PASSWORD`,
`REDIS_AUTH`, `MINIO_ROOT_PASSWORD`, `NEXTAUTH_SECRET`, and `SALT`. Generate the
64-character encryption key with:

```sh
openssl rand -hex 32
```

Put that result in `ENCRYPTION_KEY`. Do not commit `.env`. Passwords embedded in
`DATABASE_URL` must be URL-safe; percent-encode reserved URL characters.

The optional `LANGFUSE_INIT_*` group can create the initial organization,
project, and user on first startup. If it is left empty, complete setup in the
web UI and copy the resulting project public and secret keys into the core
service's `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` variables.

## Validate and start

Validate interpolation and compose syntax before pulling images:

```sh
docker compose --env-file .env -f compose.yaml config --quiet
```

Then start the stack on a Docker-capable host:

```sh
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml ps
```

Langfuse is ready only after both probes succeed:

```sh
curl -fsS http://localhost:3000/api/public/health
curl -fsS http://localhost:3000/api/public/ready
```

Publish the versioned Harness prompt catalog after the stack is healthy. The
command creates a new Langfuse version for each real registered consumer and
assigns `LANGFUSE_PROMPT_LABEL` (default `production`):

```sh
LANGFUSE_BASE_URL=http://localhost:3000 \
LANGFUSE_PUBLIC_KEY=... LANGFUSE_SECRET_KEY=... \
pnpm --filter @meiye/core langfuse:prompts:push
```

Use `--dry-run` to inspect the catalog without sending credentials. For stable
replays, set `LANGFUSE_PROMPT_VERSIONS` in the core environment to a JSON map
of prompt keys to version numbers. Admission then fetches those versions and
persists each returned version, label, source, and content hash in the durable
task request. If Langfuse is unavailable, fixture runs remain green but emit an
explicit downgrade warning and record the builtin version in the audit trace.

The prompt catalog contains 20 registered sites: the original 14 core consumers
(intent naming, copy/image/video brief compilation, fact satisfaction/criticality,
copy candidate generation, the three NotePlan nodes, destination mapping, copy
generation, platform adaptation, and text response) plus 6 XHS vertical beauty
assets (`harness/xhs-outline|content|note-gen|image-prompt|cover-prompt|style-analysis`,
issue #315). `execution-selection.ts` remains outside this lane; its existing
consumer is listed for follow-up rather than being replaced with a fake call.
Strict deploys must pin all 20 keys in `LANGFUSE_PROMPT_VERSIONS`.

The metrics exporter upserts deterministic items into the dataset named
`harness-structured-node-metrics`. Create that dataset once in Langfuse before
enabling delivery. Until it exists, dataset delivery fails into the existing
retryable outbox path rather than acknowledging a partial export.

The same authenticated Harness trace also receives the V1 product scores
`product.confirmation_precision` and
`product.time_to_first_usable_draft` from the durable
`first_usable_draft_observed` audit event. Conflict paths are excluded from the
precision score but retain their time-to-first-draft measurement.

## Audit authority and retention

Langfuse ClickHouse stores observability data only. ClickHouse TTL or complete
Langfuse loss must not change the business audit fact. Authoritative audit
queries continue to use the application business PostgreSQL table:
`harness_runtime.audit_events`. They never query this compose project's
PostgreSQL, ClickHouse, or `harness_runtime.langfuse_outbox` delivery state.

An operator can verify the durable fact against the application's business
database independently of this stack:

```sql
select id, workflow_id, stage, event_type, payload, created_at
from harness_runtime.audit_events
where workflow_id = :workflow_id
order by created_at;
```

To stop without deleting volumes:

```sh
docker compose --env-file .env -f compose.yaml down
```
