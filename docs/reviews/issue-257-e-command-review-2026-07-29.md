# Issue #257 · E 档 94 条命令逐条复核

日期：2026-07-29
基线：`cc04918ddb11f5cd5013ee085a369047538e218c`
来源：Issue #257、D-161③、`references/analysis/agent-architecture-research-2026-07-28/11-command-surface-inventory.md`

## 结论

- 原始候选：94/94 已覆盖。
- 删除旧 public action/query surface：81。
- 保留：13。
- R11 假 E：9。六条 ContentPackage migration command、两条 migration query 由正式 CLI 动态构造 action；`create_work_from_content_package` 由前台 carrier 动态派发。
- 设计意图保留：`confirm_asset_intake_fact`、`store_fact_append`。两者均是 D-151 明定的 kernel/server seam，浏览器写入由 `finalize_store_intake` 顶替。
- 过渡/承接保留：`content_package_delivery_timeline` 保住 cutover 前 legacy handoff 合并投影；`search` 等 #256 的 `read_context(scope, query?)` 承接。

“删除”默认只指三个 foundation module 暴露的旧 action/query seam，以及只服务该 seam 的 contract、permission、test 和 orphan wrapper。仍被 CLI、worker、Harness、Result Delivery、Product projection 或内部 adapter 消费的底层能力必须保留。

## 复核标准

1. 生产派发不仅查 action 字面量；同时追踪动态参数、CLI 模板字符串、注入式 `dependencies.command`、server/kernel 直调与 worker adapter。
2. 无生产派发不自动等于删除。若决策明确把入口收窄为 kernel/admin/商家确认面，或已有锁定下游票承接，归为“设计意图保留”。
3. 只有测试、历史 evidence、幂等 fingerprint、权限注册或通用 HTTP router 命中，不算生产消费者。
4. 删除旧 seam 不等于删除底层业务能力；每行写明真实替代面或未来归并面。

## 94 行复核表

| E# | R11# | action/query | 裁定 | 独立理由 | 去向 |
|---:|---:|---|---|---|---|
| 1 | 3 | `content_package_migration_activate` | **保留** | 正式 cutover CLI 动态派发；实现仅在备份、零差异和 owned receipt 全部通过后切换写属主（`content-package-migration-cli.ts:20-29,101-127`；`content-package-migration.ts:1023-1079`）。 | admin/cutover；权威库零差异回执后随迁移桥退役。 |
| 2 | 4 | `content_package_migration_backfill` | **保留** | `pnpm contentpackage:cutover backfill` 是正式入口；实现只接受 frozen run，并执行真实回填及报告重建（`apps/core/package.json:18`；`content-package-migration.ts:951-1020`）。 | admin/cutover backfill。 |
| 3 | 5 | `content_package_migration_dry_run` | **保留** | CLI 动态派发并持久化 dry-run 报告；freeze 明确依赖该报告先成功（`content-package-migration.ts:870-887`）。 | admin/cutover 预检。 |
| 4 | 6 | `content_package_migration_freeze` | **保留** | 该阶段保存快照、验证隔离恢复并锁定 frozen 写属主，不是普通原语可替代动作（`content-package-migration.ts:876-947`）。 | admin/cutover freeze。 |
| 5 | 7 | `content_package_migration_inspect` | **保留** | CLI action 列表动态包含 `inspect`；实现生成差异报告并登记 inspected 阶段（`content-package-migration-cli.ts:20-29`；`content-package-migration.ts:864-867`）。 | admin/cutover inspect。 |
| 6 | 8 | `content_package_migration_rollback` | **保留** | CLI 动态派发；实现只允许当前 active run 回滚并切回 legacy 写属主（`content-package-migration.ts:1084-1110`）。 | admin/cutover rollback。 |
| 7 | 9 | `repair_media_custody` | **删除** | 只有旧 switch/admin 注册；没有专属 CLI、ops runbook 或生产调用。通用 HTTP router 不是动作消费者（`foundation-module.ts:368-383,504-508`；`server.ts:2230-2261`）。 | 保留 `media-custody.ts` 的内部修复 cluster；删除 public command wrapper。 |
| 8 | 11 | `attach_content_package_generation` | **删除** | 当前 `result_adopt` 已原子写 generated assets、childRuns、ownedAssets 与新版本；旧独立挂接会制造第二写入口（`operations-visual-adoption.ts:104-116`；`application-service.ts:7744-7780,7842-7865`）。 | Result Delivery `result_adopt`。 |
| 9 | 12 | `cancel_content_package` | **删除** | 仅历史 evidence/test 调用；当前 Result 命令面没有 package cancel（`result-delivery/foundation-module.ts:111-150`）。 | 将来若恢复，必须新建商家确认面。 |
| 10 | 13 | `create_content_package` | **删除** | `result_adopt` 已 create-if-absent，并在同一事务写完整聚合；旧命令只会创建不完整空包（`application-service.ts:7492-7553,7793-7851`）。 | Result Delivery adoption。 |
| 11 | 15 | `edit_content_package_variant` | **删除** | Result Center 已把人工 OCC 写入收敛为 `edit_content_package_version`；旧 variant action 无可达 UI（`result-content-package-hand-edit.ts:1-6,29-37,57-98`）。 | Result Center hand edit。 |
| 12 | 17 | `export_content_package` | **删除** | 前台导出已走 `result-delivery/result_export`，其 adapter 仍直接复用 `exportContentPackage` service（`results_/$workId.tsx:517-535,758-785`；`operations-visual-adoption.ts:370-407`）。 | 删除旧 command；保留 export service。 |
| 13 | 23 | `revoke_content_package_rights` | **删除** | 当前撤权从素材治理 `withdraw_asset` 发起，并由 Product adapter 自动传播到受影响内容包（`canonical-asset-actions.tsx:505-526`；`product-package-rights-adapter.ts:125-147`）。 | 素材撤权传播链。 |
| 14 | 24 | `reuse_content_package` | **删除** | 实现已固定抛 `REUSE_TASK_REQUIRED`，明确 direct copy 退役；可达再创作走 `derive_creative_work`（`application-service.ts:9538-9546`；`results_/$workId.tsx:902-930`）。 | `derive_creative_work`。 |
| 15 | 26 | `record_onboarding_skip` | **删除** | 仅写 `cold_start_skipped` 事件；D-029 已取消独立 onboarding，Day-0/Day-N 共用 Composer（`application-service.ts:5333-5337`；设计文档 D-029）。 | Composer 冷态示例，不保留 skip action。 |
| 16 | 27 | `create_creative_work` | **删除** | 主 Composer 经 `/p1/composer/submissions` 和 submission coordinator 原子创建 Work/Task/ContentPackage（`composer-submission-client.ts:92-107`；`submission-coordinator.ts:149-223`）。 | 删除旧 command；保留被 `deriveCreativeWork` 使用的内部 method。 |
| 17 | 28 | `update_creative_work_draft` | **删除** | 新草稿由 lens state machine 管理，并在提交时冻结 revisions；旧 Work draft method 无生产消费者（`lens-state-machine.ts:668-815,913-999`）。 | Composer lens state。 |
| 18 | 29 | `update_creative_work_brief` | **删除** | 当前 Brief 草稿走 `brief_context_sync` 与 `brief_project` 的版本化 creation-experience seam（`composer-live.ts:248-280`；`creation-experience/foundation-module.ts:650-694`）。 | creation-experience Brief。 |
| 19 | 30 | `confirm_creative_work_brief` | **删除** | 商家确认已迁到可达的 `creation-experience/brief_confirm`，并按当前 revisions 持久化（`composer-live.ts:283-295`；`creation-experience/foundation-module.ts:695-745`）。 | 商家 Brief 确认面。 |
| 20 | 32 | `submit_creative_work` | **删除** | Result 调整链确认 quote 后内部直调 `submitCreativeWork`；保留公开旧 submit 会绕过当前主链（`operations-visual-adoption.ts:320-365`）。 | 删除 command；保留内部 submit method。 |
| 21 | 33 | `approve_creative_generation` | **删除** | 当前高成本确认走 video regeneration 的 quote→confirm seam；旧 approval method 无调用（`results_/$workId.tsx:1405-1435`；`video-regeneration-foundation.ts:109-124`）。 | video regeneration 商家确认面。 |
| 22 | 39 | `reroll_creative_job` | **删除** | 该 action 服务旧三候选抽卡模式；D-113 已锁为单主候选，主动换版应创建新任务。 | 新 Job/revision 派生。 |
| 23 | 40 | `quality_retry_creative_job` | **删除** | 质量失败已定义为内部有界重试，不应暴露成独立用户命令；旧 method 无消费者（设计文档 D-105/D-113 相关合同）。 | Harness 内部 bounded retry。 |
| 24 | 41 | `create_task` | **删除** | 飞书确认与集成异常 adapter 直接调用 `createTask`；旧浏览器 command seam 不再需要（`operations-confirmation-task-adapter.ts:16-37,53-76`）。 | 删除 command；保留内部 task method。 |
| 25 | 42 | `transition_task` | **删除** | 同一生产 adapter 在确认与连接恢复时直接调用 `transitionTask`（`operations-confirmation-task-adapter.ts:39-50,79-100`）。 | 删除 command/permission；保留内部 transition method。 |
| 26 | 43 | `configure_trigger` | **删除** | 没有 admin UI、ops script 或生产调用；初始 trigger config 为空，当前 action 不能证明存在可运营配置面（`application-service.ts:679-690`）。 | 有真实配置消费者时重新立项。 |
| 27 | 44 | `run_trigger` | **删除** | worker handler 已直接调用 `operations.runTrigger` 并注册到 job worker；公开 command 是重复入口（`trigger-job-handler.ts:39-50`；`job-worker.ts:681`）。 | 删除 command；保留 worker/internal method。 |
| 28 | 45 | `retry_task_notification` | **删除** | 无产品或运维消费者；正常通知已在 `runTrigger` 内投递（`application-service.ts:1843-1862`）。 | worker notification flow。 |
| 29 | 46 | `execute_weekly_batch` | **删除** | Result close-loop 已替代旧 weekly operations IA；新周复盘确认只产 snapshot intent，不自动建任务或扣费（`weekly-review-panel.tsx:1-5`）。 | Result Center 周复盘。 |
| 30 | 47 | `record_weekly_fact` | **删除** | 新周事实从 ContentPackage publication/observation 投影读取；public method 无调用（`result-close-loop-live.ts:148-199`）。 | 删除 command/admin 注册；保留内部 `appendWeeklyFact`。 |
| 31 | 48 | `create_weekly_review` | **删除** | 新周复盘从真实事实现场投影并显式 unknown；旧静态候选 review 无调用（`weekly-review-model.ts:260-355`）。 | Result Center weekly review model。 |
| 32 | 49 | `confirm_weekly_candidates` | **删除** | 当前确认先写 result review action，再按需派生 `derive_creative_work`；旧命令自动造 ContentTask 已不符合合同（`results_/$workId.tsx:1531-1589`）。 | 商家 review action + 派生 Work。 |
| 33 | 50 | `dismiss_weekly_candidate` | **删除** | 新 `stop_series` 是 `decision_only`，不创建 task/snapshot；旧 dismiss action 无消费者（`weekly-review-model.ts:358-403`）。 | Result Center decision record。 |
| 34 | 51 | `create_work` | **删除** | 模板选择应进入共享 draft reference；weekly apply-template 仍内部调用 `createWork`，无需公开 action（`operations/adapters.ts:530-576`）。 | 删除 command；保留内部 canvas Work method。 |
| 35 | 53 | `preview_template_version` | **删除** | 商家画廊从 `creation_catalog.previewDocument` 读预览；后台预览由活的 `admin_preview_template_version` 承担（`application-service.ts:3933-3960`）。 | creation catalog/admin preview。 |
| 36 | 54 | `create_blank_work` | **删除** | P1 自由创作走 Composer；高阶空白画布属于 Pro Studio aggregate，其真实入口是 `createProject(emptyKernelGraph())`（`apps/canvas/src/client/canvas-shell.tsx:420-464`）。 | Composer / Pro Studio project。 |
| 37 | 55 | `create_work_from_content_package` | **保留** | R11 漏掉动态派发：`ContentPackageExportCarrier` 调 `operationsCommand(action,payload)` 并固定传入本 action；组件生产挂载在 Result/Works（`content-package-export-carrier.tsx:123-140`）。 | 人工轻编辑 Work 入口。 |
| 38 | 56 | `create_work_from_user_template` | **删除** | 当前模板语义是写共享 draft reference，不直接创建第二个 Work；Cmd+K “加入创作”消费者已撤回。 | 共享 Composer draft reference。 |
| 39 | 61 | `rename_user_template` | **删除** | 可见面只在保存时设置模板名并走 `save_user_template`；没有独立 rename UI 或调用（`works-light-edit-page.tsx:328-373`）。 | 如恢复模板管理，随真实 UI 重建。 |
| 40 | 62 | `copy_user_template` | **删除** | 已接复制语义是 `copy_template_version_to_work`，不是复制 UserTemplate record；本 action 没有消费者（`works-light-edit-page.tsx:191-235`）。 | 画布模板版本复制。 |
| 41 | 63 | `delete_user_template` | **删除** | 当前没有用户模板管理/删除 UI，只有保存入口；保留无调用 CRUD 会冒充完整管理面（`works-light-edit-page.tsx:328-373`）。 | 有管理面时重新建立商家确认动作。 |
| 42 | 64 | `set_template_shortcuts` | **删除** | 产品要求每用户快捷项，但当前实现按 workspace 整包覆盖且没有写侧消费者，所有权模型错误（`application-service.ts:3911-3922`）。 | 随真实个人快捷面重建。 |
| 43 | 66 | `start_canvas_image` | **删除** | Pro Studio 已统一经 `submitGeneration` 进入 `model-supply/canvas_generation_submit`；旧起图入口会形成第二媒体生成主链（`backend-port.ts:812-835`）。 | Model Supply canvas generation。 |
| 44 | 67 | `complete_canvas_image` | **删除** | 现代 Canvas 通过 durable `getGenerationJob` 读取终态，不存在人工 complete 消费者（`backend-port.ts:837-843`）。 | Generation Job reconciliation。 |
| 45 | 68 | `cancel_canvas_image` | **删除** | 真实取消经 Canvas `cancelGeneration` → `model-supply/canvas_generation_cancel`（`backend-port.ts:877-884`；`core-generation-provider.ts:299-318`）。 | Model Supply cancel。 |
| 46 | 69 | `index_search_document` | **删除** | D-098 要求目录搜索跨过真实门槛后再建；当前没有索引生产者，保留会冒充已交付搜索写面。 | 将来 canonical search index。 |
| 47 | 70 | `retrieval_evaluation` | **删除** | 无后台/ops/生产消费者；D-162 已把评测真相归到 `evals/evals.json + promptfoo`，不再写产品 operations 表。 | 离线 eval 体系。 |
| 48 | 77 | `content_package_migration_report` | **保留** | 运维 CLI 通过模板字符串动态构造 query；报告是 cutover 七项零差异证据（`content-package-migration-cli.ts:20-34,101-118`）。 | admin/cutover report。 |
| 49 | 78 | `content_package_migration_status` | **保留** | 同一正式 CLI 动态派发，用于读取 run 当前阶段；不能由 report 替代（`application-service.ts:9874-9879`）。 | admin/cutover status。 |
| 50 | 82 | `content_package_delivery_timeline` | **保留** | 这是唯一合并新包 delivery events 与 legacy handoff 只读事件的 query；legacy projection 在 cutover 完成前受保护（`content-package-delivery.ts:414-421`）。 | cutover 过渡 read_context/交付回执面。 |
| 51 | 83 | `content_package_delivery_capabilities` | **删除** | Result Center 已按真实材料、审批与设备事实计算 capability，并隐藏未验证直发；旧后台 query 是第二份投影（`delivery-capability-groups.ts:48-73,114-125`）。 | Result Center capability projection。 |
| 52 | 85 | `content_package_weekly_result_review` | **删除** | 活的 Result Center 已从 ContentPackage 发布记录、信号和 review action 构造周复盘（`result-close-loop-live.ts:148-200`）。 | Result Center close-loop。 |
| 53 | 86 | `content_package_lineage` | **删除** | 仅历史 evidence 脚本调用；生产 UI 已从 `content_packages` 聚合投影读取来源与 lineage（`results_/$workId.tsx:1099-1123`）。 | canonical ContentPackage/read_context。 |
| 54 | 89 | `content_package_versions` | **删除** | standalone query 与 service 仅互相调用；生产 Result Center 直接消费 ContentPackage 内的 versions（`result-live-projection.ts:509-534`）。 | `content_packages` projection。 |
| 55 | 90 | `task` | **删除** | 旧单任务路由只丢弃 task id 后跳工作台；operations `getTask` 无其他消费者（`routes/dashboard/tasks_/$taskId.tsx:1-16`）。 | pending actions / 对话任务卡。 |
| 56 | 91 | `inbox` | **删除** | 旧 inbox route 已跳转；`listInbox` 仍被集成异常恢复 adapter 内部直调，因此只删 public query（`operations-confirmation-task-adapter.ts:79-100`）。 | 保留内部 listInbox；商家面走 pending actions。 |
| 57 | 92 | `task_events` | **删除** | T34 明确旧任务事件流随任务 IA 下线，当前 service 只有本 query 消费（`docs/handoff/t34-content-operations-replacement-map.md:31-36,53-64`）。 | 不保留；未来运营控制台另立项。 |
| 58 | 93 | `weekly_batch` | **删除** | 旧 weekly operations 组件和路由已删除，替代矩阵指定由 Result Center 周复盘承接。 | Result Center weekly facts。 |
| 59 | 94 | `weekly_review` | **删除** | 读取旧 `p1_weekly_reviews` 真相；当前周复盘由 ContentPackage ledger 现场投影，不维护第二份事实。 | Result Center weekly review。 |
| 60 | 95 | `weekly_batch_executions` | **删除** | 仅服务已退役周批 UI；真实异步运行观测统一在 job-runtime admin 面。 | job-runtime observability。 |
| 61 | 96 | `trigger_metrics` | **删除** | trigger worker 活着，但从不消费该 query；后台真实读取 job-runtime observability（`admin-operations-health.tsx:358-367`）。 | job-runtime metrics。 |
| 62 | 99 | `user_templates` | **删除** | standalone query 无调用；活的 `creation_catalog` 内部调用 `listUserTemplates` 并合并返回（`application-service.ts:3933-3939`）。 | 删除 public query；保留 helper。 |
| 63 | 100 | `template_shortcuts` | **删除** | 快捷位已随 creation catalog 一起返回，无需独立网络 seam（`application-service.ts:3926-3939`）。 | creation catalog；后续 Creation Surface。 |
| 64 | 104 | `latest_canvas_image_job` | **删除** | 生产 observer 已持有确定 jobId 并轮询活的 `canvas_image_job`；latest-by-work 会引入“猜最新”的歧义（`creative-job-observer.ts:399-415`）。 | 精确 Generation Job ref。 |
| 65 | 105 | `search` | **保留** | 这是“遗漏”而非替代：服务已实现 workspace 索引与模板合并，前台仍用全量 history 客户端过滤；#256 已锁 `read_context(scope, query?)`（`application-service.ts:4866-4890`）。 | #256 `read_context` 归并前保留。 |
| 66 | 106 | `retrieval_metrics` | **删除** | 无 Web/admin/ops 消费；只读自造 retrieval 表，而 D-162 已把 eval 真相归离线 `evals/evals.json + promptfoo`。 | 离线 eval 体系。 |
| 67 | 109 | `parse_asset_batch` | **删除** | worker 有 batch effect 消费器，但生产没有 action sender 创建任务；旧 action 仍是未通电入口（`job-worker.ts:510-513`）。 | `generate(kind=parse)` 原语的 durable 内部实现。 |
| 68 | 111 | `promote_asset_draft` | **删除** | 五步向导已直接从 draft 构造一次 `finalize_store_intake`，不再经过 draft→batch 独立命令（`store-intake-wizard.tsx:320-345`）。 | 提议归 `record`，确认归商家面。 |
| 69 | 112 | `record_asset_intake_batch` | **删除** | server finalizer 与历史导入直接调用 intake service 录批；无需外部 action（`store-intake-finalizer.ts:419-425`；`store-profile-import.ts:170-190`）。 | server internal staging / `record`。 |
| 70 | 113 | `correct_asset_intake_fact` | **删除** | 当前导入候选修改会作为 fresh user confirmation 走普通 wizard，不原地修改旧 candidate（`store-intake-wizard-model.ts:530-534`）。 | `record(kind=correction)` + 商家确认。 |
| 71 | 114 | `confirm_asset_intake_fact` | **保留** | D-161 明列 D-151 反例；浏览器权限显式为 null，`finalize_store_intake` 内部复用相同 `confirmFact`（`capability-permission.ts:439-446`；`store-intake-finalizer.ts:437-445`）。 | kernel/server fact confirmation seam。 |
| 72 | 117 | `reject_asset_intake_candidate` | **删除** | 当前 wizard 只提交 selectedGroupIds；未选候选自然不进入 finalizer，不需要单独 reject action（`store-intake-wizard-model.ts:536-579`）。 | 商家选择/`ask_merchant`。 |
| 73 | 118 | `propose_reusable_asset` | **删除** | action 只是无消费者薄包装，领域 service 可保留；提议管线已由 #256 建壳、#251 建四态管道。 | `record/propose` 原语管线。 |
| 74 | 119 | `confirm_reusable_asset` | **删除** | action 无派发；service 中同名 fingerprint 不是调用。确认属于商家专属面，不进入模型工具。 | 商家 reusable-asset 确认面。 |
| 75 | 120 | `deactivate_series` | **删除** | action 无消费者，service 命中只是幂等 fingerprint；停用若开放必须由商家维护面发起。 | 商家系列维护面。 |
| 76 | 121 | `create_reuse_task` | **删除** | 旧 action 虽能提交 Harness，但没有生产 sender；真实 Harness 只消费并验证已有 seed（`production-context-port.ts:215-220`）。 | Skill 配方 + 基质原语。 |
| 77 | 122 | `record_preference_signal` | **删除** | preference eval 直接调用 service 且使用内存仓库，不经过 module action（`evals/preference-memory/runner.ts:140-143`）。 | 被动沉淀管道的 `record`。 |
| 78 | 123 | `propose_preference` | **删除** | eval 与领域聚合均直接调 service；无人调用 action wrapper（`runner.ts:159-161`；`reuse-memory-service.ts:815`）。 | #256 propose 壳 + #251 管道。 |
| 79 | 124 | `confirm_preference` | **删除** | eval 直接调用 service，action 无生产 sender；确认必须保留为商家动作而非模型原语。 | 商家 preference 确认面。 |
| 80 | 125 | `revoke_preference` | **删除** | action 无派发；service fingerprint 与 eval direct call 都不构成消费者。撤销属于商家维护。 | 商家 preference 撤销面。 |
| 81 | 126 | `parse_task_view` | **删除** | `parse_asset_batch` 没有任务生产入口，故该 view 也没有当前前台消费者。 | 将来归 `read_context`。 |
| 82 | 127 | `asset_draft_view` | **删除** | 生产确有 `ParseService.draftView` 内部消费者，但不经过 module query；只删旧外部 seam（`apps/core/src/main.ts:1609-1635`）。 | 保留 service，外部读归 `read_context`。 |
| 83 | 129 | `asset_intake_view` | **删除** | 历史导入直接在 command response 返回 batch，finalizer server-side resolve；没有独立 query 消费者。 | server intake flow / `read_context`。 |
| 84 | 130 | `asset_intake_missing_fact_keys` | **删除** | 仅做确定性 missing-key 计算且无调用，不构成已接完整门禁；#256 将统一收编 check 判据。 | `check` 原语复用同一判据。 |
| 85 | 131 | `reusable_asset_view` | **删除** | action 无生产 sender；底层 `ReuseMemoryService.assetView` 可由新路径复用。 | `read_context` + 商家确认面。 |
| 86 | 132 | `reuse_task_seed` | **删除** | 旧 create action 内部可直接造 seed；生产生成链只验证请求携带的 seed，无需独立 query。 | Skill 配方/内部 seed verifier。 |
| 87 | 133 | `series_suggestions` | **删除** | 当前没有查询消费者；系列建议属于未来策展配方，不是保留空 action 的理由。 | Skill/策展建议 + 商家展示。 |
| 88 | 134 | `preference_view` | **删除** | recorded eval 直接调 service 并只产 fixture 指标；没有生产 module query（`runner.ts:186-190`）。 | `read_context` / 商家维护面。 |
| 89 | 135 | `store_fact_append` | **保留** | D-151 明确浏览器走 `finalize_store_intake`，本 action 收窄为 kernel 纠正/撤销；权限对浏览器返回 null（设计文档 D-151；`capability-permission.ts:457`）。 | kernel/server StoreFact seam。 |
| 90 | 136 | `context_bundle_compile` | **删除** | 生产 Harness 已直接 compile/freeze；旧 module command 会形成第二编译入口（`production-context-port.ts:189,326`）。 | Harness context injection。 |
| 91 | 139 | `context_bundle_get` | **删除** | 旧 query 是无消费者包装；底层 repository.get 仍被 Harness、交付审批和复用校验直接使用。 | 保留 internal repository port。 |
| 92 | 140 | `context_bundle_history` | **删除** | 没有生产 `history()` 消费者，唯一调用是本 query；真实 provenance 按 revision-specific `get` 读取。 | 保留不可变 revisions，不保留 list-all seam。 |
| 93 | 141 | `context_bundle_recompile_events` | **删除** | 没有 `listRecompileEvents` 生产消费者；freeze 仍会事务写审计事件，数据保留不等于保留空查询。 | 保留审计写入；删除 read wrapper。 |
| 94 | 142 | `context_bundle_fence` | **删除** | 生产 Harness 已在内部比较 source revisions 并按变化重编译（`production-context-port.ts:138-165`）。 | Harness fence/check 判据。 |

## 删除批边界

建议按四个公开 seam 分批：asset-memory 21 条、context 5 条、operations query 15 条、operations command 40 条。每批先在模块公开接口补 table-driven “Unknown/default deny” 失败断言，再删 case/contract/permission/orphan，跑该模块单测与 Core typecheck。保留项必须继续有正向行为断言，尤其 migration CLI、`create_work_from_content_package`、D-151 两个 kernel seam。

`git ls-files -- <path>` 空输出只适用于确实整文件删除的 orphan。三个 foundation module 都是共享宿主，删 case 后文件仍被跟踪，不能用 `git ls-files` 证明 action 消失；这类变更以公开行为测试、权限 default-deny 和 index 范围的 action-aware 残余审计为证。
