# V31-28 — Composer 旅程上的 workbench 计划/中断面确定性渲染（§37.4-C/E/H 缺口）

**Parent**: V31-10 / V31-14（票已关，本票承接其浏览器旅程未闭合部分）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: implementation-complete / release-verification-pending（2026-08-13；2026-08-16 回填一条阻断）— 七腿及生产传输/恢复链已进入候选代码；旧 lane/worktree 已清理。**⚠️ 余项不止「required CI 与证据归档」**：`p2-browser-closure.spec.ts:270` 连续五次红在同一张「两种图文方向」问答卡上（含两次纯文档 PR 与一次同 commit 重跑，故与合入内容无关），与本票 08-12 重开记的「问答卡不出现」同签名、退路 `composer-question-card` 同样不出——**说明 `implementation-complete` 在 p2 这条路径上未兑现，release 验证不应在此仍红时放行**（定性来源 V31-104）。**⚠️ 2026-08-23 更正：上面这条归因已撤回**——失败瞬间实证（DOM＋`pending_questions`／`p1_agent_interrupts`）显示卡是有的，产品当时问的是**付费执行确认**；p2 的红＝helper 编舞过时（腿 1 只修了 `ui-journey.ts`，`p2-browser-closure.spec.ts` 那份拷贝没跟着修）＋第二拦路者 `6ef2b49a8` 自动开跑造成的确认死锁（已 revert）。p2 这条红**不再构成对本票实现的反证**。另登记一个真缺口：`experience-correction-surface` 生产者未建（`composer-home.tsx` 硬写 `producerReady: false`，且 `composer-conversation.interaction.test.tsx` 反向断言它必须不存在），p2 spec 该断言已按裁决移除，**待生产者落地后回补**

**Implementation state**: implemented
**Verification state**: locally production-path verified on earlier SHAs; required same-SHA CI pending
**Release state**: pending PR + `Core quality / required`
**Evidence SHA**: 39ca4b399361a9226848c71009d3d6500612ce2c
Evidence 注：integration candidate；required CI pending
**Workflow Run**: 
**Artifact Digest**: 

## What to build

商家在 /dashboard Composer 提交 image_text 定制创作后，Living Plan（agent-living-plan 五节文档）、commit strip（agent-commit-strip）、plan diff 与 typed interrupt 的刷新持久面必须**确定性**出现在旅程里。当前 Core 侧事件与 UI 组件都存在（V31-10 组件、V31-05 AgentWorkbenchHost 已挂在 composer stream 槽），但真实浏览器旅程中这些面不出现（跑十余轮仅历史上偶发出现过一次），商家看得到叙述/进度/方向问答/生成流，却看不到计划文档与确认条。

## 诊断结论（2026-08-09 codex CLI 四问取证＋主控亲验，取代下方旧 triage 假设）

**不是时序竞态（置信 0.98）——是三段生产接线从未存在**（主控已逐条亲验）：

1. **Core 生产者缺口（0.99）**：Composer submission 编排从不调用 Session Harness / PlanCompiler，该路径根本不产生 `plan.created/plan.revised` 语义事件（compilePlan/adjustPlan 只有 service 定义，composer 侧零调用者）。
2. **Thread 绑定缺口（0.99）**：提交响应未携带/未回写权威 threadId/runId，AgentWorkbenchHost 会话投影不会绑定到新 run 的 thread。
3. **语义传输缺口（0.99）**：`applyLiveSemanticEvent` 除 index 转出口外零生产调用者；loadReplay/streamReplay 未接鉴权 HTTP/SSE seam，Composer Host 未注入生产 loadReplay 与 live subscriber。
4. **跨 Thread 状态不隔离（0.90，独立真缺陷）**：reducer `set_session` 仅替换 session 不清 `plans/activePlanId`（agent-event-reducer.ts）；单例 store 下旧投影可残留误显——这也是历史「偶发绿一次」的最可能解释（置信 0.72）。

## 实施范围（按诊断四项）

1. Core：Composer submission 边界幂等创建/复用 Agent Thread+Run 并接入 Session Harness/PlanCompiler，产出真实 plan 语义事件（禁止 web 伪造 plan 事件）。
2. 提交响应携带权威 threadId/runId；web 成功后更新 Workbench 绑定或失效重取 get_workbench_session。
3. 为 loadReplay/streamReplay 接鉴权 HTTP/SSE 生产 seam；Composer Host 注入生产 loadReplay + live subscriber，从 snapshot 的 lastEventId/lastStreamOffset 续传。
4. Thread 变化/回 Idle 时原子清空计划与中断投影（set_session 语义修正）。

Living Plan 组件与 plan reducer 主逻辑无需重写。下述 lane-28 worktree 与 PG 数据库仅是历史诊断记录；资源已清理，不再是可恢复现场。当前执行入口见 `docs/ops/current-project-status.md`。

**排期约束**：与 V31-27（steering 前台）语义相邻（同触 composer-home / workbench 会话面），按语义锁纪律串行——V31-27 合入后再开工本票。

## 2026-08-09 triage 证据（merge controller，全程留存）

- 提交链已修通：image_text 无 case_image 源时 Core 400 fail-closed（`INVALID_STATE: Required source slot case_image`）——spec 已补 `seedComposerInlineAuthorize` 种子；种子后 run 正常起（叙述→创作进度→两种图文方向问答→「正在写第一版…」流式）。
- 但 `agent-living-plan` / `agent-commit-strip` / `agent-plan-diff` / `ask-merchant-group-card` 在 composer 旅程 DOM 快照中从未出现（方向问答由另一渲染器出面）；执行确认中断刷新持久（§37.4-H）同样等不到可锚定面。
- 环境差异已排除：main 与 lane-21（V31-25 代码）、新旧测试库、export/manual_copy 缺省均复现红。
- 复现命令：`PORT=3061 PLAYWRIGHT_CORE_PORT=4161 TEST_DATABASE_URL=postgres://meiye:meiye@127.0.0.1:54329/<fresh-db> pnpm exec playwright test tests/e2e/specs/v31-living-plan-journey.spec.ts`
- 疑点方向：AgentWorkbenchHost 会话投影是否在新提交后真正绑定该 run 的 thread 并消费 plan 语义事件（V31-03 projector→V31-04 reducer→V31-10 UI 链在 composer 宿主上的接线）；偶发通过说明链路能通、大概率是绑定/时序问题而非缺组件。

## Acceptance criteria

- [ ] `v31-living-plan-journey.spec.ts` fixme 去除并全绿（agent-living-plan 五节 + 修订 + diff）
- [ ] `v31-context-fence-journey.spec.ts` §37.4-E fixme 去除并全绿（计划真相面或 stale reconfirm 可锚定）
- [ ] `v31-interrupt-resume-journey.spec.ts` §37.4-H fixme 去除并全绿（typed interrupt 刷新不丢 + resume）
- [ ] 上述三条即验收合同，禁止改弱断言；修复在产品接线侧

## Evidence

> 空表由 L-CI 脚手架落盘，**Wave 4 对着真实证据填**。填表规则（机器可判优先）：
> `AC<n>` 对应「Acceptance criteria」小节里第 n 个 checkbox 条目，顺序固定；id 列只写
> `AC<n>`，不加任何修饰。writer / consumer 写 `path/to/file.ts:line`。PG result 与
> Playwright result 写真实结果（如 `12/12 pass`）；没跑就留 `—`，不写「应该通过」之类
> 的推测。required CI job 写 `.github/workflows/core-quality.yml` 里的 job 名。
> 单元格内的 `|` 必须转义成 `\|`。空值统一写 `—`。
> **三个结果列各守一轴，不得跨轴填**：`unit/eval result` 只收单测与离线评测结果，
> `PG result` 只收真实 Postgres 套件结果，`Playwright result` 只收浏览器旅程结果。
> 把 `biome` / `tsc` / 单测结果写进 `Playwright result` 属跨轴，须改回本轴。
> 三个结果列的空值分三种，必须区分：`—`＝该格未填（脚手架初始态）；`n/a`＝该 AC 在该轴上
> **没有**证据要求（须在表下用一句话说明为何没有）；`未跑`＝该轴有要求但本轮未执行（须写出
> 未执行的原因）。writer / consumer / failure-recovery test / required CI job 四列的空值
> 仍统一写 `—`。
> **勾选规则**：writer / consumer / failure-recovery test / required CI job 四列非空，**且**
> 三个结果列每一格都是真实结果或 `n/a` ⇒ 方可勾选。任一结果格为 `—` 或 `未跑` ⇒ 不得勾选。
> （原规则是「一行未填满，对应 AC 不得勾选」。在只有 PG / Playwright 两个结果列时，它把
> 「本来就不该有 PG 证据的 AC」也判成未验收——列集扩展史见 V31-29「Evidence」节末。）

| AC | production writer | production consumer | failure-recovery test | unit/eval result | PG result | Playwright result | required CI job |
|---|---|---|---|---|---|---|---|
| AC1 | — | — | — | — | — | — | — |
| AC2 | — | — | — | — | — | — | — |
| AC3 | — | — | — | — | — | — | — |
| AC4 | — | — | — | — | — | — | — |

## Wave-4 浏览器实证：这四个面在真实旅程上仍然不出现（2026-08-10，review-memory 落，W4-D 证据）

**本票 Status 是 `done (merged 6bf659915)`，但它要解决的现象在真实浏览器上仍然存在。** W4-D 2026-08-10 第三轮（HEAD `2da11d5ab`，逐 spec 独立进程，一次性库）实测：

| 项 | 实测 |
|---|---|
| 暴露 spec | `tests/e2e/specs/v31-mid-run-steering-journey.spec.ts`，2 FAIL（`round3-per-spec/SUMMARY.txt`） |
| 断言位置 | `:108`（用例 `spec.ts:78`）与 `:169`（用例 `spec.ts:146`） |
| 定位器 | `plan-commit-strip` `.or(` `artifact-panel` `).or(` `agent-activity-line` `).or(` `composer-question-turn` `)`，取 `.first()` |
| 结果 | 四个 **全部**未出现，`toBeVisible({ timeout: 120_000 })` 超时 |
| 日志 | `round3-per-spec/v31-mid-run-steering-journey.log:160`（定位器）／`:166-167`（等待记录）／`:172` 与 `:203`（断言行） |

**这条实证对本票的价值在于它排除了两种解释**：

- **不是选择器写错**：`.or()` 串了四个候选，四个都没出现。若只是某个 testid 改名，其余三个仍应命中其一。
- **不是等太短**：120s。本票诊断结论里那条「历史上偶发出现过一次」的现象（诊断第 4 项判为 reducer `set_session` 不清 `plans/activePlanId` 所致）在本轮 13 spec × 3 轮中**一次都没再出现**。

**注意 I 旅程是干净的**（`v31-thread-root-workbench` **5/5 PASS**，全轮唯一）。它同属 workbench 面但走的是 thread root 入口——所以缺口不是「AgentWorkbenchHost 整个不工作」，而更像是**composer 提交这条路径上的产出/绑定/传输三段**（本票诊断第 1-3 项）在真实旅程上仍未闭合。这条对照缩小了排查面，也说明本票的诊断四项里至少前三项值得重新逐条核。

**给主控的收口含义**：本票的 `done` 与 V31-27 的 `done` 形成一条链——V31-27 的 AC1 被本票的缺口挡住，两票的 `done` 都应视为**未验收**。建议与 V31-18 的 `merged-with-evidence-debt` 口径一并裁。**本轮未改本票 Status 与任何 checkbox。**

## Wave-4 终审 v2：三条剩余红均回到本票（2026-08-10）

> 锚树：集成树 `d3e29ee0f`；证据目录：
> `scratchpad/w4d/w4-final-v2/round-per-spec/`。本节只记录失败边界，不把红灯当成根因结论。

| 旅程 | 实测断点 | 归票理由 |
|---|---|---|
| `v31-context-fence-journey.spec.ts` | 唯一 case 失败：`agent-plan-diff` 等待 180s 仍不存在（spec `:215`；log `:185-212`） | 改价后的 Plan diff 是本票 AC2 直接合同；不是 V31-55 admission 错误形态 |
| `v31-interrupt-resume-journey.spec.ts` | 3 个 case 中 `1 passed / 2 failed`；其中本票所属 case 等待「两种图文方向」`agent-pending-interrupt` 180s 不可见（spec `:231`；log `:171-198`） | typed interrupt 的产出、Composer 绑定与刷新持久正是本票 AC3；另一个 expiry fixture 失败不混入本票，见 V31-57 |
| `v31-partial-resume-assisted-journey.spec.ts` | 唯一 case 失败：恢复页上等待「两种图文方向」`agent-pending-interrupt` 120s 不可见（spec `:143`；log `:143-170`） | 同样死在 Composer/workbench 的 typed interrupt 面，尚未走到 partial delivery/settlement；因此先归 V31-28，不误归部分交付后端 |

本轮不勾 AC：三条都是对本票未闭合的浏览器反证，并且证据还不足以在「产出、Thread 绑定、语义传输、reducer 隔离」四段中选定单一根因。

## Wave-4 resume 浏览器续证（2026-08-11，INT `a9095ad40`）

> 证据：`/tmp/v31-final-verify/SUMMARY.txt` 与 batch logs。仍**不勾**任何 AC。

| 旅程 | 本 resume 实测 | 归票 |
|---|---|---|
| `v31-context-fence-journey` | full gate：`agent-plan-diff` 180s 不可见（spec `:215`） | AC2 仍红 |
| `v31-interrupt-resume-journey` | crit：resume-by-id pending interrupt 不可见；owner-workspace case **PASS**；expiry case 进 terminal 但退款文案停在「处理中」（expiry 归 V31-57，interrupt 面归本票） | AC3 仍红 |
| `v31-living-plan-journey` | short batch：revise `response.text` 300s hang；start 后 delivery card 180s 缺（与 V31-56 重叠；本票仍背 Living Plan 确定性渲染合同） | AC1 仍红 |
| `v31-partial-resume-assisted-journey` | full gate 串中受 Web ECONNRESET cascade；无新绿证 | AC3 家族仍欠 |

Evidence 表四行 Playwright 轴可记：**本 resume 仍红 / 未转绿**（不填假绿）。unit/PG 本轮未为本票新取数，表内 writer 列保持脚手架，**零勾选**。

## 2026-08-12 重开（triage 收编，证据=docs/ops/browser-gate-tail-triage-2026-08-12.md §2.1）

CI run 31554310069 中 4 个 case 在**服务全程存活**时独立复现「问答卡不出现」：`composer-card-family.spec.ts:243/:372/:449`（p2，`ask-merchant-group-card` 240s 超时，且 :243 失败前已通过 `composer-progress-card` 断言——run 在流式推进）＋ `m04-browser-hard-gate.spec.ts:364` image_text→xiaohongshu（prod，`ui-journey.ts:341` 同时等 `ask-merchant-group-card` 与 `composer-question-card` 两个 testid，300s 双双不出现）。

**较 08-10 关票时的新事实**：当时记录「方向问答由另一渲染器出面」（composer-question-card 退路可用）；本轮 m04 把退路也一起等了，**同样没出**——退路在本票合入（6bf659915）之后也断了。三条 composer-card-family 走**免费 copy 路线**，与 V31-63 付费 admission 主簇无关（两门日志 `Price-drift` 命中 0）。

初步方向（按可能性排序，triage 读码锚点）：
1. run 先进 `delivered`、问答轮询随即关闭：`use-composer-interactions.ts:142/:145/:148`（`refetchInterval`/`enabled` 均带 `phase !== 'delivered'`）＋ `ask-merchant-interaction-slot.tsx:51-57` 同理；spec 自注已记 T44 后 industry gap 变 deliver-first（`composer-card-family.spec.ts:253-256`），若 promotion gap 同样 deliver-first 则正是本症状。
2. Core 侧未升 gap：`structured-nodes.ts:943`（`fallbackGuidanceGap` 的 `团购|优惠|套餐|活动` 分支）→ `:369-378`（`blockingQuestion`）；`:901` unattended='continue'。
结构性观察：问答卡与执行确认卡共用 `transports.readInteraction(taskId)` 单槽通道按 `kind` 分流（`use-composer-interactions.ts:151-157`），渲染点 `composer-home.tsx:3839`（生产槽）/`:3855`（legacy fallback）——两个渲染器都没出，缺的是上游数据。

**验收跑前置**：V31-64（门仪器）先修，否则复跑判据被级联污染。

## 2026-08-12 晚 主控取证复跑定性（当前基线 617ce747，探针库留存）

**先纠一个归因**：CI run 31554310069 的基线已含 `631ca906`（轮询腿修复，经 `557c007e` 入 main；`git merge-base --is-ancestor` 证实）——「CI 跑的是未修码、复跑即绿」不成立。主控在当前基线全新库复跑，4 case 家族**红依旧**，且两条腿各有独立根因，均不是渲染器缺陷：

**腿 1（m04/xhs image_text，`ui-journey.ts:341`）＝e2e 编舞漂移，脱离 V31-56 显式启动线**。探针库 `v3128_xhs`@54329：提交 202 后 `creation_submissions.harness_state='reserved'`、`harness_start_attempts=0`、DBOS `workflow_status` **0 行**、`pending_questions`/`p1_agent_interrupts` 均 0；失败 DOM 里 Living Plan 条完好、「开始制作」按钮未点。`submitComposerJourney` 还停留在「202=已启动」旧合同（fixture 注释原文），从不点 `agent-commit-strip-start`；而图文方向问题是**执行内 interrupt**（V31-63 fence 探针实证 admission 之后才升起）——不点开始制作，问题结构性不可能出现，两个渲染器缺席是正确行为。**已修**：`tests/e2e/fixtures/ui-journey.ts` image_text 分支改为等 strip 就绪→`waitForResponse('/start')`→点击→再等方向问题（编舞抄 fence spec 已验证配方）；`execution-confirmation-interaction-card` 期待仅保留给 video（image_text 预确认路径无流内新卡，§37.4-E 下 fresh 卡只以 successor 形态出现）。

**腿 2（composer-card-family :243/:372/:449，免费 copy）＝V31-14/V31-25 快照 Make 设计迁移，spec 期望的旅程整段不可达——待拍板**。主控全 spec 复跑（当前基线，全新库）：**3 failed / 7 passed（14.9m），红的正是 CI 三 case，服务全程健康**（stub 类与纯 UI 类照常绿）。探针库 `v3128_ccf`@54329：9 个 `beautyMarketingHarnessWorkflow` 全 **SUCCESS**、intent 步 **9/9** 走 snapshot_validator，DBOS streams/events/operation_outputs 里问题文案与 suspended 事件 **0 命中**；intent 步真实输出 `mode='snapshot_validator', llmInvoked=false, routingSource='policy', route='customized', blockingQuestion=null`（`make-snapshot-consume.ts:106` `materializeIntentFromSnapshot`，模块头注释白纸黑字「guidance gaps are not re-opened on the Make path」）。即：带冻结快照的 Make 一律 validator 化，fixture 的 `fallbackGuidanceGap`（`ai-sdk-runner.ts:1339-1350`，本 prompt 必产 promotion_details gap）整层被绕过——triage 假设 1（deliver-first 关轮询）与假设 2（Core 没升 gap）都只对了表层，真相是**提问被设计性上移到方案期**（`composer-plan-session.ts:814` clarification interrupt 通道存在），而 e2e 方案期内核在该 prompt 上直接给 plan 不提问。产品级问题：copy 路线「问答→hold→settle→精修」旅程（T31 三卡族）现无触发路径。**两个方向待用户拍板**：(a) 方案期内核＋plan surface 补提问（旅程搬家，spec 编舞重排到 plan 阶段）；(b) 承认 copy 快照路线 deliver-first，T31 三 case 改约（问答卡族只在方案期 clarification 与 image_text 执行内 interrupt 两个场景保留）。

**腿 3（SSE 帧门，付费 progress/token 帧客户端全丢）**：lane 修复 `831caee2`（`use-workflow-event-stream` 接受 `${taskId}:plan-r<N>` id 族，12/12 合同测试＋消费方 8/8），已由主控 cherry-pick 合入（`04b76c31`）并复核 12/12＋8/8。

**腿 4（客户端静默吞答案——双读腿竞态，主控 trace 实锤）**：腿 1 修复后旅程推进到答题步，答案却从未到达 Core（留存库 `v3128_xhs2`：interrupt 恒 pending、`decision_events` 0 行；Core 日志零报错；trace 网络流里 **POST /interaction 一次都没有**，而 aria-pressed 已翻）。根因：卡由 snapshot 读腿渲染（06:43:04.595 先到），`answerAskMerchant` 却硬依赖较慢的 plain 读腿的 `pendingAskRequest`（06:43:05.474 才首次非空），点击落在间隙里被 `if (!pendingAskRequest) return` **无声吞掉**——真商家手快同样中招，且无任何重试/提示。**已修**：slot 把渲染中的 request 传给提交回调（`ask-merchant-interaction-slot.tsx` onSubmit 带 request；`use-composer-interactions.ts` answerAskMerchant 按调用方给的 request 提交），新合同测试钉「own poll 未落地时答案仍送达」（9/9＋group card 16/16）。

**腿 5（服务端写闸拒收 own prepared attempt——trace 409 实锤）**：腿 4 修复后 POST 发出，被 `HARNESS_INTERACTION_TASK_MISMATCH` 409 拒（trace 记录响应体）。两道闸（`application-service.ts` submitInteraction 的 `resume.runId !== taskId`、`interaction-service.ts` submit 的 expectedRunId 校验）都把 `${taskId}:plan-r1` 当外来 run。**已修**：新增 `prepared-attempt-run-id.ts` 共享谓词（与腿 3 的 SSE 门同一精确形态规则），两闸放行 own prepared-attempt 家族、malformed/carrier 后缀/异 task 仍 409（application-service 11/11＋interaction-service 27/27＋core tsc 0 错）；V31-63 successor 答案路由零触碰。

### 终局（探针第 6/7 轮，库 `v3128_xhs6`/`v3128_xhs7` 留存）

腿 5 修后答案落库全链证实：`decision_events` 1 行、interrupt `resolved`、`resume_delivery_status='sent'`、DBOS workflow SUCCESS，页面按所选「干货科普版」出多页大纲并逐页配图至候选。第 6 轮 spec 仍红是旅程观测窗问题（fixture 速度下 run 从答题直冲 delivered，60s 窗口里 resumed stage line 没被观测到）——settlement race 补第三证据臂（新增 delivery card 计数，点击前基数，镜像 terminalFailure 模式）。**第 7 轮：`xhs-image-text-main-journey` 1 passed（34.6s）**——提交→方案→开始制作→方向问答→答案落库→续跑→配图→delivered note workspace 整案贯通。修复 commit：`4e944bf6`（core 写闸）/`5fcdd280`（web 竞态）/`c753e6a2`（旅程编舞）/`04b76c31`（SSE 帧门 cherry-pick）。

## 2026-08-12 深夜 免费 copy 腿裁决与实施（copy 腿 lane，主控两轮裁决落定）

**触发条件分权定性（本轮裁决实质，替代「方案期对促销 gap 提问」的初始方向）**：探针实证（库 `v3128_copy`@54329，未改码基线）促销缺价 prompt（含 card-family 原三 case 的『团购/优惠活动』与 day0 的『把新团购做一套能发的』）**一律先触发 Brief 高危确认**（trigger=high_risk_fact_missing_or_conflict，Brief 阻塞提交、briefConfirmation 恒在提交体上），且 Brief 确认面商家不输入任何信息。据此定性：**Brief 高危确认=事实风险的知情继续（consent），方案期提问=非高危指导缺口的补充征询（supplement），两机制按 prompt 形态分权，不叠加**。方案期提问的 e2e 触发签名=泛化模糊创作请求（无行业词/无促销词/无素材，如「随便帮我写点这周能发的内容」）；促销 prompt 继续走 Brief 知情继续→deliver-first（uiux-day0-contract 高危冲突 case 合同原样保住）。

**实施（copy 腿）**：
1. e2e 方案期内核提问分支：`apps/core/src/assembly/e2e-session-fixture-decision.ts`（从 core-assembly 内联抽出；泛化模糊签名→ask_merchant『这次内容主要属于哪一类美业服务？』(industry_category)，答案 turn→propose copy plan 带答案；三页/其余 prompt 行为零改动）。
2. 答案 turn 带原意图上下文：`clarificationAnswerTurnMessage`/`splitClarificationAnswerTurnMessage`（composer-plan-session.ts）——intent turn projection 无 thread 历史，裸答案对 fixture 与 live 模型同样不可规划。
3. copy 答后自动开跑（D-043）：`answerClarification` 对 `policy_exempt_copy` freeze 返 `makeReady:true`＋run completed（composer-plan-session.ts）；coordinator `answerClarification` 三分支（plain/reprice/replay）对 makeReady 补幂等 `startHarness`（submission-coordinator.ts）。merchant_confirmed 路径零触碰（V31-56 显式开跑模型不受影响）。
4. T31 三 case（composer-card-family.spec.ts :243/:372/:449）换泛化模糊 prompt 编舞重排：:243=方案期问题卡→答→进度→交付三面有序＋全商家语言；:372=答→自动开跑→交付（答案体现进 plan）；:449=改约为方案期持久等待合同（不答则 run 持久等待、刷新后问题仍在、答案仍可续跑交付）——旧「倒计时默认值放行」语义不搬进方案期。
5. 答题可按发（web，两处小修，实跑逼出的既有缺口）：
   - `composer-pending-interrupt-gate.ts` 新增 `composerSubmitDisabledGate`——提交后 lens 冻结/报价清空把发送钮锁死，问题卡的「答案就是这一按」被自家提交门永久挡住；answering 时仅越过 submission 门（busy 门原样）。composer-home submitDisabled 改走该 gate（node:test 3 例合同）。
   - `composer-home.tsx handleIntentChange` 补 `!pendingComposerClarification` 守卫——冻结态下打字原语义=「重开新一次创作」（rebind 新 session、`task:null`＋丢 question turn，composer-session.ts:236-252），问题卡答题打字即把要 POST 的 task 句柄挖空，`submitPlanCommand` 静默 toast 退出、`/answer` 永不发出（探针实证：修前点击无 POST，修后 POST 携 `{"merchantAnswer":"皮肤管理"}`）。
6. 方案期停车 run 的 SSE 断流重连（web，`use-workflow-event-stream.ts`）：问题卡停车时 Make 未开跑→`harness_runtime.task_requests` 无行→`owns()`=false→workflow events SSE 404；EventSource 对非 200 **永久关闭不重试**，答后 Make 即使 11s 内交付（audit 实证 answer→package_delivered=11s、Core 端 answer 路由 169ms 内已响应），页面进度卡/交付卡永不渲染。修=CLOSED 态 3s 后重订阅（`connectAttempt` 重跑订阅 effect；终态 success/failed 已 close 不会循环）。此缺口只此前未暴露是因为旧流程 Make 恒在 submit/prepare 期就有 task_requests 行。

**Follow-ups（本轮不做，待开票/归主控）**：
- [ ] 方案期 unattended 机制另开票：clarification 过期→`proposalFromSubmission` 默认编译＋auto-start（:449 旧「默认值放行」语义的方案期产品等价物）。
- [ ] live 模型路线「Brief 确认过的缺口不再重问」属提示词调优，另记。
- [ ] `composer-failure-recovery.spec.ts` W10 与 `pending-actions-inbox.spec.ts` 用促销 prompt 期待执行期 ask 卡，与本票同根（快照 Make 不再提问）且按分权定性促销 prompt 也不会在方案期提问——执行期问答编舞重排（含 fence spec）归主控后续轮，本轮一行未动。
- [ ] SSE 404-重连（实施项 6）是客户端修法；server 侧备选=`owns()` 认领已备案而未开跑的 composer 任务（harness postgres-store 越界读 submission 存储，分层代价更高）。若后续别的停车形态（执行期 fence 等）也踩 404 断流，再评估上收 server。
- [ ] 本地 e2e 偶发「问题卡后页面 fetch 响应整页丢失」传输悬案（V31-64 仪器票邻域）：答案 POST 抵达 Core（169ms 内已写响应、audit `package_delivered` 答后 11s）但浏览器侧 `posted.response()` 恒不归、且该页 in-page GET 也悬（probe5/6 复现）；同 probe 再跑一把全部 58ms 归位（probe7），SSE 面（进度/交付渲染）全程不受影响。已排除：Service Worker（`serviceWorkers:'block'` 复现不变）、PG 饱和（悬窗 pg_stat_activity 峰值 25/100）、Core/轮询端点（decision 对停车任务 404@3.5ms）。疑点=vite dev 传输层。:372 的首答 envelope 断言因此改钉 replay（幂等重放同壳 `makeReady:true`，首答 envelope 由 core 合同测试钉死），行为面（按下即续跑→交付、无显式 /start）不变。probe 留档：scratchpad probe4-7.log（会话临时目录，过期以此记录为准）。

**记录在案的跟进项**：① ~~`answerExecutionConfirmation` 与腿 4 同构~~ → **2026-08-23 已核：确认卡单挂载点 `composer-home.tsx:4237-4238` 与守卫同腿，腿 4 竞态不适用**（挂载条件与传入的 `request` 都是 `pendingExecutionConfirmation`，守卫读的是同一个值，守卫为 null 时卡片不可能存在；全仓仅此一处挂载）。已加钉现状用例，第二渲染腿一旦出现即断在 `use-composer-interactions.interaction.test.tsx`；② 第 7 轮 Core 日志一条非致命 `L0.5 production sampling failed: EvalLayerResult ... is immutable and already bound to different facts`（采样层，不阻旅程），若三门复跑再现需另查；③ m04 image_text 与 xhs 共用同一 fixture 路径，未单独本地复跑，以三门 CI 复跑为准。

## 2026-08-12 第六腿（CI run 31573910031 m04:364 揭出，主控定性）

跟进项 ③ 兑现成真红：CI production 门 `m04-browser-hard-gate.spec.ts:364`（image_text）三次尝试同签名——**新编舞全走通**（202 五 id ✓、开始制作 start POST ✓、方向卡出现并答 ✓，trace 实证），随后 240s 内 `composer-stage-line` 一条不出，而同 run 实际交付成功（error-context 里「成品已就绪 · 第 1 版」在位）。本地复现（探针库 `meiye_playwright_4131_25733` 留存）：DBOS streams 里 **13 条 progress 信封完好**，全部盖 `composer-task:<id>:plan-r1`，浏览器一条没收到。xhs 主旅程绿只因它不断言 stage line——**白话进度在 merchant_confirmed 运行上结构性从未流出过**。

两处服务端缺口叠加（腿 3 客户端帧门的服务端镜像＋一）：
1. **`workflow-events.ts:73` 精确匹配过滤**：订阅以 base taskId 打开，`taskId:plan-rN` 的 progress/token 帧被当外来 workflow 丢弃。修=复用 `prepared-attempt-run-id.ts` 共享谓词放行 own prepared-attempt 家族（carrier 后缀/异 task 仍拒）。
2. **`dbos-workflow-events.ts` readEvents 对未出生 workflow 静默收流**：浏览器 202 后立刻订阅，而 V31-56 下 DBOS workflow 到点「开始制作」才创建；`DBOS.readStream` 对 `!status` 直接 break（SDK `dbos.js:1101` 实证），readEvents 空结束→`getResult` 无超时轮询挂到 run 跑完→SSE 只吐一帧终态。修=流结束时查 `getWorkflowStatus`：workflow 不存在或仍活跃（PENDING/ENQUEUED/DELAYED）则等待重试（500ms，偏移去重不重放），仅终态收流。

先红后绿：`workflow-events.test.ts` 新增 prepared-attempt 投影用例（红：仅剩 state 帧→绿：progress/token/state 三帧）；`dbos-workflow-events.test.ts` 新增「订阅先于运行创建仍收帧」＋「重试流不重放已交付帧」两用例（11/11）。core tsc 0 错。行为验证=本地 m04 image_text case（下节）。

## 2026-08-12 第七腿（第六腿修后 m04 本地复跑揭出）

六腿修后 m04 image_text 失败点从 `ui-journey.ts:641`（白话进度）前移到 `:1093`（`downloadFullPackage` export 步）：`result_export` 恒 500 `APPROVAL_CONTEXT_UNAVAILABLE`（三轮复现，确定性）。库证（`meiye_f5_verify`）：冻结 ContextBundle 键=`context-<taskId>:plan-r1`（`production-context-port.ts:355` 按 run 分键——正确，reprice 后 plan-r2 需自己的冻结包），而包身 `source.workflowId`=基础 task id（`operations-visual-adoption`/`application-service` 等多处把它当 task 身份消费——也正确）；export 的 `ContextBundleApprovalPolicyResolver.resolve`（`content-package-delivery.ts:936`）只查 `context-<基础id>` 恒 miss。写路径 `content-package-revision-port.ts:598` 早已懂这个家族（`isPreparedAttemptWorkflowId` 门控＋强制 `source.workflowRevision === input.workflowRevision`）——漏的只是读路径。

修=resolve miss 时用包上的 `workflowRevision`（写入时已锁死=冻结 plan revision）经 `preparedAttemptRunIdForTask` builder（`prepared-attempt-run-id.ts` 新增，与谓词对偶、拒 0/负数/非整数）重构 attempt 键回查。先红后绿（freshness 测试断言两次查询顺序）；操作域套件 43/43；core tsc 0 错。

**行为验证（四轮）**：二轮=六腿修后失败点前移（白话进度断言通过），export 步撞 54329 多 lane 连接耗尽（`too many clients`，53300——本地基建假红，判别注记已记 V31-70）；三轮=连接空窗下 export 仍红，确定性坐实第七腿；**四轮=七腿修后 `m04 image_text → xiaohongshu` 整案 1 passed（1.2m）**——submit→strip 开跑→方向问答→白话进度→交付→restore→adopt→deliver→export/download→restore 全链贯通，正是 CI run 31573910031 三次尝试全红的那条 case。探针库 `meiye_playwright_4131_25733`（六腿 13 条 progress 信封证据）留存。

## 2026-08-16 回填：`implementation-complete` 在 p2 这条路径上尚未兑现（由 V31-104 定性转来）

`p2-browser-acceptance` 连续五次红里，`p2-browser-closure.spec.ts:270`
（helper `submitImageTextAllowingTerminalFailure`，调用点 `:841`）死在：

```
expect(locator).toBeVisible() failed
Locator: getByTestId('ask-merchant-group-card').filter({hasText:'/两种图文方向/u'})
     .or(getByTestId('composer-question-card').filter({hasText:'/两种图文方向/u'}))
     .or(getByTestId('composer-stage-line').filter({hasText:'已按你选的方向继续准备整套图文'}))…
Timeout: 180000ms — element(s) not found
```

**与本票「2026-08-12 重开」记的症状同签名**：同样的两个 testid、同样的「两种图文方向」、
同样的"服务全程存活但卡不出现"，而且**退路 `composer-question-card` 同样没出**
（正是那一节记的「退路在本票合入 6bf659915 之后也断了」）。

证据强度值得单说：五次观测里**两次跑在纯文档 PR（#18/#19，零产品代码）上，
第五次是同一 commit 的 attempt 2 重跑**（run `31939952353`，job `95153522135`）。
所以这条红**与任何被合入的内容无关**，不是某次改动引入的回归。

**对本票的直接后果**：当前状态写的是
`implementation-complete / release-verification-pending`，
但 p2 这条路径上该行为**没有兑现**。七腿的修复各有其证，本条不推翻它们；
它说明的是**验收覆盖面不足**——`m04` / `composer-card-family` 之外，
`p2-browser-closure` 这条也走同一张问答卡，而它一直在红。
**release 验证不应在这条路径仍红时放行。**

定性来源＝V31-104（该票只负责把两条恒红分开、各自找归属，不重复开修复票）。
本条的机制假说仍以本票「2026-08-12 重开」那两条排序为准，
其中第 1 条（run 先进 `delivered` → 问答轮询被 `phase !== 'delivered'` 关掉）
与「服务活着但卡不出现」的形态最吻合，建议从它入手。

## 2026-08-23 更正：上面这条回填的归因错了，p2 的红不是本票的产品缺陷

08-16 回填把 `p2-browser-closure.spec.ts:270` 判成与本票「问答卡不出现」同签名，
并据此说本票的 `implementation-complete` 在 p2 路径上未兑现。**拿到失败瞬间的状态后，
这个归因不成立，予以更正。**

**实测（main `73e7dc603`，本地两次确定性复现，服务全程存活）**：卡是有的、
问答通道正常产出——只是产品此刻问的是**付费执行确认**，不是「两种图文方向」。

| 证据 | 实测 |
|---|---|
| DOM 快照 | 活文档「第 1 版」＋可见的 `开始制作`，以及 `确认本次执行方案` 卡（`已预留 15 分（等待确认）`） |
| `harness_runtime.pending_questions` | 1 行，`renderer='execution_confirmation'`、`unattended='hold'` |
| `public.p1_agent_interrupts` | 1 行，`step='execution_selection'`、`action='confirm_paid_execution'`、`reservedCredits=15` |
| `execution_spine.creation_submissions` | `harness_state='started'`、`harness_start_attempts=1` |

**正确定性＝p2 路径的红＝helper 编舞过时 ＋ 第二拦路者（`6ef2b49a8` 自动开跑死锁）**：

1. **helper 编舞过时（＝本票腿 1 的漏网半边）**：腿 1 当时只修了
   `tests/e2e/fixtures/ui-journey.ts`，`p2-browser-closure.spec.ts` 里
   `submitImageTextAllowingTerminalFailure`（`:225-287`）是**同一套旧编舞的第二份拷贝**，
   没跟着修：202 之后直接等方向问答，把放行动作排在其后。而方向问答是执行内 interrupt，
   不放行 Make 就结构性不可能出现。同文件另一用例 `:690-710` 早就是对的。
   合同依据＝authoritative plan §5.4「付费媒体执行 → Critical Interrupt」＋V31-56
   让 `开始制作` 成为该确认。另注：`1c45089f6` 曾修过这半边，当晚被 `a69ea7740`
   连同 library-source 改动一并回滚（回滚正主不是它），**从未被单独判过**。
2. **第二拦路者＝`6ef2b49a8`（viral 自动开跑）造成的死锁**：Make 在确认前开跑并抬起
   流内确认中断，而 strip 仍渲染 `开始制作`；点它走 decide+start，决定落库
   `confirmed`（`p1_plan_confirmation_decisions`）但**不投递 resume 给已抬起的中断**
   （`p1_agent_interrupts` 恒 `status='pending'`、`resume_delivery_status='none'`），
   run 永久停住。trace 里全程只有三条业务 POST（submissions / decide / start），
   没有任何 interaction 提交。**已 revert**（见本轮 commit ①）。

**因此 08-16 那句「`implementation-complete` 在 p2 这条路径上未兑现」撤回**：
修完编舞＋revert 后，该用例一路走到交付（提交→开始制作→两种图文方向→答→候选流式→
delivery card→delivery-morph/candidate-capsule/sediment 全过）。
本票七腿的实现不被 p2 这条红反证。

### 顺带登记一个真缺口：`experience-correction-surface` 生产者未建

同一用例在交付后断言 `experience-correction-surface` 可见，但该面**结构性不可能出现**：
`mkfast-template-main/src/product/composer/composer-home.tsx` 硬写
`producerReady: false`（注释「no auto-split yet」），`task-experience.ts` 的
`shouldShowExperienceCorrection` 因此恒 false；产品自己的
`composer-conversation.interaction.test.tsx` 反过来断言它**必须不存在**
（V31-75 AC「空「纠错怎么记」不常驻」正是这么定的）。
两条测试正面打架，e2e 那条属对未建功能的超前断言。

**处置（2026-08-23 主控裁决）**：从 p2 spec 删除该断言（不改成恒空的条件断言），
缺口登记在此，**待 correction 生产者落地后回补该断言**。

### 2026-08-23 §37.4-E 事实绑定：修复与一个已知边界

`v31-context-fence-journey.spec.ts:199`（§37.4-E）的红**不是断言错，是产线不可达**：
定制创作提交从不声明 `requestedFactRefs`（App Shell 只在自由创作填它，
`composer-home.tsx:2626`），于是冻结快照的 `factRevisionRefs` 恒空，
`execution-plan-admission.ts:425` 的 `sameIdSet(空, 空)` 恒相等，
价格改多少次都判不出 stale → 无 successor → plan 只有一版 →
`living-plan.tsx:77` 的 `previousFacts` 恒 null → `agent-plan-diff` 永不挂载。

已修：服务端派生（`deriveMaterialFactRefs`，本轮 commit ④），只绑
`MATERIAL_FACT_KINDS`＋带有效期的事实，只在定制创作，走既有
`resolveExplicitFactGrants` 授予通道（仍在 `withPinnedHeads` 下 fail-closed）。

**机制实证更正（2026-08-23 晚，Core 内打点 + 同环境对照轮）**：派生不在提交时生效，而在
**开始制作的准入**（`composer-submission-gate` `admit()` 全程只调用一次）——那一刻派生出
`[…:price:1]` 并成为冻结快照；改价落库后准入侧的 `resolveFactHeads` 解析到 `price:2`
（`materialPriceOrDateChanged:true`），`evaluateExecutionPlanStaleness` 得
`diffKeys=["factRevisionRefs","contextDrifted"] status=stale` → successor → 第二版计划 → diff。
修复承重的真正原因：`execution-plan-live-facts.ts:450/473` 把事实比对**和**
`contextDrifted` 都关在 `snapshot.factRevisionRefs.length > 0` 门内，冻结集为空等于把整个围栏
静默关掉。对照轮（同机同库同端口，仅回退该 commit）立刻红在 `agent-plan-diff` 180s 不出现，
与打点逐字对上。commit ④ 的 message 里「提交时冻结」的叙述应按此条为准。

**已知边界（登记，未处理）**：冻结快照的 `allowedFactRefs` 上限 200
（`creation-execution-snapshot.ts`）。派生被截断在这个上限内、商家自报的 ref 优先，
`listActive` 按 factId 排序所以保留集合是确定的。**物料事实超过 200 条的工作区，
围栏只覆盖前 200 条**——这是刻意选择（宁可围栏覆盖子集，也不让派生把一次能跑的提交
变成 schema 拒绝），但它是个真边界，需要更大上限或分组摘要时回到这里。
