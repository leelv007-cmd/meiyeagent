# 抖音与小红书平台机会发现核验

- 核验日期：2026-07-17
- 抓取时区：Asia/Shanghai（UTC+08:00）
- 实时抓取窗口：2026-07-17 17:05–17:11
- 证据等级：A（OpenCLI 从目标平台已登录页面直接读取）；由证据推导的产品规则标为 D
- 范围：只核验抖音和小红书的热点、话题、节点机会发现能力；大众点评由独立发现文档承载
- 操作边界：全程只调用 OpenCLI 标注为 `read` 的命令；小红书 `ask` 在适配器中标注为 `write`，未调用

## 结论先行

1. **不存在“调一个接口就得到可直接发布的美业热点机会”。** 平台只提供原始候选，Agent 仍需做时效校验、行业/地域相关性判断、门店资产匹配和原创改写。
2. **抖音官方活动是本轮最强的“节点型机会源”。** `activities` 同时返回 `activity_id` 和 `end_time`，可明确判定过期。但它没有返回完整规则、资格和活动页 URL，不能直接声称门店可参加。
3. **抖音热点词目前只能当“全局候选池”。** `hashtag hot --keyword ...` 对“美发/美甲/美容/皮肤管理”连续返回完全相同的全局榜单，说明当前 `keyword` 不能视为有效行业筛选。
4. **小红书搜索更适合识别“当前内容角度和表达结构”，不能单独证明“正在热”。** 搜索返回发布日期、排名、点赞和 URL，详情可补充正文、标签、收藏和评论；但同一查询会混入数月前内容和语义假命中。
5. **地域相关性不是榜单原生字段。** 需使用“城市/商圈 + 项目/问题”组合查询，再由正文或标签交叉验证；仅因查询词中含城市不得标记为本地机会。
6. **产品应输出“可解释的候选机会卡”，不是搬运热榜。** 每张卡必须说明来源、抓取时间、时效、为什么适合这家店、匹配了什么本店事实，以及哪些内容不能复制。

## 证据标签

- **A：平台可见事实**：本文的命令台账、返回字段、原始 ID/URL、抓取时间、榜单/搜索快照、笔记正文/标签摘要和适配失败面。它们只证明抓取时可见的平台状态。
- **D：待验证产品假设**：机会卡字段、状态机、TTL/重抓节奏、原创改写流程和前端交互建议。它们需用连续抓取和真实商家采用/拒绝记录校准，不是已验证平台规则。
- 本轮没有 B 级长期趋势证据，也没有 C 级门店确认；因此不判断哪个机会“必然值得蹭”或“能带来到店”。

## 已核验的读取能力

| 平台 | 来源类型 | OpenCLI 命令 | 当前可得字段 | 可支持 | 不可支持 |
| --- | --- | --- | --- | --- | --- |
| 抖音 | 全局热点词 | `douyin hashtag hot` | `name`, `id`, `view_count` | 证明该话题在抓取时出现于返回榜单 | 行业筛选、地域、开始时间、过期时间、趋势增速 |
| 抖音 | 官方活动 | `douyin activities` | `activity_id`, `title`, `end_time` | 证明活动当时在列且有截止日期 | 开始时间、详细规则、参与资格、品牌/门店适用性 |
| 抖音 | 关键词内容 | `douyin search` | `rank`, `desc`, `author`, `url`, `plays`, `likes`, `comments`, `shares` | 核验内容角度、标签、公开 CTA 和平台内容 URL | 发布日期；当前实例的 `plays/comments/shares` 多为 `0`，不得当真实流量比较 |
| 小红书 | 关键词搜索 | `xiaohongshu search` | `rank`, `author`, `author_url`, `likes`, `title`, `url`, `published_at` | 核验查询下可见内容、发布日期和原始笔记 ID | 搜索趋势、热度增速、曝光、地域定位、精确过期时间 |
| 小红书 | 笔记详情 | `xiaohongshu note` | `title`, `author`, `content`, `likes`, `collects`, `comments`, `tags` | 交叉核验表达结构、地域/行业标签和互动快照 | 搜索排名、详情层的发布日期、趋势增速、经营结果 |
| 小红书 | 个性化推荐 | `xiaohongshu feed` | `id`, `title`, `type`, `author`, `likes`, `url` | 证明当前登录会话的 Feed 可读 | 全站热榜或美业趋势；它高度个性化且不返回发布日期 |

## 抖音实时核验

### 1. 全局热点词：有当下候选，无美业过滤

2026-07-17 17:05:35 抓取的前 20 条热点词包含：

| 话题 | 话题 ID | 抓取时 `view_count` | 可复用类型 | 直接可用？ |
| --- | --- | ---: | --- | --- |
| 第一眼直觉点评穿搭 | `2573429` | 11,057,686 | “第一眼点评”可作表达机制候选 | 否；需匹配真实项目和 IP 专业视角 |
| 慢充才是旅行最佳打开方式 | `2573593` | 10,475,409 | 旅行/假期情境候选 | 否；与门店服务的关联尚未核验 |
| 餐桌上的东方美学有多绝 | `2574689` | 10,458,532 | “东方美学”视觉语言候选 | 否；跨行业搬运风险高 |

为核验行业过滤，在 17:05:45–17:05:54 依次执行：

```sh
opencli douyin hashtag hot --keyword 美发 --limit 20 --window background -f json
opencli douyin hashtag hot --keyword 美甲 --limit 20 --window background -f json
opencli douyin hashtag hot --keyword 美容 --limit 20 --window background -f json
opencli douyin hashtag hot --keyword 皮肤管理 --limit 20 --window background -f json
```

四次均返回与无关键词调用完全相同的 20 条、相同顺序和相同数值。因此当前产品不得把 `--keyword` 标记为已验证的行业热点过滤。

### 2. 官方活动：有明确截止日期的机会源

2026-07-17 17:06:27 的活动列表中，可见与美容/妆造内容较相关的官方活动：

| 活动标题 | `activity_id` | `end_time` | 机会意义 | 仍需校验 |
| --- | --- | --- | --- | --- |
| 交出流汗不脱妆的小秘密！有奖投稿 | `7642660687445496870` | 2026-07-30 | 高温/持妆场景的明确截止型节点 | 活动规则、服务门店是否适用、是否要求特定商品 |
| 分千万流量！晒夏日持妆神器抽相机 | `7649006355399283738` | 2026-07-30 | 夏日持妆内容机会 | 不得将门店服务伪装为指定商品种草 |
| 投稿抽相机！打卡春夏氛围感美妆 | `7644140157985805358` | 2026-07-30 | 氛围感妆造/视觉表达机会 | 主题定义、投稿素材和商业内容限制 |
| 毕业拍立得 | `7650364281557865518` | 2026-07-31 | 毕业造型/美甲/摄影联动候选 | 距截止日较近，必须二次核验且确认门店真有对应服务 |

这类活动可以给机会卡提供 `expires_on` 的强证据，但返回值只精确到日期，未返回时区和当日截止时刻。只有在活动详情、参与资格和门店资产都校验后，才能从“候选”升级为“可采用”。

### 3. 关键词搜索：可发现内容机制，无法单独确定时效

| 查询 | 可复核实例 | 实例显示的机制 | 关键边界 |
| --- | --- | --- | --- |
| `夏日发色` | [夏天染这五款发色](https://www.douyin.com/video/7622625394633574867) | 季节 + 肤色问题 + 五款服务建议 + “惠州”本地化 + 私信 CTA | 搜索结果无发布日期；不能因排名高就称为当日热点 |
| `显白美甲` | [黄皮姐妹美甲别乱选色](https://www.douyin.com/video/7662351779703821809) | 问题型开场 + 显白公式 + 武汉本地标签 + 门店品牌 | 8 条结果仅前 2 条与美甲直接相关；必须做逐条相关性过滤 |
| `晒后修复 皮肤管理` | [敏肌晒后完整修护流程](https://www.douyin.com/video/7645919643925171569) | 夏季问题 + 服务流程 + 郴州同城 | 涉及敏感肌/修护功效，需合规与事实校验，不能照抄医疗化表述 |
| `晒后修复 皮肤管理` | [皮肤管理店的一天](https://www.douyin.com/video/7653035900708417905) | 第一视角体验 + 晒后场景 + 上海徐汇本地标签 | “72 小时黄金修复”属待核验功效表述，不可直接复用 |

当前 `douyin search` 的 `plays` 全部返回 `0`，多数 `comments` 和 `shares` 也是 `0`，与部分结果的点赞量不匹配。本轮只把标题/正文摘要、作者、URL 和可见标签当作有效字段，不用该命令做流量对比。

### 4. 抖音当前适配失败面

| 命令 | 结果 | 产品含义 |
| --- | --- | --- |
| `douyin hashtag search --keyword 夏日美甲` | API `-2`，JSON 空响应解析失败 | 话题精准搜索不能进入当前已验证能力矩阵 |
| `douyin hashtag search --keyword 美发` | 同样失败；失败 trace ID `20260717090614-04ec3b92` | 不是单一关键词问题 |
| `douyin search '夏日美甲'` | 解析到结果卡，但无稳定视频 URL/描述，命令失败 | 搜索必须有查询改写和失败降级，不能向用户显示空白结果 |
| `douyin location '上海徐汇'` | API `-2`，JSON 空响应解析失败 | 不得把 POI 精准匹配标记为当前可用；只能从内容文本/标签获得弱地域证据 |

## 小红书实时核验

### 1. 搜索 + 笔记详情：当前最实用的两段式发现

`xiaohongshu search` 返回发布日期和 URL，`xiaohongshu note` 再补充正文、标签、收藏和评论。两者需以笔记 ID 合并，不应把任一步单独当成完整机会证据。

| 查询 | 可复核笔记 | 搜索快照 | 详情补充 | 可复用机制 |
| --- | --- | --- | --- | --- |
| `夏日美甲` | [Nail 冰透玻璃蓝](https://www.xiaohongshu.com/search_result/6a535c4f0000000008001480) (`6a535c4f0000000008001480`) | 2026-07-12，搜索第 1，点赞原始值 `3992` | 收藏 `3258`，评论 `79`；标签含“夏天美甲/蓝色美甲/猫眼美甲” | 季节体感“降温” + 具体颜色/工艺 + 成品近景 |
| `夏日发色` | [夏季必备发型、发色](https://www.xiaohongshu.com/search_result/6a3fb486000000000603040d) (`6a3fb486000000000603040d`) | 2026-06-27，搜索第 10，点赞原始值 `301` | 收藏 `194`，评论 `14`；标签含“杭州发型推荐/男士发型/夏季发色” | 季节 + 人群 + 地域 + 具体服务主题 |
| `上海 晒后修复 皮肤管理` | [高温预警，给皮肤降温](https://www.xiaohongshu.com/search_result/6a55eeef000000001702dbb2) (`6a55eeef000000001702dbb2`) | 2026-07-14，搜索第 3，点赞原始值 `7` | 正文从台风路径与持续高温转到出油/防晒/清洁；标签含“上海皮肤管理/闵行区问题肌/夏日修复” | 当地天气/新闻节点 + 店内问题场景 + 服务建议 + 本地标签 |
| `上海 晒后修复 皮肤管理` | [徐汇这家韩国皮肤馆](https://www.xiaohongshu.com/search_result/6a586ea8000000000f01141d) (`6a586ea8000000000f01141d`) | 2026-07-16，搜索第 1，点赞原始值 `2` | 本轮未读取详情 | 城区 + 体验结果 + 服务探店角度；是否为商业合作待核验 |

小红书 `likes` 是字符串，可返回 `3992`、`1万`、`2.9万` 等不同格式。存储时必须保留 `raw_value`；如果用于比较，另外保存带解析版本的 `normalized_value`，不得静默转换。

### 2. “查询命中”不等于“机会成立”

2026-07-17 17:10:38 搜索 `七夕美甲` 时，前 10 条中：

- 多条只是普通猫眼、短甲、粉金或夏日美甲，标题未出现七夕语义。
- 一条作者名为“王七夕”，构成典型字面假命中。
- 最无关的结果可追溯至 2026-02-01，说明搜索未自动实施“最近 30 天”窗口。

因此，“节日词 + 项目词”只能生成搜索候选。至少需再核验标题/正文/标签中的节点语义、发布日期和当年节点日期，才能升级为机会卡。

### 3. 地域相关性需两步校验

不带地域的 `晒后修复 皮肤管理` 搜索，前列多为医生/教授科普、自护经验或产品内容，不是本地门店服务。加入“上海”后，前列出现徐汇、闵行、古北等本地化结果，但仍混入无关及 2024–2025 年旧内容。

产品应将地域相关性拆成：

1. `query_region`：来自门店资产的城市/区/商圈，不是 Agent 猜测。
2. `evidence_region`：正文、标签、作者信息或可验证 POI 中真实出现的地域。
3. `region_match_reason`：解释查询地域与证据地域如何一致；无证据时降级为“无地域保证的内容角度”。

### 4. 个性化 Feed 不是行业热榜

2026-07-17 17:10:48 读取的 10 条 Feed 主要是办公室分租、餐饮、成都旧房、招聘、种菜和创业活动，与美业无关。该结果只反映当前登录会话的推荐，不能作为美业平台趋势源。

## 机会卡最小合同（D：产品规则建议）

| 字段 | 要求 | 不得省略的原因 |
| --- | --- | --- |
| `opportunity_id` | 产品内部稳定 ID | 便于复盘、去重与异步恢复 |
| `platform` | `douyin` / `xiaohongshu` | 不同平台字段不可混写 |
| `source_type` | `official_activity`, `global_hot`, `seeded_search`, `note_detail` | 来源类型决定可信度和过期规则 |
| `source_id` / `source_url` | 保存平台 ID 与去授权查询参数的稳定 URL | 可回溯原始证据，不泄露会话型 `xsec_token` |
| `query` / `raw_rank` | 搜索类来源必填 | 排名只在某次查询与会话中有意义 |
| `captured_at` | ISO 8601 + 时区 | 热点与互动值均是快照 |
| `published_at` | 有平台字段时保存；无则为 `unknown` | 不得从排名或 ID 猜测发布时间 |
| `expires_on` / `expires_at` / `expiry_basis` | 官方活动先原样保存只到日期的 `end_time`；不猜测当日截止时刻；其他来源记录产品 TTL 与依据 | 必须能说明为什么仍有效 |
| `raw_metrics` | 原样保留数值与字符串 | 适配器字段可缺失、为 0 或使用“万”格式 |
| `industry_relevance` | 匹配项目/服务/人群的证据和分数 | “美”、“夏日”等泛词不等于美业可用 |
| `region_relevance` | `query_region`, `evidence_region`, `match_reason` | 防止把搜索词当地理证据 |
| `store_asset_matches` | 列出真实匹配的门店、项目、服务、团购、案例、IP 身份 | 没有本店资产就只是追热点，不是可发布机会 |
| `reusable_mechanism` | 只提炼结构：触发点、开场、证据、成品形式、CTA | 不复制原标题、正文、视觉或人设 |
| `risk_flags` | 功效/医疗化表述、官方活动资格、商业合作、版权、过期、弱地域证据 | 决定是否触发 HITL 或直接拒绝 |
| `state` | `candidate`, `active`, `degraded`, `expired`, `rejected` | 前端不应展示已过期或无关机会 |

### 建议的时效与降级规则

| 来源 | 初始状态 | 建议复验节奏 | 过期/降级规则 |
| --- | --- | --- | --- |
| 抖音官方活动 | `candidate` | 展示前每次复验；至少每 24 小时重抓 | 平台不再列出或抓取地日期已晚于 `end_time` 时 `expired`；`end_time` 当日由于缺少精确时刻必须重新校验 |
| 抖音全局热点词 | `candidate` | 展示前复验；产品 TTL 建议不超过 6 小时 | 离榜、无行业匹配或只能硬蹭时 `rejected` |
| 抖音关键词搜索 | `degraded` | 使用前重抓，并与官方活动/热点词/外部日历交叉验证 | 因无发布日期，单独只能作表达机制，不标记为“当前热点” |
| 小红书搜索 | `candidate` | 展示前重抓；依 `published_at` 与业务节点单独计算新鲜度 | 超出研究/任务时间窗、语义假命中、无地域/行业证据时降级或拒绝 |
| 小红书 Feed | `rejected` 作为行业机会源 | 不进入行业趋势流程 | 只能用于用户明确要求的个人 Feed 观察 |

表中“6 小时/24 小时”是待通过连续抓取校准的产品初始值，不是平台公开规则。

## 原创改写与风险边界（D：产品规则建议）

### 可以提炼的是“机制”

- 环境触发：高温、旅游、毕业、换季等与项目真实相关的场景。
- 表达结构：问题开场 → 专业解释 → 本店项目/案例 → 适用人群/限制 → 本地 CTA。
- 形式机制：第一视角体验、第一眼点评、五款合集、过程前后对比、主理人/专业人员解说。
- 匹配要素：必须换成本店的真实服务、价格/团购事实、可用案例、门店地域、IP 身份和真实承接方式。

### 不可复制或伪造的是“原作与事实”

- 不复制原标题、正文句子、口播、镜头顺序、封面、图片、人设口头禅或未授权案例。
- 不把搜索排名写成“官方热榜”，不把单条高赞写成“趋势正在上升”。
- 不在未核验规则时声称“参加官方活动”或使用活动激励话术。
- 不复用“黄金 72 小时”、“快速美白”、“修复受损肌肤”等未经门店资质、服务事实和合规审核的功效语句。
- 不将点赞、收藏、评论与到店、咨询或买券建立因果。

## 对工作流的直接影响

```text
平台原始候选
  → 来源与时效校验
  → 行业/地域相关性过滤
  → 匹配门店、项目、服务、团购、案例和 IP 资产
  → 只提炼可复用机制
  → 生成一个原创主推方案
  → 仅在规则、功效、版权或事实不确定时触发 HITL
```

前端不应向商家暴露上述工程流水线。只展示：

- 机会是什么，还有多久；
- 为什么适合这家店；
- 它使用了哪些本店事实与资产；
- 打开后的一个完整主推成品；
- “不适合我家”、“换项目”、“换 IP”、“更本地”、“不要蹭这个”等快捷纠偏。

## 命令台账

### 环境与适配器

```sh
opencli auth status
opencli doctor
opencli douyin --help -f yaml
opencli xiaohongshu --help -f yaml
```

核验时 OpenCLI 为 `v1.8.6`，Browser Bridge 扩展已连接；`auth status` 显示抖音、小红书均为 `logged_in`。文档不记录用户身份和会话令牌。

### 抖音读取

```sh
opencli douyin hashtag hot --limit 20 --window background -f json
opencli douyin hashtag hot --keyword 美发 --limit 20 --window background -f json
opencli douyin hashtag hot --keyword 美甲 --limit 20 --window background -f json
opencli douyin hashtag hot --keyword 美容 --limit 20 --window background -f json
opencli douyin hashtag hot --keyword 皮肤管理 --limit 20 --window background -f json
opencli douyin activities --window background -f json
opencli douyin search '流汗不脱妆' --limit 10 --window background -f json
opencli douyin search '夏日发色' --limit 8 --window background -f json
opencli douyin search '夏日美甲' --limit 8 --window background -f json
opencli douyin search '显白美甲' --limit 8 --window background -f json
opencli douyin search '晒后修复 皮肤管理' --limit 8 --window background -f json
opencli douyin hashtag search --keyword 夏日美甲 --limit 10 --window background -f json
opencli douyin hashtag search --keyword 美发 --limit 10 --window background --trace retain-on-failure -f json
opencli douyin location '上海徐汇' --limit 5 --window background -f json
```

### 小红书读取

```sh
opencli xiaohongshu search '夏日发色' --limit 12 --window background -f json
opencli xiaohongshu note '<note-url-with-xsec-token>' --window background -f json
opencli xiaohongshu search '夏日美甲' --limit 12 --window background -f json
opencli xiaohongshu search '晒后修复 皮肤管理' --limit 12 --window background -f json
opencli xiaohongshu search '上海 晒后修复 皮肤管理' --limit 10 --window background -f json
opencli xiaohongshu search '七夕美甲' --limit 10 --window background -f json
opencli xiaohongshu feed --limit 10 --window background -f json
```

小红书搜索 URL 返回的 `xsec_token` 是会话/时效型查询参数，本文仅保存稳定笔记 ID 和去授权参数的 URL。正文中的 ID 与抓取时间可用于后续重新获取可访问链接。

## 待连续抓取校准的问题

1. 抖音全局热点词的更新频率、离榜时间和 `view_count` 变化是否稳定可观测。
2. 抖音官方活动详情页、资格和规则能否通过已登录只读页面稳定补齐。
3. 抖音 `hashtag search` 和 `location` 的 API `-2` 是平台短期异常、账号能力限制还是适配器回归。
4. 小红书搜索排名的会话/地域波动，以及同一查询多时点结果的重合度。
5. “近 24 小时/近 7 天/近 30 天”在不同机会类型下的合理窗口，需用连续抓取与商家采用记录共同校准。
6. 哪些机会卡被商家标记为“适合我家/硬蹭/太旧/不符合调性”，以此学习门店的长期选题偏好。
