# V31-28 — Composer 旅程上的 workbench 计划/中断面确定性渲染（§37.4-C/E/H 缺口）

**Parent**: V31-10 / V31-14（票已关，本票承接其浏览器旅程未闭合部分）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: done (merged 6bf659915, 2026-08-09)

## What to build

商家在 /dashboard Composer 提交 image_text 定制创作后，Living Plan（agent-living-plan 五节文档）、commit strip（agent-commit-strip）、plan diff 与 typed interrupt 的刷新持久面必须**确定性**出现在旅程里。当前 Core 侧事件与 UI 组件都存在（V31-10 组件、V31-05 AgentWorkbenchHost 已挂在 composer stream 槽），但真实浏览器旅程中这些面不出现（跑十余轮仅历史上偶发出现过一次），商家看得到叙述/进度/方向问答/生成流，却看不到计划文档与确认条。

## 诊断结论（2026-08-09 codex CLI 四问取证＋主控亲验，取代下方旧 triage 假设）

**不是时序竞态（置信 0.98）——是三段生产接线从未存在**（主控已逐条亲验）：

1. **Core 生产者缺口（0.99）**：Composer submission 编排从不调用 Session Harness / PlanCompiler，该路径根本不产生 `plan.created/plan.revised` 语义事件（compilePlan/adjustPlan 只有 service 定义，composer 侧零调用者）。
2. **Thread 绑定缺口（0.99）**：提交响应未携带/未回写权威 threadId/runId，AgentWorkbenchHost 会话投影不会绑定到新 run 的 thread。
3. **语义传输缺口（0.99）**：`applyLiveSemanticEvent` 除 index 转出口外零生产调用者；loadReplay/streamReplay 未接鉴权 HTTP/SSE seam，Composer Host 未注入生产 loadReplay 与 live subscriber。
4. **跨 Thread 状态不隔离（0.90，独立真缺陷）**：reducer `set_session` 仅替换 session 不清 `plans/activePlanId`（agent-event-reducer.ts）；单例 store 下旧投影可残留误显——这也是历史「偶发绿一次」的最可能解释（置信 0.72）。

## 实施范围（按诊断四项）

1. Core：Composer submission 边界幂等创建/复用 Agent Thread+Run 并接入 Session Harness/PlanCompiler，产出真实 plan 语义事件（禁止 web 伪造 plan 事件）。
2. 提交响应携带权威 threadId/runId；web 成功后更新 Workbench 绑定或失效重取 get_workbench_session。
3. 为 loadReplay/streamReplay 接鉴权 HTTP/SSE 生产 seam；Composer Host 注入生产 loadReplay + live subscriber，从 snapshot 的 lastEventId/lastStreamOffset 续传。
4. Thread 变化/回 Idle 时原子清空计划与中断投影（set_session 语义修正）。

Living Plan 组件与 plan reducer 主逻辑无需重写。诊断打点现场保留在 lane-28 worktree（美业内容2-lane-28，spec 已解 fixme＋网络/宿主打点＋afterAll 暂移；PG 证据库 meiye_lane28），实施 lane 可直接取用。

**排期约束**：与 V31-27（steering 前台）语义相邻（同触 composer-home / workbench 会话面），按语义锁纪律串行——V31-27 合入后再开工本票。

## 2026-08-09 triage 证据（merge controller，全程留存）

- 提交链已修通：image_text 无 case_image 源时 Core 400 fail-closed（`INVALID_STATE: Required source slot case_image`）——spec 已补 `seedComposerInlineAuthorize` 种子；种子后 run 正常起（叙述→创作进度→两种图文方向问答→「正在写第一版…」流式）。
- 但 `agent-living-plan` / `agent-commit-strip` / `agent-plan-diff` / `ask-merchant-group-card` 在 composer 旅程 DOM 快照中从未出现（方向问答由另一渲染器出面）；执行确认中断刷新持久（§37.4-H）同样等不到可锚定面。
- 环境差异已排除：main 与 lane-21（V31-25 代码）、新旧测试库、export/manual_copy 缺省均复现红。
- 复现命令：`PORT=3061 PLAYWRIGHT_CORE_PORT=4161 TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/<fresh-db> pnpm exec playwright test tests/e2e/specs/v31-living-plan-journey.spec.ts`
- 疑点方向：AgentWorkbenchHost 会话投影是否在新提交后真正绑定该 run 的 thread 并消费 plan 语义事件（V31-03 projector→V31-04 reducer→V31-10 UI 链在 composer 宿主上的接线）；偶发通过说明链路能通、大概率是绑定/时序问题而非缺组件。

## Acceptance criteria

- [ ] `v31-living-plan-journey.spec.ts` fixme 去除并全绿（agent-living-plan 五节 + 修订 + diff）
- [ ] `v31-context-fence-journey.spec.ts` §37.4-E fixme 去除并全绿（计划真相面或 stale reconfirm 可锚定）
- [ ] `v31-interrupt-resume-journey.spec.ts` §37.4-H fixme 去除并全绿（typed interrupt 刷新不丢 + resume）
- [ ] 上述三条即验收合同，禁止改弱断言；修复在产品接线侧

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **一行未填满，对应 AC 不得勾选。**

| AC | production writer | production consumer | failure-recovery test | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — |
