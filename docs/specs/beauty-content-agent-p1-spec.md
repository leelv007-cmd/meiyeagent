---
title: 美业内容副驾 P1 实施规格
status: ready-for-agent
triage: ready-for-agent
date: 2026-07-11
source_of_truth:
  - P1 决策地图（17/17 resolved）
  - 统一模型供应与渠道管理决策地图（closed）
  - ADR-0001 / ADR-0005 / ADR-0006 / ADR-0007 / ADR-0008 / ADR-0009
  - 文档一致性复核：`docs/reviews/p1-document-consistency-review-2026-07-11.md`（历史基线）
  - 2026-07-16 两线产品叠加：`references/analysis/vozeb-方案合集-2026-07-16.md`
  - Pro Studio rev2：`docs/specs/vozeb-adoption-pro-studio-spec.md`
  - ADR-0012：`docs/adr/0012-two-lane-pro-studio-overlay.md`
  - P1 修订方案：`docs/reviews/p1-revision-plan-2026-07-11.md`
---

# 美业内容副驾 P1 实施规格

> 当前口径叠加：本规格仍是 P1 Scope 基线；D01–D18 的最新决策、ContentPackage 架构和当前实现状态以 CONTEXT.md、ADR-0011、阶段决策日志与当前代码为准。2026-07-16 已确认两线边界：P1 的“开放图文工作台/自由画布”收窄为 Composer 日常轻编辑；无限画布、高阶精修、TTS+音效、在线画布 Agent 由 Pro Studio 独立加购规格承载，不计入 P1 mainline must-have，也不改变 ContentPackage 唯一成品聚合。

> **2026-07-19 现行叠加**：`docs/design/beauty-marketing-agent-product-design-2026-07-17.md`（合并权威版，D-001~D-046）已接管前台产品结构（另见 CONTEXT.md「2026-07-17 宣发产品方向」节）。旧设计只继承四项白名单约束（权威版 Implementation Boundary 原文）：「ContentPackage 是唯一用户成品事实且 Product Core 是唯一物理写入入口；长任务可持久恢复；来源、事实、权利、合规/AIGC 和账号能力按版本追溯；真实外部动作绑定精确成品、账号、平台、时间与费用并一次性确认」。本规格中的前台形态——任务收件箱作为主工作面、开放图文工作台入口、模型自由选择等——不再决定前台信息架构；首页与交互以权威版第一部分及 D-029（Day-0 同界面、Composer 主轴）、D-031（前台无槽位填表）、D-032（三进三出前后端合同；异步收件箱聚合待办、呈现层一次置顶一个）、D-043~D-045（主路径折叠、默认供给、额度接缝）和 D-046（result 阶段自由追问派生 revision）为准。`status: ready-for-agent` 表示本规格可被实现消费，不代表其历史前台描述仍是当前状态；实际完成度与开放门以当前实现总账和代码/测试为准。

## Problem Statement

付费单店商户已经可以生成单条文案、基础平台变体、视频成片和人工发布包，但每周内容运营仍散落在单次创作流中。商户需要反复寻找草稿、素材缺口、待确认项、发布状态和回顾数据；模型、模板和外部连接也缺少统一、可恢复、可审计的产品控制面。

当前活动实现把一个 workspace 的大部分产品事实保存在单行 JSONB 中，额度以可变余额为主，模型与视频执行没有真正的持久任务队列。外部供应调用还可能占用 workspace 数据库事务，无法可靠支持 P1 已锁定的任务收件箱、模型自由选择、开放图文工作台、抖音官方连接、飞书 MCP、双账、后台目录和高用量 Pro。

P1 的问题不是增加更多零散功能，而是让单店 Owner 在一个稳定的运营工作面内完成“本周做什么、缺什么、选哪个模型或模板、哪些内容待确认、是否已发布、结果如何”，同时保证异步任务、外部连接、额度和成本可以恢复、解释和回滚。

## Solution

P1 建设一个面向付费单店 Owner 的内容运营控制面：创作页内的任务收件箱作为主工作面，同屏提供紧凑周条、周内容批次和薄周回顾；它不是商家一级导航。内置触发器按固定时间或已知状态创建任务，但不提供用户自定义自动化平台。

创作能力扩展为 Composer 日常轻编辑，支持官方模板、自建模板、文字/图片/裁切/顺序调整、预览、保存版本、导出、AI 生图和 AI 改图。无限画布与高阶精修不在 P1 默认面，而由 Pro Studio 加购线独立提供；官方模板由后台版本化发布，用户选择快捷展示；品牌水印和 AIGC 标识为创作开关，发布阶段的最终规则留待功能完成后的法务审核。

模型供应统一进入 Product Core：后台发布完整模型目录、Deployment、路由和价格版本，用户在任务中自由选择模型或使用 LLM Auto；图片和视频不使用跨品牌 Auto。工作区可配置 strict BYOK，但仍消耗产品产出额度。媒体任务使用持久 Job/Attempt/Asset 和产品用量、供应成本双账。

外部平台采用官方 L1 + 人工 L3。抖音实现条件式 Publish/Observe 完整骨架，真实应用、Scope 和接口实证只控制生产激活；当前生产装配仍是硬编码 recorded，pilot 触发点前必须向商户诚实标注「未接入」，不得表述为「只差 Key」或「只差激活」。飞书通过官方远程 MCP 接入全部正式工具，后台统一更新工具目录，用户选择快捷展示。所有连接凭据通过 Product Core metadata、成熟 Secret Manager/KMS 和可替换 OAuth PoC 管理。

运行时保持单仓、单服务边界和单 Postgres，以 HTTP 与 job-worker 两个入口共同部署。持久任务优先复用 pg-boss，Graphile Worker 为对照候选；AI SDK 位于 ContentWorkflowRunner Runtime Port 后。Mastra、Redis/Inngest、服务拆分和 pgvector 只有在真实瓶颈、对照 PoC 改善和可回滚同时成立时才重开。

## User Stories

### 运营工作台与任务

1. 作为单店 Owner，我希望打开首页就看到“现在该做什么”，从而不必在内容库、素材库和发布记录间寻找下一步。
2. 作为单店 Owner，我希望任务收件箱聚合待审草稿、缺素材、发布准备、连接异常和周回顾任务，从而按优先级处理本周运营。
3. 作为单店 Owner，我希望同屏看到只读紧凑周条，从而快速识别五个日期状态点和内容缺口，而不需要使用完整日历。
4. 作为单店 Owner，我希望按状态、来源、风险、日期和关联内容筛选任务，从而快速缩小处理范围。
5. 作为单店 Owner，我希望创作、改稿、模板和图文草稿可以批量处理，从而减少重复确认。
6. 作为单店 Owner，我希望价格、顾客授权、医美或合规提示不阻塞创作与编辑，从而完整使用生产工具；只有进入公开发布时才应用发布阶段确认与策略。
7. 作为单店 Owner，我希望缺素材、外部权限不足或服务不可用等确实无法执行的任务显示原因和下一步，从而知道需要补素材、重授权还是稍后重试。
8. 作为单店 Owner，我希望批量处理失败时可以回到逐条处理，并保留已完成结果，从而不丢失本周进度。
9. 作为单店 Owner，我希望内置触发器在周批次就绪、素材不足、草稿久未确认和周回顾就绪时创建任务，从而不用每天主动检查。
10. 作为单店 Owner，我希望可以逐个启停内置触发器，从而控制提醒频率，但不必学习规则编辑器。
11. 作为单店 Owner，我希望同一 workspace、触发器和时间窗最多产生一个有效任务，从而不被重复提醒淹没。
12. 作为单店 Owner，我希望飞书通知失败时任务仍留在收件箱，从而不因外部连接故障丢失工作。
13. 作为单店 Owner，我希望周运营回顾只汇总可追溯的计划、草稿、确认、发布标记、素材缺口和人工线索，从而相信其中数字。
14. 作为单店 Owner，我希望缺失数据明确显示未知，而不是由模型补造，从而避免错误经营判断。
15. 作为单店 Owner，我希望下周建议先成为待确认候选，再进入周内容批次，从而保留最终控制权。

### 开放图文工作台与模板

16. 作为单店 Owner，我希望使用官方模板快速生成小红书/抖音封面、Before/After、价格卡、套餐说明、好评卡、门店介绍和拍摄清单，从而覆盖高频内容需求。
17. 作为单店 Owner，我希望在 Composer 中快速修改文字、图片、裁切、顺序和基础布局，从而完成日常内容编辑；无限画布和精确版式留给 Pro Studio 加购线。
18. 作为单店 Owner，我希望创建和保存自己的模板，从而复用门店风格。
19. 作为单店 Owner，我希望在官方模板和自建模板中置顶、排序和隐藏快捷入口，从而形成自己的常用工作面。
20. 作为单店 Owner，我希望后台更新官方模板时，新作品默认使用新版本，而旧作品保持原样，从而避免历史内容被静默改变。
21. 作为单店 Owner，我希望可以主动升级或复制旧模板版本，从而按需采用新版设计。
22. 作为单店 Owner，我希望模板下架只影响新建，不破坏历史作品，从而继续编辑和导出旧内容。
23. 作为单店 Owner，我希望在图文工作台直接使用 AI 生图和改图，从而无需跳转到独立工具。
24. 作为单店 Owner，我希望品牌水印和 AIGC 标识在创作阶段都是开关，从而自由完成内容生产。
25. 作为后台运营者，我希望统一创建、分类、版本化发布、灰度和下架官方模板，从而持续维护模板库。
26. 作为后台运营者，我希望模板变更有审计和历史版本，从而能定位作品使用的准确版本。

### 模型目录、选择与 BYOK

27. 作为单店 Owner，我希望任务内有快捷模型选择器和完整模型目录，从而既能快速使用，也能自由选择。
28. 作为单店 Owner，我希望看到模型制造方、稳定产品名、版本、能力和预计产出额度，从而做知情选择。
29. 作为单店 Owner，我希望物理供应通道和密钥细节被隐藏，从而不用理解底层路由。
30. 作为单店 Owner，我希望个人默认、收藏、最近使用和本次覆盖彼此独立，从而不会因一次选择改变长期设置。
31. 作为单店 Owner，我希望固定模型不可用时得到明确原因，而不是静默换成另一个模型，从而保持结果可预期。
32. 作为单店 Owner，我希望 LLM Auto 只在已发布的兼容模型集合中按质量优先路由，并展示实际使用模型，从而兼顾易用性与透明度。
33. 作为单店 Owner，我希望图片和视频始终显式选择模型，从而避免跨品牌结果不可控。
34. 作为单店 Owner，我希望 GPT Image 2、Nano Banana 2、Nano Banana Pro、Seedream 5.0 Pro 进入图片完整目录，从而按任务自由选择。
35. 作为单店 Owner，我希望 Seedance 2.0、Kling 最新系列、Grok 最新系列和 Veo 最新系列进入视频完整目录，从而按任务自由选择。
36. 作为单店 Owner，我希望未获真实 Deployment 激活的模型显示不可提交状态，从而不把文档能力误认为生产可用。
37. 作为单店 Owner，我希望配置工作区 strict BYOK 后只使用自己的授权通道，从而控制供应合同和费用。
38. 作为单店 Owner，我希望 BYOK 失败时不静默回落平台 Key，从而避免费用承担者被改变。
39. 作为单店 Owner，我希望提交前同时看到产品产出额度扣减和供应商可能另行计费，从而理解两类费用。
40. 作为单店 Owner，我希望模型退休或版本迁移需要显式确认，从而不让默认模型被后台静默替换。
41. 作为后台运营者，我希望统一管理 Provider Profile、Channel、Deployment、Catalog、双价目、凭据引用、路由、健康、灰度和生命周期，从而维护一个事实源。
42. 作为后台运营者，我希望目录和路由通过草稿、启用、发布流程产生不可变 revision，从而让历史任务可解释。
43. 作为后台运营者，我希望合格模型默认可见但可分批灰度，从而快速扩充目录又能控制生产激活。
44. 作为后台运营者，我希望通过 recorded/fake Adapter 验收未激活候选，从而不让真实 Key 和商务开通阻塞开发。

### 生成任务、资产和额度

45. 作为单店 Owner，我希望图片和视频生成成为可查询、可取消、可恢复的持久任务，从而关闭页面后仍能继续。
46. 作为单店 Owner，我希望上游已接单后系统继续恢复原任务，而不是盲目重投，从而避免重复生成和重复收费。
47. 作为单店 Owner，我希望固定模型失败时保持排队或提示重新选择，而不是跨模型自动替换，从而保持选择语义。
48. 作为单店 Owner，我希望已成功生成的媒体及时进入自有 Asset，从而不依赖供应商临时 URL。
49. 作为单店 Owner，我希望技术失败、取消和未交付按产品政策正确释放额度，从而不被错误扣费。
50. 作为单店 Owner，我希望“成功但不满意”的重做遵循套餐额度，而不是由系统伪装成技术失败退款，从而保持计费一致。
51. 作为单店 Owner，我希望 Growth 与高用量 Pro 使用相同功能，从而不因套餐被功能墙限制。
52. 作为单店 Owner，我希望 Pro 只增加产出量、并发、队列优先级和工作日优先支持，从而清楚知道升级价值。
53. 作为单店 Owner，我希望按文案、图片和视频购买加量包，从而按实际需求扩容。
54. 作为单店 Owner，我希望自动补充额度必须显式开启并设置月度金额上限，从而控制支出。
55. 作为后台运营者，我希望产品额度和供应成本分账，从而分别处理用户权益和供应商毛利。
56. 作为后台运营者，我希望供应成本可以从估算、观测到对账和调整逐步补证，从而不把未知费用当作零。

### 抖音官方 Publish / Observe

57. 作为单店 Owner，我希望在一个抖音账号连接内独立启用 Publish 和 Observe，从而只授予需要的能力。
58. 作为单店 Owner，我希望账号、Scope 或接口尚未激活时仍能完成创作和发布包，从而不被外部审核阻塞工作。
59. 作为单店 Owner，我希望发布普通视频是 must-have，而 POI、小程序锚点按账号资格条件显示，从而避免不可用选项阻塞发布。
60. 作为单店 Owner，我希望点击立即发布或安排发布时只确认一次账号、内容快照和时间，从而不会在执行时被重复打扰。
61. 作为单店 Owner，我希望内容、账号或发布时间改变时重新确认，从而确保执行内容与授权一致。
62. 作为单店 Owner，我希望提交后看到 submitted、reviewing、published、failed 或待平台核验状态，从而知道真实进度。
63. 作为单店 Owner，我希望已有平台作品 ID 时系统不因状态未知而重复发布，从而避免重复作品。
64. 作为单店 Owner，我希望提交前明确失败、能力未开通或权限失效时获得 L3 人工发布包，从而不中断运营。
65. 作为单店 Owner，我希望 Observe 读取授权账号在平台允许窗口内的全部可见作品，并区分本产品发布与外部发布，从而回顾账号整体表现。
66. 作为单店 Owner，我希望每个观察指标显示平台时间、采集时间和缺失原因，从而不把旧数据当成当前事实。
67. 作为单店 Owner，我希望 access token 自动刷新，refresh token 到期前三天得到轻提示，从而减少连接中断。
68. 作为单店 Owner，我希望平台限流时不受产品额外上限限制，并在明确未接单时安全排队，从而最大化可用性。
69. 作为单店 Owner，我希望断开连接立即删除 Token 和 Observe 缓存，但保留原创内容与最小发布历史，从而兼顾控制权和可追溯性。
70. 作为单店 Owner，我希望连接页显示待审核、需重授权、权限不足、限流和停用等状态及处理入口，从而自行恢复连接。

### 飞书 MCP 通用连接

71. 作为单店 Owner，我希望通过飞书官方远程 MCP 连接自己的飞书账号，从而在本产品中使用飞书文档工具。
72. 作为单店 Owner，我希望飞书连接默认使用我的 UAT 身份，从而访问范围与我在飞书中的真实权限一致。
73. 作为单店 Owner，我希望飞书官方当前正式提供的全部工具都进入产品工具库，从而不被人为功能裁剪。
74. 作为单店 Owner，我希望自行选择和排序飞书工具快捷入口，从而形成适合自己的工作方式。
75. 作为单店 Owner，我希望明确提出的读取、创建和编辑操作直接执行，从而不被重复确认弹窗打断。
76. 作为单店 Owner，我希望只有后台自主触发的发送、删除或覆盖他人对象等高风险动作需要确认，从而在安全与可用之间取得平衡。
77. 作为单店 Owner，我希望单个飞书工具异常时其他工具继续使用，从而不因局部故障失去整条连接。
78. 作为单店 Owner，我希望断开飞书连接后本地凭据和内容缓存立即删除，而已创建的飞书文档继续保留，从而不误删外部成果。
79. 作为单店 Owner，我希望看到最近的工具、对象、执行时间、状态和外部链接，从而了解系统做过什么。
80. 作为后台运营者，我希望自动发现飞书新增工具或 Schema 变化，并在兼容性检查后统一发布，从而稳定更新工具库。
81. 作为后台运营者，我希望新工具发布不打乱用户已有快捷项，从而避免后台更新破坏个性化布局。

### 迁移、可靠性与运维

82. 作为单店 Owner，我希望 P0 历史内容、素材、视频、额度和发布记录在 P1 迁移后保持一致，从而继续使用原有资产。
83. 作为单店 Owner，我希望迁移失败时后续写入口可以回滚，而迁移后已经产生的新事实不会被旧快照覆盖，从而避免数据丢失。
84. 作为系统 Worker，我希望从持久队列认领任务、续租、重试和恢复，从而不依赖浏览器连接或单个进程内存。
85. 作为系统 Worker，我希望所有外部供应调用发生在短事务之外，从而不长期占用 workspace 锁和数据库连接。
86. 作为后台运营者，我希望查看队列积压、最老任务、认领延迟、租约过期和恢复次数，从而判断 Postgres 队列是否需要升级。
87. 作为后台运营者，我希望查看事务时长、workspace 锁等待、连接池等待、慢 SQL 和索引增长，从而发现真实 DB 瓶颈。
88. 作为后台运营者，我希望查看 Worker CPU、内存、事件循环延迟、任务并发和媒体耗时，从而判断是否需要独立 Worker Service。
89. 作为后台运营者，我希望查看 Runner 分支、暂停、恢复失败和发布节奏，从而判断是否需要 Mastra 或独立 Agent Service。
90. 作为后台运营者，我希望用固定中文检索集测量 Recall@K、无结果率和改查率，从而判断 FTS 是否足够或需要向量检索。

> 用户故事中的“单店 Owner”是默认商业主体和主要操作人，不排除固定 Workspace Operator/Reviewer 在其授权范围内使用或审阅；权限合同以固定角色矩阵为准，不引入自定义 ACL。

## Implementation Decisions

### 1. Scope and source of truth

- 本规格消费已关闭的 P1 决策地图和统一模型供应地图，不重新解释或扩大范围。
- P1 面向所有付费单店，workspace 采用固定四层角色边界：商户侧 Workspace Owner、Workspace Operator、Workspace Reviewer，以及独立全局管理上下文中的 Platform Admin；不建设多门店/Agency、可配置席位或自定义 ACL 工作台。Owner 仍是默认商业主体和发布确认责任人，固定角色不改变单店边界。
- 真实商户样本、模型 Key、平台账号、成本和质量采集与功能开发并行；它们控制 activation、排序和定价，不阻塞 recorded/fake 合同实现。
- Product Core/Postgres 是产品事实唯一写入口；App Shell、AI runner、MCP client、Gateway、Worker 和远端平台均不得成为第二事实源。

### 2. Highest testing and integration seam

- 唯一最高 seam 是 Product Core Application Service。Web、Admin、HTTP、MCP 与 job-worker 都调用同一组命令和查询。
- Application Service 负责 workspace 授权、领域状态机、幂等、用量预留/结算、审计和 Adapter 调度。
- 供应商、Secret Store、任务组件、对象存储、检索、通知、抖音和飞书位于 Ports/Adapters 外围，可用 fake、recorded 或 live Adapter 替换。
- 测试优先从 Application Service 外部行为验证状态与结果；不直接断言 pg-boss、AI SDK 或供应商 SDK 的内部调用顺序。

### 3. Modules

- **Workspace and Identity**：单店 workspace、固定 Owner/Operator/Reviewer 会员角色、操作主体和后台服务身份；Platform Admin 属于独立管理模式。
- **Content Task Inbox**：ContentTask、TaskEvent、TaskSourceLink、周批次、紧凑周条、批量动作和任务投影。
- **Built-in Triggers**：后台定义触发器、workspace 启停、时间窗幂等、触发执行和通知召回。
- **Weekly Review**：只汇总可追溯事实、标记 unknown、生成待确认下周候选。
- **Graphics Workbench**：作品、画布文档、素材引用、导出、AI 图片任务和用户模板。
- **Template Catalog**：Template、TemplateVersion、发布 revision、下架、灰度和 UserTemplateShortcut。
- **Model Supply Control Plane**：CatalogModel、ModelDeployment、Capability/Price/Lifecycle revision、RoutePolicy、RouteSnapshot 和用户选择投影。
- **Generation Runtime**：GenerationJob、ProviderAttempt、ProviderTaskRef、Asset、回调/轮询、取消意图和恢复；同时承载 composed-video workflow：分镜 gate → 逐镜候选 Attempt → N→1 → compose 终态 Asset，不引入 Mastra。
- **Ledgers**：Product Usage Ledger、Provider Cost Ledger、余额/毛利投影、加量包和封顶自动补充。
- **Connection and Secrets**：Connection、CredentialBinding/Version、ExternalAccount/Object、requested/granted capability、健康与 secret_ref。
- **Douyin Adapter**：OAuth、PublishJob、ObserveSnapshot、webhook/poll、平台额度和 L3 handoff。
- **MCP Adapter**：飞书远程 MCP UAT、ToolCatalog、ToolRevision、ToolCall、ToolActivity 和局部降级。
- **Job Runtime**：pg-boss Adapter、Graphile Worker 对照 Adapter、worker entrypoint、outbox 和 reconciliation。
- **Search**：结构化过滤、标签、Postgres FTS/trigram、Retrieval Port 和检索评测。
- **Admin**：模型、模板、工具、连接、activation/evidence、路由、价目、健康、迁移和审计投影。

### 4. Core data model

- 现有 workspace JSONB 中的核心事实迁入关系表；所有业务事实包含 workspace、稳定 ID、时间、操作者和 correlation。
- 历史对象保存 legacy source 和映射置信度；未知 provider、model、route、cost 或 external ID 保持 unknown，不补造事实。
- ContentTask 独立于 AgentRun 和外部消息；同一 trigger + workspace + time window 使用唯一幂等约束。
- TemplateVersion 不可变；作品固定引用创建时版本。新版本、下架和用户升级不改写历史作品。
- Connection 保存 provider、subject、identity mode、requested/granted capabilities、secret_ref、状态、到期、last success/error；不保存 secret 明文。
- Publish 与 Observe 是可扩展 CapabilityKind 的 P1 实例；不为 Engage/Attribution 建设业务表或流程。
- ToolCatalog 保存官方工具稳定标识、远端 schema revision、风险分类和发布状态；用户快捷展示是独立投影，不控制授权事实。
- GenerationJob 是用户可见任务；ProviderAttempt 表示一次实际执行；ProviderTaskRef 保存上游接单身份。Job、Attempt 和 Product Usage/Provider Cost 不合并。
- RouteSnapshot 保存输入 `data_class`；`contains_face`、`pii`、`medical` 复用素材敏感度事实，并按 ADR-0005 在选择候选前执行数据驻留硬过滤。
- Product Usage 事件 append-only，覆盖 reserve、commit、refund、expire、adjust/compensate；余额由事件投影，不直接作为财务真相。
- Provider Cost 事件 append-only，覆盖 estimate、observe、reconcile、adjust；保存原币、单位、price revision、credential owner 和 evidence confidence。
- Audit 与 ExternalCallLedger 对敏感字段脱敏；不得保存 Token、密钥前缀、完整敏感响应或长期复制飞书正文。

### 5. State machines

#### ContentTask

- 状态至少覆盖 todo、in_progress、needs_review、needs_asset、blocked、ready、done、archived；blocked 只表示缺少执行条件或外部能力，不作为创作内容审查门禁。
- 状态变更保存来源、原因、关联对象和操作者；任务收件箱 UI 标签可映射但不得成为另一套状态机。
- 创作、编辑和模板批量动作不按内容风险拆分；缺少素材、能力或外部权限的不可执行项才从批次排除。公开发布不进入无需确认的创作批次。

#### GenerationJob and ProviderAttempt

- Job 覆盖 draft/queued/running/waiting/completed/failed/cancelled/unknown。
- Attempt 保存 acceptance 为 rejected_before_accept、accepted 或 acceptance_unknown；只有确认未接单或上游幂等已证实时自动重试。
- 上游 task ID 已返回后继续 poll/webhook/recovery，不跨供应方重投。
- Asset 成功进入自有存储后才满足媒体交付条件；临时 URL 不视为完成。
- composed video 中每个镜头候选都是独立可恢复 Attempt；technical validation 与人工标注集校准的 quality scoring 分离，分辨率通过不得推导固定美学分。

#### DouyinPublishJob

- 状态覆盖 draft、confirmation_pending、submitted、reviewing、published、failed、unknown、manual_required。
- 用户确认绑定账号、内容快照和发布时间；任一变化使确认失效。
- 已有 item_id/video_id 时 unknown 不触发重新发布；24 小时后显示待平台核验并支持手动刷新。
- 提交前失败、能力未激活或权限失效进入 manual_required 并生成 L3 handoff。

#### Connection

- 状态覆盖 pending_review、available、reauthorize_required、permission_missing、rate_limited、degraded、disabled、revoked。
- 单 capability/tool 故障只局部降级；身份整体失效才要求重新授权。
- 断开连接立即吊销/删除 secret，停止新调用并清除可再获取缓存；历史用户内容和最小活动事实保留。

#### Template and Tool revision

- 后台变更走 draft、enabled、published、retired；发布产生不可变 revision。
- 新 revision 只影响新作品或新工具调用；历史引用固定旧 revision。
- 飞书新增或变更工具先进入待发布目录，兼容性检查后统一上线。

### 6. Application interfaces

- **Task queries**：收件箱列表、任务详情、周条、周批次、周回顾和筛选计数。
- **Task commands**：开始、完成、归档、补素材、批量处理、确认候选、启停内置触发器。
- **Template queries/commands**：浏览已发布模板、读取版本、创建用户模板、保存作品、管理快捷项、主动升级/复制。
- **Model queries/commands**：读取目录与可用性、设置默认/收藏、报价、提交生成、查询/取消/重试任务、读取 Asset。
- **Admin model commands**：创建/发布 Catalog/Deployment/Price/Route revision、激活/停用 Operation、管理证据和 kill switch。
- **Credential commands**：write-only 保存、轮换、吊销、连接、重授权和断开；查询只返回掩码、状态、范围和时间。
- **Douyin commands/queries**：连接、启用 capability、确认/安排发布、刷新状态、读取 Observe、断开和生成 L3 handoff。
- **MCP commands/queries**：连接飞书、读取工具目录、管理快捷项、执行明确用户意图、确认后台高风险动作、查询活动和断开。
- **Ledger queries**：产品额度投影、事件明细、供应成本证据、对账差异和异常队列。
- **Worker commands**：认领、续租、写 attempt evidence、单调状态转换、写 Asset receipt、触发结算和 reconciliation。
- 所有写命令要求 workspace-scoped idempotency key 和 canonical payload hash；同 key 不同 payload 返回 conflict。

### 7. Interaction decisions

- 工作台主面是任务收件箱，紧凑周条只读；不建设拖拽日历。
- 创作、编辑、模板和草稿允许直接批量处理；公开发布始终由用户确认，飞书明确用户指令不重复弹窗。
- 模型选择采用任务快捷层 + 完整目录；Settings 承载工作区 BYOK，不让普通创作界面编辑 Key、Base URL 或物理 Channel。
- 模板和飞书工具的快捷展示由用户自定义，但后台目录决定正式可用项。
- 连接和任务错误必须给出可执行下一步；unknown 不能显示为 success 或 zero。
- 创作阶段不新增法务合规开发门禁；品牌水印/AIGC 标识是开关。发布阶段最终规则在功能完整后由法务审核并通过配置/策略接入。

### 8. Runtime and component reuse

- 保持单仓、单服务边界；HTTP 与 job-worker 为两个运行入口，初期一起部署并共享 Postgres。
- pg-boss 是持久任务主实现，Graphile Worker 是同一 Job Port 后的对照候选；禁止先自研 polling、cron、retry、DLQ 和 dashboard。
- 队列组件只负责可靠调度；Product Core 拥有业务 Job、Attempt、幂等、结算、撤权和审计。
- AI SDK 位于 ContentWorkflowRunner Runtime Port 后；业务模块不 import AI SDK、Mastra 或 provider SDK。
- “业务模块不 import provider SDK”不约束 Adapter 内部：Adapter 优先复用官方 `@ai-sdk/*`、fal 或原厂 SDK 归一化请求/响应，不裸写重复 fetch；AI SDK experimental 媒体接口不得成为 Product Core Port 契约。
- MCP client 优先复用 @ai-sdk/mcp；飞书使用官方远程 MCP，不以本地 npx server 作为云生产默认。
- Credential value 使用成熟 Secret Manager/KMS；Nango 只作为可替换 OAuth connection PoC，不能成为业务事实源。
- 模型执行通过 ProviderExecutionPort；Bifrost 主、LiteLLM 对照的隔离 PoC 是 P1 must-have，但生产晋升是 conditional。
- Managed Media Adapter（fal）是验证期可激活的 conditional 媒体执行通道；落地期按 ADR-0005 在同一 Port 后替换为国内原厂/官方云，历史 RouteSnapshot 与 Attempt 不改写。
- Composer 日常轻编辑优先复用成熟组件；无限画布/高阶精修由 Pro Studio 规格负责，P1 不建设专业视频时间线。

### 9. Migration and rollback

- 迁移采用 expand、可重复 backfill、差异校验、冻结新命令、排空/接管在途任务、整窗切换。
- 校验至少覆盖对象数、稳定 ID、状态、内容版本、Asset receipt、额度事件总和、terminal reservation 唯一性和 external ID。
- 不长期双写。旧 workspace JSON 只读保留为 legacy evidence，并设明确移除条件。
- 在途旧模型/视频任务保留原 task ref，只做 inspect、callback、download、Asset 落盘与成本对账，不取消后重投。
- 回滚仅切换后续提交入口。新系统已产生的 Job、Attempt、Asset、Connection 和 Ledger 继续由新 Owner 恢复；除非能证明切换后没有任何新事实，否则禁止用旧数据库快照覆盖。
- 验证期与国内落地期通过发布新的 Catalog/Route revision 切换，不改写运行中和历史任务。

### 10. Activation and release evidence

- 所有支持 Operation 必须先通过 fake/recorded contract、状态机、幂等、重复 callback、safe-only retry、取消和 unknown 测试。
- 未激活的模型、抖音 capability 或连接可以存在于后台并显示 evidence status，但不得进入用户可提交状态。
- 付费 Beta 的全部 must-have 旅程合计至少有一条真实可用路径；不要求每条旅程、所有候选模型和特殊锚点都激活。
- 发布证据包含租户隔离、workspace-role authorization、secret redaction、双账、迁移 dry-run、备份恢复、入口回滚和任务恢复。
- AIGC 证据覆盖的是内容 AIGC 状态、产品开关值、provider/platform provenance 和必要隐式元数据的完整记录，不等于产品可见 AIGC 开关必须始终开启。
- 内容质量证据包含真实文案主链接线、PromptVersion/ExampleSet revision、固定美业离线 eval、按模型/模板/场景归因的采用/改稿/换批/发布事实，以及视频 technical validation 与人工校准质量评分的分离。
- “直接采用 + 小改采用率 ≥60%”是 P1 成效观察，不是发布 Gate；样本不足必须显示 unknown，真实读数不阻塞 recorded/fake 功能实现，也不得伪造为已达标。
- **法务终审 owner/trigger**：P1 Product Owner 对触发与闭环负责，专门法务团队负责审核；在功能完整后启动，最迟绑定“封闭付费 Beta → 公开收费”商业事件完成。结果只进入发布阶段策略/配置，不反向阻塞创作开发。
- **Gate 0 owner/trigger**：P1 Product Owner 负责放行，法务/合规负责人提供算法备案、生成式 AI 服务登记、页面公示及仍有数据出境时的合同/备案证据；从封闭付费 Beta 转向公众注册或公开收费前必须全部完成。
- P1 功能完成不等于可公开收费。封闭付费 Beta 通过既定 P1 发布 Gate；公开收费上线另有硬门：Gate 0 未完成不得开放。

### 11. Evidence-gated future upgrades

- 采集 queue depth、oldest runnable age、claim latency、lease expiry、recovery count。
- 采集 DB transaction、workspace lock wait、pool wait、慢 SQL 和索引增长。
- 采集 Worker CPU/RSS、event-loop lag、任务并发、媒体时长和失败分类。
- 采集 Runner 分支/暂停/恢复缺陷和模块发布/回滚节奏。
- 采集搜索 Recall@K、无结果率和人工改查率。
- Mastra、Redis/BullMQ/Inngest、独立 Agent/Worker 服务、分库或 pgvector 只有在持续真实瓶颈、对照 PoC 明显改善和具备回滚三项同时成立时才能重开。

## Testing Decisions

### Test philosophy

- 测试外部可观察行为、领域事实和不变量，不测试组件内部实现。
- 最高 seam 是 Product Core Application Service；尽量用一个 seam 覆盖 Web/Admin/HTTP/MCP/Worker 的共同用例。
- 每个外部 Adapter 都提供 fake/recorded fixture；live test 显式、隔离、默认不在普通 CI 中运行。
- 所有故障测试同时断言产品结果、Product Usage 和 Provider Cost，避免只测 HTTP 状态。

### Application Service contract tests

- workspace A 无法读取或调用 workspace B 的任务、连接、凭据引用、Asset 和账本。
- 同 idempotency key + 同 payload 返回原结果；同 key + 不同 payload 返回 conflict。
- 创作与编辑任务可批量执行；缺素材、缺能力或外部权限不足的任务被排除并说明原因，内容提示本身不构成创作阻塞。
- trigger + workspace + time window 去重，通知失败不删除 ContentTask。
- 周回顾只引用真实记录，缺失事实为 unknown，候选确认后才进入批次。
- 模板 revision 不改写历史作品，主动升级产生新引用。
- 固定模型失败不跨 CatalogModel；LLM Auto 保存 actual model 和 RouteSnapshot。
- BYOK strict 不回落平台 Key，失败时 Product Usage/Provider Cost 符合真实接单和交付状态。
- reserve 的 terminal commit/refund/expire 互斥且幂等；adjustment 只追加不改写历史。
- 供应成本迟到或调整不重跑模型、不反向改写产品交付。
- 顾客人脸、PII 或医疗健康输入在 RouteSnapshot 冻结前按 `data_class` 被硬过滤出海外 Deployment；脱敏后重试产生新的可审计输入 revision。
- 文案结果保存 platform、prompt/example revision 和 requested/actual model；warning 只做非破坏性标注，不自动篡改“第一次”等正常原文。

### State-machine tests

- ContentTask、GenerationJob/Attempt、DouyinPublishJob、Connection、TemplateRevision 和 ToolRevision 的合法与非法转换。
- provider accepted/acceptance_unknown 后不盲重投；重复/乱序 callback 单调收敛。
- 上游成功、自有 Asset 写入失败时只恢复下载/存储，不重新生成。
- 抖音已有作品 ID 后 unknown 不重复发布；提交前失败进入 L3。
- 飞书单工具 403/schema failure 只局部降级，401 身份失效才要求重授权。
- 写工具结果不明时查询账本或外部对象，不自动重复创建或更新。

### Adapter contract tests

- 所有录取模型 Adapter 覆盖文档化 operation、请求/响应归一化、capability、错误、usage/cost 和 recorded fixture。
- Douyin Adapter 覆盖 OAuth callback、refresh、撤权、Scope 缺失、429、重复事件、reviewing/unknown 和 L3。
- Feishu MCP Adapter 覆盖 UAT、工具目录、allowed-tools、schema revision、读取、创建、编辑、单工具降级和断开。
- Secret Adapter 覆盖 write-only、AAD workspace binding、轮换、吊销、掩码和日志脱敏。
- Storage Adapter 覆盖 workspace object key、hash/size receipt、临时 URL 恢复和重复写幂等。
- Managed Media Adapter 覆盖 fal Queue/prediction、webhook/poll、ProviderTaskRef、Asset 回存、取消、unknown、usage/cost 和 `data_class` 拒绝路径。

### Postgres and job integration tests

- 新业务表的 workspace 索引、唯一约束、append-only 约束和 terminal event 互斥。
- pg-boss 在同一事务创建任务、认领、续租、退避、延迟、cron、dead-letter/redrive 和进程重启恢复。
- Graphile Worker 对照 PoC 使用同一 Job Port 和核心故障集，比较接合成本而非只跑 happy path。
- 外部 provider 调用和媒体执行不持有 workspace advisory transaction lock。
- HTTP 入口中断后 job-worker 可继续任务；worker 重启后可从持久状态恢复。
- outbox 重放不重复创建外部副作用或账本 terminal event。

### Search tests

- 固定中文 query set 覆盖项目别名、同义词、错别字、标签、授权状态、平台、日期和空结果。
- 记录 FTS/trigram + 标签的 Recall@K、无结果率和人工改查率。
- 在没有基线失败证据前不添加 pgvector 断言或 RAG 依赖。

### End-to-end journeys

- Owner 从内置触发器进入任务收件箱，处理一周创作/缺素材/待发布混合批次并生成周回顾；内容创作不被额外审核，公开发布单独确认。
- Owner 从官方模板开始，在 Composer 日常轻编辑中调整文字/图片/裁切/顺序，调用 AI 图片、保存用户模板并导出作品；无限画布由 Pro Studio 规格单独验收。
- Owner 选择固定图片/视频模型，完成报价、reserve、异步生成、Asset 落盘和双账结算。
- Owner 使用 strict BYOK，验证不可用时不回落平台 Key。
- Owner 连接抖音，确认一次普通视频，经历 reviewing/unknown/published 或提交前失败转 L3，并读取全账号 Observe。
- Owner 连接飞书，查看全部正式工具、设置快捷项、直接执行明确的文档读取/创建/编辑，并查看活动记录。
- Data hygiene journey：捕获所有 provider/managed-media 请求，验证顾客 PII、人脸和医疗健康素材不会发送到海外 Deployment；该 P0 must-have 原样平移到 P1。
- Quality journey：真实文案主链生成三条实质差异候选，保存 prompt/model/template/scenario attribution；采用、小改、换一批与发布事件可回放，正常“第一次”文案不被规则改写。
- Admin 发布模型、模板或飞书工具新 revision，历史任务、作品和快捷项保持稳定。
- 迁移 dry-run、冻结、整窗切换、入口回滚和 legacy in-flight recovery 完成且不覆盖新事实。

### Prior art

- 复用现有 Core HTTP/ProductService 的授权、幂等和状态转换测试形态，但将断言提升到新的 Application Service 和关系表投影。
- 复用现有视频 renderer/provider integration test 的 recorded/live 分层和 artifact receipt 验证。
- 复用现有 Postgres repository test 的真实事务与 workspace 隔离方式，扩展到任务、连接和双账。
- 前端 E2E 继续使用项目现有单 Worker Playwright 配置，按 must-have 用户旅程建立稳定种子数据。

## Out of Scope

- 多门店、Agency、可配置席位、自定义 ACL、多级法务流程和复杂审批编排。
- 完整内容日历、拖拽排期、统一评论/私信收件箱、自动回复和复杂因果归因。
- 小红书、点评、微信生态的新增官方 Publish/Observe/Engage/Attribution；小红书和点评继续图文/L3。
- L2 浏览器辅助、浏览器扩展、云端浏览器、Cookie/Profile 托管和 Browser Profile Vault。
- 任意 MCP URL、任意 Source、API Discovery、用户可配置 Automations、脚本和通用动作编排。
- Engage/Attribution 业务表、跨店同行 feed、行业模板市场和跨租户内容网络。
- 机构 API/产品 API key；它属于真实企业客户触发的独立 effort。
- P1 mainline 不提供 TTS 口播试听、数字人口播、专业视频时间线和重视频编辑；TTS+音效与高自由度精修仅在 Pro Studio 独立加购规格内，不能回写为 P1 must-have。
- Mastra、Redis/BullMQ/Inngest、独立 Agent/Worker 服务、分库和 RAG/pgvector，除非新的触发证据通过 Scope Reopen。
- 个人成员 BYOK、任意 Base URL、图片/视频跨品牌 Auto 和用户自定义 fallback set。
- 在本规格内确定最终套餐额度数值、加量包价格、Pro 定价或真实供应商合同。
- 在功能完整前执行法务终审，或用法务待审反向限制创作功能开发。

## Further Notes

- P1 功能录取与真实商户成效验证分离。真实样本当前仍不足，不能把功能验收写成已证明商业成效。
- 高用量 Pro 的价格阶梯仍可在 ¥799/¥999/¥1299 附近测试，但不属于本实施规格的固定值。
- 自托管模型网关必须完成 Bifrost 主、LiteLLM 对照的隔离 PoC；PoC 通过不等于生产晋升。
- 抖音 Observe 的公开文档存在接口漂移。实现必须依赖后台 activation/evidence，不在代码中写死未经当前控制台验证的 endpoint/scope。
- 飞书远程 MCP 的工具 schema 可能变化。后台目录和 Adapter revision 必须隔离变化，不能让单工具升级拖垮整条连接。
- 后续任务拆分应按 Application Service 用例和可验证垂直切片组织，不按“先建所有表、再建所有后端、最后做前端”的水平层切分。
