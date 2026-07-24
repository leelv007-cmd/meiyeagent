# 轻量 Prompt Compiler 与 Harness 模式调研

> 日期：2026-07-24
>
> 研究问题：对于“少量用户输入 + 个性化上下文 → 结构化多模态生成指令 → 调用供应商 → 质量反馈”，哪些组件应直接采用、二次开发、仅借鉴或暂不推荐？
>
> 决策边界：本文给出候选组合、采用条件和最小抽象，不替用户锁定最终技术决策，也不建议为了框架重写已存在的 Harness。

## 0. 结论先行

当前项目缺的不是另一套通用 Agent 框架，而是把已经存在的五段 Harness 收敛成一条**可冻结、可重放、可评估的生成指令编译边界**。

最轻的候选组合是：

1. **直接采用现有 TypeScript 应用服务 + Zod + AI SDK `generateText/streamText + Output.object`**，继续承担①意图正名与③Brief 编译。AI SDK 已能用 Zod/JSON Schema 生成并验证类型化输出；无须为了“typed output”再加运行时。
2. **在现有 Harness 内二次开发一个很薄的 Prompt Compiler 边界**：先解析并冻结精确 Prompt 版本，再用纯函数把 `CreationExecutionSnapshot + ContextBundle + PromptBinding + SchemaBinding` 编译为 `CompiledGenerationInstruction`。它不是 DSL、不是图、也不是第三套状态机。
3. **继续让 DBOS 只做 durable 外壳**：长任务、48 小时人工等待、进度流、幂等 effect 和恢复进 DBOS；短同步编译逻辑留普通函数。不要把 Prompt 编译本身变成 DBOS 专属 API。
4. **继续用 Langfuse 管 Prompt 版本与线上 trace，用 promptfoo/Vitest 管发布前门禁**：Langfuse 负责“发生了什么、用了哪个版本、真实失败如何沉淀”；promptfoo 负责跨 Prompt/模型/样本矩阵与硬红线；Vitest 负责纯函数、状态和业务不变量。
5. **BAML 只做触发式同模型配对实验**：如果真实美业数据上，AI SDK 的首过 schema 有效率、嵌套完整度或业务质量持续不达标，再对单个节点做 BAML spike；未证明收益前不引入 `.baml` DSL、代码生成、NAPI 原生运行时和第二套 provider/观测胶水。
6. **DSPy 只借鉴离线“signature + metric + optimizer”闭环**；当前不把 Python optimizer 放入生产主链。Prompt 稳定、数据集和指标成熟后，可离线优化，再把候选 Prompt 回写 Langfuse，经 promptfoo 门禁发布。
7. **LangGraph、Mastra workflow、Temporal 暂不进入当前主干**：它们分别会新增 graph state/checkpointer、Agent/Workflow/Storage、Temporal Server/Worker/Task Queue 等概念，并与现有 Harness、DBOS、Model Supply、Langfuse 重叠。只有出现动态工具循环、多 Agent 运行时分支、跨服务大规模 durable 等新需求时才重开评估。

一句话裁定：

> **控制流留在现有 TypeScript Harness；Prompt、上下文、schema、路由和安全策略在执行前冻结为一张可追溯的编译收据；durability 只包住真正需要恢复的边界。**

## 1. 本文所说的 Prompt Compiler 是什么

这里的 Prompt Compiler 不是“把字符串模板拼起来”，也不是一个可视化 Agent Builder。它应完成四件事：

1. **解析**：把 Recipe/任务声明中的逻辑引用解析成精确 Prompt、schema、模型策略和安全策略版本。
2. **投影**：从完整 `ContextBundle` 中只投影当前节点、模态、平台需要的上下文，避免把全部历史与敏感字段无差别塞给模型。
3. **编译**：生成供应商可执行的 instructions、结构化输入、媒体引用与参数。
4. **留痕**：产出稳定 hash、版本、数据分类、权利依据和 idempotency key，使同一次执行可解释、可回放、可评估。

它不应负责：

- 持久任务恢复；
- 动态决定下一节点；
- 维护第二套业务状态；
- 自动把一次反馈升级为长期偏好；
- 绕过 Model Supply 直接选择供应商；
- 让运营任意改写控制流或安全门。

这一边界与 12-Factor Agents 的一手工程经验一致：成熟 AI 产品往往是“确定性软件 + 少量恰当的 LLM 步骤”，最快的路径是把小型、模块化 Agent 概念嵌入现有产品，而不是整体重写为 Agent 框架；其 Factor 2/4/8 分别强调自持 Prompt、把模型动作视为结构化输出、掌握控制流。[12-Factor Agents](https://github.com/humanlayer/12-factor-agents)

## 2. 仓内复核：骨架已经存在，问题在绑定而非框架

### 2.1 已经具备的能力

当前仓库不是“还没有 Harness”：

- `apps/core/package.json:43-52` 已使用 `@dbos-inc/dbos-sdk@4.23.6`、`ai@^7.0.19` 和 Zod；没有 BAML、Mastra、LangGraph、Temporal 生产依赖。
- `apps/core/src/p1/harness/structured-model-runtime.ts:14-25` 明确区分 e2e fixture 与生产 live verified model，生产结构化节点进入 `AiSdkStructuredObjectExecutor`。
- `apps/core/src/p1/harness/structured-nodes.ts:190-268` 已有①意图正名、③文案/图片/视频 Brief 编译、Zod schema、稳定 effect idempotency key 和 canonical JSON 输入。
- `apps/core/src/p1/model-supply/structured-node-runner.ts:78-151` 已把结构化调用接入 Model Supply，记录路由、调用次数、成本、token、provider task ref，并在 provider attempt 前做 fence。
- `apps/core/src/p1/harness/dbos-workflow.ts:53-137` 已把纯 `runHarnessWorkflow` 包在 DBOS 外：step、进度流、token 流、pending decision、48 小时 `recv`、trace 与 terminal failure 都有持久边界。
- `apps/core/src/p1/harness/langfuse-prompts.ts:44-156` 已能按 label 获取 Prompt，并冻结 name/version/content/contentHash/source/fallback；Langfuse 不可用时有 builtin fallback。
- `apps/core/package.json:26-30` 已有七红线、偏好记忆和 Langfuse eval 导入脚本，不是从零搭评估。

仓内既有研究的主要结论也仍成立：

- DBOS 适合“Node 服务 + PostgreSQL”的轻量 durable 外壳，但业务 revision fencing 仍由应用层负责；见 [`01-dbos-transact.md`](../harness-research-2026-07-17/01-dbos-transact.md) 与交叉验证。
- AI SDK 现行结构化输出先行，BAML 只在真实数据配对实验触发；见 [`07-baml-vs-aisdk.md`](../harness-research-2026-07-17/07-baml-vs-aisdk.md) 与 [`r07-xcheck.md`](../harness-research-2026-07-17/xcheck/r07-xcheck.md)。
- Langfuse、promptfoo、Vitest 分工为线上观测/数据集、离线硬门、业务状态硬断言；见 [`05-langfuse.md`](../harness-research-2026-07-17/05-langfuse.md) 与 [`06-eval-harness.md`](../harness-research-2026-07-17/06-eval-harness.md)。
- 控制流留代码、常变层版本化外置，比把五段式塞进通用可视化框架更契合；见 [`09-visual-light-and-build-own.md`](../harness-research-2026-07-17/09-visual-light-and-build-own.md)。

### 2.2 当前真实断点

同一研究包的实现审计已证明，当前主要缺口不是 Harness 不存在，而是它会忠实执行“不完整或错误装配”的输入：

1. **Prompt 版本有三套语义但没有 binding**：Recipe `promptRevisionRef`、Harness frozen prompt、structured node `schemaRevision` 彼此没有统一；Model Supply 还把 schema revision 写进 `promptRevision`。见 [`02-personalization-context-prompt-implementation-audit.md:343-355`](./02-personalization-context-prompt-implementation-audit.md)。
2. **图片和视频实际复用了 copy Prompt**：resolver 只有 `harness/intent-naming` 与 `harness/brief-copy`，生产 wiring 会把 copy-oriented instruction 传给 image/video schema。见同报告 `:357-364`。
3. **执行快照没有冻结实际 Prompt binding**：同一逻辑 snapshot 若以后按 `production` label 重新解析，无法证明得到同一 Prompt。
4. **Prompt、schema、模型路由、数据分类、权利依据没有一张统一编译收据**：trace 各自能记录部分事实，但不能从一个 ID 证明“这次供应商调用完整使用了什么”。
5. **Compiler 上游事实仍有断链**：门店事实、Recipe Prompt、历史反馈等是否进入 `ContextBundle` 决定个性化上限；换 Agent 框架不会自动修复事实 owner、scope 和 projection。

因此，本轮最有价值的工作是把现有能力连成一条可执行真相，而不是迁移编排框架。

## 3. 三类运行形态对比

| 形态 | 核心接口/概念 | 直接用户价值 | 新增代码与运行负担 | 失败/恢复语义 | 当前适配度 |
| --- | --- | --- | --- | --- | --- |
| 普通应用服务流水线 | TypeScript 函数、Zod schema、Model Supply port、数据库事务 | 请求响应快；逻辑清楚；错误可直接呈现；最容易做精确数据投影 | 最低；不新增进程/存储；需自行保证调用幂等 | 进程崩溃不会自动续跑；适合同步编译、校验、短模型调用 | **最高**，应承载 Prompt Compiler 内核 |
| 轻量 durable workflow | DBOS workflow/step、workflow ID、`recv`、event、stream、PostgreSQL system tables | 长图/视频可断点恢复；审批可跨 48 小时；进度稳定；重复提交不重复付费 | 中；已有 Node + PG 上增加 DBOS schema、注册顺序、版本发布与 step 幂等纪律 | workflow 从完成 step 后恢复；外部副作用仍按 at-least-once 设计 | **高**，现有主干继续使用 |
| 通用 Agent/graph framework | State/Node/Edge、thread/checkpointer/store、Agent/tool loop、框架级 memory | 只有在动态分支、循环工具调用、多 Agent 协同时才产生明显新价值 | 高；新增状态模型、持久化、调试面、版本语义，并与现有 Harness/DBOS 重叠 | 取决于 checkpointer/框架；通常仍需生产持久后端与幂等 | **低**，当前五段固定主干不需要 |

### 3.1 普通应用服务不是“简陋版”

AI SDK 官方当前接口已把 structured output 纳入 `generateText`/`streamText`，`Output.object` 可接受 Zod、Valibot 或 JSON Schema 并在最终输出上做类型验证；`AI_NoObjectGeneratedError` 保留原始 text、response、usage 与 cause，足以让现有 Model Supply 记录可诊断失败。[AI SDK structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)

其边界也很明确：

- `streamText` 的 partial object 在完成前不能按完整 schema 验证；
- schema 有效不等于业务事实正确；
- 当前仓内指标已诚实标记 `Output.object` 没有 repair hook；
- retry、repair、重新询问用户、切换模型是产品策略，不应被 SDK 隐式决定。

所以普通应用服务层最适合做“确定性 context projection + 单节点 LLM structured output + 显式错误分类”。

### 3.2 DBOS 只包需要耐久的边界

DBOS 官方工作流由普通 TypeScript 函数组成，`DBOS.runStep` 包外部副作用；中断后从最后完成 step 恢复。workflow ID 可作为全局幂等键；workflow 主体必须保持确定性，数据库/API/随机数/本地时间等非确定性操作应进入 step。[DBOS workflows](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)

消息、event 与 stream 都持久化：`recv` 可等待外部输入，event 可向客户端发布当前状态，stream 可传长期任务或 LLM 进度；workflow 内 stream 写入 exactly-once，step 内写入按 at-least-once 看待。[DBOS workflow communication](https://docs.dbos.dev/typescript/tutorials/workflow-communication)

这与当前实现吻合，但不应把每个纯映射函数都做成 durable step。推荐边界：

- Prompt 解析、Provider 调用、成品写入等 I/O：DBOS step；
- context projection、schema 选择、指令编译、红线纯校验：普通纯函数；
- 48 小时人工确认：DBOS `recv`；
- ContentPackage revision 是否仍可写：业务 OCC，不交给 DBOS 猜。

### 3.3 通用 Agent/graph 框架为什么当前过重

LangGraph 的核心抽象是共享 `State`、执行 `Nodes` 和路由 `Edges`，graph 还需 compile；生产持久化再引入 thread ID、checkpointer 与跨 thread store。interrupt 会保存 graph state，并在 resume 时从节点开头重跑该节点。[LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)、[Persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)、[Interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

这些能力并非不好，而是会在当前仓里形成重复：

- `State` 与现有 `HarnessWorkflowInput/CreationExecutionSnapshot/ContextBundle` 重复；
- `Nodes/Edges` 与固定五段 `runHarnessWorkflow` 重复；
- `thread_id/checkpointer` 与 DBOS workflow ID/system tables 重复；
- `interrupt` 与 DBOS `recv + pending decision` 重复；
- `Store` 与现有事实账本、偏好账本、ContentPackage 重复。

如果未来真正出现“模型在运行时决定下一个工具、循环次数不固定、多个 Agent 共享并发图状态”，LangGraph 才会开始提供超过这些重复成本的价值。

## 4. 候选组件事实矩阵

版本与维护快照来自 2026-07-24 的 Open CLI npm/PyPI registry 读取；“维护中”只说明近期有发布，不代表 API 已稳定。

| 候选 | 当前快照 / 许可 | 核心扩展接口 | 新增运行/代码负担 | 适用裁定 |
| --- | --- | --- | --- | --- |
| Vercel AI SDK | `ai@7.0.36`，Apache-2.0，registry modified 2026-07-23；仓内范围 `^7.0.19` | `generateText`、`streamText`、`Output.object/array/choice/json`、Zod/JSON Schema、provider adapters | 无新增服务；仓内已采用；需自己做 prompt/version/业务语义 | **直接采用** |
| DBOS TypeScript | `@dbos-inc/dbos-sdk@4.24.16`，MIT，modified 2026-07-22；仓内 pin `4.23.6` | `registerWorkflow`、`runStep`、workflow ID、`recv/send`、event、stream、queue | Node executor + PostgreSQL system state；需注册/版本/幂等/迁移纪律；当前已经支付 | **直接采用现有边界，不扩权** |
| Langfuse | 旧单体 JS 包 `langfuse@3.38.20`，MIT，modified 2026-06-18；平台核心能力 MIT，企业目录另行许可 | Prompt name/version/label/config/variables/compile/cache；generation↔prompt trace；dataset experiment/evaluator | SDK 可轻；完整自托管平台仍需 PG + ClickHouse + Redis + S3；不能当合规 SoR | **直接采用既有 Prompt/trace/eval 平面** |
| promptfoo | `0.121.19`，MIT，modified 2026-07-14 | YAML/Node API 的 prompts/providers/tests/assertions；自定义 JS/TS provider 与 grader；CI 退出码 | CI/离线进程；数据集与断言配置维护；不进入生产请求链 | **直接采用既有离线门禁** |
| BAML | `@boundaryml/baml@0.223.0`，modified 2026-06-24；npm metadata 标 MIT，但仓库 `canary/LICENSE` 为 Apache-2.0，许可元数据不一致需法务/锁版复核 | `.baml` function/class、Jinja prompt、`ctx.output_format`、generated `baml_client`、SAP tolerant parser、ClientRegistry | 新 DSL + codegen + NAPI 原生 addon + CI generate + provider/trace 适配；不能直接进不支持原生 addon 的 Workers runtime | **条件二开/单节点 spike** |
| DSPy | PyPI `dspy@3.2.1`，MIT，last release 2026-05-28，Python `>=3.10,<3.15` | Signature、Module、Metric、Evaluate、optimizer `compile`（如 GEPA） | 新 Python 环境、训练/验证集、反思模型调用与优化预算；若进生产会形成第二语言运行时 | **只借鉴并可选离线实验** |
| LangGraph JS | `@langchain/langgraph@1.4.8`，MIT，modified 2026-07-15 | `StateGraph`、State schema/reducer、Node/Edge、checkpointer/store、interrupt/Command | graph 状态、thread/checkpointer/store 与运行调试新概念；会复制 DBOS/Harness | **当前不推荐** |
| Mastra core | `@mastra/core@1.52.1`，核心 Apache-2.0，modified 2026-07-23；部分 `ee/` 为专有许可 | Agent、tool、typed workflow step、structuredOutput、storage domains、Studio/Editor | 新 Agent/Workflow/Storage/observability/eval 体系；生产持久存储；高频版本；部分生产权限能力触 EE | **workflow 不推荐；Editor 仅保留触发式 Port** |
| Temporal TypeScript | `@temporalio/workflow@1.21.0`，MIT，modified 2026-07-23 | Workflow/Activity、Worker、Task Queue、signal/query、event history、patch/Worker Versioning、replay test | Temporal Server/Cloud + namespace + workers + task queues + history/版本发布纪律；最高运行负担 | **仅作 durable 参考，当前不采用** |

### 4.1 Langfuse：是 Prompt Registry，不应变成第二个 Compiler

Langfuse Prompt Management 已支持：

- `{{variable}}` 与 SDK `.compile()`；[Variables](https://langfuse.com/docs/prompt-management/features/variables)
- Prompt 与任意 JSON config 一起版本化，可存 model 参数、schema 或 tool 定义；[Config](https://langfuse.com/docs/prompt-management/features/config)
- 客户端缓存、stale-while-revalidate、启动预取与 fallback；[Caching](https://langfuse.com/docs/prompt-management/features/caching)
- generation 关联精确 Prompt，使指标可按 Prompt version 回看；[Link prompts to traces](https://langfuse.com/docs/prompt-management/features/link-to-traces)
- 本地或托管 dataset、item/run evaluator、CI/CD experiment，以及多模态 dataset；[Experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)

但 Langfuse config 是任意 JSON，不替应用执行 Zod 校验、权利判断、数据分类、Model Supply 路由和业务 OCC。正确分工是：

- Langfuse 保存并版本化“可变 artifact”；
- Prompt Compiler 只接受**已经解析成精确 version/hash 的 artifact**；
- 业务 snapshot/trace 保存精确 binding，而不是只保存 `production` label；
- Prompt 发布前走 promptfoo/Vitest 门禁。

当前 resolver 手写 HTTP + builtin fallback 已可用。若未来改用官方 `@langfuse/client` 获得缓存和 `.compile()`，应保持这一业务规则：**首次 admission 可按 label 解析，恢复与重放必须按已冻结 version/hash，不得再次解析浮动 label。**

### 4.2 BAML：可能提高容错，但不是零成本替换

BAML 官方把 LLM function、输入输出类型、client 与 Jinja Prompt 写在 `.baml` 中，生成语言侧 `baml_client`；生成代码负责请求、解析、修复 broken JSON 与类型化返回。[What is BAML](https://docs.boundaryml.com/guide/introduction/what-is-baml)、[Prompting in BAML](https://docs.boundaryml.com/guide/baml-basics/prompting-with-baml)、[TypeScript setup](https://docs.boundaryml.com/guide/installation-language/typescript)

它对本项目可能产生的真实价值只有两项：

1. schema-aligned prompt rendering；
2. 比严格 JSON/schema-only 路径更宽容的解析。

其代价则是确定的：

- Prompt/schema 进入第二种 DSL；
- 生成客户端进入构建和 code review；
- NAPI 原生包限制部署位置；
- Model Supply、Langfuse trace、dataClass、成本证据仍要重新接回；
- Prompt 来源会出现“Langfuse 还是 `.baml`”的 owner 问题；
- 当前许可证元数据需先消歧。

因此 BAML 的采用门不能是“社区说解析更稳”，而应是同模型、同参数、同输入集的配对实验。至少比较：

- 首次 schema 有效率；
- 嵌套必填字段完整率；
- 需要再次调用模型的比例；
- p50/p95 延迟与 token/费用；
- 美业 Brief 的事实正确、可执行、平台适配与权利合规评分；
- 失败样本是否能被现有显式重试/补问以更低复杂度解决。

只有业务 SLO 的净收益稳定覆盖新增 DSL、build、runtime 与观测负担，才在**单个节点**采用；不做全链迁移。

### 4.3 DSPy：借鉴优化闭环，不进入在线主链

DSPy 把任务描述为 structured input/output 的 Signature，用 Module 组合步骤，用 Python metric 对单条预测打分，再让 optimizer 运行候选 Prompt 并保留高分版本。[Program, don’t prompt](https://dspy.ai/getting-started/program-dont-prompt/)、[Metrics](https://dspy.ai/getting-started/metrics/)、[GEPA optimization](https://dspy.ai/getting-started/gepa-optimization/)

这套思想适合在数据成熟后补充“Prompt 如何系统优化”，但当前不适合成为运行依赖：

- 没有稳定 metric，optimizer 只会优化错误目标；
- Python 服务会扩大部署与排障面；
- 自动优化产物若绕过 Langfuse version、人工 review 和 promptfoo gate，会破坏当前审计链。

可借鉴的最小做法是：沿用 Signature/Metric/Optimizer 三段思想，离线产出 Prompt 候选；最终仍以 Langfuse immutable version 发布，记录数据集、metric、optimizer config 和基线结果。

### 4.4 Mastra、LangGraph、Temporal：保留触发点，不进当前主干

Mastra 的 typed workflow step、Agent structured output、storage、eval 和 Studio 都成熟且仍在快速维护；官方 storage 会持久化 workflow snapshot、memory、observability、eval、schedule 与长任务状态。[Mastra agents/tools](https://mastra.ai/docs/workflows/agents-and-tools)、[Storage](https://mastra.ai/docs/storage/overview)

但这些 domain 正是当前仓已分别交给 DBOS、业务账本、Langfuse、promptfoo/Vitest 的部分。为了 Studio 把五段迁入 Mastra，会用一套重叠系统换一张可视化图。仅当运营对 Langfuse Prompt UI 的需求明确超出当前能力，并通过既有 Mastra spike gates 时，才评估 Editor/Studio 局部接入。

Temporal 是很好的耐久性参照：Workflow/Activity 强制分离、确定性 replay、长任务版本 patch/Worker Versioning、测试环境时间跳跃和历史 replay 都比轻量库更完备。[Workflow basics](https://docs.temporal.io/develop/typescript/workflows/basics)、[Versioning](https://docs.temporal.io/develop/typescript/workflows/versioning)、[Testing/replay](https://docs.temporal.io/develop/typescript/best-practices/testing-suite)

也正因为这些能力，它要求独立服务/Cloud、Worker、Task Queue、历史兼容与部署版本治理。当前单 Node + PG 的产品阶段没有证据证明需要支付这笔成本；应借鉴其 Activity 隔离、replay test 和发布版本纪律，不直接采用。

## 5. 推荐的最小编译边界

### 5.1 两阶段，不新建框架

推荐把当前逻辑明确拆成两个阶段：

```ts
// I/O boundary: executed once at admission and persisted.
resolvePromptArtifact(logicalRef, modality): Promise<FrozenPromptArtifact>

// Pure boundary: deterministic and runtime-independent.
compileGenerationInstruction({
  snapshot,
  contextBundle,
  promptArtifact,
  outputContract,
  executionPolicy,
}): CompiledGenerationInstruction
```

第一阶段允许访问 Langfuse；第二阶段不访问网络、不读当前 label、不看当前时间、不自行选供应商。

### 5.2 最小数据，不再制造平行领域模型

不建议新建庞大的 `PromptProject`、`AgentGraph` 或 `CompilerRuntime`。在现有 execution snapshot/trace 上补一张轻量 receipt 即可：

```ts
interface PromptBinding {
  name: string;
  version: string;
  contentHash: string;
  modality: 'intent' | 'copy' | 'image' | 'video';
  source: 'langfuse' | 'builtin';
}

interface CompilationReceipt {
  prompt: PromptBinding;
  schema: { name: string; revision: string; hash: string };
  contextHash: string;
  executionPolicyRevision: string;
  dataClass: string[];
  rightsRefIds: string[];
  instructionHash: string;
}

interface CompiledGenerationInstruction<Output> {
  instructions: string;
  input: string; // canonical JSON
  schema: ZodType<Output>;
  receipt: CompilationReceipt;
  idempotencyKey: string;
}
```

名称可按仓内风格调整；关键不是接口字面，而是以下不变量：

1. 一个 provider attempt 对应一张 receipt；
2. Prompt version 与 schema revision 分栏，不再复用字段；
3. `contextHash` 对应真正送入模型的投影，不只是完整 bundle head；
4. `dataClass`、权利引用和 execution policy 在调用前确定；
5. receipt 与 Model Supply attempt、Harness stage trace、候选资产使用同一 correlation/idempotency lineage；
6. 恢复只能读取冻结 artifact，不能按浮动 label 重新解析。

### 5.3 三模态必须各自有 Prompt identity

最低限度应有：

- `harness/intent-naming`
- `harness/brief-copy`
- `harness/brief-image`
- `harness/brief-video`

四者分别发布、评估、回滚。可共用受测试的 Prompt block，但不能让媒体 schema 被 copy system instruction 覆盖。

Prompt config 可以保存模型参数或 schema ref，但**schema 的可执行权威仍在代码/Zod**。如果 Langfuse config 声明的 schema revision 与代码可解析 revision 不一致，应 admission fail closed，而不是静默取“最新”。

### 5.4 Compiler 与 DBOS 的接缝

推荐执行顺序：

1. DBOS step：解析并冻结精确 Prompt artifact；
2. 纯函数：编译 instruction 与 receipt；
3. DBOS step：经 Model Supply 发起 provider attempt；
4. 纯函数：schema/业务完整度/硬红线校验；
5. DBOS step：保存候选、trace、score 或 pending question；
6. DBOS step + 业务 OCC：回装 ContentPackage revision。

这样既保留崩溃恢复，也可在不启动 DBOS 的单元测试里重放 compiler。

## 6. 最小质量反馈闭环

### 6.1 三层评估，不建第四套平台

| 层 | 工具 | 评什么 | 是否阻塞 |
| --- | --- | --- | --- |
| 纯函数/合同 | Vitest | canonical projection、hash 稳定、Prompt/schema binding、dataClass、rights、OCC 输入、不变量 | PR 阻塞 |
| Prompt/模型离线 | promptfoo + 自定义 TS provider | 固定 dataset 上的 schema、完整度、事实、平台、红线、成本/延迟、BAML 配对 | Prompt 发布与 PR 阻塞 |
| 线上真实流量 | Langfuse | 精确 Prompt version 的 trace、失败簇、人工评分、真实多模态 case、漂移 | 监控；确认后回灌离线集 |

promptfoo 官方配置就是 `prompts + providers + tests + assertions`，可用 JavaScript assertion、自定义 provider、外部测试集和 CI 退出码实现硬门。[Promptfoo configuration](https://www.promptfoo.dev/docs/configuration/guide/)；项目与 LICENSE 均为 MIT。[Promptfoo repository](https://github.com/promptfoo/promptfoo)

### 6.2 反馈只能先变成证据

用户 adopt/edit/reject 的第一落点应是：

- 精确 candidate/asset/content revision；
- 对应 `CompilationReceipt`；
- 操作类型、差异、作用域和时间；
- 是否明确要求长期记忆。

随后才：

- 变成 Langfuse dataset item；
- 进入 promptfoo/Vitest 回归；
- 在满足既定偏好晋升规则时生成 PreferenceCandidate。

不建议让 DSPy、Langfuse evaluator 或任意 Agent 框架直接把单次反馈改写为 production Prompt 或永久偏好。

## 7. 采用分类

### 7.1 直接采用

| 项 | 采用范围 | 理由 |
| --- | --- | --- |
| AI SDK + Zod | ①③ structured output、错误证据、provider 适配 | 已在栈内，满足当前 typed output |
| DBOS | 长任务、人工等待、进度、step 恢复 | 当前代码已接通；用户价值直接 |
| Langfuse Prompt/trace/dataset | Prompt 版本、线上血缘、实验数据 | 已在设计和实现边界内；避免再造 Prompt CMS |
| promptfoo + Vitest | 离线矩阵、红线、业务不变量 | 已有脚本；与生产运行时解耦 |

### 7.2 二次开发

| 项 | 最小改动 |
| --- | --- |
| 仓内 Prompt Compiler | 两阶段 resolver + pure compiler；不建 DSL/graph |
| Prompt binding | snapshot 冻结 name/version/hash/modality；恢复不重新取 label |
| 三模态 Prompt | copy/image/video 独立 identity、dataset、发布门 |
| Compilation receipt | 把 Prompt/schema/context/policy/dataClass/rights/idempotency 串成一条 lineage |
| Langfuse 接入 | 可选改官方 client 缓存/compile；必须保留业务 fail-closed 与精确版本规则 |

### 7.3 仅借鉴

| 候选 | 借鉴点 |
| --- | --- |
| DSPy | Signature、可量化 metric、优化器预算、候选 Prompt 离线比较 |
| Temporal | Workflow/Activity 分离、历史 replay test、版本 patch/worker versioning |
| LangGraph | State schema、interrupt payload、动态图触发条件；当前不引入 runtime |
| Mastra | Editor 的 draft/publish/version UX、typed step 展示；当前不迁 workflow |
| 12-Factor Agents | 自持 Prompt/context/control flow、LLM 只在少量节点做结构化决策 |

### 7.4 条件采用或不推荐

| 候选 | 当前裁定 | 重开条件 |
| --- | --- | --- |
| BAML | **条件采用：单节点配对 spike** | 同模型业务数据证明净收益，且许可证、NAPI 部署、Langfuse/Model Supply 接缝通过 |
| Mastra workflow | **当前不推荐** | 出现明确 Agent loop/运营 Editor 需求，且既有四项 spike gate 通过 |
| LangGraph | **当前不推荐** | 动态工具循环、多 Agent、运行时图分支成为产品需求 |
| Temporal | **当前不推荐** | DBOS 在多服务规模、历史 replay、跨语言 worker、运维 SLO 上出现已证实硬伤 |
| 任何可视化 Agent Builder 作为主后端 | **不推荐** | 除非重新证明许可、安全、数据 owner、durability 与五段硬门均优于现有实现 |

## 8. 代码与运行负担排序

| 路线 | 新增生产进程/有状态服务 | 新增主要概念 | 代码迁移量 | 综合负担 |
| --- | --- | --- | --- | --- |
| 现有 TS compiler + AI SDK | 0 | PromptBinding、CompilationReceipt | 小，局部收敛 | **低** |
| 现有 DBOS durable 外壳 | 0（现有 Node + PG 内） | step/version/idempotency | 已支付，后续局部 | **低到中** |
| BAML 单节点 | 0 个服务；增加 native addon/build | `.baml`、generated client、SAP、第二套配置 | 中 | **中** |
| DSPy 离线 optimizer | 仅离线 Python job | Signature/Metric/Optimizer/train-val-test | 中，但不污染在线 | **中** |
| LangGraph | 可复用 PG，但增加 checkpointer/store | State/Node/Edge/thread/checkpoint | 中到大 | **中到高** |
| Mastra workflow/Studio | storage + 可选 Studio/observability | Agent/Step/Workflow/Storage/Editor | 大 | **高** |
| Temporal | Temporal Server/Cloud + Worker/Task Queue | history/replay/namespace/versioning/activity | 大 | **最高** |

框架增加的概念只有在转化为用户可感知价值时才值得支付。当前用户能感知的是：

- 少输字段仍能得到正确、个性化的多模态成品；
- 长任务不丢、重复提交不重复扣费；
- 审批后能继续；
- 生成失败能解释并修复；
- 同一成品能证明用了哪些事实、素材、Prompt 与模型；
- 修改后下一次更好，但不会误记。

graph、Agent、Studio 或 DSL 本身不是用户价值。

## 9. 推荐验证顺序

1. **先修 binding**：Prompt version、schema revision、Recipe ref、Model Supply 字段统一；snapshot 冻结精确 Prompt。
2. **拆三模态 Prompt**：copy/image/video 独立发布与评估，修复当前媒体串 Prompt。
3. **落轻量 receipt**：用现有 trace/correlation 贯通 compiler → provider attempt → candidate → ContentPackage。
4. **补 compiler 测试**：同一输入稳定 hash；不同 Prompt/schema/context revision 必须产生不同 receipt；敏感 dataClass 与 rights fail closed。
5. **闭合反馈数据集**：真实 adopt/edit/reject 精确关联 receipt，进入 Langfuse dataset 和离线回归。
6. **再看 AI SDK SLO**：只有真实数据证明 structured output 是主要瓶颈，才开 BAML 单节点配对实验。
7. **最后才评估框架升级**：只有固定五段已经不再能表达真实产品需求时，再看 LangGraph/Mastra/Temporal。

这一顺序保持所有决策可逆：前五步无论以后选 BAML、LangGraph、Mastra 或 Temporal 都仍是必要资产；反过来先换框架并不会自动得到这些资产。

## 10. 来源与检索说明

### 10.1 仓内依据

- 当前产品设计 D-033～D-038：[`beauty-marketing-agent-product-design-2026-07-17.md`](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md)
- 当前个性化、Prompt、Harness 实现审计：[`02-personalization-context-prompt-implementation-audit.md`](./02-personalization-context-prompt-implementation-audit.md)
- DBOS、Langfuse、eval、BAML、轻量可变层、Mastra 原研究与交叉验证：[`harness-research-2026-07-17`](../harness-research-2026-07-17/)
- 当前实现：
  - `apps/core/src/p1/harness/structured-nodes.ts`
  - `apps/core/src/p1/harness/dbos-workflow.ts`
  - `apps/core/src/p1/harness/langfuse-prompts.ts`
  - `apps/core/src/p1/model-supply/structured-node-runner.ts`
  - `apps/core/src/p1/model-supply/ai-sdk-runner.ts`

### 10.2 外部一手来源

- [AI SDK structured data](https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data)
- [DBOS workflows](https://docs.dbos.dev/typescript/tutorials/workflow-tutorial)
- [DBOS workflow communication](https://docs.dbos.dev/typescript/tutorials/workflow-communication)
- [Langfuse Prompt variables](https://langfuse.com/docs/prompt-management/features/variables)
- [Langfuse Prompt config](https://langfuse.com/docs/prompt-management/features/config)
- [Langfuse Prompt caching](https://langfuse.com/docs/prompt-management/features/caching)
- [Langfuse prompt-to-trace linkage](https://langfuse.com/docs/prompt-management/features/link-to-traces)
- [Langfuse experiments via SDK](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk)
- [Langfuse core/enterprise license boundary](https://github.com/langfuse/langfuse/blob/main/LICENSE)
- [Promptfoo configuration](https://www.promptfoo.dev/docs/configuration/guide/)
- [Promptfoo MIT license](https://github.com/promptfoo/promptfoo/blob/main/LICENSE)
- [BAML overview](https://docs.boundaryml.com/guide/introduction/what-is-baml)
- [BAML Prompting](https://docs.boundaryml.com/guide/baml-basics/prompting-with-baml)
- [BAML TypeScript installation](https://docs.boundaryml.com/guide/installation-language/typescript)
- [BAML repository Apache-2.0 license](https://github.com/BoundaryML/baml/blob/canary/LICENSE)
- [DSPy program](https://dspy.ai/getting-started/program-dont-prompt/)
- [DSPy metrics](https://dspy.ai/getting-started/metrics/)
- [DSPy GEPA optimization](https://dspy.ai/getting-started/gepa-optimization/)
- [LangGraph Graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [Mastra agents and tools](https://mastra.ai/docs/workflows/agents-and-tools)
- [Mastra storage](https://mastra.ai/docs/storage/overview)
- [Mastra license](https://github.com/mastra-ai/mastra/blob/main/LICENSE.md)
- [Temporal Workflow basics](https://docs.temporal.io/develop/typescript/workflows/basics)
- [Temporal Workflow versioning](https://docs.temporal.io/develop/typescript/workflows/versioning)
- [Temporal testing and replay](https://docs.temporal.io/develop/typescript/best-practices/testing-suite)
- [12-Factor Agents](https://github.com/humanlayer/12-factor-agents)

### 10.3 网络检索路由

本资产的外部检索全部优先使用 Open CLI：

- 已知官方 URL 使用 `opencli web read --url ... --stdout -f yaml`；
- 版本、许可证 metadata 与维护日期使用 `opencli npm package ... -f yaml` / `opencli pypi package dspy -f yaml`；
- 搜索优先 `opencli google search ... -f yaml`。

Open CLI 的 Google adapter 对 LangGraph、Promptfoo、Langfuse 许可证等部分查询返回无结果，因此降级到 **Open CLI DuckDuckGo adapter**；随后仍读取官方文档或官方 GitHub LICENSE。一次 LangGraph npm registry fetch 短暂失败，使用同一 Open CLI 命令重试成功。**未使用 Web Search。**
