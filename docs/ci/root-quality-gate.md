# Root quality-gate runbook

Use Node 22 and pnpm 10.30.3 from a fresh checkout. The Web typecheck imports
generated Content Collections types, so build before typechecking.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm check
pnpm uiux:bundle-check
```

The bundle command reports `status: not-run` when the production Web build is
missing, and reports the measured gzip sizes when it ran. `pnpm check` includes
the per-package Biome checks, Secret Scan, and decision-ticket guard.

## PostgreSQL and DBOS persistence gate

Start the local PostgreSQL service, then run the Core suite with both distinct
database URLs. The final assertion rejects a green-looking run that skipped the
PostgreSQL or DBOS coverage.

```sh
docker compose up -d postgres
export TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_test
export TEST_DBOS_SYSTEM_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye_dbos_test
./scripts/ci/provision-test-db.sh
pnpm --filter @meiye/core test 2>&1 | tee core-persistence-test.log
node scripts/ci/assert-core-persistence-ran.mjs core-persistence-test.log
```

Failures are intentionally separated: provisioning reports environment/setup
problems, the test runner reports code failures, and the final assertion reports
coverage that was not executed.
