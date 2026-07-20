# Local Research System

> ⚠️ **2026-07-18 链接审计批注**：本文所引本地研究基建 `references/INDEX.md`、`references/docs/official/`、`references/source-manifest.json`、`references/scripts/*.mjs` 及旧编号文件计划为 2026-07-06 旧工作区（美业内容/）历史口径，未随 00-16 系列迁入本工作区、现已不存在。当前调研入口以 `CONTEXT.md` 权威链与 `references/analysis/README.md` 为准；官方平台/合规规则需要时按现行流程联网核实。正文结论不受影响。

## Purpose

Build a reusable local research base so future product, architecture, and platform decisions start from stored official documents and source mirrors instead of repeated web searches.

## Current Assumptions

- The product remains scoped to non-medical beauty local businesses.
- P0 is a cloud web creation copilot, not an autonomous publishing agent.
- Local snapshots are the default source of truth, but platform APIs and compliance rules must be refreshed before implementation decisions.

## Research Layers

1. Official documentation snapshots in `references/docs/official/`.
2. Source mirrors in `references/repos/`.
3. Analysis writeups in `references/analysis/`.
4. Wayfinder tickets in `.scratch/beauty-content-agent-wayfinding/` for unresolved decisions.

## First Comparisons To Produce

1. `01-platform-capability-matrix.md`: Douyin, Xiaohongshu, Meituan/Dianping, WeChat Official Account.
2. `02-saas-shell-source-review.md`: mkfast-template vs open TanStarter vs custom app shell.
3. `03-agent-runtime-review.md`: Mastra workflow/tooling fit and boundaries.
4. `04-compliance-implementation-plan.md`: AIGC labeling, non-medical beauty boundary, ad-language checks.
5. `05-p0-architecture-decision.md`: final P0 architecture and implementation backlog.
