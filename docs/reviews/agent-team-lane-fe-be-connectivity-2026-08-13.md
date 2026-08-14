# Lane B — FE/BE Connectivity
- HEAD: `0a6934089a160a0f0cc3ffc084d42466d47140e2`（`refs/heads/main`）
- Date: 2026-08-13
- Scope: 只读代码树。无发明网络抓包。历史走查只当旁证，本轮以当前 HEAD 接线为准。
- Authority: V3.1 plan §§7–16 / 21–24 / 27–28 / 34 / 37；`docs/ops/capability-ledger-2026-08-13.md`

## 1. Verdict

**部分接通，未达商家安全。** 注册→档案→素材→报价→提交→确认/免确认→Make 的主链在合同与路由上是真接线，不是空壳。但商家感知的「通」被三处系统性断点压住：

1. **UI 政策与 Core 政策打架**（L1 免确认被浏览器硬开确认卡；L2 可能叠三层确认）。
2. **双流不同权威**（Composer 对话吃 `workflow.progress/token/state`；Workbench 吃 Agent semantic replay/SSE，而 `agent_semantic_event_adapter_v1` 默认关、零投影写入）。
3. **错误面不翻译**（P1 / interrupt / steering 把 Core 英文 `error.message` 原样打到时间线）。

账本 C4/C8「不可用」在本 HEAD 仍能从接线解释：steering 在「尚无 admitted snapshot / 尚无 unit progress」时 404 英文裸出；Living Plan 开始制作失败被 toast 吞掉细节。C1/C2/C7 档案与挂源链在代码上已接通（V31-84/85/86/88），本轮不重复发明活体结论。

总判：**不能按「已接通」放行商家主旅程。** 先修确认口径 + 错误面 + 双流权威，再谈 steering / 自报次日追问。

## 2. End-to-end trace table

| Action | UI | Web API | Core command | Persist | Event/SSE | Projection | Status | Break point |
|---|---|---|---|---|---|---|---|---|
| 1 Register / provision / Day-0 说一句 | `register-form.tsx:73` `authClient.signUp.email` → 验邮后 `user-assembly.ts:22` 才 provision；`store-intake-wizard.tsx:512` `extract_store_sentence`；`store-intake-wizard.tsx:440` + model `finalize_store_intake`。Composer 上 `ProgressiveFactCard` **只提醒、不写** | `/api/auth/$`；`core-client.ts:69` `ensureVerifiedWorkspaceProvisionedForCoreForward`；`/api/core/p1/commands`；`/api/core/product/state` | Core `workspace-bootstrap`（仅 `x-core-actor: worker`，`server.ts:1154`）；`entitlements.register_gift` / `provision_model_defaults`（`workspace-provisioning.ts:216`）；`asset-memory.extract_store_sentence`（`asset-memory-foundation-module.ts:109`）；`asset-memory.finalize_store_intake`（同文件 `:97`） | Web outbox `workspace_provisioning`；Core 事实账 `finalize`；profile 写入 | 无 SSE；extract 失败静默（wizard `:525` catch 空） | `/dashboard/store` 档案 + `store_facts_active`（`store.tsx:196`，revision 重钉 `:181`） | **CONNECTED（降级）** | 未验邮不 provision（`user-assembly.ts:22`）；Composer 首屏不再录入（D-C4，`progressive-fact-card.tsx:10`）；provision 失败曾整号 500（账本 V31-78，本 HEAD 有终态化，活体未复跑） |
| 2 Composer L1 纯 copy | `composer-home.tsx:1807` `openExecutionConfirmFor` **恒** `existingGate: true` → 先弹 `ExecutionConfirmCard`；通过后 `use-composer-run.ts:125` `submitComposerSubmission` | `POST /api/core/p1/composer/submissions`（`submissions.ts:8`） | `composer-submissions` → `coordinator.submit`（`server.ts:1675`，202）；`classifyProgressiveLevel` L1 `approvalBasis: policy_exempt_copy`（`progressive-level.ts:213`）；`requiresPaidConfirmation` 对 copy+无图/视频 unit 为 false（`submission-coordinator.ts:1991`）；exempt 直接 `startHarness`（`:889`） | `execution_spine.creation_submissions` + `ExecutionPlanSnapshot`（`approvalBasis=policy_exempt_copy`，禁 `confirmationDecisionRef`） | 对话：`use-workflow-event-stream.ts` `workflow.progress/token/state`；Workbench：`/agent-threads/:id/replay|events` | 报价 chip + 交付卡；**确认卡仍出现** | **CONNECTED-WRONG（200）** | 规格 §3 L1 / §37.4-B「免确认直达」被 UI 违约。Core 不造确认请求；浏览器自己造了一张。属 200-but-wrong，不是 4xx |
| 3 Composer L2 图文 Living Plan | 同一 `submitComposerSubmission`；`use-living-plan-controller.ts:61` `decide` → `:73` `POST .../tasks/:id/start`；另有流内 `ExecutionConfirmationInteractionCard`（`use-composer-interactions.ts:313`） | `POST /api/core/p1/composer/submissions`；`POST /api/core/p1/confirmation-requests/:id/decide`（`decide.ts`）；`POST /api/core/p1/composer/tasks/:id/start` | submit 202 `makeReady:false` + `executionConfirmationRequestId`；`executionConfirmation.create`（`server.ts:2510`，确认前 reserve）；`executionConfirmation.decide`（`:2586`）；`coordinator.start` | snapshot + confirmation request/decision + credit reservation（同一事务，§14.3） | 同上双流；Living Plan 修订走 `plan.revised`（若 adapter 开） | Commit strip「开始制作」+ 可能再叠客户端确认卡 + harness 流内卡 | **CONNECTED（叠卡）** | 三套确认面并存：客户端 `existing_gates` 卡、Living Plan `/start`、harness `execution_confirmation` interrupt。钱链在 Core 是通的；商家击数违约 D-043 |
| 4 视频付费 + 零素材诚实 fallback | `video-confirm-zone.ts:44` 视频必须显式确认；`recipe-source-slot-guidance-card.tsx:18` `canSwitch`；`findSlotFreeFallbackRecipe` 对必填 slot 的视频配方返回 null（`recipe-source-slot-readiness.ts:130` 测） | 同 submissions；slot 400 由 `use-composer-run.ts:440` `requiredSourceSlotFromError` 拦截 | `assertSourceRequirements`（Core 配方门）；视频 billed 走 `merchant_confirmed` + reserve | 同 L2；零素材不入账（slot 在 submit 前/400 挡住） | 无 work 则无 SSE | 引导卡「去素材库 / 无 fallback」；`canSwitch=false` 用 `*_no_fallback` 文案 | **CONNECTED（诚实）** | 带素材视频 Make 本轮未从代码证伪；零素材线不再假切自由创作（V31-85）。未走查 live 生成 |
| 5 中途 steering | `steering-composer-panel.tsx:259` `submitSteering`；gate `steering_gate`（`:216`） | `POST /api/core/p1/commands` `agent-session.steering_submit`；query `list_steering_commands` / `steering_gate` | `SteeringService.submitAuthoritative`（`foundation-module.ts:249`）；`resolveAuthority` 要 admitted snapshot + run/thread/task 绑定 + **非空 unit progress**（`core-assembly.ts:857-907`） | `p1_make_steering_commands` append-only | 无专用 SSE；靠 list 刷新 | 面板渲染 `impact.feeNote`（Core 投影） | **BROKEN（4xx + 英文裸出）** | 无 admitted plan → 404 `No admitted execution plan exists for task …`（`core-assembly.ts:861`）；无 progress → 409 `QUEUE_NOT_READY`。`readP1Envelope` 把 `error.message` 原样丢给 `steering-error`（panel `:91`） |
| 6 Interrupt resume / reconnect | `agent-workbench.tsx:238` `listPendingInterrupts`；`:293` `resumePendingInterrupt`；`reconnectAgentWorkbench`（`agent-event-client.ts:33`） | `GET /api/core/p1/pending-interrupts`；`POST /api/core/p1/interrupts/resume`；`GET /api/core/p1/agent-threads/:id/replay`；`GET .../events` | `pending-interrupts-list` / `pending-interrupts-resume`（`server.ts:1507`）；semantic `loadReplay`（`:1935`） | interrupt 表 + semantic event store | 双流：semantic SSE（Workbench）+ workflow SSE（对话/token） | Workbench 四态 + Composer 对话 | **DEGRADED** | 重连协议在代码上完整（§27.6）。`agent_semantic_event_adapter_v1` **默认关**（`semantic-event-projector.ts:75`）→ replay 常空，而对话仍靠 workflow SSE。expire 无商家 BFF。interrupt 错误英文直出（`typed-interrupt-client.ts:32`） |
| 7 素材 upload → authorize → attach → revoke | `canonical-asset-actions.tsx:110` upload；`asset-authorization-model.ts:91` `update_asset_metadata`+`authorize_asset`；`:545` `withdraw_asset`；`composer-library-source-picker.tsx:26` 挂源 | `PUT/GET /api/core/p1/assets`（`core-client.ts:278`）；`POST /api/core/product/commands` | `product-commands` `add_asset` / `authorize_asset` / `withdraw_asset`（`product-service.ts:2313+`）；撤权传播引用包 | product assets + rights | 无 SSE | 素材库状态徽章 + Composer 仅 `authorizationStatus=authorized` 可选 | **CONNECTED** | 上传被门店档案挡（`canonical-asset-actions.tsx:112`）。撤权 fail-closed 在 resolver（`reference-asset-resolver.ts:145`）。撤权后换源再跑本轮未跟测试网 |
| 8 对象工作区 edit / 逐页 regenerate | `copy-image-text-worksurface.tsx:265` selection AI → `onAdjust(buildSelectionAiPrompt)`；hand-edit `result-content-package-hand-edit.ts:75` `edit_content_package_version`；`composer-note-plan-live.ts:160` `result_adjust_prepare` → `:219` `result_adjust` | `/api/core/p1/commands` `operations` / `result-delivery` / `product-billing.quote` | `operations.edit_content_package_version`；`result-delivery.result_adjust_prepare` / `result_adjust` | ContentPackage OCC 新版本；derived work/task | 派生 run 的 workflow SSE | Result Center / 交付卡进工作区 | **CONNECTED** | Tiptap 只在 object workspace（C12 静态门）。`/dashboard/workspace` **不是**对象工作区（见 §3）。逐页 regenerate 要已有页图，否则中文 throw（`composer-note-plan-live.ts:140`） |
| 9 发布交接 + 自报 OutcomeEvidence | `use-publish-handoff.ts:101` `prepare_mobile_publish_handoff`；`:198` `record_merchant_published`；`:236` chip → `record_content_package_result_signal` + `record_self_report_ask` | `/api/core/p1/commands` + `operations.content_packages` query | `operations.prepare_mobile_publish_handoff` / `record_merchant_published` / `self_report_ask` / `record_self_report_ask`（`foundation-module.ts:529+`） | publish 事件 + ask 行 + result signal | `outcome.recorded`（adapter 开时） | Delivered 面板 + 结果页自报 | **DEGRADED** | 次日追问依赖内存 `publishedAtRef`（`use-publish-handoff.ts:120`）。刷新后 Delivered 水合**不会**问 `self_report_ask`。`attempt_publish_from_handoff` 无商家直发按钮（符合 D-155 白名单） |
| 10 记忆注入清单 + 撤销 | `memory-injection-receipt.tsx:42` `injection_receipt`；`:53` `revoke_memory`；经验页 `memory-vault-page.tsx:280` `entries_page` + `confirm_candidate`/`reject_candidate`/`delete_entry` | `/api/core/p1/query` + `/commands` module `memory` | `memory.injection_receipt` / `revoke_memory` / `entries_page` / `confirm_candidate` | preference 头权威；receipt 只读痕迹 | `memory.proposed` / `memory.promoted`（adapter 开时） | 任务详情清单；`/dashboard/memory` 三层 IA | **CONNECTED（空态诚实）** | 活动/常用做法域 `UnbuiltNote`（`memory-vault-page.tsx:258`）无 producer。注入清单无数据时 panel `return null`（receipt `:70`），商家看不见「本次没注入」 |
| 11 积分 quote / balance / 失败退回 | Composer `quote-wiring.ts:40` `projectComposerQuoteView`（`creditCost`+`failureRefundsCredits`）；`use-merchant-credit-detail.ts:12` `entitlements.credit_detail`；短少双出口 `workbench-credit-purchase-actions.tsx` | `/api/core/p1/query` `product-billing.quote` + `entitlements.credit_detail` | P1 `product-billing.quote`；扣减只在 confirmation/submit 事务；refund 回原 lot | GrantLot + ProductUsageLedger（P1 唯一写者） | 无商家 SSE | 工作台 pill + `/settings/account?section=credits` 批次/流水/`expired_uncredited` | **CONNECTED** | 报价公式字段在 view 里（`formulaExpression`）但 browser-contract 剥供应侧。悬死 run 的退款出口属 C4/V31-82 执行终态，不是 quote API 断 |
| 12 Thread 交付后继续 | `composer-home.tsx:2719` Delivered 打字 → `rebindComposerSession`（`composer-session.ts:228` **task=null**）；`use-composer-run.ts:333` 仍传 `agentThreadId: activeAgentThreadId`；`activeAgentThreadId` 回落到内存 `agentBinding`（home `:875`） | 同 submissions，body `agentThreadId` | coordinator 校验 workspace 所有权后复用 thread | 新 Work 挂同一 `p1_agent_threads` | 新 run 事件 | `/dashboard/recent` `list_threads`；`?threadId=` 恢复 | **DEGRADED** | 刷新后 `agentBinding` 丢，除非 `?threadId=` / `get_workbench_session` 找回。`rebind` 清 task 是刻意，但续写依赖未持久化的 binding。`create_thread` **无 UI** |
| 13 Goal / proactive idle | `IdleGoalProactivePanel` 在 Workbench `rootMode==='idle'`（`agent-workbench.tsx:345`）；`get_idle_projection` / `accept_opportunity` / `dismiss_opportunity` | `/api/core/p1/query|commands` `goal-proactive` | `goal-proactive.get_idle_projection`（`foundation-module.ts:334`）；`accept_opportunity`（`:236`） | goal / candidate 表 | `goal.updated`（adapter 开时） | Idle 主列建议；**无** `/dashboard/goals` | **CONNECTED（按设计无独立面）** | `confirm_goal_proposal` Core 有、UI **零调用**。gate 关时面板仍挂载、建议为空。证据门控建议依赖档案事实 |
| 14 Admin vs merchant | 商家侧栏只有 5 项（`navigation.ts:11`）；Admin 走 `/admin/*` + `ADMIN_NAV_GROUPS` | 商家 BFF `authorizeWorkspaceCoreRequest`；admin 另 `admin-config-proxy-authorization.ts` | P1 `authorizeP1Request` 按 module/action；`x-core-actor` | 分角色 | 无 | Admin 不进商家 nav | **DEGRADED** | 平台 admin 进商家工作区时 `core-client.ts:83` 设 `x-core-actor: admin`。`/dashboard/jobs|sessions|search|workspace|identity` 无侧栏但仍 200。Settings `/models` `/connections` 对商家可见 |

## 3. Dead / orphan inventory

### UI without backend

| Surface | Path | Why orphan / leak |
|---|---|---|
| Canvas job 历史 | `/dashboard/jobs` `jobs.tsx:8` → `CanonicalHistoryPage mode="jobs"` | §4.1 无此路由。Pro Studio 已废（D-170）。只读 legacy 投影，商家侧栏不链，URL 直达仍渲染 |
| 旧 session 历史 | `/dashboard/sessions` `sessions.tsx:12` | 与 `/dashboard/recent`（Thread 列表）双历史。`returnObjectPaths.session` 仍指向这里（`navigation.ts:159`） |
| 全局搜索壳 | `/dashboard/search` `search.tsx:15` | 同一 CanonicalHistory，不是 Thread 搜索 |
| 「内容工作区」汇总 | `/dashboard/workspace` `workspace.tsx:38` `WorkspaceAssetsPage` | **不是**对象工作区。只读 facts/identities/materials 摘要。Store header 链过来（`store.tsx:246`） |
| 口吻独立页 | `/dashboard/identity` `identity.tsx:40` | §4.1 门店页应收编身份。Workspace ↔ Identity 互链，第三套资料面 |
| 记忆未建域 | `memory-vault-page.tsx:258` `UnbuiltNote` | 活动/常用做法诚实「没做完」，无 command |
| 注入清单空 | `memory-injection-receipt.tsx:70` | 无 receipt 则整块不挂，商家无法区分「没注入」vs「没接线」 |
| Goal 提案确认 | — | `confirm_goal_proposal` 无任何 `commandP1` 调用 |

### Backend without UI

| Core route / command | Handler | Merchant UI |
|---|---|---|
| `confirmation-create` `POST .../confirmation-requests` | `server.ts:2492` | 无 BFF、无 fetch。创建只发生在 submission coordinator 内部 |
| `confirmation-list-pending` | `server.ts:2530` | 无 web route。商家看不到「待确认列表」 |
| `confirmation-expire` | `server.ts:2613` | 无 web route。到期靠 sweeper，无白话出口 |
| `assistant-stream` `POST .../p1/assistant/stream` | `server.ts:2774` | 有 BFF `routes/api/core/p1/assistant/stream.ts`，**product/ 零引用** |
| `canvas-text-stream` | `server.ts:2711` | 无 web BFF、无 UI（Canvas 已退役） |
| `agent-session.create_thread` | `foundation-module.ts:221` | 无 UI。thread 由 composer submit / `open_legacy_work_thread` 创建 |
| `goal-proactive.confirm_goal_proposal` | `foundation-module.ts:227` | 无 UI |
| `operations.attempt_publish_from_handoff` | `foundation-module.ts:550` | 有意不给直发按钮（D-155） |
| e2e fixtures `e2e-credit-detail-fixture` 等 | `server.ts:1187+` | 仅 service-token + `e2eFixtureEnabled`，正确隔离 |

### Contract mismatches

| 合同 | UI 假设 | Core 实际 | 后果 |
|---|---|---|---|
| `ComposerSubmissionResult.makeReady` + `executionConfirmationRequestId` | L1 免卡；L2 等 Living Plan `/start` | L1 `makeReady:true` 且无 requestId；L2 相反 | UI 不读 `makeReady` 决定是否弹卡，只读本地 `existingGate:true` |
| `ExecutionPlanSnapshot.approvalBasis` | 浏览器可再确认 | `policy_exempt_copy` 禁止 `confirmationDecisionRef` | 客户端卡不是确认权威，只是多余击 |
| `P1RequestError.message` | 商家中文 | `readP1Envelope`（`p1/client.ts:118`）透传 `error.message` | 英文 / Zod / 内部 taskId 直出 |
| `apiEnvelopeSchema` 必有 `meta.correlationId` | mock `{data}` 就算成功 | parse 失败 → `Response envelope was invalid.` | 见 `v31-p1-route-mock-envelope-note`；生产 Core 有 meta，测试易假红/假绿 |
| `InterruptPayload` vs Workbench interrupt | `interruptType: interrupt.action`（`agent-workbench.tsx:248`） | resume 要 `schemaVersion+interruptId+revision` | 字段能对上；失败信息仍是英文 |

### Event/SSE mismatches

| 流 | 生产者 | 消费者 | 错位 |
|---|---|---|---|
| `workflow.progress` / `workflow.token` / `workflow.state` | `workflow-events` `server.ts:2669` | `use-workflow-event-stream.ts:39` → Composer 对话 / token / delivery | 交付与失败态权威在这条 |
| Agent semantic replay/SSE | `agent-semantic-replay/events` `server.ts:1907` | `agent-event-transport.ts:32/62` → `AgentWorkbenchHost` | 四态、Living Plan、interrupt 投影在这条 |
| Shadow dual-write | `agent_semantic_event_adapter_v1` 默认 **false**（`semantic-event-projector.ts:50-79`；`api-runtime.ts:2163`） | UI **无条件** `loadAgentWorkbenchReplay` | flag 关：replay 空、Workbench Idle/空计划；对话仍在走。**snapshot vs stream 双真相** |
| AG-UI adapter | `ag-ui-adapter.ts:56` domain→`RUN_*` | **无前端订阅** | `interrupt.requested` 映射 `RUN_FINISHED`（`:77`）只影响未接线的 adapter 面 |
| Composer 本地 sessionStorage | `composer-session/v1` | `composer-home` restore | V31-83 已按 workspace 清；换号仍依赖 `discardForeignComposerSessionHandles` |

## 4. Findings

### FIND-B-001 — Severity: P0
- Title: L1 纯 copy 被浏览器强制开执行确认卡，违约 §3 / §37.4-B
- Trace (UI → API → Core → event → UI): Send → `composer-home.tsx:1807` `shouldOpenExecutionConfirm({existingGate:true,generative:true})` 恒 true → 商家先点确认卡 → 才 `runCreate` → `POST /api/core/p1/composer/submissions` → Core `classifyProgressiveLevel` L1 `confirmationExempt` + `approvalBasis:policy_exempt_copy` → 202 `makeReady:true`、**无** `executionConfirmationRequestId` → 冻结 snapshot 后直接 Make
- Evidence: `execution-confirm-card.ts:55` 模式仍是 `existing_gates`，注释写明 copy 应 `direct_submit`；调用点却把 `existingGate` 写死 true。Core 测明确「policy_exempt_copy 没有 /start 往返」（`composer-http.test.ts:2186`）
- Merchant impact: 免费/1 分文案多一击；与「简单任务不因升级变复杂」门 5 冲突。账本 C3 已记「出了确认卡」
- Fix contract: `openExecutionConfirmFor` 必须吃提交结果/报价 lens：`lensId==='copy'` 且 quote 无付费媒体 unit → 不打开卡，直接 `runCreate`。禁止用本地 `existingGate:true` 代替 `approvalBasis`
- Files: `mkfast-template-main/src/product/composer/composer-home.tsx:1798-1818`；`execution-confirm-card.ts:83-100`；`apps/core/src/p1/agent-session/progressive-level.ts:213-226`；`submission-coordinator.ts:1991-1997`
- Tests: 扩 `execution-cost-feedback.test.ts`：copy + `existingGate` 未满足时不应开卡；加 composer-home 交互：copy send 不出现 `execution-confirm` testid；Core 已有 exempt 测保持
- Do not: 不要把 L1 改成真走 `confirmation-decide`；不要用积分阈值绕过（§3 永久口径）
- Depends on: 无

### FIND-B-002 — Severity: P0
- Title: Steering 在无 admitted plan / 无 unit progress 时 404/409，英文 + taskId 直出
- Trace: 运行中输入 → `SteeringComposerHost` `resolveSteeringThreadId`（可能 `open_legacy_work_thread`）→ `steering_submit` → `SteeringService` → `resolveAuthority`（`core-assembly.ts:857`）`getByWorkflowId(taskId)` 空 → `SteeringServiceError('NOT_FOUND', 'No admitted execution plan exists for task ${taskId}…', 404)` → `mapSessionError` 原样 message → `readP1Envelope` → panel `:91` `caught.message`
- Evidence: 权威解析还要求 `p1_agent_runs.durability='sync'` 且 `snapshot_hash` 一致（`:872-894`），以及 `getTaskProgress.length>0`（`:901`）。Living Plan 已确认但 Make 尚未写出 unit progress 时，入口已 `isSteeringEntryVisible`（phase+gate）为真
- Merchant impact: C8 不可用；内部 `composer-task:…` 泄漏。与账本 V31-81 同一断点，本 HEAD 未改
- Fix contract: ① 无 admitted snapshot 或 progress 空 → 200 商家句「现在还不能改这一页，等做出第一页再调」，`applicationStatus=not_ready`，禁止 404 英文；② 入口 `visible` 必须等 `list_steering_commands` 或 progress 查询说 queue ready；③ `P1RequestError` 对 `NOT_FOUND/QUEUE_NOT_READY` 映射中文，不渲染 `error.message`
- Files: `apps/core/src/assembly/core-assembly.ts:856-907`；`apps/core/src/p1/agent-session/foundation-module.ts:66-75`；`steering-composer-panel.tsx:88-94,232-238`；`p1/client.ts:115-125`
- Tests: Core：submit 在无 snapshot / 空 progress 返回 shaped 商家句而非 404 英文。Web：`steering-error` 不含 `admitted`/`task`
- Do not: 不要在浏览器分类 steering；不要为了绿测跳过 authority
- Depends on: C4 Make 真写出 `p1_make_steering_task_progress`（V31-82 终态）

### FIND-B-003 — Severity: P1
- Title: Workbench semantic 流与 Composer workflow 流双权威；adapter 默认关
- Trace: 提交绑定 `threadId/runId` → Host `loadAgentWorkbenchReplay` + `subscribeAgentSemanticEvents`（`composer-home.tsx:3838`）→ Core replay/events（`server.ts:1907`）依赖 projector 写入 → `resolveAgentSemanticEventAdapterEnabled` 未显式 true 则 **零写入**（`semantic-event-projector.ts:75`）→ replay 空 session。同时 `useComposerInteractions` 订 `workflow.*`（`composer-home.tsx:2171`）正常推进对话
- Evidence: flag 注释「Default OFF when unset」（projector `:50`）；`api-runtime.ts:2163`「default off = zero projection writes」。FE 无 flag 门控
- Merchant impact: Living Plan / interrupt / 四态 与 对话进度 各说各话；重连后 Workbench 像 Idle，右边还在跑。§27.6「唯一重连入口」名存实亡
- Fix contract: 二选一写进发布门：A) 生产打开 `agent_semantic_event_adapter_v1` 且 Host 在 replay 空+active workflow 时降级；B) Host 在 flag 关时不订 semantic，四态从 workflow/session projection 派生。禁止双订且默认空
- Files: `apps/core/src/p1/agent-semantic-events/semantic-event-projector.ts:42-79`；`apps/core/src/assembly/api-runtime.ts:2163`；`agent-event-transport.ts:32-86`；`composer-home.tsx:3832-3852,2171`
- Tests: flag 关：replay 空不得把已绑定 thread 画成冷启动；flag 开：reconnect 保留 pending interrupt
- Do not: 不要再加第三套 EventSource
- Depends on: FIND-B-002 的 progress 投影同源

### FIND-B-004 — Severity: P1
- Title: P1 / interrupt / Living Plan 错误面吞细节或英文直出
- Trace:
  - P1：`readP1Envelope` 用 `error.message`（`p1/client.ts:118`），fallback `'P1 request failed'` / `'Response envelope was invalid.'` / ``P1 query ${module}.${action} timed out.``
  - Interrupt：`typed-interrupt-client.ts:32` `'Interrupt request failed.'`；Host `:267/:297` `error.message`
  - Living Plan：`use-living-plan-controller.ts:67/88` catch 只 toast「方案确认失败/开始制作失败」，不读 code
  - 流内确认：`use-composer-interactions.ts:337` toast 中文后 throw 英文 `'The execution confirmation could not be submitted.'`
- Evidence: `product/client.ts` 已做状态码中文；P1 路径未跟。`correlatedApiErrorMessage` 只追加关联 ID，不翻译
- Merchant impact: 同一产品两种错误语言；确认失败商家不知道是 409 幂等还是钱没扣
- Fix contract: 单一 `merchantErrorFromP1(code, status)` 表；白名单外永不渲染上游 `message`。Living Plan 按 `CONFIRMATION_DECIDE_FAILED` / `COMPOSER_PLAN_START_FAILED` 分句
- Files: `mkfast-template-main/src/p1/client.ts:89-128,249`；`typed-interrupt-client.ts:26-36`；`agent-workbench.tsx:264-298`；`use-living-plan-controller.ts:54-89`；`use-composer-interactions.ts:337-341`
- Tests: 对 `NOT_FOUND`/`QUEUE_NOT_READY`/`INVALID_STATE` fixture 断言 UI 无英文句子、无 `composer-task:`
- Do not: 不要把 Zod `parsed.error.message` 当商家文案
- Depends on: FIND-B-002 的 Core 成形错误

### FIND-B-005 — Severity: P1
- Title: 自报次日追问只活在当次 tab 内存
- Trace: Delivered → `prepare_mobile_publish_handoff`（`use-publish-handoff.ts:101`）→ 仅当 `publishedAtRef.current` 已设才 `self_report_ask`（`:120`）→ ref 只在 `record_merchant_published` 成功后赋值（`:214`）→ 刷新/次日打开 ref=null → 不问 ask
- Evidence: `publishedAtRef` / `askIdRef` 均为 `useRef`，无 localStorage、无按 workId 的 query 水合
- Merchant impact: §6.3 / §37.4-K「次日追问」在真实隔日路径上 never-called。入口芯片只在「本会话刚点过已发布」时出现
- Fix contract: Delivered 水合用 `workId+packageId` 调 `self_report_ask`（Core 已按 durable publish 事件算窗口）。浏览器禁止用内存时间戳当门
- Files: `mkfast-template-main/src/product/agent-workbench/publish-handoff/use-publish-handoff.ts:57-150,187-231`；`apps/core/src/p1/operations/foundation-module.ts:595,943`
- Tests: 已有 publish 事件、无内存 ref 时，面板仍渲染 `self-report-prompt`
- Do not: 不要在浏览器算「次日」
- Depends on: 无

### FIND-B-006 — Severity: P1
- Title: 交付后续写同一 Thread 依赖未持久化的 `agentBinding`
- Trace: Delivered 打字 → `rebindComposerSession` 置 `task:null`（`composer-session.ts:237`）→ `activeAgentThreadId = session.task?.agentThreadId ?? agentBinding?.threadId ?? initialThreadId`（`composer-home.tsx:875`）→ 内存 binding 在 → submissions 带 `agentThreadId`（`use-composer-run.ts:333`）。刷新后 binding 空，除非 URL `?threadId=`
- Evidence: `setAgentBinding(null)` 在换号 restore（home `:1976`）。sessionStorage 清 task 后不保留 thread
- Merchant impact: §2.3 / §37.4-I「交付≠Thread 完」在刷新后变成新会话。C10 降级可用与此一致
- Fix contract: persist `threadId` 于 workspace-scoped session key；`rebind` 清 task 但保留 `agentThreadId`。无 thread 时先 `get_workbench_session` 再 submit
- Files: `composer-session.ts:228-253`；`composer-home.tsx:789,875,1976,2713-2730`；`use-composer-run.ts:333`
- Tests: delivered → 打字 → 刷新 → 下一次 submissions body 仍带同一 `agentThreadId`
- Do not: 不要每次交付 `create_thread`
- Depends on: 无

### FIND-B-007 — Severity: P2
- Title: §4.1 以外的 dashboard 路由是 IA 泄漏，不是商家必需面
- Trace: 侧栏只有 workbench/works/assets/store/memory。下列路由仍 200：
  - `/dashboard/jobs` `jobs.tsx:4` Canvas job 只读
  - `/dashboard/sessions` `sessions.tsx:6` 旧 session 历史（应用该是 `/recent`）
  - `/dashboard/search` `search.tsx:4` 同壳搜索
  - `/dashboard/workspace` `workspace.tsx:14` 资料摘要，**不是**对象工作区
  - `/dashboard/identity` `identity.tsx:14` 口吻独立页
  - `/dashboard/catalog` `catalog.tsx:13` 全屏配方目录 — **商家需要**（选配方回 `?catalogRecipeRevisionId=`）
  - `/dashboard/assets` — **商家需要**（§4.1 把素材写进 store，现行 IA 升成一级，可接受）
  - `/dashboard/tasks` `tasks.tsx:64` 已 redirect，正确
- Evidence: `navigation.ts:155-161` `returnObjectPaths` 仍把 job/session 指回泄漏路由
- Merchant impact: 深链/命令面板把人带进只读遗物；「工作区」名与对象工作区撞车
- Fix contract: jobs/sessions/search 301→`/dashboard/recent` 或 `/dashboard/works`；workspace/identity 收进 `/dashboard/store`；改 `returnObjectPaths`
- Files: `routes/dashboard/{jobs,sessions,search,workspace,identity}.tsx`；`lib/uiux/navigation.ts:155-186`；`lib/routes.ts:29-45`
- Tests: 改 `product-surface-contract` / 路由测：上述 path 不再渲染 CanonicalHistory jobs/sessions
- Do not: 不要删 `/dashboard/catalog` 或 `/dashboard/assets`
- Depends on: 无

### FIND-B-008 — Severity: P2
- Title: 确认集合 / assistant-stream / create_thread 有 Core 无商家面
- Trace: `confirmation-create|list-pending|expire` 仅 service-token Core（`server.ts:2492-2613`）。Web 只有 `.../decide`（`core-request.ts:243`）。`assistant-stream` 有 BFF 无 product 调用。`create_thread` 无 UI
- Evidence: `grep confirmation-requests` 在 `src/product` 只有 decide。`grep create_thread` 在 web src 为零
- Merchant impact: 付费 hold 到期商家看不到列表；不能从收件箱点进确认（只能靠当前 thread 流内卡）。assistant-stream 是死 BFF，增加攻击面
- Fix contract: 要么挂 pending-actions 读 `confirmation-list-pending`，要么删商家可达的死 BFF。expire 必须有商家句（§14.4 / D-153）走现有 decide/sweeper 投影，不新开 expire 按钮
- Files: `apps/core/src/server.ts:2492-2665`；`mkfast-template-main/src/lib/core-request.ts:243-311`；`routes/api/core/p1/assistant/stream.ts`
- Tests: 列出 pending confirmation 至少在 pending-actions 或 Workbench interrupt 之一出现
- Do not: 不要让浏览器调 `confirmation-create`
- Depends on: FIND-B-005 的 ask 水合可共用 pending 投影

### FIND-B-009 — Severity: P2
- Title: Feature flag 关后端、UI 仍整块挂载
- Trace:
  - `make_steering_v1` 默认开；关则 `steering_gate.enabled=false`，Host 不挂面板（好）
  - `agent_semantic_event_adapter_v1` 默认关；Host 仍订 replay/SSE（坏，FIND-B-003）
  - `marketing_goal_v1` / `proactive_opportunity_v1`：`enableIdleGoalProactive` 默认 true（`agent-workbench.tsx:135`），gate 关只是空建议
  - 记忆 kill switch：vault/receipt 仍 query，后端应 fail closed（未在本轮逐条证）
- Evidence: `steering-service.ts:69` flag 默认 on；projector `:75` adapter 默认 off
- Merchant impact: 关 adapter 时 Workbench 像坏了而不是「未开启」
- Fix contract: 每个 §41 flag 必须有 FE 对称：off → 不订对应 API，或诚实空态写「未开启」
- Files: `agent-workbench.tsx:135,345`；`semantic-event-projector.ts:42-79`；`steering-composer-panel.tsx:214-238`
- Tests: 已有 ops-console flip drill；补一条 web 静态：adapter 关则不调用 `/agent-threads/.../events` 或调用失败不改 workflow 对话
- Do not: 不要一次建满未实施批次的 flag
- Depends on: FIND-B-003

### FIND-B-010 — Severity: P2
- Title: Fixture / e2e 适配器能掩盖生产断线
- Trace: `e2e-session-fixture-decision.ts` 仅 `APP_ENV=e2e` 伪造三页 plan；`composer-home.tsx:806` `campaignFixture?.read` 可替换 campaign 轮询；`MODEL_EXECUTION_MODE=fixture` 让 Make 看起来交付。store intake `draftSupplyFromExperience` 标注「Core draftSupply only — never guess fixture from FE env」（wizard `:468`）— 这条是对的
- Evidence: 账本 R1：fixture 档 Living Plan 答完方向就跑完，V31-82 浏览器测会假绿
- Merchant impact: 走查/CI 绿 ≠ 生产接通。Lane B 不把 fixture 绿当连通证明
- Fix contract: 生产 bundle 不得引用 `campaignFixture`；e2e fixture 路由保持 service-token。C4/C5 连通验收必须 `MODEL_EXECUTION_MODE!=fixture` 或明确标「降级」
- Files: `apps/core/src/assembly/e2e-session-fixture-decision.ts`；`composer-home.tsx:806`；`apps/core/src/server.ts:1187-1374`
- Tests: 静态禁止 product 在非 test 路径 import `*fixture*`
- Do not: 不要删 e2e fixture（仪器需要）
- Depends on: 无

### FIND-B-011 — Severity: P2
- Title: 平台 admin 在商家工作区转发时抬升为 `x-core-actor: admin`
- Trace: `core-client.ts:59-87` `normalizeProductRole` → `productRole==='admin'` 则 `x-core-actor: admin` 且 workspace-role 用原始 role
- Evidence: 商家命令面与 admin 治理面共用同一 forward。Capability 表按 actor 分权；admin 进自己店会带治理 actor
- Merchant impact: 低：admin 本就可治。风险是误用商家 UI 打到 admin-only action，或审计把店主操作记成 admin
- Fix contract: 商家 BFF（`/api/core/product/*`、`/api/core/p1/composer/*`）恒 `x-core-actor: user`。admin actor 仅限 `/api/core/p1/commands` 且 module∈admin 白名单
- Files: `mkfast-template-main/src/lib/core-client.ts:59-87,328-338`；`lib/admin-config-proxy-authorization.ts`
- Tests: 平台 admin session 调 `composer/submissions` 的 upstream header 为 `user`
- Do not: 不要在商家页挂 admin 组件
- Depends on: 无

### FIND-B-012 — Severity: P2
- Title: 注入清单与 Goal 提案缺少「零结果」诚实态；`confirm_goal_proposal` 死命令
- Trace: receipt 空 → `return null`（`memory-injection-receipt.tsx:70`）。Goal 只有 idle 建议，无提案确认 UI。Core `confirm_goal_proposal` 无 web 调用
- Evidence: `grep confirm_goal_proposal` 在 `mkfast-template-main/src` 为零
- Merchant impact: 商家无法回答「这次用了哪些经验」（空≠未接线）。Goal 提案若只在后台产生，商家永远确认不了
- Fix contract: receipt 空渲染「这次没有用到已记住的经验」。有 pending proposal 必须在 idle 面板接 `confirm_goal_proposal`，或删该 command 的商家能力
- Files: `memory-injection-receipt.tsx:69-71`；`idle-goal-proactive.tsx:49-120`；`apps/core/src/p1/goal-proactive/foundation-module.ts:227-235`
- Tests: taskId 有、receipt.entries=[] 时仍有 panel + 空态句
- Do not: 不要为了演示造假注入
- Depends on: 无

## 5. Executable ticket pack

| ID | Sev | Title | Slice | Exit |
|---|---|---|---|---|
| B-T1 | P0 | L1 copy 去掉客户端确认卡 | 改 `openExecutionConfirmFor`：copy + 无付费媒体 quote → 直接 `runCreate`。`makeReady===true` 且无 `executionConfirmationRequestId` 禁止开卡 | Playwright `v31-level1-copy-journey`：send 后无 `execution-confirm` / `execution-confirmation-interaction-card`；Core snapshot `approvalBasis=policy_exempt_copy`；1 分账不变 |
| B-T2 | P0 | Steering 成形错误 + 入口门 | Core `resolveAuthority` 失败返回 `not_ready` 商家句；FE 未 ready 不挂 submit；P1 不透传英文 | 无 snapshot 时 UI 中文、无 taskId；有 progress 后才能 `steering-submit` |
| B-T3 | P1 | 选定单一事件权威 | 拍板 A 开 adapter 并做空 replay 降级，或 B Host 不订 semantic。删死 AG-UI 订阅幻想 | flag 关：对话仍走、Workbench 不装成 Idle 丢 task。flag 开：reconnect 保 interrupt |
| B-T4 | P1 | 商家错误词典 | `readP1Envelope` / interrupt / Living Plan 走同一 code→中文表 | 单测：10 个常见 code 无英文、无 `composer-task:` |
| B-T5 | P1 | 自报 ask 水合 | 去掉 `publishedAtRef` 门；Delivered mount 调 `self_report_ask` | 刷新已发布 work，芯片仍在 |
| B-T6 | P1 | Thread 续写持久化 | `rebind` 保留 `agentThreadId`；workspace-scoped persist | 交付→刷新→再发送 body 含同一 thread |
| B-T7 | P2 | IA 收口 | jobs/sessions/search redirect；workspace/identity 并入 store | 侧栏外路由不渲染第二套历史 |
| B-T8 | P2 | 死 BFF / 死命令 | 文档化或拆除 `assistant-stream` 商家 BFF；pending-actions 接 confirmation list；goal proposal 接线或删能力 | `create_thread`/`confirm_goal_proposal` 要么有按钮要么从商家 capability 移除 |
| B-T9 | P2 | Flag 对称 | adapter / proactive / memory kill 与 UI 同开同关 | flip drill 关 adapter 时无 semantic EventSource |
| B-T10 | P2 | Admin actor 隔离 | 商家 BFF 强制 `x-core-actor:user` | 见 FIND-B-011 测 |

建议顺序：B-T1 → B-T4 → B-T2 → B-T3 → B-T5 → B-T6 → 其余。B-T2 依赖 Make 真写 progress（与 C4/V31-82 同批）。

## 6. Open questions / unproven

- C4 图文确认后 work 悬死 running：接线是通的（decide+start+workflow SSE），终态/退款是执行问题。本轮无新网络证据；不把 V31-82 再写成「UI 没调 API」。
- 带素材视频 live Make、撤权后再提交的 fail-closed：代码路径在，本 HEAD 无活体。
- `agent_semantic_event_adapter_v1` 在当前部署是否已被 ops 打开：代码默认关；未读生产 admin-config 头。
- V31-80「时间线直出 ExecutionPlanSnapshot 指令」：product 源码无该字符串；更像 fixture/stage `message` 原样投影。需对着一条真实 progress frame 才能结案。
- 平台 admin 调商家 API 是否被 Core 当成治理 actor 放行额外 action：只证实 header 抬升，未穷举 capability 表。
- `confirmation-expire` sweeper 是否已向商家推 interrupt：无 UI、无 BFF，推送未证。
- `/dashboard/catalog` 是否应升格进 §4.1：功能上需要，权威表未写。
- Day-0 Composer 提醒卡是否仍满足「说一句」产品承诺：现行权威是店页向导 + 发送后补问（D-C4）。若产品仍要求工作台首屏说一句，则是规格 supersede，不是断线。

本文件是 Lane B 唯一产出。未改产品代码，未跑可变 git。
