# Publish Route Proof Of Concept

> ⚠️ **2026-07-07 v1.5 覆盖批注**：本文中所有 L2/browser preparation、`publish.prepare_browser`、小红书 no-submit 灰度均已被 v1.5 Scope Lock 移出 P0。当前 P0 只保 L3 发布包（做厚）与 verified L1 官方能力边界验证；本文保留为历史 POC 和 P1+ 风险参考。

> ⚠️ **2026-07-18 链接审计批注**：本文引用的原型产物 `references/prototypes/publish-route-poc/` 未迁入本工作区、现已不存在；原型跑分仅作历史证据，复跑需按文中脚本描述重建。结论不受影响。

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗内容商家 Regulated Content Mode 创作副驾 P0 发布路线  
结论性质：开发前路线决策和本地原型验证；未完成真实平台账号验收前，不等同于生产发布能力。

## Question

What is the safest P0 publish route implementation for L3 packages, WeChat official publishing, Douyin official publish/share routes, and browser-assisted preparation without making unsafe automation promises?

## 结论

P0 发布系统的安全路线是：**所有平台默认 L3 发布包，官方能力只在账号级 verified 后进入 L1；L2 浏览器辅助不进入 P0。**

推荐产品承诺：

1. 小红书、抖音、美团/点评、微信公众号都稳定生成 `L3 发布包`。
2. 微信公众号的第一条 L1 路线是 `创建草稿`，不是默认直接发布。
3. 微信 `freepublish` 只允许在已认证服务号、账号能力 verified、用户显式请求发布、用户最终确认、状态轮询和审计都完成后开启。
4. 抖音 OpenAPI 发布和 SDK/H5 分享发布进入技术验证路线，但在真实账号验收前只能是 `doc-only`，不能对外承诺自动发布。
5. 小红书没有找到普通商家笔记自动发布官方 API 证据，P0 只能承诺 L3；不做 L2 浏览器准备草稿。
6. 美团/点评不承诺内容自动发布，P0 用 L3 发布包加线索台账；后续优先验证预约、券码核销、评价、客资和经营数据归因。
7. `Compliance Gate` 是发布前硬门禁：`block` 状态禁止导出、发布包交接和官方提交。

一句话判断：

**发布功能不要做成“全平台一键代运营”，要做成“可审计的发布包 + 被验证的平台能力适配器 + 人工确认状态机”。**

## Local Sources Used

产品与前序决策：

- `合集-v1.2-含开源项目选型.md`
- `CONTEXT.md`
- `references/analysis/01-execution-path.md`
- `references/analysis/03-agent-runtime-source-review.md`
- `references/analysis/05-platform-capability-matrix.md`
- `references/analysis/06-compliance-implementation-plan.md`
- `references/analysis/07-domain-data-model.md`

官方文档快照：

- `references/docs/official/platforms/douyin-share-publish.md`
- `references/docs/official/platforms/douyin-publish-openapi.md`
- `references/docs/official/platforms/douyin-video-data.md`
- `references/docs/official/platforms/wechat-official-account-draft.md`
- `references/docs/official/platforms/wechat-official-account-publish.md`
- `references/docs/official/platforms/wechat-official-account-token.md`
- `references/docs/official/platforms/xiaohongshu-api-development.md`
- `references/docs/official/platforms/xiaohongshu-content-tool-rules.md`
- `references/docs/official/platforms/xiaohongshu-publish-service.md`
- `references/docs/official/platforms/meituan-developer-home.md`
- `references/docs/official/platforms/meituan-openapi.md`

本地原型：

- `references/prototypes/publish-route-poc/README.md`
- `references/prototypes/publish-route-poc/sample-input.json`
- `references/prototypes/publish-route-poc/publish-route-resolver.mjs`
- `references/prototypes/publish-route-poc/out/routes.json`
- `references/prototypes/publish-route-poc/out/l3-package.json`
- `references/prototypes/publish-route-poc/out/run-report.md`

## Live Sources Used

无。本轮只使用本地 OpenCLI 官方快照和前序本地研究结论。平台能力正式上线前仍必须刷新官方文档并做真实账号 smoke test。

## Official Evidence Summary

### 抖音

本地官方快照显示两类能力：

- OpenAPI 内容发布：文档面向希望以 `open_api` 形式直接发布视频或图片内容至抖音的开发者；支持视频和图片；视频建议 mp4/webm，文件不超过 4G、15 分钟以内，图片不超过 100M；带品牌 logo 或水印可能触发审核、降权、下架或账号风险。
- SDK/H5 分享发布：用户可以从第三方应用向抖音发布内容，支持图片、视频、图文混合，并可携带话题、小程序、POI 等信息；文档强调开发者需要主动申请投稿能力，且用户应自主发布。

工程判断：

- OpenAPI 可以做 L1 技术验证，但必须有应用审核、用户授权、素材限制校验、审核状态记录、失败码归档。
- 分享发布不是系统无人值守提交，产品文案必须写成“用户自主发布到抖音”。
- `doc-only` 阶段只能生成验证计划，不能启用生产提交。

### 微信公众号

本地官方快照显示：

- 服务号可以通过服务端接口管理草稿，包括新增、更新、列表、数量、删除和详情。
- 服务号可以使用发布能力，包括发布草稿、查询发布状态、获取已发布列表、获取已发布图文信息和删除文章。
- 2025 年 7 月起，个人主体账号、企业主体未认证账号及不支持认证的账号会被回收上述接口调用权限。

工程判断：

- 微信是 P0 最清晰的 L1 候选，但入口应该从 `draft/add` 开始。
- `freepublish/submit` 必须独立开关，且要求已认证服务号、真实账号验收、用户最终确认、状态查询和审计留痕。
- 未认证企业号或个人主体账号只能回退到 L3。

### 小红书

本地官方快照主要覆盖电商开放平台和服务市场：

- 应用类目包括一键搬家、商品优化、打单工具、订单管理、ERP、商家后台系统。
- API 权限集中在公共、授权、商品、库存、素材中心、订单、售后和消息推送。
- 内容工具类目是为商家提供经营素材产出和内容管理的软件，入驻门槛高，需要企业主体、团队、用户量和服务能力证明。
- “发布服务”指服务市场应用或服务上架，不是普通商家笔记发布 API。

工程判断：

- P0 不承诺小红书自动发布笔记。
- 小红书主路径是 L3 发布包。
- L2 浏览器辅助只能灰度：打开页面、准备内容、提示用户检查；禁止最终点击发布、绕过验证码、抽取 cookie、调用隐藏接口。

### 美团/点评

本地快照确认美团技术服务合作中心有服务商、品牌商、个人开发者入口，服务零售方向有团购核销等经营能力入口；但内容自动发布 API 没有被验证。

工程判断：

- P0 不承诺自动发布点评/美团内容。
- 业务价值更可能在线索台账、预约、券码核销、评价、客资和经营数据归因。
- 内容侧保持 L3 发布包；数据侧进入独立账号验证和商家授权路线。

## Prototype Result

运行命令：

```bash
node references/prototypes/publish-route-poc/publish-route-resolver.mjs
```

输出摘要：

| Scenario | 小红书 | 抖音 | 微信公众号 | 美团/点评 |
|---|---|---|---|---|
| `p0_default_unverified` | `L3_PACKAGE` | `L3_PACKAGE` | `L3_PACKAGE` | `L3_PACKAGE` |
| `wechat_verified_draft` | `L3_PACKAGE` | `L3_PACKAGE` | `L1_WECHAT_DRAFT` | `L3_PACKAGE` |
| `wechat_direct_submit_requested` | `L3_PACKAGE` | `L3_PACKAGE` | `L1_WECHAT_FREEPUBLISH` | `L3_PACKAGE` |
| `douyin_doc_only_validation` | `L3_PACKAGE` | `L3_PACKAGE` | `L3_PACKAGE` | `L3_PACKAGE` |
| `xhs_browser_assist_gray` | `not_in_p0` | `L3_PACKAGE` | `L3_PACKAGE` | `L3_PACKAGE` |
| `blocked_by_compliance` | `blocked_by_compliance` | `blocked_by_compliance` | `blocked_by_compliance` | `blocked_by_compliance` |

原型验证的关键不变量：

- 默认状态下四个平台都只生成 L3。
- 只有账号级 `verified_capabilities` 满足时，微信公众号才从 L3 升级到 L1 草稿。
- 微信直接发布不是默认动作，必须显式 `requested_actions.wechat_official_account = submit_publish`。
- 抖音即使打开 feature flag，只要账号能力没有 verified，仍回退到 L3 并输出验证计划。
- 小红书 L2 不进入 P0；pilot 只记录 L3 发布包人工发布耗时。
- 合规 `block` 会同时禁止发布包导出、发布包交接和官方提交。

## Route Design

### Route Levels

| Level | 含义 | P0 允许状态 |
|---|---|---|
| `L3` | 发布包：文案、素材、封面、话题、清单、合规提示、归因字段 | 所有平台默认支持 |
| `L2` | 浏览器辅助准备：打开页面、预填或整理草稿、截图确认 | 只做灰度实验，禁止最终提交 |
| `L1` | 官方接口：草稿、发布、状态查询、数据回传 | 只在账号级 verified 后启用 |

### State Machine

沿用 `references/analysis/07-domain-data-model.md`：

```text
generated
  -> compliance_checked
  -> package_ready
  -> user_confirmed
  -> submitted
  -> observed
  -> closed
```

规则：

- L3 可以停在 `package_ready` 或 `user_confirmed`。
- L2 必须停在最终平台提交动作之前。
- L1 只有账号能力为 `verified` 时才允许进入 `submitted`。
- `needs_review` 不允许自动提交，只能人工复核后重新检查。
- `block` 直接终止，不生成可公开导出的发布包。

### Feature Flags

| Flag | 默认 | 用途 | 开启条件 |
|---|---:|---|---|
| `wechat_oa_draft` | off | 微信服务号草稿创建 | 已认证服务号真实验收通过 |
| `wechat_oa_freepublish` | off | 微信草稿提交发布 | 草稿链路稳定、用户确认、状态轮询和审计完成 |
| `douyin_openapi_publish` | off | 抖音 OpenAPI 直发验证 | 应用审核、授权、图片/视频发布、审核状态和失败码验证 |
| `douyin_share_publish` | off | 抖音 SDK/H5 用户自主发布 | 投稿能力申请通过，按钮文案和用户自发布流程验收 |
| `xiaohongshu_browser_assist` | off | 小红书浏览器准备草稿 | 灰度账号安全测试，禁止自动提交 |
| `meituan_retail_data` | off | 美团/点评经营数据归因验证 | 服务零售能力、商家授权和数据范围确认 |

## Engineering Implementation Path

### 1. Core API 数据模型

先落这些表，不要把能力判断写死在前端或 Agent prompt：

- `platform_capabilities`
- `platform_capability_evidence`
- `platform_accounts`
- `platform_account_capabilities`
- `publish_packages`
- `publish_package_artifacts`
- `publish_package_steps`
- `publish_jobs`
- `publish_attempts`
- `publish_observations`
- `audit_events`

最重要的约束：

- 产品承诺读取账号级 `platform_account_capabilities.status = verified`。
- 只有官方文档证据时，状态只能是 `doc-only`。
- L1/L2 失败必须降级到 L3，不能让用户拿不到发布内容。

### 2. Core API 服务边界

建议先实现这些内部服务：

| Service | 责任 |
|---|---|
| `PublishPackageService` | 根据平台变体生成 L3 包、artifact、checklist |
| `PublishRouteResolver` | 读取能力表、账号能力、feature flag、合规状态，选择 L1/L2/L3 |
| `PublishJobService` | 管理状态机和人工确认 |
| `PublishAttemptService` | 记录 L1/L2 请求、响应、失败码、降级原因 |
| `PlatformCapabilityService` | 管理官方证据、账号验收和功能开关 |
| `ComplianceGate` | 发布前硬门禁，不让 Agent 或平台审核替代 |

Agent Service 只能通过 Core API 工具调用这些服务，不能直接改发布状态或账号能力。

### 3. Agent Tools

P0 工具面建议：

| Tool | 风险等级 | 行为 |
|---|---|---|
| `publish.create_package` | low | 创建 L3 发布包，所有平台可用 |
| `publish.prepare_browser` | high | 只做 L2 准备，最终提交禁用 |
| `publish.submit_official` | high | 只允许 verified L1，必须有用户确认 |
| `publish.record_manual_result` | medium | 用户粘贴发布链接、截图或备注 |
| `publish.observe_official` | medium/high | 读取官方发布状态或指标 |

高风险工具都必须写审计：

- 调用人、workspace、store、content_version、platform、route_level。
- request hash、response hash、外部 item id、外部 URL。
- user confirmation id。
- compliance check id 和 AIGC label record id。
- failure code、downgrade reason。

### 4. L3 发布包先行

第一批开发只做 L3：

1. 生成平台变体。
2. 跑 `Compliance Gate`。
3. 生成 `publish_package`。
4. 导出文案、图片、清单、合规摘要、AIGC 标识说明。
5. 用户人工发布后记录平台链接和发布时间。
6. 写入线索台账字段：`campaign_id`、`platform`、`manual_url`、`store_id`、`content_id`。

这一步完成后，产品已经能提供稳定交付，不依赖任何平台账号审批。

### 5. 微信 L1 草稿

第二批只做公众号草稿：

1. 验证账号是已认证服务号。
2. 配置 AppID、AppSecret、IP 白名单和 token 刷新。
3. 上传封面图和正文图。
4. 调用草稿新增接口。
5. 读取草稿详情并做 hash 比对。
6. 在 UI 中展示“已生成公众号草稿，发布前请确认”。
7. 记录 `publish_attempt`，状态为 `draft_created`。

不在这一阶段默认直接发布。

### 6. 微信 Freepublish

第三批在草稿稳定后再做：

1. 用户点击明确的“提交发布”动作。
2. 弹出最终确认，展示账号、标题、摘要、封面、合规状态和 AIGC 标识。
3. 验证 `wechat_oa_freepublish` flag、账号 verified capability、合规未过期。
4. 调用发布草稿接口。
5. 轮询发布状态。
6. 保存外部文章 URL、状态、失败码。
7. 失败时保留草稿和 L3 包，给出可人工处理路径。

### 7. 抖音技术验证

第四批只做验证，不默认对外售卖为“自动发布”：

1. 申请内容发布能力。
2. 验证图片发布、视频发布、素材大小和格式限制。
3. 处理品牌 logo、水印、POI、小程序挂载风险。
4. 记录审核状态、失败码、item id、分享 URL。
5. 验证视频数据接口和 webhook 关联。
6. 通过后才把账号能力标为 `verified`。

SDK/H5 分享路线必须在 UI 中表达为“打开抖音并由用户发布”，不能表达为后台代发。

### 8. 小红书 L2 灰度（P1+ 历史参考，不进 P0）

第五批只允许内部或少量灰度账号：

1. 只打开页面和准备草稿，不最终点击发布。
2. 禁止验证码绕过、cookie 抽取、隐藏 API、无人值守批量。
3. 每次准备都要求用户可见、可取消、可手动修改。
4. 截图或日志只保存用户确认后的必要信息。
5. 失败时直接回到 L3 包。

只要没有官方 API 证据，小红书自动发布就不能进入产品承诺。

### 9. 美团/点评归因路线

第六批从内容发布转向经营数据：

1. 先用 L3 内容包和人工发布链接。
2. 建立 `campaign_id` 到平台链接、预约、券码、线索备注的映射。
3. 验证服务零售、预约、核销、评价、客资和经营数据权限。
4. 只在商家授权和服务商/品牌账号通过后接入。
5. 不把经营数据能力包装成内容自动发布能力。

## Product Copy Boundaries

可以说：

- “为小红书、抖音、美团/点评、微信公众号生成发布包。”
- “公众号认证服务号通过验收后，可生成官方草稿。”
- “抖音官方发布能力可按账号和应用审核结果接入。”
- “小红书支持发布包；是否值得做浏览器辅助由 P1+ 数据决定。”
- “美团/点评可沉淀线索台账，后续按商家授权接入经营数据。”

不能说：

- “全平台一键自动发布。”
- “无需登录、无需人工确认自动代发。”
- “小红书自动发布笔记。”
- “点评/美团内容自动发布。”
- “浏览器辅助可以绕过验证码或自动提交。”
- “抖音分享发布等于后台自动发布。”

## Acceptance Criteria

P0 发布模块进入开发完成态前，至少满足：

1. 任意平台都能在合规通过后生成 L3 发布包。
2. 合规 `block` 时，导出、发布包交接和官方提交全部被拒绝。
3. `platform_capabilities.status = doc-only` 时，只输出验证计划，不进入 production submit。
4. 账号级能力未 verified 时，L1 请求必须降级到 L3。
5. P0 不包含 L2 浏览器辅助；final submit、captcha bypass、cookie extraction、hidden API 调用全部禁止。
6. 微信草稿和 freepublish 是两个独立 feature flag。
7. 微信 freepublish 必须有用户最终确认和状态轮询。
8. 抖音分享发布必须记录为 user self-publish。
9. 每次 L1 尝试都写 `publish_attempts` 和 `audit_events`。
10. L1 失败不会影响用户下载或使用 L3 包。

## Follow-Up Tickets

- 构建 Core API `PublishRouteResolver` 和 `platform_capabilities` seed。
- 开发 L3 发布包 UI 和导出格式。
- 做微信公众号已认证服务号真实草稿验收。
- 做抖音 OpenAPI/SDK/H5 发布能力申请和真实账号验收。
- 设计小红书 L2 灰度安全测试方案。
- 设计美团/点评线索台账和经营数据归因 POC。
