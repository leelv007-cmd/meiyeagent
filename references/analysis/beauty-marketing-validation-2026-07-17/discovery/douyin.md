# 抖音美业门店发现与精确锚点匹配

> 抓取日期：2026-07-17
>
> 抓取时段：17:03–17:17 CST（Asia/Shanghai）
>
> 平台：抖音
>
> 方法：优先复用已登录 Chrome 的 OpenCLI 抖音专用适配；仅执行 `search`、`user-videos`、`hashtag`、`location` 及 OpenCLI Browser 页面读取。
>
> 安全边界：未发布、未保存草稿、未删除、未修改任何平台数据。

## 1. 结论摘要

- 12 个大众点评精确锚点在抖音上的结果为：`matched` 1 个、`probable` 7 个、`not_found` 4 个。`probable` 只表示同品牌、同名账号或内容曾出现，不表示已确认同分店或近30天活跃。
- 精确锚点找不到近30天正样本时，已换用“城市 + 品类/服务 + 门店”发现活跃候选。本轮建立了四个业态、每类至少 2 个可观察账号的部分时间窗：美发、美甲美睫、生活美容、皮肤管理。
- 8 个发现账号中，重复线索为：项目/服务曝光 `8/8`、促销/团购 `6/8`、节点/时机 `3/8`、品牌/个人 IP `3/8`、可独立复用的日常宣传物料 `0/8`。这是发现层线索，不是正式 9 店任务语料的频次统计，不直接产生产品决策。
- “活跃”不等于“优质”。多个商家账号高频发布但标题模板化、话题词与美业无关，且搜索适配中的播放数多为 `0`。本报告把它们作为生产模式样本，不作为效果最佳实践。

## 2. 证据级别与匹配规则

### 2.1 证据级别

| 级别 | 含义 | 本轮用法 |
|---|---|---|
| A-page | OpenCLI Browser 在抖音作品页原文读到的作者、认证主体、作品 URL 和“发布时间” | 可用于证明某一条内容在时间窗内可见 |
| A-discovery | `opencli douyin search` / `user-videos` 直接返回的作者、标题、作品 ID/URL | 可用于发现与检查内容序列，但 `user-videos` 本轮不返回 `create_time`，不能独立证明发布日期 |
| D-derived | 将 `aweme_id >> 32` 转为类时间戳的筛选线索 | **非官方合同、非 A 级、不当作平台原始发布时间，不用于正式频次计数** |

`user-videos` 返回顺序也不保证严格按时间倒序。因此，除非已逐条在页面上读到“发布时间”，否则只记为 `partial/date_unverified`。

### 2.2 店铺匹配状态

- `matched`：名称/品牌、城市或分店锚点、商家身份可以同时对上。
- `probable`：品牌或名称可对上，但分店、地址、作者与门店的关系至少有一项未证明。
- `not_found`：精确词与简化变体词均未返回可归因到该门店的稳定作品。这不等于门店没有抖音账号，仅表示本轮检索未发现。

## 3. 12 个精确锚点的抖音匹配

| # | 大众点评锚点 | 状态 | 抖音可见结果 | 30 天窗口 | 证据边界 |
|---|---|---|---|---|---|
| 1 | 研色·烫染·漂发·巴黎画染（徐家汇） | probable | 精确词命中 UGC：[“徐家汇的这家研色 salon”](https://www.douyin.com/video/7313551355375897896)；另一条提到华山路、巴黎画染 880 元：[7169503492594273549](https://www.douyin.com/video/7169503492594273549) | date_unverified；无 A 级近30天正样本 | 作者是探店 UGC，不是已确认门店账号；`search` 未返回日期 |
| 2 | TIDA HAIR（中山公园） | not_found | 精确词与 `TIDA HAIR 上海` 均未得到稳定同店结果 | not_found | “TIDA”与车型/英文噪声混在一起 |
| 3 | 玫丽盼 MLP（新天地） | probable | [MLP·玫丽盼染发沙龙官方号](https://www.douyin.com/user/MS4wLjABAAAAmasutQhxkQNRBPNNJyzUwKddFEiY16m8Jey0CDOQMb7GRCMiqRRAVYXFBmC3v5o_) 是商家认证账号；代表页 [7506078337585892647](https://www.douyin.com/video/7506078337585892647) | 无 A 级近30天正样本；代表页发布于 2025-05-19 16:57 | 账号可对上品牌，但“新天地分店”未被页面身份证明 |
| 4 | 御·nail（城西银泰） | not_found | 精确词及 `御nail 杭州` 无稳定同店结果 | not_found | 返回 DK Nail、拾月等其他杭州美甲店，不能混同 |
| 5 | AN NAIL（滨江天街） | not_found | 精确词及 `AN NAIL 杭州` 无稳定同店结果 | not_found | 返回 ONAIL 美甲灯、A nail shop 等近形噪声 |
| 6 | Ellen.G（杭州火车东站） | probable | [Ellen.G章章（有课）](https://www.douyin.com/user/MS4wLjABAAAAdd3ckR74r2K00zIdpuz3811GXoZ6o-jRtJKnvtfs258AXFKT73Mm3S1WCVn1_RfY) 发布美甲设计/培训内容；代表页 [7531304003838709050](https://www.douyin.com/video/7531304003838709050) | 无 A 级近30天正样本；代表页发布于 2025-07-26 16:26 | 名称匹配，但账号主体更像设计/培训 IP，东站门店身份未证明 |
| 7 | 圣梦亲体美肤生活馆（成都天誉） | probable | [圣梦亲体美肤生活馆（会展店）](https://www.douyin.com/user/MS4wLjABAAAApwhhc2L6bsPeQvYGTexVbKwmuFSV7odkzeOD1p6DgrM) 存在活跃内容 | partial；A 级已核实 2026-07-01 至 2026-07-16 至少 2 条 | 同品牌，但“会展店”不是“天誉店”；不升级为同分店 |
| 8 | 优兰熹美容疗愈 SPA（成都天阔美地） | not_found | 精确词及 `优兰熹 成都` 无稳定同店结果 | not_found | 搜索返回普通 SPA 和无关噪声 |
| 9 | 秋和闺蜜美容养生 SPA 馆（成都泰安街） | probable | [秋和美拾美刻美容护肤养生（朱水碾街店）](https://www.douyin.com/user/MS4wLjABAAAAjnnZlWEM32UpStVOMydBJFOX6-MFsLgh0FLjIa7NCn5B7fF2Wr9Ouu6sk0OrG2FA) 为认证账号 | partial；A 级已核实 2026-06-22 至 2026-07-17 至少 2 条 | 品牌字样可对上，但门店是“朱水碾街店”而非“泰安街店” |
| 10 | TurnOver28（深圳卓悦） | probable | 命中 `TurnOver28皮肤管理`、`TurnOver28_SJZ` 及多条 UGC；例：[7657481431161311717](https://www.douyin.com/video/7657481431161311717) | date_unverified；无 A 级“深圳卓悦”正样本 | 品牌泛匹配，现有作者/内容未证明深圳卓悦分店 |
| 11 | 华熙生物 QUADHA 夸迪皮肤管理（深圳） | matched | [华熙 QUADHA 夸迪美肤中心（深圳店）](https://www.douyin.com/user/MS4wLjABAAAAmKr0VLrz0jihtFO6dAWpNN9rajjnYAaU39_b5YboW22Tm84a5tkx8_b_Ul851fZK)；认证主体“深圳市福田区夸迪欣雪儿美肤中心” | partial；A 级已核实 2026-07-10 至 2026-07-13 至少 2 条 | 同城市商家身份已确认；未逐条验证 `user-videos` 全部 20 条的日期，不报正式频次 |
| 12 | HIKO SKIN 彦村（深圳福田） | probable | 历史 UGC 精确提到“福田金中环”与 `HIKO SKIN彦·敏感肌肤护理中心`：[7214087145173159207](https://www.douyin.com/video/7214087145173159207) | date_unverified；无 A 级近30天正样本 | 作者为 UGC，未找到可确认的官方账号与当前分店活跃证据 |

### 3.1 福田口岸分店补充核验（超窗边界）

2026-07-17 通过 OpenCLI Browser 只读打开作品 [7601464168575326883](https://www.douyin.com/video/7601464168575326883)，页面作者为“SMOOTH小室木·专注痘敏（福田口岸）”，发布时间为 **2026-01-31 18:03**。该记录可支持分店身份匹配，但已超出本轮 2026-06-18 至 2026-07-17 窗口，不进入任务语料、覆盖率或产品共性结论。没有继续为补齐单店覆盖追逐个例。

读取方式：

```sh
opencli browser s008verify open 'https://www.douyin.com/video/7601464168575326883' --window background
opencli browser s008verify eval '<read author and 发布时间 from visible page>'
opencli browser s008verify close
```

## 4. 四个业态的近30天可观察样本

`window_status` 均为 `partial`：表中时间范围由两个作品页的原始“发布时间”组成，可证明时间窗内至少有这两条，不代表已完整统计全部发布频次。

| 业态 | 城市 | 账号/门店 | sec_uid / 账号 URL | A 级已核实时间范围 | 代表内容 | 五类宣发线索 | 回查键 |
|---|---|---|---|---|---|---|---|
| 美发 | 上海 | 浦江专注烫发染发（ALINECOOL）；认证主体为上海市闵行区浦江镇坚隅美容美发店 | [MS4w…FF_N](https://www.douyin.com/user/MS4wLjABAAAAzY7GaUZKvq46cyFR4EbuweH2id2Rh7lzBM1LIY7SIrEnlhj1urMmKE3PCQsrFF_N) | 2026-06-20 23:06 至 2026-07-08 14:49 | [浦江万达附近理发店推荐](https://www.douyin.com/video/7653494208518857381)；[烫染理发店](https://www.douyin.com/video/7660045744426601841) | 1 项目/服务曝光；4 本地促销 | `ALINECOOL + 浦江万达 + 坚隅美容美发` |
| 美发 | 成都 | 成都观山男士发型阿信 | [MS4w…gIlIgU](https://www.douyin.com/user/MS4wLjABAAAAJx7ViRJGcbFy0Wh2ZaYTkMu3dMa1EaMmLNQdVgIlIgU) | 2026-07-12 12:55 至 2026-07-16 19:10 | [观山售后与男士发型标杆](https://www.douyin.com/video/7661500683431168945)；[细软塌造型教程](https://www.douyin.com/video/7663081636040851057) | 1 项目/技术曝光；3 发型师个人 IP | `观山男士发型 + 阿信 + 成都` |
| 美甲美睫 | 上海 | 0127 上海日式美甲美睫 | [MS4w…DuRFed](https://www.douyin.com/user/MS4wLjABAAAA-A2iXKQDKD5Qf-CYxvq9PKCEQEh2WkYs7InSfrssVscjqhmHP31HVcSoetDuRFed) | 2026-06-19 12:46 至 2026-07-15 17:24 | [开美甲店一天 vlog](https://www.douyin.com/video/7652963317228630897)；[新品饮品上新](https://www.douyin.com/video/7662683321927354289) | 1 服务/环境曝光；2 上新机会；3 门店日常 IP | `0127美甲美睫 + 静安 + 上海` |
| 美甲美睫 | 杭州 | 杭州美甲美睫（看置顶） | [MS4w…S2RSj58](https://www.douyin.com/user/MS4wLjABAAAAo5k5DHKuFQeACCcTmSHAd8P-X-c-ydfJf9Y8S2RSj58) | 2026-06-27 20:07 至 2026-07-11 14:32 | [美甲店 vlog](https://www.douyin.com/video/7656045752502906289)；[杭州百元美甲](https://www.douyin.com/video/7661154639845519470) | 1 款式/服务曝光；2 暑期、百元话题；4 价格引流 | `杭州美甲美睫 + 百元美甲 + 置顶` |
| 生活美容 | 成都候选 | 圣梦亲体美肤生活馆（会展店） | [MS4w…p6DgrM](https://www.douyin.com/user/MS4wLjABAAAApwhhc2L6bsPeQvYGTexVbKwmuFSV7odkzeOD1p6DgrM) | 2026-07-01 13:04 至 2026-07-16 17:03 | [30 周年全能臻选卡](https://www.douyin.com/video/7657420955450665838)；[头皮养护 109 元](https://www.douyin.com/video/7663048873254353855) | 1 项目曝光；2 周年/夏季机会；4 套餐价格 | `圣梦 + SANMOON + 会展店`；需在点评核分店 |
| 生活美容 | 成都/邛崃候选 | 秋和美拾美刻美容护肤养生（朱水碾街店）；认证主体为邛崃市美拾美刻美容用品销售有限责任公司 | [MS4w…k0OrG2FA](https://www.douyin.com/user/MS4wLjABAAAAjnnZlWEM32UpStVOMydBJFOX6-MFsLgh0FLjIa7NCn5B7fF2Wr9Ouu6sk0OrG2FA) | 2026-06-22 20:01 至 2026-07-17 09:11 | [肩颈套餐 78 元](https://www.douyin.com/video/7654188666339764718)；[闺蜜打卡促销](https://www.douyin.com/video/7663298246294820559) | 1 服务过程；4 团购/闺蜜引流 | `秋和 + 美拾美刻 + 朱水碾街`；不与泰安街店混同 |
| 皮肤管理 | 深圳 | 华熙 QUADHA 夸迪美肤中心（深圳店）；认证主体为深圳市福田区夸迪欣雪儿美肤中心 | [MS4w…l851fZK](https://www.douyin.com/user/MS4wLjABAAAAmKr0VLrz0jihtFO6dAWpNN9rajjnYAaU39_b5YboW22Tm84a5tkx8_b_Ul851fZK) | 2026-07-10 20:23:43 至 2026-07-13 12:41 | [修丽可瀑布水疗](https://www.douyin.com/note/7660873980823894132)；[夸迪清洁补水按摩套餐](https://www.douyin.com/video/7661868259133632347) | 1 项目曝光；4 团购/到店 CTA | `华熙 QUADHA + 夸迪欣雪儿 + 福田沙嘴路` |
| 皮肤管理 | 成都 | 玺妍娜专注问题肌肤；认证主体为天府新区成都片区华阳玺颜美容中心 | [MS4w…vAi4IY](https://www.douyin.com/user/MS4wLjABAAAAGMVgbGLmBkdbf2fZRz9y-MvVbRkzLSy37AkYZG_D2lzXBVNhFdeGsrqKY4vAi4IY) | 2026-06-27 22:44 至 2026-07-10 12:44 | [效果和安全是底线](https://www.douyin.com/video/7656086097373498630)；[老板/女性成长 IP](https://www.douyin.com/video/7660755571506793779) | 1 问题肌项目；3 老板个人 IP；4 同城/团购 CTA | `玺妍娜 + 华阳玺颜美容 + 天府新区` |

五类线索编号：1=日常项目/服务曝光；2=热点/时机借势；3=品牌/个人 IP；4=促销/团购；5=日常宣传物料。由于 `hashtag` 本轮调用失败，表中“2”只是作品文案中的季节/上新时机线索，不是已证实的抖音平台热点。普通视频、vlog、教程或内容中的价格字幕不自动计为“5 日常宣传物料”；本轮没有稳定观察到可独立复用的海报、项目卡、价目卡、到店指引或线下/私域物料生产证据。

## 5. 发现层的重复线索与候选输入

### 5.1 跨 8 个发现账号的重复线索

| 线索 | 账号数 | 发现层解读 | 决策边界 |
|---|---:|---|---|
| 项目/服务曝光 | 8/8 | 四个业态均重复出现，是当前最稳定的内容组成线索 | 只能进入正式语料的编码维度，不单独确定入口或工作流 |
| 促销/团购 | 6/8 | 多业态重复出现价格、套餐、团购或到店动作 | 可作为转化信息候选维度，不能推导为每个任务必填项 |
| 节点/时机 | 3/8 | 季节、暑期、上新、周年等只在部分账号出现 | 保留为机会类候选；本轮未验证平台热点，不作热点产品规则 |
| 品牌/个人 IP | 3/8 | 专业观点、主理人或门店日常在部分账号出现 | 保留为表达身份候选；样本不足以确定人设模型或交互 |
| 可独立复用的日常宣传物料 | 0/8 | 未稳定观察到海报、项目卡、价目卡、到店指引等生产证据 | “未观察到”不等于“不需要”；应改用商家任务回放验证 |

这 8 个账号是为补齐四业态观察而建立的发现集，**不是正式 9 店 corpus**，也没有完整发布频次、转化效果或商家任务起点数据。上表只用于提炼重复线索、设计后续编码项，不直接得出产品入口、交互或编排规则。

### 5.2 12 锚点的重复身份边界

12 个精确锚点中只有 `1/12 matched`，其余为 `7/12 probable` 和 `4/12 not_found`。反复边界不是“某一家店必须如何处理”，而是抖音检索结果会持续混合同品牌不同分店、员工/主理人、探店 UGC 和无关内容。因此，后续正式语料至少需分别编码“被宣传门店”“发布账号”“表达身份”和“分店匹配状态”。这是数据可归因的最低要求，不是前台表单或工作流定稿。

### 5.3 产品候选假设（全部为 D，待验证）

以下只是为原型和商家任务回放提供的 D 级假设，不是本轮调研已确认的产品规则：

1. **D：**在后续任务回放中，比较“经营目标”“现有素材”“历史做同款”和“预期成品”等真实起点，再决定前台入口；公开成品标题无法反推任务起点。
2. **D：**测试 Agent 能否基于项目/服务、门店可变事实和转化信息给出一个完整草案，再让商家快捷纠偏；不把表格中的编码字段直接映射成前台表单。
3. **D：**测试价格、有效期、团购和分店等可变事实的核对时机；是否需要来源提示、何时需要人确认，必须由误用成本和任务回放共同决定。
4. **D：**测试“时机说明”和“表达身份建议”是否帮助商家决策；当前 `3/8` 的发现密度不足以固化为热点卡、人设选择器或其他精确交互。

单个账号的专业观点、文案噪声、分店匹配或超窗记录只保留在第 3、4 节的证据表与边界中，不用来单独支持产品结论。

## 6. 工具结果与失败边界

### 6.1 登录与专用适配

- `opencli auth status` 显示 `douyin: logged_in`；`opencli profile list` 显示 Browser Bridge 已连接。
- `opencli douyin --help -f yaml` 显示 `search`、`user-videos`、`hashtag`、`location` 均为 `access: read`。
- `search` 本轮可稳定返回标题、作者、作品 URL 和互动字段，但播放数多为 `0`；不将其解读为真实零播放。
- `user-videos` 可返回最多 20 条可见作品及 `aweme_id`，但本轮返回中没有原始 `create_time`。

### 6.2 `hashtag` 与 `location` 失败

2026-07-17 17:06:04–17:06:11 CST 调用以下只读命令均失败：

```sh
opencli douyin hashtag search --keyword '美发' --limit 10 -f json --window background --site-session persistent
opencli douyin hashtag search --keyword '美甲美睫' --limit 10 -f json --window background --site-session persistent
opencli douyin hashtag search --keyword '生活美容' --limit 10 -f json --window background --site-session persistent
opencli douyin hashtag search --keyword '皮肤管理' --limit 10 -f json --window background --site-session persistent
opencli douyin location '上海 美发' --limit 10 -f json --window background --site-session persistent
opencli douyin location '杭州 美甲美睫' --limit 10 -f json --window background --site-session persistent
opencli douyin location '成都 皮肤管理' --limit 10 -f json --window background --site-session persistent
opencli douyin location '深圳 生活美容' --limit 10 -f json --window background --site-session persistent
```

错误均为创作者端 API 响应的 `JSON parse failed: Unexpected end of JSON input`。这是调用失败，不能解读为“没有话题”或“没有 POI”；本轮也没有修改全局适配器。

## 7. 原始命令和抓取时间

### 7.1 城市 × 业态发现

命令格式（下表每个查询均独立执行）：

```sh
opencli douyin search '<query>' --limit 8 -f json --window background --site-session persistent
```

| 抓取时间 CST | 原始 query |
|---|---|
| 17:04:32–17:04:40 | `上海 美发 门店`；`上海 美甲 美睫 门店`；`上海 生活美容 门店`；`上海 皮肤管理 门店` |
| 17:04:50–17:04:59 | `杭州 美发 门店`；`杭州 美甲 美睫 门店`；`杭州 生活美容 门店`；`杭州 皮肤管理 门店` |
| 17:05:13–17:05:23 | `成都 美发 门店`；`成都 美甲 美睫 门店`；`成都 生活美容 门店`；`成都 皮肤管理 门店` |
| 17:05:33–17:05:44 | `深圳 美发 门店`；`深圳 美甲 美睫 门店`；`深圳 生活美容 门店`；`深圳 皮肤管理 门店` |
| 17:07:04–17:07:19 | `上海 皮肤管理 官方号`；`杭州 生活美容 官方号`；`成都 生活美容 官方号`（适配解析失败）；`深圳 生活美容 官方号` |

### 7.2 12 个精确锚点

命令格式：

```sh
opencli douyin search '<query>' --limit 10 -f json --window background --site-session persistent
```

| 抓取时间 CST | 原始 query |
|---|---|
| 17:09:19 | `研色 烫染 漂发 巴黎画染 徐家汇` |
| 17:09:25 | `TIDA HAIR 中山公园` |
| 17:09:29 | `玫丽盼 MLP 新天地` |
| 17:09:32 | `御 nail 城西银泰` |
| 17:09:36 | `AN NAIL 滨江天街` |
| 17:09:39 | `Ellen.G 杭州火车东站` |
| 17:09:51 | `圣梦亲体美肤生活馆 成都天誉` |
| 17:09:54 | `优兰熙美容疗愈SPA 成都天阔美地` |
| 17:09:56 | `秋和闺蜜美容养生SPA馆 成都泰安街` |
| 17:10:00 | `TurnOver28 深圳卓悦` |
| 17:10:03 | `华熙生物 QUADHA 夸迪 皮肤管理 深圳` |
| 17:10:06 | `HIKO SKIN 彦村 深圳福田` |

简化变体词于 17:10:20–17:10:43 CST 逐条执行：

```text
TIDA HAIR 上海
御nail 杭州
AN NAIL 杭州
Ellen.G 美甲 杭州
优兰熹 成都
秋和闺蜜 成都
TurnOver28 深圳 美容
HIKO SKIN 彦村
```

### 7.3 `user-videos` 与页面日期核验

`user-videos` 原始命令：

```sh
opencli douyin user-videos '<sec_uid>' --limit 20 --with_comments false -f json --window background --site-session persistent
```

| 抓取时间 CST | 账号 |
|---|---|
| 17:12:06 | MLP·玫丽盼染发沙龙官方号 |
| 17:12:16 | Ellen.G章章（有课） |
| 17:12:25 | 圣梦亲体美肤生活馆（会展店） |
| 17:12:35 | 秋和美拾美刻美容护肤养生（朱水碾街店） |
| 17:12:42 | 华熙 QUADHA 夸迪美肤中心（深圳店） |
| 17:13:21 | 浦江专注烫发染发（ALINECOOL） |
| 17:13:58 | 0127 上海日式美甲美睫 |
| 17:14:08 | 杭州美甲美睫（看置顶） |
| 17:14:21 | 成都观山男士发型阿信 |
| 17:14:35 | 玺妍娜专注问题肌肤 |

页面核验原始命令（仅读）：

```sh
opencli browser dyverify open 'https://www.douyin.com/video/<aweme_id>'
opencli browser dyverify wait time 1
opencli browser dyverify eval "(()=>{const pub=(document.body.innerText.match(/发布时间：[^\\n]+/)||[])[0]||'';const links=[...document.querySelectorAll('a[href*=\"/user/\"]')].filter(a=>!a.href.includes('/user/self')&&a.href.match(/\\/user\\/MS4/));const a=links.find(x=>x.textContent.trim())||links[0];return {url:location.href,published:pub,author:a?a.textContent.trim().replace(/\\s+/g,' '):'',author_url:a?a.href.split('?')[0]:''};})()"
```

17:15:54–17:17:02 CST 重点核验的第二条样本 URL 已直接列在第 4 节；页面返回了完整“发布时间”与作者链接。

## 8. 待下一轮复核

- 在大众点评按第 4 节“回查键”复核门店名、地址、分店和团购，特别是圣梦、秋和的分店歧义。
- 若需要“近30天完整发布数”，应等专用适配恢复原始 `create_time`，或对全部可见作品逐页打开核验；不应用 `aweme_id` 推算替代。
- 本轮只证明“内容生产形态与可观察活跃性”，没有证明哪条内容带来咨询、买券、核销或到店；效果只能后续与商家的可验证结果信号关联。
