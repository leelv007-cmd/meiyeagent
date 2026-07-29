# Issue #246 F：既有词汇到六原语的映射与 D-127 处置建议

日期：2026-07-29  
性质：Spec 更新前置盘点，不是新工具设计  
代码快照：`issue/246` 工作树（基准提交 `fb20cf20b5eeb47c3a11233f12e9c520de5dd002`；盘点时同票实现仍在并行修改）

## 1. 权威口径

D-162 定义的唯一模型工具面为：

| 原语 | 语义 |
|---|---|
| `read_context(scope, query?)` | 读取商家、素材、历史、规则、快照、任务等上下文 |
| `generate(kind, brief)` | 调用供给生成文案、图、视频、音频或抽取/解析结果 |
| `revise(target_ref, instruction)` | 对既有目标做带 OCC 围栏的有界修改 |
| `record(kind, payload, provenance)` | 仅写入提议/记录，不越过商家确认边界 |
| `check(target_ref, rulesets?)` | 确定性校验；不调用模型 |
| `ask_merchant(question, options?)` | 异步询问商家 |

定义见 `docs/design/beauty-marketing-agent-product-design-2026-07-17.md:2849-2872`。D-166 决定⑥要求先把既有 `operation` / `mode` / `command` 等词汇映射进这六个原语，禁止并行建立第二套，见同文件 `:3305-3308`。

本文中的 D-127 建议含义：

- **KEEP**：保留为领域内部合同、路由能力、商家确认、worker/admin 命令或 UI 投影；它不是模型工具名。
- **ADAPT**：作为一个原语的 `kind`、内部适配器或 canonical write sink 被吸收；迁移期可保留内部值，但不得再独立暴露成模型工具。
- **RETIRE**：在调用迁移、持久化兼容和零流量证据成立后删除旧别名/旧 model-facing dispatch；“建议 RETIRE”不等于本票已删除。

## 2. 扫描口径与完整性边界

生产扫描覆盖 `apps/`、`packages/`、`mkfast-template-main/src/`，排除测试、fixture、生成代码、Paraglide、Cloudflare 生成声明和 vendored UI。核心命令派发另用 `case` 穷举。

```bash
rg -n --glob '*.{ts,tsx}' \
  --glob '!**/*.test.*' --glob '!**/*.spec.*' \
  --glob '!**/*.fixture.*' --glob '!**/fixtures/**' \
  --glob '!**/generated/**' --glob '!**/src/locale/**' \
  --glob '!**/worker-configuration.d.ts' --glob '!**/vendor/**' \
  '\b(operation|mode|command|action)\??:\s*' \
  apps packages mkfast-template-main

rg -n "case '[^']+'" \
  apps/core/src/p1/operations/foundation-module.ts \
  apps/core/src/p1/operations/asset-memory-foundation-module.ts

# context 模块用 name === / !== 分支，不使用 switch/case
rg -n "name (===|!==) '[^']+'" \
  apps/core/src/p1/operations/context-foundation-module.ts
```

“相关生产枚举”指可能被误当作模型动作、原语别名或原语路由参数的动作词汇。纯状态、视觉布局、登录方式和数据库迁移开关也列在 §7，但不强行映射到原语。

## 3. 生成 / 修改 operation 词汇

### 3.1 同一供给能力的现有枚举

| 现有枚举 / 位置 | 全部值 | 六原语映射 | D-127 建议 |
|---|---|---|---|
| `CreativeOperation`：`packages/contracts/src/uiux.ts:2-12` | `copy.generate`, `copy.adapt`, `image.generate`, `image.edit`, `image.reference_transform`, `video.generate`, `audio.speech`, `audio.sfx` | `*.generate`、`audio.*` → `generate`；`copy.adapt`、`image.edit`、`image.reference_transform` → `revise` | **ADAPT**：保留为供给路由 `kind` / capability，不作为八个模型工具 |
| `SupplyOperation`：`packages/contracts/src/supply-registry.ts:11-19` | `copy.generate`, `copy.adapt`, `text.respond`, `image.generate`, `image.edit`, `video.generate`, `audio.speech`, `audio.sfx` | `copy.generate`, `text.respond`, `image.generate`, `video.generate`, `audio.*` → `generate`；`copy.adapt`, `image.edit` → `revise` | **KEEP + ADAPT**：供应目录需要这些值；模型工具面只见六原语 |
| `MODEL_OPERATIONS` / `ModelOperation`：`apps/core/src/p1/model-supply/supply-contracts.ts:13-23` | 与 `SupplyOperation` 同八值 | 同上 | **KEEP + ADAPT**；长期应消除与 contracts 的重复权威，但本票不整改 |
| `IMAGE_INTENT_OPERATIONS`：`packages/contracts/src/image-intent.ts:3-20` | `image.generate`, `image.edit`, `image.reference_transform` | `image.generate` → `generate`；其余 → `revise` | **ADAPT** 为两个原语的 image kind / instruction contract |
| Canvas backend operation：`apps/canvas/src/server/backend-port-vnext.ts:5-12` | `image.generate`, `image.edit`, `text.respond`, `video.generate`, `audio.speech`, `audio.sfx` | 除 `image.edit` → `revise` 外，其余 → `generate` | Canvas 属独立宿主；**KEEP internal + ADAPT at primitive boundary** |
| `PublicProductQuoteOperation`：`apps/core/src/p1/product-billing/server-quote-authority.ts:14-22` | `copy.generate`, `copy.adapt`, `image.generate`, `video.generate` | 对应 `generate` / `revise` 的计费 operation | **KEEP** 为报价资源键；禁止把 quote operation 当工具名 |
| `PlatformDefaultModelOperation`：`apps/core/src/p1/foundation/workspace-provision.ts:16-21` | `copy.generate`, `image.generate`, `video.generate`, `audio.speech` | 全部是 `generate` 的默认模型选择键 | **KEEP** 为 admin-config / provisioning 词汇 |
| `GenerationOperation = UsageResource`：`apps/core/src/p1/foundation/domain.ts:76-78,116-117` | `copy`, `image`, `video`, `audio` | `generate(kind=...)` 的计费资源轴 | **KEEP**，不是动作枚举 |

### 3.2 Issue #246 指定的两个命中

| 现有词汇 | 证据 | 映射 | 处置 |
|---|---|---|---|
| `CanvasImageJob.operation: 'generate' \| 'edit'` | `apps/core/src/p1/operations/types.ts:1081-1108` | `generate` → `generate`；`edit` → `revise` | **ADAPT**：统一经六原语进入；底层 job 可暂保短值作为适配器内部字段。不得再建一组 `generate_image` / `edit_image` 工具 |
| `ImageGenerationRequest.operation: 'generate' \| 'edit'` | `apps/core/src/p1/operations/types.ts:1110-1120` | `generate` → `generate`；`edit` → `revise` | **ADAPT**：与 job 使用相同边界；request 字段只作内部路由 |
| `VisualAdoptionTarget.mode: 'first_adopt' \| 'revise'` | `apps/core/src/p1/result-delivery/role-action-compiler.ts:6-14` | `revise` 是 `revise` 的 canonical OCC write sink；`first_adopt` 是商家采用/确认，不是 `record` | `revise` **ADAPT** 到原语落点；`first_adopt` **KEEP** 在 merchant confirmation 面 |
| compiled family `first_adopt \| revise_content_package_visuals \| local_working_selection` | `apps/core/src/p1/result-delivery/role-action-compiler.ts:21-39,98-102` | `revise_content_package_visuals` 承接 `revise` 的已确认写；`first_adopt` 为确认；`local_working_selection` 纯本地 | **KEEP internal**；不得把三个 family 暴露为第二套工具 |

关键语义边界：

- `mode:'revise'` 不是“模型可直接改 canonical package”的授权。当前 compiler 接收 merchant role action，并携 `expectedRevision` 写 canonical；模型侧 `revise(target_ref,instruction)` 仍须经过既有确认/采用边界。
- `generate_content_package_variants` 的执行合同写的是 `operation:'copy.adapt'`（`packages/contracts/src/content-package.ts:970-980`）。对供应路由它是 adapt，对 agent 意图却是“生成三个变体”。目标应为 `generate(kind=copy_variants)`，内部仍可路由到 `copy.adapt`；不能仅按字符串把整个命令误归 `revise`。

## 4. 结果面与 ProductCommand

### 4.1 图片采用动作

`VisualAdoptionRoleAction` 的全部值是 `adopt_one`, `set_primary`, `set_cover`, `add_to_set`, `adopt_set`, `replace_set`（`packages/contracts/src/content-package.ts:905-915`）。

| 值 | 原语关系 | D-127 建议 |
|---|---|---|
| `add_to_set` | 本地 working selection，不调用原语 | **KEEP UI-local** |
| `adopt_one`, `set_primary`, `set_cover`, `adopt_set`, `replace_set` | 商家采用/确认；确认后的 OCC 写可成为 `revise` sink，但动作本身不进入模型工具面 | **KEEP merchant-facing** |

### 4.2 Result Shell action

`ResultActionId` 共 12 个值，权威数组见 `packages/contracts/src/result-center.ts:68-83`。

| 值 | 原语投影 | D-127 建议 |
|---|---|---|
| `open_history`, `open_run_detail` | `read_context` | **KEEP projection** |
| `continue_adjust` | `revise` | **KEEP projection + ADAPT at adapter** |
| `retry`, `recover_or_verify` | 运行态恢复/重试，不强塞六原语；需要重新生成时才进入 `generate` | **KEEP projection** |
| `create_from_this` | 依据具体 target 进入 `generate` 或提议级 `record`，当前枚举本身不足以判定 | **KEEP projection；待 adapter 判型** |
| `adopt_candidate`, `deliver` | 商家确认/交付，不是模型原语 | **KEEP merchant-facing** |
| `leave_and_continue`, `handle_current_issue`, `cancel_run`, `open_more` | UI / workflow 控制，不是原语 | **KEEP UI/workflow** |

整族 **KEEP 为 Result Shell 投影**；只在 command adapter 内路由到六原语或 merchant/worker 面，不能把 12 个 action 变成 12 个工具。

### 4.3 `ProductCommand` 全量分组

权威 union 为 `packages/contracts/src/product.ts:582-720`，生产执行 switch 为 `apps/core/src/product/product-service.ts:2217-3624`。当前 union 共 37 个值；该模块在 D-127 中属于 KEEP 核心域，因此以下是入口吸收建议，不是整族删除建议。

| 分组 | 全部现有值 | 六原语 / 边界 | D-127 建议 |
|---|---|---|---|
| 确定性校验 | `check_content` | `check` | **ADAPT** |
| 生成 / 场景编排 | `generate_copy`, `create_douyin_variant`, `create_weekly_set`, `remix_content`, `create_storyboard`, `start_video` | 生成本体 → `generate`；weekly/storyboard 等场景步骤由 Skill 表达 | **ADAPT**；迁移后 RETIRE 其 model-facing 别名，保留必要内部 service 方法 |
| 有界修改 | `quick_edit`, `replace_storyboard_shot` | `revise` | **ADAPT** |
| 提议/记录候选 | `save_store_draft`, `add_asset`, `update_asset_metadata` | 只有仍为草稿/提议时才可 `record`；若直接写 canonical 则不进入模型面 | **ADAPT with confirmation boundary** |
| 商家确认、授权、采用、发布 | `confirm_store`, `confirm_qualification`, `authorize_asset`, `select_content`, `confirm_storyboard`, `display_preflight`, `confirm_responsibility`, `create_handoff`, `mark_published`, `apply_plan` | 不映射为模型原语 | **KEEP merchant-facing** |
| worker / 运行态 / 审计 | `claim_video`, `heartbeat_video`, `transition_video`, `resume_video`, `record_video_render`, `complete_video`, `cancel_video`, `retry_video`, `record_handoff_export`, `report_handoff_result` | worker 生命周期与审计，不属于六原语 | **KEEP internal** |
| 直接 UI / 生命周期 | `hide_example`, `withdraw_asset`, `undo_edit`, `revert_to_ai`, `abandon_content` | 用户直接动作；其中 undo/revert 可复用 revise 底层，但不是 agent 工具 | **KEEP UI/internal** |

## 5. P1 operations 三模块 dispatch 全量映射

以下覆盖两个生产 switch 和 context 分支的全部 142 个 action/query：`foundation-module.ts:450-1408`、`asset-memory-foundation-module.ts:116-423`、`context-foundation-module.ts:116-230`。同一名称只出现一次。

### 5.1 可吸收到六原语的现有实现

| 原语 | 现有 dispatch 名 |
|---|---|
| `read_context` | `canonical_history`, `content_package`, `content_package_delivery_timeline`, `content_package_results`, `content_package_lineage`, `content_packages`, `content_package_versions`, `task`, `inbox`, `task_events`, `creation_catalog`, `work`, `export_receipts`, `canvas_image_job`, `latest_canvas_image_job`, `search`, `parse_task_view`, `asset_draft_view`, `asset_intake_view`, `reusable_asset_view`, `preference_view`, `store_facts_active`, `store_fact_history`, `context_bundle_get`, `context_bundle_history`, `context_bundle_recompile_events` |
| `generate` | `generate_content_package_variants`, `start_canvas_image`, `parse_single_asset`, `parse_asset_batch` |
| `record`（仅候选/提议级可进） | `attach_content_package_generation`, `create_content_package`, `record_content_package_manual_result`, `record_content_package_result_signal`, `record_content_package_result_review_action`, `create_creative_work`, `update_creative_work_draft`, `derive_creative_work`, `save_creative_work_selection_draft`, `save_creative_assets_to_library`, `create_task`, `transition_task`, `prepare_manual_asset_draft`, `promote_asset_draft`, `record_asset_intake_batch`, `correct_asset_intake_fact`, `prepare_store_profile_import`, `propose_reusable_asset`, `record_preference_signal`, `propose_preference`, `context_bundle_compile` |
| `check` | `asset_intake_missing_fact_keys`, `context_bundle_fence` |
| `revise` | **无接受自然语言 `instruction` 的现有 dispatch**；`edit_content_package_version` 是商家直填新文本，不等价 |
| `ask_merchant` | **无现有 dispatch** |

上表是“可作为底层实现”的语义映射，不证明每个 dispatch 当前有生产调用方，也不证明已通电到 agent。

### 5.2 场景 / 编排别名

以下名称由 Skill 组合六原语表达，不应继续作为独立 model-facing 工具：

`export_content_package`, `reuse_content_package`, `record_onboarding_skip`, `update_creative_work_brief`, `resume_creative_job`, `cancel_creative_job`, `retry_creative_job`, `quality_retry_creative_job`, `run_trigger`, `execute_weekly_batch`, `record_weekly_fact`, `create_weekly_review`, `dismiss_weekly_candidate`, `cancel_canvas_image`, `creative_workbench`, `content_package_delivery_capabilities`, `content_package_weekly_result_review`, `weekly_batch`, `weekly_review`, `weekly_batch_executions`, `create_reuse_task`, `asset_intake_experience`, `reuse_task_seed`, `series_suggestions`。

建议 **ADAPT → RETIRE model-facing alias**。其中 job resume/cancel/retry 是运行态控制，不得伪装成 `revise`；本映射表只裁定“不新增第七套工具”，具体由 workflow runtime 还是既有内部 service 承接，仍待实施设计。

### 5.3 商家确认 / canonical / 权利 / 计费面

以下不进入模型工具面：

`adopt_harness_candidate`, `adopt_canvas_work_export`, `adopt_into_content_package`, `cancel_content_package`, `edit_content_package_version`, `edit_content_package_variant`, `approve_content_package_action`, `deliver_content_package`, `revoke_content_package_rights`, `rollback_content_package_version`, `confirm_creative_work_brief`, `submit_creative_work`, `approve_creative_generation`, `reroll_creative_job`, `confirm_weekly_candidates`, `confirm_asset_intake_fact`, `finalize_store_intake`, `reject_asset_intake_candidate`, `confirm_reusable_asset`, `deactivate_series`, `confirm_preference`, `revoke_preference`, `store_fact_append`。

建议 **KEEP 在 merchant/kernel 面**。其中名称带 `record`、`edit` 或 `revise` 也不能越过“模型只能提议、商家确认 canonical”的不变量。

### 5.4 admin、迁移、编辑器和运维面

以下是管理、迁移、画布直操、模板直操、索引或运维命令，不属于六原语：

`content_package_migration_activate`, `content_package_migration_backfill`, `content_package_migration_dry_run`, `content_package_migration_freeze`, `content_package_migration_inspect`, `content_package_migration_rollback`, `repair_media_custody`, `configure_trigger`, `retry_task_notification`, `create_work`, `copy_template_version_to_work`, `preview_template_version`, `create_blank_work`, `create_work_from_content_package`, `create_work_from_user_template`, `save_canvas_revision`, `upgrade_work_template`, `set_creation_labels`, `save_user_template`, `rename_user_template`, `copy_user_template`, `delete_user_template`, `set_template_shortcuts`, `export_work`, `complete_canvas_image`, `index_search_document`, `retrieval_evaluation`, `admin_create_template_version`, `admin_create_template`, `admin_enable_template_version`, `admin_preview_template_version`, `admin_publish_template_version`, `admin_retire_template`, `content_package_migration_report`, `content_package_migration_status`, `canvas_export_asset`, `trigger_metrics`, `templates`, `user_templates`, `template_shortcuts`, `retrieval_metrics`, `admin_template_catalog`。

建议 **KEEP internal/admin/editor**；是否删除零调用旧项需要独立反向调用与运维入口证据，本文不把“未见调用”写成已可 RETIRE。

## 6. 其他相关 action 家族

| 词汇 | 全部值 / 证据 | 映射与处置 |
|---|---|---|
| `WeeklyBatchAction` | `create`, `revise`, `apply_template`, `prepare_draft`；`apps/core/src/p1/operations/types.ts:221-225` | 场景 Skill：create/apply/prepare → `generate`/`record`，revise → `revise`；**ADAPT → RETIRE model-facing enum**，若批处理内部仍需则 KEEP internal |
| content result review action | `continue_series`, `change_cta`, `change_platform`, `stop_series`；`packages/contracts/src/content-package.ts:676-686` | 这是运营结果信号，不是工具；**KEEP as record payload** |
| legacy handoff event operation | `package_created`, `opened`, `downloaded`, `shared`, `copied`, `published`；`packages/contracts/src/content-package.ts:631-640` | 审计事件 taxonomy；**KEEP**，不得由模型用 `record` 伪造 |
| video free action / regen intent | free action 六值：`apps/core/src/p1/model-supply/video-regeneration.ts:46-56` | poll/recover/download/sort 是 runtime/read；subtitle edit 可落 revise；adopt 是 merchant；**KEEP internal，按入口 ADAPT** |
| Canvas generation backend action | `cancelGeneration`, `quoteGeneration`, `retryGeneration`, `submitGeneration`；`apps/canvas/src/client/node-generation-contract.ts:70-80` | transport action，不是原语；submit 背后 `generate/revise`，其余为 quote/runtime；**KEEP internal** |
| Skill binding mode | 当前 active enum 为 `required`, `user_selected`, `disabled`（`apps/core/src/p1/skills/types.ts:3-17`）；为读取旧事实，`AuditedSkillBinding.mode` 仍兼容 `planner_selected`（`:88-90`） | `planner_selected` 按 D-166 明确 **RETIRE**；工作树当前只在审计/退役兼容面保留该 discriminator（`apps/core/src/p1/skills/repository.ts:148-213`、`apps/core/src/p1/skills/service.ts:168-183,312-314`）。其余 **KEEP** 为绑定策略，均不是原语 |

## 7. 扫到但不映射为六原语的 mode / action

这些枚举与模型动作同名形态相似，但语义轴不同。强行映射反而会制造第二套歧义：

| 类别 | 例子与证据 | 处置 |
|---|---|---|
| 模型选择策略 | `auto \| fixed`：`apps/core/src/p1/model-supply/route-contracts.ts:20`、`packages/contracts/src/product.ts:636-638` | **KEEP**，是路由策略 |
| Composer 入口模式 | `agent \| direct`：`packages/contracts/src/uiux.ts:170-172`、`apps/core/src/p1/operations/types.ts:656-663` | **KEEP**，是宿主入口 |
| 解析执行方式 | `single_sync \| batch_async`：`packages/contracts/src/parse-service.ts:167-178` | **KEEP**，是执行调度 |
| 交付能力状态 | `automatic_verified \| assisted \| unavailable`：`packages/contracts/src/content-package.ts:644-648`；`actionable \| manual \| unavailable`：`packages/contracts/src/marketing-package.ts:32-48` | **KEEP**，是 capability/result projection |
| 复用范围决策 | `accepted_default \| explicitly_expanded`：`packages/contracts/src/reuse-memory.ts:16-23` | **KEEP**，是商家决策证据 |
| billing settlement | `commit \| refund`：`apps/core/src/p1/harness/billing-compensation.ts:10-18` | **KEEP internal** |
| usage ledger action | `reserve \| commit \| refund \| expire \| adjust \| compensate`：`apps/core/src/p1/foundation/domain.ts:76-90` | **KEEP audit/ledger** |
| supply/admin lifecycle | `accepting \| isolated \| draining`、`isolate \| stop_new_tasks \| recover \| drain`：`apps/core/src/p1/supply-registry/hot-assembly.ts:113-128`、`postgres-admin-supply-runtime.ts:1319` | **KEEP admin/internal** |
| UI-only mode | `single \| set`, `preserve \| stash \| change`, `inbox \| week`, `create \| rename` 等 | **KEEP UI-local**；不注册工具 |
| Pro Studio / frozen canvas actions | `plan \| confirm \| apply` 等位于 `apps/core/src/pro-studio-runtime/canvas-agent.ts:237` 及同文件后续签名 | 按 D-127 **FREEZE**；本票不吸收、不扩展 |

## 8. 落地约束

1. 六原语是唯一 model-facing registry key；本表里的 operation/action 只能成为参数、适配器或非模型内部合同。
2. `record` 只写提议/记录，不能吸收 `confirm_*`、`adopt_*`、授权、权利、计费或 canonical finalize。
3. `revise` 接收 `target_ref + instruction`；“商家直填新值”“OCC canonical sink”“图片供给的 `image.edit`”只分别是输入/落点/路由，不能各自变成工具。
4. `generate(kind)` 的 kind 由 Skill/能力查询提供，不把当前 operation union 原样写死进六原语签名。
5. job resume/cancel/retry、报价、worker heartbeat、admin lifecycle 保持内部 service/workflow 能力，不因没有对应原语而新增第七工具。
6. RETIRE 必须有迁移和零调用/零流量证据；本盘点没有执行删除。

## 9. 未证实边界

- 本文是静态生产代码盘点，没有证明每个枚举值当前可达、已调用或已持久化。
- 三个 P1 operations switch 已逐项枚举，但仓库还有 integrations、admin-config、entitlements 等内部 command 面；它们被归为非模型内部面，没有逐命令改写为六原语。
- 当前 Issue #246 工作树在并行开发；合并前必须重跑 §2 的两个 `rg`，更新新增/退役枚举和行号。
- D-127 处置均为本交付的建议；除 D-166 已明确裁定的 `planner_selected` 外，不把建议写成已执行事实。
