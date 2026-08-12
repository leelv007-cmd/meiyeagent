# V31-28 — Composer 旅程上的 workbench 计划/中断面确定性渲染（§37.4-C/E/H 缺口）

**Parent**: V31-10 / V31-14（票已关，本票承接其浏览器旅程未闭合部分）
**批次**: 收尾
**Blocked by**: None — can start immediately
**Status**: reopened（2026-08-12）— 五腿定性并修净四腿（编舞漂移/SSE 帧门/答案竞态/写闸拒收），xhs 主旅程本地整案绿（1 passed 34.6s）；余=免费 copy 腿（V31-14/25 快照 Make 设计性不提问）方案期提问 vs spec 改约待用户拍板＋三门 CI 复跑

**Implementation state**: implemented
**Verification state**: evidence-debt
**Evidence SHA**: c3a9d02dbafc3ba5560be41870f1f2250f897856
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

Living Plan 组件与 plan reducer 主逻辑无需重写。诊断打点现场保留在 lane-28 worktree（美业内容2-lane-28，spec 已解 fixme＋网络/宿主打点＋afterAll 暂移；PG 证据库 meiye_lane28），实施 lane 可直接取用。

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

**记录在案的跟进项**：① `answerExecutionConfirmation` 与腿 4 同构（也依赖 plain 读腿的 `pendingExecutionConfirmation`）——V31-63 fence 编舞重排时若确认卡同样由 snapshot 腿先渲染会踩同一竞态，届时按腿 4 方案同修；② 第 7 轮 Core 日志一条非致命 `L0.5 production sampling failed: EvalLayerResult ... is immutable and already bound to different facts`（采样层，不阻旅程），若三门复跑再现需另查；③ m04 image_text 与 xhs 共用同一 fixture 路径，未单独本地复跑，以三门 CI 复跑为准。
