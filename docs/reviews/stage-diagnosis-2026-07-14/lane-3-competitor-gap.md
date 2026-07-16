# Lane 3 · 竞品对标为何落不到自己产品上 — 归因诊断（路径/资源/时间）

- 日期：2026-07-14
- 分支 / HEAD：`main` / `22a9d4e`（feat: add Ark media execution adapters，2026-07-14 21:45）
> 状态：历史诊断快照；当前代码与决策以仓库 HEAD 和 07-decision-log.md 为准。
- 维度：竞品对标承诺 → 代码级落地状态 → 未落地根因归因
- 只诊断不改码。严重度：P0 = 直接卡住"真实商家可端到端用"的对标承诺；P1 = 削弱"易用/闭环"的对标承诺；P2 = 细节体验或范围内已知缓做。
- 判定口径沿用 `CONTEXT.md:3-7`：当前代码、当前决策、ADR-0010 优先；recorded/fixture 不等于真跑。

## 一句话结论

竞品对标的**功能清单**抄到了约 80%（首页主工作流、结构化工作流、资产库、任务历史、账本、L3 发布包、AI 原生意图态旅程、单体架构——全部有代码落地）；但对标最难、也是 CreatOK 真正的产品价值——**真实价值链闭环**（真实模型/媒体执行、accepted 内容进一级库、对象自身续作、官方发布 Adapter）——大面积停在 recorded/fixture 壳与两套事实的投影拼接。归因主线是**开发路径问题**（done 语义坍缩 + 两套事实未收敛 + 局部优化代替结构重构），而不是资源或时间不足。

---

## 一、现状实证

### 1.1 竞品对标当初承诺了什么（references 提炼）

站在已有 11 份调研肩上，把散落的对标承诺收敛为 12 条可验证锚点：

| # | 对标承诺 | 来源锚点 | 承诺强度 |
|---|---|---|---|
| C1 | 首页即主工作流（非空聊天/导航页） | `creatok-function-breakdown.md:136-140`、`p0-benchmark-matrix.md:239` | 强 |
| C2 | 垂类结构化工作流 + 模块选择器（商品套图/A+ → 项目套图/图文长图） | `creatok-function-breakdown.md:248-309`、`creatok-productization-architecture-gap-analysis.md:135-152` | 强 |
| C3 | 资产库承接结果 + 业务 metadata + 授权/合规状态 + 生命周期（回收站） | `creatok-function-breakdown.md:336-364`、`creatok-productization-architecture-gap-analysis.md:369-395` | 强 |
| C4 | 任务历史承接异步生成（task_id、submit/resume/status、可恢复/重试/refund） | `creatok-function-breakdown.md:497-514`、`creatok-architecture-estimate.md:17` | 强 |
| C5 | Credits 统一账本 reserve/commit/refund + 失败补偿 | `creatok-function-breakdown.md:399-411`、`creatok-productization-architecture-gap-analysis.md:413-425` | 强 |
| C6 | 官方发布产品化：账号能力矩阵 + L1 官方优先 + L3 兜底 | `creatok-function-breakdown.md:366-387`、`05-platform-capability-matrix.md:28-33` | 强 |
| C7 | Agent Skills 外部入口（P0 内部 tools，P1 外部） | `creatok-function-breakdown.md:413-442` | 弱（明确后置） |
| C8 | AI 原生意图态旅程：agent 主动提案、对话式外壳+结构化内核、候选 N→1、双合规门、流里跑库里存 | `02-合成-AI原生旅程与排布重构.md:33-72` | 强 |
| C9 | 视频成片 P0 主打：模型端买 + ffmpeg 薄壳 + AIGC 标识烧录 | `03-合成-架构与产品化取舍-KickArt双路评估.md:30-46`、`ADR-0008` | 强 |
| C10 | 架构对标：单体/无独立 agent runtime/异步轮询/Better Auth/火山存储 | `creatok-architecture-estimate.md:8-22`、`03-合成...:54-59` | 强 |
| C11 | 真实模型层买 API（豆包/即梦/Seedream/Seedance 按量调用可切换） | `03-合成...:16-17`、`p0-benchmark-matrix.md:230` | 强 |
| C12 | 合规护城河（超越 CreatOK：广告法/AIGC/医美 Regulated Mode/Preflight） | `creatok-productization-architecture-gap-analysis.md:82-83`、`02-合成...:30` | 强（差异化） |

benchmark 给 CreatOK 的定性是"**高产品化参考、低直接 P0 迁移度**"，总分 63.6（`p0-benchmark-matrix.md:231`）。这句话是本维度的钥匙：对标的价值从来不是抄功能，而是抄"把 AI 多模态从 model playground 做成垂类内容生产**系统**"的闭环机制（`creatok-function-breakdown.md:672-675`）。

### 1.2 对标点 → 落地状态 → 卡在哪（代码级）

状态定义：**已落** = 接入用户主路径且有真跑/可信测试；**半落** = 壳/状态机/fixture 成立，真实执行或业务下游仍缺；**未落** = 无主路径或两套事实断裂；**缓做** = 范围内主动后置。

| 对标点 | 落地状态 | 代码级证据 | 卡在哪 |
|---|---|---|---|
| C1 首页主工作流 | 已落（结构未达标） | `unified-creation-workbench.tsx` 为默认主面，Agent 开场/意图框/场景 chips 齐 | 成品不领屏、一框 8+ 子块（`exit-report.md:25-31`）；视觉 6.5 vs 8.0 |
| C2 结构化工作流/模块选择器 | 半落 | `creation-shelf.tsx`、`contentModules` state（`unified-creation-workbench.tsx:360`） | 图文套图渲染管线 ADR-0008 主动缓做；模块选择器未成独立产物链 |
| C3 资产库 + 生命周期 | 半落 | 资产库能展示 creative/product 双投影按 `ownedAssetId` 去重 | 归档/回收站/引用保护未实现（P1-D，见 §二） |
| C4 任务历史/异步/可恢复 | 已落 | durable jobs、`async-task-center`、Result Card、retry/refund 合同 | 对象自身续作断链（P0-B）；Task 合同断链（P0-C） |
| C5 账本 reserve/commit/refund | 已落 | `foundation-ledger.ts`、双账本（产品用量账 + 供应成本账） | 无（本项是对标落地最扎实的一条） |
| C6 官方发布/账号矩阵/L3 | 半落 | L3 发布包状态机、发布快照/确认合同成立 | 抖音正式 Adapter = `RecordedDouyinAdapter`（`main.ts:334`）= 未落 |
| C7 Agent Skills 外部 | 未落（符合规划） | 内部 tools 化，外部 skills P1 | 主动后置，不计缺陷 |
| C8 AI 原生意图态旅程 | 大部分已落 | 意图框、今日建议 chips、候选 3 选 1+换一批、对话式外壳 | 视觉密度与结构仍高于 CreatOK；真实商家易用性未验 |
| C9 视频成片 ffmpeg 薄壳 | 半落 | ffmpeg 真调 child_process（`video/composer.ts:240`、`media-tools.ts:1`），假 mp4 已修 | 片段来源 = Ark（默认 disabled），真实成片链未 live |
| C10 单体架构对标 | 已落 | 单 Node 服务 + Postgres + graphile-worker/pg-boss 双队列 + AI SDK Port（ADR-0002/0006/0007） | 无 |
| C11 真实模型层买 API | 半落（07-14 晚新增） | Ark 媒体真 fetch 火山方舟（`ark-media-adapter.ts:459,502,573`）；LLM direct = `OpenAiCompatibleLlmExecutionPort` | 默认 disabled+仅覆盖 2 模型；LLM direct = `configured_unverified`（`adapters.ts:1509`）；BYOK 生产装配仍 recorded |
| C12 合规护城河 | 半落 | 合规 gate/AIGC 标识/Preflight 骨架、`06-compliance-implementation-plan.md` | 真实医美准入/平台规则实测未做（ADR-0004 资质准入制未接真实账号验收） |

### 1.3 关键增量核实（晚于既有对账文件的新证据）

既有对账 `historical-review-implementation-reconciliation-2026-07-14.md`（HEAD `dfa599a`/`fbd8e45`，07-14 下午）与 `references-docs-uiux-unfinished-upgrade-reconciliation-2026-07-14.md` 之后，当晚有 3 个 feature 提交，改变了两处对标判定，必须校正：

1. **真实媒体通路从"完全缺失"升级为"代码接通但默认关闭"**：
   - 既有对账 §6 P0-E 断言"direct 分支只提供真实 LLM，没有 media"（`adapters.ts:1419-1465`）。
   - 校正：`22a9d4e`（07-14 21:45）新增 `ArkMediaExecutionPort`，对 `seedream-5-pro`/`seedance-2` 真发 POST 到 `https://ark.cn-beijing.volces.com/api/v3/images/generations` 与 `/contents/generations/tasks`（`ark-media-adapter.ts:459,502`；`runtime-config.ts:40`）。
   - 但：`parseMediaMode` 默认 `disabled`（`runtime-config.ts:367-373`），需 `MODEL_MEDIA_EXECUTION_MODE=ark` + 全套 `ARK_*` 凭据才装配；`ArkMediaCompositeExecutionPort.execute` 只路由 2 个模型 id，其余仍走 recorded fallback（`adapters.ts:1365-1371`）；activation 仅在配了 `ARK_*_ACTIVATION_*` 证据时才升 `live_verified`（`runtime-config.ts:91-94`），否则 `configured_unverified`。**结论：真实媒体执行"代码已就绪、通路未激活、覆盖不全"，比对账旧结论进了一步，但离"真实商家能生成 AI 图/视频"仍差激活证据与全模型覆盖。**

2. **工作台选模从"挑第一个可用模型"校正为"接入偏好优先级链"**：
   - 既有对账 §6 P0-H 断言工作台"从空 selectedModelId 开始，选择 catalog 中第一个 available && unitPrice 的模型"，判定"模型选择业务合同未实现"。
   - 校正：`daa9081`（07-13，早于对账 HEAD）已引入 `resolveCreationModelSelection`，按 current_selection → user_default → workspace_default 解析且无匹配返回 `undefined`（不再兜底挑第一个）（`model-current-selection.ts:18-38`），工作台第 589-594 行实际消费 `currentModelSelections[operation]` + 后端 `preferences.userDefault/workspaceDefault`（`unified-creation-workbench.tsx:589`）。**对账 P0-H 的"挑第一个可用模型"措辞在 HEAD 已不准确。**
   - 但残余问题真实：后端 `ModelPreferenceRegistry` 为纯 in-memory Map（`catalog.ts:449-452`），进程重启即失；`readCurrentModelSelection` 走 sessionStorage（跨设备/会话不持久）。**选模优先级链已接通，但持久化闭环仍弱——P0-H 从"未实现"降级为"半落"，不再是最刺眼项。**

> 这两处校正的方法论意义：竞品对标落地是移动靶。诊断必须核到 HEAD 提交，否则会把"当晚刚补的真实通路"误判成"从未实现"。

---

## 二、缺陷清单（带严重度与锚点）

### P0 级（卡住"真实商家可端到端用"的对标承诺）

**P0-1 · accepted 内容进不了一级内容库 — 对标 C4/C8"流里跑、库里存"断裂**
- 现象：工作台"采用"只写 `state.creativeContents`（`application-service.ts:5638`），不写一级库 `state.contents`；前端 `/dashboard/content` 读 `state.contents`（`content.tsx:100,136,141`）。两套事实靠投影拼接。
- 失败场景：商家在工作台采用一条文案 → 打开内容库看到"0 条内容"（`references-docs...reconciliation:30`、`after-t7/04-content.png`），无法在主库继续改稿/交接/发布。
- 核实时序：`b761764`（07-14 20:47 promote generation results）晚于对账仍未修此断链，`acceptCreativeAsset` 第 5638 行仍只 push `creativeContents`。
- 归因：**开发路径问题**（两套事实未收敛，见 §三）。

**P0-2 · 真实媒体/抖音执行未激活 — 对标 C6/C9/C11"真实生产系统"未闭环**
- 现象：Ark 媒体代码接通但默认 `disabled` 且仅覆盖 2 模型（`runtime-config.ts:367-373`、`adapters.ts:1365`）；生产装配 `main.ts:334` 固定 `new RecordedDouyinAdapter()`，默认返回 `recorded_not_configured`（`douyin.ts`）；`main.ts:326` 固定 `new RecordedByokExecutionAdapter()`。
- 失败场景：真实商家提交图片/视频/抖音发布/BYOK 试用 → 得到 recorded 结果或不可提交。抖音/BYOK 非"补 Key 即通"，是硬编码 RecordedAdapter（须换装配）。
- 对标落差：CreatOK 是发货产品（真实 Sora/Veo/Kling/Seedance 跑在 30 万用户上，`creatok-architecture-estimate.md:19`），我方是 fixture 下的壳。
- 归因：**时间/优先级 + 阶段化策略叠加路径问题**（见 §三）。

**P0-3 · 对象自身续作断链 — 对标 C4"任务可恢复/派生"半落**
- 现象：`CreativeObjectPage` 只渲染状态/互链/gallery，Work 卡只有"打开 Session/Work"，无"继续/恢复/重试/另存"（`creative-object-page.tsx:232-246`）；主工作台固定取当前 Session 最新 Work（`unified-creation-workbench.tsx:336-375`）。
- 失败场景：商家从历史 Work 详情想续作 → 只有只读深链，页面提示"检查设置再提交"却无对应动作（对账 §6 P0-B 浏览器复核）。
- 归因：**开发路径问题**（IA 合同未接线）。

### P1 级（削弱"易用/闭环"的对标承诺）

**P1-1 · Task 来源/状态/动作/批次合同互相断开 — 对标 C4/C8 半落**
- 现象：来源 href 只覆盖 asset/content/publish，work/integration/review/template 仅文字（`operations-view-model.ts:361-403`）；详情页把 Task 的 `todo` 交给只认 draft/running 的 `ProductStatus`，显示"状态待识别"（`operations-task-page.tsx:495-503`）；详情无处理动作（同文件 505-557）。
- 归因：**路径问题**（状态机口径不统一）。

**P1-2 · 资产生命周期治理未实现 — 对标 C3 回收站/引用保护缺失**
- 现象：生成 Asset 不自动成完整 Product Asset 治理对象，无 archived/recycle 状态，详情动作是授权撤回而非归档/恢复（对账 §6 P1-D）。
- 归因：**时间/范围**（明确排后）。

**P1-3 · 工作台结构未达 CreatOK 意图态水平 — 对标 C1/C8 视觉分 6.5 vs 8.0**
- 现象：一框 8+ 子块、成品不领屏、skip 与主 CTA 竞争（`exit-report.md:25-31`）；R2 自认"不能靠继续换 token 达 8.0，须先重构 IA"（`references-docs...reconciliation:98`）。
- 归因：**路径问题**（T1-T7 七轮局部调 token 代替结构重构，见 §三）。

**P1-4 · 合规护城河真实验收未做 — 对标 C12 差异化未兑现**
- 现象：合规 gate/AIGC/Preflight 有骨架，但 ADR-0004 资质准入制、平台规则须"真实账号实测"（`feedback-regulated-market-access-gating`）未接真实账号；medical 场景 Regulated Mode 未走真实医美商户验收。
- 风险：合规是被反复强调的"真护城河 vs 负债"分水岭（MEMORY 项目笔记），只做骨架=负债。
- 归因：**时间/优先级**（绑定 pilot 触发点，尚未到）。

### P2 级（细节体验/范围内已知）

**P2-1 · 模型偏好持久化弱 — 对标 C4 半落残余**
- 现象：`ModelPreferenceRegistry` in-memory（`catalog.ts:449`）、current selection 走 sessionStorage，跨设备/重启不持久。
- 归因：**路径问题**（未接持久层），但优先级低（链已通）。

**P2-2 · 图文套图模块选择器未成独立产物链 — 对标 C2 缓做**
- 现象：`contentModules` 有 state，但 CreatOK 式"至少 7 张卡片结构化输出"（`creatok-function-breakdown.md:259-269`）的渲染管线 ADR-0008 缓做。
- 归因：**范围/时间**（视频优先主动缓做）。

---

## 三、根因归因（本维度重点）

对未落地/半落项做路径/资源/时间三分类。**先证伪"资源不足"和"时间不足"，再锁定"路径问题"为主因。**

### 3.1 证伪：不是资源问题

资源投入证据充分：
- Core 411 tests（391 pass/20 skip）、Web 234 tests、`pnpm check` 全绿（对账 §10）。
- 72 个 product 组件、35 张 P1 实施票 + 25 张 Path B 票交付（`.scratch/p1-implementation/MAP.md`、`uiux-upgrade-b/MAP.md`）。
- Codex CLI 执笔 + Opus×25 对抗校验全过（MEMORY 项目笔记）。
- 工程质量历史评为 A-（`p1-code-quality-deep-review-2026-07-12.md:20`）。
- 单体架构对标（C10）、账本（C5）、异步任务（C4 骨架）、ffmpeg 真实合成（C9）——这些**需要真功夫的部分都落了**。

**若是资源不足，不会出现"411 测试全绿 + 72 组件 + 假 mp4 都修好了"的现状。资源是饱和的（与用户既定"饱和开发资源、拒绝残缺 MVP"工作方式一致）。**

### 3.2 证伪：不是主要的时间问题

- 视频套图缓做（P2-2）、资产生命周期（P1-2）、Agent Skills 外部（C7）——这些是 **ADR-0008/范围决策主动后置**，不是排不进；属正常范围管理，不是"对标落不下"的主因。
- 真实媒体激活（P0-2）确有时间/优先级成分（Ark 07-14 才补、抖音绑 pilot 触发点），但"代码 07-14 才补"本身暴露的是**优先级排序问题**（真实执行面排在 UIUX 七轮打磨之后），根子仍回到路径。

### 3.3 锁定主因：开发路径问题（三条病根）

**病根 A · done 语义坍缩**（对账 §8.1 已命名，本维度确认它直接导致"对标落不下"）
- 决策关闭、代码提交、fixture 测试、视觉退出线、正式关票被反复写成同一个"完成"。
- 后果：对标点 C1-C12 在"壳成立"就被记为"已对标"，但 CreatOK 的对标价值恰在**闭环**（生成→资产→历史→发布→账本连成一条真实链，`creatok-function-breakdown.md:672-675`）。壳成立 ≠ 链闭合。
- 证据：`daa9081 feat: complete UIUX upgrade B tickets` 实为 implementation dump，机器真相里 04-25 仍 open、I01-I12 non-green（对账 §2.1）。

**病根 B · 两套事实靠投影拼接，未收敛**
- `creativeContents` vs `contents`（P0-1）、creative Asset vs Product Asset（P1-2）在视觉上"像一个库"，动作与生命周期仍断裂。
- 这是**架构演进中"先做投影兼容、后收敛真身"却停在第一步**的典型路径债。CreatOK 的"流里跑、库里存"（C8，`02-合成...:31`）要求二者同源；我方做成了两源投影。
- 后果：对标 C3/C4/C8 全部卡在"能展示、不能续作/入库"。

**病根 C · 局部优化代替结构重构**
- 工作台视觉 T1-T7 连打七轮 token/密度/CTA（git log `c49fa45`→`8f6c8e0`），分数 3.83→6.5，但 R2 自认"不能靠继续换 token 达 8.0，须先重构信息架构"（`references-docs...reconciliation:98`、`exit-report.md:25-31`）。
- 对标 C1/C8 的"意图态、成品领屏"是**信息架构命题**，用视觉微调解不了。这是路径依赖：沿着"调组件"的熟路走，绕开了"重构 IA"的难路。

### 3.4 归因总表

| 未落/半落项 | 路径 | 资源 | 时间 | 主因判定 |
|---|:--:|:--:|:--:|---|
| P0-1 内容入库断链 | ● | | | **路径**（两套事实未收敛，病根 B） |
| P0-2 真实媒体/抖音/BYOK 未激活 | ● | | ◐ | **路径为主**（recorded 空转太久+排序靠后）+ 时间（绑触发点） |
| P0-3 对象续作断链 | ● | | | **路径**（IA 合同未接线） |
| P1-1 Task 合同断链 | ● | | | **路径**（状态机口径不统一） |
| P1-2 资产生命周期 | ◐ | | ● | **时间/范围**（主动排后） |
| P1-3 工作台结构 6.5<8.0 | ● | | | **路径**（局部优化代替重构，病根 C） |
| P1-4 合规真实验收 | | | ● | **时间/优先级**（绑 pilot 触发点） |
| P2-1 偏好持久化 | ● | | | 路径（未接持久层） |
| P2-2 图文套图管线 | | | ● | 时间/范围（视频优先） |

●=主因 ◐=次因。**路径问题命中 6/9，是"竞品对标落不到产品上"的绝对主因。**

### 3.5 一句话根因

> 我方把 CreatOK 的**功能对标**做透了（抄到 80% 功能清单 + 更强的合规差异化设计），却把**闭环对标**做浅了（真实模型/媒体、内容入库、对象续作、官方发布 Adapter 停在 recorded/fixture 壳与两套事实）。CreatOK 的产品价值 = 真实闭环跑在 30 万用户上；我方现状 = fixture 下完整的壳。对标落不下的根因不是"没抄到"，而是"抄到了形、没接通真实价值链"——这是 done 语义坍缩 + 两套事实未收敛 + 局部优化代替结构重构三条路径病根的合力，与资源/时间基本无关。

---

## 四、阶段判定

用统一标尺（L0 脚手架 / L1 demo 可演示 / L2 真实端到端可用 / L3 商家易用）对竞品对标覆盖度打分：

| 对标簇 | 阶段 | 依据 |
|---|:--:|---|
| C1/C8 首页主工作流 + AI 原生旅程 | **L1→L2 之间** | 意图态壳、候选、开场全落且可演示；但成品不领屏、结构未达 CreatOK、真实商家未验（`exit-report.md`） |
| C2/C3 结构化工作流 + 资产库 | **L1** | 能展示、能拼接投影；套图管线缓做、资产生命周期缺、两套事实未收敛 |
| C4 任务历史/异步 | **L2（壳）/L1（续作）** | durable job 骨架扎实可演示；对象自身续作与 Task 合同断链，未到真实端到端 |
| C5 账本 | **L2** | reserve/commit/refund 双账本真实落地，是对标最扎实一条 |
| C6/C9/C11 发布 + 视频 + 真实模型 | **L1（+局部 L0.5）** | ffmpeg 真合成、Ark 真 fetch 代码就绪=L1；但默认 disabled、抖音/BYOK recorded、未激活=未到 L2 |
| C10 架构 | **L2** | 单体+双队列+AI SDK Port 真实运行，符合 ADR，可承载后续真实接线 |
| C12 合规护城河 | **L1** | 骨架+计划齐；真实医美准入/平台规则实测未做 |

**本维度综合阶段判定：整体处于 L1（demo/recorded 可演示）向 L2（真实端到端可用）过渡的前半程，且被"两套事实未收敛 + 真实执行面未激活"两道路径闸卡住，尚未跨入 L2。**

- 已越过 L0/L1：脚手架、壳、状态机、fixture 演示对标覆盖充分。
- 未进入 L2 的硬门槛（全是对标落地的"最后一公里"）：① 真实媒体/抖音执行激活；② accepted 内容进一级库；③ 对象续作接线。
- L3 远未触及：真实商家易用性、稳定性、闭环顺滑均无证据（S5 从未完成，对账 §11）。

**与 CreatOK 定量对照**：CreatOK 自身在 benchmark 得 63.6/100 且被判"高参考低迁移"（`p0-benchmark-matrix.md:231`）；我方对标它的落地覆盖，功能维度可达其形，但"真实生产系统"维度（真实模型/发布/账本跑在真实用户）——CreatOK 是 confirmed 发货，我方是 recorded 壳，这一层的对标差距是当前与 L2 之间的全部距离。

---

## 五、增量建议（归因驱动，不重复既有 frontier）

既有对账已给 F1-F8 / Frontier A-C，本维度只补"从竞品对标归因视角"的增量排序与护栏，避免重复造轮子：

1. **先拆"done 语义坍缩"的度量口径（治病根 A，零代码成本，最高杠杆）**：对每个对标点 C1-C12 强制三态标注——`壳成立` / `真实链通` / `商家验收`，禁止用 commit 标题或 fixture 绿灯宣称"已对标"。这是让后续所有对标判断不再漂移的前提。

2. **两套事实收敛优先于任何新功能（治病根 B，对标 C3/C4/C8）**：`creativeContents`→`contents`、creative Asset→Product Asset 的收敛，验收必须走"生成→采用→一级内容库可见→编辑/交接"真实用户链（对账 F1），而非查 projection。这条不通，C3/C4/C8 的对标永远停在 L1。

3. **真实执行面激活按"一条打通"而非"全模态铺开"（治 P0-2，对标 C6/C9/C11）**：优先激活 Ark 已就绪的 seedream/seedance 两条（补 `ARK_*_ACTIVATION_*` 证据 + 真实 smoke test），把 `ArkMediaCompositeExecutionPort` 的 2 模型覆盖扩到 P1 首发池；抖音/BYOK 必须换掉 `main.ts:326,334` 的 RecordedAdapter 装配，不得再以"只差 Key"表述（它们是硬编码 recorded）。一条真实链通 > 十条 recorded 壳。

4. **工作台重构走 IA 而非 token（治病根 C，对标 C1/C8）**：停止第八轮视觉微调，改为拆 8+ 子块、成品领屏、单一主动作——这是信息架构命题，R2 已自认（对账 F5）。

5. **对标护栏**：CreatOK 单体/无独立 agent runtime/异步轮询的架构取舍（C10，`creatok-architecture-estimate.md:54-60`）已被我方正确继承，勿因视频/媒体接入而过度拆分；KickArt 旗舰 ¥32.8 万/年不订阅套壳的两笔硬账（`03-合成...:24-28`）继续成立，真实媒体走 Ark 直调是对的方向。

6. **合规差异化尽早接真实验收（治 P1-4，对标 C12 是唯一护城河）**：ADR-0004 资质准入制 + 平台规则须绑第一批 pilot 真实账号实测，否则 C12 从"护城河设计"沦为"负债骨架"。

---

## 附：本轮核实清单

| 核实项 | 结果 |
|---|---|
| Ark 媒体是否真发请求 | 是，`ark-media-adapter.ts:459,502,573` 真 fetch 火山方舟；默认 disabled（`runtime-config.ts:368`） |
| Ark 提交时序 | `22a9d4e` 07-14 21:45，晚于两份对账 HEAD，属新增增量 |
| accepted 内容是否入一级库 | 否，`application-service.ts:5638` 仍只写 `creativeContents`；前端读 `state.contents`（`content.tsx:100`） |
| ffmpeg 是否真合成 | 是，`video/composer.ts:240`、`media-tools.ts:1` 真 spawn ffmpeg |
| 抖音/BYOK 生产装配 | recorded 硬编码，`main.ts:326,334` |
| 工作台选模 | 已接 `resolveCreationModelSelection` 优先级链（`unified-creation-workbench.tsx:589`），对账 P0-H"挑第一个"措辞已过期；偏好 in-memory 持久化弱 |
| LLM direct activation | `configured_unverified`（`adapters.ts:1509`），须活化证据升 live |
| 资源投入 | 饱和（411+234 tests、72 组件、Codex+Opus 对抗），证伪"资源不足" |
