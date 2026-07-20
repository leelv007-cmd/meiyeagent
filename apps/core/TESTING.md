# Core Test Acceptance

`pnpm --filter @meiye/core test` without database environment variables is a
useful fast signal, but it is not persistence acceptance: PostgreSQL tests and
the production DBOS registration smoke skip when their test URLs are absent.

## Persistence environment

Persistence acceptance requires both variables below:

- `TEST_DATABASE_URL`: a disposable business PostgreSQL database. Apply the
  App Shell migrations from `mkfast-template-main/drizzle/` before running Core
  tests. Core workspace migration depends on the Better Auth `public.session`
  table created by that schema.
- `TEST_DBOS_SYSTEM_DATABASE_URL`: a separate disposable PostgreSQL database
  for DBOS system storage. It must not resolve to the business database.

Provision both databases and the App Shell schema from the repository root:

```bash
TEST_DATABASE_URL='postgres://user:password@127.0.0.1:5432/meiye_test' \
TEST_DBOS_SYSTEM_DATABASE_URL='postgres://user:password@127.0.0.1:5432/meiye_dbos_test' \
./scripts/ci/provision-test-db.sh
```

The PostgreSQL role in each URL must be able to connect to the target database.
When a target does not exist, it must also be allowed to create databases via
the cluster's `postgres` maintenance database. Set
`BUSINESS_POSTGRES_ADMIN_URL` or `DBOS_POSTGRES_ADMIN_URL` when database
creation requires different admin credentials. The script does not drop or
reset existing databases.

After provisioning, run the acceptance suite with the same variables:

```bash
TEST_DATABASE_URL='postgres://user:password@127.0.0.1:5432/meiye_test' \
TEST_DBOS_SYSTEM_DATABASE_URL='postgres://user:password@127.0.0.1:5432/meiye_dbos_test' \
pnpm --filter @meiye/core test
```

The CI persistence job additionally requires at most 26 skipped tests and a
passing result for the five-stage production DBOS registration smoke. This
prevents the 21 PostgreSQL cases and the DBOS smoke from silently returning to
their environment-gated skip path. When adding or removing environment-gated
tests, re-verify the 26-skip threshold against the current suite baselines.
