---
title: 美业宣发经营 Agent P1 产品化规格：结果体验、资产治理与经营闭环
status: ready-for-agent
priority: P1
date: 2026-07-22
scope: 当前审计优先级 P1；以 P0 统一执行主干完成为前置
source_of_truth:
  - 2026-07-22 全面差距复核与优化报告
  - 合并权威产品设计 D-001~D-099
  - ADR-0007 / ADR-0010 / ADR-0011 / ADR-0012
  - UI/用户旅程重建、ContentPackage 产品化与全量功能开发规格
tracker_issue: https://github.com/leelv007-cmd/meiyeweb-agent/issues/130
---

# 美业宣发经营 Agent P1 产品化规格：结果体验、资产治理与经营闭环

> 本规格把 2026-07-22 全面差距复核中的 P1 项转成可开发、可验收的产品化合同。这里的 `P1` 表示 P0 统一执行与发布可信度完成后的下一优先级，不等同于 2026-07-11 的历史 P1 Scope，也不恢复已经被 D-072~D-099 和 ADR-0011/0012 取代的旧任务收件箱、自由画布或前台信息架构。
>
> **两线边界**：P1 拥有 Composer、Result、Content、Assets、Delivery 和移动交接的主线产品化；Pro Studio 继续是独立 add-on 与探索式工程事实。P1 可以治理 Pro Studio 产生的 OwnedAsset 和 adoption 后的 ContentPackage，但不接管其画布工程、节点级生成或高阶编辑器 UI。

## Problem Statement

门店内容操作者目前能够从 Composer 提交任务并进入 Result Center，但“结果可见”还没有变成“结果易懂、可改、可交付、可复用”。桌面 Result 把主成品、候选、运行证据、事实、平台、CTA 和调整动作连续堆叠；移动 Result 信息密度更高，底部导航与调试信息争夺空间。History、Run Detail、选区改写、平台预览等动作存在入口，却没有形成稳定、真实的工作面。

Content 和 Assets 已有基本列表，但用户可见投影仍可能暴露 AIDA 等内部结构、英文候选标题和工程字段。用户无法围绕平台、项目、IP、系列、权利有效期、来源与引用关系稳定检索和治理内容资产。采用、保存到素材库、创建平台 variant 和派生 revision 的边界也不够直观。

首次用户没有被迫建档，这是正确方向，但当前冷态缺少渐进式上下文引导；一旦遇到顾客素材授权，又会从单个问题突然展开为高密度表单。Landing 的创作输入无法延续到注册后的 Composer，形成看似可输入、实际丢失意图的伪交互。

项目已有 token 流式、SSE、Result Shell、Delivery、结果信号和周复盘相关代码资产，但它们没有成为生产页面的唯一体验。用户旅程往往止于下载 ZIP 或系统分享，无法持续回答“发到哪里、是否已经发布、观察到什么、下一轮为什么推荐这样做”。这使项目在美业事实、权利和经营结果方面的潜在差异化没有被真正呈现出来。

因此，P1 的核心不是增加更多页面，而是在 P0 的同一执行事实之上，把 Result、Content、Assets、移动交接、发布回执和经营信号收敛成一个完整、优雅、诚实的商家旅程。

## Solution

围绕唯一 ContentPackage 和 P0 的 CreationExecutionSnapshot，完成六个连续产品面：

- **渐进式开始**：Day-0 与 Day-N 继续使用同一 Composer；只在当前任务需要时询问最小门店事实、素材和权利，Landing 意图在登录后可确认恢复但不自动提交。
- **三种结果工作面**：Result Center 继续是具体 Work 的上下文工作区，不新增 Result 实体或一级导航。文案、图文、视频共享同一 Result Shell 和动作语义，各自使用适合媒介的成品工作面。
- **真实编辑与版本**：选区改写、自由调整、平台 variant、套图 working selection、视频镜头调整和确定性手改都产生可追溯的 derived Task 或 ContentPackage revision；客户端不保留第二套成品真相。
- **内容与素材治理**：Content 只投影平台成品、状态和下一步；Assets 以 OwnedAsset 为基础提供用户化标题、标签、项目/IP、权利、来源、引用和失败状态治理。
- **发布与结果闭环**：Delivery receipt 明确区分已下载、已交接、已分享与已发布；用户可在原位记录发布 URL、平台、账号、时间和责任人，并用十秒内可完成的 chips 补记结果信号。
- **周复盘与下一轮建议**：只读取同一 ContentPackage 的发布回执与分级信号，回答“发了什么、观察到什么、下一轮验证什么”，不做伪 ROI 或因果归因。
- **移动与可访问性**：375px 成为完整任务面，不是桌面卡片缩放版；主动作、系统分享、复制/下载、恢复、轻改、交付和结果补记在手机上闭环，并通过键盘、VoiceOver、axe、200% zoom 和 reduced-motion 验收。

## User Stories

### Day-0、登录承接与渐进式上下文

1. As a 首次访问者, I want 在 Landing 输入一句创作意图后注册并回到带有该意图的 Composer, so that 开始动作不会因登录而丢失。
2. As a 首次访问者, I want 登录后先确认恢复的意图而不是被自动提交, so that 我仍然控制媒介、平台、素材和费用。
3. As a 首次使用的门店内容操作者, I want 直接看到与正式用户相同的 Composer, so that 我不用先完成长向导。
4. As a 首次使用的门店内容操作者, I want 冷态示例明确标注为示例且与我的事实物理隔离, so that 我不会把示例误认为本店内容。
5. As a 首次使用的门店内容操作者, I want 系统只询问当前任务缺少的最小门店事实, so that 我能先出活再逐步完善资料。
6. As a 门店内容操作者, I want 每个问题说明为什么需要以及会影响什么, so that 我能判断是否回答、跳过或使用安全回退。
7. As a 门店内容操作者, I want 非关键事实允许稍后补充且明确其结果影响, so that onboarding 不会成为另一套审批流。
8. As a 门店内容操作者, I want 已确认的门店事实、价格、项目和身份自动复用并显示来源, so that 第二次创作明显更省力。
9. As a 门店内容操作者, I want 过期或冲突事实以一张单问卡处理, so that 我不用进入完整设置页才能继续。
10. As a 门店内容操作者, I want 顾客素材首次只回答主体、用途、平台和有效期所需的最少问题, so that 权利确认不会突然展开为高密度法务表单。
11. As a 门店内容操作者, I want 高级权利证据字段按需展开并保留草稿, so that 有正式授权文件时仍能完整登记。
12. As a 门店内容操作者, I want 未确认公开授权的素材默认只能内部使用, so that 产品不会用乐观默认扩大授权范围。

### Result Shell 与运行态

13. As a 门店内容操作者, I want 从提交、最近创作、内容、任务或通知进入同一个具体 Work Result Center, so that 结果只有一个落点。
14. As a 门店内容操作者, I want Result 首屏先看到“这是什么、能不能用、下一步做什么”, so that 我十秒内能完成判断。
15. As a 门店内容操作者, I want 运行中看到真实 token 或白话阶段事件并可离开, so that 等待过程透明但不需要守着页面。
16. As a 门店内容操作者, I want 断线重连后从上次 SSE event 继续, so that 页面不会重复播报或漏掉状态。
17. As a 门店内容操作者, I want 返回 Result 时恢复精确 Work、ContentPackage revision、面板和滚动位置, so that 不会误回最近一次结果。
18. As a 门店内容操作者, I want History 面板显示真实版本时间线、来源任务、操作者和可恢复动作, so that 历史入口不是空壳。
19. As a 门店内容操作者, I want Run Detail 默认折叠并用用户语言解释关键阶段、费用和失败, so that 需要排查时有信息但主成品不被工程日志淹没。
20. As a 门店内容操作者, I want 事实来源面板只显示本次实际使用的事实和素材, so that “AI 依据”不是装饰信息。
21. As a 门店内容操作者, I want 每个 Result 状态只有一个主动作和少量次动作, so that 我不用在近义按钮中猜下一步。
22. As a 支持人员, I want 用户可复制一个短 support reference 而不是暴露内部 UUID, so that 能定位问题又不破坏商家体验。

### 文案、图文与视频成品工作面

23. As a 文案用户, I want 主推荐以可阅读、可编辑的文档面呈现并按需展开备选, so that 结果不像三张技术候选卡。
24. As a 文案用户, I want 选择一段文字后执行更口语、更专业、弱化广告感等改写, so that 我可以精准调整而不重生成全文。
25. As a 文案用户, I want 选区改写产生可比较、可采用、可撤销的派生版本, so that 原稿永远可恢复。
26. As a 文案用户, I want 小红书、抖音和视频号预览读取同一 ContentPackage 的平台 variant, so that 预览不是客户端临时拼接。
27. As a 文案用户, I want 对平台 variant 的明确保存产生 canonical revision, so that Content、Delivery 和后续复用看到同一结果。
28. As a 图文用户, I want 主图、封面、套图顺序和采用状态用明确角色语言呈现, so that 我不会面对一组近义“采用”按钮。
29. As a 图文用户, I want 套图 working selection 在本机短期恢复且只有“采用这组”才原子写入, so that 拖动排序不会制造大量服务器版本。
30. As a 图文用户, I want base revision 已变化时比较、丢弃或重新应用本地选择, so that 旧草稿不会静默覆盖新版本。
31. As a 图文用户, I want 保存到素材库与采用到成品是两个独立动作, so that 临时候选不会污染经营资产。
32. As a 视频用户, I want 播放器、封面、字幕、分镜和逐镜调整围绕成片排布, so that Result 像视频工作面而不是调试面板。
33. As a 视频用户, I want 单镜重生成只产生镜头候选，重新合成并采用后才产生新成片 revision, so that 编辑、计费和版本边界一致。
34. As a 门店内容操作者, I want “还想怎么改”在三种工作面使用同一派生 Task 语义, so that 不用每种媒介重新学习。
35. As a 门店内容操作者, I want “基于此再创作”带入结构、风格和明确选中的素材角色但重新读取当前事实, so that 系列化不会复制过期价格与活动。

### Content 成品库

36. As a 门店内容操作者, I want Content 只展示 ContentPackage 成品而不是内部 Work、Job 或旧 CreativeContent, so that 内容库只有一个事实来源。
37. As a 门店内容操作者, I want 内容卡显示用户化标题、平台、媒介、状态、更新时间和唯一下一动作, so that 我能快速继续工作。
38. As a 门店内容操作者, I want 内部 prompt、AIDA 节点、候选标签、状态枚举和模型信息不出现在成品正文, so that 内容可直接阅读和交付。
39. As a 门店内容操作者, I want 按平台、媒介、状态、项目、IP、系列和日期筛选内容, so that 历史积累后仍能找到目标。
40. As a 门店内容操作者, I want 搜索标题、正文和用户标签并看到匹配原因, so that 不需要记住内部编号。
41. As a 门店内容操作者, I want 内容详情原位进入继续调整、交付、发布补记和基于此再创作, so that 不产生第二套动作页。
42. As a 门店内容操作者, I want 历史迁移内容默认只读且在我明确调整或交付时按需锚定 Work, so that 系统不批量制造伪任务和伪费用。

### Assets 素材治理

43. As a 门店内容操作者, I want 素材卡使用中文业务标题和清晰缩略图, so that “Composed video candidate”等内部命名不会进入素材库。
44. As a 门店内容操作者, I want 按文件夹、标签、项目、IP、素材类型、来源和创建时间筛选, so that 素材库能支持日常经营查找。
45. As a 门店内容操作者, I want 按授权状态、适用平台、有效期和待替换状态筛选, so that 公开营销前能快速找到安全素材。
46. As a 门店内容操作者, I want 每个素材显示来自上传、生成、采用、Pro Studio 或历史迁移的来源, so that 资产血缘可理解。
47. As a 门店内容操作者, I want 查看一个素材被哪些 ContentPackage revision 引用, so that 撤权或替换时知道影响范围。
48. As a 门店内容操作者, I want 授权即将到期或已撤回时看到待处理列表和安全替换入口, so that 新生成和新交付不会继续使用无效素材。
49. As a 门店内容操作者, I want 失败、处理中和可用 Asset 分开展示并解释下一步, so that 临时 URL 或失败对象不会伪装成可用素材。
50. As a 门店内容操作者, I want 文件夹和标签只改变治理元数据、不复制二进制 Asset, so that 整理不会制造第二份资产真相。

### 交付、发布回执与结果信号

51. As a 门店内容操作者, I want Delivery 明确区分已下载、已复制、已系统分享、已交接和已发布, so that 文件动作不会被写成平台结果。
52. As a 门店内容操作者, I want 每次交接绑定精确 ContentPackage revision、平台、账号或责任人、时间和用途, so that 交付责任可追溯。
53. As a 门店内容操作者, I want 人工发布后在 Delivery 或 Content 原位补记平台、账号、发布时间和 URL, so that 发布事实与成品版本对得上。
54. As a 门店内容操作者, I want 修改已发布成品时得到“产生新版本，不改写历史发布”提示, so that 线上内容记录保持真实。
55. As a 门店内容操作者, I want 用一排 chips 补记获得注意、私信咨询、加微、预约、买券、核销和到店, so that 记录一次结果不超过十秒。
56. As a 门店内容操作者, I want 每个信号显示时间、来源和已验证/门店记录/推断相关性层级, so that 系统不会把相关性说成因果。
57. As a 门店内容操作者, I want 可以纠正或撤回人工补记并保留审计, so that 误点不会污染后续推荐。
58. As a 门店内容操作者, I want 结果阶梯按已发布、获得注意、发生咨询、预约或买券、核销或到店展示, so that 我能直观看到经营进展。
59. As a 门店内容操作者, I want 缺少结果数据时看到未知而不是零或自动估算, so that 周复盘不会制造虚假表现。

### 周复盘与下一轮建议

60. As a 门店内容操作者, I want 周复盘只汇总本周真实发布回执和结果信号, so that 报告可以回查来源。
61. As a 门店内容操作者, I want 周复盘回答“发了什么、观察到什么、下一轮验证什么”, so that 复盘直接支持行动而不是展示 vanity metrics。
62. As a 门店内容操作者, I want 下一轮建议引用具体 ContentPackage、平台、信号和不确定性, so that 我知道推荐理由。
63. As a 门店内容操作者, I want 一键续做、换 CTA、换平台或停止系列, so that 复盘可以直接进入下一条创作。
64. As a 门店内容操作者, I want 没有足够证据时推荐明确标注探索性, so that 产品不伪造 ROI 或确定性结论。
65. As a 门店内容操作者, I want 拒绝或调整建议时只记录当前决定，长期偏好仍需确认晋升, so that 复盘不会悄悄改变我的品牌表达。

### 移动、视觉与可访问性

66. As a 手机用户, I want 375px Result 首屏只保留主成品、状态和当前主动作, so that 底部导航不会遮挡关键操作。
67. As a 手机用户, I want 查看、采用、轻改、复制、下载、系统分享、交付、结果补记和再创作都能在手机完成, so that 基础旅程不要求回桌面。
68. As a 手机用户, I want Web 准备的发布包可以通过一次性链接或系统分享在手机安全打开, so that 桌面创作到手机发布成为一等旅程。
69. As a 手机用户, I want 分享不可用时自动降级为一次性链接或下载并解释差异, so that 设备能力差异不会造成死路。
70. As a 读屏用户, I want 状态变化、采用反馈和流式文本得到节制且有意义的播报, so that 不被每个 token 或重复 toast 淹没。
71. As a 键盘用户, I want 所有 Result、Content、Assets 和 Delivery 动作有可见焦点、合理顺序与关闭后焦点恢复, so that 不使用鼠标也能完成主旅程。
72. As a 低视力用户, I want 200% zoom 与 320/375/768/1440 宽度下没有横向阻断和遮挡, so that 放大后仍可工作。
73. As a 动效敏感用户, I want reduced-motion、低功耗或 Save-Data 下停止业务装饰循环并保留必要状态反馈, so that 动效不会影响使用与性能。
74. As a 深色模式用户, I want 三种 Result、Content、Assets 和所有 Portal 浮层保持同等信息层级与对比度, so that 暗色模式不是另一套质量标准。
75. As a 门店内容操作者, I want 应用继续使用“门店橱窗”的白瓷、磨砂玻璃和玫瑰金体系但减少通用 SaaS 卡片堆叠, so that 产品既优雅又突出成品本身。

## Implementation Decisions

### 1. Dependency and product boundary

- P1 以 P0 的 CreationExecutionSnapshot、单一 Harness、共享对象存储、公共 ContentPackage 投影和绿色发布门为前置。P0 未完成时可以开发纯投影和组件，但不得宣称完整旅程上线。
- Result Center 继续位于具体 Work 上下文，不新增 Result 表、Result 聚合、Result 一级导航或第二历史列表。
- 商家一级导航维持“创作 / 内容 / 素材 / 门店”。Pro Studio 保持独立 add-on，不回流为主线编辑器。
- 所有页面只读取 canonical Task/Work/Job/Asset/ContentPackage/RouteSnapshot 与账本投影；UI state 只拥有临时交互，不拥有业务真相。
- 对 Pro Studio 来源，公共投影通过判别式 `originRef` 接受 `advanced_canvas_project_revision`，不要求其伪造 `CreationExecutionSnapshot`；adoption 后仍由同一 ContentPackage/OwnedAsset 投影承接。

### 2. Progressive onboarding and landing handoff

- Day-0 与 Day-N 使用同一 Composer。没有强制建档向导；系统根据当前 Recipe 和 snapshot readiness 只询问会阻塞本次交付的最小事实。
- Landing 输入只保存意图文本、显式 Lens（若已选）和创建时间到同浏览器短期 session handoff；不保存素材、权利、报价、Provider 或隐藏 prompt。登录后展示恢复确认，用户可编辑或丢弃，绝不自动提交。
- 示例数据使用独立 example workspace/source 标识，不能进入商家事实账本、推荐、搜索或计费。
- 权利问答默认一问一卡，先处理主体、用途、平台和期限；证据文件、详细范围与例外按需展开。未确认时保持 `internal_only`。

### 3. One Result Shell, three media worksurfaces

- `ResultShellModel` 是唯一结果投影，负责状态、主动作、次动作、返回上下文、History、Run Detail、Fact Sources、Delivery 和错误恢复。它不写业务事实。
- `ResultCommandAdapter` 是唯一动作入口，把采用、手改、选区改写、自由调整、套图采用、视频重生成、交付和再创作映射到 Product Core 命令。
- 文案工作面采用文档式主稿、按需备选、选区操作和平台预览；图文工作面采用主图/封面/套图角色与 working selection；视频工作面采用播放器、封面、字幕、分镜和逐镜调整。
- History 显示 ContentPackage revision 时间线和 derived-from；Run Detail 读取 Task/Job/Attempt 的安全诊断投影，默认折叠且不暴露 provider secret、内部 slug 或 raw payload。
- Fact Sources 只显示当前 revision 实际引用的事实、素材、身份和权利摘要；未被使用的来源不进入“依据”抽屉。

### 4. Editing and version semantics

- 确定性手改通过 expected revision 写新 ContentPackage revision；模型改写、选区改写和自由调整创建 derived Task，再由同一 Harness 产生新候选 revision。
- 选区改写输入包含 base revision、稳定文本锚点或选区 hash、用户指令和平台 variant。base 漂移时返回 conflict 并提供比较，不把旧偏移套到新文本。
- 平台预览读取 canonical variant；预览本身不写入，用户明确保存或采用后创建新 revision。客户端生成的临时格式不得进入 Delivery。
- 套图 working selection 只保存稳定 Asset id、角色、顺序、base revision 和 surface version；本设备自动恢复七天，跨设备保存必须显式创建 Work draft revision。
- 视频单镜调整产生候选 Asset/Attempt；只有重新合成并采用成片才写 ContentPackage。字幕纯文本修改不触发媒体费用，需重编码时先新报价。
- “基于此再创作”生成新 snapshot，继承允许的结构、风格、参数与素材角色，重新编译当前事实、权利、身份和报价。

### 5. Content projection

- Content 列表只读 ContentPackage 公共投影。历史对象通过既定按需 legacy anchor 适配，不批量创建 Work、Job、费用或虚构来源。
- 公共内容字段使用业务标题、主平台、媒介、状态组、采用/交付/发布摘要、项目/IP/系列标签、更新时间和 next action。
- 结构化 prompt、AIDA/内部阶段、候选评分、Provider、RouteSnapshot、成本和 raw status 在投影边界删除；若需要支持诊断，进入权限隔离的技术视图。
- 搜索先使用现有 Postgres FTS/trigram 和结构化过滤；没有 Recall 证据前不引入向量检索。
- 列表和详情动作复用 ResultCommandAdapter，不再建立 Content 专用第二套编辑/交付命令。

### 6. Asset governance

- OwnedAsset 是可持久使用的媒体事实；Provider 临时 URL、未完成 Attempt 和本地预览不是素材库 Asset。
- Asset display title 在入库时由业务上下文生成，并允许用户修改治理标题；禁止把内部英文候选名直接投影给商家。
- 文件夹、标签、项目、IP、用途和用户标题属于可版本化治理 metadata，不复制对象二进制，也不改变不可变 receipt。
- 权利投影包含主体、用途、平台、有效期、证据状态、撤回状态和影响计数。撤回阻止新生成与新交付，并创建待替换投影；历史版本保持审计可见。
- Asset lineage 至少关联上传/生成/adoption/Pro Studio/legacy 来源、父 Asset 和引用它的 ContentPackage revisions；执行来源使用判别式 `originRef = marketing_creation_snapshot | advanced_canvas_project_revision | direct_upload | legacy_import`。Pro Studio 来源还必须保存 projectId、revisionId、nodeId/jobId 和必要 checkpoint 引用。
- 权利撤回或过期阻止新的营销生成、adoption、公共交付、系统分享和发布。工作区成员能否私下取回原始上传文件由独立 `private_retrieval_eligible` 策略决定：仅当工作区所有权、来源合同和当前访问策略同时允许时开放，且必须记录 retrieval receipt；这不恢复公开营销权。
- Pro Studio 工程 ZIP 必须逐 Asset 执行 workspace access、`private_retrieval_eligible` 与 export policy。不可导出的引用资产必须使导出 fail-closed，或在用户明确选择“仅导出可用项”后从 ZIP 中排除并写入 manifest warning；不得因 Canvas manifest 不复用成品 rights schema 就绕过权利判断。
- 搜索与筛选覆盖类型、来源、项目、IP、标签、权利、平台、有效期、处理状态和失败状态；失败项给出重试、替换或删除草稿的明确动作。

### 7. Mainline streaming as the only Composer copy-generation experience

- 主线 Composer/Result 的文案用户可见增量统一消费 `workflow.token` 的 candidate/channel/sequence；不得同时从轮询结果和 token 流生成重复候选。
- SSE 连接使用 `Last-Event-ID` 恢复，客户端按 event id/sequence 去重，terminal revision 到达后以公共 ContentPackage 投影校准最终文本。
- token 流可视呈现逐字更新；读屏播报按语义段落节流，最终完成只礼貌播报一次。断线时显示“正在恢复连接”，不清空已到达文本。
- 图片和视频继续用白话阶段事件与最终 Asset，不伪造 token 或百分比。
- Pro Studio `text.respond` 可以复用同一 SSE envelope、sequence、恢复和去重规则，但其 terminal truth 是 durable canvas text node + project revision，不是 ContentPackage；只有 adoption 后才进入主线成品投影。

### 8. Delivery and publication receipts

- Delivery action 状态至少区分 `prepared`、`downloaded`、`copied`、`shared`、`handed_off`、`published_recorded`、`failed`；这些是回执类型，不扩展 ContentPackage 聚合状态机。
- assisted handoff 绑定精确 ContentPackage revision、target platform、account 或责任人、用途、创建时间、到期时间和 ApprovalReceipt（需要时）。一次性链接默认短期有效，撤销后立即不可用。
- `shared` 或 `handed_off` 绝不等于 `published`。只有已验证平台回执或用户人工补记才能形成 publication record。
- 人工发布记录包含平台、账号显示标识、发布时间、URL、记录人、source tier 和修订历史；修改已发布成品产生新 revision，不改写旧 publication record。
- 自动发布状态机仍受平台 live gate 控制；未验证平台只提供发布包、系统分享和人工回执。
- 主线确定性 ZIP 使用成品交付 manifest；Pro Studio 工程 ZIP 使用 `pro-studio-canvas-export/v1`。两者可以共用纯打包算法，但不得复用 publication/delivery 状态、rights 字段或 receipt 类型。

### 9. Outcome signals, weekly review and recommendation

- 结果信号采用 append-only observation ledger，至少支持 attention、inquiry、contact_added、appointment、voucher_purchase、redemption、store_visit；纠正通过 supersede，不原地改写。
- 每个 observation 绑定 workspace、ContentPackage revision、publication record（若有）、发生时间、记录时间、actor、source tier、可选数量和最小必要备注。
- source tier 固定为 `verified`、`merchant_recorded`、`inferred_association`。UI 必须显示层级；推断相关性不能使用“带来、导致、转化”语言。
- 不记录完整聊天正文、顾客敏感联系方式或 CRM 明细；结果 chips 只服务宣发校准。
- 周复盘是同一 ledger 和 ContentPackage 的只读投影，只回答发布内容、观察信号、未知项和下一轮验证建议。
- 下一轮建议引用具体历史 revision、平台、CTA、信号与不确定性，生成“续做/换 CTA/换平台/停止系列”候选；用户确认后才进入新 CreationExecutionSnapshot。
- 无足够样本时显示探索性建议或 unknown，不计算伪 ROI，不把缺失当零。

### 10. Mobile information architecture

- 375px Result 使用单列任务面：固定顶部返回与状态、主成品、一个 sticky 主动作、折叠次动作；底部商家导航为 sticky 动作预留安全区，不覆盖内容。
- 手机保留查看、采用、轻改、复制/下载、系统分享、交付、结果补记、版本恢复、重试/取消和再创作；高级批量编辑可以延后，但不得要求桌面才能完成基本交付。
- 桌面→手机交接优先系统分享；不支持多文件时使用一次性链接；再次失败时回退确定性 ZIP/单项下载。每次降级用用户语言解释，不改变 publication 状态。
- 移动“进度”与任务通知使用同一 Work deep link 和 Result return context，不创建 MobileActionBook 第二套事实。

### 11. Visual and accessibility contract

- 延续“门店橱窗”设计系统，成品本身是视觉中心；白瓷/磨砂玻璃/玫瑰金仅承担层级和品牌，不用连续同质卡片包裹每段信息。
- 文案工作面采用可阅读内容宽度；图文采用媒体优先布局；视频采用影院式播放器与下方编辑轨迹。运行证据、技术细节和次要元数据默认折叠。
- 所有主触控目标至少 44×44，产品签名主控件建议 48×48；文本、状态、焦点和禁用态满足 WCAG 2.1 AA。
- Dialog、Bottom Sheet、Select 和 Toast 使用统一 primitive、Portal 主题、focus trap、焦点返回和单一 aria-live 策略。
- `prefers-reduced-motion`、低功耗和 Save-Data 下停止非必要 WebGL/rAF/GSAP 循环；必要进度不依赖动效单独表达。
- 320/375/768/1440、200% zoom、浅深主题是固定发布矩阵，不允许只验收桌面浅色截图。

### 12. Analytics and product metrics

- 事件全部绑定 snapshot revision、Work、ContentPackage revision 和匿名 workspace actor，不记录内容正文或敏感顾客数据。
- 关键漏斗为 Recipe visible→apply→submit→result usable→adopt→deliver→publication recorded→outcome signal→next recommendation accepted。
- 体验指标包含首次有效提交率、首次可用结果时长、Result 首次有效动作时间、移动交接完成率、主推荐直接采用率、调整后采用率、可发布包率和 visible dead CTA 数。
- 经营指标只按 source tier 展示；样本量和 unknown 必须与读数一起呈现。

### 13. Cutover

- 先将新 Result Shell 和三工作面接到 canonical 公共投影，再物理退场旧 workbench result branch、重复 ContentPackage 主动动作和 MobileActionBook 写路径；三媒介未齐时不得提前删除唯一可用 fallback。
- Content/Assets 新投影启用前完成 legacy title/status 清洗规则和只读迁移对账；不重写历史原始证据。
- publication/outcome/weekly review 采用 expand migration 与新命令单写；旧信号若来源不明保持 unknown，不补造时间、平台或因果。
- 回滚切换页面和新命令入口，不覆盖已经产生的新 revision、receipt 或 observation。

## Testing Decisions

### Test philosophy and primary seam

- 好测试只验证商家可见行为、公共投影、命令结果、版本血缘和可访问性，不断言组件树、CSS 类名、内部 reducer 或数据库表结构。
- **唯一主验收 seam 是登录用户通过 production-build Web 使用公共 HTTP+SSE 完成 Composer→Result→Adopt/Edit→Delivery→Publication Record→Outcome Signal→Weekly Review→Next Creation。** 所有页面共享该 seam，不为 Result、Content、Assets 和 Mobile 各建一套伪后端。
- 纯投影、状态转换和无障碍组件可有快速合同测试，但不能代替连续浏览器旅程。

### Result and editing contract tests

- ResultShell 对运行、等待问题、失败可恢复、候选、已采用、已交付和已发布状态只返回一个主动作。
- History 来自真实 ContentPackage revisions；Run Detail 来自安全投影；Fact Sources 只含实际引用。
- 确定性手改产生新 revision 并保留 derived-from；OCC 冲突不覆盖新版本。
- 选区改写在 base revision 漂移时返回 conflict；成功时产生 derived Task 和可比较候选。
- 平台预览不写业务事实；保存后 Content、Result 和 Delivery 同时读取新 canonical variant。
- 套图 working selection 覆盖本机恢复、七天过期、base 漂移、原子采用、撤销和跨设备显式草稿。
- 视频覆盖单镜候选、重新合成、使用成片、字幕免费/需重编码分流和费用确认。

### Content and Asset tests

- Content 列表只含公共 ContentPackage 投影，不泄漏 prompt、AIDA、raw status、UUID、Provider 或模型 slug。
- 搜索与过滤返回真实平台、项目、IP、系列、状态和日期结果；空结果不调用模型补造。
- legacy 内容读取不创建 Work；第一次明确调整或交付才幂等创建 legacy anchor，且不调用模型、不扣费、不制造 revision。
- Asset 只有持久 receipt 才进入可用列表；临时 URL、处理中和失败项不能伪装完成。Pro Studio Asset 必须通过 `advanced_canvas_project_revision` originRef 可回查。
- 文件夹/标签操作不复制对象；标题修改不改变 hash/receipt；来源和引用反向查询准确。
- 授权到期或撤回阻止新营销生成、adoption、公共交付和发布并形成待替换投影；历史 revision 仍可审计。私下取回原始文件只在 `private_retrieval_eligible` 为真时允许，Canvas 工程 ZIP 逐 Asset 执行同一策略。

### Streaming tests

- 断开前收到的 token 在 `Last-Event-ID` 重连后不重复，乱序/重复 event 单调收敛。
- 多候选和 title/body/CTA channel 不串流；terminal ContentPackage revision 与已展示文本一致。
- 页面刷新不会从轮询和 SSE 生成两份候选；连接失败可恢复且不清空已有内容。
- 读屏区域不逐 token 轰炸，语义段落节流和最终一次完成播报可测试。

### Delivery and outcome tests

- copied/shared/handed_off 不改变 publication 状态；只有 verified callback 或人工记录创建 publication record。
- 一次性链接覆盖创建、读取、过期、撤销、workspace 隔离和日志脱敏。
- 发布记录绑定精确 revision；后续编辑不会改写旧记录。
- observation append、supersede、source tier、时间和 workspace 隔离正确；缺数据为 unknown，不显示 0 或推断因果。
- 周复盘只引用同一 workspace 的真实 publication/observation；建议包含来源和不确定性。
- “续做/换 CTA/换平台”只有用户确认后才创建新 snapshot；拒绝建议不会直接写长期偏好。

### End-to-end journeys

- Day-0：Landing 输入→注册/登录→恢复确认→显式 Lens/平台→最小事实单问→提交→首个可用结果。
- 文案：token 流→主推荐→选区改写→采用→平台 variant→复制/发布包→人工发布记录→咨询 chip→周复盘→续做。
- 图文：Recipe required source→套图 working selection→采用整组→保存一个 OwnedAsset→交付→手机系统分享降级。
- 视频：运行恢复→播放器/字幕/封面→单镜候选→重新合成报价→采用成片→交接责任人→发布补记。
- 历史内容：Content 搜索→只读 legacy 内容→明确调整触发按需 anchor→Result→新 revision，不产生伪费用。
- 撤权：Assets 找到被引用素材→撤回→受影响内容待替换→安全替换→新交付，历史证据保持。
- 所有 E2E 使用公共服务和 recorded Provider；live Provider 只在受保护独立 gate 运行。前端 fixture 可以用于组件开发，不可作为本规格完成证据。

### Responsive, visual and accessibility tests

- production build 在 320/375/768/1440、浅色/深色和 200% zoom 运行固定旅程与截图回归。
- 375px Result 主动作、底部安全区、长文、中文换行、视频比例、套图托盘和 Delivery 全高面无遮挡。
- axe 覆盖 Composer、Result、Content、Assets、Delivery、Weekly Review；主路径零 serious/critical violation。
- 键盘测试覆盖 skip link、Tab 顺序、模态 focus trap、Esc、focus return、选区动作、采用反馈和错误恢复。
- VoiceOver 人工清单覆盖 Lens、流式内容、候选、媒体角色、状态变化、分享降级和结果 chips。
- reduced-motion/Save-Data 下非必要动画循环为零；页面功能和状态反馈保持完整。

### Metrics and evidence

- 测试环境验证所有漏斗事件携带 snapshot/package revision 且不含正文、顾客联系方式或密钥。
- completion evidence 绑定 commit、production build、浏览器版本、viewport、主题、种子数据 revision、workflow run 和截图/视频。
- 体验验收以商家可见结果为准；“组件存在、单测通过、fixture 截图可见”不能关闭未挂载旅程。

### Prior art

- 复用现有 Result Shell、Result Command Adapter、token stream、return restore、三媒介 worksurface、Delivery panel 和 mobile video 合同测试。
- 复用 ContentPackage public projection、OCC、delivery manifest、assisted receipt、recent projection 和 legacy migration 先例。
- 复用 Assets governance、authorization、OwnedAsset、ContentPackage attachment 与 Pro Studio adoption 的不可变资产边界。
- 浏览器验收沿用当前 Playwright production-candidate、移动 viewport、暗色模式和 axe 工具链，但升级为连续主旅程。

## Out of Scope

- 不建设统一拖拽内容日历、复杂排程、评论私信 Inbox、自动回复或社交聆听。
- 不建设 CRM、顾客档案、销售漏斗、预约管理、买券核销系统、收银、会员或财务报表；结果 chips 只用于宣发校准。
- 不承诺自动因果归因、自动 ROI、竞品监测或跨租户行业 feed。
- 不新增未经 live gate 验证的平台自动发布；小红书、朋友圈等继续使用发布包、系统分享或人工交接。
- 不建设企业级多层审批、自定义 ACL、多门店/Agency 控制台、危机批量暂停和大规模团队协作。
- 不在主线复制 Canva/CapCut 专业编辑器；无限画布、高阶精修、TTS/SFX 和节点编辑由 Pro Studio D-099 独立规格拥有。
- 不引入向量检索、RAG 或新的内容索引服务，除非现有 FTS 的固定检索集出现明确失败证据。
- 不扩大医疗美容默认范围，也不在本规格执行公开收费前的完整法务与运营验证。
- 不把全站 Landing 视觉重做纳入范围；仅修复 Landing 意图承接和与主应用连续性直接相关的交互。

## Further Notes

- **Issue Tracker**：本规格发布于 GitHub Issue [#130](https://github.com/leelv007-cmd/meiyeweb-agent/issues/130)，并以 `ready-for-agent` 标记；P0 Issue [#129](https://github.com/leelv007-cmd/meiyeweb-agent/issues/129) 是完整上线前置。
- **本地权威文件**：`docs/specs/beauty-marketing-agent-p1-productization-spec-2026-07-22.md` 与 Issue #130 正文保持同步；代码评审和拆票优先引用本地固定路径，Tracker 用于执行状态。
- **测试接缝裁决**：本规格主 seam 是完整登录浏览器旅程，底层仍只读写 P0 已冻结的公共 HTTP/SSE 和 ContentPackage 合同。Result、Content、Assets、Mobile 不得用各自 mock store 作为完成证据。
- **P0 依赖**：CreationExecutionSnapshot、单一 Harness、共享对象存储、公共 DTO 清洗和商家界面内部标识清零必须先进入稳定基线；否则 P1 页面只能算开发中投影。
- **建议实施包**：P1-A Day-0/权利渐进引导；P1-B Result Shell + 文案/图文/视频工作面；P1-C Content/Assets 投影治理；P1-D token 流式与跨端恢复；P1-E Delivery/publication/outcome ledger；P1-F 周复盘/下一轮建议；P1-G 移动与可访问性总验收。P1-B 与 P1-C 可在公共投影冻结后并行，P1-D 接入 P1-B，P1-E 依赖 canonical revision，P1-F 依赖真实 receipt/signal，P1-G 贯穿并最终放行。
- **Definition of Done**：三模态在 production-build Web 和 375px 手机上都能从真实 Result 完成采用/轻改/交付；Content/Assets 无内部文本污染；发布与交付状态不混淆；至少一条 recorded 端到端链能产生 publication record、结果 signal、周复盘和下一轮建议；全矩阵无障碍与视觉门绿色。
- **商业验证边界**：recorded 链证明功能合同，不证明真实平台发布、商家采用率或经营提升。任何 `merchant_validated` 结论仍需后续真实门店样本与独立证据。
- **诚实量级**：XL。允许按实施包拆 PR 和子 Issue，但对外开放必须以连续旅程验收，不发布只有页面没有业务闭环的半产品。
