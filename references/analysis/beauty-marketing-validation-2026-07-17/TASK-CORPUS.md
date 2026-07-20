# 美业宣发真实任务基准集合同与第一轮台账

- 版本：v0.2
- 建立日期：2026-07-17
- 状态：10 家候选、9 家窗口内代表观测已入账；完整 30 天频次、原始快照包与第二编码待补
- 研究范围：抖音、小红书、大众点评；8–12 家非医疗美容门店；每次抓取时点向前 30 天
- 产品框架：五类宣发入口 × 六维宣发坐标 × 个性化资产/行业资产匹配

> 本文先定义抽样、字段、编码和统计合同，再登记 2026-07-17 的真实公开发现。台账只含平台可见事实与有边界的研究编码，不含演示、推测或模型生成样本。

## 1. 基准集回答什么

本轮基准集用来回答：

1. 真实门店在三个平台公开做了哪些宣发动作，五类入口各自以什么成品出现；
2. 一条公开宣发内容如何组合门店、项目/服务、团购、品牌/IP、素材、平台结构和 CTA；
3. 热点、同城、节日、季节和门店经营节点为什么构成机会，其来源、相关性和有效期是否可验证；
4. 三个平台分别能看到哪些互动或经营信号，哪些内容仍然未知；
5. 哪些结论可以从公开证据得到，哪些必须进入门店任务回放、原型测试或经营者补记。

本轮不能回答内部任务由谁发起、素材由谁拍摄、为什么修改/拒绝、谁审核、是否产生真实预约或到店。除非获得 C 级门店确认，否则这些字段保持 `unknown`，不从账号人设或页面结构反推工作流。

## 2. 研究单位与事实边界

### 2.1 四种研究单位

| 单位 | ID 格式 | 定义 | 统计用途 |
| --- | --- | --- | --- |
| 门店位置 | `S001` | 一个可被地址或平台门店页区分的经营位置；连锁不同分店不得合并 | 门店覆盖率、品类分层 |
| 平台快照 | `PS001` | 某门店在某平台、某次抓取中的搜索、账号、店铺页和时间窗完整性记录 | 平台匹配率、缺失率、抓取质量 |
| 公开宣发观测 | `O0001` | 一条视频、笔记、商家动态、项目/团购宣传页或可验证物料 | 入口、六维、资产与 CTA 编码 |
| 门店确认任务 | `T0001` | 经经营者任务回放确认的一次真实宣发任务，可关联一条或多条公开观测 | 动机、素材来源、修改、采用和经营观察 |

`TASK-CORPUS` 的公开抓取阶段以 `O` 为最小行。`T` 默认留空；只有同一活动标识、相同成品和时间能够直接证明关联，或获得 C 级门店确认时，才允许把多条 `O` 关联为一个 `T`。相似文案、同一天发布或同一项目不能单独证明是同一内部任务。

### 2.2 平台页面的计入规则

| 平台/页面 | 30 天任务语料 | 当前经营事实快照 | 不计入任务语料 |
| --- | --- | --- | --- |
| 抖音 | 门店官方或公开表达身份账号在时间窗内发布的视频/图文 | 账号主页、公开门店/团购入口 | 推荐流中无法匹配门店身份的内容 |
| 小红书 | 门店官方或公开表达身份账号在时间窗内发布的笔记 | 账号主页、店铺/地点入口 | 无法证明与门店相关的搜索结果 |
| 大众点评 | 时间窗内有明确发布时间/更新时间的商家动态或宣发物 | 门店页、项目、服务、团购、价格、履约与公开聚合信号 | 顾客评价本身、无日期的当前项目页 |

顾客评价可以作为公开口碑或顾客语言的候选证据输入，但不能冒充门店生产的宣发任务。保存时去除顾客姓名、头像、账号和联系方式，只保留完成分析所需的去标识化片段或聚合信号。

### 2.3 时间窗

- 本轮使用本地时区的 30 个自然日：抓取日计为第 1 天，`window_start_at` 为抓取日前第 29 天 00:00。本次统一为 `[2026-06-18T00:00:00+08:00, captured_at]`；若后续另做滚动 720 小时窗口，必须新建口径，不能混算。
- 抖音、小红书和有时间序列的商家动态，应尝试连续翻页直到越过 `window_start_at`。若分页、风控或加载失败，标记 `window_completeness=partial/blocked`，不得计算该门店的发布频率。
- 无发布日期的大众点评项目、团购和门店页只作为 `current_snapshot`，不能进入“最近 30 天发布数”的分母。
- 页面展示“3 天前”等相对时间时，同时保存原文与按抓取时点换算的日期，并标记 `time_precision=relative_day`；无法可靠换算时为 `unknown`。

## 3. 证据与抓取合同

### 3.1 证据等级

| 等级 | 允许来源 | 允许写入的结论 |
| --- | --- | --- |
| A：平台直接记录 | OpenCLI 或只读浏览器从目标平台直接取得，保留 URL/平台 ID、抓取时间、命令和可复核摘录 | 抓取时公开可见的页面、成品、字段和指标；原始包保全状态另计 |
| B：跨样本重复观察 | 至少 3 家独立门店、覆盖至少 2 个业态的 A 级记录经过可复核编码和反例检查 | 本样本内重复出现的结构、入口、素材或 CTA 模式 |
| C：门店确认 | 任务回放、访谈、原型使用或经营者补记 | 发起原因、素材来源、修改/采用、发布与经营观察 |
| D：产品假设 | 由 A/B/C 提出的待验证推断 | 原型和下一轮研究问题，不能写成行业事实 |

每个字段都应可追溯到 `evidence_ids[]`。同一行可以同时含 A 级公开事实、B 级研究编码和 `unknown` 内部字段，不能用一个总等级替代逐字段边界。当前 A 级材料是可复核直接摘录，不等于三个平台的不可变 raw 包已完成；raw 保全缺口在覆盖统计中单列。

`A/B/C/D` 只描述结论成熟度；验证手册的 `P0/P1/P2/P3` 另行描述证据来源层。登记结论时二者并列记录，映射与示例见 [VALIDATION-PLAYBOOK.md](VALIDATION-PLAYBOOK.md#证据分层)。

### 3.2 抓取优先级与只读边界

1. `opencli`：优先使用平台专用适配和用户现有登录态；
2. `in_app_browser`：OpenCLI 未覆盖但页面可只读核验时使用；
3. `chrome_cdp`：前两者不能复用登录态、且必须深度只读核验时使用；
4. `manual_readonly`：只能作为最后降级，并记录人工抄录字段。

每次尝试都要记录 `capture_method`、适配器/命令标识、`capture_status`、失败原因、证据摘要路径与 raw 保全状态。不得执行发布、删除、关注、点赞、收藏、评论、私信、下单或其他写操作；不得把“登录可见”写成“接口已接通”。任何日志和研究文件都不能保存 cookie、token 或账号秘密。

## 4. 抽样配额

### 4.1 门店配额

| 业态 | 必选门店位置数 | 可扩展数 | 合计范围 |
| --- | ---: | ---: | ---: |
| 美发 | 2 | 1 | 2–3 |
| 美甲美睫 | 2 | 1 | 2–3 |
| 生活美容 | 2 | 1 | 2–3 |
| 皮肤管理 | 2 | 1 | 2–3 |
| **总计** | **8** | **最多 4** | **8–12** |

医疗美容不进入本轮统计。品牌不同分店按门店位置分别记录，但同一品牌最多占一个业态配额的 1 家；如确需纳入第二家分店，只能作为对照，不计入主样本分母。

### 4.2 选择与替换规则

1. 先记录平台搜索词、城市/商圈、抓取时间、候选出现顺序，再判断是否纳入，避免只挑“看起来做得好”的账号。
2. 纳入条件：非医疗美容；能确认一个真实门店位置；至少一个平台存在可复核商家页或身份账号；不与已选门店重复。
3. 优先最大差异：独立店/连锁分店、不同价格带和不同公开表达身份均可纳入，但只能按公开页面描述，未知组织方式不得猜测。
4. 替换仅限重复门店、医疗美容、身份无法核对、三个平台均不可访问或原始证据无法保存。替换原因保留在候选台账。
5. 从 8 家扩到 12 家，只用于补足业态、平台正样本或五类入口的明显证据缺口；不能为了让某个结论成立而补样本。

### 4.3 平台与入口覆盖

- 对每个已选门店都必须在抖音、小红书和大众点评执行一次可复核匹配尝试，因此每个平台有 8–12 个 `PS`，`not_found` 也是有效结果。
- 每家门店优先获得至少一个内容平台正样本和一个大众点评门店页正样本；无法满足时保留缺口，不用同名但无法核身的账号代替。
- 五类入口均进入统一编码。要称为本样本重复模式，每类至少需要 3 条独立 A 级观测、来自 3 家门店并覆盖至少 2 个业态；未达到时标记 `limited/no_public_evidence`，可以在 8–12 家范围内补样，但不能放宽 30 天或证据规则。
- “案例、口碑、科普、幕后、测评、教程”是内容配方或证据形式，不新增为第六类入口。

五类入口的主分类规则：

| `promotion_job_primary` | 判定条件 | 容易误判的边界 |
| --- | --- | --- |
| `daily_service_exposure` | 核心是持续展示项目、服务、过程、专业解释、环境或结果 | 含优惠但不以限时/权益为中心，仍可归此类 |
| `traffic_opportunity` | 明确借平台热点、同城事件、节日、季节或当前节点获得注意 | 仅使用热门 BGM、标签或通用标题，不能自动判为热点借势 |
| `brand_personal_ip` | 身份观点、故事、栏目连续性或“谁在表达”是成品主轴 | 有人出镜但主要展示项目，不自动归为 IP |
| `promotion_groupbuy_conversion` | 价格、套餐、团购、限时权益或到店转化活动是核心主张 | 普通价目表若主要用于长期信息展示，可归日常物料 |
| `routine_marketing_materials` | 核心交付是可复用海报、价目卡、菜单、门店屏、预约卡等物料 | 所有图文都有封面，不代表都属于物料入口 |

每条 `O` 只能有一个 `promotion_job_primary`，可有零到多个 `promotion_job_secondary[]`。主类占比可以求和；次类只作组合分析，不能与主类混算。

## 5. 字段合同

### 5.1 通用编码规则

- 标识符、枚举和时间使用机器可读英文；公开原文、研究备注和待确认问题使用中文。
- 缺失必须显式写 `unknown`、`not_visible`、`not_applicable` 或 `not_found`，不得用空字符串混淆不同含义。
- 多值字段使用数组；无值使用 `[]`。金额同时保留 `price_raw`、币种和可选数值，不从“低至”“券后”等模糊文本强转唯一价格。
- 每个可变事实保留 `captured_at`、`effective_at`、`expires_at` 和 `evidence_ids[]`；不可见时间写 `unknown`。
- 公开可见素材不等于门店有权二次使用，`rights_status` 默认 `unknown`。
- 研究者判断必须写入独立 `coding_*` 字段，不能覆盖平台原始字段。

### 5.2 门店位置 `Store`

| 字段 | 类型/枚举 | 填报合同 |
| --- | --- | --- |
| `store_id` | string | 纳入后顺序生成；不可由平台 ID 代替 |
| `public_store_name` | string | 使用商家公开名称 |
| `beauty_category` | enum | `hair` / `nail_lash` / `life_beauty` / `skin_management` |
| `city` / `district` | string | 只填公开可验证位置 |
| `location_evidence_ids` | array | 至少一个地址、地图或平台门店页证据 |
| `brand_scope_public` | enum | `independent` / `chain_branch` / `unknown`；仅按公开标识 |
| `public_price_band_raw` | string/unknown | 保留平台原文，不自行给“高端/低端”标签 |
| `selection_anchor` | object | 首次发现平台、查询词、候选排名、抓取时间 |
| `sample_status` | enum | `candidate` / `included` / `replacement` / `excluded` |
| `sample_role` | enum | `primary_content` / `identity_boundary` / `replacement_pool`；角色不替代纳入状态 |
| `status_reason` | string | 纳入、替换或排除的可复核原因 |
| `cross_platform_match_basis` | array | 地址、公开电话尾号、品牌名、Logo、平台互链等；不保存无关个人信息 |

### 5.3 平台快照 `PlatformSnapshot`

| 字段 | 类型/枚举 | 填报合同 |
| --- | --- | --- |
| `platform_snapshot_id` | string | 每次门店 × 平台 × 抓取时点唯一 |
| `store_id` | string | 关联门店位置 |
| `platform` | enum | `douyin` / `xiaohongshu` / `dianping` |
| `search_query_raw` | string | 实际使用的查询词，不事后改写 |
| `platform_entity_id` / `canonical_url` | string/unknown | 平台账号、门店或页面稳定标识 |
| `identity_match_status` | enum | `matched` / `probable` / `not_found` / `conflict`；只有 `matched` 进入主统计 |
| `identity_scope` | enum | `store` / `brand_city` / `chain_city` / `brand` / `unknown`；只有 `matched + store` 可计分店级覆盖 |
| `match_evidence_ids` | array | 支持同店匹配的原始证据 |
| `captured_at` / `window_start_at` | ISO 8601 | 精确到可获得粒度，并保留时区 |
| `capture_method` | enum | `opencli` / `in_app_browser` / `chrome_cdp` / `manual_readonly` |
| `adapter_or_command` | string | OpenCLI 适配器/命令名称或降级方式，不含秘密 |
| `capture_status` | enum | `success` / `partial` / `blocked` / `not_found` |
| `window_completeness` | enum | `complete` / `partial` / `blocked` / `not_applicable` |
| `oldest_visible_at` / `pagination_stop_reason` | time/string | 证明是否越过 30 天边界 |
| `evidence_summary_path` | path | 指向保存稳定 ID/URL、命令、时间与可复核摘录的发现文档 |
| `raw_evidence_path` | path/unknown | 指向 `raw/` 的不可变去敏原始输出；未保全时必须为 `unknown` |
| `current_store_metrics_raw` | object | 评分、评价量、销量等原样保存，明确为店铺/团购层而非内容互动 |
| `limitations` | array | 登录、风控、字段隐藏、分页或身份冲突等限制 |

### 5.4 公开宣发观测 `Observation`

| 字段组 | 字段 | 填报合同 |
| --- | --- | --- |
| 身份 | `observation_id`, `store_id`, `platform_snapshot_id` | 三者必填，保持可追溯 |
| 原始对象 | `artifact_type`, `platform_artifact_id`, `canonical_url` | 类型可为 `video` / `note` / `merchant_post` / `project_promo` / `deal_promo` / `material` |
| 时间 | `published_at_raw`, `published_at`, `time_precision`, `captured_at`, `within_30d` | `within_30d=true` 才进入发布频率统计 |
| 原文 | `title_raw`, `body_raw_or_redacted`, `hashtags_raw`, `location_tag_raw` | 原文过长时保存摘要并链接原始证据，不复制顾客个人信息 |
| 分类 | `promotion_job_primary`, `promotion_job_secondary[]`, `content_recipe_tags[]` | 主类严格按五类枚举；配方标签不能替代入口 |
| 证据 | `evidence_ids[]`, `evidence_summary_path`, `raw_evidence_path`, `field_provenance` | 原始字段和编码字段分别标来源；未保全 raw 时显式写 `unknown` |
| 关联 | `task_episode_id`, `campaign_group_id` | 默认 `unknown`；只在直接证据或 C 级确认后关联 |
| 质量 | `coding_status`, `second_coder_status`, `disagreement_note` | `coding_status`：`uncoded` / `first_pass` / `reviewed`；`second_coder_status`：`pending` / `reviewed`；不确定主类必须复核 |

### 5.5 六维宣发坐标

| 维度 | 必填字段 | 可选字段与判定边界 |
| --- | --- | --- |
| 宣发任务 | `promotion_job_primary`, `public_purpose_cues[]` | `internal_business_goal` 默认 `unknown`，除非 C 级确认 |
| 流量机会 | `opportunity_type`, `opportunity_basis`, `opportunity_evidence_ids[]` | `why_now_public`, `relevance_explanation`, `freshness_status`; 没有独立依据时不得写“蹭热点” |
| 表达身份 | `voice_identity_type`, `identity_public_label`, `identity_evidence_ids[]` | `credibility_basis_public`, `ip_series_cues[]`; 出镜者不等于内部责任人 |
| 平台机制 | `platform`, `container_type`, `hook_structure`, `platform_mechanism_tags[]` | 标题、首屏、封面、时长、话题、同城/搜索词按平台原样编码 |
| 门店事实/素材 | `store_fact_refs[]`, `service_refs[]`, `deal_refs[]`, `ip_refs[]`, `material_refs[]` | 每个引用都要有来源；无法证明属于本店时不计为个性化匹配 |
| 转化动作 | `cta_primary`, `cta_secondary[]`, `cta_endpoint_public`, `cta_visibility` | CTA 出现不证明用户执行；实际结果默认 `unknown` |

受控枚举：

- `opportunity_type`：`always_on` / `platform_trend` / `local_event` / `seasonal` / `calendar_node` / `store_event` / `promotion_deadline` / `search_demand` / `unknown`；
- `opportunity_basis`：`explicit_in_artifact` / `external_source_match` / `merchant_confirmed` / `unknown`；
- `voice_identity_type`：`store_official` / `brand` / `owner_founder` / `professional_person` / `other_person` / `customer_voice` / `unknown`；
- `cta_primary`、`cta_secondary[]`：`private_message` / `wechat` / `call` / `booking` / `buy_coupon` / `redeem` / `navigate` / `visit_store` / `follow` / `comment` / `collect` / `none` / `unknown`。

### 5.6 热点来源与时效

只有 `opportunity_type` 为热点、同城、季节、节点或搜索机会时填本组：

| 字段 | 填报合同 |
| --- | --- |
| `trend_source_type` | `platform_trend_page` / `platform_search` / `repeated_platform_pattern` / `local_event_source` / `calendar_source` / `merchant_confirmed` / `unknown` |
| `trend_source_platform` | 来源平台；跨平台借势也必须区分来源与发布平台 |
| `trend_source_id_or_url` | 可复核来源；没有来源则为 `unknown`，不能补写热门结论 |
| `trend_source_published_at` / `trend_captured_at` | 保留来源出现和本次抓取时间 |
| `trend_expires_at` | 仅在节日、活动期限、榜单周期或平台状态能支持时填写 |
| `expiry_basis` | 平台状态、明确日期、事件结束、活动期限或 `unknown` |
| `freshness_status` | `active` / `near_expiry` / `expired` / `unknown`，并记录判定规则 |
| `source_to_publish_latency_hours` | 只有来源时间与内容发布时间都可靠时计算 |
| `store_relevance_evidence` | 具体关联的项目、地域、身份、顾客问题或经营节点；不能只写“适合美业” |
| `borrowed_layer` | `topic` / `structure` / `emotion` / `mechanism` / `unknown`；不复制他人具体表达 |

### 5.7 个性化资产与行业资产

| 资产侧 | 字段 | 合同 |
| --- | --- | --- |
| 门店 | `store_fact_refs[]` | 地址、营业时段、环境、品牌主张、承接方式等，每项带证据与有效期 |
| 项目/服务/产品 | `service_refs[]`, `product_refs[]` | 名称、适用人群、流程、时长、公开主张、价格原文和来源；不补写功效 |
| 团购/活动 | `deal_refs[]` | 套餐、权益、价格原文、适用门店、购买/预约方式、期限和履约限制 |
| 品牌/IP | `ip_refs[]` | 公开身份、专业边界、表达样本、栏目线索；内部授权和离店规则默认未知 |
| 素材 | `material_refs[]` | `person` / `space` / `process` / `tool` / `product` / `result` / `testimonial` / `graphic` / `other`；记录来源、清晰可见用途和 `rights_status` |
| 平台历史 | `history_refs[]` | 只关联可复核历史内容，不把高互动自动解释为“有效资产” |
| 行业资产 | `industry_asset_tags[]` | 美业场景、品类知识、平台结构、热点机制、IP 栏目、物料模板、CTA 和合规规则 |
| 组合解释 | `asset_match_explanation` | 一句话说明“为何这个项目/身份/素材/平台/CTA 被组合”，区分公开证据与研究推断 |
| 缺口 | `asset_gaps[]`, `safe_fallback_observed` | 标出缺价格、缺素材、缺权利或缺承接；只记录公开观察到的降级，不虚构 Agent 行为 |

资产引用对象至少包含：`ref_id`、`asset_type`、`public_label`、`source_evidence_id`、`captured_at`、`effective_at`、`expires_at`、`observed_usage`、`rights_status`、`confidence`。`rights_status` 只允许 `confirmed_for_scope` / `unknown` / `restricted`；`confirmed_for_scope` 只能来自直接、用途明确的授权证据或 C 级门店确认。公开出现只写入 `observed_usage`，不能自动晋升为未来生成授权。

### 5.8 平台指标与可见互动

每条观测使用 `visible_metrics[]` 保存平台原始指标：

| 字段 | 合同 |
| --- | --- |
| `metric_name_platform_raw` | 平台原始名称，如点赞、收藏、评论、销量、评价数 |
| `metric_scope` | `artifact` / `account` / `store` / `project` / `deal`；不同 scope 不混算 |
| `metric_value_raw` | 原样保存，如 `1.2万`、`100+`、`暂无` |
| `metric_value_normalized` | 只有语义明确时填写；缩写/区间同时标注 `approximate/bounded` |
| `metric_visibility` | `exact` / `abbreviated` / `bounded` / `hidden` / `not_applicable` |
| `metric_captured_at` | 指标是动态快照，必须记录抓取时间 |

抖音、小红书的点赞、收藏、评论、分享/转发、播放等仅按当时可见字段记录；大众点评的评分、评价量、团购销量等必须保留在门店/团购 scope。不同平台指标不可合成“热度分”，互动高低也不能证明咨询、预约、买券、核销或到店。

### 5.9 未知项与待门店验证

每条 `O` 必须包含：

- `unknown_fields[]`：公开页面无法回答的字段；
- `merchant_validation_required`：`yes/no`；
- `merchant_validation_questions[]`：一问一事，直接对应未知字段；
- `researcher_interpretation[]`：如有 B/D 判断，写出依据和替代解释；
- `merchant_confirmation_refs[]`：后续 C 级记录，采用追加版本，不覆盖原始公开观察。

公开研究阶段默认未知且需要重点验证：原始经营目标、任务发起者、素材拍摄/选择来源、顾客或员工素材授权范围、修改/拒绝原因、实际采用方式、内部发布责任、CTA 实际动作、咨询/预约/买券/核销/到店和收入影响。

## 6. 编码与复核流程

1. **抓取者**只保存平台原始证据、匹配依据、时间窗和抓取限制；
2. **第一编码者**在不看互动高低的前提下编码五类入口和六维，避免用结果倒推任务；
3. **第二编码者**复核全部热点借势、IP、主类不确定项，以及每个平台随机不少于 20% 的其余观测；
4. 主类或机会依据存在分歧时保留两种解释，由复核者裁定并写 `disagreement_note`；无法裁定为 `unknown`；
5. 门店确认以新 C 级证据追加到 `T`，不修改当时抓取的 A 级原文和指标；
6. 任何用于产品决策的结论必须列出证据 ID、适用平台/业态、分母、缺失率和反例。

## 7. 统计方法

### 7.1 先报告覆盖，再报告模式

固定报告五个分母：

1. `N_store`：纳入的独立门店位置数；
2. `N_platform_attempt`：门店 × 平台匹配尝试数；
3. `N_complete_window`：能完整覆盖 30 天的内容平台快照数；
4. `N_observation`：符合合同的公开宣发观测数；
5. `N_confirmed_task`：有 C 级门店确认的真实任务数。

每项结论同时报告 `n/N`。样本少于 10 时优先给原始计数而非只给百分比；所有表格显示 `unknown/not_visible` 缺失率。

### 7.2 五类入口与六维组合

- 门店覆盖率：`至少出现一次该主入口的门店数 / 该分析中窗口合格门店数`；
- 观测占比：`该主入口观测数 / 已分类观测总数`，必须按平台、业态分层；
- 门店等权占比：先在每家门店内计算入口占比，再取中位数与四分位距，防止高频账号支配结论；
- 六维完整度：分别报告机会、身份、平台机制、事实/素材和 CTA 的 `observed/unknown`，不得用一个总分遮蔽缺口；
- 资产组合：按 `项目/团购/IP/素材/CTA` 共现计数，至少跨 3 家独立门店并覆盖至少 2 个业态才称“本样本重复模式”。平台特有模式可以限在单平台，但必须写明边界。

### 7.3 热点与时效

- 只有存在可复核热点来源的观测进入热点时效统计；
- 报告来源可追溯率、发布时间精度、`source_to_publish_latency_hours` 中位数/四分位距、抓取时已过期数量；
- 无法证明来源或期限的内容只标 `unknown`，不进入“热点响应速度”分母；
- 热点相关性以具体门店事实或项目关联编码，不用互动高低倒推相关性。

### 7.4 可见互动

- 仅在相同平台、相同 `metric_scope`、相同内容容器和相近内容年龄内描述中位数与四分位距；
- 缺播放/曝光分母时不计算互动率；平台缩写值只能做近似分布，不能与精确值混称精确统计；
- 大众点评的评分、评价量、销量不能与抖音/小红书互动合并比较；
- 公开互动与咨询、预约、买券、核销、到店只可并列观察，不做因果归因。

### 7.5 结论命名

| 名称 | 最低条件 | 表述方式 |
| --- | --- | --- |
| 单条观察 | 1 条 A 级证据 | “在该页面观察到……” |
| 本样本重复模式 | 至少 3 家独立门店、覆盖至少 2 个业态，且有反例检查 | “在本轮样本中重复出现……” |
| 平台特有候选 | 同平台至少 3 家独立门店、覆盖至少 2 个业态 | “在该平台样本中出现……” |
| 门店确认模式 | 至少 3 家独立门店、覆盖至少 2 个业态的 C 级任务 | “经这些门店任务回放确认……” |
| 产品假设 | 未满足以上条件或含机制推断 | 明确标 D 级并进入下一轮验证 |

跨平台产品规则除满足“本样本重复模式”外，还必须在抖音与小红书两个内容平台样本中重复；平台能力边界则需在同平台多个业态查询中复现。单店、单条或单平台偶发案例只用于字段发现、反例和风险边界，不提升产品路线优先级。本轮是分层目的抽样，不代表行业总体。不得使用显著性检验、行业渗透率、平台算法因果、付费价值或到店提升等表述。

## 8. 第一轮台账

本轮采用“内容活跃候选 → 大众点评分店锚定 → 另一内容平台反查”的顺序，避免从点评热店名单假设内容活跃。最终纳入 10 家：美发 3、美甲美睫 2、生活美容 2、皮肤管理 3。每家都有大众点评门店级锚点，9 家至少有一个内容平台的窗口内分店级正样本；S008 保留为身份边界，不用连锁级或超窗内容补齐。三平台都完成了 matched/probable/not_found 尝试。

台账仍不是完整 30 天频次语料：小红书主页范围存在分页/ID 时间估算，抖音只逐页复核代表作品日期，大众点评当前摘要没有发布时间；去敏原始输出包和第二编码也尚未完成。

### 8.1 候选与门店样本

| `store_id` | `public_store_name` | `beauty_category` | `city/district` | `selection_anchor` | `sample_status` | `sample_role` | `status_reason` | `location_evidence_ids` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S001 | TR salon 烫染·漂发·巴黎画染 | `hair` | 上海 / 徐家汇 | XHS 活跃内容反向锚定 | `included` | `primary_content` | XHS 近 30 天正样本 + 点评门店级 matched；抖音未稳定核身 | `DP-EnwKWSumbxFak3PD`, `XHS-5bcf54a2e5d34700010c2ba5` |
| S002 | Tress&Tune Studio 发型设计（麓湖 CPI 店） | `hair` | 成都 / 麓湖 | XHS 活跃内容反向锚定 | `included` | `primary_content` | 三平台品牌、城市与麓湖分店/商圈一致 | `DP-H1BpUKEJ5Mits8d1`, `XHS-66dda2a7000000001d023aed`, `DY-7663001871920950755` |
| S003 | TOPP1NG·barbershop 男士复古理发馆 | `hair` | 深圳 | XHS 活跃内容反向锚定 | `included` | `primary_content` | 三平台品牌、城市与业态一致 | `DP-EZUfvuuT5pUeaAvu`, `XHS-596e58cd5e87e7397f0147b9`, `DY-7110521262652296459` |
| S004 | 小椿禾·nail（松江大学城） | `nail_lash` | 上海 / 松江大学城 | XHS 活跃内容反向锚定 | `included` | `primary_content` | XHS 近 30 天正样本 + 点评门店级 matched；抖音相似名未合并 | `DP-Ha2zHNwi0qXKE5SK`, `XHS-57e6f6fb6a6a690c51b752fc` |
| S005 | 0127ネイル日式美甲美睫（西苏州路店） | `nail_lash` | 上海 / 西苏州路 | 抖音活跃内容反向锚定 | `included` | `primary_content` | 抖音作品页日期 + 点评门店级 matched；小红书仅历史品牌级 probable | `DP-l5hWFglCtgZdtQWH`, `DY-MS4wLjABAAAA-A2iXKQDKD5Qf-CYxvq9PKCEQEh2WkYs7InSfrssVscjqhmHP31HVcSoetDuRFed` |
| S006 | THE PURI·璞悦·水疗按摩（湖滨 in77 店） | `life_beauty` | 杭州 / 湖滨 in77 | XHS 活跃内容反向锚定 | `included` | `primary_content` | 三平台品牌、城市与分店一致 | `DP-H7RgNAkxxtfCwnXG`, `XHS-6669a2cc0000000003033c3b`, `DY-7660881570043022619` |
| S007 | 圣梦亲体美肤生活馆（会展店） | `life_beauty` | 成都 / 会展、沙湾 | 抖音活跃内容反向锚定 | `included` | `primary_content` | 抖音作品页日期 + 点评同名分店 matched；小红书为品牌城市 probable，不下放分店事实 | `DP-G3kMs1FuDgobAQ76`, `DY-MS4wLjABAAAApwhhc2L6bsPeQvYGTexVbKwmuFSV7odkzeOD1p6DgrM` |
| S008 | SMOOTH 小室木·专注痘敏（福田口岸店） | `skin_management` | 深圳 / 福田口岸 | XHS 连锁内容 + 抖音分店反向锚定 | `included` | `identity_boundary` | 抖音与点评精确到福田口岸，但抖音分店页仅核到 2026-01-31 超窗内容；XHS 只按深圳连锁级使用，不进入 30 天任务编码 | `DP-G9fMPeVBToEMHgVz`, `XHS-6352b3f20000000018029af7`, `DY-7601464168575326883` |
| S009 | 华熙 QUADHA 夸迪皮肤管理（深圳店） | `skin_management` | 深圳 / 福田、沙头 | 点评锚点 + 抖音当前内容 | `included` | `primary_content` | 抖音认证主体与深圳商家身份 + 点评门店 matched；XHS 近 30 天 not_found | `DP-Gaqcxa5IA5W1Dsxl`, `DY-MS4wLjABAAAAmKr0VLrz0jihtFO6dAWpNN9rajjnYAaU39_b5YboW22Tm84a5tkx8_b_Ul851fZK` |
| S010 | 玺妍娜皮肤管理·专注问题肌（三利广场店） | `skin_management` | 成都 / 华阳 | 抖音活跃内容反向锚定 | `included` | `primary_content` | 抖音作品页日期 + 点评华阳分店 matched；XHS 仅历史品牌/华阳身份，不计 30 天正样本 | `DP-l5OUQiNKhSbePga0`, `XHS-60d04ebc0000000001008c44`, `DY-MS4wLjABAAAAGMVgbGLmBkdbf2fZRz9y-MvVbRkzLSy37AkYZG_D2lzXBVNhFdeGsrqKY4vAi4IY` |

### 8.2 非医疗范围初筛

皮肤管理样本只完成公开页面初筛，不能凭“未看到医疗字样”证明其法律或资质属性。它们在进入真实发布试点前必须完成经营主体、服务范围与资质核验；本轮只用于低风险生活美容/皮肤管理表达的研究。

| `store_id` | 公开可见定位 | 初筛状态 | 当前边界 | 试点前门禁 |
| --- | --- | --- | --- | --- |
| S008 | 痘敏护理、皮肤管理门店 | `provisional_nonmedical` | 未观察到医疗机构身份，不构成非医疗证明 | 核经营主体、服务项目、资质与功效表达 |
| S009 | 皮肤管理、美肤中心 | `provisional_nonmedical` | 套餐含清洁/补水/按摩，功效与品牌授权待核 | 核服务范围、品牌/产品授权与功效表达 |
| S010 | 问题肌肤管理、美容中心 | `provisional_nonmedical` | 专业身份与功效边界未确认 | 核经营主体、人员资历、服务范围与功效表达 |

### 8.3 三平台快照

| `platform_snapshot_id` | `store_id` | `platform` | `search_query_raw` | `identity_match_status` | `captured_at` | `window_start_at` | `capture_method` | `capture_status` | `window_completeness` | `evidence_summary_path` | `limitations` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PS001 | S001 | `xiaohongshu` | `TR salon 烫染 漂发 上海 徐家汇` | `matched` | 2026-07-17T17:15:01+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/xiaohongshu.md` | 主页可见数含 ID 时间估算 |
| PS002 | S001 | `douyin` | `TR salon 烫染 漂发 上海 徐家汇` | `not_found` | 2026-07-17T17:26:25+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `not_found` | `blocked` | `discovery/cross-platform-matrix.md` | 相似作者缺上海/徐家汇证据 |
| PS003 | S001 | `dianping` | `TR salon 烫染` | `matched` | 2026-07-17T17:15:01+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/xiaohongshu.md` | 当前门店摘要，无发布序列 |
| PS004 | S002 | `xiaohongshu` | `Tress&Tune 成都 麓湖` | `matched` | 2026-07-17T17:15:01+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/xiaohongshu.md` | 搜索日期可靠，主页窗口非全量 |
| PS005 | S002 | `douyin` | `Tress&Tune 成都 麓湖` | `matched` | 2026-07-17T17:26:25+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `blocked` | `discovery/cross-platform-matrix.md` | 身份匹配；搜索无发布日期，不计频次 |
| PS006 | S002 | `dianping` | `Tress&Tune 成都` | `matched` | 2026-07-17T17:15:01+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/xiaohongshu.md` | 当前门店摘要 |
| PS007 | S003 | `xiaohongshu` | `TOPP1NG 深圳` | `matched` | 2026-07-17T17:15:01+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/xiaohongshu.md` | 搜索日期可靠，主页窗口非全量 |
| PS008 | S003 | `douyin` | `TOPP1NG 深圳 男士理发馆` | `matched` | 2026-07-17T17:26:25+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `blocked` | `discovery/cross-platform-matrix.md` | 身份匹配；搜索无发布日期，不计频次 |
| PS009 | S003 | `dianping` | `TOPP1NG 美发 深圳` | `matched` | 2026-07-17T17:15:01+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/xiaohongshu.md` | 当前门店摘要 |
| PS010 | S004 | `xiaohongshu` | `小椿禾 nail 上海` | `matched` | 2026-07-17T17:15:01+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/xiaohongshu.md` | 搜索日期可靠，主页窗口非全量 |
| PS011 | S004 | `douyin` | `小椿禾 nail 上海 松江大学城` | `not_found` | 2026-07-17T17:26:25+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `not_found` | `blocked` | `discovery/cross-platform-matrix.md` | 相似昵称缺城市/分店证据 |
| PS012 | S004 | `dianping` | `小椿禾 nail 上海` | `matched` | 2026-07-17T17:15:01+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/xiaohongshu.md` | 当前门店摘要 |
| PS013 | S005 | `xiaohongshu` | `0127 上海 日式美甲美睫 静安` | `probable` | 2026-07-17T17:31:58+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `partial` | `blocked` | `discovery/xiaohongshu.md` | 仅历史品牌关联；窗口内无同店正样本 |
| PS014 | S005 | `douyin` | `0127 上海日式美甲美睫` | `matched` | 2026-07-17T17:17:02+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/douyin.md` | 两条页面日期已复核，非全量 |
| PS015 | S005 | `dianping` | `0127 日式美甲美睫 上海` | `matched` | 2026-07-17T17:28:13+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/dianping.md` | 当前门店摘要 |
| PS016 | S006 | `xiaohongshu` | `THE PURI 璞悦 杭州 湖滨 in77` | `matched` | 2026-07-17T17:15:01+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/xiaohongshu.md` | 搜索日期可靠，主页窗口非全量 |
| PS017 | S006 | `douyin` | `THE PURI 璞悦 杭州 湖滨 in77` | `matched` | 2026-07-17T17:26:25+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `blocked` | `discovery/cross-platform-matrix.md` | 身份匹配；搜索无发布日期，不计频次 |
| PS018 | S006 | `dianping` | `THE PURI 璞悦 杭州` | `matched` | 2026-07-17T17:15:01+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/xiaohongshu.md` | 当前门店摘要 |
| PS019 | S007 | `xiaohongshu` | `圣梦亲体美肤生活馆 会展店 成都` | `probable` | 2026-07-17T17:31:58+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `partial` | `partial` | `discovery/xiaohongshu.md` | 近 30 天 UGC 仅到品牌+成都，未到会展店 |
| PS020 | S007 | `douyin` | `圣梦亲体美肤生活馆 会展店` | `matched` | 2026-07-17T17:17:02+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/douyin.md` | 两条页面日期已复核，非全量 |
| PS021 | S007 | `dianping` | `圣梦亲体美肤生活馆 会展店 成都` | `matched` | 2026-07-17T17:28:13+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/dianping.md` | 与天誉店分开记录 |
| PS022 | S008 | `xiaohongshu` | `SMOOTH 小室木 深圳 痘敏` | `probable` | 2026-07-17T17:15:01+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/xiaohongshu.md` | 深圳连锁级内容，不下放福田口岸 |
| PS023 | S008 | `douyin` | `SMOOTH 小室木 深圳 痘敏` | `matched` | 2026-07-17T17:26:25+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `blocked` | `discovery/douyin.md` | 分店作者已匹配；补充页面核验显示代表页发布时间 2026-01-31，超出窗口，不计任务正样本 |
| PS024 | S008 | `dianping` | `SMOOTH 小室木 福田口岸 深圳` | `matched` | 2026-07-17T17:30:53+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/dianping.md` | 当前门店摘要 |
| PS025 | S009 | `xiaohongshu` | `华熙生物 QUADHA 夸迪 皮肤管理 深圳` | `not_found` | 2026-07-17T17:15:01+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `not_found` | `blocked` | `discovery/xiaohongshu.md` | 只有超窗/其他城市结果 |
| PS026 | S009 | `douyin` | `华熙生物 QUADHA 夸迪 皮肤管理 深圳` | `matched` | 2026-07-17T17:17:02+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/douyin.md` | 两条页面日期已复核，非全量 |
| PS027 | S009 | `dianping` | `华熙生物 QUADHA 夸迪皮肤管理 深圳` | `matched` | 2026-07-17T17:06:20+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/dianping.md` | 当前门店摘要 |
| PS028 | S010 | `xiaohongshu` | `玺妍娜 专注问题肌肤 成都 华阳` | `probable` | 2026-07-17T17:31:58+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `partial` | `blocked` | `discovery/xiaohongshu.md` | 仅历史品牌/华阳关联，法律主体别名与窗口内同店内容均未证实 |
| PS029 | S010 | `douyin` | `玺妍娜 专注问题肌肤 成都` | `matched` | 2026-07-17T17:17:02+08:00 | 2026-06-18T00:00:00+08:00 | `opencli` | `success` | `partial` | `discovery/douyin.md` | 两条页面日期已复核，非全量 |
| PS030 | S010 | `dianping` | `玺妍娜 问题肌肤 成都` | `matched` | 2026-07-17T17:28:13+08:00 | not_applicable | `opencli` | `success` | `not_applicable` | `discovery/dianping.md` | 当前门店摘要；法律主体别名未证实 |

`PS001–PS030` 的 `raw_evidence_path` 当前统一为 `unknown`；上表路径均为 `evidence_summary_path`，不得当作不可变 raw 输出。

#### 8.3.1 身份作用域矩阵

| `store_id` | 小红书 `PS / identity_scope` | 抖音 `PS / identity_scope` | 大众点评 `PS / identity_scope` |
| --- | --- | --- | --- |
| S001 | PS001 / `store` | PS002 / `unknown` | PS003 / `store` |
| S002 | PS004 / `store` | PS005 / `store` | PS006 / `store` |
| S003 | PS007 / `store` | PS008 / `store` | PS009 / `store` |
| S004 | PS010 / `store` | PS011 / `unknown` | PS012 / `store` |
| S005 | PS013 / `brand` | PS014 / `store` | PS015 / `store` |
| S006 | PS016 / `store` | PS017 / `store` | PS018 / `store` |
| S007 | PS019 / `brand_city` | PS020 / `store` | PS021 / `store` |
| S008 | PS022 / `chain_city` | PS023 / `store` | PS024 / `store` |
| S009 | PS025 / `unknown` | PS026 / `store` | PS027 / `store` |
| S010 | PS028 / `brand_city` | PS029 / `store` | PS030 / `store` |

### 8.4 可复核直接摘录

下表是便于阅读的首轮摘要；它们具备平台直接摘录和稳定对象链接，但不可变 raw 尚未保全，因此不宣称完整 Observation 证据包已完成。追溯与编码状态见表后矩阵。

| `observation_id` | `store_id` | `platform` | `artifact_type` | `published_at` | `within_30d` | `promotion_job_primary` | `opportunity_type` | `voice_identity_type` | `service_refs` | `deal_refs` | `ip_refs` | `material_refs` | `cta_primary` | `visible_metrics` | `evidence_ids` | `unknown_fields` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O0001 | S001 | `xiaohongshu` | `note` | 2026-06-21 | true | `promotion_groupbuy_conversion` | `unknown` | `brand` | 染发/漂发 | 一口价 688 元原文，时效未知 | TR 门店品牌 | [] | `unknown` | 不用于效果判断 | [XHS `6a38070c0000000011014f48`](https://www.xiaohongshu.com/search_result/6a38070c0000000011014f48) | 价格有效期、CTA、素材权利、内部起因、结果 |
| O0002 | S002 | `xiaohongshu` | `note` | 2026-06-25 | true | `brand_personal_ip` | `always_on` | `brand` | 发型设计/工作室 | [] | 美学创作工作室、创始表达 | [] | `unknown` | 不用于效果判断 | [XHS `6a3d02270000000008033e0f`](https://www.xiaohongshu.com/search_result/6a3d02270000000008033e0f) | 内部起因、表达责任、CTA、权利、结果 |
| O0003 | S003 | `xiaohongshu` | `note` | 2026-06-24 | true | `daily_service_exposure` | `always_on` | `brand` | 男士 Buzz Cut / 背头 | [] | 男士复古理发馆风格 | [] | `unknown` | 不用于效果判断 | [XHS `6a3b89df00000000080021ac`](https://www.xiaohongshu.com/search_result/6a3b89df00000000080021ac) | 素材权利、CTA、内部起因、结果 |
| O0004 | S004 | `xiaohongshu` | `note` | 2026-07-13 | true | `daily_service_exposure` | `seasonal` | `brand` | 美甲款式/客照 | [] | 个人工作室定位 | [] | `unknown` | 不用于效果判断 | [XHS `6a54aab8000000001700bbe5`](https://www.xiaohongshu.com/search_result/6a54aab8000000001700bbe5) | 顾客素材权利、真实经营目标、CTA、结果 |
| O0005 | S005 | `douyin` | `video` | 2026-07-15T17:24:00+08:00 | true | `traffic_opportunity` | `store_event` | `brand` | 门店体验/新品饮品 | [] | 0127 门店日常 | [] | `unknown` | 不用于效果判断 | [DY `7662683321927354289`](https://www.douyin.com/video/7662683321927354289) | 上新期限、内容操作者、CTA、结果 |
| O0006 | S006 | `xiaohongshu` | `note` | 2026-07-08 | true | `daily_service_exposure` | `always_on` | `brand` | SPA / 肩颈 / 空间体验 | [] | 璞悦品牌空间 | [] | `unknown` | 不用于效果判断 | [XHS `6a4e1ad2000000001700bd64`](https://www.xiaohongshu.com/search_result/6a4e1ad2000000001700bd64) | “西湖边”只作地域语境，不计本地事件；服务主张边界、CTA、素材权利、结果 |
| O0007 | S007 | `douyin` | `video` | 2026-07-16T17:03:00+08:00 | true | `promotion_groupbuy_conversion` | `seasonal` | `brand` | 头皮养护 | 109 元原文，时效未知 | 圣梦会展店 | [] | `unknown` | 不用于效果判断 | [DY `7663048873254353855`](https://www.douyin.com/video/7663048873254353855) | 价格/权益/期限、CTA、结果 |
| O0009 | S009 | `douyin` | `video` | 2026-07-13T12:41:00+08:00 | true | `promotion_groupbuy_conversion` | `unknown` | `brand` | 清洁/补水/按摩套餐 | 套餐可见，权益/期限未知 | QUADHA 深圳店 | [] | `buy_coupon` | 不用于效果判断 | [DY `7661868259133632347`](https://www.douyin.com/video/7661868259133632347) | 价格、权益、期限、功效边界、结果 |
| O0010 | S010 | `douyin` | `video` | 2026-07-10T12:44:00+08:00 | true | `brand_personal_ip` | `always_on` | `owner_founder` | 问题肌专业表达 | [] | 老板/女性成长 IP | [] | `unknown` | 不用于效果判断 | [DY `7660755571506793779`](https://www.douyin.com/video/7660755571506793779) | 身份资历、功效边界、CTA、内部起因、结果 |

#### 8.4.1 观测追溯与保全状态

| `observation_id` | `platform_snapshot_id` | `time_precision` | `captured_at` | `field_provenance` | `evidence_summary_path` | `raw_evidence_path` | `coding_status` | `second_coder_status` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| O0001 | PS001 | `day` | 2026-07-17T17:15:01+08:00 | `platform_visible + researcher_coding` | `discovery/xiaohongshu.md` | `unknown` | `first_pass` | `pending` |
| O0002 | PS004 | `day` | 2026-07-17T17:15:01+08:00 | `platform_visible + researcher_coding` | `discovery/xiaohongshu.md` | `unknown` | `first_pass` | `pending` |
| O0003 | PS007 | `day` | 2026-07-17T17:15:01+08:00 | `platform_visible + researcher_coding` | `discovery/xiaohongshu.md` | `unknown` | `first_pass` | `pending` |
| O0004 | PS010 | `day` | 2026-07-17T17:15:01+08:00 | `platform_visible + researcher_coding` | `discovery/xiaohongshu.md` | `unknown` | `first_pass` | `pending` |
| O0005 | PS014 | `minute` | 2026-07-17T17:17:02+08:00 | `platform_visible + researcher_coding` | `discovery/douyin.md` | `unknown` | `first_pass` | `pending` |
| O0006 | PS016 | `day` | 2026-07-17T17:15:01+08:00 | `platform_visible + researcher_coding` | `discovery/xiaohongshu.md` | `unknown` | `first_pass` | `pending` |
| O0007 | PS020 | `minute` | 2026-07-17T17:17:02+08:00 | `platform_visible + researcher_coding` | `discovery/douyin.md` | `unknown` | `first_pass` | `pending` |
| O0009 | PS026 | `minute` | 2026-07-17T17:17:02+08:00 | `platform_visible + researcher_coding` | `discovery/douyin.md` | `unknown` | `first_pass` | `pending` |
| O0010 | PS029 | `minute` | 2026-07-17T17:17:02+08:00 | `platform_visible + researcher_coding` | `discovery/douyin.md` | `unknown` | `first_pass` | `pending` |

### 8.5 热点机会证据

| `observation_id` | `trend_source_type` | `trend_source_platform` | `trend_source_id_or_url` | `trend_captured_at` | `trend_expires_at` | `freshness_status` | `store_relevance_evidence` | `source_to_publish_latency_hours` | `evidence_ids` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

当前没有一条门店观测同时具备独立热点来源、可靠来源时间和可计算发布时差，因此不填伪热点行。平台级机会证据单列在 `discovery/platform-opportunities.md`；下一轮只有完成门店资产相关性复核后才关联到 `O`。

### 8.6 待门店验证队列

| `validation_id` | `store_id` | `observation_ids` | `unknown_field` | `merchant_validation_question` | `priority` | `status` | `confirmation_ref` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MV001 | S001–S007,S009–S010 | O0001–O0007,O0009–O0010 | `internal_business_goal` | 这条内容当时是为了解决什么经营问题，谁先提出？ | P0 | pending | unknown |
| MV002 | S001,S007,S009 | O0001,O0007,O0009 | `deal_validity` | 当时价格/套餐的权益、适用分店、有效期和承接入口是什么？ | P0 | pending | unknown |
| MV003 | S004 | O0004 | `rights_status` | 客照/案例由谁提供，允许在哪些平台与周期复用？ | P0 | pending | unknown |
| MV004 | S001–S007,S009–S010 | O0001–O0007,O0009–O0010 | `adoption_and_outcome` | 是否为门店主动发布；发生了哪些修改与可验证结果信号？ | P0 | pending | unknown |
| MV005 | S008 | unknown | `branch_scope` | 连锁级小红书内容可否用于福田口岸店，哪些事实必须分店覆盖？ | P1 | pending | unknown |
| MV006 | S001–S010 | unknown | `routine_marketing_materials` | 最近 30 天实际做过哪些价目卡、海报、门店屏、到店指引或私域/线下物料？ | P1 | pending | unknown |
| MV007 | S008–S010 | unknown | `regulated_service_scope` | 经营主体、服务范围与资质能否确认属于本轮非医疗范围，哪些功效表达需禁止或复核？ | P0 | pending | unknown |

### 8.7 第一轮覆盖统计

| 指标 | 分子 `n` | 分母 `N` | 平台/业态范围 | 缺失率 | 证据等级 | 结论或缺口 |
| --- | ---: | ---: | --- | ---: | --- | --- |
| 纳入门店位置 | 10 | 10 | 美发 3 / 美甲美睫 2 / 生活美容 2 / 皮肤管理 3 | 0% | A+B | 达到 8–12 家和各业态 2–3 家配额 |
| 三平台匹配尝试 | 30 | 30 | 10 店 × 3 平台 | 0% | A 级直接摘录；raw 待补 | matched/probable/not_found 均已记录 |
| 至少一个内容平台有窗口内分店级正样本 | 9 | 10 | 抖音或小红书 | 10% | A 级直接摘录；raw 待补 | S008 只有连锁级或超窗分店内容；如实保留缺口，不为凑数下放个例 |
| 完整 30 天发布序列 | 0 | 10 | 内容平台 | 100% | A | 小红书分页/时间估算、抖音日期字段缺失；禁止报告正式频次 |
| 至少有 1 条正式分店观测的入口 | 4 | 5 | 9 条分店级代表观测 | 20% | A 级覆盖，不等于共性 | 宣传物料入口为 0；此行只报告出现与否 |
| 达到本样本重复模式门槛的主入口 | 2 | 5 | 9 条分店级代表观测 | 60% | B | 日常项目/服务曝光 3 店、促销/团购转化 3 店；品牌/IP 2 店、流量机会 1 店、宣传物料 0 店均未达门槛 |
| 分店级三平台均 matched | 3 | 10 | S002,S003,S006 | 70% | A+B | S008 的 XHS 仅为连锁级；正样本不要求三平台都存在，不得用 probable 补全分店事实 |
| 去敏原始平台输出包 | 0 | 3 | 抖音 / 小红书 / 大众点评 | 100% | retention gap | 当前保存的是可复核发现文档、ID、URL 与命令台账，不是不可变 raw dump |
| 第二编码完成 | 0 | 9 | O0001–O0007,O0009–O0010 | 100% | pending | 需独立复核主入口、身份与机会分类 |

## 9. 完成判定

只有同时满足以下条件，才能把本文件状态改为“第一轮完成”：

- 纳入 8–12 家门店，四个业态各 2–3 家；
- 每家门店完成三个平台匹配尝试，并保存成功、失败或未找到的原始证据；
- 所有可用内容平台快照明确 30 天窗口完整性，所有当前经营页与 30 天发布分开统计；
- 五类入口都有真实证据，或明确报告无法达到覆盖目标的原因；
- 所有观测完成六维、个性化资产、行业资产、CTA、互动与未知项编码；
- 热点观测都有来源及时效字段，无法证明的热点结论已降为 `unknown`；
- 第二编码复核完成，所有统计带分母、缺失率、证据等级和适用边界；
- 没有把公开互动写成到店因果，也没有从公开页面臆测内部岗位流程。
