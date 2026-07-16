# 美业内容副驾 P0 产品页面蓝图与工作流规格

> 状态：历史快照（2026-07-07）。当前 P1/UIUX 与 ContentPackage 口径以 [`CONTEXT.md`](../../../CONTEXT.md)、最新 ADR、当前阶段决策日志和 [`docs/specs/contentpackage-productization-spec.md`](../../../docs/specs/contentpackage-productization-spec.md) 为准；本文保留原始 P0 页面与工作流证据，不覆盖后续一级导航或成品事实源决策。

> 2026-07-07 v1.5 对齐批注（已由 2026-07-08 晚修订）：本文以 `合集-v1.5-P0决策定稿.md` 的最新 Scope Lock 为准。P0 保 8：门店档案、真实素材库、文案生成、视频成片、内容库、L3 发布包、合规 gate、手工线索台账；L2、完整账号中心、完整用量账本、图文渲染管线、周报均不作为 P0 必交付。
>
> 2026-07-08 UI/交互对齐批注：首屏以“示例美甲店 + 美业场景技能卡 + AI 预填可编辑表单 + 任务四态卡 + 合规四段式文案”为准；prompt-kit、Streamdown/cjk、AI SDK UI 路线为组件事实源，RSC 禁入生产。
>
> 2026-07-08 晚 D3/D5 批注（v1.5 修订摘要第 13 条 + ADR-0008）：页面骨架为 **“1 个 Agent 工作台 + 3 个轻侧栏资产页”**（对话式外壳、结构化内核；L0-L4 换容器保内核；副驾不设独立浮层）；**视频成片已并入 P0 主打**。页面级权威口径见 v1.5 02 §1 与 00 §3.2。

日期：2026-07-07

类型：页面级 PRD + workflow blueprint

相关资料：
- `合集-v1.5-P0决策定稿.md`
- `references/creatok/reports/creatok-function-breakdown.md`
- `references/benchmark/reports/p0-benchmark-matrix.md`
- `references/creatok/reports/creatok-productization-architecture-gap-analysis.md`
- `references/benchmark/interaction-study-2026-07-07/interaction-patterns-xyq-creatok.md`
- `references/benchmark/ui-adaptation-study-2026-07-08/00-合成-UI适配与组件选型.md`

配套低保真原型：
- `references/prototypes/p0-product-blueprint/index.html`

## 1. P0 产品定义

P0 是面向美业到店和医美/医疗资质准入制商家的云端 Web 创作副驾。它不做全自动运营；图文渲染管线仍缓做，但视频成片已是 P0 主打功能之一。

P0 目标：

```text
让一家美业门店从“每条内容 1-2 小时”
降到“5-10 分钟准备一条可发文案，提交即走生成一条可发短视频”，
并能记录内容带来的咨询 / 加微 / 预约 / 核销。
```

P0 主闭环：

```text
开通
  -> 建门店档案
  -> 上传真实素材
  -> Agent 工作台提出今日建议 / 接收三喂料
  -> brief 确认卡
  -> 生成文案候选或视频成片任务
  -> 合规预审 / 采用
  -> 生成 L3 发布包 / 人工发布
  -> 记录线索
  -> 人工汇总反馈下一批内容
```

成功标准：
- 新店 5 分钟内产出第一条可发内容，占比 >= 70%。
- 文案直接采用或小改采用率 >= 60%。
- 视频成片链路可跑通，单条成本 / 端到端时长 / 质量可用率 / 标识烧录可行性有实测记录。
- 第 2-4 周每店每周至少产出/发布 3 条，占比 >= 50%。
- >= 60% 门店能记录至少 1 条内容到线索的关联。
- AIGC 标识注入率 100%。
- 受监管内容发布前核验提醒覆盖率 100%。
- L3 发布包使用率试点继续开发线 >= 60%。

## 2. 信息架构

P0 骨架为一个 Agent 工作台加三个轻侧栏资产页：

| 页面 | 页面目标 | P0 范围 | P1 后置 |
| --- | --- | --- | --- |
| Agent 工作台 | 发起和推进创作流 | 拟人化问候 + 今日建议 chips + 中央意图框（三喂料）+ 场景 chips + brief 确认卡 + 进度旁白 + 候选 / 合规 / 产物卡 + 任务浮标 | 高级内容日历、批量团队协作 |
| 内容库 | 沉淀流中产物 | 草稿、已发布两态 + 文案 / 视频产物 + 基础平台变体 | 待发布队列、本店爆款、高级排期、多账号表现分析 |
| 线索台账 | 人工记录咨询、加微、预约、核销并关联内容 | 手工录入、内容关联、人工洞察 | 自动抓取评论/私信、统一收件箱、自动周报 |
| 门店档案 | 沉淀项目、价目、人设、真实素材、资质与合规资料 | 档案、素材、项目、禁忌、资质档案、账号基础记录 | 独立账号中心、能力矩阵四表、多门店 |

账号中心和用量/套餐不作为 P0 一级导航。账号能力收在门店档案和发布包流程中；用量只以顶部 quota meter、生成按钮旁次数提示和账户抽屉承载。P1 再独立账号中心、用量/套餐页。

## 3. Agent 工作台

### 3.1 页面目标

Agent 工作台是首页和产品本体。用户进入后应该看到 agent 已经提出建议，并能通过点选、拍照传图、粘贴文本或一句话意图直接开跑，而不是进入传统卡墙或空白表单。

核心问题：
- 本周要发什么。
- 用哪些真实素材。
- 每条内容适合哪个平台。
- 是否有合规风险。
- 下一步是确认 brief、选择文案候选、等待视频成片、保存草稿或生成发布包。

### 3.2 页面结构

```text
Agent 开场
  拟人化问候 / 今日建议 chips / quota meter

中央意图框
  打字 / 拍照传图 / 粘贴文本（三喂料同框）
  场景 chips 一行横滑 + 全部场景展开

创作流时间线
  brief 确认卡
  进度旁白
  文案候选卡（三选一 + 换一批）或视频任务卡（单发 + 免费重试）
  合规预审卡
  产物卡
  发布包入口

右下
  异步任务浮标 / 连接桥通知状态
```

首屏 10 秒优先级：

| 元素 | P0 要求 |
| --- | --- |
| 示例工作区 | 以 agent 演示流形式预置示例美甲店、已授权素材、内容卡、视频任务和发布包；只读、不计用量、可隐藏 |
| 场景入口 | 一行 chips + 可展开货架；不再用卡墙占首屏 |
| brief 确认卡 | 合并 L1 槽位、L0.5 逐槽确认、L4 AI 预填；Hook 独立成槽，价格字段不 AI 预填 |
| 流式反馈 | 使用 prompt-kit + Streamdown/cjk + AI SDK UI 路线；生产禁用 RSC |
| 任务状态 | queued / running / needs_action / completed 四态；视频分钟级任务可离开可恢复，技术失败自动退，成功不满意给免费重试上限 2 次 |

### 3.3 关键字段

内容卡字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `content_item_id` | id | 内容母体 id |
| `title` | string | 标题或选题 |
| `scenario` | enum | 案例种草、团购优惠、专业科普、顾客口碑、同城引流、门店日常 |
| `recommended_platforms` | array | P0 为小红书、抖音；点评、公众号为 Go 后扩展 |
| `conversion_hook` | string | 私信问价、预约、加微、团购券、到店导航 |
| `body_preview` | string | 正文摘要 |
| `asset_links` | array | 真实素材、授权证明、发布包素材 |
| `visual_plan` | object | 封面建议、素材顺序、Canva/人工渲染说明；不代表 P0 自建图文渲染管线 |
| `video_storyboard` | object | P0 视频成片流内可确认分镜 / Hook / 首帧建议 |
| `video_artifact_id` | id | P0 视频成片产物，可为空 |
| `compliance_status` | enum | unchecked、pass、warning、blocked、regulated_preflight_required |
| `quota_cost_hint` | object | 本次生成消耗与剩余额度提示 |
| `status` | enum | 以 `p0-data-model-api-contract.md` §4 为准；UI 不使用 `ready_to_publish` |

### 3.4 主要 CTA

| CTA | 作用 | 约束 |
| --- | --- | --- |
| 就发这条 / 换个建议 | 从今日建议 chips 开跑 | 生成前展示本次消耗 |
| 从素材生成一条 | 选择素材后生成单条内容 | 必须记录素材来源和授权状态 |
| 更口语 / 更专业 / 弱化广告感 | 快速改稿 | 新版本进入 content_versions |
| 生成封面/图文建议 | 输出素材顺序、封面文案、Canva/人工渲染建议 | 自建图文渲染管线不进 P0 |
| 生成短视频 | AIDA 分镜确认 → 首帧 → 片段 → 合成 → 标识烧录 | P0 主打；异步任务，按条计价 |
| 生成发布包 | 进入 Publish Compliance Preflight | warning/regulated 默认展示提醒并留痕；行为红线 blocked 硬停，高监管不可逆动作才显式确认 |
| 保存到内容库 | 保存 content item 和 variants | 保存前跑合规 gate |
| 去线索台账 | 关联后续咨询或核销 | 可从内容卡创建 lead |

### 3.5 P0 / P1 边界

P0 必做：
- Agent 工作台创作流。
- brief 确认卡与场景 chips。
- 文案候选三选一与视频成片单发任务。
- 示例工作区演示流。
- 素材缺口提醒。
- 合规状态和替代表述。
- 保存草稿和平台变体。
- 视频成片任务、标识烧录和存相册 / 发布包交接。

P1 后置：
- 内容日历。
- 团队协作审稿。
- 自动读取平台表现。
- 自建图文渲染管线。
- 重编辑时间线。

## 4. 内容库

### 4.1 页面目标

内容库不是文件夹，也不是生成历史。它是内容母体、平台变体、版本、合规、发布和线索的连接中心。

### 4.2 对象模型

```text
Content Item
  -> Platform Variant
  -> Version
  -> Asset Link
  -> Compliance Result
  -> Publish Task
  -> Lead Link
```

### 4.3 视图

| 视图 | 用途 |
| --- | --- |
| 本周内容 | 当前推荐计划和待处理内容 |
| 草稿箱 | 已生成但未确认 |
| 待发布 | P1 队列视图；P0 由内容详情和发布包状态承载 |
| 已发布 | 人工标记或官方能力回写 |
| 本店爆款 | P1 洞察视图；P0 可人工备注，不做独立视图 |
| 已归档 | 低价值或过期内容 |

### 4.4 关键字段

| 字段 | 说明 |
| --- | --- |
| 内容标题 | 内容母体名 |
| 项目 | 关联门店项目 |
| 平台变体 | P0 为小红书/抖音；点评/公众号为 Go 后扩展 |
| 状态 | 以 `p0-data-model-api-contract.md` §4 为准；禁用 `ready_to_publish` |
| 合规 | pass、warning、blocked、regulated_preflight_required |
| 素材 | 使用的真实素材和 AI 辅助素材 |
| 发布任务 | 发布包或 L1/L3 路由（L2 为 P1+ 预留，不进 P0） |
| 线索 | 关联咨询、加微、预约、核销 |
| 版本 | 版本数和最后修改时间 |

### 4.5 主要 CTA

- 打开详情。
- 生成平台变体。
- 再改一版。
- 生成发布包。
- 标记已发布。
- 关联线索。
- 收藏为本店爆款（P1）。

## 5. 线索台账

### 5.1 页面目标

线索台账让商家看到内容和咨询/预约/到店之间的相关性。P0 不做复杂因果归因，也不依赖平台数据可读。

### 5.2 关键字段

| 字段 | 说明 |
| --- | --- |
| 日期 | 线索发生时间 |
| 来源内容 | 关联 content item / variant |
| 平台 | 小红书、抖音、点评、公众号、私域 |
| 类型 | 私信、评论、加微、预约、团购券、核销、到店 |
| 项目 | 关联项目 |
| 金额/券核销 | 可选 |
| 跟进状态 | new、contacted、booked、redeemed、lost |
| 备注 | 人工备注 |

### 5.3 主要 CTA

- 新增线索。
- 从内容创建线索。
- 关联已有内容。
- 记录本周人工反馈。
- 标记已预约。
- 标记已核销。

### 5.4 人工洞察输出

自动周报不作为 P0 必交付。P0 可由陪跑或商家人工汇总可操作洞察：

- 本周发布了哪些内容。
- 哪类内容产生咨询/预约。
- 哪些内容收藏或互动高但线索低。
- 下周建议主推哪些项目。
- 缺少哪些真实素材。
- 有哪些合规高频问题。

## 6. 门店档案

### 6.1 页面目标

门店档案让副驾“懂这家店”，并提供所有生成、合规、发布和线索的业务事实。

### 6.2 模块

| 模块 | 关键字段 |
| --- | --- |
| 基础信息 | 店名、城市、商圈、地址、交通/停车 |
| 项目价目 | 项目名、价格、时长、适合人群、注意事项、禁用承诺 |
| 主推卖点 | 老师资历、环境、服务、产品、审美风格 |
| 预约方式 | 电话、微信、团购链接、私信引导语 |
| 语气人设 | 温柔专业、活泼年轻、老板娘亲切、高端轻奢 |
| 真实素材 | 案例图、before/after、环境图、手法视频、好评截图 |
| 拍摄清单 | 根据素材缺口自动生成 |
| 禁忌话术 | 不能打折、不能承诺、不能使用的素材 |
| 资质与合规资料 | 医疗机构执业许可、医疗广告审查证明、授权证明 |
| 账号基础记录 | 平台账号名、主页链接、认证/资质状态、人工备注；完整能力矩阵四表为 Go 后 / P1 |

### 6.3 冷启动

冷启动可以上传：
- 历史帖子截图。
- 价目表截图。
- 项目介绍。
- 顾客好评。
- 活动海报。
- 门店主页链接。

系统生成档案初稿，但必须让用户确认。未经确认的价目、资质、活动不得用于发布包。

## 7. 发布包与发布任务

### 7.1 页面目标

P0 默认 L3 发布包兜底。L1 官方能力只在官方文档和账号级真实验收后启用；L2 浏览器辅助已移出 P0，不再保留灰度。

### 7.2 发布包内容

| 内容 | 说明 |
| --- | --- |
| 文案 | 标题、正文、话题、CTA |
| 素材 | 原始图片/视频、授权证明、封面建议、素材顺序、视频成片文件；图文卡渲染为 Go 后 / P1 |
| 平台说明 | 平台、账号、人设、发布时间建议 |
| 复制说明 | 每个平台复制/上传步骤 |
| 合规提示 | 风险项、替代表述、人工确认项 |
| AIGC 标识 | 显式/隐式标识状态 |
| 人工确认清单 | 资质、广告审查、授权、价格、平台规则 |

### 7.3 发布任务状态

```text
待准备
  -> 待合规
  -> 待确认
  -> 交接中 / 发布中
  -> 已发布 / 待人工 / 失败
  -> 已归档
```

### 7.4 路由规则

| 路由 | P0 规则 |
| --- | --- |
| L1 官方发布 | 只对 account-level verified 的平台账号启用 |
| L2 浏览器辅助 | P0 禁用；P1+ 仅在 pilot 发布耗时数据支持后重评 |
| L3 发布包 | 默认下限，任何平台都必须可用 |

P0 L3 发布包必须做厚：扫码转手机、分段一键复制、图片/视频打包下载或存相册、发布 checklist。pilot 记录发布耗时，作为 P1 是否重启 L2 的唯一输入。

## 8. 用量 / 套餐

### 8.1 页面目标

商家侧看“本月还能做什么”，系统侧在 P0 保留简单额度计数、视频按条计价和技术失败退款留痕。完整 provider cost 账本、复杂账单分析和团队共享额度为 Go 后 / P1。

### 8.2 商家可理解权益

| 权益 | P0 说明 |
| --- | --- |
| 内容额度 | 生成内容母体和平台变体 |
| 图文额度 | Go 后 / P1；P0 只给封面/图文建议，不自建渲染管线 |
| 视频成片额度 | P0 主打权益，按条计价；单条成本由 Week-1 spike 回填 |
| 发布包次数 | L3 发布包导出 |
| 账号包 | 绑定平台账号数量 |
| 素材容量 | 上传素材、导出文件、授权证据 |

### 8.3 用量状态

```text
estimated
  -> reserved
  -> committed
  -> refunded
  -> failed_no_charge
```

P0 高成本或异步任务记录至少关联：
- workspace。
- user。
- content item / asset / publish task / agent run。
- video artifact / durable job。
- refund reason。

完整 provider、model、estimated/actual cost 和成本分析字段进入 Go 后 / P1 完整用量账本。

## 9. 核心工作流

### 9.1 GenerateWeeklyContentWorkflow

```text
1. load_store_profile
2. retrieve_real_assets
3. check_material_gap
4. select_beauty_scenario_pack
5. generate_topics
6. compose_content_core
7. create_platform_variants
8. create_cover_and_asset_order_suggestions
9. run_compliance_gate
10. save_drafts
11. return_content_cards
```

输入：
- store_id。
- project_ids。
- target_platforms。
- content_count。
- scenarios。
- tone。
- selected_assets。

输出：
- content_items。
- content_variants。
- asset_links。
- compliance_results。
- material_gap。
- quota_cost_hint。

失败兜底：
- 门店档案不足：进入补充问题。
- 真实素材不足：生成拍摄清单。
- 合规 warning：给替代表述。
- 合规 blocked：不允许保存为可发布状态。
- provider 失败：refund 并保留任务状态。

### 9.2 CreateVideoWorkflow

视频成片为 P0 主打。该工作流必须异步、可恢复、可取消，并在合成阶段完成显式 AIGC 标识烧录和隐式 metadata 写入。

```text
1. load_store_profile_and_assets
2. create_aida_storyboard
3. confirm_storyboard_in_stream
4. reserve_video_quota
5. generate_first_frames
6. generate_clips
7. evaluate_candidates
8. compose_video_with_ffmpeg
9. burn_in_aigc_label_and_write_metadata
10. store_video_artifact
11. run_compliance_gate
12. attach_to_content_item_and_publish_package
13. commit_or_refund_usage
```

验收指标：
- 单条成本。
- 端到端时长。
- 质量可用率。
- 标识烧录可行性。

### 9.3 CreateGraphicPackWorkflow（Go 后 / P1）

自建图文渲染管线不属于 P0。P0 只输出封面文案、素材顺序、Canva/人工渲染建议；若 Go 后重启，再按以下工作流实现。

```text
1. select_store_project
2. select_real_assets
3. choose_card_modules
4. compose_copy
5. reserve_graphic_quota
6. render_cards
7. inject_aigc_label_if_needed
8. run_compliance_gate
9. save_assets_and_content_variant
10. commit_or_refund_usage
```

Go 后 / P1 卡片模块：
- 封面种草图。
- 真实案例图。
- 项目卖点卡。
- 适合人群卡。
- 服务流程卡。
- 价格/优惠卡。
- 注意事项卡。
- 环境/老师信任卡。
- 预约引导卡。
- 合规提示卡。

### 9.4 CreatePublishPackageWorkflow

```text
1. load_content_variant
2. load_account_capability
3. run_publish_compliance_preflight
4. reserve_publish_package_quota
5. package_copy_assets_video_labels
6. choose_route_L1_L3
7. export_package
8. create_publish_task
9. commit_or_refund_usage
```

硬停止：
- 伪造资质。
- 未授权顾客案例。
- 移除 AIGC 标识。
- 绕过平台审核。
- 疗效/安全性保证。
- 治愈率/有效率承诺。
- 处方药、未经批准药械或未核验医疗广告内容。
- 违法不良信息、滥用资质或平台规则规避请求。

硬停止清单以 `合集-v1.5-P0决策定稿.md` 09 章为准；本文只列 P0 发布包工作流中的高频项。

### 9.5 LeadWeeklyReportWorkflow（Go 后 / P1）

自动周报不属于 P0。P0 可人工汇总内容与线索洞察，Go 后再产品化为以下工作流。

```text
1. aggregate_content
2. aggregate_manual_leads
3. link_leads_to_content
4. summarize_patterns
5. suggest_next_week_topics
6. suggest_material_gap
7. save_weekly_report
```

输出：
- 本周内容数量。
- 内容到线索关联数。
- 预约/核销量。
- 高表现内容。
- 下周选题。
- 素材缺口。
- 合规高频风险。

## 10. 状态模型

### 10.1 ContentStatus

```text
draft
review_required
ready_to_package
package_created
published
needs_manual_action
failed
archived
```

### 10.2 ComplianceStatus

```text
unchecked
pass
warning
regulated_preflight_required
blocked
manually_confirmed
```

### 10.3 PublishTaskStatus

```text
preparing
compliance_pending
confirmation_pending
handoff_ready
publishing
published
manual_required
failed
archived
```

### 10.4 UsageStatus

```text
estimated
reserved
committed
refunded
failed_no_charge
```

### 10.5 LeadStatus

```text
new
contacted
booked
redeemed
lost
invalid
```

## 11. P0 验收清单

| 维度 | 验收标准 |
| --- | --- |
| 激活 | 新店 <= 5 分钟产出第一条可发内容，占比 >= 70% |
| 内容质量 | 直接采用/小改采用率 >= 60% |
| 频率 | 第 2-4 周每店每周至少产出/发布 3 条，占比 >= 50% |
| 线索 | >= 60% 门店记录至少 1 条内容关联线索 |
| 发布 | L3 发布包使用率 >= 60%；L1 只按 account-level verified 平台启用 |
| 合规 | 行为红线硬拦截命中率 100%；AIGC 标识注入率 100%；素材授权和 before/after 门控可用；受监管内容 Preflight 提醒展示并留痕 |
| 视频 | 视频成片链路跑通；单条成本 / 端到端时长 / 质量可用率 / 标识烧录可行性实测在案 |
| 用量 | 生成按钮旁标注本次消耗和剩余额度；视频按条计价；异步/高成本技术失败自动退并留痕 |
| 审计 | 合规、用量、导出、发布包、工具调用均有 correlation id |

## 12. P0 / P1 边界

P0 必做：
- 创作台主工作流。
- 示例美甲店工作区。
- 美业场景技能卡。
- AI 预填可编辑表单。
- 当前生成任务四态卡。
- 内容卡片流。
- 内容库。
- 线索台账手工录入。
- 门店档案和真实素材库。
- L3 发布包。
- 视频成片。
- durable 异步任务、视频存储/转码/标识烧录链、视频额度计价。
- 合规 gate。
- 简单额度计数和生成前次数提示。

P1 后置：
- 内容日历。
- 独立账号中心。
- 完整能力矩阵四表。
- 图文渲染管线和图文套图。
- 完整用量账本。
- 重编辑时间线、数字人口播、专业剪辑能力。
- 自动周报。
- 团队协作。
- 官方平台能力深化。
- 发布成功/失败分析。
- 外部 Agent Skills。

暂不做：
- 全自动发布承诺。
- 私有签名逆向。
- 群控养号。
- 住宅代理池。
- captcha bypass / cookie extraction。
- 完整 CRM/SCRM。
- 复杂因果归因。
- 未核验医疗广告发布。
