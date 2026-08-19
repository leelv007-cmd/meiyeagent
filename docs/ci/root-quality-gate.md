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
export PERSISTENCE_POSTGRES_ADMIN_URL=postgres://localhost/postgres
bash scripts/ci/run-persistence-evidence-instrument.sh
```

This is instrumentation only: `releaseVerdict` is `null`, the job is not in the
`required` aggregate, and it must not be promoted until CI-01B explicitly
calibrates the real runner.

The opt-in evidence guard is catalog-aware. It reports every stale active suite
with its `blocking`, `advisory`, or `instrument` decision, owner, and ticket.
Only stale `blocking` entries fail the merge-quality gate; advisory and
instrument results remain visible telemetry and do not become a release
verdict. This is not an allowlist: every selected file still requires a fresh
business/DBOS pair, the checked-out SHA, a non-zero TAP contribution, and zero
failures/skips.

For a frozen integration checkout, generate the exact selection files before
provisioning. Do not reuse a plan, receipt, or database pair from another SHA.

```sh
node scripts/uiux/opt-in-test-evidence-guard.mjs \
  --output output/ci/opt-in-evidence-guard.json \
  --selection-dir output/ci/persistence-selections

export RELEASE_COMMIT_SHA="$(git rev-parse HEAD)"
export PERSISTENCE_EVIDENCE_PATHS_FILE=output/ci/persistence-selections/blocking.json
export PERSISTENCE_POSTGRES_ADMIN_URL=postgres://localhost/postgres
export CI_EVIDENCE_DIR=output/ci/persistence-blocking
bash scripts/ci/run-persistence-evidence-instrument.sh

node scripts/ci/record-opt-in-persistence-evidence.mjs \
  --provision output/ci/persistence-blocking/provision.json \
  --results output/ci/persistence-blocking/results.json \
  --receipt docs/ops/persistence-calibrations/<commit>-<provision-id>.json
```

Run the advisory/instrument selection files separately when their owners need
fresh telemetry. The final command verifies the provision/results pair again,
hashes each already-redacted TAP artifact, and only then updates the matching
ledger entries plus a committed, URL-free receipt. It refuses a stale SHA,
unknown path, zero-test file, skip, failure, missing ledger record, or an
artifact outside the checkout.

The runner tags both fresh main-pair databases with the provision id and commit
before tests start. Its exit trap checks those exact owner markers, terminates
only their connections, drops only that pair, and verifies absence on both
success and failure. A cleanup error is itself a failing run; never substitute
a manual broad database cleanup for that failed proof.

The machine-readable journey catalog is validated in root quality:

```sh
node scripts/ci/journey-ownership-catalog.mjs validate
```

The catalog is inventory-closed over 98 Playwright files and 96 active canonical
persistence files. Every resolved entry declares owner, tier, environment,
current decision, skip policy, and artifact. Advisory and instrument entries
also name a follow-up ticket and never contribute to a release verdict.

Current ownership is explicit: browser inventory is 10 required, 26 advisory,
and 62 full-RC/local files; Core owns 90 persistence files in the required
`core-persistence` job, while six Web persistence files remain CI-01B advisory
candidates. Local-only success does not claim an artifact that no producer emits.

The full RC browser command is catalog-driven and currently selects 97 product
files. Instrument decisions never enter that list. V31-82 runs only through the
advisory `run-v31-instruments.sh` producer and writes its own uploaded log.
