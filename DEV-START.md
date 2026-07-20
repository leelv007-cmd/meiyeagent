# Dev start (one page)

## Prerequisites

- **Node.js ≥ 22** (`package.json` engines)
- **pnpm 10.30.3** (repo `packageManager`)
- **Docker** (local Postgres via Compose)
- Optional for persistence acceptance: `psql` on `PATH` (used by `scripts/ci/provision-test-db.sh`)

## 1. Postgres

```bash
docker compose up -d postgres
# Host port 54329 → container 5432
# User/password/db: meiye / meiye / meiye
# DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/meiye
```

Apply App Shell migrations when you need auth/session schema on the business DB:

```bash
pnpm --filter @meiye/web db:migrate:local
```

## 2. Env

`pnpm dev` loads **`.env.example` first**, then optional **`.env`** overrides.

- Fixture defaults in `.env.example` are for **local only** (`APP_ENV=e2e` + `MODEL_EXECUTION_MODE=fixture`).
- Weak placeholders (`change-me`, `better-auth-secret`, `local-*-service-token`, all-zero `INTEGRATION_SECRET_STORE_KEY`, …) are **refused outside** `APP_ENV=development|e2e|test` (or `NODE_ENV=test`). Replace them for production/staging; never commit real secrets.

## 3. Fixture path (default green loop)

```bash
pnpm dev
# Web :3000  Core :4100  Canvas :4200  + Core worker
```

- Full Work → Job → Asset/Content loop **without provider credentials**.
- `MODEL_EXECUTION_MODE=fixture` is hard-gated to `APP_ENV=e2e`.
- Recorded (non-executable models) path:

```bash
pnpm dev:recorded
# APP_ENV=development MODEL_EXECUTION_MODE=recorded
```

## 4. Provision test DBs (persistence acceptance)

Default `pnpm --filter @meiye/core test` **without** DB URLs is a fast signal only — PostgreSQL cases and DBOS registration smoke **skip**.

```bash
TEST_DATABASE_URL='postgres://meiye:meiye@127.0.0.1:54329/meiye_test' \
TEST_DBOS_SYSTEM_DATABASE_URL='postgres://meiye:meiye@127.0.0.1:54329/meiye_dbos_test' \
./scripts/ci/provision-test-db.sh
```

- Business test DB gets App Shell Drizzle migrations (Better Auth `public.session` required by Core workspace migration).
- **DBOS system DB must be a different database** than `TEST_DATABASE_URL` / `DATABASE_URL`.
- Then re-run Core tests with the same two URLs. Details: [`apps/core/TESTING.md`](apps/core/TESTING.md).

**Default green test ≠ persistence acceptance.**

## 5. Harness (optional five-stage production path)

Set `HARNESS_DBOS_SYSTEM_DATABASE_URL` to a **separate** Postgres database from `DATABASE_URL`. Enabling Harness also expects a live-verified direct model runtime; keep `DBOS__APPVERSION` sticky until in-flight workflows drain. See `.env.example` comments for pool/Langfuse knobs.

## 6. Live path caveats (t01–t20 audit)

`pnpm dev:live` alone is not enough against current local admin config. Successful local acceptance used:

```bash
INTEGRATION_SECRET_STORE_MODE=recorded \
BYOK_MODEL_BINDINGS=e2e-placeholder=e2e-placeholder \
pnpm dev:live
```

Live/direct model and media modes need real credentials, activation probes, and non-secret fingerprint fields documented in `.env.example` — configuration alone stays inactive until probes match.

## 7. Authority docs

| Doc | Role |
|-----|------|
| [`PRODUCT.md`](PRODUCT.md) | Product purpose, positioning, principles |
| [`CONTEXT.md`](CONTEXT.md) | Shared language + current authority chain |
| [`DESIGN.md`](DESIGN.md) | Visual / brand tokens |
| [`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`](docs/design/beauty-marketing-agent-product-design-2026-07-17.md) | Merged product design + D-001… decisions |
| [`docs/handoff/README.md`](docs/handoff/README.md) | Parallel worktree lanes + test/persistence rules |
| [`apps/core/TESTING.md`](apps/core/TESTING.md) | Core persistence acceptance |

## Quick commands

| Goal | Command |
|------|---------|
| Fixture stack | `pnpm dev` |
| Recorded stack | `pnpm dev:recorded` |
| Live stack (see caveats) | `pnpm dev:live` |
| Core unit/fast tests | `pnpm --filter @meiye/core test` |
| Core + persistence | provision-test-db + same URLs + Core test |
| Web e2e | `pnpm --filter @meiye/web e2e` |
| Typecheck / monorepo test | `pnpm typecheck` / `pnpm test` |
