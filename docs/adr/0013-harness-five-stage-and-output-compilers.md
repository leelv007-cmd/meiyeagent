# ADR-0013: 五段 Harness 执行架构与四类输出编译器

Status: accepted (2026-07-24)

> 本 ADR 凝结自合并权威版决策日志 D-032/D-033/D-041/D-101/D-104/D-110/D-112/D-113/D-118（`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`），是实施投影不是第二真相源；任何冲突以决策日志为准。
>
> **2026-08-08 修订注（D-178/ADR-0020）**：五段状态机的**长期执行拓扑地位被收敛路线接管**——三 runner 按 V3.1 §22.4 先六原语化再收敛为单 `CompiledExecutionPlan → DBOS executor`，五阶段只保留为 trace taxonomy（与 D-036 一致）。DBOS 载体边界、D-038 五条、pg-boss 分工与④段等待语义在过渡期继续有效；退役门＝V3.1 §35 批次 6（spec-I）。

## Context

执行层曾经的病根是「模块各自为战、多套事实」（D-110 诊断）。本 ADR 把执行层总骨架钉死为一套：任何用户主动创作交互都是一个 Task，驱动一条五段 Harness 工作流，产物统一落 ContentPackage（ADR-0011）。治理背景：执行排期按 D-110 单一序列（装配门→M 合入门→R 试点/发布门→E 发布工程门），R 级修复一律直接落目标形态（修复即建设）。

## Decision

**五段状态机（D-033，DBOS 承载 D-041）**：①意图正名（LLM：模糊一句话→结构化任务声明）→②上下文注入（确定性：六维编译→不可变 ContextBundle）→③Brief 编译（LLM：每执行单元完整 brief）→④执行与择优→⑤回装与交付（组装回 ContentPackage revision）。DBOS Transact 是五段编排控制流的权威 durable 载体，workflowID=TaskID；它不取代执行队列、业务状态表或交付 outbox。

**分层载体边界（H03）**：DBOS 负责五段控制流、超时、恢复和 `send/recv` 等编排语义；pg-boss 只负责媒体等执行子任务的排队、租约、重试与 DLQ；模型供应业务表保存 job/attempt/asset/退款所需事实；outbox 只负责向外部通知、投影和交付。pg-boss 终态通过幂等 `DBOS.send` 回到原 workflow，workflow 在编排层 `DBOS.recv` 后再读取同一 job，不重新提交 provider 效果。

**④段等待实现（H03）**：媒体 job 提交/读取同一幂等 job 后，pg-boss 终态通过定向 `DBOS.send` 发送到 `harness-media-job:<jobId>`，④段在 workflow 层 `DBOS.recv` 后再 reconcile，不在 step 内轮询 provider。图文笔记页的 admission 竞争则由单个带稳定效果键的 `DBOS.runStep` 承载有界 claim 轮询，最长 300 秒（1200×250ms）；该 step 内不挂起等待，抢不到即返回 reconciliation-pending。非 DBOS 调用方没有 durable step 能力时只做一次即时 claim，忙时快速返回 202。终态定向 send、step 内有界轮询与 generation fencing 共同覆盖恢复和旧写拒绝。

**确定性骨架＋段内智能（D-112）**：五段是 DBOS 确定性状态机；段内为受限 agent loop（控制 LLM 理解/规划/allowlist 内调工具/自检）。阶段分支由 LLM 输出**结构化判断信号**，Workflow 按预置条件边执行转移——LLM 出判断、状态机执行，LLM 永不直接驱动转移。硬编码兜底只保四类底线：忠实性（按 ADR-0018 收窄口径）、权利授权、产品额度、外部发布确认。platform 拆双字段 `contentPackagePlatform × distributionTarget`，用户确认的选择进提交 Body→服务端签名→admission 冻结。v1 `contentPackagePlatform` 集合＝小红书/抖音/视频号三平台；朋友圈（wechat_moments）＝仅 `distributionTarget`（导出＋assisted 交付，不做平台化变体主体）——D-128。

**四类输出编译器（D-104/D-118）**：定制创作共享稳定 `ContentIntent`（①②段编译产物），随后分流四类编译器，编排分级：

| outputKind | 编排 | 候选策略 |
|---|---|---|
| copy | 人设＋载体模板拼接→单次 LLM 调用，秒级 token 流式 | 1 主候选（D-113） |
| image | ImageIntent 编译→单次模型调用（D-115 三操作/七 slot/exactText 门） | 1 主候选 |
| image_text_note | 多阶段：NotePlan 先行→文字定稿→页级图片并行→五维评估回炉（D-116） | 双风格草稿 |
| video | 模型原生单调用直出（D-105），离场恢复；AIGC 标识不做我方烧录（D-118 裁决） | 1 主候选 |

**轻输出＝退化执行，不是旁路（D-118）**：copy/image 的③④段可退化为「模板拼接＋单调用」，但必须共享①②段注入、额度门、AI 生成软提示、交付合同、DBOS durable 载体与 SSE 投影。

**④段择优收窄（D-113）**：默认交付 1 个主候选，不做默认抽卡；「择」仅发生在用户品味选择与质量门失败的有界重试；内部多候选直接侵蚀毛利（D-109 内部淘汰不重复扣用户）。

**默认 LLM 供应商（D-129）**：文案生成与全部文本判断位（①③段/结构化判断信号/事实槽满足度/评估回炉）默认＝**DeepSeek**，OpenAI 兼容接口直走 AI SDK 现行 API（D-035）；需视觉输入的判断位除外，按 catalog 多模态位配置。默认型号＝deepseek-v4-pro（v4-flash 轻档备选），supply-registry catalog 运营参数后台可换（D-044）；接入细节（参数/限流/错误码/缓存/思考模式）以 `references/analysis/deepseek-api-docs-2026-07-24/` 官方文档镜像为准，不凭模型记忆。图/视频默认型号＝seedream-5-pro 系/seedance-2 系，供给通道默认＝火山方舟直连（tuzi relay 容灾备选），同为 catalog 运营参数；exactText 校验＝生成链既有多模态模型 VLM 校验，不引独立 OCR 新件（D-129 补充）。

## 实施红线

- 禁止为任何轻链路另立旁路系统或第二套提交/结果真相。
- `DBOS.runStep` 只能包围可重放且带效果键的外部效果；禁止在 step 内调用 `DBOS.recv`，也禁止在 step 内对 provider job 或 outbox 自旋轮询。唯一例外是图文笔记 admission 的 300 秒有界 claim 轮询，它只重试业务状态 claim，不等待 provider 终态；provider 终态等待仍由 workflow 编排层 `DBOS.recv`（必要时带明确 deadline）承载，终态通知必须幂等。
- step 纯函数内核、at-least-once 幂等、大产物走对象存储、⑤段 OCC fencing（D-038）；测试永不 import durable 载体。
- LLM 判断信号必须是结构化输出；场景规则退位给 LLM 判断＋确定性兜底，不新增硬编码业务分支。
- 编译器内部封装段位重量差异，骨架与三进三出合同（D-032）对外统一。

## Graphile Worker 去留

Graphile Worker 不是生产运行时：`main.ts` 与 `job-worker.ts` 只构造 pg-boss。当前仍保留 `graphile-worker@0.17.3`、比较适配器及其 focused/integration tests，理由是它们是可执行的运行时选型证据，记录 pg-boss 的 lease、cron、DLQ、取消和观测性差异；这不是双活队列。若未来不再需要该证据，必须同时删除适配器、测试、比较记录和依赖，不能把它留成未声明的死依赖。
