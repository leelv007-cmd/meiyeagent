# Platform Capability Matrix

审查日期：2026-07-06  
审查对象：抖音、小红书、美团/大众点评、微信公众号  
业务范围：美业到店 + 医美/医疗内容商家的内容创作副驾。医美、医疗、注射、激光、手术、药械等内容采用 Regulated Content Mode；不支持疗效承诺、伪造资质/案例和无人值守账号运营。

## 结论

P0 的安全承诺不是“全平台一键自动发布”，而是：

1. 所有平台都稳定提供 `L3 发布包`：标题、正文、图片/视频素材、话题、门店信息、操作清单、合规提示、归因记录字段。
2. 微信公众号和抖音可以进入 `L1 官方能力验证`，但必须先完成应用/账号权限申请和真实账号验收；验收前只能标记为 `doc-only`。
3. 小红书当前没有找到面向普通商家笔记自动发布的官方 API 证据，P0 只能承诺 L3；L2 浏览器辅助最多作为灰度预填/预提交实验，不能自动提交。
4. 美团/大众点评当前更适合作为线索、预约、核销、评价和经营数据归因试点，不适合作为内容自动发布承诺；内容侧仍以 L3 发布包为主。

## 状态口径

- `verified`：官方文档存在，并且真实应用/商家/公众号账号完成权限和端到端测试。
- `doc-only`：官方文档说明能力存在，但本地还没有账号验收记录。
- `blocked`：需要平台审核、服务商入驻、商家授权或登录后文档，当前不能进入产品承诺。
- `manual-only`：只能通过人工发布包或人工录入完成，不走自动接口。
- `not-found`：本轮官方资料未发现该能力，不能写入产品卖点。

本轮没有任何平台能力可标记为 `verified`，因为还没有真实账号验收记录。

## 总矩阵

| 平台 | 账号/准入类型 | Publish | Observe | Engage | Attribution | P0 路线 | 安全产品承诺 |
|---|---|---|---|---|---|---|---|
| 抖音 | 抖音开放平台移动/网站应用；用户授权；投稿/视频数据等能力审核 | `doc-only`：OpenAPI 可直接发布视频/图片；SDK/H5 分享由用户自主发布。POI、小程序挂载需额外权限 | `doc-only`：授权后可查视频列表、视频信息、互动/播放等数据；share_id 可关联 item_id | `not-found`：本轮只确认数据读取，没有确认评论/私信回复 API | `doc-only`：可沉淀 item_id、分享 URL、播放/互动指标；到店转化需另接 POI、小程序、券或人工线索 | L3 默认；L1 做 P0 技术验证，不作为默认承诺 | “生成抖音发布包；通过官方能力审核后可启用抖音发布/数据回传” |
| 小红书 | 开放平台企业开发者/服务市场服务商；内容工具类目门槛高 | `not-found`：未发现普通商家笔记自动发布 API；内容工具可做图片/文案/素材管理 | `not-found`：当前官方快照偏电商商品/订单/素材，不支持笔记数据承诺 | `not-found`：未确认笔记评论/私信读写 | `manual-only`：只能记录发布包、人工链接、线索备注 | L3 默认；L2 仅灰度预填/预提交，且用户最终确认 | “生成小红书笔记发布包，人工发布；暂不承诺自动发布” |
| 美团/大众点评 | 美团技术服务合作中心；三方服务商/品牌商/个人开发者；服务零售需审批和商家授权 | `not-found`：未确认点评内容/帖子自动发布 API；商品/团购等经营能力不等于内容发布 | `doc-only/blocked`：官方入口展示服务零售、团购核销等；评价、订单、预约、经营数据需登录后文档和账号验证 | `not-found`：未确认服务零售评价回复/私信自动处理能力 | `doc-only/blocked`：团购核销、订单、预约、客资、优惠码、经营数据方向最有归因价值，但需账号验证 | L3 内容默认；L1 只做经营/线索/核销数据接入试点 | “生成点评/美团发布包；可做线索台账，后续按商家授权接入核销/预约/评价数据” |
| 微信公众号 | 已认证服务号优先；需要 AppID/AppSecret/IP 白名单等；2025-07 起个人主体、未认证企业、不支持认证账号会回收发布接口权限 | `doc-only`：草稿管理和 freepublish 发布接口明确存在 | `doc-only`：可查发布状态、已发布列表和图文详情 | `not-found`：本轮未验证留言、客服消息或自动回复闭环 | `doc-only/manual`：可记录文章 URL、发布时间、阅读原文链接、自有短链/二维码；平台内转化需另接业务系统 | L3 默认；已认证服务号通过验收后可做 L1 | “生成公众号图文并发布到草稿；认证服务号通过测试后可提交发布” |

## 平台细节

### 抖音

官方资料显示两条发布路径：

- OpenAPI 发布：面向希望以 `open_api` 形式直接发布视频或图片到抖音的开发者。支持视频、图片；视频建议 mp4/webm，文件不超过 4G、15 分钟以内；图片不超过 100M。带品牌 logo 或水印的素材有审核、降权、下架、封禁风险。
- SDK/H5 分享发布：用户点击带抖音标识的按钮，将应用内图片、视频或图文混合内容同步到抖音，由用户自主发布。文档明确提示能力需要在「能力管理-内容能力-投稿能力」主动申请，且更适合用户自己创作内容的场景。

Observe 侧官方资料显示，用户授权后可以查询视频列表、视频基础信息、视频互动数据；发布链路可先获取 `share_id`，通过 Webhooks 拿到 `share_id` 与 `item_id` 的关系，再查询分享 URL 和数据。

P0 判断：

- 可以做官方 L1 技术验证，但验收前不能承诺“已支持抖音自动发布”。
- P0 默认仍生成 L3 发布包，并把抖音官方接入作为功能开关。
- 不承诺评论/私信自动回复，也不承诺到店转化归因。若后续要做转化，需要另接 POI、小程序、券、表单或人工线索台账。

验收清单：

1. 创建并审核移动/网站应用。
2. 申请投稿能力、视频信息数据、视频互动数据。
3. 使用测试账号授权。
4. 发布一条图片内容和一条视频内容，记录审核状态、失败码、素材限制。
5. 获取 `share_id`、Webhook 事件、`item_id`、分享 URL 和基础数据。
6. 验证删除、审核中、审核失败、限流/风控场景。

### 小红书

本轮官方资料主要指向电商开放平台和服务市场：

- 应用类目包含一键搬家、商品优化、打单工具、订单管理、企业 ERP、跨境 ERP、商家后台系统。
- API 权限主要是公共接口、授权、商品、库存、素材中心、订单、售后和消息推送。
- “内容工具”类目定义为给小红书商家提供经营素材产出、内容管理的电商软件；图片工具要求具备图片处理/抠图、模板、图片空间、智能生成文案。
- 内容工具服务商入驻门槛高：大陆企业、注册资本不低于 20 万、成立 1 年以上、技术人员不少于 10 人、客服不少于 5 人、单平台付费用户 1000 家以上等。
- “发布服务”是服务市场上架流程，不是笔记发布 API。

P0 判断：

- 没有官方证据支持“自动发布小红书笔记”作为 P0 承诺。
- P0 只做小红书发布包：标题、正文、封面、图片顺序、标签、门店/项目说明、禁用词提示、人工发布 checklist。
- L2 如果要做，只能是浏览器辅助把内容放到用户可检查的位置，并由用户最终点击发布；上线前至少需要 2 周、多个真实账号的安全测试和失败退出机制。

验收清单：

1. 继续追踪小红书是否开放本地生活/笔记发布官方 API。
2. 如申请内容工具服务市场，先评估主体资质、保证金、服务市场审核周期和已有付费用户证明。
3. 若试 L2，只允许“打开页面、预填、用户确认”，禁止绕过验证码、禁止自动提交、禁止无人值守批量发布。

### 美团/大众点评

本地快照确认美团技术服务合作中心存在三类入驻：三方服务商、连锁品牌、个人开发者；商家服务中包含服务零售，公开首页出现团购核销等能力入口。原大众点评北极星开放平台页面显示其技术和运营服务迁移到美团技术服务合作中心，2025-07-02 起使用新的文档中心和控制台。

在线核验时，公开搜索结果能看到服务零售方向包含团购核销、订单管理、商品管理、预订、评价、预约、会员通、电商交易、经营数据、客资中心、店铺优惠码等能力描述，并且服务零售范围覆盖丽人医美等本地服务类目。但这些能力细节页当前依赖 JS、登录或账号权限，本地快照没有完整 API 参数和验收记录，因此只能标为 `doc-only/blocked`。

P0 判断：

- 不能承诺“自动发布大众点评内容/点评笔记/评价”。
- 可以把美团/点评作为 P0 的“线索台账和后续归因接入优先平台”。
- 真正有商业价值的是团购券码核销、预约、订单、客资、优惠码、评价读取和经营数据回流；这些必须在商家授权和服务商/品牌账号验证后再做 L1。

验收清单：

1. 注册并确认入驻身份：三方服务商、品牌商或个人开发者。
2. 进入服务零售/丽人相关文档，确认可申请的能力包和行业范围。
3. 使用真实或沙箱商家授权，验证券码核销、订单/预约查询、评价数据、客资推送、优惠码读取。
4. 建立内容包 `campaign_id` 到团购券、预约、订单、人工线索的映射。
5. 验证数据延迟、撤销、退款、核销失败、重复线索、跨门店归属。

### 微信公众号

官方资料显示，服务号可以通过服务端接口管理草稿和发布：

- 草稿管理：开关、添加、更新、列表、数量、删除、详情。
- 发布能力：发布草稿、查询发布状态和详情、获取已发布消息列表、获取已发布图文信息、删除发布文章。
- 关键限制：2025 年 7 月起，个人主体账号、企业主体未认证账号及不支持认证的账号会被回收上述发布接口调用权限。

P0 判断：

- 微信公众号是当前最清晰的 L1 候选，但前提是已认证服务号和真实接口验收。
- P0 可以先做“发布到草稿箱”；直接发布必须加人工确认、权限检测、发布频次检测、错误码留痕。
- 本轮未验证留言、客服消息、自动回复、粉丝互动和阅读数据接口，不纳入 P0 Engage 承诺。

验收清单：

1. 使用已认证服务号配置 AppID、AppSecret、IP 白名单。
2. 获取 access_token 并记录刷新策略。
3. 上传封面和正文图片，创建草稿。
4. 查询草稿详情和草稿列表。
5. 人工确认后调用发布草稿。
6. 查询发布任务状态、已发布列表和图文详情。
7. 验证未认证/个人账号的权限错误表现。

## P0 架构落点

### 能力表

建议在 Core API/Postgres 中维护 `platform_capabilities`，不要把平台判断硬编码在 Agent Service：

| 字段 | 含义 |
|---|---|
| `platform` | `douyin` / `xiaohongshu` / `meituan_dianping` / `wechat_official_account` |
| `area` | `publish` / `observe` / `engage` / `attribution` |
| `route_level` | `L1` / `L2` / `L3` |
| `status` | `manual-only` / `doc-only` / `blocked` / `verified` / `disabled` |
| `account_type` | 需要的账号类型或认证主体 |
| `permission_name` | 平台能力名或权限包 |
| `last_doc_check_at` | 最近官方文档核验时间 |
| `last_account_test_at` | 最近真实账号验收时间 |
| `evidence_links` | 本地快照和官方链接 |
| `risk_notes` | 审核、封禁、权限、合规风险 |
| `fallback_route` | 不可用时回退到的 L3 发布包 |

### 发布作业

P0 统一走 `publish_jobs`，不同平台只是执行器不同：

1. `generated`：Agent Service 生成初稿。
2. `compliance_checked`：Core API 合规门禁通过。
3. `package_ready`：L3 发布包完成。
4. `user_confirmed`：用户确认内容、平台和账号。
5. `submitted`：只有 L1 verified 平台才允许进入。
6. `observed`：读取平台返回的状态/链接/指标。
7. `closed`：记录发布结果或失败原因。

所有平台都必须先能完成 `package_ready`；L1/L2 失败不能阻塞用户拿到可发布内容。

### 功能开关

- `douyin_openapi_publish`: 默认关闭，账号验收后开启。
- `douyin_share_publish`: 默认关闭，适合用户自主发布场景。
- `xiaohongshu_browser_assist`: 默认关闭，只能灰度预填，禁止自动提交。
- `meituan_retail_data`: 默认关闭，等服务零售账号和商家授权。
- `wechat_oa_draft`: 默认关闭，认证服务号验收后开启。
- `wechat_oa_freepublish`: 默认关闭，必须在草稿成功和人工确认后单独开启。

## 对外话术

可以说：

- “为抖音、小红书、点评/美团、微信公众号生成可直接使用的发布包。”
- “公众号和抖音支持按官方能力接入，账号审核通过后可启用自动草稿/发布流程。”
- “点评/美团支持线索台账，后续可按商家授权接入预约、券码核销、评价和经营数据。”

不能说：

- “全平台一键自动发布。”
- “小红书自动发布。”
- “自动回复所有平台评论/私信。”
- “自动计算每篇内容 ROI。”
- “无人值守代运营账号。”

## 证据

本地快照：

- `references/docs/official/platforms/douyin-publish-openapi.md`
- `references/docs/official/platforms/douyin-share-publish.md`
- `references/docs/official/platforms/douyin-video-data.md`
- `references/docs/official/platforms/xiaohongshu-api-development.md`
- `references/docs/official/platforms/xiaohongshu-content-tool-rules.md`
- `references/docs/official/platforms/xiaohongshu-publish-service.md`
- `references/docs/official/platforms/meituan-developer-home.md`
- `references/docs/official/platforms/meituan-openapi.md`
- `references/docs/official/platforms/wechat-official-account-draft.md`
- `references/docs/official/platforms/wechat-official-account-publish.md`

官方链接：

- https://open.douyin.com/platform/resource/docs/ability/content-management/douyin-publish-solution
- https://developer.open-douyin.com/docs/resource/zh-CN/dop/ability/opensdk/content-management/share-and-publish-to-douyin
- https://developer.open-douyin.com/capacity-center-page/capacity-detail/7180522194714230845
- https://xiaohongshu.apifox.cn/
- https://xiaohongshu.apifox.cn/doc-2811130
- https://xiaohongshu.apifox.cn/doc-2810945
- https://developer.meituan.com/
- https://developer.meituan.com/docs
- https://developer.meituan.com/isv/daozong?location=tuangou
- https://open.dianping.com/
- https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html
- https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html

## 下一步

1. Publish Route Proof Of Concept 只能从两个方向开始：微信公众号草稿/发布、抖音发布/视频数据。
2. 小红书优先打磨 L3 发布包和合规检查，不做自动发布承诺。
3. 美团/点评优先做线索台账、内容包 campaign_id、人工核销/预约录入结构；等账号权限拿到后再接真实数据。
4. 所有平台接入前，先把 `platform_capabilities` 和 `publish_jobs` 做成可配置状态机。
