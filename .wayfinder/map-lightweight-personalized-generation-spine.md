---
title: "轻量个性化内容生成主干决策地图"
labels:
  - wayfinder:map
status: archived
tracker: local-markdown
created_at: 2026-07-24
archived_at: 2026-07-24
---

> **[2026-07-24 收档 — D-110]** 本地图及全部 `lpgs-*` 票据自 D-110 起并入收档，不再作为独立决策权威逐票推进。lpgs-00/lpgs-08 的退役清单与首发收缩边界已吸收进 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md` 的 D-110 退役面；与已拍板决策的四处口径分歧按 D-110 元原则（D-101～D-109 为更细化场景感受后的决定，优先于更早冲突内容）裁决：①Langfuse 保持 D-036 角色并补「不可用不得阻断生成主链」运行时约束；②DBOS 维持编排层 durable 载体（D-041+D-101 双确认），「仅候选承载异步视频」表述废弃；③Pro Studio 移出首发投入焦点，代码与 entitlement 付费墙保留，收编按 D-103 挂自由创作主线验证后；④Skills 维持 D-108 一等地位，五件套排入 D-101 Recipe Studio 同批次。本目录研究成果保留作收缩输入参考；后续收敛执行以 D-110 统一序列（装配门→M→R→E）为唯一权威。

## Destination

锁定一份可直接交给实施规划的“轻量个性化内容生成主干”产品与技术决策包：小白用户只需一句话、少量选择或素材，系统即可调用其个人、品牌、门店、行业和历史偏好上下文，编译成可检查、可追溯的结构化生成指令，经统一供应商适配接口生成文案、图片或视频，并沉淀为可继续调整与复用的成品。

本地图同时给出现有能力的保留、冻结、退役和必要数据迁移边界，以及约束后续代码规模和结构复杂度的硬规则；本地图不实施代码。

## Hard constraints

- 产品核心竞争力是“个性化上下文 + 领域 Prompt Compiler/Harness + 质量反馈闭环”，不是模型路由后台、通用 CRM、复杂运营治理或专业画布本身。
- 主干必须保持可解释的线性流程：用户输入 → 上下文装配 → 结构化指令编译 → 供应商调用 → 结果标准化 → 成品与反馈。
- 上游供应商差异必须收敛在小而稳定的 adapter contract 内，不允许供应商字段反向污染产品领域模型。
- 允许主动将偏离主干的现有能力列为冻结、移出首发或退役；本轮只产出决策和迁移规格，不删除代码。
- 不以新增通用 Agent 框架、任意工作流画布、第二套结果聚合、长期双写或“为未来可能需要”建立抽象。
- 个人、品牌、门店、素材和历史偏好属于用户资产；隐私、授权、租户隔离与可删除性不能以轻量化为由取消。
- 当前代码、测试和运行事实优先于旧计划文字；已有术语若与新的产品边界冲突，必须通过独立决策票修订 `CONTEXT.md`。

## Standing sources

- `CONTEXT.md`
- `PRODUCT.md`
- `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`
- `docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md`
- `docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md`
- `docs/reviews/comprehensive-development-review-2026-07-24.md`
- `docs/reviews/optimization-roadmap-2026-07-24.md`
- `references/analysis/harness-research-2026-07-17/`
- 当前代码、测试、依赖、Git 状态和可运行证据

## Decisions so far

- [锁定轻量主干目的地与收缩权限](issues/lpgs-00-lock-destination-and-contraction-boundary.md) — 新地图以个性化提示词编译到多模态成品为唯一主干，允许研究后提出保留、冻结、退役和必要迁移，不要求全部历史能力兼容。
- [锁定首发产品范围与退役清单](issues/lpgs-08-lock-launch-scope-and-retirement-list.md) — 首发保留创作、身份/门店事实、授权素材、可检查 Brief、三模态生成、单一成品以及最小恢复/计费；CRM、自动发布、Pro Studio、复杂供应治理、动态多供应路由和自动长期偏好移出首发，旧链在消费者与数据迁移闭合后退役。

## Research completed

- [审计当前真实主链、代码规模与退役面](issues/lpgs-01-audit-current-flow-complexity-and-retirement-surface.md)
- [审计个性化上下文、资源与 Prompt 实现](issues/lpgs-02-audit-personalization-context-and-prompt-implementation.md)
- [调研供应商 API 差异与最小适配合同](issues/lpgs-03-research-supplier-api-variance-and-minimal-adapter-contract.md)
- [调研轻量 Prompt Compiler 与 Harness 模式](issues/lpgs-04-research-lightweight-prompt-compiler-and-harness-patterns.md)
- [调研小白创作交互与质量反馈闭环](issues/lpgs-05-research-novice-creation-ux-and-quality-loop.md)
- [调研上下文记忆、隐私与评测边界](issues/lpgs-06-research-context-memory-privacy-and-evaluation.md)
- [综合主干偏差、可复用资产与候选方案](issues/lpgs-07-synthesize-lightweight-spine-options.md)

研究结论推荐“复用优先、边界受限”的主干作为讨论基线：保留不可变执行/上下文、供应接单证据、资产托管、双账语义和唯一成品 revision；收缩为一条编译—生成—交付链；Langfuse 不进入在线关键路径；DBOS 仅候选承载异步视频/长等待；偏好激活延后；动态供应控制面、CRM、自动发布、Pro Studio 和新 Agent/graph 不进入首发主干。该推荐不是用户最终决定。

## Frontier

当前只讨论一个决策：

- [锁定个性化上下文领域模型](issues/lpgs-09-lock-personalization-context-domain-model.md) — 收敛身份、门店/品牌事实、素材、当前任务、长期偏好、编译血缘与反馈的最少对象、唯一 owner 和删除/撤权边界。

在该领域模型关闭前，不推进 Harness、供应合同、成品合同、原型、代码预算或实施迁移。

## Decision path

1. [综合主干偏差、可复用资产与候选方案](issues/lpgs-07-synthesize-lightweight-spine-options.md)
2. [锁定首发产品范围与退役清单](issues/lpgs-08-lock-launch-scope-and-retirement-list.md)
3. [锁定个性化上下文领域模型](issues/lpgs-09-lock-personalization-context-domain-model.md)
4. [锁定 Prompt Compiler 与 Harness 拓扑](issues/lpgs-10-lock-prompt-compiler-and-harness-topology.md)
5. [锁定供应商适配与生成任务合同](issues/lpgs-11-lock-provider-adapter-and-generation-task-contract.md)
6. [锁定成品聚合与反馈合同](issues/lpgs-12-lock-result-package-and-feedback-contract.md)
7. [原型验证小白主干与可检查指令](issues/lpgs-13-prototype-novice-mainline-and-inspectable-brief.md)
8. [锁定轻量运行拓扑与代码预算](issues/lpgs-14-lock-lightweight-runtime-topology-and-code-budget.md)
9. [产出实施与迁移规格](issues/lpgs-15-produce-implementation-and-migration-spec.md)

## Fog

- 现有 MarketingIdentity、StoreProfile、OwnedAsset、ContextBundle、Recipe、Surface、Lens、CreationExecutionSnapshot、ContentPackage 中，哪些是必要产品概念，哪些只是实施历史形成的重复层。
- “个性化”应由哪些稳定事实、可变偏好、当前任务上下文与历史反馈组成；哪些内容可以自动推断，哪些必须让用户确认。
- 五阶段 Harness 是否应保留为显式产品主干、收缩为 Prompt Compiler + durable job，或进一步退化为普通应用服务流水线。
- 文案、图片、视频是否真正需要同一内部阶段模型，还是只需共享输入合同、任务状态和成品合同。
- 代码规模应以哪些边界衡量：生产代码、测试、生成物、参考源码、历史迁移和文档不能混为一个数字。

## Out of scope

- 本地图内修改生产代码、删除数据库或迁移真实用户数据。
- 训练或微调基础模型、自建 GPU 推理集群。
- 为所有未来供应商建立万能协议或动态 DSL。
- 自动公开发布、广告投放、完整 CRM、复杂线索运营、专业级无限画布和通用企业 Agent 平台。
- 在研究结论前承诺具体删码比例、发布日期或团队人数。
