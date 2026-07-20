# 可用组件与本项目适配矩阵

- 日期：2026-07-17
- 目标：优先复用成熟组件，但不因“组件存在”而引入第二套消息、工作流、记忆或业务真相
- 结论：保留现有 AI SDK + PostgreSQL + pg-boss + 领域工作台，新增 HITL 领域层；外部组件只在明确缺口上做隔离验证

> ⚠️ **2026-07-17 深夜更新横幅**：本矩阵三项处置结论已被 D-034~D-038 取代/升级——①「pg-boss 继续作为业务工作流主底座」「推荐落地顺序 P0：不引入新 runtime」→ D-034：五段式 durable 载体主选 DBOS Transact（PoC 六题定案制），pg-boss 收窄为存量队列；②「Langfuse 做隔离评测验证」「P1 再做试验」→ D-036：Langfuse 自托管转正（trace/回放/实验/prompt 版本，合规留痕双写自建 PG 审计表）+ promptfoo 七红线 CI 门 + 纯 Vitest 跑 BeautyPreferenceMemoryEval；③「2–3 个主观候选」演进方向受 D-023 限定（默认一个主推荐，备选按需展开）。矩阵内组件事实、许可边界与「采用门禁」七问仍可引用；最新选型证据见 `../harness-research-2026-07-17/`。权威：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`。

## 选型原则

1. 组件是否解决当前真实缺口，而不是重复已有能力。
2. 谁保存最终业务真相，是否会形成双写或跨运行时一致性问题。
3. 是否支持精确作用域、版本、来源、撤回、过期和一次性消费。
4. 是否适配 TypeScript、现有 Cloudflare BFF 与 Node Core 边界。
5. 许可证、托管锁定、维护活跃度和自托管成本。
6. 前端是否能保持领域化产品界面，而不是退回通用聊天壳。

## 现有工程可复用基础

| 能力 | 当前证据 | 判断 |
| --- | --- | --- |
| AI 结构化提案 | `apps/core/package.json` 已使用 AI SDK；`ai-sdk-runner.ts` 存在只提议、不自动应用的字段 patch | 直接扩展为决策/偏好/影响预览工具 |
| 不可变上下文基础 | `CreativeGroundingSnapshot`、ContentPackage 来源引用和版本 | 升格为 ContextBundle 内核，不建平行体系 |
| 2–3 个主观候选 | 文案固定生成 3 个候选；现有 A/B/C 选择和幂等采用 | 直接演进为主观选择卡 |
| 人工暂停与恢复 | 视频工作流已有 `awaiting_quality_review`、revision fencing、人工选择后恢复 | 抽取通用 `waiting_for_human` 模式 |
| 异步和幂等 | pg-boss 已覆盖 deferred、租约、重试/DLQ、取消和确定性 Job ID | 继续作为业务工作流主底座 |
| 就地修改与版本 | CreativeBrief adopt/edit/revert、ContentPackage 派生与回滚 | 增加 diff、scope、服务端 undo，不重做版本系统 |
| 高风险批准 | 抖音批准绑定账号、内容 snapshot revision 和时间；飞书确认绑定不可变 argument hash | 提炼通用 ApprovalRequest/Receipt |
| 任务流插槽 | Operations 持久任务和 `renderInline` | 插入事实、记忆和批准卡 |
| 视觉资产版本 | OfficialTemplate/TemplateVersion、CanvasRevision | 继续承载布局；补固定项、变量槽、场景和权利 |

当前首个产品断点也很明确：`creation-assistant.tsx` 的接受/编辑/忽略仍是 local-only，用户点“接受”并未真正修改 Work。这应先闭环，而不是先换框架。

## 前端与 Agent UI

| 方案 | 可复用能力 | 主要代价 | 维护/许可 | 本项目结论 |
| --- | --- | --- | --- | --- |
| 现有 AI SDK 7 + 领域组件 | typed message/tool/data parts、审批响应、流式状态；已在项目中 | 领域卡片需要自己实现 | 已采用，版本随项目锁定 | **P0 主方案** |
| 现有 Base UI/shadcn + Sonner + Drawer | 可访问原语、toast action、作用域 chips、移动抽屉 | 不提供 HITL 语义 | 已采用 | **P0 主方案** |
| assistant-ui | Tool UI、`human()/resume()`、approval options、host-owned persistence、版本交互 | 会带来第二套线程/消息/组件状态；资产与作用域仍自建 | MIT；采用前再核验锁版 | **P1 借鉴或隔离试验，不整体接入** |
| AG-UI | interrupt、approve-with-edits、snapshot/delta、capability 协议 | 是协议，不是产品 UI；与 AI SDK `UIMessage` 重复 | 开放协议，生态仍变化 | **保留未来映射能力** |
| CopilotKit | HITL Hook、生成式组件、AG-UI 状态 | React Core、Runtime、Inspector 和遥测形成整套运行时 | 活跃，依赖较重 | **暂不引入** |
| OpenAI ChatKit | 完整聊天壳、线程、附件、Widget/Form actions | 托管 UI/iframe 与 Python 服务边界不匹配领域工作台 | 许可口径采用前需复核 | **不用于核心创作产品** |
| OpenAI Agents SDK JS | 工具 `needsApproval`、interruptions、可序列化 RunState | 不提供耐久调度、超时、业务幂等；会叠加 Agent runtime | MIT，0.x 快速变化 | **只借鉴模型，不替换现有 runtime** |
| HumanLayer | 邮件/Slack 等外部异步审批模式 | 原 SDK 已转 legacy，非当前产品内交互 | 当前定位已变化 | **不进入核心链路** |

### 应自建的领域组件

组件视觉层复用现有原语，领域语义与状态由本项目持有：

1. `ContextSummaryChips`
   - 显示本次使用的门店、服务、Offer、IP、场景、平台和授权素材。
   - 默认折叠，不要求确认。

2. `SubjectiveChoiceCard`
   - 基于现有 `copy-candidate-selector`。
   - 2–3 个完整候选，差异轴用经营语言。

3. `InlineCorrectionBar`
   - 自然语言、动态快捷动作和直接编辑。
   - 默认“仅这版”，显示字段级或画面级 diff。

4. `FactConflictCard`
   - 旧值、新值、来源、生效时间和影响范围。
   - 只提交事实修订，不写偏好。

5. `MemoryProposalCard`
   - 证据次数、归纳规则、推荐作用域。
   - “记住 / 仅这次 / 调整范围”。

6. `AssetPromotionCard`
   - 固定骨架、变量槽、禁继承项、来源、权利、适用场景和回放预览。

7. `IrreversibleApprovalCard`
   - 内容 revision、平台、账号、时间、费用、用途、素材权利和过期时间。
   - 任何关键字段变化后自动失效。

8. `UndoAction`
   - 可用 Sonner action 呈现，但必须调用服务端修订命令。
   - 不能对发布或扣费提供“假撤销”。

9. `NeedsDecisionTask`
   - 异步任务中心新增明确的 `needs_decision`，与故障 `recoverable` 分开。

10. `MobilePublishHandoff`
    - 精确预览、目标账号、一次性授权、打开原生平台或唤醒正确手机。

## 工作流与耐久执行

| 方案 | 暂停/恢复 | 持久状态 | 精确批准绑定 | TS/Cloudflare 适配 | 许可/部署 | 本项目结论 |
| --- | --- | --- | --- | --- | --- | --- |
| PostgreSQL + pg-boss | 需抽象 wait 状态 | 强，且与业务事务同源 | 现有代码已实现 snapshot/hash | Node TS 主底座，CF 经 API | 自托管；pg-boss MIT | **P0 主方案** |
| Temporal | Signal/Update/condition、durable timer | 很强 | Update validator + 业务校验 | TS Worker 需要正式 Node runtime，不适合 CF Worker | Server/SDK MIT；另有 Cloud | **真实瓶颈出现后的升级路径** |
| Inngest | `waitForEvent`、timeout | SaaS 强 | 仍需 DB 版本校验 | TS/CF 友好 | SaaS；Server 许可与自托管成本需评估 | **若必须托管试点，候选第一** |
| Trigger.dev | waitpoint token、timeout | Cloud 强；自托管能力有差异 | token 不等于已认证 Owner | TS，但任务跑在其 Worker | Apache-2.0 核心/Cloud | **不采用当前主链路** |
| Cloudflare Workflows | `waitForEvent`、最长周期等待 | CF 托管 | 仍需业务 action hash | CF 原生 | 托管、无自托管运行时 | **Core 整体迁往 CF 时再评估** |
| LangGraph JS | interrupt/checkpoint/time travel | 依赖 checkpointer | thread/checkpoint 不等于业务版本 | TS 可用，非业务耐久底座 | MIT 库，平台另计 | **可做推理图，不做批准真相** |
| Mastra | suspend/resume、snapshot、Studio | 可接多种 storage | 业务绑定仍自建 | TS 友好 | Core 与企业能力需分辨 | **会重复 AI SDK/工作流层** |
| OpenAI Agents SDK | tool interruption、RunState | 应用自行保存 | 到 tool call，业务版本仍自建 | TS 可用 | MIT | **只放在业务工作流内部** |

### 为什么当前不换工作流引擎

现有抖音发布链已经具备正确但分散的业务语义：账号、内容快照版本、锚点、发布时间进入确认哈希，执行前重新检测关键字段是否变化。飞书高风险操作也已有持久任务、去重键和不可变意图确认。

新的通用引擎不会自动补齐这些业务规则，反而会把运行状态拆到第二套系统。当前应把点状实现上收为：

```text
ApprovalRequest
→ permission/revision/expiry/state CAS
→ ApprovalReceipt
→ deterministic continuation job
→ effect claim + reconcile
```

外部编排器若未来引入，必须经事务 outbox 发送事件，PostgreSQL 仍保存最终 Receipt。

## 记忆、检索与事实治理

| 组件 | 最适合承担 | 不能承担 | 许可/边界 | 本项目结论 |
| --- | --- | --- | --- | --- |
| PostgreSQL + JSONB/关系表 | 事实版本、DecisionEvent、偏好投影、资产、批准凭证 | 不能跳过领域校验 | PostgreSQL License | **立即采用，唯一权威** |
| pgvector | 合法作用域内的语义召回和混合检索 | 不决定事实、作用域和授权 | PostgreSQL License | **候选量大时再加** |
| LangMem | 从对话/edit delta 抽取结构化候选 | 不直接写 Preference 或事实 | MIT；偏 Python | **与 Mem0 二选一 spike** |
| Mem0 OSS | 语义记忆 CRUD/history、托管或自建检索 | 不能静默 auto-capture；平台能力不等于 OSS | Apache-2.0；Platform 专有边界 | **与 LangMem 二选一 spike** |
| Graphiti | 时序关系和多实体 provenance | 抽取 edge 不等于事实真实 | Apache-2.0；需要图数据库 | **二期有真实多跳需求再评估** |
| Zep | Graphiti 托管治理 | 不能按 Graphiti OSS 许可理解 | Cloud/BYOC 商业产品 | **暂不采用** |
| Letta | 长生命周期 Agent 与 memory block | 不适合共享事实库；Agent 可写、并发有覆盖风险 | Apache-2.0 | **除非替换整个 runtime** |

### 明确排除 Emmett

Emmett 的 TypeScript/Postgres event-sourcing 方向表面契合，但官方仓库明确当前没有许可证。没有许可证不等于可以商用复用，因此从候选中剔除。

### 不做全量 Event Sourcing

当前采用：

- 普通领域表保存当前状态；
- append-only ledger 保存关键决定、来源和补偿事件；
- 同一事务更新事件与 read model；
- `UNIQUE(stream_id, stream_version)` 做乐观并发；
- undo 追加 `DecisionReverted`，偏好变化追加 `PreferenceSuperseded`。

只有未来确实需要从事件重建全部领域对象，才评估完整 Event Sourcing/CQRS。

## 可观测与评测

| 组件 | 用途 | 不能承担 | 许可/边界 | 建议 |
| --- | --- | --- | --- | --- |
| OpenTelemetry | 上下文编译、检索、模型、工作流和外部动作 trace 标准 | 不是业务审计账本 | Apache-2.0；后端另选 | **采用标准** |
| Langfuse | Trace、Dataset、Experiment、Score、人工标注和回归 | 不保存 DecisionEvent/ApprovalReceipt | MIT Core；EE 目录商业许可 | **做隔离评测验证** |
| 自建 `BeautyPreferenceMemoryEval` | 作用域、false promotion、事实污染、撤回、跨店泄漏 | 不替代运行期观测 | 项目内部 | **P0 必须建立** |

确定性的 scope、状态、过期、来源和版本用代码 grader；只有“两个表达是否同一语义”才使用 LLM judge，并用人工样本校准。

## 许可与托管边界

采用前必须区分“开源核心”和“托管/企业能力”：

- Langfuse 核心 MIT，但 `ee/`、`web/src/ee/`、`worker/src/ee/` 等目录是商业许可。
- Mem0 OSS 是 Apache-2.0；Memory Decay、部分时序推理和托管能力属于 Platform 边界。
- Graphiti 是 Apache-2.0；Zep Cloud/BYOC 是商业产品，不能混为一谈。
- Letta Server 可自托管，但模型、embedding、Postgres、认证和 sandbox 仍由使用方负责。
- Cloudflare Workflows 是托管运行时，不存在等价的本地自托管底座。
- Inngest、Trigger.dev 的 Cloud 与 self-hosted 能力不完全对等，不能只按 SDK 许可证判断锁定成本。

## 推荐落地顺序

### P0：不引入新 runtime

1. 闭环 `creation-assistant` 的服务端应用、diff 和 undo。
2. 增加 `DecisionEvent / PreferenceCandidate / ReusableAssetCandidate / ApprovalReceipt` 领域合同和持久化。
3. 抽取视频工作流的 pause/select/resume 为通用 `waiting_for_human`。
4. 抽取抖音和飞书的版本绑定批准为通用 Approval 领域。
5. 把异步任务中心的 `recoverable` 拆成 `needs_decision` 和真实故障。
6. 用现有 AI SDK + UI 原语实现十个领域组件。
7. 建立 OTel trace 与领域 golden dataset，偏好先运行 shadow mode。

### P1：小范围验证

1. assistant-ui Tool UI 模式的隔离原型，只评估能否减少自建状态代码。
2. Langfuse Core 或 Cloud 的 trace/eval 试验，明确数据保留和隐私边界。
3. 候选量足够大后加 pgvector。
4. LangMem 与 Mem0 只选一个做候选抽取 spike，比较 precision、scope accuracy 和 false promotion。

### P2：满足触发条件才引入

- Temporal：跨服务补偿、跨月等待、工作流升级和复杂并发已经成为被测瓶颈。
- Cloudflare Workflows：Node Core 的业务工作流整体迁到 Cloudflare，而不是只迁一个 HITL 节点。
- AG-UI：出现第二种 Agent runtime、第二客户端或跨语言前端协议需求。
- Graphiti：确有大量 IP × 场景 × 平台 × 资产的多跳、时序关系查询。

## 采用门禁

任何新组件进入主链路前必须回答：

1. 它替换哪一段现有代码，而不是叠加在哪一层？
2. 最终业务真相仍在哪里？
3. 网络分区或重复事件时如何与 PostgreSQL 对账？
4. 是否支持作用域、版本、过期、撤回和数据删除？
5. Cloud 与 OSS 能力是否等价？许可证是否覆盖生产使用？
6. 包升级后，等待中的工作流和审批如何恢复或过期？
7. 用户界面是否因此增加消息壳、线程壳、参数或表单？如果是，收益是否足以抵消？

来源与官方链接见 [`SOURCE-REGISTER.md`](./SOURCE-REGISTER.md)。
