# Source Inventory

> ⚠️ **2026-07-18 链接审计批注**：本文所引 `references/repos/*` 本地镜像已从工作区移除（当前仅存 creatok-skills、vozeb、harness-2026-07-17，均 gitignore 不入库）。mkfast-template 模板现位于仓库根 `mkfast-template-main/`；需复核其余源码时按原仓库名重新 clone。文中镜像路径为 2026-07-06 快照期历史记录，结论不受影响。

## Snapshot

Created from the local clones under `references/repos/`.

## mkfast-template

Path: `references/repos/mkfast-template`

Latest cloned commit:

```text
b5ad73e fix: remove unused affiliate environment variables from deploy workflow
```

Initial facts:

- Package manager: `pnpm@10.30.3`.
- Runtime direction: TanStack Start + Cloudflare Workers.
- Includes: Better Auth, TanStack AI, TanStack Query, TanStack Router/Start, Base UI, Tabler icons, Creem, Stripe, Drizzle, R2/storage, admin/settings/dashboard routes.
- Useful directories:
  - `src/auth`
  - `src/api`
  - `src/db`
  - `src/payment`
  - `src/storage`
  - `src/routes/dashboard`
  - `src/routes/settings`
  - `src/routes/admin`
  - `src/components/admin`
  - `src/components/settings`
  - `docs/`

Review questions:

- Can product routes be added without fighting the existing route/layout conventions?
- Is Better Auth already wired in a way that can support Store Workspace and roles?
- Are storage APIs scoped by user only, or can they be cleanly changed to workspace/store scope?
- Does the payment implementation support subscription + usage ledger, or only subscription state?
- Which APIs are safe to keep on Workers, and which should call Core API / Agent service?

## open-tanstarter

Path: `references/repos/open-tanstarter`

Latest cloned commit:

```text
3048d08 chore: update viteplus version badge
```

Initial facts:

- Package manager: `pnpm@11.9.0`.
- Smaller TanStack Start reference with Better Auth, Drizzle, shadcn, Postgres.
- Useful for comparing minimal implementation patterns against private `mkfast-template`.

Review questions:

- Is its Postgres-first shape easier for this product than the Cloudflare D1 shape?
- Which patterns are simpler than private `mkfast-template` and worth copying?

## mastra

Path: `references/repos/mastra`

Latest cloned commit:

```text
81b66d0 chore: regenerate providers and docs [skip ci]
```

Initial facts:

- Package manager: `pnpm@11.5.1`.
- Monorepo packages include `core`, `memory`, `rag`, `evals`, `server`, `mcp`, `playground`, `agent-builder`, `cli`, deployers, loggers.
- Good fit areas to inspect first:
  - `packages/core/src`
  - `packages/memory/src`
  - `packages/rag/src`
  - `packages/evals/src`
  - `packages/server/src`

Review questions:

- What is the smallest stable subset needed for P0 workflows and tools?
- How hard is it to persist workflow state, tool calls, and cost records into our own database?
- Which long-running features are beta or too heavy for P0?
- Can Mastra observability be correlated with our `agent_runs` and `tool_calls` tables?

## better-auth

Path: `references/repos/better-auth`

Initial facts:

- Monorepo packages include `better-auth`, `core`, `cli`, `drizzle-adapter`, `api-key`, `redis-storage`, `stripe`, `sso`, `scim`, `oauth-provider`.
- Key local docs:
  - `references/docs/official/better-auth/introduction.md`
  - `references/docs/official/better-auth/installation.md`
  - `references/docs/official/better-auth/organization.md`

Review questions:

- Does Organization plugin cover Store Workspace membership, or should Store Workspace remain in Core API?
- How should API keys be separated from high-risk platform credentials?
- Can Better Auth Stripe plugin be used without coupling billing to quota ledger?

## tanstack-router

Path: `references/repos/tanstack-router`

Initial facts:

- Contains TanStack Router and TanStack Start implementation and examples.
- Use mainly to understand framework constraints and deployment patterns, not as product code.

Review questions:

- Which TanStack Start server-function patterns are safe on Workers?
- Which patterns become awkward once Core API and Agent service are separate services?

## workers-sdk

Path: `references/repos/workers-sdk`

Initial facts:

- Wrangler and Cloudflare Workers SDK source.
- Use for deployment/runtime understanding and examples.

Review questions:

- Which Worker limits affect app-shell BFF routes?
- How should secrets, bindings, D1/R2, and service bindings be separated per environment?

## drizzle-orm

Path: `references/repos/drizzle-orm`

Initial facts:

- ORM candidate already used by mkfast-template and open TanStarter.
- Review should focus on Postgres schema/migration ergonomics and D1/Postgres boundary.

## konva

Path: `references/repos/konva`

Initial facts:

- Canvas rendering/editor candidate for P0 image cards and covers.
- Review against alternatives before committing, especially if text layout, export quality, and mobile editing matter.

