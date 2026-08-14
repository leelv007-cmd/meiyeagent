# Lane C — UI/UX vs Plan
- HEAD: `0a6934089a160a0f0cc3ffc084d42466d47140e2`（`git rev-parse HEAD` 与 `refs/heads/main` 一致）
- Date: 2026-08-13
- Authority: V3.1 plan §§0 / 2 / 4 / 5 / 6 / 28 / 39；PRODUCT.md Design Principles / Anti-references / Brand；`docs/ops/capability-ledger-2026-08-13.md`（C3 / C16 / V31-80）；XHS spec §2.4 首屏顺序
- Evidence class: **推断** = 本 lane 只读代码 / locale / 静态与 interaction 断言，未新开浏览器。**已测** = 能力盘点走查（`0487afd9` R1、`1baf2074` R2）与现存 Playwright spec 契约。二者冲突时以盘点走查为商家可见真相。

## 1. Verdict

**Fail。** 工作台外壳合同有一半已经钉住（问候 h1、分段器、800/1240 数字、62/38 panel 默认、商家一级导航「创作/内容/素材/门店/经验」、Tiptap 不进 Composer、报价 chip 有双态文案函数），但商家看见的主轴仍是 `ComposerHome` 大单体里的 **卡片堆叠 + ChatConversation + 右对齐引用块**，不是 plan §0 / §39 的文档时间线。内部对象（`work-<uuid>`、`ExecutionPlanSnapshot`、`Campaign`、`memoryId`、`任务/叙述/决策`、`进入对象工作区`）仍直出主界面。V31-80 七项未修；C3 免确认直达与 C8 steering 裸错仍是盘点已测红。当前 UI 不能宣称已对齐 V3.1 商家体验。

一句话：合同写在 `workbench-shell.ts` 和 `dashboard-home-contract.test.ts` 里，体验写在 `composer-home.tsx`（约 5000 行）和 `composer-conversation.tsx` 里，两边没有合成一条商家可见的 Workstream。

## 2. Contract checklist

| Contract | Plan § | Pass/Fail/Partial | Evidence | Merchant-visible symptom |
|---|---|---|---|---|
| 用户只理解五件事；内部对象不进主界面 | §2.1 | **Fail** | 推断：`WorkbenchInspectorPanel` 直出 `{workId}`；`agent_frame_stage_*` 为「叙述/决策/计划/结果/任务」；交付卡「进入对象工作区」；Campaign 错误文案含 `Campaign plan: {id}`；`memory_injection_receipt_source` =「来源记忆 {memoryId}」。已测：盘点 R1 §3 / V31-80 第 1–3 项。 | 右栏看见 `work-…`；时间线标签写「任务」「叙述」；成品标题/结果行带内部指令 |
| Workstream = 文档时间线，非气泡 / 非三步向导 / 非卡片堆叠 | §0 / §39 减卡 | **Fail** | 推断：`ComposerConversation` 包 `ChatConversation`；merchant turn 是 `meiye-porcelain max-w-[min(100%,28rem)] rounded-2xl` 右对齐块；进度/问题/确认/交付各自 `rounded-2xl` 卡。`AgentWorkstream` 的 `NarrativeLine` 只吃 semantic 流，生产主路径把 legacy 流塞进 `processSlot`。门店档案仍是五步 `StoreIntakeWizard`。 | 主轴看起来像带时间线轨道的聊天+卡片墙，不是一篇连续文档 |
| 首屏：问候 → 分段器 → Composer → 建议行 → Activity Shelf | §4.1 / D-164① 已被 GAP R-1 supersede / XHS §2.4 | **Partial**（骨架过、插入物静默超车） | 推断+静态门：`dashboard-home-contract.test.ts` 只扫 `composer-home.tsx` 里五个标记的源码顺序。运行时在分段器与 Composer 之间还可插入 `ProgressiveFactCard`、`ViralAdaptPanel`、`IdleGoalProactivePanel`、自由创作模型面板、`campaign-paid-work-panel`。已测：`dashboard-home-mount` 只断言 `create` 在 `proposal` 前，不禁插入物。 | 冷启动先看到档案提醒卡 / 模型选择 /「连着做第二条」，Composer 被挤下去 |
| 桌面 62/38 Workstream / Artifact；Idle ~800 / Active ~1240 | §4.2 / XHS D8 | **Partial** | 推断：`WorkbenchDualColumn` `defaultSize={62}/{38}` 过。但右栏是「上下文」inspector，不是 Artifact 原位生长。`isWorkbenchDualColumnEligible` 要求视口 **≥1240** 才展开；Active 在常见 13–14" 内容区仍锁 800。ArtifactCanvas 叠在左列 process 下面。 | 成品不在右侧长出；窄桌面永远单列；右栏只剩摘要+裸 ID |
| 移动：过程/作品胶囊、Artifact sheet、Composer 在底栏上方；手机无完整编辑器 | §4.3 | **Partial** | 推断：`MobileProcessWorksSwitch` + `ArtifactMobileSheet` + sticky Composer `bottom-[calc(5.25rem+env(safe-area-inset-bottom))]` 过。但 `/dashboard/results/$workId` 无 desktop-relay，手机点「进入对象工作区」仍上 Tiptap 全编辑器。 | 手机能打开完整精修面，违背「拍摄/确认/进度/交接」边界 |
| Thread-root 四态 Idle / Active / Waiting / Delivered | §5.1 | **Partial** | 推断：`workbenchStateOf` 有四态+额外 `failed`。Inspector 把 Waiting 折成 `running`（「进行中」）。Campaign / 确认卡 / Brief 另起状态脸。已测 R2：悬死 work 把 Composer 整锁，无 Waiting 四问文案。 | 等待确认时右栏仍写「创作进行中」；悬死看起来像还在做 |
| Waiting 四问：为什么停 / 要你做什么 / 不做会怎样 / 何时继续 | §5.1 | **Fail** | 推断：`ComposerQuestionCard` 有倒计时与 hold 句，缺完整四问模板。`ExecutionConfirmationWaitingMessageCard` 只有「这次任务已暂停 / 补充调整说明」。`PendingInterruptStrip` 只有「需要你处理」+ `description \|\| interruptType`。无「如果不做会怎样」。 | 停住时不知道会不会扣分、会不会取消、要不要守着 |
| Living Plan 是活文档不是表单 | §5.3 | **Partial** | 推断：`living-plan-model.ts` 五节（目标/本次制作/表达策略/事实与素材/预计积分与时长）是文档投影。UI 包在 `rounded-2xl` 卡里，版本切换写 `r{n}`。执行后仍挂「返回修改/开始制作」（V31-80 第 4）。 | 方案像一张永远可点的表单卡，不像已确认的文档章节 |
| Commit Strip vs Critical Interrupt；中断卡仅两动作（D-164③） | §5.4 | **Partial** | 推断：Commit Strip 两钮「返回修改 / 开始制作」。`ExecutionConfirmationInteractionCard` 两钮。`PendingInterruptStrip` 两钮。但确认卡展开大纲+参数表；Campaign 面板另加确认；Brief 也是卡。Level 1 走查仍出确认卡（已测 C3）。 | 纯文案也被拦一次；中断卡读起来像设置页 |
| Artifact 原位生长、stable ID、无候选+结果+交付三卡 | §5.5 / §27.5 / C16 | **Partial** | 推断：`ArtifactCanvas` 按 `artifactId` reconciliation。生产主路径交付仍走 `ComposerDeliveryCard` + 折叠 `candidate` + inspector 摘要，三套脸。已测：fixture 成品标题=内部指令拼接（C16 / V31-80）。 | 同一条成品在时间线、右栏、工作区各说一遍，标题还是指令原文 |
| Steering 必须显示影响范围 | §5.6 | **Partial**（面在、链断） | 推断：`SteeringComposerPanel` / `projectSteeringImpact` 有「已应用到…其余不变」结构。已测 C8：提交报英文 `No admitted execution plan exists for task composer-task:…`（V31-81）。 | 中途改一句看到英文+内部 task id |
| 发布交接 / 自报近零摩擦 | §6 | **Partial** | 推断：`PublishHandoffPanel` + 自报 chips 挂在 Workstream。已测 C12：结果页入口在，次日追问未走。自报 chips 与 plan「有人问/加微信/预约了/买券/到店/没动静」需对一下实现集合。 | 交付后能补记，但不会被追问 |
| 减卡；连续叙事；不重复粘贴候选正文 | §39 | **Fail** | 推断：Idle 有分段器+提醒卡+建议空态卡+示例店橱窗+Campaign 勾选；Active 有进度卡+问题卡+确认卡+方案卡+交付卡+inspector 卡。`candidateShouldCollapse` 只收起同 task 候选正文，交付卡仍是第三张。 | 一屏多张白瓷卡，读起来像后台 |
| AI 不确定性六态 | §39 | **Fail** | 推断：代码库无六态投影（`我先按…` / `需要你确认` / `当前不能继续` / `当前只是草稿` / `已经确认` / `已经执行`）。V31-80 第 4 项即「已经确认/已经执行」未投影。 | 方案卡执行后按钮仍活着 |
| 记忆注入可见 | §12.7 / §39 / C11 | **Partial** | 推断：`MemoryInjectionReceiptPanel` 在有 `explicitTaskId` 时挂上。文案「来源记忆 {memoryId}」。Idle 建议「为什么现在」拼接 `kind:ref`。已测 C11：经验页空态诚实，注入/撤销未走到。 | 看得到「经验」入口；一旦有注入就看到内部 id |
| 商家语言：创作/内容/素材/门店；经验 not 记忆 JSON | PRODUCT / §4.1 | **Partial** | 推断：`BUSINESS_NAVIGATION` 五词过；经验页 `MemoryValueView` 禁 raw JSON。泄漏面见上。面包屑仍可能写「工作台」（V31-75 第 8 项未拍板）。 | 导航像门店产品；卡片和右栏不像 |
| 报价 chip 常显 + 失败退还双态；无 raw recorded/trialing | §3 R5 / A5 / PRODUCT Anti-ref | **Partial** | 推断：`projectWorkbenchCreditQuote` 要求 `failureRefundsCredits: boolean` 才显示；文案「失败将退回积分」/「失败不退回积分」，与 §5.4「失败自动退回」/「该模型失败不退回」不一致。`resolveComposerQuoteUsageLine` 与 quote chip **并列渲染** →「本次约消耗 N 分」+「本次用量已确认」同屏（已测 V31-80 第 6）。商家 settings 未见 `trialing` 直出（推断）。 | 同一笔钱两句话；退回口径三套 |
| 无障碍：焦点、label、reduced motion、状态不只靠颜色 | §39 / PRODUCT A11y | **Partial** | 推断：`ProductStatus` = 中文标签+圆点+说明；`prefers-reduced-motion` 在 conversation / rose-glow CSS。Interrupt **不**自动聚焦标题（`PendingInterruptStrip` 无 `focus()`；问题卡只 `scrollIntoView`）。Activity 状态有文字。流式 `aria-live` 在进度卡，conversation 故意 `aria-live="off"`。 | 键盘能到 Composer；中断卡不会把焦点抓过来 |
| Tiptap 只在对象工作区，永不进 Composer | D-171 / XHS D4 / §28 | **Pass** | 推断：`object-workspace-c12.static.test.ts` + `workbench-p1.static.test.ts` 扫 Composer 禁 `@tiptap/`。 | Composer 是 textarea，精修才是富文本 |
| 不新增 /intent /plan /make；Composer 唯一主轴 | §4.1 / PRODUCT DP1 | **Partial** | 推断：无这三条一级路由。但 `/dashboard/catalog` 全屏配方市场、`/dashboard/identity`、`/dashboard/workspace`、`/dashboard/jobs`、`/dashboard/sessions`、`/dashboard/search`、cmdk 创建货架与 Composer 抢入口。 | ⌘K / 目录 / 口吻页都能绕开主轴开做 |
| 反参考：CreatOK 市场、聊天气泡、SaaS 待办、店务 CRM、技术词 | PRODUCT Anti-ref | **Fail** | 推断：`CatalogLivePage` 全屏目录；`ChatConversation`+右对齐块；`PendingActionsInbox` 抽屉；五步录入向导；技术词见上。 | 身份仍像「带美业皮的 AI 工具台」 |
| V31-80 内部指令 / 裸 ID / 方案不冻结 / 双叙述 / 用量双行 | Ledger C3/C16 | **Fail** | 已测：盘点 R1 §3 七项。推断：HEAD 仍有 inspector `{workId}`、commit strip 无终态、quote 双行并列、`deliveryStatement = frame.message`。 | 与 08-13 走查同一张脸 |
| 前端目录 / ComposerHome 退为薄宿主 | §28.3 | **Fail** | 推断：`composer-home.tsx` ~5030 行，仍拥有 Intent/Plan/Activity/Artifact/Steering/Interrupt/Campaign。`agent-workbench/` 是并行第二套，不是替换。 | 同一屏两套时间线抢事件 |

## 3. Surface map

### 3.1 商家主轴（应对齐 §4.1）

| Surface | Route / mount | 计划职责 | HEAD 实际 |
|---|---|---|---|
| Agent Workbench | `/dashboard` → `ComposerHome` | Thread-root 唯一创作入口 | 问候+分段器+Composer 大卡+legacy 对话流+并行 `AgentWorkbenchHost` |
| Object workspace / 精修 | `/dashboard/results/$workId` | 精修、发布交接 | Result Center + Tiptap；标题「结果中心」；手机不接力 |
| 内容 | `/dashboard/works` | 成品与历史 | 一级导航「内容」落地此处 |
| Thread 列表 | `/dashboard/recent` | Thread 投影，不另存会话真相 | 有页；描述文案写「Agent Thread」；不在一级导航 |
| 门店 | `/dashboard/store` | 门店/项目/事实 | **五步录入向导** + 事实账本 |
| 素材 | `/dashboard/assets` | 素材与授权 | 上传/授权；冷启动也可挂同一向导 |
| 经验 | `/dashboard/memory` | 经验（非 JSON） | 三层 IA（待确认/已记住/证据）诚实空态 |

### 3.2 额外 / 竞争面（与 Composer 抢注意力）

| Surface | Route | 为何算竞争 |
|---|---|---|
| 全屏配方目录 | `/dashboard/catalog` | CreatOK 式工具市场；XHS 说配方住分段器二级，不新增导航 |
| 口吻 | `/dashboard/identity` | 独立长留页；Composer `@` 胶囊已有身份 |
| 内容工作区 | `/dashboard/workspace` | 与对象工作区 / 素材库第三套「工作区」 |
| Jobs / Sessions | `/dashboard/jobs`、`/dashboard/sessions` | 内部对象列表；cmdk 与 trusted-return 仍链到这里 |
| 搜索 | `/dashboard/search` | 第三套历史面 |
| 旧内容 / 旧任务 | `/dashboard/content`、`/dashboard/tasks` | 重定向壳，仍占路由表 |
| 待办抽屉 | workbench `PendingActionsInbox` | SaaS 待办；计划说待办不是首屏统治者，但抽屉仍是第二套 HITL |
| ⌘K | `GlobalCommandPalette` | 导航+创建货架+task/session/job 条目 |
| Campaign 勾选 | Composer 粘底宿主内 | 永远占 Composer 上方一行，Level 3 控件泄漏到 Level 1 首屏 |
| 自由创作模型/思考深度 | `FreeCreationPanel` | 分段器与 Composer 之间的参数表 |
| 示例店橱窗 | Idle `ExampleStoreShowcase` | 冷启动卡片堆（可接受为冷启动教学，但密度压过 Composer） |

一级导航本身 **Pass**：创作 / 内容 / 素材 / 门店 / 经验。问题不在侧栏词表，在侧栏之外还活着一整圈对象模型路由。

## 4. Findings

### FIND-C-001 — Severity: P0
- Title: 时间线「结果」行与成品标题直出内部指令（V31-80-1/2）
- Plan contract violated: §2.1 内部对象不进主界面；§39 连续叙事；C3/C16
- Evidence (component + copy): 已测盘点四号 copy 单：结果行含「不得偏离 ExecutionPlanSnapshot」。推断：`applyComposerProgress` 在 `assembly_delivery` success 把 `frame.message` 原样写入 `deliveryStatement`；`ComposerDeliveryCard` 原样渲染 `statement`；工作区标题同源。fixture 放大可见性，但拼接源在产品侧。
- Merchant impact: 店主以为成品摘要是给她看的，读到的是给模型的执行纪律。信任当场碎。
- Fix contract (copy/IA/behavior): 商家可见标题/结果行只允许 `merchantMessage` / 成品 title / 任务总结三选一，且必须过 `cardLanguageIssues`；含 `ExecutionPlanSnapshot`、`不得偏离`、`只使用冻结事实` 的字符串不得进 narrative/result/title。
- Files: `mkfast-template-main/src/product/composer/composer-session.ts`；`composer-delivery-card.tsx`；`composer-conversation.tsx`（`agent_frame_stage_result`）；Core merchant-delivery-language（若 message 本身就是指令）
- Tests: Playwright `getByTestId('composer-delivery-statement')` / `getByTestId('agent-frame-stage-result')` 对 fixture copy 单 `expect.not.toContain('ExecutionPlanSnapshot')`；工作区 title textbox 同断言。加静态扫描：timeline/title 禁 `ExecutionPlanSnapshot|不得偏离|冻结方案`。
- Do not: 不要改 fixture 让指令消失来假绿；不要在渲染层静默 substring scrub 而不修来源字段。
- Depends on: V31-80；C3/C16 lane

### FIND-C-002 — Severity: P0
- Title: 右栏上下文把 `work-<uuid>` 和「对象工作区」交给商家
- Plan contract violated: §2.1；PRODUCT Anti-ref「后台代码与技术术语」；V31-80-3
- Evidence: 推断 `workbench-shell-layout.tsx`：`{workId}` 写在 `data-testid="workbench-inspector-work-id"`。交付卡 `composer-delivery-object-workspace-gate` 文案「进入对象工作区 · 点开看完整成品」。按钮「进入对象工作区」。已测盘点 R1 §3.2。
- Merchant impact: 五件事里没有「Work ID」。店主不知道该不该抄这串给客服。
- Fix contract: 右栏永不渲染裸 id；测试 id 可留 `data-has-work`。主 CTA 改为「打开成品」/「去精修」。对象工作区只留内部/测试名。
- Files: `workbench-shell-layout.tsx`；`composer-delivery-card.tsx`；`composer-home.tsx` inspector 接线
- Tests: `getByTestId('workbench-inspector-work-id')` 必须 `toHaveCount(0)` 或改成不包含 `/^work-/` 的可见文本；`getByTestId('workbench-inspector-open-full')` accessible name `/打开成品|去精修/`；全页禁可见 `/work-[0-9a-f-]{8}/`。
- Do not: 不要把 id 藏进 tooltip「方便调试」；不要改成「作品编号」仍打印 uuid。
- Depends on: V31-80

### FIND-C-003 — Severity: P0
- Title: 生产主轴仍是 ChatConversation + 右对齐引用块 + 卡片墙，文档 Workstream 是旁路
- Plan contract violated: §0「文档式时间线，非气泡聊天、非三步向导、非卡片堆叠」；§39 减卡 / 连续叙事
- Evidence: 推断 `composer-conversation.tsx`：`ChatConversation` + merchant `flex justify-end` porcelain 块（测试自称「light chip, not chat bubble」——视觉仍是气泡）。`AgentFrameHost` 每匝一张带「叙述/决策/计划/结果/任务」标签的卡。`composer-home.tsx` 把这整棵树塞进 `AgentWorkbenchHost.processSlot`。真正的 `NarrativeLine`（左边线文档行）只投影 semantic 事件，且用 `excludeNarrativeTexts` 去重——等于承认两套叙述。
- Merchant impact: 升级后店主仍觉得这是「又一个 AI 聊天框」，不是经营文档。
- Fix contract: 商家主轴只渲染 `AgentWorkstream` 文档行。用户句用短引用块（§39），不要右对齐气泡。进度折进 `ActivityLine`。交付/方案/中断才允许有边界面板。`ChatConversation` 退出生产 DOM（测试可留适配）。
- Files: `composer-conversation.tsx`；`agent-workstream.tsx`；`composer-home.tsx` processSlot 接线；`heroui-glass.css` timeline rail
- Tests: `getByTestId('composer-conversation')` 生产路径不存在，或不再含 `[data-slot=chat-message-user]` / `justify-end` 气泡。`getByTestId('agent-narrative-line')` 是唯一用户句。卡片计数：Idle 0 张业务卡（问候/分段器/Composer/建议芯片除外）；Active 至多 1 张 interrupt 或 1 张 plan。
- Do not: 不要「把气泡改成左边对齐」当修复；不要再包一层 AgentFrame 皮肤。
- Depends on: §28.3 ComposerHome 拆分；与 FIND-C-001 同源去重

### FIND-C-004 — Severity: P0
- Title: 首屏顺序被运行时插入物静默超车（未走显式 supersede）
- Plan contract violated: §4.1 / §0.4「D-164① 已被 GAP R-1 supersede；再改首屏必须显式 supersede」；XHS §2.4
- Evidence: 推断 `composer-home.tsx` 源码顺序是问候 → 分段器 → `dashboard-section-create` → 建议 → Shelf（静态门绿）。但 `dashboard-section-create` **内部**在 `ComposerPromptBar` 之前挂：`ProgressiveFactCard`、`ViralAdaptPanel`、`AgentWorkbenchHost`（含 `IdleGoalProactivePanel`）、Campaign 勾选。自由模式分段器下先出 `FreeCreationPanel`（选模型）。静态测试不读这些节点。已测 e2e 只比 create/proposal 两段。
- Merchant impact: 冷启动第一眼不是「说一句今天发什么」，而是补档案 / 选模型 / 连着做第二条。
- Fix contract: Idle customized 可见序必须是 问候 → 分段器 → **单一 Composer** → 建议芯片行 → Shelf。档案缺口收成 Composer 底栏一句+链到门店，或发送后的单问卡。Campaign / 模型 / Goal 面板不得占 Idle 主列。若产品要改序，先写 supersede，再改静态门把插入物算进顺序。
- Files: `composer-home.tsx`；`free-creation-panel.tsx`；`idle-goal-proactive.tsx`；`dashboard-home-contract.test.ts`（门要升级，不是删）
- Tests: Playwright `dashboardSectionOrder` 扩展为节点序：`dashboard-greeting` → `composer-creation-mode` → `composer-intent-input` → `suggestion-capsule-row` →（可选）`dashboard-section-continue`。断言这些之间 **不可见** `progressive-fact-card` / `campaign-paid-work-panel` / `composer-generation-params` / `idle-goal-proactive[data-state=ready]`。
- Do not: 不要为了过门把插入物 `hidden` 但仍占焦点序；不要把 Goal 做成首屏第二张卡。
- Depends on: 与 C1 冷启动密度同一决策；不要和 V31-86 档案链抢入口

### FIND-C-005 — Severity: P1
- Title: 62/38 右栏不是 Artifact；双栏门槛 1240 把大多数桌面锁在单列
- Plan contract violated: §4.2 左 Workstream / 右 Shared Artifact；Idle 800 / Active 1240
- Evidence: 推断 `WorkbenchDualColumn` 62/38 过。右栏 `WorkbenchInspectorPanel` 标题「上下文」/「本次成品」/「进行中」，不是 `ArtifactCanvas`。`ArtifactCanvas` 在 `agent-workstream-works` 里与 process **竖着叠在左列**。`WORKBENCH_DUAL_COLUMN_MIN_WIDTH_PX = 1240`：视口不到 1240 则 `widthMode=conversation`，Active 也不扩到 1240。
- Merchant impact: 「图文页在右侧逐页长出」（§2.2 成功形态）没发生。店主要在左列往下翻才看到成品骨架。
- Fix contract: Active/Delivered 且有 artifact 时，右 38% **就是** `ArtifactCanvas`（plan/note/video/publish 原位更新）。Inspector 摘要并入 Artifact header。双栏门槛改为「内容区能放下 1240 外壳」或「≥1024 且有 artifact」，不要用整窗 1240 误伤 14" 笔记本。
- Files: `workbench-shell.ts`；`workbench-shell-layout.tsx`；`composer-home.tsx` `WorkbenchCreateLayout`；`artifact-canvas.tsx`
- Tests: viewport 1440×900：`workbench-dual-column` + `agent-artifact-canvas` 在 `workbench-inspector-panel`（或取代它）。viewport 1100：Active 仍应看到成品列或明确的「作品」入口，不得只剩 800 对话。`getByTestId('workbench-result-inspector')` 不再是唯一右栏。
- Do not: 不要把 inspector 和 Artifact 做成可拖三列首页。不要为了过数字把空 Idle 也拉到 1240。
- Depends on: C16 artifact 流；FIND-C-003 主轴合并后再搬 DOM

### FIND-C-006 — Severity: P1
- Title: 方案卡执行后不冻结，六态「已经确认 / 已经执行」未投影
- Plan contract violated: §39 六态；§5.4 Commit Strip 只服务未开做的方案；V31-80-4
- Evidence: 已测 work-cd980cd4：r1 已开始并交付，卡上仍是「返回修改 / 开始制作」。推断 `projectCommitStrip` 不读 executing/delivered/failed；`DEFAULT_ACTIONS` 恒两钮。
- Merchant impact: 店主以为还能改这版方案；点下去可能二次确认或报错。
- Fix contract: readiness/phase ∈ {confirmed, executing, delivered, failed} 时 strip 只读：已确认/已经在做/已经做完/没做成。动作收成「查看成品」或「调整下一版」（自然语言，不复活同一张开始制作）。
- Files: `commit-strip-model.ts`；`commit-strip.tsx`；`living-plan.tsx`；`use-living-plan-controller.ts`
- Tests: interaction 矩阵 delivered/executing/failed：`agent-commit-strip-start` 不存在或 disabled；可见文本匹配 `/已经确认|已经在制作|已经做好/`。禁止 delivered 后 `getByRole('button', { name: '开始制作' })`。
- Do not: 不要用灰色按钮假装冻结但仍可点；不要在失败态只修 V31-75 右栏而放过方案卡。
- Depends on: V31-80；六态词表（FIND-C-015）

### FIND-C-007 — Severity: P1
- Title: 「本次约消耗 N 分」与「本次用量已确认」同屏（V31-80-6）
- Plan contract violated: §3 R5 一条报价 chip；V31-74 互斥在确认卡路径失效
- Evidence: 推断 `composer-home.tsx` `usageSlot`：`workbenchCreditQuote.visible` 与 `quoteUsage.kind === 'confirmed'` **两个 `<p>` 独立挂**。`resolveComposerQuoteUsageLine` 只互斥 status vs confirmed，不管 credit quote 行。已测确认卡路径双行。
- Merchant impact: 同一笔积分两句，店主不知道哪句是准的。
- Fix contract: 一个位置一条句。未确认：`本次约消耗 N 分 · 失败自动退回|该模型失败不退回`。已确认：`本次已按 N 分计 · …`。禁止第三句「本次用量已确认」并列。
- Files: `composer-home.tsx` usageSlot；`quote-readiness.ts`；`workbench-credit.ts`
- Tests: `getByTestId('workbench-credit-quote')` 与 `getByTestId('composer-quote-line')` 不可同时 visible。文案与 §5.4 对齐（见 FIND-C-022）。
- Do not: 不要把一行 `hidden` 仍留在 a11y 树；不要改计费数字。
- Depends on: V31-74 语义不动；只修渲染互斥

### FIND-C-008 — Severity: P1
- Title: Waiting 没有四问完整句
- Plan contract violated: §5.1 Waiting 必须解释为什么停 / 要你做什么 / 不做会怎样 / 默认何时继续
- Evidence: 推断 `ExecutionConfirmationWaitingMessageCard`：「这次任务已暂停」「补充调整说明后…继续」——缺为什么、缺不做会怎样、缺何时。`PendingInterruptStrip` fallback `item.interruptType` 会漏英文枚举。问题卡有倒计时（「N 秒后按默认继续」）和部分 hold，但付费 hold 到期（D-153 取消+退分）没有统一四问块。已测 R2 悬死：无取消、无超时说明、Composer 整锁。
- Merchant impact: 店主不敢关页，也不知道守着有没有用。
- Fix contract: 所有 Waiting 脸（问题/付费确认/权利/悬死）同一四行模板。付费 hold：不做=取消并退分+何时。普通问：不做=按默认继续+何时。悬死：为什么停+你现在能做的（取消/换素材）+钱怎么办。
- Files: `execution-confirmation-waiting-message-card.tsx`；`agent-workstream.tsx` PendingInterruptStrip；`composer-question-timeout.ts`；composer 悬死出口（V31-82 半径）
- Tests: `getByTestId('agent-pending-interrupt')` 四段均可定位（建议 `waiting-why` / `waiting-must` / `waiting-if-not` / `waiting-when`）。禁止可见 `interruptType` 原串。
- Do not: 不要做第四张待办卡；四问是文档行，不是新向导。
- Depends on: V31-82 终态；D-153 文案

### FIND-C-009 — Severity: P1
- Title: Level 1 纯 copy 仍可能被确认卡/方案卡拦住
- Plan contract violated: §3 Level 1 免确认直达；§43 门 5「简单任务不因升级变复杂」；C3
- Evidence: 已测盘点 C3：copy 单出确认卡。推断：e2e `v31-level1-copy-journey.spec.ts` 合同写「no execution-confirmation card」；`decideSubmitPath` 在 `requiresBrief=false` 时 `direct_submit`。生产仍可能走 Living Plan commit strip 或 server `execution_confirm`。Campaign 勾选对所有模式可见，会把 Level 1 拖进 Level 3 语义。
- Merchant impact: 「写条朋友圈」变成方案+确认，和升级前文案直出相比更慢更吓。
- Fix contract: `approvalBasis: policy_exempt_copy` 的前台：无 Living Plan 卡、无「开始制作」、无执行确认。只留报价 chip。Campaign 控件仅在商家明确要「连着做」或 Level 3 意图时出现。
- Files: `composer-home.tsx` executionConfirmSlot / living plan 挂载条件；`campaign-paid-work-*`；Core 是否对 copy 仍发 confirm（超出本 lane，但 UI 必须 fail-closed 不渲染）
- Tests: 已有 `v31-level1-copy-journey`：加 `expect(page.getByTestId('execution-confirmation-interaction-card')).toHaveCount(0)` 且 `agent-commit-strip` 不存在；`campaign-paid-work-panel` Idle 不可见。
- Do not: 不要用积分阈值「便宜就免确认」；U1 已禁。
- Depends on: C3 免确认裁决（账本仍 open）；V31-80

### FIND-C-010 — Severity: P1
- Title: 额外路由与 ⌘K 创建货架跟 Composer 抢主轴
- Plan contract violated: §4.1 不新增 intent/plan/make 一级页；PRODUCT DP1 Composer 唯一主轴；Anti-ref CreatOK 市场
- Evidence: 推断路由仍挂 `/dashboard/catalog` 全屏目录、`/identity`、`/workspace`、`/jobs`、`/sessions`、`/search`。`GlobalCommandPalette` `kind: 'task' | 'session' | 'job'`。`creative-object-page.tsx` 深链到 sessions/jobs。一级导航没有这些，但 cmdk 和旧链可达。
- Merchant impact: 同一件事有「去创作 / 去目录 / 去口吻 / 去工作区」四条路。
- Fix contract: 商家壳只保留 §4.1 六条。catalog 降为 Composer 配方胶囊的 popover，禁止独立 URL 当首页。jobs/sessions 对商家 404 或静默转到 works/recent。cmdk 只搜五件事+Thread+成品，条目 kind 不得叫 task/job。
- Files: `routes/dashboard/catalog.tsx`；`identity.tsx`；`workspace.tsx`；`jobs.tsx`；`sessions.tsx`；`global-command-model.ts`；`creative-object-page.tsx`
- Tests: 登录商家访问 `/dashboard/catalog` 应回到 `/dashboard` 并打开配方胶囊，或 404。cmdk 列表 `expect.not.toContain('Job')`。侧栏仍只有 5 项。
- Do not: 不要新做「全部工具」页来收容这些路由。
- Depends on: 口吻是否完全收进 `@` 胶囊（产品确认）

### FIND-C-011 — Severity: P1
- Title: AgentFrame 舞台标签把内部分类学印在每一匝上
- Plan contract violated: §2.1 Task 不进主界面；§39 减卡；商家语言
- Evidence: 推断 locale：`agent_frame_stage_narrative=叙述`、`decision=决策`、`plan=计划`、`result=结果`、`task=任务`。`AgentFrameHost` 每匝渲染 `meiye-agent-frame__stage-label`。用户句已关掉标签，Agent 匝仍开着。
- Merchant impact: 店主被训练去认「任务/决策」而不是「它在干什么」。
- Fix contract: 舞台标签对商家关闭。若要保留文档结构，用商家动词：「我听到的」「需要你拍板」「方案」「成品」。禁止「任务」。
- Files: `project.inlang/messages/zh.json` `agent_frame_stage_*`；`composer-conversation.tsx` `agentFrameStageLabel`
- Tests: `getByTestId('agent-frame-stage-task')` 不可见或文本 ≠「任务」。可见标签白名单测试。
- Do not: 不要只改英文 locale。
- Depends on: FIND-C-003 若删掉 AgentFrame 标签，本项随掉

### FIND-C-012 — Severity: P1
- Title: 经验注入与 Idle 建议把内部 ref 拼给商家
- Plan contract violated: §12.7 / §39 注入可见但是商家语言；§2.1
- Evidence: 推断 `memory_injection_receipt_source`:「来源记忆 {memoryId}」。`IdleGoalProactivePanel`：「为什么现在：」+ `evidenceRefs.map(kind:ref)`。已测 C11 未走到注入，所以这是推断缺陷、合同已写在 DOM。
- Merchant impact: 「它为什么这么写」应该是一句店里的话，不是 `store_fact:…`。
- Fix contract: 注入清单显示 statement + 人话来源（哪次纠正/哪份档案）+ 时间。Idle 建议只显示 `reason` 人话。`data-*` 可留 id。
- Files: `memory-injection-receipt.tsx`；`zh.json`；`idle-goal-proactive.tsx`
- Tests: `getByTestId('memory-injection-receipt-memory-id')` 不可见或文本不匹配 `/mem_|memory-/`。`idle-suggestion-why-now` 不匹配 `/\w+:[\w-]+/`。
- Do not: 不要为了隐藏 id 把整个注入面板删掉。
- Depends on: C11 AC4

### FIND-C-013 — Severity: P1
- Title: Campaign 控件常驻 Composer，错误态泄漏英文与 plan id
- Plan contract violated: §2.1；§3 Level 3 不应污染 Level 1；V31-75 第 6 项只改了勾选文案
- Evidence: 推断 `composer-home.tsx` `campaign-paid-work-panel` 在 sticky Composer 里无条件渲染。勾选已是「连着做第二条」。错误：`Campaign 状态暂时无法更新…Work`；状态：`Campaign plan: {campaign.campaignPlanRef.id}`。
- Merchant impact: 没人要连着做时也被问；出错时看到 Campaign/Work。
- Fix contract: 默认不渲染该面板。仅当意图是活动/多条，或商家主动展开「还要再做一条」时出现。错误句用「这条连做安排暂时读不到」。永不打印 plan ref。
- Files: `composer-home.tsx` campaign 块
- Tests: 冷启动 `getByTestId('campaign-paid-work-panel')` 不可见。打开后错误态 `not.toContain('Campaign')` / `not.toMatch(/plan:/)`。
- Do not: 不要把 Campaign 做成首屏开关来「教育」商家。
- Depends on: FIND-C-004；FIND-C-009

### FIND-C-014 — Severity: P1
- Title: 手机可进入完整 Tiptap 对象工作区
- Plan contract violated: §4.3「不在手机上完整暴露复杂编辑器」；PRODUCT「移动端只覆盖拍摄上传、确认、进度、发布交接」
- Evidence: 推断 `/dashboard/results/$workId` 无 `desktopRelay`。`CopyImageTextWorksurface` 在 Result Center 直接挂 `ObjectWorkspaceEditor`。交付卡/inspector CTA 在 `viewportKind==='mobile'` 仍 `openDelivery`。Workstream 有作品 sheet，但「打开完整成品」绕过 sheet 进全编辑器。
- Merchant impact: 手机精修失败、误触选区 AI、与「扫码交接」抢场景。
- Fix contract: 手机结果面 = 预览 + 分块复制 + 下载 + 自报 +「到电脑上精修」。Tiptap 在 `useIsMobile()` 不挂载。深链手机打开 results 走 relay 页。
- Files: `routes/dashboard/results_/$workId.tsx`；`copy-image-text-worksurface.tsx`；`object-workspace-shell.tsx`；`device-relay.ts`
- Tests: mobile 390：`object-workspace-editor` 不存在；可见「到电脑上精修」或交接。desktop 才有 contenteditable。
- Do not: 不要做半残手机编辑器「先能改标题」。
- Depends on: 无

### FIND-C-015 — Severity: P1
- Title: AI 不确定性六态没有商家可见投影
- Plan contract violated: §39 六态
- Evidence: 推断全 `src/product` 无六态词表组件。最接近的是 Brief `uncertaintyOrConflict` 字段和问题卡 hold 句。方案/草稿/冻结/已执行没有统一徽章。
- Merchant impact: 店主分不清「它在猜」还是「已经定了」。
- Fix contract: 六态各一句+稳定 testid，挂在 Workstream 当前阶段行，不新开卡。词表锁定计划原文。
- Files: 新小模块 `ai-uncertainty-state.ts` + 挂到 living-plan / narrative / delivery；locale keys
- Tests: 每个态一条 interaction：可见指定句，且同时只有一个态。
- Do not: 不要做六色图例；不要英文 enum。
- Depends on: FIND-C-006

### FIND-C-016 — Severity: P1
- Title: Steering 失败把 Core 英文和 task id 直出
- Plan contract violated: §5.6 影响范围人话；§2.1；C8 / V31-81
- Evidence: 已测：`No admitted execution plan exists for task composer-task:…`。推断 `SteeringComposerPanel` `caught.message` 原样进 `steering-error`。
- Merchant impact: 中途改封面变成系统报错。
- Fix contract: 浏览器永不渲染非商家文案的 Error.message。失败用固定句：「这次改动现在还排不进去，成品做完后再说，或先打开方案调整。」链断修在 V31-81，UI 本票只挡泄漏。
- Files: `steering-composer-panel.tsx`；必要时 `steering-client.ts`
- Tests: mock 抛该英文：`getByTestId('steering-error')` 不含 `admitted` / `composer-task` / `execution plan`。
- Do not: 不要把英文翻译成更长的英文。
- Depends on: V31-81 修链；本项可先做护栏

### FIND-C-017 — Severity: P2
- Title: 门店档案仍是五步向导，违背「连续理解不是填表」
- Plan contract violated: §5.2 Intent 不是表单；§0 非三步向导
- Evidence: 推断 `StoreIntakeWizard` 挂在 `/dashboard/store` 与冷启动 assets。`ProgressiveFactCard` 已降为提醒+链接（好），但目的地仍是五步。
- Merchant impact: Day-0 被赶去填表，而不是在 Composer 说一句。
- Fix contract: 档案补齐优先走 Composer 单问 / 「说一句」提取（V31-89 已有方向）。向导降为门店页的高级整理，不是必经。
- Files: `store-intake-wizard.tsx`；`routes/dashboard/store.tsx`；`progressive-fact-card.tsx`
- Tests: 新注册首访：主列无五步；说一句后档案卡可一击保存（承接 V31-86/89）。
- Do not: 不要把五步搬到 dashboard 首屏当「更清楚」。
- Depends on: V31-86 / V31-89

### FIND-C-018 — Severity: P2
- Title: Thread 列表与结果中心对外使用内部名词
- Plan contract violated: §2.1；§4.1 recent 是投影不是第二套会话产品
- Evidence: 推断 `thread-list-page.tsx` description：「列出的是 Agent Thread」。`results_/$workId.tsx` title「结果中心」。
- Merchant impact: 导航叫「创作」，面包屑/页名却跳到另一套词。
- Fix contract: recent 标题「最近的创作」；描述「从这里回到同一条对话」。结果页「成品」或沿用内容名。禁止 Agent Thread / 结果中心。
- Files: `thread-list-page.tsx`；`routes/dashboard/results_/$workId.tsx`；相关 locale
- Tests: 可见文本禁 `/Agent Thread|结果中心/`。
- Do not: 不要为了改名新建 `/dashboard/threads`。
- Depends on: V31-75 面包屑「工作台」命名拍板

### FIND-C-019 — Severity: P2
- Title: 多 Work 同 thread 双叙述复发
- Plan contract violated: §39 不重复粘贴；V31-80-5
- Evidence: 已测：第二单提交后 prompt 叙述双条。V31-75 只修单 Work。推断 `excludeNarrativeTexts` 只按当前 session merchant turns 去重，跨 Work 或 semantic+legacy 双写会漏。
- Merchant impact: 同一句话出现两次，像系统卡了。
- Fix contract: 同一 `threadId` 同一句用户文本只渲染一次，按 trim 文本+turn 角色去重，不按 work。
- Files: `composer-home.tsx` excludeNarrativeTexts；`agent-workstream.tsx`；`composer-session` fold
- Tests: 同 thread 连续两单：`composer-turn-merchant` + `agent-narrative-line` 合计该句 count=1。
- Do not: 不要把第二单用户句吞掉。
- Depends on: FIND-C-003 单轴后本项应变简单

### FIND-C-020 — Severity: P2
- Title: 退回双态文案三套，且与 §5.4 例句不一致
- Plan contract violated: §3 R5 / §5.4 / A5
- Evidence: 推断 chip「失败将退回积分」/`失败不退回积分`；commit strip「失败自动退回」/`该模型失败不退回`。计划例句是后者。
- Merchant impact: 同一规则两种说法，像两个产品。
- Fix contract: 全站锁定 §5.4 两句。一处 locale，三处消费。
- Files: `zh.json` `workbench_credit_*`；`commit-strip-model.ts`
- Tests: locale 契约测试两句 exact match；chip 与 strip 同源函数。
- Do not: 不要解释「将」vs「自动」的法务差异除非法务要求。
- Depends on: FIND-C-007

### FIND-C-021 — Severity: P2
- Title: Activity Shelf 默认收成一行，不是合同里的横排大留白卡
- Plan contract violated: XHS §2.4 / D6 / P1-3
- Evidence: 推断 `DashboardContinueSection` 默认 `expanded=false` 一条 pill；展开才 `flex gap-4 overflow-x-auto` ≤3 卡。
- Merchant impact: Idle 几乎看不到「接着上次」对象，Shelf 合同形同虚设。
- Fix contract: 有待处理对象时默认横排 ≤3 卡（缩略图/状态/下一步）。无对象则整段不渲染（已做）。
- Files: `dashboard-continue-section.tsx`
- Tests: 有 running/failed work 时 `activity-shelf-card` count>0 无需先点 expand。
- Do not: 不要做成内容瀑布。
- Depends on: FIND-C-004 密度

### FIND-C-022 — Severity: P2
- Title: 方案卡「已绑定 N 项事实用法」与工作区「暂无关联事实」对打
- Plan contract violated: §5.3 活文档可信；V31-80-7
- Evidence: 已测零事实账号。推断 `commitStripInputFromPlanFacts` 用 `factsSummary` 正则猜 ok。
- Merchant impact: 店主不知道方案到底有没有用到本店事实。
- Fix contract: 计数权威=工作区同一事实投影。0 就写「这次没绑门店事实」。禁止「2 项用法」对「暂无」。
- Files: `commit-strip-model.ts`；living-plan facts 投影；object workspace 事实面
- Tests: 零事实 fixture：strip 与工作区同一句。
- Do not: 不要为了对齐把 0 显示成 2。
- Depends on: V31-80 定性（fixture vs 产品计数）

### FIND-C-023 — Severity: P2
- Title: Interrupt 不自动聚焦；Waiting 被折进「进行中」
- Plan contract violated: §39 无障碍「Interrupt 自动聚焦标题」；§5.1 四态可辨
- Evidence: 推断问题卡 `scrollIntoView` 但不 `focus` 标题。`PendingInterruptStrip` 无 tabIndex/focus。`workbenchInspectorPhaseOf` 把 waiting 映射 running。
- Merchant impact: 读屏用户不知道在等她；视力用户右栏还说在做。
- Fix contract: 中断出现时 focus 标题（`h3` tabindex=-1）。Inspector Waiting 用「等你处理」+四问短句，不用「进行中」。
- Files: `composer-question-card.tsx`；`agent-workstream.tsx`；`workbench-state.ts`；`workbench-shell-layout.tsx`
- Tests: 中断出现后 `document.activeElement` 为 interrupt 标题。Inspector `data-inspector-phase=waiting`。
- Do not: 不要 `aria-live=assertive` 整段复读。
- Depends on: FIND-C-008

### FIND-C-024 — Severity: P2
- Title: 自由创作把模型名和「思考深度」放在分段器与 Composer 之间
- Plan contract violated: §2.1 模型不进主界面；§5.1 Idle 不展示 Provider/Skill
- Evidence: 推断 `FreeCreationPanel` 模型 Select；`ComposerGenerationParamsPanel`「思考深度」。V31-75 第 9 项只换了控件，模型名分层未做。
- Merchant impact: 自由创作看起来像开发者 playground。
- Fix contract: Idle 自由模式仍是一句话+发送。模型/深度进「更多」胶囊，默认「按店里常用设置」。
- Files: `free-creation-panel.tsx`；`composer-generation-params-panel.tsx`
- Tests: 切到自由创作：主列无「思考深度」、无模型 listbox，直到点更多。
- Do not: 不要发明中文花名硬译 GPT Image 2 而不做分层决策。
- Depends on: V31-75 残留拍板

### FIND-C-025 — Severity: P2
- Title: `merchantDeliverableLabel` / `deliverableKindLabel` 未知枚举原样透传
- Plan contract violated: §2.1；V31-75 第 6 项「未知值原样透传」是技术债不是产品合同
- Evidence: 推断两处 `return kind`。确认卡曾直出 `image`（已测历史）。
- Merchant impact: 新 kind 会再漏一次。
- Fix contract: 未知 kind →「这次成品」；dev assert。禁止透传 slug。
- Files: `merchant-deliverable-label.ts`；`living-plan-model.ts`
- Tests: `merchantDeliverableLabel('image_set_v3') === '这次成品'`；确认卡无 `/^[a-z_]+$/` 单词语。
- Do not: 不要空白单元格。
- Depends on: 无

## 5. Executable ticket pack

每张票都是行为修复，不是换肤。建议顺序：泄漏护栏 → 首屏插入物 → 单轴时间线 → 右栏 Artifact → 四态/六态文案。

### TICKET-C-01 — P0 展示层泄漏护栏（消化 V31-80 1/2/3/6）
- Goal: 时间线/标题/右栏/报价条无内部指令、无裸 id、无双用量句。
- Scope: FIND-C-001, 002, 007, 025
- Files: `composer-session.ts`；`composer-delivery-card.tsx`；`workbench-shell-layout.tsx`；`composer-home.tsx` usageSlot；`merchant-deliverable-label.ts`
- Acceptance:
  1. fixture copy 单：`composer-delivery-statement` 与工作区 title 不含 `ExecutionPlanSnapshot|不得偏离|只使用冻结事实`。
  2. `workbench-inspector-work-id` 无可见 uuid/work- 前缀。
  3. `workbench-credit-quote` 与 `composer-quote-line` 不同时 visible。
  4. 确认卡 deliverable 无 raw slug。
- Playwright:
  - `await expect(page.getByTestId('composer-delivery-statement')).not.toContainText('ExecutionPlanSnapshot')`
  - `await expect(page.getByTestId('workbench-result-inspector')).not.toContainText(/work-[0-9a-f]/)`
  - `await expect(page.getByTestId('workbench-credit-quote')).toBeVisible()` 时 `composer-quote-line` hidden
- Do not: 不改生成/扣分；不修 fixture 来藏指令。
- Depends on: 无（可先于 V31-81/82）

### TICKET-C-02 — P0 首屏插入物清场（显式遵守 R-1）
- Goal: Idle 可见序 = 问候 → 分段器 → Composer → 建议芯片 → Shelf。
- Scope: FIND-C-004, 013, 021, 024
- Files: `composer-home.tsx`；`free-creation-panel.tsx`；`idle-goal-proactive.tsx`；`dashboard-home-contract.test.ts`；`dashboard-continue-section.tsx`
- Acceptance:
  1. 冷启动 customized：greeting 与 intent 之间无可点击业务卡（允许分段器）。
  2. `campaign-paid-work-panel` 默认不挂载。
  3. 自由模式模型/思考深度不在首屏。
  4. 有未完成作品时 Shelf 默认横排卡。
  5. 静态门把插入物算进顺序（现在的 indexOf 五标记不够）。
- Playwright: 扩展 `dashboard-home-mount` 节点序断言（见 FIND-C-004）。
- Do not: 不删示例店；不把档案提醒做成第二输入框。
- Depends on: 档案补齐仍走门店页/发送后单问（FIND-C-017 可后做）

### TICKET-C-03 — P0 单轴文档 Workstream
- Goal: 去掉生产路径 ChatConversation 气泡与双叙述。
- Scope: FIND-C-003, 011, 019
- Files: `composer-conversation.tsx`；`agent-workstream.tsx`；`composer-home.tsx`；locale `agent_frame_stage_*`
- Acceptance:
  1. 用户句 = 一条文档引用，count=1（含第二单）。
  2. 无右对齐 porcelain 气泡。
  3. 无「任务」标签。
  4. 减卡：Active 主列除 Composer 外最多 1 个有边界面板（interrupt 或 plan）。
- Playwright:
  - `expect(page.locator('[data-testid=composer-turn-merchant]')).toHaveCount(0)` 或改 testid 后断言 `not.toHaveClass(/justify-end/)`
  - 同句 `getByText(prompt)` 在 timeline 内 `toHaveCount(1)`
- Do not: 不引入 assistant-ui runtime；不新做聊天气泡皮肤。
- Depends on: TICKET-C-01 以免把指令搬进 NarrativeLine

### TICKET-C-04 — P1 右栏改为 Artifact 原位生长
- Goal: Active/Delivered 62/38 的 38 = 同一个 artifactId 的生长面。
- Scope: FIND-C-005, C16
- Files: `workbench-shell.ts`；`workbench-shell-layout.tsx`；`composer-home.tsx`；`artifact-canvas.tsx`
- Acceptance:
  1. 图文运行中右栏按页长出，不新增候选卡。
  2. 刷新后同一 `data-artifact-id`。
  3. 1100px 宽仍能打开作品面（sheet 或降级列）。
  4. 右栏无裸 work id。
- Playwright: `v31-artifact-growth-journey` 加 `workbench-inspector-panel` 内 `agent-artifact-card`；`data-artifact-id` 稳定。
- Do not: 不把 Result Center 整页嵌进右栏。
- Depends on: TICKET-C-03（否则左列仍是卡片墙）

### TICKET-C-05 — P1 方案冻结 + 六态 + Waiting 四问
- Goal: 已执行的方案只读；等待态说完四问。
- Scope: FIND-C-006, 008, 015, 023
- Files: `commit-strip-model.ts`；`living-plan.tsx`；interrupt/waiting 卡；`workbench-state.ts`
- Acceptance:
  1. delivered 无「开始制作」。
  2. 六态各有一句可见。
  3. 任一 Waiting 四 testid 齐全。
  4. Interrupt 出现后焦点在标题。
- Playwright: 见各 FIND Tests。
- Do not: 不把四问做成四步向导。
- Depends on: V31-82 悬死终态才测全；文案可先挂健康 Waiting

### TICKET-C-06 — P1 Level 1 免确认面 + Campaign 离场
- Goal: 纯 copy 一击到做；确认只留给付费媒体。
- Scope: FIND-C-009, 013
- Files: `composer-home.tsx` confirm 挂载；campaign 面板
- Acceptance: `v31-level1-copy-journey` 无 confirm 卡、无 commit strip；报价 chip 常显双态。Campaign 默认不在 DOM。
- Do not: 不设金额阈值。
- Depends on: C3 产品裁决若维持「必须确认」则本票改为改计划而非改 UI——当前权威是免确认

### TICKET-C-07 — P1 商家壳路由收敛 + 手机无全编辑器
- Goal: 可点入口只剩五件事；手机结果面不做 Tiptap。
- Scope: FIND-C-010, 014, 018
- Files: dashboard extra routes；cmdk；`results_/$workId.tsx`；object workspace
- Acceptance: catalog/jobs/sessions 商家不可当工作台用；mobile 无 `object-workspace-editor`；recent/results 无内部名词。
- Do not: 不删管理员路由。
- Depends on: 口吻是否完全收进 Composer（需主控一句）

### TICKET-C-08 — P1 Steering 错误护栏 + 影响范围句
- Goal: 中途改需求只说影响页和积分，失败也不漏内部英文。
- Scope: FIND-C-016
- Files: `steering-composer-panel.tsx`
- Acceptance: 成功句「已应用到封面和第 2 页；其他页面不变。」（或 Core 人话 summary）。失败句固定中文。
- Playwright: `steering-error` 禁英文关键词；绿路径 `steering-impact` 可见受影响/不受影响。
- Do not: 不在浏览器重算计费。
- Depends on: V31-81 修链才能绿；护栏可先合

### TICKET-C-09 — P2 经验注入人话 + 事实计数同源
- Goal: 注入清单和方案事实计数都用商家词。
- Scope: FIND-C-012, 022
- Files: `memory-injection-receipt.tsx`；idle proactive；commit strip facts
- Acceptance: 无 memoryId / `kind:ref`；零事实两边同句。
- Depends on: C11 走到注入数据

### TICKET-C-10 — P2 文案单点与退回双态
- Goal: 退回两句、交付 CTA、面包屑命名全站同一套。
- Scope: FIND-C-020, 018, V31-75 残留
- Files: locale；commit strip；delivery CTA
- Acceptance: exact 两句；「打开成品」；无「工作台」对商家（若主控拍板改名）。
- Depends on: 主控拍板面包屑词

## 6. Open questions / unproven

1. **C3 免确认 vs 确认卡**：e2e 规格写 copy 直达，盘点走查出了确认卡。HEAD 上是 Living Plan strip、server interrupt，还是 Brief？本 lane 未复跑浏览器。**未证**。修之前用盘点四号账号走一条纯朋友圈，看是哪张卡。
2. **V31-80 第 1/2 项分界**：指令是 Core `frame.message` 还是 fixture echo？代码显示 product 侧把 message 当任务总结。需对一条 live copy 看 title 是否仍脏。**推断产品侧有责，live 未证。**
3. **V31-80 第 7 项「2 项事实」来源**：fixture 语义还是计数 bug。未读 Core projection。
4. **自报 chips 集合**是否等于 §6.3 `有人问/加微信/预约了/买券/到店/没动静`：结果页盘点见到「发出去了/没发成功/不太确定」，像发布记录不是经营信号。**未逐枚对照。**
5. **次日追问** UI 是否存在独立入口：C12 未走完。
6. **recorded/trialing**：商家 credits 页本 lane 未逐行读完所有 settings 渲染；`trialing` 存在支付内部类型。需一眼 credits UI 才敢写 Pass。
7. **WCAG 全站**：只抽了工作台。对比度、键盘走完 Plan/Interrupt/交接 **未测**。
8. **双栏 1240 门槛**是否曾被 D-171 解释为「外壳宽度」而非「视口宽度」：代码按视口实现。若权威是外壳，FIND-C-005 的门槛条款要改判。
9. **ComposerHome 5000 行**：§28.3 迁出是否仍是本季度范围，还是只要求体验等价。本审查按体验合同判 Fail，不要求一次拆完文件。
10. **本 lane 未开浏览器**。所有「已测」引用 08-13 盘点（部分证据树早于 HEAD）。V31-75 之后 HEAD 可能修了失败态右栏，但 V31-80 清单在账本仍为 open，且对应 DOM 仍在。

---

**Lane C 给主控的收敛建议**：不要开「工作台视觉升级」票。先合 TICKET-C-01 护栏（否则任何走查都在看脏数据），再 C-02 把首屏插销拔掉，再 C-03 让商家只剩一条文档轴。C-04 以后才谈 62/38 像不像稿。未完成前，不要把 C16 从「降级可用」改成可用。
