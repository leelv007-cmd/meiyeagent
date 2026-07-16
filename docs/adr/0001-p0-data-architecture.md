> ⚠️ **2026-07-07 批注**：仍有效。微调：架构 A（ADR-0006）下 Better Auth 表并入同一 Postgres，不再保留 D1 shell-local auth 库。

# P0 Data Architecture

Status: accepted

P0 uses `mkfast-template` as the app shell, but product facts live in a separate Core API backed by Postgres. Under ADR-0006, Better Auth, sessions, API keys, shell-local payment entry, upload metadata, and all product facts use the same managed Postgres database; D1 does not carry P0 auth or business data. Store Workspace, Real Asset Library, Content Core, Platform Variant, Publish Package, Lead Ledger, Usage Ledger, Compliance Gate, Agent runs, and audit events belong to Core API/Postgres because they require workspace authorization, versioning, ledger semantics, compliance review, and durable audit trails.

**Considered Options**

- Put product tables into `mkfast-template/src/db/app.schema.ts` on D1.
- Use Better Auth organization tables as the product workspace model.
- Use Mastra Memory/RAG as the long-term store for shop facts and content state.
- Keep binary assets in R2 and product metadata in Core API/Postgres.

**Consequences**

The app shell must call Core API instead of directly reading product tables. Every product write must pass Core API authorization and audit. The `ai-runner` / `ContentWorkflowRunner` can orchestrate workflows, but it cannot own store facts, compliance decisions, publishing state, usage balance, or lead records.
