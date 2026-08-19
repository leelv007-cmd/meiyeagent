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

## Wave 0 per-file persistence instrument

CI-01A runs separately as the advisory `persistence-instrument` job. It uses a
fresh, isolated business/DBOS database pair on the checked-out SHA and invokes
every registered opt-in suite one file at a time. Its redacted artifacts contain
one TAP log and pass/fail/skip counts per file. A missing pair, pair mismatch,
zero-test file, failure, or skip makes the instrument red.

```sh
export RELEASE_COMMIT_SHA="$(git rev-parse HEAD)"
export TEST_DATABASE_URL=postgres://localhost/meiye_instrument_business
export TEST_DBOS_SYSTEM_DATABASE_URL=postgres://localhost/meiye_instrument_dbos
bash scripts/ci/run-persistence-evidence-instrument.sh
```

This is instrumentation only: `releaseVerdict` is `null`, the job is not in the
`required` aggregate, and it must not be promoted until CI-01B explicitly
calibrates the real runner.

The machine-readable journey catalog is validated in root quality:

```sh
node scripts/ci/journey-ownership-catalog.mjs validate
```

The catalog is inventory-closed over 98 Playwright files and 95 persistence
files. Every resolved entry declares owner, tier, environment, current decision,
skip policy, and artifact. Advisory and instrument entries also name a follow-up
ticket and never contribute to a release verdict.
