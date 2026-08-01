# UI/用户旅程重建 开发规格（2026-07-20）

> **SUPERSEDED in part（2026-08-01 / D-170）**：文中「Pro Studio 入口 / 专业工作区横条 / #61–#72 画布 K 票现行」等产品声张已废止。Pro Studio 全量退役——见 [`pro-studio-retirement-spec-2026-08-01.md`](./pro-studio-retirement-spec-2026-08-01.md) 与决策日志 D-170。Composer / Result / 三模态主线合同仍可作历史与主线接缝参考；**不得**再实现「进入 Pro Studio」CTA。

- 决策依据：D-072~D-098（UI/用户旅程块 + D-098 七项收敛处置），继承 D-013/D-023/D-027/D-028/D-029/D-031/D-033/D-037/D-038/D-040/D-043/D-044/D-045/D-046/D-062/D-066/D-068/D-069/D-080、ADR-0007（token 流式）、ADR-0011；见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md`
- 复核链：七路交叉复核报告 `docs/reviews/ui-journey-decisions-xcheck-2026-07-20.md`（事实层零 P0；§6 票包存续裁定；§7/§8 C1~C7 处置）
- 存量基线：#50-#60（T1-T6/Ta-Td/V1）与 #61-#72（Pro Studio K01-K11）已合入 main；本 spec 的正确姿势=**在已 shipped 后端接缝之上重建首屏与结果面**，勿再基于 SceneVisualButton/工作台结果分支加码
- 实施状态：Codex 两路交叉复核完毕并已修订（lane1 决策忠实性 0 P0/12 P1/6 P2、lane2 代码现实 3 P0/9 P1/1 P2，共 31 条发现**全部采纳落入本稿**；报告 `.scratch/ui-journey-spec-review-2026-07-20/lane{1,2}-*.md`）；终稿一致性复核完毕（两路 Opus：31 条 Codex 发现全 LANDED；全局一致性 1 P1+2 P2 已修——视频提交确认 UI 归 WT-C/WT-E 收窄为 regeneration、story 编号 33a/33b 理顺、视频 P0 卡≤3 补注）→ 本稿为拆票基线
- 关键修订（Codex 轮）：S1 contract-spine 前置票与共享文件冻结清单（R-01/R-02）；前端交互测试基建票替代不存在的"既有 vitest+RTL"（R-03）；依赖边修正 C→A+B、E-core→A+B、E-frontend→D1 合同、Z cutover 硬依赖三线（R-10/F-12）；报价对象唯一属主与三套局部事实收敛（R-05）；再次采用整组须新 OCC 命令（R-07）；inbox 扩展而非"已可复用"（R-04）；manifest=扩展既有 export adapter（R-09）；Result 命名边界（R-08）；六卡字段级首发合同、目录 12 项门槛闸、ToolHandoff 白名单、渠道隐藏序列化边界、事件 revision、视频点击口径含 Brief 等（lane1 F 系列）

## Problem Statement

商家（美业门店主/主理人）今天面对的创作产品存在三层断裂：

1. **开始难**：冷态首屏被四套竞争分类轴（营销入口/场景/operation/preset）瓜分，默认锁死 `copy.generate`，图片能力无冷态一级入口；快捷入口点击会静默覆盖用户已输入的意图；模板/场景硬编码在前端，运营调整=前端发版。
2. **等待与结果散**：提交后的运行、候选、采用、调整、交付分散在工作台结果分支、ContentPackage 详情、移动 ActionBook 三处，两套采用、两套自由调整、至少四套交付入口并存，"做同款"按钮直达永远报错的退役命令；用户无法回答"我的东西在哪、下一步点什么"。
3. **交付不诚实/不完整**：video 只有单 MP4 导出，无完整发布包；系统分享/复制/交接页绑在 legacy 数据源；结果可用/最终失败/交付类状态多为瞬态呈现或缺持久事件源（"需要选择/补确认"已有 pending-actions 权威收件箱，不重建），长任务离开页面即失联。

## Solution

按 D-072~D-098 重建三段旅程，全部落在既有 canonical 真相（Task/Work/Job/Asset/ContentPackage/RouteSnapshot + 账本 + 回执）之上：

1. **统一创作入口**：意图先行 Composer 四层结构（`文案|图文|视频` 创作对口用户显式选择 → 一句话意图 + `+来源` + 动态设置行 → 六张版本化快捷模板卡（八个单对口 Recipe variant）→ 少量工具 + Pro Studio + 查看全部）；模板与前台编排由后台版本化 Creation Experience Catalog 管理：仅 Recipe+Surface 走 `草稿→预览→校验→发布→回滚` 全生命周期与可视编辑器，Surface 引用静态 Lens 枚举与静态 Tool 注册表种子（D-098 C3；Lens/Tool 升级为可发布对象属未来解锁项）。
2. **独立结果中心**：`/dashboard/results/$workId` 承接从运行（含 ADR-0007 token 级流式）到候选采用、继续调整、版本、交付的全程；三类成品工作区共享 Result Shell 纯投影与动作语义，媒介专属工作面各自展开；首轮直接建新面+同轮退旧分支（D-098 C1）。
3. **能力感知交付**：拿到文件（manifest/v1 + 确定性 ZIP + 系统分享矩阵 + 一次性链接）+ assisted 人工交接全建；自动发布状态机后置到首平台过 live gate（D-098 C2）；站内通知为引用式投影，复用 pending-actions 收件箱（D-098 C2/C7）。

同批完成对已 shipped #50-#60 的三处增补（T1 前端重挂/T2 模型名回首屏+视频确认重挂 D-088/Td 视频退额按秒差额）与遗留项 GL-23（额度阻塞卡内联兑换）、GL-25/26（CI 真机前置卫生）。

## User Stories

### A. 冷态首屏与创作对口（D-074/076/081）

1. 作为门店主，我想在首屏直接用一句话说今天想发什么，就能开始创作，而不是先理解分类页，以便最短路径出活。首屏必须完整可见：一句话输入、`+ 来源`、可修改的"平台 + 交付物"建议、预计总消耗与唯一有文字标签的主 CTA（D-074）；平台/精确交付物建议不得反向改变创作对口（D-081）。
2. 作为门店主，我想明确点选 `文案|图文|视频` 三个创作类型之一（系统不替我猜），以便费用档、输出媒介和后续设置符合我的预期。
3. 作为门店主，未选创作类型就点"开始创作"时，我想看到"选择创作类型后继续"的提示且焦点回到类型组，以免提交错媒介的任务。
4. 作为门店主，我想在选定类型后看到只与当前任务相关的 3~5 个高频设置（含可见的产品模型名），其余收进"更多设置"，以便不被工程参数淹没。
5. 作为门店主，我切换创作类型时想逐字保留已输入的文字、来源和素材，冲突时先看"保留/暂存/改变"差异并可撤销，以免辛苦输入被清空。
6. 作为门店主，我想让模型、参数、数量变化后自动重新取得服务端总报价，以便确认时的价格就是扣费价格。
7. 作为读屏用户，我想让创作类型组是带可见标题的必选 radiogroup 且输入过程中不播报任何模式推断，以便无障碍地完成显式选择。

### B. 快捷模板卡与移动端（D-075/082/083/084）

8. 作为门店主，我想在 Composer 下方看到六张快捷卡（从案例图写小红书/朋友圈项目介绍/项目活动套图/促销海报/抖音项目成片/旧内容换平台），以便零输入也能开始高频任务。首发 Recipe 按 D-082/D-083 字段级锁定（属首个 revision 默认，后期走新 revision 调整）：各卡"标题+一行副文案+明确动作"逐字采用 D-083 组合；默认交付=笔记+3:4 封面（案例图小红书）/一条短文案（朋友圈）/四张 3:4（套图）/一张 3:4 可改 1:1/9:16（海报）/15 秒 9:16 成片+封面+发布文案（抖音）/按所选 variant 分别交付（旧内容换平台）。
9. 作为门店主，点前五张卡时"选择{类型}并套用"一击完成类型选择与模板套用（无冲突不弹确认），以便低摩擦开始。
10. 作为门店主，模板要覆盖我手改过的模型/参数/已确认报价、或与我已选类型不一致时，我想先看服务端 `RecipePatchPreview` 差异（按实际差异列"保留/暂存/改变"）并确认，主动作分别为"套用并更新设置"或"切换到{对口}并套用"（D-083），以免设置被静默改写。
11. 作为门店主，点"旧内容换平台"时我想自己选来源、创作形式与目标载体（无默认值），以便复用方向由我决定。
12. 作为门店主，套用模板后我想看到"已选择{类型}并套用'{模板}'"与撤销入口，焦点落在第一个缺失输入上，以便知道下一步补什么。
13. 作为手机用户，我想在冷态看到两列三行完整六卡（选类型后收敛为该类型 P0 卡两列两行：文案/图文最多四张、视频最多三张，D-078/D-084），不用横向滑动找能力，以便发现全部媒介。
14. 作为手机用户，我想通过"查看全部模板/查看全部创作工具"进入同一 canonical 全屏目录（双 tab、任务语言分类），返回时恢复筛选、滚动与焦点，以便目录增长后仍可查找。
15. 作为手机用户，我想全局同时只有一个 bottom sheet（仅用于冲突确认、旧内容换平台面板与一步窄工具确认），返回/下滑关闭后恢复原草稿与焦点，以免叠层迷失。

### C. 创作工具与 Pro Studio（D-077/092）

16. 作为门店主，我想在首页看到与当前类型/素材/权益最相关的少量工具（桌面≤3/移动≤2）与"进入 Pro Studio"横条，以便进阶能力可发现但不挤占主路径。
17. 作为门店主，首批 standalone 工具（多平台尺寸重排导出/批量去背景/字幕擦除修复/Pro Studio 无限画布）我想从明确的内容/素材版本"带入当前内容"打开，预览与返回零写入，明确提交才创建任务与扣费，以便试用不产生副作用。跨入口携带走 typed `ToolHandoff`：只传稳定 id/revision、角色与最小设置，URL/sessionStorage 不得含正文、素材授权、隐藏 prompt、Provider 或完整草稿（D-077/D-084/D-092 白名单）。
18. 作为门店主，套餐未解锁的工具我想看到锁定原因；未过发布门的工具直接不出现，以免点开假能力。Pro Studio 入口统一进入现有 `/pro-studio` canonical gate（entitlement/Owner checkout/激活等待/Canvas SSO 全复用，禁止绕 gate 的 Canvas 深链）；`composer_recipe | standalone_tool` 是仅有的两类 dispatch，`dialog|route|workspace` 只是呈现容器不是第三运行时（D-075/D-077）。
18a. 作为门店主，模板/工具全屏目录按 tab 统计 `published && visible && 能力过门` 条目数：少于 12 项只显示分类筛选不渲染搜索框，达到 12 项才显示搜索（首轮只建计数+门槛闸，搜索索引/匹配实现由跨线触发后续票，D-093/D-098 C5）。

### D. 后台创作配置（D-078/082/083 + D-098 C3）

19. 作为运营者，我想在后台"创作入口与模板"编辑器里以 `草稿→预览→校验→发布→回滚` 管理 Recipe 与 Surface（标签/副文案/排序/精选/上下架/桌面移动预览），以便日常调整不走前端发版。
20. 作为运营者，我发布的新 Surface/Recipe revision 只影响新会话，用户正在编辑、已报价、已提交的任务冻结原 revision，以免运行中任务被改写。
21. 作为运营者，我不能通过普通配置创造第四类 operation、静默切换用户类型选择或让任一首轮能力失去入口；供应故障要临时关闭入口只能走高影响应急开关并留审计，以便配置自由不破坏执行安全。
22. 作为实施者，首轮 Lens 是静态枚举、CreativeToolEntry 是静态注册表种子（D-098 C3），只有 Recipe+Surface 进完整发布生命周期，以便建造面与真实变更频率匹配。

### E. 条件 Brief 与提交确认（D-094 + D-088）

23. 作为门店主，简单文案/单图任务在事实、权利、报价完整时我想直接开始（点"生成"即确认），以便日常任务两击到位。
24. 作为门店主，视频生成、多交付物、超四张图、受限素材、高风险事实缺失、报价过门槛时，我想先看一张紧凑 Brief（目标/平台/来源权利/关键事实/模型设置/费用时长/待确认项），确认绑定精确 revisions，以便大额复杂任务不盲发。
25. 作为门店主，只有当系统建议或来源提取的事实真的参与了草稿时才显示证据抽屉，以免装饰性"AI 依据"。
26. 作为门店主，视频确认区我想看到计费方式（按次/按生成成片 N 秒）、预计额度与完成时间，确认后冻结 ProductQuoteSnapshot 与 RouteSnapshot，以便报价可解释可对账。

### F. 结果中心与运行态（D-089/090 + ADR-0007 + D-098 C1）

27. 作为门店主，明确开始生成拿到 workId 后我想直接进入 `/dashboard/results/$workId`，运行中就能看进度、后台继续、恢复核验、取消与失败处理，以便不用等完成才有落点。
28. 作为门店主，文案/图文运行时我想看到自首个 token 起的流式候选渲染（ADR-0007），阶段播报只是无障碍聚合层，以便所见即所得地等待。
29. 作为门店主，浏览器返回时我想回到原 Composer 草稿与触发位置（不产生第二份草稿）；从最近创作/内容/任务/通知进入时返回恢复原筛选滚动焦点，以便导航可预期。未提交编辑按 `{workspaceKind, workId, baseRevisionId, surfaceVersion}` 隔离；刷新或 revision 已前进时提供"恢复/对比/丢弃"，禁止旧草稿静默套新 revision；显式 workId/contentId 失效时显示 not-found/recoverable 状态，不得回落到最近结果（D-089/D-090）。
30. 作为门店主，我不想要一个空泛的"结果"一级导航或结果列表页；结果中心只由具体对象入口进入（提交/最近创作/内容档案/任务/通知/可信深链），集合浏览仍在"内容"，以便心智模型只有一套。
31. 作为门店主，最近创作（桌面六条/移动四条）每项我想看到真实阶段与唯一下一动作（查看进度/处理当前问题/继续调整/继续交付/查看结果），链接精确 workId，以便一眼接续。
32. 作为实施者，Result Center 使用唯一 `ResultShellModel` 纯投影与统一命令适配器，禁止新增 Result 表/状态/第二历史（D-085/D-089）；首轮直接建新面；含视频面的旧 workbench 结果分支与 ContentPackageDetail 重复主动动作的物理退场统一归收尾 cutover 票（硬依赖 C/D/E 三线齐备，D-098 C1"三媒介新面齐备后退旧"），以免第四套结果真相或视频未齐先删旧 fallback。

### G. 三类成品工作区与采用（D-085/087/095 + D-013/D-046）

33. 作为门店主，三个工作区我想要同一套动作语义：状态驱动主动作（候选态"采用此版本/选为主图/加入套图/采用这组/使用此成片"→采用后"继续完善并交付"→已交付"基于此再创作"）+ 继续调整 + 交付 + 更多，以便不用每个媒介重新学。
33a. 作为门店主，文案/图文工作面我想要编辑、选区改写、事实来源与平台预览（D-085 决定①），以便文字成品有真正的编辑体验而非只读卡片。
33b. 作为手机用户，三媒介结果 P0 动作我全都要：查看、采用、自由文本轻改、复制/下载、系统分享或降级、采用到当前内容、保存新版本、合规单版本存素材、基于此再创作、版本恢复、异步恢复/重试/取消；视频另加播放、轻量封面与字幕校对——不得用"请到桌面继续"替代基础成品动作（D-085 决定⑥）。
34. 作为门店主，每个工作区常驻"还想怎么改？"自由文本，模型执行的修改创建 derived Task 与新候选版本（继承 D-046），确定性手改直接创建带 OCC 的 derived revision，以便任何修改都有血缘且不覆盖原稿。
35. 作为门店主，图片候选我想看到完整角色化动作矩阵与精确反馈：动作="采用这张/选为主图/设为封面/加入套图/采用这组/替换当前图片"（同一情境不并列近义按钮），反馈="已采用这张图片/已设为主图/已设为封面/已加入套图，第 N 张/已采用这组，共 N 张/已替换，原版本仍可恢复"；读屏名称含角色、顺序与是否已采用，完成后礼貌播报一次并把焦点送回更新处（D-087）。套图组装用可撤销的本地 working selection，"采用这组"才一次原子写入 ContentPackage revision。
35a. 作为门店主，交付物预期两张及以上时默认进入套图工作面、我仍可明确切换为单图处理（D-095 两张门槛）；独立海报/单图/封面不被迫经过套图托盘。
36. 作为门店主，套图 working selection 我想同设备自动恢复七天、点"保存草稿"才作为 Work draft revision 跨设备；恢复时绑定 base revision，漂移后必须"比较/丢弃/重新应用"三选一（D-095），以便误关不丢又不制造无谓服务端写入。
37. 作为门店主，"采用"与"保存到素材库"我想是两个独立动作：素材只保存明确、持久、具权利与血缘的不可变媒体版本，以免素材库被临时 URL 污染。
38. 作为门店主，视频工作区我想有播放器、封面、字幕、分镜候选与逐镜调整；单镜重生成只产生镜头候选，"重新合成整段"并"使用此成片"才写入新 ContentPackage revision，以便剪辑心智与计费边界一致。
39. 作为门店主，"基于此再创作"只复用结构/风格/参数/我明确选的素材角色并重新注入当前门店事实与报价（不复制旧价格旧活动），以便复用不带出过期信息。
40. 作为实施者，VideoWorkflow 降级为派生只读模型是一次显式立项的实质重构（真相迁往 canonical 对象、保留崩溃恢复幂等），不得按低成本改造排期，以便工期诚实。

### H. 视频计费与退额（D-088 + Td 增补）

41. 作为门店主，每次"重新生成此镜头/重新合成整段"都是新请求独立计费（按次或按成片秒数），确认区明示"按生成成片 N 秒计费"，以便不产生"编辑免费"的误解。
42. 作为门店主，按秒计费我想要上限预授权、按可信实际秒数结算：低于确认值自动退差额，高于上限不静默补扣（差额平台承担），以便扣费永不超过我确认的数。
43. 作为门店主，任务内 fallback 只能在冻结候选集合与已确认报价上限内自动执行，一个任务只产生一次幂等 ProductUsage 预占/结算，attempt 级供应成本走 ProviderCostLedger 分账，以便产品扣费与供应成本可分别对账。
44. 作为门店主，视频失败退额我想按秒数差额/attempt 对账规则精确执行（Td 增补），缺可信 usage 证据时结算保持 estimated/unknown 不伪装 reconciled，以便退款可信。
44a. 作为门店主，以下动作永不产生生成费用：轮询、恢复、下载同一 supplier task、采用候选、纯确定性排序、修改独立字幕资产且无需媒体重渲染的文本操作（D-088 免费动作清单；字幕已烧录或需重编码时必须走"重新合成整段"新报价）。
44b. 作为门店主，任何会新建生成任务的"重试"必须回到报价确认，不得包装成免费恢复；恢复/核验同一个已受理 supplier task 不重新报价（D-088 retry/recover 分流）。

### I. 交付（D-086/096 + D-098 C2）

45. 作为门店主，任何已采用成品我想至少能复制文本、单项下载媒体、下载完整发布包（manifest/v1 + 确定性 ZIP，命名含门店/类型/平台/日期/短 revision），以便没有任何平台打通时也能交付。
46. 作为门店主，小红书包含 caption/封面/按序图片/checklist/权利 AIGC 摘要，抖音与视频号包含 video.mp4/cover/caption/字幕/checklist，朋友圈按分段文案+单项文件交付（distribution target 不伪装自动发布），以便各平台拿来即用。
47. 作为门店主，系统分享按设备能力降级（文件→一次性交接链接→下载），取消不记已交付，"已交给系统分享"不写成"已发布"，以便状态诚实。
48. 作为门店主，assisted 交接我想指定"本人发布/外部责任人"，交接 receipt 绑定精确目标平台、目标账号或责任人、ContentPackage revision、用途、时间、费用范围与一次性 ApprovalReceipt（D-086），24h 未确认提醒、一次性链接 72h 失效，"已交接"与"已发布"分离（后者须外部结果回执或人工记录），以便人工链路可追踪。
48a. 作为手机用户，"交付"打开全高能力面先示最安全下一步；键盘、读屏与焦点恢复必须区分"下载完成/系统分享完成/资料已交接/平台已发布"四种结果（D-086），不支持的能力不以灰色"直接发布"制造错觉。
49. 作为实施者，交接页复用现有 `dashboard/handoff/$token` 四段范式（分享/下载/复制/回报）替换为 canonical delivery 数据源，不从零重做；自动发布 delivery attempt 状态机（partial/unknown/reconcile）后置到首平台过 live gate（D-098 C2），以便首轮不建无生产者的机器。

### J. 通知与收件箱（D-097 + D-098 C2/C7 + #47）

50. 作为门店主，只在关键可行动状态（结果可用/需选择补确认/acceptance_unknown 需恢复核验/最终失败/交付部分成功失败未知/交付完成）收到站内通知，链接精确 workId，以便不被排队进度刷屏。
51. 作为实施者，通知层是引用式投影（复用 pending-actions 收件箱、Task 状态、deliveryEvents），不建独立 Notification 表；四类无源事件与 D-086 逐对象交付投影同批建设；浏览器系统通知后置到真实用户阶段（C7），以免第二真相。

### K. legacy 与遗留项（D-091 + D-098 C4 + GL）

52. 作为门店主，没有来源 Work 的旧内容我想继续在原详情页看只读档案、版本与回执深链（标记"旧内容未记录"），以便历史诚实可查。
53. 作为实施者，首轮只建 ResultTargetResolver 的只读 legacy 分支；`ensure_legacy_content_work_anchor` 写路径后置到真实 pre-lineage 内容出现（D-098 C4），以便不为空人群建机器。
54. 作为门店主，额度用尽被阻塞时我想在阻塞卡内直接输入兑换码解锁（GL-23，出处=`docs/reviews/implementation-gap-ledger-2026-07-19.md` §7.7；独立遗留卫生项，不由 D-072~D-098 授权产品边界），不用导航到设置页，以便闭环不缺一环。
55. 作为实施者，CI 真机持久层 job 须先清 GL-25（reuse delivery lineage 断言红）与 GL-26（provision 脚本补 canvas 迁移）（出处同上 §7.7；独立遗留卫生项），以便新波次验收跑在可信的红绿灯上。

### L. 对已 shipped 票的增补（报告 §6）

56. 作为实施者，T1 的 core"创建即确认 brief"接缝保留并被 D-094 复用，前端"本次将使用"chips 重挂新 Composer、废弃展开四卡路径，以便不推翻已 shipped 底座。
57. 作为实施者，T2 的稳健修复保留，可见 CatalogModel 名按 D-076 回到首屏动态设置行，视频显式确认重挂 D-088 报价合同，以便与新决策对齐。
58. 作为实施者，T4 工作台流中接管与 T6 场景 chips 是被取代面（勿再加码），其后端直发路径决策、Harness 幂等守卫、D-023 候选呈现原样喂给 Result Center，以便迁移不丢已验证行为。
59. 作为实施者，V1 e2e 硬门按 C6 口径重立基线（模板卡一击两用；纯文本路径恰 2 击；必选对口=模式选择器不计前置表单），以便 Day-0 合同持续可断言。

## Implementation Decisions

1. **真相集合不变**：Task/Work/Job/Asset/ContentPackage/RouteSnapshot + ProductUsage/ProviderCost 双账本 + ExportReceipt/ApprovalReceipt/delivery receipts 是唯一业务真相；本轮全部新面（Composer 状态、Result Shell、通知、目录）皆为纯投影或版本化配置引用，禁止第二历史/第二资产/第二发布状态/独立 Notification 表。
2. **创作对口状态机**：`unselected → selected(source:user_explicit) → switch_preview → frozen`；字段记录 `user|template|system` 来源与 dirty/revision；`previewChange → commitChange → undoChange` 统一可逆变更；提交冻结 lens/surface/recipe/model/quote/route revisions。禁止任何自动对口推断与静默跨 CatalogModel 回退。
3. **Creation Experience Catalog（新缝，唯一新增发布聚合）**：`CreationRecipeVersion`（完整可独立校验快照：展示/lens/事实要求/来源槽/Brief 默认/交付物规格/Workflow-Prompt-ModelPolicy-QuotePolicy revision 引用/目标工作区/hash）与 `CreationSurfaceRevision`（纯编排：引用已发布 revision + 排序精选上下架）走 `草稿→预览→校验→发布→回滚` 原子发布；复用 admin-config append-only/CAS/actor/reason/audit 模式（D-037 对账：新增强类型 artifact 独立目录，非第二配置运行时）；Lens 静态枚举、ToolEntry 静态注册表种子（D-098 C3）。隐藏 prompt 只回服务端 revision 引用，不下发浏览器。须附旧 Creation Catalog 迁移/兼容矩阵：现有 `shortcuts/templates/userTemplates` 查询与前端投影哪些映射为 Recipe/Surface、哪些仅留历史、旧查询何时退场——不允许两套同名 Catalog 入口真相并存；前端 `selectedPreset.internalIntent` 直改路径同批删除。目录 published-visible 计数（`published && visible && 能力过门`）与 12 项门槛闸属首轮交付物（搜索实现后置）。
4. **六卡八 variant**：五张单对口 Recipe + "旧内容换平台"同 familyId 三 variant；套用走服务端 `RecipePatchPreview`（保留/暂存/改变三态、可撤销），替换 `selectedPreset.internalIntent` 直改 intent 的旧机制；朋友圈建模为 distribution/export target。
5. **Result Center**：canonical 路由 `/dashboard/results/$workId`（可带 contentId/versionId/panel/focusKey，服务端校验 lineage）；唯一 `ResultShellModel` 投影 + 统一命令适配器 + ResultTargetResolver（含只读 legacy 分支）；首轮直接建三媒介工作面并同轮退场旧 workbench 结果分支与 ContentPackageDetail 重复主动动作（D-098 C1，灰度/影子/renderer 回滚机器后置）；运行态承载 ADR-0007 token 级流式，阶段播报为无障碍聚合层。命名与迁移边界：路由以新建 route 文件落地（不再扩 `dashboard/?workId=` 查询桥）；既有 `harnessCandidateResultModel`、stream phase、delivery capability 作为 Shell 的子投影组合复用；现有 `ContentPackageResults`（发布后转化信号/周复盘）语义保留不挪用为结果壳，防止生成候选与发布后归因混层。
6. **采用合同**：图片角色化动作编译为同一服务端 visual-adoption 命令（create-if-absent 幂等建包 / expectedRevision OCC 更新 / 整组原子写入有序不可变媒体版本）；working selection 为本地 typed intent/reducer（同设备七天恢复，显式保存才成 Work draft revision）；image_text variant 有序视觉列表第 1 张即主图/封面，不建 PrimaryImage/Cover 实体；媒体版本节点=新 owned media asset id + parent/source lineage（不复用 reuse-memory 的配方级 AssetRevision）。既有接缝的可复用边界收窄为"首次 create-if-absent 建包 + generation attachment"：现行 adopt 命令在已采用时直接 409 且无 expectedRevision，"再次采用整组/替换"须新增带 `packageId + baseVersionId + expectedRevision + orderedVisualAssetIds` 的 OCC 命令（如 `revise_content_package_visuals`），一次创建 derived immutable version；不得挪用 `attach_content_package_generation` 表达用户采用。
7. **视频计费**：quote→confirm→reserve→dispatch→settle 单一合同，scope 参数区分单镜/整段；`per_request | per_output_second` 两类计费；task 级 ProductQuoteSnapshot + attempt 级 ProviderCostSnapshot；上限预授权+可信实际秒数结算（低退高不补扣）；一任务一次幂等 ProductUsage；VideoWorkflow 重构为派生读模型（显式立项）。报价对象唯一属主=新 contracts 模块 `product-quote`（ProductQuoteSnapshot/billingMode/quoted-billed seconds/RouteSnapshot 引用），其余线只消费；既有三套报价局部事实（前端客户端 `quoteFor`、共享 `CreativeExecutionContract` quote 字段、canvas 专用持久报价）收敛/适配到该合同，不再造第四套；现行 ProductUsage 仅支持 0|1 单位，按秒差额结算须扩展账本合同；`billedSeconds` 只能来自可信 provider/media 证据并在通用 settle 端落账，视频线不自写第二套退款算法。
8. **交付分层**：能力 resolver 按"拿到文件/交接到平台/直接发布"分组；首轮建 manifest/v1 schema+validator、确定性 ZIP、Web Share 能力矩阵、一次性交接链接（72h）、assisted receipt 状态机（准备/已交接/待人工发布/已记录结果）与 24h 待确认提醒（先做收件箱被动投影）；复用 handoff/$token 页面范式换 canonical 数据源；manifest/ZIP 为**扩展既有确定性 export adapter**（image_text `content.json` 演进为 manifest/v1、补视频完整包分支，保留固定 mtime/顺序/既有 receipt），不新建第二套打包/receipt；视频线只提供成品/封面/字幕/镜头清单输入。自动发布 attempt 状态机与逐平台 live gate 后置（首发 automatic_verified=0）。
9. **通知**：现有 pending-actions 收件箱只投影 `question|approval` 两类，可直接复用的是其传输/排序/唯一当前动作/UI 容器——实现形态=**扩展该引用式 inbox projection**（新增可行动条目类型如 ActionableInboxItem，保持既有 PendingAction 合同兼容），Task 终态与 deliveryEvents 扩展是须新建的事件源；精确 result deep link + 可验证 revision；失效显示 recoverable error 不回落最近结果。
10. **条件 Brief**：服务端 trigger projection（视频/多交付物/超四图/受限素材/高风险事实/报价门槛/确认失效），绑定精确 draft/recipe/model/quote/source revisions；触发规则属代码级安全策略，运营配置不可关闭。
11. **权限与审计**：延续既有合同——高影响动作带目标/影响预览、原因、CAS/幂等或回滚、不可变审计；`publication.handoff` 权限映射进交付面。
12. **shipped 底座处置**：T1 core auto-confirm、T2 稳健修复、T3 开关合同、T5 授权内联、Ta/Tb/Tc/Td 账本支付线全部保留复用；T4/T6 前端表面按新面替换后删除；V1 按 C6 口径重立。
13. **工具 dispatch 与 Pro Studio gate**：底层仅 `composer_recipe | standalone_tool` 两类入口，`dialog|route|workspace` 只是 standalone 呈现容器非第三运行时；Pro Studio 入口只到 `/pro-studio` canonical gate，复用 entitlement/Owner checkout/激活等待/Canvas SSO，禁止绕 gate 深链；跨入口上下文=typed ToolHandoff（字段白名单：稳定 id/revision/角色/最小设置），URL 与 sessionStorage 不含正文/授权/隐藏 prompt/Provider/完整草稿。
14. **模型可见/渠道隐藏序列化边界**：Composer 设置行、Brief、Result 运行详情、错误与退款文案、交付面向普通用户只暴露产品化 CatalogModel 名称与产品报价；ProviderProfile/ExecutionChannel/Deployment/Credential/New API/Sub2API/内部价格/fallback 顺序不得出现在任何浏览器可见合同（D-062/D-076/D-085），以序列化/快照测试锁定。
15. **创作配置事件 revision**：只定义并记录 exposure/select/apply/start/complete/correct/cancel 七类事件（携带 surface/recipe/action/lens revision，不含隐藏 prompt 与用户敏感正文），供后续调整首发组合；不建聚合看板（D-078 证据边界）。

## Testing Decisions

- **好测试的定义**：只测外部行为与合同（命令输入→canonical 对象状态/回执/账本），不测实现细节；durable 载体不被测试 import（继承 D-038/07-18 spec 接缝拍板）。
- **接缝（由高到低，全部沿既有形态）**：
  1. **HTTP 命令 + 合同测试**（既有 operations 测试形态）：visual-adoption、recipe apply、quote/confirm/settle、delivery、通知投影查询——覆盖幂等键重放、OCC 冲突、部分失败保真（404/409 不吞错）。
  2. **发布聚合合同测试**（新缝，参照 admin-config 测试）：Catalog 的草稿/校验/原子发布/回滚/非法引用/并发发布冲突/会话冻结（新 revision 不影响已打开草稿）。
  3. **纯投影单测**（既有 product/*-model.test.ts 形态）：ResultShellModel phase/action 矩阵、通知投影、Recent projection、RecipePatchPreview reducer、lens 状态机（unselected/冲突/撤销/恢复）。
  4. **前端交互测试**（须先建基建——Codex 复核 R-03 实锤：当前 Web 测试为 `tsx --test`/node:test + SSR 渲染，仓库无 Vitest/RTL）：WT-0 显式立"测试基建票"引入 Vitest+jsdom+RTL+user-event 并落一个真实焦点/键盘交互样例，六卡冷态/套用/冲突确认/撤销、单一 bottom sheet 恢复、radiogroup 语义在其上编写；若基建票被否，则这些交互断言全部改落 Playwright，不得声称"既有 RTL 先例"。
  5. **e2e 真机**（V1/auth e2e 形态，Playwright 四服务真启动，先例 `tests/e2e/specs/uiux-day0-contract.spec.ts`）：C6 口径点击计数分路径断言——普通无冲突模板：卡片(1)+开始(2)到首 token；纯文本：选对口(1)+开始(2)；**视频：卡片/选对口+开始+条件 Brief 确认（D-094/D-043 决定③的额外一次确认不因 C6 取消）**；token 流式中间态、结果中心提交→采用→交付闭环、移动恢复、暗色。
  6. **无障碍与视觉合同矩阵**：设计系统非回归（复用现有白瓷/玻璃/字体/状态色/明暗主题，不另起视觉系统，D-074）；卡片单一 button 语义/非 hover/触区≥48×48px/单次 polite 播报（D-083）；320×720、390×844、横屏、200% 缩放（<280px 单列不截断）矩阵（D-084）。
- **验收口径**：首轮验收必须同时覆盖文本/图片/视频三模态的可发现、提交、等待（流式）、结果、调整、保存/交付、恢复（D-073）；CI 真机持久层 job 先清 GL-25/26。

## Out of Scope（本 spec 明确不做）

- 自动发布 delivery attempt 状态机（partial/unknown/reconcile）与任何平台 `automatic_verified` 上线票（D-098 C2；逐平台独立 live gate 后按票开放）。
- Result Center 灰度分桶、shadow projection、新旧 renderer 共存回滚、Wave 1 兼容 panel（D-098 C1；D-040 运营重启解锁）。
- Lens/ToolEntry 的可发布配置生命周期与可视编辑器（D-098 C3）；工作区/套餐/地区多层配置覆盖（D-078 首版全局）。
- `ensure_legacy_content_work_anchor` 写路径与修复机器（D-098 C4）。
- 目录搜索索引/匹配实现（D-098 C5；门槛闸建、跨 12 项解锁）。
- 浏览器系统通知（Web Notifications/SW，D-098 C7）；跨平台批量交付调度（D-086 首版单平台单账号 attempt）。
- 插件市场/第二 Canvas Agent/通用 RecipeFragment DSL/成员 RBAC（各决策明令）。
- GL-24（Harness 主路径中止，accepted_decision 维持）、GL-27（死代码清理 P3）；运营期合规/预登记流程（D-040 置后）。
- 竞品数据抓取与运营指标看板（D-078 证据边界：事件 revision 保留，看板不入本轮）。

## 分包与 Worktree 划分（拆票打包形式）

沿 07-18 四线 worktree 模式（文件属主互斥 + handoff 文档 + 依赖序拆票）。**Codex 复核（R-01/R-02）实锤：现状属主天然不互斥**——core 的 `operations/application-service.ts`+`foundation-module.ts` 同时容纳 Brief/提交冻结与 adoption/export；前端 `unified-creation-workbench.tsx`（4600+ 行）与 `mobile-action-book.tsx`（2600+ 行）同时容纳 Composer、结果、视频与交付；`routes/dashboard/index.tsx` 是 Composer 根路由与旧 `?workId=` 结果桥的共同文件。因此必须先落 **S1 contract-spine 前置票**再开并行：

- **S1 contract-spine（并行前唯一前置，整合属主执行）**：新建 contracts 接口文件并冻结属主——`product-quote`（WT-B 独占）、`result-center`（WT-D1 属主，含 `{workId, returnToDraftKey, focusKey}` 导航合同）、`creation-experience`（WT-A 独占）、`video-workflow`（WT-E 独占，从 `model-supply/index.ts` 无行为抽出 video-workflow-contract）；共享冻结清单（并行期间仅唯一整合属主可改）：`operations/application-service.ts`、`operations/foundation-module.ts`、`operations/types.ts`、`operations/repository.ts`、`operations/postgres-repository.ts`、`apps/core/src/main.ts`、`packages/contracts/src/index.ts`、`packages/contracts/src/uiux.ts`、`unified-creation-workbench.tsx`、`mobile-action-book.tsx`；`routeTree.gen.ts` 仅生成永不手改。A/B 各建独立新模块目录与 FoundationModule，禁止继续向 OperationsApplicationService 塞新方法，整合票做薄接线。

六条开发线：

- **WT-0 卫生与测试基建（无阻塞，最先动）**：GL-25 归因修复 + GL-26 provision 补 canvas 迁移 + V1 e2e 按 C6 口径重立基线 + 前端交互测试基建（Vitest+jsdom+RTL 样例）。属主：`scripts/ci/`、CI workflow、e2e 断言文件，另加 GL-25 实际涉及的 harness 交付测试与最小修复 hunk（`p1/harness/delivery.postgres.test.ts`、`p1/harness/postgres-store.ts` 窄属主）与测试基建配置文件。
- **WT-A 创作配置与 Composer 合同（core）**：Creation Experience Catalog（Recipe/Surface 发布聚合、校验、会话冻结、旧 Catalog 迁移矩阵）、RecipePatchPreview 服务端合同、条件 Brief trigger projection、revision 冻结链、事件 revision 记录。属主：新模块目录 `p1/creation-experience/**` + contracts `creation-experience`（admin-config 只读参考不改）。
- **WT-B 计费交付通知合同（core）**：ProductQuoteSnapshot + per_output_second 结算（含 ProductUsage 账本扩展）、visual-adoption/`revise_content_package_visuals` OCC 命令、export adapter 扩展（manifest/v1+视频完整包）+ assisted receipt 状态机 + deliveryEvents 扩展、inbox projection 扩展（ActionableInboxItem）+ Recent 投影、ResultTargetResolver 只读 legacy 分支。属主：新模块目录 `p1/product-billing/**`、`p1/result-delivery/**` + `p1/pending-actions*` + `operations/content-package*` + contracts `product-quote`/`content-package`/`actionable-inbox`。
- **WT-C 首屏 Composer 重建（前端）**：lens 状态机、六卡/RecipePatchPreview 前端、动态设置行（T2 增补：模型名回首屏）、移动两列三行 + 全屏目录 + 单一 bottom sheet、工具入口、T1 chips 重挂、GL-23 阻塞卡内联兑换。属主：新目录 `src/product/composer/**` + creation-entry/creation-catalog-model/creative-quote 系文件 + `routes/dashboard/index.tsx`（WT-C 唯一属主）+ 全屏目录新 route；不得触碰两大冻结容器与 results 路由。
- **WT-D 结果中心与三工作区（前端）**：`/dashboard/results/$workId` 路由、ResultShellModel/命令适配器、token 流式运行态（ADR-0007）、文案/图文与图片工作面（套图 working selection）、交付面板（拿到文件 + assisted，复用 handoff/$token 范式）、旧结果分支与 ContentPackageDetail 重复动作同轮退场（T4 表面替换）。拆为 **D1**（Result Shell/route/命令适配器/运行态流式，先冻结 result-center 合同供 C/E 消费）与 **D2**（三工作区整合/交付面/自有 content-package-detail 重复动作收敛；含视频面的旧 workbench 分支物理删除归 Z 票）。属主：新目录 `src/product/results/**` + 新 route `routes/dashboard/results_/$workId.tsx` + workbench-state-model/copy-candidate/copy-stream/handoff/$token/content-package-detail（仅退重复动作）；不得触碰 `dashboard/index.tsx` 与两大冻结容器。
- **WT-E 视频线（core+前端跨栈窄切）**：VideoWorkflow 派生化重构（显式立项）、**工作面内 regeneration（单镜/整段）确认与结算/退差额展示**（Td 增补）、视频工作面（单镜/整段/字幕/封面）。Composer **提交时**的视频确认 UI（Story 24/26）归 WT-C——渲染层消费 WT-B `product-quote` 合同的 billingMode/quotedSeconds，报价冻结走 B/A 链；据此 WT-E 前端仅阻塞于 D1 合同，无 WT-C 边。属主：`model-supply/composed-video-workflow*` + 抽出的 video-workflow-contract + `video-content-package-port.ts` + contracts `video-workflow` + 前端 `video-workflow-*` 与 `src/product/results/video/**`；不得拥有 product-quote/content-package contracts 与任何 ZIP/receipt 实现（只供输入）。

依赖边（开发顺序骨架，按 Codex 复核 R-10 修正）：`WT-0 ∥ S1 先行 → A 与 B 并行（新模块目录互斥）→ WT-C 阻塞于 A **和 B**（服务端报价快照在 B）；WT-D1 阻塞于 B（Shell/route/命令适配器，消费已冻结的 A provenance 字段）；WT-E core 阻塞于 A（条件 Brief/冻结链）**和 B**（报价结算）；WT-E 前端阻塞于 D1 的 result-center 合同（前置冻结，不是后段再接）→ WT-D2 三工作区整合 → **Z 收尾 cutover 整合票**：旧结果分支/ContentPackageDetail 重复动作/T6 场景 chips 的物理删除与 V1 全量门，硬依赖 **WT-C + WT-D + WT-E 三线**的桌面/移动门与三模态 e2e 全绿（D-098 C1"三媒介新面齐备后退旧"，不得视频未齐先删旧 fallback）`。合并顺序：WT-0/S1 → A/B → C/D1/E-core → D2/E-frontend → Z。每线一份 handoff（`docs/handoff/`），列明属主文件边界、消费的合同接口、阻塞票号与验收命令；跨线接口一律走 contracts 包类型与 HTTP 合同测试，不允许跨 worktree 直接 import 对方未合入代码；完整属主 glob 清单见 `.scratch/ui-journey-spec-review-2026-07-20/lane2-reality.md` 属主节（handoff 定稿时逐字收编）。

## Further Notes

- **建造顺序纲领**：在 #50-#60/#61-#72 已 shipped 接缝之上重建；先合同类型与纯投影（低风险可并行），Result Center 直接建成后一次性退旧（不留双活）；T4/T6 表面在新面可用前保持现状但禁止加码。
- **第二真相高危点**（复核 §5）：D-086 delivery attempt 与既有 DeliveryAttempt 对象须显式声明为扩展同一对象；通知/Recent/目录全部只读投影。
- **零余量点击预算**：C6 口径下两条主路径都恰好 2 击，任何新增前置节都会破 D-043 硬门——新票引入 UI 节点时必须重跑点击计数断言。
- **拆票时注意显式立项**：VideoWorkflow 派生化重构、handoff 页 canonical 化迁移、`copy.adapt` 与客户端拼接双轨收敛，三者都是"看似改名实为重构"的坑位。
