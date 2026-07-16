> ⚠️ **Superseded by ADR-0006 (2026-07-07)**：四个独立部署单元的实现方式被替换为"Workers 壳 + 单 Node 服务 + 托管 Postgres"的模块边界方案；本 ADR 防"App Shell 隐形拥有产品事实"的动机与边界规则全部保留。下方正文是历史记录，不再作为 P0 实施口径。

# P0 Service Architecture

Status: superseded by ADR-0006 (2026-07-07)

P0 uses a four-boundary architecture: `mkfast-template` is forked only as the Cloudflare Workers app shell; a separate Core API backed by Postgres owns all product facts, workspace authorization, ledgers, compliance, publishing, provider registry, jobs, and audit; a separate Node/Mastra Agent Service runs workflows through Core API tools; and a separate Node Worker Pool handles render/export/heavy jobs with R2 as binary object storage. This keeps the fast SaaS shell reusable while preventing D1, Mastra memory, R2, or browser workers from becoming hidden sources of truth for compliance-sensitive product state.

**Considered Options**

- Put the whole P0 inside the `mkfast-template` Worker and D1 schema.
- Use Mastra as the direct product backend and memory store.
- Use client/browser rendering as the export path.
- Use L2/browser automation as the publishing foundation.

**Consequences**

The implementation needs more service plumbing upfront: typed adapters, Core API membership checks, Postgres migrations, job leases, and service-to-service auth. In return, app shell, product domain, agent runtime, renderer, compliance, publishing, usage, and audit can evolve independently, and P0 does not depend on unattended platform automation.
