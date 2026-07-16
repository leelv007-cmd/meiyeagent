# 美业内容副驾 P0 数据模型与 API 合同规格

> 状态：历史快照（2026-07-07）。当前 P1 与 ContentPackage 口径以 [`CONTEXT.md`](../../../CONTEXT.md)、[`docs/specs/beauty-content-agent-p1-spec.md`](../../../docs/specs/beauty-content-agent-p1-spec.md)、[`docs/specs/contentpackage-productization-spec.md`](../../../docs/specs/contentpackage-productization-spec.md)、最新 ADR 和当前代码/测试为准；本文只保留 P0 合同证据，不覆盖后续成品事实源决策。

日期：2026-07-07

类型：Core API / Postgres contract

相关资料：
- `合集-v1.2-含开源项目选型.md`
- `references/product/reports/p0-product-ia-workflow-blueprint.md`
- `references/creatok/reports/creatok-productization-architecture-gap-analysis.md`
- `references/creatok/notes/technical-surface.md`

## 1. 合同目标

本规格把 P0 页面蓝图和工作流落到 Core API/Postgres 的事实模型。

P0 必须支持：
- 门店档案和项目价目。
- 真实素材库和素材权利。
- 内容母体、平台变体、版本。
- 合规 gate 和 Publish Compliance Preflight。
- L3 发布包、verified L1 发布任务；L2 浏览器辅助仅保留为 P1+ 枚举/迁移预留，P0 路由不得选择 L2。
- 线索台账和内容关联。
- 视频成片：AIDA 分镜、首帧/片段、薄合成壳、AIGC 标识烧录、视频 artifact、存相册 / 发布包交接。
- 最小额度账本事件：reserve / commit / refund；完整 provider cost 账本为 Go 后 / P1+。
- Agent run、tool call、durable job 和 audit event。

P0 不把完整图文渲染管线、周报自动化、完整 provider cost 账本、L2 浏览器辅助、平台凭据保险库、重编辑时间线或数字人口播纳入必交付；这些属于 Go 后 / P1+ 合同。

设计原则：
- 所有产品事实归 Core API/Postgres。
- App Shell 只做 UI、session、settings、billing entry 和上传/proxy 机械能力。
- `ai-runner` 不直接改业务表，只通过 Core API tools。
- `renderer/jobs` 不判断权限、不扣费、不决定合规。
- R2 只存二进制对象，object key 不是权限、授权、合规或发布事实。

## 2. 服务事实归属

| 层 | 可以拥有 | 不得拥有 |
| --- | --- | --- |
| App Shell | UI route、Better Auth session、settings view、billing entry、typed BFF adapter、upload/proxy mechanics | Store Workspace、内容、素材权利、合规、发布、线索、用量事实 |
| Core API / Postgres | workspace、store、asset metadata、content、compliance、publish、lead、usage、agent run、tool call、audit、durable job | provider secret 明文、二进制文件本体、不可审计的外部动作 |
| ai-runner 模块 | workflow execution、LLM/tool orchestration、stream events、临时推理上下文 | 直接写业务事实、直接扣费、直接发布、直接访问凭据明文 |
| renderer/jobs 模块 | 视频合成、转码、AIGC 标识烧录、截图 QA、发布包导出、对象处理 job execution | 权限、合规结论、发布路线、用量扣费 |
| R2 | original assets、video artifacts、rendered artifacts、publish package exports、consent evidence files | metadata、rights、workspace authorization、compliance status、publish status |

## 3. 全局约定

### 3.1 基础字段

除只读字典表外，Core API 业务表默认包含：

| 字段 | 说明 |
| --- | --- |
| `id` | ULID/UUID |
| `workspace_id` | 租户隔离主键，必须出现在所有产品事实表 |
| `store_id` | 门店范围，适用于门店域对象 |
| `created_at` / `updated_at` | 时间戳 |
| `created_by_user_id` / `updated_by_user_id` | 操作用户 |
| `deleted_at` | 软删除，P0 对素材和内容保留 |
| `correlation_id` | 跨 agent/job/tool/audit 追踪 |

### 3.2 API envelope

Core API 返回统一 envelope：

```json
{
  "code": "OK",
  "msg": "ok",
  "data": {},
  "meta": {
    "request_id": "req_...",
    "correlation_id": "corr_...",
    "idempotency_key": "idem_..."
  }
}
```

错误返回：

```json
{
  "code": "COMPLIANCE_BLOCKED",
  "msg": "内容包含硬停止风险，不能生成发布包",
  "error": {
    "details": {}
  },
  "meta": {
    "request_id": "req_...",
    "correlation_id": "corr_..."
  }
}
```

说明：CreatOK 前端可见的 app API 使用 `{ code, msg, data }` 形态；我方 Core API 保留同类 envelope，但 `code` 使用稳定字符串，便于前端、BFF 和 ai-runner 统一处理。

### 3.3 幂等

以下操作必须支持 `Idempotency-Key`：
- 创建 agent run。
- 创建 durable job。
- 创建 content item / variant / version。
- 创建视频成片任务。
- 生成图文套图（Go 后 / P1+）。
- 创建发布包。
- 创建发布任务。
- usage reserve / commit / refund。
- worker job result callback。

幂等冲突返回 `IDEMPOTENCY_CONFLICT`，不得重复扣费或重复创建发布任务。

## 4. 核心状态枚举

### 4.1 ContentStatus

```text
draft
review_required
ready_to_package
package_created
published
needs_manual_action
failed
archived
```

### 4.2 VariantStatus

```text
draft
ready_for_review
ready_to_package
package_created
published
archived
```

### 4.3 ComplianceStatus

```text
unchecked
pass
warning
regulated_preflight_required
blocked
manually_confirmed
```

### 4.4 PublishRoute

```text
L1_OFFICIAL
L3_HANDOFF_PACKAGE
```

P1+ 预留：`L2_BROWSER_ASSIST`。P0 schema、seed 和 resolver 不得把它作为可选路线。

### 4.5 PublishTaskStatus

```text
preparing
compliance_pending
confirmation_pending
handoff_ready
publishing
published
manual_required
failed
archived
```

### 4.6 UsageEntryStatus

```text
estimated
reserved
committed
refunded
failed_no_charge
expired
```

### 4.7 JobStatus

```text
draft
queued
running
waiting_for_approval
completed
failed
cancelled
refunded
```

### 4.8 AgentRunStatus

```text
created
running
waiting_for_user
completed
failed
cancelled
```

### 4.9 LeadStatus

```text
new
contacted
booked
redeemed
lost
invalid
```

### 4.10 AssetRightsStatus

```text
unknown
pending_confirmation
confirmed
restricted
not_allowed
expired
```

## 5. 数据模型

### 5.1 Workspace 与成员

#### `workspaces`

门店空间或未来 agency/client 空间。

关键字段：
- `id`
- `name`
- `type`: `single_store` / `agency` / `client_store`
- `status`: `onboarding` / `active` / `suspended` / `churn_risk`
- `plan_id`
- `created_at`

索引：
- `(status, updated_at)`
- `(type, status)`

#### `workspace_members`

关键字段：
- `workspace_id`
- `user_id`
- `role`: `owner` / `operator` / `reviewer` / `admin`
- `status`: `active` / `invited` / `disabled`

索引：
- unique `(workspace_id, user_id)`
- `(user_id, status)`

### 5.2 门店档案

#### `stores`

关键字段：
- `workspace_id`
- `name`
- `city`
- `district`
- `business_area`
- `address`
- `store_type`
- `appointment_methods` JSONB
- `selling_points` JSONB
- `forbidden_claims` JSONB
- `price_list_version`
- `profile_status`: `draft` / `needs_confirmation` / `confirmed`

索引：
- `(workspace_id, profile_status)`
- GIN `selling_points`

#### `store_projects`

项目/服务/价目。

关键字段：
- `store_id`
- `name`
- `category`
- `price_min`
- `price_max`
- `duration_minutes`
- `suitable_for`
- `contraindications`
- `notes`
- `regulated_flag`
- `confirmed_at`

索引：
- `(workspace_id, store_id, category)`
- `(workspace_id, regulated_flag)`

#### `personas`

门店或账号语气。

关键字段：
- `store_id`
- `scope`: `store` / `account` / `scenario`
- `name`
- `tone`
- `style_rules` JSONB
- `blocked_phrases` JSONB

索引：
- `(workspace_id, store_id, scope)`

### 5.3 账号能力

#### `accounts`

平台账号，不直接存明文凭据。

关键字段：
- `store_id`
- `platform`: `xiaohongshu` / `douyin` / `dianping` / `wechat` / `other`
- `display_name`
- `profile_url`
- `persona_id`
- `auth_status`: `not_connected` / `connected` / `expired` / `revoked` / `manual_only`
- `health_status`: `normal` / `needs_login` / `limited` / `unknown`

索引：
- `(workspace_id, store_id, platform)`
- `(workspace_id, auth_status, health_status)`

#### `account_capabilities`（Go 后 / P1+ full matrix）

账号级能力矩阵。P0 只记录账号基础信息与 account-level verified 边界验证；完整 Publish / Observe / Engage / Attribution 能力矩阵为 Go 后 / P1+。

关键字段：
- `account_id`
- `capability`: `publish_text` / `publish_image` / `publish_video` / `read_metrics` / `read_comments` / `reply`
- `route`: `L1_OFFICIAL` / `L3_HANDOFF_PACKAGE`
- `status`: `unverified` / `verified` / `disabled` / `unsupported`
- `verified_at`
- `evidence_url`
- `notes`

索引：
- unique `(account_id, capability, route)`
- `(workspace_id, status, route)`

说明：`L2_BROWSER_ASSIST` 是 P1+ 兼容枚举，不是 P0 可选路线；P0 账号能力种子不得把任何能力标为 L2 verified。

#### `account_credentials`（P1+，不进 P0）

P0 不托管任何平台凭据；本表仅作为 P1+ 重启云端 L2 或深度平台接入时的设计占位。

关键字段：
- `account_id`
- `provider`
- `secret_ref`
- `status`
- `expires_at`
- `last_rotated_at`

索引：
- `(workspace_id, account_id, status)`

### 5.4 素材库

#### `assets`

R2 对象的业务 metadata。

关键字段：
- `store_id`
- `asset_type`: `image` / `video` / `document` / `screenshot` / `export`
- `source_type`: `user_upload` / `ai_generated` / `imported` / `store_doc` / `publish_export`
- `object_key`
- `thumbnail_key`
- `checksum`
- `mime_type`
- `size_bytes`
- `asset_status`: `active` / `pending_review` / `quarantined` / `archived` / `deleted`
- `project_id`
- `platform_hint` array
- `usage_hint` array
- `rights_status`
- `sensitivity`: `normal` / `before_after` / `medical_or_aesthetic` / `minor` / `face_visible`
- `aigc_status`: `not_ai` / `ai_assisted` / `ai_generated`
- `compliance_status`
- `used_count`
- `metadata` JSONB

索引：
- unique `(object_key)`
- `(workspace_id, checksum)`
- `(workspace_id, store_id, asset_type, created_at desc)`
- `(workspace_id, project_id)`
- `(workspace_id, rights_status, sensitivity)`
- `(workspace_id, compliance_status)`
- GIN `(platform_hint)`
- GIN `(usage_hint)`

#### `asset_tags`

关键字段：
- `asset_id`
- `tag_type`: `project` / `style` / `usage` / `platform` / `compliance`
- `tag_value`
- `confidence`
- `created_by`: `user` / `agent` / `system`

索引：
- `(workspace_id, tag_type, tag_value)`
- `(asset_id, tag_type)`

#### `asset_usages`

记录素材被内容、图文、发布包使用。

关键字段：
- `asset_id`
- `target_type`: `content_item` / `content_variant` / `publish_package`
- `target_id`
- `usage_role`: `cover` / `case` / `process` / `background` / `evidence`

索引：
- `(workspace_id, asset_id)`
- `(workspace_id, target_type, target_id)`

#### `asset_rights_evidence`

顾客授权或资质证据。

关键字段：
- `asset_id`
- `evidence_type`: `customer_consent` / `license` / `ad_review` / `source_proof`
- `object_key`
- `status`: `pending` / `confirmed` / `rejected` / `expired`
- `confirmed_by_user_id`
- `confirmed_at`

索引：
- `(workspace_id, asset_id, status)`
- `(workspace_id, evidence_type, status)`

### 5.5 内容模型

#### `content_items`

内容母体。

关键字段：
- `store_id`
- `project_id`
- `scenario`: `case_seed` / `promotion` / `education` / `review` / `local_traffic` / `daily_story`
- `title`
- `core_angle`
- `conversion_hook`
- `status`
- `source_agent_run_id`
- `compliance_status`
- `latest_variant_id`

索引：
- `(workspace_id, store_id, status, updated_at desc)`
- `(workspace_id, project_id, scenario)`
- `(workspace_id, compliance_status)`

#### `content_variants`

平台变体。

关键字段：
- `content_item_id`
- `platform`
- `account_id`
- `title`
- `body`
- `hashtags` array
- `cta`
- `cover_text`
- `visual_plan` JSONB
- `video_storyboard` JSONB
- `video_artifact_id`
- `platform_rules_version`
- `status`
- `compliance_status`
- `aigc_status`
- `current_version_id`

索引：
- `(workspace_id, content_item_id, platform)`
- `(workspace_id, platform, status)`
- `(workspace_id, compliance_status)`

#### `content_versions`

改稿版本。

关键字段：
- `content_variant_id`
- `version_no`
- `title`
- `body`
- `structured_payload` JSONB
- `change_reason`
- `created_by`: `user` / `agent`
- `agent_run_id`

索引：
- unique `(content_variant_id, version_no)`
- `(workspace_id, content_variant_id, created_at desc)`

#### `content_asset_links`

内容到素材。

关键字段：
- `content_item_id`
- `content_variant_id`
- `asset_id`
- `role`
- `sort_order`

索引：
- `(workspace_id, content_item_id)`
- `(workspace_id, asset_id)`

#### `video_artifacts`

P0 视频成片产物。视频文件本体在对象存储，业务事实和合规/用量关联留在 Postgres。

关键字段：
- `content_item_id`
- `content_variant_id`
- `agent_run_id`
- `durable_job_id`
- `storyboard` JSONB
- `first_frame_manifest` JSONB
- `clip_manifest` JSONB
- `compose_manifest` JSONB
- `object_key`
- `duration_seconds`
- `aspect_ratio`
- `provider`
- `model`
- `quota_reservation_id`
- `aigc_label_burned_in`
- `metadata_written`
- `compliance_result_id`
- `status`: `queued` / `running` / `needs_action` / `completed` / `failed` / `archived`

索引：
- `(workspace_id, content_item_id, created_at desc)`
- `(workspace_id, agent_run_id)`
- `(workspace_id, status, updated_at desc)`

### 5.6 合规

#### `compliance_results`

统一记录创作合规、图文合规、发布前预检。

关键字段：
- `target_type`: `asset` / `content_item` / `content_variant` / `publish_package`
- `target_id`
- `check_type`: `creative_gate` / `asset_check` / `publish_preflight`
- `status`
- `regulated_mode_triggered`
- `risk_level`: `low` / `medium` / `high` / `blocked`
- `issues` JSONB
- `suggested_rewrites` JSONB
- `ruleset_version`
- `model_provider`
- `checked_by`: `system` / `agent` / `user`

索引：
- `(workspace_id, target_type, target_id, created_at desc)`
- `(workspace_id, status, risk_level)`
- `(workspace_id, regulated_mode_triggered)`

#### `publish_preflight_confirmations`

提醒展示与必要确认记录。医美/医疗资质准入轻量版默认记录提醒已展示；只有行为红线或 L1 官方提交等高风险动作才需要显式确认。

关键字段：
- `compliance_result_id`
- `confirmed_by_user_id`
- `confirmation_items` JSONB
- `notes`
- `confirmed_at`

索引：
- `(workspace_id, compliance_result_id)`
- `(workspace_id, confirmed_by_user_id, confirmed_at desc)`

### 5.7 发布包与发布任务

#### `publish_packages`

L3 包和 verified L1 任务使用的统一包；L2 不进入 P0。

关键字段：
- `content_variant_id`
- `account_id`
- `platform`
- `route`
- `package_status`: `draft` / `compliance_pending` / `confirmation_pending` / `ready` / `exported` / `expired` / `archived`
- `copy_payload` JSONB
- `asset_manifest` JSONB
- `instructions` JSONB
- `aigc_label_status`
- `compliance_result_id`
- `export_object_key`

索引：
- `(workspace_id, content_variant_id)`
- `(workspace_id, platform, route, package_status)`
- partial current package index on `(content_variant_id)` where `package_status in ('ready', 'exported')`

#### `publish_tasks`

发布任务状态。

关键字段：
- `publish_package_id`
- `content_variant_id`
- `account_id`
- `platform`
- `route`
- `status`
- `scheduled_at`
- `published_at`
- `platform_url`
- `failure_reason`
- `manual_notes`

索引：
- `(workspace_id, status, updated_at desc)`
- `(workspace_id, platform, route, status)`
- `(workspace_id, content_variant_id)`

#### `publish_attempts`

每次尝试和降级记录。

关键字段：
- `publish_task_id`
- `route`
- `attempt_no`
- `status`: `started` / `succeeded` / `failed` / `downgraded`
- `error_code`
- `error_detail`
- `downgraded_to_route`
- `started_at`
- `ended_at`

索引：
- `(workspace_id, publish_task_id, attempt_no)`
- `(workspace_id, route, status)`

### 5.8 线索与周报

#### `leads`

P0 人工登记为主。

关键字段：
- `store_id`
- `source_platform`
- `source_type`: `manual` / `platform_metric` / `imported`
- `lead_type`: `dm` / `comment` / `wechat_add` / `booking` / `coupon` / `redeem` / `visit`
- `project_id`
- `amount`
- `status`
- `customer_alias`
- `contact_hash`
- `occurred_at`
- `notes`
- `created_by_user_id`

索引：
- `(workspace_id, store_id, occurred_at desc)`
- `(workspace_id, status, occurred_at desc)`
- `(workspace_id, project_id)`

#### `lead_content_links`

关键字段：
- `lead_id`
- `content_item_id`
- `content_variant_id`
- `link_confidence`: `manual` / `inferred`
- `notes`

索引：
- `(workspace_id, lead_id)`
- `(workspace_id, content_item_id)`
- `(workspace_id, content_variant_id)`

#### `weekly_reports`（Go 后 / P1+ reserved）

自动周报不进 P0 Slice。P0 只做手工线索台账与人工洞察；本表为 Go 后把人工洞察产品化时的预留合同。

关键字段：
- `store_id`
- `week_start`
- `week_end`
- `summary` JSONB
- `content_count`
- `lead_count`
- `booking_count`
- `redeem_count`
- `suggested_topics` JSONB
- `material_gaps` JSONB
- `generated_by_agent_run_id`

索引：
- unique `(workspace_id, store_id, week_start)`

### 5.9 用量与套餐

#### `subscriptions`

关键字段：
- `workspace_id`
- `plan_code`
- `status`
- `billing_provider`
- `billing_customer_ref`
- `current_period_start`
- `current_period_end`

索引：
- `(workspace_id, status)`

#### `quota_balances`

关键字段：
- `workspace_id`
- `quota_type`: P0 为 `content` / `video` / `publish_package` / `storage`；Go 后 / P1+ 预留 `graphic` / `account_pack`
- `limit_amount`
- `used_amount`
- `reserved_amount`
- `period_start`
- `period_end`

索引：
- unique `(workspace_id, quota_type, period_start)`

#### `usage_ledger`

append-only 用量账本。

关键字段：
- `workspace_id`
- `quota_type`
- `action`: `reserve` / `commit` / `refund` / `expire`
- `status`
- `amount`
- `reservation_id`
- `target_type`: `agent_run` / `content_item` / `asset` / `publish_package` / `publish_task`
- `target_id`
- `provider`
- `model`
- `cost_estimate`
- `actual_cost`
- `failure_reason`
- `idempotency_key`

索引：
- `(workspace_id, quota_type, created_at desc)`
- `(workspace_id, reservation_id)`
- unique `(workspace_id, idempotency_key)` where not null

#### `provider_cost_logs`（P0 minimal for video; P1+ full ledger）

完整 provider 成本账本不进 P0 必交付。P0 为视频成片保留最小 provider/model/cost/error 记录，用于 Week-1 spike、按条计价和技术失败退款；跨 provider 成本分析为 P1+。

关键字段：
- `workspace_id`
- `agent_run_id`
- `tool_call_id`
- `provider`
- `model`
- `input_units`
- `output_units`
- `cost`
- `status`
- `error_code`

索引：
- `(workspace_id, provider, model, created_at desc)`
- `(workspace_id, agent_run_id)`

### 5.10 Agent、Tool 与 Job

#### `agent_runs`

关键字段：
- `workspace_id`
- `store_id`
- `workflow_type`: P0 为 `generate_weekly_content` / `create_video` / `create_publish_package`；Go 后 / P1+ 预留 `create_graphic_pack` / `lead_weekly_report`
- `trigger_source`: `user` / `schedule` / `system`
- `status`
- `input_payload` JSONB
- `output_summary` JSONB
- `cost_estimate`
- `actual_cost`
- `started_by_user_id`
- `started_at`
- `ended_at`
- `correlation_id`

索引：
- `(workspace_id, store_id, created_at desc)`
- `(workspace_id, workflow_type, status)`

#### `tool_calls`

关键字段：
- `agent_run_id`
- `tool_id`
- `tool_version`
- `side_effect_type`: `read_only` / `write_draft` / `consume_quota` / `external_publish_prepare` / `external_publish_submit` / `credential_access`
- `risk_level`: `low` / `medium` / `high`
- `requires_approval`
- `status`
- `input_payload` JSONB
- `output_payload` JSONB
- `input_hash`
- `output_hash`
- `cost_estimate`
- `actual_cost`
- `error_code`

索引：
- `(workspace_id, agent_run_id, created_at)`
- `(workspace_id, tool_id, status)`
- `(workspace_id, requires_approval, status)`

#### `durable_jobs`

关键字段：
- `workspace_id`
- `job_type`
- `status`
- `target_type`
- `target_id`
- `agent_run_id`
- `attempt_count`
- `max_attempts`
- `run_after`
- `locked_by`
- `locked_until`
- `error_code`
- `error_detail`
- `idempotency_key`

索引：
- `(status, run_after)`
- `(workspace_id, target_type, target_id)`
- unique `(workspace_id, idempotency_key)` where not null

#### `audit_events`

append-only 审计。

关键字段：
- `workspace_id`
- `actor_user_id`
- `actor_type`: `user` / `agent` / `system` / `worker`
- `event_type`
- `target_type`
- `target_id`
- `payload` JSONB
- `correlation_id`
- `ip_hash`
- `user_agent_hash`

索引：
- `(workspace_id, created_at desc)`
- `(workspace_id, event_type, created_at desc)`
- `(workspace_id, target_type, target_id, created_at desc)`

## 6. API 合同

路径示例使用 `/v1`。App Shell 可通过 typed BFF adapter 转发，但业务事实仍由 Core API 返回。

### 6.1 Store Profile

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{workspace_id}/store` | 读取门店档案 |
| `PATCH` | `/v1/stores/{store_id}` | 更新基础档案 |
| `POST` | `/v1/stores/{store_id}/projects` | 新增项目价目 |
| `PATCH` | `/v1/store-projects/{project_id}` | 更新项目 |
| `POST` | `/v1/stores/{store_id}/profile-confirmations` | 用户确认档案初稿 |

约束：
- 未确认的价格、活动、资质不得进入发布包。
- 档案确认写 `audit_events.store.profile_confirmed`。

### 6.2 Assets

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/v1/upload-sessions` | 创建上传会话和 object key |
| `POST` | `/v1/assets` | 上传完成后创建 asset metadata |
| `GET` | `/v1/assets` | 按项目、平台、用途、授权、合规筛选 |
| `PATCH` | `/v1/assets/{asset_id}` | 更新 metadata |
| `POST` | `/v1/assets/{asset_id}/rights-evidence` | 增加授权/资质证据 |
| `POST` | `/v1/assets/{asset_id}/tag` | 打标签 |

`POST /v1/upload-sessions` request：

```json
{
  "workspace_id": "ws_...",
  "store_id": "store_...",
  "file_name": "case.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 123456,
  "intended_asset_type": "image"
}
```

response：

```json
{
  "upload_session_id": "upl_...",
  "object_key": "workspaces/ws_/assets/...",
  "upload_url": "https://...",
  "expires_at": "2026-07-07T12:00:00Z"
}
```

### 6.3 Content

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/v1/content-items` | 内容库列表 |
| `GET` | `/v1/content-items/{content_item_id}` | 内容详情 |
| `POST` | `/v1/content-items` | 创建内容母体 |
| `POST` | `/v1/content-items/{content_item_id}/variants` | 创建平台变体 |
| `POST` | `/v1/content-variants/{variant_id}/versions` | 新版本/改稿 |
| `PATCH` | `/v1/content-variants/{variant_id}/status` | 状态流转 |
| `POST` | `/v1/content-variants/{variant_id}/asset-links` | 关联素材 |

状态流转规则：
- `blocked` compliance 不得流转到 `ready_to_package`。
- `regulated_preflight_required` 必须先走 Publish Compliance Preflight。
- 所有状态变更写 audit event。

### 6.4 Workflows / Agent Runs

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/v1/agent-runs/generate-weekly-content` | 生成本周内容 |
| `POST` | `/v1/agent-runs/create-video` | P0：生成视频成片 |
| `POST` | `/v1/agent-runs/create-graphic-pack` | P1+：生成项目套图 |
| `POST` | `/v1/agent-runs/create-publish-package` | 生成发布包 |
| `POST` | `/v1/agent-runs/lead-weekly-report` | Go 后 / P1+：生成线索周报 |
| `GET` | `/v1/agent-runs/{agent_run_id}` | 查询执行状态 |
| `GET` | `/v1/agent-runs/{agent_run_id}/events` | stream/poll 事件 |
| `POST` | `/v1/agent-runs/{agent_run_id}/cancel` | 取消 |
| `POST` | `/v1/agent-runs/{agent_run_id}/approve` | 人在环继续 |

`POST /v1/agent-runs/generate-weekly-content` request：

```json
{
  "store_id": "store_...",
  "project_ids": ["proj_..."],
  "target_platforms": ["xiaohongshu", "douyin"],
  "content_count": 5,
  "scenarios": ["case_seed", "promotion"],
  "tone": "warm_professional",
  "selected_asset_ids": ["asset_..."]
}
```

response：

```json
{
  "agent_run_id": "run_...",
  "job_id": "job_...",
  "status": "queued",
  "usage_reservation_id": "resv_..."
}
```

`POST /v1/agent-runs/create-video` request：

```json
{
  "store_id": "store_...",
  "content_item_id": "item_...",
  "content_variant_id": "var_...",
  "selected_asset_ids": ["asset_..."],
  "duration_seconds": 15,
  "aspect_ratio": "9:16",
  "storyboard": {
    "hook": "...",
    "shots": []
  }
}
```

response：

```json
{
  "agent_run_id": "run_...",
  "job_id": "job_...",
  "video_artifact_id": "vid_...",
  "status": "queued",
  "usage_reservation_id": "resv_..."
}
```

### 6.5 Compliance

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/v1/compliance/check` | 创作合规检查 |
| `POST` | `/v1/publish-preflights` | 发布前核验 |
| `POST` | `/v1/publish-preflights/{id}/confirm` | 人工确认 |
| `GET` | `/v1/compliance-results` | 风险列表 |

硬停止请求返回 `COMPLIANCE_BLOCKED`。触发医美/医疗/注射/激光/手术/药械等边界词时返回 `REGULATED_PREFLIGHT_REQUIRED`。

视频成片必须在合成阶段完成显式 AIGC 标识烧录和隐式 metadata 写入；缺失时不得标记为 `completed`。

### 6.6 Publish

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/v1/publish-packages` | 创建发布包 |
| `GET` | `/v1/publish-packages/{package_id}` | 预览发布包 |
| `POST` | `/v1/publish-packages/{package_id}/export` | 导出 L3 包 |
| `POST` | `/v1/publish-tasks` | 创建发布任务 |
| `POST` | `/v1/publish-tasks/{task_id}/mark-published` | 人工标记已发布 |
| `POST` | `/v1/publish-tasks/{task_id}/downgrade-to-l3` | 降级为 L3 |
| `GET` | `/v1/accounts/{account_id}/capabilities` | 读取账号能力 |

路由约束：
- `L1_OFFICIAL` 需要 `account_capabilities.status=verified`。
- 任意失败必须可降级 `L3_HANDOFF_PACKAGE`。

### 6.6.1 Video artifacts

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/v1/video-artifacts/{video_artifact_id}` | 视频成片详情 |
| `POST` | `/v1/video-artifacts/{video_artifact_id}/attach-to-package` | 加入 L3 发布包 |
| `POST` | `/v1/video-artifacts/{video_artifact_id}/mark-saved-to-album` | 记录存相册交接 |

### 6.7 Leads and Weekly Reports

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/v1/leads` | 新增线索 |
| `GET` | `/v1/leads` | 线索列表 |
| `PATCH` | `/v1/leads/{lead_id}` | 更新状态 |
| `POST` | `/v1/leads/{lead_id}/content-links` | 关联内容 |
| `POST` | `/v1/weekly-reports` | 生成周报 |
| `GET` | `/v1/weekly-reports/{report_id}` | 读取周报 |

### 6.8 Usage

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/v1/usage/balances` | 额度余额 |
| `GET` | `/v1/usage/ledger` | 用量流水 |
| `POST` | `/v1/usage/reservations` | reserve |
| `POST` | `/v1/usage/reservations/{reservation_id}/commit` | commit |
| `POST` | `/v1/usage/reservations/{reservation_id}/refund` | refund |

约束：
- tool 不得直接修改 `quota_balances`。
- 所有额度变化必须由 `usage_ledger` append event 推导。
- `commit` 和 `refund` 必须幂等。

### 6.9 App Shell / BFF

App Shell BFF 只做聚合和转发，不落业务事实。

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/app/api/bootstrap` | 聚合当前 workspace、store、quota、feature flags |
| `POST` | `/app/api/uploads/presign` | 转发上传签名请求，返回 presigned URL |
| `GET` | `/app/api/jobs/{job_id}/events` | SSE/poll job events |
| `POST` | `/app/api/billing/checkout` | 创建支付 checkout |
| `GET` | `/app/api/billing/portal` | 跳转账单 portal |

约束：
- BFF 不写 content、asset rights、compliance、publish、lead、usage 事实。
- BFF 不 import Mastra types。
- BFF 可以把 Core API envelope 原样透传给前端。

### 6.10 Worker internal RPC

renderer/jobs 模块只接 Core API 创建的 job。

| RPC | 用途 |
| --- | --- |
| `jobs.claim` | Worker 领取 job |
| `jobs.heartbeat` | 续租 job lock |
| `jobs.complete` | 回写成功结果 |
| `jobs.fail` | 回写失败原因 |
| `render.graphicPack` | Go 后 / P1+：图文套图渲染 |
| `video.generateFrames` | P0：生成首帧候选 |
| `video.generateClips` | P0：生成视频片段 |
| `video.compose` | P0：ffmpeg 薄合成、字幕/BGM、AIGC 标识烧录和 metadata 写入 |
| `export.publishPackage` | 发布包导出 |
| `asset.process` | 素材压缩、缩略图、元数据提取 |

约束：
- Worker 结果必须回写 Core API。
- Worker 不直接 commit/refund usage。
- Worker 不直接改变 compliance 或 publish route。

## 7. Core API tools 合同

ai-runner 调 Core API tools，所有 tool 均写 `tool_calls`。

| Tool | side_effect_type | requires_approval | 说明 |
| --- | --- | --- | --- |
| `store.profile.read` | read_only | false | 读取门店档案 |
| `store.profile.update` | write_draft | true | 更新档案建议或用户确认 |
| `asset.search` | read_only | false | 搜索真实素材 |
| `asset.tag` | write_draft | false | 自动打标签，需可回滚 |
| `asset.suggest_shooting_list` | read_only | false | 生成拍摄清单 |
| `copy.compose` | read_only | false | 生成草稿文本 |
| `copy.platform_adapt` | read_only | false | 生成平台变体 |
| `graphic.compose` | consume_quota | true | Go 后 / P1+：图文渲染前 reserve |
| `video.script` | read_only | false | P0：生成 AIDA 分镜和 Hook，作为成片流内可确认过程产物 |
| `video.generate` | consume_quota | true | P0：首帧与片段生成 |
| `video.compose` | consume_quota | false | P0：薄合成壳、标识烧录和 artifact 写入 |
| `compliance.check` | read_only | false | 合规检查 |
| `content.save_draft` | write_draft | false | 保存草稿和版本 |
| `publish.create_package` | consume_quota | true | 生成发布包 |
| `lead.link_content` | write_draft | false | 线索关联内容 |
| `usage.reserve` | consume_quota | false | 预留额度 |
| `usage.commit` | consume_quota | false | 确认扣费 |
| `usage.refund` | consume_quota | false | 退款 |

## 8. 错误码

| Code | 触发 |
| --- | --- |
| `AUTH_UNAUTHORIZED` | 未登录或 token 无效 |
| `WORKSPACE_FORBIDDEN` | 无 workspace 权限 |
| `VALIDATION_FAILED` | 请求字段不合法 |
| `IDEMPOTENCY_CONFLICT` | 幂等 key 与已有请求不一致 |
| `STATE_TRANSITION_INVALID` | 状态流转非法 |
| `QUOTA_INSUFFICIENT` | 额度不足 |
| `USAGE_RESERVATION_FAILED` | 预留失败 |
| `USAGE_COMMIT_FAILED` | commit 失败 |
| `COMPLIANCE_BLOCKED` | 合规硬停止 |
| `REGULATED_PREFLIGHT_REQUIRED` | 需要发布前核验 |
| `ASSET_RIGHTS_UNCONFIRMED` | 素材授权未确认 |
| `ACCOUNT_NOT_VERIFIED` | L1 账号能力未 verified |
| `PUBLISH_ROUTE_UNAVAILABLE` | 发布路由不可用 |
| `JOB_NOT_FOUND` | job 不存在 |
| `JOB_NOT_RETRYABLE` | job 不可重试 |
| `PROVIDER_FAILED` | provider 调用失败 |
| `STORAGE_OBJECT_MISSING` | R2 object 不存在 |

前端可按错误域分组：
- `AUTH_*` / `WORKSPACE_*`：登录和权限。
- `JOB_*`：异步任务。
- `USAGE_*` / `QUOTA_*`：额度和账本。
- `COMPLIANCE_*` / `REGULATED_*` / `ASSET_RIGHTS_*`：合规与素材权利。
- `PUBLISH_*` / `ACCOUNT_*`：发布路由。
- `PROVIDER_*` / `STORAGE_*`：外部服务或对象存储。

## 9. 审计事件

P0 audit event 必须 append-only。

| Event | 说明 |
| --- | --- |
| `workspace.member_added` | 成员加入 |
| `store.profile_updated` | 门店档案更新 |
| `store.profile_confirmed` | 门店档案确认 |
| `asset.uploaded` | 素材上传 |
| `asset.rights_updated` | 素材授权状态更新 |
| `asset.used_in_content` | 素材被内容使用 |
| `content.item_created` | 内容母体创建 |
| `content.variant_created` | 平台变体创建 |
| `content.version_created` | 新版本创建 |
| `content.status_changed` | 内容状态变更 |
| `compliance.checked` | 合规检查 |
| `compliance.qualified_access_preflight_required` | 触发医美/医疗资质准入轻量版的发布前提醒 |
| `compliance.publish_preflight_confirmed` | 发布前人工确认 |
| `compliance.blocked` | 合规阻断 |
| `publish.package_created` | 发布包创建 |
| `publish.package_exported` | 发布包导出 |
| `publish.task_created` | 发布任务创建 |
| `publish.task_status_changed` | 发布状态变更 |
| `publish.route_downgraded` | L1 或未来 L2 降级到 L3 |
| `lead.created` | 线索创建 |
| `lead.linked_to_content` | 线索关联内容 |
| `lead.status_changed` | 线索状态变更 |
| `usage.reserved` | 额度预留 |
| `usage.committed` | 扣费确认 |
| `usage.refunded` | 退款 |
| `agent.run_started` | Agent run 开始 |
| `agent.run_completed` | Agent run 完成 |
| `agent.run_failed` | Agent run 失败 |
| `tool.call_started` | tool 调用开始 |
| `tool.call_completed` | tool 调用完成 |
| `tool.call_failed` | tool 调用失败 |
| `tool.approval_requested` | 需要人工确认 |
| `tool.approved` | 人工批准 |
| `tool.denied` | 人工拒绝 |
| `account.capability_verified` | 账号能力 verified |
| `account.revoked` | 账号撤权 |

## 10. P0 实施切片

### Slice 1：Core facts

必须先有：
- `workspaces`
- `stores`
- `store_projects`
- `assets`
- `content_items`
- `content_variants`
- `content_versions`
- `compliance_results`
- `usage_ledger`
- `agent_runs`
- `tool_calls`
- `audit_events`

### Slice 2：Creative workflow

支持：
- `POST /agent-runs/generate-weekly-content`
- `GET /content-items`
- `POST /content-variants/{id}/versions`
- `POST /compliance/check`
- `POST /usage/reservations`

### Slice 3：Publish package

支持：
- `POST /publish-packages`
- `POST /publish-packages/{id}/export`
- `POST /publish-preflights`

### Slice 4：Lead loop

支持：
- `POST /leads`
- `POST /leads/{id}/content-links`

Go 后 / P1+：
- `POST /weekly-reports`
- `GET /weekly-reports/{id}`

## 11. P0 不纳入合同

以下不进 P0 API 合同：
- 完整 CRM/SCRM。
- 自动评论/私信收件箱。
- 外部 Agent Skills API key 管理。
- L2 browser assist / final submit。
- 平台凭据保险库。
- 图文套图生成与自动周报。
- 重编辑时间线、数字人口播、专业剪辑器。
- 私有签名逆向、cookie extraction、captcha bypass。
- 多门店 agency 工作台。
- 复杂因果归因。
