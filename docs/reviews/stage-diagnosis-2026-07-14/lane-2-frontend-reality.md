# 阶段性回头诊断 · Lane 2：前端"真产品界面/可用功能" vs "演示壳/代码复现"

> **范围**：只诊断前端 `mkfast-template-main/src/`（product/ 72 文件、p1/ 19 组件、routes/ 页面）——逐组件核查"接了真实后端数据的可用功能"vs"sample/mock/seed/demo 驱动的演示壳"，逐条商家核心链路判 L1/L2/L3，并给出"看着完成实则演示"的 file:line 例证。不改码，只诊断。
>
> **站位**：本报告站在 `docs/reviews/uiux-productization-gap-report-2026-07-13.md`（下称"07-13 差距报告"）与同目录 `lane-1-tech-stack.md`（后端执行面）之上，只诊断"增量与现状"。**核心增量：07-13 差距报告评审的固定点早于 `daa9081`（2026-07-13 23:21 "complete UIUX upgrade B tickets"）+ T1-T7 视觉冲刺，其列出的绝大多数前端 P0/P1（流式缺失、结果区无缩略图、i18n 中英混杂、品牌残留、视频零接线、⌘K 非全局、估时硬编码）在这批提交里已被系统性修复。** 本报告以 HEAD（`22a9d4e`）为准，逐条标注哪些旧结论已被推翻、哪些仍成立、以及推翻后暴露出的**真正**当前短板。
> 状态：历史诊断快照；当前代码与决策以仓库 HEAD 和 07-decision-log.md 为准。

---

## 一、现状实证

### 1.1 组件盘点：45 个 tsx 视图 + 27 个 model/test，绝大多数已接线消费

product/ 目录 72 个文件不是 72 个 UI 组件——是 **45 个 `.tsx` 视图 + 27 个 `.ts`/`.test` 模型与测试**（`ls product/*.tsx | wc -l = 26`，加 p1/ 19 个 tsx = 45）。这是健康的"视图—模型分离"结构，不是堆砌。

关键反转：07-13 差距报告的头号根因是"已建未接线"（video_workflow、AiImageSelector、TemplateCatalog、RetrievalSearch、⌘K 全零 JSX 消费者）。**在 HEAD 上，这些几乎全部接线了**：

| 组件 | 07-13 报告状态 | HEAD 现状（证据） |
|---|---|---|
| copy 流式（CopyCandidateStream） | 不存在 | `copy-stream.tsx` 新建，`unified-creation-workbench.tsx:68-70,710,1890` 主路径 JSX 消费 |
| 副驾对话（CreationAssistant / useChat） | 不存在 | `creation-assistant.tsx:1,310` `useChat`，`workbench:59,1444` 消费 |
| 视频成片工作流 | 前端零引用 | `creative-object-page.tsx:24,76` + `mobile-action-book.tsx:77,1426` 消费 `video-workflow-panel` |
| 自动轮询 refetchInterval | 全站 0 命中 | `creative-job-observer.ts:149,233,333` + `video-workflow-panel.tsx:119` |
| 异步任务中心浮标 | src 中无 | `async-task-center.tsx` 挂到全局外壳 `sidebar-layout.tsx:94` + `dashboard-sidebar.tsx:75` |
| 真实媒体缩略图/lightbox | 结果区零 `<img>` | `canonical-media-gallery.tsx:112-142` 真 `<img>`/`<video>`+lightbox+onError 兜底 |
| ⌘K 全局面板 | 局部挂在 CreationShelf | `global-command-palette.tsx:372` `GlobalCommandProvider` 全局 Provider |
| 示例店终态 | 前端零消费 | `example-store-preview.tsx` 被 `workbench` + `mobile-action-book` 消费 |

**结论：前端"代码复现→产品接线"这一步在 07-13 晚已大幅推进。** 07-13 差距报告的"组件写了没接进主路径"批评，对当前 HEAD 基本不再成立。

### 1.2 真实数据链路：通的——这是本 lane 最需要澄清的一点

07-13 差距报告 P0-3 断言"结果区与历史区不渲染成品缩略图"。逐链核查后，**真实数据链路是完整接通的**，07-13 结论已过期：

- **结果区**（`workbench:2114-2153`）：`hasPersistedResult && currentAssets.length > 0` 分支用 `CanonicalMediaGallery` 渲染真实 asset。
- **media src 解析**（`canonical-history-model.ts:164-170`）：`src: /api/core/p1/assets?objectKey=<真实objectKey>`——从真实 asset 的 `objectKey` 拼真实 BFF 端点。
- **BFF 代理存在**（`routes/api/core/p1/assets.ts`）+ **后端端点存在**（`apps/core/src/server.ts:632-665` `/v1/assets/` 带 workspace 越权校验）。
- **资产/历史路由全部真委托**：`assets.tsx:9`→`CanonicalHistoryPage mode="assets"`、`jobs/sessions/works/recent` 同构、`tasks.tsx:18`→`OperationsTaskPage`，全部接 `useProductState` 真实投影，无空壳。

即：给一个真实跑通的 Job→Asset，前端**会**渲染真实缩略图、点开 lightbox、失败有 retry。渲染管道不是短板。

### 1.3 演示壳的真相：43 张 seed 图 = 硬编码静态映射的"空态装饰墙"

这是本 lane 的**核心发现**，也是任务点名要"特别标出"的 R2 冲刺塞进去的种子图。`public/seed/` 下 43 张 `.webp`（asset/template/preset/scene/store/model/hero/video 八类），全部通过**前端硬编码映射表**贴进界面，与后端数据无关：

- **历史/资产空态装饰墙**（`canonical-history-page.tsx:115-146`）：`ASSET_GALLERY_PREVIEW` 8 个写死文件名 → `<img src={/seed/asset/${name}.webp}>`，且整块 `aria-hidden="true" pointer-events-none select-none opacity-75`——**这是当 `items.length===0`（真实资产为空）时铺的一面装饰墙**，右下角贴"示例"角标。看着像"资产库满是作品"，实则一张真实用户资产都没有。
- **内容库空态画廊**（`routes/dashboard/content.tsx:57-66`）：`sampleGalleryCovers` 6 张 seed 图，源码注释自证 `Decorative gallery preview for the empty content library — dimmed, marked with the shared "Example" badge`。
- **示例店贴图**（`example-store-preview.tsx:22-33`）：`EXAMPLE_ASSET_PREVIEW_BY_ID` / `EXAMPLE_CONTENT_PREVIEW_BY_ID` 把 `example-asset-1..4`、`example-content-1..3` 硬编码映射到 `/seed/store/*.webp`。
- **场景 chips 贴图**（`creation-entry-model.ts:107-158`）：`sceneChipGroups` 8 个场景 chip 的 `imageUrl` 全是 `/seed/scene/*.webp` 写死。
- **任务收件箱贴图**（`content-task-inbox.tsx:437-441`）、**模板画廊**（`template-catalog.tsx` 6 处 `/seed/template/`）、**模型预览卡**（`model-preview.ts:3` `/seed/model/`）同理。

**定性**：seed 图有明确的诚实边界设计（`aria-hidden` + "示例"角标 + 注释标 Decorative），**不是"假装真实用户数据"的欺骗**——这点要给团队公道。但它造成的产品阶段错觉是真实的：**首屏、空态、场景卡、模板卡的所有"成品视觉"都来自这 43 张静态图，没有一张来自真实生成。** 一个真实商家零配置打开产品，看到的"琳琅满目"全是装饰层。

### 1.4 流式是"真 AI SDK"，但默认档位跑的是 fixture 假流

07-13 差距报告 P0-1"副驾对话与文案生成缺 token 级流式"已被推翻——**后端是真 Vercel AI SDK v7**：

- `ai-sdk-runner.ts:14` `import { streamText, generateObject, ... } from 'ai'`，`:60` `OpenAiCompatibleAiSdkRunner` 用 `createOpenAICompatible`（`:67`）直连 provider，`:151` `streamText` + `:157` `Output.object` 做部分对象流式，`:163` `toTextStreamResponse`。
- 前端 `copy-stream.tsx:1,50` `experimental_useObject`（`@ai-sdk/react`）订阅 `/api/core/p1/copy/stream`；`creation-assistant.tsx:310` `useChat` 订阅 assistant 流。
- 依赖真装了：`package.json` `@ai-sdk/react 4.0.23` / `ai 7.0.19` / `streamdown 2.5.0` / `@streamdown/cjk 1.0.3`（07-13 报告说"三库 0 采购"已过期）。

**但——真流式只在生产档位通，默认档位是 fixture 假流**（这是最关键的当前事实，与 lane-1 同构）：

- `main.ts:141-146`：`aiStreamingRunner` = `mode==='fixture'` → `FixtureAiStreamingRunner`；否则 `activation==='live_verified' && direct` → 真 `OpenAiCompatibleAiSdkRunner`；**否则 `undefined`**。
- `.env.example:13-15` 出货默认 `APP_ENV=e2e` + `MODEL_EXECUTION_MODE=fixture` → 克隆即跑 `FixtureAiStreamingRunner`。
- `FixtureAiStreamingRunner.startCopyStream`（`ai-sdk-runner.ts:303-329`）返回**写死的 6 段中文 chunk**（`:308-315` `'{"candidates":[{"title":"透亮猫眼｜真实到店记录"...'`），用 `setTimeout` 每 200ms 吐一段，模拟逐字流。`streamAssistant`（`:209-301`）同理，`createUIMessageStream` 手工 `writer.write` 写死旁白"我先按当前创作意图整理重点…"。
- 默认 `recorded` 档位（非 e2e）：`aiStreamingRunner=undefined` → copy/stream 端点 `server.ts` 抛 `COPY_STREAM_UNAVAILABLE` 503（`:551`）→ 前端 `copyStream.onError` 显示"stream interrupted"（`workbench:711`），**无本地降级到非流式路径**。

即：**流式外壳是真的、AI SDK 接线是真的，但商家开箱体验到的"逐字浮现"是 fixture 写死文案的定时吐字，不是真模型输出。** 真模型流式（`direct`+`live_verified`）在前端从未被证明跑通过（lane-1 P0-2：无 CI 内 live 证据）。

### 1.5 降门槛层（07-13 点名 CheckBox 模式）已大幅落地

07-13 差距报告点名的两处（流式见 1.4）中"CheckBox 模式/降门槛"也已推进：

- **真上传**（`composer-image-input.tsx:258-284`）：`onDrop`/`onPaste`/`capture="environment"`/真 `uploadItem` async——07-13 P2"本机文件仅 file-pick 不上传"已修。
- **场景 chips 一点即填**（`creation-entry.tsx:122,132-141` `fillEditableIntent`）+ **开场建议**（`:127` `openingSuggestions` 按真实 asset/task 信号生成）+ **选中预设隐藏提示词框**（`:190` `selectedPreset` 分支）——07-13 P1-5/P1-8 大部分已修。
- **估时不再硬编码**（`creative-quote.ts:32-68` `quoteFor` 取 `model.unitPrice`，删了 12/45/90s 常量）+ **后端真实估时源**（`workbench:597` `durationEstimateView(selectedModel.durationEstimate)`，后端 `foundation-module.ts:746` `durationEstimateFromSamples` 从样本算）——07-13 P1-3"90s vs 18min 差一个数量级"已修。
- **i18n 全接入**（product/+p1/ 71 文件 import paraglide messages、硬编码中文 0 文件、`project.inlang/settings.json:3` `baseLocale=zh`）——07-13 P0-2/P1-11 已修。
- **TanStarter 品牌残留**：product/p1/layout/config 层 grep `tanstarter|built-with|mkfast|mksaas` = 0——07-13 P0-2 已修（营销页残留未在本 lane 范围复核）。

**仍缺**（07-13 承接的"CheckBox 完整层"）：CreatOK A+ 式"成套结构模块多选构建器"（`grep 套组/成套/moduleCombination` 仍 0 业务命中，`workbench` operation 仍大按钮单选）——但 `workbench:1096,1516` 出现 `availableContentModules` / `availableModules`，说明"内容模块"骨架已埋，需进一步核查是否为真多选构建器（本 lane 未展开，留 lane-3 竞品对标）。

---

## 二、缺陷清单（带严重度）

### P0-1 · 默认开箱体验 100% 是 fixture 假数据流 + seed 装饰图，无一处真实生成产物

- **现状**：`.env.example` 出货 `MODEL_EXECUTION_MODE=fixture`，克隆即跑 `FixtureAiStreamingRunner`（写死 6 段 chunk 定时吐字，`ai-sdk-runner.ts:308-315`）；首屏/空态/场景卡/模板卡的全部成品视觉来自 43 张硬编码 seed 图（`canonical-history-page.tsx:115-146` 等）。真实商家零配置打开，看到的每一个"作品"都是装饰层或写死 fixture，**没有一个字、一张图来自真实模型**。
- **失败场景**：邀请制封闭 Beta 商家首次登录 → 看到"资产库满墙作品"（实为 aria-hidden seed 装饰）+ 生成文案逐字浮现（实为 fixture 写死"透亮猫眼｜真实到店记录"）→ 误判产品已就绪 → 用真实门店信息生成 → 若 shell 未配 `direct`+`live_verified`，copy/stream 返 503"stream interrupted"，图片/视频因 `MODEL_MEDIA_EXECUTION_MODE=disabled` 提交按钮禁用（lane-1 P1-1）。**演示态与可用态之间有一道商家看不见的悬崖。**
- **严重度 P0**：这是本 lane 与 lane-1「fixture 掩盖最难部分」在前端的同构投影。前端把 fixture/seed 的保真度打磨到"看着像 L3 成品"，反而放大了"看起来完成"与"真实接通"的落差。

### P0-2 · 真流式在前端从未被证明——所有可见的"流式"都是 fixture 定时器

- **现状**：真 `streamText`/`generateObject` 路径（`OpenAiCompatibleAiSdkRunner`）只在 `mode!=='fixture' && activation==='live_verified' && direct`（`main.ts:143-145`）下装配；`.env.example` 默认 fixture + 无 `MODEL_DIRECT_*` 配置。前端 dogfood/E2E 全程跑 fixture（`docs/evidence/uiux-upgrade-b/acceptance-report.md:18` 自证"fixture 不能证明真实供应商调用/耗时/生产可用性；截图存在不等于测试通过"）。
- **失败场景**：验收看到"逐字流式"截图 → 误判 P0-1 流式承诺已兑现 → 实际真模型 SSE 透传（跨 Workers 壳）稳定性、中文 Streamdown-cjk 逐字无乱码（Week-1 spike 第 5 题）从未在真 provider 上验证过一次。
- **严重度 P0**：流式是"第一眼价值第一信号"（CONTEXT / 合集定稿反复钦定），而它当前的证明强度 = fixture 定时器。`docs/evidence/uiux-upgrade-b/wrangler-streaming-proof.md` 存在但需核查其是否为真 provider（本 lane 未展开，建议 lane-1/验收方交叉核）。

### P1-1 · seed 装饰墙无"空 vs 满"的商家心智引导，易被误读为真实存量

- **现状**：`AssetGalleryPreview`（`canonical-history-page.tsx:126-147`）在真实资产为 0 时铺 8 张 seed 图 + "示例"角标，但主 `WarmEmptyState`（`:162-198`）与这面装饰墙在同一视口并列。角标"示例"是唯一区分信号，字号 `text-[10px]`。
- **失败场景**：商家看到满屏缩略图 + 角落小字"示例" → 第一印象是"这里已经有很多素材"，而非"这是空的、这些是范例"。演示感盖过了空态引导。
- **严重度 P1**：诚实边界（aria-hidden/角标/注释）已做，但视觉权重失衡削弱了"邀请首次创作"的空态本意。

### P1-2 · "成套结构模块多选构建器"（CreatOK A+ 范式）仍未见真多选构建

- **现状**：`grep 套组/成套/moduleCombination/bundle/suite/combo` 于 product+p1 零业务命中；主 Composer operation 仍是大按钮单选（文案/图片/视频）。`workbench:1096` `availableContentModules`、`:1516` `availableModules` 出现但未核实是否真"提交前勾选组合成套结构 + 默认勾选核心项 + 成套预览"。
- **失败场景**：商家想一次产出"封面+价格卡+种草文"成套内容，只能大按钮逐个单发，与 CreatOK A+ 16 模块默认选 5 的成套构建体验有代差。
- **严重度 P1**：07-13 点名 CheckBox 模式的"数据流机制"部分，属明显落后但有替代路径。

### P2-1 · 部分组件仍有"已建未挂主路径"残留（收敛中，非系统性）

- **现状**：`RetrievalSearch`（`retrieval-search.tsx`）、`AiImageSelector`（`ai-image-selector.tsx`）等是否已进核心创作路径需逐一核（07-13 报告称零消费者，本 lane 已确认 video_workflow/example-store/⌘K/media-gallery 均已接线，但未逐一复核全部 19 个 p1 组件）。
- **严重度 P2**：即便有残留也是个位数，不再是 07-13 时的系统性问题。

---

## 三、阶段判定

统一标尺（L0 脚手架能跑 / L1 demo 能演示 / L2 真实商家可端到端用 / L3 商家易用），本 lane 只对"前端界面 + 可用功能"这一纵切判定：

| 前端维度 | 判定 | 依据 |
|---|---|---|
| 组件工程完成度 / 接线 | **L2-就绪** | 45 视图已系统性接线，07-13"已建未接线"P0 群基本清零；视图—模型分离结构健康 |
| 真实数据渲染管道 | **L2-就绪** | CanonicalMediaGallery 真 img/video+lightbox+兜底；BFF 代理+后端端点+路由委托全通，真数据会真渲染 |
| 流式/生成式 UI 外壳 | **L2-外壳就绪，真流未证明** | 真 AI SDK v7（useObject/useChat）已接主路径；但默认档位跑 fixture 定时器假流，真 provider 流式前端零证明 |
| 降门槛交互层 | **L1→L2 过渡** | 真上传/场景chips/预设隐藏提示词/真实估时/i18n 已落地；成套多选构建器仍缺 |
| 默认开箱可用性 | **L1-演示壳** | 100% fixture 假流 + seed 装饰图；无一处真实生成产物；演示态↔可用态有隐藏悬崖 |
| 商家核心链路端到端（真数据真产出） | **L1→L2 之间，未证明 L2** | 链路各段前端都在，但从未有一条真实商家路径（真模型→真Asset→真Content→真L3包）被前端证明跑通 |

**本 lane 综合判定：前端处于 "L2 界面就绪 / L1 真实体验" 的分裂态。**

前端不是这个产品的短板——组件工程扎实、接线到位、真实渲染管道完整，07-13 差距报告的绝大多数前端 P0/P1 在 `daa9081`+T1-T7 里被真实修复了，这是实打实的进步。**真正卡在 L2 门槛上的是"界面完成度"远超"真实体验完成度"**：所有能让商家"第一眼觉得可用"的东西（逐字流式、满墙缩略图、成品画廊、场景卡）当前都由 fixture 定时器 + 43 张静态 seed 图供给，而真实商家路径（真模型流式、真媒体生成、真端到端闭环）在前端一次都没被证明过。这与 lane-1「Done 语义坍缩」「fixture 掩盖最难部分」、07-13 差距报告「验收只验功能存在不验接进主路径/体验质感」在前端层完全同构——只是这一轮，团队把"演示壳"本身打磨到了 L3 保真度，反而让悬崖更隐蔽。

**一句话**：前端已经不是"停留在代码复现阶段"（那是 07-13 的判断，已过时）——它停在"演示壳做到了以假乱真，但真实商家从未端到端用过一次"的阶段。下一步的关键不是再补组件，而是让**一条**真实链路（真商家档案→真模型→真产出→真 L3 包）在前端被证明跑通，并把 fixture/seed 与真实态的边界在商家心智里显式化。

---

## 四、增量建议

1. **打通并录制一条真实端到端链路**（最高优先）：配 `MODEL_EXECUTION_MODE=direct` + `MODEL_DIRECT_*` + `MODEL_MEDIA_EXECUTION_MODE=ark` + 通过 `RUN_LIVE_MODEL_PROVIDER_TEST=1`，在前端走完"示例店 remix → 真模型流式文案 → 真 Ark 图/视频 → 真 Asset 入库 → 真 L3 发布包"，截图/录屏归档为 L2 证据。这是把本 lane 从 L1→L2 的唯一硬门槛，且它同时兑现 lane-1 P0-2。

2. **让 fixture/seed 与真实态在商家心智里显式化**：默认档位下给全局一条"当前为演示数据"的持久提示；`AssetGalleryPreview` 装饰墙提高"示例"标识视觉权重（或首次真实创作后自动隐藏），避免"满墙作品"错觉盖过空态邀请。

3. **给 recorded 档位一条无凭据可跑的真实闭环 seed 通道**（承接 07-13 P0-7 遗留）：让新克隆者在不配 provider 的前提下也能体验"真实持久化"的闭环（Job→Asset→Content 真入库，仅 provider 输出为占位），并显式标"本地测试可用"，与生产 `live_verified` 门禁隔离。

4. **完成 CheckBox 成套构建器**：核实 `availableContentModules` 骨架，落成"提交前多选组合 + 核心项默认勾选 + 成套结构预览"，对齐 CreatOK A+ 范式（可与 lane-3 竞品对标联合裁决）。

5. **逐一清点剩余 p1 组件挂载状态**：确认 `RetrievalSearch`/`AiImageSelector` 等是否已进主创作路径，未挂的要么接线要么裁撤，杜绝 07-13 式"已建未接线"回潮。

---

### 附：对 07-13 差距报告前端结论的增量校正（本 lane 范围内）

| 07-13 旧结论 | 出处 | HEAD（22a9d4e / daa9081）校正 |
|---|---|---|
| 副驾对话与文案缺 token 流式，12 秒白屏 | P0-1 | **已推翻**：真 AI SDK v7 `useObject`/`useChat` 接主路径；但默认档位跑 fixture 定时器假流，真流未证明 |
| TanStarter 品牌全站残留 | P0-2 | **产品层已修**（grep=0）；营销页残留本 lane 未复核 |
| 结果区/历史区不渲染成品缩略图 | P0-3 | **已推翻**：CanonicalMediaGallery 真渲染+lightbox+兜底，真实链路通 |
| AI 展示组件库全线未采购 | P0-5 | **已推翻**：streamdown 2.5.0 / @streamdown/cjk 1.0.3 已装并用于 StreamingAiMarkdown |
| 长任务无自动轮询无推送 | P0-6 | **已推翻**：creative-job-observer refetchInterval + 全局 AsyncTaskCenter 浮标 |
| 默认 recorded 开箱闭环跑不通 | P0-7 | **部分推翻**：默认已切 fixture 可跑闭环；但跑的是假流+seed，真实体验仍 L1 |
| Vercel AI SDK 栈选型落空 | P1-1 | **已推翻**：前后端均真 import ai/@ai-sdk/react |
| 视频成片前端零接线 | P1-2 | **已推翻**：creative-object-page + mobile-action-book 已消费 video_workflow |
| 估时硬编码 90s | P1-3 | **已推翻**：quoteFor 取真实 unitPrice + 后端 durationEstimateFromSamples |
| 无全局异步任务中心浮标 | P1-4 | **已推翻**：AsyncTaskCenter 挂全局外壳 |
| ⌘K 非全局 | P1-6 | **已推翻**：GlobalCommandProvider 全局挂载 |
| i18n 中英混杂 71 文件零接入 | P1-11 | **已推翻**：71 文件已接 paraglide，baseLocale=zh，硬编码中文=0 |
| 成套模块多选构建器缺失 | P1-7 | **仍成立**（本 lane P1-2）：骨架或已埋，真多选构建未证 |
| seed 图 = 空态装饰演示 | 材料E / T1 | **仍成立且需强调**（本 lane 核心 P0-1/P1-1）：43 张静态图供给全部"成品视觉" |
