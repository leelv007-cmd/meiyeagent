# 小红书近期门店内容发现与点评锚点匹配

- 抓取日期：2026-07-17（Asia/Shanghai）；结束时系统时间 `2026-07-17T17:15:01+08:00`。首条命令前未单独取系统时间，结合命令执行与结果资源时间戳，主要抓取时段约为 17:03–17:15 CST。
- 观察窗口：2026-06-18 至 2026-07-17，按自然日包含首尾。
- 抓取方式：OpenCLI `xiaohongshu` 专用适配 1.8.6，复用已登录浏览器会话；候选回查使用只读 `dianping search`。
- 访问范围：只执行 `auth status`、`whoami`、`search`、`user`、`note` 和只读帮助/诊断；未执行关注、点赞、收藏、评论、私信、发布、删除或登录操作。
- 研究目标：先按大众点评 12 个精确门店锚点寻找近 30 天同店内容；没有正样本时，不保锚点，改为发现同期活跃门店，并反向回查点评身份。
- 样本性质：候选发现集，不是门店排名、经营质量判断或内容带来到店结果的因果证据。

## 结论摘要

严格按“同品牌、同城市、同分店/商圈”判断，点评 12 个原始锚点在观察窗口内得到 `0 matched / 2 probable / 10 not_found`：

- `AN NAIL` 和 `优兰熹`出现同品牌同城近期内容，但小红书笔记没有公开分店字段，只能标为 `probable`。
- 其余 10 家没有可归属到指定分店的近 30 天正样本。旧探店、同名产品、泛商圈结果和其他城市同品牌内容均未强行并入。
- “研色”锚点需要特别纠错：活跃小红书账号 `TR I 烫染·漂发·画染` 能反向匹配到点评另一家独立挂牌门店 `TR salon 烫染·漂发·巴黎画染（徐家汇商圈）`，不能因为服务词和商圈相似就并入“研色”。它作为活跃替代样本保留。

替代发现集保留 12 个小红书账号，覆盖四城与四业态：美发 4、美甲美睫 4、生活美容 2、皮肤管理 2。这 12 个对象包含 `XHS-only`、`probable` 和品牌级账号，不是 12 家相互独立且已稳定匹配的正式门店，因此本文只用它们生成后续编码候选，不从单账号或个例直接得出产品决策。正式样本及跨平台共性以 [TASK-CORPUS](../TASK-CORPUS.md) 与 [PATTERN-FINDINGS](../PATTERN-FINDINGS.md) 为准。

## 匹配状态与时间口径

- `matched`：小红书公开作者/正文与点评挂牌名、城市、分店或唯一商圈信息一致。
- `probable`：品牌和城市一致，但笔记没有分店、地址、电话尾号或认证主体等稳定分店标识。
- `not_found`：观察窗口内没有可归属到该门店的正样本；不等于门店没有小红书内容。
- `XHS-only`：小红书账号近期活跃，但只读点评精确检索未返回可用同名门店；只作为内容模式样本。
- 搜索结果的 `published_at` 是适配器原始字段。`user` 结果没有 `published_at`；表内“近 30 天可见数/范围”由返回笔记 ID 的前 8 位十六进制时间戳推导，因此属于下界估计。示例笔记日期优先选用搜索结果原始 `published_at`。
- 当 `user --limit 20` 返回 20 条且全部落入窗口，数量记为 `>=20`，不把分页上限当作真实总量。

## 点评 12 个精确锚点：小红书同店匹配

| # | 点评锚点 | 状态 | 窗口内小红书证据 | 最近的可见关联证据与判断 |
|---:|---|---|---|---|
| 1 | 研色·烫染·漂发·巴黎画染（徐家汇） | `not_found` | 无可归属正样本 | 搜索到作者 `研色色彩salon` 的历史笔记[《巴黎画染》](https://www.xiaohongshu.com/search_result/68b56407000000001d018d4e)，`published_at=2025-09-01`、笔记 ID `68b56407000000001d018d4e`，已超窗。近期 `TR I` 是另一点评挂牌门店，不能合并。 |
| 2 | TIDA HAIR（中山公园） | `not_found` | 无 | 最接近结果为作者 `上海发型设计伊森` 的[《谁家好人把理发店开在25楼啊哈哈哈哈哈》](https://www.xiaohongshu.com/search_result/69e77ace000000001a02f1dc)，`published_at=2026-04-21`、ID `69e77ace000000001a02f1dc`；可见标题/作者没有 TIDA，且已超窗，不归属。 |
| 3 | 玫丽盼 MLP（新天地） | `not_found` | 无 | 作者 `我的主业是生活` 的[《新天地玫丽盼🍃染发·撸猫·喝茶》](https://www.xiaohongshu.com/search_result/69e766c9000000001e00c47f)，`published_at=2026-04-21`、ID `69e766c9000000001e00c47f`，是名称/商圈直接关联的历史探店，但不在窗口内。窗口内“玫丽盼”多为染发产品/其他城市，未归属。 |
| 4 | 御·nail（城西银泰） | `not_found` | 无 | 精确与变体查询均未出现同时包含品牌和分店的窗口内笔记；“城西银泰工作室转让”“粉金一下”等结果不含门店身份，不归属。 |
| 5 | AN NAIL（滨江天街） | `probable` | 作者 `AN NAIL·日式美甲美睫` 于 2026-07-15 发布[《这回真的给我美飞起了》](https://www.xiaohongshu.com/search_result/6a566868000000000f028a9f)，ID `6a566868000000000f028a9f` | `note` 原始结构确认作者、`#ANNAIL #杭州美甲`，29 赞、11 收藏；点评回查存在滨江天街、奥体、杭州店等多个分店，笔记没有分店字段，因此不能升级为同店 `matched`。 |
| 6 | Ellen.G（杭州火车东站） | `not_found` | 无 | `Ellen.G 美甲 杭州` 与 `Ellen G 杭州 火车东站 美甲` 查询没有出现品牌可见结果；窗口内泛杭州美甲内容不归属。 |
| 7 | 圣梦亲体美肤生活馆（成都天誉） | `not_found` | 无 | 作者 `温暖` 的[《周末给身体放个假｜圣梦亲体美肤生活馆》](https://www.xiaohongshu.com/search_result/69760a20000000000b00b633)，`published_at=2026-01-25`、ID `69760a20000000000b00b633`，品牌直接关联但超窗且标题不含天誉店。 |
| 8 | 优兰熹美容疗愈 SPA（成都天阔美地） | `probable` | 作者 `A优兰熹世梦` 于 2026-07-14 发布[《藏在闹市中的庭，优兰熹，治愈我的松驰时光》](https://www.xiaohongshu.com/search_result/6a55f769000000000803e806)，ID `6a55f769000000000803e806`；同作者 2026-07-11 另有品牌 13 年内容 | `note` 正文确认 `#优兰熹 #成都护肤 #庭院式SPA`，点评回查成都仅返回天阔美地店，但小红书正文没有地址/分店稳定标识，保守标为 `probable`。 |
| 9 | 秋和闺蜜美容养生 SPA 馆（成都泰安街） | `not_found` | 无 | 精确与短名查询没有出现品牌可见结果；“泰安街/成都 SPA”泛内容不归属。 |
| 10 | TurnOver28（深圳卓悦） | `not_found` | 无 | 标题直接出现品牌的历史样本为[《南山LDM分享 Turnover28》](https://www.xiaohongshu.com/search_result/684a40090000000012006ff7)，`published_at=2025-06-12`、ID `684a40090000000012006ff7`，已超窗；2026 年结果没有可见标题/作者稳定指向卓悦店。 |
| 11 | 华熙生物 QUADHA 夸迪皮肤管理（深圳） | `not_found` | 无 | 可见品牌门店历史样本[《华熙生物～夸迪实体店》](https://www.xiaohongshu.com/search_result/649e8d990000000013000047)，作者 `华熙生物.夸迪龙华体验店`，`published_at=2023-06-30`、ID `649e8d990000000013000047`。窗口内“夸迪”结果为产品/其他城市或行业新闻，不归属。 |
| 12 | HIKO SKIN 彦村（深圳福田） | `not_found` | 无 | 直接品牌历史样本[《要美不要痘，祛痘就找专业的HIKO SKIN 彦》](https://www.xiaohongshu.com/search_result/61c53b58000000000102c011)，作者 `小精灵探店`，`published_at=2021-12-24`、ID `61c53b58000000000102c011`，远超窗口。 |

## 抖音活跃候选反向回查

- 只读补查时段：2026-07-17 17:29:06–17:31:58 CST。
- 输入范围：仅反查 4 个抖音活跃候选，没有追加其他候选。
- 判断仍使用本文件的 `matched / probable / not_found` 规则；抖音活跃不自动等于小红书同店活跃。

| # | 抖音侧候选 | 状态 | 2026-06-18 至 2026-07-17 原始 `published_at` 正样本 | 稳定身份与判断 |
|---:|---|---|---|---|
| 1 | ALINECOOL / 上海浦江万达 / 坚隅美容美发 | `not_found` | 无可归属正样本 | 精确与“ALINECOOL 浦江万达”“坚隅美容美发 浦江万达”变体均未出现品牌/门店可见字段。2026-06-18 的[《我再也不相信什么男士理发馆了》](https://www.xiaohongshu.com/search_result/6a32db010000000011019be1)，作者 `哥斯拉の翔`、作者 ID `634691880000000018029891`、笔记 ID `6a32db010000000011019be1`；单篇正文只有泛“理发翻车”标签，没有 ALINECOOL、坚隅或浦江万达稳定标识，明确排除。 |
| 2 | 0127 上海日式美甲美睫 / 静安 | `probable` | 无；窗口内 2026-07-12 的[《上海千元美甲装修店天花板》](https://www.xiaohongshu.com/search_result/6a535d24000000001c027ba1)，作者 `伐想桑班哦`、作者 ID `556c0ab96b9f165dd3d8a975`、笔记 ID `6a535d24000000001c027ba1`，正文实际标注 `@Love Nail`，不是 0127，排除 | 历史关联笔记[《上海美甲｜给顾客用香奈儿护手霜的0127》](https://www.xiaohongshu.com/search_result/69646d04000000001a029420)，`published_at=2026-01-12`，作者 `泥巴电团`、作者 ID `5c24b9bd000000000702efb8`、笔记 ID `69646d04000000001a029420`。品牌词和上海一致，但没有静安分店或官方主体，故仅 `probable`。 |
| 3 | 圣梦亲体美肤生活馆会展店 / 成都 | `probable` | 2026-07-07 · [《按摩spa》](https://www.xiaohongshu.com/search_result/6a4d12ce000000000f0078d9) · 作者 `赵yy` · 作者 ID `5e47f5070000000001001143` · 笔记 ID `6a4d12ce000000000f0078d9`。单篇正文直接写“今天来圣梦体验”，标签含 `#成都美容店 #成都探店` | 品牌和城市成立，但正文未出现“会展店”、地址、电话或认证主体；不能把成都其他圣梦分店内容归到会展店。窗口外另见 2026-04-17 的交大店和 2026-01-25 的泛品牌内容。 |
| 4 | 玺妍娜专注问题肌肤 / 成都华阳 / 华阳玺颜美容中心 | `matched`（玺妍娜品牌与华阳位置）；别名待确认 | 无。精确作者最近可见结果为 2026-01-29，超出窗口 | [玺妍娜成分护肤](https://www.xiaohongshu.com/user/profile/60d04ebc0000000001008c44)，作者 ID `60d04ebc0000000001008c44`。历史笔记[《成都｜敏感肌修复｜私人定制护肤方案》](https://www.xiaohongshu.com/search_result/6800ca51000000001c035faa)，`published_at=2025-04-17`、笔记 ID `6800ca51000000001c035faa`；正文直接写“玺妍娜皮肤管理中心”，标签含 `#成都海昌路华阳探店`。这足以确认玺妍娜与成都华阳；但不能仅凭本轮结果确认“华阳玺颜美容中心”是同一挂牌别名。 |

### 本轮补查命令

以下为去除临时查询参数后的持久记录；`note` 实际读取时使用适配器当次返回的临时访问参数，但该参数不写入文件。

```bash
date -Iseconds
opencli --version
opencli xiaohongshu whoami -f json --window background --site-session persistent
opencli xiaohongshu search 'ALINECOOL 上海 浦江万达 坚隅美容美发' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search 'ALINECOOL 浦江万达' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '坚隅美容美发 浦江万达' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '0127 上海 日式美甲美睫 静安' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '0127美甲美睫 上海 静安' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '圣梦亲体美肤生活馆 会展店 成都' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '圣梦 会展店 成都 美肤' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '玺妍娜 专注问题肌肤 成都 华阳' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '华阳 玺颜 美容中心 成都' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '玺妍娜 华阳' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '玺颜美容中心 华阳' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '玺妍娜 问题肌肤' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/search_result/6a32db010000000011019be1' -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/search_result/6a535d24000000001c027ba1' -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/search_result/6a4d12ce000000000f0078d9' -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/search_result/6800ca51000000001c035faa' -f json --window background --site-session persistent
date -Iseconds
```

## 近 30 天发现层候选输入

任务标签：`①` 日常项目/服务曝光；`②` 有明确时令、节点、事件或本地机会的借势；`③` 品牌/个人 IP；`④` 促销、团购或体验招募；`⑤` 日常宣传物料制作。这些标签是账号级“至少出现一次”的发现线索，不是内容频率、行业占比或独立门店共性。

| # | 业态 / 城市 | 小红书作者与主页 | 近 30 天可见数 / 范围 | 原始 `published_at` 示例（标题 / ID） | 可观察任务 | 点评身份回查 |
|---:|---|---|---|---|---|---|
| 1 | 美发 / 上海 | [TR I 烫染·漂发·画染](https://www.xiaohongshu.com/user/profile/5bcf54a2e5d34700010c2ba5) · `5bcf54a2e5d34700010c2ba5` | 4 / 2026-06-21 | 2026-06-21 · [上海中年叛逆染发漂发一口价688米](https://www.xiaohongshu.com/search_result/6a38070c0000000011014f48) · `6a38070c0000000011014f48` | ①门店日常、染漂案例；③门店品牌；④一口价 | `matched` 到点评 [TR salon 烫染·漂发·巴黎画染](https://www.dianping.com/shop/EnwKWSumbxFak3PD)，徐家汇商圈；不是原“研色”锚点。 |
| 2 | 美发 / 杭州 | [杭州男士发型十一](https://www.xiaohongshu.com/user/profile/64e0b8d10000000001007a02) · `64e0b8d10000000001007a02` | 6 / 2026-06-22–07-16 | 2026-06-29 · [独属于短发的风格#美式前刺](https://www.xiaohongshu.com/search_result/6a42153b000000000803e8bd) · `6a42153b000000000803e8bd` | ①发型案例；②夏季（流行发色/前刺仅记风格）；③发型师个人 IP | `XHS-only`；点评精确检索未返回同名美发门店。 |
| 3 | 美发 / 成都 | [Tress&Tune 发型设计室](https://www.xiaohongshu.com/user/profile/66dda2a7000000001d023aed) · `66dda2a7000000001d023aed` | 8 / 2026-06-19–07-07 | 2026-06-25 · [不止剪发！这是一间美学创作工作室](https://www.xiaohongshu.com/search_result/6a3d02270000000008033e0f) · `6a3d02270000000008033e0f` | ①剪发/护理；②麓湖端午集市与本地场景；③创始人、音乐摄影空间 IP | `matched` 到点评 [Tress&Tune Studio发型设计（麓湖CPI店）](https://www.dianping.com/shop/H1BpUKEJ5Mits8d1)。 |
| 4 | 美发 / 深圳 | [TOPP1NG](https://www.xiaohongshu.com/user/profile/596e58cd5e87e7397f0147b9) · `596e58cd5e87e7397f0147b9` | 2 / 2026-06-24–07-17 | 2026-06-24 · [梳个背头｜只喜欢硬核BUZZ CUT](https://www.xiaohongshu.com/search_result/6a3b89df00000000080021ac) · `6a3b89df00000000080021ac` | ①男士发型；③男士理发馆 IP；“硬核”只作内容风格，不计时机借势 | `matched` 到点评 [TOPP1NG·barbershop男士复古理发馆](https://www.dianping.com/shop/EZUfvuuT5pUeaAvu)。 |
| 5 | 美甲美睫 / 上海 | [小椿禾·nail](https://www.xiaohongshu.com/user/profile/57e6f6fb6a6a690c51b752fc) · `57e6f6fb6a6a690c51b752fc` | 8 / 2026-07-13–07-16 | 2026-07-13 · [救命！上海宝藏美甲个人工作室被你发现](https://www.xiaohongshu.com/search_result/6a54aab8000000001700bbe5) · `6a54aab8000000001700bbe5` | ①款式/客照；②夏季（碎钻仅记款式）；③个人工作室定位 | `matched` 到点评 [小椿禾·nail](https://www.dianping.com/shop/Ha2zHNwi0qXKE5SK)，松江大学城。 |
| 6 | 美甲美睫 / 杭州 | [CoCoNaiL](https://www.xiaohongshu.com/user/profile/60dafc1b0000000001000d24) · `60dafc1b0000000001000d24` | `>=20` / 2026-06-18–07-17 | 2026-06-23 · [焕新启幕｜CoConail全面升级完成](https://www.xiaohongshu.com/search_result/6a3a52770000000008025f82) · `6a3a52770000000008025f82` | ①原创款式；②世界杯（童话/莫奈仅记风格，不计借势）；③品牌与教学；④五周年店庆 | `probable` 品牌：点评返回万象汇店、滨江店两店，账号没有分店字段。 |
| 7 | 美甲美睫 / 成都 | [Andylashes](https://www.xiaohongshu.com/user/profile/5db05a2a000000000100949c) · `5db05a2a000000000100949c` | 4 / 2026-07-01–07-17 | 2026-07-17 · [成都美睫｜欧美睫毛](https://www.xiaohongshu.com/search_result/6a59b497000000000f01fca3) · `6a59b497000000000f01fca3` | ①美睫款式；欧美/亚裔只作风格配方，不计时机借势 | `XHS-only`；点评精确检索未返回同名门店。 |
| 8 | 美甲美睫 / 杭州 | [AN NAIL·日式美甲美睫](https://www.xiaohongshu.com/user/profile/5b1e166ce8ac2b1170ff03b8) · `5b1e166ce8ac2b1170ff03b8` | `>=1` / 2026-07-15；`user` 主页读取返回空数组 | 2026-07-15 · [这回真的给我美飞起了](https://www.xiaohongshu.com/search_result/6a566868000000000f028a9f) · `6a566868000000000f028a9f` | ①长款/龙爪款式；“趋势款式”无独立来源，不计时机借势 | `probable` 到滨江天街店：品牌、城市一致，点评有多分店，笔记不含分店。 |
| 9 | 生活美容 / 杭州 | [THE PURI 璞悦·湖滨in77店](https://www.xiaohongshu.com/user/profile/6669a2cc0000000003033c3b) · `6669a2cc0000000003033c3b` | 8 / 2026-06-29–07-15 | 2026-07-08 · [西湖边私藏高端SPA｜躺平治愈所有疲惫](https://www.xiaohongshu.com/search_result/6a4e1ad2000000001700bd64) · `6a4e1ad2000000001700bd64` | ①SPA/肩颈内容；②台风、本地游湖场景；③品牌空间；④新店体验官招募 | `matched` 到点评 [THE PURI·璞悦·水疗按摩（湖滨in77店）](https://www.dianping.com/shop/H7RgNAkxxtfCwnXG)。 |
| 10 | 生活美容 / 成都 | [A优兰熹世梦](https://www.xiaohongshu.com/user/profile/5b67bafa69d6ce0001f8847c) · `5b67bafa69d6ce0001f8847c` | `>=2` / 2026-07-11–07-14；`user` 主页读取返回空数组 | 2026-07-14 · [藏在闹市中的庭，优兰熹，治愈我的松驰时光](https://www.xiaohongshu.com/search_result/6a55f769000000000803e806) · `6a55f769000000000803e806` | ①护肤/SPA体验；③品牌 13 年、主理人/团队、新中式庭院 IP | `probable` 到点评 [优兰熹美容疗愈SPA（天阔美地店）](https://www.dianping.com/shop/k2SmZ935p1tqG1e2)；笔记缺分店标识。 |
| 11 | 皮肤管理 / 成都 | [成都专研问题肌的林子](https://www.xiaohongshu.com/user/profile/5fd775db00000000010048b8) · `5fd775db00000000010048b8` | 3 / 2026-07-15–07-17 | 2026-07-15 · [开店8年，从中海国际门店搬到了工作室](https://www.xiaohongshu.com/search_result/6a572a13000000000f015380) · `6a572a13000000000f015380` | ①问题肌/安静护理体验；③八年店主身份；④邀请 20 位本地用户做客 | `XHS-only`；点评精确检索未返回同名门店。 |
| 12 | 皮肤管理 / 深圳 | [SMOOTH小室木·专注痘敏](https://www.xiaohongshu.com/user/profile/6352b3f20000000018029af7) · `6352b3f20000000018029af7` | `>=20` / 2026-06-26–07-17 | 2026-06-26 · [非常抱歉，目前我们团队真的出不了深圳](https://www.xiaohongshu.com/search_result/6a3e81470000000008026e9d) · `6a3e81470000000008026e9d` | ①痘敏案例/护理科普；③四店连锁、团队专业；④王牌护理团购 | `matched` 到点评同品牌深圳连锁；可见龙华、福田口岸、坂田、景田等店，单篇仍需分店级消歧。 |

### 发现账号线索汇总

| 线索 | 账号数 | 可复算范围 | 本轮用法 |
|---|---:|---|---|
| ① 日常项目/服务曝光 | 12/12 | #1–#12 | 发现层高覆盖线索；待正式门店样本与发帖频率复核。 |
| ② 节点/时令/事件/本地借势 | 5/12 | #2 夏季；#3 端午本地；#5 夏季；#6 世界杯；#9 台风/本地 | 只计有明确时机锚点的账号；#6 童话/莫奈及 #7/#8 款式仅是风格，不计借势。 |
| ③ 品牌/个人 IP | 10/12 | #1–#6、#9–#12 | 仅作身份资产类型的探索线索；不从其中选定前台字段或工作流。 |
| ④ 促销/团购/体验招募 | 5/12 | #1、#6、#9、#11、#12 | 仅作交易事实与有效期校验的探索线索，不代表转化效果。 |
| ⑤ 日常宣传物料制作 | 0/12 | 无稳定直接证据 | 不用普通笔记封面补数；需另建物料样本集。 |

> 口径边界：上表的分母是“12 个发现账号”，其中存在 `XHS-only`、`probable`、品牌级与多分店账号，不能改写成“12 家独立门店”或“美业行业占比”。

## 原始笔记结构抽样

`opencli xiaohongshu search` 原始可见列为 `rank / author / author_url / likes / title / published_at / url`；`note` 读取为 `field / value` 行。以下保留四种代表性任务的原始字段，不把正文之外的信息补写进去。

### 日常门店与项目曝光：TR salon

```yaml
title: TRsalon门店忙碌日常
author: TR I 烫染·漂发·画染
content: "#漂色发色 #混血发色 #漂发 #店里日常忙碌 #用心服务好每一位顾客 #我们的工作日常 #忙碌的早上 #忙碌并快乐着 #忙碌的周一 #忙碌而充实"
likes: "1"
collects: "0"
comments: "0"
note_id: 6a37f5aa000000001003e979
```

### 品牌活动：CoCoNaiL 五周年

```yaml
title: 夏韵鎏指·焕境新生2026五周年店庆
author: CoCoNaiL
content_visible: "五载匠心，秀领杭城。作为杭州首个举办美甲大秀的原创品牌……18位超模联袂演绎……"
tags: "#杭州日式美甲, #美甲教学培训, #婚礼美甲, #开业, #美甲店, #周年庆, #指尖的艺术"
likes: "34"
collects: "1"
comments: "0"
note_id: 6a339c510000000008026c57
```

### 新店体验招募：THE PURI

```yaml
title: 在in77遇见疗愈｜璞悦SPA杭州体验官招募中
author: THE PURI 璞悦·湖滨in77店
content_visible: "6月30日盛大启幕……坐标杭州湖滨银泰in77商圈核心位置……小红书粉丝3000+/大众点评6-8级用户……"
tags: "#杭州SPA, #THEPURI璞悦, #杭州探店, #杭州in77, #新店招募, #体验官招募"
likes: "78"
collects: "53"
comments: "159"
note_id: 6a4207f60000000011006c18
```

### 团购承接：SMOOTH 小室木

```yaml
title: 透明消费｜王牌护理团购上线
author: SMOOTH小室木·专注痘敏
content_visible: "拒绝套路｜王牌项目团购全程透明 标价即实价，无隐形消费……到店不加价……美团或大众后台私"
likes: "4"
collects: "0"
comments: "0"
note_id: 6a549b36000000002103fbfd
```

## 发现层共性与待验证产品假设

### 本文可支持的发现层共性

1. 12/12 账号都有项目、服务或效果案例的可见线索；这是“日常项目/服务曝光值得进入正式复核”，不是行业频率结论。
2. 五类账号级线索可复算为 `12/12、5/12、10/12、5/12、0/12`；个人/`IP`、促销和物料仍只是探索输入。
3. 节点借势只计 #2 夏季、#3 端午本地、#5 夏季、#6 世界杯、#9 台风/本地，共 5/12；童话、莫奈、欧美/亚裔及普通款式均不擅自扩成节点。
4. 账号可同时出现多类任务线索，但单账号的组合不能用来决定产品信息架构。
5. 促销/团购/体验招募只能确认公开表达存在，不能据此推断库存、核销、预约、到店或转化。
6. `⑤宣传物料制作` 为 0/12 稳定直接证据；需另建价目表、项目卡、店庆海报、团购长图、到店指引、节日门贴和朋友圈物料样本集。
7. 跨平台身份必须按品牌、城市、分店、地址、电话尾号、点评 shop ID 和平台 user ID 做可解释复核；本轮候选集中的 `XHS-only`、`probable` 和品牌级对象均不充当分店级共性样本。

### D 级待验证产品假设

- `D-XHS-01`：前台可能更适合从“本周值得宣传的经营任务”进入，而非先选图文/视频工具；必须与目标起步、素材起步、历史做同款和成品起步原型对比。
- `D-XHS-02`：Agent 可能应根据已核验的身份、项目、服务、门店、时机与交易事实组合一个完整主推荐，再允许快捷纠偏；本文不决定具体控件、字段、选项数或工作流。
- `D-XHS-03`：个人 IP、品牌 IP 与多分店身份可能需要分层资产，而不是一套通用“品牌语气”；字段和优先级需通过正式任务重放验证。
- `D-XHS-04`：促销与节点内容的 Agent 输出可能需要事实、渠道和有效期校验；触发时机、阻断强度和人工确认方式待任务测试。

## 证据边界与适配器限制

### 本轮可以确认

- 搜索时点公开返回的作者名、作者 ID/主页 URL、标题、`published_at`、笔记 ID/URL；
- `user` 返回的公开笔记列表、标题、类型、点赞展示值与 URL；
- `note` 返回的正文、标签以及当时可见点赞/收藏/评论数；
- 点评只读搜索返回的挂牌名称、商圈、shop ID，可用于身份交叉检查；
- 哪些宣发任务在标题/正文中直接出现。

### 本轮不能确认

- 账号是否由门店、员工、代运营或第三方共同管理；未见官方认证主体时不写“官方账号”；
- 点评分店与没有地址字段的小红书品牌账号是否为同一具体分店；
- 搜索/主页是否返回全部笔记，删除、隐藏、限流或分页内容均不可见；
- 笔记 ID 时间戳是否等同平台最终发布时间；它只用于主页结果的范围估算，不能覆盖搜索原始 `published_at`；
- 点赞、收藏、评论是否来自自然流量，亦不能从互动推断内容质量、咨询、预约、买券、核销或到店；
- 正文中的价格、团购、营业、服务效果是否仍有效；必须回到门店/交易系统核验；
- 普通笔记封面是否属于门店可复用的宣传物料资产。

### 登录与失败记录

- `opencli auth status` 与 `opencli xiaohongshu whoami` 均确认登录态可读；账号名不写入研究文件。
- `AN NAIL·日式美甲美睫`、`A优兰熹世梦` 的 `user` 命令返回空数组，但搜索结果和单篇 `note` 可读；因此只写搜索可见下界，不把空数组解释为没有其他内容。
- 搜索结果相关性会混入同名产品、其他城市和泛商圈内容；本文件逐条降级或排除，没有用搜索排名替代身份判断。

## 原始命令记录

下列命令均在 `/Users/bin/Desktop/开发/内容无人区/美业内容2` 执行。小红书和点评命令统一使用后台窗口与持久站点会话；所有命令均为只读。

### 适配器、版本与登录态

```bash
command -v opencli
opencli --help
opencli xiaohongshu --help -f yaml
opencli auth status
opencli xiaohongshu whoami -f json --window background --site-session persistent
opencli --version
date -Iseconds
```

### 城市 × 业态发现

```bash
opencli xiaohongshu search '上海 美发工作室 染发' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '上海 美甲美睫 工作室' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '上海 皮肤管理 门店' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '杭州 美发 工作室' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '杭州 美甲美睫 店' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '杭州 生活美容 门店' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '成都 美发 沙龙' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '成都 美甲美睫 工作室' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '成都 皮肤管理 门店' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '深圳 美发 沙龙' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '深圳 美甲美睫 工作室' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '深圳 生活美容 皮肤管理' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '上海 皮肤管理 工作室 日常' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '上海 美甲 工作室 客照' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '杭州 美发 发型师 客照' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '杭州 美甲 店 新款' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '成都 美发 发型师 客照' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '成都 美睫 店 客照' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '成都 皮肤管理 工作室 日常' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '深圳 美发 发型师 客照' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '上海 美容院 门店 日常' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '杭州 美容院 身体护理' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '成都 美容院 养生 SPA' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '深圳 美容院 身体护理' --limit 15 -f json --window background --site-session persistent
```

### 点评锚点精确检索与回退检索

```bash
opencli xiaohongshu search '研色 烫染 漂发 巴黎画染 徐家汇' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search 'TIDA HAIR 中山公园' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '玫丽盼 MLP 新天地' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '御 nail 城西银泰' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search 'AN NAIL 滨江天街' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search 'Ellen.G 杭州火车东站' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '圣梦亲体美肤生活馆 成都天誉' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '优兰熹 美容 疗愈 SPA 成都 天阔美地' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '秋和闺蜜 美容 养生 SPA 成都 泰安街' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search 'TurnOver28 深圳 卓悦' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '华熙生物 QUADHA 夸迪 皮肤管理 深圳' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search 'HIKO SKIN 彦村 深圳 福田' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '研色 徐家汇' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search 'TIDA HAIR' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search 'TIDA 中山公园 美发' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search 'MLP 新天地 美发' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '玫丽盼 新天地 美发' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '御nail 杭州' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search 'ANNAIL 杭州' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search 'AN NAIL 杭州 美甲' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search 'Ellen.G 美甲 杭州' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search 'Ellen G 杭州 火车东站 美甲' --limit 15 -f json --window background --site-session persistent
opencli xiaohongshu search '圣梦 天誉 美容 成都' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '优兰熹 天阔美地' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '秋和闺蜜 泰安街' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search 'TurnOver28 深圳' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search '夸迪 深圳 皮肤管理' --limit 10 -f json --window background --site-session persistent
opencli xiaohongshu search 'HIKO SKIN 深圳' --limit 10 -f json --window background --site-session persistent
```

### 候选主页与单篇读取

```bash
opencli xiaohongshu user '5bcf54a2e5d34700010c2ba5' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '57e6f6fb6a6a690c51b752fc' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '64e0b8d10000000001007a02' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '67ab9898000000000e01c9af' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '60dafc1b0000000001000d24' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '5fd775db00000000010048b8' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '67442153000000001c01bd0e' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '66dda2a7000000001d023aed' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '5db05a2a000000000100949c' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '65adaff100000000140042cd' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '6352b3f20000000018029af7' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '596e58cd5e87e7397f0147b9' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '6669a2cc0000000003033c3b' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '5b1e166ce8ac2b1170ff03b8' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu user '5b67bafa69d6ce0001f8847c' --limit 20 -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/user/profile/5bcf54a2e5d34700010c2ba5/6a37f5aa000000001003e979' -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/user/profile/60dafc1b0000000001000d24/6a339c510000000008026c57' -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/user/profile/6669a2cc0000000003033c3b/6a4207f60000000011006c18' -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/user/profile/6352b3f20000000018029af7/6a549b36000000002103fbfd' -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/search_result/6a566868000000000f028a9f' -f json --window background --site-session persistent
opencli xiaohongshu note 'https://www.xiaohongshu.com/search_result/6a55f769000000000803e806' -f json --window background --site-session persistent
```

### 活跃样本的点评只读回查

```bash
opencli dianping search 'TR salon 烫染' --city '上海' --limit 5 -f json --window background --site-session persistent
opencli dianping search '小椿禾 nail' --city '上海' --limit 5 -f json --window background --site-session persistent
opencli dianping search '男士发型十一' --city '杭州' --limit 5 -f json --window background --site-session persistent
opencli dianping search 'CoCoNaiL' --city '杭州' --limit 5 -f json --window background --site-session persistent
opencli dianping search 'THE PURI 璞悦' --city '杭州' --limit 5 -f json --window background --site-session persistent
opencli dianping search '优兰熹' --city '成都' --limit 5 -f json --window background --site-session persistent
opencli dianping search '林子 问题肌' --city '成都' --limit 5 -f json --window background --site-session persistent
opencli dianping search 'Tress&Tune' --city '成都' --limit 5 -f json --window background --site-session persistent
opencli dianping search 'Andylashes 美睫' --city '成都' --limit 5 -f json --window background --site-session persistent
opencli dianping search 'SMOOTH 小室木' --city '深圳' --limit 5 -f json --window background --site-session persistent
opencli dianping search 'TOPP1NG 美发' --city '深圳' --limit 5 -f json --window background --site-session persistent
opencli dianping search 'AN NAIL' --city '杭州' --limit 5 -f json --window background --site-session persistent
```
