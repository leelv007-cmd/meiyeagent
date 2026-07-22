# 美业内容2 — 转本地开发 工作区整理 Baseline（2026-07-22）

从「多 worktree 云端/orca 编排（线上）」切换到「主仓单一本地工作流（线下）」的收尾记录。
前序交接见 [`orca-129-169-local-agent-handoff-2026-07-22.md`](./orca-129-169-local-agent-handoff-2026-07-22.md)。

## 本次整理动作

- **回收 8 个 worktree**：qa-20260722 + orca workspaces 下 7 个（ci-baseline-a1 / L1–L5 / pr-review），全部 `git worktree remove`，回到单一主仓。
- **保住 L3 未提交成果**：254 行 execution-spine 新代码（`verifiedSourceObjects` 逻辑 + 测试）→ commit `7ad9b29`，提交到 `leelv007-cmd/L3-p0-spine` 本地分支。
- **abort L2 中断的 rebase**：原状态 detached HEAD + 7 个未解冲突（rebase 到旧的 `6f75020` 半途停住）→ `rebase --abort` 干净回到 `4232e7b`（= 远端）。
- **归档 2 份文档进 main**：orca handoff（#129-169）+ wave-1 PR review（#170-174）→ commit `f37b4aa`，已 push。
- **清除生成物噪音**：所有 worktree 的 `mkfast-template-main/worker-configuration.d.ts`（wrangler types 生成物，含 `REACTBITS_LICENSE_KEY`）统一 checkout 丢弃。
- **删除已回收分支**：`qa/beauty-marketing-agent-20260722`、`leelv007-cmd/pr-review-170-174`（提交都已在 main、review doc 已归档）。

## 当前工作区拓扑

- 唯一 worktree：**主仓 `main` @ `f37b4aa`，与 `origin/main` 完全一致（0/0）**。
- `/Users/bin/orca/workspaces/美业内容2/` 已清空。

## 6 个 open PR / 保留分支现状

| PR | 分支 | 本地↔远端 | mergeable | 备注 |
|----|------|-----------|-----------|------|
| #175 | ci-baseline-a1 (A1) | = origin ✅ | DIRTY/CONFLICT | **无 CI checks** |
| #174 | L5-p0-merchant-ui | = origin ✅ | DIRTY/CONFLICT | |
| #173 | L3-p0-spine | **ahead 1**（有意保留）| UNSTABLE/MERGEABLE | 唯一可合，但 CI 未稳 |
| #172 | L4-p0-storage-runtime | = origin ✅ | DIRTY/CONFLICT | |
| #171 | L2-p0-security | = origin ✅ | DIRTY/CONFLICT | rebase 已 abort |
| #170 | L1-p0-ci-gate | **ahead4/behind2**（有意保留）| DIRTY/CONFLICT | 分叉 |

## 2 个有意保留的本地领先（未 push，待本地推进时处理）

1. **L3-p0-spine · ahead 1**：成果 checkpoint `7ad9b29`。推进 #173 时 push（会更新 PR）。
2. **L1-p0-ci-gate · ahead4/behind2 分叉**：本地 4 commit 是远端 2 commit 的内容超集（多出 `green core baseline` + `root quality acceptance` 两个独有 commit，中间两个与远端同名等价）。推进 #170 时收敛，大概率 `force-push` 本地覆盖远端。

> 方向决策（2026-07-22）：orca worktree 回收，但**远端分支 / PR / issue 全部原样保留不动**；因此以上两处本地领先暂不 push，仅记录在案。

## 转本地开发 · 下一步

- **这 6 个 PR 当前不可直接合**：5/6 与 main `CONFLICTING`，CI 红或缺失（#175 无 checks）。handoff 里「按序合 #170→174」的计划需重做。
- 本地推进单个 PR 的路径：`checkout` 分支 → `rebase origin/main` → 解冲突 → 修 CI → 转 ready → 合。
- backlog：**50 个 open issue**（#1–#169，含 P0 remediation / P1 productization / Pro Studio 等 Spec），全部 `ready-for-agent`。
