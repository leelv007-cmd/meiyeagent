# Harness 五段式实现 — 开源对标候选清单（待筛选）

- 日期：2026-07-17
- 状态：**已完结并拍板（2026-07-17 深夜）**。产出：01-10 候选报告（各文件头有 Codex 交叉验证裁定横幅）+ `xcheck/` 对抗验证（r01–r07、r09–r10 共 9 份交付；r08 三次容量失败未产出，见 08 号报告头部横幅与 D-037 证据边界）+ 11 号决策简报；用户全案采纳主推荐，**转正为 D-034~D-038**（权威见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`）。源码镜像统一在 `references/repos/harness-2026-07-17/`（depth-1，已 gitignore）。
- 上游依据：D-032（编排总纲：三层架构、确定性主干、栈不换只调优先级）、D-033（Task + Harness 五段式）、决策 B（AI SDK 起步、零 agent 框架、Mastra 推迟 Port 预留）、[[feedback_mature_components_over_inhouse_framework]]（自写抽象须 ADR 证明成熟方案不可用）。

## 0. 边界：本轮不重开什么

- **不重开编排骨架选型之争**：对话层 = AI SDK token 流式，能力层 = 可替换 provider，均已锁。本轮对标是给编排层五段式找「补件」，不是换骨架。
- **不引入 agent 框架**：五段式 = 确定性主干 + 两个 LLM 节点（①③）+ 一个 N→1 节点（④），不需要 autonomous agent loop。Mastra workflow 原语只作范式参考（Port 预留仍在）。
- **七条硬红线门禁不找框架**：价格/版本/来源/串线等门禁本质是确定性校验，自己写 + 回归测试覆盖即可。Guardrails-AI / NeMo Guardrails 属过度工程，预先排除。
- **模型路由不找框架**：择优段的多模型调用走 AI SDK provider registry 薄封装即可（火山/Seedance 直调已定）。LiteLLM/OpenRouter 网关预先排除（部署主体与合规都不合）。

## 1. 五段式 → 四个真实工程问题

| Harness 段 | 性质 | 悬而未决的工程问题 |
|---|---|---|
| ①意图正名 | LLM | **问题 B**：结构化输出的稳定性（schema 命中率、重试、降级） |
| ②上下文注入 | 确定性 | **问题 C**：三池（行业/门店/信号）的存取与 Stage-2 偏好沉淀 |
| ③Brief 编译 | LLM | **问题 B**（同上）+ Brief 质量的可优化性 |
| ④执行与择优 | 确定性+LLM | **问题 D**：N→1 择优的评估器、门禁回归、路由记录 |
| ⑤回装与交付 | 确定性 | （已解：ContentPackage revision，无新问题） |
| 贯穿：耐久性 | 基建 | **问题 A**：长任务可恢复、durable 等待、revision fencing 的执行载体 |
| 贯穿：可审计 | 基建 | **问题 D**：DecisionTrace 的落库与查看 |

## 2. 问题 A — 耐久编排载体（本轮最重决策）

现状：pg-boss 是**队列**，不是 durable workflow——没有 step 级 checkpoint、没有 crash 后从断点恢复、`waitForEvent` 式挂起要自己拿状态机模拟。五段式要的「任务独立可恢复 + 等待即挂起 + revision fencing」正卡在这个缺口上。真正的调研题：**pg-boss 之上自建五段耐久性，还是引入 durable execution 组件**。

| # | 候选 | 一句话 | 主要吸引力 | 主要顾虑 |
|---|---|---|---|---|
| A1 | **DBOS Transact (TS)** | Postgres 原生 durable execution **库**，无独立服务 | 与「只有 PG」的栈零新增基建，workflow/step checkpoint 全存自己的 PG；最贴 D-032「栈不换」 | 社区较年轻；与 pg-boss 职责重叠需理清（可能直接替掉 pg-boss） |
| A2 | **Inngest** | 事件驱动 durable functions，TS 一等公民 | `step.run`/`step.waitForEvent`/`step.sleep` 与五段式挂起语义一一对应；自托管 dev server 开源 | 多一个常驻服务；自托管版与云版能力差距需实测 |
| A3 | **Trigger.dev** | 开源长任务运行时，v4 | 无超时长任务 + **Realtime 进度流直达前端**（天然匹配三进三出的「白话进度事件」） | 需部署其 worker 运行时，基建最重的开源选项；自托管成熟度需实测 |
| A4 | **Cloudflare Workflows** | Workers 原生 durable execution，`step.do`/`step.sleep`/`step.waitForEvent` | 验证期本就部署 CF「Workers 壳」，零新增服务即得挂起语义；与现有 Hyperdrive→PG 通路同面 | 专有运行时不可自托管 → 中国化迁移时该层整体重写，「平移便宜」维度先天硬伤；step 数/CPU/时长限额需核实 |
| A5 | Temporal | durable execution 金标准 | replay/determinism 范式最完整，读它能校准候选的完备度 | 集群太重，不符合单体阶段 → **只作范式参考，不候选采用** |
| A6 | Restate / Hatchet | 单二进制 durable runtime / PG-backed 编排 | 备查项，若 A1-A4 均有硬伤再启 | 社区规模与 TS 生态均弱于前排候选 |

**建议深调**：A1 + A2 + A3 + A4 四选一（A5 作范式阅读，A6 备查）。我的倾向排序 A1 > A2 > A3；A4 是「验证期最顺、迁移面最差」的特殊项，须拿限额与逃逸成本数据后再定。

## 2b. Cloudflare 面（2026-07-17 用户补充）：可复用 vs 参考

验证期部署本就在 CF（Workers 壳 + 单 Node 服务 + Hyperdrive→托管 PG），CF 自家件按三栏定位，随问题 A 一并深调核实：

| 件 | 初步定位（待核实） |
|---|---|
| **Cloudflare Workflows** | 问题 A 正式候选（A4），durable execution 原生挂起语义 |
| **Agents SDK（npm `agents` 包）** | 对话层**范式参考不采用**（D-032 锁 AI SDK）：读其 Durable Objects 状态同步、WebSocket 流、挂起/恢复设计 |
| **AI Gateway** | 能力层薄路由 + 模型调用日志的**可复用件候选**：缓存/重试/fallback/日志开箱；与 DecisionTrace 的分工及迁移面待评 |
| **Queues / Durable Objects** | 与 pg-boss 职责重叠度对照；DO 是 Workflows/Agents SDK 的底层原语，读作范式 |

## 3. 问题 B — LLM 段的结构化可靠性（①意图正名、③Brief 编译）

现状：AI SDK `generateObject`/`streamObject` 是 baseline，已够跑。调研题：schema 复杂化（Brief 六维）后命中率与重试成本是否需要专用层。

| # | 候选 | 一句话 | 主要吸引力 | 主要顾虑 |
|---|---|---|---|---|
| B1 | **AI SDK generateObject**（栈内） | baseline，不引新件 | 零成本；与流式对话层同一 SDK | 复杂 schema 命中率与错误修复策略偏薄 |
| B2 | **BAML** | schema-first LLM 函数 DSL + Schema-Aligned Parsing | 宽容解析显著提升结构化命中率；测试面板利于 Brief 迭代 | 新 DSL + codegen 一层学习/构建成本；与 AI SDK 并存的边界要划清 |
| B3 | DSPy | Brief 编译 = 可优化程序（signature + optimizer） | 「③Brief 编译」的理论原型，值得读 | Python、重范式 → **只作范式参考，不候选采用** |

**建议**：B1 起步实测，B2 深调一轮拿数据（命中率对比），B3 范式阅读。

## 4. 问题 C — 三池上下文与偏好沉淀（②上下文注入）

现状：②段本身是确定性组装（六维 ContextBundle，immutable），**主体是自己的代码 + PG 表，不需要框架**。框架相关的是 Stage-2 偏好学习（BeautyPreferenceMemoryEval 已定为发布门），属**缓建**。

| # | 候选 | 一句话 | 定位 |
|---|---|---|---|
| C1 | **Letta (MemGPT)** | memory blocks + 记忆状态可直接查看 | HITL 调研已引用其「记忆可检视」范式，对齐误学检测口径 |
| C2 | **Mem0** | 抽取-合并-检索记忆层 | 偏好沉淀管线的对标 |
| C3 | Zep / Graphiti | 时序知识图谱记忆 | 备查，重于当前需求 |

**建议**：本轮**不深调**，只保留 C1 薄读（已有 HITL 材料），待 Stage-2 门临近再开专题。列在此处防丢。

## 5. 问题 D — 择优、评估门与审计（④择优 + DecisionTrace + eval 门）

调研题：④段 N→1 的评估器怎么写、七红线回归和 BeautyPreferenceMemoryEval 挂在什么 harness 上、DecisionTrace 用什么落库查看。

| # | 候选 | 一句话 | 主要吸引力 | 主要顾虑 |
|---|---|---|---|---|
| D1 | **Langfuse** | 开源自托管 LLM tracing + datasets + LLM-as-judge | 一件事解决 DecisionTrace 落库/查看 + 运行审计 + eval 数据集；自托管合部署主体要求 | 自托管运维面（ClickHouse 依赖版本需核实）；trace 模型与我们 Task/五段结构的映射要设计 |
| D2 | **promptfoo** | 声明式 eval harness，CI 门 | 七红线回归 + BeautyPreferenceMemoryEval 直接可挂 CI；TS 生态 | 声明式 YAML 对复杂择优逻辑的表达力上限 |
| D3 | evalite | Vitest 风格 TS eval | 与栈最亲和的轻选项，可替代 D2 | 项目年轻，功能面窄 |
| D4 | Arize Phoenix / DeepEval | 观测/评估备选 | 备查 | Python 重心，栈不亲和 |

**建议深调**：D1 + D2（D3 作 D2 的对照项一并看，D4 备查）。

## 5b. 问题 E — 可视化编排与非代码维护面（2026-07-17 用户补充）

前提（用户给定）：Harness 骨架一旦定下不常变；**常变的是提示词、模型/择优参数、④段内部策略顺序**；后台会有非代码人员操作；维护简易性是选型标准之一。

三条根本路线（张力先摆明）：
- **路线一：可视化 LLM 工作流平台当编排运行时**（Dify/Coze Studio/Flowise 类）——非代码人员全可视改，但它接管编排层，与 D-032 确定性主干冲突风险高；durable 挂起/revision fencing/红线门禁/审计难安放。
- **路线二：骨架留代码，常变层数据化外置**——提示词进 prompt management（UI 编辑+版本+回滚+发布标签，非代码人员可用；Langfuse 自带，已并入 05 号调研）；参数/顺序进配置表 + 后台管理页；可视化只做只读 DAG 展示（React Flow 类组件）。
- **混合路线（挑战者）：主干在代码/durable 载体，③④等 LLM 密集节点外挂成「Dify/Coze 子工作流 API」**，画布归运营。真实可行性（时延/流式/版本耦合/审计通路）待实证。

| # | 候选 | 一句话 | 定位疑点 |
|---|---|---|---|
| E1 | **Dify** | 自托管可视化 LLM 工作流平台（中国生态最热） | 当运行时 vs 当③④子流引擎 vs 纯范式参考；许可附加条款；durable/审计短板 |
| E2 | ~~Coze Studio（扣子开源版）~~ | 字节开源，工作流画布 | **用户排除（2026-07-17）：明显不符合要求，停止调研** |
| E3 | Flowise / Langflow | 轻量 LLM flow builder | 成熟度/安全记录，快评即可 |
| E4 | n8n | 通用自动化 + AI 节点 | fair-code 许可对商业 SaaS 内嵌 vs 内部运营用的边界 |
| E5 | Windmill | 代码工作流 + 自动生成 UI | 「代码优先+可视化壳」混合范式参考 |
| E6 | React Flow (xyflow) + prompt management | 自建路线两块积木 | 自建只读 DAG + 配置后台的工作量级 |
| E7 | **Mastra Studio** | Mastra（TS agent 框架，决策 B「Port 预留」对象）自带可视化工作台：workflow 图、run/trace、playground | 用户点名核查（2026-07-17）：能否当非代码可变层控制台；是否 dev-only；采用 Studio 是否意味着编排层改跑 Mastra workflow（**牵动问题 A**） |

**建议**：按「路线二为默认、混合路线为挑战者」设问调研；结论并入最终对比决策简报，新增第四决策题「非代码可变层怎么承载」。

## 6. 建议的深调组合（供筛选）

| 优先 | 对象 | 回答什么 |
|---|---|---|
| ① | **DBOS vs Inngest vs Trigger.dev vs Cloudflare Workflows**（+Temporal 范式阅读） | 五段式跑在什么载体上；pg-boss 去留；CF 件复用面 |
| ② | **Langfuse + promptfoo**（evalite 对照） | DecisionTrace + 双层评估 + 发布门落在哪 |
| ③ | **BAML**（对照 AI SDK baseline） | ①③段结构化命中率要不要专用层 |
| ④ | **Dify vs Mastra Studio**（Coze Studio 已排除；+Flowise/Langflow/n8n/Windmill 快评 + React Flow 自建评估） | 可视化编排采不采、采到哪层；非代码人员改提示词/参数的承载 |
| 缓 | Letta/Mem0/Graphiti | Stage-2 偏好学习专题，暂不开 |

筛选方式：对 ①②③ 直接说「按建议开」或增删（如「A3 不看」「BAML 缓」）。深调产出物将按 per-candidate 一文 + 一份对比决策简报落在本目录，简报给出唯一主推荐（D-023 口径）。
