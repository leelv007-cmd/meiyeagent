# 三类成品工作区结果动作合同

- 日期：2026-07-20
- 状态：`accepted`（D-085 的规范性细化合同；若与主规划冲突，以主规划最新 accepted 决策为准）
- 对应主决策：D-085
- 用户选择：方案 B「共享动作语义 + 媒介专属工具」
- 范围：文案/图文、图片、视频三个成品工作区从运行、恢复、采用、调整到交付的全生命周期
- 路由补充：D-089 已选择独立 Result Center `/dashboard/results/$workId`；本文件的 Result Shell 与三类工作区挂载于该路由，底层唯一真相和动作合同不变。

## 1. 决策摘要

三个成品工作区共享 Result Shell、生命周期语义、版本、交付、历史和运行证据，但不共享一套僵硬的按钮清单。共享层负责回答“当前结果能否使用、下一步是什么、怎样调整、怎样交付、怎样恢复”；媒介工作面分别承接文案编辑与平台预览、图片大预览与套图调整、视频播放器与分镜/字幕/封面。

首页 `文案 | 图文 | 视频` 是用户主动选择的创作对口，不等同于结果工作区枚举。“图文”可以按冻结的 Recipe 输出合同进入文案/图文工作区或图片工作区；工作区选择由 Recipe revision 决定，运行后不得由模型输出、Provider 或后台默认静默改写。

## 2. 统一信息层级

```text
返回 / 当前任务 / 当前 revision / 状态

成品主视图

[状态对应的唯一主动作] [继续调整] [交付] [更多]

媒介专属快捷调整

常驻「还想怎么改？」自然语言输入

版本与历史
运行详情（默认折叠）
```

### 2.1 首屏动作预算

- 桌面端同时最多显示一个 primary 和三个 secondary；其余动作进入“更多”。
- 移动端固定显示一个 primary 与“更多”，不增加条件性第三按钮；不得用横向动作条隐藏关键动作。
- 当“交付”已经升为当前 primary 时不再重复显示同名 secondary；其他阶段的“交付”只作为直接进入交付能力面的捷径。
- “运行详情”默认折叠，不让模型、参数、费用和技术状态抢占成品视图。
- 阶段动作与成品动作分开：运行中显示离开并后台继续、取消或恢复；结果可用后才显示采用、调整和交付。

## 3. 共享动作语义

### 3.1 采用当前结果

采用动作只在存在未采用候选时出现，并按媒介使用用户可理解的标签：

| 工作区 | 主动作 |
|---|---|
| 文案/图文 | `采用此版本` |
| 图片 | `选为主图`、`加入套图`或`采用这组`，由交付物决定 |
| 视频 | `使用此成片` |

采用的含义是把候选写入当前 canonical ContentPackage revision 或对应成品槽位；不等于发布，也不等于保存到素材库。采用后显示明确的已采用状态，不继续保留含糊的“保存结果”。

### 3.2 继续调整

- 三个工作区常驻自由文本“还想怎么改？”，快捷 chip 只作为加速器，不能替代自由表达。
- 自由文本和任何需要模型执行的调整必须继承 D-046：创建 derived Task 与 derived revision，保留 source/adopted/edit/derived-from/route/cost 审计链，且不新增 message/thread 持久化实体。
- 纯确定性结构编辑（如人工改字、排序）可以直接创建 ContentPackage 或 Asset derived revision，不强制创建 Task，但仍需 actor、reason、source revision、expectedRevision/OCC 与审计证据。
- 结构化 AI 快捷修改与自由文本必须收敛到同一 derived Task/revision 命令语义，不能一个创建 Work、另一个在客户端拼字符串。
- 图片、视频调整在提交前显示本次预计消耗、预计时长和影响范围；逐张或逐镜调整不得默认触发整套重跑。
- 用户可随时回到调整前版本；恢复旧版也创建新 revision，不删除后续历史。

### 3.3 交付

“交付”是一个能力感知入口，不把下载、分享、保存素材和批准发布混成同一动作。根据当前媒介、平台、账号绑定、权限、权利事实和部署能力，只展示真实可用项：

1. 复制或下载单项成品；
2. 下载完整发布包；
3. 系统分享；不支持 Web Share 时降级为复制交接链接或下载；
4. assisted 人工交接；
5. `automatic_verified` 自动发布。

发布必须绑定精确平台、账号、ContentPackage revision、ApprovalReceipt 和回执。未绑定、未验证或不支持自动发布的平台仍可诚实提供复制、单项下载、完整发布包、可用的系统分享或降级链接以及 assisted 人工交接，但不显示自动发布或“发布成功”等误导文案。

### 3.4 基于此再创作

对外统一使用“基于此再创作”，不再把“做同款”解释为复制旧内容。它只复用结构、风格、参数、槽位和用户明确选择的素材角色，重新注入当前门店事实、授权素材与报价，创建新草稿；不得修改源成品，也不得把旧价格、期限、顾客信息或活动事实带入新任务。

### 3.5 重新生成

重新生成位于“更多”，明确展示将继承的来源、Recipe、模型设置、预计消耗和预计时长。新结果作为同一血缘下的新候选或 revision，原结果保持可回退。已接受或接受态未知的媒体 Job 继续遵守异步幂等与禁止盲重提合同。

### 3.6 版本与运行详情

版本与历史提供时间线、差异比较、来源动作与恢复。运行详情折叠展示实际产品模型、参数、报价、Task/Job 状态、来源、权利、合规结论、失败与退款证据；前台不得展示 Provider、Deployment、Credential、New API/Sub2API 或 fallback 顺序。

## 4. 状态驱动的主动作

Result phase 按下列优先级投影，命中上层后不得被下层 `completed` 覆盖：交付异常/进行中 → 接受态未知 → 用户待处理 → 运行异常 → 运行中 → 可用候选 → 已采用 → 可交付 → 已交付。

| Canonical predicate | Result phase / 主动作 | 允许命令与目标 | OCC、重试与批准策略 |
|---|---|---|---|
| DeliveryAttempt 为 awaiting approval | `awaiting_approval` / `查看并批准` | 对精确 platform variant revision 创建 ApprovalReceipt | expectedRevision 不匹配时刷新差异；禁止批准漂移后的版本 |
| DeliveryAttempt 为 delivering | `delivering` / `离开并后台继续` | 只读进度、能力允许时取消交付 | 不重复提交；按 delivery id 幂等恢复 |
| 部分载体成功、部分失败 | `partial_delivery` / `处理未完成交付` | 只重试失败载体，目标仍是原精确 revision | 不得投影为 delivered；成功回执不可覆盖或重发 |
| DeliveryAttempt 失败 | `delivery_failed` / `重试交付` | 使用原 ApprovalReceipt 或按策略重新批准失败载体 | 区分可重试与永久失败，保存失败回执 |
| 任一媒体 Job 为 `acceptance_unknown` | `unknown` / `恢复或核验` | 只允许 query/reconcile，不允许 regenerate/resubmit | 禁止盲重提和重复扣费，直到接受态被解析 |
| Job 为 accepted 且尚未终态 | `running` / `离开并后台继续` | query、恢复、上游明确支持时 cancel | 不允许因轮询超时新建 Job；冻结 RouteSnapshot |
| 视频/媒体候选需要用户选择，或权利/事实待确认 | `needs_attention` / `处理当前问题` | 选择候选或补确认，写精确 Asset/ContentPackage revision | 命令带 expectedRevision；stale 时重新展示差异 |
| Job 为 `rejected_before_accept` 或接受前失败 | `failed_before_acceptance` / `重试` | 新建派生 Task/Job，继承来源并重取报价 | 仅此阶段可安全重提；使用新 idempotency key 与 lineage |
| Task/Job submitting、queued 或 running | `running` / `离开并后台继续` | 查看进度、符合能力时取消 | 提交与取消均幂等；晚到终态按冻结快照对账 |
| 已有可用候选但未采用 | `usable_candidate` / 各媒介“采用” | adopt 到 expected ContentPackage revision 或成品槽 | stale 时拒绝静默覆盖，刷新后让用户重新确认 |
| 候选已采用但交付资料未齐 | `adopted` / `继续完善并交付` | 确定性编辑写 ContentPackage/Asset derived revision；模型调整写 derived Task + revision | 每次命令带 expectedRevision；冲突时比较、重放或取消 |
| 精确平台 variant、权利和账号条件已满足 | `delivery_ready` / `交付` | 创建 ApprovalReceipt 或无发布权限副作用的下载/复制包 | 发布绑定精确 revision；下载不得暗示已发布 |
| 所有目标载体均有成功回执 | `delivered` / `基于此再创作` | 创建 reuse task/新草稿，源 revision 不变 | partial 不得进入此态；新任务重新注入事实与报价 |

Result Shell 是纯投影，不新增 Result 状态实体。唯一真相继续来自 Task、Work、Job、Asset、ContentPackage 和 RouteSnapshot。现有 `VideoWorkflow` 只能作为这些对象派生的视频流程读模型；其选择、取消、派生等命令必须关联并写回明确的 Task/Job/Asset/ContentPackage revision。

所有会改变当前成品或交付对象的命令都必须携带 expectedRevision/OCC。发生 stale 时返回当前 revision 和可比较差异，用户选择重新应用、保留当前或取消；不得 last-write-wins 静默覆盖。

## 5. 文案/图文工作区

### P0

- 同屏查看并编辑标题、正文、Hook/CTA、话题和已采用视觉素材。
- 复制全文，也可分别复制标题、正文、CTA。
- 选区改写、缩短、扩写、换语气、弱促销、加强 CTA；先预览差异，用户确认后写入新 revision。
- 用户显式选择适用目标载体后生成真实 platform variant 并提供对应成品预览；不得用添加固定前缀冒充平台适配。首发文案/图文预览覆盖小红书和朋友圈交付形态，视频预览覆盖抖音和微信视频号交付形态；朋友圈继续是 distribution/export target，不冒充当前 `ContentPackagePlatform` 或自动发布能力，任何目标的直接发布仍需独立 `automatic_verified` live gate。
- 显示高风险事实的来源与待确认状态，特别是价格、期限、项目效果、资质和顾客案例。
- 图文媒体条支持封面、顺序、移除、替换和补图，保存到同一个 ContentPackage revision。
- 版本历史、比较和恢复；交付入口提供复制、下载发布包、人工交接和经验证发布。

### P1

- 富文本或块级编辑、批注和更细粒度 undo。
- 多个选区候选、标题/Hook 批量候选和一题多写。
- Word/PDF、多平台批量派生、封面 A/B 和协作评论。

## 6. 图片工作区

### P0

- 单图大预览或套图网格，支持候选比较和明确的主图/套图采用状态。
- 采用后仍可调整顺序、设置封面、移除、从授权素材替换或补图。
- 逐张重新生成、改比例、裁切、替换文案、保留主体换背景和统一风格；每次只生成受影响的不可变媒体版本，并保留 parent/source 血缘。
- 下载当前单图、所选图片或整套发布包。
- “保存单图到素材”与“采用整套内容”分开，并显示保存的具体不可变媒体版本；配方/系列的 `AssetRevision` 不充当图片版本。
- 复杂精修可进入 Light Composer 或 Pro Studio，完成后通过 adoption 回到同一 ContentPackage，不建立第二资产真相。

### P1

- 多平台尺寸批量派生、局部画布精修、封面 A/B、图文转视频。
- 更高级的多素材编排和节点操作继续由 Pro Studio 承接。

## 7. 视频工作区

### P0

- 最终播放器支持播放、暂停、拖动、全屏和可访问字幕/文字稿。
- 设置当前帧或已有授权图片为封面；修改独立字幕资产文本、字幕开关、口播稿和基础字幕样式。若字幕已烧录或修改需要媒体重渲染/上游合成，则进入整段重新合成与重新报价。
- 查看分镜、选择逐镜候选、替换素材、重新生成单个镜头和调整镜头顺序；每次提交单镜重生成都是新的独立计费生成任务。
- 整段重新生成同样是新的独立计费生成任务，必须保留当前版本，并显示继承内容、所选模型、目标时长、计费方式、预计费用与预计时长；按成片秒数计费时不得只显示“1 次”。
- 下载 MP4、封面、字幕和平台发布包；支持系统分享或明确降级。
- 可进入 Pro Studio 精修，并携带当前视频 revision、来源和 ContentPackage 血缘；点击入口本身不创建空项目。
- 运行中支持后台继续、恢复/核验、符合上游能力时取消；完成态不能只剩播放器和“去内容库”。

### P1

- 音乐与音效时间点、局部字幕擦除/修复、多平台裁切和不同时长版本。
- 精确时间线、逐帧修剪、字幕坐标/动画和复杂多轨只在桌面或 Pro Studio 提供。

## 8. 移动端边界

移动端 P0 必须能完成查看、候选采用到当前 ContentPackage/成品槽、自由文本轻改、复制/下载、系统分享或降级、保存新版本、把明确、持久、具备权利与 parent/source 血缘的单个不可变媒体版本保存为素材、基于此再创作、版本恢复以及异步任务的恢复/重试/取消。视频还必须支持播放、轻量封面选择和字幕文本校对，不能用“请到桌面继续”替代基础成品动作。

精确图像布局、复杂套图编排、逐帧修剪、字幕位置与动画、复杂多轨交由桌面或 Pro Studio；交接时保留 Work、ContentPackage revision、滚动位置、选中对象和未提交调整。

## 9. 无障碍与反馈

- Result Shell 只设置一个聚合状态 live region，避免任务列表、通知和结果页重复播报。
- 步骤列表为当前步骤提供 `aria-current="step"`；进入 needs_attention 后把焦点或公告送到可操作区域。
- 图片顺序调整同时提供键盘上移/下移，不只依赖拖动。
- 视频字幕资产绑定 `<track>`；没有字幕时提供文字稿或明确的无字幕状态。
- 所有可见动作触区至少 44×44px，项目移动设计基线继续使用 48×48px。
- 保存、复制、下载和分享结果以 `polite` 方式反馈；取消等破坏性动作有清晰名称与影响确认。

## 10. 当前产品约束与复用点

### 已有可复用能力

- Workbench 已有 Harness 主推荐、备选和采用，以及结果阶段自由文本调整入口。
- ContentPackage 已有 immutable derived revision、OCC、平台 variant、版本比较/恢复、导出、ApprovalReceipt 和交付重试。
- 图片结果已有 Asset 保存与加入内容的部分接缝。
- 视频流程已有分镜编辑/锁定、候选选择、取消、失败恢复、派生版本和最终播放。
- Light Composer 已有窄范围文案编辑、模块排序、图片替换/裁切、预览和导出能力。

### 必须消除的冲突

- Harness 与 legacy copy 不能继续保留两套采用语义。
- Work-level 自由调整与 ContentPackage 客户端字符串快改必须统一到 revision 合同。
- 正式 `copy.adapt` 与添加固定前缀的“平台版”占位路径不能同时对用户可见。
- 平台 export、quick-edit export 和 legacy handoff 必须收进统一“交付”。
- “保存”只表示保存新 revision；图片/视频“保存为素材”只针对明确、持久、具备权利与 parent/source 血缘的不可变媒体版本，配方/系列才使用 `reuse-memory.ts` 的 `AssetRevision`。
- 当前“做同款”连接已退役命令，应改为“基于此再创作”并接入正式 reuse task 链。

## 11. 首轮验收

1. 文案、图片、视频三种真实任务都能从运行完成进入各自结果工作区，并在同一 Result Shell 看见正确状态和下一主动作。
2. 每种媒介都能采用、继续调整、交付、查看历史和运行详情；自由文本或模型调整创建 derived Task + derived revision 和完整审计血缘，不新增 message/thread 实体；确定性人工编辑至少创建带 OCC 的 derived revision，任何调整都不覆盖原 revision。
3. 图片可在采用后调整套图；视频完成态具备下载、分享降级、轻改和进入 Pro Studio，不再只提供播放与去内容库。
4. 交付能力根据平台、账号、权限和部署事实诚实显示；未验证自动发布时不得出现伪成功路径。
5. “基于此再创作”创建新草稿，不改源成品、不复制旧事实，并保留结构/素材角色血缘。
6. 320×720、390×844、桌面 200% 缩放、键盘和读屏均可完成采用、轻改与交付；无 serious/critical 可访问性问题。
7. Task、Work、Job、Asset、ContentPackage、RouteSnapshot 和账本仍是唯一真相；VideoWorkflow 只作派生读模型，没有新建第二套 Result、历史、素材或发布状态。
8. `acceptance_unknown` 只允许恢复/核验，`rejected_before_accept` 才允许安全重提；partial delivery 不得显示为 delivered，所有成品与交付写命令均通过 expectedRevision/OCC 的 stale 测试。

## 12. 后续状态

- “交付”面板首批目标、下载包、系统分享与 assisted handoff 已由 D-086/D-096 关闭；直接发布仍按逐平台 live gate 上线。
- 文案/图文 P0 预览覆盖小红书与朋友圈交付形态，视频 P0 预览覆盖抖音与微信视频号交付形态；该载体映射不构成自动发布能力证明。
- 图片采用动作按单图、角色槽和套图分别使用的最终用户文案已由 D-087 关闭；详细合同见 `image-adoption-contract.md`。
- 视频单镜重生成与整段重新合成均按新请求独立计费，计价随模型及上游 `per_request | per_output_second` 规则变化，已由 D-088 关闭；详细合同见 `video-regeneration-billing-contract.md`。
- Result Shell 与当前 ContentPackage detail 的迁移方式已由 D-089 关闭：新增独立 Result Center 路由，使用唯一纯投影和命令适配器渐进迁移；Workbench 完整结果区与 ContentPackage detail 重复主动动作最终退场。详细合同见 `result-center-migration-contract.md`。

## 13. 证据边界

本合同以当前代码和测试真相为主要依据。2026-07-20 未提交新的竞品生成任务：小云雀旧视频结果能直接证明“重新生成、提升画质、字幕处理”等方向；CreatOK 与讯飞绘文能支持任务历史、资产沉淀、文档编辑和平台预览方向，但不能据此声称其当前账号完整具备本文所有动作。本文的完整动作架构是我方产品设计，不冒充竞品 live 复刻。
