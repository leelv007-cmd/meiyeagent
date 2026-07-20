# 11 · Harness 五段式实现选型 — 对比决策简报

- 日期：2026-07-17
- 状态：**已拍板（2026-07-17 深夜）**：用户全案采纳四题主推荐，提示词承载点名 Langfuse 先行；已转入权威文档决策日志 **D-034~D-038**（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`）。本文件保留为决策依据存档；Dify 段仍待 r08 交叉验证收尾后补正（不影响已拍板结论——Dify 为搁置项）。
- 证据基础：10 份调研报告（01-10，多 agent 并行，源码镜像 + 线上核实）+ **10 路 Codex 对抗性交叉验证**（xcheck/r01-r10；r08 Dify 复核因模型容量重试中，本简报 Dify 事实标「待 r08 复核」）。凡被 xcheck 判 ❌/⚠️ 的断言，本简报已按修正后口径书写。
- 上游约束：D-032（三层架构、确定性主干、栈不换只调优先级）、D-033（Task + Harness 五段式）、用户新增标准（骨架不常变；常变=提示词/模型择优参数/④段策略顺序；后台有非代码人员；维护简易）。

## 0. 四题总览（先看这张表）

| 决策题 | 主推荐 | 定案形态 |
|---|---|---|
| A 五段式 durable 载体 | **DBOS Transact (TS)** | **进 2-3 天 PoC 后定案**（非直接锁定）；pg-boss 先共存不硬迁 |
| B ①③结构化层 | **AI SDK 现行结构化 API 起步** | BAML 为触发式升级路径，阈值 WOZ 期标定 |
| D 评估与审计 | **Langfuse + promptfoo + 纯 Vitest 三件分工** | 可直接锁定；合规留痕双写自建 PG 审计表 |
| E 非代码可变层 | **扩展存量 admin-config 的自建薄后台** | 可直接锁定主线；提示词承载 Langfuse 先行、Mastra Editor 绑 spike gate 后评 |

跨题统一工程约束（全部报告共识，无论最终选谁都成立）：
1. **五段 step 内核写成 runtime 无关纯函数**——载体只当外壳，换载体不动内核（04 号报告提出，01/02/03 号一致印证）。
2. **step 均按 at-least-once 设计业务幂等**——没有任何候选给 exactly-once（r01 修正）。
3. **大产物（视频/图）走对象存储，编排状态与 trace 只存引用**（Inngest 32MB/4MB 默认限制、Langfuse 媒体同理）。
4. **⑤回装段的 revision fencing 一律业务层 OCC 条件写**——所有载体都只给版本隔离不给数据层防覆盖（四份载体报告一致）。
5. **发布 SOP**：新版本部署须有 in-flight 实例排空/版本粘滞策略，纳入 CI 清单。

---

## 1. 决策题 A：五段式跑在什么载体上（含 pg-boss 去留）

### 现状缺口
pg-boss 是队列不是 durable workflow：无 step 级 checkpoint、无 crash 断点恢复、挂起等待要自建状态机。五段式的「任务独立可恢复 + 等待即挂起 + 白话进度流」正卡在这。

### 四强赛果（按 xcheck 修正后口径）

| 候选 | 语义完备度 | 架构契合 | 许可 | 平移成本 | 裁定 |
|---|---|---|---|---|---|
| **DBOS** | 齐（checkpoint 落自家 PG、挂起数天、版本隔离、进度流一等公民） | **最高**：纯 npm 库嵌单 Node 服务，唯一依赖 PG | MIT | 最低（基建层只换 PG URL；应用层有约束见下） | **主推荐，进 PoC** |
| Inngest | 齐（waitForEvent≤366 天、flow control 最强、Connect 反连） | 中：多一个 Go 服务 + Redis | **SSPL**（自用不触发毒丸，红线=不 fork；非 OSI，尽调会标注） | 低-中 | **强备选** |
| CF Workflows | 够用（waitForEvent 365 天、挂起不占并发） | 高（验证期就在 CF） | 专有 | **最高**：无 self-host、无逃逸；部署版本语义**无官方背书**（r04） | 出局主线，留范式 |
| Trigger.dev | **最强**（Realtime 推送、waitpoint 前端直连） | **最低**：平台非库，塞不进 Workers 壳+单 Node；自托管 8 服务且无 checkpoint | Apache-2.0 | 中（重但可平移） | 出局主线，留范式 |

### 主推荐：DBOS 进 PoC，PoC 通过才定案

**为什么是 DBOS**：它是唯一「不新增任何常驻服务」的候选——checkpoint、队列、事件、进度流全落我们已有的 PostgreSQL；MIT 无许可暗礁；`DBOSClient` 让 Workers 壳无需 executor 即可 enqueue/读流/审批；`writeStream/readStream`（LISTEN/NOTIFY）正对「白话进度事件」SSE。迁中国云=只换连接串，是所有候选里「验证期最快 × 平移最便宜」两头唯一都占的。

**为什么不直接定案（r01 交叉验证的三处削弱，必须 PoC 实证）**：
1. 「DBOS Queues 可直接替代 pg-boss」**不成立**——功能组合有限制、存量 job/API/状态迁移未分析。→ **策略改为共存**：五段式新工作流走 DBOS，存量 pg-boss job 原地不动，稳定后再评估合并。
2. 「迁移成本极窄」只对基建成立——应用层有 bundler 禁打包、launch 前注册 workflow、连接池所有权、schema 权限等一串约束。
3. step 为 at-least-once——④段视频提交、模型调用须幂等键设计。

**PoC 六题**（2-3 天，全过才锁定；任一不过转 Inngest 评估）：
1. 五段骨架跑通（①-⑤最小实现，含 ContextBundle 冻结与⑤ OCC 条件写）；
2. kill -9 后 crash 恢复实测（断点续跑、不重放已完成 step）；
3. 挂起 48h 等审批（`recv`）+ 恢复 + 版本隔离行为实测；
4. `writeStream` → SSE → 前端进度条通路；
5. 与现有 Drizzle/pg 连接池、migration 体系共存；
6. bundler/部署链约束在我们 Next.js + 单 Node 服务架构下的实际代价。

**备选 Inngest 的启用条件**：PoC 任一硬伤，或后续需要「多租户 flow control（每租户并发/限流/去抖）」超出 DBOS Queues 能力时。前置=法务确认 SSPL 自用边界（不 fork、不透出、不转售编排能力）。

**留下的范式抄作业**：CF Agents SDK「对话壳⇄durable 核、进度更新也检查点化」双层结构；Trigger.dev 的 waitpoint token 前端直连审批、metadata 进度推送。

---

## 2. 决策题 B：①意图正名 / ③Brief 编译的结构化层

**主推荐：AI SDK 现行结构化 API 起步 + BAML 触发式升级**（07 号结论 (b)，xcheck 裁定方向成立）。

要点（按 xcheck 修正）：
- **注意 `generateObject` 已 deprecated**（r07 实锤）——实现按 ai@7 现行结构化输出 API 写，不抄旧文档。
- ①③封在**独立非流式函数边界**内（这是 D-033 五段结构天然给的），日后单节点切 BAML 是局部替换，锁定风险≈0。
- **阈值降级为提案**：92%/97% 无证据链（r07）。改为：WOZ 期先建 50-100 条真实输入 eval 集，跑出目标中国模型的基线首过校验率，**用基线数据反推阈值再登记触发点**——不预设数字。
- **BAML 新增前置核查**：其发布物内部存在 Apache-2.0/MIT 许可冲突未解（r07）——引入前须确认上游已修或法务可接受。
- BAML 的机制红利（SAP 宽容解析、弱模型增益）真实存在，但 benchmark 是近两年前 BFCL v1 厂商自测（r07），对中国模型的实际增益以我们自己的 eval 集实测为准。

---

## 3. 决策题 D：择优、评估门与审计（可直接锁定）

**主推荐：三件分工，各任其职**——这是 05/06 两份报告 + 双 xcheck 后最稳的一题。

| 件 | 职责 | 关键实锤 |
|---|---|---|
| **Langfuse（自托管）** | 线上 trace/回放/实验/prompt 版本；Task=trace、五段=五 span | `LangfuseGuardrail`/`LangfuseEvaluator` 原语解包验证为真（r05）；全部所需功能在 MIT OSS 免费版 |
| **promptfoo** | 七红线回归 + red-team 对抗 CI 阻塞门；④段择优判分器范式 | policy 插件官方示例即红线模板；23.4k star 日更（r06 裁定成立） |
| **纯 Vitest 自写 runner** | BeautyPreferenceMemoryEval（多轮→跑管线→记忆状态硬等式断言） | 06 号诚实结论：有状态集成测试进 eval 框架是仪式负担 |

05/06 分歧裁决：**BeautyPreferenceMemoryEval 跑在 Vitest（硬等式阻塞门）+ 结果导出 Langfuse datasets（基线看板与漂移监控）**——两报告各取所长，不二选一。

边界与代价（认账后再锁）：
- **Langfuse 不是合规 system of record**（CH+TTL）：红线门禁留痕**同步双写自建 PG 审计表**，traceId 外键关联富回放。
- 自托管四件套（PG17+ClickHouse+Redis+S3）运维面是真实成本；被 ClickHouse 收购=资金稳但 CH 依赖永久。
- 火山/豆包在 promptfoo 无独立 provider——走 openai 兼容覆盖，上线前真机验一次。
- 附带纠偏（r04）：**CF AI Gateway 实有 Custom Provider**，「中国模型不可接」不成立——若验证期想白捡网关层重试/日志，可开一个真机试火山接入的小 spike，非必需。

---

## 4. 决策题 E：非代码可变层怎么承载（提示词/参数/④段顺序）

### 主推荐：自建薄后台 = **扩展存量 admin-config**（r09 交叉验证的意外实锤）

我们仓里已有 `apps/core/src/p1/admin-config/`：global/workspace 双作用域、追加式修订、CAS apply/回滚、actor/reason/correlationId 审计、secret 拒绝，旁有 model catalog 发布 CAS 与 SecretStore。**正确路线不是新建配置系统，而是**：
1. 加**强类型 Harness artifact**（④段策略顺序、择优参数、模型路由表）进现有修订体系；
2. apply 前插入 **candidate → eval → approve → publish** 门（发布强制过 promptfoo 门禁）；
3. 面向运营的**结构化表单**（不是画布）；
4. 提示词发布时**钉住不可变版本/content hash**。
5. React Flow 只读 DAG viewer **缓建**（锦上添花，v1 可无）。

工作量：09 号估 2-3 人周 v1，其中数据层有存量，实际预期更低。

### 提示词承载的真分叉：Langfuse prompt management vs Mastra Editor

这是 E 题唯一需要拍板的分叉：

| | Langfuse prompt mgmt | Mastra Editor |
|---|---|---|
| 与已选件关系 | D 题已引入，**零新增件** | 需把①③做成 Mastra Agent（新增运行时依赖） |
| 编辑体验 | label 发布流（production/staging）、版本回滚，够用但朴素 | CMS 式（draft/published/version 定向/prompt blocks），**最好** |
| 覆盖面 | 只管提示词 | 提示词+工具；model/参数/顺序也管不了（r10 实锤） |
| 风险 | 无新增 | editor 0.x 钉版本；生产 RBAC 免费档未确认（r10）；「兼容 AI SDK v5/v6/v7」非同源担保 |

**建议：Langfuse prompt management 先行**（零新增件、与观测/eval 天然一体、够用），**Mastra Port 保持「条件打开」**：登记 r10 提出的四项 spike gate（editor db 源迁移/回滚实测、Simple Auth 生产可用性、①③ Agent 化改造成本、版本钉扎与 Langfuse 观测打通），未来若运营对提示词编辑体验提出更高要求再启动 spike。**不为 Editor 提前改跑 Mastra workflow**（r10 裁定与 10 号报告一致）。

### Dify（待 r08 复核后终裁）
- **不当运行时**（Python 双语言、崩溃续跑仅到暂停点、多租户许可禁令）——三份独立报告同向，预期不会翻。
- **子流引擎路线（TS 主干版本 pin API 调③④）技术可行但双前置**：法务确认「SaaS 客户不构成 Dify tenant」+ 接受崩溃丢在途 run。**除非「运营可视化画布」上升为硬需求，否则搁置为战术选项**。
- **范式清单照抄**：草稿→发布→版本 pin 三态、暂停/恢复契约（GraphRuntimeState 序列化 + form_token + 恢复锁版本）、火山/豆包视频插件的接入形态。

### 其余定论
- Flowise/Langflow：排除进生产后端（Langflow KEV+勒索实证硬；Flowise 证据较弱但同因排除）；n8n：内部运营自动化免费可用，客户可见内嵌按官方四类边界个案判（r09 修正）；Windmill：范式参考（AGPL 合规路线存在但无产品理由启用）。

---

## 5. 待办与触发点登记（拍板后转入权威文档）

| # | 事项 | 触发点/期限 |
|---|---|---|
| 1 | DBOS PoC 六题 | 薄壳开工后第一个工程 spike（2-3 天） |
| 2 | BeautyPreferenceMemoryEval 基线 eval 集（50-100 条）| WOZ 期收真实输入后建，反推 BAML 阈值 |
| 3 | BAML 许可冲突上游核查 | 引入 BAML 前 |
| 4 | Inngest SSPL 法务口径 | 仅当 DBOS PoC 失败 |
| 5 | Mastra 四项 spike gate | 运营提出提示词编辑体验升级需求时 |
| 6 | Dify 法务（tenant 界定）| 仅当运营画布成为硬需求 |
| 7 | AI Gateway 接火山真机试 | 可选小 spike，非必需 |
| 8 | r08 Dify 交叉验证收尾 | 容量恢复后自动重试中；落地后修订本简报 Dify 段 |

## 6. 与既有决策的关系
- D-032 完全兼容：栈不换（AI SDK+PG 不动），只是编排层的 durable 缺口用 DBOS（PoC 后）补上，pg-boss 共存过渡。
- 决策 B「Mastra Port 预留」：口径更新为「条件打开至 Mastra Agent runtime 与调优/观测集成边界，绑四 spike gate」（r10 措辞）。
- 2026-07-05 Mastra 历史校准：**部分过时**（DurableAgent 已非单进程 in-memory），跨会话记忆已更新。
