# 票 10 · 全局异步任务浮标 + 未读角标 + 一键回源
> 阶段: Phase 1 · 流式与生成反馈 ｜ 差距: P1-4 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "10",
  "decisionIds": [
    "DEC-PATH-B"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-4"
  ],
  "contractIds": [
    "I04",
    "I10"
  ],
  "blockedBy": [
    "09"
  ],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- 差距报告 `P1-4`（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:183-186`）的精确口径是 `partial`：不是“没有全局 Job 页”，而是已有 `/dashboard/jobs` 仍为 pull-based 隐藏页，没有跨 Work/会话的浮标主动收口、新完成未读角标与一键回源。
- 报告§一根因②③（`:24-26`）直接命中本票：已建能力没进主路径，后端 durable Job 与前端可见反馈之间断层。本票不能以“已有历史页”代替跨页可见行为。
- 报告§二 2.1（`:42-44`）确认成熟产品的异步渐进反馈范式；本票仅承接图片/视频长 Job 的离页回收，token 流式仍由 06–08 承接，不用 Job 浮标冒充 token 流。
- 对标锚点为 KickArt 右下任务中心（`references/benchmark/ai-native-journey-study-2026-07-08/kickart-findings.md:18-19,38`）；CreatOK “无全局任务中心”是负面基线，不得当本票正面样板。
- 范围边界：D3 仍是“对话式外壳、结构化内核”，不做 chat clone；D4 保持 3 选 1 单选；不复活 L-1 贴链接抓取；不引入模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/routes/dashboard/jobs.tsx:4-9`：`/dashboard/jobs` 已存在，直接渲染 `CanonicalHistoryPage mode="jobs"`；报告的“并非零全局入口”仍准确。
- `mkfast-template-main/src/product/canonical-history-page.tsx:122-141,143-212`：页面仅在自身挂载时查 `canonical_history`，无 `refetchInterval`；可列出 Job，但不能在其他业务页主动提醒。报告所述 pull-based 未漂移。
- `mkfast-template-main/src/product/canonical-history-model.ts:33-71,128-146`：同一投影已同时聚合 `jobs` 与 `imageJobs`，两类都有 `/dashboard/jobs/:jobId` 深链；可复用为浮标单一事实源，无需新建任务库。
- `apps/core/src/p1/operations/application-service.ts:4090-4108,4135-4173`：`getCanonicalHistory` 按当前 workspace 读持久化状态，各集合按更新时间排序分页，返回 `jobs`/`imageJobs` 总数与当页数据。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:1005-1020`：运行中 Creative Job 仍需手点“核验原 Job 进度”；行号较报告的 `workbench:1005-1020` 未漂移。
- `mkfast-template-main/src/lib/uiux/navigation.ts:4-11`：`BUSINESS_NAVIGATION` 仍只有 6 个业务项，没有 Jobs；本票用全局浮标 + “查看全部”显性接入既有页，不再造第二个任务中心。
- `mkfast-template-main/src/components/layout/sidebar-layout.tsx:53-89`：认证后的产品壳包住全部 `/dashboard/**`，且已区分桌面侧栏与移动底导；这是“离开当前 Work 仍可见”的正确挂载点。
- `packages/contracts/src/uiux.ts:35-41,57-73` 与 `apps/core/src/p1/operations/types.ts:711-739`：Creative Job 与 Canvas Image Job 的现有状态集、`workId`/`updatedAt`/输出引用已足够做聚合与回源；本票不新造状态机。

## 改造方案（步骤级 + 涉及文件清单）

1. **复用票 09 的唯一观测源**：等 09 交付自动观测与白话阶段后，在产品壳订阅同一 React Query cache/观测器；不在浮标内再起一个轮询循环，不重复触发 `resume_creative_job`。
2. **归一全局任务摘要**：从已有 `canonical_history` 投影归一 Creative Job 与 Canvas Image Job，仅保留浮标所需的 `jobId/workId/kind/status/label/updatedAt/href`；运行中与新结束态的用户文案、禁假百分比规则完全沿用 09。
3. **挂到产品壳**：仅在 `mode="product"` 的 `SidebarLayout` 渲染右下浮标，使其跨 `/dashboard/**` 路由保持。桌面固定在右下；移动端避开现有底导和 safe area，展开为可滚动面板。
4. **定义未读语义**：首次成功读取只建立当前用户基线，不把历史完成 Job 全标未读；之后仅将 09 定义的新结束/待处理状态变化计一次。已读水位按登录用户保存在本机，打开面板后清除已展示项角标，刷新与页内跳转不反复报旧任务。
5. **做轻量收口，不复制历史页**：收起态显示在跑数与未读角标；展开态仅列“进行中/新完成”最近项。点任务直达既有 `/dashboard/jobs/:jobId`，底部“查看全部任务”进 `/dashboard/jobs`；不创建第二份 Job 数据或第二个详情页。
6. **补齐用户可感知状态**：浮标在跨页时保持稳定，新结果到达用 `aria-live` 和可见角标告知；空态、查询失败、进行中、新完成皆用商家白话，不暴露 canonical/投影/路由快照等工程词。
7. **留下可视验收证据**：用同一长任务完成“提交→离开 Work→在其他业务页收到角标→一次点击回到原 Job”，并与 KickArt 右下任务中心同视口对照。

涉及文件清单：

- 修改：`mkfast-template-main/src/components/layout/sidebar-layout.tsx`、`mkfast-template-main/src/product/canonical-history-model.ts`、`mkfast-template-main/src/product/canonical-history-page.tsx`、`mkfast-template-main/src/product/canonical-history-model.test.ts`、`mkfast-template-main/tests/e2e/specs/uiux-creation-loop.spec.ts`。
- 复用不复制：`mkfast-template-main/src/routes/dashboard/jobs.tsx`、`mkfast-template-main/src/components/ui/popover.tsx`、`mkfast-template-main/src/components/ui/sheet.tsx`、票 09 实际交付的 Job 观测入口。
- 新增：最多一个壳级异步任务浮标组件；当前仓库尚无该文件，实施时按现有 product/layout 边界落位，brief 不虚构路径。
- 不修改：后端 Job 状态机、D4 候选策略、L-1 范围、模型路由规则。

**参考实现（ui-dojo @c034657，详见 references/benchmark/ui-dojo-analysis-2026-07-13.md）**：`src/components/ck/background-task-card.tsx`——7 状态→4 tone 映射 + elapsed 耗时显示；仅模式参考、实现重写（该文件属 CopilotKit 线且仓库无 LICENSE）。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家提交图片或视频长任务后，可立即切到资产库、内容库或其他 `/dashboard/**` 页；右下浮标始终可见，能看到任务仍在进行，无需回原 Work 手点“核验进度”。
- 任务在商家浏览其他页时结束，浮标自动出现新完成/待处理提示与未读数；商家不刷新页面也能看到变化，且看不到伪造百分比。
- 首次使用浮标时，历史完成任务不会突然全变未读；打开面板看过新项后角标清除，刷新、页内跳转或重新打开不会重复提醒同一任务。
- 商家在浮标中点一次任务项，直接进入对应的既有 Job 详情，能核对关联 Work、实际状态与已产出结果；不先绕到无上下文的列表。
- 商家点“查看全部任务”进入既有 `/dashboard/jobs`，能同时看到跨 Work/会话的 Creative Job 与 Canvas Image Job；浮标与全部页不出现相互矛盾的状态。
- 桌面窄屏与移动端上，浮标不遮挡底部导航、提交/采用主操作或系统 safe area；键盘与读屏用户可打开、读到新结果并进入对应任务。
- 截图/录屏对照：同一桌面视口并排展示“当前产品改造后的右下浮标收起态 + 带未读的展开态” vs “KickArt 登录态右下任务中心展开态”；另附当前产品“离页前在跑→离页后未读→点击回源”三帧。对标必须是真实页面截图，不得用 DOM 摘要或 CreatOK 负面基线代替。

## Blocked-by / Blocks

- Blocked-by：票 09。09 必须先交付自动观测、状态归一与阶段白话叙事；本票不得独立定义第二套轮询、阶段或进度口径。
- 全局关票闸：Phase 0 共同前置必须完成，且票 02 的体验合同 required 条目未以用户可见行为 + 对标截图验绿前，本票不得关闭。
- Blocks：MAP 未声明编号下游票；本票是 Phase 1 与 Path B Exit milestone 的异步回收证据前置。票 16 可复用该收口，但不擅自新增 `10 → 16` 阻断链。

## 风险与回退

- **与票 09 双轮询**：两个 observer 会重复拉取、闪烁和反复提醒。控制：浮标只订阅 09 的共享 cache；回退浮标自身的请求触发，保留 09 的原页反馈。
- **未读水位漂移**：首次加载、用户切换或时钟异常可能造成历史洪水/漏报。控制：按登录用户隔离基线，以 `jobId + status + updatedAt` 去重；回退为只显在跑数，不伪造未读。
- **全局投影载荷**：`canonical_history` 同时返回多类对象。控制：复用 Query cache、最近页与 09 的活动态轮询策略，不每个浮标实例单独请求；若实测载荷不可接受，回 ADR 补 job-only 投影决策，不在本票暗增 API。
- **遮挡与焦点失控**：桌面侧栏、移动底导、软键盘可与浮层冲突。控制：沿用现有 Popover/Sheet 和 safe-area 边界；回退为壳内固定“任务”按钮，保留一键回源。
- **双任务中心与范围串票**：把浮标扩成新历史页、chat 线程或候选/模型选择器会复制事实源并踩后续票。控制：只做摘要、角标和深链；回退壳级挂载与本机已读 key，既有 `/dashboard/jobs`、票 09 反馈与 D3/D4/L-1/模型路由决策保持不变。
