# V31-40 — 计划 revision 与 plan.created/plan.revised 语义事件的原子性（outbox / 修复缝）

**Parent**: V31-09（Plan Compiler）/ V31-03（语义事件）/ Task 7
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: open

## 缺口

计划 revision 先落库、语义事件后发，两者不在同一事务，也没有 outbox、没有修复扫描。锚署树 `美业内容2-v31-fix-07`：

- `apps/core/src/p1/agent-session/plan-compiler.ts:636 emitPlanSemanticEvent`，注释自陈：「After append-only store write: ... Failures surface to caller — plan row already committed; projector is idempotent on eventId so retry is safe.」
- 调用点 `plan-compiler.ts:330`（compile）与 `:501`（adjust）都在 store 写入**之后**。
- `grep` 全仓无任何针对「有 revision 无事件」的 backfill / reconcile / 修复扫描（`emitPlanSemanticEvent` 只有这三个引用）。

于是存在一个持久的中间态：**计划在库里，事件从未发出**。projector 幂等只保证「重试安全」，不保证「一定有人重试」——调用方一旦崩溃或上层吞掉异常，这个计划就永远不会出现在商家面前。浏览器侧的 Living Plan / commit strip 完全由 `plan.created` / `plan.revised` 驱动，所以这个中间态的外在症状正是 V31-28 记录的「计划面偶发不出现」，且它与那票诊断的三段接线缺口是**独立**成因：接线修好后这一支仍会零星复发，且复发时无任何告警。

## 为什么不能只靠「调用方重试」

- 语义事件是商家可见性的唯一来源，不是遥测。丢一条 = 商家丢一个计划面，而不是丢一条日志。
-「失败上抛给调用方」在 compile 路径上意味着整个提交失败——但计划 revision 已经提交了，下次重试会撞 append-only 的 revision 冲突走 `raced` 分支，回到「有 revision 无事件」的同一个坑。
- 没有扫描就没有「已知未修」的清单：这一族缺陷在生产上不可观测。

## 实施范围（两条路线，实施 lane 择一并在票下记录裁决）

**A. 同事务 outbox（推荐）**：revision 与事件候选在同一事务写入（事件行落 outbox 表），发布由既有 outbox 派发器消费。参考本仓已有的 `confirmationDispatch` outbox 三态（`pending`/`dispatched`/`expired`）形制，不新造第二套状态机。

**B. 修复扫描**：允许两段写，另加一条以「有 revision 且无对应 eventId」为谓词的补偿扫描，按 planId+revision 幂等补发。

A 关掉窗口，B 只缩短窗口。若选 B 必须给出为什么 A 不可行。

## Acceptance criteria

- [ ] 一条 PG 测试：事件发布失败后，计划 revision 与事件**同时**不可见（A），或在一次扫描后事件必定补齐（B）——RED 先证当前代码下 revision 可见而事件永久缺失
- [ ] 崩溃形态：事务提交后、发布前进程中断，重入后商家仍能看到该计划面
- [ ] 幂等：同 planId+revision 重放不产生第二条事件（钉 eventId）
- [ ] 若走 A：不新增第二套状态机，复用既有 outbox 三态；若走 B：扫描谓词有测试、有上限、有指标
- [ ] 与 V31-28 的接线修复不重叠：本票只管 revision↔event 这一对的原子性
