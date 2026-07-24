# ADR-0013: 五段 Harness 执行架构与四类输出编译器

Status: accepted (2026-07-24)

> 本 ADR 凝结自合并权威版决策日志 D-032/D-033/D-041/D-101/D-104/D-110/D-112/D-113/D-118（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`），是实施投影不是第二真相源；任何冲突以决策日志为准。

## Context

执行层曾经的病根是「模块各自为战、多套事实」（D-110 诊断）。本 ADR 把执行层总骨架钉死为一套：任何用户主动创作交互都是一个 Task，驱动一条五段 Harness 工作流，产物统一落 ContentPackage（ADR-0011）。治理背景：执行排期按 D-110 单一序列（装配门→M 合入门→R 试点/发布门→E 发布工程门），R 级修复一律直接落目标形态（修复即建设）。

## Decision

**五段状态机（D-033，DBOS 承载 D-041）**：①意图正名（LLM：模糊一句话→结构化任务声明）→②上下文注入（确定性：六维编译→不可变 ContextBundle）→③Brief 编译（LLM：每执行单元完整 brief）→④执行与择优→⑤回装与交付（组装回 ContentPackage revision）。DBOS Transact 为唯一 durable 载体，workflowID=TaskID；不叠第二运行时。

**确定性骨架＋段内智能（D-112）**：五段是 DBOS 确定性状态机；段内为受限 agent loop（控制 LLM 理解/规划/allowlist 内调工具/自检）。阶段分支由 LLM 输出**结构化判断信号**，Workflow 按预置条件边执行转移——LLM 出判断、状态机执行，LLM 永不直接驱动转移。硬编码兜底只保四类底线：忠实性（按 ADR-0018 收窄口径）、权利授权、产品额度、外部发布确认。platform 拆双字段 `contentPackagePlatform × distributionTarget`，用户确认的选择进提交 Body→服务端签名→admission 冻结。

**四类输出编译器（D-104/D-118）**：定制创作共享稳定 `ContentIntent`（①②段编译产物），随后分流四类编译器，编排分级：

| outputKind | 编排 | 候选策略 |
|---|---|---|
| copy | 人设＋载体模板拼接→单次 LLM 调用，秒级 token 流式 | 1 主候选（D-113） |
| image | ImageIntent 编译→单次模型调用（D-115 三操作/七 slot/exactText 门） | 1 主候选 |
| image_text_note | 多阶段：NotePlan 先行→文字定稿→页级图片并行→五维评估回炉（D-116） | 双风格草稿 |
| video | 模型原生单调用直出（D-105），离场恢复；AIGC 标识不做我方烧录（D-118 裁决） | 1 主候选 |

**轻输出＝退化执行，不是旁路（D-118）**：copy/image 的③④段可退化为「模板拼接＋单调用」，但必须共享①②段注入、额度门、AI 生成软提示、交付合同、DBOS durable 载体与 SSE 投影。

**④段择优收窄（D-113）**：默认交付 1 个主候选，不做默认抽卡；「择」仅发生在用户品味选择与质量门失败的有界重试；内部多候选直接侵蚀毛利（D-109 内部淘汰不重复扣用户）。

## 实施红线

- 禁止为任何轻链路另立旁路系统或第二套提交/结果真相。
- step 纯函数内核、at-least-once 幂等、大产物走对象存储、⑤段 OCC fencing（D-038）；测试永不 import durable 载体。
- LLM 判断信号必须是结构化输出；场景规则退位给 LLM 判断＋确定性兜底，不新增硬编码业务分支。
- 编译器内部封装段位重量差异，骨架与三进三出合同（D-032）对外统一。
