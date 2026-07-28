# 票 03 · 已建未挂能力清点：逐项接线/裁撤裁决表
> 阶段: Phase 0 · 共同前置 ｜ 差距: P0-3、P0-6、P1-2、P1-8、P1-9、P2-3 中列举的未接线能力 ｜ 决策依据: ADR-0010

<!-- decision-ticket-map:start -->
```json
{
  "ticketId": "03",
  "decisionIds": [
    "DEC-PATH-B"
  ],
  "guardrailDecisionIds": [],
  "gapIds": [
    "P0-3",
    "P0-6",
    "P1-2",
    "P1-8",
    "P1-9",
    "P2-3"
  ],
  "contractIds": [
    "I01"
  ],
  "blockedBy": [],
  "closureEvidence": [
    ".scratch/uiux-upgrade-b/tickets/03-built-unwired-adjudication.md",
    ".scratch/creatok-uiux-wayfinding/assets/current-product-screenshots/08-content-library-desktop-live.jpg",
    ".scratch/creatok-uiux-wayfinding/assets/screenshots/09-gallery-desktop-live.jpg"
  ],
  "status": "closed"
}
```
<!-- decision-ticket-map:end -->

## 差距锚点

- 根因是“组件/后端能力存在”被当成完成，主路径却没有消费者：核心入口仍是 `/dashboard` → `UnifiedCreationWorkbench`，验收必须回到商家能否在此看见、操作并拿到结果。
- P0-3：结果区、历史区、Asset 详情只显示标题、ID、`objectKey`/SHA，已有媒体读取链路和 `AiImageSelector` 成品图预览未进入主路径。
- P0-6：运行中 Job 仍靠“核验原 Job 进度”按钮触发整包刷新；已有单 Job 查询未被前端消费。实核纠偏：报告升级文案提到的 `streamRunEvents` 当前全仓不存在，不列为“已建未挂”，事件流建设仍归票 09。
- P1-2：`video_workflow_create_draft/confirm/select_candidate/cancel`、查询与 worker 已接后端，前端零 `video_workflow` 消费；旧同步 render 路径仍在。
- P1-8/P1-9：`AiImageSelector`、`TemplateCatalog`、`RetrievalSearch` 仅由 `p1/index.ts` 导出；模板缩略图层可复用，模型卡仍是纯文字，不能把“组件存在”误报成视觉卡达标。
- P2-3：只读 `exampleStore` 已随 ProductState 返回，主工作台却明确渲染“没有示例”，形成后端实现、前端空态、spec 三方断裂。
- 锁定边界：D3 保持“对话式外壳、结构化内核”，不做 chat clone；D4 仍为 3 选 1 单选；L-1 链接抓取不复活；模型必须显式选定，禁止跨品牌 Auto。

## 现状代码入口（实核 file:line）

| 能力 | 当前入口与未挂证据 | 裁决 / 承接票 |
| --- | --- | --- |
| 成品媒体读取与预览 | `apps/core/src/server.ts:418-469` 提供 workspace 隔离的 `/v1/assets/*`；`mkfast-template-main/src/routes/api/core/p1/assets.ts:4-8`、`src/lib/core-client.ts:197-253` 已有 BFF；但结果卡 `src/product/unified-creation-workbench.tsx:1045-1105`、历史卡 `src/product/canonical-history-page.tsx:69-110` 与 Asset 详情 `:254-284` 不渲染媒体 | **接线**；票 17 统一按 `asset.kind` 渲染缩略图/视频封面与 lightbox，不以另一套 Job 卡旁路代替 |
| 单 Job 查询 | `apps/core/src/p1/model-supply/foundation-module.ts:2048-2052` 已有 `model-supply/job`；通用客户端 `mkfast-template-main/src/p1/client.ts:34-63` 可查询；主工作台只整包取投影 `src/product/unified-creation-workbench.tsx:225-250`，运行态仍手点 `:1005-1020` | **接线**；票 09 以 `currentJob.providerJobId` 轮询单 Job，终态仅一次回收进 Operations 投影；不得伪造百分比 |
| durable 视频成片 | `apps/core/src/p1/model-supply/foundation-module.ts:1917-1946,2082-2091` 暴露命令/查询；`composed-video-workflow.ts:49-169` 落 durable service；`job-worker.ts:225-240,307-310` 注册 worker | **接线**；票 16 接入分镜确认、单选候选、取消、离页后回收；同步旧轨 `apps/core/src/server.ts:731-918` 同票退役。产品默认固定为每镜 `candidatesPerShot=1`，落实 ADR-0008 后述的 `video single-shot + free retry`；D5 的 N→1 保留为显式多候选运行的工程评测能力，Core 继续支持 1–8，不在默认体验并发增费 |
| `AiImageSelector` | `mkfast-template-main/src/p1/ai-image-selector.tsx:65-186` 有显式模型 Radio 卡，`:198-217` 又自带提示词框，`:234-307` 有 Job/成品预览；仅 `src/p1/index.ts:1` 导出，routes/product 无消费者；卡片无缩略图 | **接线（收窄复用）**；票 15 把模型选择层改成带预览图/标签/额度的单选卡并挂 Composer；不原样挂载重复提示词/Job 壳，保留“无跨品牌 Auto” |
| `TemplateCatalog` | `mkfast-template-main/src/p1/template-catalog.tsx:283-317` 是独立目录，`:374-426` 已有缩略图画廊；仅 `src/p1/index.ts:9` 导出。现主路径已用 `src/product/creation-shelf.tsx:127-145,192-241` 取同一 catalog，但只呈现文字/图标入口 | **接线（合并而非双目录）**；票 13/15 将现有缩略图卡合入 `CreationShelf`/Composer，选中命名预设后隐藏意图框，并显示“该传什么图” |
| `RetrievalSearch` | `mkfast-template-main/src/p1/retrieval-search.tsx:78-121,123-239` 是独立结构化检索 UI；后端 `operations/search` 可服务专门搜索页，但票 20 的全局 palette 只需现有 `canonical_history` 与统一创作目录 | **裁撤独立 palette 接线**；不挂载第二套 `RetrievalSearch` 组件。票 20 以 `canonical_history` 承担 Task/Session/Job/Work/Asset 导航，以统一创作目录承担模板/工具/素材带入；`operations/search` 保留给专门搜索页，不复制进全局 palette，也不抓 URL |
| `exampleStore` | `apps/core/src/product/product-service.ts:109-134` 已建只读“弥鹿美甲示例店”及 4 素材/3 内容卡/1 发布包，`:191-197` 随状态归一化；前端已取 ProductState `mkfast-template-main/src/product/unified-creation-workbench.tsx:238-241`，却在 `:682` 明示无示例 | **接线**；票 21 仅在真实 E0 且 `hidden=false` 时渲染只读终态与“看示例·做同款”，不得混入真实历史 |

行号漂移核对：报告对 `AiImageSelector:254`、`TemplateCatalog:218/385`、`product-service.ts:113`、工作台 `573-581/744/782-793/1005-1020/1045-1105` 的锚点当前仍准确；`streamRunEvents` 为报告叙述与当前代码不一致，以上以实核入口为准。

## 改造方案（步骤级 + 涉及文件清单）

1. 固化唯一去向：以上七项全部“接线”，但 `AiImageSelector`/`TemplateCatalog` 采用收窄或合并，禁止再造平行模型选择器、模板目录、Job 卡或检索台。
2. 票 09 接单 Job 查询：运行态按 `providerJobId` 轻量轮询；页面离开/组件卸载即停；发现终态后触发一次既有 `resume_creative_job` 回收 Asset/Content，再停轮询。轮询只展示真实状态和白话阶段，不由时间推算百分比。
3. 票 13/15 接预设与视觉卡：复用 `TemplateCatalog` 缩略图呈现和 `AiImageSelector` 显式单选语义，数据统一来自现有 catalog；命名预设必须携带输入素材提示，选中后隐藏提示词/意图编辑区。模型卡不提供跨品牌 Auto。
4. 票 16 接 durable 视频：Composer 创建 draft → 用户确认分镜 → 提交后台 Job → 需要时逐镜头单选候选 → 完成/失败自动回收；确认新轨可见后删除旧同步 render 的前端调用与服务端路由。产品默认每镜单候选（`candidatesPerShot=1`）并以免费重试形成新一轮尝试；显式多候选运行仍可使用 Core 的 N→1/人工复核能力。
5. 票 17 接媒体读取：从 canonical Asset 的 `objectKey/kind` 生成同源 BFF URL，结果、历史、Asset/Content 详情共用同一媒体卡与 lightbox；错误态显示可理解占位，不泄漏对象键作为主内容。
6. 票 20 不接独立 `RetrievalSearch` 壳：全局 ⌘K 的导航组读取 `canonical_history`，添加组读取统一创作目录；专门搜索页可继续使用 `operations/search`。两组共享稳定深链/带入适配，不复制检索状态机。
7. 票 21 接示例终态：严格以真实工作区无 Task/Work/Asset/Content 且 `exampleStore.hidden=false` 为门槛；示例全程只读，做同款只复制必要模板/结构，不复制示例为真实事实。

涉及文件清单（承接票按职责修改，票 03 本身不改代码）：

- 前端主路径：`mkfast-template-main/src/product/unified-creation-workbench.tsx`、`creation-shelf.tsx`、`canonical-history-page.tsx`。
- 前端已建能力：`mkfast-template-main/src/p1/ai-image-selector.tsx`、`template-catalog.tsx`、`retrieval-search.tsx`、`operations-view-model.ts`、`client.ts`、`index.ts`。
- 路由/BFF：`mkfast-template-main/src/routes/dashboard/search.tsx`、`src/routes/api/core/p1/assets.ts`、`src/lib/core-client.ts`。
- 后端接线/退役：`apps/core/src/p1/model-supply/foundation-module.ts`、`composed-video-workflow.ts`、`apps/core/src/job-worker.ts`、`apps/core/src/server.ts`、`apps/core/src/product/product-service.ts`。

## DoD（全部必须是用户可见行为；至少 1 条截图对照项：当前产品 vs 对标产品）

- 商家在主创作路径能看到带缩略图、用途标签和额度信息的模板/模型卡；模型为显式单选，界面没有跨品牌 Auto。
- 商家点选命名预设后，提示词/意图编辑框从界面消失，只保留该预设所需的传图指引、素材入口与生成动作。
- 商家提交图片或视频长任务后无需点击刷新：离页再回来仍能看到真实阶段，完成后成品自动出现；界面不展示由计时器伪造的百分比。
- 商家完成视频的可见动线是“确认分镜 → 后台生成 → 必要时单选候选 → 成片回收/可取消”，浏览器不再被一次 18 分钟请求占住；D4 文案候选仍是 3 选 1 单选。
- 商家在结果区、作品历史、资产库与详情页能直接看到图片缩略图或视频封面，点击可预览，不再以 Asset ID、`objectKey` 或 SHA 代替成品。
- 商家在搜索页或 ⌘K 输入同一关键词能看到当前 workspace 的任务、素材、内容、模板结果并打开/带入创作；界面没有“贴链接抓取”入口。
- 新空工作区可见只读“弥鹿美甲示例店”终态和“看示例·做同款”；一旦产生真实对象，示例不混入真实历史、统计或资产库。
- 截图对照：同尺寸并排提交当前产品 `assets/current-product-screenshots/08-content-library-desktop-live.jpg` 与对标 `assets/screenshots/09-gallery-desktop-live.jpg`（基准目录均为 `.scratch/creatok-uiux-wayfinding/`），并补一张升级后同路由截图；对照中须肉眼可见“纯文字卡 → 成品缩略图画廊”的变化。

## Blocked-by / Blocks

- Blocked-by：无。
- 全局关票闸：票 02 完成前，本票不得关票。
- Blocks：票 13、15、16、21；它们必须沿用本表的“接线/合并/退役”裁决，不得另建平行能力。
- 非阻断交接：单 Job 查询交票 09，成品媒体链路交票 17；票 20 沿用本票最新裁决，不挂载独立 `RetrievalSearch`。若承接票再次改变去向，必须回 ADR-0010 重裁，不得静默搁置。

## 风险与回退

- 风险：直接整块挂载 `AiImageSelector` 会复制 Composer 的提示词与 Job UI，破坏 D3。回退：仅保留显式模型卡数据/交互，恢复现 Composer；不回退到跨品牌 Auto。
- 风险：整块挂载 `TemplateCatalog` 会与 `CreationShelf` 形成两个目录、两套快捷位。回退：撤下新画廊壳但保留单一 catalog 数据与原文字入口，随后按合并方案重做。
- 风险：轮询读到 provider 终态但 Operations 投影未回收，造成“已完成仍 running”。回退：停自动回收并恢复“核验原 Job”显式按钮作为临时降级；不得制造本地完成态。
- 风险：媒体 URL 权限、过期或格式异常导致破图。回退：显示带“重新载入/打开详情”的媒体占位，保留 workspace 隔离；不得直接暴露 core URL 或放宽 objectKey 校验。
- 风险：示例数据污染真实对象与指标。回退：隐藏示例区并保留真实 E0，不删除后端只读种子；禁止把示例写入 canonical 历史。
- 风险：视频新旧轨并存产生重复扣费/重复 Job。回退：回滚到单一旧轨，保留新轨状态数据用于排障；确认单轨后再清旧路由，绝不双投。
