> **⚠️ 本文已被取代（2026-08-08）**：权威版本为同目录 `meiye-agent-v3.1-authoritative-plan-2026-08-08.md`。冲突处以 V3.1 为准；本文保留作历史底稿与细节补充参考。修订依据见 `docs/reviews/0808-agentic-plan-cross-review-2026-08-08.md`。

# 丽客美页 Agent 原生工作台 V2：Intent → Living Plan → Make × LLM/Harness 完整升级规划

**版本**：V2.0 / 2026-08-08  
**适用仓库**：`leelv007-cmd/meiyeweb-agent`  
**方案性质**：产品、用户旅程、LLM 编排、Harness、AG-UI 事件、技术架构、UI/UX、测试、发布与运营控制面的统一实施规格  
**配套原型**：`meiye-agentic-workbench-harness-v2-prototype.html`

---

## 0. 单一权威结论

本次升级保留 **Intent → Plan → Make** 的业务语义，但不再将其实现为三张大页面、三段向导或一组不断追加的卡片。

商家前台应表现为一条连续、主动、可恢复的 **Agent Workstream**：

```text
商家说一个模糊经营目标
  → Agent 先检索门店事实、授权素材、历史内容与经验
  → 形成可见但非阻塞的理解与假设
  → 只对高影响歧义问一个问题
  → Living Plan 在同一文档中逐步成形
  → 确定性系统补齐事实、权利、费用、能力与执行边界
  → 用户确认一次
  → Production Harness 按冻结方案执行
  → 同一个 Artifact 原位生长
  → 用户可在运行中 steering
  → Delivered 后精修、发布交接与结果留痕
```

核心技术边界为：

> **LLM 驱动语义与创意；Agent Session Harness 驱动理解、检索、Plan 与 Steering；Production Make Harness + DBOS 驱动付费执行、幂等、恢复、结算和交付；Harness Control Plane 驱动版本、评估、灰度与回滚。**

### 0.1 不变的产品真相

以下现有真相链继续保留：

- `Task / Work / ContentPackage`；
- DBOS durable workflow；
- execution snapshot 与 route snapshot；
- 事实、权利和资质门；
- 积分报价、预扣、结算和失败退还；
- Prompt exact version 与 Skill manifest；
- Result Center / Object Workspace；
- 单 Dashboard 创作主路由；
- copy、media、note 三类 carrier 产品语义。

### 0.2 本次必须新增的四层

1. **Agent Workbench**：连续叙事、Activity、Living Plan、Artifact、Critical Interrupt。
2. **Agent Session Harness**：低延迟、低副作用的 Intent/Plan/Steering 控制循环。
3. **Approved Plan Snapshot**：用户看到的方案与 Production Harness 实际执行方案完全一致。
4. **Harness Control Plane**：统一管理 Prompt、Skill、Tool、Schema、Model Policy、Eval、Canary 与 Release。

### 0.3 明确不做

- 不让 LLM 成为业务状态机或数据库权威；
- 不让模型直接选择 Provider、修改费用或绕过权利门；
- 不引入第二套 durable Agent Runtime 替换 DBOS；
- 不暴露原始 Chain of Thought；
- 不允许模型生成任意 HTML、CSS、JavaScript 或任意 React 组件；
- 不用无限多 Agent 自由协商；
- 不为“看起来实时”而把稳定 SSE 全量迁成 WebSocket；
- 不建设完整视频 NLE、CRM、预约或收银系统；
- 不在用户确认后静默重算出不同方案。

---

# 1. 目标产品体验

## 1.1 用户只需要理解五件事

商家在整个流程中只需要理解：

1. **我想解决什么经营问题**；
2. **系统理解成了什么**；
3. **系统准备为我制作什么**；
4. **现在做到哪一步、是否需要我处理**；
5. **成品是否已经可以发布**。

模型、Prompt、Provider、Task、Route、Revision、Schema、Job 等内部对象不进入主界面。

## 1.2 表层体验不是传统三步向导

服务端仍有 Intent、Plan、Make 等状态，但前台是一条连续文档：

```text
Agent Lead
  ↓
Narrative Stream
  ↓
Activity Stream
  ↓
Assumption / Inline Choice
  ↓
Living Plan
  ↓
Commit Strip / Critical Interrupt
  ↓
Live Make + Shared Artifact
  ↓
Delivered + Publish Handoff
```

## 1.3 成功形态

一个理想任务：

> 用户：“明天下午还有两个空档，帮我发点奶油风美甲，不要太像广告。”

系统应做到：

1. 自动识别“填补空档 + 推新品”的经营目标；
2. 检索门店项目、最近授权素材、店主表达身份与最近发布内容；
3. 告知“我找到了 5 张适合的授权图片，价格没有可靠来源，因此不写价格”；
4. 只问一个真正影响结果的问题，例如“更突出新款，还是更突出明天下午空档？”；
5. 形成 Living Plan：小红书 6 页图文 + 朋友圈短文案 + 预约 CTA；
6. 显示预计积分、失败退还、权利和事实状态；
7. 用户确认后开始；
8. 图文页在右侧 Artifact 中逐页长出；
9. 用户中途说“封面不要写最后两个名额”，只修改未完成的封面计划；
10. 完成后直接进入发布准备和手机交接。

---

# 2. 总体架构

## 2.1 四层架构

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Agent Workbench / React                                  │
│ Narrative · Activity · Living Plan · Artifact · Interrupt   │
└──────────────────────────────┬──────────────────────────────┘
                               │ AG-UI-compatible events
┌──────────────────────────────▼──────────────────────────────┐
│ 2. Agent Session Harness                                     │
│ Intent · Retrieval · Ambiguity · Plan · Steering            │
│ 只读优先；Plan 确认前不做付费媒体副作用                      │
└──────────────────────────────┬──────────────────────────────┘
                               │ ApprovedPlanSnapshot
┌──────────────────────────────▼──────────────────────────────┐
│ 3. Production Make Harness + DBOS                            │
│ Admission · Execute · Select · Assemble · Settle · Recover  │
└──────────────────────────────┬──────────────────────────────┘
                               │ traces / scores / releases
┌──────────────────────────────▼──────────────────────────────┐
│ 4. Harness Control Plane                                     │
│ Prompt · Skill · Tool · Schema · Model · Eval · Canary      │
└─────────────────────────────────────────────────────────────┘
```

## 2.2 各层主权

| 对象 | 权威层 |
|---|---|
| 商家自然语言、假设、方案叙述 | LLM / Agent Session Harness |
| 事实是否存在、是否过期 | Fact / Context 服务 |
| 素材是否授权 | Rights 服务 |
| 能力是否可用 | Model Supply / Capability |
| 费用和积分 | Billing |
| 是否允许继续 | Policy Engine / Harness |
| 任务状态和恢复 | DBOS / Task |
| 最终成品 | ContentPackage |
| Prompt、Skill、Tool 版本组合 | Harness Release |
| UI 呈现 | React Controlled Surface Registry |

## 2.3 为什么拆成两个 Harness

### Agent Session Harness

适合：

- Intent 理解；
- 主动检索；
- 模糊适配；
- Plan 编译；
- Plan 调整；
- Make steering；
- 经验候选；
- 低成本、快速、可取消的交互。

### Production Make Harness

适合：

- 付费模型调用；
- 图片和视频生成；
- durable provider job；
- bounded execution；
- 付费确认；
- 部分成功；
- 账本结算；
- ContentPackage 组装；
- 刷新与故障恢复。

把二者混在同一循环中，会让一次简单理解请求也进入重型 durable 生产链；把二者完全分开但不共享冻结 Plan，又会导致用户确认方案与实际执行方案漂移。因此中间必须由 `ApprovedPlanSnapshot` 连接。

---

# 3. 页面与信息架构

## 3.1 路由原则

保留：

| 路由 | 职责 |
|---|---|
| `/dashboard` | Agent Workbench：Intent、Plan、Make 的唯一创作入口 |
| `/dashboard/results/$workId` | 对象工作区、精修、发布交接 |
| `/dashboard/works` | 成品与历史内容 |
| `/dashboard/recent` | 会话、任务和恢复入口 |
| `/dashboard/store` | 门店、项目、素材、身份、事实 |
| `/dashboard/memory` | 前台显示为“经验” |

不新增 `/intent`、`/plan`、`/make` 三个一级页面。

建议 `/dashboard` search schema 新增：

```ts
interface DashboardSearch {
  taskId?: string;
  identity?: string;
  intentId?: string;
  planId?: string;
  phase?: 'intent' | 'plan' | 'make';
}
```

`phase` 只作为首屏定位提示；服务端 `WorkbenchSessionProjection` 是实际状态权威。

## 3.2 桌面总体布局

```text
┌───────────────────────────────────────────────────────────┐
│ 顶栏：工作台 / 当前门店 / Agent 主动度 / 积分 / 恢复状态 │
├───────────────────────────────────────────────────────────┤
│ 左 62%：连续 Agent Workstream │ 右 38%：Shared Artifact  │
│ Narrative                │ Plan / Note / Video / Publish  │
│ Activity                 │ 原位持续更新                   │
│ Inline Choice            │                                │
│ Living Plan              │                                │
│ Interrupt                │                                │
│ Steering Composer        │                                │
└───────────────────────────────────────────────────────────┘
```

Idle 时主列保持约 800px；Active / Delivered 且有 Artifact 时展开到约 1240px。继续复用当前 `react-resizable-panels` 和移动 Bottom Sheet。

## 3.3 移动端布局

移动端不是桌面双栏缩小，而是：

- 默认显示 Workstream；
- 顶部胶囊切换“过程 / 作品”；
- Artifact 在全屏 Sheet 中打开；
- Composer 固定在移动底栏上方；
- 付费 Interrupt 使用全宽底部面板；
- 拍摄、上传、确认、查看进度和发布交接为主；
- 不在手机上完整暴露复杂编辑器。

---

# 4. 商家工作台完整流程

## 4.1 Intent：连续理解，不是填写表单

### 页面内容

- 问候与一句主输入；
- 经营目标快捷语义；
- 素材、项目、身份、平台等胶囊；
- 主动度设置：稳妥 / 平衡 / 主动；
- 今日建议和最近工作；
- CTA：`先帮我理一理` 或 `直接帮我做`。

### Agent 行为

1. 先解释当前理解；
2. 自动检索已存在的信息；
3. 显示安全 Activity；
4. 提出低风险假设；
5. 只在高影响歧义时追问；
6. 不扣积分、不启动付费媒体生成。

### 前台文案示例

> 我理解你这次主要想填补明天下午的空档，同时顺带曝光新款。先按自然分享、不过度促销处理。

> 我找到了 5 张最近上传且可用于公开宣传的奶油风作品图。具体价格没有可靠来源，所以方案里不会写数字价格。

## 4.2 Living Plan：活文档，不是卡片表单

Plan 在同一条 Workstream 中逐行形成：

```text
目标
  用真实作品吸引附近顾客，并自然带出明日下午可预约

本次制作
  小红书图文 · 6 页
  朋友圈短文案 · 1 条
  预约引导图 · 1 张

表达策略
  店主本人自然分享
  低促销感
  CTA：私信预约

事实与素材
  使用 5 张已授权图片
  不写价格
  不承诺效果

预计
  38 积分 · 约 2–4 分钟 · 失败按规则退还
```

用户可以用自然语言调整：

- “只做小红书”；
- “再自然一点”；
- “不要写空档”；
- “改成技师口吻”；
- “封面不要写价格”；
- “减少到 4 页”。

每次调整产生新的 Plan revision，重新核查事实、权利、能力和 quote；旧版本不可被静默覆盖。

## 4.3 Commit Strip / Critical Interrupt

普通 Plan 使用紧凑确认条：

```text
38 积分 · 余额 126 · 素材授权通过 · 事实可用
[返回修改] [开始制作]
```

只有以下情况进入 Critical Interrupt：

- 付费媒体执行；
- 顾客素材或受限素材；
- 高风险事实冲突；
- 资质缺失；
- 费用变化；
- 模型降级会改变质量或交付；
- 发布等外部动作；
- bounded execution 继续增加预算。

Interrupt 必须只读、解释原因、提供明确出口，不重新变成设置表单。

## 4.4 Make：Artifact 原位生长

左侧 Workstream 显示：

- 当前阶段；
- 已完成内容；
- 需要用户处理的唯一事项；
- 可否离开；
- 失败和退还状态。

右侧同一个 Artifact 持续更新：

- 文案：标题、正文、CTA 逐块完成；
- 图文：页面骨架、文案、配图状态逐页完成；
- 视频：分镜、关键帧、生成状态、字幕和封面逐场景完成；
- 发布：准备度逐项完成。

不重复追加“候选卡 + 结果卡 + 交付卡”。同一对象只更新一个稳定 ID。

## 4.5 Steering

用户运行中可输入：

> 封面不要写“最后两个名额”。第二页少一点字。

系统先分类：

| 类型 | 行为 |
|---|---|
| `future_step_patch` | 修改尚未执行步骤，不重新报价 |
| `derived_revision` | 已完成内容创建派生版本 |
| `plan_change` | 数量、模型、平台、费用或事实改变，回到 Plan |
| `unsafe_or_conflicting` | 解释冲突并要求修正 |

前台必须显示影响范围：

> 已应用到封面和第 2 页；其他页面不变。

## 4.6 Delivered 与 Publish Handoff

Delivered 默认展示：

- 主推荐；
- 其他交付物；
- 发布准备度；
- 快捷修改；
- 打开对象工作区；
- 生成同系列；
- 进入发布交接。

发布交接包括：

- 标题、正文、话题、CTA 分块复制；
- 图片按顺序命名和批量下载；
- 视频、字幕、封面和平台安全区；
- 手机二维码继续；
- verified / assisted / unavailable 能力状态；
- “我已发布”、链接、时间和截图留痕；
- 后续观察窗口。

---

# 5. LLM 驱动模型

## 5.1 一个主 Agent，多种专业节点

首发采用一个 **Marketing Supervisor Agent**，内部调用受控专业节点：

```text
Marketing Supervisor
  ├── Intent Interpreter
  ├── Retrieval Planner
  ├── Ambiguity Resolver
  ├── Plan Synthesizer
  ├── Copy / Note / Image / Video Generators
  ├── Quality Critics
  └── Experience Curator
```

这些可以使用不同 Prompt 和模型策略，但不拥有独立、自由扩散的长期记忆和工具权限。

### 允许真正并行的子任务

- 参考图风格分析；
- 多平台文案改编；
- 独立候选软质量评价；
- 不改变主事实的页面并行生成。

所有 delegation 受 `maxDelegations` 约束。

## 5.2 LLM 与确定性系统分工

### LLM 负责

- 模糊意图理解；
- 检索需求规划；
- 假设与追问建议；
- 经营策略和内容结构；
- 方案商家语言；
- 文案、图文、视觉 Prompt、视频分镜；
- 软质量评价；
- Steering 语义分类建议；
- 经验候选提议。

### 确定性系统负责

- 身份、权限；
- 事实、时效；
- 素材权利；
- 模型能力；
- Quote 和积分；
- 状态机；
- 幂等；
- durable 恢复；
- 发布硬门；
- 审计；
- 最终业务写入。

## 5.3 模糊适配的四级策略

| 等级 | 定义 | 行为 |
|---|---|---|
| L0 | 明确 | 直接形成 Plan |
| L1 | 可安全假设 | 采用可逆默认，并显示 assumption |
| L2 | 会实质影响结果 | 只问一个高价值问题 |
| L3 | 权利、事实、费用或外部动作风险 | 必须 Interrupt / 阻断 |

不使用单一 confidence 阈值作为唯一判断。置信度只能辅助，最终由“影响类别 × 可逆性 × 权威来源”决定。

## 5.4 主动度三级

### 稳妥

- 少做假设；
- 中等影响就询问；
- 适合受监管或新门店。

### 平衡（默认）

- 先检索；
- 低风险默认；
- 每轮最多一个问题；
- 用户可以随时纠偏。

### 主动

- 自动选择项目、素材、平台和配方；
- 自动提出系列组合；
- 付费和高风险动作仍必须确认。

## 5.5 问题预算

推荐上限：

| 阶段 | 默认最多问题 |
|---|---:|
| Intent | 1 |
| Plan | 1 |
| Make | 仅安全、费用或不可继续时 |
| Publish | 仅必要发布字段或外部确认 |

多个相关缺口应合并成一个自然问题，不得拆成连续表单槽位。

---

# 6. LLM 输入合同

## 6.1 AgentTurnInput

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

## 6.2 ModelContextProjection

只给模型最小、经过权限裁剪的投影：

```ts
type ModelContextProjection = {
  merchantRequest: {
    text: string;
    creationMode: 'customized' | 'free';
    language: 'zh-CN';
  };

  confirmedFacts: Array<{
    ref: string;
    kind: string;
    value: string;
    revision: number;
    freshness: 'current' | 'expiring' | 'stale';
    claimPolicy: 'allowed' | 'context_only' | 'forbidden';
  }>;

  assets: Array<{
    ref: string;
    category: string;
    description: string;
    rightsStatus: 'authorized' | 'restricted' | 'expired';
    allowedPlatforms: string[];
    containsPerson: boolean;
  }>;

  identity: {
    ref: string | null;
    displayName: string;
    voiceSummary: string;
  };

  recentContent: Array<{
    ref: string;
    platform: string;
    topic: string;
    published: boolean;
  }>;

  experience: Array<{
    ref: string;
    instruction: string;
    status: 'confirmed' | 'pending';
  }>;

  policies: {
    forbiddenClaims: string[];
    requiredDisclosures: string[];
  };

  executionCapabilities: {
    availableDeliverables: string[];
    unavailableDeliverables: string[];
  };
};
```

### 禁止进入模型上下文

- Provider secret；
- 其他 workspace 数据；
- 未授权顾客原始资料；
- 内部数据库物理键；
- 上游成本和路由秘密；
- 原始操作日志；
- 隐藏推理；
- 无关历史全文。

## 6.3 Context 预算

建议按域设置预算：

| 域 | 默认上限 |
|---|---:|
| 当前 Intent | 完整 |
| 门店事实 | 20 条，按相关性和新鲜度 |
| 素材摘要 | 12 条 |
| 历史内容 | 6 条 |
| 确认经验 | 8 条 |
| 待确认经验 | 3 条，仅用于提示，不自动应用 |
| Policy | 仅适用规则 |

超过预算时按相关性、时效和事实权威排序，不允许简单截断导致高风险事实丢失。

---

# 7. LLM 输出合同

## 7.1 AgentTurnDecision

自然语言只负责解释；真正动作必须结构化：

```ts
type AgentTurnDecision = {
  merchantMessage: string;

  action:
    | { kind: 'retrieve'; requests: RetrievalRequest[] }
    | { kind: 'ask_merchant'; question: MerchantQuestion }
    | { kind: 'propose_plan'; proposal: PlanProposal }
    | { kind: 'patch_plan'; patch: PlanPatchProposal }
    | { kind: 'steer_make'; patch: MakeSteeringProposal }
    | { kind: 'propose_experience'; candidates: ExperienceCandidate[] }
    | { kind: 'finish_turn' };

  evidenceRefs: string[];
  assumptions: Array<{
    key: string;
    statement: string;
    risk: 'low' | 'medium' | 'high';
  }>;
};
```

执行前必须经过：

```text
Zod parse
→ evidenceRef validation
→ tool policy
→ fact policy
→ rights policy
→ billing policy
→ bounded execution
→ state transition
```

## 7.2 IntentHypothesis

```ts
type IntentHypothesis = {
  normalizedGoal: {
    type:
      | 'fill_availability'
      | 'promote_service'
      | 'show_case'
      | 'build_identity'
      | 'promotion_event'
      | 'free_creation';
    summary: string;
    urgency: 'today' | 'this_week' | 'evergreen' | null;
  };

  subject: {
    projectHint: string | null;
    assetNeed: 'required' | 'recommended' | 'none';
  };

  desiredActions: string[];
  platformHints: string[];
  deliverableHints: string[];

  assumptions: Array<{
    key: string;
    value: string;
    risk: 'low' | 'medium' | 'high';
    userVisible: boolean;
  }>;

  ambiguities: Array<{
    field: string;
    impact: 'creative_only' | 'fact' | 'rights' | 'cost' | 'external_effect';
    resolution: 'safe_default' | 'retrieve' | 'ask_user' | 'block';
  }>;

  retrievalRequests: RetrievalRequest[];
};
```

## 7.3 PlanProposal

LLM 输出策略，不写确定性费用和权利结论：

```ts
type PlanProposal = {
  goalNarrative: string;
  whyNow: string | null;

  recommendedDeliverables: Array<{
    carrier: 'copy' | 'note' | 'image' | 'video';
    platform: string;
    quantity: number;
    purpose: string;
    rationale: string;
  }>;

  expressionStrategy: {
    voice: string;
    openingMechanism: string;
    narrativeStructure: string[];
    promotionIntensity: 'low' | 'medium' | 'high';
    cta: string;
  };

  factIntentions: Array<{
    factKind: string;
    intendedUse: string;
  }>;

  assetIntentions: Array<{
    assetRef: string;
    intendedUse: string;
  }>;

  assumptions: Array<{
    key: string;
    statement: string;
  }>;
};
```

## 7.4 Partial output 规则

- `partialOutputStream` 只能更新临时 Activity 和非权威 Artifact preview；
- 只有最终通过 schema 的 output 才能写 canonical Plan 或业务状态；
- partial 中出现费用、权利、事实结论时不得直接展示为已确认；
- UI 必须标识 `正在形成`、`草稿`、`已确认` 三种状态；
- repair 后的最终对象替换同一 stable ID，不能追加一个新对象制造重复。

---

# 8. Agent 工具与策略

## 8.1 工具注册表

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

## 8.2 首批工具

### 自动可用的只读工具

- `find_store_projects`；
- `read_confirmed_store_facts`；
- `find_authorized_assets`；
- `read_marketing_identity`；
- `read_recent_content`；
- `read_confirmed_experience`；
- `read_platform_requirements`；
- `read_model_capabilities`。

### 需要 Policy 的可逆写操作

- 保存 IntentDraft；
- 创建 Plan revision；
- 标记本次 assumption；
- 创建 derived adjustment；
- 创建经验候选。

### 必须用户确认

- 付费媒体执行；
- 增加预算；
- 使用受限顾客素材；
- 改变交付数量和费用；
- 对外发布；
- 建立长期经验。

## 8.3 工具描述原则

工具描述必须说明：

- 能做什么；
- 不能做什么；
- 返回的数据边界；
- 是否产生副作用；
- 何时需要审批；
- 幂等键语义；
- 错误是否可重试。

不允许用模糊描述，例如“管理门店内容”或“完成发布”。

---

# 9. Agent Session Harness

## 9.1 状态机

```text
idle
→ interpreting
→ retrieving
→ hypothesis_ready
→ awaiting_clarification（可选）
→ plan_compiling
→ plan_ready
→ awaiting_approval
→ handing_off
→ steering
→ completed
```

## 9.2 运行约束

```ts
type AgentControlLimits = {
  maxLlmSteps: number;
  maxToolCalls: number;
  maxRetrievalCalls: number;
  maxMerchantQuestions: number;
  maxReplans: number;
  maxSchemaRepairs: number;
  maxContextTokens: number;
  maxDelegations: number;
};
```

建议默认：

| 限制 | Intent | Plan | Steering |
|---|---:|---:|---:|
| LLM steps | 4 | 6 | 3 |
| tool calls | 6 | 8 | 4 |
| retrieval | 6 | 4 | 2 |
| questions | 1 | 1 | 1 |
| replans | — | 3 | 1 |
| schema repair | 1 | 1 | 1 |
| delegations | 1 | 2 | 1 |

超过限制：使用当前最好结果、确定性回退或请求用户，不允许无限循环。

## 9.3 Agent Session Service

建议模块：

```text
apps/core/src/p1/agent-session/
  service.ts
  turn-runner.ts
  intent-interpreter.ts
  context-retrieval.ts
  ambiguity-policy.ts
  plan-synthesizer.ts
  plan-compiler.ts
  steering-classifier.ts
  tool-registry.ts
  event-projector.ts
  repository.ts
```

建议 P1 actions：

```text
agent_session_read
agent_turn_start
agent_turn_cancel
intent_create
intent_update
intent_normalize
plan_preview
plan_adjust
plan_read
plan_confirm
plan_cancel
steering_submit
workbench_session_projection
```

## 9.4 运行伪代码

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
    instructions: await promptPack.resolveExact(
      release.promptBindings,
      session.phase,
    ),
    prompt: canonicalJson(projection),
    tools: toolRegistry.forPhase(session.phase),
    activeTools: toolRegistry.namesForPhase(session.phase),
    output: Output.object({
      name: 'beauty_marketing_agent_turn',
      schema: agentTurnDecisionSchema,
    }),
    stopWhen: stepCountIs(release.controlLimits.maxLlmSteps),
    prepareStep: ({ steps }) =>
      controlStepPolicy({ steps, session, release }),
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

---

# 10. Plan Compiler 与冻结方案

## 10.1 两阶段 Plan

```text
LLM PlanProposal
  + Fact resolver
  + Rights resolver
  + Recipe resolver
  + Model capability
  + Billing quote
  + Skill manifests
  + Prompt packs
  + Compliance policy
  → MarketingPlanRevision
```

LLM 不写：

- quote；
- 余额；
- rights status；
- model availability；
- prompt/skill exact revision；
- execution limits；
- Plan expiry。

## 10.2 MarketingPlanRevision

```ts
type MarketingPlanRevision = {
  planId: string;
  revision: number;
  status:
    | 'compiling'
    | 'ready'
    | 'stale'
    | 'blocked'
    | 'confirmed'
    | 'cancelled'
    | 'superseded';

  goal: {
    summary: string;
    whyNow: string | null;
    desiredAction: string;
  };

  deliverables: PlanDeliverable[];
  expression: PlanExpression;
  factUsages: PlanFactUsage[];
  assetUsages: PlanAssetUsage[];
  rightsSummary: PlanRightsSummary;
  complianceSummary: PlanComplianceSummary;
  capabilitySummary: PlanCapabilitySummary;
  quote: PlanQuote;

  boundRevisions: {
    intentRevision: number;
    contextBundleId: string;
    contextRevision: string;
    recipeRevisionIds: string[];
    catalogRevisionId: string;
    modelRevisionIds: string[];
    sourceRevisionIds: string[];
    rightsRevisionIds: string[];
    quoteRevisionId: string;
    harnessReleaseId: string;
  };

  expiresAt: string;
};
```

## 10.3 ApprovedPlanSnapshot

用户点击开始制作后冻结：

```ts
type ApprovedPlanSnapshot = {
  planId: string;
  planRevision: number;

  intentDeclaration: IntentDeclaration;
  contextBundleRef: {
    bundleId: string;
    revision: number;
    hash: string;
  };

  executionBriefs: ExecutionBrief[];
  deliverables: PlanDeliverable[];

  promptRevisionRefs: Record<string, PromptRevisionRef>;
  skillManifestRefs: Record<string, SkillManifestRef[]>;
  routeRequirements: CapabilityRequirement[];

  quoteRevision: string;
  rightsRevisionRefs: string[];
  factRevisionRefs: string[];
  boundedExecution: BoundedExecutionSnapshot;
  harnessReleaseId: string;

  snapshotHash: string;
};
```

## 10.4 PlanApprovalReceipt

```ts
type PlanApprovalReceipt = {
  receiptId: string;
  workspaceId: string;
  actorId: string;
  planId: string;
  planRevision: number;
  approvalType: 'start_make';
  approvedAt: string;
  expiresAt: string;
  snapshotHash: string;
  quoteId: string;
  creditCost: number;
  idempotencyKey: string;
};
```

## 10.5 stale 触发器

以下变化使已确认前的 Plan stale：

- Intent 改动；
- 项目、价格、活动或地址 revision 变化；
- 素材授权撤销、过期或平台范围变化；
- MarketingIdentity 变化；
- recipe / catalog / model capability 变化；
- quote 过期；
- Prompt Pack 或 Skill manifest 变化；
- 合规主策略变化。

确认后、执行前发生实质变化时必须重新确认；执行中按影响分类处理，不得静默更换。

---

# 11. Production Make Harness 调整

## 11.1 保留现有五阶段，但改变职责

现状：

```text
intent_naming
→ context_injection
→ brief_compilation
→ execution_selection
→ assembly_delivery
```

目标：

```text
approved_plan_verification
→ context_and_rights_fence
→ execution_preparation
→ execution_selection
→ assembly_delivery
```

阶段名可为了 durable 兼容暂不物理修改，但新任务的语义应逐步转为：

- 不重新理解用户 Intent；
- 不重新生成与已确认 Plan 不同的 Brief；
- 只验证冻结 Plan 是否仍有效；
- 确定性地执行 `ApprovedPlanSnapshot`。

## 11.2 过渡策略：双跑一致性

第一阶段：

1. Plan 产生冻结 intent、context 和 brief；
2. 旧 Harness 仍重新运行；
3. 对比 intent hash、brief hash、fact refs、deliverables、quote；
4. 不一致只记 shadow evidence，不改变生产结果。

第二阶段：

- 新任务优先消费 ApprovedPlanSnapshot；
- 旧节点只做 validator；
- mismatch fail closed。

第三阶段：

- 关闭重复 LLM 调用；
- 保留确定性验证和 legacy replay 分支。

## 11.3 Steering 与派生执行

```ts
type SteeringClassification =
  | {
      kind: 'future_step_patch';
      affectedUnits: string[];
      requiresRequote: false;
    }
  | {
      kind: 'derived_revision';
      completedUnits: string[];
      requiresRequote: boolean;
    }
  | {
      kind: 'plan_change';
      reason: string;
      requiresReplan: true;
    }
  | {
      kind: 'unsafe_or_conflicting';
      reason: string;
    };
```

所有 Steering 都形成可追踪 command：

```ts
type MakeSteeringCommand = {
  commandId: string;
  taskId: string;
  sourcePlanRevision: number;
  sourceContentVersionIds: string[];
  instruction: string;
  classification: SteeringClassification;
  affectedUnitIds: string[];
  createdAt: string;
  actorId: string;
};
```

## 11.4 Context Fence 新语义

| 时点 | 变化 | 行为 |
|---|---|---|
| Plan 确认前 | 事实变化 | 自动更新 Plan，并显示 diff |
| 确认后、执行前 | 关键事实/权利/费用变化 | Plan stale，重新确认 |
| 执行中 | 未使用事实变化 | 继续 |
| 执行中 | 已引用价格/日期变化 | 暂停并提示 |
| 执行中 | 素材撤权 | 立即 fail closed |
| 执行中 | 非关键软信息变化 | 可完成，但发布准备要求复核 |

---

# 12. 流式事件与 AG-UI 兼容层

## 12.1 五条逻辑流

| 流 | 用途 |
|---|---|
| Narrative | Agent 商家语言、理解、解释 |
| Activity | 工具、检索、生成阶段和安全摘要 |
| State | session、Plan、Task 和 interrupt 共享状态 |
| Artifact | Plan、文案、图文、视频和发布包原位更新 |
| Interrupt | 需要用户或管理员决定的关键暂停 |

## 12.2 统一 envelope

```ts
type MeiyeAgentEvent = {
  eventId: string;
  threadId: string;
  runId: string;
  parentRunId?: string;
  sequence: number;
  occurredAt: string;
  source: 'agent_session' | 'dbos_harness' | 'billing' | 'rights' | 'publish';
  type: string;
  payload: unknown;
};
```

## 12.3 AG-UI 映射

| 内部事件 | AG-UI-compatible |
|---|---|
| narrative start/delta/end | `TEXT_MESSAGE_START/CONTENT/END` |
| tool start/args/result | `TOOL_CALL_START/ARGS/END/RESULT` |
| activity current state | `ACTIVITY_SNAPSHOT` |
| activity patch | `ACTIVITY_DELTA` |
| shared state full | `STATE_SNAPSHOT` |
| shared state patch | `STATE_DELTA` |
| critical decision | `RUN_FINISHED` with interrupt outcome |
| new run / resumed run | `RUN_STARTED` |
| terminal success/error | `RUN_FINISHED` / `RUN_ERROR` |

## 12.4 Activity 不进入 LLM 上下文

Activity 只用于前端过程呈现：

- 找到多少素材；
- 正在编译 Plan；
- 第几页生成中；
- 等待 provider；
- 正在做敏感词检查。

它不能反复回灌给 LLM，避免上下文膨胀和自我叙述污染。

## 12.5 Artifact stable ID

```ts
type ArtifactUpdate = {
  artifactId: string;
  artifactType: 'plan' | 'copy' | 'note' | 'image' | 'video' | 'publish';
  revision: number;
  status: 'skeleton' | 'partial' | 'ready' | 'failed';
  patch: unknown;
};
```

相同 `artifactId` 进行 reconciliation，而不是每次生成新卡片。

## 12.6 Interrupt 对接 DBOS

流程：

```text
DBOS QuestionCard / Approval Need
→ AgentEventProjector 先发 StateSnapshot + MessagesSnapshot
→ RUN_FINISHED(outcome=interrupt)
→ 用户提交 resume payload
→ 校验 interruptId / revision / schema / expiry
→ 写 StructuredDecisionInput
→ DBOS 恢复
→ 新 RUN_STARTED
```

DBOS 仍是 pending、timeout、hold、reservation release 和 resume 权威；AG-UI 只负责协议和呈现。

## 12.7 重连

客户端保存：

- `threadId`；
- `runId`；
- `lastEventId`；
- 最近 `STATE_SNAPSHOT` revision；
- Artifact revisions。

重连顺序：

1. 读取 `workbench_session_projection`；
2. 获取最新 StateSnapshot；
3. 从 `lastEventId` 回放 semantic events；
4. patch 失败时丢弃本地状态并重新取 snapshot；
5. pending interrupt 始终优先显示；
6. 不自动采用“最近一个任务”覆盖显式 `taskId`。

---

# 13. 前端实施

## 13.1 继续使用的技术栈

- React 19；
- TanStack Router；
- TanStack Query；
- AI SDK 7；
- HeroUI / shadcn 现有基元；
- Motion；
- Tiptap；
- react-resizable-panels；
- Vaul；
- Zod；
- Playwright；
- SSE。

## 13.2 不新增全局状态库

服务端投影为真相；前端只需要一个 event reducer/store 管理当前 thread：

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

可以用 React reducer + external store 小封装，不引入 Redux/Zustand 作为第二业务真相。

## 13.3 推荐目录

```text
src/product/agent-workbench/
  agent-workbench.tsx
  use-agent-thread.ts
  agent-event-reducer.ts
  agent-event-client.ts
  workbench-session-model.ts

  stream/
    narrative-line.tsx
    activity-line.tsx
    assumption-line.tsx
    inline-choice.tsx
    interrupt-line.tsx

  plan/
    living-plan.tsx
    plan-section.tsx
    plan-diff.tsx
    commit-strip.tsx

  artifact/
    artifact-canvas.tsx
    artifact-registry.tsx
    note-artifact.tsx
    video-artifact.tsx
    publish-artifact.tsx

  steering/
    steering-composer.tsx
    steering-impact.tsx

  interrupt/
    interrupt-renderer.tsx
    rights-interrupt.tsx
    cost-interrupt.tsx
    execution-interrupt.tsx
```

## 13.4 `ComposerHome` 迁移

目标：`ComposerHome` 只负责：

- route/search；
- query/mutation wiring；
- session restore；
- Agent Workbench layout；
- legacy bridge。

逐步移出：

- Intent UI；
- Plan UI；
- Activity；
- Artifact；
- Steering；
- Interrupt rendering；
- Agent event handling。

## 13.5 Controlled Surface Registry

模型只能请求客户端批准的语义组件：

```ts
const AGENT_SURFACE_REGISTRY = {
  narrative: NarrativeLine,
  activity: ActivityLine,
  assumption: AssumptionLine,
  inline_choice: InlineChoice,
  plan_section: PlanSection,
  plan_diff: PlanDiff,
  interrupt: InterruptRenderer,
  artifact_note: NoteArtifact,
  artifact_video: VideoArtifact,
  artifact_publish: PublishArtifact,
} as const;
```

模型不能传：

- 任意 className；
- URL；
- HTML；
- JavaScript；
- React component name；
- 业务 command；
- 未注册 action。

## 13.6 A2UI 使用边界

A2UI 只适合：

- 临时资质补充；
- 平台特定字段；
- 外部连接器的少量动态输入；
- 将来跨平台客户端。

核心 Living Plan、费用、权利、发布确认仍用本地类型化组件，不由 A2UI 动态生成。

---

# 14. Prompt、Skill、Tool 与 Harness Release

## 14.1 当前问题

当前 Prompt 注册表持续扩大，若每个任务解析和冻结全部站点，会导致：

- 无关 Prompt 故障阻塞当前任务；
- 运维 pin 成本扩大；
- 任务真实依赖不透明；
- 很难做按能力、按配方的发布和回滚。

## 14.2 Prompt Pack

继续保留单一 Prompt registry，但按任务选择 pack：

```ts
const HARNESS_PROMPT_PACKS = {
  agentControl: [
    'intentNaming',
    'factSatisfaction',
    'factCriticality',
    'destinationMapping',
  ],

  copy: [
    'briefCompilation',
    'copyCandidate',
    'copyGeneration',
    'platformAdaptation',
  ],

  note: [
    'xhsOutline',
    'xhsContent',
    'xhsImagePrompt',
    'notePlan',
    'noteTextBlock',
    'noteConsistency',
  ],

  cover: ['xhsCoverPrompt', 'xhsStyleAnalysis'],
  viral: ['xhsViralRewrite', 'xhsViralImageVision'],
  video: ['briefVideo', 'textResponse'],
} as const;
```

Resolver 调整为：

```ts
resolve(keys: readonly HarnessPromptKey[]): Promise<HarnessFrozenPrompts>
```

严格策略仍要求所选 pack 的 exact version 全部存在；不再让纯文案任务依赖未使用的 viral Prompt。

## 14.3 HarnessRelease

```ts
type HarnessRelease = {
  releaseId: string;
  version: number;
  status: 'draft' | 'evaluating' | 'canary' | 'production' | 'retired';

  agentSessionHarnessVersion: string;
  makeHarnessVersion: string;

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

  rollout: {
    percentage: number;
    workspaceAllowlist: string[];
    industryAllowlist: string[];
  };

  approvedBy: string | null;
  createdAt: string;
};
```

### 运行时纪律

- Langfuse label 只用于候选选择和发布；
- 发布 `HarnessRelease` 时解析为 exact Prompt versions；
- 运行时只读取 release 中冻结的 exact version；
- 任务、Plan、Trace 全部记录 releaseId；
- 回滚通过切回旧 release，而不是在任务中动态读取最新 Prompt。

## 14.4 Skill

Skill 继续：

- 按 stage 解析；
- 具备 revision 和 content hash；
- admission 冻结 manifest；
- 检查 required capabilities；
- 记录 invocation receipt；
- 不允许前端自由拼接隐藏 Skill instruction。

## 14.5 Tool

Tool policy 与 HarnessRelease 绑定，支持：

- allowlist；
- phase；
- max calls；
- timeout；
- approval；
- side effect；
- data classification；
- 版本化 schema。

---

# 15. Harness Control Plane 管理台

## 15.1 Releases

展示：

- Production / Canary / Draft；
- release diff；
- Prompt packs；
- Skill、Tool、Schema、Model Policy；
- rollout；
- 关联任务；
- 一键 rollback；
- 发布审批记录。

## 15.2 Prompt Packs

展示：

- Prompt key / name；
- exact version / hash；
- 所属 pack；
- 使用 stage；
- 调用量；
- 首次 schema 通过率；
- repair 率；
- fallback 率；
- 延迟和成本；
- 关联 eval。

## 15.3 Tool Policies

展示和管理：

- 工具说明；
- 参数 schema；
- side effect；
- approval；
- phase；
- data classes；
- timeout；
- 调用上限；
- 最近错误和拒绝原因。

## 15.4 Skills

展示：

- Skill revision；
- accepted / published / deployed；
- stage；
- capability requirement；
- content hash；
- invocation count；
- eval score；
- 退役影响。

## 15.5 Trace & Replay

过滤：

- workspace；
- thread；
- run；
- plan；
- task；
- work；
- release；
- Prompt version；
- model route；
- failure code。

支持：

- 只读时间线；
- StateSnapshot；
- tool calls；
- interrupts；
- Prompt/Skill lineage；
- 成本；
- 离线 replay；
- 与候选 release 比较。

## 15.6 Evals

管理：

- Dataset；
- Node eval；
- Journey replay；
- Prompt experiment；
- Model comparison；
- Redline；
- 用户反馈；
- Canary 指标。

---

# 16. 评估体系

## 16.1 L0：合同和确定性测试

- Zod schema；
- evidence refs；
- fact refs；
- rights refs；
- quote；
- revision；
- idempotency；
- interrupt resume；
- state patch；
- fallback；
- billing settlement。

## 16.2 L1：节点 Dataset

### Intent

指标：

- goal 分类；
- 检索域 precision / recall；
- 不必要追问率；
- 应问未问率；
- 高风险错误假设率。

### Plan

指标：

- 事实引用准确率；
- 未授权事实率；
- 交付物合理性；
- CTA 一致性；
- quote 一致性；
- Plan 稳定性；
- 局部调整是否只影响目标范围。

### Make

指标：

- 首次 schema 通过率；
- repair 率；
- 事实保持；
- 候选差异；
- 图文页一致性；
- steering 作用域；
- partial delivery 完整性。

## 16.3 L2：Journey Replay

对历史任务在隔离环境中替换：

- Prompt；
- 模型；
- Skill；
- Tool policy；
- Harness release。

比较新旧结果，不产生真实扣费和外部发布。

## 16.4 L3：Shadow

- Production 正常服务用户；
- Candidate 只计算 Intent/Plan/工具选择或内容候选；
- 不执行付费副作用；
- 比较 plan diff、风险、成本预测和输出；
- 不写生产 ContentPackage。

## 16.5 L4：Canary

- workspace allowlist；
- 行业 allowlist；
- 5% → 25% → 50% → 100%；
- 自动回滚门。

自动回滚条件：

- 权利或事实错误；
- billing mismatch；
- schema repair 激增；
- Plan 接受率下降；
- 用户追问增加；
- 延迟或成本超阈值；
- interrupt 恢复失败。

## 16.6 L5：真实经营验证

- Plan 接受率；
- Plan 修改次数；
- 首个可评估结果时间；
- 发布准备完成率；
- 实际发布率；
- 同类纠正下降；
- 咨询、预约、加微、团购和到店信号。

### 评价分工

| 内容 | 评价方式 |
|---|---|
| 事实、权利、费用、schema | 确定性代码 |
| 自然度、品牌感、吸引力 | 人工或 LLM Judge |
| 商家是否喜欢 | 用户行为 |
| 是否带来预约 | 可验证经营信号 |

LLM Judge 不能替代事实和授权验证。

---

# 17. Observability

## 17.1 Trace 树

```text
agent.thread
  └── agent.run
       ├── intent.interpret
       ├── context.retrieve
       │    ├── tool.store_facts
       │    ├── tool.assets
       │    └── tool.experience
       ├── ambiguity.resolve
       ├── plan.synthesize
       ├── plan.compile
       ├── interrupt.wait
       └── make.workflow
            ├── approved_plan.verify
            ├── context_rights.fence
            ├── content.generate
            ├── media.generate
            ├── quality.check
            ├── assembly
            └── publish.prepare
```

## 17.2 每个 span 记录

- threadId / runId / parentRunId；
- intentId / planId / planRevision；
- taskId / workId；
- harnessReleaseId；
- Prompt exact version / hash；
- Skill refs；
- Tool policy revision；
- model route revision；
- schema revision；
- token usage；
- observed cost；
- latency；
- repair；
- fallback；
- interrupt；
- terminal state。

## 17.3 不记录

- API Key；
- 未脱敏顾客资料；
- 原始敏感图片；
- 完整 Provider 私密响应；
- 原始 Chain of Thought。

---

# 18. 数据库与服务建议

## 18.1 新表/聚合

建议：

- `p1_agent_threads`；
- `p1_agent_runs`；
- `p1_agent_events`；
- `p1_intent_drafts`；
- `p1_marketing_plan_revisions`；
- `p1_plan_approval_receipts`；
- `p1_make_steering_commands`；
- `p1_publish_handoffs`；
- `p1_harness_releases`；
- `p1_harness_release_rollouts`。

是否物理独立建表可按现有聚合模式调整，但语义必须独立。

## 18.2 写入纪律

- Agent partial 不写 canonical Plan；
- Plan revision append-only；
- receipt immutable；
- steering command append-only；
- publish handoff 绑定 ContentPackage version；
- release immutable，rollout 单独变更；
- event 使用 per-thread monotonic sequence；
- snapshot 可重建，semantic event 不可静默删除。

---

# 19. 与当前仓库的迁移映射

## 19.1 保留并复用

| 当前组件/模块 | V2 用途 |
|---|---|
| `routes/dashboard/index.tsx` | 单工作台入口、深链恢复 |
| `composer-home.tsx` | 迁为薄宿主 |
| `workbench-shell-layout.tsx` | 双栏、Inspector、移动 Sheet |
| `workflow-core.ts` | Production Make Harness 主链 |
| `dbos-workflow.ts` | durable run、interrupt、settlement、恢复 |
| `task-admission.ts` | ApprovedPlan、route、prompt/skill、bounds 冻结 |
| `structured-nodes.ts` | 结构化节点与 deterministic fallback |
| `structured-node-runner.ts` | schema、repair、cost、provider fence |
| `langfuse-prompts.ts` | 单 registry，升级为 selective pack |
| `BriefSurface` | 迁入 Living Plan 的风险/证据区 |
| `ExecutionConfirmCard` | 迁为 Critical Interrupt renderer |
| `NoteObjectWorkspace` | Delivered 精修真相面 |
| `CopyImageTextWorksurface` | Tiptap、选区 AI、敏感词与版本修订 |

## 19.2 新增 Core

```text
apps/core/src/p1/agent-session/**
apps/core/src/p1/marketing-plan/**
apps/core/src/p1/harness/harness-release.ts
apps/core/src/p1/harness/prompt-packs.ts
apps/core/src/p1/harness/approved-plan-admission.ts
apps/core/src/p1/agent-events/**
```

## 19.3 新增 Web

```text
mkfast-template-main/src/product/agent-workbench/**
mkfast-template-main/src/product/harness-admin/**
```

## 19.4 Legacy 兼容

- 没有 ApprovedPlanSnapshot 的旧 durable task 继续走旧 replay；
- 新前台能投影旧 progress/token/question；
- 新任务默认双写 AgentEvent；
- 旧 confirmation 与 PlanApprovalReceipt 过渡期双写；
- 不自动迁移历史任务到新 layout；
- incompatible durable layout fail closed，并给运营清晰处置。

---

# 20. 分阶段实施路线

## Wave 0：合同、基线与影子事件

### 目标

建立不改变生产行为的新合同和观察面。

### 工作

- `AgentTurnInput`；
- `IntentHypothesis`；
- `AgentTurnDecision`；
- `MarketingPlanRevision`；
- `ApprovedPlanSnapshot`；
- `HarnessRelease`；
- `MeiyeAgentEvent`；
- 现有 progress/token/question → AgentEvent shadow projector；
- 当前漏斗和性能基线。

### 验收

- 同一现有任务能由 snapshot + events 重建前台状态；
- 影子事件不改变 Task、账单和 UI；
- sequence、replay 和跨 workflow 隔离通过。

## Wave 1：连续 Workstream 外壳

### 工作

- NarrativeLine；
- ActivityLine；
- Agent event reducer；
- 重连状态；
- 现有 turn 适配；
- 卡片减量；
- 移动过程/作品切换。

### 验收

- 现有创作行为零变化；
- Active 首屏只保留连续主流；
- 不显示空 Activity 或重复交付。

## Wave 2：Agent Session Harness / Intent

### 工作

- Agent Session Service；
- Intent interpreter；
- Retrieval tools；
- ambiguity policy；
- assumptions；
- question budget；
- 自由创作事实分层；
- proactive mode。

### 验收

- 无门店资料的自由创作可到达安全通用结果；
- 已有信息不重复询问；
- 每轮最多一个问题；
- 权利和事实高风险不被 LLM 默认。

## Wave 3：Living Plan

### 工作

- PlanProposal；
- deterministic Plan Compiler；
- Plan revision；
- Plan diff；
- Compact Plan；
- commit strip；
- 现有 Brief/quote/confirm 统一呈现。

### 验收

- 用户能在一个连续面理解目标、交付、事实、素材、费用和风险；
- 调整只生成新 revision；
- quote 和权利由确定性服务覆盖模型提案。

## Wave 4：PlanApprovalReceipt 与 ApprovedPlanSnapshot

### 工作

- receipt；
- snapshot hash；
- 旧 confirmation 双写；
- task admission 绑定；
- DBOS 运行前复验；
- stale / expiry；
- shadow hash 对账。

### 验收

- 用户看到的 Plan 与执行 Brief、deliverables、quote 一致；
- 重放不重复创建 Task 或扣费；
- stale receipt 拒绝；
- receipt 和旧 confirmation mismatch fail closed。

## Wave 5：Production Harness 消费冻结 Plan

### 工作

- `approved_plan_verification`；
- 旧 intent/brief 节点降为 validator；
- selective recompile；
- context fence 新语义；
- legacy replay 分支；
- 逐步关闭重复 LLM 调用。

### 验收

- 新任务不重新生成不同 Intent/Brief；
- 事实撤销、quote 变化和权利变化精确中断；
- legacy durable task 保持可恢复。

## Wave 6：Artifact 与 Steering

### 工作

- Artifact stable IDs；
- snapshot/delta；
- note skeleton；
- video scene progress；
- steering classifier；
- future patch / derived revision / replan；
- 影响范围反馈；
- partial delivery。

### 验收

- 中途指令只修改目标范围；
- 已完成内容不被静默覆盖；
- 数量、费用、事实和权利变化触发重核；
- 5/6 页成功可只恢复失败页。

## Wave 7：发布交接

### 工作

- Publish Artifact；
- 文案分块；
- 素材排序和 ZIP；
- 手机交接；
- capability 三态；
- 发布记录；
- 观察窗口。

### 验收

- Delivered 后五分钟内可完成手机交接；
- 未验证发布能力不显示为可直发；
- 发布留痕绑定 exact ContentPackage version。

## Wave 8：Prompt Pack 与 Harness Release

### 工作

- selective Prompt resolver；
- release schema；
- release publish；
- production/canary；
- rollout；
- rollback；
- exact trace linkage。

### 验收

- 纯文案任务不依赖无关 Prompt；
- 任一运行能还原 exact release；
- rollback 不需要改任务内 Prompt；
- release diff 可读。

## Wave 9：Evaluation Harness 与控制台

### 工作

- Dataset；
- experiments；
- replay；
- shadow；
- canary dashboard；
- release admin；
- tool/skill/prompt views；
- incident drill。

### 验收

- Candidate 不产生生产副作用；
- 自动回滚门可演练；
- 评估结果绑定 release；
- Prompt、Skill、Tool 和模型变化均可追踪。

## Wave 10：退役重复 UI 和旧执行分支

只有以下条件全部满足才退役：

- PlanApprovalReceipt 覆盖所有确认语义；
- 新任务完全消费 ApprovedPlanSnapshot；
- Interrupt、费用、权利、stale 和 refund 旅程全绿；
- 真实商家试点优于旧流程；
- rollback 已演练；
- legacy durable replay 有明确保留期限。

---

# 21. 推荐 PR / Issue 拆分

| 编号 | 内容 | 风险 |
|---|---|---|
| V2-01 | Agent/Plan/HarnessRelease contracts | 中 |
| V2-02 | AgentEvent shadow projector | 中 |
| V2-03 | Client reducer + replay | 中 |
| V2-04 | Narrative / Activity Workstream | 低 |
| V2-05 | Agent Session repository + service | 中 |
| V2-06 | Intent interpreter + ambiguity policy | 高 |
| V2-07 | Read-only tool registry | 中 |
| V2-08 | Living Plan compiler | 高 |
| V2-09 | Living Plan UI + diff | 中 |
| V2-10 | PlanApprovalReceipt 双写 | 高 |
| V2-11 | ApprovedPlan admission | 高 |
| V2-12 | Make Harness shadow comparison | 高 |
| V2-13 | Make Harness consume snapshot | 高 |
| V2-14 | Artifact protocol + registry | 中 |
| V2-15 | Steering service | 高 |
| V2-16 | Publish Handoff | 中 |
| V2-17 | Prompt packs | 中 |
| V2-18 | HarnessRelease + rollout | 高 |
| V2-19 | Evaluation Harness | 中 |
| V2-20 | Harness Admin | 中 |
| V2-21 | Legacy UI retirement | 高 |

禁止用单张“全面重做 Agent 工作台”大票承载全部变更。

---

# 22. 测试与验收矩阵

## 22.1 Contract

- 所有 LLM 输出 strict parse；
- unknown action 拒绝；
- evidence ref 越权拒绝；
- arbitrary UI/component 拒绝；
- Plan deterministic fields 不接受模型写入；
- receipt / snapshot hash；
- state patch；
- event sequence；
- resume idempotency；
- Prompt Pack exact pin；
- HarnessRelease immutable。

## 22.2 Core / PG / DBOS

- IntentDraft revision；
- Plan append-only；
- stale trigger；
- receipt 幂等；
- approved snapshot admission；
- DBOS suspend/resume；
- timeout、hold expiry、reservation release；
- semantic resubmission；
- bounded continuation；
- partial settlement；
- release rollout selection；
- legacy replay。

## 22.3 前端

- reducer replay；
- out-of-order event；
- duplicate event；
- patch mismatch snapshot recovery；
- Activity 不重复；
- Artifact stable ID；
- pending interrupt 优先；
- keyboard focus；
- reduced motion；
- mobile sheet；
- screen reader labels。

## 22.4 Playwright 主旅程

### A. Day-0 自由创作

- 无门店资料；
- 模糊输入；
- 不被 confirmed_store/project 阻断；
- 生成不带门店虚构事实的通用文案；
- 进入发布交接。

### B. 定制图文

- 先检索已有资料；
- 只问一个问题；
- Living Plan；
- Plan 调整；
- receipt；
- note 逐页生成；
- 单页重生；
- 发布交接。

### C. 视频付费执行

- Plan 显示时长、分镜、积分；
- Interrupt；
- 关闭标签页；
- 恢复；
- 部分失败；
- 字幕、封面和 assisted fallback。

### D. Plan stale

- 确认前价格 revision 变化；
- Plan 显示 diff；
- 旧确认不可提交；
- 重新确认后执行。

### E. 素材撤权

- Plan 形成后素材撤权；
- Make admission fail closed；
- 可换素材；
- 不重复扣费。

### F. Mid-run Steering

- 修改封面与第二页；
- 其他页面保持；
- 无费用变化直接应用；
- 增加页数进入 replan + requote。

### G. Interrupt resume

- pending interrupt 阻止普通新输入；
- duplicate resume 幂等；
- expired resume 拒绝；
- payload schema 不匹配可见错误。

### H. Harness Release

- workspace canary 命中候选 release；
- 非 canary 使用 production；
- rollback 后新任务回旧 release；
- 在途任务保留冻结 release。

---

# 23. 指标与 SLO

## 23.1 产品漏斗

```text
Intent submitted
→ first useful understanding
→ Plan ready
→ Plan confirmed
→ Make started
→ first usable artifact
→ Delivered
→ Publish handoff completed
→ Published recorded
→ Observed signal
```

## 23.2 建议目标

| 指标 | 试点目标 |
|---|---:|
| 首次可见 Agent 理解 | p75 < 1.5s |
| 首次 Activity | p75 < 1s |
| 普通 Intent → Plan | p75 < 8s |
| 每轮必要问题 | ≤1 |
| Plan 接受或小改后接受 | ≥70% |
| Plan 与执行 snapshot mismatch | 0 |
| schema repair | <10% |
| rights / billing 错误 | 0 |
| 重连恢复成功 | ≥99.5% |
| pending interrupt 丢失 | 0 |
| Artifact 重复对象率 | 0 |
| 交付到手机交接 | 中位 <5 分钟 |

## 23.3 Agent 主动性指标

- 自动检索覆盖率；
- 检索命中率；
- 避免重复提问率；
- 安全默认接受率；
- assumption 被纠正率；
- 高风险错误默认率；
- 工具调用无效率。

## 23.4 Harness 运行指标

- per-node latency；
- Prompt version success；
- first-pass schema validity；
- repair；
- fallback；
- cost；
- bounded suspension；
- interrupt timeout；
- resume；
- partial success；
- settlement compensation；
- release regression。

---

# 24. UI/UX 规则

## 24.1 减卡原则

只有下列情况使用有边界的面板：

- Critical Interrupt；
- Artifact；
- 事实/权利冲突；
- 对象工作区；
- 发布准备。

普通理解、进度、建议和假设优先使用文档行、轻量 chip 和内联编辑。

## 24.2 连续叙事

- Agent 行不使用聊天气泡；
- 用户输入可用短引用块；
- 工具过程折叠为 Activity；
- Living Plan 作为文档章节；
- 已完成阶段可折叠但可追溯；
- 不重复粘贴完整候选正文。

## 24.3 AI 不确定性

必须区分：

- `我先按……处理`：安全假设；
- `需要你确认`：高影响歧义；
- `当前不能继续`：硬门；
- `当前只是草稿`：partial；
- `已经确认`：冻结 Plan；
- `已经执行`：不可静默覆盖。

## 24.4 无障碍

- WCAG 2.1 AA；
- 状态不只靠颜色；
- 每个 Activity 有可读文本；
- 流式更新使用适度 `aria-live`，避免每 token 宣读；
- Interrupt 自动聚焦标题；
- 关闭 Sheet 后焦点回来源；
- 所有动效支持 reduced motion；
- 键盘可完成 Plan、Interrupt 和发布交接。

---

# 25. 安全与合规

## 25.1 输入安全

- 商家文本始终视为不可信数据；
- 工具输出按 schema 校验；
- 检索结果带 workspace 和 rights scope；
- Prompt injection 不能改变工具 policy；
- 外部链接和抓取严格使用已批准双轨；
- LLM 不读取 secret。

## 25.2 输出安全

- 事实 refs 反向验证；
- rights refs 反向验证；
- quote 和能力确定性覆盖；
- arbitrary action 拒绝；
- 发布前重新扫描；
- 高风险内容进入确认或阻断；
- 生成阶段软提示与发布硬门分层。

## 25.3 经验

- 纠正不自动变长期经验；
- 只生成候选；
- 用户选择“以后都这样”后写入；
- 显示来源和适用范围；
- 支持撤销；
- stale/foreign experience 拒绝。

---

# 26. 回滚与事故处置

## 26.1 代码回滚

- 每 Wave 独立 feature flag；
- Agent Workbench 可以退回旧 Composer renderer；
- AgentEvent 双写可停读不停写；
- ApprovedPlan 新路径可按 workspace 关闭；
- legacy Make Harness 保留到 V2 全量稳定后。

## 26.2 Release 回滚

- 在途任务保持冻结 release；
- 新任务切回前一 production release；
- Prompt label 回滚不能改变已冻结 task；
- canary 自动暂停；
- 记录 rollback reason 和 evidence。

## 26.3 数据处置

- Intent / Plan / receipt append-only；
- 不删除事件以伪造恢复；
- layout 不兼容时 fail closed；
- 必要时只取消未执行任务并退还积分；
- 不自动重放外部写操作。

---

# 27. 发布前绝对门

以下任一未满足，不全量上线：

1. 用户可见 Plan 与实际执行 snapshot exact 一致；
2. LLM 无法绕过事实、权利、费用和权限；
3. pending interrupt 在刷新和重连后不丢失；
4. duplicate resume、duplicate event 和 duplicate submit 幂等；
5. 新流程对 Day-0 自由创作可达；
6. 中途 steering 不静默改变费用、事实和其他页面；
7. partial output 不写 canonical state；
8. Prompt、Skill、Tool、Schema 和 Model Policy 均可定位 exact release；
9. Candidate shadow 和 replay 不产生生产副作用；
10. rollback 演练通过；
11. live / fixture / recorded 状态严格区分；
12. 真实门店试点证明提问和完成时间不劣于旧流程；
13. 不显示原始 Chain of Thought；
14. 无障碍、移动端和 reduced motion 通过。

---

# 28. 最终实施顺序建议

最稳妥顺序：

```text
先统一事件和投影
→ 再替换前台呈现
→ 再引入 Agent Session Harness
→ 再形成 Living Plan
→ 再冻结 ApprovedPlanSnapshot
→ 再让 Production Harness 消费冻结 Plan
→ 再做 Steering 和 Publish Handoff
→ 最后建设 Harness Release / Eval / Admin 并退役旧 UI
```

不要先把 LLM 改得更自主，再补权限和执行边界；也不要先大改 Production Harness，再验证新的前台体验是否真正降低商家认知成本。

最终体验应收敛为：

> **我只说经营目标；Agent 主动把已有信息找齐并告诉我它怎么理解；我确认一次真实、可执行的方案；系统按同一方案完成制作；我随时可以纠偏；最后顺利发布。**

---

# 29. 参考依据

## 仓库实施基线

- `PRODUCT.md`
- `DESIGN.md`
- `docs/specs/xhs-vertical-integration-spec-2026-08-01.md`
- `apps/core/src/p1/harness/workflow-core.ts`
- `apps/core/src/p1/harness/dbos-workflow.ts`
- `apps/core/src/p1/harness/task-admission.ts`
- `apps/core/src/p1/harness/structured-nodes.ts`
- `apps/core/src/p1/harness/langfuse-prompts.ts`
- `apps/core/src/p1/model-supply/structured-node-runner.ts`
- `mkfast-template-main/src/product/composer/composer-home.tsx`
- `mkfast-template-main/src/product/composer/workbench-shell-layout.tsx`
- `mkfast-template-main/src/product/object-workspace/**`

## 外部模式参考

- AG-UI：events、state、interrupt、serialization；
- Vercel AI SDK：structured output、tool loop control、streaming data；
- A2UI：declarative catalog 和 progressive rendering；
- Langfuse：Prompt version/label、trace linkage、datasets、experiments、eval；
- assistant-ui / CopilotKit：Tool UI、Interactable、Shared State 和 HITL 模式。

