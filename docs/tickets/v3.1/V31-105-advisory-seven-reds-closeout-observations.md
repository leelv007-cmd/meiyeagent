# V31-105 — advisory 七红收口轮（2026-08-23）的观察债：修红时看到、刻意没顺手改的十三条

**Parent**: 门可靠性（V31-104 的后继：两条 advisory job 里所有红的归属与余债）
**批次**: 登记优先（每条都有 file:line，但改法各自牵涉产品/合同裁决，不在修红分支里动）
**Blocked by**: 无
**Related**: V31-16 / V31-27 / V31-90（steering）、V31-22（ops console）、V31-28（§37.4-E 围栏与 fact-ref 上限）、V31-82（composer 解锁）、V31-104（两条 spec 的定性）、V31-70（workerd 仪器）

**Status**: open（2026-08-23）— 七红全部归因并修净于 `claude/advisory-integration`；十三条观察债逐条带 file:line（make-steering task_id 两端拼法不同／`linkExecutionRun` 无生产调用方／legacy-work 回退 409／Core 202 后异步失败造不存在的 Run／`listRecentRunPins` LIMIT 20／自动发布交接抬 revision／p2 :344／openConsole 5s／Deploy 门 30 分钟窗口短于 Advisory 65 分钟／视频在途窗口 开始制作 仍可按／关标签页恢复采样窗口(已修)／已完成 run 无恢复通道／DBOS 回送至不存在 workflow＋resume sent 乐观值），均需产品或合同裁决后另派工

**Implementation state**: not started
**Verification state**: n/a
**Evidence SHA**:
**Workflow Run**:

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

### 6. workbench 自动准备手机发布交接会抬 ContentPackage revision

T20 复现的审计链：`content_package.approval_recorded` 与 `result_delivery.assisted_handoff_link_issued` 落在 `content_package.revision_conflict` 前 0.5s、同一 package。即 package 一读到 delivered，workbench 就自动 `prepare_mobile_publish_handoff`，Core 在该调用里记一条自发布 approval receipt 并抬 revision。旅程没要求的写者让任何「先拿 revision 后提交」的客户端都会撞 CAS。同形态的陈旧 CAS 还在：`tests/e2e/specs/video-native-compiler.spec.ts:233`、`image-intent-service-journeys.spec.ts:284`（本轮未红、未动）。产品问题：自动交接准备是否该算一次 revision 变更——真实商家点「采用」同样可能吃到 "Refresh and retry"（`mkfast-template-main/src/product/results/use-result-center-view.tsx:761-773`）。

### 7. `p2-browser-closure.spec.ts:344` `RESULT_ADJUST_REVISION_CONFLICT`

本轮在干净私有库上的 p2 整文件轮次里观察（见 lane 终报）；与 §6 同属「旅程外写者抬 revision」家族还是独立抖动，以本轮私有库两轮的结果为准登记在此，不据共享库的一次样本下结论。

### 8. `openConsole` 吃 5s 默认超时（V31-104②）依然存在

CI run 32589342875 的 retry1 死在 `v31-ops-console-release-journey.spec.ts:41`。与本轮 run pin 根因无关，仍归 V31-70 环境治理。

### 9. Deploy 门的轮询窗口（30 分钟）短于 Advisory telemetry 实际时长（~65 分钟）

`.github/workflows/deploy.yml` 的「Require a green same-SHA Advisory telemetry run」对 main `73e7dc603` 走了超时路径（run 32590987502：attempt 30/30 仍 `in_progress`）。门本身在判，但 Advisory 变绿后要手动 re-run Deploy。改法二选一：窗口放到 ≥70 分钟，或改为 `workflow_run` 监听 Advisory telemetry 完结再部署。

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

**读法陷阱**：`p1_agent_interrupts.resume_delivery_status='sent'` 记的是「已入队」不是「已送达」，实际 send 可在 job 队列里死掉；判 resume 是否投递须看 pgboss job／死信。**未解**：该 `:plan-r1` workflow 为何在 DBOS 系统库里不存在（单轮内 Core 启动横幅 3–7 次，但绿轮同样多次，重启次数区分不了成败；DBOS 系统库名按 playwright 进程 pid 派生，Core 重启不换库）。p2b 轮独有的 `JobRuntimeError: Tracer job was not found.` 与 L0.5 噪音已排除为成因（xhs 轮零出现却同签名）。

## 同轮登记在别票的

- §37.4-E 冻结 fact-ref 上限 200、`experience-correction-surface` 生产者未建 → V31-28。
- V31-104①「断言型产品缺陷」撤回 → V31-104。
