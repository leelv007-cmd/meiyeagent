# 大众点评候选门店发现

- 抓取窗口：2026-07-17 17:03:36–17:06:20 CST（Asia/Shanghai）
- 抖音活跃候选反向回查窗口：2026-07-17 17:27:03–17:28:13 CST（Asia/Shanghai）
- 抓取方式：OpenCLI `dianping` 专用适配，复用本机已登录浏览器会话
- 访问范围：仅执行 `whoami`、`search`、`shop` 及只读诊断；未执行登录、收藏、下单、评价、关注或发布
- 发现目标：为抖音、小红书、大众点评的后续跨平台匹配，提供 8–12 家名称可精确检索、公开经营信息较完整的门店锚点
- 样本性质：候选发现集，不是行业榜单，也不是经营效果、内容质量或投放效果判断

## 结论摘要

本轮保留 12 家候选，覆盖上海美发、杭州美甲美睫、成都生活美容、深圳皮肤管理四个业态切片。所有候选都能由大众点评公开列表和详情接口交叉得到门店 ID、精确名称、评分、评论量、客单参考、商圈或地址与营业时间；其中 11 家的挂牌名称直接带有服务词，适合作为抖音、小红书的精确检索锚点。

OpenCLI 当前 `shop` 输出不包含项目菜单或团购券字段。因此，表中的“服务事实”只采用挂牌名称与点评类目中显式出现的词；“团购”一律标记为本轮不可见，不能据此推断门店没有团购。后续跨平台任务应使用“品牌/门店精确名 + 分店/商圈 + 显式服务词”检索，再以平台账号主页或商品页完成同店匹配。

## 证据等级

- `S1`：服务词同时出现在精确挂牌名称与搜索命中的类目/查询语境中，可作为公开服务定位证据。
- `S0`：只确认到较宽泛的挂牌服务词或点评类目，不能外推具体项目、技术、功效或价格。
- `G?`：适配器未返回团购/套餐字段；状态是“未观察到”，不是“没有”。
- 评分、评论数与客单参考均为抓取时点快照；搜索页评分粒度较粗，候选表统一采用随后 `shop` 详情返回值。

## 候选门店

| # | 业态 | 城市 / 商圈 | 大众点评门店与证据 | 评分 / 评论 / 客单参考 | 项目、服务、团购可见性 | 推荐跨平台精确锚点 |
|---:|---|---|---|---|---|---|
| 1 | 美发 | 上海 / 徐家汇 | [研色·烫染·漂发·巴黎画染（徐家汇店）](https://www.dianping.com/shop/k5aOEXXZ1YL2N032) · `k5aOEXXZ1YL2N032` | 4.9 / 3,228 / ¥655 | `S1`：挂牌明确“烫染、漂发、巴黎画染”；类目为美发。`G?` | `"研色·烫染·漂发·巴黎画染" "徐家汇"` |
| 2 | 美发 | 上海 / 中山公园 | [TIDA HAIR 烫发 染发 漂发（中山公园店）](https://www.dianping.com/shop/k8iUkB72wSTOAFQ1) · `k8iUkB72wSTOAFQ1` | 4.8 / 1,251 / ¥111 | `S1`：挂牌明确“烫发、染发、漂发”；类目为美发。`G?` | `"TIDA HAIR" "中山公园" 烫发 染发 漂发` |
| 3 | 美发 | 上海 / 新天地、马当路 | [玫丽盼 MLP·专业染护沙龙（新天地店）](https://www.dianping.com/shop/G2X2LJmPLnY3Qa55) · `G2X2LJmPLnY3Qa55` | 4.8 / 686 / ¥613 | `S1`：挂牌明确“专业染护沙龙”；类目为美发。不能由名称外推具体染护产品。`G?` | `"玫丽盼MLP" "新天地" 专业染护` |
| 4 | 美甲美睫 | 杭州 / 城西银泰 | [御·nail 日式美甲美睫（城西银泰店）](https://www.dianping.com/shop/l8YoN7eNe7RmM1Vd) · `l8YoN7eNe7RmM1Vd` | 4.9 / 1,418 / ¥447 | `S1`：挂牌明确“日式美甲美睫”；类目为美甲。`G?` | `"御·nail" "城西银泰" 日式美甲美睫` |
| 5 | 美甲美睫 | 杭州 / 滨江天街 | [AN NAIL·日式美甲美睫專門店（滨江天街店）](https://www.dianping.com/shop/Ga56Z70x3GMzeXSx) · `Ga56Z70x3GMzeXSx` | 4.6 / 1,754 / ¥407 | `S1`：挂牌明确“日式美甲美睫”；类目为美甲。`G?` | `"AN NAIL" "滨江天街" 日式美甲美睫` |
| 6 | 美甲美睫 | 杭州 / 火车东站、城东 | [Ellen.G 日式美甲美睫美肤（火车东站店）](https://www.dianping.com/shop/G9LVYuHQmgRwVDsh) · `G9LVYuHQmgRwVDsh` | 4.7 / 1,043 / ¥203 | `S1`：挂牌明确“日式美甲、美睫、美肤”，详情地址文本还出现“肌肤管理”；搜索类目仍为美甲。不能外推具体美肤项目。`G?` | `"Ellen.G" "杭州火车东站" 日式美甲美睫美肤` |
| 7 | 生活美容 | 成都 / 锦东、东大路 | [圣梦亲体美肤生活馆（天誉店）](https://www.dianping.com/shop/l9axBpJGEUSRFK04) · `l9axBpJGEUSRFK04` | 4.7 / 684 / ¥130 | `S0`：挂牌只确认“亲体美肤生活馆”，搜索类目为 SPA 美体；没有具体项目词。`G?` | `"圣梦亲体美肤生活馆" "成都天誉店"` |
| 8 | 生活美容 | 成都 / 郫筒 | [优兰熹美容疗愈 SPA（天阔美地店）](https://www.dianping.com/shop/k2SmZ935p1tqG1e2) · `k2SmZ935p1tqG1e2` | 3.9 / 86 / ¥164 | `S1`：挂牌明确“美容疗愈 SPA”，搜索类目为 SPA 美体；“疗愈”仅是挂牌用语，不构成效果证据。`G?` | `"优兰熹美容疗愈SPA" "成都天阔美地"` |
| 9 | 生活美容 | 成都 / 财富又一城、泰安街 | [秋和闺蜜美容养生 SPA 馆（泰安街店）](https://www.dianping.com/shop/k3P5DsDVEznd4SAN) · `k3P5DsDVEznd4SAN` | 4.2 / 182 / ¥96 | `S1`：挂牌明确“美容养生 SPA”，搜索类目为皮肤管理；不能外推功效或具体项目。`G?` | `"秋和闺蜜美容养生SPA馆" "成都泰安街"` |
| 10 | 皮肤管理 | 深圳 / 福田中心、岗厦 | [TurnOver28 韩国专业皮肤&头皮管理（卓悦店）](https://www.dianping.com/shop/H5sdJyonhvZMhahF) · `H5sdJyonhvZMhahF` | 4.8 / 748 / ¥487 | `S1`：挂牌明确“皮肤管理、头皮管理”；类目为皮肤管理。“韩国专业”仅是挂牌定位。`G?` | `"TurnOver28" "深圳卓悦" 皮肤 头皮管理` |
| 11 | 皮肤管理 | 深圳 / 沙头、上沙 | [华熙生物 QUADHA 夸迪皮肤管理（深圳店）](https://www.dianping.com/shop/Gaqcxa5IA5W1Dsxl) · `Gaqcxa5IA5W1Dsxl` | 4.5 / 3,657 / ¥153 | `S1`：挂牌明确品牌与“皮肤管理”；类目为皮肤管理。不能由品牌名推断门店授权范围或使用产品。`G?` | `"华熙生物QUADHA夸迪皮肤管理" "深圳"` |
| 12 | 皮肤管理 | 深圳 / 购物公园、会展中心 | [HIKO SKIN 彦村·敏感肌肤护理中心（福田店）](https://www.dianping.com/shop/l7qSHHW39aTe7OCI) · `l7qSHHW39aTe7OCI` | 4.7 / 2,181 / ¥185 | `S1`：挂牌明确“敏感肌肤护理”，精确查询返回类目为祛痘；两者只能作为平台分类/挂牌事实，不能合并成疗效结论。`G?` | `"HIKO SKIN彦村" "深圳福田" 敏感肌肤护理` |

## 抖音活跃候选反向回查

本节只回答“已在抖音侧发现的活跃候选，能否在大众点评找到稳定门店锚点”。抖音活跃状态和认证主体来自上游候选信息，本轮没有回抓或复核抖音；匹配结论只基于大众点评 `search` 与 `shop` 的公开返回值。

状态定义：

- `matched`：辨识度较高的名称与分店/地点同时一致，且详情页给出稳定 `shop_id` 和地址。
- `probable`：品牌词与地点强相关，但名称写法或认证主体无法由大众点评适配器闭环确认。
- `not_found`：多组精确与拆分查询仍没有相关的稳定门店结果。

| 抖音侧候选输入 | 回查状态 | 大众点评稳定锚点 | 分店与地址证据 | 证据边界 |
|---|---|---|---|---|
| `ALINECOOL` / 上海浦江万达 / 认证主体“坚隅美容美发” | `probable` | [ALINE造型（浦江万达店）](https://www.dianping.com/shop/G5KK2IEI2iVwLDfK) · `G5KK2IEI2iVwLDfK` | 搜索商圈为浦江镇；详情地址为“万达广场3楼3028室”，营业时间 10:00–20:30 | 地点与 `ALINE` 名称词根吻合；但 `ALINECOOL` 精确查询只返回静安、长宁的 `ALINE造型` 分店，认证主体查询没有相关结果。大众点评未返回企业主体，故不能升级为 `matched`，也不能把其他 `ALINE` 分店并入该店。 |
| `0127 上海日式美甲美睫` / 静安 | `matched` | [0127ネイル日式美甲美睫（西苏州路店）](https://www.dianping.com/shop/l5hWFglCtgZdtQWH) · `l5hWFglCtgZdtQWH` | 精确命中西苏州路店；详情地址为“西苏州路71号办公楼七楼701电梯口”，距汉中路站 4 口步行 730m，营业时间 10:00–21:00 | 独特数字品牌、服务词和上海分店位置一致。适配器没有返回行政区或主体字段，因此只做门店级匹配，不补写认证主体。 |
| `圣梦亲体美肤生活馆（会展店）` / 成都 | `matched` | [圣梦亲体美肤生活馆（会展店）](https://www.dianping.com/shop/G3kMs1FuDgobAQ76) · `G3kMs1FuDgobAQ76` | 名称与“会展店”精确一致；详情地址为“金沙北一路80号现代城7-109号”，距沙湾站 A1 口步行 310m，营业时间 09:00–20:00 | 这是会展店，不是基准表中的[圣梦天誉店](https://www.dianping.com/shop/l9axBpJGEUSRFK04)。两店 `shop_id`、地址均不同，必须保留为独立门店，不因同品牌合并。 |
| `玺妍娜专注问题肌肤` / 成都华阳 / 认证主体“华阳玺颜美容中心” | `matched` | [玺妍娜皮肤管理·专注问题肌（三利广场店）](https://www.dianping.com/shop/l5OUQiNKhSbePga0) · `l5OUQiNKhSbePga0` | 搜索商圈为华阳；详情地址为“华阳街道天府大道南段2034号3幢10层1024号”，营业时间 10:00–21:00 | 独特品牌、服务定位与华阳地点同时一致，可做门店级匹配。大众点评未返回企业主体，不能据此确认“华阳玺颜美容中心”与该 `shop_id` 的法律主体关系。 |

回查结论：3 家达到门店级 `matched`，1 家为 `probable`，0 家为 `not_found`。其中 `ALINECOOL` 仍需要地址、电话尾号或认证主体与大众点评门店的第二稳定标识，才能作为确定的同店样本；其余三家可以优先进入后续内容样本抓取，但仍需在内容平台保留分店字段。

### 最终候选的福田口岸分店复核

2026-07-17 17:30:53 CST 追加执行：

```bash
opencli dianping search 'SMOOTH 小室木 福田口岸' --city 深圳 --limit 10 -f json --window background --site-session persistent
```

结果精确返回 [SMOOTH小室木·专注痘敏（福田口岸店）](https://www.dianping.com/shop/G9fMPeVBToEMHgVz) · `G9fMPeVBToEMHgVz`，类目“皮肤管理”，商圈“皇岗/水围”，抓取时评分 4.5、评论 715、客单参考 ¥235。该名称、城市和分店与抖音“福田口岸”账号一致，可以作为门店级 `matched`；小红书仍是深圳连锁品牌级内容，不能自动写入该分店事实。

### 反向回查原始命令

```bash
date '+%Y-%m-%d %H:%M:%S %Z'
opencli dianping search 'ALINECOOL 浦江万达' --city 上海 --limit 15 -f json --window background --site-session persistent
opencli dianping search '0127 日式美甲美睫' --city 上海 --limit 15 -f json --window background --site-session persistent
opencli dianping search '圣梦亲体美肤生活馆 会展店' --city 成都 --limit 15 -f json --window background --site-session persistent
opencli dianping search '玺妍娜 问题肌肤' --city 成都 --limit 15 -f json --window background --site-session persistent
opencli dianping search 'ALINECOOL' --city 上海 --limit 15 -f json --window background --site-session persistent
opencli dianping search 'ALINE COOL 美发' --city 上海 --limit 15 -f json --window background --site-session persistent
opencli dianping search '坚隅美容美发' --city 上海 --limit 15 -f json --window background --site-session persistent
opencli dianping search '浦江万达 美容美发' --city 上海 --limit 15 -f json --window background --site-session persistent
opencli dianping shop 'G5KK2IEI2iVwLDfK' -f yaml --window background --site-session persistent
opencli dianping shop 'l5hWFglCtgZdtQWH' -f yaml --window background --site-session persistent
opencli dianping shop 'G3kMs1FuDgobAQ76' -f yaml --window background --site-session persistent
opencli dianping shop 'l5OUQiNKhSbePga0' -f yaml --window background --site-session persistent
date '+%Y-%m-%d %H:%M:%S %Z'
```

## 为什么保留这 12 家

1. 四城四业态各保留 3 家，避免用单一城市或单一高客单模型代替整个美业。
2. 优先保留精确名称中自带服务词的门店，方便其他平台用名称、商圈和服务词进行同店消歧。
3. 样本同时覆盖工作室/单店、连锁分店、品牌型门店，以及约 ¥96–¥655 的客单参考区间，适合观察不同经营资产如何进入宣发内容。
4. 没有把搜索排名当作质量排名；高评论量只是公开信息丰富度的弱代理。
5. 成都样本的评分与评论量整体弱于其他三城，仍保留是为了避免生活美容业态缺席；后续跨平台若无法确认活跃账号，应允许替换，不把本名单冻结为正式样本。

## 后续跨平台匹配规则

每家门店先用表中的精确锚点搜索，再同时满足以下至少两项，才标为“高置信同店”：

- 平台账号或商品页的完整门店/品牌名一致；
- 城市、分店或商圈一致；
- 地址、电话尾号、官方认证主体等稳定标识一致；
- 服务定位与点评挂牌相符，且没有明显城市/分店冲突。

只有名称相似、达人探店提及或同品牌异店时，标为“关联内容”，不能并入门店自有账号样本。平台内容的播放、点赞、收藏、销量、团购价格与到店结果，必须记录抓取时间和来源，不能从大众点评评分或评论量推断。

## 证据边界与适配器限制

### 本轮可以确认

- 大众点评公开返回的 `shop_id`、精确挂牌名称、URL；
- 抓取时点的评分、评论量、客单参考；
- 搜索返回的类目、商圈，以及详情返回的地址、营业时间、服务/环境分；
- 挂牌名称中原样出现的服务词。

### 本轮不能确认

- 具体项目菜单、项目单价、团购套餐、券有效期、库存和可预约状态；
- 门店是否经营某个未写入挂牌名的服务；
- 大众点评账号与抖音、小红书账号的主体归属；
- 公开内容是否由门店、员工、达人或代运营创作；
- 某条内容是否带来咨询、预约、核销或到店；
- 评分、评论与客单参考是否能代表真实经营质量。

### 登录态诊断

`opencli auth status` 把 `dianping` 标记为 `logged_in: true`，随后 `search` 与 `shop` 都正常返回结构化结果。单独执行 `whoami` 时，适配器报告：

> Dianping member page rendered but no user_id link found — stale dper or layout drift

因此只能确认登录会话足以读取搜索/详情，不能确认当前账号 ID；没有为修复身份读取而触发重新登录。

## 原始命令记录

下列命令均在 `/Users/bin/Desktop/开发/内容无人区/美业内容2` 执行。为了复现浏览器登录态，点评命令统一使用后台窗口和持久站点会话。

### 适配器与登录态检查

```bash
date '+%Y-%m-%d %H:%M:%S %Z'
agent-reach doctor --json
command -v opencli
opencli --help
opencli -V
opencli auth status
opencli dianping --help -f yaml
opencli dianping whoami -f yaml --window background --site-session persistent
```

其中 `agent-reach doctor --json` 在本机返回 `command not found`，随后按其 OpenCLI 后端规则直接使用 `/usr/local/bin/opencli` 1.8.6。

### 首轮城市/业态发现

```bash
opencli dianping search '美发' --city 上海 --limit 12 -f json --window background --site-session persistent
opencli dianping search '美甲美睫' --city 杭州 --limit 12 -f json --window background --site-session persistent
opencli dianping search '生活美容' --city 成都 --limit 12 -f json --window background --site-session persistent
opencli dianping search '皮肤管理' --city 深圳 --limit 12 -f json --window background --site-session persistent
```

### 服务词复核

```bash
opencli dianping search '烫染' --city 上海 --limit 10 -f json --window background --site-session persistent
opencli dianping search '日式美甲 美睫' --city 杭州 --limit 10 -f json --window background --site-session persistent
opencli dianping search 'SPA美体 生活美容' --city 成都 --limit 10 -f json --window background --site-session persistent
opencli dianping search '敏感肌 皮肤管理' --city 深圳 --limit 10 -f json --window background --site-session persistent
```

### 候选详情核验

```bash
opencli dianping shop 'k63N1icpWB5r7iWY' -f yaml --window background --site-session persistent
opencli dianping shop 'H4vmYgonJDMmVsqj' -f yaml --window background --site-session persistent
opencli dianping shop 'H5RvWLem3gonp8Sf' -f yaml --window background --site-session persistent
opencli dianping shop 'l8YoN7eNe7RmM1Vd' -f yaml --window background --site-session persistent
opencli dianping shop 'k2WZwssMfqlgGDhB' -f yaml --window background --site-session persistent
opencli dianping shop 'G3b10ZHXUnm5Tv3s' -f yaml --window background --site-session persistent
opencli dianping shop 'jdaIdibL1Oi0QNFQ' -f yaml --window background --site-session persistent
opencli dianping shop 'l9axBpJGEUSRFK04' -f yaml --window background --site-session persistent
opencli dianping shop 'G39wdRp9RCJdauMd' -f yaml --window background --site-session persistent
opencli dianping shop 'H5sdJyonhvZMhahF' -f yaml --window background --site-session persistent
opencli dianping shop 'Gaqcxa5IA5W1Dsxl' -f yaml --window background --site-session persistent
opencli dianping shop 'l7qSHHW39aTe7OCI' -f yaml --window background --site-session persistent
opencli dianping shop 'k5aOEXXZ1YL2N032' -f yaml --window background --site-session persistent
opencli dianping shop 'k8iUkB72wSTOAFQ1' -f yaml --window background --site-session persistent
opencli dianping shop 'G2X2LJmPLnY3Qa55' -f yaml --window background --site-session persistent
opencli dianping shop 'Ga56Z70x3GMzeXSx' -f yaml --window background --site-session persistent
opencli dianping shop 'G9LVYuHQmgRwVDsh' -f yaml --window background --site-session persistent
opencli dianping shop 'k2SmZ935p1tqG1e2' -f yaml --window background --site-session persistent
opencli dianping shop 'k3P5DsDVEznd4SAN' -f yaml --window background --site-session persistent
```

未进入最终 12 家的详情核验仍保留在命令记录中，便于复核候选取舍。
