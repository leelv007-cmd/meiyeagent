# CreatOK 对我方产品化与技术架构差距分析

日期：2026-07-07

相关资料：
- 我方规划：`合集-v1.2-含开源项目选型.md`
- CreatOK 功能拆解：`references/creatok/reports/creatok-function-breakdown.md`
- P0 竞品对标矩阵：`references/benchmark/reports/p0-benchmark-matrix.md`
- CreatOK 技术表面线索：`references/creatok/notes/technical-surface.md`
- CreatOK 证据索引：`references/creatok/notes/evidence-index.md`

## 1. 总结判断

CreatOK 对我方的价值不在跨境电商行业本身，而在它把 AI 多模态能力产品化成一套垂类内容生产系统：

```text
垂类任务入口
  -> 结构化输入
  -> 异步生成任务
  -> 历史 / 示例 / 模板
  -> 资产库沉淀
  -> 平台发布页
  -> credits / plan / team
  -> Agent Skills 外部入口
```

我方要迁移的是这套机制，而不是迁移 TikTok 电商的业务对象。

对美业到店 P0，正确吸收方式是：

```text
门店档案
  -> 真实素材库
  -> 创作台主工作流
  -> 内容母体与平台变体
  -> 合规 gate
  -> L3 发布包 / verified L1
  -> 线索台账
  -> 周报和下一轮内容建议
```

核心结论：

1. **CreatOK 的“结构化工作流 + 任务历史 + 资产库 + 积分账本”应进入我方 P0。**
2. **CreatOK 的 Flow、社区模板、外部 Agent Skills、团队工作流应进入 P1/P2。**
3. **CreatOK 的 TikTok 爆款复刻、真视频生成首屏承重、电商 A+ 详情图、TikTok Shop 发布路径不应照搬。**
4. **我方必须补齐 CreatOK 缺失的门店知识、真实素材权利、内容到线索闭环、国内平台发布边界和美业/医美合规审计。**

## 2. 进入 P0 的产品机制

| CreatOK 机制 | 证据 | 我方 P0 决策 | 必要改造 |
| --- | --- | --- | --- |
| 首页即主工作流 | dashboard 首屏就是视频生成输入框和工具卡 | 创作台首页直接给“生成本周内容”与“从素材生成一条内容” | 默认生成内容卡，不默认生成真视频 |
| 垂类工具卡 | 视频、图片、音频、工具 hover 菜单 | 收敛成文案、图文、视频脚本、发布包、线索周报、拍摄清单 | P0 不暴露 20+ 工具入口 |
| 历史 / 示例 tab | 视频/图片生成页有历史与示例 | 每个生成任务进入内容库和任务历史 | 示例换成美业场景包 |
| 结构化输入 | 商品套图/A+ 要求平台、市场、语言、商品信息、模块 | 图文套图要求项目、平台、素材、价格/优惠、卡片模块 | 商品字段改成门店项目和预约规则 |
| 预设 / 优化 / 向导 | 生成框附近有预设、优化、向导、积分估算 | 加入平台风格、语气、素材缺口、合规改写和成本估算 | 向导必须先问门店资料缺口 |
| 资产库 | AI 生成、上传资产、数字人、商品库、回收站 | 真实素材、AI 生成、发布包、门店资料、回收站 | 增加授权、敏感、已用、合规 metadata |
| TikTok 发布页 | 账号列表、授权、官方 API、支持国家、教程 | 账号能力矩阵 + 发布层级 + L3 发布包 | 国内平台默认 L3，L1 只按账号 verified |
| credits + plan | 套餐、积分、失败补偿、队列、团队共享 | Usage Ledger reserve / commit / refund | 商家侧包装为内容额度、图文额度、账号包 |
| task id / 状态 | ai-tasks、submit、resume、queued/processing/completed/failed | 所有生成、导出、发布包任务可恢复、重试、退款 | 任务事实归 Core API，不归前端或 Agent |

## 3. P1/P2 后置机制

| CreatOK 机制 | 后置原因 | 我方阶段 |
| --- | --- | --- |
| Flow 画布 | 对低运营水平商家过重，P0 不需要自由工作流 | P1/P2 做模板中心或运营人员工作台 |
| 社区模板 | 需要先验证本店内容采用率和场景包质量 | P1 做美业场景包模板库 |
| 团队工作流 / 团队资产 | P0 单店自助 + 陪跑为主 | P1 做简单团队协作，P2 做代运营工作台 |
| 外部 Agent Skills | P0 开放会增加支持成本和安全面 | P1/P2 在内部 tools 稳定后开放 |
| 真视频生成 | 成本、质量、合规和交付风险高 | P1 轻视频，P2 再评估文生视频/数字人 |
| 多语言 / 多市场 | 美业 P0 先做本地中文平台 | P2 其他垂类或出海再评估 |

## 4. 不应照搬的做法

| CreatOK 做法 | 为什么偏离我方 | 我方替代 |
| --- | --- | --- |
| TikTok 爆款复刻作为中心卖点 | 美业直接复刻容易触发版权、肖像、医疗广告和平台风控风险 | 本店历史内容复用 + 竞品结构参考 + 合规改写 |
| 真视频生成作为首页承重 | P0 成本高、失败率不可控，且商家素材质量参差 | 视频脚本、分镜、拍摄清单、字幕草稿、轻视频发布包 |
| TikTok Shop 商品链接识别 | 美业服务不是标准商品 SKU | 门店项目价目、活动、案例素材、预约规则 |
| A+ 电商详情图 | 本地生活成交发生在小红书/点评/抖音/私域，不是电商详情页 | 项目套图、案例卡、流程卡、价格/优惠卡、预约引导卡 |
| 官方 TikTok API 路径 | 国内平台能力差异大，不能外推出自动发布 | L3 发布包兜底，L1 only account-level verified，L2 no-submit 灰度 |
| 通用版权/商用授权口径 | 医美/医疗还涉及资质、广告审查、疗效表达、顾客授权 | Regulated Content Mode + Publish Compliance Preflight + 审计 |

## 5. 我方 P0 页面结构调整

CreatOK 的导航规模对我方 P0 过重。美业商家首屏应更克制，避免“工具大全”。

建议 P0 一级导航：

```text
创作台
内容库
线索台账
门店档案
用量/套餐
```

账号中心在 P0 收进门店档案或发布包流程中，P1 再独立成一级导航。

### 5.1 创作台

对标来源：CreatOK dashboard 主生成框、Agent 快捷动作、视频/图片历史与示例。

P0 页面结构：

```text
顶部：本周主推项目 / 目标平台 / 内容数量 / 素材状态 / 额度预估
左侧：本周内容卡片流
右侧：副驾对话与快捷改稿
底部：保存草稿 / 生成发布包 / 去线索台账
```

内容卡字段：
- 标题。
- 推荐平台。
- 内容类型。
- 转化钩子。
- 正文预览。
- 配图/封面建议。
- 视频脚本入口。
- 合规状态。
- 使用素材。
- 操作按钮。

P0 快捷动作：
- 生成本周 3-5 条内容。
- 从案例图写小红书。
- 生成抖音口播。
- 生成点评项目介绍。
- 生成拍摄清单。
- 生成发布包。
- 合规改写。

### 5.2 图文套图

对标来源：CreatOK 商品套图和 A+ 内容的结构化输入、模块选择器、输出结构。

我方 P0 不做电商 A+，改成项目套图：

| 卡片 | P0 用途 |
| --- | --- |
| 封面种草图 | 小红书/抖音封面 |
| 真实案例图 | 展示顾客授权素材或真实项目结果 |
| 项目卖点卡 | 服务差异、老师经验、材料/产品说明 |
| 适合人群卡 | 需求分层，不做疗效承诺 |
| 服务流程卡 | 到店步骤和体验说明 |
| 价格/优惠卡 | 仅引用已确认价目和活动 |
| 注意事项卡 | 售前/售后说明 |
| 环境/老师信任卡 | 门店环境、老师资历、服务口碑 |
| 预约引导卡 | 私信、电话、团购券或门店定位 |
| 合规提示卡 | AIGC 标识、资质/授权提醒 |

### 5.3 内容库

对标来源：CreatOK 的历史任务和资产沉淀。

我方不能停留在生成历史，应做内容项目模型：

```text
Content Item
  -> Platform Variant
  -> Version
  -> Asset Link
  -> Compliance Result
  -> Publish Task
  -> Lead Link
```

最小视图：
- 本周内容。
- 草稿箱。
- 待发布。
- 已发布。
- 已归档。
- 本店爆款。

筛选：
- 平台。
- 项目。
- 状态。
- 合规。
- 是否带线索。
- 是否使用真实素材。

### 5.4 线索台账

CreatOK 没有本地商家的线索闭环，这是我方必须补齐的差异化。

P0 字段：
- 来源内容。
- 平台。
- 时间。
- 类型：私信、评论、加微、预约、团购券、核销、到店。
- 项目。
- 金额/券核销。
- 跟进状态。
- 备注。

P0 周报：
- 哪类内容带来咨询。
- 哪类内容收藏高但咨询低。
- 哪个项目缺素材。
- 下周建议发什么。

### 5.5 门店档案

CreatOK 有商品信息和商品库，但我方需要门店业务档案。

P0 模块：
- 基础信息。
- 项目价目。
- 预约方式。
- 账号人设。
- 真实素材。
- 拍摄清单。
- 禁忌话术。
- 资质与合规资料。
- 账号授权。

冷启动可借鉴 CreatOK 的附件上传和 Agent 引导，但必须要求用户确认档案初稿。

### 5.6 发布中心/发布包

CreatOK 的 TikTok 发布页适合借鉴信息结构，不适合借平台路径。

P0 发布包必须包含：
- 标题、正文、话题、封面文案。
- 图片/图文/视频脚本/字幕草稿。
- 平台和账号建议。
- 发布时间建议。
- 复制说明和素材下载。
- 合规提示。
- AIGC 标识状态。
- 人工确认清单。

发布任务状态：

```text
待准备
  -> 待合规
  -> 待确认
  -> 交接中 / 发布中
  -> 已发布 / 待人工 / 失败
  -> 已归档
```

## 6. 生成工作流取舍

### 6.1 P0 主工作流

CreatOK 的“视频生成输入框”应被改造成“本周内容工作流”：

```text
GenerateWeeklyContentWorkflow
  1. load_store_profile
  2. retrieve_real_assets
  3. check_material_gap
  4. select_beauty_scenario_pack
  5. generate_topics
  6. compose_content_core
  7. create_platform_variants
  8. create_visual_plan
  9. create_video_script_if_needed
 10. run_compliance_gate
 11. save_drafts
 12. return_content_cards
```

验收：
- 新店 5 分钟内产出第一条可发内容。
- 每条内容有平台建议、转化钩子、素材引用和合规状态。
- 真实素材不足时输出拍摄清单。
- 高风险内容保存/导出/发布包前触发 Publish Compliance Preflight。

### 6.2 图文套图工作流

```text
CreateGraphicPackWorkflow
  1. select_store_project
  2. select_real_assets
  3. choose_card_modules
  4. compose_copy
  5. render_cards
  6. inject_aigc_label_if_needed
  7. run_compliance_gate
  8. save_assets_and_content_variant
```

### 6.3 发布包工作流

```text
CreatePublishPackageWorkflow
  1. load_content_variant
  2. load_account_capability
  3. run_publish_compliance_preflight
  4. package_copy_assets_labels
  5. choose_route_L1_L2_L3
  6. export_package
  7. create_publish_task
```

### 6.4 线索周报工作流

```text
WeeklyReportWorkflow
  1. aggregate_content
  2. aggregate_manual_leads
  3. link_leads_to_content
  4. summarize_patterns
  5. suggest_next_week_topics
  6. suggest_material_gap
```

## 7. Agent 交互取舍

CreatOK 的 Agent 页面证明一个原则：Agent 不应只是聊天框，而应是垂类工具调度入口。

我方 P0 Agent 形态：

| 交互 | P0 决策 |
| --- | --- |
| 对话输入 | 保留，但不是唯一入口 |
| 附件上传 | 保留，用于价目表、历史帖子、案例图、好评截图、活动海报 |
| 快捷动作 | 必做，绑定固定 workflow |
| 技能按钮 | P0 内部叫“场景包”，避免工程化术语 |
| 历史 | 必做，关联 content item / agent run |
| confirmation gate | 高成本、高风险、外部动作必做 |
| 外部 Agent Skills | P1/P2，再开放 |

第一批内部 tools：

```text
store.profile.read
asset.search
asset.suggest_shooting_list
topic.suggest
copy.compose
copy.platform_adapt
graphic.compose
video.script
compliance.check
content.save_draft
publish.create_package
lead.link_content
usage.reserve
usage.commit
usage.refund
```

工具必须记录：

```text
tool_call_id
agent_run_id
workspace_id
store_id
side_effect_type
risk_level
requires_approval
cost_estimate
input_hash
output_hash
correlation_id
```

## 8. 媒体资产能力差距

CreatOK 的资产库强在多来源资产归集，但我方需要更强的业务 metadata。

### 8.1 P0 资产分类

| 分类 | 含义 |
| --- | --- |
| 真实素材 | 案例图、before/after、环境图、手法视频、好评截图 |
| AI 生成 | 封面背景、氛围图、插画元素、图文卡片 |
| 发布包 | 导出的图文、脚本、素材包、平台复制文本 |
| 门店资料 | 价目表、活动海报、资质、预约方式、历史内容 |
| 回收站 | 软删除恢复 |

### 8.2 P0 必备 metadata

| 字段 | 作用 |
| --- | --- |
| `workspace_id` / `store_id` | 租户隔离 |
| `source_type` | user_upload / ai_generated / imported / package_export |
| `project_id` | 关联服务项目 |
| `platform_hint` | 适合小红书/抖音/点评/公众号 |
| `usage_hint` | 封面、案例、过程、环境、口碑、价格 |
| `rights_status` | 已授权、待确认、不可商用、未知 |
| `sensitivity` | 普通、before_after、medical_or_aesthetic、minor、face_visible |
| `aigc_status` | 非 AI、AI 辅助、AI 生成 |
| `compliance_status` | 未检查、通过、警告、阻断 |
| `used_count` | 避免重复使用 |
| `object_key` | R2 二进制引用 |

## 9. 计费与用量设计

CreatOK 的 credits 可直接启发 Usage Ledger，但我方商家侧应更业务化。

### 9.1 P0 商家可理解权益

| 权益 | 计费对象 |
| --- | --- |
| 内容额度 | 生成内容母体和平台变体 |
| 图文额度 | 图文卡片/套图渲染导出 |
| 视频脚本额度 | 口播稿、分镜、拍摄清单 |
| 账号包 | 绑定平台账号数量 |
| 发布包次数 | L3 发布包导出 |
| L2 发布辅助次数 | 只做 no-submit 灰度 |
| 素材容量 | R2 存储和转码成本 |

### 9.2 Usage Ledger 原则

```text
reserve -> commit -> refund
```

必须从 P0 设计：
- 任务开始前预留。
- 成功后确认扣费。
- 失败、取消或 provider 错误后退款。
- 每次记录 provider、模型、用量、成本、失败原因。
- 每个扣费都关联 content item / asset / publish task / agent run。

## 10. 技术服务边界

CreatOK 技术表面显示了成熟的 Next 应用、`/app/api` wrapper、异步任务、presigned upload、assets、plan/credit 和 Agent Skills API。对我方的关键启发是“边界”，不是照抄栈。

我方 P0 仍采用四服务边界：

```text
Cloudflare Workers App Shell
  -> Core API + Postgres
      -> Agent Service + Mastra
      -> Worker Pool
      -> R2
```

### 10.1 App Shell

可借鉴 CreatOK：
- 清晰的 app route 和 dashboard shell。
- 统一 API wrapper。
- 顶部 credits/升级入口。
- account menu 的账单、API key、语言、主题入口。

我方边界：
- App Shell 只做 UI、auth/session、settings、billing entry、upload/proxy mechanics。
- 不拥有 Store Workspace、内容、合规、发布、线索或用量事实。
- 不 import Mastra types。

### 10.2 Core API / Postgres

必须自研并拥有：
- Store Workspace authorization。
- Store Profile / Projects / Prices。
- Real Asset Library metadata and rights。
- Content Core / Platform Variants。
- Compliance Gate / AIGC labels。
- Publish Package / Publish Jobs / Publish Attempts。
- Lead Ledger / Weekly Reports。
- Usage Ledger / Provider Cost Ledger。
- Provider Registry / Eval Gate。
- Durable Jobs。
- Audit Events。

### 10.3 Agent Service / Mastra

CreatOK Skills 的 thin-client 机制说明，外部 agent 入口应通过后端 API 调度任务，而不是把 provider 能力暴露给客户端。

P0 取舍：
- Mastra 放独立 Node service。
- Agent 只通过 Core API tools 读写业务事实。
- 高风险 tool 必须 requires_approval。
- 长任务必须有 run id / task id，可恢复、可取消、可审计。

### 10.4 Worker Pool

P0 用于：
- SVG template compile。
- resvg-js rasterization。
- sharp resize/composite/metadata。
- Playwright QA/fallback screenshots。
- 发布包导出。

不负责：
- 权限判断。
- 扣费。
- 合规结论。
- 发布路线决策。

### 10.5 R2

R2 只存二进制：
- original assets。
- rendered artifacts。
- publish package exports。
- consent evidence files。

R2 key 不是权限、授权、发布或合规事实。所有业务 metadata 进入 Core API/Postgres。

## 11. 技术 gap 清单

| Gap | CreatOK 给出的证据 | 我方 P0 决策 |
| --- | --- | --- |
| API response shape | CreatOK app API 预期 `{ code, msg, data }` | 我方可定义统一 API envelope，但错误码要覆盖合规、用量、权限、任务状态 |
| async task | CreatOK 有 submit/resume/status 和多状态 | 我方所有生成/导出/发布包任务进 durable_jobs |
| model capability | CreatOK 前端按模型能力控制 reference/duration/resolution | 我方 provider registry 暴露 capabilities 和 pricing，不写死前端 |
| upload | CreatOK presigned URL + asset record | 我方 App Shell 可做上传机械能力，metadata/rights 归 Core API |
| asset source | CreatOK 有 user_upload/ai_tasks/sora_generations | 我方扩展为 real_asset/ai_generated/store_doc/publish_export |
| credits | CreatOK 有 user/org ledger、plan、quota error codes | 我方做 workspace usage ledger + provider cost ledger |
| official publish | CreatOK 有 TikTok official API page | 我方做 account_capabilities + publish router + L3 fallback |
| skills API | CreatOK public skills thin client | 我方 P0 内部 tools，P1/P2 external skills |
| analytics | CreatOK 有 GA/Meta/Baidu/Vercel | 我方 P0 也需要产品行为、任务成功率、成本、合规命中、发布包使用率 |

## 12. P0 backlog 建议

### Sprint 1：基础闭环

1. Store Profile：门店档案、项目价目、人设、禁忌话术。
2. Real Asset Library：上传、标签、授权状态、素材检索。
3. Creative Desk：生成本周内容和内容卡片流。
4. Content Core：内容母体、平台变体、版本、状态。
5. Basic Usage Ledger：内容额度 reserve/commit/refund。

### Sprint 2：图文与合规

1. Graphic Pack：项目套图、封面、价格卡、好评卡。
2. Compliance Gate：广告法、AIGC 标识、Regulated Content Mode。
3. Publish Compliance Preflight：保存/导出/发布包前核验。
4. Publish Package：L3 发布包导出和复制说明。
5. Audit Events：tool call、合规、用量、导出记录。

### Sprint 3：线索与发布任务

1. Lead Ledger：人工登记咨询、加微、预约、核销。
2. LeadContentLink：线索关联内容。
3. Weekly Report：内容-线索周报。
4. Account Capability Matrix：平台账号、能力、授权状态。
5. Publish Task：发布层级、状态、失败原因和人工备注。

### Sprint 4：产品化增强

1. 美业场景包 v1：案例种草、团购优惠、专业科普、顾客口碑、同城引流。
2. 素材缺口向导：基于内容计划生成拍摄清单。
3. 任务历史和恢复：agent run / job / content item 关联。
4. 成本和质量 dashboard：任务成功率、采用率、每条内容成本。
5. P1 spike：轻视频和外部 Agent Skills。

## 13. 本轮决策

进入 P0：
- 创作台主工作流。
- 结构化场景包。
- 内容任务历史。
- 真实素材库和 metadata。
- 项目套图/图文模块选择器。
- 发布包与账号能力矩阵。
- Usage Ledger reserve / commit / refund。
- Agent 内部 tools/workflows。
- 合规 gate 和审计。
- 线索台账。

进入 P1/P2：
- Flow 画布。
- 社区模板。
- 外部 Agent Skills。
- 轻视频 / 真视频。
- 团队资产和代运营工作台。
- 自动周报增强。
- L2 浏览器辅助。

必须自研：
- 门店档案。
- 真实素材权利模型。
- 内容母体 / 平台变体 / 版本模型。
- 美业合规规则和 Publish Compliance Preflight。
- 发布路由和 L3 发布包。
- 线索台账。
- Usage Ledger。
- Provider Registry。
- Audit Events。

明确不做：
- 私有签名逆向。
- 住宅代理池。
- 群控养号。
- captcha bypass / cookie extraction。
- 隐形全自动发布承诺。
- 未核验的医疗广告发布。
- 疗效/安全性保证。
- 伪造案例、伪造资质、移除 AIGC 标识。

