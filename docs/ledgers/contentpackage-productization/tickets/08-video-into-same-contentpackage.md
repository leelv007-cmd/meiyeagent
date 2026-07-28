# 票 08 · 视频成片进同一 ContentPackage
> 建设面: E1 成品收敛 ｜ 决策: DEC-CONTENTPACKAGE-SOLE ｜ Blocked-by: 06

> 基线说明（2026-07-15）：本票中的“零命中/未实现”类描述仅指当时快照；当前代码已有 ContentPackage contracts 与 wiring，开放票仍表示治理/验收未闭环，不代表实现为空。

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "08",
  "decisionIds": [
    "DEC-CONTENTPACKAGE-SOLE"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "G-VIDEO-ORPHAN"
  ],
  "contractIds": [],
  "blockedBy": [
    "06"
  ],
  "closureEvidence": [],
  "resolution": null,
  "status": "open"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- **独立第三套结果事实（confirmed）**：视频成片的终点是 `DurableVideoWorkflow` 自己——`apps/core/src/p1/model-supply/index.ts:3528` `workflow.status = 'completed'` 后仅保存 checkpoint 即 return（`:3529-3535`）；成片 `composedAsset` 只挂在 workflow 上（`index.ts:2569-2592`，`composedAsset` 在 `:2592`）。整条完成路径零调用任何内容事实写入：不进旧 Product `contents`、不进 P1 `creativeContents`、更没有 ContentPackage（全仓 `ContentPackage` 当前零命中，已复核 ADR-0011 "真实空白"结论仍成立）。
- **Job 交付即终结（confirmed）**：worker 侧 `ComposedVideoJobEffect.run` 拿到 completed 后只把 `{ workflowId, status, composedAssetId }` 写进 tracer Job output（`apps/core/src/p1/model-supply/composed-video-workflow.ts:271-283`），商户成品层面无任何后继动作。
- **采用通道对视频关死（confirmed）**：唯一的采用命令 `acceptCreativeAsset` 只认 `state.creativeAssets`（文案/图，`apps/core/src/p1/operations/application-service.ts:5572`），且 `assetIds: [asset.id]` 写死单元素（`:5631`；ADR-0011 所引 `:5638` 已漂移 7 行，逻辑未变）。视频 `composedAsset` 是 model-supply 域的 OwnedAsset，根本走不进这条命令。
- **内容库看不见视频（confirmed）**：`/dashboard/content` 由 `state.contents`（旧 Product `ContentItem[]`，`packages/contracts/src/product.ts:409`）过滤渲染（`mkfast-template-main/src/routes/dashboard/content.tsx:136,141`；ADR-0011 所引 `content.tsx:100` 已漂移，现 `:100` 是 sourceContent 查找、列表过滤在 `:136/:141`）。视频完成后商户唯一能看到成片的地方是创作工作台面板内联 `<video>`（`mkfast-template-main/src/product/video-workflow-panel.tsx:555-566`），面板此态仅剩 cancel 一个动作（`:568-579`）——没有入库、没有版本、没有状态用语，成片是"看完即散"的第三套事实。
- **票界**：本票把视频生命周期（确认提交→逐镜候选人工挑选→compose 终态）挂进同一 ContentPackage 聚合与版本体系，交付"视频和图文在一个库"。ContentPackage 聚合合同/repository/采用命令基座由票 01/06 落，内容库读 ContentPackage 投影由票 07 落；视频包的三平台 variant 归票 11，variant 编辑/回滚归票 12，水印烧录与撤权归票 15，历史已完成视频的迁移归票 17。
- **锁定边界**：不重开 D4（文案 3 选 1 单选不动；视频逐镜 N→1 人工选镜是另一契约，本票原样保留）；商户一级导航维持创作/内容/素材/门店，Work/Job/Asset/RouteSnapshot 只出现在二级详情；状态用语只用创作中/可使用/需处理（D14），且映射不得长成第二套状态机。

## 现状代码入口（实核 file:line）

- `apps/core/src/p1/model-supply/index.ts:2569-2592`：`DurableVideoWorkflow` 接口，status 枚举 `draft | running | awaiting_quality_review | cancel_requested | completed | cancelled`（`:2585-2591`），`composedAsset?: OwnedAsset`（`:2592`）。
- `apps/core/src/p1/model-supply/index.ts:3243`：`runDurableVideoWorkflow` 主循环；`:3478` 逐镜候选齐备但未人工选镜时置 `awaiting_quality_review`；`:3511-3520` `composer.compose` 产出 `composedAsset`（compose 后即自有存储 owned Asset，非临时 URL）；`:3528-3535` 置 completed、存 checkpoint、return——断裂点本体。
- `apps/core/src/p1/model-supply/composed-video-workflow.ts:54`：`DurableComposedVideoApplicationService`（模块级服务）；`:120-133` `confirmAndSubmit`＝分镜确认+提交 tracer Job；`:223-237` 注释明示 execute/reconcile 走同一 restart-safe runner（checkpoint 防重复生成）；`:252-283` `ComposedVideoJobEffect.run` 完成路径。
- `apps/core/src/p1/model-supply/foundation-module.ts:1994-2032`：`video_workflow_create_draft / confirm / select_candidate / cancel` 命令分发；`:2168-2185`：`video_workflow / video_workflow_latest / video_workflows` 查询分发——Web/HTTP/MCP 共用的 seam 入口。
- `apps/core/src/main.ts:309-321`：HTTP 进程装配 `PersistentContentWorkflowRunner` 与 `DurableComposedVideoApplicationService`；`apps/core/src/job-worker.ts:213-233`：worker 进程装配同一 runner + `ComposedVideoJobEffect`（compose 实际发生在 worker 进程）。
- `apps/core/src/p1/model-supply/postgres-repository.ts:678`：`PostgresDurableVideoWorkflowStore`；`:966` `PersistentContentWorkflowRunner`；`:1045-1071` `runVideoWorkflow` 幂等续跑（completed/cancelled 直接返回）。
- `apps/core/src/p1/operations/application-service.ts:5572-5665`：`acceptCreativeAsset` 采用命令全貌（票 06 的改造对象，本票只消费其落成的 ContentPackage 命令基座，不动文案侧规则）。
- `mkfast-template-main/src/product/video-workflow-panel.tsx:555-579`：完成态内联播放 + cancel；`:19` 经 `commandP1/queryP1` 走 P1 BFF。桌面挂载 `mkfast-template-main/src/product/unified-creation-workbench.tsx:1983-2003`（`:1989`），手机挂载 `mkfast-template-main/src/product/mobile-action-book.tsx:1425-1431`。
- `mkfast-template-main/src/product/creative-job-observer.ts:50-52,142-168`：`video_workflows` 轮询与失效链，包状态推进后要让内容库投影同步失效。
- 测试 prior art：`apps/core/src/p1/model-supply/composed-video-workflow.test.ts:344` 起的 "durable composed-video application seam" 套件——本票新增契约测试沿用同形态打 Application Service 外部行为。

## 改造方案（步骤级）

1. **契约先行（依赖票 01 冻结的聚合合同）**：为 `kind: 'video'` 的 ContentPackage 落实体映射——source facts＝`workId / workflowId / storyboardRevision / catalogModelId / dataClass / aigcLabelEnabled / shots prompt 快照`；child runs＝DurableVideoWorkflow 引用 + 逐镜 selected clip Asset 引用；generated assets＝`composedAsset`（owned objectKey，禁临时 URL）；完成时创建首个可编辑版本（版本内容＝成片 Asset 引用 + 分镜脚本快照；编辑/回滚细节归票 12）。投影契约放进票 06/07 已开的 ContentPackage 契约文件（`packages/contracts/` 下位置以票 06 实际落点为准，本票不另开第二份契约）。
2. **Application Service 命令——视频生命周期两个挂点（不新增 seam，命令名以票 01 冻结合同为准，下述为语义）**：
   - **确认即开包**：`video_workflow_confirm` 命令路径（`foundation-module.ts:2014-2018` → `confirmAndSubmit`）成功后，在同一命令编排内调用票 06 落成的 ContentPackage 服务创建 `kind=video` 包，用户可见状态＝创作中，幂等键＝`workspaceId + workflowId`（重复 confirm 只查询不复制包）。分镜草稿（未 confirm）不建包——confirm 是付费执行合同确认点，与十条状态契约"不创建付费任务补齐缺项"一致，避免未确认草稿污染内容库。
   - **交付落包**：`ComposedVideoJobEffect.run`（`composed-video-workflow.ts:252-283`）在 `status === 'completed'` 分支调用注入的"视频交付落包"命令端口：写入 composedAsset 为 generated asset、创建首版本、包状态推进为可使用；`awaiting_quality_review` 分支把包置为需处理；cancel 路径（`:239-250`）把包置为对应终态。worker 也是 seam 的合法调用方（spec §2：Web/Admin/HTTP/MCP/job-worker 调同一组命令），端口注入按 `main.ts:309-321` 与 `job-worker.ts:213-233` 两处现有装配形态各接一次，依赖方向＝effect → ContentPackage 命令窄端口，不让 model-supply 内核反向 import operations 全量。
   - **幂等与状态契约**：交付落包以 `workflowId + compositionKey` 为幂等键；execute/reconcile 重投（restart-safe 语义，`:223-237`）只查询不重复版本、不重复包——直接落实十条状态契约"使用原幂等键只查询、幂等查询不重复版本"。逐镜 N→1 选镜保留成功子任务只重试失败的既有语义不动。
3. **前端与投影（消费票 07 的内容库）**：
   - 内容库列表（票 07 的 ContentPackage 投影）渲染 `kind=video` 包：封面/时长、创作中/可使用/需处理徽标、可使用态点开播放成片（owned objectKey 经现有 `videoAssetUrl` 通道）；来源（Work/workflow/模型/RouteSnapshot）只进详情二级。
   - `video-workflow-panel.tsx:555-579` 完成态从"面板终点"改为"包引用"：保留内联预览，新增"已入内容库·查看成品"跳转到内容库该包详情；需处理态（选镜）在包详情提供回到选镜面板的入口。手机 `mobile-action-book.tsx:1425-1431` 同一包引用、同一状态用语——同一 ContentPackage 对象，设备只改布局。
   - 包状态推进后失效内容库查询缓存，接在 `creative-job-observer.ts:142-168` 既有轮询失效链上，不另起第二条轮询。
   - 严禁把 `video-workflow-model.ts` 的 effectiveStatus 推导复用为内容库状态源——包状态由聚合状态机经命令持有，前端只渲染。
4. **测试（打 Application Service 外部行为，形态沿用 `composed-video-workflow.test.ts:344` 套件）**：
   - **同库同版本契约（本票核心断言）**：同一 workspace 先用票 06 命令采用"文案+多图"得 `kind=image_text` 包，再把视频 workflow 跑到 completed，断言内容库列表查询同时返回两个 ContentPackage、状态口径一致，且视频包有首个版本记录——复现并防回"视频是第三套事实"。
   - confirm 幂等：重复 confirm 不复制包；交付幂等：对同一 workflow 重跑 `ComposedVideoJobEffect.run`（模拟 worker 重启 reconcile）不重复版本、不重复计费事实。
   - `awaiting_quality_review` → 包＝需处理；选镜 resume 至 completed → 可使用；cancel → 终态且永不出现可使用版本。
   - 断言包引用的成片为 owned objectKey（供应商临时 URL 出现即失败）。
   - 旧三套防回归：完成落包后 `state.contents` 与 `creativeContents` 均无新增（不双写，D06）。测试只作工程护栏，不作为关票依据。

## DoD（全部必须是用户可见行为）

- 商户在工作台确认分镜并提交视频后，打开一级导航"内容"即可看到该视频成品条目处于"创作中"；成片完成后同一条目变为"可使用"，点开能直接播放成片——不再需要回到创作工作台的面板才能找到成片。
- 同一商户先采用一条图文、再完成一条视频，内容库同一列表同时出现图文成品与视频成品，状态徽标同一套（创作中/可使用/需处理），点开各自详情均有版本记录——"视频和图文在一个库"成立。
- 逐镜候选需要人工挑选时，内容库该成品显示"需处理"，点入能回到选镜界面；选完镜返回内容库，状态自动前进，不需要商户手动刷新对象。
- 商户取消视频后，内容库该成品进入终态，不出现"可使用"假象，也不产生可播放版本。
- 商户在手机上打开内容库，看到的是同一个视频成品、同一状态（同一 ContentPackage 对象），手机可完成播放预览与结果决策；成片来源（分镜、模型、执行记录）只在详情二级出现。
- **对照证据（至少 1 条，当前 vs 改造后 + 对标）**：同一分镜任务录屏三帧对照——当前产品"确认提交 → 工作台面板内联播放（唯一出口）→ 打开 `/dashboard/content` 无任何新条目"，对比改造后"确认提交 → 内容库出现创作中条目 → 完成后同库变可使用并可播放"；并与 CreatOK/即梦"生成完成的视频自动进入同一作品库"的对应画面并排。
- 证据必须来自真实可操作 `/dashboard`（桌面 + 手机视口各一段）；真实 provider 成片的端到端留证按 D01 归票 22 回挂，本票不得以"命令存在/fixture 绿/契约测试过"关票。

## Blocked-by / Blocks

- **Blocked-by**：票 01（ContentPackage 聚合合同 + 十条状态契约冻结——E1 地基，合同未冻结不得扩建）；票 06（ContentPackage 写通道/repository/服务基座）；票 07（内容库只读 ContentPackage——否则"同库可见"无处呈现）。
- **Blocks**：票 11（视频包的三平台 variants 以 `kind=video` 包存在为前提）→ 票 15（水印/AIGC 烧录与撤权作用于含视频的包导出）→ 票 16（桌面/手机同一 Package 旅程的视频半边）→ 票 17（新视频链路成立后才能冻结旧完成视频的写入并迁移只读）→ 票 22（真实链路端到端验收中"图文或视频"的视频线）。解阻不等于关票；本票以上述用户可见证据关票。

## 风险与回退

- **worker→包命令的装配环**：`ComposedVideoJobEffect` 现只持有 `runnerForWorkspace`（`job-worker.ts:232`），注入包命令端口可能诱发 model-supply ↔ operations 循环依赖。控制：端口定义在 ContentPackage 服务侧、effect 只依赖窄接口，装配在 `main.ts` / `job-worker.ts` 组合根完成（参照 `attachDurableMediaRuntime` 形态）。回退：若环解不开，confirm 侧建包保留，交付落包退为 worker 经 tracer Job 完成回调驱动的独立编排命令——绝不回退成"前端轮询 workflow 拼投影"。
- **变相双写（D06 红线）**：workflow 上的 `composedAsset` 与包内 generated asset 并存不是双写——workflow 是内部执行/恢复/审计对象（ADR-0011 责任边界），包是唯一成品事实；红线是禁止再把成片写进旧 `contents` / `creativeContents`，测试已设防回断言。
- **重复落包/重复版本**：execute/reconcile 与 worker 重启天然会重放完成路径。控制：`workflowId + compositionKey` 幂等键 + "只查询不重复版本"契约测试；违反即十条状态契约失败。
- **状态映射长成第二状态机（D14）**：视频 workflow 六态到包三档用语的映射只存在于包状态机的命令推进里，前端与手机不得各自再推导。控制：内容库状态一律读包投影；code review 检查 `video-workflow-model.ts` 未被内容库 import。
- **完成时刻商户不可见的中间态**：worker 完成与包投影失效之间存在秒级延迟，商户可能短暂看到"创作中"但面板已播放成片。接受为最终一致（既有轮询节奏内收敛），不为此加推送通道。
- **回退方案**：功能开关只控制"视频 confirm/完成是否写包"；关闸后回到现状（面板内联播放），已创建的包、版本与导出事实由新链路保留并继续可查，不删除、不用旧快照覆盖（spec §9 回滚原则）。旧工作台播放路径全程保留，回退零损失。
