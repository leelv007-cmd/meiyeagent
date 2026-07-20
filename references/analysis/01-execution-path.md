# Execution Path

> ⚠️ **2026-07-18 链接审计批注**：本文所引本地研究基建 `references/INDEX.md`、`references/docs/official/`、`references/source-manifest.json`、`references/scripts/*.mjs` 及旧编号文件计划为 2026-07-06 旧工作区（美业内容/）历史口径，未随 00-16 系列迁入本工作区、现已不存在。当前调研入口以 `CONTEXT.md` 权威链与 `references/analysis/README.md` 为准；官方平台/合规规则需要时按现行流程联网核实。正文结论不受影响。

## Goal

Build a development-ready research and technical-selection base for the non-medical beauty local-business content copilot.

The working rule is local-first: every future decision should start from `references/INDEX.md`, source snapshots under `references/docs/official/`, and source mirrors under `references/repos/`. Live web is only for refreshing stale sources or checking capabilities that may have changed.

## Assumptions

- P0 remains a cloud web creation copilot for non-medical beauty stores.
- P0 does not promise unattended multi-platform publishing.
- `mkfast-template` is the primary SaaS shell candidate because the private source is now cloned locally.
- Mastra is the primary Agent runtime candidate, but it must be verified through source review and a workflow spike.
- Platform capabilities and compliance rules are unstable enough to require re-verification before implementation.

## Phase 0: Local Research Base

Status: complete.

Artifacts:

- `references/source-manifest.json`
- `references/scripts/fetch-docs.mjs`
- `references/scripts/sync-repos.mjs`
- `references/scripts/build-index.mjs`
- `references/INDEX.md`
- `references/docs/official/`
- `references/repos/`

Refresh command:

```bash
node references/scripts/fetch-docs.mjs
node references/scripts/sync-repos.mjs
node references/scripts/build-index.mjs
```

Acceptance:

- All official docs in `references/INDEX.md` are checked.
- All repos in `references/INDEX.md` are checked.
- New analysis cites local paths first.

## Phase 1: Source-Level Reviews

Output files:

- `references/analysis/02-saas-shell-source-review.md`
- `references/analysis/03-agent-runtime-source-review.md`
- `references/analysis/04-auth-tenancy-storage-review.md`

Review focus:

- `mkfast-template`: route structure, auth, payment, storage, admin, API boundaries, Cloudflare limits, what can be reused without bending the app.
- `open-tanstarter`: compare smaller public TanStarter-style implementation against private template complexity.
- `mastra`: tools, workflows, memory, RAG, observability, evals, deployment boundaries.
- `better-auth`: organization plugin, adapters, rate limiting, API key plugin, Stripe plugin, multi-tenant fit.

Decision needed:

- Whether P0 starts from `mkfast-template` directly, forks it into product app-shell, or uses it only as reference.
- Whether Mastra runs as an independent service from day one or starts embedded behind a strict adapter.

## Phase 2: Platform Capability Matrix

Output file:

- `references/analysis/05-platform-capability-matrix.md`

Local source starting points:

- `references/docs/official/platforms/douyin-publish-openapi.md`
- `references/docs/official/platforms/douyin-share-publish.md`
- `references/docs/official/platforms/douyin-video-data.md`
- `references/docs/official/platforms/xiaohongshu-content-tool-rules.md`
- `references/docs/official/platforms/xiaohongshu-publish-service.md`
- `references/docs/official/platforms/meituan-openapi.md`
- `references/docs/official/platforms/wechat-official-account-publish.md`

Matrix columns:

- Platform
- Publish
- Observe
- Engage
- Attribution
- Required account type
- Required application or service-market approval
- P0 route: L1/L2/L3
- P0 product promise
- Unknowns to verify with real accounts

Acceptance:

- No platform is marked L1 until official docs and account permission tests both pass.
- L2 is described as browser-assisted preparation unless a real account test proves otherwise.
- L3 publish package remains the guaranteed fallback.

## Phase 3: Compliance Implementation Plan

Output file:

- `references/analysis/06-compliance-implementation-plan.md`

Local source starting points:

- `references/docs/official/compliance/cac-generative-ai-measures.md`
- `references/docs/official/compliance/cac-ai-labeling-measures.md`
- `references/docs/official/compliance/cac-deep-synthesis.md`
- `references/docs/official/compliance/gb-45438-2025.md`

Acceptance:

- Define explicit and implicit AIGC labeling requirements for text, image, and video exports.
- Define non-medical beauty boundary rules and blocked terms.
- Define ad-language risk checks and replacement suggestions.
- Define audit records required for every generated/exported/published asset.

## Phase 4: Product Domain And Data Model

Output files:

- `references/analysis/07-domain-data-model.md`
- `docs/adr/0001-p0-data-architecture.md` if a hard architectural decision is made.

Use the glossary in `CONTEXT.md`.

Acceptance:

- Store Workspace, Store Operating Agent, Real Asset Library, Content Core, Platform Variant, Publish Package, Lead Ledger, Compliance Gate, and Beauty Skill Pack have stable data shapes.
- Postgres vs D1 responsibility is explicit.
- Every table that affects cost, compliance, or publishing has an audit strategy.

## Phase 5: Technical Spikes

Output files:

- `references/analysis/08-mastra-workflow-spike.md`
- `references/analysis/09-model-provider-eval-plan.md`
- `references/analysis/10-graphic-renderer-selection.md`
- `references/analysis/11-publish-route-poc.md`

Minimum spikes:

- Generate 3 to 5 structured content cards from a mock store profile and real assets.
- Run compliance gate before saving.
- Save Content Core and Platform Variants.
- Export one L3 publish package.
- Benchmark at least two LLM providers and one low-cost fallback against a small beauty-content eval set.
- Render one Xiaohongshu cover and one price card with real assets.

Acceptance:

- Spikes produce artifacts, not only notes.
- Each spike records setup time, implementation friction, runtime limits, cost, and failure modes.

## Phase 6: P0 Architecture Decision

Output file:

- `references/analysis/12-p0-architecture-decision.md`

Decision shape:

- App shell
- Core API
- Agent service
- Worker pool
- Database and object storage
- Queue and background task system
- Provider registry
- Compliance and audit
- Deployment environments

Acceptance:

- The chosen architecture can support P0 without relying on L2 auto-publishing.
- Heavy tasks are not forced into Cloudflare Workers if runtime limits make them fragile.
- Agent runtime and core business domain are separate failure domains.

## Phase 7: Implementation Backlog

Output files:

- `references/analysis/13-p0-backlog.md`
- `.scratch/beauty-content-agent-wayfinding/issues/`

Backlog order:

1. Fork or initialize app shell.
2. Add Workspace and Store domain.
3. Add asset upload and metadata.
4. Add content model.
5. Add Agent workflow adapter.
6. Add compliance gate.
7. Add publish package export.
8. Add lead ledger.
9. Add usage ledger.
10. Add admin/customer-success views.
11. Run paid pilot.

Acceptance:

- Every P0 story has a test or manual verification method.
- No story depends on unresolved platform permissions unless it has an L3 fallback.

## Phase 8: Pilot And GTM Validation

Output files:

- `references/analysis/14-pilot-playbook.md`
- `references/analysis/15-merchant-interview-findings.md`

Acceptance:

- 10 to 20 non-medical beauty stores interviewed.
- 3 to 5 real stores run a Wizard-of-Oz content trial.
- Content adoption, publishing time saved, lead-ledger usage, and willingness to pay are measured.

