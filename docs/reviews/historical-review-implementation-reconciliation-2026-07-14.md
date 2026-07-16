# 历史评审与当前产品完整度对账

> 状态：历史快照，固定点为 dfa599a。当前代码、票据状态与架构决策以当前 HEAD、CONTEXT.md、ADR-0011 和 2026-07-14 决策日志为准；本报告原始证据不改写。

- 日期：2026-07-14
- 分支 / HEAD：`main` / `dfa599a`
- 范围：`docs/reviews/`、`.scratch/` 中的 P1、模型供应、CreatOK UIUX、Path B 研究/决策/实施记录，以及当前代码、自动化测试和 `localhost:3000` 运行页面
- 当前结论：**旧 UIUX 25 项清单已经大面积实现，但产品仍未完整；缺口已经从“组件有没有”转移到规范对象续作、内容/资产/任务业务闭环、真实媒体与平台适配、同一候选验收和真实用户证据。**

## 1. 判定口径

本报告把容易混淆的状态分开：

| 状态 | 含义 |
|---|---|
| 已实现 | 当前代码已接入用户主路径，并有当前测试或可信的既有 E2E 证据；不自动等于可发布。 |
| 部分实现 | 本地 fixture/recorded、页面或状态机已成立，但真实供应商、真实设备、关键结构或业务下游仍缺。 |
| 未实现 | 锁定的用户行为没有主路径入口，或上下游使用两套事实，用户无法完成该业务结果。 |
| 历史/过期 | 结论描述的是旧快照，已被 remediation、后续代码或更新 ADR 覆盖。 |
| 待验收 | 实现可能存在，但尚未满足同一候选、外部对标、真实供应商/设备/用户证据，不能关票。 |

单测、组件存在、静态截图、fixture 和 commit 标题都不能单独证明“产品完成”。

## 2. 总结：为什么做了很多，产品仍不完整

### 2.1 窄口径：2026-07-13 的 24 条 UIUX gap + D4

- 已实现：**19 项**。
- 部分实现：**6 项**：P0-1、P0-4、P0-6、P1-1、P1-2、P2-5。
- 完全未实现：**0 项**。
- 但正式治理状态仍是：25 张票只关闭 01–03，04–25 共 **22 张仍 open**；I01–I12 **全部 pending / non-green**。

因此 `daa9081 feat: complete UIUX upgrade B tickets` 只能解释为一次 implementation dump，不能解释为验收完成。当前验收报告本身也明确区分实现证据、同一候选证据和真实运行证据，并拒绝用 fixture 代替后两者。

### 2.2 宽口径：原 CreatOK S0–S5 用户合同与当前真实业务链

以下并不在旧 24 条 gap 的完整覆盖范围内，且当前仍有真实断链：

1. **采用的 Content 进不了一级内容库**：工作台写入 Operations 的 `creativeContents`，`/dashboard/content` 读取另一套 `ProductState.contents`。用户在工作台“采用成功”后，不能在主内容库继续编辑、交接或发布。
2. **历史 Work / Session / Job 只有只读深链，不能从对象自身续作**：详情页提示检查设置或恢复，但只提供对象互链；主工作台固定取最新 Work。
3. **Task owning-context、状态与批次合同没有闭环**：部分来源只有文字；详情页将 `todo` 映射成“状态待识别”；详情没有处理动作；普通任务绑定 Work 后不自动进入进行中，周批次完成又会自动写 `done`；批次没有逐项模型/报价/合同审阅。
4. **生成 Asset 只是两套资产投影的拼接，不是完整资产治理对象**：能在资产库展示，但归档、恢复、回收站、引用保护等锁定生命周期未实现。
5. **真实图片/视频供应商执行一直未接入 P1 统一运行时**：当前 `direct` 只装配真实 LLM；图片/视频仍是 recorded/fixture media。ffmpeg 能合成输入片段，不等于用户能生成真实 AI 图片/视频。
6. **抖音正式 Publish/Observe Adapter 不存在**：当前生产装配仍是 `RecordedDouyinAdapter`，不是只补账号或 Key 就能启用。
7. **BYOK“密钥试用”没有使用用户密钥发起真实请求**：生产装配固定为 `RecordedByokExecutionAdapter`，成功结果是本地 `recorded:*`，页面却提示试用完成。
8. **模型偏好没有进入创作选模优先级**：设置页“本次使用”只写 `sessionStorage`，工作台不读取；用户/工作区默认也没有生产 resolve 调用，工作台直接挑目录中第一个可用且有价格的模型。
9. **S5 从未完成**：没有同一候选的完整验收、真实目标商家、真实设备、生产切换、首小时/24h/7d 观察证据。

这解释了用户当前感知：旧清单中的按钮、卡片、流式壳、画廊和任务浮标大多已经出现，但贯穿对象生命周期的“继续完成”与真实价值链仍断开。

### 2.3 S0–S5 当前阶段裁定

| 阶段 | 当前裁定 | 主要未闭环 |
|---|---|---|
| S0 基线 | 历史固定点有通过记录；当前 HEAD 未重新证明 | 当前候选的全量 E2E/build/真实环境基线。 |
| S1 壳、路由、共享合同 | 大部分实现 | 受信返回上下文没有生产接线；后台无概览且固定返回 Dashboard。 |
| S2 冷启动与统一创作闭环 | 最新 Work 主链已实现；历史对象部分实现 | Work/Session/Job 自身地址不能继续、恢复、重试或派生。 |
| S3 运营、复用、资产历史 | **未完成，是当前最大产品缺口** | Content 入库、Task owning-context/状态/批次合同、Asset 生命周期、Recent 聚合与筛选。 |
| S4 移动、发布、设置管理 | 页面外壳大部分实现；关键设置合同未闭环 | 模型偏好不控制创作、BYOK 不真实执行、真实图片/视频、抖音正式发布、管理概览/安全返回和真实设备证据。 |
| S5 验收、切换、观察 | **未完成** | 同一候选、live provider、真实目标商家、生产切换与观察。 |

## 3. 九份历史评审的当前有效性

| 文件 | 当前判定 | 当前仍有效的结论 |
|---|---|---|
| `creatok-uiux-code-deep-review-2026-07-12.md` | 历史快照，大部分被 remediation 与 Path B 覆盖 | S5 真实验收、对象续作、运营/历史闭环必须按用户行为验收，而不是按组件数量验收。 |
| `creatok-uiux-code-deep-review-remediation-2026-07-12.md` | 代码修复记录有效，但只证明其固定点 | 原报告的多项误报已修；文件自己仍保留无真实用户、live provider、生产切换与观察证据的边界。 |
| `doc-consistency-audit-2026-07-12.md` | 当时的产品口径冲突已关闭；实施状态需要刷新 | 角色、创作/发布、AIGC/水印等政策冲突已统一；但 07-13/14 后新增了实施地图和关票状态漂移。 |
| `p1-code-quality-deep-review-2026-07-12.md` | 多数代码发现已过期，核心 live 警报仍成立 | 假 mp4、视频双轨、3 条 eval、合同测试缺失已修；真实模型/媒体/平台、自动视频质量仍未闭环。 |
| `p1-code-quality-remediation-2026-07-12.md` | 当前有效的 recorded 完成记录 | 本地可修项基本完成；它列出的真实模型、媒体、抖音、飞书仍待补。当前代码进一步证明媒体/抖音不仅缺证据，还缺正式运行时 Adapter。 |
| `p1-deep-review-workflow-2026-07-11.md` | 历史需求与审查输入；实现状态已过期 | 关系化、锁、数据分级、durable 视频、Polotno、中文检索等已落地；Generative UI 部分实现，真实供应商/平台与完整用户闭环仍欠。 |
| `p1-document-consistency-review-2026-07-11.md` | 口径治理已完成，不能作为 readiness 证明 | 明确真实 OAuth/UAT/供应账号属于发布证据；旧实现漂移清单不能被重新当作当前事实。 |
| `p1-revision-plan-2026-07-11.md` | `implemented-recorded`，不是 release complete | T-A/T-B/T-C/T-D 的代码骨架已交付；真实文案质量、真实媒体、自动 N→1 与外部发布仍部分或未实现。 |
| `uiux-productization-gap-report-2026-07-13.md` | 当前 UIUX 方向的有效基线 | 原 25 项现为 19 已实现、6 部分；其清单没有覆盖后来复核出的 Content 入库、对象续作、Task 合同和真实 Adapter 断链。 |

## 4. `.scratch` 中各地图到底代表什么

| 地图 | 当前含义 | 不能据此声称什么 |
|---|---|---|
| `.scratch/p1-wayfinding/map.md` | P1 决策已关闭 | 不代表功能或发布 Gate 已完成。 |
| `.scratch/model-supply-wayfinding/map.md` | 模型供应领域合同已锁定 | 不代表真实 deployment 已激活。 |
| `.scratch/p1-implementation/MAP.md` | 35 张票已按 recorded/local/PostgreSQL 口径交付 | 不代表真实供应商、OAuth、付费、法务、试点或负载完成。 |
| `.scratch/creatok-uiux-wayfinding/map.md` | UIUX 决策与交接已关闭，历史过程明确“不实施生产代码” | 不代表 S0–S5 已按用户合同落地。 |
| `.scratch/creatok-uiux-implementation/map.md` | 原严格串行实施计划，仍写 `Status: planned`、S0 frontier | 已被后来的 cutover/Path B 实现事实旁路；当前未标 superseded，属于治理漂移，不能作为当前实现真相。 |
| `.scratch/uiux-upgrade-b/MAP.md` + `decision-ticket-map.json` | 当前 Path B 关票机器真相 | 只关闭 01–03；04–25 仍 open。MAP 顶部“implementation complete”不能覆盖机器状态和 acceptance gate。 |

另有一处具体过报：R2 Exit 报告称“40 张种子图入位”，而 `tickets-r2/impl-notes/t1-wiring.md` 明确记录 **30 张已接、10 张未接**。这不必强行把 10 张都接入，但报告必须改成真实数字或说明“40 张资产已生成、30 张接线”。

## 5. 原 25 项 UIUX gap 当前矩阵

| 项 | 当前判定 | 已落地 | 仍缺 |
|---|---|---|---|
| P0-1 token 流式 | 部分实现 | AI SDK runner、前端 partial consumption、Wrangler fixture 多 chunk 已接。 | live-provider 首 token、中断、上游失败和完成证据。 |
| P0-2 模板品牌残留 | 已实现 | TanStarter/MkFast/MkSaaS 主路径残留和 `/ai` 旁路已退役。 | 仅剩正式关票所需同候选/对标证据。 |
| P0-3 成品缩略图 | 已实现 | 结果、资产、Recent 有 canonical gallery、lightbox 与详情。 | 真实生成作品替换示例内容的同一候选验证。 |
| P0-4 渐进展开 | 部分实现 | 场景、预设、专业参数折叠已接。 | 工作台仍一张大卡 8+ 子块，成品不领屏，skip 与主 CTA 竞争。 |
| P0-5 AI 富渲染 | 已实现 | ResponseStream + Streamdown/CJK 已进入主路径。 | live 流式与移动/中断恢复证据。 |
| P0-6 长任务反馈 | 部分实现 | fixture 下自动轮询、白话阶段、异步浮标、禁假百分比。 | 真实供应商 lifecycle、完成回流和耗时样本。 |
| P0-7 默认闭环 | 已实现 | 本地 fixture 无凭据可跑，错误可恢复且明确标注本地测试。 | 不代表生产可用。 |
| P1-1 AI SDK 选型 | 部分实现 | `streamText`/结构化候选和前端 hooks 已实际使用。 | live-provider 仍未验证。 |
| P1-2 视频前端接线 | 部分实现 | durable workflow、候选、取消、恢复、成片播放和旧轨退役已接 fixture。 | P1 统一运行时没有真实 media Adapter；live video 未发生。 |
| P1-3 真实估时 | 已实现 | 旧 12/45/90 常量已去掉；无足够样本时诚实降级。 | 真实样本尚未积累。 |
| P1-4 全局异步任务中心 | 已实现 | 跨页浮标、进行中、未读、完成、一键回源已有。 | Task 业务来源/状态本身另有断链，见第 6 节。 |
| P1-5 Agent 开场 | 已实现 | 问候、今日建议、场景 chips 可预填且不提前写业务对象。 | 真实商家易用性尚未验证。 |
| P1-6 全局 Cmd/Ctrl+K | 已实现 | 一级页全局可用，含导航/添加到创作双组。 | 返回上下文的完整用户链仍需结合历史对象验收。 |
| P1-7 成套模块多选 | 已实现 | checkbox 多选、套组预览、A/B 默认继承已接。 | 工作台整体密度仍高。 |
| P1-8 预设隐藏提示词 | 已实现 | 命名预设隐藏 prompt 并给素材指导。 | 正式对标证据待补。 |
| P1-9 模型/模板视觉卡 | 已实现（原 gap） | 主路径 radio、预览、额度和估时已接。 | 厂商视觉载体、默认/选中态仍弱。 |
| P1-10 `/ai` 旁路 | 已实现 | 公共旁路 404/退役，生成入口回到受治理主路径。 | 无。 |
| P1-11 i18n | 已实现 | 中文默认、英文切换和 route/query/hash/session 保持已有。 | 当前任务筛选触发值仍可见原始 `all`，属新运行缺陷。 |
| P1-12 触区/字号 | 已实现 | 379/390px 可见控件 ≥48px，产品正文 18px。 | 真机连续点按和真实字体表现未验收。 |
| P2-1 三喂料 | 已实现 | 拍照、图库、多选、拖放、粘贴和 durable Asset 引用已接。 | 真机行为录屏待补。 |
| P2-2 内部模型标识 | 已实现 | recorded/internal id/version 已从三类模型卡净化。 | 真实 deployment 仍未激活。 |
| P2-3 示例店 | 已实现 | 只读、零消耗、做同款已接。 | 示例不能代替真实作品数据。 |
| P2-4 点睛动效 | 已实现 | 真实状态驱动且 reduced-motion 可读。 | 外部状态对标待补。 |
| P2-5 字体栈 | 部分实现 | CSS 与 Chromium computed style 声明 HarmonyOS Sans/MiSans。 | 安装相应字体的真实设备未验收。 |
| D4 3 选 1 | 已实现 | 恰 3 条、单选 1、付费换批、免费重试两次、第三次阻断均有主路径。 | 正式边界录屏/对标待补。 |

## 6. 旧 25 项之外，当前仍未闭环的产品缺口

### P0-A · accepted Content 与一级内容库是两套事实

- `acceptCreativeAsset()` 只向 `state.creativeContents` 写入，并把 Work 标成 accepted：`apps/core/src/p1/operations/application-service.ts:5367-5460`。
- `/dashboard/content` 通过 `useProductState()` 读取 `state.contents`：`mkfast-template-main/src/routes/dashboard/content.tsx:87-143`。
- 当前 E2E 只断言 `creativeProjection.contents`，没有采用后打开一级内容库验证可见、编辑、交接和发布。

**判定：未实现。** 这是最直接的价值链断点，优先级高于继续做视觉微调。

### P0-B · Work / Session / Job 深链不能从自身续作

- `CreativeObjectPage` 只渲染状态、对象互链、结果和 gallery：`mkfast-template-main/src/product/creative-object-page.tsx:193-338`。
- Work 卡只有“打开 Session / 打开 Work”，没有“继续创作、恢复、重试、另存”：同文件 `232-246`。
- 主工作台固定取当前 Session 的最新 Work：`mkfast-template-main/src/product/unified-creation-workbench.tsx:336-375`。
- 2026-07-14 浏览器复核中，draft Work 详情提示“检查本次生成设置后再提交”，页面却没有对应操作。

**判定：部分路由实现，业务续作未实现。** Canvas Work 可编辑是例外，不能代表普通创作对象闭环。

### P0-C · Task 来源、状态、动作和批次合同互相断开

- 来源 href 只覆盖 asset/content/publish；work/integration/review/template 只有文字：`mkfast-template-main/src/p1/operations-view-model.ts:361-403`。
- `ContentTaskInbox` 支持 `onOpenSource`，唯一页面调用却没有传入：`mkfast-template-main/src/product/operations-task-page.tsx:217-268`。
- 无 href 且无 callback 时，“查看来源”被渲染成 `<span>`：`mkfast-template-main/src/p1/content-task-inbox.tsx:203-216`。
- 详情页把 Task 的 `todo` 交给只认识 draft/running/completed 等对象状态的 `ProductStatus`，当前页面实际显示“状态待识别”：`operations-task-page.tsx:495-503`、`lib/uiux/status.ts:17-102`。
- 详情页没有开始/完成/归档或来源动作，只有“返回任务收件箱”：`operations-task-page.tsx:505-557`。
- 普通 task-bound Work 创建不推进 Task，todo 又允许直接 complete；weekly batch 完成会自动写 done，违背锁定的“持久动作开始、用户确认完成”合同。
- 周批次当前直接执行命令，没有可恢复 Agent 记录、逐项模型/报价/合同审阅。

**判定：基础任务页已实现，核心任务合同未实现。**

### P1-D · Asset 可展示，但生命周期治理未实现

- 生成结果写入 `creativeAssets`；资产库把 creative Asset 与 Product Asset 合并投影并按 `ownedAssetId` 去重。
- 生成 Asset 不自动成为完整 Product Asset 治理对象；Product Asset 类型没有 archived/recycle 状态，详情动作是授权撤回而非归档、恢复、回收站和引用保护。

**判定：展示闭环已实现，治理闭环未实现。**

### P0-E · 真实媒体与抖音正式执行一直没有实现

- `createModelExecutionRuntime()` 的 recorded/fixture/gateway 均提供 recorded media；direct 分支只提供真实 LLM execution，没有 media：`apps/core/src/p1/model-supply/adapters.ts:1419-1465`。
- Core 生产装配显式使用 `new RecordedDouyinAdapter()`：`apps/core/src/main.ts:322-349`。
- `RecordedDouyinAdapter` 默认返回 `recorded_not_configured`：`apps/core/src/p1/integrations/douyin.ts:11-42`。
- `.env.example` 默认 `APP_ENV=e2e` + `MODEL_EXECUTION_MODE=fixture`，页面也诚实显示“本地测试可用”。

**判定：真实 LLM 代码可配置但未 live；真实图片/视频和抖音正式 Adapter 未实现。**

### P1-F · Recent 与运营栏没有按已锁定 IA 收口

- Recent 把 Session/Work/Job/Asset/Content/Task 分别平铺，不是一条 Agent 来源链一张活动卡；只有自由文本搜索，没有对象、状态、来源、模型、日期 URL 筛选。
- 右侧运营栏固定三块且不可折叠；所有下一行动统一进入任务详情，没有按 Asset/Content/发布/连接/模型/Job owning context 分流。
- `/admin` 直接跳模型页，后台返回固定 `/dashboard`，没有概览和最近安全产品地址返回。

**判定：壳与路由存在，锁定的 IA/返回合同部分或未实现。**

### P0-G · BYOK“密钥试用”是 recorded 成功，不是真实执行

- 模型设置把 BYOK 描述为使用用户自己的密钥执行文案、图片或视频；前端成功后提示“密钥试用完成”。
- Core runtime 无条件注入 `RecordedByokExecutionAdapter`：`apps/core/src/main.ts:322-349`。
- 该 Adapter 忽略 credential、不发网络请求，直接返回 `recorded:{catalogModelId}`：`apps/core/src/p1/integrations/byok.ts:6-30`。
- 前端把返回的 `completed` 当真实成功 toast：`mkfast-template-main/src/p1/entitlement-byok-panels.tsx:84-109`。

**判定：正式 BYOK 执行未实现，且当前用户反馈具有误导性。** 这不是补一份 activation evidence 就能关闭；要么接真实 Adapter，要么把 recorded 试用严格限制在 e2e 并明确显示模拟结果。

### P0-H · 设置页模型选择/默认值没有控制创作台

- 设置页“本次使用”只调用 `writeCurrentModelSelection()` 写 `sessionStorage`：`mkfast-template-main/src/p1/model-settings.tsx:323-339`、`model-current-selection.ts:21-52`。
- 主工作台从未读取该 storage 或 preferences；它从空 `selectedModelId` 开始，随后选择 catalog 中第一个 `available && unitPrice` 的模型：`mkfast-template-main/src/product/unified-creation-workbench.tsx:263,467-470,510-521`。
- 后端 `ModelPreferenceRegistry.resolve()` 定义了 current → user default → workspace default 优先级，但生产 Foundation module 只调用 set/view/recordRecent，没有 resolve 调用：`apps/core/src/p1/model-supply/catalog.ts:481-486`。

**判定：模型设置 UI 已实现，模型选择业务合同未实现。** 用户看到的“本次使用 / 我的默认 / 工作区默认”目前不能保证下一次创作使用对应模型。

## 7. 视觉与体验当前真实位置

R2 Exit 的阶段退出判定成立，但它不是长期产品完成线：

- 9 屏均分：3.83 → 6.50，达到本轮 exit 线；CreatOK 8.0 仍是长期基准。
- S8 移动工作台 5.6：缺成品 hero、示例脚手架过长、标题重复。
- S1 桌面工作台 6.2：一张大卡 8+ 子块、成品不领屏、skip 与主 CTA 并置。
- S7 模型设置 6.2：厂商视觉载体与默认/选中态弱。
- 本轮明确未做：线索表单收抽屉；资产 tab 语义重构；双上传入口合并；真实作品替换示例骨架。

因此“R2 EXIT PASS”只能表示这轮评分闸通过，不能表示产品达到 CreatOK 或可发布水平。

## 8. 根因

1. **Done 语义坍缩**：决策关闭、代码提交、fixture 测试、视觉退出线、正式关票和发布 Gate 被反复写成同一个“完成”。
2. **评审按旧 gap 修，未重新走完整用户旅程**：组件与页面存在后，没有从 Work/Task/Content/Model preference/BYOK 自身验证“能否继续完成业务”。
3. **两套事实通过投影拼起来**：creative Content/Asset 与 Product Content/Asset 没有完全收敛，视觉上像一个库，动作和生命周期仍断裂。
4. **测试固化当前实现，不等于验收产品合同**：例如单测明确接受 review 来源无 href；Content E2E 不打开一级内容库；历史对象 E2E 只验证标题和深链。
5. **fixture 掩盖了最难部分**：UI、BFF、持久化和状态机都能像真实产品运行，但真实 media、真实平台、真实耗时和恢复并未发生。
6. **机器真相没有随实现回填**：commit 标题、R2 Exit、MAP 顶部、decision-ticket map 和 acceptance report 同时给出不同层级的“完成”。

## 9. 建议 Wayfinder frontier

按用户价值与依赖排序：

1. **F1 · 收敛 canonical 创作事实**：accepted Content 进入一级内容库；Work/Session/Job 从自身地址继续/恢复/另存；生成 Asset 进入可治理生命周期。验收必须走“生成 → 采用 → 内容库 → 编辑/交接”，不只查 projection。
2. **F2 · 收敛 Task owning-context**：统一状态机；来源全部可回跳；详情可执行；任务绑定 Work 后自动进入进行中、由用户确认完成；周批次增加可恢复记录和逐项合同。
3. **F3 · 收敛模型选择与 BYOK 合同**：创作台按 current → user default → template → workspace default 解析模型；BYOK 必须真实使用授权密钥，recorded 试用不得展示为真实成功。
4. **F4 · 接真实价值执行面**：优先接一条真实 LLM + 一条真实图片 + 一条真实视频的 P1 runtime，补真实 lifecycle/成本/恢复；再实现正式抖音 Adapter。没有正式 Adapter 的能力不得写成“只差 Key”。
5. **F5 · 重构核心工作台结构**：不是继续调 token，而是拆 8+ 子块、让成品领屏、缩短移动首屏、收敛唯一主动作。
6. **F6 · 收敛 Asset/Recent/运营 IA**：资产归档/恢复/回收站/引用保护；Recent 按来源链聚合和结构化筛选；下一行动按 owning context 分流。
7. **F7 · 同一候选真实验收**：同一提交重跑全量 E2E/build，补真实竞品、供应商、设备与 5–8 位目标商家关键旅程，再逐项把 I01–I12 转绿并关闭 04–25。
8. **F8 · 修正文档机器真相**：把 `.scratch/creatok-uiux-implementation/map.md` 标为 historical/superseded；纠正 40/30 张图表述；禁止使用“implementation complete”覆盖 open tickets。

## 10. 本轮当前验证

| 验证 | 结果 |
|---|---|
| `pnpm check` | PASS；Contracts/Core typecheck、Web Biome、secret scan、decision-ticket guard 全通过。 |
| `pnpm test` | PASS；Core 411 tests：391 pass / 20 conditional skip / 0 fail；Web 当前 234/234；UIUX scripts 无失败。 |
| 浏览器 | `localhost:3000` 当前可登录；Dashboard、Task、Asset、Content、Models、Connections 可达；控制台无产品错误。 |
| 浏览器业务复核 | 复现 Work/Session 只读无续作；Task 筛选显示原始 `all`；Task 详情 `todo` 显示“状态待识别”、无处理/来源动作；Content 页面为 0 条且未承接已采用 creative Content。 |
| 未在本轮重跑 | 全量 `pnpm e2e`、production build、live provider、真实设备和目标商家测试。它们仍是正式关票前置。 |

## 11. 最终裁定

“以前的评审有没有实现”不能只给一个百分比：

- **P1 工程骨架 / recorded 合同：大部分已实现。**
- **旧 UIUX 25 项：19 已实现、6 部分、0 完全未写。**
- **CreatOK S0–S5 的完整用户闭环：S0/S1/S2/S4 大部分覆盖，S3 和 S5 未完成。**
- **一直没有真正实现或闭环的核心项：Content 入一级内容库、历史对象续作、Task 合同、Asset 生命周期、模型偏好生效、真实 BYOK、真实图片/视频 runtime、抖音正式 Adapter、真实候选/设备/商家/生产验收。**

所以当前产品不是“什么都没做”，而是**做成了一个工程质量不错、fixture 下很完整的产品壳与状态机，却还没有把真实内容价值链和关键对象生命周期接成一个可持续使用的产品。**
