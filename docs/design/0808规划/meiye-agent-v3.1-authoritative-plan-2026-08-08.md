# 丽客美页 Beauty Marketing Agent V3.1：Agent-native 升级合并权威版

**版本**：V3.1 / 2026-08-08
**方案性质**：产品、领域模型、LLM 编排、Harness、事件协议、前端、平台设施、迁移与验收的**单一权威**实施规格
**取代**：`meiye-agentic-workbench-v2-complete-plan.md`（V2）与 `完成.md`（V3）两份草案。两份草案冲突处以本文为准；本文未覆盖的细节以 V2 为补充参考。
**修订依据**：`docs/reviews/0808-agentic-plan-cross-review-2026-08-08.md`（R1–R16）＋ `docs/reviews/v3.1-product-first-framework-benchmark-review-2026-08-08.md`（框架对标 A/B/C/D 组）＋ `docs/reviews/v3.1-codex-xcheck-2026-08-08.md`（codex 独立交叉复核：9 BLOCK / 13 MAJOR / 3 MINOR 已全部修入，U1–U12 经用户逐项拍板）＋ `docs/reviews/v3.1-specs-codex-xcheck-2026-08-08.md`（九张 spec 交叉复核与 U13–U14 裁决）。现行决策汇总为 **U1–U14 共 14 项**；已拍板硬约束见附录 A，完整决策记录见附录 B。

> **权威勘误（2026-08-19）**：历史版 §0.4 曾错把 D-088 记为「不新增 message/thread 实体」。正确裁决是：`AgentThread` 一等化 supersede D-046 中的 Thread/消息实体禁令；`/dashboard/recent` 收编为 Thread 列表投影另承接 D-097。D-088 仍是「视频局部/完整重生均为新用户任务」的计费与血缘合同，不被本方案 supersede。可审计原记录与 accepted correction 见主决策日志 D-178 后的「D-178 权威勘误」。

---

## 0. 单一权威结论

本次升级保留 **Intent → Plan → Make** 的业务语义，但系统的责任划分正式改为三层：

```text
Agent 层
长期关系 / Thread / Goal / Memory / 判断 / 规划 / 主动建议
        ↓ 编译
Execution 层
确定性门禁 / 费用 / Provider 副作用 / 恢复 / 幂等 / 交付
        ↓
Artifact & Evidence 层
ContentPackage / Asset / Delivery / Outcome / Audit
```

商家前台表现为一条连续、主动、可恢复的 **Agent Workstream**（文档式时间线，非气泡聊天、非三步向导、非卡片堆叠）：

```text
商家说一个模糊经营目标
  → Agent 检索门店事实、授权素材、历史内容与经验
  → 形成可见但非阻塞的理解与假设
  → 只对高影响歧义问一个问题
  → 按任务分级：轻任务直接做，复杂任务 Living Plan 逐步成形
  → 确定性系统补齐事实、权利、费用、能力与执行边界
  → 含付费媒体时用户确认一次（纯 copy 免确认）
  → Production Harness 按冻结方案执行
  → 同一个 Artifact 原位生长
  → 用户可在运行中 steering
  → Delivered 后精修、发布交接、商家自报结果
  → 结果进入 Memory，供下一次判断
```

核心技术边界：

> **LLM 驱动语义与创意；Agent Session Harness 驱动理解、检索、Plan 与 Steering；Production Make Harness + DBOS 驱动付费执行、幂等、恢复、结算和交付；HarnessRelease 驱动版本、评估、灰度与回滚。**

### 0.1 V3 四个上层假设的裁决结果

| # | V3 主张 | V3.1 裁决 |
|---|---|---|
| 1 | `AgentThread` 不再等于 `Work` | **采纳**，须显式 supersede D-016（部分）与 D-046 中的 Thread/消息实体禁令，Recent 投影另承接 D-097，见 §0.4 |
| 2 | `MarketingGoal` 成为一等对象 | **采纳合同，移出首切片**：不建 Goal CRUD 管理面，由 Agent 从 Thread 中提议、用户确认才创建 |
| 3 | Memory 成为正式 Agent 子系统 | **采纳方向**，但「Soft Preference 自动生效」撤回（改双通道，§12.3）；实现收编现有 preference 体系而非另起新表（§12.5） |
| 4 | 五阶段降级 + Typed Plan Grammar | **五阶段降级为 trace taxonomy 采纳**；Grammar 解释器**否决**，降格为 plan-as-data（§22） |

### 0.2 不变的产品真相

- `Task / Work / ContentPackage`；
- DBOS durable workflow（唯一耐久执行底座，禁第二套 durable runtime）；
- execution snapshot 与 route snapshot；
- 事实、权利和资质门；
- 积分报价、预扣、结算和失败退还（计费规格 2026-08-01 全部纪律不变）；
- Prompt exact version 与 Skill manifest；
- Result Center / Object Workspace；
- 单 Dashboard 创作主路由；
- `copy | note | media` 三类 carrier（kind 三枚举 + 兼容别名，不做破坏性迁移）。

### 0.3 本次新增

1. **AgentThread / AgentRun / MarketingGoal**：长期会话、运行记录、上位经营目标；
2. **Agent Workbench**：连续叙事、Activity、Living Plan、Artifact、Critical Interrupt，Thread-root；
3. **Agent Session Harness**：低延迟、低副作用的 Intent/Plan/Steering 控制循环；
4. **ExecutionPlanSnapshot**：用户确认的方案与 Production Harness 实际执行方案完全一致；
5. **Memory 平台**（收编升级现有 preference 体系）与 **Outcome Evidence / 商家自报旅程**；
6. **HarnessRelease**（唯一 release 对象）：统一管理 Prompt Pack、Skill、Tool、Schema、Model Policy、Eval、Canary 与 Release。

### 0.4 决策登记（supersede 与承接）

本方案显式推翻 / 修订以下既有决策，按项目纪律记录：

| 决策 | 处置 | 说明 |
|---|---|---|
| D-016「不引入第二套 Agent/工作流/记忆运行时」 | **部分 supersede** | AgentThread/AgentRun 持久化与 Memory 平台化落地属其射程；「禁第二套 durable runtime」半句**继续有效**（AgentKernel 无 durable checkpoint，见 §7.3） |
| D-046 中的 Thread/消息实体禁令 | **部分 supersede** | AgentThread 立为一等对象；D-046 的 result 阶段自由调整与 derived revision 能力继续有效 |
| D-097 最近创作/可行动状态入口 | **承接并收编投影** | `/dashboard/recent` 收编为 Thread 列表投影，不并存两套会话/最近创作真相 |
| D-164①（首屏顺序）已被 GAP R-1 supersede | **承接 R-1** | 首屏顺序按 XHS spec §2.4；Workstream 改版若变动首屏顺序须再走显式 supersede |
| 全量 Prompt strict boot 校验 | **修订** | 校验时点从 boot 挪到 release 发布，见 §29.3 |
| U1–U14 十四项实施决策 | **已拍板（2026-08-08）** | 主计划 codex 复核产出 U1–U12，九张 spec 复核产出 U13–U14；记录与正文落点见附录 B |

以下决策**不推翻、逐条承接**（曾被 V2/V3 遗漏）：D-061、D-153、计费 §4.1/§4.2、D-166③、D-167①②③⑤、D-163①、D-038、D-168②、D-116/D-169①、D-171②④——全文对应落点见附录 A。

### 0.5 明确不做

- 不让 LLM 成为业务状态机或数据库权威；
- 不让模型直接选择 Provider、修改费用或绕过权利门；
- 不引入第二套 durable Agent Runtime（LangGraph+DBOS、Mastra Workflow+DBOS 双 checkpoint 均禁止）；
- 不建 Plan Grammar 解释器 / 任意 DAG / 商家侧 DAG；
- 不暴露原始 Chain of Thought，也不持久化；
- 不允许模型生成任意 HTML、CSS、JavaScript 或任意 React 组件；
- 不用无限多 Agent 自由协商；每个 Specialist 不拥有独立长期人格 Memory；
- 不为「看起来实时」把稳定 SSE 全量迁成 WebSocket；
- 不建设完整视频 NLE、CRM、预约或收银系统；
- 不在用户确认后静默重算出不同方案；
- 商家不可安装 Skill；不开放第三方脚本直接运行；无 arbitrary shell / arbitrary SQL；
- Agent 不修改价格事实、不判定权利有效、不无确认发布；
- 不逐 token 落库；
- 每次简单改字不生成 Living Plan。

---

# Part I：产品

## 1. 产品目标

最终产品不是「给门店一个很好用的 AI 内容生成器」，而是：

> **长期理解这家店，并持续帮它完成宣发工作的 Beauty Marketing Agent。**

产品长期闭环：

```text
经营目标 → 理解门店现状 → 读取长期经验 → 发现机会 → 制定计划
→ 制作内容 → 交付/发布 → 记录结果 → 学习 → 提出下一步
```

护城河优先级（投入按此排序）：

```text
长期经营证据 > 长期 Memory > 上下文与 Skill > Agent Planning > 复杂编排技巧
```

**燃料警示（R11）**：首发 `automatic_verified` 平台数 = 0（D-086），闭环唯一现实燃料是**商家自报**。因此「记录结果」不是 schema 问题而是旅程设计问题，见 §6.3；Proactive 能力以 evidence 覆盖率为准入门，见 §25。

## 2. 目标产品体验

### 2.1 用户只需要理解五件事

1. 我想解决什么经营问题；
2. 系统理解成了什么；
3. 系统准备为我制作什么；
4. 现在做到哪一步、是否需要我处理；
5. 成品是否已经可以发布。

模型、Prompt、Provider、Task、Route、Revision、Schema、Job 等内部对象不进入主界面。

### 2.2 成功形态

> 用户：「明天下午还有两个空档，帮我发点奶油风美甲，不要太像广告。」

1. 自动识别「填补空档 + 推新品」；
2. 检索门店项目、最近授权素材、店主表达身份与最近发布内容；
3. 告知「找到 5 张适合的授权图片，价格没有可靠来源，因此不写价格」；
4. 只问一个真正影响结果的问题；
5. Living Plan：小红书 6 页图文 + 朋友圈短文案 + 预约 CTA；
6. 显示预计积分、失败退还、权利和事实状态；
7. 含付费媒体 → 用户确认一次后开始；
8. 图文页在右侧 Artifact 逐页长出；
9. 中途说「封面不要写最后两个名额」，只修改未完成的封面计划；
10. 完成后进入发布准备和手机交接；次日一句话追问结果。

### 2.3 Delivered 不等于 Thread 完成

```text
当前 Work delivered → 继续聊 → 新 Work → 同一 Goal / Thread
```

这是 Thread 独立于 Work 后最重要的产品变化。

## 3. 分级创作流程（Progressive Plan）

取消「所有任务必经完整 Living Plan + 确认一次」。分级如下：

### Level 0：确定性轻修改

例：「删除最后一句。」

```text
request → deterministic derived revision
```

无 Plan、无确认、无 Agent Session LLM 调用（直接走 revise 原语的确定性路径）。维持 D-013/D-164⑥ 原义。

### Level 1：简单生成（纯 copy）

例：「写一条朋友圈护理介绍。」

内部产生 concise intent/brief；前台不强制展示完整 Living Plan。

**硬边界（R2 + U1 拍板）**：Level 1 免确认**仅限纯 copy（零付费媒体调用）**，且此为**永久口径**——不设积分阈值、不设操作 allowlist，未来放宽必须显式 supersede（避免「金额阈值绕过权利门」：便宜的图也可能用受限素材）。任何含出图/出视频的「简单生成」一律过执行确认（流内 interrupt 形态即可，不必是完整 Living Plan）。判定权威 = XHS spec §3.2 / D-171③：「按是否含付费媒体执行」，验收门「拒绝则零扣费」。免确认路径同样冻结 `ExecutionPlanSnapshot`（`approvalBasis: policy_exempt_copy`，§14.2）——免的是确认，不免冻结。

**计费 UX 规则（R5，Level 0/1 免确认路径必须满足）**：

- 报价 chip 常显：「本次约消耗 N 分」+ 该模型失败退还开关双态文案（「失败自动退回」/「该模型失败不退回」）；
- 余额不足 → 阻断提交 + 双出口引导（买加油包 / 升级套餐），不透支；
- 失败退还状态在流水与前台可见。

### Level 2：复杂创作

例：「做一套小红书 5 页护理案例。」

```text
Living Plan → 用户可改 → 含付费媒体确认一次 → Make
```

### Level 3：Campaign / Goal Plan

例：「8 月帮我持续推头皮护理。」

Plan 可按周分解，一个 Plan 派生多个 Work。Campaign 不需要动态拓扑：= 一个 Plan 派生 N 个标准 Work（§22）。

**付费授权粒度（U7 拍板）**：Campaign 确认只批准计划与排期；每个含付费媒体的派生 Work 启动前按 exact quote/rights 单独流内确认，纯 copy Work 仍免确认（§14.1）。

## 4. 页面与信息架构

### 4.1 路由原则

| 路由 | 职责 |
|---|---|
| `/dashboard` | Agent Workbench：Thread-root 的唯一创作入口 |
| `/dashboard/results/$workId` | 对象工作区、精修、发布交接 |
| `/dashboard/works` | 成品与历史内容 |
| `/dashboard/recent` | **Thread 列表投影**（收编，不另存会话真相）与恢复入口 |
| `/dashboard/store` | 门店、项目、素材、身份、事实 |
| `/dashboard/memory` | 前台显示为「经验」（现有 memory-vault 升级，§12） |

不新增 `/intent`、`/plan`、`/make` 一级页面。

`/dashboard` search schema 新增：

```ts
interface DashboardSearch {
  threadId?: string;
  taskId?: string;
  identity?: string;
  intentId?: string;
  planId?: string;
  phase?: 'intent' | 'plan' | 'make';
}
```

`phase` 只作首屏定位提示；服务端 `WorkbenchSessionProjection` 是状态权威。首屏顺序承接 GAP R-1（问候 → 分段器 → Composer → 建议行 → Activity Shelf）；Workstream 改版若变动此顺序须显式 supersede。

### 4.2 桌面布局

```text
┌───────────────────────────────────────────────────────────┐
│ 顶栏：工作台 / 当前门店 / Agent 主动度 / 积分 / 恢复状态 │
├───────────────────────────────────────────────────────────┤
│ 左 62%：连续 Agent Workstream │ 右 38%：Shared Artifact  │
│ Narrative / Activity / Inline  │ Plan / Note / Video /    │
│ Choice / Living Plan /         │ Publish 原位持续更新     │
│ Interrupt / Steering Composer  │                          │
└───────────────────────────────────────────────────────────┘
```

Idle 主列约 800px；Active/Delivered 且有 Artifact 时展开到约 1240px（承接 D-171① 宽度合同）。复用 `react-resizable-panels` 与移动 Bottom Sheet。

### 4.3 移动端

- 默认显示 Workstream；顶部胶囊切换「过程 / 作品」；
- Artifact 在全屏 Sheet 打开；Composer 固定底栏上方；
- 付费 Interrupt 用全宽底部面板；
- 拍摄、上传、确认、查看进度和发布交接为主；不在手机上完整暴露复杂编辑器。

## 5. 商家工作台完整流程

### 5.1 Workbench 四态（Thread-root）

`Idle / Active / Waiting / Delivered` 保留，但工作台对象从「单 Work」升级为「Agent Thread」。

**Idle** 展示：当前最重要 Goal（如有）、Agent 主动建议（evidence 门控，§25）、最近 Thread、一句话 Composer、少量能力入口。不展示 Workflow/Provider/Skill/Node/Trace。

**Waiting** 必须解释：为什么停 / 需要你做什么 / 如果不做会怎样 / 默认何时继续。超时语义承接 D-116/D-169①：超时 = **语义层默认回答**（系统代答，仅限无对外副作用；涉外部副作用或超额度不自动继续），留痕区分商家答/代答；**不做载体层挂起过期**（过期→失败/取消是被禁形态）。付费确认 hold 到期走 D-153：取消任务 + 退分 + 白话告知（§14.4）。

### 5.2 Intent：连续理解，不是填写表单

Agent 行为：先解释当前理解 → 自动检索已有信息 → 显示安全 Activity → 提出低风险假设 → 只在高影响歧义时追问 → 不扣积分、不启动付费媒体生成。

### 5.3 Living Plan：活文档，不是卡片表单（Level 2+）

Plan 在同一条 Workstream 中逐行形成（目标 / 本次制作 / 表达策略 / 事实与素材 / 预计积分与时长）。用户可用自然语言调整（「只做小红书」「再自然一点」「减少到 4 页」）；每次调整产生新的 Plan revision，重新核查事实、权利、能力和 quote；旧版本不可被静默覆盖。

### 5.4 Commit Strip / Critical Interrupt

普通 Plan 用紧凑确认条：

```text
38 积分 · 余额 126 · 素材授权通过 · 事实可用 · 失败自动退回
[返回修改] [开始制作]
```

只有以下情况进入 Critical Interrupt：付费媒体执行；顾客素材或受限素材；高风险事实冲突；资质缺失；费用变化；模型降级会改变质量或交付；发布等外部动作；bounded execution 继续增加预算。

Interrupt 必须只读、解释原因、提供明确出口，不重新变成设置表单（承接 D-164③：卡上只有拒绝/确认两个动作）。

### 5.5 Make：Artifact 原位生长

左侧 Workstream：当前阶段、已完成内容、需要用户处理的唯一事项、可否离开、失败和退还状态。右侧同一个 Artifact 持续更新（文案逐块 / 图文逐页 / 视频逐场景 / 发布准备逐项）。不重复追加「候选卡+结果卡+交付卡」；同一对象只更新一个稳定 ID。

视频逐场景的场景状态面＝**分镜/关键帧**两项（2026-08-11 用户拍板：字幕/封面为无效功能、无字幕/封面状态位；契约收窄见 V31-60，字幕残链清理见 V31-61）。

### 5.6 Steering

用户运行中输入自然语言，系统先分类（详见 §24）：

| 类型 | 行为 |
|---|---|
| `future_step_patch` | 修改尚未执行步骤，不重新报价 |
| `derived_revision` | 已完成内容创建派生版本 |
| `plan_change` | 数量、模型、平台、费用或事实改变，回到 Plan |
| `unsafe_or_conflicting` | 解释冲突并要求修正 |

前台必须显示影响范围：「已应用到封面和第 2 页；其他页面不变。」

**计费口径（2026-08-23 用户终裁，收口 §23.3 `derived_revision.requiresRequote` 与 V31-105 §1 A）**：

- 已提交并触发上游供应商 API 调用的单元，一律正常计费——Steering 不回滚、不退免已发生的供应商调用（与「accepted/acceptance_unknown 的 Provider 副作用不可被修改」一致）。
- **已生成页重做按页计费、未生成页免费改向**：`derived_revision` 只对 already-invoked 受影响页走报价工作流（数量＝这些页的个数，同源 `quoteAuthority.resolve` → `billing.buildQuote`）；尚未生成的受影响页是 `future_step_patch` 改向，0 额外积分；未点名的页保持不变。
- 混合指令：已生成的受影响页计费，未生成的兄弟页免费，其余页不动。
- 商家面表述遵循 D-061（不暴露上游成本），只显示积分口径。quote 已解析时明示数字（例「封面会按你的改法重新生成并计 12 积分；其余页不动，不另算积分。」）；quote 尚未解析时不拿旧余额猜数字。

## 6. 发布交接与商家自报旅程

### 6.1 Delivered 默认展示

主推荐、其他交付物、发布准备度、快捷修改、打开对象工作区、生成同系列、进入发布交接、**继续同一 Thread**。

### 6.2 发布交接（落在 D-155 白名单内）

- 标题、正文、话题、CTA 分块复制；
- 图片按顺序命名和批量下载（确定性 ZIP）；
- 视频和平台安全区（**2026-08-11 用户拍板，V31-37 采 A 路**：视频字幕与视频封面为无效功能、不交付——承认 #264 退役口径，字幕/封面由发布平台承担，产品侧不承诺字幕轨与封面面板）；
- **手机二维码继续**：语义限定 = 交接页搬到手机、由**商家自己**在其平台账号发布（MobilePublishHandoff）；**不含**扫码后由我方驱动任何发布动作（D-171④ reject + D-155 冻结面）；
- verified / assisted / unavailable 能力三态：未验证发布能力不显示为可直发，不伪装自动发布成功；
- 「我已发布」、链接、时间和截图留痕，绑定 exact ContentPackage version；
- assisted 交接承接既有 receipt 细则：24h 未确认提醒、一次性链接 72h 失效、「已交接」与「已发布」分离。

### 6.3 商家自报旅程（R11，学习闭环的燃料入口）

自报必须是近零摩擦旅程，不是 `POST /outcomes` 表单：

- 发布交接完成**次日**一句话追问：「昨天的笔记有人来问吗？」（U2 拍板：次日一次，不做可配置多次）；
- 一键信号 chips：`有人问 / 加微信 / 预约了 / 买券 / 到店 / 没动静`；
- 可补链接/截图但不强制；
- 打扰频控（U2 拍板）：同一 Work 最多追问一次，商家连续两次不理会则该店降频；
- 自报数据进入 OutcomeEvidence（`merchant_reported`），是 Memory 与 Proactive 的主燃料。

---

# Part II：领域模型

## 7. 架构总原则

### 7.1 One canonical owner per semantic fact

不再使用「全系统只有一个真相源」的过度简化表达。目标规则：**禁止同一语义多个 writer，而不是禁止系统存在多个领域真相。**

| 语义 | Canonical owner |
|---|---|
| 门店、项目、价格、活动等真实经营事实 | Business Fact Domain |
| 素材及权利 | Asset / Rights Domain |
| Agent 长期对话 | AgentThread |
| 长期经营目标 | MarketingGoal |
| Agent 经验和偏好 | Agent Memory（收编现有 preference 体系，§12.5） |
| 一次执行任务 | Work / Task |
| 耐久副作用状态 | DBOS Workflow |
| 用户方案 | MarketingPlanRevision |
| 成品 | ContentPackage |
| Provider 状态与成本 | Route / Provider Attempt / Cost Ledger |
| 用户额度 | Usage Ledger（积分与上游成本**永久双轨，禁止合并**，D-061） |
| 外发结果 | Delivery Receipt |
| 经营反馈 | Outcome Evidence |
| Prompt、Skill、Tool 版本组合 | HarnessRelease（唯一 release 对象，§29） |
| UI 呈现 | React Controlled Surface Registry |

### 7.2 Agent 可以自主判断，但不能拥有业务授权

Agent 可以：理解目标、召回 Memory、自主选择 Skill、自主查询能力、自主决定下一步读什么、编译 Plan、对失败输出有限自纠、提议长期经验、提议下一次营销动作。

Agent 不可以：修改真实价格；判断权利已经获得；创建用户额度；绕过产品用量；修改 Provider 接受态；伪造发布成功；替用户完成不可逆批准；将未经确认的推测升级成经营事实。

### 7.3 AgentKernel 与 Durable Runtime 解耦

```text
AgentKernel → PlanCompiler → ExecutionSnapshot → DBOS
```

- AI SDK 是首个 `AgentKernel` 实现（`AiSdkAgentKernel`），隔离在 adapter 后；
- port 定位收窄（D5）：**只为测试隔离与 AI SDK 大版本升级服务**，不承诺跨框架可替换性（kernel 替换＝全量回归，无真实消费者）；同一环境只选一个主 AgentKernel；
- **AgentKernel 无自己的 durable checkpoint**——不允许两套 Agent durable checkpoint 与 DBOS 长期并存（D-016 保留半句）。

### 7.4 双 Harness 边界

**Agent Session Harness**：Intent 理解、主动检索、模糊适配、Plan 编译、Plan 调整、Make steering、经验候选——低成本、快速、可取消，只读优先，Plan 确认前不做付费媒体副作用。

**Production Make Harness**：付费模型调用、图片视频生成、durable provider job、bounded execution、付费确认、部分成功、账本结算、ContentPackage 组装、恢复。

二者混在同一循环会让简单理解请求进入重型 durable 生产链；完全分开但不共享冻结 Plan 会导致确认方案与执行方案漂移。中间由 `ExecutionPlanSnapshot` 连接（§14）。

Level 0 确定性轻修改**不进任何 Harness LLM 循环**，直接走 revise 原语确定性路径。

## 8. 总体架构

```text
                Merchant
                   │
             Agent Workbench（Thread-root）
                   │
              AgentThread ──── MarketingGoal
                   │
               AgentRun
                   │
            Supervisor Agent
        ┌──────────┼──────────────┐
   Memory System  Context      Capability Registry
        │         Compiler      （Capability/Recipe/Skill/Tool）
        └──────────┼──────────────┘
             Agent Session Harness
                   │  PlanProposal
              Plan Compiler（确定性）
                   │
            MarketingPlanRevision
                   │  用户确认（按付费媒体分级）
           ExecutionPlanSnapshot
                   │
        Production Make Harness + DBOS
        ┌──────────┼──────────┐
    Generation   Assets    Delivery
        └───── ContentPackage ─────┘
                   │
            Outcome Evidence（自报为主）
                   │
            Memory / Evaluation
                   │
             Next Proposal
```

## 9. AgentThread

一次创作 Work 结束后不再天然重新开始。Thread 表达「我们最近一直在处理什么问题」：

```text
Thread「8 月新客引流」
 ├ Work: 小红书护理案例
 ├ Work: 团购活动海报
 ├ Work: 老板 IP 视频
 └ Work: 周末活动复盘
```

```ts
interface AgentThread {
  threadId: AgentThreadId;
  resourceId: MerchantResourceId;
  title: string;
  status: 'active' | 'archived';
  activeGoalIds: MarketingGoalId[];
  summaryRevision: number;
  summary?: string;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

Thread 不保存：ContentPackage 正文、Provider 状态、账本、权利、完整 Message dump。

**收编关系（R12）**：`/dashboard/recent` 改为 Thread 列表投影，不并存两套会话真相；历史 Work 首次打开时 lazy create legacy thread（§33.2）。

## 10. AgentRun

持久化的 operational object，用于 trace、replay、release 对比、failure diagnosis、eval、interruption recovery correlation。

```ts
interface AgentRun {
  runId: AgentRunId;
  threadId: AgentThreadId;
  parentRunId?: AgentRunId;
  trigger: 'merchant_turn' | 'proactive_signal' | 'follow_up' | 'system_resume';
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  durability: 'exit' | 'sync';   // 只读会话轮=exit（轮末落盘一次）；含付费副作用恒 sync
  harnessReleaseId: HarnessReleaseId;
  startedAt: string;
  finishedAt?: string;
}
```

AgentRun 不是：Task、DBOS workflow、ContentPackage、business transaction。

**durability 分级（A7；MAJOR-03 补升级语义）**：Session Harness 的只读轮用 `exit` 语义降低持久化开销；进入付费执行的 run 恒 `sync`。档位打进 trace，成本/延迟差异可解释。`exit` 档**禁止**用于任何含付费副作用的 run。

**升级/分裂语义**：`durability` 创建后**不可变**——run 不原地升档。Session turn = `exit` AgentRun；handoff 时创建 `sync` child AgentRun，经 `parentRunId + workflowId + snapshotHash` 关联到 DBOS execution。确认、重连、handoff 各持久化点与 crash 窗口须有专项测试。

## 11. MarketingGoal

用户真正说的往往是「最近新客少」「下个月想多推头皮护理」，一个目标产生多个 Work。

```ts
interface MarketingGoal {
  goalId: MarketingGoalId;
  resourceId: MerchantResourceId;
  objective: 'exposure' | 'inquiry' | 'booking' | 'group_buy'
    | 'ip_growth' | 'retention' | 'custom';
  statement: string;
  horizon?: { from?: string; until?: string };
  priority: 'low' | 'normal' | 'high';
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  evidenceRefs: EvidenceRef[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}
```

**产品口径（R15）**：Goal 不建 CRUD 管理面、不做用户维护负担。Goal 只在两条路径产生：(1) 用户在对话中表达长期目标时由 Agent 提议创建；(2) Agent 建议把最近几次内容归到某个目标，**用户确认才关联**。不从历史数据自动猜 Goal。Goal 不直接拥有执行拓扑，它是 Agent 持续规划的上位目标。

## 12. Agent Memory 平台

### 12.1 定位

```text
Business Truth → Memory System → Context Compiler → ContextBundle/ModelContext → Agent
```

Memory 不代替经营事实，保存的是「Agent 从长期交互与结果中积累出来的、怎么更好服务这家店」的信息。

### 12.2 五层认知分类（文档分类学，实现按 §12.4 收缩）

- **Working**：当前阶段正在做什么（当前目标/当前策略），自动维护，无需确认；
- **Preference**：软偏好（「小红书少一点强促销感」），有 confidence/scope/decay/evidence/correction；
- **Episodic**：一次真实经历（某日某任务商家删掉价格强调），用于未来推理归纳；
- **Procedural**：稳定的「这家店怎么做更好」的流程性经验，影响范围大；
- **Correction**：纠正类（「小林不是老板娘」「这个项目不是 199」），优先级恒高于软偏好，一等建模。

### 12.3 Authority 分层（R1 修订：撤回自动生效，改双通道）

```text
L0 Observation      自动记录，不改变未来默认行为
L1 Session-scoped   本 Thread 内即时生效；Thread 结束/交付时一键提议转正；
                    跨 Thread 持久化必须走 候选 → 商家确认
L2 Strong Preference 商家明确表达或确认后长期生效，可撤销
L3 Procedural       可改变未来流程，必须 propose → merchant confirm → promoted
L4 Business Fact    不属于 Memory 权威，必须由事实域处理
L5 Irreversible Authority  Memory 永远没有资格产生
```

承接的既有纪律（D-010/011/017/032/163②，全部继续有效）：

- 重复行为只生成候选，确认后生效；检索不能自动强化偏好；
- 被动沉淀管道产出一律 `propose_*`，不直接入库；
- 软偏好随时间衰减，事实不按行为衰减；
- `false_persistence_rate === 0` 仍是偏好学习能力的上线放行门；
- 临时纠偏被错误沉淀为长期偏好的比例硬指标 = 0。

**为什么撤回自动生效**：错误偏好自动固化的信任成本不可逆（商家感知「它学歪了还改不掉」）；Thread 内生效已拿到即时纠偏的全部体验收益，跨 Thread 转正只差一次 chip 级轻确认。

### 12.4 首批实现范围（R10）

- **做**：Working + Correction + Preference 三类；
- **Episodic** = 现有 DecisionEvent / trace 的**读取投影**，不新建写路径；
- **Procedural** 仅显式确认路径（propose → confirm → promoted）；
- **移出本期**：pattern mining（Episodic → 归纳 → Procedural proposal 的自动挖掘）、industry skill learning（多门店聚合）——燃料（outcome 体量）冷启动为零，建了空转。单店私有经验永不自动分享给其它店。

**实现形态（A6，对标 Mastra Observational Memory）**：一套抽取机制、两条落库路径——

- **working**：后台 Observer 压缩 + reflection **全量重写**（记忆规模有界，不叠层膨胀）+ async buffering（分批预算，不卡对话），无确认门；
- **preference / correction**：统一 Extractor（schema 化抽取）+ `onExtracted` 钩子**落候选表**，经 §12.3 双通道确认后生效。确认门只留在涉及商家授权语义的地方。

### 12.5 存储收编（U5 拍板：按生命周期混合，2026-08-08）

仓库已有 `p1_preference_candidates / p1_preference_promotions / p1_preference_heads / p1_memory_approval_receipts / p1_creation_experience_events` 与 `/dashboard/memory` 经验前台。**按生命周期分置，不把有界全量重写与晋升账本混进同一张表**：

- **preference / correction**：续用现有三表**扩列**（加 `kind`、`authority`、`scope`、`decay` 相关列与 `state: active/proposed/superseded/revoked/expired`）——候选→晋升→头指针的账本语义不变；
- **working**：放 **Thread checkpoint / summary**（它本来就是会话态，随 §18.3 compaction 全量重写，不进晋升账本）；
- **procedural**：先保留 confirmed projection，如需独立持久化再评估。

不新建 `p1_agent_memory_entries` 超集表。语义连续、迁移面小、不造双真相。

统一条目合同（投影层）：

```ts
interface AgentMemoryEntry {
  memoryId: MemoryId;
  resourceId: MerchantResourceId;
  kind: 'working' | 'preference' | 'episode' | 'procedure' | 'correction';
  scope: MemoryScope;   // 门店 × IP × 场景 × 平台的最窄适用组合
  authority: 'observation' | 'session' | 'strong' | 'confirmed';
  state: 'active' | 'proposed' | 'superseded' | 'revoked' | 'expired';
  statement: string;
  evidenceRefs: EvidenceRef[];
  confidence: number;
  effectiveFrom: string;
  expiresAt?: string;
  revision: number;
}
```

Embedding 只负责合法 scope 内排序。**向量相似度永远不能决定**：workspace、IP、rights、fact validity、authority。

### 12.6 删除语义（承接 D-168②）

分离删除：删源对话**不级联删**记忆条目，维护面标注「来源已删除」；记忆条目 / DecisionEvent / ApprovalReceipt / provenance 四类实体各自删除策略；ApprovalReceipt 不可删（失效不等于删除）。

### 12.7 注入透明化（Q1 补项）

每次生成注入了哪些记忆条目必须对商家可见：任务详情提供本次注入清单（memoryId / statement / 来源），「经验」页可从条目反查最近被注入的任务。上下文注入不允许发生在商家背后——这是记忆信任的产品前提，与查看 / 纠正 / 撤销并列为验收项。

**载体（MAJOR-12）**：`MemoryInjectionReceipt`（或等价 trace projection），绑定 exact task/run/release + memory revision refs。验收测试：Core 侧 tenant/revision 校验；Playwright 旅程「任务详情 → 经验来源 → 撤销 → 后续任务不再注入」。

## 13. MarketingPlanRevision（R6 修订：projection 模型）

```ts
interface MarketingPlanRevision {
  planId: MarketingPlanId;
  revision: number;
  threadId: AgentThreadId;
  goalIds: MarketingGoalId[];
  scope: 'single_work' | 'multi_work' | 'campaign';

  // BLOCK-07 修订：revision 行不可变、无状态列。compiled/confirmed/cancelled/
  // superseded 等生命周期事实由独立 append-only 事件与 PlanConfirmationDecision
  // 承载（确认权威唯一属主 = §14.3 Decision）；readiness 恒为 projection

  intent: IntentDeclaration;
  goal: { summary: string; whyNow: string | null; desiredAction: string };
  deliverables: PlanDeliverable[];      // carrier 用 kind 三枚举 copy|note|media
  expression: PlanExpression;
  factUsages: PlanFactUsage[];
  assetUsages: PlanAssetUsage[];
  rightsSummary: PlanRightsSummary;
  complianceSummary: PlanComplianceSummary;
  capabilitySummary: PlanCapabilitySummary;
  quoteRef: RevisionRef;                // 引用计费域 quote revision，不复制金额权威

  boundRevisions: {
    intentRevision: number;
    contextBundleId: string;
    contextRevision: string;
    recipeRevisionIds: string[];
    catalogRevisionId: string;
    modelRevisionIds: string[];
    sourceRevisionIds: string[];
    rightsRevisionIds: string[];
    harnessReleaseId: string;
  };

  contentHash: string;
  expiresAt: string;
  createdAt: string;
}
```

**readiness 是 projection，不是 lifecycle 状态**：`ready / stale / blocked / reprice_required` 由确定性服务基于外部事实实时计算（事实 revision 变化、素材撤权/过期、identity 变化、recipe/catalog/model capability 变化、quote 过期、Prompt Pack/Skill manifest 变化、合规主策略变化 → stale）。revision 本身 append-only 不可变，旧版本不可被静默覆盖。

LLM 不写：quote、余额、rights status、model availability、prompt/skill exact revision、execution limits、Plan expiry（全部由 Plan Compiler 确定性补齐，§22）。

## 14. ExecutionPlanSnapshot 与执行确认（R4 修订：不新造 Receipt；U7/U8/U9 拍板落地）

### 14.1 确认动作

复用并扩容 **D-164③ 执行确认卡**语义：内部可重来的**生成确认**，不是外部发布批准，不进 ApprovalReceipt 家族。卡只读、只有拒绝/确认两个动作。确认门触发判定 = 是否含付费媒体（§3）。

**Campaign 粒度（U7 拍板）**：Level 3 的 Campaign 确认**只批准计划与排期，不预授权未来扣费**；每个含付费媒体的派生 Work 在其 exact quote/rights/facts 冻结后单独流内确认（纯 copy Work 按 policy exemption 自动执行）。相关合同带 `campaignPlanRef / workOrdinal / approvalScope: 'plan_only' | 'single_work'`。

### 14.2 ExecutionPlanSnapshot（U9 拍板：中性交接物，两条路径都冻结）

Session Harness 与 Make Harness 之间的**唯一**交接物，编译定稿后冻结——不论是否需要商家确认，`exact plan / quote / release` 都必须冻结，保住「所见/所报价即所执行」，无旁路：

```ts
interface ExecutionPlanSnapshot {
  planId: string;
  planRevision: number;
  intentDeclaration: IntentDeclaration;
  contextBundleRef: { bundleId: string; revision: number; hash: string };
  executionPlan: CompiledExecutionPlan;   // plan-as-data，§22
  deliverables: PlanDeliverable[];
  promptRevisionRefs: Record<string, PromptRevisionRef>;
  skillManifestRefs: Record<string, SkillManifestRef[]>;
  routeRequirements: CapabilityRequirement[];
  quoteRef: RevisionRef;                  // 引用，金额权威在计费域
  rightsRevisionRefs: string[];
  factRevisionRefs: string[];
  boundedExecution: BoundedExecutionSnapshot;  // 闸门数值全为显式事实，禁隐式默认（D-167①）
  harnessReleaseId: string;

  approvalBasis: 'merchant_confirmed' | 'policy_exempt_copy';  // U9：含付费媒体=前者并须有确认决定；纯 copy=后者
  confirmationDecisionRef?: string;   // approvalBasis=merchant_confirmed 时必填

  snapshotHash: string;
}
```

### 14.3 确认对象 = 待决请求 + 不可变决定（U8 拍板：确认前 reserve，维持 D-153）

拆成两个对象，不让「已确认记录」承载等待期 TTL：

```ts
// 待决请求：plan 编译定稿且含付费媒体时创建；创建事务内完成预扣
interface ExecutionConfirmationRequest {
  requestId: string;
  workspaceId: string;
  planId: string;
  planRevision: number;
  snapshotHash: string;               // 一致性锚
  quoteRef: RevisionRef;              // 计费域 quote revision（D-109 冻结）
  reservationIdempotencyKey: string;  // 创建时已 reserve（确认前预扣，U8=A）
  createdAt: string;
  holdExpiresAt: string;              // D-153 业务期限（1h–30d）
  status: 'pending' | 'decided' | 'expired';
}

// 不可变决定：商家确认/拒绝时落库
interface PlanConfirmationDecision {
  decisionId: string;
  requestId: string;
  actorId: string;
  decision: 'confirmed' | 'rejected';
  decidedAt: string;
}
```

- **时序（U8=A，与 D-153 及现有 `dbos-workflow.ts` 退款证据链一致）**：请求创建事务内先 reserve（余额检查 + reservation + GrantLot FEFO 扣减**同一数据库事务 + workspace 级积分锁**，计费 §4.2）→ 等待期商家可见「已预留 N 分」→ 确认则继续执行、结算 settle；**拒绝或 `holdExpiresAt` 到期则 durable 取消 + 全额 refund + 白话告知**，无静默失效；refund 回原批次，批次过期则份额作废且流水可见（计费 §4.1）；
- **纯 copy 免确认路径（approvalBasis=policy_exempt_copy）**：无请求/决定对象、无等待期，reserve 在 Make 启动事务内按计费 §4 常规流执行（reserve → execute → settle/refund）；
- **无「旧 confirmation 双写过渡期」**：新路径 feature flag 切换，legacy durable task 走独立 replay 分支，layout 不兼容 fail closed（BILL 反双轨口径）。

### 14.4 stale 与重新确认

确认后、执行前发生实质变化（关键事实/权利/费用）→ Plan stale，必须重新确认；执行中按 Context Fence 分类处理（§23.4），不得静默更换。

## 15. 能力模型：Capability / Recipe / Skill / Tool

取消「Recipe > Skill」也取消「Skill > Recipe」，四分正交：

- **Capability**：用户能完成什么（小红书案例营销 / 活动宣传套图 / 主理人 IP 内容）；
- **Recipe**：一个成熟任务默认怎么组织；
- **Skill**：如何把某个专业环节做好（Agent-native 程序性知识载体）；
- **Tool**：真正执行哪个动作。

```text
Capability
  ├ Recipe
  ├ Skill[]
  ├ Tool[]
  ├ OutputContract
  ├ UsagePolicy
  └ SafetyPolicy
```

分工继续：Langfuse → 基础 Prompt；Skill → 场景知识/方法论；ModelRecipeProfile → 模型原生编译；代码 Policy → 不可覆盖的硬门。

**注册表范围（D9）**：本期只建 Recipe / Skill / Tool 三个注册表；Capability 保留为文档分类概念，正式注册表实体绑定触发点「商家可见能力目录需求出现」再建——当前无消费者。

Skill 纪律：按 stage 解析；revision + content hash；admission 冻结 manifest；检查 required capabilities；记录 invocation receipt；不允许前端自由拼接隐藏 Skill instruction。脚本 Skill（platform-reviewed sandbox）保留为长期方向，不在本期，商家任意脚本永远禁止。

## 16. 六原语与 System-only actions

### 16.1 六原语（长期 Agent API）

```text
read_context   查事实/素材/历史/Memory/Capability/模型能力/平台规则
generate       必须编译为产品级 GenerationIntent；LLM 不传 tenant/billing/credential
revise         只对明确 target_ref 操作；OCC + stable id + derived revision
record         只允许 record observation / record proposal；
               禁止 confirm_fact / confirm_preference / grant_right
check          确定性：fact fidelity / exactText / rights / platform hard rules /
               structural contract / capability compatibility
ask_merchant   非普通 Chat：一次性问全、每项可暂不确定、整组跳过、默认值、
               timeout=语义层默认回答（D-116/D-169①）、resume
```

**原语签名纪律（D-163①）**：领域枚举不进原语签名；新增一个输出类型必须做到零代码改动（execution unit 类型注册表承接，§22.2）。红线门禁挂载在原语语义位点上（D-166③），原语面不得退化为通用工具面。

### 16.2 System-only actions

以下动作不能作为 Agent Tool，只能由 Plan Compiler + Policy + DBOS 产生：

```text
reserve_usage / settle_usage
commit_business_fact
grant_rights
publish_external
final_contentpackage_commit
provider_retry_after_unknown
```

**拦截层语义（A2，按 MAJOR-11 修正为提案层拦截）**：System-only 动作**不注册为工具、也不伪装成工具**（AI SDK 下未注册动作不会进 tool-call middleware）。「触碰」的可观测形态是闭集：模型提案 schema 中出现 forbidden intent、或 `generate` 参数蕴含外部副作用——由 **after-model / compile policy** 拦截，返回结构化 `{ blocked: true, gateId, reason, nextAction }` 回灌模型（nextAction 指向 ask_merchant / 提案路径），引导模型改道而非胡乱重试。System-only action 本体仍只由确定性 orchestrator（Plan Compiler + Policy + DBOS）产生。

---

# Part III：LLM 与 Harness

## 17. LLM 驱动模型

### 17.1 一个主 Agent，多种专业节点

商家只看到一个「丽客营销 Agent」。内部 **Marketing Supervisor** 调用受控专业节点：Intent Interpreter、Retrieval Planner、Ambiguity Resolver、Plan Synthesizer、Copy/Note/Image/Video Generators、Quality Critics、Experience Curator（另有 Platform Strategist / Copy Critic / Visual Critic / Plan Critic / Safety Explainer 类 specialist）。

专家默认：per-invocation、无长期 Memory、无账本、无权限、无 publish、输出 Zod Schema、输入最小上下文。只有 eval 明确证明值得才增加专家。允许真正并行的子任务：参考图风格分析、多平台文案改编、独立候选软质量评价、不改变主事实的页面并行生成。所有 delegation 受 `maxDelegations` 约束。

### 17.2 LLM 与确定性系统分工

**LLM 负责**：模糊意图理解、检索需求规划、假设与追问建议、经营策略和内容结构、方案商家语言、文案/图文/视觉 Prompt/视频分镜、软质量评价、Steering 语义分类建议、经验候选提议。

**确定性系统负责**：身份权限、事实时效、素材权利、模型能力、Quote 和积分、状态机、幂等、durable 恢复、发布硬门、审计、最终业务写入。

### 17.3 模糊适配四级

| 等级 | 定义 | 行为 |
|---|---|---|
| L0 | 明确 | 直接形成 Plan |
| L1 | 可安全假设 | 采用可逆默认，显示 assumption |
| L2 | 会实质影响结果 | 只问一个高价值问题 |
| L3 | 权利、事实、费用或外部动作风险 | 必须 Interrupt / 阻断 |

不使用单一 confidence 阈值作为唯一判断；最终由「影响类别 × 可逆性 × 权威来源」决定。

### 17.4 主动度三级

稳妥（少假设、中等影响就询问）/ 平衡（默认：先检索、低风险默认、每轮最多一个问题）/ 主动（自动选择项目、素材、平台和配方，付费和高风险仍必须确认）。

### 17.5 问题预算

| 阶段 | 默认最多问题 |
|---|---:|
| Intent | 1 |
| Plan | 1 |
| Make | 仅安全、费用或不可继续时 |
| Publish | 仅必要发布字段或外部确认 |

多个相关缺口合并成一个自然问题，不得拆成连续表单槽位。

### 17.6 成本控制

每 AgentRun 有 `wallClockBudget / tokenBudget / toolCallBudget / modelCostBudget / delegationBudget`。模型分配：cheap model 做 intent/routing/steering 分类；planner model 只做复杂 plan；specialist 仅在 eval 证明有用时启用。

## 18. LLM 输入合同

### 18.1 AgentTurnInput

```ts
type AgentTurnInput = {
  threadId: string;
  runId: string;
  parentRunId?: string;
  workspaceId: string;
  actorId: string;
  phase: 'intent' | 'plan' | 'make' | 'delivered' | 'publish';
  merchantMessage: string;
  proactiveMode: 'cautious' | 'balanced' | 'proactive';
  sessionRevision: number;
  activePlanRef?: { planId: string; revision: number };
  activeTaskRef?: { taskId: string; workflowId: string };
  approvedToolNames: string[];
  limits: AgentControlLimits;
  harnessReleaseId: string;
};
```

### 18.2 ModelContextProjection

只给模型最小、经过权限裁剪的投影：`merchantRequest`（text/creationMode/language）、`confirmedFacts[]`（ref/kind/value/revision/freshness/claimPolicy）、`assets[]`（ref/category/description/rightsStatus/allowedPlatforms/containsPerson）、`identity`、`recentContent[]`、`experience[]`（ref/instruction/status，来自 §12 Memory 投影）、`policies`（forbiddenClaims/requiredDisclosures）、`executionCapabilities`（available/unavailable deliverables）。

**禁止进入模型上下文**：Provider secret、其他 workspace 数据、未授权顾客原始资料、内部数据库物理键、上游成本和路由秘密、原始操作日志、隐藏推理、无关历史全文。

### 18.3 Context 预算

| 域 | 默认上限 |
|---|---:|
| 当前 Intent | 完整 |
| Goal Context | 当前 active goal 摘要 |
| 门店事实 | 20 条，按相关性和新鲜度 |
| 素材摘要 | 12 条 |
| 历史内容 | 6 条 |
| 确认经验（高置信 Memory） | 8 条 |
| 待确认经验 | 3 条，仅用于提示，不自动应用 |
| Recent Thread Summary | 压缩摘要，不给完整 transcript |
| Policy | 仅适用规则 |

超预算按相关性、时效和事实权威排序，不允许简单截断导致高风险事实丢失。需要 Thread compaction / Memory compaction / evidence links，而不是无界增长。

**Thread compaction 方案（B3，来源：pi compaction；U4 拍板补齐成本与降级）**：采用固定 6 段结构化摘要模板——Goal / Progress / **Key Decisions**（即 correction 记忆的沉淀源）/ Next Steps / Critical Context / 引用对象清单；压缩后保留 `retainedTail` 自包含 checkpoint，恢复时直接从 checkpoint 重建、免 O(n) 事件回放。向量检索层推迟。**成本归属（U4=A）**：compaction 是平台内部上下文维护，token 成本平台承担、不计商家积分；**失败降级**：保留上次摘要 + retainedTail 继续对话，不阻断。

**备用优化（C1/C4，绑定触发点）**：
- **C1 上下文 lane 增量化**（来源：Mastra state signals）：ContextBundle 从每轮全量重算改为命名 lane + snapshot/delta + cacheKey 幂等去重；上下文窗口裁掉快照时必须重发全量 snapshot（正确性关键）。触发点：上下文 token 成本可测且成为显著开销；
- **C4 大结果卸载区**（来源：LangChain Deep Agents 虚拟文件系统，取 StoreBackend 形态按租户命名空间）：素材检索/竞品抓取等大结果写「文件」、上下文只留句柄按需读回。触发点：检索结果膨胀挤占上下文预算。

## 19. LLM 输出合同

### 19.1 AgentTurnDecision（R13 修订：删除 retrieve action）

自然语言只负责解释；真正动作必须结构化。**检索在 turn 内走 tools**（streamText 工具循环），不作为终局 action——避免把一次理解拆成多轮往返。

```ts
type AgentTurnDecision = {
  merchantMessage: string;
  action:
    | { kind: 'ask_merchant'; question: MerchantQuestion }
    | { kind: 'propose_plan'; proposal: PlanProposal }
    | { kind: 'patch_plan'; patch: PlanPatchProposal }
    | { kind: 'steer_make'; patch: MakeSteeringProposal }
    | { kind: 'propose_experience'; candidates: ExperienceCandidate[] }
    | { kind: 'finish_turn' };
  evidenceRefs: string[];
  assumptions: Array<{ key: string; statement: string; risk: 'low' | 'medium' | 'high' }>;
};
```

执行前必经：`Zod parse → evidenceRef validation → tool policy → fact policy → rights policy → billing policy → bounded execution → state transition`。

### 19.2 IntentHypothesis / PlanProposal

`IntentHypothesis`：normalizedGoal（type/summary/urgency）、subject、desiredActions、platformHints、deliverableHints、assumptions（含 userVisible）、ambiguities（field/impact/resolution: safe_default|retrieve|ask_user|block）、retrievalRequests。

`PlanProposal`（LLM 输出策略，不写确定性结论）：goalNarrative、whyNow、recommendedDeliverables（carrier/platform/quantity/purpose/rationale）、expressionStrategy（voice/openingMechanism/narrativeStructure/promotionIntensity/cta）、factIntentions、assetIntentions、assumptions。

### 19.3 Partial output 规则

- `partialOutputStream` 只能更新临时 Activity 和非权威 Artifact preview；
- 只有最终通过 schema 的 output 才能写 canonical Plan 或业务状态；
- partial 中出现费用、权利、事实结论时不得直接展示为已确认；
- UI 必须标识「正在形成 / 草稿 / 已确认」三种状态；
- repair 后的最终对象替换同一 stable ID，不追加新对象制造重复。

## 20. Agent 工具与策略

### 20.1 工具注册表

```ts
type AgentToolPolicy = {
  toolName: string;
  sideEffect: 'none' | 'internal_write' | 'paid' | 'external';
  riskClass: 'read' | 'reversible' | 'sensitive' | 'irreversible';
  approval: 'never' | 'policy' | 'merchant' | 'admin';
  allowedPhases: Array<'intent' | 'plan' | 'make' | 'delivery'>;
  dataClasses: string[];
  maxCallsPerRun: number;
  timeoutMs: number;
};
```

### 20.2 首批工具

**自动可用只读**：`find_store_projects`、`read_confirmed_store_facts`、`find_authorized_assets`、`read_marketing_identity`、`read_recent_content`、`read_confirmed_experience`、`read_platform_requirements`、`read_model_capabilities`。

**需要 Policy 的可逆写**：保存 IntentDraft、创建 Plan revision、标记 assumption、创建 derived adjustment、创建经验候选。

**必须用户确认**：付费媒体执行、增加预算、使用受限顾客素材、改变交付数量和费用、对外发布、建立长期经验。

### 20.3 工具描述原则

必须说明：能做什么、不能做什么、返回数据边界、是否产生副作用、何时需要审批、幂等键语义、错误是否可重试。禁止模糊描述（「管理门店内容」「完成发布」）。

工具形态纪律（B6）：不按 API 端点拆工具，合并成高价值工作流工具；返回语义化字段而非物理键/UUID；分页、过滤、截断带**可执行的**提示；检索类工具提供 `response_format: 'concise' | 'detailed'` 让 Agent 自选详略。

### 20.4 Policy 挂点（中间件形态，A1/B5）

策略执行不再只有 turn 级后置一个挂点，统一为可组合的中间件形态：

- **node 式钩子**（`before_model` / `after_model`，返回状态补丁）：承载问题预算计数、AgentControlLimits、Memory/上下文注入；
- **wrap 式钩子**（洋葱包裹 model / tool 调用）：承载重试、模型降级、超时、structured repair；
- **`wrap_tool_call` per-call 确定性拦截**：租户 / 权利 / 配额门在每次工具调用前拦截，拒绝时返回**模型可见的拒绝理由 + 门 id**（前端可渲染具体是哪条门），不抛异常炸轮次；
- **控制动作静态声明**：每条 policy 注册时声明其有权执行的控制动作，受限枚举 = `continue | end_turn | ask_merchant`——**不开放任意跳转**（控制流在 DBOS 代码里，不交还给可变中间件）；
- **执行序 pin 进 HarnessRelease**：before 正序 / after 逆序 / wrap 嵌套的合成顺序随 release 冻结，policy 顺序变化必须在 release diff 中可见；
- **两档执行（B5）**：付费副作用前的门恒 **blocking**（模型执行前完成校验）；只读轮的门可 **parallel**（省延迟）。

## 21. Agent Session Harness

### 21.1 状态机

```text
idle → interpreting → retrieving → hypothesis_ready
→ awaiting_clarification（可选）→ plan_compiling → plan_ready
→ awaiting_approval（仅付费媒体）→ handing_off → steering → completed
```

Level 0/1 走捷径：Level 0 不进此状态机；Level 1 从 interpreting 直达 handing_off（免 plan_ready/awaiting_approval，计费 chip 常显）。

### 21.2 运行约束

```ts
type AgentControlLimits = {
  maxLlmSteps: number; maxToolCalls: number; maxRetrievalCalls: number;
  maxMerchantQuestions: number; maxReplans: number; maxSchemaRepairs: number;
  maxContextTokens: number; maxDelegations: number;
};
```

| 限制 | Intent | Plan | Steering |
|---|---:|---:|---:|
| LLM steps | 4 | 6 | 3 |
| tool calls | 6 | 8 | 4 |
| retrieval | 6 | 4 | 2 |
| questions | 1 | 1 | 1 |
| replans | — | 3 | 1 |
| schema repair | 1 | 1 | 1 |
| delegations | 1 | 2 | 1 |

**数值生效方式（U11 拍板 = B）**：上表数值是待校准种子，不直接生效——用 recorded/fixture 回放校准后随 release 发布（D-167：闸门数值为可审计事实、禁隐式默认）；未标定项显式 unset，且拒绝进入依赖该上限的生产路径。

超限：使用当前最好结果、确定性回退或请求用户，不允许无限循环。触顶 = **可续挂起态不是失败**（当前最好结果 + 未达标说明 + 可继续，D-167②；Mastra Goals 的「预算耗尽 = paused、提额可续」同构验证）；三层重试不叠乘；权限类失败（`subject_asset_rights` / `external_action_approval`）不进自纠环，直接硬拦 + `ask_merchant`（D-167③）。

**备用能力（C2，来源：Mastra background tasks + `untilIdle`，绑定触发点：批次 4 后按需）**：会话内派发长任务不阻塞对话、完成后回灌同一条流；`perAgentConcurrency + backpressure: 'queue'` 是商户级限流的现成语义。纪律照抄：LLM 侧的 background 标记只是修饰符，**不能把未显式 opt-in 的工具静默异步化**。

### 21.3 模块与 P1 actions

```text
apps/core/src/p1/agent-session/
  service.ts / turn-runner.ts / intent-interpreter.ts / context-retrieval.ts
  ambiguity-policy.ts / plan-synthesizer.ts / plan-compiler.ts
  steering-classifier.ts / tool-registry.ts / event-projector.ts / repository.ts
```

P1 actions：`agent_session_read / agent_turn_start / agent_turn_cancel / intent_create / intent_update / intent_normalize / plan_preview / plan_adjust / plan_read / plan_confirm / plan_cancel / steering_submit / workbench_session_projection`。

### 21.4 运行伪代码

```ts
async function runAgentTurn(input: AgentTurnInput) {
  const release = await harnessReleaseResolver.resolve(input.harnessReleaseId);
  const session = await sessionRepository.read(input.threadId);
  const projection = await contextProjector.build(input, session);

  const result = streamText({
    model: await controlModelRouter.resolve({
      role: session.phase === 'intent' ? 'fast_structured' : 'planner',
      release,
    }),
    instructions: await promptPack.resolveExact(release.promptBindings, session.phase),
    prompt: canonicalJson(projection),
    tools: toolRegistry.forPhase(session.phase),      // 检索在此循环内完成
    activeTools: toolRegistry.namesForPhase(session.phase),
    output: Output.object({ name: 'beauty_marketing_agent_turn', schema: agentTurnDecisionSchema }),
    stopWhen: stepCountIs(release.controlLimits.maxLlmSteps),
    prepareStep: ({ steps }) => controlStepPolicy({ steps, session, release }),
  });

  for await (const partial of result.partialOutputStream) {
    await eventProjector.emitActivityDelta(input.runId, partial);
  }

  const decision = agentTurnDecisionSchema.parse(await result.output);
  const policy = await agentPolicy.evaluate({ decision, session, release });
  if (policy.kind === 'interrupt') {
    await eventProjector.emitResumeSnapshots(session);
    await eventProjector.finishWithInterrupt(policy.interrupt);
    return;
  }
  const next = await applyAgentDecision(policy.command);
  await eventProjector.emitStateDelta(diff(session, next));
  await eventProjector.finishSuccess();
}
```

前置核查（R16.5）：前端 `ai@7.0.19` 与 `@ai-sdk/react@4.0.23` 版本错位，批次 1 对齐后方可依赖 `partialOutputStream / prepareStep` 语义。

**伪代码的实施约束（MAJOR-01）**：上述代码是示意，实施必须满足——model / tool 调用经统一 middleware runner 包裹（§20.4 的 before/after/wrap 三类钩子，不允许退化为 turn 末一次 `agentPolicy.evaluate`）；`tools / activeTools` 来自 **server-owned** capability + policy 裁剪，不从请求输入信任；HarnessRelease 增加 `middlewareBindings: Array<{ policyId, revision, kind, order, allowedControlActions }>`，resolver 输出 exact composition（§29.4）。

## 22. Plan Compiler 与 plan-as-data（R3 修订：否决 Grammar 解释器）

### 22.1 编译链

```text
Agent PlanProposal
  ↓ Schema（Zod strict parse）
  ↓ Policy（tool/fact/rights/billing）
  ↓ Capability Resolver
  ↓ Skill / Prompt Dependency Compiler（按 Prompt Pack，§29.2）
  ↓ Route Requirement Resolver
  ↓ Usage / Quote Resolver（计费域，产出 quote revision 引用）
  ↓ Rights Resolver
  → CompiledExecutionPlan（数据）
  → MarketingPlanRevision
  → （确认后）ExecutionPlanSnapshot → DBOS
```

这是既有 D-101 链（StageTypeRegistry + RecipeCompiler → CompiledExecutionPlan → 「DBOS 只执行已发布计划，不在运行时解释任意流程图」）的扩容，不是新架构。

### 22.2 CompiledExecutionPlan = 数据，不是可解释程序

```ts
interface CompiledExecutionPlan {
  schemaVersion: 'compiled-execution-plan/v1';
  units: ExecutionUnit[];          // typed，类型来自代码注册表
  dependencyGroups: Array<{        // 可并行组：组内并行，组间顺序
    groupId: string;
    unitIds: string[];
  }>;
  boundedRetry: Record<string, {   // 有界重试参数，显式事实禁隐式默认（D-167①）
    maxAttempts: number;
    maxCostCents: number;
    retry: { enabled: false } | {  // BLOCK-06：默认关（D-167③）；开启须三条件齐备
      enabled: true;
      predicateRef: string;        // 已发布的 versioned retry predicate（闭集错误类）
    };
  }>;
  cachePolicies?: Record<string, { // unit 级可选缓存（MAJOR-07 收紧）
    ttlSeconds: number;
    scope: 'workspace';            // 强制 workspace 隔离；key 含 unitType+输入hash+releaseId
    dependsOn: string[];           // fact/rights revision 依赖，任一变化即失效
  }>;
}
```

**边界（本节为硬约束）**：

- 控制流（sequence/parallel/conditional）留在 **DBOS TypeScript workflow 代码**里——代码本来就有这些能力，且 durable 语义已验证；
- **不存在 grammar 解释器**；模型不可产出 `ConditionalNode` 类构造；条件分支只能是**编译期展开**或**代码内确定性分支**（D-167⑤：条件位禁副作用，否则 durable 重放崩塌）；
- `ExecutionUnit` 类型注册边界（MAJOR-07 精确化）：**新增 carrier/recipe 不改六原语与 executor 核心**；新增 execution-unit type 仍需注册表、schema、policy 与测试——「零代码改动」指执行引擎核心，不是全系统（D-163①：领域枚举不进原语/引擎签名）；
- 红线门禁（D-166③：七门恒 block、采样率恒 1.0、软提示留痕）挂载在 execution unit 的语义位点上，编译产物必须保留挂载点；
- unit 级重试**默认关**（BLOCK-06，D-167③「默认关；未知错误默认不重试」）：仅当 unit 证明请求幂等、provider 未受理、且错误码在已发布 predicate 闭集内才开启；predicate **显式排除** validation / contract / rights / billing / `accepted` / `acceptance_unknown`；与 SDK / tool / DBOS 三层做「唯一重试属主」测试，三层不得叠乘；
- unit 级缓存 key **必含 `harnessReleaseId`** 且强制 workspace 隔离；含敏感素材 / 权利 / 外部副作用的 unit **默认不可缓存**；
- 禁止：arbitrary code、unbounded loop、dynamic executable JS、model-defined SQL、model-defined HTTP endpoint。

### 22.3 五阶段的最终定位

现有 `intent_naming → context_injection → brief_compilation → execution_selection → assembly_delivery` 五阶段：

- **短期保留**为物理运行拓扑（durable 兼容，阶段名不物理修改）；
- **长期降级**为 trace grouping / admin explanation / historical compatibility / metrics dimension（与 D-036「五段=五个语义 span」一致）；
- 新任务语义逐步转为：不重新理解 Intent、不重新生成与已确认 Plan 不同的 Brief、只验证冻结 Plan 是否仍有效、确定性执行 ExecutionPlanSnapshot。

### 22.4 三 runner 收敛（顺序倒置，R3）

workflow-core 现有 `executeCopyHarnessStages / executeNoteHarnessStages / executeMediaHarnessStages` 三套并列 runner 收敛为单一 `CompiledExecutionPlan → DBOS executor` 是正确终态，但顺序必须是：

1. **先迁走挂在 workflow-core 上的门与帧**（以 symbol 为准，行号为 2026-08-08 快照，MAJOR-09 校正）：确认门 `confirmPaidGenerationExecution`（`workflow-core.ts:3319`，三个调用点 `:1553` / `:2011` / `:2293`）、note 页级执行帧（note runner `:1810` 起，页级 progress callback 主要在 `:2041-2220`）迁到独立模块并保持 XHS §3.2 验收门全绿；
2. 再将 runner 内部重复逻辑替换为六原语（intent stage → read_context/ask；brief stage → generate；execution stage → generate/check/revise）；
3. 最后收敛三 runner 为单 executor，五阶段只留 trace taxonomy。

收敛全程承接 **D-038 五条**：step 内核 runtime 无关纯函数；at-least-once 业务幂等；大产物走对象存储；回装段 revision fencing 业务层 OCC 条件写；发布 SOP 有 in-flight 排空/版本粘滞。

## 23. Production Make Harness

### 23.1 职责变化

```text
现状: intent_naming → context_injection → brief_compilation → execution_selection → assembly_delivery
目标: execution_plan_verification → context_and_rights_fence → execution_preparation → execution_selection → assembly_delivery
```

阶段名为 durable 兼容暂不物理修改；新任务不重新理解 Intent、不重新生成 Brief，只验证冻结 Plan 仍有效并确定性执行。

### 23.2 过渡策略（R8 修订：抽样 + 确定性字段对账）

第一阶段（shadow）：Plan 产生冻结 intent/context/brief；旧 Harness 仍运行；**只对账确定性字段**（deliverable 数量/carrier、fact refs、rights refs、quote、bounds）——LLM 生成物（intent 文本、brief 措辞）不做 hash 对账（非确定输出，hash 恒 mismatch 是噪音）；**抽样 ~10% + 时间盒**，不全量长期双跑（成本）；**提前关闭条件（D8）**：连续 2-4 周 deterministic-field mismatch = 0 即关闭 shadow，不陪跑到批次 5。不一致只记 shadow evidence，不改变生产结果。

第二阶段：新任务优先消费 ExecutionPlanSnapshot，旧节点只做 validator，mismatch fail closed。

第三阶段：关闭重复 LLM 调用，保留确定性验证和 legacy replay 分支。

### 23.3 Steering 与派生执行

```ts
type SteeringClassification =
  | { kind: 'future_step_patch'; affectedUnits: string[]; requiresRequote: false }
  | { kind: 'derived_revision'; completedUnits: string[]; requiresRequote: boolean }
  | { kind: 'plan_change'; reason: string; requiresReplan: true }
  | { kind: 'unsafe_or_conflicting'; reason: string };

type MakeSteeringCommand = {
  commandId: string; taskId: string;
  sourcePlanRevision: number; sourceContentVersionIds: string[];
  instruction: string; classification: SteeringClassification;
  affectedUnitIds: string[]; createdAt: string; actorId: string;
};
```

所有 Steering command 绑定 thread/work/task/plan revision/execution snapshot/content package revision。Provider 已 `accepted / acceptance_unknown` 的副作用不能被「修改」，accepted/unknown 不盲重提。

### 23.4 Context Fence

| 时点 | 变化 | 行为 |
|---|---|---|
| Plan 确认前 | 事实变化 | 自动更新 Plan（新 revision），显示 diff |
| 确认后、执行前 | 关键事实/权利/费用变化 | Plan stale，重新确认 |
| 执行中 | 未使用事实变化 | 继续 |
| 执行中 | 已引用价格/日期变化 | 暂停并提示 |
| 执行中 | 素材撤权 | 立即 fail closed |
| 执行中 | 非关键软信息变化 | 可完成，发布准备要求复核 |

## 24. Steering 命令面

完整实施：`steer / follow_up / cancel_remaining / regenerate / pause`。分类行为见 §5.6/§23.3。中途指令只修改目标范围；已完成内容不被静默覆盖；数量、费用、事实和权利变化触发重核；5/6 页成功可只恢复失败页（partial delivery）。

**双队列语义（B7）**：`steer` 与 `follow_up` 是两档插入时点——steer = 当前执行单元完成即插入（打断式，「等下，换个风格」）；follow_up = 全部单元完成后插入（追加式，「做完再加一条朋友圈」）。Steering Composer 对商家以自然语言可分辨的方式暴露两档，分类器兜底判定。

## 25. Proactive Agent（evidence 门控）

不使用无限后台 LLM loop：

```text
Signals → Candidate Detector → Cheap deterministic filter
→ Agent relevance/ranking → OpportunityCandidate → Merchant proposal
```

Signal 来源：一段时间未发布、活动临近、素材积累、项目新增、Goal 未推进、历史内容表现、商家提供热点、已验证平台信号。**不假设拥有的外部数据不得使用。**

```ts
interface OpportunityCandidate {
  candidateId: string;
  resourceId: MerchantResourceId;
  goalId?: MarketingGoalId;
  reason: string;
  evidenceRefs: EvidenceRef[];   // 每条主动建议必须有 evidence
  expiresAt?: string;
  status: 'proposed' | 'accepted' | 'dismissed' | 'expired';
}
```

OpportunityCandidate 是可过期 derived record，不是重量级核心聚合。接受后：Opportunity → Thread turn → Goal/Plan → Work。建议不自动产生付费副作用。

**准入门（R11）**：该商家 evidence 覆盖率 ≥ 阈值（附录 B-2 拍板）才开启主动建议——没有 evidence 的建议是拍脑袋打扰，dismiss 率会杀死功能信任。阈值 unset 时门默认关闭、coverage 只观测；基线形成前运营可用既有 `proactive_opportunity_v1` flag 按 workspace allowlist 临时开启（U13）。

## 26. Outcome Evidence 与学习闭环

### 26.1 三层 Outcome（重心倒转，R11）

- **merchant_reported（主燃料）**：商家自报（§6.3 旅程）——有人问/加微/预约/买券/到店；
- **verified（首发=0，随平台能力渐进）**：发布回执、平台互动、团购、预约、核销；
- **inferred**：只表达**时间相关性**，禁止表达因果。

```ts
interface OutcomeEvidence {
  evidenceId: string;
  contentPackageRef: RevisionRef;
  goalId?: MarketingGoalId;
  signal: 'published' | 'attention' | 'inquiry' | 'wechat' | 'booking'
    | 'purchase' | 'redeemed' | 'visit' | 'feedback';
  source: 'verified' | 'merchant_reported' | 'inferred';
  value?: number;
  observedAt: string;
  sourceRef?: string;
}
```

存储：扩展现有 result / observability / manual outcome contract，不新建聚合。**canonical owner 指定（MAJOR-13，V31-19 开票前置）**：唯一 canonical write contract = 现有 manual outcome contract 的扩展面（result ledger 与 observability 只投影、不写）；提交幂等键 = `contentPackageRef + signal + observedAt/sourceRef`；须定义商家修正/撤回语义、exact ContentPackage revision 绑定、tenant/actor 校验测试。开票时先列三个候选载体的现状 owner 再动手。

### 26.2 学习闭环

```text
ContentPackage → OutcomeEvidence → Episodic（投影）→ [本期人工/显式确认] → Procedural
```

自动 Pattern Mining 与 industry skill learning **移出本期**（§12.4）。评价事件必须携带版本上下文：contentPackage / work / goal / skillId / skillVersion / capability / recipe / harnessRelease / scene。

---

# Part IV：事件与前端

## 27. 三层事件模型与 AG-UI 兼容层

### 27.1 三层事件

- **Canonical State**：真正业务事实（Goal/Plan/Work/Question/ContentPackage/Usage/Delivery）——各领域自己写 canonical state + outbox；
- **Semantic Event**：可恢复 Agent UI（run.started / message.final / activity.snapshot / goal.updated / plan.created / plan.revised / interrupt.requested / interrupt.resolved / artifact.revised / memory.proposed / memory.promoted / work.waiting / work.delivered / outcome.recorded）——持久化，可 replay；
- **Ephemeral Event**：token.delta、reasoning_activity.delta、progress animation——**不持久化，不得逐 token 写 PostgreSQL**，不参与恢复正确性。

现状基线（R16.3）：仓库已有 `workflow.progress / workflow.token / workflow.state` 三帧与 SSE 通道，`workflow.token` 即 ephemeral 层现实存在。Semantic projector **基于这三帧扩展**，不从零建。ephemeral 判定在**发射侧**（B2，来源：Mastra transient chunk）：事件带 `transient: true` 即只走实时流不落库，不靠 projector 侧过滤兜底。semantic event 另带 `context_role: 'included' | 'excluded' | 'summarized'` 字段（来源：pi session-format 的 entry 级标注）——把「事件持久化」与「LLM 上下文构建」彻底解耦，不让 semantic/ephemeral 分层兼职这件事。

### 27.2 AgentEventProjector 与 envelope

```ts
interface AgentSemanticEvent {
  eventId: string;
  threadId: AgentThreadId;
  streamOffset: bigint;          // per-thread 单调；domain 层类型
  contextRole: 'included' | 'excluded' | 'summarized';  // MAJOR-02：§27.1 标注落进合同
  sourceDomain: string;
  sourceEntityId: string;
  sourceRevision: string;
  correlationId: string;
  causationId?: string;
  eventType: string;
  payload: JsonValue;
  occurredAt: string;
}
```

**wire schema 与 domain schema 分开定义（MAJOR-02）**：wire 侧 `streamOffset` 用 decimal string（bigint 不可 JSON/SSE 序列化），游标比较按数值序；ephemeral frame 的 wire schema 带 `transient: true`。测试：round-trip、乱序、重复、跨 thread 隔离。

UI sequence 不参与业务一致性。snapshot 可重建；semantic event 不可静默删除；event 丢包不影响 canonical state。

### 27.3 五条逻辑流与 AG-UI 映射

| 流 | 用途 |
|---|---|
| Narrative | Agent 商家语言、理解、解释 |
| Activity | 工具、检索、生成阶段和安全摘要 |
| State | session、Plan、Task 和 interrupt 共享状态 |
| Artifact | Plan、文案、图文、视频和发布包原位更新 |
| Interrupt | 需要用户或管理员决定的关键暂停 |

AG-UI 定位承接 XHS spec：**只抄协议**（events/state/interrupt/serialization 的 envelope 映射），不引入 AG-UI runtime。内部 domain event 不直接使用 AG-UI enum，经 Semantic Projector → AG-UI Adapter 输出：narrative → `TEXT_MESSAGE_*`；tool → `TOOL_CALL_*`；activity → `ACTIVITY_SNAPSHOT/DELTA`；shared state → `STATE_SNAPSHOT/DELTA`；critical decision → `RUN_FINISHED`(interrupt outcome)；new/resumed run → `RUN_STARTED`；terminal → `RUN_FINISHED / RUN_ERROR`。

### 27.4 Activity 不进入 LLM 上下文

Activity 只用于前端过程呈现（找到多少素材、正在编译 Plan、第几页生成中、等待 provider、敏感词检查），不回灌 LLM，避免上下文膨胀和自我叙述污染。

### 27.5 Artifact stable ID

```ts
type ArtifactUpdate = {
  artifactId: string;
  artifactType: 'plan' | 'copy' | 'note' | 'image' | 'video' | 'publish';
  revision: number;
  status: 'skeleton' | 'partial' | 'ready' | 'failed';
  patch: unknown;
};
```

相同 `artifactId` 做 reconciliation，不每次生成新卡片。

### 27.6 Interrupt 对接 DBOS 与重连

```text
DBOS QuestionCard / Approval Need
→ Projector 先发 StateSnapshot + MessagesSnapshot
→ RUN_FINISHED(outcome=interrupt)
→ 用户提交 resume payload
→ 校验 interruptId / revision / schema / expiry
→ 写 StructuredDecisionInput → DBOS 恢复 → 新 RUN_STARTED
```

**Interrupt 类型化协议（A3，来源：LangChain HITL middleware 的 ActionRequest 合同）**：

```ts
interface InterruptPayload {
  interruptId: string;      // 稳定 id；回注凭 id，禁位置索引（依赖分组会同批产生多个待审，
                            // LangGraph 的位置索引错位是已知反面教材）
  threadId: string;         // BLOCK-03：补齐可校验坐标
  runId: string;
  workflowId: string;
  step: string;             // D-169① resume 三元组 = runId + step + resumeData
  revision: number;         // 对应现有 QuestionCard.workflowRevision，stale resume 用 CAS 拒绝
  schemaVersion: string;
  action: string;           // 'confirm_paid_execution' | 'resolve_rights' | 'answer_question' | ...
  args: JsonValue;
  config: { allowAccept: boolean; allowEdit: boolean; allowReject: boolean; allowRespond: boolean };
  description: string;
  expiresAt?: string;       // 可选：仅业务规则本身有期限时出现（如 D-153 付费确认 hold）；
                            // 普通 ask_merchant 不得因载体 TTL 失效（D-116/D-169①）
}
// resume = { interruptId, revision, type: 'accept' | 'edit' | 'reject' | 'respond', args? }
// 服务端做 CAS（revision）+ actor + workspace 校验
```

payload 与任意前端解耦（「AG-UI 只抄协议」的落点）；同批多个 pending interrupt 按 `{ interruptId: resume }` 映射回注。

**HITL 重发现（B1，来源：Mastra `listSuspendedRuns()`；MAJOR-06 补 resource 级入口）**：`listPendingInterrupts({ resourceId, threadId? })`——workspace 鉴权，`threadId` 只是过滤条件而非唯一入口；用户从首页/移动端恢复时可按当前 resource 拉全部待处理项。返回前做 actor/RBAC/tenant 校验，禁止仅凭可猜 threadId 读取 payload。

**并发 turn 仲裁（U6 拍板 = A）**：每 Thread 同时只允许一个活跃写 turn；第二个提交请求返回 409 + 前端提示刷新，以 `sessionRevision` 做 OCC。不做服务端排队、不做自动合并（两端意图混成不可审计输入）。

DBOS 仍是 pending、timeout、hold、reservation release 和 resume 权威；AG-UI 只负责协议和呈现。

重连：客户端保存 threadId / runId / lastEventId / 最近 STATE_SNAPSHOT revision / Artifact revisions。顺序：读 `workbench_session_projection` → 取最新 StateSnapshot → 从 lastEventId 回放 semantic events → patch 失败丢弃本地状态重取 snapshot → pending interrupt 始终优先显示 → 不自动用「最近一个任务」覆盖显式 `taskId`。

## 28. 前端实施

### 28.1 技术栈

React 19、TanStack Router/Query、AI SDK 7（**批次 1 先解决 `ai@7` 与 `@ai-sdk/react@4` 版本错位**）、HeroUI（Pro 为 vendored 源码同步，非依赖）、shadcn 现有基元、Motion、Tiptap、react-resizable-panels、Vaul、Zod、Playwright、SSE。

**不引入** assistant-ui / AG-UI / CopilotKit runtime（XHS spec 定位：assistant-ui 只抄模式/可拷贝片段、禁完整 Thread Runtime；AG-UI 只抄协议）。UI 实现基线 = HeroUI Pro AI showcase 模板 + assistant-ui 示例参照。

### 28.2 不新增全局状态库

服务端投影为真相；前端一个 event reducer/store 管理当前 thread：

```ts
type AgentWorkbenchClientState = {
  session: WorkbenchSessionProjection;
  messages: NarrativeMessage[];
  activities: Record<string, AgentActivity>;
  artifacts: Record<string, ArtifactProjection>;
  pendingInterrupts: InterruptProjection[];
  connection: 'connecting' | 'live' | 'replaying' | 'offline';
};
```

React reducer + external store 小封装，不引入 Redux/Zustand 作为第二业务真相。

### 28.3 目录与 ComposerHome 迁移

```text
src/product/agent-workbench/
  agent-workbench.tsx / use-agent-thread.ts / agent-event-reducer.ts
  agent-event-client.ts / workbench-session-model.ts
  stream/    narrative-line.tsx activity-line.tsx assumption-line.tsx
             inline-choice.tsx interrupt-line.tsx
  plan/      living-plan.tsx plan-section.tsx plan-diff.tsx commit-strip.tsx
  artifact/  artifact-canvas.tsx artifact-registry.tsx note-artifact.tsx
             video-artifact.tsx publish-artifact.tsx
  steering/  steering-composer.tsx steering-impact.tsx
  interrupt/ interrupt-renderer.tsx rights-interrupt.tsx cost-interrupt.tsx
             execution-interrupt.tsx
  goal/ memory-proposal/ proactive-proposal/
```

`ComposerHome`（现 4237 行大单体）退为薄宿主：只负责 route/search、query/mutation wiring、session restore、Workbench layout、legacy bridge。Intent UI、Plan UI、Activity、Artifact、Steering、Interrupt rendering、事件处理逐步移出。拆分与 AgentKernel 落地同 PR 系列进行（§35 治理方式）。

### 28.4 Controlled Surface Registry

模型只能请求客户端批准的语义组件：

```ts
const AGENT_SURFACE_REGISTRY = {
  narrative: NarrativeLine, activity: ActivityLine, assumption: AssumptionLine,
  inline_choice: InlineChoice, plan_section: PlanSection, plan_diff: PlanDiff,
  interrupt: InterruptRenderer, artifact_note: NoteArtifact,
  artifact_video: VideoArtifact, artifact_publish: PublishArtifact,
} as const;
```

模型不能传：任意 className、URL、HTML、JavaScript、React component name、业务 command、未注册 action。

A2UI 类动态表单仅限：临时资质补充、平台特定字段、外部连接器少量动态输入。核心 Living Plan、费用、权利、发布确认用本地类型化组件。

---

# Part V：平台设施

## 29. Prompt Pack 与 HarnessRelease

### 29.1 现状与问题

现状：22 个注册 prompt key，resolver 每任务全量解析冻结，缺任一 pin → strict boot 失败。问题：无关 Prompt 故障阻塞当前任务、运维 pin 成本扩大、任务真实依赖不透明、难做按能力/配方的发布回滚。

### 29.2 Prompt Pack

继续单一 Prompt registry，按任务选择 pack：

```ts
const HARNESS_PROMPT_PACKS = {
  agentControl: ['intentNaming', 'factSatisfaction', 'factCriticality', 'destinationMapping'],
  copy:  ['briefCompilation', 'copyCandidate', 'copyGeneration', 'platformAdaptation'],
  note:  ['xhsOutline', 'xhsContent', 'xhsImagePrompt', 'notePlan', 'noteTextBlock',
          'noteConsistency', 'xhsNoteGen'],      // BLOCK-05：补 xhsNoteGen（note-plan-structured-port 等真实消费者）
  media: ['briefImage'],                          // BLOCK-05：补 briefImage（production/unified-media stage ports 消费）
  cover: ['xhsCoverPrompt', 'xhsStyleAnalysis'],
  viral: ['xhsViralRewrite', 'xhsViralImageVision'],
  video: ['briefVideo', 'textResponse'],
} as const;   // 22 键全覆盖，与 langfuse-prompts.ts 注册表一致

resolve(keys: readonly HarnessPromptKey[]): Promise<HarnessFrozenPrompts>
```

纯文案任务不再依赖未使用的 viral Prompt。**覆盖构造性测试（BLOCK-05）**：所有可达 prompt consumer 的 key 必须被至少一个 pack 覆盖；每种 carrier 的编译依赖集必须 exact；未覆盖 key 使 release 发布失败，不得回 builtin 假绿。

### 29.3 strict 校验合同同批修改（R14）

- 校验时点从 **boot** 挪到 **release 发布**：发布 HarnessRelease 时校验「该 release 引用的全部 pack 的 exact version 齐全」，缺任一 → 发布失败；
- boot 只校验当前 production release 可解析；
- 「未使用位点缺失不得静默降级」保留：`isFallback` 降级信号经审计管道落库（D-166④ 不动）；
- D-165 三轴（`skillRevision` / `promptVersion` / `catalogRevision`）**仍是三个扁平顶层键，pack 化不得引入嵌套**。

### 29.4 HarnessRelease（R7：唯一 release 对象，吸收 AgentReleaseManifest）

**identity 拆分（BLOCK-04）**：release 拆为三个对象——不可变 `HarnessReleaseArtifact`（全部 exact bindings + `manifestHash`，即下方类型）、独立 `HarnessReleaseLifecycle`（draft/evaluating/canary/production/retired 状态迁移与审批）、独立 `HarnessReleaseRollout`（`p1_harness_release_rollouts`）。artifact 落库后任何字段不可变，lifecycle 与 rollout 单独变更，releaseId 恒指向唯一 manifest。

```ts
type HarnessReleaseArtifact = {
  releaseId: string;
  version: number;
  manifestHash: string;

  agentSessionHarnessVersion: string;
  makeHarnessVersion: string;

  middlewareBindings: Array<{      // MAJOR-01：policy 组合随 release 冻结
    policyId: string;
    revision: string;
    kind: 'before_model' | 'after_model' | 'wrap_model' | 'wrap_tool_call';
    order: number;
    allowedControlActions: Array<'continue' | 'end_turn' | 'ask_merchant'>;
  }>;

  // 吸收自 AgentReleaseManifest（V3 §25，该对象取消）
  supervisorPolicyRef: RevisionRef;
  memoryPolicyRef: RevisionRef;
  contextCompilerRef: RevisionRef;
  planSchemaRevision: string;          // 原 planGrammarRevision，随 R3 降格更名

  promptBindings: Record<string, PromptRevisionRef>;
  promptPackBindings: Record<string, string[]>;
  schemaBindings: Record<string, string>;
  skillBindings: Record<string, SkillRevisionRef[]>;
  toolPolicyRevision: string;
  modelPolicyRevision: string;
  factPolicyRevision: string;
  rightsPolicyRevision: string;
  budgetPolicyRevision: string;
  evalSuiteRevision: string;

  createdAt: string;
};

// 独立对象（不在 artifact 内）：
// HarnessReleaseLifecycle { releaseId, status, approvedBy, ... }   — 状态与审批
// HarnessReleaseRollout   { releaseId, workspaceAllowlist,          — 首发唯一灰度轴
//                           percentage?, industryAllowlist? }       — 绑定触发点：付费 workspace ≥ 50（D1）
```

它不是商品，不绑定：当前店事实、quote、rights、credential、provider cost、ContentPackage。

运行时纪律：Langfuse label 只用于候选选择和发布；发布时解析为 exact Prompt versions；运行时只读取 release 冻结的 exact version；任务、Plan、Trace 全部记录 releaseId；回滚 = 切回旧 release，不在任务中动态读最新 Prompt；release immutable，rollout 单独变更。

**per-run 试跑（C3 + U10 拍板 = A）**：单商户/单 thread 试跑**只能选择另一个完整的 immutable candidate releaseId**（选择沿委派链自动传播，缺省取 production release pin）；**禁止字段级覆写**——同一 releaseId 必须恒对应唯一 manifest，否则 exact release、trace 还原和回滚承诺全部破产。`AgentRun.harnessReleaseId` 记录实际使用的 release。**allowlist + candidate 试跑是试点期的灰度形态**，percentage 机器后置（D1）。**放量判据（U12 拍板 = B）**：gates 全过是底线；`scored` verdict 只记账，放量由人工决定；样本量足够后再定义自动门。

## 30. Harness Control Plane（R9 修订：砍半，展示层用 Langfuse）

### 30.1 自建面（仅 Langfuse 覆盖不了的）

- **Releases**：production/canary/draft、release diff、发布审批记录、rollout 配置、一键 rollback、关联任务；
- **Tool Policies**：工具说明、参数 schema、side effect、approval、phase、data classes、timeout、调用上限、最近错误和拒绝原因;
- **Kill Switch 面板**（§41.2）。

### 30.2 用 Langfuse 现成面（只建数据写入，不建查看界面）

- Prompt 版本/调用量/首次 schema 通过率/repair 率/延迟成本 → Langfuse prompt management + dashboards；
- Trace & Replay（按 workspace/thread/run/plan/task/release/prompt version/model route/failure code 过滤）→ trace 带 `releaseId` tag 聚合；
- Datasets / experiments / eval 管理 → Langfuse datasets + experiments。

等真实运营痛点被实际撞到（如按 release 聚合不了）再补自建面。

## 31. 评估体系

### 31.1 L0：合同和确定性测试

Zod schema、evidence refs、fact refs、rights refs、quote、revision、idempotency、interrupt resume、state patch、fallback、billing settlement。

### 31.1b L0.5：Quick Checks 零 LLM 行为门（A4，来源：Mastra quick-checks；字母后缀为稳定小节 ID）

微秒级、零 token 的行为断言，作 CI 门 + 生产抽样打分：`toolOrder(['read_context','generate','check','record'])`（六原语序列约束）、`didNotCall('record')`（只读 Session Harness 负向断言）、`maxToolCalls(n)`、`noToolErrors`、输出 `includes/excludes/matches`。这是成本最低的一层门，先于任何 LLM Judge 存在。

### 31.2 L1：节点 Dataset

- **Intent**：goal 分类、检索域 precision/recall、不必要追问率、应问未问率、高风险错误假设率;
- **Plan**：事实引用准确率、未授权事实率、交付物合理性、CTA 一致性、quote 一致性、Plan 稳定性、局部调整作用域、invalid plan rate、unavailable-tool selection rate、plan/snapshot fidelity;
- **Make**：首次 schema 通过率、repair 率、事实保持、候选差异、图文页一致性、steering 作用域、partial delivery 完整性;
- **Memory**：recall precision、cross-merchant leak、false persistence、correction recurrence、preference lift、procedural proposal quality;
- **Proactive**：proposal relevance、dismiss/accept rate、「为什么现在」可解释率、stale opportunity rate。

**gates / thresholds / verdict 三态（A5，来源：Mastra gates-and-verdicts）**：忠实性、权利、红线类 → **gates**（缺一即 `failed`）；品牌调性、可读性、吸引力类 → **thresholds**（支持 `{max}` 反向带——幻觉类分数越高越坏）；verdict 三态 `passed / scored / failed`——**`scored` = gates 全过但 threshold 未达，可放行但记账**，是 canary 放量判据的中间态（此前只有二值门）。

**冷启动（U3 拍板 = A）**：L1 数据集以 fixtures 为主 + 脱敏历史任务抽样；冻结 dataset revision / 来源 / 许可；历史数据不得直接进入 replay 写路径。

### 31.3 L2-L5

- **L2 Journey Replay（绑定触发点：历史任务量达数百级，D2）**：历史任务隔离环境替换 Prompt/模型/Skill/Tool policy/release，比较新旧；**replay 强制只读闸（B4，来源：LangGraph time-travel 警告——replay 会重跑 checkpoint 之后一切，含 LLM 调用与 interrupt）**：不加「禁付费副作用」闸即重复扣费;
- **L3 Shadow（同 L2 触发点）**：Candidate 只计算 Intent/Plan/工具选择或内容候选，不执行付费副作用，不写生产 ContentPackage;
- **L4 Canary**：首发 = **workspace allowlist + per-run 覆写 + 人工回滚 + 回滚演练**（D1/D3）；percentage 阶梯（5%→25%→50%→100%）与自动回滚门（权利或事实错误、billing mismatch、schema repair 激增、Plan 接受率下降、用户追问增加、延迟成本超阈、interrupt 恢复失败）**绑定触发点**：付费 workspace ≥ 50 且指标管道稳定运行一个月——试点期自动门误触发比漏触发更伤;
- **L5 真实经营验证**：Plan 接受率、修改次数、首个可评估结果时间、发布准备完成率、实际发布率、同类纠正下降、咨询/预约/加微/团购/到店信号。

评价分工：事实/权利/费用/schema = 确定性代码；自然度/品牌感/吸引力 = 人工或 LLM Judge；商家是否喜欢 = 用户行为；是否带来预约 = 可验证经营信号。**LLM Judge 不能替代事实和授权验证。**

## 32. Observability

Trace 树：`agent.thread → agent.run → (intent.interpret / context.retrieve+tools / ambiguity.resolve / plan.synthesize / plan.compile / interrupt.wait / make.workflow → execution_plan.verify / context_rights.fence / content.generate / media.generate / quality.check / assembly / publish.prepare)`。

每 span 记录：threadId/runId/parentRunId、intentId/planId/planRevision、taskId/workId、harnessReleaseId、Prompt exact version/hash、Skill refs、Tool policy revision、model route revision、schema revision、token usage、observed cost、latency、repair、fallback、interrupt、terminal state。

不记录：API Key、未脱敏顾客资料、原始敏感图片、完整 Provider 私密响应、原始 Chain of Thought。**积分与上游成本双真相：任何面永不暴露上游 token/美元成本（D-061）。**

## 33. 数据库与迁移

### 33.1 新表（R10 收编后的最终清单）

```text
p1_agent_threads
p1_agent_runs
p1_agent_semantic_events        （outbox + projector 产物，ephemeral 不落库）
p1_marketing_goals
p1_marketing_plan_revisions
p1_execution_confirmation_requests   （§14.3 待决请求，含 reservation 引用与 holdExpiresAt）
p1_plan_confirmation_decisions       （§14.3 不可变决定）
p1_make_steering_commands
p1_harness_release_artifacts         （immutable，含 manifestHash）
p1_harness_release_lifecycle
p1_harness_release_rollouts
```

**不新建**：`p1_agent_memory_entries`（收编现有 preference 体系扩列，§12.5）、OutcomeEvidence 聚合（扩展现有 result/observability/manual outcome contract）、OpportunityCandidate 表（read/derived projection）、独立 Approval 表（复用执行确认卡语义 + 关联行）。

写入纪律：Agent partial 不写 canonical Plan；Plan revision append-only（无状态列，生命周期走事件与 Decision，BLOCK-07）；confirmation decision immutable；steering command append-only；publish handoff 绑定 ContentPackage version；release immutable，rollout 单独变更；semantic event per-thread 单调 streamOffset，不可静默删除；snapshot 可重建。

### 33.2 Migration Strategy

- **AgentThread**：历史 Work 第一次打开 → lazy create legacy thread，不做一次性全量迁移；新创作 Thread → Work;
- **MarketingGoal**：不从历史数据猜；用户表达长期目标时创建；历史 Work 由 Agent 提议归组、确认才关联;
- **Memory**：历史（用户修改、adopted revisions、outcome、decision traces）只作为 extraction 输入；首轮 migration 只生成 proposed memory，不批量自动激活;
- **branded IDs（R16 范围限定）**：只用于**新 agent 域合同**（thread/run/goal/plan/memory/event）；存量 ID 按 seam 触碰时机会性迁移，不做全仓 retrofit。

---

# Part VI：实施

## 34. 与当前仓库的迁移映射

### 34.1 保留并复用

| 当前组件/模块 | V3.1 用途 |
|---|---|
| `routes/dashboard/index.tsx` | 单工作台入口、深链恢复 |
| `composer-home.tsx`（4237 行） | 迁为薄宿主（§28.3） |
| `workbench-shell-layout.tsx` | 双栏、Inspector、移动 Sheet |
| `workflow-core.ts`（三 runner） | Production Make Harness 主链，按 §22.4 顺序收敛 |
| `dbos-workflow.ts` | durable run、QuestionCard/StructuredDecisionInput、hold、reservation release、settlement、恢复 |
| `task-admission.ts` | route/prompt/skill/bounds 冻结 + ExecutionPlanSnapshot 绑定（**quote 不在 admission 冻结面**，quote 权威在计费域，snapshot 只持引用） |
| `structured-nodes.ts` / `structured-node-runner.ts` | 结构化节点、schema、repair、cost、provider fence、deterministic fallback |
| `langfuse-prompts.ts`（22 键全量） | 单 registry，升级为 selective pack（§29） |
| `experience-basis.ts` + preference 三表 + memory-vault | Memory 平台收编基座（§12.5） |
| `workflow.progress/token/state` 三帧 + SSE | Semantic projector 扩展基线（§27.1） |
| `BriefSurface` | 迁入 Living Plan 的风险/证据区 |
| `ExecutionConfirmCard` | 扩容为执行确认卡 / Critical Interrupt renderer（§14.1） |
| `NoteObjectWorkspace` | Delivered 精修真相面 |
| `CopyImageTextWorksurface` | Tiptap、选区 AI、敏感词与版本修订 |
| `notePlan` schema | note carrier 的页级计划，接入 PlanDeliverable |

### 34.2 新增模块

```text
packages/contracts/src/agent/
  thread.ts run.ts goal.ts plan.ts memory.ts semantic-event.ts
  execution-plan.ts release.ts steering.ts outcome.ts

apps/core/src/p1/agent-session/**      （§21.3）
apps/core/src/p1/agent/
  kernel/ memory/ context/ planner/ compiler/ capabilities/
  proactive/ outcome/ events/
apps/core/src/p1/marketing-plan/**
apps/core/src/p1/harness/harness-release.ts
apps/core/src/p1/harness/prompt-packs.ts
apps/core/src/p1/harness/execution-plan-admission.ts

mkfast-template-main/src/product/agent-workbench/**   （§28.3）
mkfast-template-main/src/product/harness-admin/**     （§30.1 砍半后范围）
```

现有 `harness/` 逐步退化为 compatibility / adapter，不再继续扩张。

### 34.3 Legacy 兼容

- 没有 ExecutionPlanSnapshot 的旧 durable task 继续走旧 replay；
- 新前台能投影旧 progress/token/question；
- 新任务默认走新路径（feature flag），**无双写过渡期**（R4）；
- 不自动迁移历史任务到新 layout；
- incompatible durable layout fail closed，给运营清晰处置。

## 35. 分批实施路线（R15 合并后的唯一顺序）

治理方式：**不做前置大重构**。触碰哪个 seam，就在对应纵切内完成治理（实现 PlanCompiler → 同 PR 系列收敛 runner 前置件；实现 AgentEventProjector → 同 PR 系列统一 SSE lifecycle；实现 AgentKernel → 同 PR 系列拆 ComposerHome）。必须前置的只有四项：**branded IDs（新合同域）、canonical ownership、schema versioning、one-writer enforcement**。

### 批次 1：合同 + Thread + 事件 + 外壳

- Agent 域 contracts（thread/run/goal/plan/memory/event/execution-plan/release/steering/outcome）+ branded IDs + canonical ownership matrix；
- `AgentThread / AgentRun` persistence；
- Semantic Event Projector（**基于现有 progress/token/state 三帧扩展**）+ snapshot/replay；
- NarrativeLine / ActivityLine / event reducer / 重连状态 / 卡片减量 / 移动过程-作品切换；
- Workbench 从 Work-root 改为 Thread-root，保留 Work inline projection；`/dashboard/recent` 收编；
- `ai` 与 `@ai-sdk/react` 版本对齐；
- 当前漏斗和性能基线。

**退出门**：一个 Thread 可产生多个 Work；刷新/重连不丢上下文；旧 Work lazy 打开；业务写路径完全不变；影子事件不改变 Task、账单和 UI；sequence、replay 和跨 workflow 隔离通过；现有创作行为零变化；不显示空 Activity 或重复交付。

### 批次 2：Agent Session Harness + 分级 Plan

- Agent Session Service、Intent interpreter、turn 内检索 tools、ambiguity policy、assumptions、question budget、自由创作事实分层、proactive mode；
- Progressive Plan Level 0/1/2 判定与计费 UX 规则（§3）；
- PlanProposal → 确定性 Plan Compiler → MarketingPlanRevision（projection readiness）；
- Living Plan UI + diff + Compact Plan + commit strip；现有 Brief/quote/confirm 统一呈现；
- Policy 挂点中间件落地（§20.4）+ 工具设计审查（B6：工作流化、语义化字段、response_format）+ Quick Checks 行为门接入 CI（§31.1b）。

**退出门**：无门店资料的自由创作可达安全通用结果；已有信息不重复询问；每轮最多一个问题；权利和事实高风险不被 LLM 默认；简单任务不因新链变慢或变复杂（Level 0/1 无新增摩擦）；用户能在一个连续面理解目标/交付/事实/素材/费用/风险；调整只生成新 revision；quote 和权利由确定性服务覆盖模型提案。

### 批次 3：执行确认 + 冻结快照 + Harness 消费

- 执行确认卡扩容（D-164③ 语义）+ ExecutionConfirmationRequest / PlanConfirmationDecision 两对象（§14.3，确认前 reserve）；
- ExecutionPlanSnapshot + snapshotHash + task admission 绑定 + DBOS 运行前复验 + stale/expiry（D-153 语义）；
- shadow 对账（确定性字段、抽样 10%、时间盒）；
- `execution_plan_verification`；旧 intent/brief 节点降为 validator；selective recompile；context fence 新语义；legacy replay 分支；逐步关闭重复 LLM 调用；
- Interrupt 类型化协议 + id 回注（§27.6 A3）+ HITL 重发现端点（B1）。

**退出门**：用户看到的 Plan 与执行 Brief/deliverables/quote 一致（fidelity=100%）；重放不重复创建 Task 或扣费；stale 确认拒绝；mismatch fail closed；新任务不重新生成不同 Intent/Brief；事实撤销、quote 变化和权利变化精确中断；legacy durable task 保持可恢复；hold 到期=取消+退分+白话告知。

### 批次 4：Artifact + Steering + 发布交接 + 自报

- Artifact stable IDs、snapshot/delta、note skeleton、video scene progress；
- steering classifier、future patch / derived revision / replan、影响范围反馈、partial delivery；
- Publish Artifact、文案分块、素材排序 ZIP、手机交接（商家自发语义）、capability 三态、发布记录、观察窗口；
- **商家自报旅程**（§6.3：次日追问 + 一键 chips + 频控）。

**退出门**：中途指令只修改目标范围；已完成内容不被静默覆盖；数量/费用/事实/权利变化触发重核；5/6 页成功只恢复失败页；Delivered 后五分钟内可完成手机交接；未验证发布能力不显示为可直发；发布留痕绑定 exact ContentPackage version；自报入口在交付旅程内可达。

### 并行 lane：Memory 平台（不阻塞批次 2-4 主线）

- 现有 preference 体系扩列（kind/authority/scope/decay/state，§12.5）；
- Working / Correction / Preference 读写路径 + Session-scoped 双通道（§12.3）；
- passive observation pipeline（产出恒 proposed）；
- Episodic 读取投影；OutcomeEvidence 与现有发布结果/评价/人工补记统一；
- D-168② 删除语义。

**退出门**：跨店 Memory 泄漏=0；Business Fact 被 Memory 覆盖=0；Correction 优先级正确且 correction recurrence=0；false persistence=0（放行门）；Memory retrieval precision 有离线评测；记忆可查看、纠正和撤销；**注入清单可见且撤销后不再注入**（§12.7 MemoryInjectionReceipt，MAJOR-12）。

### 批次 5：Prompt Pack + HarnessRelease + Langfuse 挂接

- selective Prompt resolver + pack 定义；strict 校验挪到 release 发布（§29.3）；
- HarnessRelease schema（含吸收字段）+ publish + allowlist canary + per-run 覆写（C3）+ rollback + exact trace linkage；
- 自建 admin 砍半面（releases/tool policy/kill switch）+ Langfuse tag 挂接；
- L4 canary（allowlist + per-run 覆写形态，D1）；L2 replay / L3 shadow 绑定触发点后置（D2），建时带只读闸（B4）。

**退出门**：纯文案任务不依赖无关 Prompt；任一运行能还原 exact release；rollback 不改任务内 Prompt；release diff 可读；Candidate 不产生生产副作用；回滚演练通过（自动化回滚门绑定触发点，D3）；评估结果绑定 release。

### 批次 6：Proactive + 退役

- Signal model、Opportunity detector（deterministic filter 先行）、proactive proposal、Goal-aware planning、Outcome→Memory 闭环；**evidence 覆盖率准入门**；
- 退役：Thread=Work 假设、旧 result conversation glue、重复 planning DTO、三套 workflow runner（§22.4 顺序完成后）、第二份 Prompt pack 映射、手工硬编码 Tool allowlist、已无消费者的旧 Harness surface、重复 UI。

**退役前置条件（全部满足才动手）**：执行确认覆盖所有确认语义；新任务完全消费 ExecutionPlanSnapshot；Interrupt、费用、权利、stale 和 refund 旅程全绿；真实商家试点优于旧流程；rollback 已演练；legacy durable replay 归档走条件门（U14：零 active/pending 旧实例 + 最长 hold 窗口 30d 走完 + 审计导出与回滚证明齐备 + ops policy 安全缓冲，之后归档 fail closed）。

**Goal 时点**：MarketingGoal 合同在批次 1 落 contracts，但 Goal 的产品面（提议创建、归组确认、Goal-aware planning）在批次 6 随 Proactive 一起激活——**不在首切片建 Goal 管理面**。

## 36. 推荐 PR / Issue 拆分

| 编号 | 内容 | 批次 | 风险 |
|---|---|---|---|
| V31-01 | Agent 域 contracts + branded IDs + ownership matrix | 1 | 中 |
| V31-02 | AgentThread/AgentRun persistence + lazy legacy thread | 1 | 中 |
| V31-03 | Semantic Event Projector（三帧扩展）+ replay | 1 | 中 |
| V31-04 | Client reducer + Narrative/Activity Workstream | 1 | 低 |
| V31-05 | Thread-root Workbench + recent 收编 | 1 | 中 |
| V31-06 | Agent Session repository + service + turn runner | 2 | 中 |
| V31-07 | Intent interpreter + ambiguity policy + 检索 tools | 2 | 高 |
| V31-08 | Progressive Level 判定 + 计费 UX 规则 | 2 | 高 |
| V31-09 | Plan Compiler + MarketingPlanRevision | 2 | 高 |
| V31-10 | Living Plan UI + diff + commit strip | 2 | 中 |
| V31-11 | 执行确认卡扩容 + 确认请求/决定对象（§14.3） | 3 | 高 |
| V31-12 | ExecutionPlan admission + DBOS 复验 + D-153 expiry | 3 | 高 |
| V31-13 | shadow 对账（抽样+确定性字段） | 3 | 中 |
| V31-14 | Make Harness 消费 snapshot + validator 降级 | 3 | 高 |
| V31-15 | Artifact protocol + registry | 4 | 中 |
| V31-16 | Steering service + classifier | 4 | 高 |
| V31-17 | Publish Handoff + 自报旅程 | 4 | 中 |
| V31-18 | Memory 扩列 + 双通道 + observation pipeline | 并行 | 高 |
| V31-19 | OutcomeEvidence 统一 + 删除语义 | 并行 | 中 |
| V31-20 | Prompt packs + strict 校验迁移 | 5 | 中 |
| V31-21 | HarnessRelease + rollout + rollback | 5 | 高 |
| V31-22 | Harness Admin（砍半面）+ Langfuse 挂接 | 5 | 中 |
| V31-23 | Eval：L0/L0.5/L1 + allowlist L4 + 人工回滚演练（L2/L3 与自动回滚门为 trigger-bound backlog，不占 PR 号） | 5 | 中 |
| V31-24 | Proactive（evidence 门控） | 6 | 中 |
| V31-25 | 三 runner 收敛（§22.4 顺序） | 6 | 高 |
| V31-26 | Legacy 退役 | 6 | 高 |

禁止用单张「全面重做 Agent 工作台」大票承载全部变更。

## 37. 测试与验收矩阵

### 37.1 Contract

所有 LLM 输出 strict parse；unknown action 拒绝；evidence ref 越权拒绝；arbitrary UI/component 拒绝；Plan deterministic fields 不接受模型写入；confirmation record / snapshot hash；state patch；event streamOffset；resume idempotency；Prompt Pack exact pin（release 时点）；HarnessRelease immutable。

### 37.2 Core / PG / DBOS

IntentDraft revision；Plan append-only + readiness projection（无状态列）；stale trigger；确认请求创建即 reserve 的事务原子性 + confirmation 幂等；execution snapshot admission（含 `policy_exempt_copy` 路径）；DBOS suspend/resume；timeout、hold expiry（=取消+退分）、reservation release；semantic resubmission；bounded continuation（触顶=可续挂起）；partial settlement（refund 回原批次、过期作废流水可见）；release rollout selection；legacy replay；**余额检查+reservation+FEFO 同事务+workspace 锁并发测试**。

### 37.3 前端

reducer replay；out-of-order/duplicate event；patch mismatch snapshot recovery；Activity 不重复；Artifact stable ID；pending interrupt 优先；keyboard focus；reduced motion；mobile sheet；screen reader labels。

### 37.4 Playwright 主旅程

- **A. Day-0 自由创作**：无门店资料、模糊输入、不被 confirmed_store/project 阻断、生成不带虚构事实的通用文案、进入发布交接；
- **B. Level 1 纯 copy**：免确认直达结果、报价 chip 常显、余额不足阻断双出口、**exact plan/quote/release 仍冻结**（`approvalBasis=policy_exempt_copy` 的 admission、重放与扣费幂等，BLOCK-01）；
- **B2. 记忆注入透明**：任务详情 → 注入清单 → 经验来源 → 撤销 → 后续任务不再注入（MAJOR-12）；
- **C. 定制图文（Level 2）**：先检索、只问一个问题、Living Plan、调整、确认、note 逐页生成、单页重生、发布交接；
- **D. 视频付费执行**：Plan 显示时长/积分（**2026-08-11 用户拍板：分镜不进 Plan、原「Plan 显示分镜」要求废止，V31-35 随之废止**——上游供应商无任何按分镜计费的规则，分镜仅应用于提示词生成环节、与积分无关，商家不需要知道分镜及其与积分的关系）、Interrupt、关标签页、恢复、部分失败；字幕/封面不交付——旅程断言「不承诺字幕轨/封面面板」（2026-08-11 用户拍板，V31-37 采 A 路：#264 退役，字幕由发布平台承担；原「字幕封面 assisted fallback」要求废止）；
- **E. Plan stale**：确认前价格 revision 变化、显示 diff、旧确认不可提交、重新确认后执行；
- **F. 素材撤权**：Plan 形成后撤权、Make admission fail closed、可换素材、不重复扣费；
- **G. Mid-run Steering**：修改封面与第二页、其他页保持、无费用变化直接应用、增加页数进入 replan+requote；
- **H. Interrupt resume**：pending interrupt 阻止普通新输入、duplicate resume 幂等、expired resume 拒绝（hold 到期=取消+退分）、payload schema 不匹配可见错误；
- **I. Thread 连续**：Delivered 后继续同一 Thread 产生新 Work、刷新重连上下文不丢；
- **J. Harness Release**：canary 命中候选、非 canary 用 production、rollback 后新任务回旧 release、在途任务保留冻结 release；
- **K. 自报旅程**：交付次日追问可达、一键 chips 落 OutcomeEvidence、频控生效。

## 38. 指标与 SLO

产品漏斗：Intent submitted → first useful understanding → Plan ready → Plan confirmed → Make started → first usable artifact → Delivered → Publish handoff completed → Published recorded → **Outcome reported** → Observed signal。

**两层结构（D4 + U2 拍板）**：**硬门 5 条**进验收，未达不放行——① rights / billing 错误 = 0；② Plan 与执行 snapshot mismatch = 0；③ duplicate debit / duplicate accepted side effect = 0；④ pending interrupt 丢失 = 0；⑤ Day-0 自由创作可达且简单任务不因升级变慢。**自报覆盖率（U2=A）**：首个试点窗只作观测（参考值 40%），形成基线后再升硬门——升门时 §38/§43/批次退出门/测试数据窗口四处用同一命名、分母与样本下限。下表其余为**观测指标**——用于趋势与告警，不作验收门（试点期无基线，全量设门 = 测量负担）。

| 指标（硬门 5 条外均为观测层） | 试点参考 |
|---|---:|
| 首个有意义 acknowledgment | p75 ≤ 1.2s |
| 首次 Activity | p75 ≤ 1s |
| memory retrieval | p95 ≤ 300ms |
| intent ready | p75 ≤ 2.5s |
| simple task（Level 1）plan/brief | p75 ≤ 4s |
| complex Living Plan（Level 2+） | p75 ≤ 8–12s |
| steering ack | p95 ≤ 1s |
| reconnect snapshot | p95 ≤ 2s |
| semantic projection lag | p99 ≤ 500ms |
| 每轮必要问题 | ≤1 |
| Plan 接受或小改后接受 | ≥70% |
| Plan 与执行 snapshot mismatch | 0 |
| schema repair | <10% |
| rights / billing 错误 | 0 |
| duplicate product debit / duplicate accepted side effect | 0 |
| 重连恢复成功 | ≥99.5% |
| pending interrupt 丢失 | 0 |
| Artifact 重复对象率 | 0 |
| 交付到手机交接 | 中位 <5 分钟 |
| **交付后 7 日自报覆盖率** | 试点 ≥40%（阈值待 B-2 校准） |

Agent 主动性指标：自动检索覆盖率、检索命中率、避免重复提问率、安全默认接受率、assumption 被纠正率、高风险错误默认率、工具调用无效率。Harness 运行指标：per-node latency、Prompt version success、first-pass schema validity、repair、fallback、cost、bounded suspension、interrupt timeout、resume、partial success、settlement compensation、release regression。

## 39. UI/UX 规则

**减卡原则**：只有 Critical Interrupt、Artifact、事实/权利冲突、对象工作区、发布准备用有边界面板；普通理解、进度、建议和假设用文档行、轻量 chip 和内联编辑。

**连续叙事**：Agent 行不使用聊天气泡；用户输入可用短引用块；工具过程折叠为 Activity；Living Plan 作为文档章节；已完成阶段可折叠但可追溯；不重复粘贴完整候选正文。

**AI 不确定性六态**：`我先按……处理`（安全假设）/ `需要你确认`（高影响歧义）/ `当前不能继续`（硬门）/ `当前只是草稿`（partial）/ `已经确认`（冻结 Plan）/ `已经执行`（不可静默覆盖）。

**记忆注入可见（§12.7）**：任务详情提供本次注入的经验清单入口，商家能回答「它为什么这么写」。

**无障碍**：WCAG 2.1 AA；状态不只靠颜色；每个 Activity 有可读文本；流式更新适度 `aria-live`（不逐 token 宣读）；Interrupt 自动聚焦标题；关闭 Sheet 后焦点回来源；所有动效支持 reduced motion；键盘可完成 Plan、Interrupt 和发布交接。

**视觉基线**：形态改版会作废 GAP R-8 截图基线与 journey 门清单——批次 1-2 验收须排重拍与门清单更新。

## 40. 安全与合规

**输入安全**：商家文本始终视为不可信数据；工具输出按 schema 校验；检索结果带 workspace 和 rights scope；Prompt injection 不能改变工具 policy；外部链接和抓取严格使用已批准双轨；LLM 不读取 secret。

**输出安全**：事实 refs 反向验证；rights refs 反向验证；quote 和能力确定性覆盖；arbitrary action 拒绝；发布前重新扫描；高风险内容进入确认或阻断；生成阶段软提示与发布硬门分层（D-117②：生成零内容限制，风控唯一收口=发布提醒与发布审核，内容真实性责任在商家）。

**永远 deterministic 的门**：tenant identity、billing identity、critical fact fidelity、rights、medical/regulated hard gate、external publish approval、provider acceptance state、quota、ContentPackage OCC。Agent 可以解释，不能决定。

**经验**：纠正不自动变长期经验；只生成候选；用户选择「以后都这样」后写入；显示来源和适用范围；支持撤销；stale/foreign experience 拒绝。

## 41. Feature Flags 与 Kill Switch

### 41.1 Flags

```text
批次 1：  agent_thread_v1 / agent_run_v1 / agent_semantic_event_adapter_v1
批次 2：  progressive_plan_v1 / agent_kernel_v1 / compiled_execution_plan_produce_v1
批次 3：  execution_plan_snapshot_v1 / compiled_execution_plan_consume_v1
批次 4：  make_steering_v1
并行 lane：agent_memory_read_v1 / agent_memory_candidate_write_v1
批次 6：  marketing_goal_v1 / proactive_opportunity_v1
```

命名修正（MINOR-03）：`agent_semantic_event_adapter_v1`（原 agui_protocol_v1——只抄协议不引 runtime，名称须体现 adapter）；`agent_memory_candidate_write_v1`（原 soft_write——R1 已撤回自动生效，写的是候选）。compiled plan 拆生产/消费两个 flag（MAJOR-08：编译在批次 2 产生、批次 3 才被 Make 消费）。

每个 flag 必须声明：canonical writer、legacy fallback、migration rule、delete condition。**flag 随所属批次引入（D7），不一次建满。**§36 的对应票为各 flag/switch 的 owner，创建与删除责任随票走。

### 41.2 Kill Switch（颗粒化，不做单一总开关）

```text
批次 2：  disable_agent_planning（specialist 委派停用并入其降级档，不单设开关）
批次 3：  force_manual_plan_confirmation（确认卡在批次 3 生效）
         force_legacy_five_stage（新 Make 消费自批次 3 开始，即刻需要回退开关）
批次 4：  disable_make_steering
并行 lane：disable_memory_write / disable_memory_read
批次 6：  disable_proactive_agent
```

switch 随所属批次引入（D6），不一次建满（批次归属按 MAJOR-08 与 §35 对齐）。

## 42. 回滚与事故处置

**代码回滚**：每批次独立 feature flag；Workbench 可退回旧 Composer renderer；AgentEvent 可停读不停写；ExecutionPlan 新路径可按 workspace 关闭；legacy Make Harness 保留到全量稳定后。

**Release 回滚**：在途任务保持冻结 release；新任务切回前一 production release；Prompt label 回滚不改已冻结 task；canary 试点期**人工暂停**（自动暂停随自动回滚门绑定触发点，BLOCK-08/D3）；记录 rollback reason 和 evidence。

**数据处置**：Intent/Plan/confirmation append-only；不删除事件以伪造恢复；layout 不兼容 fail closed；必要时只取消未执行任务并退还积分（D-153 语义）；不自动重放外部写操作。

## 43. 发布前绝对门

以下任一未满足，不全量上线：

1. 用户可见 Plan 与实际执行 snapshot exact 一致（fidelity=100%）；
2. LLM 无法绕过事实、权利、费用和权限；Agent 不产生 Business Truth、不拥有余额、不拥有 Publish authority、不可绕过 Tool Registry；
3. pending interrupt 在刷新和重连后不丢失；
4. duplicate resume、duplicate event、duplicate submit、duplicate debit、duplicate accepted side effect 全部幂等/为 0；
5. 新流程对 Day-0 自由创作可达；简单任务不因升级变慢或变复杂；
6. 中途 steering 不静默改变费用、事实和其他页面；
7. partial output 不写 canonical state；
8. Prompt、Skill、Tool、Schema 和 Model Policy 均可定位 exact release；
9. **任何已启用的** replay/shadow 均不得产生生产副作用（BLOCK-08：L2/L3 本身绑定触发点，未建设不构成放行障碍）；
10. rollback 演练通过；kill/restart 后重复 side effect=0；accepted/unknown 不盲重提；
11. live / fixture / recorded 状态严格区分；
12. 真实门店试点证明提问和完成时间不劣于旧流程；
13. 不显示原始 Chain of Thought；
14. 无障碍、移动端和 reduced motion 通过；
15. Memory：cross-store leak=0、correction recurrence=0、false business fact promotion=0；
16. Planner：invalid plan=0 进入 execution、unresolved hard requirement=0 进入 execution；
17. Event：snapshot+replay 等价、event 丢包不影响 canonical state、ephemeral delta 不参与恢复正确性；
18. Thread 可跨 Work 连续、Delivery 后可继续同一 Thread、Memory 可查看/纠正/撤销、Agent 推荐带可解释依据。

## 44. 最终目标

升级完成的标准是五件事同时成立：

1. 商家第二个月再来时，Agent 真的比第一个月更懂这家店；
2. 商家只说一个经营目标，Agent 可以自己拆成多次宣发任务；
3. 一次任务复杂时，Agent 会规划、检查、修正，并在真正需要时询问用户；
4. 执行过程中，Provider、费用、权利和发布永远可恢复、可审计、不重复；
5. 内容发布之后，结果会进入下一次判断，而不是消失在系统外。

```text
                    ┌──────────────────────┐
                    │                      │
                    ↓                      │
Goal → Understand → Plan → Execute → Deliver
 ↑                                      │
 │                                      ↓
 └──── Learn ← Memory ← Outcome ← Observe
```

工程资源从「把五阶段 Harness 做得越来越完整」转向「**让一个 Agent 长期理解一家门店，同时把所有真实业务副作用可靠地交给确定性执行内核**」。

---

# 附录 A：必须承接的已拍板硬约束（验收附录）

实施各批次逐条进验收；违反任一条视为该批次不通过。

| # | 约束 | 来源 | 本文落点 |
|---|---|---|---|
| A1 | 积分/上游成本双真相铁律：任何面永不暴露上游 token/美元成本；供应侧用量账与商家积分账永久双轨禁合并 | D-061 | §7.1、§32 |
| A2 | 付费确认 hold 到期 = durable 取消任务 + 退回额度 + 白话告知；无静默失效；reservation sweeper 不复活 | D-153 | §14.3、§37.4-H、§42 |
| A3 | 余额检查 + ProductUsage reservation + GrantLot FEFO 扣减同一数据库事务 + workspace 级积分锁 | 计费 §4.2 | §14.3、§37.2 |
| A4 | refund 回原扣批次；批次过期则份额作废不复活且流水行可见 | 计费 §4.1 | §14.3、§37.2 |
| A5 | 模型级失败退还开关投影到前台报价双态文案 | credit-billing-spec §3 失败退还开关（:100）/ 报价 chip 合同（:184） | §3 Level 1、§5.4 |
| A6 | 有界执行：闸门数值进钉扎快照禁隐式默认；触顶=可续挂起态非失败；三层重试不叠乘；权限类失败不进自纠环直接硬拦+ask_merchant | D-167①②③ | §14.2、§21.2 |
| A7 | 七门红线恒 block、不可配置不可采样（采样率恒 1.0）、onViolation 恒触发、软提示必须留痕 | D-166③ | §22.2 |
| A8 | 领域枚举不进原语/引擎签名；新增输出类型零代码改动 | D-163① | §16.1、§22.2 |
| A9 | kind 三枚举 `media|copy|note` + 兼容别名（image_text→note、video→media），起步不做破坏性迁移 | D-171② / xhs spec §3.1（:196） | §13 deliverables |
| A10 | D-038 五条：step 纯函数内核；at-least-once 业务幂等；大产物对象存储；回装段 OCC 条件写；发布 SOP 排空/版本粘滞 | D-038 | §22.4 |
| A11 | 记忆分离删除：删源对话不级联删记忆；四类实体（记忆/DecisionEvent/ApprovalReceipt/provenance）各自删除策略；ApprovalReceipt 不可删 | D-168② | §12.6 |
| A12 | 统一超时语义：超时=语义层默认回答（仅限无外部副作用），留痕区分商家答/代答；不做载体层挂起过期；编辑中暂停倒计时；涉外部副作用或超额度不自动继续 | D-116/D-169① | §5.1、§16.1 |
| A13 | 确认门判定=是否含付费媒体执行；纯 copy 免确认（D-043）；确认卡只读、只有拒绝/确认；拒绝则零扣费 | XHS §3.2 / D-164③ / D-171③ | §3、§14.1 |
| A14 | strict prompt 供给：缺 pin 不得静默降级，isFallback 经审计管道落库；D-165 三轴扁平顶层键禁嵌套 | D-166④ / D-165 | §29.3 |
| A15 | GAP required CI 覆盖（L4 必跑门表） | GAP:70-78 | 批次 1-2 验收 |
| A16 | R-8 视觉截图基线与 journey 门清单因形态改版作废，须重拍/更新 | GAP:35、GAP:88 | §39、批次 1-2 验收 |
| A17 | OpenCLI live 门与 device bridge 互相独立且均 fail-closed | xhs spec §5；决策日志 D-171 实施核销（:3528-3532） | 相关 lane 验收 |
| A18 | 条件/判断位禁止副作用（durable 重放语义崩塌） | D-167⑤ | §22.2 编译期展开/代码内确定性分支 |
| A19 | 二维码交接=商家自发（MobilePublishHandoff）；扫码后我方驱动发布被 reject | D-171④、D-155 冻结面 | §6.2 |

# 附录 B：决策记录（14 项已全部拍板，2026-08-08，逐项经用户确认）

复核来源：`docs/reviews/v3.1-codex-xcheck-2026-08-08.md` §3（U1–U6 为原附录 B 六项校准，U7–U12 为 codex 复核新增）；U13–U14 来自九张 spec 的 codex 交叉复核（`docs/reviews/v3.1-specs-codex-xcheck-2026-08-08.md` §4 的 D2/D3，D1 随 BLOCK-02 证伪关闭）。正文落点已同步。

| # | 决策 | 拍板结果 | 正文落点 |
|---|---|---|---|
| U1 | 免确认边界未来是否放宽到低成本媒体 | **A**：永久只有纯 copy 免确认；放宽须显式 supersede，不设积分阈值/allowlist | §3 Level 1 |
| U2 | 自报追问时机、chips、频控与覆盖率门岞 | **A**：次日一次 + 6 chips + 连续两次不理降频；40% 首窗只观测、形成基线后再升硬门 | §6.3、§38 |
| U3 | L1 eval 冷启动数据口径 | **A**：fixtures 为主 + 脱敏历史抽样；冻结 dataset revision/来源/许可 | §31.2 |
| U4 | compaction token 成本归属与失败降级 | **A**：平台承担、不计商家积分；失败保留上次摘要 + retainedTail，不阻断 | §18.3 |
| U5 | Memory 存储收编 | **C**：按生命周期混合——preference/correction 续用三表扩列，working 放 Thread checkpoint，procedural 保留 confirmed projection | §12.5、§33.1 |
| U6 | 多设备并发 turn 仲裁 | **A**：每 Thread 单活跃写 turn，第二请求 409 + 提示刷新，`sessionRevision` OCC | §27.6 |
| U7 | Campaign 派生付费 Work 的确认粒度 | **B**：Campaign 确认只批准计划排期；每付费 Work 单独流内确认，纯 copy 免确认 | §3 Level 3、§14.1 |
| U8 | reservation 时序 | **A**：确认请求创建事务内先 reserve；拒绝/过期全额 refund（维持 D-153 与现有 durable 证据链） | §14.3 |
| U9 | 纯 copy 免确认的冻结交接物 | **A**：中性 `ExecutionPlanSnapshot` + `approvalBasis: merchant_confirmed \| policy_exempt_copy`，两路径都冻结 exact plan/quote/release | §14.2 |
| U10 | per-run 试跑口径 | **A**：只能选择完整 immutable candidate releaseId；禁字段级覆写 | §29.4 |
| U11 | AgentControlLimits 首版数值 | **B**：recorded/fixture 回放校准后随 release 发布；未标定项显式 unset 并拒进生产路径 | §21.2 |
| U12 | canary 放量与 scored verdict 准入 | **B**：gates 全过为底线；scored 只记账、放量人工决定；自动门待样本足够再定义 | §29.4、§31.3 |
| U13 | Proactive evidence 准入门无基线期间的启用策略 | **默认关 + 人工 allowlist**：阈值 unset 时门默认关闭、coverage 只观测；运营可用既有 `proactive_opportunity_v1` flag 按 workspace 临时开启（试点/演示），不新增机制；分母/观察窗/最小样本随 U2 基线形成后另拍 | §25.3 |
| U14 | legacy durable replay 归档时机 | **条件门 + 安全缓冲**：零 active/pending 旧实例 + 最长 hold 窗口（30d）走完 + 审计导出与回滚证明齐备，再加 ops policy 给值的固定缓冲后归档 fail closed；不用日历一刀切 | §22.4、§35 批次 6 |

**补充裁决留痕（2026-08-08 spec 复核轮）**：Goal status 迁移（active→paused/completed/abandoned）走「Agent 对话中提议→商家确认→落新 revision」路径（无管理页、revision OCC），系对 §11 状态迁移空白的补充，落点见 V3.1-F 票面。

**补充裁决留痕（2026-08-11 视频域纠偏轮）**：两项用户拍板——① **视频字幕与封面为无效功能、不交付**（V31-37 采 A 路：承认 #264 退役，字幕由发布平台承担，产品侧不承诺字幕轨与封面面板；§6.2/§37.4-D 已修订）；② **分镜不进 Plan、与积分无关**（上游供应商无任何按分镜计费的规则，分镜仅应用于提示词生成环节；§37.4-D「Plan 显示分镜」要求废止，V31-35 整票废止）。边界：Make 期逐场景进度（分镜/关键帧，§5.5）与交付面镜头清单**保留**——它们是过程反馈与交付物内容，与计费无关。承接实施：V31-60（契约收窄，删 `subtitle`/`coverStatus`/`coverRef` 死字段）、V31-61（字幕残链清理，先斩 model-supply 时长推导对字幕时间轴的隐性依赖 `index.ts:5764`，再核 handoff/content-package 残余）、V31-62（V31-15 AC2/3/4 定向浏览器绿证补齐）。

# 附录 C：参考依据

**仓库实施基线**：`PRODUCT.md`、`DESIGN.md`、`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（决策权威）、`docs/specs/xhs-vertical-integration-spec-2026-08-01.md`、`docs/specs/credit-billing-spec-2026-08-01.md`、`docs/ops/gap-remediation-plan-xhs-313-328-2026-08-02.md`、`apps/core/src/p1/harness/{workflow-core,dbos-workflow,task-admission,structured-nodes,langfuse-prompts}.ts`、`apps/core/src/p1/model-supply/structured-node-runner.ts`、`mkfast-template-main/src/product/composer/{composer-home,workbench-shell-layout}.tsx`、`mkfast-template-main/src/product/object-workspace/**`。

**评审依据**：`docs/reviews/0808-agentic-plan-cross-review-2026-08-08.md`（R1–R16 修改、保留清单、硬约束核查，含两轮 file:line 事实核查）；`docs/reviews/v3.1-product-first-framework-benchmark-review-2026-08-08.md`（产品优先 × 落地效率 × 框架对标专项，A/B/C/D 四组修订来源；Mastra 1.57 / pi.dev 0.84 / LangChain-LangGraph 1.x 三路实查）；`docs/reviews/v3.1-codex-xcheck-2026-08-08.md`（codex 独立交叉复核：BLOCK-01~09 / MAJOR-01~13 / MINOR-01~03 修入记录 + U1–U12 决策来源）；`docs/reviews/v3.1-specs-codex-xcheck-2026-08-08.md`（九张 spec 复核 27 findings 的双反驳处置 + U13–U14 裁决来源）。

**借鉴来源对照表**（正文各处的 A/B/C 编号 → 来源框架与文档）：

| 编号 | 借鉴内容 | 来源 |
|---|---|---|
| A1 | Policy 两类钩子 + 执行序 pin（§20.4） | LangChain middleware — https://docs.langchain.com/oss/python/langchain/middleware/custom |
| A2 | System-only 拦截层 block-with-reason（§16.2） | pi extensions `tool_call` 事件 — https://pi.dev/docs/latest/extensions |
| A3 | Interrupt 类型化协议 + id 回注（§27.6） | LangChain HITL middleware / LangGraph interrupts — https://docs.langchain.com/oss/python/langgraph/interrupts |
| A4 | Quick Checks 零 LLM 行为门（§31.1b） | Mastra — https://mastra.ai/docs/evals/quick-checks |
| A5 | gates/thresholds/verdict 三态（§31.2） | Mastra — https://mastra.ai/docs/evals/gates-and-verdicts |
| A6 | Observer 压缩 + Extractor 候选流（§12.4） | Mastra Observational Memory — https://mastra.ai/docs/memory/observational-memory |
| A7 | durability 分级 / RetryPolicy 保守默认 / CachePolicy 含 releaseId（§10/§22.2） | LangGraph — https://reference.langchain.com/python/langgraph/types/Durability 、/RetryPolicy 、graph-api CachePolicy |
| B1 | HITL 重发现端点（§27.6） | Mastra `listSuspendedRuns()` — https://mastra.ai/docs/agents/agent-approval |
| B2 | transient 发射侧判定（§27.1） | Mastra streaming transient chunk — https://mastra.ai/guides/concepts/streaming |
| B3 | 6 段压缩模板 + retainedTail（§18.3） | pi compaction — https://pi.dev/docs/latest/compaction |
| B4 | replay 强制只读闸（§31.3） | LangGraph time-travel — https://docs.langchain.com/oss/python/langgraph/use-time-travel |
| B5 | guardrail blocking/parallel 两档（§20.4） | OpenAI Agents SDK guardrails — https://openai.github.io/openai-agents-python/guardrails/ |
| B6 | 工具工作流化 + response_format（§20.3） | Anthropic writing tools — https://www.anthropic.com/engineering/writing-tools-for-agents |
| B7 | steering 双队列语义（§24） | pi steer/followUp — https://pi.dev/docs/latest/usage |
| C1 | 上下文 lane snapshot/delta（§18.3 备用） | Mastra state signals — https://mastra.ai/docs/long-running-agents/signals |
| C2 | background tasks + untilIdle（§21.2 备用） | Mastra — https://mastra.ai/docs/long-running-agents/background-tasks |
| C3 | per-run release 覆写（§29.4） | Mastra Editor 版本定向 — https://mastra.ai/docs/editor/overview |
| C4 | 大结果卸载区（§18.3 备用） | LangChain Deep Agents — https://docs.langchain.com/oss/python/deepagents/overview |
| — | pi session-format entry 级 `context_role` 标注（§27.1） | pi — https://pi.dev/docs/latest/session-format |
| — | 触顶=paused 同构验证（§21.2） | Mastra Goals — https://mastra.ai/docs/long-running-agents/goals |

**外部模式参考**：AG-UI（events/state/interrupt/serialization，只抄协议）；Vercel AI SDK（structured output、tool loop control、streaming）；A2UI（declarative catalog，限动态表单场景）；Langfuse（Prompt version/label、trace linkage、datasets、experiments、eval）；assistant-ui / CopilotKit（Tool UI、Interactable、Shared State、HITL 模式，只抄模式禁 runtime）。

**被取代文档**：`meiye-agentic-workbench-v2-complete-plan.md`、`完成.md`——保留作历史底稿，冲突处以本文为准。


