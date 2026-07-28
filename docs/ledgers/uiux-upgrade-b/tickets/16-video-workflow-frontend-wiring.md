# 票 16 · 视频成片前端接线（video_workflow_*）+ 同步 18 分钟旧轨退役
> 阶段: Phase 3 · 接线与成品感 ｜ 差距: P1-2 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "16",
  "decisionIds": [
    "DEC-PATH-B",
    "DEC-D3-WORKBENCH",
    "DEC-MEDIA-MODEL-EXPLICIT"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P1-2"
  ],
  "contractIds": [
    "I01"
  ],
  "blockedBy": [
    "03"
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

- 差距报告 `P1-2`（`docs/reviews/uiux-productization-gap-report-2026-07-13.md:173-176`）已核实：durable composed-video 命令、查询与 worker 已存在，但正式前端零 `video_workflow` 消费；§一根因③（`:26`）与点名矩阵（`:82-83,93`）均把它归为“后端已建、主路径未接”。
- 当前用户选“视频”仍走通用 `submit_creative_work`，看不到 AIDA 四段分镜、确认、质量复核、取消与最终合成的完整 workflow。旧 `POST video-jobs/:id/render` 仍可由 BFF 暴露，浏览器请求会等待 core 产出完整 mp4。
- 实核纠偏：指定的 ADR 锚点已发生文件名漂移，当前有效文件为 `docs/adr/0008-video-in-p0-and-layered-buy-build.md`。报告中的 Ark 轮询路径也已漂移，当前有效文件是 `apps/core/src/video/ark-provider.ts`；18 分钟默认值只在 `apps/core/src/main.ts:561`。
- 再收窄一处口径：`mkfast-template-main/src/routes/api/core/product/video/process.ts` 当前除生成的 route tree 外没有手写前端调用者；因此旧轨是“仍部署、仍可阻塞调用”的残留入口，不应表述成当前主工作台已主动调用它。P1-2 核心仍成立：成片新轨没有用户界面，旧同步 surface 也未退役。
- 锁定边界：D3 保持“对话式外壳、结构化内核”，不另造 chat clone；D4 文案维持 3 选 1 单选且由票 18 承接，本票只按后端实际 `awaiting_quality_review` 做逐镜候选单选，不固定成 3 个、不做多选；L-1 贴链接抓取不复活；模型必须显式选定，禁止跨品牌 Auto。

## 现状代码入口（实核 file:line）

- `mkfast-template-main/src/routes/dashboard/index.tsx:27-38`：桌面主入口为 `UnifiedCreationWorkbench`，移动端分流到 `MobileActionBook`；两处都必须能恢复同一个视频 workflow，不能只做孤立 demo 页。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:66-90,211-270`：已有“视频”operation、显式模型与 catalog 状态；`:365-415` 视频仍与文案/图片共走 `submit_creative_work`，无 composed-video 分支。
- `mkfast-template-main/src/product/unified-creation-workbench.tsx:752-932,1045-1105`：当前 Composer 只有技术参数/报价/通用 Job 提交，结果卡也没有视频 workflow 的分镜、候选或播放器。
- `mkfast-template-main/src/product/mobile-action-book.tsx:118-132,665-730,897-899`：移动端只看通用 creative Job，且明确把 Composer 留给桌面；当前无法恢复、取消或处理 composed-video 待确认状态。
- `mkfast-template-main/src/p1/client.ts:34-89` 与 `mkfast-template-main/src/routes/api/core/p1/query.ts:4-8`、`mkfast-template-main/src/routes/api/core/p1/commands.ts:4-9`：现有 workspace BFF 与 `queryP1/commandP1` 足够接线，无需新增平行 API 壳。
- `apps/core/src/p1/model-supply/foundation-module.ts:1753-1775,1917-1946,2082-2091`：命令已覆盖 create draft / confirm / select candidate / cancel，查询已覆盖指定 workflow 与当前用户 latest；create draft 强制每镜传 1–8 的 `candidatesPerShot`。票 03 已按 ADR-0008 的 `video single-shot + free retry` 裁决产品默认固定为 1；D5 的 N→1 保留给显式多候选工程评测。
- `apps/core/src/p1/model-supply/composed-video-workflow.ts:49-169,258-260`：durable service 返回 workflow + tracer Job，Job ID 稳定为 `model.composed-video:<workflowId>`；`apps/core/src/job-worker.ts:218-232,305-310` 已接 worker。
- `apps/core/src/p1/model-supply/index.ts:2354-2437,2617-2685,3220-3278`：workflow 状态为 draft / running / awaiting_quality_review / cancel_requested / completed / cancelled；多候选无法可靠自动裁决时才停在待复核，完成后持有 `composedAsset`。`:3362-3385` 说明同一 workflow ID 的 draft payload 不可改写。
- `mkfast-template-main/src/routes/api/core/p1/assets.ts:4-8` 与 `mkfast-template-main/src/lib/core-client.ts:197-253`：已能按 workspace 安全读取 `generated/composed` mp4，可直接承载候选预览与最终成片播放器。
- 旧轨：`mkfast-template-main/src/routes/api/core/product/video/process.ts:44-267` 会等待 core、读取完整 `arrayBuffer` 再写 R2；`apps/core/src/server.ts:139-143,731-918` 是同步 render 路由；`apps/core/src/main.ts:531-584` 注入 Ark/local renderer，其中 `:558-561` 为 10 秒进程内轮询与 18 分钟默认超时。以上行号均按当前树实核。

## 改造方案（步骤级 + 涉及文件清单）

1. **在唯一主路径分流视频提交**：`operation === 'video.generate'` 时不再调用通用 `submit_creative_work`。在现有 Work 记录流中显示 AIDA 四段结构化分镜卡（Attention / Interest / Desire / Action），以当前 Work 意图形成四个可编辑镜头提示；只复用已选的明确 `catalogModelId`、AIGC 开关与数据分类，不增加 URL 抓取或 Auto 模型。
2. **尊重 draft 不可变合同**：四段内容先保留为前端编辑态；用户点“锁定分镜”后，以稳定 workflow ID、storyboard revision 调 `video_workflow_create_draft`。`candidatesPerShot` 不做用户参数，也不套用文案 D4 的数字 3；按票 03 的正式裁决固定为 1，表达视频单次单候选，免费重试创建新一轮尝试。服务端草稿出现后转为只读确认态；如返回编辑，不覆写同 ID，而是明确新建 revision/workflow。
3. **确认即后台运行**：用户点“确认分镜并开始生成”调用 `video_workflow_confirm`，成功后立即显示“已提交后台，可离开此页”；禁止同一次点击再投通用 creative Job。稳定幂等键、pending 禁用与服务端返回状态共同阻止双击双投。
4. **接入恢复与自动观测**：进入视频 Composer 先查 `video_workflow_latest`，获得 ID 后查 `video_workflow`；复用票 09 的真实状态轮询/白话阶段原则，在 draft、running、awaiting review、cancel requested、completed 间自动更新，终态或离页即停，不用假百分比。
5. **接待人工质量复核**：仅当状态为 `awaiting_quality_review`，按后端返回的 shot/candidates 渲染可播放候选、真实质量说明与单选控件；每镜一次只提交一个 `video_workflow_select_candidate`，返回 running 后继续后台合成。这里不是 D4 文案 3 选 1，不新增“换一批”或多选采用。
6. **完成、取消与错误可行动**：running 可发 `video_workflow_cancel` 并显示 cancel requested；completed 通过现有 workspace asset BFF 播放 `composedAsset.objectKey`；查询失败保留 workflow ID 和重试入口，不把网络错误说成生成失败，也不自动重投。
7. **补移动恢复面而非复制 Composer**：`MobileActionBook` 的 progress 阶段显示同一 latest workflow 的白话状态、取消、待复核单选与最终播放；首建/编辑四段分镜仍留在桌面结构化 Composer，移动端给出清晰接力说明，不另建第二套分镜状态。
8. **新轨可见闭环后同票退役旧轨**：删除 BFF 同步 process 路由并重新生成 route tree；从 core server 移除 video render route、active render controller 与 renderer dependency；从 main 移除 `VIDEO_PROVIDER_*` 的旧 renderer 注入。保留 durable composed-video 的 model-supply provider、ffmpeg composition 与 asset 验证链，不删除被新轨复用的 `product-renderer` 校验能力。
9. **单轨验收**：用同一 Work 完成“编辑四段→锁定→确认→离页→回来→必要时单选→播放成片/取消”的真实浏览器走查；Network 中整段生成期间不得存在一条挂到 mp4 返回的同步页面请求，也不得同时出现通用 Job 与 composed-video 双提交。

涉及文件清单：

- 修改：`mkfast-template-main/src/product/unified-creation-workbench.tsx`、`mkfast-template-main/src/product/mobile-action-book.tsx`、`mkfast-template-main/src/routeTree.gen.ts`。
- 删除：`mkfast-template-main/src/routes/api/core/product/video/process.ts`。
- 旧轨退役：`apps/core/src/server.ts`、`apps/core/src/main.ts`。
- 只读复用：`mkfast-template-main/src/p1/client.ts`、`mkfast-template-main/src/routes/api/core/p1/query.ts`、`mkfast-template-main/src/routes/api/core/p1/commands.ts`、`mkfast-template-main/src/routes/api/core/p1/assets.ts`、`mkfast-template-main/src/lib/core-client.ts`、`apps/core/src/p1/model-supply/foundation-module.ts`、`apps/core/src/p1/model-supply/composed-video-workflow.ts`、`apps/core/src/p1/model-supply/index.ts`、`apps/core/src/job-worker.ts`。
- 不新造当前不存在的组件路径；若实施时为可读性提取视图组件，必须留在现有 product 责任边界并由同一状态源驱动。

**参考实现（ui-dojo @c034657，详见 references/benchmark/ui-dojo-analysis-2026-07-13.md）**：`src/pages/ai-sdk/workflow.tsx:26-32` STATUS_MAP + DisplayStep——步骤状态（running/waiting/suspended/success/failed）→ Tool UI 状态机逐步点亮，视频五步链照此渲染合同。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家在正式工作台选择“视频”后，看到的是同一创作流内可编辑的 AIDA 四段分镜与明确模型名；界面没有跨品牌 Auto、贴链接抓取入口或独立 chat clone。
- 商家锁定草稿后能逐段检查分镜，再明确确认生成；返回编辑会形成可辨认的新 revision，不会出现“刚改的分镜未生效”。
- 商家确认后页面立即进入“后台生成，可离开”状态；关闭或切走页面不会中止任务，回来后自动恢复同一个 workflow，无需保持一次 18 分钟请求或手点刷新。
- 商家在桌面和移动进度面都能看到真实白话阶段；界面不出现按时间自增的百分比、长期无解释 spinner、重复 Job 或重复扣费提示。
- 只有 workflow 确实进入待质量复核时，商家才看到对应镜头的真实可播放候选，并且每镜只能单选一个继续；这里不冒充文案 D4 的固定 3 候选，也没有多选采用。
- 商家取消后看到“正在取消→已取消”的可理解状态，刷新后仍保持取消；网络错误只显示可重试查询，不把原任务悄悄重投。
- workflow 完成后，商家在原创作流与移动进度面可直接播放最终竖屏成片，并能从该任务回到对应 Work；主内容不暴露 `objectKey`、SHA、provider task ref 等内部标识。
- 截图对照：同一桌面视口并排提交当前产品 `.scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/05-video-models-desktop-live.jpg`、对标 `.scratch/creatok-uiux-wayfinding/assets/screenshots/03-video-generator-desktop-live.jpg` 与升级后“可确认四段分镜 + 后台生成状态”截图，肉眼可见从竖排技术表单/无成片链路变为低门槛、可离页的成片流程。
- 补一组同 workflow 的移动截图：running、awaiting review（若真实触发）与 completed 至少覆盖 running + completed；与桌面截图中的 workflow 标识和状态一致，证明跨页面恢复而非摆拍静态卡。

## Blocked-by / Blocks

- Blocked-by：票 03；必须沿用其“durable 视频接线 + 同步旧轨退役”裁决，不得保留双轨长期并存。
- 全局关票闸：Phase 0 未完成前本票不得进入 frontier；票 02 的体验合同 required 条目与对标截图未验绿前，本票不得关票。
- Blocks：MAP 未声明直接下游硬阻塞。票 17 可复用本票的 `composedAsset` 与播放器入口统一结果/历史/资产画廊，票 10 可把同一 tracer Job 收入全局浮标，均不得另造第二份视频状态。
- 非阻断协作：票 09 的自动观测、票 11 的真实估时、票 15 的模型富卡应被复用，但不改变本票唯一硬依赖 `03`，也不把它们的范围复制进本票。

## 风险与回退

- **双轨双投/双扣费**：视频按钮仍落入通用 `submit_creative_work`，同时又 confirm composed workflow。控制：按 operation 单入口分支，并以用户可见的单一任务卡走查；回退只能整版恢复单一旧轨，禁止运行时双写或静默 fallback。
- **草稿不可变造成错版**：同 ID payload 改动会被 core 拒绝。控制：服务端 create 前本地编辑，create 后变确认态；修改即新 revision/ID。回退为“取消本次草稿并重新建稿”，不得覆盖已确认 workflow。
- **轮询竞态/重复动作**：刷新时 confirm、select、cancel 可能与状态推进相撞。控制：动作 pending 时锁定同一动作，提交后以服务端状态为准；回退只恢复显式查询按钮，不重投生成。
- **旧轨删早导致无出片**：新轨在真实环境尚未从 confirm 走到 playable composed asset。控制：同一发布单元先完成可见闭环证据再删旧入口；若上线失败，以版本回滚恢复旧单轨，不在现网同时开放两轨。
- **成片或候选无法播放**：asset 权限、对象键或 codec 不匹配。控制：继续走现有 workspace asset BFF 与技术验证；回退显示“暂时无法播放/重新载入/返回任务”，保留任务事实，不直出 core URL 或内部对象键。
- **候选数改变成本**：API 允许 1–8，数值直接改变成本、等待时长和人工复核概率。控制：产品入口固定为票 03 已裁决的 1，不暴露该技术参数；只有显式工程评测才可配置 N→1，多候选不会被默认体验静默启用。
- **候选策略越界**：把视频质量复核做成 D4 3 选 1、换一批或多选，会重开已锁决策。控制：严格按后端返回数量逐镜单选；文案 D4 仍由票 18 实现，视频免费重试政策不在本票重定义。
