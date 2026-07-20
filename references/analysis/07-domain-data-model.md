# Domain Data Model

> ⚠️ **2026-07-07 v1.5 覆盖批注**：最终数据模型以 `references/product/reports/p0-data-model-api-contract.md` 为单一事实源。本文中 D1 承载 Better Auth/session、`content_cores/platform_variants/publish_jobs` 等旧命名均为历史口径；P0 采用单托管 Postgres（含 Better Auth 表）和契约命名。

> ⚠️ **2026-07-18 链接审计批注**：本文所引 `references/repos/*` 本地镜像已从工作区移除（当前仅存 creatok-skills、vozeb、harness-2026-07-17，均 gitignore 不入库）。mkfast-template 模板现位于仓库根 `mkfast-template-main/`；需复核其余源码时按原仓库名重新 clone。文中镜像路径为 2026-07-06 快照期历史记录，结论不受影响。

审查日期：2026-07-06  
审查对象：美业到店 + 医美/医疗资质准入制商家创作副驾 P0  
结论性质：开发前数据模型与领域边界，不是最终 DDL。

## 结论

P0 的核心数据模型必须以 `Store Workspace` 为租户边界，以 Postgres 中的 Core API 为产品事实来源。

不要把产品核心域塞进 `mkfast-template` 的 D1 `app.schema.ts`。按 ADR-0006，Better Auth、session、API key、shell-local payment/upload metadata 与产品事实同入单托管 Postgres；D1 不承载 P0 auth 或业务数据。Store Workspace、Real Asset Library、Content Core、Platform Variant、Publish Package、Platform Account、Lead Ledger、Usage Ledger、Compliance Gate、Agent runs 和 audit events 都应该进入 Core API/Postgres。

关键原则：

1. `workspace_id` 是所有产品表的第一租户边界；`store_id` 是门店业务边界。
2. Better Auth 只提供身份和 session，不提供最终 workspace authorization。
3. Agent Service、Mastra Memory、RAG、平台回调、浏览器辅助都不能成为产品事实来源。
4. 任何影响合规、发布、用量、成本、线索、素材授权的写操作都要有审计记录。
5. P0 优先做可审计的内容运营闭环，不为未来多门店/代运营场景过度抽象，但表结构不要阻断它们。

## 本地依据

- 产品术语：`CONTEXT.md`
- 产品基线：`合集-v1.2-含开源项目选型.md`
- 范围决策：`docs/adr/0003-regulated-content-mode.md`
- 执行路径：`references/analysis/01-execution-path.md`
- SaaS 壳源码审查：`references/analysis/02-saas-shell-source-review.md`
- Agent Runtime 源码审查：`references/analysis/03-agent-runtime-source-review.md`
- 平台能力矩阵：`references/analysis/05-platform-capability-matrix.md`
- 合规实施方案：`references/analysis/06-compliance-implementation-plan.md`
- mkfast-template D1 schema：`references/repos/mkfast-template/src/db/auth.schema.ts`
- mkfast-template app schema：`references/repos/mkfast-template/src/db/app.schema.ts`
- mkfast-template DB 文档：`references/repos/mkfast-template/docs/db.md`
- mkfast-template Storage 文档：`references/repos/mkfast-template/docs/storage.md`
- Better Auth Organization 文档快照：`references/docs/official/better-auth/organization.md`
- Cloudflare D1 limits：`references/docs/official/cloudflare/d1-limits.md`
- Cloudflare Workers limits：`references/docs/official/cloudflare/workers-limits.md`
- Cloudflare R2 docs：`references/docs/official/cloudflare/r2.md`

## 命名收敛

旧草案里有一些表名可以继续参考，但 P0 实现应该统一到当前术语：

| 旧名或模糊名 | P0 推荐名 | 原因 |
|---|---|---|
| `content_items` | `content_cores` | 与 `Content Core` 术语一致，强调平台中立内容母体 |
| `content_variants` | `platform_variants` | 与 `Platform Variant` 术语一致，强调平台适配 |
| `publishing_tasks` | `publish_jobs` | “job” 更适合状态机和执行记录 |
| `publishing_attempts` | `publish_attempts` | 与 `publish_jobs` 配套 |
| `compliance_results` | `compliance_checks` + `compliance_findings` | 合规不是单一结果，而是检查记录和风险项 |
| `accounts` | `platform_accounts` | 避免和 Better Auth/OAuth account 混淆 |
| `store_projects` | `store_services` | 美业“项目”实际是服务/价目项，英文表名用 service 更清楚 |
| `audit_logs` | `audit_events` | 记录事实事件，不只是日志文本 |

## 系统边界

### App Shell / D1

继续复用：

- Better Auth `user`、`session`、`account`、`verification`、`apikey`。
- admin 用户管理、登录注册、邮箱验证、API key。
- payment provider registry、checkout、customer portal 的壳层入口。
- R2 upload/proxy 机械能力。

不要新增：

- `workspaces`
- `stores`
- `assets`
- `content_cores`
- `platform_variants`
- `publish_packages`
- `publish_jobs`
- `lead_records`
- `usage_ledger_entries`
- `compliance_checks`
- `audit_events`

### Core API / Postgres

Core API 是以下事实来源：

- 租户、门店、成员、角色、权限。
- 门店档案、项目价目、禁忌话术、平台人设。
- 真实素材元数据、版本、授权、使用历史。
- 内容母体、平台变体、版本。
- 发布包、发布任务、发布尝试、平台结果。
- 线索台账、内容关联、周报。
- 用量预占、提交、退款、成本记录。
- 合规检查、风险项、AIGC 标识、人工确认。
- Agent 执行记录、工具调用、模型调用摘要。
- 审计事件。

### Agent Service / Mastra

Agent Service 可以保存执行态和调试态，但产品状态必须回写 Core API：

- 可以保存 workflow state、临时 memory、trace、eval 结果。
- 不能保存门店档案、价格、素材授权、内容版本、合规结论、发布状态、线索、用量余额。
- 所有写操作通过 Core API tool 完成，不能绕开权限和审计。

### R2 / Object Storage

R2 只存二进制对象：

- 原始素材。
- 处理后的素材版本。
- 生成封面、图文卡片、长图。
- 发布包导出文件。
- 授权凭证截图或文件。

R2 不保存产品事实。所有可查询、可授权、可审计的元数据都在 Postgres。

## 租户和权限模型

### P0 结构

```text
identity_user
  -> workspace_members
      -> workspaces
          -> stores
              -> store_profiles / store_services / assets / content / leads
```

P0 可以约束为一个 workspace 默认一个主 store，但仍保留 `stores` 表。这样不会提前做代运营复杂度，也不会把“门店”和“租户”永久绑死。

### 身份投影

如果 Better Auth 继续留在 D1，Core API 需要一个身份投影表：

| 表 | 作用 |
|---|---|
| `identity_users` | Core API 内部用户引用，映射 Better Auth user id |

建议字段：

- `id`
- `auth_provider`
- `auth_user_id`
- `email_normalized`
- `email_hash`
- `display_name`
- `avatar_url`
- `status`
- `last_synced_at`
- `created_at`
- `updated_at`

`identity_users` 不是登录表。登录、密码、OAuth、session 仍归 Better Auth。

### Workspace

| 表 | 作用 |
|---|---|
| `workspaces` | 租户、套餐、用量、成员和审计的最高业务边界 |
| `workspace_members` | 用户在 workspace 中的角色和状态 |
| `workspace_invitations` | 邀请记录 |
| `support_access_grants` | 内部客服/管理员临时访问授权 |

`workspaces` 建议字段：

- `id`
- `name`
- `slug`
- `status`: onboarding / active / suspended / archived
- `primary_store_id`
- `plan_code`
- `billing_customer_ref`
- `default_locale`
- `timezone`
- `created_by`
- `created_at`
- `updated_at`
- `archived_at`

`workspace_members` 建议字段：

- `workspace_id`
- `identity_user_id`
- `role`: owner / manager / creator / reviewer / viewer
- `status`: invited / active / disabled / removed
- `invited_by`
- `accepted_at`
- `created_at`
- `updated_at`

### 权限规则

P0 角色建议：

| 角色 | 能力 |
|---|---|
| owner | 成员、套餐、门店档案、素材、内容、发布包、线索、用量 |
| manager | 门店档案、素材、内容、发布包、线索 |
| creator | 创建和编辑内容，上传素材，生成发布包 |
| reviewer | 复核内容、合规提示、发布包确认 |
| viewer | 只读内容库、线索、报告 |

硬规则：

- Core API 每个请求必须带 `workspace_id` 和 actor。
- 所有产品查询都必须从 `workspace_members` 验证权限。
- `store_id` 必须属于当前 `workspace_id`。
- 普通用户不能 override `P0_BLOCK`。
- support/admin 访问必须通过 `support_access_grants` 并写 `audit_events`。
- 不以 shell 的 `session.user.role === "admin"` 直接授权产品数据访问。

## Store Workspace 和 Store Profile

### Store

| 表 | 作用 |
|---|---|
| `stores` | 一个实际门店或门店主页运营对象 |
| `store_profile_versions` | 门店档案快照 |
| `store_services` | 项目/服务项 |
| `store_service_prices` | 价格、活动和套餐证据 |
| `store_policies` | 禁忌话术、素材限制、折扣规则 |
| `store_personas` | 门店或账号语气人设 |

`stores` 建议字段：

- `id`
- `workspace_id`
- `display_name`
- `legal_name`
- `city`
- `district`
- `business_area`
- `address`
- `category`: nail / lash / hair / spa / life_beauty / mixed
- `non_medical_only`: true
- `status`
- `created_at`
- `updated_at`

`store_profile_versions` 是快照，不要只在 `stores` 上原地覆盖。原因是内容生成、合规检查、价格口径都要知道当时读取的是哪一版门店事实。

建议字段：

- `id`
- `store_id`
- `version_no`
- `profile_json`
- `source_type`: manual / import / agent_suggested / public_page
- `confirmed_by`
- `confirmed_at`
- `created_by`
- `created_at`

### Store Services And Prices

`store_services` 记录项目事实：

- `id`
- `workspace_id`
- `store_id`
- `name`
- `category`
- `description`
- `duration_minutes`
- `suitable_for`
- `contraindication_notes`
- `status`

`store_service_prices` 记录价格证据：

- `id`
- `workspace_id`
- `store_id`
- `service_id`
- `price_type`: standard / promo / package / coupon
- `amount_cents`
- `currency`
- `display_text`
- `price_source`: price_sheet / campaign_sheet / manual_input / platform_page
- `source_asset_id`
- `valid_from`
- `valid_until`
- `included_items`
- `excluded_items`
- `reservation_required`
- `store_scope`
- `inventory_or_quota`
- `confirmed_by`
- `confirmed_at`

生成含价格内容时，只能引用有效 `store_service_prices`。没有结构化价格证据时，系统只能写“可咨询门店确认价格/档期”。

## Platform Account 和 Capability

### Platform Account

| 表 | 作用 |
|---|---|
| `platform_accounts` | 门店在小红书、抖音、点评/美团、公众号等平台的账号 |
| `platform_account_credentials` | 凭据引用，不存明文 |
| `platform_account_capabilities` | 某账号已验证的能力 |
| `platform_capabilities` | 平台能力矩阵的全局版本 |
| `platform_capability_evidence` | 文档、账号测试、失败码证据 |

`platform_accounts` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `platform`: xiaohongshu / douyin / meituan_dianping / wechat_official_account
- `display_name`
- `handle`
- `homepage_url`
- `account_type`
- `persona_id`
- `auth_status`: none / pending / connected / expired / revoked / blocked
- `health_status`: unknown / normal / limited / login_required / risk
- `last_checked_at`
- `created_at`
- `updated_at`

`platform_account_credentials` 建议字段：

- `id`
- `workspace_id`
- `platform_account_id`
- `credential_type`: oauth_token / app_secret / cookie_ref / webhook_secret
- `secret_ref`
- `scope`
- `expires_at`
- `rotated_at`
- `revoked_at`
- `created_at`

凭据明文必须进入 secret manager/KMS，不进入 Postgres。

### Capability

`platform_capabilities` 是全局或版本化配置：

- `platform`
- `area`: publish / observe / engage / attribution
- `route_level`: L1 / L2 / L3
- `status`: manual-only / doc-only / blocked / verified / disabled
- `permission_name`
- `account_type`
- `last_doc_check_at`
- `evidence_links`
- `risk_notes`
- `fallback_route`

`platform_account_capabilities` 是账号级验证：

- `platform_account_id`
- `capability_id`
- `status`: untested / verified / failed / disabled
- `last_account_test_at`
- `last_success_at`
- `last_failure_code`
- `notes`

产品承诺只能读取账号级 `verified`。只有文档证据时，最多展示“可申请/待验证”，不能进入默认自动化承诺。

## Real Asset Library

### 表边界

| 表 | 作用 |
|---|---|
| `assets` | 素材主记录 |
| `asset_versions` | 原图、裁剪、压缩、排版、导出版本 |
| `asset_rights` | 授权和使用范围 |
| `asset_tags` | 标准标签 |
| `asset_tag_links` | 素材和标签关系 |
| `asset_embeddings` | 检索向量和描述 |
| `asset_usages` | 素材被内容、变体、发布包使用的记录 |

`assets` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `asset_type`: image / video / screenshot / document / generated_card / export_file
- `source_type`: merchant_upload / customer_provided / staff_shot / platform_screenshot / generated
- `title`
- `description`
- `capture_time`
- `original_asset_version_id`
- `current_asset_version_id`
- `is_ai_generated`
- `is_ai_synthesized`
- `status`: active / needs_review / blocked / archived
- `created_by`
- `created_at`
- `updated_at`

`asset_versions` 建议字段：

- `id`
- `workspace_id`
- `asset_id`
- `version_no`
- `storage_provider`: r2
- `storage_key`
- `mime_type`
- `size_bytes`
- `width`
- `height`
- `duration_ms`
- `content_hash`
- `perceptual_hash`
- `transform_type`: original / crop / compress / retouch / layout / label_injected
- `created_by`
- `created_at`

`asset_rights` 采用合规方案中的字段：

- `rights_owner`
- `consent_status`: unknown / pending / granted / revoked / not_required
- `consent_scope`: internal_reference / publish_package / public_marketing / paid_ads
- `consent_evidence_asset_id`
- `contains_person`
- `contains_sensitive_personal_info`
- `minor_involved`
- `redaction_status`
- `expires_at`
- `revoked_at`

硬规则：

- 未授权顾客素材不能进入公开导出或发布包。
- 未成年人素材不进入 P0 公开营销。
- 好评截图默认要求脱敏。
- 授权撤回后，新内容禁止使用；已发布内容进入下架/替换提醒。

## Content Core

### 表边界

| 表 | 作用 |
|---|---|
| `content_cores` | 平台中立内容母体 |
| `content_core_versions` | 内容母体不可变版本 |
| `content_asset_links` | 内容与素材版本关系 |
| `content_topics` | 可选，选题池和计划 |

`content_cores` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `title`
- `objective`: awareness / consultation / appointment / coupon / retention
- `content_type`: note / short_video_script / service_intro / campaign / review_reuse
- `lifecycle_status`: draft / checking / ready / packaged / published / archived
- `commercial_intent`: true/false
- `current_version_id`
- `source_agent_run_id`
- `created_by`
- `created_at`
- `updated_at`

`content_core_versions` 建议字段：

- `id`
- `workspace_id`
- `content_core_id`
- `version_no`
- `store_profile_version_id`
- `brief`
- `key_message`
- `body_outline`
- `cta`
- `service_refs`
- `price_refs`
- `generation_context_hash`
- `created_by`
- `created_at`

每个版本保存的是生成时的结构化事实引用，而不是只保存最终文案。这样合规、价格、素材来源和后续回放才可审计。

## Platform Variant

### 表边界

| 表 | 作用 |
|---|---|
| `platform_variants` | 平台版本主记录 |
| `platform_variant_versions` | 平台文案、脚本、封面文案版本 |
| `variant_asset_links` | 平台版本使用的素材版本 |

`platform_variants` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `content_core_id`
- `platform`
- `platform_account_id`
- `variant_type`: xhs_note / douyin_script / dianping_service_intro / wechat_article
- `status`: draft / checking / needs_review / ready / packaged / published / archived
- `current_version_id`
- `latest_compliance_check_id`
- `created_at`
- `updated_at`

`platform_variant_versions` 建议字段：

- `id`
- `workspace_id`
- `platform_variant_id`
- `version_no`
- `title`
- `body`
- `hashtags`
- `cover_text`
- `image_order`
- `video_script`
- `shot_list`
- `manual_publish_notes`
- `platform_constraints_snapshot`
- `created_by`
- `created_at`

规则：

- 平台版本生成后必须过 `Compliance Gate`。
- 用户改标题、正文、价格、图片顺序、脚本，都生成新版本并重新检查。
- 小红书、抖音、点评/美团、公众号的文案格式差异放在版本字段和 Beauty Skill Pack，不在 Content Core 中混写。

## Publish Package 和 Publish Job

### 表边界

| 表 | 作用 |
|---|---|
| `publish_packages` | L3 或 L1/L2 前置交付包 |
| `publish_package_artifacts` | 导出文本、图片、视频、zip、清单 |
| `publish_package_steps` | 人工发布 checklist |
| `publish_jobs` | 发布状态机 |
| `publish_attempts` | L1/L2 提交或观测尝试 |
| `publish_observations` | 发布链接、平台状态、指标快照 |

`publish_packages` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `platform_variant_id`
- `platform`
- `route_level`: L1 / L2 / L3
- `status`: draft / compliance_checked / package_ready / user_confirmed / exported / submitted / closed / failed
- `compliance_check_id`
- `aigc_label_record_id`
- `created_by`
- `created_at`
- `updated_at`

`publish_package_artifacts` 建议字段：

- `id`
- `workspace_id`
- `publish_package_id`
- `artifact_type`: text / image / video / checklist / zip
- `asset_version_id`
- `storage_key`
- `content_hash`
- `explicit_label_status`
- `implicit_label_status`
- `created_at`

`publish_jobs` 状态机：

```text
generated
  -> compliance_checked
  -> package_ready
  -> user_confirmed
  -> submitted
  -> observed
  -> closed
```

L3 可以停在 `package_ready` 或 `user_confirmed`。只有账号能力为 `verified` 的 L1 才能进入 `submitted`。

`publish_attempts` 必须记录：

- `route_level`
- `executor`: manual / official_api / browser_assist
- `request_hash`
- `response_hash`
- `external_item_id`
- `external_url`
- `status`
- `failure_code`
- `failure_reason`
- `downgraded_to_package_id`

## Lead Ledger

### 表边界

| 表 | 作用 |
|---|---|
| `lead_records` | 线索主记录 |
| `lead_content_links` | 线索和内容/发布结果的关联 |
| `lead_followups` | 跟进状态变化 |
| `weekly_reports` | 内容和线索周报 |

`lead_records` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `platform`
- `platform_account_id`
- `lead_type`: comment / dm / wechat_add / appointment / coupon_claim / redemption / store_visit
- `source_type`: manual / platform_import / webhook / support_entry
- `occurred_at`
- `customer_alias`
- `contact_hash`
- `service_id`
- `amount_cents`
- `followup_status`: new / contacted / booked / redeemed / lost / ignored
- `notes_redacted`
- `created_by`
- `created_at`
- `updated_at`

`lead_content_links` 建议字段：

- `lead_id`
- `content_core_id`
- `platform_variant_id`
- `publish_package_id`
- `publish_job_id`
- `link_source`: manual / share_id / url_match / coupon_code / platform_callback
- `confidence`: exact / likely / weak
- `created_at`

隐私规则：

- P0 不默认保存手机号、微信号等明文个人信息。
- 如果业务必须保存联系方式，必须单独做加密字段、授权记录、访问审计和删除流程。
- 周报用聚合数据和脱敏备注，不把顾客隐私扩散到 Agent Memory。

## Usage Ledger

### 表边界

| 表 | 作用 |
|---|---|
| `plans` | 套餐定义 |
| `workspace_subscriptions` | workspace 当前套餐状态投影 |
| `quota_balances` | 当前额度缓存 |
| `usage_reservations` | 运行中的预占 |
| `usage_ledger_entries` | 额度流水 |
| `provider_cost_entries` | 模型、渲染、平台调用成本 |
| `billing_event_refs` | payment webhook 或发票事件引用 |

原则：

```text
reserve before run
commit after success
refund on cancel/failure
adjust only by auditable admin action
```

`usage_ledger_entries` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `entry_type`: reserve / commit / refund / adjust / expire
- `usage_unit`: content_generation / platform_variant / image_render / publish_package / l2_assist / model_token / storage_gb
- `quantity`
- `related_reservation_id`
- `related_agent_run_id`
- `related_content_core_id`
- `related_publish_package_id`
- `idempotency_key`
- `reason`
- `created_by`
- `created_at`

`provider_cost_entries` 建议字段：

- `id`
- `workspace_id`
- `agent_run_id`
- `tool_call_id`
- `provider`
- `model`
- `input_tokens`
- `output_tokens`
- `image_count`
- `duration_ms`
- `cost_amount`
- `cost_currency`
- `status`
- `failure_reason`
- `created_at`

不要从 payment `paid=true` 直接推导权益。payment 是收款事实，Usage Ledger 是产品消耗事实。

## Compliance Gate

合规表沿用 `06-compliance-implementation-plan.md`：

| 表 | 作用 |
|---|---|
| `compliance_rule_sets` | 规则集版本 |
| `compliance_checks` | 检查记录 |
| `compliance_findings` | 风险项 |
| `aigc_label_records` | 显式/隐式标识记录 |
| `asset_rights` | 素材授权 |
| `user_confirmations` | 用户确认和风险接受记录 |
| `compliance_review_tasks` | 人工复核队列 |

检查目标必须支持：

- asset
- asset_version
- content_core
- content_core_version
- platform_variant
- platform_variant_version
- publish_package
- publish_job

硬规则：

- 保存 Content Core 前检查意图和 Regulated Content Mode 触发项。
- 保存 Platform Variant 前检查广告、价格、平台文案和受监管内容核验提醒。
- 导出图片/视频/发布包前检查 AIGC 标识和素材授权。
- 平台提交前检查账号能力、用户确认、合规状态有效期。
- `P0_BLOCK` 不可由普通用户 override。

## Beauty Skill Pack

### 表边界

| 表 | 作用 |
|---|---|
| `beauty_skill_packs` | 垂类能力包主记录 |
| `beauty_skill_pack_versions` | prompt、模板、规则和样例版本 |
| `prompt_templates` | 生成、改写、平台适配 prompt |
| `content_templates` | 场景模板 |
| `example_sets` | few-shot 或案例样本 |
| `eval_sets` | 评测集版本 |

`Beauty Skill Pack` 是可运营资产，不是代码里的散 prompt。

P0 最少需要：

- 小红书笔记模板。
- 抖音口播脚本模板。
- 点评/美团项目介绍模板。
- 公众号/私域短文模板。
- Regulated Content Mode 和发布前核验规则引用。
- 价格和素材授权规则引用。
- 20 到 50 条内部 eval 样本；合规专项按 06 方案扩到 120 条。

## Agent Runs 和 Tool Calls

### 表边界

| 表 | 作用 |
|---|---|
| `agent_runs` | 一次副驾任务 |
| `agent_workflow_steps` | workflow 步骤状态 |
| `tool_calls` | 工具调用记录 |
| `model_calls` | 模型调用摘要 |
| `agent_run_events` | 流式进度和用户可见事件 |

`agent_runs` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `run_type`: generate_weekly_content / rewrite_content / create_publish_package / weekly_report
- `status`: queued / running / waiting_user / succeeded / failed / cancelled
- `requested_by`
- `input_hash`
- `output_hash`
- `usage_reservation_id`
- `source_skill_pack_version_id`
- `started_at`
- `ended_at`
- `created_at`

`tool_calls` 建议字段：

- `id`
- `workspace_id`
- `agent_run_id`
- `workflow_step_id`
- `tool_name`
- `input_hash`
- `output_hash`
- `status`
- `requires_approval`
- `approved_by`
- `duration_ms`
- `error_code`
- `created_at`

工具调用只能通过 Core API 修改产品数据。Agent 不能直接写业务表。

## Audit Events

### 表边界

| 表 | 作用 |
|---|---|
| `audit_events` | 产品审计事件 |

`audit_events` 建议字段：

- `id`
- `workspace_id`
- `store_id`
- `actor_type`: user / agent / system / support_admin / platform
- `actor_id`
- `action`
- `target_type`
- `target_id`
- `target_version_id`
- `before_hash`
- `after_hash`
- `risk_level`
- `ip_address_hash`
- `user_agent_hash`
- `correlation_id`
- `created_at`

必须写审计的动作：

- workspace/member/role 变更。
- store profile、service、price、policy 变更。
- asset 上传、版本生成、授权变更、删除/归档。
- content core、platform variant 的创建和版本变更。
- compliance check、finding 处理、人工确认。
- AIGC label 注入、导出、复制、发布包生成。
- publish job 状态变化、平台提交、失败、降级。
- lead 创建、状态变化、内容关联。
- usage reserve、commit、refund、adjust。
- platform credential 创建、旋转、撤销。
- support/admin 访问。

保留策略：

- 普通草稿可以软删除。
- audit、usage ledger、compliance、publish attempts 不硬删除。
- 广告和发布相关记录默认保留不少于 3 年。
- 如果未来支持无显式标识例外，相关日志至少保留 6 个月；P0 不开放该能力。

## P0 表分组

### 第一批必须实现

先实现能跑通创作闭环的最小表：

- `identity_users`
- `workspaces`
- `workspace_members`
- `stores`
- `store_profile_versions`
- `store_services`
- `store_service_prices`
- `store_policies`
- `store_personas`
- `platform_accounts`
- `platform_capabilities`
- `platform_account_capabilities`
- `assets`
- `asset_versions`
- `asset_rights`
- `asset_tags`
- `asset_tag_links`
- `asset_usages`
- `content_cores`
- `content_core_versions`
- `content_asset_links`
- `platform_variants`
- `platform_variant_versions`
- `variant_asset_links`
- `publish_packages`
- `publish_package_artifacts`
- `publish_package_steps`
- `publish_jobs`
- `compliance_rule_sets`
- `compliance_checks`
- `compliance_findings`
- `aigc_label_records`
- `user_confirmations`
- `usage_reservations`
- `usage_ledger_entries`
- `provider_cost_entries`
- `agent_runs`
- `tool_calls`
- `audit_events`

### 第二批可延后

- `workspace_invitations`
- `support_access_grants`
- `asset_embeddings`
- `publish_attempts`
- `publish_observations`
- `lead_records`
- `lead_content_links`
- `lead_followups`
- `weekly_reports`
- `beauty_skill_packs`
- `beauty_skill_pack_versions`
- `prompt_templates`
- `content_templates`
- `eval_sets`
- `model_calls`
- `agent_workflow_steps`
- `agent_run_events`

说明：线索台账是 P0 价值闭环，但可以在内容生成和发布包跑通后作为下一批实施；表设计不能等到上线后再补，否则内容到线索的关联会丢。

## 索引和约束建议

通用字段：

- 所有租户表都有 `workspace_id`。
- 门店表都有 `store_id`。
- 版本表有 `version_no`。
- 软删除使用 `archived_at` 或 `deleted_at`。
- 高风险写操作使用 `idempotency_key`。
- 外部平台对象保存 `external_id` 和 `external_url`，但不能作为唯一事实。

关键唯一约束：

- `workspace_members(workspace_id, identity_user_id)`
- `stores(workspace_id, display_name)` 可按需要宽松处理
- `platform_accounts(workspace_id, platform, handle)`
- `content_core_versions(content_core_id, version_no)`
- `platform_variant_versions(platform_variant_id, version_no)`
- `asset_versions(asset_id, version_no)`
- `usage_ledger_entries(workspace_id, idempotency_key)`

关键索引：

- `assets(workspace_id, store_id, asset_type, status)`
- `content_cores(workspace_id, store_id, lifecycle_status, updated_at)`
- `platform_variants(workspace_id, platform, status, updated_at)`
- `publish_jobs(workspace_id, status, platform, updated_at)`
- `lead_records(workspace_id, store_id, occurred_at)`
- `compliance_checks(workspace_id, target_type, target_id, checked_at)`
- `audit_events(workspace_id, target_type, target_id, created_at)`
- `usage_ledger_entries(workspace_id, created_at)`

## API 边界

Core API 首批 endpoint 可以按领域分组：

```text
GET/POST /workspaces
GET/POST /workspaces/:workspace_id/members
GET/PUT /stores/:store_id/profile
GET/POST /stores/:store_id/services
GET/POST /assets
GET/POST /content-cores
GET/POST /content-cores/:id/platform-variants
POST /compliance/checks
POST /publish-packages
POST /publish-jobs/:id/confirm
POST /usage/reserve
POST /usage/commit
POST /usage/refund
GET/POST /leads
GET /audit-events
```

Agent Service 不应该暴露底层 Mastra `/agents`、`/workflows`、`/tools` 给商家端。它只暴露产品语义：

```text
POST /agent-runs/generate-weekly-content
POST /agent-runs/rewrite-content
POST /agent-runs/create-publish-package
GET  /agent-runs/:agent_run_id
POST /agent-runs/:agent_run_id/cancel
```

## 验收标准

数据模型验收：

1. 一个 seeded workspace/store 可以通过 Core API 被已认证 shell user 读取。
2. workspace membership check 发生在 Core API。
3. 一个真实素材上传后，R2 有对象，Postgres 有 asset、asset_version、asset_rights。
4. 一次生成任务可以 reserve usage，失败 refund，成功 commit。
5. 一条 Content Core 能生成至少两个 Platform Variant，并保留版本。
6. Platform Variant 保存前必须产生 compliance check。
7. Publish Package 导出前必须有 AIGC label record 和 compliance summary。
8. L3 Publish Package 不依赖任何平台账号验证。
9. 普通用户不能发布或导出 `P0_BLOCK` 内容。
10. 每个影响合规、发布、用量、线索的写操作都有 audit event。

## 实施顺序

1. 建 Core API/Postgres skeleton 和 Drizzle pg schema。
2. 做 `identity_users`、`workspaces`、`workspace_members`、`stores`。
3. 接 app-shell session 到 Core API，完成 membership check。
4. 建 Real Asset Library：R2 object + `assets` / `asset_versions` / `asset_rights`。
5. 建 Store Profile：`store_profile_versions` / `store_services` / `store_service_prices`。
6. 建 Usage Ledger：reserve / commit / refund。
7. 建 Content Core 和 Platform Variant 版本表。
8. 接 Compliance Gate 表并在保存前强制检查。
9. 建 Publish Package 和 L3 导出。
10. 建 Agent runs/tool calls 的最小记录。
11. 加 Lead Ledger 和 weekly report。
12. 再做 L1/L2 publish route POC，不先绕过数据模型。

## 决策

P0 采用如下事实来源：

```text
Better Auth / D1
  identity/session only

Core API / Postgres
  product facts, authorization, ledgers, compliance, audit

Agent Service / Mastra
  workflow execution only

R2
  binary object storage only
```

这一路线比“全部塞进模板 D1”更慢一点，但能避免后期最难拆的风险：租户权限、合规、发布、线索、用量账本和审计分散在不可回放的壳层 server functions 里。
