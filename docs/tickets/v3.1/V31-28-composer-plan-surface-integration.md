# V31-28 — Composer 旅程上的 workbench 计划/中断面确定性渲染（§37.4-C/E/H 缺口）

**Parent**: V31-10 / V31-14（票已关，本票承接其浏览器旅程未闭合部分）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: ready-for-agent

## What to build

商家在 /dashboard Composer 提交 image_text 定制创作后，Living Plan（agent-living-plan 五节文档）、commit strip（agent-commit-strip）、plan diff 与 typed interrupt 的刷新持久面必须**确定性**出现在旅程里。当前 Core 侧事件与 UI 组件都存在（V31-10 组件、V31-05 AgentWorkbenchHost 已挂在 composer stream 槽），但真实浏览器旅程中这些面不出现（跑十余轮仅历史上偶发出现过一次），商家看得到叙述/进度/方向问答/生成流，却看不到计划文档与确认条。

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
