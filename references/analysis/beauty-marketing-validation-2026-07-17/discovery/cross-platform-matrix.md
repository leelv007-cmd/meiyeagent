# 12 个活跃候选的跨平台核身矩阵

- 抓取日期：2026-07-17（Asia/Shanghai）。抖音查询时段：`2026-07-17T17:23:44+08:00`–`2026-07-17T17:26:25+08:00`。
- 固定候选：仅使用 [`xiaohongshu.md`](./xiaohongshu.md)“近 30 天活跃替代样本”的 12 个账号，不扩样。
- 平台范围：小红书、大众点评、抖音。按用户决定，本轮取消美团调研。
- 工具：OpenCLI `1.8.6`；抖音使用 `douyin search` 专用只读适配并复用已登录持久会话。
- 操作边界：只执行帮助、版本、登录态检查、日期和关键词搜索；未执行关注、点赞、评论、私信、发布、删除或登录操作。
- 用途：做候选门店身份核对与第一轮 corpus 资格分层，不判断门店经营质量，不推断内容带来到店或交易的因果结果。

## 核身口径

### 抖音状态

- `matched`：结果可见字段同时给出同一品牌与城市或唯一分店/商圈，且没有冲突信息。
- `probable`：品牌与城市一致，但多分店情况下缺少分店标识，不能落到同一具体门店。
- `not_found`：exact 与 variant 两次查询均没有满足上述稳定条件的结果。相似名称、同名个人、搜索词命中、作者自称“官方号”都不能单独完成核身。

### 时间与证据边界

- 小红书日期沿用专用适配器原始 `published_at`，主页与笔记链接沿用原发现文件。
- 抖音 `search` 返回作者、正文摘要、互动展示值与视频 URL，但**不返回平台官方发布日期**。因此本文件不把任何抖音结果写成“近 30 天作品”，也不以 `aweme_id` 推算时间或把推算结果升级成 A 级证据。
- 表内仅保留无 token 的稳定视频 URL / `aweme_id`；不保存登录信息、签名参数、下载地址或临时接口字段。
- 大众点评状态与链接直接复用原文件的只读回查结果，没有重复抓取，也没有借公开信息推断账号归属组织。

## 结论摘要

抖音核身结果为 `4 matched / 1 probable / 7 not_found`：

- 三平台身份匹配最完整：`Tress&Tune`、`TOPP1NG`、`THE PURI 璞悦·湖滨in77店`、`SMOOTH 小室木`；此处只统计身份，后续日期复核显示 SMOOTH 分店内容超窗，不属于窗口内内容候选。
- 抖音可确认品牌与城市、但不能落分店：`CoCoNaiL`。
- `TR`、`杭州男士发型十一`、`小椿禾`的抖音结果虽有相似名称，但缺少城市/分店或共享品牌，全部保守记为 `not_found`，没有因同名合并。
- `Andylashes`、`AN NAIL`、`优兰熹`、`成都专研问题肌的林子`未发现满足稳定核身条件的抖音结果。

## 12 候选矩阵

| # | 固定候选 | 小红书 user / note 证据 | 点评回查 | 抖音核身 | 抖音稳定证据与匹配理由 | 第一轮 corpus 状态 |
|---:|---|---|---|---|---|---|
| 1 | TR I 烫染·漂发·画染（上海） | [user `5bcf54a2e5d34700010c2ba5`](https://www.xiaohongshu.com/user/profile/5bcf54a2e5d34700010c2ba5)；2026-06-21 [note `6a38070c0000000011014f48`](https://www.xiaohongshu.com/search_result/6a38070c0000000011014f48) | `matched`：[TR salon（徐家汇商圈）](https://www.dianping.com/shop/EnwKWSumbxFak3PD) | `not_found` | [视频 `7662927457641039598`](https://www.douyin.com/video/7662927457641039598) 的作者仅显示“TR 美发工作室 Carl”，可见字段没有上海/徐家汇；另一个 `TR.SAlon` 结果出现深圳语义，不能合并。 | **纳入**：XHS+DP 已完成门店锚定；抖音留空，不影响两平台任务样本。 |
| 2 | 杭州男士发型十一 | [user `64e0b8d10000000001007a02`](https://www.xiaohongshu.com/user/profile/64e0b8d10000000001007a02)；2026-06-29 [note `6a42153b000000000803e8bd`](https://www.xiaohongshu.com/search_result/6a42153b000000000803e8bd) | `XHS-only`：点评无同名门店 | `not_found` | [视频 `7662781481320980730`](https://www.douyin.com/video/7662781481320980730) 显示作者“型色沙龙十一”且正文含杭州理发店，但没有与 XHS 共享的品牌、分店或账号标识；“十一”不足以核身。 | **替换/待核身**：保留个人 IP 模式，不作为已核实门店。 |
| 3 | Tress&Tune 发型设计室（成都麓湖） | [user `66dda2a7000000001d023aed`](https://www.xiaohongshu.com/user/profile/66dda2a7000000001d023aed)；2026-06-25 [note `6a3d02270000000008033e0f`](https://www.xiaohongshu.com/search_result/6a3d02270000000008033e0f) | `matched`：[Tress&Tune Studio（麓湖CPI店）](https://www.dianping.com/shop/H1BpUKEJ5Mits8d1) | `matched` | [视频 `7663001871920950755`](https://www.douyin.com/video/7663001871920950755) 的作者显示“麓湖Tress&Tune美发设计室”，正文同时出现成都、麓湖；[视频 `7650739074227776098`](https://www.douyin.com/video/7650739074227776098) 进一步出现 `Tress&Tune Studio`、成都、麓湖 CPI。 | **纳入·核心**：三平台品牌、城市、分店/商圈一致。 |
| 4 | TOPP1NG（深圳） | [user `596e58cd5e87e7397f0147b9`](https://www.xiaohongshu.com/user/profile/596e58cd5e87e7397f0147b9)；2026-06-24 [note `6a3b89df00000000080021ac`](https://www.xiaohongshu.com/search_result/6a3b89df00000000080021ac) | `matched`：[TOPP1NG·barbershop男士复古理发馆](https://www.dianping.com/shop/EZUfvuuT5pUeaAvu) | `matched` | [视频 `7110521262652296459`](https://www.douyin.com/video/7110521262652296459) 的作者为“深圳TOPP1NG-復古理髮館”，品牌、城市与业态同时一致。 | **纳入·核心**：三平台品牌与城市一致。 |
| 5 | 小椿禾·nail（上海松江） | [user `57e6f6fb6a6a690c51b752fc`](https://www.xiaohongshu.com/user/profile/57e6f6fb6a6a690c51b752fc)；2026-07-13 [note `6a54aab8000000001700bbe5`](https://www.xiaohongshu.com/search_result/6a54aab8000000001700bbe5) | `matched`：[小椿禾·nail（松江大学城）](https://www.dianping.com/shop/Ha2zHNwi0qXKE5SK) | `not_found` | [视频 `7660873905066421105`](https://www.douyin.com/video/7660873905066421105) 的作者为“椿禾Nail Studio官方号”，只共享“椿禾”词根与业态；可见字段没有上海/松江，且“官方号”是昵称文本而非认证证明。 | **纳入**：XHS+DP 已完成门店锚定；抖音不合并。 |
| 6 | CoCoNaiL（杭州） | [user `60dafc1b0000000001000d24`](https://www.xiaohongshu.com/user/profile/60dafc1b0000000001000d24)；2026-06-23 [note `6a3a52770000000008025f82`](https://www.xiaohongshu.com/search_result/6a3a52770000000008025f82) | `probable`：点评有万象汇、滨江两店，XHS 无分店字段 | `probable` | [视频 `7570287943576797812`](https://www.douyin.com/video/7570287943576797812) 的作者为“CoCoNaiL&eyelash轻奢美甲”，正文含“杭州美甲美睫”；品牌与城市一致，但无分店字段。 | **纳入·分店待核身**：作为品牌级任务样本，不能把内容写入任一具体分店事实。 |
| 7 | Andylashes（成都） | [user `5db05a2a000000000100949c`](https://www.xiaohongshu.com/user/profile/5db05a2a000000000100949c)；2026-07-17 [note `6a59b497000000000f01fca3`](https://www.xiaohongshu.com/search_result/6a59b497000000000f01fca3) | `XHS-only`：点评无同名门店 | `not_found` | exact 与 variant 结果均为无关内容，没有同时出现 `Andylashes`、成都与美睫门店身份的稳定 URL。 | **替换/待核身**：仅保留 XHS 内容模式，不作为门店样本。 |
| 8 | AN NAIL·日式美甲美睫（杭州） | [user `5b1e166ce8ac2b1170ff03b8`](https://www.xiaohongshu.com/user/profile/5b1e166ce8ac2b1170ff03b8)；2026-07-15 [note `6a566868000000000f028a9f`](https://www.xiaohongshu.com/search_result/6a566868000000000f028a9f) | `probable`：杭州多分店，XHS 无分店字段 | `not_found` | exact 搜索返回的 [视频 `7662797106986763176`](https://www.douyin.com/video/7662797106986763176) 属于“anan·Nail”且正文指向奎文，不是杭州 AN NAIL；variant 也没有品牌+杭州稳定结果。 | **纳入·分店待核身**：两平台品牌级候选；补地址/电话尾号前不落具体分店。 |
| 9 | THE PURI 璞悦·湖滨in77店（杭州） | [user `6669a2cc0000000003033c3b`](https://www.xiaohongshu.com/user/profile/6669a2cc0000000003033c3b)；2026-07-08 [note `6a4e1ad2000000001700bd64`](https://www.xiaohongshu.com/search_result/6a4e1ad2000000001700bd64) | `matched`：[THE PURI·璞悦·水疗按摩（湖滨in77店）](https://www.dianping.com/shop/H7RgNAkxxtfCwnXG) | `matched` | [视频 `7660881570043022619`](https://www.douyin.com/video/7660881570043022619) 的作者直接显示“THE PURI 璞悦·湖滨in77店”，正文再次出现杭州 in77；[视频 `7662772099924692721`](https://www.douyin.com/video/7662772099924692721) 也同时出现璞悦、杭州、湖滨 in77。 | **纳入·核心**：三平台品牌、城市与分店一致。 |
| 10 | A优兰熹世梦（成都） | [user `5b67bafa69d6ce0001f8847c`](https://www.xiaohongshu.com/user/profile/5b67bafa69d6ce0001f8847c)；2026-07-14 [note `6a55f769000000000803e806`](https://www.xiaohongshu.com/search_result/6a55f769000000000803e806) | `probable`：[优兰熹美容疗愈SPA（天阔美地店）](https://www.dianping.com/shop/k2SmZ935p1tqG1e2)，XHS 缺分店字段 | `not_found` | exact 与 variant 结果都没有优兰熹品牌可见结果；仅命中天阔美地房产或泛成都 SPA，不归属。 | **纳入·分店待核身**：两平台品牌级候选；不把 XHS 内容直接归入天阔美地店。 |
| 11 | 成都专研问题肌的林子 | [user `5fd775db00000000010048b8`](https://www.xiaohongshu.com/user/profile/5fd775db00000000010048b8)；2026-07-15 [note `6a572a13000000000f015380`](https://www.xiaohongshu.com/search_result/6a572a13000000000f015380) | `XHS-only`：点评无同名门店 | `not_found` | exact 结果中的 [视频 `7660414259675242994`](https://www.douyin.com/video/7660414259675242994) 属于“量科颜·问题肌专研中心”，与“林子”没有共享品牌/身份；variant 为泛问题肌结果。 | **替换/待核身**：保留八年店主/个人 IP 模式，不作为已核实门店。 |
| 12 | SMOOTH小室木·专注痘敏（深圳） | [user `6352b3f20000000018029af7`](https://www.xiaohongshu.com/user/profile/6352b3f20000000018029af7)；2026-06-26 [note `6a3e81470000000008026e9d`](https://www.xiaohongshu.com/search_result/6a3e81470000000008026e9d) | `matched`：点评同品牌深圳连锁；单篇仍需分店消歧 | `matched` | [视频 `7601464168575326883`](https://www.douyin.com/video/7601464168575326883) 的作者为“SMOOTH小室木·专注痘敏（福田口岸）”，正文同时出现深圳、福田与品牌；该状态只表示身份核身，后续作品页核验日期为 2026-01-31，超出本轮窗口。 | **身份边界**：可确认抖音分店身份，但没有窗口内分店级正样本；XHS 连锁级内容不得自动分配给该店。 |

## 固定小红书候选的中间快照（不用于产品决策）

仅从本文件固定的 12 个小红书候选中，当时形成了 **9 个中间跟踪对象**；后续页面日期复核后，其中 8 个仍是内容候选，SMOOTH 福田口岸只保留为身份边界。该中间结果不用于产品共性计数：

1. 三平台身份较完整的内容候选（3 家）：Tress&Tune、TOPP1NG、THE PURI 璞悦·湖滨in77店。
2. XHS+DP 已锚定、抖音不合并（2 家）：TR salon、小椿禾·nail。
3. 品牌级候选、分店待核身（3 家）：CoCoNaiL、AN NAIL、优兰熹。
4. 身份边界（1 家）：SMOOTH 小室木福田口岸；抖音分店身份可确认，但已核日期超窗，不计 30 天内容候选。

其余 3 个 XHS-only 账号——杭州男士发型十一、Andylashes、成都专研问题肌的林子——保留为内容/IP 模式参考和替换池。它们在获得地址、电话尾号、认证主体、点评 shop ID 或其他稳定门店标识前，不进入“已核实门店”统计。

这套 9 家中间候选不是“九家都已三平台打通”，且只有 1 家皮肤管理候选，不满足正式样本中每个业态至少 2 家的配额，因此不能直接把本节标为第一轮 corpus 完成。最终台账结合抖音活跃候选的点评反向锚定，纳入 10 家分店级样本；权威名单见 [`TASK-CORPUS.md`](../TASK-CORPUS.md)。

在任何 corpus 中都必须使用权威 `identity_scope` 枚举：`store`、`brand_city`、`chain_city`、`brand`、`unknown`。本文件的 `XHS-only` 只是发现状态，落入 corpus 时映射为 `identity_match_status=not_found/probable` 与 `identity_scope=unknown/brand`，不是新的 `identity_scope` 值。生成或评估时，分店待核身内容不得自动拼接具体地址、价格、团购或营业事实。

## 抖音 exact / variant 查询记录

下列命令均在 `/Users/bin/Desktop/开发/内容无人区/美业内容2` 执行；均为只读，使用后台窗口和持久站点会话。

```bash
opencli --version
opencli douyin --help -f yaml
opencli auth status
date -Iseconds

opencli douyin search 'TR salon 烫染 漂发 上海 徐家汇' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'TR salon 徐家汇' --limit 5 -f json --window background --site-session persistent
opencli douyin search '杭州男士发型十一' --limit 5 -f json --window background --site-session persistent
opencli douyin search '男士发型 十一 杭州' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'Tress&Tune 成都 麓湖' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'Tress Tune 发型 成都' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'TOPP1NG 深圳 男士理发馆' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'TOPPING barbershop 深圳' --limit 5 -f json --window background --site-session persistent

opencli douyin search '小椿禾 nail 上海 松江大学城' --limit 5 -f json --window background --site-session persistent
opencli douyin search '小椿禾 美甲 上海' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'CoCoNaiL 杭州 美甲' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'CoCo Nail 杭州' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'Andylashes 成都 美睫' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'Andy lashes 成都' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'AN NAIL 杭州 美甲美睫' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'ANNAIL 杭州' --limit 5 -f json --window background --site-session persistent

opencli douyin search 'THE PURI 璞悦 杭州 湖滨 in77' --limit 5 -f json --window background --site-session persistent
opencli douyin search '璞悦 SPA 杭州 in77' --limit 5 -f json --window background --site-session persistent
opencli douyin search '优兰熹 成都 天阔美地' --limit 5 -f json --window background --site-session persistent
opencli douyin search '优兰熹 成都 SPA' --limit 5 -f json --window background --site-session persistent
opencli douyin search '成都专研问题肌的林子' --limit 5 -f json --window background --site-session persistent
opencli douyin search '林子 问题肌 成都' --limit 5 -f json --window background --site-session persistent
opencli douyin search 'SMOOTH 小室木 深圳 痘敏' --limit 5 -f json --window background --site-session persistent
opencli douyin search '小室木 深圳 皮肤管理' --limit 5 -f json --window background --site-session persistent

date -Iseconds
```

## 失败与可复现边界

- 本轮 24 次抖音搜索均成功返回，没有登录、验证码、限流或适配器异常；`auth status` 显示抖音登录态可用，账号身份不写入研究文件。
- 搜索只取每个 query 前 5 条，是固定候选的核身探针，不等于平台全量检索；`not_found` 只表示本轮 exact/variant 可见结果不足，不表示门店没有抖音账号或作品。
- 抖音搜索结果没有 `published_at`、账号主页 URL、认证主体、门店地址或电话尾号；互动值也可能随时间变化。本文件不保存互动值，避免把瞬时指标当身份事实。
- XHS 与抖音昵称可由用户自行修改；后续如要把 `probable` 升为 `matched`，应补充平台主页稳定 user ID、认证主体、POI、地址或电话尾号，而不是扩大模糊关键词搜索。
- 公开内容只能证明抓取时点可见字段；不能证明账号由店长、技师、品牌方或代运营管理，也不能证明内容带来咨询、买券、核销或到店。
