---
title: 美业宣发经营 Agent P0 整改规格：发布可信度与统一执行主干
status: ready-for-agent
priority: P0
date: 2026-07-22
scope: 当前审计优先级 P0；不是历史 P0 产品阶段的重开
source_of_truth:
  - 2026-07-22 全面差距复核与优化报告
  - 合并权威产品设计 D-001~D-099
  - ADR-0006 / ADR-0007 / ADR-0008 / ADR-0009 / ADR-0010 / ADR-0011 / ADR-0012
  - UI/用户旅程重建、ContentPackage 产品化、后台供应控制与全量功能开发规格
tracker_issue: https://github.com/leelv007-cmd/meiyeweb-agent/issues/129
---

# 美业宣发经营 Agent P0 整改规格：发布可信度与统一执行主干

> 本规格把 2026-07-22 全面差距复核中的 P0 项转成可开发、可迁移、可验收的执行合同。这里的 `P0` 表示当前最高整改优先级，不表示重启历史“P0 保 8”产品阶段，也不推翻已经接受的 ContentPackage、DBOS、Provider Registry、ProductQuote、Usage/Cost ledger、SSE 与权利审计架构。
>
> **创作主线边界（D-170 修订）**：本规格所称“统一提交主干”“所有新创作 Task”均指 Composer 发起的主线营销创作（定制创作 + 自由创作薄路径）。**Pro Studio 两线/画布并行为历史表述，已全量退役（D-170）**——见 `docs/specs/pro-studio-retirement-spec-2026-08-01.md`。共享 Product Core（身份与工作区隔离、CatalogModel、报价与路由、ProviderAttempt、Usage/Cost ledger、OwnedAsset、Capability、审计和 ContentPackage revision port）仍生效；禁止新 advancedCanvas adoption 写 ContentPackage；历史血缘只读。

## Problem Statement

门店内容操作者已经能在当前产品中选择文案、图文或视频，套用 Recipe、上传素材、确认报价并进入 Result Center，但界面上的选择尚未成为后端执行的唯一事实。平台、交付物、Recipe、Surface、素材槽位、品牌或个人 IP、报价与路由分散在本地草稿、Operations 命令、Harness、ContentPackage 和供应执行中；部分字段仍被硬编码或从自然语言意图反推。这会造成“用户选的是一套，系统执行和收费的是另一套”的高风险错配。

当前同时存在 Composer→Operations/Model Supply 与五阶段 Harness 两条顶层编排路径。文案已能经过 Harness，图片和视频则主要走独立运行时。两条路径都可能形成结果或写入 ContentPackage，使恢复、DecisionTrace、QuestionCard、计费、供应路由和结果版本无法天然共享同一组不变量。

本地开发环境已具备较厚的功能实现，但当前 main 的测试、静态检查、密钥扫描、包体预算和远端质量工作流不是绿色基线；Web、Core、Worker 对制品存储的理解也不一致。Web 上传使用对象存储，而 Core/Worker 仍可依赖本地文件系统，导致多实例、滚动发布和进程重启时无法保证同一 Asset 可见。生产资源映射、不可变构建、readiness、迁移、回滚和真实 Provider 证据尚未形成同一发布门。

用户界面同时暴露 Work/Asset UUID、内部状态枚举、模型 slug、空的 History/Run Detail 动作和失效的移动“进度”入口。即使底层能力存在，这些表现也会直接破坏用户对结果、费用和产品完整性的信任。

因此，当前问题不是继续扩充模板或功能，而是先恢复一个可审计的绿色提交基线，并让“用户选择—系统执行—内容结果—费用—交付证据”成为一条唯一、可恢复、可回放的生产事实链。

## Solution

建立一个由 `CreationExecutionSnapshot` 驱动的单一创作提交与执行主干：

- Composer 在提交前完成 Recipe、Surface、Lens、目标平台、交付物、来源素材、权利摘要、表达身份、模型策略、目录版本、报价、路由和 Brief 确认的服务端校验。
- 主线 Composer 唯一调用 `CreationSubmissionCoordinator`；Coordinator 在同一个幂等命令中冻结 `CreationExecutionSnapshot`，创建或关联 Work 与 ContentPackage shell，确认额度预占，并启动 DBOS 五阶段 Harness。
- 由 Composer 发起的文案、图片、视频全部实现同一 Harness StagePort 合同；Operations/Model Supply 只作为主线领域能力端口，不再承载第二条主线顶层工作流。历史 Pro Studio 节点生成路径已退役（D-170），不得再复制或续命共享账本/资产/供应/审计旁路。
- 所有 ContentPackage revision 只经过一个业务写入端口，继续使用 OCC、不可变 revision、来源血缘和权威审计。
- staging/production 统一使用 S3-compatible 对象存储；本地文件系统仅允许开发和测试。Core API、Worker 和 Web 读取同一 OwnedAsset receipt。
- 根级 CI 把干净安装、类型检查、构建、测试、持久化、静态检查、密钥扫描、包体预算、Web 和主旅程 E2E 合成同一 required gate（Canvas 已退役，不再是 required unit）。
- 关闭三个已知高风险安全问题，并用攻击场景回归测试证明修复，而不是只修改分支判断。
- 把运行真相投影为商家语言：商家页面不再显示 UUID、内部枚举或供应商模型 slug；所有可见 CTA 必须有真实完成路径，否则隐藏或明确不可用。
- 用 `/health/live`、`/health/ready`、`/capabilities` 区分进程存活、环境可交付和商家可用能力；recorded 证据不得被投影为 live verified。
- 在受保护环境运行真实文案、图片、视频 Provider gate，绑定 commit、环境、成本帽和证据有效期，形成 staging 发布依据。

## User Stories

### 执行选择与冻结

1. As a 门店内容操作者, I want 提交前看到最终创作类型、平台、交付物、素材、身份、模型和费用摘要, so that 我知道系统即将执行什么。
2. As a 门店内容操作者, I want 我选择的 Recipe revision 被服务端原样冻结, so that 后台发布新版 Recipe 不会改变在途任务。
3. As a 门店内容操作者, I want 我进入时使用的 Surface revision 被任务记录, so that 后续可以解释当时为什么出现这些入口和默认值。
4. As a 门店内容操作者, I want 文案、图文、视频 Lens 必须由我显式选择, so that 系统不会从一句话中替我猜媒介并改变费用。
5. As a 门店内容操作者, I want 目标平台由结构化选择进入执行合同, so that 意图里有没有写“小红书”都不会改变平台真相。
6. As a 门店内容操作者, I want 交付物种类、数量、顺序、比例和时长在提交时冻结, so that 结果包与报价一致。
7. As a 门店内容操作者, I want 当前采用的品牌 IP 或个人 IP revision 被清楚记录, so that 成品不会使用错误人物口吻。
8. As a 门店内容操作者, I want 来源素材与来源 ContentPackage 精确绑定 revision, so that 后续复用不会静默读取已经变化的内容。
9. As a 门店内容操作者, I want 素材的授权范围与有效期摘要随任务冻结, so that 发布前可以判断该版本当时是否可用。
10. As a 门店内容操作者, I want 模型策略、目录模型 revision、报价 revision 和路由 revision 可追溯, so that 我能解释实际模型与费用。
11. As a 门店内容操作者, I want Brief 确认只对精确输入 revisions 有效, so that 输入变化后不会沿用过期确认。
12. As a 门店内容操作者, I want 对同一提交重复点击只得到同一个任务与费用预占, so that 网络抖动不会重复生成或扣费。
13. As a 支持人员, I want 从一次执行快照回放 Brief、路由、结果和费用回执, so that 用户投诉可以基于同一事实处理。
14. As a 系统审计人员, I want 执行快照不可原地修改且所有派生任务引用上一版本, so that 历史证据不会被覆盖。

### 必需素材与复用入口

15. As a 门店内容操作者, I want Recipe 宣称需要案例图时必须提供至少一张符合授权要求的案例图, so that 系统不会交付与入口承诺不一致的内容。
16. As a 门店内容操作者, I want 缺少必需素材时看到用户语言的缺口说明和补充入口, so that 我不用理解内部 slot id。
17. As a 门店内容操作者, I want 非必需素材缺失时得到安全回退说明, so that 可完成的任务不会被过度阻塞。
18. As a 门店内容操作者, I want 服务端再次验证素材类型、数量、工作区、权利和有效期, so that 绕过前端也不能提交无效输入。
19. As a 门店内容操作者, I want “旧内容换平台”先让我选择一条真实 ContentPackage revision, so that 入口不会在没有来源时变成死路。
20. As a 门店内容操作者, I want 没有可复用内容时该入口明确不可用并引导我先创作, so that 页面不展示点击后必然失败的能力。
21. As a 门店内容操作者, I want 换平台只复用结构、风格和明确选择的素材角色并重新注入当前事实, so that 旧价格和旧活动不会被带入新成品。

### 单一编排与三模态恢复

22. As a 门店内容操作者, I want 文案、图片和视频都从同一个提交入口开始, so that 三种创作遵循一致的确认与恢复规则。
23. As a 门店内容操作者, I want 三种媒介都经历意图正名、上下文注入、Brief 编译、执行择优、回装交付五阶段, so that 安全与质量门不会只覆盖文案。
24. As a 门店内容操作者, I want 每个任务同一时刻最多出现一个阻塞问题, so that 我不会面对平行审批和重复确认。
25. As a 门店内容操作者, I want 关闭页面或服务重启后继续同一个 Work 和 ContentPackage, so that 长任务不会丢失或生成第二份结果。
26. As a 门店内容操作者, I want 已被供应商受理的任务只恢复查询、下载或合成, so that 系统不会因状态未知而重复投递。
27. As a 门店内容操作者, I want 图片和视频失败恢复与文案共享同一状态语义, so that 任务中心不需要理解三套运行状态。
28. As a 门店内容操作者, I want 所有进度通过同一 SSE 事件序列接收并支持断线续传, so that 刷新后不会错过关键状态。
29. As a 门店内容操作者, I want 任务失败时保留已经成功且可用的子产物, so that 重试只补失败部分。
30. As a 门店内容操作者, I want 取消、失败、恢复和成功都与一次费用预占单调收敛, so that 一个任务只有一个最终结算事实。
31. As a 工程师, I want Operations/Model Supply 只实现能力端口而不创建第二条顶层流程, so that 编排不变量只有一个所有者。
32. As a 工程师, I want ContentPackage 只通过一个带 OCC 的写入端口产生 revision, so that Harness、视频和快捷编辑不会各自复制聚合规则。
33. As a 工程师, I want 每个阶段使用稳定 effect key 且可安全重放, so that at-least-once 执行不会制造重复副作用。
34. As a 支持人员, I want 同一 Work 的失败、恢复、结果和交付都能沿一个 correlation 链查询, so that 不需要跨三套日志拼接事实。

### 共享资产与生产运行

35. As a 门店内容操作者, I want 无论请求落到哪个 API 或 Worker 实例都能读取同一素材和成品, so that 扩容或发布不会出现文件消失。
36. As a 门店内容操作者, I want 实例重启后图片、音频、视频、封面、字幕和 ZIP 仍可下载, so that 已交付内容不会依赖临时磁盘。
37. As a 门店内容操作者, I want 只有对象完整写入并校验后 Asset 才显示可用, so that 数据库不会指向不存在或损坏的文件。
38. As a 门店内容操作者, I want 对象写入成功但数据库提交失败时系统能安全清理孤儿对象, so that 存储不会长期累积不可追溯文件。
39. As a 系统管理员, I want staging 和 production 启动时拒绝 filesystem 存储模式, so that 错误配置不会带着本地磁盘进入生产。
40. As a 系统管理员, I want Core API、Worker 与 Canvas 使用绑定同一 commit 的不可变构建, so that 一次发布的版本组合可重建。
41. As a 系统管理员, I want 数据库迁移在服务切换前按固定顺序执行并可回滚后续入口, so that 发布失败不会覆盖新业务事实。
42. As a 系统管理员, I want `/health/live` 只表达进程存活, so that 编排器能正确处理进程生命周期。
43. As a 系统管理员, I want `/health/ready` 检查业务数据库、DBOS、对象存储、Worker、schema 和必要能力, so that 未具备交付条件的实例不接流量。
44. As a 门店内容操作者, I want `/capabilities` 只把有当前证据的能力显示为已验证, so that recorded 或 disabled 配置不会被包装成线上可用。

### 安全、质量门与界面真相

45. As a 系统管理员, I want 所有 IPv4-mapped IPv6 的私网、回环和云元数据地址都被安全请求层拒绝, so that 供应商下载不能绕过 SSRF 边界。
46. As a 系统管理员, I want 每次 DNS 解析和重定向跳转都重新执行地址与主机校验, so that 首跳安全不能掩盖后续跳转风险。
47. As a 付费用户, I want Stripe Customer 只按我的不可变用户身份绑定并验证远端 metadata, so that 同邮箱或历史客户不会进入我的账单主体。
48. As a 付费用户, I want 并发首次结账只产生一个最终 Customer 归属, so that 不会出现重复或交叉绑定。
49. As a 付费用户, I want 支付 Webhook 在签名验证成功后才参与去重和状态处理, so that 伪造事件不能占用真实事件的幂等位置。
50. As a 付费用户, I want processing 或处理失败的 Webhook 返回可重试结果而不是静默成功, so that 权益事件不会永久丢失。
51. As a 开发者, I want 干净 checkout 和冻结依赖安装能够通过所有 required checks, so that 本机缓存不会掩盖依赖泄漏。
52. As a 开发者, I want Web、Core、Contracts、Canvas、持久化、静态检查、密钥扫描和包体预算在普通 PR 上共同阻塞合入, so that 发布质量不是手工拼接。
53. As a 开发者, I want 测试夹具使用明确无效的示例值或窄范围声明, so that 密钥扫描既不误报又不会被全局放宽。
54. As a 手机用户, I want “进度”入口打开当前任务或任务中心的真实状态, so that 底部导航不会把我送回无关页面。
55. As a 门店内容操作者, I want Result 只显示用户语言的状态、模型展示名和可执行下一步, so that UUID、枚举和供应商 slug 不干扰判断。
56. As a 门店内容操作者, I want History、Run Detail 和其他可见动作有真实内容与返回路径, so that 页面不再出现幻象交互。
57. As a 门店内容操作者, I want 未实现能力被隐藏或标为不可用并解释原因, so that 每个可见 CTA 都值得信任。
58. As a 键盘或读屏用户, I want Bottom Sheet 和 Dialog 只有一个模态语义、完整 focus trap 与关闭后焦点恢复, so that 我不会被困在叠层中。
59. As a 深色模式用户, I want Portal 中的选择器和弹窗继承当前产品主题, so that 浮层不会突然回退到旧视觉系统。
60. As a 移动网络用户, I want 主 JavaScript 包保持在既定 gzip 预算内, so that 首次可交互时间不会被不必要代码拖慢。

### 真实供应与发布证据

61. As a 发布负责人, I want 真实文案、图片、视频官方主渠道测试在受保护环境运行并受成本帽约束, so that live 证据可用且不会失控消费。
62. As a 发布负责人, I want 每个放行能力保存 commit、环境、Provider、目录与路由 revision、时间和证据有效期, so that 旧录制结果不能替代当前版本。
63. As a 发布负责人, I want 每种媒介至少一个官方主渠道完成真实生成并留下任务、结果与费用证据, so that 发布门证明真实连通而不是只证明配置存在。双渠道故障切换保留为非阻塞增强项。
64. As a 发布负责人, I want 同一 commit 完成 required CI、staging 部署、readiness、主旅程 smoke 和 provider live gate 后才能标记 release candidate, so that 发布结论绑定同一份代码真相。

## Implementation Decisions

### 1. Priority and authority

- 本规格是 2026-07-22 审计产生的 P0 整改增量，不覆盖历史 P0/P1 产品规格；冲突时以 D-072~D-099、ADR-0010~0011、**D-170（Pro Studio 退役）** 和本规格的整改边界为准。
- 保留当前 Workers/BFF、Node Core、DBOS、PostgreSQL、ContentPackage、Provider Registry、双账、SSE 和审计结构；禁止以整改为由替换整个运行时或新增第二聚合。
- 现有全量功能父项、Provider live gate 和同一增量验收项继续作为依赖证据源；本规格只补齐当前审计确认的未闭环合同，不重复实现已关闭票据。
- **Pro Studio 两线表为历史口径（D-170 RETIRE）**：画布工程/节点生成/过程 ZIP 不再作为现行产品面。共享平台不变量仍禁止第二套 Catalog、Quote、Route、Usage、Cost、Asset、Capability 或审计事实。退役实施见 `docs/specs/pro-studio-retirement-spec-2026-08-01.md`。

| 关注点 | Composer 主线（现行） | Pro Studio（历史/已退役） | 唯一共享属主 |
| --- | --- | --- | --- |
| 执行输入 | `CreationExecutionSnapshot` | 历史：`AdvancedCanvasProjectRevision + GenerationCheckpoint` | 主线应用层；引用同一 actor/workspace/catalog/quote/route 事实 |
| 顶层编排 | DBOS 五阶段 Harness | 历史：Canvas BackendPort（已退役） | Provider/ledger/storage 等领域端口 |
| 计费单位 | 一 Task 一 reservation | 历史：一 GenerationJob/item 一 reservation | Product Usage ledger |
| 媒体事实 | OwnedAsset | OwnedAsset（历史画布来源只读血缘） | Asset Storage Port / receipt |
| 成品写入 | Harness/确定性手改等调用 revision port | 禁止新 adoption；历史 advancedCanvas 血缘只读 | Product Core ContentPackage revision port |
| ZIP | 成品交付 manifest | 历史过程资产 manifest（不再交付） | 确定性打包纯函数可保留 |

### 2. `CreationExecutionSnapshot` is the execution root

- 新增不可变 `CreationExecutionSnapshot` 作为一次由 Composer 发起的付费或可交付营销创作执行的根事实。它在正式启动 Harness 前由服务端一次创建；任何会改变执行语义的修改必须创建新 Task 或新 snapshot revision，不能原地覆盖。自由创作薄路径不伪造完整 Recipe/Surface 营销字段；历史画布节点 checkpoint 路径已退役（D-170）。
- Snapshot 至少引用：workspace 与 actor、Surface revision、Recipe revision、显式 Lens、原始意图、来源对象与 revision、权利摘要 revision、平台目标、有序交付物合同、content modules、表达身份 revision、模型策略、CatalogModel revision、ProductQuoteSnapshot、RouteSnapshot、Brief confirmation revision、创建时间与 schema version。
- Snapshot 只保存稳定标识、revision 和必要摘要，不复制素材二进制、密钥、完整供应商响应或可变前端草稿。
- ContextBundle 是 Harness 上下文编译结果，RouteSnapshot 是供应路由事实，ContentPackage 是成品聚合；三者都引用同一 CreationExecutionSnapshot，但不互相取代。
- 平台、交付物和 content modules 禁止从自由文本正则、展示文案或前端默认值反推。`social_cover` 等默认只允许来自已发布 Recipe revision，并必须出现在 snapshot 中。

### 3. Required source slots are a server gate

- Recipe revision 定义结构化 source slot：用户标签、允许对象类型、最少/最多数量、是否必需、权利要求、允许平台、用途与安全回退。
- 前端可提前计算缺口用于引导，但正式提交由服务端按 snapshot 输入重新计算。缺失必需项返回稳定错误码、用户语言说明和可定位的 slot；不创建付费 Job、不预占额度。
- 非必需 slot 可使用 Recipe 明确声明的安全回退；回退选择与原因进入 DecisionTrace。
- “旧内容换平台”必须携带明确 ContentPackage revision；没有候选来源时入口禁用或转为“先创作一条内容”，不能提交空来源。

### 4. One submission coordinator

- Composer 唯一调用 `CreationSubmissionCoordinator`。Coordinator 负责校验 workspace/role、幂等键、snapshot、Brief、报价有效性、required source、能力状态和额度，然后原子创建或关联 Work、ContentPackage shell、Task 与 usage reservation。
- 同 workspace、同 idempotency key、同 canonical payload 返回原提交结果；同 key 不同 payload 返回 conflict。
- Coordinator 启动 DBOS Harness 后返回稳定的 Work、Task、ContentPackage 和 snapshot 标识。客户端不再串行调用“创建 Work—确认报价—提交 Work”来拼装业务事务。
- 旧 Operations 提交命令进入兼容期只读或内部适配层；新 Composer 不得继续调用。兼容窗口结束后删除用户可达写入口。

### 5. One DBOS Harness for copy, image and video

- 五阶段 Harness 是所有由 Composer 新建的营销创作 Task 的唯一顶层编排器。Operations/Model Supply、视频 durable workflow、ffmpeg 和 Provider Adapter 均降为 StagePort 或能力端口。历史 Pro Studio 节点级 GenerationJob 不属于此处的营销 Task（路径已退役，D-170）。
- Copy、Image、Video StagePort 共享输入 envelope、稳定 effect key、progress/token/state/question/revision 事件语义、恢复与 terminal failure 合同。
- 视频逐镜头 checkpoint 与合成可以保留内部子状态，但必须向 Harness 投影同一个 Task/Work/ContentPackage；不得创建第三套商家结果状态。
- 已受理或 `acceptance_unknown` 的 ProviderAttempt 禁止跨供应商盲重投。恢复只执行查询、回调核验、下载、对象入库或后续合成；确认未受理后才可按原冻结策略重试。
- 文案 token 事件属于用户可见增量；图像和视频只发白话阶段事件，不制造假百分比。

### 6. One ContentPackage revision port

- Product Core 保持 ContentPackage 唯一物理写入所有者。Harness 第五阶段、确定性手改、采用、视频合成和交付动作都调用同一个 revision port。
- 历史 Pro Studio 节点/候选/检查点/工程 ZIP 不自动产生 ContentPackage revision；**禁止新 adoption** 调用 revision port（D-170）；既有 `advancedCanvas` 血缘只读。
- Port 强制 workspace 隔离、expected revision、幂等键、derived-from、snapshot reference、来源血缘、rights/compliance state 和审计事务。
- 历史 CreativeContent、ContentItem 和独立视频结果继续只读迁移，不恢复双写。
- Result、Content 和 Assets 只读取公共投影；Provider、成本和内部路由字段在公共 DTO 转换时移除。

### 7. Usage, quote and receipt consistency

- ProductQuoteSnapshot 与 RouteSnapshot 在提交前有效，Coordinator 绑定后不可静默替换；任何超出报价上限或候选集合的改动要求新报价和新确认。
- 一个 Composer Task 只有一个 Product Usage reservation，terminal commit/release/expire 互斥且幂等；attempt 级 Provider Cost 独立记录。前端可以把 `release` 解释为“额度退回/退款”，但不得另造 ledger `refund` 终态。
- 历史 Pro Studio batch 计费语义（一 item 一 reservation）仅作账本对账参考；现行产品无画布 batch 入口（D-170）。
- 恢复、轮询、重复下载、确定性采用和同一供应任务的对象回存不产生第二次产品费用。
- 同一 snapshot 必须能关联最终 result revision、usage receipt、provider cost evidence 与 delivery receipt。

### 8. Shared object storage

- 保留现有 Asset Storage Port，新增并启用 S3-compatible adapter；Cloudflare R2 是 Web 所在环境的默认实现，契约保持可兼容其他 S3 服务。
- development/test 可以显式使用 filesystem；staging/production 未配置共享对象存储时启动失败。
- 对象键包含 workspace 隔离前缀和不可变内容身份；receipt 至少包含 object key、content type、byte size、hash、storage revision 与创建时间。
- 生成制品先写入确定性对象键并完成大小/hash 校验，再在业务事务中登记 Asset receipt。只有主线交付物形成或确定性成品修改时，才另外通过唯一 revision port 写 ContentPackage（Pro Studio adoption 写口已退役，D-170）；数据库不得先暴露尚不存在的对象。
- 对象成功而数据库失败时写入可重放清理账本；定期清理只删除超过安全窗口且没有任何 receipt 引用的对象。
- ffmpeg 使用进程级临时目录物化输入与输出，完成上传或失败后清理；不得把临时路径写成业务事实。
- 契约测试使用 S3-compatible 本地服务，覆盖 API 与 Worker 跨进程读取、重复写、失败恢复和孤儿清理。

### 9. Deployment and readiness

- Web/BFF 保持 Cloudflare Workers；Core API 与 Worker 使用同一不可变 Node OCI 构建的不同启动命令；Canvas 使用绑定同一 commit 的独立构建。四个单元的版本组合写入 release manifest。
- Core 的正式启动不得依赖开发期 TypeScript runner；构建必须产生可部署产物。
- 根级流水线顺序固定为 migration preflight、deploy、readiness、smoke、release manifest；失败时只回滚后续入口，不用旧数据库快照覆盖切换后新事实。
- `/health/live` 不访问外部依赖，只表达进程生命。
- `/health/ready` 检查业务 PostgreSQL、DBOS system DB、schema compatibility、共享对象存储读写探针、Worker lease freshness、必要 Provider 模式、关键 outbox 积压阈值和 Canvas 可达性；任何生产必需项缺失返回非就绪。
- `/capabilities` 输出商家能力三态 `verified / assisted / unavailable` 与安全说明；内部证据层另存 `implemented / recorded_verified / live_verified / merchant_validated`，不能混用。

### 10. Security closure

- SSRF 修复先规范化所有 IPv4-mapped IPv6 表示，再复用 IPv4 公网判断；每次 DNS 全结果与每个重定向跳都重新校验。私网、回环、链路本地、云元数据和保留地址拒绝，拒绝前不调用 transport。
- Stripe Customer 归属以已认证的不可变 user id 为唯一键。远端 Customer 必须带相同应用用户 metadata；创建使用 user-scoped idempotency key；本地按 user id 条件绑定，并在清理重复数据后增加非空 customer id 唯一约束。禁止按邮箱自动认领历史 Customer。
- Payment Webhook 必须先对原始 body 做大小限制和签名验证，再执行事件去重。只有已完成事件可以幂等返回成功；processing、失败或租约过期事件按可恢复状态处理并让 Provider 重试，不得静默吞掉。
- 三项安全问题分别增加最小复现测试和负向回归；没有测试证据不得关闭风险。

### 11. CI and release gate

- 普通 PR 的根级 required gate 至少包含 frozen clean install、Contracts/Core/Web/Canvas typecheck、build、unit/integration tests、真实 PostgreSQL/DBOS persistence tests、Biome/check、secret scan、bundle budget、Web interaction tests 与主旅程 Playwright。
- 持久化 job 必须用断言证明数据库和 DBOS 测试确实执行，不能依赖环境变量静默 skip。
- Secret scan 仅允许显式、窄范围、可审计的测试夹具例外；禁止全目录或通用正则白名单。
- Web 初始主包 gzip 预算维持 350 KB。超预算必须拆包或得到带数据的预算修订，不以“构建成功”代替性能门。
- release candidate 必须绑定同一 commit 的 required CI、staging manifest、readiness、E2E、provider live evidence 与恢复演练；历史截图和 fixture 只能作为辅助证据。

### 12. User-visible truth and interaction safety

- 商家页面禁止展示 Work/Job/Asset UUID、原始 phase/panel/workspace/status 枚举、Provider 标识、模型 slug、stack trace 或内部 error code。支持诊断通过权限隔离的详情页或可复制 support reference 提供。
- 所有状态经统一 ProductStatus 映射为简短用户语言，并给出唯一下一动作。
- 移动“进度”入口必须解析到当前进行中任务；无当前任务时进入真实任务中心。URL 参数必须被目标路由消费。
- History、Run Detail、选区改写、复用与其他 visible CTA 必须拥有可测试行为；无法在本阶段完成的入口隐藏或以不可用状态解释，不保留点击后空白。
- Dialog/Bottom Sheet 统一使用一个模态 primitive，包含 focus trap、Esc/返回、背景不可交互、关闭后 focus return；禁止嵌套 `aria-modal`。
- Portal 必须携带产品主题 token，浅色和深色截图均不得回退到模板主题。

### 13. Cutover and compatibility

- 先以 characterization tests 锁住现有 Composer、Operations、Harness、ContentPackage、Usage 和 video recovery 行为，再引入 Coordinator。
- Cutover 采用“新提交单写新主干、历史任务原 owner 恢复、公共投影兼容读取”的策略，不长期双写。
- 在途旧任务继续由其原运行时完成，但新用户提交不得再进入旧顶层路径。迁移完成条件是生产流量中旧提交命令调用为零，并保留一个明确回滚窗口。
- 回滚只能切换新提交入口；已经由新主干产生的 snapshot、Task、Asset、ledger 和 ContentPackage revision 继续由新 owner 恢复。

## Testing Decisions

### Test philosophy and primary seam

- 好测试只断言用户可观察结果、公共合同、账本事实和持久化不变量，不断言 DBOS 内部状态机、React 组件私有 state 或 Provider SDK 调用细节。
- **唯一主验收 seam 是认证后的 Composer 提交 HTTP 命令 + SSE 事件流 + 最终公共 ContentPackage 投影。** 同一套旅程对文案、图文和视频参数化运行。只要该 seam 证明输入选择、恢复、结果和费用一致，就不再为 Operations 与 Harness 分别建立重复的端到端测试面。
- 五阶段纯函数、Storage Port、Payment 与 Safe Fetch 保留较低层合同测试，用于快速定位不变量；它们不替代主 seam。

### Contract tests

- Composer Snapshot schema 拒绝缺失 Recipe/Surface/Lens/platform/deliverables/identity/quote/route/rights revision 的付费提交；自由创作薄路径字段合同单独约束（不恢复画布 GenerationCheckpoint 旁路）。
- 同一 canonical payload 的字段顺序变化不改变 payload hash；实际语义变化必须产生 conflict 或新 snapshot。
- 自由文本包含不同平台词时，结构化平台选择仍决定输出平台。
- Recipe revision 更新后，在途 snapshot、Brief、报价和结果保持旧 revision。
- required source 覆盖数量不足、类型错误、跨 workspace、授权不足、过期和已撤回；所有失败发生在 Job/usage reservation 创建前。
- Coordinator 重复提交返回同一 Work/Task/Package；中途故障重试不重复预占或启动 workflow。

### Harness and persistence tests

- 文案、图文、视频通过相同五阶段事件顺序，最终都只产生一个 ContentPackage revision 写入路径。
- 每种媒介覆盖成功、单问挂起与恢复、取消、terminal failure、进程中断恢复、重复/乱序事件和 OCC 冲突。
- `acceptance_unknown` 不跨 Provider 重投；确认未受理后才允许原策略重试。
- 重放任意 stage 不重复 Provider side effect、Asset、usage terminal event、audit event 或 ContentPackage revision。
- 真 PostgreSQL 与 DBOS 测试验证事务、workspace 隔离、schema identity、outbox 和恢复；测试命令必须证明这些用例实际运行。

### Storage tests

- API 上传的 Asset 可由独立 Worker 读取，Worker 生成的 Asset 可由 API 与 Web 下载。
- 对象写入失败不产生可见 receipt；数据库事务失败不产生悬空可见 Asset；孤儿对象按安全规则回收。
- 重复上传同一不可变对象幂等，hash 或 size 不一致时拒绝覆盖。
- 实例重启、滚动发布和临时目录清理后，已完成 ContentPackage 的媒体与 ZIP 仍可访问。
- staging/production 配置 filesystem 时启动和 readiness 必须失败。

### Security tests

- SSRF 覆盖 IPv4-mapped IPv6 点分与十六进制的 loopback、RFC1918、link-local、metadata、公网对照与第二跳重定向；被拒绝场景 transport 调用数为零。
- Stripe 覆盖同邮箱多个 Customer、邮箱变更、远端 metadata 不匹配、并发首次绑定、本地唯一约束和 Portal 读取正确主体。
- Webhook 覆盖无效签名不能占 dedupe key、有效事件在伪造事件后仍可处理、processing 不返回终态成功、租约恢复、重复有效事件幂等和失败重试后只结算一次。

### Browser and interaction tests

- 三种 Lens 从选择、Recipe 套用、必需素材、报价、提交、Result、恢复到交付至少各有一条 production-build E2E；测试通过公共 HTTP/SSE，不启用前端 fixture short-circuit。
- 删除意图中的平台关键词，仍断言所选平台、数量、比例、时长、交付物和模型展示正确。
- 每个商家可见 CTA 都在 E2E 目录中有成功或明确不可用断言；静态扫描与运行态检查共同保证零空动作。
- 375px 下移动进度入口、Result 主动作、Bottom Sheet 键盘焦点和 Portal 深浅主题通过；页面文本断言不出现 UUID、raw enum、provider/model slug。

### CI, live and release evidence

- 在全新 checkout 上使用冻结 lockfile 安装并执行完整 gate；本机已安装依赖结果不能作为替代。
- Bundle gate 读取 production build 产物并按初始主包 gzip 预算判断。
- Provider live gate 在受保护 environment 中按文案/图片/视频三个官方主渠道运行；每种媒介必须完成一次真实生成，并强制成本帽、secret redaction、run nonce 和 evidence artifact。双渠道同 CatalogModel、独立故障域与故障切换矩阵不阻塞本轮发布。
- staging smoke 验证四个部署单元版本一致、readiness 通过、跨实例资产可读、SSE 续传和至少一次 Worker 重启恢复。
- 每份发布证据包含 commit SHA、workflow run、环境、配置 revision、开始/结束时间、结果、证据有效期和制品校验；缺任一字段不能标 release candidate。

### Prior art

- HTTP+SSE 主 seam 沿用现有 Harness HTTP、workflow event 与前端 Harness client 合同测试。
- ContentPackage OCC、write ownership、delivery、migration 和 public projection 测试继续作为唯一聚合先例。
- 媒体恢复沿用 composed video、ProviderAttempt、Asset receipt 与 provider conformance 故障矩阵。
- UI 沿用 Composer Lens/Recipe/Brief、Result Center、Delivery、mobile video 与 Playwright production-candidate 先例，但必须移除只证明 fixture 的捷径。

## Out of Scope

- 不重做视觉品牌、不新建第四个一级导航、不增加 Result 实体或第二内容聚合。
- 不建设统一内容日历、拖拽排程、评论私信 Inbox、多层团队审批、多门店或 Agency 管理。
- 不新增平台自动发布连接器；未通过 live gate 的能力继续使用 verified/assisted/unavailable 三态。
- 不建设完整 Canva/CapCut 级编辑器；Pro Studio 已全量退役（D-170），不在本规格内恢复画布或 parity 重做。
- 不引入新的 Agent/workflow 框架，不以 Mastra、Inngest、Redis 或服务拆分替代当前 DBOS 主干。
- 不扩大到 CRM、预约、收银、库存、会员、排班、财务或自动 ROI 归因。
- 除三个明确 P1 安全问题及与共享存储/CI 直接相交的项外，不在本规格中顺带修完独立代码审查的全部 P2/P3。
- 不执行公开收费所需的完整法务、备案和真实商家运营验证；这些仍由既有商业发布门拥有。

## Further Notes

- **Issue Tracker**：本规格发布于 GitHub Issue [#129](https://github.com/leelv007-cmd/meiyeweb-agent/issues/129)，并以 `ready-for-agent` 标记；既有全量父项 #24、Provider live gate #119 与同增量验收 #128 是关联证据，不因新 Issue 自动关闭。
- **本地权威文件**：`docs/specs/beauty-marketing-agent-p0-remediation-spec-2026-07-22.md` 与 Issue #129 正文保持同步；代码评审和拆票优先引用本地固定路径，Tracker 用于执行状态。
- **测试接缝裁决**：本规格采用一个最高公共 seam——Composer 提交 HTTP + SSE + ContentPackage 投影。五阶段纯函数和 Adapter 测试只用于不变量与故障定位，不另立平行产品验收口径。
- **依赖复用**：Provider live gate 复用现有真实 Adapter 探针；发布硬门只要求三模态官方主渠道真实生成。现有双渠道故障矩阵继续保留为增强证据，但不阻塞本轮 release candidate。若旧 Issue 的证据不绑定当前 commit，则视为未满足本规格。
- **建议实施包**：P0-A 绿色基线与三项安全；P0-B Snapshot/required source/Coordinator；P0-C 三模态 Harness 与单 ContentPackage Port；P0-D 共享存储/部署/readiness；P0-E 商家界面真相与移动进度；P0-F live gate 与同一 commit 发布验收。P0-A、P0-B 可先并行，P0-C 依赖 P0-B，P0-D 可与 P0-C 并行，P0-E 在公共 DTO 冻结后接入，P0-F 最后统一放行。
- **Definition of Done**：只有当干净安装 required CI 全绿、三个安全回归关闭、三模态从同一 public seam 运行、生产 UI 零内部标识、共享资产跨实例可读、staging readiness fail-closed，并且文案/图片/视频各有一个官方主渠道真实生成的当前证据时，P0 才能关闭。无第二渠道时必须显示 `single_channel / no_fallback`。局部单测、旧 fixture 8/8、Token 校验、代码存在或本地 build 成功均不足以关闭。
- **诚实量级**：XL。该规格允许按上述实施包拆 PR，但不允许把其中任一局部完成描述为“生产就绪”。
