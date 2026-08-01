# Repository Guidelines

## Project Structure & Module Organization

This pnpm monorepo contains the 美业内容2 product:

- `mkfast-template-main/` (`@meiye/web`) contains the TanStack Start/React app, routes, APIs, database schema, and browser tests.
- `apps/core/` (`@meiye/core`) contains domain contracts, workflows, providers, and Node tests.
- `packages/contracts/` contains shared TypeScript/Zod contracts. Gates and operational scripts live in `scripts/`; decisions and evidence live in `docs/` and `references/`.
- Pro Studio / `apps/canvas` are **retired** (D-170); do not treat Canvas as a required product or dev surface.

Read `PRODUCT.md`, `CONTEXT.md`, and the relevant current spec before changing behavior. For web changes, also follow `mkfast-template-main/AGENTS.md`.

## Build, Test, and Development Commands

Use Node.js 22+, pnpm 10.30.3, and Docker for local PostgreSQL.

- `pnpm install` installs workspace dependencies.
- `pnpm dev` starts the fixture stack (Web :3000, Core :4100, and worker). Canvas :4200 is not required (Pro Studio retired, D-170).
- `pnpm build` builds workspace packages with build scripts.
- `pnpm typecheck` runs the repository TypeScript gate.
- `pnpm test` runs workspace tests and repository gate tests.
- `pnpm --filter @meiye/core test` runs Core tests; provision separate business and DBOS databases for persistence acceptance.
- `pnpm --filter @meiye/web e2e` runs Playwright browser tests; use a focused spec while iterating.
- `pnpm --filter @meiye/web check` runs the read-only Biome check for the web package.

## Coding Style & Naming Conventions

Use strict TypeScript and match the surrounding package. Biome is the formatter/linter; do not format unrelated files. Use kebab-case filenames, PascalCase components, and `*.test.ts(x)` tests. Web imports use `@/`; do not edit generated route files.

## Testing Guidelines

Add a focused regression test for behavior changes. Core and contract tests use Node’s runner through `tsx`; web interaction tests use Vitest, and browser journeys use Playwright in `mkfast-template-main/tests/e2e/specs/`. No coverage threshold is declared; changed paths still need meaningful assertions. Skipped database tests are not persistence acceptance.

## Security & Configuration

Copy `.env.example` to `.env` for local overrides. Never commit credentials or paste secrets into code, issues, or evidence. Keep fixture, recorded, and live-provider validation separate; live claims require activation and recorded evidence.

## Commit & Pull Request Guidelines

Use concise English Conventional Commit-style subjects such as `feat:`, `fix(scope):`, `test(scope):`, `refactor(scope):`, or `merge:`. PRs should explain scope and impact, link the issue/ticket, list validation commands and results, include UI screenshots, and call out required database, provider, or E2E setup.

## XHS / Workbench Implementation Constraints (2026-08-01, D-171)

- Zero new agent runtime: AG-UI / assistant-ui / CopilotKit are pattern references only; DBOS, Task, and ContentPackage remain the truth chain.
- Tiptap (rich text) is allowed only inside the object workspace — never in the Composer.
- XHS sourcing red lines: no anonymous scraping, no signature reverse-engineering, no account pools. Link ingestion only via the user's own logged-in session (OpenCLI channel, live-gated) or manual paste.
- ContentPackage kind product vocabulary is `media|copy|note` (`image_text|video` are legacy aliases). Confirm-gate rule is paid-media-execution based; pure copy stays exempt (D-043). Note-path hold activates in P1 only.
- Authority: `docs/specs/xhs-vertical-integration-spec-2026-08-01.md`.
