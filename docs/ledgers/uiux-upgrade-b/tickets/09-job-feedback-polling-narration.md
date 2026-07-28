# 票 09 · Job 生成反馈：自动轮询/streamRunEvents + 阶段白话叙事 + 禁假百分比修复
> 阶段: Phase 1 · 流式与生成反馈 ｜ 差距: P0-6 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "09",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-TOKEN-STREAMING"
  ],
  "guardrailDecisionIds": [
    "DEC-JOB-PROGRESSBAR"
  ],
  "gapIds": [
    "P0-6"
  ],
  "contractIds": [
    "I04"
  ],
  "blockedBy": [],
  "closureEvidence": [
    "docs/reviews/uiux-upgrade-b-ticket-closure-2026-07-14.md"
  ],
  "resolution": "superseded",
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- 差距报告 `P0-6`（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:145-153`）定性为 `partial`：长任务提交后没有自动轮询或 creative 流程浏览器推送，running Job 仍靠商家手点“核验原 Job 进度”；终态产物不会自动回收到结果区。
- 报告§一根因③（`:26`）直指前后端接线断层；§六路径 A/B（`:253,261-264`）要求“占位卡 + 轻量轮询 + 阶段字段贯通白话叙事 + 禁假百分比”，不能再以手动整包 invalidate 代替生成反馈。
- 报告 `:75,93`还点名两处百分比渲染；原型记录的固定 `62%`（`.scratch/creatok-uiux-wayfinding/assets/10-desktop-visual-system-prototype-record.md:119,134`）不是可信业务事实。`docs/specs/beauty-content-agent-p0-spec.md:354-355` 要求异步测试基于事件/状态轮询，界面只显示已知步骤和人话说明。
- 实核纠偏：报告 `:26,153` 称后端“已定义 `streamRunEvents`”，但当前业务代码全仓无该方法；它只出现在决策文档 `合集-v1.5-P0决策定稿.md:1317-1325`。本票不把文档承诺冒充已有 Port，MVP 选用现成单 Job 查询自动轮询。
- 范围边界：长任务仍是结构化 Work/Job/Asset/Content，不把 Job 进度做成 chat clone；D4 仍为 3 选 1 单选；不复活 L-1 贴链接抓取；不增加模型跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/product/unified-creation-workbench.tsx:225-250`：工作台只拉取整包 creative projection 和 catalog，没有单 Job query；`:332-336,447-465` 中命令成功后会 invalidate 整包 projection，报告锚点未漂移。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:365-415,917-960`：提交期间只有按钮 pending，Job 区必须等 projection 出现 `currentJob` 才渲染，提交到真实 Job 间没有可恢复占位反馈。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:988-1020`：unknown/running 分支仍手动调 `resume_creative_job`；报告引用的 `:1005-1020` 未漂移，实际文案分别是“只核验，不重投”与“核验原 Job 进度”。
- `mkfast-template-main/src/product/mobile-action-book.tsx:118-132,218-235,665-714`：移动端同样只拉整包 projection，进度页在 running/unknown 下仍要手点“核验原 Job”；这是报告未单独列行、但与 P0-6 同源的移动入口。
- `apps/core/src/p1/model-supply/foundation-module.ts:921-938,2048-2052`：已有 workspace 隔离的 `model-supply/job` 单 Job 查询，优先返回 durable media Job；`mkfast-template-main/src/p1/client.ts:34-63` 已能通用消费该 query。
- `apps/core/src/p1/model-supply/index.ts:390-405`：单 Job 返回真实 `queued/running/unknown/cancel_requested/cancelled/completed/failed` lifecycle 状态，但没有可证明的百分比或更细供应商阶段。
- `apps/core/src/p1/operations/application-service.ts:4516-4550` 与 `apps/core/src/p1/operations/model-supply-creation-adapter.ts:139-200`：既有 `resumeCreativeJob` 会按 `providerJobId` 核验原 Job，再把终态 Asset/候选幂等回收进 Operations 投影；可复用，不必为轮询重建第二套事实。
- `mkfast-template-main/src/p1/content-task-inbox.tsx:270-275` 与 `mkfast-template-main/src/p1/ai-image-selector.tsx:248-270`：报告的百分比/progressbar 锚点仍准确；后者还带手动“刷新状态”。当前 view-model 并未提供真实 progress，两处都不得作为未来接线时的假百分比伏笔。
- `apps/core/src/product/notifier.ts:22-49`：`WebhookProductNotifier` 只向商家 IM 发 `msg_type: text`，不是浏览器更新渠道；`apps/core/src/server.ts:945-957` 的 SSE 仅回放退役 diagnostics 快照并立即 `end`，不得复用成 creative Job 伪流。
- `apps/core/src/main.ts:558-561`：视频供应商内部默认 10 秒轮询、18 分钟超时，报告纠正后的 `:561` 未漂移；这只证明长任务需要可离页反馈，旧同步视频轨的退役归票 16。

## 改造方案（步骤级 + 涉及文件清单）

1. **选定 polling MVP**：仅对有 `providerJobId` 且尚未终态的图片/视频 Job 调 `model-supply/job`；前台每 5 秒轻量 refetch，窗口重新聚焦时立即核验。Job ID 变化、页面卸载或终态时停止，不轮询整包 workbench projection。
2. **提交即反馈**：用已接受的执行合同在原 Job 区立即渲染“正在提交生成请求”占位卡；真实 Job 投影返回后原位替换，不在客户端伪造 Job ID、供应商接单或结果事实。
3. **只叙述真实阶段**：把已知 lifecycle 映射为“正在提交”“已排队，等待生成资源”“正在生成图片/视频”“正在核验供应方状态，不会重复提交”“已完成，正在整理结果”或可行动失败说明。不根据已等时长猜测阶段。
4. **终态只回收一次**：轮询观察到 `completed/failed/cancelled` 后，以当前 creative Job ID 触发一次既有 `resume_creative_job`；用 Job ID + terminal status 做客户端幂等防重，待 Operations 投影带回终态与 Asset/Content 后停止。
5. **自动为主、安全降级**：正常 running/unknown 态不再要求商家手点核验；只在自动查询连续失败时显示“暂时无法自动更新”与显式重试，不把网络错误改写为 Job 失败，也不自动重投。
6. **桌面/移动共用同一观测逻辑**：将单 Job query、终态防重回收和阶段 view-model 收口为一份共用实现，分别接进 `UnifiedCreationWorkbench` 和 `MobileActionBook`；不复制两套 timer/状态机。
7. **删掉无来源百分比**：移除 `ContentTaskView`/`ImageGenerationJobView` 的无事实 `progress` 口子及两个组件的百分比渲染，改用真实 status + 白话阶段。只有未来后端能证明“已完成量/总量”时，才可通过新的明确合同恢复可计算进度。
8. **不伪造 streamRunEvents**：本票不改退役 diagnostics SSE。若后续要从 polling 切到事件流，必须新建真实 authenticated creative Job 事件合同，证明持续事件、断线恢复与终态回收；在此之前不把 SSE 当作关票条件。

涉及文件清单：

- 修改：`mkfast-template-main/src/product/unified-creation-workbench.tsx`、`mkfast-template-main/src/product/mobile-action-book.tsx`、`mkfast-template-main/src/p1/content-task-inbox.tsx`、`mkfast-template-main/src/p1/ai-image-selector.tsx`、`mkfast-template-main/src/p1/types.ts`、`mkfast-template-main/src/p1/operations-view-model.ts`、`mkfast-template-main/src/lib/uiux/status.ts`。
- 新增：一个桌面/移动共用的 creative Job observer；实施时按现有 product/p1 责任边界落位，brief 不预造当前不存在的路径。
- 只读复用：`mkfast-template-main/src/p1/client.ts`、`mkfast-template-main/src/p1/query-keys.ts`、`apps/core/src/p1/model-supply/foundation-module.ts`、`apps/core/src/p1/operations/application-service.ts`。默认不改 Core API；只有实施复验证明现有单 Job query 缺少用户可见必需真实状态时，才回 ADR 扩合同。
- 不修改：`apps/core/src/server.ts` 退役 diagnostics SSE、`apps/core/src/main.ts` 旧视频轨（票 16）、全局任务浮标/未读角标（票 10）。

**参考实现（ui-dojo @c034657，详见 references/benchmark/ui-dojo-analysis-2026-07-13.md）**：`src/pages/ai-sdk/workflow-custom-events.tsx:20-71` ProgressIndicator（Badge+阶段名+白话 message，全程无百分比）+ `src/mastra/workflows/branching-workflow.ts` 的 writer.custom({status,message,stage})——抄类型化事件 payload 形状进 streamRunEvents 设计，不抄 Mastra 运行时（本仓 pg-boss）。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家提交图片或视频后，原 Job 区立即出现与本次执行合同对应的占位卡；不会只剩禁用按钮，也不会显示伪造 Job ID。
- 任务进入 queued/running/unknown 后，桌面与移动端都会自动更新；商家不点“核验原 Job 进度/刷新状态”也能看到状态前进。
- 生成中只显示可由真实 lifecycle 证明的白话阶段，并告知“可以离开，返回后继续”；界面不出现固定 `62%`、按时长自增的百分比或无来源 progressbar。
- 商家离开当前页面再返回，看到的仍是同一个 Job 和其最新阶段；不会因页面恢复重复提交、重复扣费或出现两个结果。
- 供应方进入 completed 后，同一 Job 卡自动转为“已完成”并在结果区出现产物；failed/cancelled 则显示真实失败/取消语义与可行下一步，不长时间卡在 running。
- 自动更新网络失败时，商家看到“暂时无法自动更新”和手动重试，原 Job 仍保留；界面不把查询失败说成生成失败，也不自动新建 Job。
- 任务收件箱与图片生成卡不再显示没有真实总量依据的数字百分比；用户看到的是状态、当前白话阶段和下一步。
- **截图/录屏对照**：同一桌面视口、同一图片或视频意图，并排展示“升级前当前产品手动核验态 vs 升级后当前产品自动阶段叙事态 vs KickArt 任务中心/CreatOK task ID 恢复参照”，至少包含提交后、运行中、完成后三帧；不得用固定 62% 静态原型冒充真实运行证据。

## Blocked-by / Blocks

- Blocked-by：无。但 Phase 0 是进入 Phase 1 frontier 的硬前置。
- 全局关票闸：票 02 完成前，本票即使实现也不得关票；关票时必须将其 `I04` 体验合同验绿。
- Blocks：票 10。票 10 复用本票的真实 Job 观测与终态回收，再增全局浮标、未读角标和一键回源；不重建第二套轮询。

## 风险与回退

- **轮询风暴**：多标签页或重渲染可能重复建 timer。控制：query key 绑定 workspace + providerJobId，只有一个 active observer，终态/卸载必停。回退可放慢轮询并保留聚焦即核验，不回退到默认手点。
- **终态重复回收**：连续 refetch 可多次命中 completed。控制：以 creative Job ID + terminal status 防重，命令 pending 期不再发。若守卫失效，停自动 resume 并显示安全核验入口，票保持未完成。
- **状态粗粒度被包装成“真阶段”**：当前后端只有 lifecycle status。控制：只做可证明的白话翻译，不声称正在分镜/渲染/合成等未上报步骤；这不如假阶段“更有过程感”，但符合禁假红线。
- **离页语义误解**：本票保证 durable Job 后台继续、返回时自动恢复；跨页实时角标属票 10。若回页恢复不稳定，保留原 Job 深链与手动核验作紧急降级，不对用户承诺“全局实时”。
- **范围滑坡**：为追求流式反馈去复活 diagnostics SSE、顺手退役视频旧轨或并入全局任务中心，会踩票 10/16。回退超出本票的改动，保留 polling + 白话阶段 + 禁假百分比的最小闭环，不回退 D3、D4、L-1 de-scope 或禁止跨品牌 Auto。
