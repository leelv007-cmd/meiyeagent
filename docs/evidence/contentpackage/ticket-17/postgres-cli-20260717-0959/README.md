# Ticket 17 real PostgreSQL migration CLI evidence

This evidence records a successful, isolated run of the real ContentPackage migration CLI lifecycle against PostgreSQL and filesystem-backed historical video bytes.

## Verified on 2026-07-17

- The test creates an isolated workspace in the configured PostgreSQL database.
- It seeds one accepted legacy creative-content row and one completed historical-video row.
- The historical video references real bytes in a temporary filesystem asset store, with a verified SHA-256 digest.
- `inspect` reports exactly two expected ContentPackages.
- `dry-run`, `freeze`, `backfill`, and `activate` complete successfully.
- `freeze` only proceeds after the isolated restore verifier reports `backupVerified: true`.
- An arbitrary run cannot roll back the active migration.
- The current active run rolls back to `rolled_back`.
- Database rows and temporary filesystem bytes are removed after the test.

## Command

The local `.env` supplied the database URL without printing credentials:

```sh
set -a; source .env >/dev/null 2>&1; set +a
TEST_DATABASE_URL="$DATABASE_URL" pnpm --filter @meiye/core exec tsx --test src/p1/operations/content-package-migration-cli.postgres.test.ts
```

Result: 1 test passed, 0 failed, 0 skipped in 2.93 seconds.

## Remaining formal Ticket 17 evidence

This proves the real CLI, PostgreSQL, filesystem, restore-verification, active-run ownership, and rollback guards. It does not replace the still-open browser acceptance evidence for a real merchant account: pre/post package inventory, playable historical video, activation, creation of a new package after activation, and UI verification after rollback.
