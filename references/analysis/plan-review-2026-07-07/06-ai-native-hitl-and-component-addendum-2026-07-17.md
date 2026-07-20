# 06 · 2026-07-17 补研：AI 原生 HITL、记忆治理与组件适配

> 本文是 2026-07-07 综合评审的后续增量，不改写当日历史判断。
> 完整研究：[`../hitl-research-2026-07-17/`](../hitl-research-2026-07-17/)
> 当前决策：[`docs/design/beauty-marketing-agent-product-design-2026-07-17.md` 第二部分：决策日志](../../../docs/design/beauty-marketing-agent-product-design-2026-07-17.md)（原独立决策日志已于 2026-07-17 并入该文件）

> ⚠️ **2026-07-17 深夜更新横幅**：本文 §1「当前主方案仍是 AI SDK + PostgreSQL + pg-boss，不增加新运行时」与 §5「Langfuse 可做隔离评测，不是业务账本」已被同日深夜 D-034~D-038 部分取代：编排层 durable 载体主选 DBOS Transact 进 PoC 定案制，pg-boss 收窄为存量队列（D-034）；Langfuse 转正承载线上 trace/回放/实验/prompt 版本，合规留痕双写自建 PG 审计表（D-036）；Mastra 引入触发条件更新为「运营提示词编辑体验超出 Langfuse」并绑四项 spike gate（D-037）。本文 §2–§4（HITL 五类分流、顾客素材局部门禁、宣发主链）仍与现行权威一致。权威：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`；选型证据：`../harness-research-2026-07-17/`。

## 为什么需要补充

2026-07-07 评审解决了产品范围、合规主体、部署分期和 AI SDK 起步等方向问题，但仍把“人在环”主要看成工程复杂度触发器，没有回答：

- 哪些判断必须由人完成；
- 一次修改何时只救当前成品，何时才值得沉淀；
- 事实、偏好、资产和批准如何分开；
- 美业广告曝光与到店引流中，人应在哪些决定点介入；
- 日常曝光、热点借势、品牌/个人 IP、促销与宣传物料如何共享门店资产而不要求用户填表；
- 通用 Agent/UI/工作流/记忆组件是否真的值得引入。

## 对 2026-07-07 结论的增量修正

### 1. 出现 HITL 矩阵，不再自动触发 Mastra

旧评审把“多分支、子流程、人在环矩阵”列为 Mastra 的引入触发条件。当前代码复核显示，项目已经拥有 AI SDK 结构化提案、PostgreSQL、pg-boss、视频 pause/select/resume、ContentPackage 版本、抖音快照授权和飞书不可变意图确认。

因此触发条件需要改为：

> 只有现有状态机在跨服务补偿、跨月等待、工作流代码升级或复杂并发消息上出现被测瓶颈，且外部引擎能明确替换现有模块时，才引入新运行时。

当前主方案仍是 AI SDK + PostgreSQL + pg-boss，新增统一 HITL 领域层，不增加 Mastra、LangGraph、Temporal、Inngest 或 Cloudflare Workflows。

### 2. HITL 不是审批矩阵，而是五类前台决定

人的输入必须分为：

1. 品味选择；
2. 临时纠偏；
3. 事实/权利冲突确认；
4. 偏好或内容结构的资产晋升；
5. 发布、投放、扣费等外部行动批准。

默认临时，明确晋升。一次选择只影响当前版本；可靠来源中的经营事实自动使用，只有冲突才询问；偏好需要最窄作用域；资产化需要预览；发布和扣费只使用一次性授权。上下文摘要可以被动展示，但不能变成一道要求商家通过的审批。

完整交互规范见 [`../hitl-research-2026-07-17/01-human-in-the-loop-best-practices.md`](../hitl-research-2026-07-17/01-human-in-the-loop-best-practices.md)。

### 3. 顾客案例的 before/after 授权是局部门禁，不是美业主链

2026-07-07 把 before/after 的顾客授权设为素材入库时的一次性标记。Phorest 的成熟产品行为表明，分享权限至少应绑定具体预约，不同预约可以不同，未授权时应直接移除分享能力。

新要求：

- 授权至少绑定 appointment/service episode，可在单张素材上收紧；
- 区分内部留档、匿名公开、完整公开和已撤回；
- 撤回使所有未发布引用失效；
- 已发布内容只能进入人工下架/处置任务，不能伪装成自动撤回；
- 这是产品模式，仍需中国法律专项审查。

这组要求只在使用顾客案例、前后对比或可识别顾客素材时触发。没有顾客素材的项目介绍、热点借势、品牌/IP 内容、促销活动和宣传物料不应被迫经过“技师采集—顾客授权—店长策展”流程。Phorest/Fresha 的证据只能支持局部素材权利设计，不能用来推导中国美业内容生产的通用组织方式。

### 4. 美业主链改为广告曝光与到店引流

首期用五类经营任务组织产品，而不是按老板、店长、技师逐级交接组织产品：

- 日常项目与服务曝光；
- 平台热点、同城话题、节日节点与本店信息借势；
- 品牌 IP、老板/主理人 IP、技师个人 IP 的连续经营；
- 海报、封面、项目卡、服务流程卡、价格/优惠卡、预约引导卡等日常宣传物料；
- 团购、上新、限时活动、同城曝光等促销与本地转化。

默认工作流为：

```text
经营目标或流量机会
→ Agent 识别宣发任务
→ 编译门店 / 服务 / 产品 / 团购 / 品牌与 IP / 平台上下文
→ 首屏交付完整成品包
→ 人进行品味选择或临时纠偏
→ Agent 生成多平台版本与宣传物料
→ 精确版本发布 / 导出 / 投放
→ 回收咨询 / 预约 / 买券 / 核销 / 到店信号
```

人员角色只决定异常事实由谁确认、谁能晋升资产、谁拥有目标账号与投放预算，不定义每条内容都必须经过的生产流水线。完整宣发任务与工作流见 [`../hitl-research-2026-07-17/04-beauty-marketing-jtbd-and-asset-orchestration.md`](../hitl-research-2026-07-17/04-beauty-marketing-jtbd-and-asset-orchestration.md)；特定顾客素材的权利边界仍见 [`../hitl-research-2026-07-17/03-beauty-roles-rights-workflows.md`](../hitl-research-2026-07-17/03-beauty-roles-rights-workflows.md)。

### 5. 通用组件只解决局部缺口

本轮比较了 assistant-ui、AG-UI、CopilotKit、ChatKit、Temporal、Inngest、Trigger.dev、Cloudflare Workflows、LangGraph、Mastra、LangMem、Mem0、Graphiti、Zep、Letta、OpenTelemetry 和 Langfuse。

结论：

- 前端继续复用 AI SDK 7 与现有 Base UI/shadcn；自建十个领域卡片。
- assistant-ui 只借鉴 Tool UI、human/resume 和 host-owned persistence。
- PostgreSQL 保存事实和决定；AI memory 只提出 `PreferenceCandidate`。
- OpenTelemetry 可作为 trace 标准，Langfuse 可做隔离评测，不是业务账本。
- LangMem 与 Mem0 只允许二选一做候选抽取 spike。
- 不做全量 Event Sourcing；普通领域表 + append-only 决策账本足够。

完整矩阵见 [`../hitl-research-2026-07-17/02-component-fit-matrix.md`](../hitl-research-2026-07-17/02-component-fit-matrix.md)。

## 新增验证任务

1. 连续观察 8–12 家不同品类门店 2–4 周的真实内容日历，统计日常曝光、热点借势、IP、促销和物料任务的实际频率与返工点。
2. 验证“今天值得发什么”“热点 × 本店”“一事多用”“做同款 / 续写系列”四个前台原型，重点测从最少素材到可发布成品的时间与直接采用率。
3. 验证 Agent 能否正确匹配门店、项目、团购、品牌/IP、平台和 CTA，并避免把热点内容改成与本店无关的泛文案。
4. 测量临时纠偏误沉淀、关键事实污染、跨门店/IP 泄漏、未授权素材公开和批准后重复副作用。
5. 验证咨询、预约、买券、核销和到店等反馈能否被记录为相关性信号，同时避免把它们包装成未经证明的因果归因。
6. 验证“3 个独立任务后提议记住”是否合理；该数字目前只是实验默认。
7. 采用任何外部组件前，重新锁版核验 Cloud/OSS 能力、许可证、数据保留和运行时迁移成本。

## 来源

官方资料、证据强度、使用边界和 OpenCLI 快照统一登记在 [`../hitl-research-2026-07-17/SOURCE-REGISTER.md`](../hitl-research-2026-07-17/SOURCE-REGISTER.md)。
