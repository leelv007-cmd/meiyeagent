# CLAUDE.md（仓根）

本仓是「美业内容2」：`apps/core`＝Core 服务（产品事实唯一权威），`mkfast-template-main`＝Workers App Shell（其内另有自己的 CLAUDE.md）。

## 领票开发的 agent 必读

1. **票面即任务书**：`gh issue view <票号> --comments`（评论中「依赖更新（v4 编排）」覆盖票面原依赖）。
2. **派发手册**：`docs/ops/agent-dispatch-runbook-2026-07-29.md` —— 环境铁律（worktree 隔离／locale:compile 冲突纪律／并发额度）、关票纪律（消费者证明门／行为为证／反向复核／rebase 六条）、派发顺序速查。
3. **编排权威**：`docs/specs/agent-substrate-dev-spec-2026-07-29.md` 的「排期与并发」（硬依赖／批次 A-E／语义锁）。
4. **决策权威**：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（票面与决策冲突以决策原文为准，冲突记录在票下评论）。

三条铁律速记：每 lane 独立 worktree；`typecheck/test/test:interaction/e2e` 会重写共享 paraglide 产物、同 worktree 内不与 dev 并跑；不 push、不关票，合入由主控亲验。
