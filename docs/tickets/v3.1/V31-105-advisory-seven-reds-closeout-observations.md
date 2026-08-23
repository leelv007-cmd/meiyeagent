# V31-105 — advisory 七红收口轮（2026-08-23）的观察债：修红时看到、刻意没顺手改的十三条

**Parent**: 门可靠性（V31-104 的后继：两条 advisory job 里所有红的归属与余债）
**批次**: 登记优先（每条都有 file:line，但改法各自牵涉产品/合同裁决，不在修红分支里动）
**Blocked by**: 无
**Related**: V31-16 / V31-27 / V31-90（steering）、V31-22（ops console）、V31-28（§37.4-E 围栏与 fact-ref 上限）、V31-82（composer 解锁）、V31-104（两条 spec 的定性）、V31-70（workerd 仪器）

**Status**: open（2026-08-23）— 七红全部归因并修净于 `claude/advisory-integration`；十六条观察债逐条带 file:line（make-steering task_id 两端拼法不同／`linkExecutionRun` 无生产调用方／legacy-work 回退 409／Core 202 后异步失败造不存在的 Run／`listRecentRunPins` LIMIT 20／自动发布交接抬 revision／p2 :344／openConsole 5s／Deploy 门 30 分钟窗口短于 Advisory 65 分钟／视频在途窗口 开始制作 仍可按／关标签页恢复采样窗口(已修)／已完成 run 无恢复通道／DBOS 回送至不存在 workflow＋resume sent 乐观值），均需产品或合同裁决后另派工

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**: 429cd43c0018883bf1187ef6c99ea908ce1ee5da
**Workflow Run**: Core quality 32607939975（required 全绿）／Advisory telemetry 32607939979

## 本轮七红的归属（给后来人对照用，不是本票的工作）

| 红 | 归因 | 修法 | 落点 |
|---|---|---|---|
| `v31-mid-run-steering-journey` :131/:185 | 准入行 key 形态＝`${taskId}:plan-r<n>:plan:<rev>:<hash>`，旧探针 `${taskId}` / `${taskId}:plan-r1` 必空；绑定 SQL 要 `run.durability='sync'` 而生产从不写该行 | `getLatestForTask` 解析 workflow-id 家族＋绑定改读 submission 自己的 `agentBinding`，线程作用域一字未放宽 | V31-90 |
| `v31-context-fence-journey` §37.4-E | 定制创作从不声明 fact，冻结 `factRevisionRefs=[]` 对空集恒 current，围栏不可达 | `deriveMaterialFactRefs`：服务端按 `isMaterialStoreFact` 列出并冻结物料事实 | V31-28 |
| `v31-ops-console-release-journey` :233/:372 | ① brief context id 与 revision 不成对→同 id 配 `expectedRevision:null` 409；② 新提交续写在途 Thread→202 后异步 `AGENT_ACTIVE_TURN_CONFLICT`，承诺的 Run 不存在 | 按 revision 铸新 id；workbench 在途时不带 thread（按下发送瞬间取快照） | V31-22 |
| `p2-browser-closure` :731 | helper 编舞过时（202≠已开跑）＋ `6ef2b49a8` 自动开跑死锁 | 先放行 Make 再等 图文方向；revert `6ef2b49a8` | V31-104①（已更正）/ V31-28 |
| `p2-browser-closure` :565 | `composer-task%3A…` 路径未解码，裸 id 相等谓词恒假 | `decodeURIComponent(pathname)` ＋静态门钉住 | #323 静态门 |
| `image-text-note-compiler` T20 | 采纳时用两分钟前的 ContentPackage revision，期间 workbench 自动准备手机发布交接把 revision 抬了 | 命令轮内读 revision，一次 refresh-retry | 本票 §6 |
| `v31-video-paid-execution-journey` | `f90b29725` 去掉了「已经在制作」条，spec 仍等它 | 按拍板 A：202 后即关 tab（spec 改，不补产品条） | 本票 §8 |

## 观察债（九条）

### 1. make-steering 两端 task_id 拼法不同：`queued_steer` 永远 drain 不到 Make

- 写进度/排队的 key＝harness workflow id：`apps/core/src/p1/harness/workflow-core.ts:2548`（注释原文 `// Durable Make taskId === workflowId (task-admission identity).`）、`dbos-workflow.ts:1830`（`taskId: input.workflowId`）；实测 `p1_make_steering_task_progress.task_id = composer-task:…:plan-r1`。
- 商家侧写命令的 key＝浏览器裸 id：`apps/core/src/p1/agent-session/steering-service.ts:763`（`command.taskId = input.taskId`）；排队消费 `steering-service.ts:842-844` `listQueued({ taskId: input.taskId })` 用的又是 harness id。
- 后果：(a) `resolveAuthority` 的 progress 恒空 → 永远走 `pendingFromPlan`，页已生成后商家仍被告知「还没开始做、不额外算积分」；(b) `queued_steer` 在单元边界 drain 不到，**商家看到的影响回读是对的，但指令实际落不到 Make**。
- 为什么不顺手对齐：`p1_make_steering_task_progress` 只有 `(workspace_id, task_id, unit_id, status)`，没有 label / page_index。改读真进度后 `steeringUnitLabel`（`steering-service.ts:349-359`）对 `page-1` 只能返回「这一步」；分类器 `inferAffectedFromInstruction` 的 `unitsByPage` 靠 pageIndex、`findCoverUnit` 兜底靠 `/cover/i`，两者都不命中 → `affected.length === 0` → `unsafe_or_conflicting`，「封面不要写最后两个名额」会变成**拒绝**。要同时补 schema（label/pageIndex）并重裁 §5.6「页已生成后」的 rebilled/settled 口径——产品＋schema 决策。

### 2. `linkExecutionRun` 无生产调用方：`durability='sync'` 行从不存在

`apps/core/src/p1/agent-session/postgres-agent-session-store.ts:258-287` 是唯一写执行链接 run 的入口，全仓零生产调用。跑完三条 journey 的库里 `p1_agent_runs` 只有 5 条 `exit`、0 条 `sync`。除 steering（本轮已改绑定语句绕开）外，`projectThreadWorkAuthority`（`apps/core/src/p1/agent-session/workbench-session.ts:39` 过滤 `durability==='sync'`）也恒空 → Workbench current/recent task 投影拿不到东西。这是 `1c45089f6`「放宽匹配」五轮全红的原因：它在放宽一个不存在的行。

### 3. 前端 `resolveSteeringThreadId` 的 `legacy-work:<id>` 回退在新合同下稳定 409

`mkfast-template-main/src/product/composer/steering-client.ts:41-45`：无 task 线程时开 `legacy-work:<id>` 线程。新绑定语句要求线程＝submission 记的 `agentBinding.threadId`，这条路必 409。V31-90 票面方向 2/3 范围，本轮未碰。

### 4. Core「accept 时承诺 runId、planning 异步失败」的形态

`apps/core/src/p1/agent-session/agent-session-store.ts:279` `assertWriteTurnAdmissible` 的 `AGENT_ACTIVE_TURN_CONFLICT` 在 202 之后才抛，任何客户端带错 thread 都会造出一个**不存在的 Run**，商家侧无感（右栏既无失败也无 run）。本轮只修了 web 侧不再带错 thread；改 Core 要动 accept 返回 `threadId` 的契约，未动。

### 5. `listRecentRunPins` 硬编码 `LIMIT 20`

`apps/core/src/p1/ops-console/ops-console-service.ts:488`（数据源 `postgres-ops-console.ts:388`，`ORDER BY started_at DESC LIMIT 20`）。CI 失败截图里这 20 行正好被别的 spec 的 seed-release run 占满。已排除它是本轮根因（本机 5–6 条 run 照样红），但 p2 job 七个 spec 共用一个 Core/库、这条排最后，早期 spec 多产 run 就会把 releaseA 的 pin 挤出窗口。改法应是按 releaseId 过滤而非纯 recent 20。

**已修：`6b1baff69acf827b83320d9eb37368cc345129b9`** — `listRecentRunPins(limit, releaseId?)`：给了 releaseId 就按 release 过滤（过滤在 LIMIT 之前），不给仍是 recent 20；service/P1 module（`list_recent_run_pins` 的 `payload.releaseId`）与 web ops console 的 release 输入框一并打通。Postgres 回归先红后绿：25 条别的 release 的 run 占满窗口时，不带 releaseId 读不到 release A、带 releaseId 恰好读到 A 的两条。

### 6. workbench 自动准备手机发布交接会抬 ContentPackage revision

**已开票：V31-106**（2026-08-23，用户裁决改写者）。

T20 复现的审计链：`content_package.approval_recorded` 与 `result_delivery.assisted_handoff_link_issued` 落在 `content_package.revision_conflict` 前 0.5s、同一 package。即 package 一读到 delivered，workbench 就自动 `prepare_mobile_publish_handoff`，Core 在该调用里记一条自发布 approval receipt 并抬 revision。旅程没要求的写者让任何「先拿 revision 后提交」的客户端都会撞 CAS。同形态的陈旧 CAS 还在：`tests/e2e/specs/video-native-compiler.spec.ts:233`、`image-intent-service-journeys.spec.ts:284`（本轮未红、未动）。产品问题：自动交接准备是否该算一次 revision 变更——真实商家点「采用」同样可能吃到 "Refresh and retry"（`mkfast-template-main/src/product/results/use-result-center-view.tsx:761-773`）。

### 7. `p2-browser-closure.spec.ts:344` `RESULT_ADJUST_REVISION_CONFLICT`

本轮在干净私有库上的 p2 整文件轮次里观察（见 lane 终报）；与 §6 同属「旅程外写者抬 revision」家族还是独立抖动，以本轮私有库两轮的结果为准登记在此，不据共享库的一次样本下结论。

### 8. `openConsole` 吃 5s 默认超时（V31-104②）依然存在

CI run 32589342875 的 retry1 死在 `v31-ops-console-release-journey.spec.ts:41`。与本轮 run pin 根因无关，仍归 V31-70 环境治理。

### 9. Deploy 门的轮询窗口（30 分钟）短于 Advisory telemetry 实际时长（~65 分钟）

`.github/workflows/deploy.yml` 的「Require a green same-SHA Advisory telemetry run」对 main `73e7dc603` 走了超时路径（run 32590987502：attempt 30/30 仍 `in_progress`）。门本身在判，但 Advisory 变绿后要手动 re-run Deploy。改法二选一：窗口放到 ≥70 分钟，或改为 `workflow_run` 监听 Advisory telemetry 完结再部署。

**已修：`1d037ace232559e2288bc096d666ee7f5a9cb5c4`** — 取第一条（保留轮询设计，不改 `workflow_run` 触发）。实测 Advisory telemetry 全程 ~55–65 分钟（2026-08-23：32607773750 62m／32609257815 60m／32615842113 63m／32618549598 59m），窗口 `max_attempts` 30→80（80×60s=80 分钟，比最长实测多 ~17 分钟余量），门步骤 `timeout-minutes` 31→81，job `timeout-minutes` 50→100（保住原 19 分钟 build/deploy 预算），deploy.yml:36 与 :69 的注释改写成实测时长。`scripts/ci/deploy-workflow.test.mjs` 新增断言：由 `max_attempts × sleep` 反推窗口，低于 70 分钟即红（改前实跑红：`window is 30 minutes`），并钉住步骤/job 两级 timeout 不能再把等待截短。

### 10. 付费视频在途窗口内 `开始制作` 仍可再按

`v31-video-paid-execution-journey` 的 DOM 采样（start 202 后每 500ms）：fixture 视频在途窗口约 6.5s，期间 Workstream 已在叙述（「已确认执行方案，开始生成」「已核验视频生成结果」），但 commit strip 保持 `50 积分 返回修改 开始制作` 且按钮 enabled；再按会被 Core 以「这次制作已经在跑了」挡回。合同上 §5.4 没承诺 strip 有在途态（`f90b29725` 起只在 delivered/failed 冻结），所以不是违反，属观感：按钮在已开跑后仍呈可按态。

### 11. 关标签页恢复：挂载读取只是 run 寿命窗口的一个采样，下一采样在 10s 后而 fixture run 只活 6s（已修，`dc9365d5a`）

**现象**：`v31-video-paid-execution-journey.spec.ts:208`（修完 §8 后这条腿首次真正被跑到）：关页后重开 `/dashboard`，480s 等不到 `composer-delivery-card[data-work-id=…]`；同轮 Core 侧早已交付结算（该 workspace 唯一计费在 work 创建后 ~13s 变 `committed / settled 50`）。旧库 1 红；新库锁内 5 轮＋6 轮仪器轮全绿。历史：V31-90 票面记 `video-paid-execution` 2/5 红同腿。

**真因（临时分支日志逐帧实证，N=2 注入）**：`readActiveHarnessTasks` 只列**还在跑**的 run，恢复窗口＝run 自己的寿命（fixture 视频 ~6s）。挂载那一读（t+1.5s）若落在 harness 行尚不可列的瞬间（SUBMIT-01A 停车），下一次刷新要等 `async-task-center.tsx:359` 的 10s 节拍（实测 t+11.6s），此时 run 已完成、永久离开列表，之后每一读都是真实 `tasks=[]`。恢复 effect（`composer-home.tsx:2150-2220`）每帧都在跑、`pickComposerRestoreTask` 返回 null 时不置位 `restoredFromServerRef`——**没有闩点**。

**已证伪（勿再走）**：①「新标签页只问一次、落空即永久丢失」——N=1 注入有第二次请求且恢复成功；②「采用逻辑闩死」——逐帧 state 显示 effect 持续运行、分支恒 `noRestoreCandidate`，那 49 次轮询无效只因全发生在 run 结束之后。

**修法**：`composer-session.ts` 纯函数 `shouldPollServerRestore`（窗口 20s／节拍 1s；绑定、商家草稿、超时三者任一即停）；`composer-home.tsx` `refetchInterval` 改函数形式。`staleTime`/`retry`/终态结算语义与 spec 的 480s 均未动。红→绿：新增 `composer-home-server-restore.interaction.test.tsx`（首两读空、其后含 run，断言采用且请求数 >1；改前 1 failed）；N=2 注入 spec 改后第 3 读提前到 t+2.5s 并采用；整文件锁内 2 轮 `2 passed`。

### 12. 残留缺口：任何一次读取成功之前就跑完的 run，重开标签页无从恢复

§11 治的是采样太稀；已完成的 run 根本不在 active 列表里，若 run 在第一次成功读取前结束（短 run／商家重开得晚），新标签页仍永久丢失。要覆盖它需要一条「最近完成的 run」恢复通道（新合同，扩大改面），本轮未做。

### 13. 本机交付卡 120s 超时的真形态：媒体生成 job 回送 `Sent to non-existent destination workflow UUID …:plan-r1`，且 `resume_delivery_status='sent'` 是乐观值

本机（Mac，私有库＋串行锁、`[Core]`>0）xhs-image-text-main 与 p2 `:344` 各一轮同签名：start 后 ~2s `creation_submissions.harness_state='started'` 即不再更新，120s 内无 plan rev2（同窗健康运行 rev1→rev2 仅 17–60s）→ **卡死非慢**。`brief_compilation` interrupt 已 `resolved / resume_delivery_status=sent`，但 pgboss 里 `model.media-generation` job 重试 5 次后 failed 进死信，错误原文 `Error: Sent to non-existent destination workflow UUID: harness.v1:<ws>:<composer-task:…:plan-r1>`（`@dbos-inc/dbos-sdk@4.23.6 SystemDatabase.sendDirect`）。同 spec 在 PR #29 的 CI 上绿，p2 `:344` 另一轮的失败形态是 §7 的 CAS 冲突——两轮两形态，属不稳定项。

**读法陷阱**：`p1_agent_interrupts.resume_delivery_status='sent'` 记的是「已入队」不是「已送达」，实际 send 可在 job 队列里死掉；判 resume 是否投递须看 pgboss job／死信。**已排除仪器因素**：`service-exits` 原文显示两轮各只有一个 Core 进程、从提交到 send 彻底失败全程无重启（所有退出均 `shutdownRequested=true` 收尾），DBOS 系统库名按 playwright 进程 pid 派生也不会换库——即发 send 的就是本该登记该 workflow 的同一个 Core，**属产品级问题，须单独开票**。两种候选（未证）：(a) Make 的 DBOS workflow 从未真正登记（付费门停车或启动路径提前返回）而媒体生成 job 仍被派发；(b) workflow 以另一 id 登记而 send 硬指 `plan-r1`（旁证：卡死轮只有 rev1、无 rev2）。验收建议：媒体生成 job 派发前须证明目标 workflow 已登记；`resume_delivery_status` 应反映真实送达。p2b 轮独有的 `JobRuntimeError: Tracer job was not found.` 与 L0.5 噪音已排除为成因（xhs 轮零出现却同签名）。

**已修：`eb9accf71`** — 定性为候选 (b)：`sendHarnessMediaJobTerminal`（`apps/core/src/p1/harness/dbos-workflow.ts:2596-2620`）是本文件里**唯一**不走 `HarnessRuntimeIdResolver` 的 DBOS send——同文件的 `resumeHarnessDbosWorkflow:2492`、`resumeHarnessDbosInteractionWorkflow:2529`、`abandonReleasedHarnessReservation:2546`、`createHarnessInterruptResumeBridge:428` 四处都写 `resolver?.workflowRuntimeId(...) ?? harnessRuntimeId(...)`，只有媒体回送直接拿冻结提交里的 `correlationId` 推地址。于是「resume 走得通、媒体回送走不通」正是这条不对称：resume 打的是准入登记的 runtime id，媒体回送打的是 `correlationId` 拼出来的 id。修法＝把 resolver 传进去（生产接线 `apps/core/src/assembly/core-assembly.ts:1333` 传 `harnessSchemaStore`）。红→绿证据：新增 `apps/core/src/p1/harness/media-terminal-destination.dbos.postgres.test.ts` 在真 DBOS 上以 `Sent to non-existent destination workflow UUID: harness.v1:…` 原样复现（修前红 31.5s／修后绿 0.4s）。

同轮修出**读法陷阱的真正来源**：`PgBossJobPort.startWorker`（`apps/core/src/p1/job-runtime/pg-boss-job-port.ts:344-372`）把 `terminalNotifier` 放在 handler 结果分类的 `try` 内，回送异常被记成**这个 job 自己的失败**——媒体其实生成成功了（`DurableTracerWorker.handle` 的 `reserve()` 幂等，重试只是重发通知，`p1_tracer_jobs` 里结果一直在），但死信里存的是 send 错误，于是"媒体 job 失败"这个读数本身是假的。另有一处：最后一次尝试时 catch 分支里的 `terminalNotifier` 抛出会让 `results.push` 整个被跳过，该 job 连失败记录都没有。两处均已修（回送失败改为经 `runtimeErrorReporter` 上报＋以 `terminalNotification` 字段与 job 自身结果并存记录；重试/死信策略未动）。

**更正本节两处结论**：
1. **`resume_delivery_status='sent'` 不是乐观值**，本节的"记的是已入队"读法有误。它只在 `deliverResolved`（`apps/core/src/p1/harness/interrupt-protocol.ts:470-495`）里 `resumeBridge.deliver()` 正常返回后才写；生产接线 `apps/core/src/assembly/api-runtime.ts:1678` 传了 `interactions`，deliver 走 `interactions.submit` → `HarnessResumeReconciler.resumeEvent`（`apps/core/src/p1/harness/resume-reconciler.ts:57-73`）——它 `await` 真正的 DBOS send 并要 `markResumed` 成功才返回 true，任何失败都 `release` 并抛出，由 `interaction-service.ts:1045-1051` 变成 `INTERACTION_RESUME_UNAVAILABLE`，此时 `'sent'` 永不落库。唯一软点是 `dbos-workflow.ts:417-425` 吞掉 `STALE_INTERACTION_REQUEST`（工作流已越过该问，属刻意）。所以本节的验收建议"`resume_delivery_status` 应反映真实送达"**已经成立**，无须改动。
2. **候选 (a)「workflow 从未登记」不成立**：resume 能送达就证明该 workflow 在 `dbos.workflow_status` 里活着；而 `sendDirect` 的报错是 `notifications.destination_uuid` 的外键（`@dbos-inc/dbos-sdk@4.23.6 dist/src/system_database.js:1348`），只说明**那个 id** 不存在，不说明该 run 不存在。旁证：本机遗留 system 库里 `harness.v1:…` 两种形态并存（裸 `composer-task:<hash>` 与 `composer-task:<hash>:plan-r1`），媒体 topic 通知在健康轮里正常落库。

**未证部分（诚实登记）**：本轮在干净 lane 库上跑 `xhs-image-text-main-journey` 两轮均绿，未在 e2e 里原样复现 §13 的整轮形态；上述定性建立在静态不对称＋单测级真 DBOS 复现之上，不是 e2e 复现。另注意本节"已排除仪器因素"只排除了轮内 Core 重启与 system 库改名，**没有**排除跨轮 pgboss 积压：业务库跨轮复用而 DBOS system 库按 pid 每轮新建，被中断的上一轮留下的媒体 job 会在下一轮被新 worker 捡起并回送到已消失的 system 库里的 workflow——同一句报错。本机实测其他 lane 业务库里确有大量此类残留（`meiye_lane_w03_e2e` 的 `meiye-p1-e2e-4100-jobs` 有 7913 条 `created`）。

### 14. artifact-growth AC2 `:554`「Core must apply artifact-head-replay」：spec 前提已过期（Composer 不走 2s replay 轮询）

main `73e7dc603` 与本分支同环境（私有库、串行锁、`[Core]`=158、`too many clients`=0）同红，Debian 干净机 3/3 红，CI main 仅 1 次绿 → **非本分支引入**。失败瞬间 state（trace＋分支带仪器轮 16 条打点）：

- spec `:512-516` 注释写「Production Composer sets `subscribeLive={undefined}`（V31-17），Growth rides `startWorkbenchReplayPoll`(2s)」。代码事实相反：`use-composer-workbench-controller.tsx:57-58,:86` 无条件传 `subscribeLive: subscribeAgentSemanticEvents`，于是 `agent-workbench.tsx:454` `if (subscribeLive || !loadReplay) return;` 永远早退——Composer 里 replay 轮询一次都没起过。观察到的 replay 全来自 SSE 重连/resync 回路（`agent-workbench.tsx:433-441` `runAgentLiveReconnectLoop`），只在重连那一小段连发，不常驻。
- 实测：route 命中 8 次、8 次都注入了 `e2eAgentFault=artifact-head-replay`，8 次响应 `x-meiye-e2e-agent-fault-applied` 全为 `null`。游标序列 #1 `null` → #2 `plan:…:r1` → #3 `…interrupt.requested:r1` → #4–#8 冻在 `artifact.revised:…:content-package-…:r3`；之后到测试结束 ~3 分钟再无 agent-threads 请求（同页 `harness/tasks` 10s／`pending-actions` 5s 一直在跑，页面没死）。
- 机制：Core `server.ts:2076-2078` 只有当本次 replay 窗口里存在 `artifact.revised` 才截断回写头；`snapshot-replay.ts:79-108` 带游标返回严格后缀。`artifact.revised` 走 SSE 先到客户端把游标顶过去，之后每个窗口都起始于它之后 → `findIndex` 恒 -1 → 头永远不回 → `:554` 烧满 180s。唯一有机会的 #3 发出时该事件尚未进 store（待证：需在 `server.ts:2078` 加临时打点坐实）。已排除 `e2eFaultInjectionEnabled`（`playwright.config.ts:83` `APP_ENV:'e2e'`，`api-runtime.ts:2530/2560` 为真）。

**定性**：不是产品缺陷，是 spec 建立在已不成立的前提上。稳法二选一、都要改 spec：从 SSE 侧注入截断，或在 `artifact.revised` 落库前抢先发一次带 fault 的 replay。本轮未动。

**已修：`428cec8966f47d836085269cd8fe92217d4a73cb`** — 走「从 SSE 侧」这条：Artifact 上屏后主动 abort `/events`，让 `runAgentLiveReconnectLoop` 自己的 resync 发出 replay，并在 route 里剥掉 `lastEventId` 把它改成断言本就写明的 cold 形态。反向对照（只把 fault 名换成真实但错误的 `artifact-gap-close`）必红，证明承重的是注入而非冷式 replay。

### 15. artifact-growth AC4 `:813`「execution-confirmation card 期望 0 实得 1」：断言与派生 run 的确认卡赛跑

同上环境 main 同红。失败瞬间 state：

- 全程只有一次 decide（父任务 `confirmation:5028f9e9…`，renderer 轮询 decide 前 204、后 409）。失败时挂着的是**另一枚** `confirmation:6c0fd929…`，`step: execution_selection`，属派生任务 `composer-task:result-adjust:75b5bbee…`；其 renderer 23:55:50 才首次出现并在 50/56:00/56:10/56:20 连续 204（未决），覆盖整个 30s 断言窗口。
- spec 清卡循环跑在 23:55:33–37、以 count==0 正常 break；派生确认 13 秒后才抬起。DOM（error-context.md）佐证：「已预留 5 分（等待确认）」「请先处理上方待确认事项」、改价行「预计积分 15 分」→「5 分」。
- spec `:788-790` 自己写了「result_adjust 会把 Composer 重绑到派生任务，harness run 会抬起它自己的流内 paid execution_confirmation」，而 `:797-810` 的清卡循环在它到达前跑完、`:813` 断言 0 —— 注释与断言自相矛盾。

**定性**：产品行为正当，spec 收口断言错。稳法＝等派生任务的 confirmation 抬起来并确认掉，而不是断言「一张都没有」。本轮未动（改 spec 需裁决）。§14/§15 都按仪器票口径登记，不是 flake。

**已修：`428cec8966f47d836085269cd8fe92217d4a73cb`** — 按 renderer 轮询的状态等派生 confirmation 抬起（未决 204／已决 409）再清卡，清卡预算 4→6（父任务残留＋派生卡＋一次改价），无固定毫秒等待。同轮另修出一条同族竞态：`:806` 的 regen 是对同一 revision 的 CAS 写，被自动发布交接抢先 79ms 抬版本、Core 回 `RESULT_ADJUST_REVISION_CONFLICT`（green-2 实测），改为先等该次写落地。**这是第三个为观察债① 打补丁的测试**（前两个是 T20 与 p2 `:344`）——该修的是那个写者，不是逐个读者。

### 16. m04 `:502`（workId-only Result route reopens a running copy）：CI 单次红、本地两轮绿、CI 复跑绿；真正拒绝的门当时不可见（已补日志）

CI `production-journey-mainline` 在 `c74bbf303`（run 32605346749）红一次，形态为交付卡 120s 不出现；Core 侧同一条请求链上先抛 `HarnessSelectionError: Every generated candidate was blocked by canonical policy`（`production-stage-ports.ts:1372`，栈见 mainline 日志 23:35:56 抛错、23:38:01 超时），属因果而非并发噪声。

复现：本地生产候选栈两轮全绿（单条 1 passed 1.8m、整文件 6 passed 3.2m，`[Core]` 144/367，too-many-clients 0，HarnessSelectionError 0 次）；CI 在 `9dd258292` 复跑该 job = success。

归因边界：`cb488e961`（该 job 绿）→`c74bbf303`（红）之间仅三条非 docs 差分，逐条排除——`7977ec9b5` 的 session 轮换路径在本旅程到不了（`ui-journey.ts:571` 只提交一次且按下时工作台 idle，`workbench-state.ts:21-46` 不算 engaged；两标签页经 `composer-home.tsx:1996-1997` 的 sessionStorage 隔离）；`c74bbf303` 只改 Result Center 的采用处理器，而该用例死在交付卡之前；`ea0e3c1a4` 仅格式化。**不归因于本批次改动，定性为时序敏感的单次红。**

判定链（供下次归因）：`production-stage-ports.ts:1358` 只传赢家 `candidateId`，但 `:1364-1369` 的 `visibleText` 是所有候选的并集 → `policy-gates.ts:133` 抽主张 → `:408-428` 仅 `trustedFactClaims` 能支撑的主张得 `sourceRef` → `:202-227` `critical_fact_source` 任一缺 `sourceRef` 即拒；`sourceRefs`＝`context.policyReferences.sourceRefs ∩ allowedFactRefs`（`:1430-1432`），后者只收 `layer==='current_fact' && pool==='store_personal' && factSnapshot` 的贡献（`:1456-1466`）。推测 A（未证）：事实升层与 bundle 编译之间有时序窗口，CI 慢机放大；推测 B：`price_benefit_freshness`（`policy-gates.ts:275-301`）的 `source.status!=='current'` 分支指向同一窗口。

遗留两条：(a) 异常携带 `gateIds`/`violations`/`triggeredClaims` 但从不入日志（该次 CI 全程 `gateId` 出现 0 次）——已由 `fix(harness): print the gate that blocked a selection` 补结构化输出（`harnessSelectionBlockDiagnostics`，不含 claim 值），下次再红可直接读出门 id 与踩线候选 field；(b) 措辞/粒度缺陷：落选候选踩线同样掀掉整次交付，文案「Every generated candidate was blocked」误导为「模型全写砸」。

### 17. PR #30（9fefcba84）Advisory v31：artifact-growth 4/4 绿，但 `v31-publish-handoff-selfreport` 两条红（同 run 内其余 22 文件绿）

Advisory run 32615842113：`v31-artifact-growth-journey` 修后在 CI 机首跑即全绿（§14/§15 闭合）；新红两条都在 `v31-publish-handoff-selfreport.spec.ts`，与 #30 的改动（只动 artifact-growth spec 与 docs）无交集，且同文件在 429cd43c0 的 run 32607939979 绿：

- `:439`「canonical handoff uses the server workspace…」：`locator.click` 360s 整测超时，栈止于 `:662`。
- `:773`「self-report refusals…」：`deliverViaComposer`（`:227`）→ `ui-journey.ts:404` `chooseImageTextDirection`——点了方向按钮后 `ask-merchant-group-card`（hasText 两种图文方向）的结算按钮 5s 内 `element(s) not found`。即 ask-merchant 卡在点击后消失/未重渲染，**与 V31-28 重开四条「ask-merchant 卡不出现」同族**。

Debian 干净机基线同文件也曾「round1 红（Request context disposed）/ round2 4 passed」。定性：既有间歇、非 #30 引入；未拿到失败瞬间 state，按 [[meiye-instrument-flake-family-and-evidence-rule]] 口径不下机制结论，下次再红先抓该卡的 DOM 转储。

## 同轮登记在别票的

- §37.4-E 冻结 fact-ref 上限 200、`experience-correction-surface` 生产者未建 → V31-28。
- V31-104①「断言型产品缺陷」撤回 → V31-104。
